import assert from 'node:assert/strict';
import test from 'node:test';
import SqliteDb from '../server/sqlite-db.js';
import { TenantDb } from '../shared/tenant-db.js';
import { createCategoriaHandler, deleteCategoriaHandler, listCategoriasHandler, createProdutoHandler, updateProdutoHandler, entradaMercadoriaHandler } from '../shared/handlers-catalog.js';
import { updateOnlineStoreHandler, upsertOnlineCatalogProductHandler, getPublicStoreHandler, createPublicOrderHandler } from '../shared/handlers-online.js';
import { saveOrderItems } from '../shared/restaurant-orders.js';
import { handle } from '../shared/router.js';

function context(body = {}, id, params = {}) {
  return {
    user: { id: 1, nome: 'Dono' }, params: { id: String(id ?? ''), ...params },
    req: { json: async () => body, header: () => '', query: () => '' },
    json: (data, status = 200) => ({ data, status }),
  };
}

function fixture(t) {
  const raw = new SqliteDb(':memory:');
  t.after(() => raw.close());
  raw.prepare("INSERT INTO estabelecimentos(id,nome) VALUES(1,'Loja A'),(2,'Loja B')").run();
  return { raw, a: { DB: new TenantDb(raw, 1), rawDB: raw, estabelecimentoId: 1 }, b: { DB: new TenantDb(raw, 2), rawDB: raw, estabelecimentoId: 2 } };
}

const stockProduct = { nome: 'Embalagem', tipo: 'produto', unidade: 'UN', sem_vencimento: true };

function categoriesFixture(t) {
  const f = fixture(t);
  f.raw.prepare(`INSERT INTO impressora_agentes(id,estabelecimento_id,nome,ip,categorias) VALUES
    (1,1,'Cozinha','local','[10,11]'),(2,1,'Bar','local','["10",12]'),
    (3,2,'Outra loja','local','[10,20]'),(4,1,'Antiga','local','invalido')`).run();
  f.raw.prepare(`INSERT INTO categorias(id,estabelecimento_id,nome,categoria_pai_id,impressora_agente_id) VALUES
    (10,1,'Principal',NULL,1),(11,1,'Filha herdada',10,NULL),(12,1,'Filha própria',10,2),
    (13,1,'Outra',NULL,NULL),(20,2,'Principal',NULL,3)`).run();
  f.raw.prepare(`INSERT INTO produtos(id,estabelecimento_id,nome,preco,estoque_atual) VALUES
    (1,1,'Produto',12,7),(2,2,'Produto B',20,8)`).run();
  f.raw.prepare(`INSERT INTO produto_categorias(estabelecimento_id,produto_id,categoria_id) VALUES
    (1,1,10),(1,1,11),(1,1,13),(2,2,20)`).run();
  f.raw.prepare(`INSERT INTO estoque_movimentacoes(estabelecimento_id,produto_id,tipo,quantidade,saldo_apos) VALUES
    (1,1,'entrada',7,7),(2,2,'entrada',8,8)`).run();
  f.raw.prepare("INSERT INTO cardapio_online_categorias(id,estabelecimento_id,nome) VALUES(1,1,'Lanches')").run();
  f.raw.prepare(`INSERT INTO cardapio_online_produtos(estabelecimento_id,produto_id,categoria_id,cardapio_categoria_id,preco) VALUES
    (1,1,10,1,15),(2,2,20,NULL,25)`).run();
  return f;
}

test('excluir categoria preserva produtos, histórico, delivery e subcategorias com suas impressoras', async (t) => {
  const f = categoriesFixture(t);
  const produtos = f.raw.prepare('SELECT * FROM produtos ORDER BY id').all().results;
  const historico = f.raw.prepare('SELECT * FROM estoque_movimentacoes ORDER BY id').all().results;
  const outroDelivery = f.raw.prepare('SELECT * FROM cardapio_online_produtos WHERE estabelecimento_id=2').first();
  assert.equal((await deleteCategoriaHandler(context({}, 10), f.a)).status, 200);
  const cats = (await listCategoriasHandler(context(), f.a)).data;
  assert.equal(cats.some((c) => c.id === 10), false);
  for (const [id, impressora] of [[11, 1], [12, 2]]) {
    const sub = cats.find((c) => c.id === id);
    assert.equal(sub.categoria_pai_id, null);
    assert.equal(sub.impressora_herdada_id, impressora);
  }
  assert.deepEqual(f.raw.prepare('SELECT * FROM produtos ORDER BY id').all().results, produtos);
  assert.deepEqual(f.raw.prepare('SELECT * FROM estoque_movimentacoes ORDER BY id').all().results, historico);
  assert.deepEqual(f.raw.prepare('SELECT categoria_id FROM produto_categorias ORDER BY categoria_id').all().results, [{ categoria_id: 11 }, { categoria_id: 13 }, { categoria_id: 20 }]);
  const online = f.raw.prepare('SELECT * FROM cardapio_online_produtos WHERE estabelecimento_id=1').first();
  assert.equal(online.categoria_id, null);
  assert.equal(online.cardapio_categoria_id, 1);
  assert.equal(online.preco, 15);
  assert.equal(online.ativo, 1);
  assert.deepEqual(f.raw.prepare('SELECT * FROM cardapio_online_produtos WHERE estabelecimento_id=2').first(), outroDelivery);
  assert.deepEqual(f.raw.prepare('SELECT categorias FROM impressora_agentes ORDER BY id').all().results.map((r) => r.categorias), ['[11]', '[12]', '[10,20]', 'invalido']);
  assert.equal((await createCategoriaHandler(context({ nome: 'Principal' }), f.a)).status, 201);
});

test('exclusão de subcategoria mantém a principal; categoria de outra loja não pode ser excluída', async (t) => {
  const f = categoriesFixture(t);
  assert.equal((await deleteCategoriaHandler(context({}, 11), f.a)).status, 200);
  assert.equal(f.raw.prepare('SELECT nome FROM categorias WHERE id=10').first().nome, 'Principal');
  assert.equal((await deleteCategoriaHandler(context({}, 20), f.a)).status, 404);
  assert.equal((await deleteCategoriaHandler(context({}, 10), f.b)).status, 404);
  for (const id of ['abc', 0, -1, 1.5]) assert.equal((await deleteCategoriaHandler(context({}, id), f.a)).status, 400);
  assert.equal((await deleteCategoriaHandler(context({}, 11), f.a)).status, 404);
  const result = await handle({ req: { path: '/api/categorias/10', method: 'DELETE', header: () => '', query: () => '' }, json: (data, status) => ({ data, status }) }, { DB: f.raw });
  assert.equal(result.status, 401);
});

test('falha na exclusão desfaz a remoção dos vínculos e das rotas de impressão', async (t) => {
  const f = categoriesFixture(t);
  const tables = ['categorias', 'produto_categorias', 'cardapio_online_produtos', 'impressora_agentes'];
  const before = tables.map((name) => f.raw.prepare(`SELECT * FROM ${name}`).all().results);
  f.raw.db.exec("CREATE TRIGGER impedir_exclusao BEFORE DELETE ON categorias BEGIN SELECT RAISE(ABORT, 'falha simulada'); END");
  await assert.rejects(() => deleteCategoriaHandler(context({}, 10), f.a), /falha simulada/);
  assert.deepEqual(tables.map((name) => f.raw.prepare(`SELECT * FROM ${name}`).all().results), before);
});

test('produto simples sem preço nem validade permite cadastro e reposição sem gerar venda ou alerta', async (t) => {
  const f = fixture(t);
  const created = await createProdutoHandler(context({ ...stockProduct, estoque_atual: 2, exibir_restaurante: true, exibir_mercado: true }), f.a);
  assert.equal(created.status, 201);
  assert.equal(created.data.preco, null);
  assert.equal(created.data.custo, 0);
  assert.equal(created.data.data_vencimento, null);
  assert.equal(created.data.exibir_restaurante, 0);
  assert.equal(created.data.exibir_mercado, 0);
  const entered = await entradaMercadoriaHandler(context({ produto_id: created.data.id, quantidade: 3 }), f.a);
  assert.equal(entered.status, 200);
  assert.equal(entered.data.novo_saldo, 5);
  assert.equal(f.raw.prepare('SELECT preco FROM produtos').first().preco, null);
  assert.deepEqual(f.raw.prepare('SELECT quantidade,data_validade FROM lotes ORDER BY id').all().results, [
    { quantidade: 2, data_validade: null }, { quantidade: 3, data_validade: null },
  ]);
  for (const table of ['vendas', 'validade_controles']) assert.equal(f.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first().n, 0);
  assert.equal((await entradaMercadoriaHandler(context({ produto_id: created.data.id, quantidade: 1 }), f.b)).status, 404);
});

test('editar produto permite retirar e recolocar o preço; atualização parcial preserva preço existente', async (t) => {
  const f = fixture(t);
  const created = await createProdutoHandler(context({ ...stockProduct, preco: 12, exibir_restaurante: true, exibir_mercado: true }), f.a);
  const id = created.data.id;
  const partial = await updateProdutoHandler(context({ nome: 'Embalagem grande' }, id), f.a);
  assert.equal(partial.data.preco, 12);
  for (const preco of [null, '']) {
    const result = await updateProdutoHandler(context({ nome: 'Embalagem grande', preco }, id), f.a);
    assert.equal(result.status, 200);
    assert.equal(result.data.preco, null);
    assert.equal(result.data.exibir_restaurante, 0);
    assert.equal(result.data.exibir_mercado, 0);
  }
  const restored = await updateProdutoHandler(context({ nome: 'Embalagem grande', preco: 15, exibir_restaurante: true, exibir_mercado: true }, id), f.a);
  assert.equal(restored.data.preco, 15);
  assert.equal(restored.data.exibir_restaurante, 1);
  assert.equal(restored.data.exibir_mercado, 1);
});

test('preço opcional não aceita valores inválidos nem desobriga validade quando habilitada ou preço de balança', async (t) => {
  const f = fixture(t);
  for (const preco of [-1, 'inválido', 0]) await assert.rejects(() => createProdutoHandler(context({ ...stockProduct, preco }), f.a), (error) => error.status === 400);
  assert.equal((await createProdutoHandler(context({ ...stockProduct, produto_balanca: true, unidade: 'KG', balanca_plu: '123' }), f.a)).status, 400);
  assert.equal((await createProdutoHandler(context({ ...stockProduct, sem_vencimento: false }), f.a)).status, 400);
  const dated = await createProdutoHandler(context({ ...stockProduct, sem_vencimento: false, data_fabricacao: '2026-10-01', data_vencimento: '2026-10-31' }), f.a);
  assert.equal(dated.status, 201);
  assert.equal(dated.data.preco, null);
  assert.equal((await entradaMercadoriaHandler(context({ produto_id: dated.data.id, quantidade: 1 }), f.a)).status, 400);
});

test('produto somente para estoque não é lançado como venda gratuita no restaurante', async (t) => {
  const f = fixture(t);
  const created = await createProdutoHandler(context(stockProduct), f.a);
  f.raw.prepare("INSERT INTO mesas(id,estabelecimento_id,numero,nome) VALUES(1,1,1,'Mesa 1')").run();
  f.raw.prepare("INSERT INTO comandas(id,estabelecimento_id,mesa_id,status) VALUES(1,1,1,'aberta')").run();
  await assert.rejects(() => saveOrderItems(context({}, 1), f.a, { chave: 'pedido-sem-preco-01', itens: [{ produto_id: created.data.id, quantidade: 1 }] }), (error) => error.status === 400 && /preço de venda/.test(error.message));
  assert.equal(f.raw.prepare('SELECT COUNT(*) AS n FROM comanda_itens').first().n, 0);
});

test('delivery recusa produto sem preço, mas permite preço próprio configurado no cardápio', async (t) => {
  const f = fixture(t);
  const created = await createProdutoHandler(context(stockProduct), f.a);
  await updateOnlineStoreHandler(context({ nome: 'Loja A', slug: 'loja-estoque', ativo: true }), f.a);
  const catalog = await upsertOnlineCatalogProductHandler(context({ produto_id: created.data.id }), f.a);
  assert.equal(catalog.status, 201);
  const menu = await getPublicStoreHandler(context({}, undefined, { slug: 'loja-estoque' }), { DB: f.raw });
  assert.equal(menu.data.produtos[0].preco, null);
  const order = { chave: 'pedido-sem-preco-02', cliente_nome: 'Ana', telefone: '11999990000', tipo_entrega: 'retirada', forma_pagamento: 'dinheiro', itens: [{ cardapio_produto_id: catalog.data.id, quantidade: 1 }] };
  await assert.rejects(() => createPublicOrderHandler(context(order, undefined, { slug: 'loja-estoque' }), { DB: f.raw }), (error) => error.status === 409);
  assert.equal(f.raw.prepare('SELECT COUNT(*) AS n FROM pedidos_online').first().n, 0);
  await upsertOnlineCatalogProductHandler(context({ produto_id: created.data.id, preco: 9 }), f.a);
  const pricedOrder = await createPublicOrderHandler(context(order, undefined, { slug: 'loja-estoque' }), { DB: f.raw });
  assert.equal(pricedOrder.status, 201);
  assert.equal(pricedOrder.data.total, 9);
});
