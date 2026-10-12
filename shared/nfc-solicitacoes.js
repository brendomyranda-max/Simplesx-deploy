import { estabelecimentoId, gerarToken, now, sha256 } from './util.js';
import { normalizarUidNfc } from './nfc.js';

const ID = /^[a-f0-9-]{36}$/;
const TOKEN = /^[A-F0-9]{64}$/;

export async function criarSolicitacaoNfcHandler(c, env) {
  const id = crypto.randomUUID();
  const token = gerarToken() + gerarToken();
  const criado = now();
  const expira = new Date(Date.now() + 120_000).toISOString();
  await env.DB.prepare('DELETE FROM nfc_solicitacoes WHERE expira_em<?')
    .bind(new Date(Date.now() - 600_000).toISOString()).run();
  await env.DB.prepare(`INSERT INTO nfc_solicitacoes
    (id, estabelecimento_id, funcionario_id, token_hash, criado_em, expira_em) VALUES (?,?,?,?,?,?)`)
    .bind(id, estabelecimentoId(env), c.user.id, await sha256(token), criado, expira).run();
  return c.json({ id, token, expira_em: expira });
}

async function solicitacaoDoUsuario(c, env) {
  if (!ID.test(c.params.id || '')) return null;
  return env.DB.prepare('SELECT id, uid, expira_em, cancelado_em FROM nfc_solicitacoes WHERE id=? AND funcionario_id=?')
    .bind(c.params.id, c.user.id).first();
}

export async function consultarSolicitacaoNfcHandler(c, env) {
  const row = await solicitacaoDoUsuario(c, env);
  if (!row) return c.json({ error: 'Solicitação não encontrada' }, 404);
  if (row.cancelado_em) return c.json({ estado: 'cancelado' });
  // O navegador pode ficar suspenso enquanto o leitor está aberto.
  if (row.uid && Date.now() - Date.parse(row.expira_em) < 300_000) {
    return c.json({ estado: 'lido', uid: row.uid, payload: '' });
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
  const row = await db.prepare('SELECT id, uid, expira_em, cancelado_em FROM nfc_solicitacoes WHERE id=? AND token_hash=?')
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
