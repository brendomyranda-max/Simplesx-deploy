import assert from 'node:assert/strict';
import test from 'node:test';
import SqliteDb from '../server/sqlite-db.js';
import { TenantDb } from '../shared/tenant-db.js';
import { funcionamentoLoja } from '../shared/online-hours.js';
import { dispatchOrders } from '../shared/order-printing.js';
import { createAgenteHandler, listAgentesHandler, updateAgenteHandler } from '../shared/handlers-cadastros.js';
import {
  atualizarPedidoOnlineHandler, createPublicOrderHandler, getPublicOrderHandler, getPublicStoreHandler,
  listPublicStoresHandler, painelPedidosHandler, updateOnlineCatalogProductHandler, updateOnlineStoreHandler, upsertOnlineCatalogProductHandler,
} from '../shared/handlers-online.js';

const context = (body = {}, params = {}) => ({ params, req: { json: async () => body, query: () => '', header: () => '' }, json: (data, status = 200) => ({ data, status }) });

async function fixture(t, platform = 'desktop') {
  const db = new SqliteDb(':memory:');
  t.after(() => db.close());
  db.prepare("INSERT INTO estabelecimentos(id,nome,ativo) VALUES(1,'Casa',1),(2,'Vizinha',1)").run();
  db.prepare("INSERT INTO produtos(id,estabelecimento_id,nome,preco,tipo,ativo) VALUES(1,1,'Lanche',20,'produto',1)").run();
  db.prepare("INSERT INTO gestores(id,estabelecimento_id,token,ativo) VALUES(1,1,'desktop-casa',1),(2,2,'desktop-vizinha',1)").run();
  db.prepare(`INSERT INTO devices(id,estabelecimento_id,nome,plataforma,token_hash,token_expira_em,criado_em,atualizado_em)
    VALUES('android-casa',1,'Celular','android','hash','2099-01-01','','')`).run();
  const env = { DB: new TenantDb(db, 1), rawDB: db, estabelecimentoId: 1 };
  await updateOnlineStoreHandler(context({ nome: 'Casa', slug: 'casa', ativo: 1, pix_chave: 'casa@example.com', pix_cidade: 'Sao Paulo' }), env);
  const product = (await upsertOnlineCatalogProductHandler(context({ produto_id: 1 }), env)).data;
  const route = { nome: 'Delivery', servidor_tipo: platform, servidor_id: platform === 'desktop' ? '1' : 'android-casa', impressora_destino: 'Expedicao USB', imprime_delivery: true, imprime_pedidos: false, largura_mm: 58 };
  const printer = await createAgenteHandler(context(route), env);
  assert.equal(printer.status, 201);
  const orderBody = (chave, forma_pagamento = 'dinheiro') => ({ chave, cliente_nome: 'Ana', telefone: '11999990000', tipo_entrega: 'entrega',
    endereco: 'Rua Um, 50', forma_pagamento, observacao: 'Tocar campainha', troco_para: 50,
    itens: [{ cardapio_produto_id: product.id, quantidade: 2, observacao: 'Sem cebola' }], estabelecimento_id: 2 });
  const order = (chave, payment) => createPublicOrderHandler(context(orderBody(chave, payment), { slug: 'casa' }), { DB: db });
  const queue = () => db.prepare(`SELECT * FROM ${platform === 'desktop' ? 'gestor_jobs' : 'device_tasks'}`).all().results;
  return { db, env, product, route, printer, order, queue, orderBody };
}

test('horários incluem abertura, excluem fechamento e preservam a pausa manual', () => {
  const store = { ativo: 1, horario_automatico: 1, horario_abertura: '18:00', horario_fechamento: '23:00', horario_dias: '[1]', horario_fuso: 'America/Sao_Paulo' };
  const aberto = (iso, changes = {}) => funcionamentoLoja({ ...store, ...changes }, new Date(iso)).aberta_agora;
  assert.equal(aberto('2026-10-19T20:59:00Z'), 0);
  assert.equal(aberto('2026-10-19T21:00:00Z'), 1);
  assert.equal(aberto('2026-10-20T01:59:00Z'), 1);
  assert.equal(aberto('2026-10-20T02:00:00Z'), 0);
  assert.equal(aberto('2026-10-20T21:00:00Z'), 0, 'terça não selecionada');
  assert.equal(aberto('2026-10-19T21:00:00Z', { ativo: 0 }), 0);
  assert.equal(aberto('2026-10-19T21:00:00Z', { horario_fuso: 'America/Manaus' }), 0);
  assert.equal(aberto('2026-10-19T10:00:00Z', { horario_automatico: 0 }), 1);
});

test('fechamento de madrugada pertence ao dia de abertura, incluindo domingo para segunda', () => {
  const store = { ativo: 1, horario_automatico: 1, horario_abertura: '22:00', horario_fechamento: '02:00', horario_dias: '[0]', horario_fuso: 'America/Sao_Paulo' };
  const aberto = (iso) => funcionamentoLoja(store, new Date(iso)).aberta_agora;
  assert.equal(aberto('2026-10-19T01:00:00Z'), 1);
  assert.equal(aberto('2026-10-19T03:00:00Z'), 1);
  assert.equal(aberto('2026-10-19T04:59:00Z'), 1);
  assert.equal(aberto('2026-10-19T05:00:00Z'), 0);
  assert.equal(aberto('2026-10-20T01:00:00Z'), 0);
});

for (const platform of ['desktop', 'android']) test(`aceitação automática imprime uma vez no destino delivery (${platform})`, async (t) => {
  const f = await fixture(t, platform);
  await updateOnlineStoreHandler(context({ aceitacao_automatica: 1 }), f.env);
  // Uma rota da outra loja nunca recebe o pedido, mesmo com tenant no corpo.
  f.db.prepare("INSERT INTO impressora_agentes(estabelecimento_id,nome,ip,imprime_delivery,servidor_tipo,servidor_id) VALUES(2,'Vizinha','',1,'desktop','2')").run();
  f.db.prepare("INSERT INTO impressora_agentes(id,estabelecimento_id,nome,ip,imprime_pedidos,servidor_tipo,servidor_id) VALUES(20,1,'Cozinha','',1,'desktop','1')").run();
  f.db.prepare("INSERT INTO categorias(id,estabelecimento_id,nome,impressora_agente_id) VALUES(10,1,'Lanches',20)").run();
  f.db.prepare('INSERT INTO produto_categorias(estabelecimento_id,produto_id,categoria_id) VALUES(1,1,10)').run();
  const orders = await Promise.all([1, 2, 3].map(() => f.order('pedido-automatico-0001')));
  assert.ok(orders.every((r) => r.data.status === 'confirmado'));
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM pedidos_online').first().n, 1);
  assert.equal(f.db.prepare('SELECT etapa FROM pedidos_online').first().etapa, 'preparando');
  assert.equal(f.queue().length, 1);
  assert.equal(f.db.prepare('SELECT (SELECT COUNT(*) FROM gestor_jobs)+(SELECT COUNT(*) FROM device_tasks) n').first().n, 1, 'destino delivery prevalece sobre categoria');
  const job = f.queue()[0];
  const payload = platform === 'android' ? JSON.parse(job.payload_json) : job;
  assert.equal(platform === 'android' ? payload.printer : job.impressora, 'Expedicao USB');
  assert.equal(job.estabelecimento_id, 1);
  const content = platform === 'android' ? payload.content : job.conteudo;
  for (const expected of ['PEDIDO DELIVERY #1', 'CLIENTE: Ana', 'Rua Um, 50', 'Sem cebola', 'Tocar campainha', 'TROCO PARA: R$ 50.00', '2x Lanche']) assert.ok(content.includes(expected), expected);
  assert.equal(f.db.prepare('SELECT status FROM comanda_itens').first().status, 'enviado');
  if (platform === 'android') assert.equal(f.db.prepare('SELECT ator_tipo FROM device_task_events').first().ator_tipo, 'system');
  await dispatchOrders(context(), f.env, { comanda_id: orders[0].data.comanda_id });
  assert.equal(f.queue().length, 1);
  const tracked = await getPublicOrderHandler(context({}, { slug: 'casa', chave: 'pedido-automatico-0001' }), { DB: f.db });
  assert.equal(tracked.data.etapa, 'preparando');
});

test('aceitação manual é o padrão; confirmar envia para a impressora dedicada', async (t) => {
  const f = await fixture(t);
  const created = await f.order('pedido-manual-0001');
  assert.equal(created.data.status, 'recebido');
  assert.equal(f.queue().length, 0);
  const confirmed = await atualizarPedidoOnlineHandler(context({ status: 'confirmado' }, { id: created.data.id }), f.env);
  assert.equal(confirmed.data.etapa, 'preparando');
  assert.equal(f.queue().length, 1);
  const routes = await listAgentesHandler(context(), f.env);
  assert.equal(routes.data[0].imprime_delivery, true);
  await updateAgenteHandler(context({ ...f.route, imprime_delivery: false }, { id: f.printer.data.id }), f.env);
  assert.equal((await listAgentesHandler(context(), f.env)).data[0].imprime_delivery, false);
});

test('Pix aguarda recebimento mesmo com aceitação automática e só então imprime', async (t) => {
  const f = await fixture(t, 'android');
  await updateOnlineStoreHandler(context({ aceitacao_automatica: 1 }), f.env);
  const created = await f.order('pedido-pix-auto-0001', 'pix');
  assert.equal(created.data.comanda_id, null);
  assert.equal(f.db.prepare('SELECT etapa FROM pedidos_online').first().etapa, 'aguardando_pix');
  assert.equal(f.queue().length, 0);
  await f.order('pedido-pix-auto-0001', 'pix');
  assert.equal(f.queue().length, 0);
  const confirmed = await atualizarPedidoOnlineHandler(context({ status: 'pix_recebido' }, { id: created.data.id }), f.env);
  assert.equal(confirmed.data.status, 'confirmado');
  assert.equal(confirmed.data.etapa, 'preparando');
  assert.equal(f.queue().length, 1);
});

test('falha da fila preserva pedido aceito e permite reenviar sem perder ou duplicar itens', async (t) => {
  const f = await fixture(t);
  await updateOnlineStoreHandler(context({ aceitacao_automatica: 1 }), f.env);
  f.db.db.exec("CREATE TRIGGER falhar_fila BEFORE INSERT ON gestor_jobs BEGIN SELECT RAISE(ABORT,'falha simulada'); END");
  const created = await f.order('pedido-falha-0001');
  assert.equal(created.status, 201);
  assert.equal(created.data.status, 'confirmado');
  assert.equal(f.queue().length, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM pedido_impressoes').first().n, 0);
  assert.equal(f.db.prepare('SELECT status FROM comanda_itens').first().status, 'novo');
  assert.equal((await painelPedidosHandler(context(), f.env)).data.delivery[0].impressao_pendente, 1);
  f.db.db.exec('DROP TRIGGER falhar_fila');
  await dispatchOrders(context(), f.env, { comanda_id: created.data.comanda_id });
  await f.order('pedido-falha-0001');
  assert.equal(f.queue().length, 1);
});

test('destino delivery desativado não imprime em outra categoria e pode ser retomado', async (t) => {
  const f = await fixture(t);
  await updateOnlineStoreHandler(context({ aceitacao_automatica: 1 }), f.env);
  f.db.prepare('UPDATE impressora_agentes SET ativo=0 WHERE id=?').bind(f.printer.data.id).run();
  const created = await f.order('pedido-inativo-0001');
  assert.equal(created.data.status, 'confirmado');
  assert.equal(f.queue().length, 0);
  f.db.prepare('UPDATE impressora_agentes SET ativo=1 WHERE id=?').bind(f.printer.data.id).run();
  await dispatchOrders(context(), f.env, { comanda_id: created.data.comanda_id });
  assert.equal(f.queue().length, 1);
});

test('horário controla vitrine e checkout; pausa manual e acompanhamento são preservados', async (t) => {
  const f = await fixture(t);
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-19T21:00:00Z') });
  const saved = await updateOnlineStoreHandler(context({ horario_automatico: 1, horario_abertura: '18:00', horario_fechamento: '23:00', horario_dias: [1] }), f.env);
  assert.equal(saved.data.aberta_agora, 1);
  assert.deepEqual(saved.data.horario_dias, [1]);
  assert.equal((await listPublicStoresHandler(context(), { DB: f.db })).data.lojas.length, 1);
  const created = await f.order('pedido-horario-0001');
  assert.equal(created.status, 201);
  t.mock.timers.setTime(new Date('2026-10-20T02:00:00Z').getTime());
  const closed = await getPublicStoreHandler(context({}, { slug: 'casa' }), { DB: f.db });
  assert.equal(closed.data.loja.aberta_agora, 0);
  assert.equal(closed.data.produtos.length, 1, 'link mantém cardápio para consulta');
  assert.equal((await listPublicStoresHandler(context(), { DB: f.db })).data.lojas.length, 0);
  assert.equal((await f.order('pedido-horario-0002')).status, 409);
  assert.equal((await f.order('pedido-horario-0001')).data.repetido, true);
  await updateOnlineStoreHandler(context({ ativo: 0 }), f.env);
  t.mock.timers.setTime(new Date('2026-10-26T21:00:00Z').getTime());
  assert.equal((await listPublicStoresHandler(context(), { DB: f.db })).data.lojas.length, 0);
  await assert.rejects(f.order('pedido-pausado-0001'), { status: 404 });
  assert.equal((await getPublicOrderHandler(context({}, { slug: 'casa', chave: 'pedido-horario-0001' }), { DB: f.db })).status, 200);
  assert.equal((await updateOnlineStoreHandler(context({ ativo: 1 }), f.env)).data.aberta_agora, 1);
  for (const body of [{ horario_abertura: '25:00' }, { horario_fechamento: '18:00' }, { horario_dias: [] }, { horario_dias: [7] }, { horario_fuso: 'Invalido' }]) {
    assert.equal((await updateOnlineStoreHandler(context(body), f.env)).status, 400);
  }
});

test('produto pausado continua no delivery e cardápio de consulta, mas API recusa compra', async (t) => {
  const f = await fixture(t);
  await updateOnlineCatalogProductHandler(context({ disponivel: 0 }, { id: f.product.id }), f.env);
  const menu = () => getPublicStoreHandler(context({}, { slug: 'casa' }), { DB: f.db });
  assert.equal((await menu()).data.produtos[0].disponivel, 0);
  assert.equal((await f.order('pedido-produto-pausa')).status, 409);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM pedidos_online').first().n, 0);
  await updateOnlineStoreHandler(context({ aceita_pedidos_online: 0 }), f.env);
  assert.equal((await menu()).data.produtos[0].disponivel, 0);
  await updateOnlineStoreHandler(context({ aceita_pedidos_online: 1 }), f.env);
  await updateOnlineCatalogProductHandler(context({ disponivel: 1 }, { id: f.product.id }), f.env);
  assert.equal((await f.order('pedido-produto-ativo')).status, 201);
});

for (const pause of ['produto', 'loja']) test(`pausa de ${pause} durante o checkout impede a gravação do pedido inteiro`, async (t) => {
  const f = await fixture(t);
  const batch = f.db.batch.bind(f.db);
  f.db.batch = (statements) => {
    f.db.prepare(pause === 'produto' ? 'UPDATE cardapio_online_produtos SET disponivel=0' : 'UPDATE lojas_online SET ativo=0').run();
    return batch(statements);
  };
  await assert.rejects(f.order('pedido-pausa-concorrente'), { status: 409 });
  for (const table of ['pedidos_online', 'pedidos_online_itens', 'mesas', 'comandas', 'comanda_itens', 'gestor_jobs']) {
    assert.equal(f.db.prepare(`SELECT COUNT(*) n FROM ${table}`).first().n, 0, table);
  }
});
