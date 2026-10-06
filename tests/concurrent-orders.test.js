import assert from 'node:assert/strict';
import test from 'node:test';
import SqliteDb from '../server/sqlite-db.js';
import { TenantDb } from '../shared/tenant-db.js';
import { saveOrderItems } from '../shared/restaurant-orders.js';
import { dispatchOrders } from '../shared/order-printing.js';
import { pullGestorJobsHandler, gestorJobStatusHandler } from '../shared/handlers-gestor.js';
import { pullDeviceTasksHandler, updateDeviceTaskStatusHandler } from '../shared/handlers-devices.js';
import { sha256 } from '../shared/util.js';

async function fixture(t, android = false) {
  const db = new SqliteDb(':memory:');
  t.after(() => db.close());
  db.prepare("INSERT INTO estabelecimentos (id,nome) VALUES (1,'Restaurante'),(2,'Outro')").run();
  db.prepare("INSERT INTO mesas (id,estabelecimento_id,numero,status) VALUES (2,1,2,'ocupada')").run();
  db.prepare("INSERT INTO comandas (id,estabelecimento_id,mesa_id,garcom_nome) VALUES (1,1,2,'Dono da mesa')").run();
  db.prepare("INSERT INTO comanda_pessoas (id,estabelecimento_id,comanda_id,nome) VALUES (1,1,1,'Pessoa 1')").run();
  db.prepare("INSERT INTO produtos (id,estabelecimento_id,nome,preco) VALUES (1,1,'Porção',20)").run();
  db.prepare("INSERT INTO categorias (id,estabelecimento_id,nome,impressora_agente_id) VALUES (1,1,'Cozinha',1)").run();
  db.prepare('INSERT INTO produto_categorias (estabelecimento_id,produto_id,categoria_id) VALUES (1,1,1)').run();
  db.prepare("INSERT INTO gestores (id,estabelecimento_id,token,sessao_id) VALUES (1,1,'desktop-token','session')").run();
  db.prepare(`INSERT INTO devices (id,estabelecimento_id,nome,plataforma,token_hash,token_expira_em,criado_em,atualizado_em)
    VALUES ('android',1,'Android','android',?,'2099-01-01','','')`).bind(await sha256('device-token')).run();
  db.prepare(`INSERT INTO impressora_agentes (id,estabelecimento_id,nome,ip,ativo,imprime_pedidos,servidor_tipo,servidor_id,impressora_destino)
    VALUES (1,1,'Cozinha','',1,1,?,?,'Termica')`).bind(android ? 'android' : 'desktop', android ? 'android' : '1').run();
  const env = { DB: new TenantDb(db, 1), rawDB: db, estabelecimentoId: 1 };
  const context = (actor = 1, body = {}) => ({ params: { id: '1' }, user: { id: actor, nome: `Garçom ${actor}` },
    req: { json: async () => body, query: () => '', header: (h) => h === 'x-device-id' ? 'android' : h === 'authorization' ? 'Bearer device-token' : '' },
    json: (data, status = 200) => ({ data, status }) });
  const order = (actor = 1, key = crypto.randomUUID(), extra = {}) => saveOrderItems(context(actor), env, {
    chave: key, itens: [{ produto_id: 1, quantidade: 1, pessoa_id: 1, observacao: `Sem sal ${actor}`, responsavel: 'Nome falso', ...extra }],
  });
  return { db, env, context, order, send: (actor = 1, extra = {}) => dispatchOrders(context(actor), env, { comanda_id: 1, ...extra }) };
}

for (const android of [false, true]) test(`quatro garçons simultâneos salvam e imprimem todos os pedidos uma vez (${android ? 'Android' : 'desktop'})`, async (t) => {
  const f = await fixture(t, android);
  await Promise.all([1,2,3,4].map((actor) => f.order(actor)));
  const orders = f.db.prepare('SELECT * FROM comanda_itens').all().results;
  assert.equal(orders.length, 4);
  assert.deepEqual(orders.map((i) => i.responsavel).sort(), ['Garçom 1','Garçom 2','Garçom 3','Garçom 4']);
  await Promise.all([1,2,3,4].map((actor) => f.send(actor)));
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM pedido_impressoes').first().n, 4);
  const jobs = f.db.prepare(`SELECT * FROM ${android ? 'device_tasks' : 'gestor_jobs'}`).all().results;
  assert.equal(jobs.length, 4);
  for (let actor = 1; actor <= 4; actor++) {
    const text = jobs.map((j) => android ? JSON.parse(j.payload_json).content : j.conteudo);
    assert.equal(text.filter((s) => s.includes(`GARCOM: Garcom ${actor}`) && s.includes(`Sem sal ${actor}`)).length, 1);
    assert.ok(text.every((s) => !s.includes('Dono da mesa') && !s.includes('Nome falso')));
  }
  assert.ok(f.db.prepare('SELECT status FROM comanda_itens').all().results.every((i) => i.status === 'enviado'));
  await f.send();
  assert.equal(f.db.prepare(`SELECT COUNT(*) n FROM ${android ? 'device_tasks' : 'gestor_jobs'}`).first().n, 4);
  const deliveries = await Promise.all(Array.from({ length: 4 }, () => android
    ? pullDeviceTasksHandler(f.context(), { DB: f.db })
    : pullGestorJobsHandler(f.context(1, { token: 'desktop-token', session_id: 'session' }), { DB: f.db })));
  const ids = deliveries.flatMap((r) => (r.data.tasks || r.data.jobs).map((j) => j.id));
  assert.equal(ids.length, 4);
  assert.equal(new Set(ids).size, 4);
});

test('reenvios concorrentes e resposta perdida preservam um único lançamento', async (t) => {
  const f = await fixture(t);
  const key = crypto.randomUUID();
  const results = await Promise.all(Array.from({ length: 4 }, () => f.order(1, key)));
  assert.equal(new Set(results.map((r) => r.itens[0].id)).size, 1);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM comanda_itens').first().n, 1);
  await assert.rejects(f.order(2, key), { status: 409 });
  await assert.rejects(f.order(1, key, { quantidade: 2 }), { status: 409 });
  f.db.prepare("UPDATE comandas SET status='fechada'").run();
  assert.equal((await f.order(1, key)).itens.length, 1);
});

test('falha ao salvar um lote reverte todos os itens e permite tentar a mesma chave', async (t) => {
  const f = await fixture(t);
  f.db.db.exec("CREATE TRIGGER fail_item BEFORE INSERT ON comanda_itens WHEN NEW.observacao='falhar' BEGIN SELECT RAISE(ABORT,'falha simulada'); END");
  const body = { chave: crypto.randomUUID(), itens: [{ produto_id: 1 }, { produto_id: 1, observacao: 'falhar' }] };
  await assert.rejects(saveOrderItems(f.context(), f.env, body), /falha simulada/);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM comanda_itens').first().n, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM comanda_lancamentos').first().n, 0);
  f.db.db.exec('DROP TRIGGER fail_item');
  assert.equal((await saveOrderItems(f.context(), f.env, body)).itens.length, 2);
});

test('falha na fila desfaz a reserva e o status; nova tentativa não perde o pedido', async (t) => {
  const f = await fixture(t);
  await f.order();
  f.db.db.exec("CREATE TRIGGER fail_queue BEFORE INSERT ON gestor_jobs BEGIN SELECT RAISE(ABORT,'fila indisponivel'); END");
  await assert.rejects(f.send(), /fila indisponivel/);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM pedido_impressoes').first().n, 0);
  assert.equal(f.db.prepare('SELECT status FROM comanda_itens').first().status, 'novo');
  f.db.db.exec('DROP TRIGGER fail_queue');
  assert.equal((await f.send()).jobs.length, 1);
});

test('duas rotas: retomar a rota indisponível não repete a que já entrou na fila', async (t) => {
  const f = await fixture(t);
  f.db.prepare("INSERT INTO categorias (id,estabelecimento_id,nome,impressora_agente_id) VALUES (2,1,'Bar',2)").run();
  f.db.prepare('INSERT INTO produto_categorias (estabelecimento_id,produto_id,categoria_id) VALUES (1,1,2)').run();
  await f.order();
  const first = await f.send();
  assert.equal(first.jobs.length, 1);
  assert.equal(first.falhas.length, 1);
  assert.equal(f.db.prepare('SELECT status FROM comanda_itens').first().status, 'novo');
  f.db.prepare("INSERT INTO impressora_agentes (id,estabelecimento_id,nome,ip,ativo,imprime_pedidos,servidor_tipo,servidor_id) VALUES (2,1,'Bar','',1,1,'desktop','1')").run();
  assert.equal((await f.send()).jobs.length, 1);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM gestor_jobs').first().n, 2);
  assert.equal(f.db.prepare('SELECT status FROM comanda_itens').first().status, 'enviado');
});

test('fechamento em andamento e pessoa paga não recebem lançamentos', async (t) => {
  const f = await fixture(t);
  f.db.prepare("UPDATE comandas SET fechamento_bloqueado_ate='2099-01-01'").run();
  await assert.rejects(f.order(), { status: 409 });
  f.db.prepare('UPDATE comandas SET fechamento_bloqueado_ate=NULL').run();
  f.db.prepare("UPDATE comanda_pessoas SET status='baixado'").run();
  await assert.rejects(f.order(), { status: 409 });
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM comanda_itens').first().n, 0);
});

test('envio seleciona apenas os itens vistos, preservando novos pedidos de outra tela', async (t) => {
  const f = await fixture(t);
  const first = await f.order(1);
  const second = await f.order(2);
  await f.send(1, { itens_ids: [first.itens[0].id] });
  assert.equal(f.db.prepare('SELECT status FROM comanda_itens WHERE id=?').bind(second.itens[0].id).first().status, 'novo');
  await f.send(2, { itens_ids: [second.itens[0].id] });
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM gestor_jobs').first().n, 2);
});

test('quarenta itens e dezesseis envios sobrepostos mantêm quatro tickets completos', async (t) => {
  const f = await fixture(t);
  await Promise.all([1,2,3,4].map((actor) => saveOrderItems(f.context(actor), f.env, {
    chave: crypto.randomUUID(), itens: Array.from({ length: 10 }, (_, index) => ({ produto_id: 1, observacao: `Garçom ${actor}, unidade ${index}` })),
  })));
  await Promise.all(Array.from({ length: 16 }, (_, index) => f.send(index % 4 + 1)));
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM comanda_itens').first().n, 40);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM pedido_impressoes').first().n, 40);
  const tickets = f.db.prepare('SELECT conteudo FROM gestor_jobs').all().results;
  assert.equal(tickets.length, 4);
  assert.ok(tickets.every((ticket) => (ticket.conteudo.match(/unidade/g) || []).length === 10));
});

for (const android of [false, true]) test(`reserva renovável e ACK antigo não sobrescrevem conclusão (${android ? 'Android' : 'desktop'})`, async (t) => {
  const f = await fixture(t, android);
  await f.order(); await f.send();
  const pull = () => android ? pullDeviceTasksHandler(f.context(1, { limit: 1 }), { DB: f.db })
    : pullGestorJobsHandler(f.context(1, { token: 'desktop-token', session_id: 'session', limit: 1 }), { DB: f.db });
  const first = (await pull()).data;
  const job = (first.tasks || first.jobs)[0];
  const status = (value, lease = job.lease_id) => {
    const c = f.context(1, android ? { status: value, lease_id: lease } : { token: 'desktop-token', session_id: 'session', status: value, lease_id: lease });
    c.params.id = String(job.id);
    return android ? updateDeviceTaskStatusHandler(c, { DB: f.db }) : gestorJobStatusHandler(c, { DB: f.db });
  };
  assert.equal((await status(android ? 'processing' : 'processando')).status, 200);
  assert.equal((await status(android ? 'processing' : 'processando')).status, 200);
  const table = android ? 'device_tasks' : 'gestor_jobs';
  const expiry = android ? 'lease_expira_em' : 'enviado_em';
  f.db.prepare(`UPDATE ${table} SET ${expiry}='2000-01-01'`).run();
  const next = (await pull()).data;
  const nextJob = (next.tasks || next.jobs)[0];
  assert.notEqual(job.lease_id, nextJob.lease_id);
  assert.equal((await status(android ? 'success' : 'feito')).status, 409);
  assert.equal((await status(android ? 'success' : 'feito', nextJob.lease_id)).status, 200);
  assert.equal((await status(android ? 'failed' : 'erro', nextJob.lease_id)).data.duplicate, true);
  assert.equal(f.db.prepare(`SELECT status FROM ${table}`).first().status, android ? 'success' : 'feito');
});
