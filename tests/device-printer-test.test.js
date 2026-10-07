import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import SqliteDb from '../server/sqlite-db.js';
import { handle } from '../shared/router.js';
import { sha256 } from '../shared/util.js';

const apiSource = ts.transpileModule(readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const { deviceApi } = await import(`data:text/javascript;base64,${Buffer.from(apiSource).toString('base64')}`);

async function fixture(t) {
  const DB = new SqliteDb(':memory:');
  t.after(() => DB.close());
  DB.prepare("INSERT INTO estabelecimentos (id,nome) VALUES (1,'Loja A'),(2,'Loja B')").run();
  DB.prepare(`INSERT INTO funcionarios (id,estabelecimento_id,nome,usuario,senha_hash,modulos) VALUES
    (1,1,'Admin A','admin-a','hash','gestor'),(2,2,'Admin B','admin-b','hash','gestor'),
    (3,1,'Garçom','garcom','hash','restaurante')`).run();
  for (const [id, tenant] of [[1, 1], [2, 2], [3, 1]]) {
    DB.prepare('INSERT INTO sessoes (estabelecimento_id,funcionario_id,token_hash,expira_em) VALUES (?,?,?,?)')
      .bind(tenant, id, await sha256(`user-${id}`), '2099-01-01').run();
  }
  DB.prepare(`INSERT INTO devices (id,estabelecimento_id,nome,plataforma,token_hash,token_expira_em,criado_em,atualizado_em)
    VALUES ('android',1,'Celular','android',?,'2099-01-01','','')`).bind(await sha256('device-token')).run();
  const request = (path, method = 'GET', body = {}, token = 'user-1', device = false) => handle({
    req: { path, method, query: () => '', json: async () => body,
      header: (name) => name === 'authorization' ? (token ? `Bearer ${token}` : '') : name === 'x-device-id' && device ? 'android' : '' },
    json: (data, status = 200) => ({ data, status }),
  }, { DB });
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    const result = await request(url, options.method, options.body ? JSON.parse(options.body) : {});
    return new Response(JSON.stringify(result.data), { status: result.status, headers: { 'Content-Type': 'application/json' } });
  });
  return { DB, request, printer: { name: 'Printer haoo', connection: 'bluetooth', width_mm: 58 } };
}

test('teste web envia a impressora Bluetooth escolhida e acompanha confirmação do Android', async (t) => {
  const f = await fixture(t);
  const created = await deviceApi.test('android', f.printer, 'teste-especifico');
  const initial = await deviceApi.task(created.task.id);
  assert.equal(initial.status, 'pending');
  assert.equal(initial.device_id, 'android');
  assert.equal(initial.payload_json, undefined);
  const pull = await f.request('/api/device/tasks/pull', 'POST', {}, 'device-token', true);
  assert.equal(pull.status, 200);
  const job = pull.data.tasks[0];
  assert.equal(job.payload.printer, 'Printer haoo');
  assert.equal(job.payload.width_mm, 58);
  assert.match(job.payload.content, /Printer haoo/);
  assert.equal((await deviceApi.task(job.id)).status, 'sent');
  for (const status of ['processing', 'success']) {
    const ack = await f.request(`/api/device/tasks/${job.id}/status`, 'POST', { status, lease_id: job.lease_id }, 'device-token', true);
    assert.equal(ack.status, 200);
    assert.equal((await deviceApi.task(job.id)).status, status);
  }
});

test('erro da impressora é devolvido à tela mesmo quando o Android continua online', async (t) => {
  const f = await fixture(t);
  const { task } = await deviceApi.test('android', f.printer, 'teste-falha');
  const pull = await f.request('/api/device/tasks/pull', 'POST', {}, 'device-token', true);
  const ack = await f.request(`/api/device/tasks/${task.id}/status`, 'POST', {
    status: 'failed', lease_id: pull.data.tasks[0].lease_id,
    error_code: 'PRINT_CHECK_REQUIRED', error_message: 'Informe o IP da impressora',
  }, 'device-token', true);
  assert.equal(ack.status, 200);
  const result = await deviceApi.task(task.id);
  assert.equal(result.status, 'failed');
  assert.equal(result.erro_mensagem, 'Informe o IP da impressora');
});

test('consultar de novo um envio sem resposta não cria dois testes', async (t) => {
  const f = await fixture(t);
  const first = await deviceApi.test('android', f.printer, 'mesma-tentativa');
  const second = await deviceApi.test('android', f.printer, 'mesma-tentativa');
  assert.equal(first.task.id, second.task.id);
  assert.equal(f.DB.prepare('SELECT COUNT(*) n FROM device_tasks').first().n, 1);
});

test('resultado do teste exige login, módulo Gestor e o mesmo estabelecimento', async (t) => {
  const f = await fixture(t);
  const { task } = await deviceApi.test('android', f.printer, 'teste-isolamento');
  const path = `/api/device-tasks/${task.id}`;
  assert.equal((await f.request(path, 'GET', {}, '')).status, 401);
  assert.equal((await f.request(path, 'GET', {}, 'user-3')).status, 403);
  assert.equal((await f.request(path, 'GET', {}, 'user-2')).status, 404);
  assert.equal((await f.request('/api/device-tasks/inexistente')).status, 404);
});
