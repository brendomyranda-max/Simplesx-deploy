import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import SqliteDb from '../server/sqlite-db.js';
import { TenantDb } from '../shared/tenant-db.js';
import { transferirItemHandler } from '../shared/handlers-transferencias.js';
import { getComandaHandler, updateItemStatusHandler, updateItemComandaHandler, fecharComandaHandler } from '../shared/handlers-vendas.js';
import { handle } from '../shared/router.js';

function fixture(t) {
  const rawDB = new SqliteDb(':memory:');
  t.after(() => rawDB.close());
  rawDB.prepare("INSERT INTO estabelecimentos (id,nome) VALUES (1,'Restaurante'),(2,'Outro')").run();
  rawDB.prepare(`INSERT INTO mesas (id,estabelecimento_id,numero,nome,status,tipo) VALUES
    (1,1,1,'Mesa 1','ocupada','normal'),(2,1,2,'Mesa 2','ocupada','normal'),
    (3,1,3,'Mesa 3','livre','normal'),(4,2,1,'Outro','ocupada','normal'),(5,1,999,'Pagamentos','ocupada','pagamentos')`).run();
  rawDB.prepare(`INSERT INTO comandas (id,estabelecimento_id,mesa_id,garcom_nome,status) VALUES
    (1,1,1,'Ana','aberta'),(2,1,2,'João','aberta'),(3,2,4,'Outro','aberta')`).run();
  rawDB.prepare(`INSERT INTO comanda_pessoas (id,estabelecimento_id,comanda_id,nome) VALUES
    (1,1,1,'Pessoa 1'),(2,1,1,'Pessoa 2'),(3,1,2,'Pessoa na mesa 2'),(4,2,3,'Outra conta')`).run();
  rawDB.prepare(`INSERT INTO comanda_itens
    (id,estabelecimento_id,comanda_id,pessoa_id,nome,quantidade,preco_unitario,observacao,status,enviado_em,criado_em,responsavel)
    VALUES (1,1,1,1,'Suco',2,12.5,'Sem gelo','enviado','2026-10-06T01:00:00.000Z','2026-10-06T00:59:00.000Z','Ana')`).run();
  const env = { DB: new TenantDb(rawDB, 1), rawDB, estabelecimentoId: 1 };
  const context = (body = {}, comanda = 1, item = 1) => ({
    params: { id: String(comanda), item_id: String(item) }, user: { id: 9 },
    req: { json: async () => body }, json: (data, status = 200) => ({ data, status }),
  });
  return { rawDB, env, context, move: (body = {}, source = 1) => transferirItemHandler(context({ mesa_destino_id: 1, comanda_destino_id: 1, pessoa_destino_id: 2, versao: 0, ...body }, source), env) };
}

test('pedido enviado troca de pessoa preservando preço, observações, estado e total', async (t) => {
  const f = fixture(t);
  const before = f.rawDB.prepare('SELECT * FROM comanda_itens WHERE id=1').first();
  assert.equal((await f.move()).status, 200);
  const after = f.rawDB.prepare('SELECT * FROM comanda_itens WHERE id=1').first();
  assert.deepEqual(after, { ...before, pessoa_id: 2, versao: 1 });
  const audit = f.rawDB.prepare('SELECT * FROM comanda_item_transferencias').first();
  assert.equal(audit.pessoa_origem_id, 1);
  assert.equal(audit.pessoa_destino_id, 2);
  assert.equal(audit.funcionario_id, 9);
  assert.equal((await getComandaHandler(f.context(), f.env)).data.subtotal, 25);
  for (const table of ['vendas', 'estoque_movimentacoes', 'gestor_jobs', 'device_tasks']) {
    assert.equal(f.rawDB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first().n, 0);
  }
});

test('move para outra mesa e sua pessoa sem duplicar o lançamento', async (t) => {
  const f = fixture(t);
  const result = await f.move({ mesa_destino_id: 2, comanda_destino_id: 2, pessoa_destino_id: 3 });
  assert.equal(result.status, 200);
  const origin = (await getComandaHandler(f.context(), f.env)).data;
  const destination = (await getComandaHandler(f.context({}, 2), f.env)).data;
  assert.equal(origin.itens.length, 0);
  assert.equal(origin.status, 'aberta');
  assert.equal(destination.itens.length, 1);
  assert.equal(destination.itens[0].id, 1);
  assert.equal(destination.itens[0].pessoa_id, 3);
  assert.equal(destination.subtotal, 25);
  assert.equal((await updateItemStatusHandler(f.context({ status: 'cancelado' }), f.env)).status, 404);
});

test('abre mesa livre e transfere para a conta geral na mesma transação', async (t) => {
  const f = fixture(t);
  const result = await f.move({ mesa_destino_id: 3, comanda_destino_id: null, pessoa_destino_id: null });
  assert.equal(result.status, 200);
  assert.equal(result.data.abriu_comanda, 1);
  const destination = (await getComandaHandler(f.context({}, result.data.comanda_destino_id), f.env)).data;
  assert.equal(destination.mesa_id, 3);
  assert.equal(destination.mesa.status, 'ocupada');
  assert.equal(destination.pessoas.length, 1);
  assert.equal(destination.itens[0].pessoa_id, null);
  assert.equal(destination.subtotal, 25);
});

test('itens entregues também podem ser atribuídos à conta geral', async (t) => {
  const f = fixture(t);
  f.rawDB.prepare("UPDATE comanda_itens SET status='entregue' WHERE id=1").run();
  assert.equal((await f.move({ pessoa_destino_id: null, versao: 1 })).status, 200);
  assert.equal(f.rawDB.prepare('SELECT status FROM comanda_itens WHERE id=1').first().status, 'entregue');
});

test('rejeita itens de outra comanda, destinos de outra conta e pessoas sem vínculo', async (t) => {
  const f = fixture(t);
  assert.equal((await f.move({}, 2)).status, 404);
  assert.equal((await f.move({ mesa_destino_id: 4, comanda_destino_id: 3, pessoa_destino_id: 4 })).status, 404);
  assert.equal((await f.move({ pessoa_destino_id: 3 })).status, 400);
  assert.equal((await f.move({ pessoa_destino_id: 4 })).status, 400);
  assert.equal((await f.move({ pessoa_destino_id: 1 })).status, 400);
  assert.equal(f.rawDB.prepare('SELECT COUNT(*) AS n FROM comanda_item_transferencias').first().n, 0);
});

test('não transfere contas em pagamento, pessoas pagas, itens cancelados ou perdidos', async (t) => {
  const f = fixture(t);
  for (const status of ['pre_fechamento', 'fechada']) {
    f.rawDB.prepare('UPDATE comandas SET status=? WHERE id=2').bind(status).run();
    assert.equal((await f.move({ mesa_destino_id: 2, comanda_destino_id: 2, pessoa_destino_id: 3 })).status, 409);
    f.rawDB.prepare('UPDATE comandas SET status=? WHERE id=1').bind(status).run();
    assert.equal((await f.move()).status, 409);
  }
  f.rawDB.prepare("UPDATE comandas SET status='aberta'").run();
  f.rawDB.prepare("UPDATE comanda_pessoas SET status='baixado' WHERE id=2").run();
  assert.equal((await f.move()).status, 400);
  f.rawDB.prepare("UPDATE comanda_pessoas SET status='baixado' WHERE id=1").run();
  assert.equal((await f.move({ pessoa_destino_id: null })).status, 409);
  for (const status of ['cancelado', 'perda']) {
    f.rawDB.prepare('UPDATE comanda_itens SET status=? WHERE id=1').bind(status).run();
    assert.equal((await f.move()).status, 409);
  }
  assert.equal((await f.move({ mesa_destino_id: 5, comanda_destino_id: null, pessoa_destino_id: null })).status, 409);
});

test('duas transferências simultâneas têm somente um vencedor', async (t) => {
  const f = fixture(t);
  const results = await Promise.all([f.move(), f.move({ mesa_destino_id: 3, comanda_destino_id: null, pessoa_destino_id: null })]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(f.rawDB.prepare('SELECT COUNT(*) AS n FROM comanda_item_transferencias').first().n, 1);
  assert.equal(f.rawDB.prepare('SELECT COUNT(*) AS n FROM comanda_itens').first().n, 1);
  assert.equal(f.rawDB.prepare('SELECT COUNT(*) AS n FROM comandas WHERE mesa_id=3').first().n, results[1].status === 200 ? 1 : 0);
});

test('fechamento reserva os itens e impede transferência durante o cálculo', async (t) => {
  const f = fixture(t);
  let release, started;
  const gate = new Promise((resolve) => { release = resolve; });
  const reading = new Promise((resolve) => { started = resolve; });
  const db = f.env.DB;
  const closingEnv = { ...f.env, DB: { prepare(sql) {
    const statement = db.prepare(sql);
    if (sql.includes("SELECT * FROM comanda_itens WHERE comanda_id=? AND status!='cancelado'")) {
      const all = statement.all.bind(statement);
      statement.all = async () => { started(); await gate; return all(); };
    }
    return statement;
  } } };
  const close = fecharComandaHandler(f.context({ pre_fechar: true, tipo: 'unica' }), closingEnv);
  await reading;
  assert.equal((await f.move()).status, 409);
  assert.equal((await fecharComandaHandler(f.context({ pre_fechar: true, tipo: 'unica' }), f.env)).status, 409);
  release();
  assert.equal((await close).status, 200);
  const command = f.rawDB.prepare('SELECT * FROM comandas WHERE id=1').first();
  assert.equal(command.status, 'pre_fechamento');
  assert.equal(command.fechamento_bloqueado_ate, null);
});

test('dados antigos de pessoa/status são recusados após outra alteração', async (t) => {
  const f = fixture(t);
  await f.move();
  assert.equal((await f.move({ pessoa_destino_id: null })).status, 409);
  f.rawDB.prepare("UPDATE comanda_itens SET status='novo' WHERE id=1").run();
  const current = f.rawDB.prepare('SELECT versao FROM comanda_itens WHERE id=1').first().versao;
  const edit = await updateItemComandaHandler(f.context({ observacao: 'Sem açúcar' }), f.env);
  assert.equal(edit.status, 200);
  assert.equal(edit.data.versao, current + 1);
  assert.equal((await f.move({ versao: current, pessoa_destino_id: null })).status, 409);
});

test('falha no movimento reverte abertura de mesa e histórico', async (t) => {
  const f = fixture(t);
  f.rawDB.db.exec("CREATE TRIGGER abort_transfer BEFORE UPDATE OF comanda_id ON comanda_itens BEGIN SELECT RAISE(ABORT, 'falha simulada'); END");
  await assert.rejects(f.move({ mesa_destino_id: 3, comanda_destino_id: null, pessoa_destino_id: null }), /falha simulada/);
  assert.equal(f.rawDB.prepare('SELECT COUNT(*) AS n FROM comandas WHERE mesa_id=3').first().n, 0);
  assert.equal(f.rawDB.prepare('SELECT status FROM mesas WHERE id=3').first().status, 'livre');
  assert.equal(f.rawDB.prepare('SELECT COUNT(*) AS n FROM comanda_item_transferencias').first().n, 0);
  assert.equal(f.rawDB.prepare('SELECT comanda_id FROM comanda_itens WHERE id=1').first().comanda_id, 1);
});

test('rota de transferência exige autenticação', async (t) => {
  const f = fixture(t);
  const result = await handle({ req: { path: '/api/comandas/1/itens/1/transferir', method: 'POST', header: () => '', query: () => '' }, json: (data, status) => ({ data, status }) }, { DB: f.rawDB });
  assert.equal(result.status, 401);
});

const catalogCode = ts.transpileModule(readFileSync(new URL('../src/lib/restaurantCatalog.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { restaurantProducts } = await import(`data:text/javascript;base64,${Buffer.from(catalogCode).toString('base64')}`);

test('cardápio inclui subcategorias em Tudo do Bar e permite filtrar cada uma', () => {
  const categories = [{ id: 1, nome: 'Bar', ativo: 1 }, { id: 2, nome: 'Alcoólicos', categoria_pai_id: 1, ativo: 1 }, { id: 3, nome: 'Soft', categoria_pai_id: 1, ativo: 1 }, { id: 4, nome: 'Cozinha', ativo: 1 }];
  const product = (id, nome, ids) => ({ id, nome, categorias: ids.map((id) => ({ id })), ativo: 1, exibir_restaurante: 1 });
  const products = [product(1, 'Cerveja', [2]), product(2, 'Água', [3]), product(3, 'Porção', [4]), product(4, 'Copo', [1]), product(5, 'Sem categoria', [])];
  assert.deepEqual(restaurantProducts(products, categories, 1, '').map((p) => p.id), [1, 2, 4]);
  assert.deepEqual(restaurantProducts(products, categories, 2, '').map((p) => p.id), [1]);
  assert.deepEqual(restaurantProducts(products, categories, 3, 'agua').map((p) => p.id), [2]);
  assert.equal(restaurantProducts(products, categories, null, '').length, 5);
  const many = Array.from({ length: 40 }, (_, i) => product(i, `Produto ${i}`, [2]));
  assert.equal(restaurantProducts(many, categories, 1, '').length, 40);
});
