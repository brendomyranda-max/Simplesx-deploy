import assert from 'node:assert/strict';
import test from 'node:test';
import SqliteDb from '../server/sqlite-db.js';
import { TenantDb } from '../shared/tenant-db.js';
import { imprimirEtiquetaPedidoHandler } from '../shared/handlers-cadastros.js';
import {
  atualizarPedidoOnlineHandler,
  createOnlineOnlyProductHandler,
  createPublicOrderHandler,
  painelPedidosHandler,
  updateOnlineStoreHandler,
  upsertOnlineCatalogProductHandler,
} from '../shared/handlers-online.js';

function context(body = {}, params = {}, query = {}) {
  return {
    params,
    user: { id: 1 },
    req: { json: async () => body, header: () => '', query: (key) => query[key] || '' },
    json: (data, status = 200) => ({ data, status }),
  };
}

test('delivery só usa estoque e o painel separa salão, delivery e prioridade', async (t) => {
  const raw = new SqliteDb(':memory:');
  t.after(() => raw.close());
  raw.prepare("INSERT INTO estabelecimentos (id,nome,ativo) VALUES (1,'Brasa e Pão',1)").run();
  raw.prepare(`INSERT INTO produtos (id,estabelecimento_id,nome,codigo_interno,preco,ativo,exibir_restaurante,tipo,sem_vencimento,criado_em)
    VALUES (10,1,'Smash da Casa','SMASH-01',29.9,1,1,'produto',1,'2026-10-07T00:00:00.000Z')`).run();
  raw.prepare(`INSERT INTO produtos (id,estabelecimento_id,nome,codigo_interno,preco,ativo,exibir_restaurante,tipo,sem_vencimento,criado_em)
    VALUES (11,1,'Pão','PAO',2,1,0,'insumo',1,'2026-10-07T00:00:00.000Z')`).run();
  raw.prepare(`INSERT INTO mesas (id,estabelecimento_id,numero,nome,capacidade,setor,status,ativo,criado_em,tipo)
    VALUES (2,1,4,'Mesa 4',4,'Salao','ocupada',1,'2026-10-09T10:00:00.000Z','normal')`).run();
  raw.prepare(`INSERT INTO comandas (id,estabelecimento_id,mesa_id,cliente_nome,garcom_nome,status,taxa_garcom_pct,pessoas_count,criado_em)
    VALUES (2,1,2,'Cliente mesa','Ana','aberta',0,1,'2026-10-09T10:00:00.000Z')`).run();
  raw.prepare(`INSERT INTO comanda_itens (id,estabelecimento_id,comanda_id,produto_id,nome,quantidade,preco_unitario,status,criado_em)
    VALUES (1,1,2,10,'Suco',1,8,'novo','2026-10-09T10:00:00.000Z')`).run();

  const adminEnv = { DB: new TenantDb(raw, 1), rawDB: raw, estabelecimentoId: 1 };
  const exclusivo = await createOnlineOnlyProductHandler(context({ nome: 'Combo', preco: 10 }), adminEnv);
  assert.equal(exclusivo.status, 400);
  const insumo = await upsertOnlineCatalogProductHandler(context({ produto_id: 11, preco: 3 }), adminEnv);
  assert.equal(insumo.status, 400);

  await updateOnlineStoreHandler(context({ slug: 'brasa-pao', nome: 'Brasa & Pão', ativo: true, taxa_entrega: 5 }), adminEnv);
  const publicado = await upsertOnlineCatalogProductHandler(context({ produto_id: 10, preco: 31.9 }), adminEnv);
  assert.equal(publicado.status, 201);

  const pedido = await createPublicOrderHandler(context({
    chave: 'pedido-publico-0002',
    cliente_nome: 'Ana Souza',
    telefone: '11999990000',
    tipo_entrega: 'entrega',
    endereco: 'Rua das Flores, 123',
    forma_pagamento: 'dinheiro',
    itens: [{ cardapio_produto_id: publicado.data.id, quantidade: 1 }],
  }, { slug: 'brasa-pao' }), { DB: raw });
  assert.equal(pedido.status, 201);

  const painel = await painelPedidosHandler(context(), adminEnv);
  assert.equal(painel.status, 200);
  assert.equal(painel.data.delivery.length, 1);
  assert.equal(painel.data.delivery[0].cliente_nome, 'Ana Souza');
  assert.equal(painel.data.restaurante.length, 1);
  assert.equal(painel.data.restaurante[0].mesa_numero, 4);
  assert.equal(painel.data.prioridade[0].nome, 'Suco');
  assert.equal(painel.data.prioridade[0].canal, 'restaurante');
  assert.equal(painel.data.prioridade[0].posicao, 1);
  assert.equal(painel.data.prioridade.at(-1).canal, 'delivery');

  const etiqueta = await imprimirEtiquetaPedidoHandler(context({ item_id: 1 }), adminEnv);
  assert.equal(etiqueta.status, 200);
  assert.match(etiqueta.data.impressao, /PRIORIDADE 1/);
  assert.match(etiqueta.data.impressao, /MESA 4/);
  assert.match(etiqueta.data.impressao, /Suco/);

  const confirmado = await atualizarPedidoOnlineHandler(context({ status: 'confirmado' }, { id: String(painel.data.delivery[0].id) }), adminEnv);
  assert.equal(confirmado.status, 200);
  const depois = await painelPedidosHandler(context(), adminEnv);
  assert.equal(depois.data.delivery[0].status, 'confirmado');
  assert.equal(depois.data.delivery[0].etapa, 'preparando');

  const cancelado = await atualizarPedidoOnlineHandler(context({ status: 'cancelado' }, { id: String(painel.data.delivery[0].id) }), adminEnv);
  assert.equal(cancelado.status, 200);
  const vazio = await painelPedidosHandler(context(), adminEnv);
  assert.equal(vazio.data.delivery.length, 0);
  assert.equal(vazio.data.prioridade.some((item) => item.canal === 'delivery'), false);
});
