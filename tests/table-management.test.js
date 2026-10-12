import assert from 'node:assert/strict';
import test from 'node:test';
import SqliteDb from '../server/sqlite-db.js';
import { TenantDb } from '../shared/tenant-db.js';
import { transferirMesaHandler } from '../shared/restaurant-table-transfer.js';
import { abrirComandaHandler, createMesaHandler, deleteMesaHandler, fecharComandaHandler, getComandaHandler, updateMesaHandler } from '../shared/handlers-vendas.js';
import { handle } from '../shared/router.js';
import { sha256 } from '../shared/util.js';

function fixture(t) {
  const db = new SqliteDb(':memory:'); t.after(() => db.close());
  db.prepare("INSERT INTO estabelecimentos (id,nome) VALUES (1,'Salão'),(2,'Outra loja')").run();
  db.prepare(`INSERT INTO mesas (id,estabelecimento_id,numero,status,tipo) VALUES
    (1,1,1,'ocupada','normal'),(2,1,2,'ocupada','normal'),(3,1,3,'livre','normal'),
    (4,2,4,'ocupada','normal'),(5,1,999,'livre','pagamentos')`).run();
  db.prepare(`INSERT INTO comandas (id,estabelecimento_id,mesa_id,status,taxa_garcom_pct) VALUES
    (1,1,1,'aberta',10),(2,1,2,'aberta',0),(3,2,4,'aberta',0)`).run();
  db.prepare(`INSERT INTO comanda_pessoas (id,estabelecimento_id,comanda_id,nome,cor) VALUES
    (1,1,1,'Ana','#111111'),(2,1,1,'João','#222222'),(3,1,2,'Ana','#333333'),(4,2,3,'Outra','#444444')`).run();
  db.prepare(`INSERT INTO comanda_itens (id,estabelecimento_id,comanda_id,pessoa_id,nome,quantidade,preco_unitario,status,observacao,responsavel) VALUES
    (1,1,1,1,'Suco',2,10,'enviado','Sem gelo','Garçom'),(2,1,1,2,'Prato',1,40,'entregue','Sem cebola','Ana'),
    (3,1,1,NULL,'Água',3,5,'novo',NULL,'João'),(4,1,1,1,'Cancelado',1,30,'cancelado','Cancelado',NULL),
    (5,1,2,3,'Entrada',1,20,'entregue',NULL,NULL)`).run();
  const env = { DB: new TenantDb(db, 1), rawDB: db, estabelecimentoId: 1 };
  const context = (body = {}, id = 1) => ({ params: { id: String(id) }, user: { id: 9, nome: 'Garçom' }, req: { json: async () => body }, json: (data, status = 200) => ({ data, status }) });
  const snapshot = () => db.prepare("SELECT id,versao FROM comanda_itens WHERE comanda_id=1 AND status IN ('novo','enviado','entregue') ORDER BY id").all().results;
  const body = (extra = {}) => ({ chave: crypto.randomUUID(), mesa_destino_id: 2, comanda_destino_id: 2, liberar_origem: false, itens: snapshot(), ...extra });
  const move = (b = body(), id = 1, e = env) => transferirMesaHandler(context(b, id), e);
  return { db, env, context, snapshot, body, move };
}

test('transfere a mesa inteira sem copiar itens, misturar pessoas ou perder os dados do preparo', async (t) => {
  const f = fixture(t);
  const before = f.db.prepare('SELECT * FROM comanda_itens WHERE id<=3 ORDER BY id').all().results;
  const result = await f.move();
  assert.equal(result.status, 200);
  assert.equal(result.data.itens_count, 3);
  const people = f.db.prepare('SELECT * FROM comanda_pessoas WHERE comanda_id=2 ORDER BY id').all().results;
  assert.deepEqual(people.map((p) => p.nome), ['Ana','Ana','João']);
  assert.deepEqual(people.map((p) => p.cor), ['#333333','#111111','#222222']);
  const after = f.db.prepare('SELECT * FROM comanda_itens WHERE id<=3 ORDER BY id').all().results;
  after.forEach((item, i) => assert.deepEqual(item, { ...before[i], comanda_id: 2, pessoa_id: i === 2 ? null : people[i + 1].id, versao: 1 }));
  assert.equal(f.db.prepare('SELECT comanda_id FROM comanda_itens WHERE id=4').first().comanda_id, 1);
  assert.equal(f.db.prepare('SELECT pessoa_id FROM comanda_itens WHERE id=5').first().pessoa_id, 3);
  assert.equal((await getComandaHandler(f.context({}, 2), f.env)).data.subtotal, 95);
  assert.equal((await getComandaHandler(f.context(), f.env)).data.subtotal, 0);
  assert.equal(f.db.prepare('SELECT status FROM comandas WHERE id=1').first().status, 'aberta');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM comanda_itens').first().n, 5);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM comanda_item_transferencias').first().n, 3);
  for (const table of ['vendas','estoque_movimentacoes','gestor_jobs','device_tasks','pagamentos','caixa']) {
    assert.equal(f.db.prepare(`SELECT COUNT(*) n FROM ${table}`).first().n, 0, table);
  }
});

test('abre destino livre e libera origem somente quando solicitado, sem registrar venda', async (t) => {
  const f = fixture(t);
  const result = await f.move(f.body({ mesa_destino_id: 3, comanda_destino_id: null, liberar_origem: true }));
  assert.equal(result.status, 200);
  assert.equal(result.data.abriu_comanda, 1);
  assert.equal(result.data.liberou_origem, 1);
  const destination = (await getComandaHandler(f.context({}, result.data.comanda_destino_id), f.env)).data;
  assert.equal(destination.taxa_garcom_pct, 10);
  assert.equal(destination.subtotal, 75);
  assert.deepEqual(destination.pessoas.map((p) => p.nome), ['Ana','João']);
  assert.equal(destination.mesa.status, 'ocupada');
  assert.equal(f.db.prepare('SELECT status FROM mesas WHERE id=1').first().status, 'livre');
  assert.equal(f.db.prepare('SELECT status FROM comandas WHERE id=1').first().status, 'fechada');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM vendas').first().n, 0);
  assert.equal((await deleteMesaHandler(f.context(), f.env)).status, 200);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM comanda_itens WHERE comanda_id=1').first().n, 1);
});

test('transferência só de conta geral cria pessoa padrão no destino livre', async (t) => {
  const f = fixture(t); f.db.prepare('UPDATE comanda_itens SET pessoa_id=NULL WHERE comanda_id=1').run();
  const result = await f.move(f.body({ mesa_destino_id: 3, comanda_destino_id: null }));
  assert.equal(result.status, 200);
  const comanda = (await getComandaHandler(f.context({}, result.data.comanda_destino_id), f.env)).data;
  assert.equal(comanda.pessoas.length, 1);
  assert.ok(comanda.itens.every((i) => i.pessoa_id === null));
});

test('timeout/reenvio retorna a mesma transferência, mesmo com origem já fechada', async (t) => {
  const f = fixture(t), b = f.body({ mesa_destino_id: 3, comanda_destino_id: null, liberar_origem: true });
  const a = await f.move(b), z = await f.move(b);
  assert.equal(a.status, 200); assert.equal(z.status, 200);
  assert.equal(z.data.repetido, true);
  assert.equal(a.data.transferencia_id, z.data.transferencia_id);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM comandas WHERE mesa_id=3').first().n, 1);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM comanda_mesa_transferencias').first().n, 1);
  assert.equal((await f.move({ ...b, liberar_origem: false })).status, 409);
});

test('duas tentativas simultâneas com a mesma chave não duplicam pessoas nem comandos', async (t) => {
  const f = fixture(t), b = f.body();
  const results = await Promise.all([f.move(b), f.move(b)]);
  assert.deepEqual(results.map((r) => r.status), [200,200]);
  assert.equal(results.filter((r) => r.data.repetido).length, 1);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM comanda_pessoas WHERE comanda_id=2').first().n, 3);
});

test('duas intenções disputando os mesmos produtos têm somente um vencedor', async (t) => {
  const f = fixture(t);
  const results = await Promise.all([f.move(), f.move(f.body({ mesa_destino_id: 3, comanda_destino_id: null }))]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200,409]);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM comanda_mesa_transferencias').first().n, 1);
});

for (const mutation of [
  "UPDATE comanda_itens SET observacao='Mudou' WHERE id=1",
  "UPDATE comanda_itens SET status='cancelado' WHERE id=1",
  "INSERT INTO comanda_itens (estabelecimento_id,comanda_id,nome) VALUES (1,1,'Novo pedido')",
]) test(`lista desatualizada recusa tudo, inclusive abertura do destino: ${mutation}`, async (t) => {
  const f = fixture(t), b = f.body({ mesa_destino_id: 3, comanda_destino_id: null });
  f.db.prepare(mutation).run();
  assert.equal((await f.move(b)).status, 409);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM comandas WHERE mesa_id=3').first().n, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM comanda_mesa_transferencias').first().n, 0);
  assert.equal(f.db.prepare('SELECT comanda_id FROM comanda_itens WHERE id=2').first().comanda_id, 1);
});

test('não transfere durante pagamento/fechamento nem quando houver venda antiga a revisar', async (t) => {
  for (const mutation of [
    "UPDATE comandas SET status='pre_fechamento' WHERE id=1",
    "UPDATE comandas SET status='pre_fechamento' WHERE id=2",
    "UPDATE comandas SET fechamento_bloqueado_ate='2999-01-01' WHERE id=1",
    "UPDATE comandas SET fechamento_bloqueado_ate='2999-01-01' WHERE id=2",
    "UPDATE comanda_pessoas SET status='baixado' WHERE id=1",
    "INSERT INTO vendas (estabelecimento_id,numero,tipo,comanda_id) VALUES (1,'Teste','restaurante',1)",
    "INSERT INTO vendas (estabelecimento_id,numero,tipo,comanda_id) VALUES (1,'Teste','restaurante',2)",
  ]) {
    const f = fixture(t); f.db.prepare(mutation).run();
    assert.equal((await f.move()).status, 409, mutation);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM comanda_mesa_transferencias').first().n, 0);
  }
});

test('não mistura empresas nem usa mesas especiais, inativas, ocupadas sem a comanda ou a própria origem', async (t) => {
  const f = fixture(t);
  for (const [changes, expected] of [
    [{ mesa_destino_id: 4, comanda_destino_id: 3 },404],
    [{ mesa_destino_id: 5, comanda_destino_id: null },404],
    [{ mesa_destino_id: 1, comanda_destino_id: 1 },400],
    [{ mesa_destino_id: 2, comanda_destino_id: null },409],
    [{ mesa_destino_id: 3, comanda_destino_id: 2 },409],
  ]) assert.equal((await f.move(f.body(changes))).status, expected);
  assert.equal((await f.move(f.body(), 3)).status, 404);
  f.db.prepare('UPDATE mesas SET ativo=0 WHERE id=3').run();
  assert.equal((await f.move(f.body({ mesa_destino_id: 3, comanda_destino_id: null }))).status, 404);
});

test('perdas ficam na origem e impedem sua liberação automática', async (t) => {
  const f = fixture(t);
  f.db.prepare("INSERT INTO comanda_itens (estabelecimento_id,comanda_id,nome,status) VALUES (1,1,'Perda','perda')").run();
  assert.equal((await f.move(f.body({ liberar_origem: true }))).status, 409);
  assert.equal((await f.move()).status, 200);
  assert.equal(f.db.prepare("SELECT comanda_id FROM comanda_itens WHERE status='perda'").first().comanda_id, 1);
});

test('falha em qualquer item reverte todos os itens, pessoas, abertura e liberação', async (t) => {
  const f = fixture(t), b = f.body({ mesa_destino_id: 3, comanda_destino_id: null, liberar_origem: true });
  f.db.db.exec("CREATE TRIGGER fail_transfer BEFORE UPDATE OF comanda_id ON comanda_itens WHEN NEW.id=2 BEGIN SELECT RAISE(ABORT,'falha simulada'); END");
  await assert.rejects(f.move(b), /falha simulada/);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM comandas').first().n, 3);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM comanda_pessoas').first().n, 4);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM comanda_item_transferencias').first().n, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM comanda_mesa_transferencias').first().n, 0);
  assert.equal(f.db.prepare('SELECT status FROM mesas WHERE id=1').first().status, 'ocupada');
  f.db.db.exec('DROP TRIGGER fail_transfer');
  assert.equal((await f.move(b)).status, 200);
});

test('500 lançamentos são transferidos em um lote com número fixo de consultas', async (t) => {
  const f = fixture(t);
  for (let i = 6; i <= 502; i++) f.db.prepare("INSERT INTO comanda_itens (id,estabelecimento_id,comanda_id,pessoa_id,nome) VALUES (?,1,1,1,'Produto')").bind(i).run();
  let queries = 0;
  const statements = new WeakMap();
  const measured = {
    prepare(sql) {
      const original = f.db.prepare(sql);
      const wrapped = {
        bind(...params) { original.bind(...params); return wrapped; },
        first() { queries++; return original.first(); },
        all() { queries++; return original.all(); },
        run() { queries++; return original.run(); },
      }; statements.set(wrapped, original); return wrapped;
    },
    batch(ss) { queries += ss.length; return f.db.batch(ss.map((s) => statements.get(s))); },
  };
  const result = await f.move(f.body(), 1, { ...f.env, DB: new TenantDb(measured,1), rawDB: measured });
  assert.equal(result.status, 200);
  assert.equal(result.data.itens_count, 500);
  assert.ok(queries < 40);
  t.diagnostic(`${queries} consultas para transferir 500 lançamentos`);
});

test('após transferência, destino fecha com o total combinado e a origem não cobra os produtos movidos', async (t) => {
  const f = fixture(t);
  f.db.prepare("INSERT INTO produtos (id,estabelecimento_id,nome,preco,custo,estoque_atual) VALUES (1,1,'Produto de teste',10,1,20)").run();
  f.db.prepare("UPDATE comanda_itens SET produto_id=1 WHERE status!='cancelado'").run();
  await f.move();
  assert.equal(f.db.prepare('SELECT estoque_atual FROM produtos WHERE id=1').first().estoque_atual, 20);
  const result = await fecharComandaHandler(f.context({ taxa_garcom_pct: 0 }, 2), f.env);
  assert.equal(result.status, 200);
  assert.equal(result.data.total, 95);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM venda_itens').first().n, 4);
  assert.equal(f.db.prepare('SELECT estoque_atual FROM produtos WHERE id=1').first().estoque_atual, 13);
  assert.equal((await getComandaHandler(f.context(), f.env)).data.subtotal, 0);
});

test('valida lista de itens e chave antes de qualquer alteração', async (t) => {
  const f = fixture(t);
  for (const changes of [{ itens: [] }, { itens: [{ id: 1, versao: 0 },{ id: 1, versao: 0 }] }, { itens: [{ id: 1, versao: -1 }] }, { chave: 'x' }, { liberar_origem: 'true' }, { mesa_destino_id: -1 }]) {
    assert.equal((await f.move(f.body(changes))).status, 400);
  }
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM comanda_mesa_transferencias').first().n, 0);
});

test('excluir mesa é lógico e preserva comandas e vendas antigas; repetir exclusão é seguro', async (t) => {
  const f = fixture(t);
  f.db.prepare("UPDATE comandas SET status='fechada' WHERE id=1").run();
  f.db.prepare("UPDATE mesas SET status='livre' WHERE id=1").run();
  f.db.prepare("INSERT INTO vendas (estabelecimento_id,numero,tipo,comanda_id,mesa_id) VALUES (1,'Antiga','restaurante',1,1)").run();
  assert.equal((await deleteMesaHandler(f.context(), f.env)).status, 200);
  assert.equal((await deleteMesaHandler(f.context(), f.env)).status, 200);
  assert.equal(f.db.prepare('SELECT ativo FROM mesas WHERE id=1').first().ativo, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM vendas').first().n, 1);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM comanda_itens').first().n, 5);
  assert.equal((await getComandaHandler(f.context(), f.env)).status, 200);
});

test('não exclui comanda aberta/pré-fechada, mesa ocupada, especial ou de outra empresa', async (t) => {
  const f = fixture(t);
  assert.equal((await deleteMesaHandler(f.context(), f.env)).status, 409);
  f.db.prepare("UPDATE mesas SET status='livre' WHERE id=1").run();
  assert.equal((await deleteMesaHandler(f.context(), f.env)).status, 409);
  f.db.prepare("UPDATE comandas SET status='pre_fechamento' WHERE id=1").run();
  assert.equal((await deleteMesaHandler(f.context(), f.env)).status, 409);
  assert.equal((await deleteMesaHandler(f.context({}, 4), f.env)).status, 404);
  assert.equal((await deleteMesaHandler(f.context({}, 5), f.env)).status, 400);
  assert.equal((await updateMesaHandler(f.context({ ativo: false }), f.env)).status, 409);
  assert.equal(f.db.prepare('SELECT ativo FROM mesas WHERE id=1').first().ativo, 1);
});

test('mesa excluída não pode ser aberta, nem por chamada antiga após exclusão concorrente', async (t) => {
  const f = fixture(t);
  assert.equal((await deleteMesaHandler(f.context({}, 3), f.env)).status, 200);
  assert.equal((await abrirComandaHandler(f.context({}, 3), f.env)).status, 404);
  assert.throws(() => f.db.prepare("INSERT INTO comandas (estabelecimento_id,mesa_id,status) VALUES (1,3,'aberta')").run(), /mesa_inativa/);
  const id = f.db.prepare("INSERT INTO comandas (estabelecimento_id,mesa_id,status) VALUES (1,3,'fechada')").run().meta.last_row_id;
  assert.throws(() => f.db.prepare("UPDATE comandas SET status='aberta' WHERE id=?").bind(id).run(), /mesa_inativa/);
});

test('exclusão que vence a abertura concorrente retorna conflito sem deixar comanda oculta', async (t) => {
  const f = fixture(t);
  let deleting;
  const env = { ...f.env, DB: { prepare(sql) {
    const statement = f.env.DB.prepare(sql);
    if (sql === 'SELECT * FROM mesas WHERE id=?') {
      const first = statement.first.bind(statement);
      statement.first = async () => {
        const old = await first();
        deleting = await deleteMesaHandler(f.context({}, 3), f.env);
        return old;
      };
    }
    return statement;
  }, batch: f.env.DB.batch.bind(f.env.DB) } };
  const opening = await abrirComandaHandler(f.context({}, 3), env);
  assert.equal(deleting.status, 200);
  assert.equal(opening.status, 409);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM comandas WHERE mesa_id=3').first().n, 0);
});

test('abertura que vence a exclusão concorrente impede desativar a mesa', async (t) => {
  const f = fixture(t);
  const env = { ...f.env, rawDB: { prepare(sql) {
    const statement = f.db.prepare(sql);
    if (sql.startsWith('UPDATE mesas SET ativo=0')) {
      const run = statement.run.bind(statement);
      statement.run = () => {
        f.db.prepare("INSERT INTO comandas (estabelecimento_id,mesa_id,status) VALUES (1,3,'aberta')").run();
        return run();
      };
    }
    return statement;
  } } };
  assert.equal((await deleteMesaHandler(f.context({}, 3), env)).status, 409);
  assert.equal(f.db.prepare('SELECT ativo FROM mesas WHERE id=3').first().ativo, 1);
});

test('recusa origem ou destino com duas comandas ativas sem mover nenhum produto', async (t) => {
  for (const mesaId of [1,2]) {
    const f = fixture(t);
    f.db.prepare("INSERT INTO comandas (estabelecimento_id,mesa_id,status) VALUES (1,?,'aberta')").bind(mesaId).run();
    assert.equal((await f.move(f.body({ liberar_origem: true }))).status, 409);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM comanda_item_transferencias').first().n, 0);
  }
});

test('reservas e conteúdo de impressão continuam vinculados aos mesmos itens após mover a mesa', async (t) => {
  const f = fixture(t);
  f.db.prepare("INSERT INTO pedido_impressoes (estabelecimento_id,item_id,impressora_id,lote_id,conteudo_item,criado_em) VALUES (1,1,1,'ticket-antigo','2x Suco sem gelo','2026-10-11')").run();
  const before = f.db.prepare('SELECT * FROM pedido_impressoes').all().results;
  assert.equal((await f.move()).status, 200);
  assert.deepEqual(f.db.prepare('SELECT * FROM pedido_impressoes').all().results, before);
  const dest = (await getComandaHandler(f.context({}, 2), f.env)).data;
  assert.equal(dest.itens.find((i) => i.id === 1).impressoes.length, 1);
});

test('recriar mesa excluída reutiliza o número sem apagar seu histórico e números ativos dão conflito', async (t) => {
  const f = fixture(t);
  await deleteMesaHandler(f.context({}, 3), f.env);
  const result = await createMesaHandler(f.context({ numero: 3, capacidade: 6, setor: 'Varanda' }), f.env);
  assert.equal(result.status, 201);
  assert.equal(result.data.id, 3);
  assert.equal(result.data.ativo, 1);
  assert.equal((await createMesaHandler(f.context({ numero: 3 }), f.env)).status, 409);
  assert.equal((await createMesaHandler(f.context({ numero: 6 }), f.env)).status, 201);
  assert.equal((await abrirComandaHandler(f.context({}, 3), f.env)).status, 201);
});

test('novas operações exigem sessão autenticada', async (t) => {
  const f = fixture(t);
  for (const [method, url] of [['POST','/api/comandas/1/transferir-mesa'],['DELETE','/api/mesas/3']]) {
    const response = await handle({ req: { path: url, method, header: () => '', query: () => '' }, json: (data, status) => ({ data, status }) }, { DB: f.db });
    assert.equal(response.status, 401);
  }
});

test('rotas autorizadas respeitam módulo, área e isolamento entre estabelecimentos', async (t) => {
  const f = fixture(t);
  f.db.prepare("INSERT INTO funcionarios (id,estabelecimento_id,nome,usuario,senha_hash,modulos) VALUES (9,1,'Teste','teste','hash','restaurante,area:vendas')").run();
  f.db.prepare("INSERT INTO sessoes (estabelecimento_id,funcionario_id,token_hash,expira_em) VALUES (1,9,?,'2099-01-01')").bind(await sha256('mesas-teste')).run();
  const request = (path, method, body = {}) => handle({ req: { path,method,header: (key) => key === 'cookie' ? 'simplesx_session=mesas-teste' : '',query: () => '',json: async () => body },json: (data,status = 200) => ({ data,status }) },{ DB:f.db });
  assert.equal((await request('/api/mesas/3','DELETE')).status,403,'garçom não exclui mesas');
  assert.equal((await request('/api/comandas/3/transferir-mesa','POST',f.body())).status,404,'origem de outra loja');
  assert.equal((await request('/api/comandas/1/transferir-mesa','POST',f.body({ mesa_destino_id:4,comanda_destino_id:3 }))).status,404);
  f.db.prepare("UPDATE funcionarios SET modulos='gestor,area:estoque' WHERE id=9").run();
  assert.equal((await request('/api/mesas/3','DELETE')).status,403,'gestor sem área de vendas');
  f.db.prepare("UPDATE funcionarios SET modulos='gestor,area:vendas' WHERE id=9").run();
  assert.equal((await request('/api/mesas/4','DELETE')).status,404,'mesa de outra loja');
  assert.equal((await request('/api/comandas/1/transferir-mesa','POST',f.body())).status,200);
  assert.equal((await request('/api/mesas/3','DELETE')).status,200);
});
