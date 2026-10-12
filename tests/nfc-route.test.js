import assert from 'node:assert/strict';
import test from 'node:test';
import SqliteDb from '../server/sqlite-db.js';
import { handle } from '../shared/router.js';
import { sha256 } from '../shared/util.js';

async function fixture(t) {
  const DB = new SqliteDb(':memory:');
  t.after(() => DB.close());
  for (const id of [1, 2]) {
    DB.prepare('INSERT INTO estabelecimentos (id,nome) VALUES (?,?)').bind(id, `Loja ${id}`).run();
    DB.prepare("INSERT INTO funcionarios (id,estabelecimento_id,nome,usuario,senha_hash,modulos) VALUES (?,?,?,?,'hash','gestor,area:vendas')")
      .bind(id, id, `Operador ${id}`, `operador-${id}`).run();
    DB.prepare('INSERT INTO sessoes (estabelecimento_id,funcionario_id,token_hash,expira_em) VALUES (?,?,?,?)')
      .bind(id, id, await sha256(`sessao-${id}`), '2099-01-01').run();
  }
  return { DB, call: (path, body, token = 'sessao-1', method = 'POST') => handle({
    req: { path, method, json: async () => body, query: () => undefined,
      header: (name) => name === 'cookie' ? `simplesx_session=${token}` : undefined },
    json: (data, status = 200) => ({ data, status }),
  }, { DB }) };
}

test('rota local exige sessão/área autorizada e valida UID físico', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.call('/api/nfc/identificar', { uid: '04A224B1C2D380' }, '')).status, 401);
  for (const uid of ['', 'COMANDA-001', '123', '<script>']) {
    assert.equal((await f.call('/api/nfc/identificar', { uid })).status, 400);
  }
  f.DB.prepare("UPDATE funcionarios SET modulos='gestor,area:financeiro' WHERE id=1").run();
  assert.equal((await f.call('/api/nfc/identificar', { uid: '04A224B1C2D380' })).status, 403);
  assert.equal(f.DB.prepare('SELECT COUNT(*) n FROM nfc_eventos').first().n, 0);
});

test('UID da tela interna usa a loja logada sem pareamento e não vaza para a fila de outro terminal', async (t) => {
  const f = await fixture(t);
  const response = await f.call('/api/nfc/identificar', {
    uid: '00:a2:24:b1:c2:d3:80', payload: 'texto gravado', estabelecimento_id: 2, origem: 'android',
  });
  assert.equal(response.status, 200);
  assert.equal(response.data.uid, '00A224B1C2D380');
  assert.equal(response.data.payload, '');
  assert.equal(response.data.origem, 'android-local');
  const row = f.DB.prepare('SELECT * FROM nfc_eventos WHERE id=?').first(response.data.id);
  assert.equal(row.estabelecimento_id, 1);
  assert.equal(row.consumido_por, '1');
  assert.ok(row.consumido_em);
  for (const token of ['sessao-1', 'sessao-2']) {
    assert.deepEqual((await f.call('/api/nfc/eventos', null, token, 'GET')).data, []);
  }
  assert.equal((await f.call(`/api/nfc/eventos/${row.id}/consumir`, {})).status, 409);
  assert.equal((await f.call(`/api/nfc/eventos/${row.id}/consumir`, {}, 'sessao-2')).status, 404);
  const repeated = await f.call('/api/nfc/identificar', { uid: row.uid });
  assert.equal(repeated.data.id, row.id);
  assert.equal(repeated.data.duplicate, true);
  for (const table of ['devices', 'mesas', 'comandas', 'comanda_itens']) {
    assert.equal(f.DB.prepare(`SELECT COUNT(*) n FROM ${table}`).first().n, 0);
  }
});

test('rota autenticada percorre UID nativo → cartão → pedido salvo na própria loja', async (t) => {
  const f = await fixture(t);
  const produto = f.DB.prepare("INSERT INTO produtos (estabelecimento_id,nome,preco,ativo) VALUES (1,'Pedido do S21',15,1)").run();
  const uid = '04A224B1C2D380';
  const leitura = await f.call('/api/nfc/identificar', { uid });
  assert.equal(leitura.status, 200);
  const mesa = f.DB.prepare("INSERT INTO mesas (estabelecimento_id,numero,nome,tipo) VALUES (1,1,'Mesa 1','normal')").run().meta.last_row_id;
  assert.equal((await f.call('/api/cartoes/cadastrar', { ...leitura.data, cliente_nome:'Cliente S21',mesa_id:mesa,chave:crypto.randomUUID() })).status,201);
  const aberto = await f.call('/api/cartoes/usar', { ...leitura.data, acao: 'abrir' });
  assert.equal(aberto.status, 200);
  const body = { ...leitura.data, acao: 'lancar', chave: 'pedido-local-unico', itens: [{ produto_id: produto.meta.last_row_id, quantidade: 2 }] };
  const lancado = await f.call('/api/cartoes/usar', body);
  assert.equal(lancado.status, 200);
  assert.equal(lancado.data.comanda_id, aberto.data.comanda_id);
  assert.equal((await f.call('/api/cartoes/usar', body)).status, 200);
  const rows = f.DB.prepare('SELECT estabelecimento_id,quantidade,nome FROM comanda_itens WHERE comanda_id=?').all(aberto.data.comanda_id).results;
  assert.deepEqual(rows, [{ estabelecimento_id: 1, quantidade: 2, nome: 'Pedido do S21' }]);
  assert.equal(f.DB.prepare('SELECT cartao FROM cartao_atendimentos WHERE pessoa_id=?').first(aberto.data.pessoa_id).cartao, uid);
});
