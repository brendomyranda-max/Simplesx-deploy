import assert from 'node:assert/strict';
import test from 'node:test';
import SqliteDb from '../server/sqlite-db.js';
import { TenantDb } from '../shared/tenant-db.js';
import { migrarSlugsLojas, slugDoNome } from '../shared/loja-slug.js';
import {
  createPublicOrderHandler, getOnlineStoreHandler, getPublicOrderHandler, getPublicStoreHandler,
  listPublicStoresHandler, updateOnlineStoreHandler, upsertOnlineCatalogProductHandler,
} from '../shared/handlers-online.js';

function context(body = {}, params = {}) {
  return { params, req: { json: async () => body, header: () => '', query: () => '' }, json: (data, status = 200) => ({ data, status }) };
}

test('loja nova recebe um endereço com seu nome, sem o número do estabelecimento', async (t) => {
  assert.equal(slugDoNome('  Brasa & Pão!  '), 'brasa-pao');
  assert.equal(slugDoNome('Açaí da Praça'), 'acai-da-praca');
  assert.equal(slugDoNome('a'.repeat(100)).length, 60);
  assert.equal(slugDoNome('🍽️'), 'restaurante');
  const raw = new SqliteDb(':memory:');
  t.after(() => raw.close());
  raw.prepare("INSERT INTO estabelecimentos (id,nome) VALUES (17,'Açaí da Praça')").run();
  const env = { DB: new TenantDb(raw, 17), rawDB: raw, estabelecimentoId: 17 };
  const loja = await getOnlineStoreHandler(context(), env);
  assert.equal(loja.data.slug, 'acai-da-praca');
  assert.equal(loja.data.site_url, '/pedido/acai-da-praca');
});

test('migração e alteração de nome preservam cardápios e acompanhamentos pelos links antigos', async (t) => {
  const raw = new SqliteDb(':memory:');
  t.after(() => raw.close());
  raw.prepare("INSERT INTO estabelecimentos (id,nome,ativo) VALUES (1,'Brasa',1),(2,'Outra',1)").run();
  raw.prepare("INSERT INTO produtos (id,estabelecimento_id,nome,preco,tipo,ativo) VALUES (10,1,'Prato',25,'produto',1)").run();
  const admin = { DB: new TenantDb(raw, 1), rawDB: raw, estabelecimentoId: 1 };
  const outra = { DB: new TenantDb(raw, 2), rawDB: raw, estabelecimentoId: 2 };
  const publico = { DB: raw };
  await updateOnlineStoreHandler(context({ slug: 'loja-1', nome: 'Brasa & Pão', ativo: 1 }), admin);
  const produto = await upsertOnlineCatalogProductHandler(context({ produto_id: 10, preco: 25 }), admin);
  const pedido = await createPublicOrderHandler(context({
    chave: 'pedido-link-antigo-01', cliente_nome: 'Ana', telefone: '11999990000', tipo_entrega: 'retirada', forma_pagamento: 'dinheiro',
    itens: [{ cardapio_produto_id: produto.data.id, quantidade: 1 }],
  }, { slug: 'loja-1' }), publico);
  assert.equal(pedido.status, 201);

  assert.equal((await migrarSlugsLojas(raw)).length, 1);
  assert.equal((await migrarSlugsLojas(raw)).length, 0, 'a migração é idempotente');
  const antigo = await getPublicStoreHandler(context({}, { slug: 'loja-1' }), publico);
  assert.equal(antigo.data.loja.slug, 'brasa-pao');
  const rede = await listPublicStoresHandler(context(), publico);
  assert.equal(rede.data.lojas[0].slug, 'brasa-pao');

  const foto = 'https://example.com/foto-restaurante.jpg';
  const perfil = await updateOnlineStoreHandler(context({ nome: 'Cantinho do Açaí', logo_url: foto }), admin);
  assert.equal(perfil.data.slug, 'cantinho-do-acai');
  assert.equal(perfil.data.logo_url, foto);
  for (const slug of ['loja-1', 'brasa-pao', 'cantinho-do-acai']) {
    const menu = await getPublicStoreHandler(context({}, { slug }), publico);
    assert.equal(menu.data.loja.slug, 'cantinho-do-acai');
    assert.equal(menu.data.loja.logo_url, foto);
    const acompanhamento = await getPublicOrderHandler(context({}, { slug, chave: 'pedido-link-antigo-01' }), publico);
    assert.equal(acompanhamento.status, 200);
    assert.equal(acompanhamento.data.total, 25);
  }
  const invasao = await updateOnlineStoreHandler(context({ slug: 'brasa-pao', nome: 'Outra loja', ativo: 1 }), outra);
  assert.equal(invasao.status, 409, 'outro estabelecimento não pode reutilizar um link compartilhado');
});

test('nomes com o mesmo endereço normalizado recebem links diferentes', async (t) => {
  const raw = new SqliteDb(':memory:');
  t.after(() => raw.close());
  raw.prepare("INSERT INTO estabelecimentos (id,nome,ativo) VALUES (1,'Café',1),(2,'Cafe',1)").run();
  const lojas = [];
  for (const id of [1, 2]) {
    const env = { DB: new TenantDb(raw, id), rawDB: raw, estabelecimentoId: id };
    lojas.push((await getOnlineStoreHandler(context(), env)).data);
  }
  assert.deepEqual(lojas.map((loja) => loja.slug), ['cafe', 'cafe-2']);
});
