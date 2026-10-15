import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DeliveryService } from '../server/service.js';
import { createApp } from '../server/app.js';

const password = 'senha-para-teste-privacidade';

async function fixture(t, filename = ':memory:') {
  let time = new Date('2026-10-13T15:00:00.000Z');
  const now = () => new Date(time);
  const service = new DeliveryService({ filename, now });
  const app = createApp(service, { now });
  const auth = app.locals.auth;
  if (auth.needsSetup()) {
    const support = auth.createAccount(null, { name: 'Suporte', username: 'suporte', password }, true);
    auth.createAccount(support, { name: 'Entregador A', username: 'entregador-a', password, role: 'driver' });
    auth.createAccount(support, { name: 'Entregador B', username: 'entregador-b', password, role: 'driver' });
    auth.createAccount(support, {
      name: 'Estabelecimento', username: 'loja', password, role: 'merchant',
      address: 'Rua da Loja', lat: -23.55, lng: -46.63,
    });
  }
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    service.close();
  }
  t.after(close);
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { method = 'GET', body, cookie, headers = {} } = {}) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: response.status,
      body: response.headers.get('content-type')?.includes('application/json')
        ? await response.json() : await response.text(),
      headers: response.headers,
      cookie: response.headers.get('set-cookie')?.split(';')[0],
    };
  }
  async function login(username) {
    const result = await request('/api/login', { method: 'POST', body: { username, password } });
    assert.equal(result.status, 200);
    return result;
  }
  return { service, request, login, close, advance(ms) { time = new Date(time.getTime() + ms); } };
}

test('informações de privacidade e páginas externas ficam acessíveis sem sessão', async t => {
  const previousContact = process.env.ENTREGAS_PRIVACY_CONTACT;
  const previousOperator = process.env.ENTREGAS_OPERATOR_NAME;
  t.after(() => {
    if (previousContact === undefined) delete process.env.ENTREGAS_PRIVACY_CONTACT;
    else process.env.ENTREGAS_PRIVACY_CONTACT = previousContact;
    if (previousOperator === undefined) delete process.env.ENTREGAS_OPERATOR_NAME;
    else process.env.ENTREGAS_OPERATOR_NAME = previousOperator;
  });
  delete process.env.ENTREGAS_PRIVACY_CONTACT;
  delete process.env.ENTREGAS_OPERATOR_NAME;
  const f = await fixture(t);
  const empty = await f.request('/api/privacy-public');
  assert.equal(empty.status, 200);
  assert.equal(empty.headers.get('cache-control'), 'no-store');
  assert.deepEqual(empty.body, { contact: '', operator: 'DoixP Entregas', configured: false });
  process.env.ENTREGAS_PRIVACY_CONTACT = ' privacidade@example.invalid ';
  process.env.ENTREGAS_OPERATOR_NAME = ' Operador de teste ';
  assert.deepEqual((await f.request('/api/privacy-public')).body, {
    contact: 'privacidade@example.invalid', operator: 'Operador de teste', configured: true,
  });
  for (const path of ['/privacy.html', '/account-deletion.html']) {
    const page = await f.request(path);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
    assert.match(page.body, /src="\/privacy\.js"/);
  }
});

test('somente sessão válida solicita exclusão e os três perfis podem registrar pedido próprio', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/account-deletion')).status, 401);
  assert.equal((await f.request('/api/deletion-requests')).status, 401);
  assert.equal((await f.request('/api/account-deletion', { method: 'POST', body: {} })).status, 401);
  for (const username of ['suporte', 'loja', 'entregador-a']) {
    const session = await f.login(username);
    const created = await f.request('/api/account-deletion', {
      method: 'POST', cookie: session.cookie,
      body: { note: ' Solicito a exclusão. ', userId: 'outra-conta', role: 'support' },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.created, true);
    assert.equal(created.body.request.userId, session.body.user.id);
    assert.equal(created.body.request.role, session.body.user.role);
    assert.equal(created.body.request.username, username);
    assert.equal(created.body.request.note, 'Solicito a exclusão.');
    assert.equal(created.body.request.status, 'pending');
    assert.equal(created.body.request.createdAt, '2026-10-13T15:00:00.000Z');
    // Filing a request must not pretend that the account has been deleted.
    assert.equal((await f.request('/api/me', { cookie: session.cookie })).status, 200);
  }
  assert.equal(f.service.db.prepare('SELECT count(*) AS n FROM users').get().n, 4);
});

test('solicitações são isoladas por conta e a fila completa exige suporte', async t => {
  const f = await fixture(t);
  const first = await f.login('entregador-a');
  const second = await f.login('entregador-b');
  const support = await f.login('suporte');
  const merchant = await f.login('loja');
  const created = await f.request('/api/account-deletion', {
    method: 'POST', cookie: first.cookie, body: { note: 'Nota privada do primeiro entregador' },
  });
  assert.deepEqual((await f.request('/api/account-deletion', { cookie: second.cookie })).body, { requests: [] });
  assert.equal((await f.request('/api/account-deletion', { cookie: first.cookie })).body.requests[0].id, created.body.request.id);
  for (const actor of [first, second, merchant]) {
    assert.equal((await f.request('/api/deletion-requests', { cookie: actor.cookie })).status, 403);
  }
  const queue = await f.request('/api/deletion-requests', { cookie: support.cookie });
  assert.equal(queue.status, 200);
  assert.equal(queue.body.requests.length, 1);
  assert.equal(queue.body.requests[0].name, 'Entregador A');
  assert.equal(queue.body.requests[0].note, 'Nota privada do primeiro entregador');
  assert.equal(queue.body.requests[0].password_hash, undefined);
});

test('reenvios simultâneos mantêm um único pedido pendente e preservam a observação inicial', async t => {
  const f = await fixture(t);
  const session = await f.login('entregador-a');
  const responses = await Promise.all(Array.from({ length: 4 }, () => f.request('/api/account-deletion', {
    method: 'POST', cookie: session.cookie, body: { note: 'Observação original' },
  })));
  assert.equal(responses.filter(response => response.status === 201).length, 1);
  assert.equal(responses.filter(response => response.status === 200).length, 3);
  assert.equal(new Set(responses.map(response => response.body.request.id)).size, 1);
  const repeated = await f.request('/api/account-deletion', {
    method: 'POST', cookie: session.cookie, body: { note: 'Tentativa de alterar a observação' },
  });
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.created, false);
  assert.equal(repeated.body.request.note, 'Observação original');
  assert.equal(f.service.db.prepare('SELECT count(*) AS n FROM account_deletion_requests').get().n, 1);
});

test('notas inválidas, origem externa e sessão expirada não registram solicitações', async t => {
  const f = await fixture(t);
  const session = await f.login('entregador-a');
  for (const body of [{ note: 'x'.repeat(1001) }, { note: 42 }, { note: null }, { note: {} }, []]) {
    assert.equal((await f.request('/api/account-deletion', {
      method: 'POST', cookie: session.cookie, body,
    })).status, 400);
  }
  assert.equal((await f.request('/api/account-deletion', {
    method: 'POST', cookie: session.cookie, body: {}, headers: { Origin: 'https://externo.invalid' },
  })).status, 403);
  assert.equal(f.service.db.prepare('SELECT count(*) AS n FROM account_deletion_requests').get().n, 0);
  f.advance(8 * 60 * 60_000);
  assert.equal((await f.request('/api/account-deletion', { cookie: session.cookie })).status, 401);
  assert.equal((await f.request('/api/account-deletion', { method: 'POST', cookie: session.cookie, body: {} })).status, 401);
  assert.equal(f.service.db.prepare('SELECT count(*) AS n FROM account_deletion_requests').get().n, 0);
});

test('protocolo persiste após reiniciar o servidor e não é duplicado', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'doixp-privacy-'));
  const filename = join(directory, 'database.sqlite');
  const first = await fixture(t, filename);
  let second;
  try {
    const session = await first.login('entregador-a');
    const registered = await first.request('/api/account-deletion', { method: 'POST', cookie: session.cookie, body: {} });
    assert.equal(registered.status, 201);
    await first.close();
    second = await fixture(t, filename);
    const newSession = await second.login('entregador-a');
    const history = await second.request('/api/account-deletion', { cookie: newSession.cookie });
    assert.equal(history.body.requests[0].id, registered.body.request.id);
    const repeated = await second.request('/api/account-deletion', { method: 'POST', cookie: newSession.cookie, body: {} });
    assert.equal(repeated.status, 200);
    assert.equal(repeated.body.request.id, registered.body.request.id);
  } finally {
    await first.close();
    await second?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
