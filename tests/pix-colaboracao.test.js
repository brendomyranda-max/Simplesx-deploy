import test from 'node:test';
import assert from 'node:assert/strict';
import { crc16, gerarPix } from '../shared/pix-colaboracao.js';
import { colaboracaoHandler } from '../shared/handlers-cadastros.js';

// Recebedor fictício exclusivo dos testes; nunca usado como fallback da API.
const RECEBEDOR_COLABORACAO = { chave: 'pix@example.com', nome: 'Recebedor de Teste', cidade: 'Sao Paulo' };
const env = {
  COLABORACAO_PIX_CHAVE: RECEBEDOR_COLABORACAO.chave,
  COLABORACAO_PIX_NOME: RECEBEDOR_COLABORACAO.nome,
  COLABORACAO_PIX_CIDADE: RECEBEDOR_COLABORACAO.cidade,
};

function campos(payload) {
  const result = {};
  for (let pos = 0; pos < payload.length;) {
    const id = payload.slice(pos, pos + 2);
    const size = Number(payload.slice(pos + 2, pos + 4));
    assert.ok(Number.isInteger(size) && size > 0);
    assert.ok(pos + 4 + size <= payload.length);
    result[id] = payload.slice(pos + 4, pos + 4 + size);
    pos += 4 + size;
  }
  return result;
}

test('CRC corresponde ao vetor de referência do Banco Central', () => {
  const exemplo = '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304';
  assert.equal(crc16(exemplo), '1D3D');
});

test('gera BR Code com chave, valor, nome limitado e cidade', () => {
  const payload = gerarPix(RECEBEDOR_COLABORACAO, '12,34');
  const data = campos(payload);
  assert.equal(campos(data['26'])['01'], RECEBEDOR_COLABORACAO.chave);
  assert.equal(campos(data['26'])['00'], 'br.gov.bcb.pix');
  assert.equal(data['54'], '12.34');
  assert.equal(data['53'], '986');
  assert.equal(data['58'], 'BR');
  assert.ok(data['59'].length <= 25);
  assert.equal(data['60'], 'SAO PAULO');
  assert.equal(campos(data['62'])['05'], '***');
  assert.equal(data['63'], crc16(payload.slice(0, -4)));
  assert.equal(campos(gerarPix(RECEBEDOR_COLABORACAO, '0.01'))['54'], '0.01');
});

test('rejeita valores inválidos sem arredondar silenciosamente', () => {
  for (const valor of ['', '0', '-1', '1.001', '1e2', 'NaN', '1000000', '1,2,3']) {
    assert.throws(() => gerarPix(RECEBEDOR_COLABORACAO, valor), /Informe um valor/);
  }
});

test('endpoint gera Pix e retorna erro de validação para valor inválido', async () => {
  const c = (valor) => ({ req: { query: () => valor }, json: (body, status = 200) => ({ body, status }) });
  assert.equal((await colaboracaoHandler(c('25'), env)).body.pix_copia_cola, gerarPix(RECEBEDOR_COLABORACAO, '25'));
  assert.equal((await colaboracaoHandler(c('-1'), env)).status, 400);
  assert.equal((await colaboracaoHandler(c(undefined), env)).body.pix_copia_cola, '');
});

test('endpoint não gera cobrança sem configuração completa do recebedor', async () => {
  const c = { req: { query: () => '10' }, json: (body, status = 200) => ({ body, status }) };
  for (const config of [{}, ...Object.keys(env).map((key) => ({ ...env, [key]: '  ' }))]) {
    const response = await colaboracaoHandler(c, config);
    assert.equal(response.status, 503);
    assert.deepEqual(Object.keys(response.body), ['error']);
  }
  const config = { ...env, COLABORACAO_PIX_CHAVE: 'outro@example.com', COLABORACAO_PIX_NOME: 'Outro Recebedor' };
  const response = await colaboracaoHandler(c, config);
  assert.equal(campos(campos(response.body.pix_copia_cola)['26'])['01'], config.COLABORACAO_PIX_CHAVE);
  assert.equal(response.body.recebedor, config.COLABORACAO_PIX_NOME);
});
