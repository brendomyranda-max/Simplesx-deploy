import assert from 'node:assert/strict';
import test from 'node:test';
import SqliteDb from '../server/sqlite-db.js';
import { TenantDb } from '../shared/tenant-db.js';
import {
  addStoreCategoryHandler,
  createPublicOrderHandler,
  getPublicOrderHandler,
  getPublicStoreHandler,
  listPublicStoresHandler,
  updateOnlineStoreHandler,
  upsertOnlineCatalogProductHandler,
} from '../shared/handlers-online.js';

function context(body = {}, params = {}) {
  return {
    params,
    req: { json: async () => body, header: () => '', query: () => '' },
    json: (data, status = 200) => ({ data, status }),
  };
}

test('apenas cardápio mantém produtos no link e bloqueia novos pedidos sem afetar outras lojas', async (t) => {
  const raw = new SqliteDb(':memory:');
  t.after(() => raw.close());
  raw.prepare("INSERT INTO estabelecimentos (id,nome,ativo) VALUES (1,'Cardápio',1),(2,'Delivery',1)").run();
  raw.prepare("INSERT INTO produtos (id,estabelecimento_id,nome,preco,estoque_atual,tipo,ativo) VALUES (10,1,'Prato da casa',25,100,'produto',1)").run();
  const admin = { DB: new TenantDb(raw, 1), rawDB: raw, estabelecimentoId: 1 };
  const outraLoja = { DB: new TenantDb(raw, 2), rawDB: raw, estabelecimentoId: 2 };
  const publico = { DB: raw };
  const criada = await updateOnlineStoreHandler(context({ slug: 'cardapio-casa', nome: 'Cardápio', ativo: true, taxa_entrega: 7 }), admin);
  assert.equal(criada.data.aceita_pedidos_online, 1, 'lojas existentes continuam recebendo pedidos');
  await updateOnlineStoreHandler(context({ slug: 'outro-delivery', nome: 'Delivery', ativo: true }), outraLoja);
  await addStoreCategoryHandler(context({ nome: 'Pratos da casa' }), admin);
  await addStoreCategoryHandler(context({ nome: 'Lanches' }), outraLoja);
  const produto = await upsertOnlineCatalogProductHandler(context({ produto_id: 10, preco: 27, descricao: 'Arroz e feijão', foto_url: 'https://example.com/prato.jpg' }), admin);
  const pedido = (chave, tipo_entrega = 'retirada') => ({
    chave, cliente_nome: 'Ana', telefone: '11999990000', tipo_entrega,
    endereco: tipo_entrega === 'entrega' ? 'Rua da Casa, 10' : '', forma_pagamento: 'dinheiro',
    itens: [{ cardapio_produto_id: produto.data.id, quantidade: 1 }],
  });
  const anterior = await createPublicOrderHandler(context(pedido('pedido-antes-consulta'), { slug: 'cardapio-casa' }), publico);
  assert.equal(anterior.status, 201);
  const contagens = () => ['pedidos_online', 'comandas', 'mesas', 'comanda_itens', 'gestor_jobs', 'device_tasks']
    .map((table) => raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first().n);
  const antes = contagens();

  const consulta = await updateOnlineStoreHandler(context({ aceita_pedidos_online: 0 }), admin);
  assert.equal(consulta.data.ativo, 1);
  assert.equal(consulta.data.slug, 'cardapio-casa');
  assert.equal(consulta.data.taxa_entrega, 7);
  assert.equal(consulta.data.aceita_entrega, 1);
  assert.equal(consulta.data.modo_publicacao, 'marketplace', 'a preferência de vitrine fica guardada');

  const menu = await getPublicStoreHandler(context({}, { slug: 'cardapio-casa' }), publico);
  assert.equal(menu.status, 200);
  assert.equal(menu.data.loja.aceita_pedidos_online, 0);
  assert.equal(menu.data.produtos[0].preco, 27);
  assert.equal(menu.data.produtos[0].descricao, 'Arroz e feijão');
  assert.equal(menu.data.produtos[0].foto_url, 'https://example.com/prato.jpg');
  const rede = await listPublicStoresHandler(context(), publico);
  assert.deepEqual(rede.data.lojas.map((loja) => loja.slug), ['outro-delivery']);
  assert.deepEqual(rede.data.categorias.map((categoria) => categoria.nome), ['Lanches']);

  for (const tipo of ['entrega', 'retirada']) {
    const bloqueado = await createPublicOrderHandler(context(pedido(`pedido-bloqueado-${tipo}`, tipo), { slug: 'cardapio-casa' }), publico);
    assert.equal(bloqueado.status, 403);
    assert.match(bloqueado.data.error, /apenas o cardápio online/);
  }
  assert.deepEqual(contagens(), antes, 'a tentativa não cria pedidos, comandas nem impressão');
  const acompanhamento = await getPublicOrderHandler(context({}, { slug: 'cardapio-casa', chave: 'pedido-antes-consulta' }), publico);
  assert.equal(acompanhamento.status, 200, 'pedidos anteriores continuam acessíveis');
  assert.equal(acompanhamento.data.total, 27);

  const edicao = await updateOnlineStoreHandler(context({ descricao: 'Cardápio para consulta' }), admin);
  assert.equal(edicao.data.aceita_pedidos_online, 0, 'editar outros campos não reativa pedidos');
  await updateOnlineStoreHandler(context({ aceita_pedidos_online: 1 }), admin);
  const reativado = await getPublicStoreHandler(context({}, { slug: 'cardapio-casa' }), publico);
  assert.equal(reativado.data.loja.aceita_pedidos_online, 1);
  const redeReativada = await listPublicStoresHandler(context(), publico);
  assert.equal(redeReativada.data.lojas.some((loja) => loja.slug === 'cardapio-casa'), true);
  const novo = await createPublicOrderHandler(context(pedido('pedido-depois-consulta'), { slug: 'cardapio-casa' }), publico);
  assert.equal(novo.status, 201);
});

test('delivery somente pelo link conserva essa escolha ao voltar do modo de consulta', async (t) => {
  const raw = new SqliteDb(':memory:');
  t.after(() => raw.close());
  raw.prepare("INSERT INTO estabelecimentos (id,nome,ativo) VALUES (1,'Direta',1)").run();
  const admin = { DB: new TenantDb(raw, 1), rawDB: raw, estabelecimentoId: 1 };
  await updateOnlineStoreHandler(context({ slug: 'loja-direta', nome: 'Direta', ativo: true, modo_publicacao: 'cardapio' }), admin);
  await updateOnlineStoreHandler(context({ aceita_pedidos_online: 0 }), admin);
  const volta = await updateOnlineStoreHandler(context({ aceita_pedidos_online: 1 }), admin);
  assert.equal(volta.data.modo_publicacao, 'cardapio');
  const rede = await listPublicStoresHandler(context(), { DB: raw });
  assert.equal(rede.data.lojas.length, 0);
  const menu = await getPublicStoreHandler(context({}, { slug: 'loja-direta' }), { DB: raw });
  assert.equal(menu.data.loja.aceita_pedidos_online, 1);
});
