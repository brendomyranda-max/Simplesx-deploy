import assert from 'node:assert/strict';
import test from 'node:test';
import SqliteDb from '../server/sqlite-db.js';
import { TenantDb } from '../shared/tenant-db.js';
import { removePessoaHandler } from '../shared/handlers-vendas.js';

function fixture(t) {
  const db = new SqliteDb(':memory:'); t.after(() => db.close());
  db.prepare("INSERT INTO estabelecimentos (id,nome) VALUES (1,'Salão'),(2,'Outra loja')").run();
  db.prepare('INSERT INTO mesas (id,estabelecimento_id,numero) VALUES (1,1,1),(2,1,2),(3,2,1)').run();
  db.prepare(`INSERT INTO comandas (id,estabelecimento_id,mesa_id,pessoas_count) VALUES
    (1,1,1,2),(2,1,2,1),(3,2,3,1)`).run();
  db.prepare(`INSERT INTO comanda_pessoas (id,estabelecimento_id,comanda_id,nome) VALUES
    (1,1,1,'Ana'),(2,1,1,'João'),(3,1,2,'Outra mesa'),(4,2,3,'Outra loja')`).run();
  db.prepare(`INSERT INTO comanda_itens
    (id,estabelecimento_id,comanda_id,pessoa_id,nome,quantidade,preco_unitario,status,observacao) VALUES
    (1,1,1,1,'Suco',2,10,'enviado','Sem gelo'),(2,1,1,2,'Prato',1,40,'entregue','Sem cebola'),
    (3,1,2,3,'Água',1,5,'novo',NULL),(4,2,3,4,'Café',1,7,'novo',NULL)`).run();
  const env = { DB: new TenantDb(db, 1), rawDB: db, estabelecimentoId: 1 };
  const context = (pid = 1, id = 1) => ({ params: { id: String(id), pid: String(pid) },
    json: (data, status = 200) => ({ data, status }) });
  const remove = (pid, id, environment = env) => removePessoaHandler(context(pid, id), environment);
  return { db, env, context, remove };
}

test('remover pessoa preserva pedidos, preço e preparo na conta geral e atualiza a divisão', async (t) => {
  const f = fixture(t);
  const before = f.db.prepare('SELECT * FROM comanda_itens ORDER BY id').all().results;
  assert.equal((await f.remove(1)).status, 200);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM comanda_pessoas WHERE id=1').first().n, 0);
  assert.equal(f.db.prepare('SELECT pessoas_count FROM comandas WHERE id=1').first().pessoas_count, 1);
  const after = f.db.prepare('SELECT * FROM comanda_itens ORDER BY id').all().results;
  assert.deepEqual(after, before.map((item) => item.id === 1 ? { ...item, pessoa_id: null, versao: item.versao + 1 } : item));
  assert.equal((await f.remove(2)).status, 200);
  assert.equal(f.db.prepare('SELECT pessoas_count FROM comandas WHERE id=1').first().pessoas_count, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM comanda_itens').first().n, 4);
});

test('pessoa de outra comanda ou estabelecimento não pode ser removida pela URL atual', async (t) => {
  const f = fixture(t);
  const before = f.db.prepare('SELECT * FROM comanda_itens ORDER BY id').all().results;
  for (const [pessoa, comanda] of [[3,1],[4,1],[4,3],[999,1]]) {
    assert.equal((await f.remove(pessoa, comanda)).status, 404);
  }
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM comanda_pessoas').first().n, 4);
  assert.deepEqual(f.db.prepare('SELECT * FROM comanda_itens ORDER BY id').all().results, before);
});

test('falha na atualização da contagem reverte remoção e vínculo dos pedidos', async (t) => {
  const f = fixture(t);
  const before = f.db.prepare('SELECT * FROM comanda_itens ORDER BY id').all().results;
  const command = f.db.prepare('SELECT * FROM comandas WHERE id=1').first();
  f.db.db.exec("CREATE TRIGGER falha_contagem_remocao BEFORE UPDATE OF pessoas_count ON comandas BEGIN SELECT RAISE(ABORT,'falha simulada'); END");
  await assert.rejects(f.remove(1), /falha simulada/);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM comanda_pessoas WHERE id=1').first().n, 1);
  assert.deepEqual(f.db.prepare('SELECT * FROM comanda_itens ORDER BY id').all().results, before);
  assert.deepEqual(f.db.prepare('SELECT * FROM comandas WHERE id=1').first(), command);
});

test('preserva pessoa com cartão em atendimento e bloqueia mudanças durante fechamento', async (t) => {
  const f = fixture(t);
  f.db.prepare(`INSERT INTO cartao_atendimentos
    (id,estabelecimento_id,chave,conteudo_hash,cartao,mesa_id,comanda_id,pessoa_id,cliente_nome,criado_em)
    VALUES ('atendimento',1,'chave','hash','001',1,1,1,'Ana','2026-10-20')`).run();
  assert.equal((await f.remove(1)).status, 409);
  for (const status of ['pre_fechamento', 'fechada']) {
    f.db.prepare('UPDATE comandas SET status=? WHERE id=1').bind(status).run();
    assert.equal((await f.remove(2)).status, 409);
  }
  f.db.prepare("UPDATE comandas SET status='aberta',fechamento_bloqueado_ate=? WHERE id=1")
    .bind(new Date(Date.now() + 60000).toISOString()).run();
  assert.equal((await f.remove(2)).status, 409);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM comanda_pessoas').first().n, 4);
  assert.equal(f.db.prepare('SELECT pessoa_id FROM comanda_itens WHERE id=1').first().pessoa_id, 1);
});

test('cartão vinculado após a leitura inicial impede remoção e reverte desvinculação dos pedidos', async (t) => {
  const f = fixture(t);
  const raced = { ...f.env, rawDB: { prepare: (sql) => f.db.prepare(sql), batch(statements) {
    f.db.prepare(`INSERT INTO cartao_atendimentos
      (id,estabelecimento_id,chave,conteudo_hash,cartao,mesa_id,comanda_id,pessoa_id,cliente_nome,criado_em)
      VALUES ('atendimento',1,'chave','hash','001',1,1,1,'Ana','2026-10-20')`).run();
    return f.db.batch(statements);
  } } };
  const before = f.db.prepare('SELECT * FROM comanda_itens WHERE id=1').first();
  assert.equal((await f.remove(1, 1, raced)).status, 409);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM comanda_pessoas WHERE id=1').first().n, 1);
  assert.deepEqual(f.db.prepare('SELECT * FROM comanda_itens WHERE id=1').first(), before);
  assert.equal(f.db.prepare('SELECT pessoas_count FROM comandas WHERE id=1').first().pessoas_count, 2);
});
