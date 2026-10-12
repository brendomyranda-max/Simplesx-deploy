import assert from 'node:assert/strict';
import test from 'node:test';
import SqliteDb from '../server/sqlite-db.js';
import { TenantDb } from '../shared/tenant-db.js';
import { cancelarComandaHandler } from '../shared/restaurant-cancel.js';
import { getComandaHandler } from '../shared/handlers-vendas.js';
import { handle } from '../shared/router.js';
import { sha256 } from '../shared/util.js';

function fixture(t) {
  const db = new SqliteDb(':memory:'); t.after(() => db.close());
  db.prepare("INSERT INTO estabelecimentos (id,nome) VALUES (1,'Salão'),(2,'Outra loja')").run();
  db.prepare("INSERT INTO mesas (id,estabelecimento_id,numero,status,tipo) VALUES (2,1,2,'ocupada','normal'),(10,2,2,'ocupada','normal'),(999,1,999,'ocupada','pagamentos')").run();
  db.prepare("INSERT INTO comandas (id,estabelecimento_id,mesa_id,status) VALUES (9,1,2,'aberta'),(10,2,10,'aberta')").run();
  db.prepare("INSERT INTO produtos (id,estabelecimento_id,nome,estoque_atual) VALUES (1,1,'Produto',12)").run();
  const antigo = new Date(Date.now()-10*60_000).toISOString();
  for (const [id,status] of [[1,'novo'],[2,'enviado'],[3,'entregue'],[4,'cancelado'],[5,'perda']]) {
    db.prepare(`INSERT INTO comanda_itens (id,estabelecimento_id,comanda_id,produto_id,nome,quantidade,preco_unitario,status,criado_em)
      VALUES (?,1,9,1,?,1,10,?,?)`).bind(id,`Pedido ${id}`,status,antigo).run();
  }
  db.prepare("INSERT INTO perdas (estabelecimento_id,produto_id,quantidade,valor_unitario,motivo,comanda_id,item_id) VALUES (1,1,1,10,'Perda anterior',9,5)").run();
  const env = { DB:new TenantDb(db,1),rawDB:db,estabelecimentoId:1 };
  const body = () => ({ chave:crypto.randomUUID(),confirmar:true,motivo:'Teste de cancelamento total',
    itens:db.prepare("SELECT id,versao FROM comanda_itens WHERE comanda_id=9 AND status!='cancelado' ORDER BY id").all().results });
  const context = (b = body(), id = 9) => ({ params:{ id:String(id) },user:{ id:1,nome:'Gestor' },req:{ json:async () => b },json:(data,status=200) => ({ data,status }) });
  const cancel = (b = body(), id = 9, e = env) => cancelarComandaHandler(context(b,id),e);
  const legacy = () => {
    for (const id of [3,4,5]) {
      db.prepare("INSERT INTO vendas (id,estabelecimento_id,numero,tipo,comanda_id,mesa_id,total,criado_em) VALUES (?,1,?,'restaurante',9,2,100,?)")
        .bind(id,`ANTIGA-${id}`,new Date(Date.now()-id*20*60_000).toISOString()).run();
      db.prepare("INSERT INTO venda_itens (estabelecimento_id,venda_id,produto_id,nome,quantidade,preco_unitario,total) VALUES (1,?,1,'Anterior',1,100,100)").bind(id).run();
      db.prepare("INSERT INTO pagamentos (estabelecimento_id,venda_id,forma,valor) VALUES (1,?,'pix',100)").bind(id).run();
      db.prepare("INSERT INTO estoque_movimentacoes (estabelecimento_id,produto_id,tipo,quantidade,saldo_apos,origem,ref_id) VALUES (1,1,'saida',1,12,'venda',?)").bind(id).run();
    }
  };
  return { db,env,body,context,cancel,legacy };
}

const snapshot = (db, tables) => Object.fromEntries(tables.map((table) => [table,db.prepare(`SELECT * FROM ${table} ORDER BY id`).all().results]));
const financial = (db) => snapshot(db,['vendas','venda_itens','pagamentos','produtos','estoque_movimentacoes','lancamentos','caixa']);
const all = (db) => ({ ...financial(db),...snapshot(db,['comandas','mesas','comanda_itens','perdas','comanda_cancelamentos']) });

test('Gestor cancela pedidos, preserva perdas e libera mesa sem venda, estorno ou estoque', async (t) => {
  for (const status of ['aberta','pre_fechamento']) {
    const f = fixture(t); f.db.prepare('UPDATE comandas SET status=? WHERE id=9').bind(status).run();
    const before = financial(f.db), loss = f.db.prepare('SELECT * FROM perdas WHERE item_id=5').first();
    const result = await f.cancel();
    assert.equal(result.status,200);
    assert.equal(result.data.itens_cancelados,3);
    assert.equal(result.data.mesa_liberada,true);
    assert.deepEqual(financial(f.db),before);
    assert.deepEqual(f.db.prepare('SELECT * FROM perdas WHERE item_id=5').first(),loss);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM perdas').first().n,4);
    assert.deepEqual(f.db.prepare('SELECT status FROM comanda_itens ORDER BY id').all().results.map((i) => i.status),['cancelado','cancelado','cancelado','cancelado','perda']);
    const command = f.db.prepare('SELECT * FROM comandas WHERE id=9').first();
    assert.equal(command.status,'fechada');
    assert.equal(command.fechamento_tipo,'cancelada');
    assert.equal(command.baixada_em,null);
    assert.ok(command.fechada_em);
    assert.equal(f.db.prepare('SELECT status FROM mesas WHERE id=2').first().status,'livre');
    const audit = f.db.prepare('SELECT * FROM comanda_cancelamentos').first();
    assert.equal(audit.funcionario_id,1);
    assert.equal(audit.motivo,'Teste de cancelamento total');
    assert.deepEqual(JSON.parse(audit.itens_json).map((i) => i.status),['novo','enviado','entregue','perda']);
    assert.deepEqual(JSON.parse(audit.vendas_json),[]);
  }
});

test('mesa 2 com três vendas antigas pode cancelar sem alterar nenhum registro financeiro', async (t) => {
  const f = fixture(t); f.legacy(); const before = financial(f.db);
  const result = await f.cancel();
  assert.equal(result.status,200);
  assert.deepEqual(result.data.vendas_anteriores,[3,4,5]);
  assert.deepEqual(financial(f.db),before);
  assert.deepEqual((await getComandaHandler(f.context(),f.env)).data.vendas_anteriores.map((v) => v.id),[3,4,5]);
  assert.equal(f.db.prepare('SELECT status FROM mesas WHERE id=2').first().status,'livre');
});

test('pedidos que possam ter sido vendidos antes não geram outra perda', async (t) => {
  const f = fixture(t); f.legacy();
  f.db.prepare("UPDATE comanda_itens SET criado_em='2000-01-01T00:00:00.000Z'").run();
  assert.equal((await f.cancel()).status,200);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM perdas').first().n,1);
});

test('cancelamento recente respeita a tolerância antes de registrar perda', async (t) => {
  const f = fixture(t);
  f.db.prepare('UPDATE comanda_itens SET criado_em=?').bind(new Date().toISOString()).run();
  assert.equal((await f.cancel()).status,200);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM perdas').first().n,1);
});

test('confirmação, motivo, chave e lista inválidos não alteram a comanda', async (t) => {
  const f = fixture(t), before = all(f.db);
  for (const changes of [{ confirmar:false },{ confirmar:'true' },{ motivo:'' },{ motivo:'ab' },{ motivo:'a'.repeat(301) },{ chave:'curta' },{ itens:null },{ itens:[{ id:1,versao:-1 }] },{ itens:[{ id:1,versao:0 },{ id:1,versao:0 }] }]) {
    assert.equal((await f.cancel({ ...f.body(),...changes })).status,400);
    assert.deepEqual(all(f.db),before);
  }
});

test('resposta perdida e reenvio não repetem perdas nem liberam a próxima ocupação', async (t) => {
  const f = fixture(t), body = f.body();
  assert.equal((await f.cancel(body)).status,200);
  f.db.prepare("INSERT INTO comandas (estabelecimento_id,mesa_id,status) VALUES (1,2,'aberta')").run();
  f.db.prepare("UPDATE mesas SET status='ocupada' WHERE id=2").run();
  const before = all(f.db), result = await f.cancel(body);
  assert.equal(result.status,200);
  assert.equal(result.data.repetido,true);
  assert.deepEqual(all(f.db),before);
  assert.equal(f.db.prepare('SELECT status FROM mesas WHERE id=2').first().status,'ocupada');
});

test('mesma chave com outro conteúdo não cancela uma operação diferente', async (t) => {
  const f = fixture(t), body = f.body(); await f.cancel(body); const before = all(f.db);
  assert.equal((await f.cancel({ ...body,motivo:'Outro motivo' })).status,409);
  assert.deepEqual(all(f.db),before);
});

test('duas confirmações da mesma intenção cancelam uma única vez', async (t) => {
  const f = fixture(t), body = f.body();
  const results = await Promise.all([f.cancel(body),f.cancel(body)]);
  assert.deepEqual(results.map((r) => r.status),[200,200]);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM comanda_cancelamentos').first().n,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM perdas').first().n,4);
});

test('duas intenções simultâneas para a mesma comanda têm somente um vencedor', async (t) => {
  const f = fixture(t);
  const results = await Promise.all([f.cancel(f.body()),f.cancel(f.body())]);
  assert.deepEqual(results.map((r) => r.status).sort(),[200,409]);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM comanda_cancelamentos').first().n,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM perdas').first().n,4);
});

test('snapshot desatualizado, incompleto ou com item extra recusa o cancelamento inteiro', async (t) => {
  for (const change of ['versao','ausente','extra']) {
    const f = fixture(t), body = f.body();
    if (change === 'versao') body.itens[0].versao++;
    if (change === 'ausente') body.itens.pop();
    if (change === 'extra') body.itens.push({ id:9999,versao:0 });
    const before = all(f.db);
    assert.equal((await f.cancel(body)).status,409);
    assert.deepEqual(all(f.db),before);
  }
});

test('fechamento real em andamento bloqueia cancelamento; reserva expirada não prende a mesa', async (t) => {
  const f = fixture(t);
  f.db.prepare("UPDATE comandas SET fechamento_bloqueado_ate='2999-01-01' WHERE id=9").run();
  const before = all(f.db);
  assert.equal((await f.cancel()).status,409);
  assert.deepEqual(all(f.db),before);
  f.db.prepare("UPDATE comandas SET fechamento_bloqueado_ate='2000-01-01' WHERE id=9").run();
  assert.equal((await f.cancel()).status,200);
  assert.equal(f.db.prepare('SELECT fechamento_bloqueado_ate FROM comandas WHERE id=9').first().fechamento_bloqueado_ate,null);
});

test('não cancela pagamento individual, pessoa paga, mesa duplicada, conta fechada ou mesa especial', async (t) => {
  for (const sql of [
    "INSERT INTO comandas (estabelecimento_id,mesa_id,status,comanda_origem_id) VALUES (1,999,'pre_fechamento',9)",
    "INSERT INTO comanda_pessoas (estabelecimento_id,comanda_id,nome,status) VALUES (1,9,'Pago','baixado')",
    "INSERT INTO comandas (estabelecimento_id,mesa_id,status) VALUES (1,2,'aberta')",
    "UPDATE comandas SET status='fechada' WHERE id=9",
    "UPDATE comandas SET comanda_origem_id=10 WHERE id=9",
    "UPDATE mesas SET tipo='online' WHERE id=2",
    "UPDATE mesas SET ativo=0 WHERE id=2",
  ]) {
    const f = fixture(t); f.db.prepare(sql).run(); const before = all(f.db);
    assert.equal((await f.cancel()).status,409);
    assert.deepEqual(all(f.db),before);
  }
});

test('pedido adicionado entre confirmação e transação impede cancelar silenciosamente o consumo novo', async (t) => {
  const f = fixture(t), body = f.body();
  const env = { ...f.env,rawDB:{ prepare:f.db.prepare.bind(f.db),batch(statements) {
    f.db.prepare("INSERT INTO comanda_itens (estabelecimento_id,comanda_id,nome) VALUES (1,9,'Pedido concorrente')").run();
    return f.db.batch(statements);
  } } };
  assert.equal((await f.cancel(body,9,env)).status,409);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM comanda_cancelamentos').first().n,0);
  assert.equal(f.db.prepare('SELECT status FROM mesas WHERE id=2').first().status,'ocupada');
  assert.equal(f.db.prepare('SELECT status FROM comanda_itens WHERE id=1').first().status,'novo');
});

test('falha ao liberar mesa reverte cancelamentos, perdas e auditoria; nova tentativa funciona', async (t) => {
  const f = fixture(t), body = f.body(), before = all(f.db);
  f.db.db.exec("CREATE TRIGGER fail_cancel BEFORE UPDATE ON mesas BEGIN SELECT RAISE(ABORT,'falha simulada'); END");
  await assert.rejects(f.cancel(body),/falha simulada/);
  assert.deepEqual(all(f.db),before);
  f.db.db.exec('DROP TRIGGER fail_cancel');
  assert.equal((await f.cancel(body)).status,200);
});

test('cancelamento vazio também libera comanda antiga sem apagar as vendas', async (t) => {
  const f = fixture(t); f.legacy();
  f.db.prepare("UPDATE comanda_itens SET status='cancelado'").run();
  const before = financial(f.db);
  assert.equal((await f.cancel()).status,200);
  assert.deepEqual(financial(f.db),before);
});

test('comandas de outra empresa não são canceladas nem entram na auditoria', async (t) => {
  const f = fixture(t), before = all(f.db);
  assert.equal((await f.cancel(f.body(),10)).status,404);
  assert.deepEqual(all(f.db),before);
  assert.equal((await f.cancel()).status,200);
  assert.equal(f.db.prepare('SELECT status FROM comandas WHERE id=10').first().status,'aberta');
});

test('rota exige login, módulo Gestor e área de vendas', async (t) => {
  const f = fixture(t);
  const request = (token = '',body = f.body()) => handle({ req:{ path:'/api/comandas/9/cancelar',method:'POST',header:(key) => key === 'cookie' ? `simplesx_session=${token}` : '',query:() => '',json:async () => body },json:(data,status=200) => ({ data,status }) },{ DB:f.db });
  assert.equal((await request()).status,401);
  for (const [id,modulos] of [[1,'restaurante,area:vendas'],[2,'gestor,area:estoque'],[3,'gestor,area:vendas']]) {
    f.db.prepare('INSERT INTO funcionarios (id,estabelecimento_id,nome,usuario,senha_hash,modulos,perfil) VALUES (?,1,?,?,\'hash\',?,\'admin\')').bind(id,`Pessoa ${id}`,`pessoa${id}`,modulos).run();
    f.db.prepare("INSERT INTO sessoes (estabelecimento_id,funcionario_id,token_hash,expira_em) VALUES (1,?,?,'2099-01-01')").bind(id,await sha256(`cancel-${id}`)).run();
  }
  assert.equal((await request('cancel-1')).status,403);
  assert.equal((await request('cancel-2')).status,403);
  assert.equal((await request('cancel-3')).status,200);
});
