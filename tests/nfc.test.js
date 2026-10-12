/**
 * Arquivo: nfc.test.js
 * Responsabilidade: Garante que a ponte NFC não mistura leituras entre estabelecimentos.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import SqliteDb from '../server/sqlite-db.js';
import { deviceNfcStatusHandler, publishDeviceNfcHandler, testDeviceNfcHandler } from '../shared/handlers-devices.js';
import { usarCartaoHandler } from '../shared/cartao-nfc.js';
import { cadastrarCartaoHandler } from '../shared/recepcao.js';
import { consumirNfcHandler, listarNfcHandler, publicarNfcGestorHandler } from '../shared/nfc.js';
import { TenantDb } from '../shared/tenant-db.js';
import { sha256 } from '../shared/util.js';

function requisicao(body, { headers = {}, query = {}, params = {}, user = { id: 7 } } = {}) {
  return {
    params,
    user,
    req: {
      json: async () => body,
      header: (name) => headers[String(name).toLowerCase()] || '',
      query: (name) => query[name] || '',
    },
    json(data, status = 200) {
      return { status, data };
    },
  };
}

async function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'simplesx-nfc-test-'));
  const rawDB = new SqliteDb(path.join(dir, 'test.db'));
  const createdAt = new Date().toISOString();
  rawDB.prepare("INSERT INTO estabelecimentos (nome, ativo, criado_em, cnpj) VALUES ('Loja A',1,?,'11111111111111')")
    .bind(createdAt).run();
  rawDB.prepare("INSERT INTO estabelecimentos (nome, ativo, criado_em, cnpj) VALUES ('Loja B',1,?,'22222222222222')")
    .bind(createdAt).run();
  const lojaA = rawDB.prepare("SELECT id FROM estabelecimentos WHERE nome='Loja A'").first().id;
  const lojaB = rawDB.prepare("SELECT id FROM estabelecimentos WHERE nome='Loja B'").first().id;
  rawDB.prepare(
    `INSERT INTO gestores (token, nome, ip, criado_em, ativo, estabelecimento_id, sessao_id)
     VALUES ('token-a','Caixa A','pc-a',?,1,?,'sessao-a')`
  ).bind(createdAt, lojaA).run();
  rawDB.prepare(
    `INSERT INTO gestores (token, nome, ip, criado_em, ativo, estabelecimento_id, sessao_id)
     VALUES ('token-b','Caixa B','pc-b',?,1,?,'sessao-b')`
  ).bind(createdAt, lojaB).run();
  const tokenDispositivo = 'segredo-android';
  rawDB.prepare(
    `INSERT INTO devices
      (id, estabelecimento_id, nome, plataforma, token_hash, token_expira_em, status, criado_em, atualizado_em)
     VALUES ('android-b',?,'Celular','android',?,?,'offline',?,?)`
  ).bind(lojaB, await sha256(tokenDispositivo), '2099-01-01T00:00:00.000Z', createdAt, createdAt).run();
  const envDa = (loja) => ({ rawDB, DB: new TenantDb(rawDB, loja), estabelecimentoId: loja });
  return {
    rawDB,
    lojaA,
    lojaB,
    tokenDispositivo,
    envA: envDa(lojaA),
    envB: envDa(lojaB),
    bruto: { rawDB, DB: rawDB },
    close() { rawDB.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}

test('leitura do gestor fica isolada e só o primeiro terminal a consome', async () => {
  const f = await fixture();
  try {
    const publicada = await publicarNfcGestorHandler(requisicao({
      token: 'token-a', session_id: 'sessao-a', uid: '7891000315507', payload: '7891000315507', leitor: 'pc-a',
    }), f.bruto);
    assert.equal(publicada.status, 200);
    assert.equal(publicada.data.duplicate, false);

    const repetida = await publicarNfcGestorHandler(requisicao({
      token: 'token-a', session_id: 'sessao-a', uid: '7891000315507', payload: '7891000315507',
    }), f.bruto);
    assert.equal(repetida.data.id, publicada.data.id);
    assert.equal(repetida.data.duplicate, true);

    const daOutraLoja = await listarNfcHandler(requisicao(null), f.envB);
    assert.deepEqual(daOutraLoja.data, []);
    const pendentes = await listarNfcHandler(requisicao(null), f.envA);
    assert.equal(pendentes.data.length, 1);
    assert.equal(pendentes.data[0].uid, '7891000315507');

    const vazada = await consumirNfcHandler(requisicao(null, { params: { id: String(publicada.data.id) } }), f.envB);
    assert.equal(vazada.status, 404);
    const primeira = await consumirNfcHandler(requisicao(null, { params: { id: String(publicada.data.id) } }), f.envA);
    assert.equal(primeira.status, 200);
    const segunda = await consumirNfcHandler(requisicao(null, { params: { id: String(publicada.data.id) } }), f.envA);
    assert.equal(segunda.status, 409);
    assert.equal(f.rawDB.prepare('SELECT COUNT(*) AS total FROM nfc_eventos').first().total, 1);
  } finally {
    f.close();
  }
});

test('Android só publica no estabelecimento do dispositivo pareado', async () => {
  const f = await fixture();
  try {
    const resposta = await publishDeviceNfcHandler(requisicao(
      { uid: '04A224B1', payload: 'mesa-4', leitor: 'celular' },
      { headers: { authorization: `Bearer ${f.tokenDispositivo}`, 'x-device-id': 'android-b' } },
    ), f.bruto);
    assert.equal(resposta.status, 200);
    const lojaB = await listarNfcHandler(requisicao(null), f.envB);
    const lojaA = await listarNfcHandler(requisicao(null), f.envA);
    assert.equal(lojaB.data[0].payload, 'mesa-4');
    assert.equal(lojaB.data[0].origem, 'android');
    assert.deepEqual(lojaA.data, []);
    await assert.rejects(
      publishDeviceNfcHandler(requisicao(
        { uid: '04A224B1' },
        { headers: { authorization: 'Bearer outro', 'x-device-id': 'android-b' } },
      ), f.bruto),
      (error) => error.status === 401,
    );
  } finally {
    f.close();
  }
});

test('gestor sem estabelecimento não grava leitura', async () => {
  const f = await fixture();
  try {
    f.rawDB.prepare("UPDATE gestores SET estabelecimento_id=0 WHERE token='token-a'").run();
    await assert.rejects(
      publicarNfcGestorHandler(requisicao({
        token: 'token-a', session_id: 'sessao-a', uid: '12345678',
      }), f.bruto),
      (error) => error.status === 401,
    );
    assert.equal(f.rawDB.prepare('SELECT COUNT(*) AS total FROM nfc_eventos').first().total, 0);
  } finally {
    f.close();
  }
});

test('NTAG215 vazio percorre a ponte Android até a comanda e normaliza o UID sem duplicar', async () => {
  const f = await fixture();
  try {
    const headers = { authorization: `Bearer ${f.tokenDispositivo}`, 'x-device-id': 'android-b' };
    const publicada = await publishDeviceNfcHandler(requisicao(
      // O Android instalado repete o UID no payload quando o cartão está vazio.
      { uid: '04A224B1C2D380', payload: '04A224B1C2D380', leitor: 'celular NFC' }, { headers },
    ), f.bruto);
    assert.equal(publicada.status, 200);
    assert.equal(publicada.data.payload, '04A224B1C2D380');
    const repetida = await publishDeviceNfcHandler(requisicao(
      { uid: '04:a2:24:b1:c2:d3:80' }, { headers },
    ), f.bruto);
    assert.equal(repetida.data.duplicate, true);
    assert.equal(repetida.data.id, publicada.data.id);

    assert.deepEqual((await listarNfcHandler(requisicao(null), f.envA)).data, []);
    const pendentes = (await listarNfcHandler(requisicao(null), f.envB)).data;
    assert.equal(pendentes.length, 1);
    assert.equal(pendentes[0].uid, '04A224B1C2D380');
    const consumida = await consumirNfcHandler(requisicao(null, {
      params: { id: String(pendentes[0].id) },
    }), f.envB);
    const mesaId = f.rawDB.prepare("INSERT INTO mesas (estabelecimento_id,numero,nome,tipo) VALUES (?,1,'Mesa 1','normal')").bind(f.lojaB).run().meta.last_row_id;
    assert.equal((await cadastrarCartaoHandler(requisicao({ ...consumida.data, cliente_nome:'Cliente NFC',mesa_id:mesaId,chave:crypto.randomUUID() }), f.envB)).status,201);
    const aberta = await usarCartaoHandler(requisicao({ acao: 'abrir', ...consumida.data }), f.envB);
    assert.equal(aberta.status, 200);
    assert.equal(aberta.data.cartao, '04A224B1C2D380');
    const mesa = f.rawDB.prepare('SELECT estabelecimento_id, nfc_uid, tipo FROM mesas WHERE id=?').first(aberta.data.mesa_id);
    assert.equal(mesa.estabelecimento_id, f.lojaB);
    assert.equal(mesa.nfc_uid, null);
    assert.equal(mesa.tipo, 'normal');
    assert.equal(f.rawDB.prepare('SELECT cartao FROM cartao_atendimentos WHERE pessoa_id=?').first(aberta.data.pessoa_id).cartao,'04A224B1C2D380');
    const produto = f.rawDB.prepare('INSERT INTO produtos (estabelecimento_id,nome,preco,ativo) VALUES (?,?,?,1)')
      .bind(f.lojaB, 'Pedido NFC', 12).run();
    const pedido = await usarCartaoHandler(requisicao({
      ...consumida.data, acao: 'lancar', chave: 'nfc-android-pedido-integrado',
      itens: [{ produto_id: produto.meta.last_row_id, quantidade: 2 }],
    }), f.envB);
    assert.equal(pedido.status, 200);
    assert.equal(pedido.data.comanda_id, aberta.data.comanda_id);
    const item = f.rawDB.prepare('SELECT estabelecimento_id,nome,quantidade,preco_unitario FROM comanda_itens WHERE comanda_id=?')
      .first(aberta.data.comanda_id);
    assert.equal(item.estabelecimento_id, f.lojaB);
    assert.equal(item.nome, 'Pedido NFC');
    assert.equal(item.quantidade, 2);
    assert.equal(item.preco_unitario, 12);
    assert.deepEqual(pedido.data.cozinha.sem_rota, ['Pedido NFC']);
    assert.deepEqual((await listarNfcHandler(requisicao(null), f.envB)).data, []);
  } finally {
    f.close();
  }
});

test('teste de conexão identifica a loja pareada sem criar leituras, mesas ou comandas', async () => {
  const f = await fixture();
  try {
    const headers = { authorization: `Bearer ${f.tokenDispositivo}`, 'x-device-id': 'android-b' };
    const resposta = await testDeviceNfcHandler(requisicao({}, { headers }), f.bruto);
    assert.equal(resposta.status, 200);
    assert.equal(resposta.data.estabelecimento, 'Loja B');
    for (const tabela of ['nfc_eventos', 'mesas', 'comandas']) {
      assert.equal(f.rawDB.prepare(`SELECT COUNT(*) n FROM ${tabela}`).first().n, 0);
    }
    await assert.rejects(testDeviceNfcHandler(requisicao({}, {
      headers: { ...headers, authorization: 'Bearer inválido' },
    }), f.bruto), { status: 401 });
  } finally { f.close(); }
});

test('diagnóstico usa fila separada e confirma chegada ao painel sem lançar pedidos', async () => {
  const f = await fixture();
  try {
    const headers = { authorization: `Bearer ${f.tokenDispositivo}`, 'x-device-id': 'android-b' };
    const uid = '04A224B1C2D380';
    const diagnostico = await testDeviceNfcHandler(requisicao({ uid, payload: 'COMANDA-001' }, { headers }), f.bruto);
    assert.equal(diagnostico.status, 200);
    assert.equal(diagnostico.data.payload, '');
    assert.equal(diagnostico.data.origem, 'android-teste');
    // Clientes antigos só consultam a fila normal: nunca recebem testes como pedidos.
    assert.deepEqual((await listarNfcHandler(requisicao(null), f.envB)).data, []);
    assert.deepEqual((await listarNfcHandler(requisicao(null, { query: { diagnostico: '1' } }), f.envA)).data, []);
    const pendentes = (await listarNfcHandler(requisicao(null, { query: { diagnostico: '1' } }), f.envB)).data;
    assert.equal(pendentes.length, 1);
    assert.equal(pendentes[0].id, diagnostico.data.id);
    assert.equal(pendentes[0].uid, uid);

    const status = () => deviceNfcStatusHandler(requisicao({ evento_id: diagnostico.data.id }, { headers }), f.bruto);
    assert.equal((await status()).data.recebido_pelo_terminal, false);
    const normal = await publishDeviceNfcHandler(requisicao({ uid }, { headers }), f.bruto);
    assert.notEqual(normal.data.id, diagnostico.data.id);
    assert.equal(normal.data.duplicate, false);
    assert.deepEqual((await listarNfcHandler(requisicao(null), f.envB)).data.map((row) => row.id), [normal.data.id]);
    const todos = await listarNfcHandler(requisicao(null, { query: { diagnostico: 'todos' } }), f.envB);
    assert.deepEqual(todos.data.map((row) => row.id), [diagnostico.data.id, normal.data.id]);

    await consumirNfcHandler(requisicao(null, { params: { id: String(diagnostico.data.id) } }), f.envB);
    const recebido = await status();
    assert.equal(recebido.data.recebido_pelo_terminal, true);
    assert.ok(recebido.data.consumido_em);
    assert.equal((await deviceNfcStatusHandler(requisicao({ evento_id: normal.data.id }, { headers }), f.bruto)).data.recebido_pelo_terminal, false);
    for (const tabela of ['mesas', 'comandas', 'comanda_itens', 'vendas']) {
      assert.equal(f.rawDB.prepare(`SELECT COUNT(*) n FROM ${tabela}`).first().n, 0);
    }
  } finally { f.close(); }
});

test('consulta do diagnóstico exige autenticação e nunca revela leituras de outra loja', async () => {
  const f = await fixture();
  try {
    const headersB = { authorization: `Bearer ${f.tokenDispositivo}`, 'x-device-id': 'android-b' };
    const publicada = await testDeviceNfcHandler(requisicao({ uid: '04A224B1C2D380' }, { headers: headersB }), f.bruto);
    f.rawDB.prepare(`INSERT INTO devices (id,estabelecimento_id,nome,plataforma,token_hash,token_expira_em,status,criado_em,atualizado_em)
      VALUES ('android-a',?,'Outro celular','android',?,'2099-01-01T00:00:00.000Z','offline','2026-01-01','2026-01-01')`)
      .bind(f.lojaA, await sha256('segredo-a')).run();
    const headersA = { authorization: 'Bearer segredo-a', 'x-device-id': 'android-a' };
    assert.equal((await deviceNfcStatusHandler(requisicao({ evento_id: publicada.data.id, estabelecimento_id: f.lojaB }, { headers: headersA }), f.bruto)).status, 404);
    await assert.rejects(deviceNfcStatusHandler(requisicao({ evento_id: publicada.data.id }, {
      headers: { ...headersB, authorization: 'Bearer inválido' },
    }), f.bruto), { status: 401 });
    for (const evento_id of [0, -1, 1.5, 'abc', null]) {
      assert.equal((await deviceNfcStatusHandler(requisicao({ evento_id }, { headers: headersB }), f.bruto)).status, 404);
    }
  } finally { f.close(); }
});
