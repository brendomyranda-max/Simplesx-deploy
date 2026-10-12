import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = ts.transpileModule(readFileSync('src/lib/nfcDelivery.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { createNfcDelivery } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const reading = { uid: '00A224B1C2D380', lidoEm: 100_000 };
const event = { id: 1, uid: reading.uid, payload: '', origem: 'android-local' };

function fixture(overrides = {}) {
  const f = { ready: false, visible: true, request: 1, time: reading.lidoEm, identified: [], consumed: [], delivered: [], errors: [], pending: 0 };
  f.bridge = createNfcDelivery({
    ready: () => f.ready, visible: () => f.visible, request: () => f.request, now: () => f.time,
    identify: async (uid) => { f.identified.push(uid); return event; },
    consume: async (id) => { f.consumed.push(id); return { ...event, id, origem: 'android' }; },
    deliver: (e) => { f.delivered.push(e); f.ready = false; },
    error: (e) => f.errors.push(e), pending: () => { f.pending++; },
    ...overrides,
  });
  return f;
}

test('dashboard não consome cartão; ação aguardando recebe apenas uma leitura da fila', async () => {
  const f = fixture();
  const events = [{ ...event, origem: 'android' }, { ...event, id: 2, origem: 'android' }];
  await f.bridge.receiveCloud(events);
  assert.deepEqual(f.consumed, []);
  f.ready = true;
  await f.bridge.receiveCloud(events);
  assert.deepEqual(f.consumed, [1]);
  await f.bridge.receiveCloud(events);
  assert.equal(f.delivered.length, 1);
});

test('UID nativo aguarda uma ação e chega diretamente sem consumir a fila nem depender de foco DOM', async () => {
  const f = fixture();
  await f.bridge.receiveNative(reading);
  assert.equal(f.pending, 1);
  assert.deepEqual(f.identified, []);
  f.ready = true;
  await f.bridge.flushNative();
  assert.deepEqual(f.identified, [reading.uid]);
  assert.deepEqual(f.delivered, [event]);
  assert.deepEqual(f.consumed, []);
  f.ready = true;
  await f.bridge.receiveNative(reading); // onPageFinished repete o mesmo evento
  assert.equal(f.delivered.length, 1);
});

test('leitura nativa escondida aguarda visibilidade e expira antes de outro atendimento', async () => {
  const f = fixture();
  f.ready = true;
  f.visible = false;
  await f.bridge.receiveNative(reading);
  assert.deepEqual(f.delivered, []);
  f.visible = true;
  f.time += 15_001;
  await f.bridge.flushNative();
  assert.deepEqual(f.identified, []);
  for (const invalid of [{ ...reading, uid: '<script>' }, { ...reading, lidoEm: f.time + 2000 }]) {
    await f.bridge.receiveNative(invalid);
  }
  assert.deepEqual(f.identified, []);
});

test('requisição em andamento bloqueia leituras simultâneas e cancelamento não entrega a uma nova ação', async () => {
  let finish;
  const f = fixture({ identify: () => new Promise((resolve) => { finish = resolve; }) });
  f.ready = true;
  const pending = f.bridge.receiveNative(reading);
  await f.bridge.receiveNative({ ...reading, lidoEm: reading.lidoEm + 1 });
  await f.bridge.receiveCloud([{ ...event, origem: 'android' }]);
  assert.deepEqual(f.consumed, []);
  f.request++; // o usuário cancelou e abriu outra ação
  finish(event);
  await pending;
  assert.deepEqual(f.delivered, []);
});

test('falha do envio avisa a tela e uma nova aproximação pode tentar novamente', async () => {
  let attempts = 0;
  const f = fixture({ identify: async () => { if (++attempts === 1) throw { status: 503, error: 'Sem conexão' }; return event; } });
  f.ready = true;
  await f.bridge.receiveNative(reading);
  assert.deepEqual(f.errors, ['Sem conexão']);
  assert.deepEqual(f.delivered, []);
  await f.bridge.receiveNative({ ...reading, lidoEm: reading.lidoEm + 1 });
  assert.deepEqual(f.delivered, [event]);
});

test('diagnóstico chega sem espera e conflito com outro terminal não bloqueia próxima leitura', async () => {
  const f = fixture({ consume: async (id) => {
    f.consumed.push(id);
    if (id === 2) throw { status: 409 };
    return { ...event, id, origem: id === 1 ? 'android-teste' : 'android' };
  } });
  await f.bridge.receiveCloud([{ ...event, origem: 'android-teste' }]);
  f.ready = true;
  await f.bridge.receiveCloud([{ ...event, id: 2 }, { ...event, id: 3 }]);
  assert.deepEqual(f.consumed, [1, 2, 3]);
  assert.deepEqual(f.delivered.map((e) => e.id), [1, 3]);
});

test('backend duplicado e tela desmontada não repetem pedido', async () => {
  const f = fixture({ identify: async () => ({ ...event, duplicate: true }) });
  f.ready = true;
  await f.bridge.receiveNative(reading);
  assert.deepEqual(f.delivered, []);
  let finish;
  const disposed = fixture({ identify: () => new Promise((resolve) => { finish = resolve; }) });
  disposed.ready = true;
  const pending = disposed.bridge.receiveNative(reading);
  disposed.bridge.dispose();
  finish(event);
  await pending;
  assert.deepEqual(disposed.delivered, []);
});
