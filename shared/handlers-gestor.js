/**
 * Arquivo: handlers-gestor.js
 * Responsabilidade: Mantém o protocolo legado da fila de impressão.
 */

import { now, num, gerarToken, getConfigValue, estabelecimentoId } from './util.js';
import { createDeviceTask } from './handlers-devices.js';
import { cleanupServerStatements, serverCutoff, SESSION_CONFLICT } from './print-servers.js';

// ============================ GESTOR LOCAL (conexão direta com o deploy) ============================

const CLAIM_LIMIT = 20;
const RECLAIM_MS = 120_000;

/**
 * Registra/atualiza um gestor local. O gestor chama isso ao iniciar com um
 * token próprio (gerado na primeira execução); o servidor guarda nome + IP
 * (identificação) e devolve o token confirmado.
 * Público: autenticado pelo próprio token (o gestor gera um token aleatório).
 */
export async function registerGestorHandler(c, env) {
  const b = await c.req.json();
  if (!b || typeof b !== 'object') return c.json({ error: 'Corpo JSON obrigatório' }, 400);

  const token = (b.token && String(b.token).trim()) || gerarToken();
  const sessionId = String(b.session_id || '').trim();
  if (!sessionId || sessionId.length > 100) return c.json({ error: 'Atualize o Gestor de Impressoras para conectar com uma sessão segura.' }, 400);
  if (token.length > 256) return c.json({ error: 'Token inválido' }, 400);
  const nome = (b.nome && String(b.nome).trim()) || 'Gestor';
  const ip = (b.ip && String(b.ip).trim()) || '';
  const printers = Array.isArray(b.printers) ? b.printers.slice(0, 100).map((p) => ({
    name: String(p?.name || '').trim().slice(0, 120),
    displayName: String(p?.displayName || p?.name || '').trim().slice(0, 120),
    isDefault: !!p?.isDefault,
  })).filter((p) => p.name) : [];

  const result = await env.DB.prepare(`INSERT INTO gestores
      (token, nome, ip, printers_json, ultima_conexao, criado_em, ativo, sessao_id)
      VALUES (?,?,?,?,?,?,1,?)
      ON CONFLICT(token) DO UPDATE SET nome=excluded.nome, ip=excluded.ip,
        printers_json=excluded.printers_json, ultima_conexao=excluded.ultima_conexao,
        ativo=1, sessao_id=excluded.sessao_id
      WHERE gestores.sessao_id=excluded.sessao_id OR gestores.ultima_conexao IS NULL OR gestores.ultima_conexao<=?`)
    .bind(token, nome, ip, JSON.stringify(printers), now(), now(), sessionId, serverCutoff()).run();
  if (!result.meta.changes) return c.json({ error: SESSION_CONFLICT }, 409);
  return c.json({ ok: true, token, nome, ip });
}

/**
 * O gestor busca os trabalhos pendentes (polling). Os trabalhos são "reclamados"
 * (status pendente -> enviado) para evitar duplicidade; se não forem confirmados
 * em RECLAIM_MS, voltam a ficar pendentes.
 * Público: autenticado pelo token do gestor.
 */
export async function pullGestorJobsHandler(c, env) {
  const b = await c.req.json();
  const token = b?.token ? String(b.token).trim() : '';
  if (!token) return c.json({ error: 'Token do gestor obrigatório' }, 401);

  const sessionId = String(b?.session_id || '');
  const lease = await env.DB.prepare('UPDATE gestores SET ultima_conexao=? WHERE token=? AND sessao_id=? AND ativo=1')
    .bind(now(), token, sessionId).run();
  if (!sessionId || !lease.meta.changes) return c.json({ error: 'Sessão do gestor não autorizada. Conecte novamente.' }, 401);

  // Trabalhos reclamados mas não confirmados a tempo voltam para a fila.
  await env.DB.prepare(
    "UPDATE gestor_jobs SET status='pendente', enviado_em=NULL WHERE gestor_token=? AND status='enviado' AND enviado_em < ?"
  )
    .bind(token, new Date(Date.now() - RECLAIM_MS).toISOString())
    .run();

  const pendentes = await env.DB.prepare(
    "SELECT id, tipo, conteudo, impressora, largura_mm, copias, cortar, alimentar FROM gestor_jobs WHERE gestor_token=? AND status='pendente' ORDER BY id LIMIT ?"
  )
    .bind(token, CLAIM_LIMIT)
    .all();

  const jobs = [];
  for (const j of pendentes.results) {
    const claimed = await env.DB.prepare("UPDATE gestor_jobs SET status='enviado', enviado_em=? WHERE id=? AND status='pendente'")
      .bind(now(), j.id)
      .run();
    if (!claimed.meta.changes) continue;
    jobs.push({
      id: j.id,
      tipo: j.tipo || 'texto',
      conteudo: j.conteudo || '',
      impressora: j.impressora || null,
      largura_mm: num(j.largura_mm) || 80,
      copias: Math.max(1, num(j.copias) || 1),
      cortar: j.cortar !== 0,
      alimentar: Math.max(0, num(j.alimentar) || 0),
    });
  }

  return c.json({ ok: true, jobs });
}

/**
 * O gestor confirma o resultado do trabalho: 'feito' ou 'erro'.
 * Público: autenticado pelo token do gestor.
 */
export async function gestorJobStatusHandler(c, env) {
  const jobId = num(c.params?.id);
  if (!jobId) return c.json({ error: 'ID do trabalho obrigatório' }, 400);

  const b = await c.req.json();
  const token = b?.token ? String(b.token).trim() : '';
  if (!token) return c.json({ error: 'Token do gestor obrigatório' }, 401);

  const gestor = await env.DB.prepare('SELECT id FROM gestores WHERE token=? AND sessao_id=? AND ativo=1')
    .bind(token, String(b?.session_id || '')).first();
  if (!gestor) return c.json({ error: 'Gestor não reconhecido' }, 401);

  const status = b?.status === 'erro' ? 'erro' : 'feito';
  const erro = status === 'erro' ? String(b?.erro || 'Falha na impressão') : null;

  await env.DB.prepare('UPDATE gestor_jobs SET status=?, erro=?, executado_em=? WHERE id=? AND gestor_token=?')
    .bind(status, erro, now(), jobId, token)
    .run();

  return c.json({ ok: true });
}

/** Lista os gestores cadastrados (para o pareamento na tela de Impressoras). */
export async function listGestoresHandler(c, env) {
  const rows = await env.DB.prepare(
    `SELECT id, COALESCE(nome_personalizado,nome) AS nome, ip, ultima_conexao, ativo, printers_json,
      '••••' || SUBSTR(token, -4) AS token_final,
      token=(SELECT valor FROM empresa_config WHERE estabelecimento_id=? AND chave='gestor_token') AS padrao
      FROM gestores WHERE ativo=1 ORDER BY nome`
  ).bind(estabelecimentoId(env)).all();
  return c.json(rows.results.map((row) => ({ ...row, online: !!row.ultima_conexao && row.ultima_conexao > serverCutoff(), printers: JSON.parse(row.printers_json || '[]') })));
}

export async function disconnectGestorHandler(c, env) {
  const b = await c.req.json();
  const result = await env.DB.prepare('UPDATE gestores SET sessao_id=NULL, ultima_conexao=NULL WHERE token=? AND sessao_id=? AND ativo=1')
    .bind(String(b?.token || ''), String(b?.session_id || '')).run();
  if (!result.meta.changes) return c.json({ error: 'Sessão do gestor não autorizada' }, 401);
  return c.json({ ok: true });
}

export async function heartbeatGestorHandler(c, env) {
  const b = await c.req.json();
  const result = await env.DB.prepare('UPDATE gestores SET ultima_conexao=? WHERE token=? AND sessao_id=? AND ativo=1')
    .bind(now(), String(b?.token || ''), String(b?.session_id || '')).run();
  if (!result.meta.changes) return c.json({ error: 'Sessão do gestor não autorizada' }, 401);
  return c.json({ ok: true });
}

export async function updateGestorHandler(c, env) {
  const b = await c.req.json();
  const nome = String(b?.nome || '').trim();
  if (!nome || nome.length > 120) return c.json({ error: 'Informe um nome de até 120 caracteres' }, 400);
  const result = await env.DB.prepare('UPDATE gestores SET nome_personalizado=? WHERE id=? AND ativo=1').bind(nome, c.params.id).run();
  if (!result.meta.changes) return c.json({ error: 'Servidor não encontrado' }, 404);
  return c.json({ ok: true });
}

export async function deleteGestorHandler(c, env) {
  const tenantId = estabelecimentoId(env);
  const gestor = await env.DB.prepare('SELECT * FROM gestores WHERE id=? AND ativo=1').bind(c.params.id).first();
  if (!gestor) return c.json({ error: 'Servidor não encontrado' }, 404);
  const marker = gerarToken();
  const results = await env.rawDB.batch([
    env.rawDB.prepare(`UPDATE gestores SET ativo=0, estabelecimento_id=0, sessao_id=?, ultima_conexao=NULL, nome_personalizado=NULL
      WHERE id=? AND estabelecimento_id=? AND ativo=1 AND (ultima_conexao IS NULL OR ultima_conexao<=?)`)
      .bind(marker, gestor.id, tenantId, serverCutoff()),
    ...cleanupServerStatements(env.rawDB, tenantId, 'desktop', gestor.id, gestor.token,
      'EXISTS (SELECT 1 FROM gestores WHERE id=? AND sessao_id=? AND ativo=0)', [gestor.id, marker]),
  ]);
  if (!results[0].meta.changes) return c.json({ error: SESSION_CONFLICT }, 409);
  return c.json({ ok: true, padrao_removido: true });
}

/**
 * O app envia uma impressão para a fila do gestor (qualquer dispositivo).
 * O token vem do corpo ou da configuração padrão (gestor_token).
 */
export async function enviarImpressaoHandler(c, env) {
  const b = await c.req.json();
  if (!b || typeof b !== 'object') return c.json({ error: 'Corpo JSON obrigatório' }, 400);

  const conteudo = b.conteudo != null ? String(b.conteudo) : '';
  if (!conteudo.trim()) return c.json({ error: 'Informe o conteúdo da impressão' }, 400);
  if (b.tipo && b.tipo !== 'texto') {
    return c.json({ error: 'Somente conteúdo textual é aceito para impressão térmica RAW' }, 400);
  }

  const deviceId = (b.device_id && String(b.device_id).trim()) || (await getConfigValue(env, 'gestor_device_id', ''));
  if (deviceId) {
    const result = await createDeviceTask(env, c.user, {
      device_id: deviceId,
      type: 'PRINT_RECEIPT',
      payload: {
        content: conteudo,
        printer: b.impressora ? String(b.impressora) : null,
        width_mm: num(b.largura_mm) || 80,
        copies: Math.max(1, num(b.copias) || 1),
        cut: b.cortar === undefined || !!b.cortar,
        feed: Math.max(0, num(b.alimentar) || 0),
      },
      idempotency_key: `print-${crypto.randomUUID()}`,
      source_type: 'web_print',
    });
    return c.json({ ok: true, task_id: result.task.id }, 201);
  }

  const gestorToken = (b.gestor_token && String(b.gestor_token).trim()) || (await getConfigValue(env, 'gestor_token', ''));
  if (!gestorToken) {
    return c.json({ error: 'Nenhum gestor configurado. Cadastre o token do gestor em Impressoras.' }, 400);
  }

  const gestor = await env.DB.prepare('SELECT id FROM gestores WHERE token=? AND ativo=1').bind(gestorToken).first();
  if (!gestor) {
    return c.json({ error: 'Gestor não encontrado ou inativo. Confira o token.' }, 400);
  }

  const r = await env.DB.prepare(
    `INSERT INTO gestor_jobs
       (gestor_token, tipo, conteudo, impressora, largura_mm, copias, cortar, alimentar, status, criado_em)
     VALUES (?,?,?,?,?,?,?,?, 'pendente', ?)`
  )
    .bind(
      gestorToken,
      'texto',
      conteudo,
      b.impressora ? String(b.impressora) : null,
      num(b.largura_mm) || 80,
      Math.max(1, num(b.copias) || 1),
      b.cortar === undefined || b.cortar ? 1 : 0,
      Math.max(0, num(b.alimentar) || 0),
      now()
    )
    .run();

  return c.json({ ok: true, job_id: r.meta.last_row_id }, 201);
}
