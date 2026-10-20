import assert from 'node:assert/strict';
import test from 'node:test';
import SqliteDb from '../server/sqlite-db.js';
import { TenantDb } from '../shared/tenant-db.js';
import { createProdutoHandler, listProdutosHandler, updateProdutoHandler } from '../shared/handlers-catalog.js';
import { updateItemComandaHandler } from '../shared/handlers-vendas.js';
import { saveOrderItems } from '../shared/restaurant-orders.js';
import { createPublicOrderHandler, getPublicStoreHandler, updateOnlineStoreHandler, upsertOnlineCatalogProductHandler } from '../shared/handlers-online.js';

function context(body = {}, params = {}, query = {}) {
  return {
    user: { id: 1, nome: 'Dono' },
    params,
    req: { json: async () => body, query: (name) => query[name] || '', header: () => '' },
    json: (data, status = 200) => ({ data, status }),
  };
}

function fixture(t) {
  const DB = new SqliteDb(':memory:');
  t.after(() => DB.close());
  DB.prepare("INSERT INTO estabelecimentos (id,nome,ativo) VALUES (1,'Loja A',1),(2,'Loja B',1)").run();
  const tenant = (id) => ({ DB: new TenantDb(DB, id), rawDB: DB, estabelecimentoId: id });
  return { DB, a: tenant(1), b: tenant(2) };
}

const insumoBase = { tipo: 'insumo', unidade: 'UN', custo: 1, validade_aberto_dias: 3, sem_vencimento: 1 };

test('produto composto guarda o acréscimo do insumo e o lançamento soma o valor na observação', async (t) => {
  const f = fixture(t);
  const bacon = await createProdutoHandler(context({ ...insumoBase, nome: 'Bacon', custo: 2 }), f.a);
  const queijo = await createProdutoHandler(context({ ...insumoBase, nome: 'Queijo', preco: 3.5 }), f.a);
  const sal = await createProdutoHandler(context({ ...insumoBase, nome: 'Sal' }), f.a);
  assert.equal(bacon.status, 201);
  const composto = await createProdutoHandler(context({
    nome: 'X-Salada', tipo: 'composto', unidade: 'UN', preco: 20,
    ingredientes: [{ insumo_id: bacon.data.id, quantidade: 1, unidade: 'UN' }],
    acrescimos: [{ insumo_id: queijo.data.id, valor: 99 }],
  }), f.a);
  assert.equal(composto.status, 201);
  assert.equal(composto.data.acrescimos.length, 1);
  assert.equal(composto.data.acrescimos[0].insumo_nome, 'Queijo');
  assert.equal(composto.data.acrescimos[0].valor, 3.5);

  const lista = await listProdutosHandler(context(), f.a);
  const item = lista.data.find((produto) => produto.id === composto.data.id);
  assert.equal(item.acrescimos[0].insumo_id, queijo.data.id);
  const outraLoja = await listProdutosHandler(context(), f.b);
  assert.equal(outraLoja.data.length, 0);

  const semPreco = await createProdutoHandler(context({
    nome: 'Sem valor', tipo: 'composto', unidade: 'UN', preco: 10,
    ingredientes: [{ insumo_id: bacon.data.id, quantidade: 1, unidade: 'UN' }],
    acrescimos: [{ insumo_id: sal.data.id, valor: 3 }],
  }), f.a);
  assert.equal(semPreco.status, 400);
  assert.match(semPreco.data.error, /preço de venda/);
  assert.equal((await updateProdutoHandler(context({
    nome: 'X-Salada', tipo: 'composto', preco: 20,
    ingredientes: [{ insumo_id: bacon.data.id, quantidade: 1, unidade: 'UN' }],
    acrescimos: [{ insumo_id: composto.data.id, valor: 2 }],
  }, { id: String(composto.data.id) }), f.a)).status, 400);

  f.DB.prepare("INSERT INTO mesas (id,estabelecimento_id,numero,status) VALUES (1,1,1,'ocupada')").run();
  f.DB.prepare("INSERT INTO comandas (id,estabelecimento_id,mesa_id,garcom_nome,status) VALUES (1,1,1,'Ana','aberta')").run();
  const pedido = await saveOrderItems(context({}, { id: '1' }), f.a, {
    chave: 'acrescimo-lanche-01',
    itens: [{ produto_id: composto.data.id, quantidade: 2, observacao: 'Sem cebola', acrescimos: [queijo.data.id, queijo.data.id], preco_unitario: 1 }],
  });
  assert.equal(pedido.itens.length, 1);
  assert.equal(pedido.itens[0].preco_unitario, 27);
  assert.equal(pedido.itens[0].observacao, 'Adicionar: Queijo\nAdicionar: Queijo\nSem cebola');
  const repetido = await saveOrderItems(context({}, { id: '1' }), f.a, {
    chave: 'acrescimo-lanche-01',
    itens: [{ produto_id: composto.data.id, quantidade: 2, observacao: 'Sem cebola', acrescimos: [queijo.data.id, queijo.data.id], preco_unitario: 1 }],
  });
  assert.equal(repetido.repetido, true);
  assert.equal(f.DB.prepare('SELECT COUNT(*) AS n FROM comanda_itens').first().n, 1);
  await assert.rejects(
    () => saveOrderItems(context({}, { id: '1' }), f.a, { chave: 'acrescimo-lanche-02', itens: [{ produto_id: composto.data.id, quantidade: 1, acrescimos: [999] }] }),
    (error) => error.status === 400,
  );

  const editado = await updateItemComandaHandler(context({ observacao: 'Ponto da carne', acrescimos: [] }, { id: '1', item_id: String(pedido.itens[0].id) }), f.a);
  assert.equal(editado.status, 200);
  assert.equal(editado.data.preco_unitario, 20);
  assert.equal(editado.data.observacao, 'Ponto da carne');

  const reajuste = await updateProdutoHandler(context({
    nome: 'Queijo', tipo: 'insumo', preco: 5, validade_aberto_dias: 3, sem_vencimento: 1,
  }, { id: String(queijo.data.id) }), f.a);
  assert.equal(reajuste.status, 200);
  assert.equal(f.DB.prepare('SELECT valor FROM produto_acrescimos WHERE insumo_id=?').bind(queijo.data.id).first().valor, 5);
  const atualizado = (await listProdutosHandler(context(), f.a)).data.find((produto) => produto.id === composto.data.id);
  assert.equal(atualizado.acrescimos[0].valor, 5);
});

test('delivery publica o insumo como observação com valor e ignora insumo de outra loja', async (t) => {
  const f = fixture(t);
  const queijo = await createProdutoHandler(context({ ...insumoBase, nome: 'Queijo', preco: 4 }), f.a);
  const lanche = await createProdutoHandler(context({
    nome: 'Smash', tipo: 'produto', unidade: 'UN', preco: 30, sem_vencimento: 1,
  }), f.a);
  const loja = await updateOnlineStoreHandler(context({ slug: 'brasa-pao', nome: 'Brasa', ativo: true, taxa_entrega: 0 }), f.a);
  assert.equal(loja.status, 200);
  const invalido = await upsertOnlineCatalogProductHandler(context({
    produto_id: lanche.data.id, preco: 30,
    opcoes: [{ nome: 'Outro', tipo: 'adicional', preco_adicional: 4, insumo_id: 999 }],
  }), f.a);
  assert.equal(invalido.status, 400);
  assert.equal(f.DB.prepare('SELECT COUNT(*) AS n FROM cardapio_online_produtos').first().n, 0);

  const publicado = await upsertOnlineCatalogProductHandler(context({
    produto_id: lanche.data.id, preco: 30,
    opcoes: [
      { nome: 'Cebola', tipo: 'removivel' },
      { nome: 'Nome errado', tipo: 'adicional', preco_adicional: 9, insumo_id: queijo.data.id },
    ],
  }), f.a);
  assert.equal(publicado.status, 201);
  const extra = publicado.data.opcoes.find((opcao) => opcao.tipo === 'adicional');
  assert.equal(extra.nome, 'Queijo');
  assert.equal(extra.insumo_id, queijo.data.id);
  assert.equal(extra.preco_adicional, 4);

  const menu = await getPublicStoreHandler(context({}, { slug: 'brasa-pao' }), { DB: f.DB });
  const opcao = menu.data.produtos[0].opcoes.find((item) => item.nome === 'Queijo');
  const pedido = await createPublicOrderHandler(context({
    chave: 'pedido-acrescimo-01',
    cliente_nome: 'Ana Souza',
    telefone: '11999990000',
    tipo_entrega: 'retirada',
    forma_pagamento: 'dinheiro',
    itens: [{ cardapio_produto_id: menu.data.produtos[0].id, quantidade: 1, opcoes_ids: [opcao.id], observacao: 'Sem molho' }],
  }, { slug: 'brasa-pao' }), { DB: f.DB });
  assert.equal(pedido.status, 201);
  assert.equal(pedido.data.total, 34);
  const item = f.DB.prepare('SELECT observacao, preco_unitario FROM comanda_itens').first();
  assert.equal(item.preco_unitario, 34);
  assert.match(item.observacao, /Adicionar: Queijo/);
  assert.match(item.observacao, /Sem molho/);

  const reajuste = await updateProdutoHandler(context({
    nome: 'Queijo', tipo: 'insumo', preco: 6, validade_aberto_dias: 3, sem_vencimento: 1,
  }, { id: String(queijo.data.id) }), f.a);
  assert.equal(reajuste.status, 200);
  assert.equal(f.DB.prepare('SELECT preco_adicional FROM cardapio_online_opcoes WHERE insumo_id=?').bind(queijo.data.id).first().preco_adicional, 6);
});

const simplesBase = { tipo: 'produto', unidade: 'UN', sem_vencimento: 1, estoque_atual: 10 };

test('produto simples cadastra bife e bebida como adicionais e preserva os vínculos na edição', async (t) => {
  const f = fixture(t);
  const bife = await createProdutoHandler(context({ ...insumoBase, nome: 'Bife extra', preco: 8 }), f.a);
  const bebida = await createProdutoHandler(context({ ...simplesBase, nome: 'Refrigerante', preco: 6 }), f.a);
  const prato = await createProdutoHandler(context({
    ...simplesBase, nome: 'Prato executivo', preco: 25,
    acrescimos: [{ insumo_id: bife.data.id, valor: 1 }, { insumo_id: bebida.data.id, valor: 1 }],
  }), f.a);
  assert.equal(prato.status, 201);
  assert.deepEqual(prato.data.acrescimos.map((a) => [a.insumo_nome, a.valor]), [['Bife extra', 8], ['Refrigerante', 6]]);
  const id = String(prato.data.id);
  const editado = await updateProdutoHandler(context({ ...simplesBase, nome: 'Prato do dia', preco: 27 }, { id }), f.a);
  assert.deepEqual(editado.data.acrescimos, prato.data.acrescimos);
  f.DB.prepare("INSERT INTO mesas(id,estabelecimento_id,numero,status) VALUES(1,1,1,'ocupada')").run();
  f.DB.prepare("INSERT INTO comandas(id,estabelecimento_id,mesa_id,status) VALUES(1,1,1,'aberta')").run();
  const pedido = await saveOrderItems(context({}, { id: '1' }), f.a, {
    chave: 'prato-simples-extras-01',
    itens: [{ produto_id: prato.data.id, quantidade: 2, preco_unitario: 1, acrescimos: [bife.data.id, bebida.data.id], observacao: 'Sem sal' }],
  });
  assert.equal(pedido.itens[0].preco_unitario, 41);
  assert.equal(pedido.itens[0].quantidade, 2);
  assert.equal(pedido.itens[0].observacao, 'Adicionar: Bife extra\nAdicionar: Refrigerante\nSem sal');
  const semBebida = await updateItemComandaHandler(context({ acrescimos: [bife.data.id] }, { id: '1', item_id: String(pedido.itens[0].id) }), f.a);
  assert.equal(semBebida.status, 200);
  assert.equal(semBebida.data.preco_unitario, 35);
  assert.equal(semBebida.data.observacao, 'Adicionar: Bife extra\nSem sal');
  const removidos = await updateProdutoHandler(context({ ...simplesBase, nome: 'Prato do dia', preco: 27, acrescimos: [] }, { id }), f.a);
  assert.deepEqual(removidos.data.acrescimos, []);
  const cadastrados = await updateProdutoHandler(context({ ...simplesBase, nome: 'Prato do dia', preco: 27, acrescimos: [{ insumo_id: bebida.data.id }] }, { id }), f.a);
  assert.equal(cadastrados.data.acrescimos[0].insumo_id, bebida.data.id);
});

test('adicionais simples exigem preço e produto ativo da mesma loja, sem aceitar o próprio produto', async (t) => {
  const f = fixture(t);
  const semPreco = await createProdutoHandler(context({ ...simplesBase, nome: 'Embalagem' }), f.a);
  const inativo = await createProdutoHandler(context({ ...simplesBase, nome: 'Bebida pausada', preco: 6 }), f.a);
  f.DB.prepare('UPDATE produtos SET ativo=0 WHERE id=?').bind(inativo.data.id).run();
  const outraLoja = await createProdutoHandler(context({ ...simplesBase, nome: 'Bebida alheia', preco: 7 }), f.b);
  for (const adicional of [semPreco, inativo, outraLoja]) {
    const result = await createProdutoHandler(context({ ...simplesBase, nome: 'Inválido', preco: 20, acrescimos: [{ insumo_id: adicional.data.id, valor: 1 }] }), f.a);
    assert.equal(result.status, 400);
  }
  const prato = await createProdutoHandler(context({ ...simplesBase, nome: 'Prato', preco: 20 }), f.a);
  const result = await updateProdutoHandler(context({ ...simplesBase, nome: 'Prato', preco: 20, acrescimos: [{ insumo_id: prato.data.id }] }, { id: String(prato.data.id) }), f.a);
  assert.equal(result.status, 400);
  assert.match(result.data.error, /próprio produto/);
  assert.equal(f.DB.prepare('SELECT COUNT(*) AS n FROM produtos WHERE nome=?').bind('Inválido').first().n, 0);
});

test('produto composto também oferece bebida simples, com preço atualizado pelo cadastro da bebida', async (t) => {
  const f = fixture(t);
  const pao = await createProdutoHandler(context({ ...insumoBase, nome: 'Pão' }), f.a);
  const bebida = await createProdutoHandler(context({ ...simplesBase, nome: 'Suco', preco: 6 }), f.a);
  const lanche = await createProdutoHandler(context({
    nome: 'Lanche', tipo: 'composto', preco: 20,
    ingredientes: [{ insumo_id: pao.data.id, quantidade: 1, unidade: 'UN' }],
    acrescimos: [{ insumo_id: bebida.data.id }],
  }), f.a);
  assert.equal(lanche.status, 201);
  await updateProdutoHandler(context({ ...simplesBase, nome: 'Suco', preco: 8 }, { id: String(bebida.data.id) }), f.a);
  const produtos = (await listProdutosHandler(context(), f.a)).data;
  assert.equal(produtos.find((p) => p.id === lanche.data.id).acrescimos[0].valor, 8);
  assert.equal(f.DB.prepare('SELECT valor FROM produto_acrescimos WHERE insumo_id=?').bind(bebida.data.id).first().valor, 8);
});

test('delivery aceita bebida simples como adicional e bloqueia opção que ficou sem preço ou inativa', async (t) => {
  const f = fixture(t);
  const bebida = await createProdutoHandler(context({ ...simplesBase, nome: 'Refrigerante', preco: 6 }), f.a);
  const prato = await createProdutoHandler(context({ ...simplesBase, nome: 'Prato', preco: 25 }), f.a);
  await updateOnlineStoreHandler(context({ slug: 'prato-bebida', nome: 'Prato e bebida', ativo: true }), f.a);
  const proprio = await upsertOnlineCatalogProductHandler(context({
    produto_id: prato.data.id, opcoes: [{ insumo_id: prato.data.id, tipo: 'adicional' }],
  }), f.a);
  assert.equal(proprio.status, 400);
  const catalogo = await upsertOnlineCatalogProductHandler(context({
    produto_id: prato.data.id, opcoes: [{ insumo_id: bebida.data.id, nome: 'Nome enviado', tipo: 'adicional', preco_adicional: 1 }],
  }), f.a);
  assert.equal(catalogo.status, 201);
  assert.equal(catalogo.data.opcoes[0].nome, 'Refrigerante');
  assert.equal(catalogo.data.opcoes[0].preco_adicional, 6);
  await updateProdutoHandler(context({ ...simplesBase, nome: 'Refrigerante', preco: 7 }, { id: String(bebida.data.id) }), f.a);
  const menu = await getPublicStoreHandler(context({}, { slug: 'prato-bebida' }), { DB: f.DB });
  assert.equal(menu.data.produtos[0].opcoes[0].preco_adicional, 7);
  const body = {
    chave: 'simples-bebida-delivery-01', cliente_nome: 'Ana', telefone: '11999990000', tipo_entrega: 'retirada', forma_pagamento: 'dinheiro',
    itens: [{ cardapio_produto_id: catalogo.data.id, quantidade: 2, opcoes_ids: [catalogo.data.opcoes[0].id], preco_unitario_esperado: 32 }],
  };
  const pedido = await createPublicOrderHandler(context(body, { slug: 'prato-bebida' }), { DB: f.DB });
  assert.equal(pedido.status, 201);
  assert.equal(pedido.data.total, 64);
  assert.match(f.DB.prepare('SELECT observacao FROM comanda_itens').first().observacao, /Adicionar: Refrigerante/);
  for (const patch of [{ preco: null }, { preco: 7, ativo: false }]) {
    await updateProdutoHandler(context({ ...simplesBase, nome: 'Refrigerante', ...patch }, { id: String(bebida.data.id) }), f.a);
    const atualizado = await getPublicStoreHandler(context({}, { slug: 'prato-bebida' }), { DB: f.DB });
    assert.deepEqual(atualizado.data.produtos[0].opcoes, []);
    const recusado = await createPublicOrderHandler(context({ ...body, chave: 'simples-bebida-delivery-02' }, { slug: 'prato-bebida' }), { DB: f.DB });
    assert.equal(recusado.status, 409);
  }
  assert.equal(f.DB.prepare('SELECT COUNT(*) AS n FROM pedidos_online').first().n, 1);
});
