/**
 * Arquivo: nfc.js
 * Responsabilidade: Valida leituras NFC e grava a ponte isolada por estabelecimento.
 */

import { httpError, now } from './util.js';

const JANELA_DUPLICADA_MS = 2000;
const RETENCAO_MS = 24 * 60 * 60 * 1000;
const PENDENTE_MS = 10 * 60 * 1000;
const PREFIXO_NFC = /^(?=.*[^0-9])[A-Za-z0-9:_.-]{1,12}$/;

function semControle(value) {
  return String(value || '').replace(/[\u0000-\u001F\u007F]/g, '').trim();
}

export function normalizarLeituraNfc(body) {
  const uid = semControle(body?.uid);
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

export async function registrarLeituraNfc(db, estabelecimentoId, leitura, origem) {
  const id = Number(estabelecimentoId);
  if (!Number.isInteger(id) || id <= 0) throw httpError(401, 'Gestor não vinculado a um estabelecimento');
  const agora = now();
  const recente = await db.prepare(
    `SELECT id, uid, payload, origem FROM nfc_eventos
     WHERE estabelecimento_id=? AND uid=? AND criado_em>?
     ORDER BY id DESC LIMIT 1`
  ).bind(id, leitura.uid, new Date(Date.now() - JANELA_DUPLICADA_MS).toISOString()).first();
  if (recente) return { id: recente.id, uid: recente.uid, payload: recente.payload, origem: recente.origem, duplicate: true };

  const criado = await db.prepare(
    `INSERT INTO nfc_eventos (estabelecimento_id, origem, leitor, uid, payload, criado_em)
     VALUES (?,?,?,?,?,?)`
  ).bind(id, origem, leitura.leitor, leitura.uid, leitura.payload, agora).run();
  await db.prepare(
    `DELETE FROM nfc_eventos WHERE estabelecimento_id=? AND (
      (consumido_em IS NOT NULL AND consumido_em<?) OR criado_em<?)`
  ).bind(id, new Date(Date.now() - RETENCAO_MS).toISOString(), new Date(Date.now() - PENDENTE_MS).toISOString()).run();
  return { id: criado.meta.last_row_id, uid: leitura.uid, payload: leitura.payload, origem, duplicate: false };
}

export async function publicarNfcGestorHandler(c, env) {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') return c.json({ error: 'Corpo JSON obrigatório' }, 400);
  const token = String(body.token || '').trim();
  const sessionId = String(body.session_id || '');
  if (!token || !sessionId) return c.json({ error: 'Sessão do gestor não autorizada' }, 401);
  const gestor = await env.DB.prepare(
    'SELECT estabelecimento_id FROM gestores WHERE token=? AND sessao_id=? AND ativo=1'
  ).bind(token, sessionId).first();
  if (!gestor) return c.json({ error: 'Sessão do gestor não autorizada' }, 401);
  const leitura = normalizarLeituraNfc(body);
  const evento = await registrarLeituraNfc(env.DB, gestor.estabelecimento_id, leitura, 'desktop');
  return c.json({ ok: true, ...evento });
}

export async function listarNfcHandler(c, env) {
  const historico = c.req.query('historico') === '1';
  const rows = historico
    ? await env.DB.prepare(
      `SELECT id, origem, leitor, uid, payload, criado_em, consumido_em
       FROM nfc_eventos ORDER BY id DESC LIMIT 10`
    ).all()
    : await env.DB.prepare(
      `SELECT id, origem, leitor, uid, payload, criado_em
       FROM nfc_eventos WHERE consumido_em IS NULL AND criado_em>? ORDER BY id LIMIT 20`
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
