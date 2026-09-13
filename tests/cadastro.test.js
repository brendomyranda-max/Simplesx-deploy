import test from 'node:test';
import assert from 'node:assert/strict';
import SqliteDb from '../server/sqlite-db.js';
import { cadastroHandler, loginFuncionarioHandler } from '../shared/handlers-cadastros.js';
import { verificarSenha } from '../shared/util.js';

function context(body) {
  return { req: { json: async () => body, header: () => undefined }, json: (data, status = 200, headers = {}) => ({ data, status, headers }) };
}
const body = { cnpj: '11.222.333/0001-81', telefone: '(11) 99999-8888', nome: 'Restaurante Teste', senha: 'senha-teste-123', turnstile_token: 'teste' };

test('cadastro cria restaurante isolado, senha protegida e permite login; rejeita duplicata', async (t) => {
  const DB = new SqliteDb(':memory:');
  t.after(() => DB.close());
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ success: true }) }));
  const env = { DB, TURNSTILE_SECRET_KEY: 'teste' };
  const result = await cadastroHandler(context(body), env);
  assert.equal(result.status, 201);
  const user = DB.prepare('SELECT * FROM funcionarios').first();
  assert.equal(user.usuario, 'admin');
  assert.notEqual(user.senha_hash, body.senha);
  assert.equal(await verificarSenha(body.senha, user.senha_hash), true);
  assert.equal(DB.prepare("SELECT valor FROM empresa_config WHERE chave='empresa_telefone'").first().valor, '11999998888');
  assert.equal(DB.prepare('SELECT estabelecimento_id FROM mesas').first().estabelecimento_id, user.estabelecimento_id);
  const login = await loginFuncionarioHandler(context({ ...body, usuario: 'admin' }), env);
  assert.equal(login.status, 200);
  assert.match(login.headers['set-cookie'], /HttpOnly/);
  assert.equal((await cadastroHandler(context(body), env)).status, 409);
  assert.equal(DB.prepare('SELECT COUNT(*) n FROM estabelecimentos').first().n, 1);
});

test('cadastro rejeita dados inválidos e verificação humana recusada sem gravar', async (t) => {
  const DB = new SqliteDb(':memory:');
  t.after(() => DB.close());
  const env = { DB, TURNSTILE_SECRET_KEY: 'teste' };
  for (const change of [{ cnpj: '11111111111111' }, { telefone: '123' }, { senha: 'curta' }, { nome: '' }]) {
    assert.equal((await cadastroHandler(context({ ...body, ...change }), env)).status, 400);
  }
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ success: false }) }));
  assert.equal((await cadastroHandler(context(body), env)).status, 400);
  assert.equal(DB.prepare('SELECT COUNT(*) n FROM estabelecimentos').first().n, 0);
});

test('falha durante criação reverte todo o cadastro', async (t) => {
  const DB = new SqliteDb(':memory:');
  t.after(() => DB.close());
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ success: true }) }));
  DB.db.exec("CREATE TRIGGER falha_config BEFORE INSERT ON empresa_config BEGIN SELECT RAISE(ABORT, 'falha simulada'); END");
  await assert.rejects(cadastroHandler(context(body), { DB, TURNSTILE_SECRET_KEY: 'teste' }), /falha simulada/);
  assert.equal(DB.prepare('SELECT COUNT(*) n FROM estabelecimentos').first().n, 0);
  assert.equal(DB.prepare('SELECT COUNT(*) n FROM funcionarios').first().n, 0);
});
