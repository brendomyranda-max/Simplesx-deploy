/**
 * Arquivo: cartao-nfc.test.js
 * Responsabilidade: Garante que o cartão NFC abre, lança e fecha só a mesa do próprio estabelecimento.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import SqliteDb from '../server/sqlite-db.js';
import { idDoCartao, usarCartaoHandler } from '../shared/cartao-nfc.js';
import { fecharComandaHandler } from '../shared/handlers-vendas.js';
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

test('leitores que fornecem somente o número continuam abrindo e lançando na mesma conta', async (t) => {
  const { raw, env, ctx } = ambiente(t);
  const aberto = await usarCartaoHandler(ctx({ acao: 'abrir', payload: '15' }), env(1));
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

  const fechado = await usarCartaoHandler(ctx({ acao: 'fechar', payload: '15' }), env(1));
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

test('NTAG215 vazio identifica uma mesa, recebe pedidos e pode ser reutilizado após pagar', async (t) => {
  const { raw, env, ctx } = ambiente(t);
  const uid = '04A224B1C2D380';
  const aberto = await usarCartaoHandler(ctx({ acao: 'abrir', uid }), env(1));
  assert.equal(aberto.status, 200);
  assert.equal(aberto.data.cartao, uid);
  assert.equal(aberto.data.mesa_numero, 1001);
  assert.equal(raw.prepare('SELECT tipo FROM mesas WHERE id=?').first(aberto.data.mesa_id).tipo, 'cartao');

  const lancado = await usarCartaoHandler(ctx({
    acao: 'lancar', uid: '04:a2:24:b1:c2:d3:80', payload: 'Texto que não identifica a conta',
    chave: 'ntag215-pedido-vazio', itens: [{ produto_id: 1, quantidade: 2 }],
  }), env(1));
  assert.equal(lancado.data.comanda_id, aberto.data.comanda_id);
  assert.equal(lancado.data.cartao, uid);
  assert.deepEqual(lancado.data.cozinha.sem_rota, ['Prato']);
  assert.equal(raw.prepare('SELECT quantidade FROM comanda_itens WHERE comanda_id=?').first(aberto.data.comanda_id).quantidade, 2);

  const conta = await usarCartaoHandler(ctx({ acao: 'fechar', uid, payload: 'Outro texto' }), env(1));
  assert.equal(conta.data.comanda_id, aberto.data.comanda_id);
  const pago = await fecharComandaHandler({
    ...ctx({ tipo: 'unica', taxa_garcom_pct: 0, forma: 'dinheiro' }),
    params: { id: String(conta.data.comanda_id) },
  }, env(1));
  assert.equal(pago.status, 200);
  assert.equal(pago.data.total, 40);
  assert.equal(raw.prepare('SELECT status FROM mesas WHERE id=?').first(aberto.data.mesa_id).status, 'livre');
  assert.equal((await usarCartaoHandler(ctx({ acao: 'fechar', uid }), env(1))).status, 404);

  const reutilizado = await usarCartaoHandler(ctx({ acao: 'abrir', uid: '04-A2-24-B1-C2-D3-80' }), env(1));
  assert.equal(reutilizado.data.mesa_id, aberto.data.mesa_id);
  assert.notEqual(reutilizado.data.comanda_id, aberto.data.comanda_id);
  assert.equal(raw.prepare('SELECT COUNT(*) n FROM comanda_itens WHERE comanda_id=?').first(reutilizado.data.comanda_id).n, 0);
  assert.equal(raw.prepare('SELECT COUNT(*) n FROM vendas WHERE comanda_id=?').first(aberto.data.comanda_id).n, 1);
  assert.equal(raw.prepare('SELECT status FROM comandas WHERE id=?').first(aberto.data.comanda_id).status, 'fechada');
});

test('dois NTAG215 com o mesmo texto não misturam contas nem estabelecimentos', async (t) => {
  const { raw, env, ctx } = ambiente(t);
  const uidA = '04A224B1C2D380';
  const uidB = '04A224B1C2D381';
  const abrir = (uid, loja = 1) => usarCartaoHandler(ctx({ acao: 'abrir', uid, payload: '15' }), env(loja));
  const a = await abrir(uidA);
  const b = await abrir(uidB);
  assert.notEqual(a.data.mesa_id, b.data.mesa_id);
  assert.notEqual(a.data.comanda_id, b.data.comanda_id);
  assert.equal(a.data.cartao, uidA);
  assert.equal(b.data.cartao, uidB);
  assert.equal((await usarCartaoHandler(ctx({ acao: 'fechar', uid: uidA }), env(2))).status, 404);
  const outraLoja = await abrir(uidA, 2);
  assert.notEqual(outraLoja.data.mesa_id, a.data.mesa_id);
  assert.equal(raw.prepare('SELECT COUNT(*) n FROM mesas WHERE nfc_uid=?').first(uidA).n, 2);
});

test('conta antiga pelo texto exige fechamento sem migrar o saldo para outro cartão', async (t) => {
  const { raw, env, ctx } = ambiente(t);
  const antiga = await usarCartaoHandler(ctx({ acao: 'abrir', payload: '15' }), env(1));
  for (const acao of ['abrir', 'lancar', 'fechar']) {
    const resposta = await usarCartaoHandler(ctx({ acao, uid: '04A224B1C2D380', payload: '15' }), env(1));
    assert.equal(resposta.status, 409);
    assert.match(resposta.data.error, /conta antiga.*15/);
  }
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM mesas WHERE tipo='cartao'").first().n, 1);
  assert.equal(raw.prepare('SELECT status FROM comandas WHERE id=?').first(antiga.data.comanda_id).status, 'aberta');
});

test('UID tem prioridade sobre o texto e uma identificação inválida é recusada', () => {
  assert.equal(idDoCartao({ uid: '04 A2 24 B1 C2 D3 80', payload: 'ç'.repeat(300) }), '04A224B1C2D380');
  assert.throws(() => idDoCartao({}), { status: 400 });
  assert.throws(() => idDoCartao({ uid: 'ç', payload: '15' }), { status: 400 });
});
