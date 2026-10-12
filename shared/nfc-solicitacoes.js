import { estabelecimentoId, gerarToken, now, sha256 } from './util.js';
import { normalizarUidNfc } from './nfc.js';
import { serverCutoff } from './print-servers.js';

const ID = /^[a-f0-9-]{36}$/;
const TOKEN = /^[A-F0-9]{64}$/;

export async function listarServidoresNfcHandler(c, env) {
  // Apenas os nomes e o estado de conexão; nunca credenciais de pareamento.
  const desktop = await env.DB.prepare(`SELECT id, nome, ultima_conexao FROM gestores WHERE ativo=1 AND sessao_id IS NOT NULL`).all();
  const android = await env.DB.prepare(`SELECT id, nome, ultima_conexao, status FROM devices
    WHERE revogado_em IS NULL AND token_expira_em>? AND plataforma='android'`).bind(now()).all();
  const cutoff = serverCutoff();
  return c.json([
    ...android.results.map((r) => ({ tipo: 'android', id: String(r.id), nome: r.nome, online: r.status === 'online' && r.ultima_conexao > cutoff })),
    ...desktop.results.map((r) => ({ tipo: 'desktop', id: String(r.id), nome: r.nome || 'Servidor do computador', online: r.ultima_conexao > cutoff })),
  ]);
}

export async function criarSolicitacaoNfcHandler(c, env) {
  const body = await c.req.json().catch(() => null);
  const tipo = body?.servidor_tipo ?? null;
  const servidorId = body?.servidor_id == null ? null : String(body.servidor_id);
  if (tipo !== null || servidorId !== null) {
    if (!['android', 'desktop'].includes(tipo) || !servidorId || servidorId.length > 100) return c.json({ error: 'Selecione um servidor NFC válido' }, 400);
    const servidor = tipo === 'android'
      ? await env.DB.prepare(`SELECT id FROM devices WHERE id=? AND revogado_em IS NULL AND token_expira_em>? AND plataforma='android'`).bind(servidorId, now()).first()
      : await env.DB.prepare(`SELECT id FROM gestores WHERE id=? AND ativo=1 AND sessao_id IS NOT NULL`).bind(servidorId).first();
    if (!servidor) return c.json({ error: 'Servidor não vinculado a este estabelecimento' }, 404);
  }
  const id = crypto.randomUUID();
  const token = gerarToken() + gerarToken();
  const criado = now();
  const expira = new Date(Date.now() + 120_000).toISOString();
  await env.DB.prepare('DELETE FROM nfc_solicitacoes WHERE expira_em<?')
    .bind(new Date(Date.now() - 600_000).toISOString()).run();
  const result = await env.DB.prepare(`INSERT INTO nfc_solicitacoes
    (id, estabelecimento_id, funcionario_id, token_hash, criado_em, expira_em, servidor_tipo, servidor_id)
    SELECT ?,?,?,?,?,?,?,? WHERE ? IS NULL OR NOT EXISTS (
      SELECT 1 FROM nfc_solicitacoes WHERE estabelecimento_id=? AND servidor_tipo=? AND servidor_id=?
      AND uid IS NULL AND cancelado_em IS NULL AND expira_em>?)`)
    .bind(id, estabelecimentoId(env), c.user.id, await sha256(token), criado, expira, tipo, servidorId,
      tipo, estabelecimentoId(env), tipo, servidorId, criado).run();
  if (!result.meta.changes) return c.json({ error: 'Este leitor está aguardando um cartão em outra tela. Conclua ou cancele essa espera e tente novamente.' }, 409);
  return c.json({ id, token, expira_em: expira });
}

async function solicitacaoDoUsuario(c, env) {
  if (!ID.test(c.params.id || '')) return null;
  return env.DB.prepare('SELECT id, uid, payload, evento_id, expira_em, cancelado_em FROM nfc_solicitacoes WHERE id=? AND funcionario_id=?')
    .bind(c.params.id, c.user.id).first();
}

export async function consultarSolicitacaoNfcHandler(c, env) {
  const row = await solicitacaoDoUsuario(c, env);
  if (!row) return c.json({ error: 'Solicitação não encontrada' }, 404);
  if (row.cancelado_em) return c.json({ estado: 'cancelado' });
  // O navegador pode ficar suspenso enquanto o leitor está aberto.
  if (row.uid && Date.now() - Date.parse(row.expira_em) < 300_000) {
    await env.DB.prepare('UPDATE nfc_solicitacoes SET entregue_em=COALESCE(entregue_em,?) WHERE id=? AND funcionario_id=?')
      .bind(now(), row.id, c.user.id).run();
    return c.json({ estado: 'lido', uid: row.uid, payload: row.payload || '' });
  }
  return c.json({ estado: row.expira_em <= now() ? 'expirado' : 'aguardando' });
}

export async function cancelarSolicitacaoNfcHandler(c, env) {
  const row = await solicitacaoDoUsuario(c, env);
  if (!row) return c.json({ error: 'Solicitação não encontrada' }, 404);
  await env.DB.prepare('UPDATE nfc_solicitacoes SET cancelado_em=? WHERE id=? AND funcionario_id=?')
    .bind(now(), row.id, c.user.id).run();
  return c.json({ ok: true });
}

// Sem sessão/cadastro de impressora: esta capacidade só pode fornecer um UID,
// por dois minutos, à solicitação criada pelo funcionário logado. Não lança pedidos.
export async function responderSolicitacaoNfcHandler(c, env) {
  const body = await c.req.json().catch(() => null);
  const id = c.params.id || '';
  const token = body?.token;
  if (!ID.test(id) || typeof token !== 'string' || !TOKEN.test(token)) {
    return c.json({ error: 'Solicitação NFC inválida' }, 401);
  }
  const db = env.rawDB || env.DB;
  const hash = await sha256(token);
  const row = await db.prepare('SELECT id, uid, expira_em, cancelado_em FROM nfc_solicitacoes WHERE id=? AND token_hash=? AND servidor_tipo IS NULL')
    .bind(id, hash).first();
  if (!row) return c.json({ error: 'Solicitação NFC inválida' }, 401);
  if (row.cancelado_em || row.expira_em <= now()) return c.json({ error: 'A espera terminou. Volte à DoixP e solicite a leitura novamente.' }, 410);
  const uid = typeof body.uid === 'string' ? normalizarUidNfc(body.uid) : '';
  if (!/^(?:[0-9A-F]{8}|[0-9A-F]{14}|[0-9A-F]{20})$/.test(uid)) return c.json({ error: 'UID NFC inválido' }, 400);
  if (row.uid) return c.json(row.uid === uid ? { ok: true } : { error: 'Outro cartão já foi recebido nesta espera' }, row.uid === uid ? 200 : 409);
  const result = await db.prepare(`UPDATE nfc_solicitacoes SET uid=?, recebido_em=?
    WHERE id=? AND token_hash=? AND uid IS NULL AND cancelado_em IS NULL AND expira_em>?`)
    .bind(uid, now(), id, hash, now()).run();
  if (!result.meta.changes) {
    const atual = await db.prepare('SELECT uid, cancelado_em, expira_em FROM nfc_solicitacoes WHERE id=? AND token_hash=?').bind(id, hash).first();
    if (atual?.uid === uid && !atual.cancelado_em && atual.expira_em > now()) return c.json({ ok: true });
    return c.json({ error: 'A espera terminou ou outro cartão já foi recebido' }, 409);
  }
  return c.json({ ok: true });
}
