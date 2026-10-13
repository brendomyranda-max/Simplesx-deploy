import assert from 'node:assert/strict';
import test from 'node:test';
import SqliteDb from '../server/sqlite-db.js';
import { TenantDb } from '../shared/tenant-db.js';
import {
  createPublicOrderHandler, getPublicStoreHandler, listPublicStoresHandler,
  updateOnlineCatalogProductHandler, updateOnlineStoreHandler, upsertOnlineCatalogProductHandler,
} from '../shared/handlers-online.js';

function context(body = {}, params = {}, query = {}) {
  return { params, req: { json: async () => body, header: () => '', query: (key) => query[key] || '' }, json: (data, status = 200) => ({ data, status }) };
}

test('promoção mostra preço anterior, filtra a vitrine e cobra o desconto no pedido', async (t) => {
  const raw = new SqliteDb(':memory:');
  t.after(() => raw.close());
  raw.prepare("INSERT INTO estabelecimentos (id,nome,ativo) VALUES (1,'Brasa',1)").run();
  raw.prepare("INSERT INTO produtos (id,estabelecimento_id,nome,codigo_interno,preco,ativo,tipo,sem_vencimento,criado_em) VALUES (10,1,'Smash','SMASH',30,1,'produto',1,'2026-10-13')").run();
  const admin = { DB: new TenantDb(raw, 1), rawDB: raw, estabelecimentoId: 1 };
  const publico = { DB: raw };
  await updateOnlineStoreHandler(context({ nome: 'Brasa', ativo: 1 }), admin);

  const criado = await upsertOnlineCatalogProductHandler(context({
    produto_id: 10, preco: 30, preco_promocional: 24.9,
    opcoes: [{ nome: 'Bacon', tipo: 'adicional', preco_adicional: 5 }],
  }), admin);
  assert.equal(criado.status, 201);
  assert.equal(criado.data.preco, 30);
  assert.equal(criado.data.preco_promocional, 24.9);

  const loja = await getPublicStoreHandler(context({}, { slug: 'brasa' }), publico);
  assert.equal(loja.data.produtos[0].preco, 30);
  assert.equal(loja.data.produtos[0].preco_promocional, 24.9);
  const emPromocao = await listPublicStoresHandler(context({}, {}, { categoria: 'promocao' }), publico);
  assert.deepEqual(emPromocao.data.lojas.map((item) => item.slug), ['brasa']);
  assert.equal(emPromocao.data.lojas[0].segmentos.includes('Promoção'), true);

  const pedido = await createPublicOrderHandler(context({
    chave: 'pedido-promocao-0001', cliente_nome: 'Ana', telefone: '11999990000',
    tipo_entrega: 'retirada', forma_pagamento: 'dinheiro',
    itens: [{ cardapio_produto_id: criado.data.id, quantidade: 2, opcoes_ids: [criado.data.opcoes[0].id], preco_unitario_esperado: 29.9 }],
  }, { slug: 'brasa' }), publico);
  assert.equal(pedido.status, 201);
  assert.equal(pedido.data.total, 59.8);
  assert.equal(raw.prepare('SELECT preco_unitario FROM pedidos_online_itens').first().preco_unitario, 29.9);

  await assert.rejects(
    updateOnlineCatalogProductHandler(context({ preco_promocional: 30 }, { id: String(criado.data.id) }), admin),
    /preço promocional deve ser menor/i,
  );
  const semPromocao = await updateOnlineCatalogProductHandler(context({ preco_promocional: null }, { id: String(criado.data.id) }), admin);
  assert.equal(semPromocao.data.preco_promocional, null);
  assert.equal((await listPublicStoresHandler(context({}, {}, { categoria: 'promocao' }), publico)).data.lojas.length, 0);
  assert.equal(raw.prepare('SELECT preco_unitario FROM pedidos_online_itens').first().preco_unitario, 29.9, 'pedido anterior conserva o preço cobrado');
  await assert.rejects(
    createPublicOrderHandler(context({
      chave: 'pedido-promocao-0002', cliente_nome: 'Ana', telefone: '11999990000',
      tipo_entrega: 'retirada', forma_pagamento: 'dinheiro',
      itens: [{ cardapio_produto_id: criado.data.id, quantidade: 1, preco_unitario_esperado: 24.9 }],
    }, { slug: 'brasa' }), publico),
    /preço de um produto mudou/i,
    'uma oferta encerrada não pode cobrar um preço maior sem avisar o cliente',
  );
  assert.equal(raw.prepare('SELECT COUNT(*) AS total FROM pedidos_online').first().total, 1);
});
