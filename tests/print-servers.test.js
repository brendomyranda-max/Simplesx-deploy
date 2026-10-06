import assert from 'node:assert/strict';
import test from 'node:test';
import SqliteDb from '../server/sqlite-db.js';
import { TenantDb } from '../shared/tenant-db.js';
import { handle } from '../shared/router.js';
import { sha256 } from '../shared/util.js';
import { putConfigHandler } from '../shared/handlers-catalog.js';
import { createAgenteHandler, deleteAgenteHandler } from '../shared/handlers-cadastros.js';
import {
  registerGestorHandler, disconnectGestorHandler, heartbeatGestorHandler, pullGestorJobsHandler,
  deleteGestorHandler, updateGestorHandler, listGestoresHandler,
} from '../shared/handlers-gestor.js';
import {
  createPairingCodeHandler, pairDeviceHandler, heartbeatDeviceHandler, pullDeviceTasksHandler,
  revokeDeviceHandler, updateDeviceHandler, createDeviceTask,
} from '../shared/handlers-devices.js';

function context(body = {}, id, token = '', deviceId = 'android-test') {
  return {
    user: { id: 1 }, params: { id: String(id || '') },
    req: { json: async () => body, header: (name) => ({ authorization: `Bearer ${token}`, 'x-device-id': deviceId })[name] || '', query: () => '' },
    json: (data, status = 200) => ({ data, status }),
  };
}

function fixture(t) {
  const DB = new SqliteDb(':memory:');
  t.after(() => DB.close());
  for (const id of [1, 2]) DB.prepare('INSERT INTO estabelecimentos (id,nome) VALUES (?,?)').bind(id, `Loja ${id}`).run();
  const tenant = (id) => ({ DB: new TenantDb(DB, id), rawDB: DB, estabelecimentoId: id });
  return { DB, pub: { DB }, a: tenant(1), b: tenant(2) };
}

async function desktop(f, session = 'session-a') {
  const body = { token: 'desktop-secret', session_id: session, nome: 'Computador', ip: 'PC' };
  assert.equal((await registerGestorHandler(context(body), f.pub)).status, 200);
  assert.equal((await putConfigHandler(context({ gestor_token: body.token }), f.a)).status, 200);
  const row = f.DB.prepare('SELECT * FROM gestores WHERE token=?').bind(body.token).first();
  return { ...row, body };
}

async function route(f, env, type, id) {
  const result = await createAgenteHandler(context({ nome: 'Cozinha', servidor_tipo: type, servidor_id: String(id), categorias: [], imprime_conta: true }), env);
  assert.equal(result.status, 201);
  f.DB.prepare('INSERT INTO categorias (estabelecimento_id,nome,impressora_agente_id) VALUES (?,?,?)')
    .bind(env.estabelecimentoId, 'Pratos', result.data.id).run();
  return result.data.id;
}

async function pairing(f, env = f.a, deviceId = 'android-test') {
  const code = await createPairingCodeHandler(context(), env);
  return { ...code.data, device_id: deviceId, name: 'Android', platform: 'android' };
}

test('desktop protege a sessão ativa, inclusive contra registro, exclusão e transferência', async (t) => {
  const f = fixture(t);
  const g = await desktop(f);
  const routeId = await route(f, f.a, 'desktop', g.id);
  assert.equal((await registerGestorHandler(context({ ...g.body, session_id: 'intruso' }), f.pub)).status, 409);
  assert.equal((await disconnectGestorHandler(context({ ...g.body, session_id: 'intruso' }), f.pub)).status, 401);
  assert.equal((await pullGestorJobsHandler(context({ ...g.body, session_id: 'intruso' }), f.pub)).status, 401);
  assert.equal((await heartbeatGestorHandler(context({ ...g.body, session_id: 'intruso' }), f.pub)).status, 401);
  assert.equal((await deleteGestorHandler(context({}, g.id), f.a)).status, 409);
  assert.equal((await putConfigHandler(context({ gestor_token: g.token }), f.b)).status, 409);
  assert.equal(f.DB.prepare('SELECT sessao_id FROM gestores WHERE id=?').bind(g.id).first().sessao_id, 'session-a');
  assert.ok(f.DB.prepare('SELECT id FROM impressora_agentes WHERE id=?').bind(routeId).first());
  assert.equal((await pullGestorJobsHandler(context(g.body), f.pub)).status, 200);
});

test('desktop desconectado pode trocar de estabelecimento sem carregar vínculos ou trabalhos antigos', async (t) => {
  const f = fixture(t);
  const g = await desktop(f);
  await route(f, f.a, 'desktop', g.id);
  f.DB.prepare("INSERT INTO gestor_jobs (estabelecimento_id,gestor_token,conteudo,status) VALUES (1,?,'antigo','pendente')").bind(g.token).run();
  assert.equal((await disconnectGestorHandler(context(g.body), f.pub)).status, 200);
  assert.equal((await putConfigHandler(context({ gestor_token: g.token }), f.b)).status, 200);
  assert.equal(f.DB.prepare('SELECT estabelecimento_id FROM gestores WHERE id=?').bind(g.id).first().estabelecimento_id, 2);
  assert.equal(f.DB.prepare('SELECT COUNT(*) AS n FROM impressora_agentes').first().n, 0);
  assert.equal(f.DB.prepare('SELECT impressora_agente_id FROM categorias').first().impressora_agente_id, null);
  assert.equal(f.DB.prepare("SELECT valor FROM empresa_config WHERE estabelecimento_id=1 AND chave='gestor_token'").first(), undefined);
  assert.equal(f.DB.prepare('SELECT status FROM gestor_jobs').first().status, 'erro');
  const next = { ...g.body, session_id: 'session-b' };
  assert.equal((await registerGestorHandler(context(next), f.pub)).status, 200);
  assert.equal((await registerGestorHandler(context(g.body), f.pub)).status, 409);
  assert.equal((await heartbeatGestorHandler(context(g.body), f.pub)).status, 401);
  assert.equal((await heartbeatGestorHandler(context(next), f.pub)).status, 200);
  assert.equal((await pullGestorJobsHandler(context(next), f.pub)).data.jobs.length, 0);
});

test('exclusão desktop limpa o cadastro da conta e permite reutilizar o mesmo token', async (t) => {
  const f = fixture(t);
  const g = await desktop(f);
  await route(f, f.a, 'desktop', g.id);
  await disconnectGestorHandler(context(g.body), f.pub);
  assert.equal((await deleteGestorHandler(context({}, g.id), f.a)).status, 200);
  assert.deepEqual((await listGestoresHandler(context(), f.a)).data, []);
  assert.equal(f.DB.prepare('SELECT COUNT(*) AS n FROM impressora_agentes').first().n, 0);
  assert.equal((await registerGestorHandler(context({ ...g.body, session_id: 'new' }), f.pub)).status, 200);
  assert.equal((await putConfigHandler(context({ gestor_token: g.token }), f.b)).status, 200);
});

test('desktop aceita somente um vencedor em conexões e vínculos simultâneos', async (t) => {
  const f = fixture(t);
  const body = { token: 'race-desktop', nome: 'PC' };
  const connections = await Promise.all(['one', 'two'].map((session_id) => registerGestorHandler(context({ ...body, session_id }), f.pub)));
  assert.deepEqual(connections.map((r) => r.status).sort(), [200, 409]);
  const links = await Promise.all([f.a, f.b].map((env) => putConfigHandler(context({ gestor_token: body.token }), env)));
  assert.deepEqual(links.map((r) => r.status).sort(), [200, 409]);
});

test('nomes editados persistem após sincronizar e outras contas não podem editar/excluir', async (t) => {
  const f = fixture(t);
  const g = await desktop(f);
  assert.equal((await updateGestorHandler(context({ nome: 'Caixa principal' }, g.id), f.a)).status, 200);
  await registerGestorHandler(context(g.body), f.pub);
  const row = (await listGestoresHandler(context(), f.a)).data[0];
  assert.equal(row.nome, 'Caixa principal');
  assert.equal(row.padrao, 1);
  assert.equal((await updateGestorHandler(context({ nome: 'Outro' }, g.id), f.b)).status, 404);
  assert.equal((await deleteGestorHandler(context({}, g.id), f.b)).status, 404);
});

test('Android ativo rejeita novo pareamento sem consumir código nem invalidar credencial', async (t) => {
  const f = fixture(t);
  const first = await pairDeviceHandler(context(await pairing(f)), f.pub);
  assert.equal(first.status, 201);
  const code = await pairing(f, f.b);
  const second = await pairDeviceHandler(context(code), f.pub);
  assert.equal(second.status, 409);
  assert.equal(f.DB.prepare('SELECT usado_em FROM device_pairing_codes WHERE id=?').bind(code.pairing_id).first().usado_em, null);
  assert.equal((await revokeDeviceHandler(context({}, 'android-test'), f.a)).status, 409);
  assert.equal((await heartbeatDeviceHandler(context({ status: 'online' }, null, first.data.device_token), f.pub)).status, 200);
  assert.equal((await updateDeviceHandler(context({ nome: 'Tablet do caixa' }, 'android-test'), f.a)).status, 200);
  assert.equal((await updateDeviceHandler(context({ nome: 'Outro' }, 'android-test'), f.b)).status, 404);
});

test('Android desconectado transfere de conta, limpa destinos e rejeita o token antigo', async (t) => {
  const f = fixture(t);
  const first = await pairDeviceHandler(context(await pairing(f)), f.pub);
  await route(f, f.a, 'android', 'android-test');
  await putConfigHandler(context({ gestor_device_id: 'android-test' }), f.a);
  await createDeviceTask(f.a, { id: 1 }, { device_id: 'android-test', type: 'TEST_PRINTER', payload: {}, idempotency_key: 'old' });
  await heartbeatDeviceHandler(context({ status: 'disconnected' }, null, first.data.device_token), f.pub);
  const next = await pairDeviceHandler(context(await pairing(f, f.b)), f.pub);
  assert.equal(next.status, 201);
  assert.equal(next.data.estabelecimento_id, 2);
  assert.equal(f.DB.prepare('SELECT COUNT(*) AS n FROM impressora_agentes').first().n, 0);
  assert.equal(f.DB.prepare('SELECT impressora_agente_id FROM categorias').first().impressora_agente_id, null);
  assert.equal(f.DB.prepare('SELECT status FROM device_tasks').first().status, 'cancelled');
  assert.equal(f.DB.prepare("SELECT valor FROM empresa_config WHERE estabelecimento_id=1 AND chave='gestor_device_id'").first(), undefined);
  await assert.rejects(heartbeatDeviceHandler(context({}, null, first.data.device_token), f.pub), { status: 401 });
  assert.equal((await pullDeviceTasksHandler(context({}, null, next.data.device_token), f.pub)).data.tasks.length, 0);
});

test('Android excluído pode ser pareado com outro ID de estabelecimento', async (t) => {
  const f = fixture(t);
  const first = await pairDeviceHandler(context(await pairing(f)), f.pub);
  await route(f, f.a, 'android', 'android-test');
  await heartbeatDeviceHandler(context({ status: 'disconnected' }, null, first.data.device_token), f.pub);
  assert.equal((await revokeDeviceHandler(context({}, 'android-test'), f.b)).status, 404);
  assert.equal((await revokeDeviceHandler(context({}, 'android-test'), f.a)).status, 200);
  assert.equal(f.DB.prepare('SELECT COUNT(*) AS n FROM impressora_agentes').first().n, 0);
  const next = await pairDeviceHandler(context(await pairing(f, f.b)), f.pub);
  assert.equal(next.status, 201);
  assert.equal(next.data.estabelecimento_id, 2);
});

test('código de pareamento e dispositivo têm somente um vencedor sob concorrência', async (t) => {
  const f = fixture(t);
  const code = await pairing(f);
  const results = await Promise.all(['android-one', 'android-two'].map((device_id) => pairDeviceHandler(context({ ...code, device_id }), f.pub)));
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal(f.DB.prepare('SELECT COUNT(*) AS n FROM devices').first().n, 1);
  const codes = await Promise.all([pairing(f), pairing(f, f.b)]);
  const pairs = await Promise.all(codes.map((body) => pairDeviceHandler(context(body), f.pub)));
  assert.deepEqual(pairs.map((r) => r.status).sort(), [201, 409]);
});

test('sessões sem contato expiram e podem ser substituídas; erro recente continua protegido', async (t) => {
  const f = fixture(t);
  const g = await desktop(f);
  f.DB.prepare('UPDATE gestores SET ultima_conexao=? WHERE id=?').bind('2000-01-01T00:00:00.000Z', g.id).run();
  assert.equal((await registerGestorHandler(context({ ...g.body, session_id: 'after-timeout' }), f.pub)).status, 200);
  const first = await pairDeviceHandler(context(await pairing(f)), f.pub);
  await heartbeatDeviceHandler(context({ status: 'error', error: 'Sem papel' }, null, first.data.device_token), f.pub);
  assert.equal((await revokeDeviceHandler(context({}, 'android-test'), f.a)).status, 409);
  f.DB.prepare("UPDATE devices SET ultima_conexao='2000-01-01T00:00:00.000Z'").run();
  assert.equal((await pairDeviceHandler(context(await pairing(f, f.b)), f.pub)).status, 201);
});

test('excluir impressora remove vínculos de categorias e respeita o estabelecimento', async (t) => {
  const f = fixture(t);
  const id = await route(f, f.a, 'desktop', 1);
  assert.equal((await deleteAgenteHandler(context({}, id), f.b)).status, 404);
  assert.equal((await deleteAgenteHandler(context({}, id), f.a)).status, 200);
  assert.equal(f.DB.prepare('SELECT impressora_agente_id FROM categorias').first().impressora_agente_id, null);
  assert.equal(f.DB.prepare('SELECT COUNT(*) AS n FROM impressora_agentes').first().n, 0);
});

test('rotas HTTP de edição e exclusão exigem autenticação e isolam contas', async (t) => {
  const f = fixture(t);
  f.DB.prepare("INSERT INTO funcionarios (id,estabelecimento_id,nome,usuario,senha_hash,modulos) VALUES (1,1,'Admin','admin','hash','gestor')").run();
  f.DB.prepare('INSERT INTO sessoes (estabelecimento_id,funcionario_id,token_hash,expira_em) VALUES (1,1,?,?)').bind(await sha256('admin-token'), '2099-01-01').run();
  const request = (path, method, body = {}, token = 'admin-token') => {
    const c = context(body, null, token);
    c.req.path = path; c.req.method = method;
    return handle(c, f.pub);
  };
  const label = await request('/api/impressora-etiquetas', 'POST', { nome: 'Etiqueta', largura_mm: 58, altura_mm: 40 });
  assert.equal(label.status, 201);
  assert.equal((await request(`/api/impressora-etiquetas/${label.data.id}`, 'PUT', { nome: 'Validade', largura_mm: 80, altura_mm: 50 })).status, 200);
  assert.equal(f.DB.prepare('SELECT nome FROM impressora_etiquetas').first().nome, 'Validade');
  assert.equal((await request(`/api/impressora-etiquetas/${label.data.id}`, 'DELETE')).status, 200);
  for (const path of ['/api/gestores/1', '/api/devices/android-test', '/api/impressora-agentes/1', '/api/impressora-etiquetas/1']) {
    for (const method of ['PUT', 'DELETE']) assert.equal((await request(path, method, {}, '')).status, 401);
  }
});
