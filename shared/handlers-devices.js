import { estabelecimentoId, gerarToken, httpError, kvGet, kvPut, now, num, sha256, temModulo } from './util.js';

export const DEVICE_TASK_TYPES = new Set([
  'PRINT_ORDER',
  'PRINT_RECEIPT',
  'PRINT_LABEL',
  'OPEN_CASH_DRAWER',
  'START_PAYMENT',
  'CANCEL_PAYMENT',
  'TEST_PRINTER',
]);

const DEVICE_STATUSES = new Set(['online', 'offline', 'disconnected', 'error']);
const TASK_RESULT_STATUSES = new Set(['processing', 'success', 'failed']);
const LEASE_MS = 120_000;
const TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const PAIRING_TTL_MS = 10 * 60 * 1000;
const CLAIM_LIMIT = 20;

function uuid() {
  return crypto.randomUUID();
}

function isoAfter(ms) {
  return new Date(Date.now() + ms).toISOString();
}

function jsonLimit(value, maxBytes = 64 * 1024) {
  let serialized;
  try {
    serialized = JSON.stringify(value ?? {});
  } catch {
    throw httpError(400, 'Conteúdo da tarefa não é JSON válido');
  }
  if (new TextEncoder().encode(serialized).byteLength > maxBytes) {
    throw httpError(413, 'Conteúdo da tarefa excede 64 KB');
  }
  return serialized;
}

function printerList(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).map((item) => ({
    name: text(item?.name || item?.nome, 120, 'Nome da impressora', true),
    connection: text(item?.connection || item?.conexao, 30, 'Conexão') || 'unknown',
    width_mm: [58, 80].includes(num(item?.width_mm || item?.largura_mm)) ? num(item?.width_mm || item?.largura_mm) : 80,
  }));
}

function rejectSensitivePaymentData(value, path = '') {
  if (!value || typeof value !== 'object') return;
  const forbidden = /^(card_?number|pan|cvv|cvc|pin|password|senha|track1|track2|magnetic_?stripe)$/i;
  for (const [key, child] of Object.entries(value)) {
    const currentPath = path ? `${path}.${key}` : key;
    if (forbidden.test(key)) throw httpError(400, `Dado sensível de cartão não permitido: ${currentPath}`);
    rejectSensitivePaymentData(child, currentPath);
  }
}

function text(value, max, field, required = false) {
  const result = String(value ?? '').trim();
  if (required && !result) throw httpError(400, `${field} obrigatório`);
  if (result.length > max) throw httpError(400, `${field} excede ${max} caracteres`);
  return result;
}

export function validateTaskPayload(type, payload) {
  if (!DEVICE_TASK_TYPES.has(type)) throw httpError(400, 'Tipo de tarefa inválido');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw httpError(400, 'Conteúdo da tarefa deve ser um objeto JSON');
  }
  if (type.startsWith('PRINT_') && type !== 'TEST_PRINTER') {
    if (!String(payload.content ?? payload.conteudo ?? '').trim()) throw httpError(400, 'Conteúdo de impressão obrigatório');
  }
  if (type === 'START_PAYMENT') {
    rejectSensitivePaymentData(payload);
    if (!(num(payload.amount ?? payload.valor) > 0)) throw httpError(400, 'Valor do pagamento deve ser positivo');
    text(payload.saleId ?? payload.sale_id, 100, 'saleId', true);
    text(payload.method ?? payload.forma, 40, 'forma de pagamento', true);
  }
  if (type === 'CANCEL_PAYMENT') {
    rejectSensitivePaymentData(payload);
    text(payload.saleId ?? payload.sale_id, 100, 'saleId', true);
  }
  return jsonLimit(payload);
}


async function deviceAudit(db, tenantId, deviceId, event, actorType, actorId, details) {
  await db.prepare(
    `INSERT INTO device_audit_events
      (estabelecimento_id, device_id, evento, detalhes_json, ator_tipo, ator_id, criado_em)
     VALUES (?,?,?,?,?,?,?)`
  ).bind(tenantId, deviceId || null, event, details ? jsonLimit(details, 16 * 1024) : null,
    actorType, actorId ? String(actorId) : null, now()).run();
}

async function audit(db, tenantId, taskId, deviceId, event, from, to, actorType, actorId, details) {
  await db.prepare(
    `INSERT INTO device_task_events
      (estabelecimento_id, task_id, device_id, evento, status_anterior, status_novo, detalhes_json, ator_tipo, ator_id, criado_em)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).bind(tenantId, taskId, deviceId, event, from || null, to || null, details ? jsonLimit(details, 16 * 1024) : null,
    actorType, actorId ? String(actorId) : null, now()).run();
}

async function authenticateDevice(c, env) {
  const authorization = String(c.req.header('authorization') || '');
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  const deviceId = text(c.req.header('x-device-id'), 100, 'deviceId', true);
  if (!token || token.length > 256) throw httpError(401, 'Credencial do dispositivo inválida');
  const device = await env.DB.prepare(
    `SELECT * FROM devices
     WHERE id=? AND token_hash=? AND token_expira_em>? AND revogado_em IS NULL`
  ).bind(deviceId, await sha256(token), now()).first();
  if (!device) throw httpError(401, 'Dispositivo não autorizado');
  return device;
}

export async function createPairingCodeHandler(c, env) {
  const tenantId = estabelecimentoId(env);
  const pairingId = uuid();
  // 48 bits aleatórios, exibidos em grupos, tornam adivinhação impraticável
  // durante a janela curta de uso sem armazenar o código em texto puro.
  const raw = gerarToken().slice(0, 12);
  const code = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
  const createdAt = now();
  const expiresAt = isoAfter(PAIRING_TTL_MS);
  await env.rawDB.prepare(
    `INSERT INTO device_pairing_codes
      (id, estabelecimento_id, code_hash, criado_por, expira_em, criado_em)
     VALUES (?,?,?,?,?,?)`
  ).bind(pairingId, tenantId, await sha256(code.replaceAll('-', '').toUpperCase()), c.user.id, expiresAt, createdAt).run();
  await deviceAudit(env.rawDB, tenantId, null, 'pairing_code_created', 'user', c.user.id,
    { pairing_id: pairingId, expires_at: expiresAt });
  return c.json({ pairing_id: pairingId, code, expires_at: expiresAt }, 201);
}

export async function pairDeviceHandler(c, env) {
  const body = await c.req.json();
  const pairingId = text(body?.pairing_id, 100, 'pairingId', true);
  const code = text(body?.code, 32, 'Código de pareamento', true).replaceAll('-', '').toUpperCase();
  const deviceId = text(body?.device_id, 100, 'deviceId', true);
  const name = text(body?.name || body?.nome, 120, 'Nome', true);
  const platform = text(body?.platform || body?.plataforma, 40, 'Plataforma', true).toLowerCase();
  const version = text(body?.version || body?.versao, 40, 'Versão');
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-real-ip') || 'local';
  const rateKey = `device-pair:${await sha256(ip)}`;
  if (num(await kvGet(env, rateKey)) >= 10) return c.json({ error: 'Muitas tentativas de pareamento. Aguarde.' }, 429);
  const pairing = await env.DB.prepare(
    `SELECT * FROM device_pairing_codes
     WHERE id=? AND code_hash=? AND usado_em IS NULL AND expira_em>?`
  ).bind(pairingId, await sha256(code), now()).first();
  if (!pairing) {
    await kvPut(env, rateKey, String(num(await kvGet(env, rateKey)) + 1), { expirationTtl: 900 });
    return c.json({ error: 'Código de pareamento inválido ou expirado' }, 401);
  }

  const consumedAt = now();
  const consumed = await env.DB.prepare(
    'UPDATE device_pairing_codes SET usado_em=? WHERE id=? AND usado_em IS NULL AND expira_em>?'
  ).bind(consumedAt, pairingId, consumedAt).run();
  if (!consumed.meta.changes) return c.json({ error: 'Código de pareamento já utilizado' }, 409);

  const existing = await env.DB.prepare('SELECT id, estabelecimento_id FROM devices WHERE id=?').bind(deviceId).first();
  if (existing && num(existing.estabelecimento_id) !== num(pairing.estabelecimento_id)) {
    return c.json({ error: 'Este dispositivo já pertence a outro estabelecimento' }, 409);
  }
  const token = gerarToken() + gerarToken();
  const tokenExpiresAt = isoAfter(TOKEN_TTL_MS);
  if (existing) {
    await env.DB.prepare(
      `UPDATE devices SET nome=?, plataforma=?, versao=?, token_hash=?, token_versao=token_versao+1,
       token_expira_em=?, status='offline', ultimo_erro=NULL, revogado_em=NULL, atualizado_em=? WHERE id=?`
    ).bind(name, platform, version || null, await sha256(token), tokenExpiresAt, consumedAt, deviceId).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO devices
       (id, estabelecimento_id, nome, plataforma, versao, token_hash, token_expira_em, status, criado_em, atualizado_em)
       VALUES (?,?,?,?,?,?,?,'offline',?,?)`
    ).bind(deviceId, pairing.estabelecimento_id, name, platform, version || null, await sha256(token), tokenExpiresAt,
      consumedAt, consumedAt).run();
  }
  await kvPut(env, rateKey, '0', { expirationTtl: 900 });
  await deviceAudit(env.DB, pairing.estabelecimento_id, deviceId, 'device_paired', 'device', deviceId,
    { name, platform, version: version || null });
  return c.json({ device_id: deviceId, device_token: token, token_expires_at: tokenExpiresAt,
    estabelecimento_id: pairing.estabelecimento_id }, 201);
}

export async function rotateDeviceTokenHandler(c, env) {
  const device = await authenticateDevice(c, env);
  const token = gerarToken() + gerarToken();
  const expiresAt = isoAfter(TOKEN_TTL_MS);
  const updatedAt = now();
  await env.DB.prepare(
    `UPDATE devices SET token_hash=?, token_versao=token_versao+1, token_expira_em=?, atualizado_em=?
     WHERE id=? AND estabelecimento_id=? AND revogado_em IS NULL`
  ).bind(await sha256(token), expiresAt, updatedAt, device.id, device.estabelecimento_id).run();
  await deviceAudit(env.DB, device.estabelecimento_id, device.id, 'device_token_rotated', 'device', device.id,
    { expires_at: expiresAt });
  return c.json({ device_token: token, token_expires_at: expiresAt });
}

export async function heartbeatDeviceHandler(c, env) {
  const device = await authenticateDevice(c, env);
  const body = await c.req.json();
  const status = DEVICE_STATUSES.has(body?.status) ? body.status : 'online';
  const error = status === 'error' ? text(body?.error, 1000, 'Erro') : '';
  const printers = printerList(body?.printers);
  await env.DB.prepare(
    'UPDATE devices SET status=?, ultima_conexao=?, ultimo_erro=?, versao=COALESCE(?,versao), printers_json=?, atualizado_em=? WHERE id=? AND estabelecimento_id=?'
  ).bind(status, now(), error || null, text(body?.version, 40, 'Versão') || null, JSON.stringify(printers), now(), device.id, device.estabelecimento_id).run();
  return c.json({ ok: true, server_time: now(), token_expires_at: device.token_expira_em });
}

export async function createDeviceTask(env, user, body) {
  const tenantId = estabelecimentoId(env);
  const deviceId = text(body?.device_id, 100, 'deviceId', true);
  const type = text(body?.type || body?.tipo, 40, 'Tipo', true).toUpperCase();
  const payloadJson = validateTaskPayload(type, body?.payload ?? body?.conteudo);
  const idempotencyKey = text(body?.idempotency_key, 160, 'idempotencyKey', true);
  const device = await env.rawDB.prepare(
    'SELECT id FROM devices WHERE id=? AND estabelecimento_id=? AND revogado_em IS NULL'
  ).bind(deviceId, tenantId).first();
  if (!device) throw httpError(404, 'Dispositivo não encontrado');
  const previous = await env.rawDB.prepare(
    'SELECT * FROM device_tasks WHERE estabelecimento_id=? AND idempotency_key=?'
  ).bind(tenantId, idempotencyKey).first();
  if (previous) return { task: previous, created: false };

  const taskId = uuid();
  const createdAt = now();
  try {
    await env.rawDB.prepare(
      `INSERT INTO device_tasks
       (id, estabelecimento_id, device_id, tipo, payload_json, idempotency_key, status, max_tentativas,
        disponivel_em, origem_tipo, origem_id, reimpressao, tarefa_original_id, criado_por, criado_em, atualizado_em)
       VALUES (?,?,?,?,?,?,'pending',?,?,?,?,?,?,?,?,?)`
    ).bind(taskId, tenantId, deviceId, type, payloadJson, idempotencyKey,
      Math.min(10, Math.max(1, num(body?.max_attempts) || 5)), createdAt,
      text(body?.source_type, 40, 'Origem') || null, text(body?.source_id, 100, 'ID da origem') || null,
      body?.is_reprint ? 1 : 0, text(body?.original_task_id, 100, 'Tarefa original') || null,
      user.id, createdAt, createdAt).run();
  } catch (error) {
    // Corrida entre duas requisições com a mesma chave: a restrição UNIQUE é
    // a autoridade final e ambas recebem a mesma tarefa.
    const raced = await env.rawDB.prepare(
      'SELECT * FROM device_tasks WHERE estabelecimento_id=? AND idempotency_key=?'
    ).bind(tenantId, idempotencyKey).first();
    if (raced) return { task: raced, created: false };
    throw error;
  }
  await audit(env.rawDB, tenantId, taskId, deviceId, 'created', null, 'pending', 'user', user.id,
    { type, idempotency_key: idempotencyKey });
  return { task: await env.rawDB.prepare('SELECT * FROM device_tasks WHERE id=?').bind(taskId).first(), created: true };
}

export async function createDeviceTaskHandler(c, env) {
  const body = await c.req.json();
  const type = String(body?.type || body?.tipo || '').toUpperCase();
  const permissions = {
    PRINT_ORDER: ['restaurante'], PRINT_RECEIPT: ['pdv_mercado', 'restaurante'],
    PRINT_LABEL: ['gestor'], OPEN_CASH_DRAWER: ['gestor'], TEST_PRINTER: ['gestor'],
    START_PAYMENT: ['pdv_mercado', 'restaurante'], CANCEL_PAYMENT: ['pdv_mercado', 'restaurante'],
  };
  if (!(permissions[type] || []).some((module) => temModulo(c.user, module))) {
    return c.json({ error: 'Usuário sem permissão para criar esta tarefa' }, 403);
  }
  const result = await createDeviceTask(env, c.user, body);
  return c.json({ task: result.task, idempotent_replay: !result.created }, result.created ? 201 : 200);
}

export async function cancelDeviceTaskHandler(c, env) {
  const tenantId = estabelecimentoId(env);
  const task = await env.rawDB.prepare(
    'SELECT * FROM device_tasks WHERE id=? AND estabelecimento_id=?'
  ).bind(c.params.id, tenantId).first();
  if (!task) return c.json({ error: 'Tarefa não encontrada' }, 404);
  if (['success', 'failed', 'cancelled'].includes(task.status)) {
    return c.json({ ok: true, duplicate: true, status: task.status });
  }
  if (task.status === 'processing') return c.json({ error: 'Tarefa em processamento não pode ser cancelada diretamente' }, 409);
  const current = now();
  const result = await env.rawDB.prepare(
    `UPDATE device_tasks SET status='cancelled', cancelado_em=?, lease_id=NULL, lease_expira_em=NULL, atualizado_em=?
     WHERE id=? AND estabelecimento_id=? AND status IN ('pending','sent')`
  ).bind(current, current, task.id, tenantId).run();
  if (!result.meta.changes) return c.json({ error: 'Tarefa foi atualizada por outra conexão' }, 409);
  await audit(env.rawDB, tenantId, task.id, task.device_id, 'cancelled', task.status, 'cancelled', 'user', c.user.id, null);
  return c.json({ ok: true, duplicate: false, status: 'cancelled' });
}

export async function pullDeviceTasksHandler(c, env) {
  const device = await authenticateDevice(c, env);
  const current = now();
  const expired = await env.DB.prepare(
    `SELECT id FROM device_tasks WHERE device_id=? AND estabelecimento_id=?
     AND status IN ('sent','processing') AND lease_expira_em<? AND tentativas<max_tentativas`
  ).bind(device.id, device.estabelecimento_id, current).all();
  for (const task of expired.results) {
    await env.DB.prepare(
      `UPDATE device_tasks SET status='pending', lease_id=NULL, lease_expira_em=NULL, atualizado_em=?
       WHERE id=? AND device_id=? AND status IN ('sent','processing') AND lease_expira_em<?`
    ).bind(current, task.id, device.id, current).run();
  }
  await env.DB.prepare(
    `UPDATE device_tasks SET status='failed', erro_codigo='MAX_ATTEMPTS',
     erro_mensagem='Limite de tentativas excedido', concluido_em=?, atualizado_em=?
     WHERE device_id=? AND estabelecimento_id=? AND status IN ('pending','sent','processing')
     AND tentativas>=max_tentativas AND (lease_expira_em IS NULL OR lease_expira_em<?)`
  ).bind(current, current, device.id, device.estabelecimento_id, current).run();

  const pending = await env.DB.prepare(
    `SELECT id FROM device_tasks WHERE device_id=? AND estabelecimento_id=? AND status='pending' AND disponivel_em<=?
     ORDER BY criado_em LIMIT ?`
  ).bind(device.id, device.estabelecimento_id, current, CLAIM_LIMIT).all();
  const tasks = [];
  for (const candidate of pending.results) {
    const leaseId = uuid();
    const claimed = await env.DB.prepare(
      `UPDATE device_tasks SET status='sent', tentativas=tentativas+1, lease_id=?, lease_expira_em=?, enviado_em=?, atualizado_em=?
       WHERE id=? AND device_id=? AND estabelecimento_id=? AND status='pending'`
    ).bind(leaseId, isoAfter(LEASE_MS), current, current, candidate.id, device.id, device.estabelecimento_id).run();
    if (!claimed.meta.changes) continue;
    const task = await env.DB.prepare(
      'SELECT id, tipo, payload_json, payload_versao, tentativas, lease_id, lease_expira_em, criado_em FROM device_tasks WHERE id=?'
    ).bind(candidate.id).first();
    tasks.push({ ...task, payload: JSON.parse(task.payload_json), payload_json: undefined });
    await audit(env.DB, device.estabelecimento_id, task.id, device.id, 'claimed', 'pending', 'sent', 'device', device.id,
      { attempt: task.tentativas });
  }
  await env.DB.prepare(
    "UPDATE devices SET status='online', ultima_conexao=?, ultimo_erro=NULL, atualizado_em=? WHERE id=? AND estabelecimento_id=?"
  ).bind(current, current, device.id, device.estabelecimento_id).run();
  return c.json({ tasks, server_time: current });
}

export async function updateDeviceTaskStatusHandler(c, env) {
  const device = await authenticateDevice(c, env);
  const body = await c.req.json();
  const requested = text(body?.status, 20, 'Status', true).toLowerCase();
  if (!TASK_RESULT_STATUSES.has(requested)) return c.json({ error: 'Status de tarefa inválido' }, 400);
  const leaseId = text(body?.lease_id, 100, 'leaseId', true);
  const task = await env.DB.prepare(
    'SELECT * FROM device_tasks WHERE id=? AND device_id=? AND estabelecimento_id=?'
  ).bind(c.params.id, device.id, device.estabelecimento_id).first();
  if (!task) return c.json({ error: 'Tarefa não encontrada' }, 404);
  if (task.status === 'success' || task.status === 'failed' || task.status === 'cancelled') {
    return c.json({ ok: true, duplicate: true, status: task.status });
  }
  if (task.lease_id !== leaseId || task.lease_expira_em < now()) {
    return c.json({ error: 'Lease da tarefa inválido ou expirado' }, 409);
  }
  if (requested === 'processing' && task.status !== 'sent') {
    return c.json({ error: 'Transição de status inválida' }, 409);
  }
  if ((requested === 'success' || requested === 'failed') && !['sent', 'processing'].includes(task.status)) {
    return c.json({ error: 'Transição de status inválida' }, 409);
  }
  const completedAt = requested === 'success' || requested === 'failed' ? now() : null;
  const errorMessage = requested === 'failed' ? text(body?.error_message || body?.error, 2000, 'Erro') : '';
  const errorCode = requested === 'failed' ? text(body?.error_code, 80, 'Código do erro') : '';
  const resultJson = body?.result === undefined ? null : jsonLimit(body.result, 32 * 1024);
  const updated = await env.DB.prepare(
    `UPDATE device_tasks SET status=?, erro_codigo=?, erro_mensagem=?, resultado_json=?,
     processando_em=CASE WHEN ?='processing' THEN ? ELSE processando_em END,
     concluido_em=COALESCE(?,concluido_em), atualizado_em=?
     WHERE id=? AND device_id=? AND estabelecimento_id=? AND lease_id=? AND status=?`
  ).bind(requested, errorCode || null, errorMessage || null, resultJson, requested, now(), completedAt, now(),
    task.id, device.id, device.estabelecimento_id, leaseId, task.status).run();
  if (!updated.meta.changes) return c.json({ error: 'Tarefa foi atualizada por outra conexão' }, 409);
  await audit(env.DB, device.estabelecimento_id, task.id, device.id, 'status_changed', task.status, requested,
    'device', device.id, errorMessage ? { error_code: errorCode, error_message: errorMessage } : null);
  return c.json({ ok: true, duplicate: false, status: requested });
}

export async function listDevicesHandler(c, env) {
  const rows = await env.DB.prepare(
    `SELECT id, nome, plataforma, versao, status, ultima_conexao, ultimo_erro, token_expira_em, printers_json, criado_em
     FROM devices WHERE revogado_em IS NULL ORDER BY nome`
  ).all();
  return c.json(rows.results.map((row) => ({ ...row, printers: JSON.parse(row.printers_json || '[]') })));
}

export async function listDeviceTasksHandler(c, env) {
  const deviceId = text(c.req.query('device_id'), 100, 'deviceId');
  const status = text(c.req.query('status'), 20, 'Status');
  let sql = 'SELECT * FROM device_tasks';
  const where = [];
  const params = [];
  if (deviceId) { where.push('device_id=?'); params.push(deviceId); }
  if (status) { where.push('status=?'); params.push(status); }
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ' ORDER BY criado_em DESC LIMIT 200';
  const rows = await env.DB.prepare(sql).bind(...params).all();
  return c.json(rows.results);
}

export async function revokeDeviceHandler(c, env) {
  const tenantId = estabelecimentoId(env);
  const current = now();
  const result = await env.rawDB.prepare(
    `UPDATE devices SET status='disconnected', revogado_em=?, token_hash=?, atualizado_em=?
     WHERE id=? AND estabelecimento_id=? AND revogado_em IS NULL`
  ).bind(current, await sha256(gerarToken() + gerarToken()), current, c.params.id, tenantId).run();
  if (!result.meta.changes) return c.json({ error: 'Dispositivo não encontrado' }, 404);
  await env.rawDB.prepare(
    `UPDATE device_tasks SET status='cancelled', cancelado_em=?, atualizado_em=?
     WHERE device_id=? AND estabelecimento_id=? AND status IN ('pending','sent')`
  ).bind(current, current, c.params.id, tenantId).run();
  await deviceAudit(env.rawDB, tenantId, c.params.id, 'device_revoked', 'user', c.user.id, null);
  return c.json({ ok: true });
}
