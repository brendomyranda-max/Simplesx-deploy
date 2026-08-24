import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import SqliteDb from '../server/sqlite-db.js';
import {
  createDeviceTask,
  pullDeviceTasksHandler,
  updateDeviceTaskStatusHandler,
  validateTaskPayload,
} from '../shared/handlers-devices.js';
import { TenantDb } from '../shared/tenant-db.js';
import { sha256 } from '../shared/util.js';

function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'simplesx-device-test-'));
  const rawDB = new SqliteDb(path.join(dir, 'test.db'));
  const createdAt = new Date().toISOString();
  rawDB.prepare("INSERT INTO estabelecimentos (nome, ativo, criado_em, cnpj) VALUES ('Loja A',1,?,'11111111111111')")
    .bind(createdAt).run();
  const tenantId = rawDB.prepare("SELECT id FROM estabelecimentos WHERE nome='Loja A'").first().id;
  rawDB.prepare(
    `INSERT INTO devices
      (id, estabelecimento_id, nome, plataforma, token_hash, token_expira_em, status, criado_em, atualizado_em)
     VALUES ('device-a',?,'Caixa','windows',?,?,'offline',?,?)`
  ).bind(tenantId, 'hash', '2099-01-01T00:00:00.000Z', createdAt, createdAt).run();
  return {
    rawDB,
    tenantId,
    env: { rawDB, DB: new TenantDb(rawDB, tenantId), estabelecimentoId: tenantId },
    close() { rawDB.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}

test('a mesma chave idempotente retorna a mesma tarefa', async () => {
  const f = fixture();
  try {
    const body = {
      device_id: 'device-a',
      type: 'TEST_PRINTER',
      payload: { content: 'teste' },
      idempotency_key: 'test-printer:request-1',
    };
    const first = await createDeviceTask(f.env, { id: 10 }, body);
    const second = await createDeviceTask(f.env, { id: 10 }, body);
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.task.id, first.task.id);
    assert.equal(f.rawDB.prepare('SELECT COUNT(*) AS total FROM device_tasks').first().total, 1);
  } finally {
    f.close();
  }
});

test('não permite criar tarefa para dispositivo de outro estabelecimento', async () => {
  const f = fixture();
  try {
    f.rawDB.prepare("INSERT INTO estabelecimentos (nome, ativo, criado_em, cnpj) VALUES ('Loja B',1,?,'22222222222222')")
      .bind(new Date().toISOString()).run();
    const otherTenant = f.rawDB.prepare("SELECT id FROM estabelecimentos WHERE nome='Loja B'").first().id;
    const otherEnv = { rawDB: f.rawDB, DB: new TenantDb(f.rawDB, otherTenant), estabelecimentoId: otherTenant };
    await assert.rejects(
      createDeviceTask(otherEnv, { id: 20 }, {
        device_id: 'device-a', type: 'TEST_PRINTER', payload: {}, idempotency_key: 'cross-tenant',
      }),
      (error) => error.status === 404
    );
  } finally {
    f.close();
  }
});

test('valida payload de pagamento sem aceitar dados sensíveis como requisito', () => {
  assert.throws(() => validateTaskPayload('START_PAYMENT', { amount: 0, saleId: '1', method: 'credit' }));
  const value = validateTaskPayload('START_PAYMENT', { amount: 10.5, saleId: 'sale-1', method: 'credit', installments: 1 });
  assert.equal(JSON.parse(value).saleId, 'sale-1');
  assert.throws(() => validateTaskPayload('START_PAYMENT', {
    amount: 10, saleId: 'sale-1', method: 'credit', cardNumber: '4111111111111111', cvv: '123',
  }));
});

test('hash de token não preserva a credencial original', async () => {
  const token = 'device-secret-value';
  const hash = await sha256(token);
  assert.notEqual(hash, token);
  assert.equal(hash.length, 64);
});

function context({ token, deviceId, body = {}, params = {} }) {
  return {
    params,
    req: {
      header(name) {
        if (name === 'authorization') return `Bearer ${token}`;
        if (name === 'x-device-id') return deviceId;
        return '';
      },
      json: async () => body,
    },
    json(data, status = 200) { return { data, status }; },
  };
}

test('claim e confirmação terminal não reexecutam a tarefa', async () => {
  const f = fixture();
  try {
    const token = 'device-secret-for-test';
    f.rawDB.prepare('UPDATE devices SET token_hash=? WHERE id=?').bind(await sha256(token), 'device-a').run();
    const created = await createDeviceTask(f.env, { id: 10 }, {
      device_id: 'device-a', type: 'TEST_PRINTER', payload: { content: 'teste' }, idempotency_key: 'claim-once',
    });

    const firstPull = await pullDeviceTasksHandler(context({ token, deviceId: 'device-a' }), { DB: f.rawDB });
    assert.equal(firstPull.status, 200);
    assert.equal(firstPull.data.tasks.length, 1);
    assert.equal(firstPull.data.tasks[0].id, created.task.id);

    const emptyPull = await pullDeviceTasksHandler(context({ token, deviceId: 'device-a' }), { DB: f.rawDB });
    assert.equal(emptyPull.data.tasks.length, 0);

    const leaseId = firstPull.data.tasks[0].lease_id;
    const processing = await updateDeviceTaskStatusHandler(
      context({ token, deviceId: 'device-a', params: { id: created.task.id }, body: { status: 'processing', lease_id: leaseId } }),
      { DB: f.rawDB }
    );
    assert.equal(processing.data.status, 'processing');
    const success = await updateDeviceTaskStatusHandler(
      context({ token, deviceId: 'device-a', params: { id: created.task.id }, body: { status: 'success', lease_id: leaseId, result: { spooler: 'accepted' } } }),
      { DB: f.rawDB }
    );
    assert.equal(success.data.status, 'success');

    const duplicate = await updateDeviceTaskStatusHandler(
      context({ token, deviceId: 'device-a', params: { id: created.task.id }, body: { status: 'success', lease_id: leaseId } }),
      { DB: f.rawDB }
    );
    assert.equal(duplicate.data.duplicate, true);
    assert.equal(f.rawDB.prepare("SELECT COUNT(*) AS total FROM device_task_events WHERE evento='claimed'").first().total, 1);
  } finally {
    f.close();
  }
});
