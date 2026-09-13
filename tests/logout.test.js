import test from 'node:test';
import assert from 'node:assert/strict';
import SqliteDb from '../server/sqlite-db.js';
import { handle } from '../shared/router.js';
import { sha256 } from '../shared/util.js';
import ts from 'typescript';
import { readFileSync } from 'node:fs';

function context(path, method, token) {
  return { req: { path, method, header: (name) => name === 'cookie' ? `simplesx_session=${token}` : undefined, query: () => undefined }, json: (data, status = 200, headers = {}) => ({ data, status, headers }) };
}

test('sair revoga apenas a sessão atual e limpa cookie mesmo repetido ou expirado', async (t) => {
  const DB = new SqliteDb(':memory:');
  t.after(() => DB.close());
  DB.prepare("INSERT INTO estabelecimentos (id,nome) VALUES (1,'Teste')").run();
  DB.prepare("INSERT INTO funcionarios (id,estabelecimento_id,nome,usuario,senha_hash,modulos) VALUES (1,1,'Estoquista','estoque','hash','gestor,area:estoque')").run();
  for (const token of ['atual', 'outro']) {
    DB.prepare('INSERT INTO sessoes (estabelecimento_id,funcionario_id,token_hash,expira_em) VALUES (1,1,?,?)').bind(await sha256(token), '2099-01-01').run();
  }
  assert.equal((await handle(context('/api/auth/me', 'GET', 'atual'), { DB })).status, 200);
  for (const token of ['atual', 'atual', 'expirado', '']) {
    const result = await handle(context('/api/auth/logout', 'POST', token), { DB });
    assert.equal(result.status, 200);
    assert.match(result.headers['set-cookie'], /simplesx_session=;.*Max-Age=0/);
  }
  assert.equal((await handle(context('/api/auth/me', 'GET', 'atual'), { DB })).status, 401);
  assert.equal((await handle(context('/api/auth/me', 'GET', 'outro'), { DB })).status, 200);
});

test('frontend aguarda confirmação, limpa dados e permite tentar novamente após falha', async (t) => {
  const storage = new Map();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) } });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else delete globalThis.localStorage; });
  const asModule = (source) => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString('base64');
  const apiModule = asModule(readFileSync('src/lib/api.ts', 'utf8'));
  const authSource = readFileSync('src/store/auth.ts', 'utf8').replace("'@/lib/api'", JSON.stringify(apiModule)).replace("'zustand'", JSON.stringify(import.meta.resolve('zustand')));
  const { useAuth } = await import(asModule(authSource));
  useAuth.getState().setAuth('Estoquista', 'caixa', ['gestor', 'area:estoque']);
  assert.equal(useAuth.getState().canArea('estoque'), true);
  assert.equal(useAuth.getState().canArea('configuracoes'), false);
  storage.set('simplesx_empresa', 'Restaurante');
  storage.set('simplesx_area', 'gestao');
  let finish;
  const fetchMock = t.mock.method(globalThis, 'fetch', () => new Promise((resolve) => { finish = resolve; }));
  const pending = useAuth.getState().logout();
  assert.equal(useAuth.getState().saindo, true);
  assert.equal(useAuth.getState().token, 'cookie');
  finish({ ok: true, status: 200, json: async () => ({ ok: true }) });
  await pending;
  assert.equal(useAuth.getState().token, null);
  assert.equal(storage.size, 0);
  useAuth.getState().setAuth('Estoquista', 'caixa', ['gestor', 'area:estoque']);
  fetchMock.mock.mockImplementation(async () => { throw new Error('offline'); });
  await assert.rejects(useAuth.getState().logout());
  assert.equal(useAuth.getState().token, 'cookie');
  assert.equal(useAuth.getState().saindo, false);
  useAuth.getState().clearSession();
  assert.equal(useAuth.getState().token, null);
});
