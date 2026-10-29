import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import SqliteDb from '../server/sqlite-db.js';
import { handle } from '../shared/router.js';
import { TenantDb } from '../shared/tenant-db.js';
import { updateOnlineStoreHandler, upsertOnlineCatalogProductHandler } from '../shared/handlers-online.js';

const perfil = { nome: 'Ana Souza', endereco: 'Rua das Flores', numero: '123', complemento: 'Casa 2', latitude: -23.55, longitude: -46.64 };
const conta = { ...perfil, telefone: '(11) 99999-0000', senha: 'cliente-teste-123' };

function context(method, route, body = {}, session = '', headers = {}) {
  return {
    params: {},
    req: { method, path: route, query: () => '', json: async () => body,
      header: (name) => ({ cookie: session, host: 'doixp.test', origin: 'https://doixp.test', 'content-type': 'application/json',
        'x-forwarded-proto': 'https', 'cf-connecting-ip': '192.0.2.1', ...headers })[name] || '' },
    json: (data, status = 200, headers = {}) => ({ data, status, headers }),
  };
}
const call = (db, method, route, body, session, headers) => handle(context(method, `/api/public/clientes${route}`, body, session, headers), { DB: db });
const cookie = (result) => result.headers['set-cookie'].split(';')[0];

test('cadastro e sessão persistem no banco e restauram perfil em outro login', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'doixp-clientes-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'test.db');
  let db = new SqliteDb(file);
  const created = await call(db, 'POST', '/cadastro', conta);
  assert.equal(created.status, 201);
  assert.equal(created.headers['cache-control'], 'no-store');
  assert.match(created.headers['set-cookie'], /HttpOnly; SameSite=Lax; Max-Age=2592000; Secure/);
  assert.match(created.headers['set-cookie'], /Path=\/api\/public/);
  assert.equal(created.data.telefone, '11999990000');
  assert.equal(created.data.senha_hash, undefined);
  const row = db.prepare('SELECT * FROM clientes_marketplace').first();
  assert.match(row.senha_hash, /^pbkdf2:/);
  assert.ok(!row.senha_hash.includes(conta.senha));
  assert.notEqual(db.prepare('SELECT token_hash FROM clientes_sessoes').first().token_hash, cookie(created).split('=')[1]);
  const altered = await call(db, 'PUT', '/me', { ...perfil, nome: 'Ana Silva', numero: '25', id: 999, telefone: '21988887777' }, cookie(created));
  assert.equal(altered.status, 200);
  assert.equal(altered.data.telefone, '11999990000');
  db.close();
  db = new SqliteDb(file);
  t.after(() => db.close());
  const restored = await call(db, 'GET', '/me', {}, `${cookie(created)}; simplesx_session=sessao-do-lojista`);
  assert.equal(restored.data.nome, 'Ana Silva');
  assert.equal(restored.data.numero, '25');
  assert.equal(restored.data.complemento, 'Casa 2');
  const login = await call(db, 'POST', '/login', { telefone: '+55 (11) 99999-0000', senha: conta.senha });
  assert.equal(login.status, 200);
  assert.equal(login.data.nome, 'Ana Silva');
  assert.equal(login.data.latitude, -23.55);
  assert.notEqual(cookie(login), cookie(created));
});

test('senha, expiração, logout e sessão administrativa não concedem acesso a clientes', async (t) => {
  const db = new SqliteDb(':memory:'); t.after(() => db.close());
  const created = await call(db, 'POST', '/cadastro', conta);
  const duplicate = await call(db, 'POST', '/cadastro', { ...conta, telefone: '+55 11 99999-0000' });
  assert.equal(duplicate.status, 409);
  for (const telefone of ['11999990000', '21999991111']) {
    const wrong = await call(db, 'POST', '/login', { telefone, senha: 'senha-incorreta' });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.data.error, 'Telefone ou senha inválidos.');
  }
  for (const session of ['', 'simplesx_session=qualquer-sessao', 'doixp_cliente=%INVALIDO']) {
    assert.equal((await call(db, 'GET', '/me', {}, session)).status, 401);
    assert.equal((await call(db, 'PUT', '/me', perfil, session)).status, 401);
  }
  const login = await call(db, 'POST', '/login', conta, cookie(created));
  assert.equal((await call(db, 'GET', '/me', {}, cookie(created))).status, 401);
  assert.equal((await call(db, 'GET', '/me', {}, cookie(login))).status, 200);
  const logout = await call(db, 'POST', '/logout', {}, cookie(login));
  assert.match(logout.headers['set-cookie'], /Max-Age=0/);
  assert.equal((await call(db, 'GET', '/me', {}, cookie(login))).status, 401);
  const expired = await call(db, 'POST', '/login', conta);
  db.prepare("UPDATE clientes_sessoes SET expira_em='2000-01-01'").run();
  assert.equal((await call(db, 'GET', '/me', {}, cookie(expired))).status, 401);
  assert.equal((await handle(context('GET', '/api/config', {}, cookie(expired)), { DB: db })).status, 401);
});

test('tentativas são limitadas no banco e origem externa não altera contas', async (t) => {
  const db = new SqliteDb(':memory:'); t.after(() => db.close());
  const created = await call(db, 'POST', '/cadastro', conta);
  for (let index = 0; index < 8; index++) {
    assert.equal((await call(db, 'POST', '/login', { ...conta, senha: 'senha-incorreta' })).status, 401);
  }
  assert.equal((await call(db, 'POST', '/login', conta)).status, 429);
  db.prepare('UPDATE clientes_login_tentativas SET expira_em=0').run();
  assert.equal((await call(db, 'POST', '/login', conta)).status, 200);
  for (const headers of [{ origin: 'https://outro.test' }, { 'sec-fetch-site': 'cross-site' }]) {
    assert.equal((await call(db, 'PUT', '/me', { ...perfil, nome: 'Invasor' }, cookie(created), headers)).status, 403);
    assert.equal((await call(db, 'POST', '/logout', {}, cookie(created), headers)).status, 403);
  }
  assert.equal((await call(db, 'GET', '/me', {}, cookie(created))).data.nome, perfil.nome);
  assert.equal((await call(db, 'PUT', '/me', { ...perfil, latitude: 'abc' }, cookie(created))).status, 400);
});

test('pedidos usam a conta da sessão, isolam o histórico e preservam compras sem conta', async (t) => {
  const db = new SqliteDb(':memory:'); t.after(() => db.close());
  db.prepare("INSERT INTO estabelecimentos(id,nome,ativo) VALUES(1,'Lanchonete',1)").run();
  db.prepare(`INSERT INTO produtos(id,estabelecimento_id,nome,codigo_interno,preco,ativo,exibir_restaurante,tipo,sem_vencimento,criado_em)
    VALUES(10,1,'Lanche','LAN-01',30,1,1,'produto',1,'2026-10-01')`).run();
  const admin = { DB: new TenantDb(db, 1), rawDB: db, estabelecimentoId: 1 };
  await updateOnlineStoreHandler({ ...context('PUT', ''), req: { ...context('PUT', '').req, json: async () => ({ slug: 'lanchonete', nome: 'Lanchonete', ativo: true }) } }, admin);
  const product = await upsertOnlineCatalogProductHandler(context('POST', '', { produto_id: 10 }), admin);
  const ana = await call(db, 'POST', '/cadastro', conta);
  const bia = await call(db, 'POST', '/cadastro', { ...conta, nome: 'Bia', telefone: '21999991111' });
  for (const [chave, session, fakeId] of [['pedido-cliente-0001', cookie(ana), bia.data.id], ['pedido-cliente-0002', cookie(bia), ana.data.id], ['pedido-visitante-0001', '', ana.data.id]]) {
    const body = { chave, cliente_id: fakeId, cliente_nome: 'Cliente', telefone: '11999990000', tipo_entrega: 'retirada', forma_pagamento: 'maquininha', itens: [{ cardapio_produto_id: product.data.id, quantidade: 1 }] };
    const order = await handle(context('POST', '/api/public/lojas/lanchonete/pedidos', body, session), { DB: db });
    assert.equal(order.status, 201);
  }
  const ordersAna = await call(db, 'GET', '/pedidos', {}, cookie(ana));
  const ordersBia = await call(db, 'GET', '/pedidos', {}, cookie(bia));
  assert.deepEqual(ordersAna.data.map((p) => p.chave), ['pedido-cliente-0001']);
  assert.deepEqual(ordersBia.data.map((p) => p.chave), ['pedido-cliente-0002']);
  assert.equal(db.prepare("SELECT cliente_id FROM pedidos_online WHERE chave='pedido-visitante-0001'").first().cliente_id, null);
  assert.equal((await call(db, 'GET', '/pedidos')).status, 401);
});
