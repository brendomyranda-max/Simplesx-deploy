/**
 * Arquivo: cartao-nfc.test.js
 * Responsabilidade: Garante que o cartão NFC abre, lança e fecha só a mesa do próprio estabelecimento.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import SqliteDb from '../server/sqlite-db.js';
import { usarCartaoHandler } from '../shared/cartao-nfc.js';
import { TenantDb } from '../shared/tenant-db.js';

function ambiente(t) {
  const raw = new SqliteDb(':memory:');
  t.after(() => raw.close());
  raw.prepare("INSERT INTO estabelecimentos (id,nome) VALUES (1,'A'),(2,'B')").run();
  raw.prepare("INSERT INTO mesas (id,estabelecimento_id,numero,nome,status,tipo) VALUES (1,1,1,'Mesa 1','livre','normal')").run();
  raw.prepare("INSERT INTO produtos (id,estabelecimento_id,nome,preco,ativo) VALUES (1,1,'Prato',20,1),(2,2,'Outro',10,1)").run();
  const env = (id) => ({ DB: new TenantDb(raw, id), rawDB: raw, estabelecimentoId: id });
  const ctx = (body) => ({
    user: { id: 3, nome: 'Ana' },
    req: { json: async () => body },
    json: (data, status = 200) => ({ data, status }),
  });
  return { raw, env, ctx };
}

test('o número do cartão vira a mesa e o lançamento sobe na mesma conta', async (t) => {
  const { raw, env, ctx } = ambiente(t);
  const aberto = await usarCartaoHandler(ctx({ acao: 'abrir', uid: '04AABB', payload: '15' }), env(1));
  assert.equal(aberto.status, 200);
  assert.equal(aberto.data.cartao, '15');
  const mesa = raw.prepare('SELECT * FROM mesas WHERE nfc_uid=?').first('15');
  assert.equal(mesa.estabelecimento_id, 1);
  assert.equal(mesa.tipo, 'cartao');
  assert.equal(mesa.numero, 15);
  assert.equal(mesa.status, 'ocupada');

  const deNovo = await usarCartaoHandler(ctx({ acao: 'abrir', uid: '15', payload: '15' }), env(1));
  assert.equal(deNovo.data.comanda_id, aberto.data.comanda_id);

  const lancado = await usarCartaoHandler(ctx({
    acao: 'lancar',
    uid: '15',
    payload: '15',
    chave: 'cartao-mesa-15-pedido',
    itens: [{ produto_id: 1, quantidade: 2 }],
  }), env(1));
  assert.equal(lancado.status, 200);
  assert.equal(lancado.data.comanda_id, aberto.data.comanda_id);
  const item = raw.prepare('SELECT nome, quantidade, estabelecimento_id FROM comanda_itens WHERE comanda_id=?').first(aberto.data.comanda_id);
  assert.equal(item.nome, 'Prato');
  assert.equal(item.quantidade, 2);
  assert.equal(item.estabelecimento_id, 1);
  assert.deepEqual(lancado.data.cozinha.sem_rota, ['Prato']);

  const fechado = await usarCartaoHandler(ctx({ acao: 'fechar', uid: '04AABB', payload: '15' }), env(1));
  assert.equal(fechado.data.comanda_id, aberto.data.comanda_id);
  assert.equal(fechado.data.comanda_status, 'aberta');
});

test('não ocupa uma mesa física com o mesmo número e não vaza para outro estabelecimento', async (t) => {
  const { raw, env, ctx } = ambiente(t);
  const aberto = await usarCartaoHandler(ctx({ acao: 'abrir', uid: '1', payload: '1' }), env(1));
  assert.equal(aberto.status, 200);
  const mesa = raw.prepare('SELECT * FROM mesas WHERE nfc_uid=?').first('1');
  assert.notEqual(mesa.id, 1);
  assert.notEqual(mesa.numero, 1);
  assert.equal(raw.prepare('SELECT nome FROM mesas WHERE id=1').first().nome, 'Mesa 1');

  const outro = await usarCartaoHandler(ctx({ acao: 'fechar', uid: '1', payload: '1' }), env(2));
  assert.equal(outro.status, 404);
  assert.equal(raw.prepare('SELECT COUNT(*) n FROM mesas WHERE estabelecimento_id=2').first().n, 0);

  const semConta = await usarCartaoHandler(ctx({ acao: 'fechar', uid: '9998', payload: '9998' }), env(1));
  assert.equal(semConta.status, 404);
});
