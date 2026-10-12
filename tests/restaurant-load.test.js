import assert from 'node:assert/strict';
import test from 'node:test';
import SqliteDb from '../server/sqlite-db.js';
import { TenantDb } from '../shared/tenant-db.js';
import { saveOrderItems } from '../shared/restaurant-orders.js';
import { dispatchOrders } from '../shared/order-printing.js';
import { fecharComandaHandler, baixarPessoaComandaHandler } from '../shared/handlers-vendas.js';

function countedDb(db, limit = Infinity) {
  let queries = 0;
  const raw = new WeakMap();
  const count = (n = 1) => { queries += n; if (queries > limit) throw new Error('Too many D1 queries'); };
  return {
    get queries() { return queries; },
    prepare(sql) {
      const statement = db.prepare(sql);
      const wrapped = {
        bind(...params) { statement.bind(...params); return wrapped; },
        first() { count(); return statement.first(); },
        all() { count(); return statement.all(); },
        run() { count(); return statement.run(); },
      };
      raw.set(wrapped, statement);
      return wrapped;
    },
    batch(statements) { count(statements.length); return db.batch(statements.map((s) => raw.get(s) || s)); },
  };
}

function fixture(t) {
  const db = new SqliteDb(':memory:'); t.after(() => db.close());
  db.prepare("INSERT INTO estabelecimentos (id,nome) VALUES (1,'Teste de carga'),(2,'Outra loja')").run();
  db.prepare("INSERT INTO mesas (id,estabelecimento_id,numero,status) VALUES (1,1,1,'ocupada')").run();
  db.prepare("INSERT INTO comandas (id,estabelecimento_id,mesa_id,status,taxa_garcom_pct) VALUES (1,1,1,'aberta',10)").run();
  db.prepare("INSERT INTO comanda_pessoas (id,estabelecimento_id,comanda_id,nome) VALUES (1,1,1,'Cliente')").run();
  db.prepare(`INSERT INTO produtos (id,estabelecimento_id,nome,tipo,unidade,preco,custo,estoque_atual,conteudo_quantidade,conteudo_unidade) VALUES
    (1,1,'Negroni','composto','UN',30,9,0,NULL,NULL),
    (2,1,'Gin','insumo','UN',NULL,100,10,1000,'ML'),
    (3,1,'Vermute','insumo','L',NULL,60,10,NULL,NULL),
    (4,1,'Bitter','insumo','ML',NULL,0.1,10000,NULL,NULL),
    (5,1,'Água','produto','UN',5,1,100,NULL,NULL),
    (6,2,'Outro produto','produto','UN',500,1,100,NULL,NULL)`).run();
  db.prepare("INSERT INTO ficha_tecnica (estabelecimento_id,produto_id,insumo_id,quantidade,unidade) VALUES (1,1,2,30,'ML'),(1,1,3,30,'ML'),(1,1,4,30,'ML')").run();
  db.prepare("INSERT INTO gestores (id,estabelecimento_id,token,sessao_id) VALUES (1,1,'fixture-token','fixture-session')").run();
  db.prepare("INSERT INTO impressora_agentes (id,estabelecimento_id,nome,ip,servidor_tipo,servidor_id,imprime_pedidos) VALUES (1,1,'Bar','','desktop','1',1)").run();
  db.prepare("INSERT INTO categorias (id,estabelecimento_id,nome,impressora_agente_id) VALUES (1,1,'Drinks',1)").run();
  db.prepare('INSERT INTO produto_categorias (estabelecimento_id,produto_id,categoria_id) VALUES (1,1,1)').run();
  const context = (body = {}) => ({ params: { id: '1' }, user: { id: 1, nome: 'Garçom' }, req: { json: async () => body }, json: (data, status = 200) => ({ data, status }) });
  const env = (counted = db) => ({ DB: new TenantDb(counted, 1), rawDB: counted, estabelecimentoId: 1 });
  const order = (count = 10, produto_id = 1) => ({ chave: crypto.randomUUID(), itens: Array.from({ length: count }, (_, i) => ({ produto_id, quantidade: 1, pessoa_id: 1, observacao: `Unidade ${i + 1}` })) });
  return { db, context, env, order };
}

test('lançar dez Negronis não repete consultas de ficha e fica abaixo do limite do deploy', async (t) => {
  const f = fixture(t), measured = countedDb(f.db);
  const result = await saveOrderItems(f.context(), f.env(measured), f.order());
  assert.equal(result.itens.length, 10);
  t.diagnostic(`${measured.queries} consultas para lançar 10 Negronis`);
  assert.ok(measured.queries < 40);
});

test('fechar dez Negronis fica abaixo do limite e baixa corretamente os três insumos', async (t) => {
  const f = fixture(t);
  await saveOrderItems(f.context(), f.env(), f.order());
  const measured = countedDb(f.db);
  const result = await fecharComandaHandler(f.context({ taxa_garcom_pct: 0 }), f.env(measured));
  assert.equal(result.status, 200);
  assert.equal(result.data.total, 300);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM venda_itens').first().n, 10);
  assert.ok(Math.abs(f.db.prepare('SELECT estoque_atual FROM produtos WHERE id=2').first().estoque_atual - 9.7) < 1e-9);
  assert.ok(Math.abs(f.db.prepare('SELECT estoque_atual FROM produtos WHERE id=3').first().estoque_atual - 9.7) < 1e-9);
  assert.equal(f.db.prepare('SELECT estoque_atual FROM produtos WHERE id=4').first().estoque_atual, 9700);
  t.diagnostic(`${measured.queries} consultas para fechar 10 Negronis`);
  assert.ok(measured.queries < 40);
});

test('falha financeira no fechamento não deixa venda, estoque ou mesa parcialmente alterados', async (t) => {
  const f = fixture(t); await saveOrderItems(f.context(), f.env(), f.order());
  f.db.db.exec("CREATE TRIGGER fail_close BEFORE INSERT ON caixa BEGIN SELECT RAISE(ABORT,'falha simulada'); END");
  await assert.rejects(fecharComandaHandler(f.context({}), f.env()), /falha simulada/);
  for (const table of ['vendas', 'venda_itens', 'pagamentos', 'estoque_movimentacoes', 'lancamentos', 'caixa']) {
    assert.equal(f.db.prepare(`SELECT COUNT(*) n FROM ${table}`).first().n, 0, table);
  }
  assert.equal(f.db.prepare('SELECT estoque_atual FROM produtos WHERE id=2').first().estoque_atual, 10);
  assert.equal(f.db.prepare('SELECT status FROM comandas WHERE id=1').first().status, 'aberta');
  assert.equal(f.db.prepare('SELECT fechamento_bloqueado_ate FROM comandas WHERE id=1').first().fechamento_bloqueado_ate, null);
  f.db.db.exec('DROP TRIGGER fail_close');
  assert.equal((await fecharComandaHandler(f.context({}), f.env())).status, 200);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM vendas').first().n, 1);
});

test('estoque da receita é validado para a soma dos dez drinks, não por linha isolada', async (t) => {
  const f = fixture(t); await saveOrderItems(f.context(), f.env(), f.order());
  f.db.prepare('UPDATE produtos SET estoque_atual=0.1 WHERE id=2').run();
  await assert.rejects(fecharComandaHandler(f.context({}), f.env()), /Estoque insuficiente.*Gin/);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM vendas').first().n, 0);
  assert.equal(f.db.prepare('SELECT estoque_atual FROM produtos WHERE id=2').first().estoque_atual, 0.1);
});

test('lote máximo de 50 drinks salva, envia sem duplicar e fecha dentro do orçamento de consultas', async (t) => {
  const f = fixture(t), submission = f.order(50);
  const measured = countedDb(f.db, 45);
  await saveOrderItems(f.context(), f.env(measured), submission);
  assert.equal((await saveOrderItems(f.context(), f.env(), submission)).repetido, true);
  const sent = await dispatchOrders(f.context(), f.env(), { comanda_id: 1 });
  assert.equal(sent.itens, 50);
  assert.equal((await dispatchOrders(f.context(), f.env(), { comanda_id: 1 })).itens, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM gestor_jobs').first().n, 1);
  const closing = countedDb(f.db, 45);
  assert.equal((await fecharComandaHandler(f.context({ taxa_garcom_pct: 0 }), f.env(closing))).data.total, 1500);
  t.diagnostic(`50 drinks: ${measured.queries} consultas no lançamento e ${closing.queries} no fechamento`);
});

test('50 produtos distintos no mesmo lançamento também ficam abaixo do limite', async (t) => {
  const f = fixture(t);
  for (let i = 10; i < 60; i++) f.db.prepare("INSERT INTO produtos (id,estabelecimento_id,nome,preco,custo,estoque_atual) VALUES (?,1,?,10,2,100)").bind(i, `Produto ${i}`).run();
  const measured = countedDb(f.db, 45);
  await saveOrderItems(f.context(), f.env(measured), { chave: crypto.randomUUID(), itens: Array.from({ length: 50 }, (_, i) => ({ produto_id: i + 10, quantidade: 1 })) });
  const closing = countedDb(f.db, 45);
  assert.equal((await fecharComandaHandler(f.context({ taxa_garcom_pct: 0 }), f.env(closing))).data.total, 500);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM estoque_movimentacoes').first().n, 50);
  assert.equal(f.db.prepare('SELECT estoque_atual FROM produtos WHERE id=6').first().estoque_atual, 100);
});

test('dois fechamentos simultâneos não duplicam venda nem baixa de estoque', async (t) => {
  const f = fixture(t); await saveOrderItems(f.context(), f.env(), f.order());
  const results = await Promise.all([1,2].map(() => fecharComandaHandler(f.context({ taxa_garcom_pct: 0 }), f.env())));
  assert.deepEqual(results.map((r) => r.status).sort(), [200,409]);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM vendas').first().n, 1);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM caixa').first().n, 1);
});

test('fechamentos de duas mesas disputando o mesmo insumo não deixam estoque negativo', async (t) => {
  const f = fixture(t); await saveOrderItems(f.context(), f.env(), f.order());
  f.db.prepare('UPDATE produtos SET estoque_atual=0.45 WHERE id=2').run();
  f.db.prepare("INSERT INTO mesas (id,estabelecimento_id,numero,status) VALUES (2,1,2,'ocupada')").run();
  f.db.prepare("INSERT INTO comandas (id,estabelecimento_id,mesa_id,status) VALUES (2,1,2,'aberta')").run();
  f.db.prepare("INSERT INTO comanda_itens (estabelecimento_id,comanda_id,produto_id,nome,quantidade,preco_unitario) VALUES (1,2,1,'Negroni',10,30)").run();
  const other = f.context({ taxa_garcom_pct: 0 }); other.params.id = '2';
  const results = await Promise.allSettled([fecharComandaHandler(f.context({ taxa_garcom_pct: 0 }), f.env()), fecharComandaHandler(other, f.env())]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.match(results.find((r) => r.status === 'rejected').reason.message, /Estoque insuficiente/);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM vendas').first().n, 1);
  assert.ok(Math.abs(f.db.prepare('SELECT estoque_atual FROM produtos WHERE id=2').first().estoque_atual - 0.15) < 1e-9);
});

test('receita encadeada e receitas circulares são tratadas sem consultas repetidas nem travamento', async (t) => {
  const f = fixture(t);
  f.db.prepare("INSERT INTO produtos (id,estabelecimento_id,nome,tipo,unidade,custo) VALUES (10,1,'Pré-mistura','composto','ML',0.1)").run();
  f.db.prepare("INSERT INTO ficha_tecnica (estabelecimento_id,produto_id,insumo_id,quantidade,unidade) VALUES (1,10,2,1,'ML')").run();
  f.db.prepare('UPDATE ficha_tecnica SET insumo_id=10 WHERE produto_id=1 AND insumo_id=2').run();
  await saveOrderItems(f.context(), f.env(), f.order());
  const measured = countedDb(f.db, 45);
  assert.equal((await fecharComandaHandler(f.context({ taxa_garcom_pct: 0 }), f.env(measured))).status, 200);
  assert.ok(Math.abs(f.db.prepare('SELECT estoque_atual FROM produtos WHERE id=2').first().estoque_atual - 9.7) < 1e-9);
  f.db.prepare("UPDATE comandas SET status='aberta' WHERE id=1").run();
  f.db.prepare("UPDATE ficha_tecnica SET insumo_id=1,unidade='UN' WHERE produto_id=10").run();
  f.db.prepare("UPDATE vendas SET status='cancelada'").run();
  await assert.rejects(fecharComandaHandler(f.context({}), f.env()), /Ficha técnica circular/);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM vendas').first().n, 1);
});

test('pagamento individual com 50 drinks também conclui sem estourar consultas', async (t) => {
  const f = fixture(t); await saveOrderItems(f.context(), f.env(), f.order(50));
  f.db.prepare("INSERT INTO mesas (id,estabelecimento_id,numero,tipo) VALUES (2,1,999,'pagamentos')").run();
  const measured = countedDb(f.db, 45);
  const result = await fecharComandaHandler(f.context({ tipo: 'individual', taxa_garcom_pct: 0 }), f.env(measured));
  assert.equal(result.status, 200);
  const id = result.data.comanda_pagamentos_id;
  const person = f.db.prepare('SELECT id FROM comanda_pessoas WHERE comanda_id=?').bind(id).first();
  const close = f.context({ pessoa_id: person.id }); close.params.id = String(id);
  const closing = countedDb(f.db, 45);
  const results = await Promise.all([baixarPessoaComandaHandler(close, f.env(closing)), baixarPessoaComandaHandler(close, f.env())]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200,409]);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM vendas').first().n, 1);
  assert.equal(f.db.prepare('SELECT status FROM mesas WHERE id=1').first().status, 'livre');
});

test('divisão individual preserva a pessoa, os itens gerais e os valores personalizados', async (t) => {
  const f = fixture(t);
  f.db.prepare("INSERT INTO mesas (id,estabelecimento_id,numero,tipo) VALUES (2,1,999,'pagamentos')").run();
  f.db.prepare("INSERT INTO comanda_pessoas (id,estabelecimento_id,comanda_id,nome) VALUES (2,1,1,'Cliente'),(3,1,1,'Sem consumo')").run();
  const submission = f.order(3); submission.itens[1].pessoa_id = 2; delete submission.itens[2].pessoa_id;
  await saveOrderItems(f.context(), f.env(), submission);
  const result = await fecharComandaHandler(f.context({ tipo: 'individual', taxa_garcom_pct: 0,
    pessoas_valores: [{ pessoa_id: 1, valor: 20, forma: 'pix' }, { pessoa_id: 2, valor: 40 }, { pessoa_id: null, valor: 30 }] }), f.env());
  assert.equal(result.data.total, 90);
  const child = f.db.prepare('SELECT * FROM comandas WHERE id=?').bind(result.data.comanda_pagamentos_id).first();
  const pessoas = f.db.prepare('SELECT * FROM comanda_pessoas WHERE comanda_id=? ORDER BY id').bind(child.id).all().results;
  assert.equal(pessoas.length, 3);
  const saved = JSON.parse(child.individual_valores);
  assert.deepEqual(pessoas.map((p) => saved.valores[p.id]), [20,40,30]);
  assert.equal(saved.formas[pessoas[0].id], 'pix');
  for (let i = 0; i < pessoas.length; i++) {
    const item = f.db.prepare('SELECT observacao FROM comanda_itens WHERE comanda_id=? AND pessoa_id=?').bind(child.id, pessoas[i].id).first();
    assert.equal(item.observacao, `Unidade ${i + 1}`);
    const close = f.context({ pessoa_id: pessoas[i].id }); close.params.id = String(child.id);
    assert.equal((await baixarPessoaComandaHandler(close, f.env())).data.fechou, i === 2);
  }
  assert.equal(f.db.prepare('SELECT SUM(total) total FROM vendas').first().total, 90);
  assert.ok(Math.abs(f.db.prepare('SELECT estoque_atual FROM produtos WHERE id=2').first().estoque_atual - 9.91) < 1e-9);
});

test('falha ao transferir pagamentos individuais desfaz a nova comanda e permite tentar novamente', async (t) => {
  const f = fixture(t); await saveOrderItems(f.context(), f.env(), f.order());
  f.db.prepare("INSERT INTO mesas (id,estabelecimento_id,numero,tipo) VALUES (2,1,999,'pagamentos')").run();
  f.db.db.exec("CREATE TRIGGER fail_individual BEFORE INSERT ON comanda_itens WHEN NEW.comanda_id!=1 BEGIN SELECT RAISE(ABORT,'falha simulada'); END");
  await assert.rejects(fecharComandaHandler(f.context({ tipo: 'individual' }), f.env()), /falha simulada/);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM comandas').first().n, 1);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM comanda_pessoas').first().n, 1);
  assert.equal(f.db.prepare('SELECT status FROM comandas WHERE id=1').first().status, 'aberta');
  f.db.db.exec('DROP TRIGGER fail_individual');
  assert.equal((await fecharComandaHandler(f.context({ tipo: 'individual' }), f.env())).status, 200);
});

test('falha ao baixar pessoa mantém pagamento pendente e não deixa venda parcial', async (t) => {
  const f = fixture(t); await saveOrderItems(f.context(), f.env(), f.order());
  f.db.prepare("INSERT INTO mesas (id,estabelecimento_id,numero,tipo) VALUES (2,1,999,'pagamentos')").run();
  const result = await fecharComandaHandler(f.context({ tipo: 'individual' }), f.env());
  const id = result.data.comanda_pagamentos_id;
  const person = f.db.prepare('SELECT id FROM comanda_pessoas WHERE comanda_id=?').bind(id).first();
  const close = f.context({ pessoa_id: person.id }); close.params.id = String(id);
  f.db.db.exec("CREATE TRIGGER fail_payment BEFORE INSERT ON caixa BEGIN SELECT RAISE(ABORT,'falha simulada'); END");
  await assert.rejects(baixarPessoaComandaHandler(close, f.env()), /falha simulada/);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM vendas').first().n, 0);
  assert.equal(f.db.prepare('SELECT status FROM comanda_pessoas WHERE id=?').bind(person.id).first().status, 'pendente');
  assert.equal(f.db.prepare('SELECT estoque_atual FROM produtos WHERE id=2').first().estoque_atual, 10);
});

test('comanda com venda antiga incompleta não permite cobrar e baixar estoque novamente', async (t) => {
  const f = fixture(t); await saveOrderItems(f.context(), f.env(), f.order());
  f.db.prepare("INSERT INTO vendas (estabelecimento_id,numero,tipo,comanda_id,total,status) VALUES (1,'ANTIGA','restaurante',1,300,'concluida')").run();
  const result = await fecharComandaHandler(f.context({}), f.env());
  assert.equal(result.status, 409);
  assert.match(result.data.error, /já possui a venda/);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM vendas').first().n, 1);
  assert.equal(f.db.prepare('SELECT estoque_atual FROM produtos WHERE id=2').first().estoque_atual, 10);
});
