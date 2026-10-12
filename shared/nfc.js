/**
 * Arquivo: nfc.js
 * Responsabilidade: Valida leituras NFC e grava a ponte isolada por estabelecimento.
 */

import { estabelecimentoId, httpError, now } from './util.js';

const JANELA_DUPLICADA_MS = 2000;
const RETENCAO_MS = 24 * 60 * 60 * 1000;
const PENDENTE_MS = 10 * 60 * 1000;
const PREFIXO_NFC = /^(?=.*[^0-9])[A-Za-z0-9:_.-]{1,12}$/;

function semControle(value) {
  return String(value || '').replace(/[\u0000-\u001F\u007F]/g, '').trim();
}

export function normalizarUidNfc(value) {
  const uid = semControle(value);
  const hex = uid.replace(/[\s:-]/g, '');
  // UIDs NFC de 4, 7 (NTAG215) ou 10 bytes, na ordem enviada pelo leitor.
  return /^(?:[0-9a-f]{8}|[0-9a-f]{14}|[0-9a-f]{20})$/i.test(hex) ? hex.toUpperCase() : uid;
}

export function normalizarLeituraNfc(body) {
  const uid = normalizarUidNfc(body?.uid);
  const payload = semControle(body?.payload);
  const leitor = semControle(body?.leitor).slice(0, 80);
  if (!/^[\x20-\x7E]{1,128}$/.test(uid)) throw httpError(400, 'Leitura NFC inválida');
  if (payload.length > 256) throw httpError(400, 'Conteúdo NFC longo demais');
  return { uid, payload, leitor };
}

export function prefixoNfcValido(prefixo) {
  return PREFIXO_NFC.test(String(prefixo || ''));
}

export async function sincronizarConfigNfc(db, estabelecimentoId, nfc) {
  const id = Number(estabelecimentoId);
  if (!Number.isInteger(id) || id <= 0 || !nfc || typeof nfc !== 'object') return;
  const prefixo = String(nfc.prefixo || 'NFC:');
  const ativo = Boolean(nfc.ativo) && prefixoNfcValido(prefixo);
  const salvar = (chave, valor) => db.prepare(
    `INSERT INTO empresa_config (estabelecimento_id, chave, valor) VALUES (?, ?, ?)
     ON CONFLICT(estabelecimento_id, chave) DO UPDATE SET valor=excluded.valor`
  ).bind(id, chave, valor).run();
  await salvar('nfc_ativo', ativo ? '1' : '0');
  if (prefixoNfcValido(prefixo)) await salvar('nfc_prefixo', prefixo);
}

export async function registrarLeituraNfc(db, estabelecimentoId, leitura, origem, consumidoPor = null, servidor = null, deduplicar = true) {
  const id = Number(estabelecimentoId);
  if (!Number.isInteger(id) || id <= 0) throw httpError(401, 'Gestor não vinculado a um estabelecimento');
  const agora = now();
  const recente = deduplicar && await db.prepare(
    `SELECT id, uid, payload, origem FROM nfc_eventos
     WHERE estabelecimento_id=? AND uid=? AND origem=? AND criado_em>? AND servidor_tipo IS ? AND servidor_id IS ?
     ORDER BY id DESC LIMIT 1`
  ).bind(id, leitura.uid, origem, new Date(Date.now() - JANELA_DUPLICADA_MS).toISOString(), servidor?.tipo ?? null, servidor?.id ?? null).first();
  if (recente) return { id: recente.id, uid: recente.uid, payload: recente.payload, origem: recente.origem, duplicate: true };

  const criado = await db.prepare(
    `INSERT INTO nfc_eventos (estabelecimento_id, origem, leitor, uid, payload, criado_em, consumido_em, consumido_por, servidor_tipo, servidor_id)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).bind(id, origem, leitura.leitor, leitura.uid, leitura.payload, agora,
    consumidoPor === null ? null : agora, consumidoPor === null ? null : String(consumidoPor), servidor?.tipo ?? null, servidor?.id ?? null).run();
  await db.prepare(
    `DELETE FROM nfc_eventos WHERE estabelecimento_id=? AND (
      (consumido_em IS NOT NULL AND consumido_em<?) OR criado_em<?)`
  ).bind(id, new Date(Date.now() - RETENCAO_MS).toISOString(), new Date(Date.now() - PENDENTE_MS).toISOString()).run();
  return { id: criado.meta.last_row_id, uid: leitura.uid, payload: leitura.payload, origem, criado_em: agora, duplicate: false };
}

export async function registrarNfcServidor(db, tenantId, leitura, origem, servidor) {
  // O servidor autenticado determina a origem, nunca campos enviados pelo cliente.
  const request = await db.prepare(`SELECT id, funcionario_id FROM nfc_solicitacoes
    WHERE estabelecimento_id=? AND servidor_tipo=? AND servidor_id=?
    AND uid IS NULL AND cancelado_em IS NULL AND expira_em>? ORDER BY criado_em LIMIT 1`)
    .bind(tenantId, servidor.tipo, servidor.id, now()).first();
  if (!request) {
    // Duas notificações do mesmo toque podem chegar após a primeira concluir a
    // espera. A segunda não deve reaparecer na fila geral de outro atendimento.
    const recent = await db.prepare(`SELECT evento_id FROM nfc_solicitacoes
      WHERE estabelecimento_id=? AND servidor_tipo=? AND servidor_id=? AND recebido_em>?
      ORDER BY recebido_em DESC LIMIT 1`).bind(tenantId, servidor.tipo, servidor.id,
      new Date(Date.now() - JANELA_DUPLICADA_MS).toISOString()).first();
    if (recent?.evento_id) {
      const event = await db.prepare('SELECT id, uid, payload, origem FROM nfc_eventos WHERE id=? AND estabelecimento_id=?')
        .bind(recent.evento_id, tenantId).first();
      if (event) return { ...event, duplicate: true };
    }
  }
  const evento = await registrarLeituraNfc(db, tenantId, leitura, origem, request?.funcionario_id ?? null, servidor, !request);
  if (request) {
    await db.prepare(`UPDATE nfc_solicitacoes SET uid=?, payload=?, recebido_em=?, evento_id=?
      WHERE id=? AND estabelecimento_id=? AND uid IS NULL AND cancelado_em IS NULL AND expira_em>?`)
      .bind(leitura.uid, leitura.payload, now(), evento.id, request.id, tenantId, now()).run();
  }
  return evento;
}

// A tela interna recebe o UID do leitor nativo e usa sua própria sessão web.
// Já nasce consumida: outra tela não pode capturar o cartão deste atendimento.
export async function identificarNfcLocalHandler(c, env) {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') return c.json({ error: 'Corpo JSON obrigatório' }, 400);
  const leitura = normalizarLeituraNfc({ uid: body.uid, leitor: 'Android integrado' });
  if (!/^(?:[0-9A-F]{8}|[0-9A-F]{14}|[0-9A-F]{20})$/.test(leitura.uid)) {
    return c.json({ error: 'UID NFC inválido' }, 400);
  }
  const evento = await registrarLeituraNfc(env.DB, estabelecimentoId(env), leitura, 'android-local', c.user.id);
  return c.json({ ok: true, ...evento });
}

export async function publicarNfcGestorHandler(c, env) {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') return c.json({ error: 'Corpo JSON obrigatório' }, 400);
  const token = String(body.token || '').trim();
  const sessionId = String(body.session_id || '');
  if (!token || !sessionId) return c.json({ error: 'Sessão do gestor não autorizada' }, 401);
  const gestor = await env.DB.prepare(
    'SELECT id, estabelecimento_id FROM gestores WHERE token=? AND sessao_id=? AND ativo=1'
  ).bind(token, sessionId).first();
  if (!gestor) return c.json({ error: 'Sessão do gestor não autorizada' }, 401);
  const leitura = normalizarLeituraNfc(body);
  const evento = await registrarNfcServidor(env.DB, gestor.estabelecimento_id, leitura, 'desktop', { tipo: 'desktop', id: String(gestor.id) });
  return c.json({ ok: true, ...evento });
}

export async function listarNfcHandler(c, env) {
  const historico = c.req.query('historico') === '1';
  const diagnostico = c.req.query('diagnostico');
  const filtroOrigem = diagnostico === 'todos' ? ''
    : diagnostico === '1' ? "AND origem='android-teste'" : "AND origem!='android-teste'";
  const rows = historico
    ? await env.DB.prepare(
      `SELECT id, origem, leitor, uid, payload, criado_em, consumido_em
       FROM nfc_eventos ORDER BY id DESC LIMIT 10`
    ).all()
    : await env.DB.prepare(
      `SELECT id, origem, leitor, uid, payload, criado_em
       FROM nfc_eventos WHERE consumido_em IS NULL AND criado_em>?
       ${filtroOrigem} ORDER BY id LIMIT 20`
    ).bind(new Date(Date.now() - 60_000).toISOString()).all();
  return c.json(rows.results);
}

export async function consumirNfcHandler(c, env) {
  const id = Number(c.params?.id);
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Leitura não encontrada' }, 404);
  const row = await env.DB.prepare('SELECT id, uid, payload, origem, consumido_em FROM nfc_eventos WHERE id=?').bind(id).first();
  if (!row) return c.json({ error: 'Leitura não encontrada' }, 404);
  if (row.consumido_em) return c.json({ error: 'Leitura já recebida em outro terminal' }, 409);
  const result = await env.DB.prepare(
    `UPDATE nfc_eventos SET consumido_em=?, consumido_por=? WHERE id=? AND consumido_em IS NULL`
  ).bind(now(), String(c.user?.id || ''), id).run();
  if (!result.meta.changes) return c.json({ error: 'Leitura já recebida em outro terminal' }, 409);
  return c.json({ ok: true, id: row.id, uid: row.uid, payload: row.payload, origem: row.origem });
}
