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
import { publishDeviceNfcHandler } from '../shared/handlers-devices.js';
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
