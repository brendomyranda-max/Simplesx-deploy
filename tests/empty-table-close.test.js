import assert from 'node:assert/strict';
import test from 'node:test';
import SqliteDb from '../server/sqlite-db.js';
import { TenantDb } from '../shared/tenant-db.js';
import { fecharComandaHandler, getComandaHandler, baixarPessoaComandaHandler } from '../shared/handlers-vendas.js';
import { somentePedidosPosteriores } from '../shared/restaurant-close-history.js';

function fixture(t) {
  const db = new SqliteDb(':memory:'); t.after(() => db.close());
  db.prepare("INSERT INTO estabelecimentos (id,nome) VALUES (1,'Salão'),(2,'Outra loja')").run();
  db.prepare("INSERT INTO mesas (id,estabelecimento_id,numero,status) VALUES (1,1,2,'ocupada'),(2,2,2,'ocupada'),(3,1,999,'ocupada')").run();
  db.prepare("UPDATE mesas SET tipo='pagamentos' WHERE id=3").run();
  db.prepare("INSERT INTO comandas (id,estabelecimento_id,mesa_id,status) VALUES (9,1,1,'aberta'),(10,2,2,'aberta')").run();
  db.prepare("INSERT INTO produtos (id,estabelecimento_id,nome,estoque_atual) VALUES (1,1,'Insumo',12)").run();
  db.prepare("INSERT INTO comanda_itens (id,estabelecimento_id,comanda_id,produto_id,nome,quantidade,preco_unitario,status) VALUES (1,1,9,1,'Cancelado',2,10,'cancelado')").run();
  const env = { DB: new TenantDb(db,1),rawDB:db,estabelecimentoId:1 };
  const context = (body = {},id = 9) => ({ params:{ id:String(id) },user:{ id:1,nome:'Gestor' },req:{ json:async () => body },json:(data,status=200) => ({ data,status }) });
  const close = (body = {}, id = 9, e = env) => fecharComandaHandler(context(body,id),e);
  const legacy = () => {
    for (const [id,total] of [[3,273.9],[4,249],[5,273.9]]) {
      db.prepare("INSERT INTO vendas (id,estabelecimento_id,numero,tipo,comanda_id,mesa_id,total,status) VALUES (?,1,?,'restaurante',9,1,?,'concluida')").bind(id,`ANTIGA-${id}`,total).run();
      db.prepare("INSERT INTO venda_itens (estabelecimento_id,venda_id,produto_id,nome,quantidade,preco_unitario,total) VALUES (1,?,1,'Produto',1,?,?)").bind(id,total,total).run();
      db.prepare("INSERT INTO pagamentos (estabelecimento_id,venda_id,forma,valor) VALUES (1,?,'dinheiro',?)").bind(id,total).run();
      db.prepare("INSERT INTO estoque_movimentacoes (estabelecimento_id,produto_id,tipo,quantidade,saldo_apos,origem,ref_id) VALUES (1,1,'saida',1,12,'venda',?)").bind(id).run();
    }
  };
  return { db,env,context,close,legacy };
}

function financialSnapshot(db) {
  return Object.fromEntries(['vendas','venda_itens','pagamentos','produtos','estoque_movimentacoes','lancamentos','caixa','comanda_itens'].map((table) => [table,db.prepare(`SELECT * FROM ${table} ORDER BY id`).all().results]));
}

test('mesa vazia com três vendas antigas pode liberar a ocupação sem alterar nenhum registro financeiro', async (t) => {
  const f = fixture(t); f.legacy(); const before = financialSnapshot(f.db);
  const result = await f.close({ liberar_vazia:true,tipo:'unica' });
  assert.equal(result.status,200);
  assert.equal(result.data.mesa_liberada,true);
  assert.deepEqual(result.data.vendas,[]);
  assert.equal(result.data.total,0);
  assert.deepEqual(result.data.vendas_anteriores,[3,4,5]);
  assert.deepEqual(financialSnapshot(f.db),before);
  assert.equal(f.db.prepare('SELECT status FROM mesas WHERE id=1').first().status,'livre');
  const command = f.db.prepare('SELECT * FROM comandas WHERE id=9').first();
  assert.equal(command.status,'fechada');
  assert.ok(command.fechada_em);
  assert.equal(command.fechamento_tipo,'sem_consumo');
  assert.equal(command.baixada_em,null);
  assert.equal(command.fechamento_bloqueado_ate,null);
  assert.deepEqual((await getComandaHandler(f.context(),f.env)).data.vendas_anteriores.map((v) => v.id),[3,4,5]);
  assert.equal(f.db.prepare('SELECT status FROM comandas WHERE id=10').first().status,'aberta');
});

test('baixa comum de mesa vazia com venda antiga exige confirmação específica e informa número correto', async (t) => {
  const f = fixture(t); f.legacy();
  for (const liberar_vazia of [undefined,false,'true',1]) {
    const result = await f.close({ liberar_vazia });
    assert.equal(result.status,409);
    assert.match(result.data.error,/comanda 9.*venda #3/);
    assert.match(result.data.error,/Liberar mesa vazia/);
    assert.equal(f.db.prepare('SELECT fechamento_bloqueado_ate FROM comandas WHERE id=9').first().fechamento_bloqueado_ate,null);
  }
  assert.equal(f.db.prepare('SELECT status FROM comandas WHERE id=9').first().status,'aberta');
});

test('pedido novo ou de preço zero impede liberar vazia e não vira cobrança automática', async (t) => {
  const f = fixture(t);
  f.db.prepare("UPDATE comanda_itens SET status='novo',preco_unitario=0 WHERE id=1").run();
  const result = await f.close({ liberar_vazia:true });
  assert.equal(result.status,409);
  assert.match(result.data.error,/recebeu produtos/);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM vendas').first().n,0);
  assert.equal(f.db.prepare('SELECT status FROM comandas WHERE id=9').first().status,'aberta');
});

test('continua bloqueando uma nova baixa financeira quando há produtos e venda anterior', async (t) => {
  const f = fixture(t); f.legacy();
  f.db.prepare("UPDATE comanda_itens SET status='entregue' WHERE id=1").run();
  const before = financialSnapshot(f.db);
  const result = await f.close();
  assert.equal(result.status,409);
  assert.match(result.data.error,/não é um fechamento em andamento/);
  assert.deepEqual(financialSnapshot(f.db),before);
});

test('mesa vazia sem histórico financeiro fecha normalmente, inclusive pré-fechada', async (t) => {
  for (const status of ['aberta','pre_fechamento']) {
    const f = fixture(t); f.db.prepare('UPDATE comandas SET status=? WHERE id=9').bind(status).run();
    const result = await f.close();
    assert.equal(result.status,200);
    assert.equal(result.data.mesa_liberada,true);
    assert.deepEqual(result.data.vendas_anteriores,[]);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM vendas').first().n,0);
  }
});

test('não libera origem enquanto existir comanda de pagamentos individuais pendente', async (t) => {
  const f = fixture(t);
  f.db.prepare("INSERT INTO comandas (id,estabelecimento_id,mesa_id,status,comanda_origem_id) VALUES (11,1,3,'pre_fechamento',9)").run();
  assert.equal((await f.close({ liberar_vazia:true })).status,409);
  assert.equal((await f.close({ liberar_vazia:true },11)).status,409);
  assert.equal(f.db.prepare('SELECT status FROM mesas WHERE id=1').first().status,'ocupada');
});

test('não libera mesa com duas comandas ativas ou reserva pertencente a outro fechamento', async (t) => {
  const f = fixture(t);
  // Simula duplicação legada anterior à restrição de abertura da Recepção.
  f.db.db.exec('DROP TRIGGER comanda_salao_unica_insert');
  f.db.prepare("INSERT INTO comandas (estabelecimento_id,mesa_id,status) VALUES (1,1,'aberta')").run();
  assert.equal((await f.close({ liberar_vazia:true })).status,409);
  f.db.prepare("UPDATE comandas SET fechamento_bloqueado_ate='2999-01-01' WHERE id=9").run();
  assert.equal((await f.close({ liberar_vazia:true })).status,409);
  assert.equal(f.db.prepare('SELECT status FROM comandas WHERE id=9').first().status,'aberta');
});

test('falha ao liberar a mesa reverte encerramento e permite tentar de novo', async (t) => {
  const f = fixture(t); f.legacy(); const before = financialSnapshot(f.db);
  f.db.db.exec("CREATE TRIGGER fail_empty BEFORE UPDATE OF status ON mesas WHEN NEW.id=1 BEGIN SELECT RAISE(ABORT,'falha simulada'); END");
  await assert.rejects(f.close({ liberar_vazia:true }),/falha simulada/);
  assert.equal(f.db.prepare('SELECT status FROM comandas WHERE id=9').first().status,'aberta');
  assert.equal(f.db.prepare('SELECT fechamento_bloqueado_ate FROM comandas WHERE id=9').first().fechamento_bloqueado_ate,null);
  assert.deepEqual(financialSnapshot(f.db),before);
  f.db.db.exec('DROP TRIGGER fail_empty');
  assert.equal((await f.close({ liberar_vazia:true })).status,200);
});

test('um item reativado entre leitura e transação impede encerrar a mesa', async (t) => {
  const f = fixture(t);
  const env = { ...f.env,rawDB:{ prepare:f.db.prepare.bind(f.db),batch(statements) {
    f.db.prepare("UPDATE comanda_itens SET status='novo' WHERE id=1").run();
    return f.db.batch(statements);
  } } };
  assert.equal((await f.close({ liberar_vazia:true },9,env)).status,409);
  assert.equal(f.db.prepare('SELECT status FROM comandas WHERE id=9').first().status,'aberta');
  assert.equal(f.db.prepare('SELECT status FROM mesas WHERE id=1').first().status,'ocupada');
});

test('dois cliques simultâneos liberam a mesa só uma vez', async (t) => {
  const f = fixture(t); f.legacy();
  const result = await Promise.all([f.close({ liberar_vazia:true }),f.close({ liberar_vazia:true })]);
  assert.deepEqual(result.map((r) => r.status).sort(),[200,409]);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM vendas').first().n,3);
});

test('API não libera comandas de outro estabelecimento e o aviso não mistura vendas', async (t) => {
  const f = fixture(t); f.legacy();
  f.db.prepare("INSERT INTO vendas (estabelecimento_id,numero,tipo,comanda_id,total) VALUES (2,'OUTRA','restaurante',10,999)").run();
  assert.equal((await f.close({ liberar_vazia:true },10)).status,404);
  const own = await getComandaHandler(f.context(),f.env);
  assert.deepEqual(own.data.vendas_anteriores.map((v) => v.id),[3,4,5]);
  assert.equal((await getComandaHandler(f.context({},10),f.env)).status,404);
});

test('mensagem de comanda já fechada não informa falsamente fechamento em andamento', async (t) => {
  const f = fixture(t);
  f.db.prepare("UPDATE comandas SET status='fechada' WHERE id=9").run();
  const result = await f.close();
  assert.equal(result.status,409);
  assert.equal(result.data.code,'COMANDA_FECHADA');
  assert.match(result.data.error,/comanda nº 9 já está fechada/);
  assert.doesNotMatch(result.data.error,/em andamento/);
});

test('reserva realmente ativa identifica a comanda e permite orientar saída sem remover o bloqueio', async (t) => {
  const f = fixture(t);
  f.db.prepare("UPDATE comandas SET fechamento_bloqueado_ate='2999-01-01' WHERE id=9").run();
  const result = await f.close();
  assert.equal(result.status,409);
  assert.equal(result.data.code,'FECHAMENTO_EM_ANDAMENTO');
  assert.match(result.data.error,/comanda nº 9.*voltar às mesas/);
  assert.equal(f.db.prepare('SELECT fechamento_bloqueado_ate FROM comandas WHERE id=9').first().fechamento_bloqueado_ate,'2999-01-01');
});

function fixtureComPedidoNovo(t) {
  const f = fixture(t); f.legacy();
  f.db.prepare(`UPDATE vendas SET criado_em=CASE id
    WHEN 3 THEN '2026-10-10T19:14:38.861Z'
    WHEN 4 THEN '2026-10-12T01:36:50.173Z'
    WHEN 5 THEN '2026-10-12T01:53:59.198Z' END WHERE comanda_id=9`).run();
  f.db.prepare("UPDATE comanda_itens SET criado_em='2026-10-12T02:23:10.146Z' WHERE id=1").run();
  f.db.prepare(`INSERT INTO comanda_itens
    (id,estabelecimento_id,comanda_id,produto_id,nome,quantidade,preco_unitario,status,criado_em)
    VALUES (45,1,9,1,'Pedido novo',1,10,'entregue','2026-10-12T03:59:49.606Z')`).run();
  return f;
}

function assertHistoricoPreservado(db, before) {
  for (const table of ['vendas','venda_itens','pagamentos','estoque_movimentacoes']) {
    const antigos = new Set(before[table].map((row) => row.id));
    assert.deepEqual(db.prepare(`SELECT * FROM ${table} ORDER BY id`).all().results.filter((row) => antigos.has(row.id)), before[table]);
  }
}

test('comanda 9 com vendas antigas fecha apenas o novo pedido de R$ 10 e libera a mesa', async (t) => {
  const f = fixtureComPedidoNovo(t), before = financialSnapshot(f.db);
  const loaded = await getComandaHandler(f.context(),f.env);
  assert.equal(loaded.data.pode_fechar_pedidos_novos,true);
  const result = await f.close({ tipo:'unica',taxa_garcom_pct:0,forma:'pix' });
  assert.equal(result.status,200);
  assert.equal(result.data.total,10);
  assert.equal(result.data.vendas.length,1);
  const vendaId = result.data.vendas[0].id;
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM vendas').first().n,4);
  assert.deepEqual(f.db.prepare('SELECT nome,quantidade,total FROM venda_itens WHERE venda_id=?').bind(vendaId).all().results,
    [{ nome:'Pedido novo',quantidade:1,total:10 }]);
  assert.deepEqual(f.db.prepare('SELECT forma,valor FROM pagamentos WHERE venda_id=?').bind(vendaId).all().results,[{ forma:'pix',valor:10 }]);
  assert.equal(f.db.prepare('SELECT estoque_atual FROM produtos WHERE id=1').first().estoque_atual,11);
  assert.equal(f.db.prepare("SELECT SUM(valor) total FROM lancamentos WHERE ref_tipo='venda' AND ref_id=?").bind(vendaId).first().total,10);
  assert.equal(f.db.prepare('SELECT SUM(valor) total FROM caixa').first().total,10);
  assert.equal(f.db.prepare('SELECT status FROM mesas WHERE id=1').first().status,'livre');
  const command = f.db.prepare('SELECT * FROM comandas WHERE id=9').first();
  assert.equal(command.status,'fechada');
  assert.ok(command.baixada_em);
  assert.equal(command.fechamento_bloqueado_ate,null);
  assertHistoricoPreservado(f.db,before);
  const closed = await getComandaHandler(f.context(),f.env);
  assert.deepEqual(closed.data.vendas_anteriores.map((venda) => venda.id),[3,4,5]);
  assert.equal(closed.data.pode_fechar_pedidos_novos,false);
  assert.equal((await f.close()).status,409);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM vendas').first().n,4);
});

test('novos pedidos podem pré-fechar e baixar com taxa zero sem repetir vendas antigas', async (t) => {
  const f = fixtureComPedidoNovo(t), before = financialSnapshot(f.db);
  assert.equal((await f.close({ pre_fechar:true,taxa_garcom_pct:0 })).status,200);
  assert.deepEqual(financialSnapshot(f.db),before);
  assert.equal(f.db.prepare('SELECT status FROM comandas WHERE id=9').first().status,'pre_fechamento');
  const result = await f.close({ taxa_garcom_pct:0 });
  assert.equal(result.status,200);
  assert.equal(result.data.total,10);
  assertHistoricoPreservado(f.db,before);
});

test('itens novos misturados com anteriores continuam bloqueados sem cobrança parcial', async (t) => {
  const f = fixtureComPedidoNovo(t);
  f.db.prepare("UPDATE comanda_itens SET status='entregue',criado_em='2026-10-10T19:00:00.000Z' WHERE id=1").run();
  const before = financialSnapshot(f.db);
  assert.equal((await getComandaHandler(f.context(),f.env)).data.pode_fechar_pedidos_novos,false);
  const result = await f.close();
  assert.equal(result.status,409);
  assert.equal(result.data.code,'ITENS_COM_VENDA_ANTERIOR');
  assert.deepEqual(financialSnapshot(f.db),before);
});

test('datas ausentes, inválidas, iguais ou anteriores nunca autorizam uma nova cobrança', () => {
  const sales = [{ criado_em:'2026-10-12T01:53:59.198Z' }];
  for (const criado_em of ['',null,'inválida','2026-10-12','2026-10-12T01:53:59.198Z','2026-10-12T01:53:59.197Z','2026-10-11T22:53:59.198-03:00']) {
    assert.equal(somentePedidosPosteriores([{ criado_em }],sales),false);
  }
  assert.equal(somentePedidosPosteriores([{ criado_em:'2026-10-12T02:00:00.000Z' }],[{ criado_em:'' }]),false);
  assert.equal(somentePedidosPosteriores([{ criado_em:'2026-10-12T02:00:00.000Z' }],sales),true);
  assert.equal(somentePedidosPosteriores([{ criado_em:'2026-10-12T02:00:00.000Z' }],[...sales,{ criado_em:'2026-10-12T03:00:00.000Z' }]),false);
});

test('item antigo reativado durante a confirmação aborta a baixa inteira dos novos pedidos', async (t) => {
  const f = fixtureComPedidoNovo(t);
  const measured = { prepare:f.db.prepare.bind(f.db),batch(statements) {
    f.db.prepare("UPDATE comanda_itens SET status='entregue',criado_em='2026-10-10T19:00:00.000Z' WHERE id=1").run();
    return f.db.batch(statements);
  } };
  const env = { ...f.env,DB:new TenantDb(measured,1) };
  const before = financialSnapshot(f.db);
  await assert.rejects(f.close({},9,env),{ status:409 });
  assertHistoricoPreservado(f.db,before);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM vendas').first().n,3);
  assert.equal(f.db.prepare('SELECT estoque_atual FROM produtos WHERE id=1').first().estoque_atual,12);
  assert.equal(f.db.prepare('SELECT status FROM comandas WHERE id=9').first().status,'aberta');
});

test('uma venda criada entre leitura e transação impede duplicar o pagamento novo', async (t) => {
  const f = fixtureComPedidoNovo(t);
  const measured = { prepare:f.db.prepare.bind(f.db),batch(statements) {
    f.db.prepare("INSERT INTO vendas (id,estabelecimento_id,numero,tipo,comanda_id,total,criado_em) VALUES (99,1,'OUTRA','restaurante',9,10,'2026-10-12T04:00:00.000Z')").run();
    return f.db.batch(statements);
  } };
  await assert.rejects(f.close({},9,{ ...f.env,DB:new TenantDb(measured,1) }),{ status:409 });
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM vendas').first().n,4);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM lancamentos').first().n,0);
  assert.equal(f.db.prepare('SELECT estoque_atual FROM produtos WHERE id=1').first().estoque_atual,12);
  assert.equal(f.db.prepare('SELECT status FROM comandas WHERE id=9').first().status,'aberta');
});

test('alteração de quantidade entre leitura e transação aborta cobrança de novos pedidos', async (t) => {
  const f = fixtureComPedidoNovo(t);
  const measured = { prepare:f.db.prepare.bind(f.db),batch(statements) {
    f.db.prepare('UPDATE comanda_itens SET quantidade=2 WHERE id=45').run();
    return f.db.batch(statements);
  } };
  await assert.rejects(f.close({},9,{ ...f.env,DB:new TenantDb(measured,1) }),{ status:409 });
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM vendas').first().n,3);
  assert.equal(f.db.prepare('SELECT estoque_atual FROM produtos WHERE id=1').first().estoque_atual,12);
});

test('falha financeira de pedido novo reverte tudo e permite nova tentativa sem duplicar histórico', async (t) => {
  const f = fixtureComPedidoNovo(t), before = financialSnapshot(f.db);
  f.db.db.exec("CREATE TRIGGER fail_new BEFORE INSERT ON caixa BEGIN SELECT RAISE(ABORT,'falha simulada'); END");
  await assert.rejects(f.close(),/falha simulada/);
  assert.deepEqual(financialSnapshot(f.db),before);
  assert.equal(f.db.prepare('SELECT status FROM comandas WHERE id=9').first().status,'aberta');
  f.db.db.exec('DROP TRIGGER fail_new');
  assert.equal((await f.close()).status,200);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM vendas').first().n,4);
  assertHistoricoPreservado(f.db,before);
});

test('duas baixas simultâneas de pedidos novos criam apenas uma venda e uma saída de estoque', async (t) => {
  const f = fixtureComPedidoNovo(t);
  const results = await Promise.all([f.close(),f.close()]);
  assert.deepEqual(results.map((result) => result.status).sort(),[200,409]);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM vendas').first().n,4);
  assert.equal(f.db.prepare('SELECT estoque_atual FROM produtos WHERE id=1').first().estoque_atual,11);
});

test('novos pedidos da comanda antiga também podem ser pagos individualmente', async (t) => {
  const f = fixtureComPedidoNovo(t), before = financialSnapshot(f.db);
  const result = await f.close({ tipo:'individual',taxa_garcom_pct:0 });
  assert.equal(result.status,200);
  assert.equal(result.data.pre_fechamento,true);
  assert.equal(result.data.total,10);
  assertHistoricoPreservado(f.db,before);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM vendas').first().n,3);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM comanda_itens WHERE comanda_id=?').bind(result.data.comanda_pagamentos_id).first().n,1);
  const pessoa = f.db.prepare('SELECT id FROM comanda_pessoas WHERE comanda_id=?').bind(result.data.comanda_pagamentos_id).first();
  const payment = await baixarPessoaComandaHandler(f.context({ pessoa_id:pessoa.id },result.data.comanda_pagamentos_id),f.env);
  assert.equal(payment.status,200);
  assert.equal(payment.data.fechou,true);
  assert.equal(payment.data.venda.total,10);
  assert.equal(f.db.prepare('SELECT status FROM mesas WHERE id=1').first().status,'livre');
  assert.deepEqual((await getComandaHandler(f.context(),f.env)).data.vendas_anteriores.map((venda) => venda.id),[3,4,5]);
  assertHistoricoPreservado(f.db,before);
});

test('vendas e itens de outra empresa não entram na validação dos novos pedidos', async (t) => {
  const f = fixtureComPedidoNovo(t);
  f.db.prepare("INSERT INTO vendas (estabelecimento_id,numero,tipo,comanda_id,total,criado_em) VALUES (2,'OUTRA','restaurante',10,999,'2099-01-01T00:00:00.000Z')").run();
  f.db.prepare("INSERT INTO comanda_itens (estabelecimento_id,comanda_id,nome,criado_em) VALUES (2,10,'Outra loja','2000-01-01T00:00:00.000Z')").run();
  assert.equal((await f.close({},10)).status,404);
  assert.equal((await f.close()).status,200);
  assert.equal(f.db.prepare('SELECT status FROM comandas WHERE id=10').first().status,'aberta');
  assert.equal(f.db.prepare('SELECT total FROM vendas WHERE estabelecimento_id=2').first().total,999);
});
