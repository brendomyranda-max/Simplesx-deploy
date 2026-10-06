import test from 'node:test';
import assert from 'node:assert/strict';
import SqliteDb from '../server/sqlite-db.js';
import { handle } from '../shared/router.js';
import { authConfigHandler, loginFuncionarioHandler } from '../shared/handlers-cadastros.js';
import { hashSenha } from '../shared/util.js';

function context(body = {}, path = '/api/auth/cadastro', method = 'POST') {
  return {
    req: { path, method, json: async () => body, header: () => undefined, query: () => undefined },
    json: (data, status = 200, headers = {}) => ({ data, status, headers }),
  };
}
const body = { cnpj: '11.222.333/0001-81', telefone: '(11) 99999-8888', nome: 'Restaurante Teste', senha: 'senha-teste-123', turnstile_token: 'teste' };

test('cadastro público bloqueia conta gratuita e dados de pagamento forjados, inclusive chamadas simultâneas', async (t) => {
  const DB = new SqliteDb(':memory:');
  t.after(() => DB.close());
  const env = { DB, TURNSTILE_SECRET_KEY: 'teste' };
  // Nem um formulário antigo nem declarações de pagamento do navegador liberam acesso.
  const requests = [body, { ...body, pago: true, status: 'PAID', valor: 50 }, { ...body, valor_centavos: 0 }, {}];
  const responses = await Promise.all(requests.map((data) => handle(context(data), env)));
  for (const result of responses) {
    assert.equal(result.status, 402);
    assert.equal(result.data.code, 'PAGAMENTO_CADASTRO_INDISPONIVEL');
    assert.equal(result.data.cadastro.valor_centavos, 5000);
    assert.equal(result.data.cadastro.pagamento_disponivel, false);
    assert.equal(result.headers['set-cookie'], undefined);
  }
  for (const table of ['estabelecimentos', 'funcionarios', 'mesas', 'empresa_config', 'sessoes']) {
    assert.equal(DB.prepare(`SELECT COUNT(*) n FROM ${table}`).first().n, 0, table);
  }
});

test('condições públicas informam taxa única de R$ 50 sem expor credenciais', async () => {
  const result = await authConfigHandler(context(), {
    TURNSTILE_SITE_KEY: 'site-publico', TURNSTILE_SECRET_KEY: 'segredo', PAGBANK_API_TOKEN: 'segredo-pagamento',
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.data, {
    turnstile_site_key: 'site-publico',
    cadastro: { valor_centavos: 5000, moeda: 'BRL', periodicidade: 'unico', pagamento_disponivel: false },
  });
});

test('contas existentes continuam entrando sem cobrança de cadastro', async (t) => {
  const DB = new SqliteDb(':memory:');
  t.after(() => DB.close());
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ success: true }) }));
  DB.prepare('INSERT INTO estabelecimentos (id,nome,cnpj,ativo) VALUES (1,?,?,1)').bind(body.nome, '11222333000181').run();
  DB.prepare("INSERT INTO funcionarios (estabelecimento_id,nome,usuario,senha_hash,perfil,modulos,ativo) VALUES (1,?,'admin',?,'admin','gestor,restaurante',1)")
    .bind(body.nome, await hashSenha(body.senha)).run();
  const login = await loginFuncionarioHandler(context({ ...body, usuario: 'admin' }), { DB, TURNSTILE_SECRET_KEY: 'teste' });
  assert.equal(login.status, 200);
  assert.match(login.headers['set-cookie'], /HttpOnly/);
  assert.equal(DB.prepare('SELECT COUNT(*) n FROM sessoes').first().n, 1);
});

test('rota antiga de colaboração não oferece mais Pix', async () => {
  const result = await handle(context({}, '/api/colaboracao', 'GET'), {});
  assert.equal(result.status, 404);
  assert.equal(result.data.pix_copia_cola, undefined);
});
