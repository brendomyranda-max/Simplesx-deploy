import assert from 'node:assert/strict';
import test from 'node:test';
import SqliteDb from '../server/sqlite-db.js';
import { TenantDb } from '../shared/tenant-db.js';
import { copiaColaPix, normalizarChavePix } from '../shared/pix.js';
import {
  atualizarPedidoOnlineHandler,
  createPublicOrderHandler,
  getPublicOrderHandler,
  getPublicStoreHandler,
  painelCozinhaHandler,
  painelPedidosHandler,
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

test('normaliza a chave Pix e trava o código copia e cola', () => {
  assert.equal(normalizarChavePix(' BRASA@Example.com '), 'brasa@example.com');
  assert.equal(normalizarChavePix('529.982.247-25'), '52998224725');
  assert.equal(normalizarChavePix('11.444.777/0001-61'), '11444777000161');
  assert.equal(normalizarChavePix('(11) 98888-7777'), '+5511988887777');
  assert.equal(normalizarChavePix('123E4567-E12B-12D1-A456-426655440000'), '123e4567-e12b-12d1-a456-426655440000');
  assert.throws(() => normalizarChavePix('111.111.111-11'), /chave Pix válida/);
  assert.throws(() => normalizarChavePix('sem-arroba'), /chave Pix válida/);
  const codigo = copiaColaPix({ chave: 'brasa@example.com', nome: 'Brasa & Pão', cidade: 'São Paulo', valor: 10, txid: 'P1' });
  assert.equal(codigo, '00020101021126390014br.gov.bcb.pix0117brasa@example.com520400005303986540510.005802BR5909BRASA PAO6009SAO PAULO62060502P16304D8D2');
  assert.throws(() => copiaColaPix({ chave: 'brasa@example.com', nome: 'Brasa', cidade: 'S', valor: 10, txid: 'P1' }), /cidade do recebedor/);
  assert.throws(() => copiaColaPix({ chave: 'brasa@example.com', nome: 'Brasa', cidade: 'São Paulo', valor: 0, txid: 'P1' }), /maior que zero/);
});

test('o Pix do pedido usa só a chave da loja e o cliente paga nela', async (t) => {
  const raw = new SqliteDb(':memory:');
  t.after(() => raw.close());
  raw.prepare("INSERT INTO estabelecimentos (id,nome,ativo) VALUES (1,'Brasa',1),(2,'Casa',1)").run();
  raw.prepare(`INSERT INTO produtos (id,estabelecimento_id,nome,codigo_interno,preco,ativo,exibir_restaurante,exibir_mercado,tipo,sem_vencimento,criado_em) VALUES
    (10,1,'Lanche','L1',10,1,1,0,'produto',1,'2026-10-10T00:00:00.000Z'),
    (11,2,'Suco','S1',8,1,1,0,'produto',1,'2026-10-10T00:00:00.000Z')`).run();
  const brasa = { DB: new TenantDb(raw, 1), rawDB: raw, estabelecimentoId: 1 };
  const casa = { DB: new TenantDb(raw, 2), rawDB: raw, estabelecimentoId: 2 };
  const publico = { DB: raw };

  const loja = await updateOnlineStoreHandler(context({
    slug: 'brasa-pao', nome: 'Brasa & Pão', ativo: true, pix_chave: ' BRASA@Example.com ', pix_cidade: 'São Paulo',
  }), brasa);
  assert.equal(loja.status, 200);
  assert.equal(loja.data.pix_chave, 'brasa@example.com');
  assert.equal(loja.data.pix_cidade, 'SAO PAULO');
  assert.equal(loja.data.pix_disponivel, 1);
  const vizinha = await updateOnlineStoreHandler(context({
    slug: 'casa-vizinha', nome: 'Casa Vizinha', ativo: true, pix_chave: '11988887777', pix_cidade: 'Campinas',
  }), casa);
  assert.equal(vizinha.status, 200);
  assert.equal(vizinha.data.pix_chave, '+5511988887777');

  const curta = await updateOnlineStoreHandler(context({ pix_cidade: 'S' }), brasa);
  assert.equal(curta.status, 400);
  assert.match(curta.data.error, /cidade do recebedor/);
  assert.equal(raw.prepare('SELECT pix_chave FROM lojas_online WHERE estabelecimento_id=1').first().pix_chave, 'brasa@example.com');
  const nome = await updateOnlineStoreHandler(context({ nome: 'Brasa & Pão' }), brasa);
  assert.equal(nome.status, 200);
  assert.equal(nome.data.pix_chave, 'brasa@example.com');

  await upsertOnlineCatalogProductHandler(context({ produto_id: 10, preco: 10 }), brasa);
  await upsertOnlineCatalogProductHandler(context({ produto_id: 11, preco: 8 }), casa);
  const menu = await getPublicStoreHandler(context({}, { slug: 'brasa-pao' }), publico);
  assert.equal(menu.data.loja.pix_disponivel, 1);
  assert.equal(Object.hasOwn(menu.data.loja, 'pix_chave'), false);
  assert.equal(Object.hasOwn(menu.data.loja, 'pix_cidade'), false);
  assert.equal(Object.hasOwn(menu.data.loja, 'latitude'), false);

  const pedido = await createPublicOrderHandler(context({
    chave: 'pedido-pix-loja-0001',
    cliente_nome: 'Ana Souza',
    telefone: '11999990000',
    tipo_entrega: 'retirada',
    forma_pagamento: 'pix',
    pix_chave: 'outra@example.com',
    itens: [{ cardapio_produto_id: menu.data.produtos[0].id, quantidade: 1 }],
  }, { slug: 'brasa-pao' }), publico);
  assert.equal(pedido.status, 201);
  assert.equal(pedido.data.total, 10);
  assert.equal(pedido.data.forma_pagamento, 'pix');
  assert.equal(pedido.data.pix_copia_cola, '00020101021126390014br.gov.bcb.pix0117brasa@example.com520400005303986540510.005802BR5909BRASA PAO6009SAO PAULO62060502P16304D8D2');
  assert.equal(pedido.data.pix_copia_cola.includes('outra@example.com'), false);
  assert.equal(pedido.data.pix_copia_cola.includes('+5511988887777'), false);
  assert.equal(pedido.data.comanda_id, null);
  const guardado = raw.prepare('SELECT etapa, status, comanda_id, mesa_id FROM pedidos_online WHERE id=?').bind(pedido.data.id).first();
  assert.equal(guardado.etapa, 'aguardando_pix');
  assert.equal(guardado.status, 'recebido');
  assert.equal(guardado.comanda_id, null);
  assert.equal(guardado.mesa_id, null);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM pedidos_online_itens WHERE pedido_online_id=?').bind(pedido.data.id).first().n, 1);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM comandas').first().n, 0);
  const esperando = await getPublicOrderHandler(context({}, { slug: 'brasa-pao', chave: 'pedido-pix-loja-0001' }), publico);
  assert.equal(esperando.data.etapa, 'aguardando_pix');
  assert.equal(esperando.data.pix_copia_cola, pedido.data.pix_copia_cola);
  const painelAntes = await painelPedidosHandler(context(), brasa);
  assert.equal(painelAntes.data.delivery.length, 1);
  assert.equal(painelAntes.data.delivery[0].etapa, 'aguardando_pix');
  assert.equal(painelAntes.data.delivery[0].itens[0].nome, 'Lanche');
  assert.equal(painelAntes.data.prioridade.length, 0);
  const cozinhaAntes = await painelCozinhaHandler(context(), brasa);
  assert.equal(cozinhaAntes.data.estacoes.every((estacao) => estacao.lancamentos.length === 0), true);
  const cedo = await atualizarPedidoOnlineHandler(context({ status: 'confirmado' }, { id: String(pedido.data.id) }), brasa);
  assert.equal(cedo.status, 409);
  assert.match(cedo.data.error, /Pix/);
  const alheioLibera = await atualizarPedidoOnlineHandler(context({ status: 'pix_recebido' }, { id: String(pedido.data.id) }), casa);
  assert.equal(alheioLibera.status, 404);
  const liberado = await atualizarPedidoOnlineHandler(context({ status: 'pix_recebido' }, { id: String(pedido.data.id) }), brasa);
  assert.equal(liberado.status, 200);
  assert.equal(liberado.data.etapa, 'recebido');
  assert.ok(liberado.data.comanda_id);
  const subiu = raw.prepare('SELECT etapa, comanda_id FROM pedidos_online WHERE id=?').bind(pedido.data.id).first();
  assert.equal(subiu.etapa, 'recebido');
  assert.equal(raw.prepare('SELECT nome FROM comanda_itens WHERE comanda_id=?').bind(subiu.comanda_id).first().nome, 'Lanche');
  const painelDepois = await painelPedidosHandler(context(), brasa);
  assert.equal(painelDepois.data.delivery[0].etapa, 'recebido');
  assert.equal(painelDepois.data.prioridade.some((item) => item.canal === 'delivery' && item.nome === 'Lanche'), true);
  const cozinhaDepois = await painelCozinhaHandler(context(), brasa);
  assert.equal(cozinhaDepois.data.estacoes.some((estacao) => estacao.lancamentos.some((lancamento) => lancamento.itens.some((item) => item.nome === 'Lanche'))), true);
  const deNovo = await atualizarPedidoOnlineHandler(context({ status: 'pix_recebido' }, { id: String(pedido.data.id) }), brasa);
  assert.equal(deNovo.status, 409);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM comandas').first().n, 1);

  const repetido = await createPublicOrderHandler(context({
    chave: 'pedido-pix-loja-0001', cliente_nome: 'Ana Souza', telefone: '11999990000', tipo_entrega: 'retirada', forma_pagamento: 'pix',
    itens: [{ cardapio_produto_id: menu.data.produtos[0].id, quantidade: 1 }],
  }, { slug: 'brasa-pao' }), publico);
  assert.equal(repetido.status, 200);
  assert.equal(repetido.data.pix_copia_cola, pedido.data.pix_copia_cola);

  const menuCasa = await getPublicStoreHandler(context({}, { slug: 'casa-vizinha' }), publico);
  const outro = await createPublicOrderHandler(context({
    chave: 'pedido-pix-casa-0001',
    cliente_nome: 'Bia',
    telefone: '11988880000',
    tipo_entrega: 'retirada',
    forma_pagamento: 'pix',
    itens: [{ cardapio_produto_id: menuCasa.data.produtos[0].id, quantidade: 1 }],
  }, { slug: 'casa-vizinha' }), publico);
  assert.equal(outro.status, 201);
  assert.match(outro.data.pix_copia_cola, /\+5511988887777/);
  assert.equal(outro.data.pix_copia_cola.includes('brasa@example.com'), false);
  assert.equal(outro.data.comanda_id, null);
  const canceladoPix = await atualizarPedidoOnlineHandler(context({ status: 'cancelado' }, { id: String(outro.data.id) }), casa);
  assert.equal(canceladoPix.status, 200);
  assert.equal(canceladoPix.data.etapa, 'cancelado');
  assert.equal(raw.prepare('SELECT comanda_id FROM pedidos_online WHERE id=?').bind(outro.data.id).first().comanda_id, null);
  const sumiu = await painelPedidosHandler(context(), casa);
  assert.equal(sumiu.data.delivery.some((item) => item.id === outro.data.id), false);
  assert.equal(raw.prepare('SELECT pix_copia_cola FROM pedidos_online WHERE chave=?').bind('pedido-pix-loja-0001').first().pix_copia_cola, pedido.data.pix_copia_cola);

  const dinheiro = await createPublicOrderHandler(context({
    chave: 'pedido-dinheiro-0001', cliente_nome: 'Ana Souza', telefone: '11999990000', tipo_entrega: 'retirada', forma_pagamento: 'dinheiro',
    itens: [{ cardapio_produto_id: menu.data.produtos[0].id, quantidade: 1 }],
  }, { slug: 'brasa-pao' }), publico);
  assert.equal(dinheiro.status, 201);
  assert.equal(dinheiro.data.pix_copia_cola, null);
  assert.ok(dinheiro.data.comanda_id);
  const pixNoDinheiro = await atualizarPedidoOnlineHandler(context({ status: 'pix_recebido' }, { id: String(dinheiro.data.id) }), brasa);
  assert.equal(pixNoDinheiro.status, 409);
  const maquina = await createPublicOrderHandler(context({
    chave: 'pedido-maquina-00001', cliente_nome: 'Ana Souza', telefone: '11999990000', tipo_entrega: 'retirada', forma_pagamento: 'cartao',
    itens: [{ cardapio_produto_id: menu.data.produtos[0].id, quantidade: 1 }],
  }, { slug: 'brasa-pao' }), publico);
  assert.equal(maquina.status, 201);
  assert.equal(maquina.data.forma_pagamento, 'maquininha');
  assert.equal(maquina.data.pix_copia_cola, null);
  const invalido = await createPublicOrderHandler(context({
    chave: 'pedido-credito-00001', cliente_nome: 'Ana Souza', telefone: '11999990000', tipo_entrega: 'retirada', forma_pagamento: 'credito',
    itens: [{ cardapio_produto_id: menu.data.produtos[0].id, quantidade: 1 }],
  }, { slug: 'brasa-pao' }), publico);
  assert.equal(invalido.status, 400);
  assert.match(invalido.data.error, /Pix, dinheiro ou maquininha/);

  const acompanhamento = await getPublicOrderHandler(context({}, { slug: 'brasa-pao', chave: 'pedido-pix-loja-0001' }), publico);
  assert.equal(acompanhamento.data.pix_copia_cola, pedido.data.pix_copia_cola);
  assert.equal(acompanhamento.data.forma_pagamento, 'pix');
  assert.equal(acompanhamento.data.etapa, 'recebido');
  assert.equal(Object.hasOwn(acompanhamento.data, 'pix_chave'), false);
  assert.equal(Object.hasOwn(acompanhamento.data, 'latitude'), false);
  const alheio = await getPublicOrderHandler(context({}, { slug: 'casa-vizinha', chave: 'pedido-pix-loja-0001' }), publico);
  assert.equal(alheio.status, 404);

  const semPix = await updateOnlineStoreHandler(context({ pix_chave: '' }), brasa);
  assert.equal(semPix.status, 200);
  assert.equal(semPix.data.pix_disponivel, 0);
  assert.equal(semPix.data.pix_chave, null);
  const bloqueado = await createPublicOrderHandler(context({
    chave: 'pedido-pix-loja-0002', cliente_nome: 'Ana Souza', telefone: '11999990000', tipo_entrega: 'retirada', forma_pagamento: 'pix',
    itens: [{ cardapio_produto_id: menu.data.produtos[0].id, quantidade: 1 }],
  }, { slug: 'brasa-pao' }), publico);
  assert.equal(bloqueado.status, 400);
  assert.match(bloqueado.data.error, /não recebe Pix/);
  const antigo = await getPublicOrderHandler(context({}, { slug: 'brasa-pao', chave: 'pedido-pix-loja-0001' }), publico);
  assert.equal(antigo.data.pix_copia_cola, pedido.data.pix_copia_cola);
  const publicoSem = await getPublicStoreHandler(context({}, { slug: 'brasa-pao' }), publico);
  assert.equal(publicoSem.data.loja.pix_disponivel, 0);
  const casaAinda = await getPublicStoreHandler(context({}, { slug: 'casa-vizinha' }), publico);
  assert.equal(casaAinda.data.loja.pix_disponivel, 1);
});
