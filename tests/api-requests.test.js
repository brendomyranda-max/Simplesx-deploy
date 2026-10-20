import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = ts.transpileModule(readFileSync('src/lib/api.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { api } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

test('leituras simultâneas da mesma URL compartilham uma requisição sem guardar o resultado', async t => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', (url, options) => new Promise(resolve => requests.push({ url, options, resolve })));
  const first = api.get('/config'), second = api.get('/config');
  const other = api.get('/produtos');
  assert.equal(requests.length, 2);
  requests[0].resolve(new Response(JSON.stringify({ taxa: 10 })));
  requests[1].resolve(new Response('[]'));
  assert.deepEqual(await first, { taxa: 10 }); assert.deepEqual(await second, { taxa: 10 }); await other;
  const fresh = api.get('/config');
  assert.equal(requests.length, 3);
  requests[2].resolve(new Response(JSON.stringify({ taxa: 0 })));
  assert.deepEqual(await fresh, { taxa: 0 });
});

test('gravação impede reutilizar leituras iniciadas antes ou durante a alteração', async t => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', (url, options) => new Promise(resolve => requests.push({ url, options, resolve })));
  const before = api.get('/produtos'), write = api.put('/produtos/1', { preco: 20 });
  const during = api.get('/produtos');
  assert.equal(requests.length, 3);
  requests[1].resolve(new Response('{}')); await write;
  const after = api.get('/produtos');
  assert.equal(requests.length, 4);
  requests[0].resolve(new Response('[{"preco":10}]'));
  requests[2].resolve(new Response('[{"preco":15}]'));
  const shared = api.get('/produtos');
  requests[3].resolve(new Response('[{"preco":20}]'));
  await Promise.all([before, during]);
  assert.deepEqual(await after, [{ preco: 20 }]); assert.deepEqual(await shared, [{ preco: 20 }]);
});

test('falha compartilhada é liberada para nova tentativa e operações de gravação continuam independentes', async t => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', (url, options) => new Promise(resolve => requests.push({ url, options, resolve })));
  const reads = [api.get('/mesas'), api.get('/mesas')];
  requests[0].resolve(new Response('{"error":"Tente novamente"}', { status: 503 }));
  const failed = await Promise.allSettled(reads);
  assert.ok(failed.every(result => result.status === 'rejected' && result.reason.status === 503));
  const fresh = api.get('/mesas');
  assert.equal(requests.length, 2); requests[1].resolve(new Response('[]')); await fresh;
  const writes = [api.post('/comandas/1/itens', { produto_id: 1 }), api.post('/comandas/1/itens', { produto_id: 1 })];
  assert.equal(requests.length, 4);
  requests[2].resolve(new Response('{}')); requests[3].resolve(new Response('{}'));
  await Promise.all(writes);
});
