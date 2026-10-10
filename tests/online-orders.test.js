import assert from 'node:assert/strict';
import test from 'node:test';
import SqliteDb from '../server/sqlite-db.js';
import { TenantDb } from '../shared/tenant-db.js';
import {
  atualizarPedidoOnlineHandler,
  createPublicOrderHandler,
  getPublicOrderHandler,
  getPublicStoreHandler,
  addMenuCategoryHandler,
  listOnlineCatalogHandler,
  organizeMenuHandler,
  removeMenuCategoryHandler,
  removeOnlineCatalogProductHandler,
  updateOnlineCatalogProductHandler,
  updateOnlineStoreHandler,
  upsertOnlineCatalogProductHandler,
} from '../shared/handlers-online.js';

function context(body = {}, params = {}, query = {}) {
  return {
    params,
    req: { json: async () => body, header: () => '', query: (key) => query[key] || '' },
    json: (data, status = 200) => ({ data, status }),
  };
}

test('catálogo online público cria uma comanda de delivery com preço e adicionais corretos', async (t) => {
  const raw = new SqliteDb(':memory:');
  t.after(() => raw.close());
  raw.prepare("INSERT INTO estabelecimentos (id,nome,ativo) VALUES (1,'Brasa e Pão',1)").run();
  raw.prepare(`INSERT INTO produtos (id,estabelecimento_id,nome,codigo_interno,preco,ativo,exibir_restaurante,exibir_mercado,tipo,sem_vencimento,criado_em)
    VALUES (10,1,'Smash da Casa','SMASH-01',29.9,1,1,0,'produto',1,'2026-10-07T00:00:00.000Z')`).run();
  const adminEnv = { DB: new TenantDb(raw, 1), rawDB: raw, estabelecimentoId: 1 };

  const store = await updateOnlineStoreHandler(context({ slug: 'brasa-pao', nome: 'Brasa & Pão', ativo: true, taxa_entrega: 5.9 }), adminEnv);
  assert.equal(store.status, 200);
  const registered = await upsertOnlineCatalogProductHandler(context({
    produto_id: 10,
    descricao: 'Pão, carne e cheddar.',
    preco: 31.9,
    opcoes: [
      { nome: 'Cebola roxa', tipo: 'removivel' },
      { nome: 'Bacon crocante', tipo: 'adicional', preco_adicional: 5 },
    ],
  }), adminEnv);
  assert.equal(registered.status, 201);
  assert.equal(registered.data.opcoes.length, 2);

  const publicEnv = { DB: raw };
  const menu = await getPublicStoreHandler(context({}, { slug: 'brasa-pao' }), publicEnv);
  assert.equal(menu.status, 200);
  assert.equal(menu.data.produtos.length, 1);
  assert.equal(menu.data.produtos[0].preco, 31.9);

  const bacon = menu.data.produtos[0].opcoes.find((option) => option.nome === 'Bacon crocante');
  const withoutOnion = menu.data.produtos[0].opcoes.find((option) => option.nome === 'Cebola roxa');
  const order = await createPublicOrderHandler(context({
    chave: 'pedido-publico-0001',
    cliente_nome: 'Ana Souza',
    telefone: '11999990000',
    tipo_entrega: 'entrega',
    endereco: 'Rua das Flores, 123',
    forma_pagamento: 'dinheiro',
    itens: [{ cardapio_produto_id: menu.data.produtos[0].id, quantidade: 2, opcoes_ids: [bacon.id, withoutOnion.id], observacao: 'Bem passado' }],
  }, { slug: 'brasa-pao' }), publicEnv);

  assert.equal(order.status, 201);
  assert.equal(order.data.total, 79.7);
  const saved = raw.prepare('SELECT * FROM pedidos_online').first();
  assert.equal(saved.comanda_id, order.data.comanda_id);
  assert.equal(saved.subtotal, 73.8);
  assert.equal(saved.taxa_entrega, 5.9);
  const mesa = raw.prepare('SELECT * FROM mesas WHERE id=?').first(saved.mesa_id);
  assert.equal(mesa.tipo, 'online');
  assert.match(mesa.nome, /Pedido online/);
  const item = raw.prepare('SELECT * FROM comanda_itens WHERE comanda_id=?').first(saved.comanda_id);
  assert.equal(item.quantidade, 2);
  assert.equal(item.preco_unitario, 36.9);
  assert.match(item.observacao, /Sem: Cebola roxa/);
  assert.match(item.observacao, /Adicionar: Bacon crocante/);

  const repeat = await createPublicOrderHandler(context({
    chave: 'pedido-publico-0001', cliente_nome: 'Ana Souza', telefone: '11999990000', tipo_entrega: 'entrega', endereco: 'Rua das Flores, 123', forma_pagamento: 'dinheiro',
    itens: [{ cardapio_produto_id: menu.data.produtos[0].id, quantidade: 2, opcoes_ids: [bacon.id] }],
  }, { slug: 'brasa-pao' }), publicEnv);
  assert.equal(repeat.status, 200);
  assert.equal(repeat.data.repetido, true);
  assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM pedidos_online').first().count, 1);
  assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM comanda_itens').first().count, 1);

  raw.prepare(`INSERT INTO produtos (id,estabelecimento_id,nome,codigo_interno,preco,ativo,exibir_restaurante,exibir_mercado,tipo,sem_vencimento,criado_em)
    VALUES (11,1,'Caldo inventado','CALDO',4,1,0,0,'insumo',1,'2026-10-07T00:00:00.000Z')`).run();
  raw.prepare(`INSERT INTO cardapio_online_produtos (estabelecimento_id,produto_id,nome_exibicao,preco,disponivel,ativo,ordem,criado_em)
    VALUES (1,11,'Caldo inventado',4,1,1,0,'2026-10-07T00:00:00.000Z')`).run();
  const filtrado = await getPublicStoreHandler(context({}, { slug: 'brasa-pao' }), publicEnv);
  assert.equal(filtrado.data.produtos.length, 1);
  assert.equal(filtrado.data.produtos[0].nome, 'Smash da Casa');

  const foto = `data:image/jpeg;base64,${'A'.repeat(80)}`;
  const comFoto = await updateOnlineCatalogProductHandler(context({ foto_url: foto }, { id: menu.data.produtos[0].id }), adminEnv);
  assert.equal(comFoto.status, 200);
  assert.equal(comFoto.data.foto_url, foto);
  await assert.rejects(
    () => updateOnlineCatalogProductHandler(context({ foto_url: `data:image/jpeg;base64,${'A'.repeat(300000)}` }, { id: menu.data.produtos[0].id }), adminEnv),
    (error) => error.status === 400,
  );
});

function bancoComoD1(raw) {
  return {
    prepare(sql) {
      const stmt = raw.prepare(sql);
      const bind = stmt.bind.bind(stmt);
      stmt.bind = (...params) => {
        if (params.some((value) => value === undefined)) {
          const error = new Error('D1 rejeita undefined');
          error.status = 500;
          throw error;
        }
        return bind(...params);
      };
      return stmt;
    },
    batch(statements) { return raw.batch(statements); },
  };
}

test('publicar produto do estoque não gera erro interno no D1', async (t) => {
  const raw = new SqliteDb(':memory:');
  t.after(() => raw.close());
  raw.prepare("INSERT INTO estabelecimentos (id,nome,ativo) VALUES (1,'Brasa e Pão',1)").run();
  raw.prepare(`INSERT INTO produtos (id,estabelecimento_id,nome,codigo_interno,preco,ativo,exibir_restaurante,exibir_mercado,tipo,sem_vencimento,criado_em)
    VALUES (10,1,'Pão na chapa','PAO',8,1,1,0,'produto',1,'2026-10-07T00:00:00.000Z')`).run();
  const adminEnv = { DB: new TenantDb(bancoComoD1(raw), 1), rawDB: raw, estabelecimentoId: 1 };
  await updateOnlineStoreHandler(context({ slug: 'brasa-pao', nome: 'Brasa & Pão', ativo: true }), adminEnv);
  const publicado = await upsertOnlineCatalogProductHandler(context({ produto_id: 10, preco: 8, descricao: '', disponivel: 1, ativo: 1 }), adminEnv);
  assert.equal(publicado.status, 201);
  assert.equal(publicado.data.nome, 'Pão na chapa');
  const pausa = await updateOnlineCatalogProductHandler(context({ disponivel: 0 }, { id: publicado.data.id }), adminEnv);
  assert.equal(pausa.status, 200);
  assert.equal(pausa.data.disponivel, 0);
});

test('cliente acompanha só o pedido da própria loja', async (t) => {
  const raw = new SqliteDb(':memory:');
  t.after(() => raw.close());
  raw.prepare("INSERT INTO estabelecimentos (id,nome,ativo,cnpj) VALUES (1,'Brasa e Pão',1,'11111111000111')").run();
  raw.prepare("INSERT INTO estabelecimentos (id,nome,ativo,cnpj) VALUES (2,'Outra Casa',1,'22222222000122')").run();
  raw.prepare(`INSERT INTO produtos (id,estabelecimento_id,nome,codigo_interno,preco,ativo,exibir_restaurante,exibir_mercado,tipo,sem_vencimento,criado_em)
    VALUES (10,1,'Pão na chapa','PAO',8,1,1,0,'produto',1,'2026-10-07T00:00:00.000Z')`).run();
  const adminEnv = { DB: new TenantDb(raw, 1), rawDB: raw, estabelecimentoId: 1 };
  const outraEnv = { DB: new TenantDb(raw, 2), rawDB: raw, estabelecimentoId: 2 };
  await updateOnlineStoreHandler(context({ slug: 'brasa-pao', nome: 'Brasa & Pão', ativo: true }), adminEnv);
  await updateOnlineStoreHandler(context({ slug: 'outra-casa', nome: 'Outra Casa', ativo: true }), outraEnv);
  const publicado = await upsertOnlineCatalogProductHandler(context({ produto_id: 10, preco: 8 }), adminEnv);
  const publicEnv = { DB: raw };
  const pedido = await createPublicOrderHandler(context({
    chave: 'pedido-publico-0003',
    cliente_nome: 'Ana Souza',
    telefone: '11999990000',
    tipo_entrega: 'entrega',
    endereco: 'Rua das Flores, 123',
    forma_pagamento: 'dinheiro',
    itens: [{ cardapio_produto_id: publicado.data.id, quantidade: 1 }],
  }, { slug: 'brasa-pao' }), publicEnv);
  assert.equal(pedido.status, 201);

  const recebido = await getPublicOrderHandler(context({}, { slug: 'brasa-pao', chave: 'pedido-publico-0003' }), publicEnv);
  assert.equal(recebido.status, 200);
  assert.equal(recebido.data.etapa, 'recebido');
  assert.equal(recebido.data.itens[0].nome, 'Pão na chapa');
  assert.equal(recebido.data.telefone, undefined);
  assert.equal(recebido.data.endereco, undefined);

  const outraLoja = await getPublicOrderHandler(context({}, { slug: 'outra-casa', chave: 'pedido-publico-0003' }), publicEnv);
  assert.equal(outraLoja.status, 404);
  const chaveCurta = await getPublicOrderHandler(context({}, { slug: 'brasa-pao', chave: 'curta' }), publicEnv);
  assert.equal(chaveCurta.status, 404);

  const cedo = await atualizarPedidoOnlineHandler(context({ status: 'saiu_entrega' }, { id: String(pedido.data.id) }), adminEnv);
  assert.equal(cedo.status, 409);
  const retiradaErrada = await atualizarPedidoOnlineHandler(context({ status: 'pronto_retirada' }, { id: String(pedido.data.id) }), adminEnv);
  assert.equal(retiradaErrada.status, 400);

  const confirmado = await atualizarPedidoOnlineHandler(context({ status: 'confirmado' }, { id: String(pedido.data.id) }), adminEnv);
  assert.equal(confirmado.status, 200);
  assert.equal(confirmado.data.status, 'confirmado');
  assert.equal(confirmado.data.etapa, 'preparando');
  const preparando = await getPublicOrderHandler(context({}, { slug: 'brasa-pao', chave: 'pedido-publico-0003' }), publicEnv);
  assert.equal(preparando.data.etapa, 'preparando');

  const saiu = await atualizarPedidoOnlineHandler(context({ status: 'saiu_entrega' }, { id: String(pedido.data.id) }), adminEnv);
  assert.equal(saiu.status, 200);
  assert.equal(saiu.data.status, 'confirmado');
  const aCaminho = await getPublicOrderHandler(context({}, { slug: 'brasa-pao', chave: 'pedido-publico-0003' }), publicEnv);
  assert.equal(aCaminho.data.etapa, 'saiu_entrega');

  const entregue = await atualizarPedidoOnlineHandler(context({ status: 'entregue' }, { id: String(pedido.data.id) }), adminEnv);
  assert.equal(entregue.data.etapa, 'entregue');
  assert.equal(entregue.data.status, 'confirmado');
  const concluido = await getPublicOrderHandler(context({}, { slug: 'brasa-pao', chave: 'pedido-publico-0003' }), publicEnv);
  assert.equal(concluido.data.etapa, 'entregue');
  const comanda = raw.prepare('SELECT status FROM comandas WHERE id=?').first(pedido.data.comanda_id);
  assert.equal(comanda.status, 'aberta');

  const cancelado = await atualizarPedidoOnlineHandler(context({ status: 'cancelado' }, { id: String(pedido.data.id) }), adminEnv);
  assert.equal(cancelado.status, 409);

  const retirada = await createPublicOrderHandler(context({
    chave: 'pedido-publico-0004',
    cliente_nome: 'Bruno',
    telefone: '11988880000',
    tipo_entrega: 'retirada',
    forma_pagamento: 'dinheiro',
    itens: [{ cardapio_produto_id: publicado.data.id, quantidade: 1 }],
  }, { slug: 'brasa-pao' }), publicEnv);
  await atualizarPedidoOnlineHandler(context({ status: 'confirmado' }, { id: String(retirada.data.id) }), adminEnv);
  const naoSai = await atualizarPedidoOnlineHandler(context({ status: 'saiu_entrega' }, { id: String(retirada.data.id) }), adminEnv);
  assert.equal(naoSai.status, 400);
  const pronto = await atualizarPedidoOnlineHandler(context({ status: 'pronto_retirada' }, { id: String(retirada.data.id) }), adminEnv);
  assert.equal(pronto.data.etapa, 'pronto_retirada');
  const noBalcao = await getPublicOrderHandler(context({}, { slug: 'brasa-pao', chave: 'pedido-publico-0004' }), publicEnv);
  assert.equal(noBalcao.data.etapa, 'pronto_retirada');
  const cancelar = await atualizarPedidoOnlineHandler(context({ status: 'cancelado' }, { id: String(retirada.data.id) }), adminEnv);
  assert.equal(cancelar.data.etapa, 'cancelado');
  const canceladoCliente = await getPublicOrderHandler(context({}, { slug: 'brasa-pao', chave: 'pedido-publico-0004' }), publicEnv);
  assert.equal(canceladoCliente.data.etapa, 'cancelado');
  const fechada = raw.prepare('SELECT status FROM comandas WHERE id=?').first(retirada.data.comanda_id);
  assert.equal(fechada.status, 'fechada');
});

test('cardápio público soma os mais vendidos da própria loja', async (t) => {
  const raw = new SqliteDb(':memory:');
  t.after(() => raw.close());
  raw.prepare("INSERT INTO estabelecimentos (id,nome,ativo,cnpj) VALUES (1,'Brasa e Pão',1,'11111111000111')").run();
  raw.prepare("INSERT INTO estabelecimentos (id,nome,ativo,cnpj) VALUES (2,'Outra Casa',1,'22222222000122')").run();
  raw.prepare(`INSERT INTO categorias (id,estabelecimento_id,nome) VALUES (1,1,'Lanches'),(2,1,'Bebidas'),(3,2,'Lanches')`).run();
  raw.prepare(`INSERT INTO produtos (id,estabelecimento_id,nome,codigo_interno,preco,ativo,exibir_restaurante,exibir_mercado,tipo,sem_vencimento,criado_em) VALUES
    (10,1,'X-Burger','XB',20,1,1,0,'produto',1,'2026-10-09T00:00:00.000Z'),
    (11,1,'Suco','SUCO',8,1,1,0,'produto',1,'2026-10-09T00:00:00.000Z'),
    (12,1,'Água','AGUA',4,1,1,0,'produto',1,'2026-10-09T00:00:00.000Z'),
    (13,2,'X-Burger da outra','XB2',20,1,1,0,'produto',1,'2026-10-09T00:00:00.000Z')`).run();
  const adminEnv = { DB: new TenantDb(raw, 1), rawDB: raw, estabelecimentoId: 1 };
  const outraEnv = { DB: new TenantDb(raw, 2), rawDB: raw, estabelecimentoId: 2 };
  await updateOnlineStoreHandler(context({ slug: 'brasa-pao', nome: 'Brasa & Pão', ativo: true }), adminEnv);
  await updateOnlineStoreHandler(context({ slug: 'outra-casa', nome: 'Outra Casa', ativo: true }), outraEnv);
  const burger = await upsertOnlineCatalogProductHandler(context({ produto_id: 10, preco: 20, categoria_id: 1 }), adminEnv);
  const suco = await upsertOnlineCatalogProductHandler(context({ produto_id: 11, preco: 8, categoria_id: 2 }), adminEnv);
  const agua = await upsertOnlineCatalogProductHandler(context({ produto_id: 12, preco: 4, categoria_id: 2 }), adminEnv);
  const outra = await upsertOnlineCatalogProductHandler(context({ produto_id: 13, preco: 20, categoria_id: 3 }), outraEnv);
  assert.equal(burger.status, 201);
  assert.equal(suco.status, 201);
  const publicEnv = { DB: raw };
  const pedido = (slug, chave, itens) => createPublicOrderHandler(context({
    chave,
    cliente_nome: 'Ana Souza',
    telefone: '11999990000',
    tipo_entrega: 'entrega',
    endereco: 'Rua das Flores, 123',
    forma_pagamento: 'dinheiro',
    itens,
  }, { slug }), publicEnv);
  const vendido = await pedido('brasa-pao', 'pedido-vendidos-0001', [
    { cardapio_produto_id: burger.data.id, quantidade: 3 },
    { cardapio_produto_id: suco.data.id, quantidade: 1 },
  ]);
  assert.equal(vendido.status, 201);
  const cancelavel = await pedido('brasa-pao', 'pedido-vendidos-0002', [
    { cardapio_produto_id: suco.data.id, quantidade: 8 },
  ]);
  assert.equal(cancelavel.status, 201);
  const cancelado = await atualizarPedidoOnlineHandler(context({ status: 'cancelado' }, { id: String(cancelavel.data.id) }), adminEnv);
  assert.equal(cancelado.status, 200);
  const daOutra = await pedido('outra-casa', 'pedido-vendidos-0003', [
    { cardapio_produto_id: outra.data.id, quantidade: 4 },
  ]);
  assert.equal(daOutra.status, 201);

  const menu = await getPublicStoreHandler(context({}, { slug: 'brasa-pao' }), publicEnv);
  const porNome = Object.fromEntries(menu.data.produtos.map((produto) => [produto.nome, produto.vendidos]));
  assert.equal(porNome['X-Burger'], 3);
  assert.equal(porNome.Suco, 1);
  assert.equal(porNome['Água'], 0);
  assert.equal(menu.data.produtos.find((produto) => produto.nome === 'X-Burger da outra'), undefined);
  assert.deepEqual(menu.data.categorias.map((categoria) => categoria.nome), ['Lanches', 'Bebidas']);

  const rede = await getPublicStoreHandler(context({}, { slug: 'outra-casa' }), publicEnv);
  assert.equal(rede.data.produtos.length, 1);
  assert.equal(rede.data.produtos[0].vendidos, 4);

  const gestor = await listOnlineCatalogHandler(context(), adminEnv);
  const contagem = Object.fromEntries(gestor.data.map((produto) => [produto.nome, produto.vendidos]));
  assert.equal(contagem['X-Burger'], 3);
  assert.equal(contagem.Suco, 1);
  assert.equal(contagem['Água'], 0);
  assert.equal(agua.status, 201);
});

test('nome da loja não aceita outro igual nem com maiúsculas diferentes', async (t) => {
  const raw = new SqliteDb(':memory:');
  t.after(() => raw.close());
  raw.prepare("INSERT INTO estabelecimentos (id,nome,ativo) VALUES (1,'Casa Um',1),(2,'Casa Dois',1)").run();
  const um = { DB: new TenantDb(raw, 1), rawDB: raw, estabelecimentoId: 1 };
  const dois = { DB: new TenantDb(raw, 2), rawDB: raw, estabelecimentoId: 2 };
  const primeira = await updateOnlineStoreHandler(context({ slug: 'casa-um', nome: 'Forno da Praça', ativo: true }), um);
  assert.equal(primeira.status, 200);
  const repetido = await updateOnlineStoreHandler(context({ slug: 'casa-dois', nome: '  forno   da   praça  ', ativo: true }), dois);
  assert.equal(repetido.status, 409);
  assert.match(repetido.data.error, /este nome/);
  assert.equal(raw.prepare('SELECT nome FROM lojas_online WHERE estabelecimento_id=2').first().nome, 'Casa Dois');
  const proprio = await updateOnlineStoreHandler(context({ nome: 'FORNO DA PRAÇA' }), um);
  assert.equal(proprio.status, 200);
  assert.equal(proprio.data.nome, 'FORNO DA PRAÇA');
  const outro = await updateOnlineStoreHandler(context({ slug: 'casa-dois', nome: 'Forno da Vila', ativo: true }), dois);
  assert.equal(outro.status, 200);
});

test('produto composto entra no delivery com os ingredientes na descrição', async (t) => {
  const raw = new SqliteDb(':memory:');
  t.after(() => raw.close());
  raw.prepare("INSERT INTO estabelecimentos (id,nome,ativo) VALUES (1,'Brasa e Pão',1)").run();
  raw.prepare(`INSERT INTO produtos (id,estabelecimento_id,nome,codigo_interno,preco,ativo,exibir_restaurante,exibir_mercado,tipo,sem_vencimento,criado_em,observacoes) VALUES
    (20,1,'X-Burger','XB',22,1,1,0,'composto',1,'2026-10-09T00:00:00.000Z','Caprichado no cheddar'),
    (21,1,'Pão','PAO',1,1,0,0,'insumo',1,'2026-10-09T00:00:00.000Z',NULL),
    (22,1,'Carne','CARNE',1,1,0,0,'insumo',1,'2026-10-09T00:00:00.000Z',NULL),
    (23,1,'Queijo','QUEIJO',1,1,0,0,'insumo',1,'2026-10-09T00:00:00.000Z',NULL),
    (24,1,'Refrigerante','REFRI',6,1,1,0,'produto',1,'2026-10-09T00:00:00.000Z','Lata gelada')`).run();
  raw.prepare(`INSERT INTO ficha_tecnica (estabelecimento_id,produto_id,insumo_id,quantidade,unidade,criado_em) VALUES
    (1,20,21,1,'UN','2026-10-09T00:00:00.000Z'),
    (1,20,21,1,'UN','2026-10-09T00:00:00.000Z'),
    (1,20,22,1,'UN','2026-10-09T00:00:00.000Z'),
    (1,20,23,1,'UN','2026-10-09T00:00:00.000Z')`).run();
  const adminEnv = { DB: new TenantDb(raw, 1), rawDB: raw, estabelecimentoId: 1 };
  await updateOnlineStoreHandler(context({ slug: 'brasa-pao', nome: 'Brasa & Pão', ativo: true }), adminEnv);
  const composto = await upsertOnlineCatalogProductHandler(context({ produto_id: 20, preco: 22, descricao: 'Caprichado no cheddar' }), adminEnv);
  assert.equal(composto.status, 201);
  assert.equal(composto.data.descricao, 'Pão, Carne e Queijo. Caprichado no cheddar');
  const jaEscrito = await upsertOnlineCatalogProductHandler(context({ produto_id: 20, preco: 22, descricao: 'Pão, carne e queijo. Sem pressa' }), adminEnv);
  assert.equal(jaEscrito.status, 200);
  assert.equal(jaEscrito.data.descricao, 'Pão, carne e queijo. Sem pressa');
  const editado = await updateOnlineCatalogProductHandler(context({ descricao: 'Só um aviso' }, { id: composto.data.id }), adminEnv);
  assert.equal(editado.status, 200);
  assert.equal(editado.data.descricao, 'Só um aviso');
  const simples = await upsertOnlineCatalogProductHandler(context({ produto_id: 24, preco: 6, descricao: 'Lata gelada' }), adminEnv);
  assert.equal(simples.status, 201);
  assert.equal(simples.data.descricao, 'Lata gelada');
});

test('categorias do cardápio organizam os itens e a remoção sai só do delivery', async (t) => {
  const raw = new SqliteDb(':memory:');
  t.after(() => raw.close());
  raw.prepare("INSERT INTO estabelecimentos (id,nome,ativo) VALUES (1,'Brasa e Pão',1),(2,'Casa Vizinha',1)").run();
  raw.prepare(`INSERT INTO produtos (id,estabelecimento_id,nome,codigo_interno,preco,ativo,exibir_restaurante,exibir_mercado,tipo,sem_vencimento,criado_em) VALUES
    (10,1,'X-Burger','XB',20,1,1,0,'produto',1,'2026-10-09T00:00:00.000Z'),
    (11,1,'Suco','SUCO',8,1,1,0,'produto',1,'2026-10-09T00:00:00.000Z')`).run();
  const adminEnv = { DB: new TenantDb(raw, 1), rawDB: raw, estabelecimentoId: 1 };
  const vizinha = { DB: new TenantDb(raw, 2), rawDB: raw, estabelecimentoId: 2 };
  await updateOnlineStoreHandler(context({ slug: 'brasa-pao', nome: 'Brasa & Pão', ativo: true }), adminEnv);
  await updateOnlineStoreHandler(context({ slug: 'casa-vizinha', nome: 'Casa Vizinha', ativo: true }), vizinha);
  const bebidas = await addMenuCategoryHandler(context({ nome: 'Bebidas' }), adminEnv);
  assert.equal(bebidas.status, 201);
  const repetida = await addMenuCategoryHandler(context({ nome: '  bebidas  ' }), adminEnv);
  assert.equal(repetida.status, 409);
  const lanches = await addMenuCategoryHandler(context({ nome: 'Lanches' }), adminEnv);
  assert.equal(lanches.status, 201);
  const idBebidas = bebidas.data.find((categoria) => categoria.nome === 'Bebidas').id;
  const idLanches = lanches.data.find((categoria) => categoria.nome === 'Lanches').id;
  const burger = await upsertOnlineCatalogProductHandler(context({ produto_id: 10, preco: 20, cardapio_categoria_id: idLanches }), adminEnv);
  const suco = await upsertOnlineCatalogProductHandler(context({ produto_id: 11, preco: 8, cardapio_categoria_id: idBebidas }), adminEnv);
  assert.equal(burger.status, 201);
  assert.equal(suco.data.categoria_nome, 'Bebidas');
  const publicEnv = { DB: raw };
  const menu = await getPublicStoreHandler(context({}, { slug: 'brasa-pao' }), publicEnv);
  assert.deepEqual(menu.data.produtos.map((produto) => produto.nome), ['Suco', 'X-Burger']);
  assert.deepEqual(menu.data.categorias.map((categoria) => categoria.nome), ['Bebidas', 'Lanches']);
  const organizado = await organizeMenuHandler(context({
    categorias: [{ id: idLanches, ordem: 0 }, { id: idBebidas, ordem: 1 }],
    produtos: [
      { id: burger.data.id, cardapio_categoria_id: idLanches, ordem: 0 },
      { id: suco.data.id, cardapio_categoria_id: idBebidas, ordem: 0 },
    ],
  }), adminEnv);
  assert.equal(organizado.status, 200);
  const reordenado = await getPublicStoreHandler(context({}, { slug: 'brasa-pao' }), publicEnv);
  assert.deepEqual(reordenado.data.produtos.map((produto) => produto.nome), ['X-Burger', 'Suco']);
  assert.deepEqual(reordenado.data.categorias.map((categoria) => categoria.nome), ['Lanches', 'Bebidas']);
  const alheia = await addMenuCategoryHandler(context({ nome: 'Pizzas' }), vizinha);
  const invasao = await updateOnlineCatalogProductHandler(context({ cardapio_categoria_id: alheia.data[0].id }, { id: burger.data.id }), adminEnv);
  assert.equal(invasao.status, 400);
  const removido = await removeOnlineCatalogProductHandler(context({}, { id: suco.data.id }), adminEnv);
  assert.equal(removido.status, 200);
  const semSuco = await getPublicStoreHandler(context({}, { slug: 'brasa-pao' }), publicEnv);
  assert.deepEqual(semSuco.data.produtos.map((produto) => produto.nome), ['X-Burger']);
  assert.equal(raw.prepare('SELECT ativo FROM produtos WHERE id=11').first().ativo, 1);
  const deVolta = await upsertOnlineCatalogProductHandler(context({ produto_id: 11, preco: 8 }), adminEnv);
  assert.equal(deVolta.status, 200);
  assert.equal(deVolta.data.ativo, 1);
  const voltou = await getPublicStoreHandler(context({}, { slug: 'brasa-pao' }), publicEnv);
  assert.equal(voltou.data.produtos.some((produto) => produto.nome === 'Suco'), true);
  const apagada = await removeMenuCategoryHandler(context({}, { id: idBebidas }), adminEnv);
  assert.equal(apagada.status, 200);
  assert.equal(apagada.data.some((categoria) => categoria.nome === 'Bebidas'), false);
  const solto = raw.prepare('SELECT cardapio_categoria_id, ativo FROM cardapio_online_produtos WHERE produto_id=11').first();
  assert.equal(solto.cardapio_categoria_id, null);
  assert.equal(solto.ativo, 1);
});
