import assert from 'node:assert/strict';
import test from 'node:test';
import SqliteDb from '../server/sqlite-db.js';
import { TenantDb } from '../shared/tenant-db.js';
import { fecharComandaHandler, getComandaHandler } from '../shared/handlers-vendas.js';

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
