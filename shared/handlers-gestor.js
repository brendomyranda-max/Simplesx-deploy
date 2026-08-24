import { now, num, gerarToken, getConfigValue } from './util.js';
import { createDeviceTask } from './handlers-devices.js';

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
  const nome = (b.nome && String(b.nome).trim()) || 'Gestor';
  const ip = (b.ip && String(b.ip).trim()) || '';

  const existe = await env.DB.prepare('SELECT id FROM gestores WHERE token=?').bind(token).first();
  if (existe) {
    await env.DB.prepare('UPDATE gestores SET nome=?, ip=?, ultima_conexao=? WHERE token=?')
      .bind(nome, ip, now(), token)
      .run();
  } else {
    await env.DB.prepare('INSERT INTO gestores (token, nome, ip, ultima_conexao, criado_em, ativo) VALUES (?,?,?,?,?,1)')
      .bind(token, nome, ip, now(), now())
      .run();
  }
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

  const gestor = await env.DB.prepare('SELECT id FROM gestores WHERE token=? AND ativo=1').bind(token).first();
  if (!gestor) return c.json({ error: 'Gestor não reconhecido' }, 401);

  await env.DB.prepare('UPDATE gestores SET ultima_conexao=? WHERE token=?').bind(now(), token).run();

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
    await env.DB.prepare("UPDATE gestor_jobs SET status='enviado', enviado_em=? WHERE id=? AND status='pendente'")
      .bind(now(), j.id)
      .run();
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

  const gestor = await env.DB.prepare('SELECT id FROM gestores WHERE token=? AND ativo=1').bind(token).first();
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
    "SELECT id, nome, ip, ultima_conexao, ativo, '••••' || SUBSTR(token, -4) AS token_final FROM gestores ORDER BY nome"
  ).all();
  return c.json(rows.results);
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
