import test from 'node:test';
import assert from 'node:assert/strict';
import SqliteDb from '../server/sqlite-db.js';
import { TenantDb } from '../shared/tenant-db.js';
import { createProdutoHandler } from '../shared/handlers-catalog.js';
import { criarVendaHandler, fecharComandaHandler } from '../shared/handlers-vendas.js';
import { createPublicOrderHandler, getPublicStoreHandler, updateOnlineStoreHandler, upsertOnlineCatalogProductHandler } from '../shared/handlers-online.js';

const req = (body = {}, params = {}) => ({ params, user: { id: 1, nome: 'Atendente' }, req: { json: async () => body, header: () => '', query: () => '' }, json: (data, status = 200) => ({ data, status }) });

function fixture(t) {
  const raw = new SqliteDb(':memory:');
  t.after(() => raw.close());
  raw.prepare("INSERT INTO estabelecimentos (id,nome,ativo) VALUES (1,'Esfiharia',1),(2,'Outra',1)").run();
  raw.prepare(`INSERT INTO produtos (id,estabelecimento_id,nome,codigo_interno,tipo,preco,custo,estoque_atual,ativo,sem_vencimento,exibir_mercado,exibir_restaurante) VALUES
    (1,1,'Esfiha de carne','E1','produto',8,2,20,1,1,1,1),
    (2,1,'Esfiha de queijo','E2','produto',8,2,20,1,1,1,1),
    (3,1,'Refrigerante lata','R1','produto',7,3,10,1,1,1,1),
    (4,1,'Batata','B1','produto',9,3,10,1,1,1,1),
    (5,1,'Lanche','L1','composto',20,5,0,1,1,1,1),
    (6,1,'Pão','P1','insumo',1,1,10,1,1,0,0),
    (7,2,'Produto alheio','A1','produto',9,2,10,1,1,1,1)`).run();
  raw.prepare("INSERT INTO ficha_tecnica (estabelecimento_id,produto_id,insumo_id,quantidade,unidade) VALUES (1,5,6,1,'UN')").run();
  const admin = { DB: new TenantDb(raw, 1), rawDB: raw, estabelecimentoId: 1 };
  const grupos = [
    { nome: 'Esfihas', quantidade: 2, opcoes: [{ produto_id: 1, adicional: 0 }, { produto_id: 2, adicional: 1 }] },
    { nome: 'Bebida', quantidade: 1, opcoes: [{ produto_id: 3, adicional: 0 }] },
    { nome: 'Acompanhamento', quantidade: 1, opcoes: [{ produto_id: 4, adicional: 0 }] },
    { nome: 'Lanche', quantidade: 1, opcoes: [{ produto_id: 5, adicional: 5 }] },
  ];
  return { raw, admin, grupos };
}

test('combo cadastrado valida produtos, cobra escolhas e baixa estoque no PDV', async (t) => {
  const f = fixture(t);
  await assert.rejects(createProdutoHandler(req({ nome: 'Inválido', tipo: 'combo', preco: 50, combo_grupos: [{ nome: 'Outro', quantidade: 1, opcoes: [{ produto_id: 7 }] }] }), f.admin), /produtos simples ou compostos ativos/);
  const criado = await createProdutoHandler(req({ nome: 'Combo 2 esfihas', tipo: 'combo', preco: 50, exibir_mercado: true, exibir_restaurante: true, combo_grupos: f.grupos }), f.admin);
  assert.equal(criado.status, 201);
  assert.equal(criado.data.tipo, 'combo');
  const escolhas = [[1, 2], [3], [4], [5]];
  const venda = await criarVendaHandler(req({ itens: [{ produto_id: criado.data.id, quantidade: 1, combo_escolhas: escolhas }], forma: 'dinheiro' }), f.admin);
  assert.equal(venda.status, 201);
  assert.equal(venda.data.total, 56);
  assert.equal(f.raw.prepare('SELECT estoque_atual FROM produtos WHERE id=1').first().estoque_atual, 19);
  assert.equal(f.raw.prepare('SELECT estoque_atual FROM produtos WHERE id=2').first().estoque_atual, 19);
  assert.equal(f.raw.prepare('SELECT estoque_atual FROM produtos WHERE id=6').first().estoque_atual, 9);
  assert.deepEqual(JSON.parse(f.raw.prepare('SELECT combo_escolhas_json FROM venda_itens').first().combo_escolhas_json), escolhas);
});

test('cliente monta combo no delivery e escolhas chegam à comanda e ao fechamento', async (t) => {
  const f = fixture(t);
  const criado = await createProdutoHandler(req({ nome: 'Combo família', tipo: 'combo', preco: 50, exibir_restaurante: true, combo_grupos: f.grupos }), f.admin);
  await updateOnlineStoreHandler(req({ nome: 'Esfiharia', ativo: 1 }), f.admin);
  const publicado = await upsertOnlineCatalogProductHandler(req({ produto_id: criado.data.id, preco: 52 }), f.admin);
  assert.equal(publicado.status, 201);
  const slug = f.raw.prepare('SELECT slug FROM lojas_online WHERE estabelecimento_id=1').first().slug;
  const menu = await getPublicStoreHandler(req({}, { slug }), { DB: f.raw });
  assert.equal(menu.data.produtos[0].combo_grupos[0].opcoes[0].nome, 'Esfiha de carne');
  const escolhas = [[1, 1], [3], [4], [5]];
  const pedido = await createPublicOrderHandler(req({ chave: 'combo-delivery-0001', cliente_nome: 'Ana', telefone: '11999990000', tipo_entrega: 'retirada', forma_pagamento: 'dinheiro', itens: [{ cardapio_produto_id: publicado.data.id, quantidade: 1, combo_escolhas: escolhas, preco_unitario_esperado: 57 }] }, { slug }), { DB: f.raw });
  assert.equal(pedido.status, 201);
  assert.equal(pedido.data.total, 57);
  assert.deepEqual(JSON.parse(f.raw.prepare('SELECT combo_escolhas_json FROM comanda_itens').first().combo_escolhas_json), escolhas);
  const fechado = await fecharComandaHandler(req({ taxa_garcom_pct: 0 }, { id: String(pedido.data.comanda_id) }), f.admin);
  assert.equal(fechado.status, 200);
  assert.equal(f.raw.prepare('SELECT estoque_atual FROM produtos WHERE id=1').first().estoque_atual, 18);
  assert.equal(f.raw.prepare('SELECT estoque_atual FROM produtos WHERE id=3').first().estoque_atual, 9);
  assert.equal(f.raw.prepare('SELECT estoque_atual FROM produtos WHERE id=6').first().estoque_atual, 9);
});

test('venda de múltiplos combos valida o estoque somado antes de gravar', async (t) => {
  const f = fixture(t);
  const criado = await createProdutoHandler(req({ nome: 'Combo', tipo: 'combo', preco: 50, exibir_mercado: true, combo_grupos: f.grupos }), f.admin);
  const escolha = [[1, 1], [3], [4], [5]];
  const resultado = await criarVendaHandler(req({ itens: [
    { produto_id: criado.data.id, quantidade: 6, combo_escolhas: escolha },
    { produto_id: criado.data.id, quantidade: 6, combo_escolhas: escolha },
  ], forma: 'dinheiro' }), f.admin);
  assert.equal(resultado.status, 400);
  assert.match(resultado.data.error, /Estoque insuficiente/);
  assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM vendas').first().n, 0);
  assert.equal(f.raw.prepare('SELECT estoque_atual FROM produtos WHERE id=3').first().estoque_atual, 10);
});
