import assert from 'node:assert/strict';
import test from 'node:test';
import SqliteDb from '../server/sqlite-db.js';
import { TenantDb } from '../shared/tenant-db.js';
import { handle } from '../shared/router.js';
import { abrirComandaHandler, getComandaHandler } from '../shared/handlers-vendas.js';
import { sha256 } from '../shared/util.js';

function measure(db) {
  let statements = 0, trips = 0;
  const originals = new WeakMap();
  return {
    get statements() { return statements; }, get trips() { return trips; },
    prepare(sql) {
      const original = db.prepare(sql);
      const wrapped = {
        bind(...values) { original.bind(...values); return wrapped; },
        ...Object.fromEntries(['first', 'all', 'run'].map(method => [method, () => {
          statements++; trips++; return original[method]();
        }])),
      };
      originals.set(wrapped, original); return wrapped;
    },
    batch(list) {
      statements += list.length; trips++;
      return db.batch(list.map(statement => originals.get(statement) || statement));
    },
  };
}

async function fixture(t) {
  const db = new SqliteDb(':memory:'); t.after(() => db.close());
  db.prepare("INSERT INTO estabelecimentos (id,nome) VALUES (1,'Restaurante'),(2,'Outra empresa')").run();
  db.prepare("INSERT INTO mesas (id,estabelecimento_id,numero) VALUES (2,1,2),(3,1,3),(4,2,2)").run();
  db.prepare("INSERT INTO mesas (id,estabelecimento_id,numero,tipo) VALUES (5,1,9999,'pagamentos')").run();
  for (let id = 1; id <= 6; id++) {
    db.prepare("INSERT INTO funcionarios (id,estabelecimento_id,nome,usuario,senha_hash,modulos) VALUES (?,1,?,?,?,'restaurante')")
      .bind(id, `Garçom ${id}`, `garcom${id}`, 'fixture').run();
    db.prepare("INSERT INTO sessoes (estabelecimento_id,funcionario_id,token_hash,expira_em) VALUES (1,?,?,'2099-01-01')")
      .bind(id, await sha256(`terminal-${id}`)).run();
    db.prepare("INSERT INTO produtos (id,estabelecimento_id,nome,preco,estoque_atual,exibir_restaurante) VALUES (?,1,?,10,1000,1)")
      .bind(id, `Produto ${id}`).run();
  }
  db.prepare("INSERT INTO gestores (id,estabelecimento_id,token,sessao_id) VALUES (1,1,'printer','session')").run();
  db.prepare("INSERT INTO impressora_agentes (id,estabelecimento_id,nome,ip,servidor_tipo,servidor_id,imprime_pedidos) VALUES (1,1,'Cozinha','','desktop','1',1)").run();
  db.prepare("INSERT INTO categorias (id,estabelecimento_id,nome,impressora_agente_id) VALUES (1,1,'Cozinha',1)").run();
  db.prepare('INSERT INTO produto_categorias (estabelecimento_id,produto_id,categoria_id) SELECT 1,id,1 FROM produtos WHERE estabelecimento_id=1').run();
  const context = (body = {}, id = '2', revision) => ({ params: { id }, user: { id: 1, nome: 'Garçom 1' },
    req: { json: async () => body, query: () => revision }, json: (data, status = 200) => ({ data, status }) });
  const env = (raw = db) => ({ rawDB: raw, DB: new TenantDb(raw, 1), estabelecimentoId: 1 });
  const call = (path, body, actor = 1, method = body ? 'POST' : 'GET') => {
    const url = new URL(path, 'http://localhost');
    return handle({ req: { path: url.pathname, method, json: async () => body,
      query: name => url.searchParams.get(name) ?? undefined,
      header: name => name === 'cookie' ? `simplesx_session=terminal-${actor}` : '' },
      json: (data, status = 200) => ({ data, status }) }, { DB: db });
  };
  return { db, context, env, call };
}

test('abrir 1, 20 ou 100 pessoas usa o mesmo número de consultas e mantém contas individuais', async t => {
  for (const count of [1, 20, 100]) {
    const f = await fixture(t), measured = measure(f.db);
    const result = await abrirComandaHandler(f.context({ pessoas_count: count }), f.env(measured));
    assert.equal(result.status, 201); assert.equal(result.data.pessoas.length, count);
    assert.equal(result.data.pessoas_count, count);
    assert.equal(result.data.pessoas.at(-1).nome, `Pessoa ${count}`);
    assert.equal(f.db.prepare('SELECT status FROM mesas WHERE id=2').first().status, 'ocupada');
    assert.ok(measured.statements <= 12); assert.ok(measured.trips <= 5);
    t.diagnostic(`${count} pessoas: ${measured.statements} comandos, ${measured.trips} acessos ao banco`);
  }
});

test('falha na vigésima pessoa reverte toda a abertura e permite uma nova tentativa', async t => {
  const f = await fixture(t);
  f.db.db.exec("CREATE TRIGGER falha_pessoa BEFORE INSERT ON comanda_pessoas WHEN NEW.nome='Pessoa 20' BEGIN SELECT RAISE(ABORT,'falha simulada'); END;");
  await assert.rejects(abrirComandaHandler(f.context({ pessoas_count: 20 }), f.env()), /falha simulada/);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM comandas').first().n, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM comanda_pessoas').first().n, 0);
  assert.equal(f.db.prepare('SELECT status FROM mesas WHERE id=2').first().status, 'livre');
  f.db.db.exec('DROP TRIGGER falha_pessoa');
  assert.equal((await abrirComandaHandler(f.context({ pessoas_count: 20 }), f.env())).status, 201);
});

test('seis terminais autenticados abrem a mesa 2 uma vez e lançam 36 produtos sem perda ou duplicação', async t => {
  const f = await fixture(t);
  const openings = await Promise.all(Array.from({ length: 6 }, (_, index) => f.call('/api/mesas/2/abrir', { pessoas_count: 20 }, index + 1)));
  assert.deepEqual(openings.map(result => result.status).sort(), [201,409,409,409,409,409]);
  const command = openings.find(result => result.status === 201).data;
  assert.equal(command.pessoas.length, 20);
  const payloads = Array.from({ length: 6 }, (_, index) => ({ chave: crypto.randomUUID(),
    itens: Array.from({ length: 6 }, (_, product) => ({ produto_id: product + 1, quantidade: 1,
      pessoa_id: command.pessoas[index].id, observacao: `Terminal ${index + 1}; produto ${product + 1}` })) }));
  const orders = await Promise.all(payloads.map((body, index) => f.call(`/api/comandas/${command.id}/itens/lote`, body, index + 1)));
  assert.ok(orders.every(result => result.status === 201));
  const retries = await Promise.all(payloads.map((body, index) => f.call(`/api/comandas/${command.id}/itens/lote`, body, index + 1)));
  assert.ok(retries.every(result => result.status === 200 && result.data.repetido));
  const sends = await Promise.all(payloads.map((_, index) => f.call('/api/impressao/comanda', { comanda_id: command.id, tipo: 'cozinha' }, index + 1)));
  assert.ok(sends.every(result => result.status === 200));
  const current = await f.call(`/api/comandas/${command.id}`);
  assert.equal(current.data.itens.length, 36); assert.equal(current.data.subtotal, 360);
  for (let actor = 1; actor <= 6; actor++) {
    const items = current.data.itens.filter(item => item.funcionario_id === actor);
    assert.equal(items.length, 6); assert.ok(items.every(item => item.pessoa_id === command.pessoas[actor - 1].id));
  }
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM pedido_impressoes').first().n, 36);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM gestor_jobs').first().n, 6);
  assert.ok(current.data.itens.every(item => item.status === 'enviado'));
});

test('comanda sem alteração consulta só uma linha de revisão; mudanças reabrem a leitura completa', async t => {
  const f = await fixture(t);
  const command = (await abrirComandaHandler(f.context({ pessoas_count: 20 }), f.env())).data;
  const unchanged = measure(f.db);
  const response = await getComandaHandler(f.context({}, String(command.id), String(command.revisao)), f.env(unchanged));
  assert.deepEqual(response.data, { sem_alteracoes: true, revisao: command.revisao });
  assert.equal(unchanged.statements, 1); assert.equal(unchanged.trips, 1);
  let revision = command.revisao;
  for (const change of [
    () => f.db.prepare("UPDATE comanda_pessoas SET nome='Ana' WHERE id=?").bind(command.pessoas[0].id).run(),
    () => f.db.prepare("INSERT INTO comanda_itens (estabelecimento_id,comanda_id,produto_id,nome,preco_unitario) VALUES (1,?,1,'Produto 1',10)").bind(command.id).run(),
    () => f.db.prepare("UPDATE mesas SET nome='Mesa do grupo' WHERE id=2").run(),
    () => f.db.prepare("UPDATE comanda_itens SET status='enviado' WHERE comanda_id=?").bind(command.id).run(),
    () => f.db.prepare("UPDATE comandas SET taxa_garcom_pct=10 WHERE id=?").bind(command.id).run(),
    () => f.db.prepare("DELETE FROM comanda_itens WHERE comanda_id=?").bind(command.id).run(),
  ]) {
    change();
    const changed = await getComandaHandler(f.context({}, String(command.id), String(revision)), f.env());
    assert.ok(changed.data.revisao > revision); assert.ok(Array.isArray(changed.data.itens));
    revision = changed.data.revisao;
  }
  const other = new TenantDb(f.db, 2);
  assert.equal((await getComandaHandler(f.context({}, String(command.id), String(revision)), { DB: other })).status, 404);
});

test('seis terminais acrescentam pessoas sem perder a contagem e a falha reverte inclusão e total', async t => {
  const f = await fixture(t);
  const command = (await f.call('/api/mesas/2/abrir', { pessoas_count: 20 })).data;
  const added = await Promise.all(Array.from({ length: 6 }, (_, index) =>
    f.call(`/api/comandas/${command.id}/pessoas`, { nome: `Cliente extra ${index + 1}` }, index + 1)));
  assert.ok(added.every(result => result.status === 201));
  const current = (await f.call(`/api/comandas/${command.id}`)).data;
  assert.equal(current.pessoas.length, 26); assert.equal(current.pessoas_count, 26);
  f.db.db.exec("CREATE TRIGGER falha_contagem BEFORE UPDATE OF pessoas_count ON comandas WHEN NEW.pessoas_count=27 BEGIN SELECT RAISE(ABORT,'falha simulada'); END");
  const { addPessoaHandler } = await import('../shared/handlers-vendas.js');
  await assert.rejects(addPessoaHandler(f.context({ nome: 'Não confirmado' }, String(command.id)), f.env()), /falha simulada/);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM comanda_pessoas WHERE comanda_id=?').bind(command.id).first().n, 26);
  assert.equal(f.db.prepare('SELECT pessoas_count FROM comandas WHERE id=?').bind(command.id).first().pessoas_count, 26);
});

test('impressão e pagamentos individuais também invalidam a revisão da comanda', async t => {
  const f = await fixture(t);
  const command = (await f.call('/api/mesas/2/abrir', { pessoas_count: 20 })).data;
  await f.call(`/api/comandas/${command.id}/itens/lote`, { chave: crypto.randomUUID(), itens: [{ produto_id: 1, pessoa_id: command.pessoas[0].id }] });
  await f.call('/api/impressao/comanda', { comanda_id: command.id, tipo: 'cozinha' });
  let current = (await f.call(`/api/comandas/${command.id}`)).data;
  f.db.prepare("UPDATE gestor_jobs SET status='erro',erro='Sem papel'").run();
  let changed = (await f.call(`/api/comandas/${command.id}?revisao=${current.revisao}`)).data;
  assert.ok(changed.revisao > current.revisao); assert.equal(changed.itens[0].impressoes[0].erro, 'Sem papel');
  current = changed;
  const closing = await f.call(`/api/comandas/${command.id}/fechar`, { tipo: 'individual', taxa_garcom_pct: 0 });
  assert.equal(closing.status, 200, JSON.stringify(closing.data));
  changed = (await f.call(`/api/comandas/${command.id}?revisao=${current.revisao}`)).data;
  assert.ok(changed.revisao > current.revisao); assert.ok(changed.transfer_comanda_id);
  const revision = changed.revisao;
  f.db.prepare("UPDATE comandas SET status='fechada' WHERE id=?").bind(changed.transfer_comanda_id).run();
  changed = (await f.call(`/api/comandas/${command.id}?revisao=${revision}`)).data;
  assert.ok(changed.revisao > revision); assert.equal(changed.transfer_comanda_status, 'fechada');
});
