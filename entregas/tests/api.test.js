import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { DeliveryService } from '../server/service.js';
import { createApp } from '../server/app.js';

const PASSWORD = 'senha-segura-de-teste';
const supportInput = { name: 'Suporte', username: 'suporte', password: PASSWORD };
const merchantInput = {
  name: 'Estabelecimento A', username: 'loja-a', password: PASSWORD, role: 'merchant',
  phone: '11911112222', address: 'Rua da Coleta, 10', lat: -23.55, lng: -46.63,
};
const orderInput = {
  reference: 'PED-001', customerName: 'Cliente de teste', customerPhone: '11933334444',
  customerCpfLast4: '0012', destinationAddress: 'Rua da Entrega, 20',
  destinationLat: -23.56, destinationLng: -46.64, distanceKm: 7, subsidy: 'base', ready: true,
};

async function fixture(t, options = {}) {
  let time = new Date('2026-10-13T15:00:00.000Z');
  const now = () => new Date(time);
  const service = new DeliveryService({ filename: ':memory:', now });
  const app = createApp(service, { now, ...options });
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
  } catch (error) {
    service.close();
    throw error;
  }
  t.after(async () => {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    service.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { method = 'GET', body, cookie, headers = {}, raw } = {}) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
    return {
      status: response.status,
      body: await response.json(),
      headers: response.headers,
      cookie: response.headers.get('set-cookie')?.split(';')[0],
    };
  }
  async function login(username = supportInput.username, password = PASSWORD) {
    return request('/api/login', { method: 'POST', body: { username, password } });
  }
  function setup() { return app.locals.auth.createAccount(null, supportInput, true); }
  return {
    service, auth: app.locals.auth, request, login, setup, base,
    advance(milliseconds) { time = new Date(time.getTime() + milliseconds); },
  };
}

function assertSafeUser(user, role) {
  assert.equal(user.role, role);
  assert.deepEqual(Object.keys(user).sort(), ['id', 'name', 'role', 'username']);
  assert.equal(typeof user.id, 'string');
}

test('configuração inicial cria um único suporte e não permite repetir o cadastro', async t => {
  const f = await fixture(t);
  assert.deepEqual((await f.request('/api/bootstrap')).body, { needsSetup: true });
  const setup = await f.request('/api/setup', {
    method: 'POST', body: { ...supportInput, role: 'driver' },
  });
  assert.equal(setup.status, 201);
  assertSafeUser(setup.body.user, 'support');
  assert.match(setup.cookie, /^doixp_entregas=[\w-]{43}$/);
  assert.deepEqual((await f.request('/api/bootstrap')).body, { needsSetup: false });
  const repeat = await f.request('/api/setup', {
    method: 'POST', body: { ...supportInput, username: 'outro-suporte' },
  });
  assert.equal(repeat.status, 409);
  assert.equal(repeat.cookie, undefined);
  assert.equal(f.service.db.prepare('SELECT count(*) AS total FROM users').get().total, 1);
  assert.equal((await f.request('/api/me', { cookie: setup.cookie })).body.user.id, setup.body.user.id);
});

test('login normaliza usuário, cria cookie protegido e logout revoga a sessão', async t => {
  const f = await fixture(t, { secureCookie: true });
  const support = f.setup();
  assert.equal((await f.request('/api/me')).status, 401);
  assert.equal((await f.request('/api/state')).status, 401);
  const login = await f.login('  SUPORTE  ');
  assert.equal(login.status, 200);
  assertSafeUser(login.body.user, 'support');
  const setCookie = login.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Secure/);
  const cookie = `outra=valor; ${login.cookie}; preferencia=clara`;
  const me = await f.request('/api/me', { cookie });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.id, support.id);
  assertSafeUser(me.body.user, 'support');
  assert.equal(me.headers.get('cache-control'), 'no-store');
  const token = login.cookie.slice('doixp_entregas='.length);
  const session = f.service.db.prepare('SELECT token_hash FROM sessions').get();
  assert.equal(session.token_hash, createHash('sha256').update(token).digest('hex'));
  assert.notEqual(session.token_hash, token);
  const logout = await f.request('/api/logout', { method: 'POST', body: {}, cookie });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /doixp_entregas=;/);
  assert.equal((await f.request('/api/me', { cookie })).status, 401);
  assert.equal(f.service.db.prepare('SELECT count(*) AS total FROM sessions').get().total, 0);
});

test('sessões expiram após oito horas e cookies alterados não autenticam', async t => {
  const f = await fixture(t);
  f.setup();
  const login = await f.login();
  const token = login.cookie.slice('doixp_entregas='.length);
  const different = `${token[0] === 'a' ? 'b' : 'a'}${token.slice(1)}`;
  assert.equal((await f.request('/api/me', { cookie: `doixp_entregas=${different}` })).status, 401);
  assert.equal((await f.request('/api/me', { cookie: 'doixp_entregas=%ZZ' })).status, 401);
  f.advance(8 * 60 * 60_000 - 1);
  assert.equal((await f.request('/api/me', { cookie: login.cookie })).status, 200);
  f.advance(1);
  assert.equal((await f.request('/api/me', { cookie: login.cookie })).status, 401);
});

test('login não revela se o usuário existe e bloqueia depois de quinze falhas', async t => {
  const f = await fixture(t);
  f.setup();
  const missing = await f.login('inexistente', 'senha-errada');
  const wrong = await f.login('suporte', 'senha-errada');
  assert.equal(missing.status, 401);
  assert.deepEqual(missing.body, wrong.body);
  for (let attempt = 2; attempt < 15; attempt += 1) {
    const response = await f.login(`usuario-${attempt}`, 'senha-errada');
    assert.equal(response.status, 401, `falha ${attempt + 1}`);
  }
  assert.equal((await f.login()).status, 429);
  f.advance(15 * 60_000);
  assert.equal((await f.login()).status, 200);
});

test('origem externa e conteúdo diferente de JSON não alteram os dados', async t => {
  const f = await fixture(t);
  const foreign = await f.request('/api/setup', {
    method: 'POST', body: supportInput, headers: { Origin: 'https://site-externo.invalid' },
  });
  assert.equal(foreign.status, 403);
  const malformedOrigin = await f.request('/api/setup', {
    method: 'POST', body: supportInput, headers: { Origin: 'null' },
  });
  assert.equal(malformedOrigin.status, 403);
  const text = await f.request('/api/setup', {
    method: 'POST', body: supportInput, headers: { 'Content-Type': 'text/plain' },
  });
  assert.equal(text.status, 415);
  const invalidJson = await f.request('/api/setup', {
    method: 'POST', raw: '{invalid', headers: { 'Content-Type': 'application/json' },
  });
  assert.equal(invalidJson.status, 400);
  assert.equal(f.auth.needsSetup(), true);
  const sameOrigin = await f.request('/api/setup', {
    method: 'POST', body: supportInput, headers: { Origin: f.base },
  });
  assert.equal(sameOrigin.status, 201);
});

test('integração aceita apenas pedido assinado pelo servidor de vendas e vinculado à loja', async t => {
  const secret = 'segredo-da-integracao-de-testes-com-mais-de-32-caracteres';
  const f = await fixture(t, { integrationSecret: secret });
  const support = f.setup();
  f.auth.createAccount(support, { ...merchantInput, onlineEstablishmentId: 42 });
  const body = { establishmentId: 42, ...orderInput, fundedDriverCents: 1400, paymentReference: 'PSP-123' };
  const signed = payload => {
    const timestamp = String(Date.parse('2026-10-13T15:00:00.000Z'));
    const raw = JSON.stringify(payload);
    return { timestamp, raw, signature: createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex') };
  };
  const message = signed(body);
  const path = '/api/integration/orders';
  assert.equal((await f.request(path, { method: 'POST', body })).status, 401);
  assert.equal((await f.request(path, { method: 'POST', body, headers: { 'x-doixp-timestamp': message.timestamp, 'x-doixp-signature': '0'.repeat(64) } })).status, 401);
  const headers = { 'x-doixp-timestamp': message.timestamp, 'x-doixp-signature': message.signature };
  const created = await f.request(path, { method: 'POST', body, headers });
  assert.equal(created.status, 201);
  assert.equal(created.body.status, 'searching');
  assert.equal((await f.request(path, { method: 'POST', body, headers })).body.id, created.body.id);
  const altered = { ...body, paymentReference: 'PSP-456' };
  assert.equal((await f.request(path, { method: 'POST', body: altered, headers })).status, 401);
  const timestamp = message.timestamp;
  const listHeaders = { 'x-doixp-timestamp': timestamp, 'x-doixp-signature': createHmac('sha256', secret).update(`${timestamp}.`).digest('hex') };
  const listed = await f.request('/api/integration/stores/42/orders', { headers: listHeaders });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.length, 1);
  assert.equal(listed.body[0].id, created.body.id);
  const readyMessage = signed({});
  const ready = await f.request(`/api/integration/stores/42/orders/${created.body.id}/ready`, {
    method: 'POST', body: {}, headers: { 'x-doixp-timestamp': readyMessage.timestamp, 'x-doixp-signature': readyMessage.signature },
  });
  assert.equal(ready.status, 200);
  assert.equal(ready.body.ready, true);
  const crossStoreMessage = signed({});
  assert.equal((await f.request(`/api/integration/stores/43/orders/${created.body.id}/cancel`, {
    method: 'POST', body: {}, headers: { 'x-doixp-timestamp': crossStoreMessage.timestamp, 'x-doixp-signature': crossStoreMessage.signature },
  })).status, 404);
  const old = signed({ ...body, reference: 'OUTRO' });
  assert.equal((await f.request(path, { method: 'POST', raw: old.raw, headers: { 'Content-Type': 'application/json', 'x-doixp-timestamp': String(Number(old.timestamp) - 300001), 'x-doixp-signature': old.signature } })).status, 401);
});

test('entregador cadastra a própria conta e só fica online depois da aprovação', async t => {
  const f = await fixture(t);
  const beforeSetup = await f.request('/api/driver/register', { method: 'POST', body: { name: 'Moto', username: 'moto', password: PASSWORD } });
  assert.equal(beforeSetup.status, 503);
  const support = f.setup();
  const registration = await f.request('/api/driver/register', { method: 'POST', body: { name: 'Moto', username: 'moto', password: PASSWORD, phone: '11987654321', role: 'support' } });
  assert.equal(registration.status, 201);
  assert.equal(registration.body.user.role, 'driver');
  assert.equal(registration.body.approvalPending, true);
  const account = registration.body.user;
  assert.equal((await f.request('/api/state', { cookie: registration.cookie })).body.drivers[0].approved, false);
  assert.equal((await f.request('/api/availability', { method: 'POST', cookie: registration.cookie, body: { online: true, lat: -23.55, lng: -46.64 } })).status, 403);
  f.service.reviewDriver(support, account.id, { suspended: false, note: 'Cadastro e documentação conferidos.' });
  assert.equal((await f.request('/api/availability', { method: 'POST', cookie: registration.cookie, body: { online: true, lat: -23.55, lng: -46.64 } })).status, 200);
  const driverPage = await fetch(`${f.base}/driver`);
  assert.equal(driverPage.status, 200);
  assert.match(await driverPage.text(), /DoixP Entregas/);
});

test('cadastros rejeitam senhas fracas e não permitem criar outro suporte pela API', async t => {
  const f = await fixture(t);
  const invalidSetup = await f.request('/api/setup', {
    method: 'POST', body: { ...supportInput, password: 'curta' },
  });
  assert.equal(invalidSetup.status, 400);
  assert.equal(f.auth.needsSetup(), true);
  f.setup();
  const login = await f.login();
  const extraSupport = await f.request('/api/accounts', {
    method: 'POST', cookie: login.cookie,
    body: { name: 'Outro suporte', username: 'outro', password: PASSWORD, role: 'support' },
  });
  assert.equal(extraSupport.status, 400);
  const accounts = await f.request('/api/accounts', { cookie: login.cookie });
  assert.equal(accounts.status, 200);
  assert.equal(accounts.body.length, 1);
  assertSafeUser(accounts.body[0], 'support');
  assert.equal((await f.request('/api/accounts')).status, 401);
  assert.equal((await f.request('/api/settings', { method: 'PATCH', body: {} })).status, 401);
});

test('somente suporte cadastra perfis, altera tarifas e registra fechamento', async t => {
  const f = await fixture(t);
  f.setup();
  const support = await f.login();
  const merchant = await f.request('/api/accounts', {
    method: 'POST', cookie: support.cookie, body: merchantInput,
  });
  assert.equal(merchant.status, 201);
  assertSafeUser(merchant.body, 'merchant');
  const driver = await f.request('/api/accounts', {
    method: 'POST', cookie: support.cookie,
    body: { name: 'Entregador', username: 'entregador', password: PASSWORD, role: 'driver' },
  });
  assert.equal(driver.status, 201);
  assertSafeUser(driver.body, 'driver');
  const accounts = await f.request('/api/accounts', { cookie: support.cookie });
  const registeredMerchant = accounts.body.find(account => account.id === merchant.body.id);
  assert.equal(registeredMerchant.phone, merchantInput.phone);
  assert.equal(registeredMerchant.lat, merchantInput.lat);
  assert.equal(registeredMerchant.lng, merchantInput.lng);
  assert.equal(registeredMerchant.password_hash, undefined);
  const settings = await f.request('/api/settings', {
    method: 'PATCH', cookie: support.cookie, body: { extraKmCents: 250 },
  });
  assert.equal(settings.status, 200);
  assert.equal(settings.body.extraKmCents, 250);
  for (const username of [merchantInput.username, 'entregador']) {
    const actor = await f.login(username);
    assert.equal(actor.status, 200);
    assert.equal((await f.request('/api/accounts', { cookie: actor.cookie })).status, 403);
    assert.equal((await f.request('/api/accounts', {
      method: 'POST', cookie: actor.cookie, body: { ...merchantInput, username: 'invasor' },
    })).status, 403);
    assert.equal((await f.request('/api/settings', {
      method: 'PATCH', cookie: actor.cookie, body: { extraKmCents: 0 },
    })).status, 403);
    assert.equal((await f.request('/api/settlements/close', {
      method: 'POST', cookie: actor.cookie, body: { weekStart: '2026-10-05' },
    })).status, 403);
    assert.equal((await f.request(`/api/drivers/${driver.body.id}/review`, {
      method: 'POST', cookie: actor.cookie, body: { suspended: false, note: 'Tentativa sem autorização' },
    })).status, 403);
  }
  const state = await f.request('/api/state', { cookie: support.cookie });
  assert.equal(state.body.settings.extraKmCents, 250);
  assert.equal((await f.request('/api/accounts', { cookie: support.cookie })).body.length, 3);
});

test('falha no perfil reverte também o usuário e permite corrigir o cadastro', async t => {
  const f = await fixture(t);
  f.setup();
  const support = await f.login();
  const invalid = await f.request('/api/accounts', {
    method: 'POST', cookie: support.cookie, body: { ...merchantInput, address: '' },
  });
  assert.equal(invalid.status, 400);
  assert.equal(f.service.db.prepare('SELECT id FROM users WHERE username=?').get(merchantInput.username), undefined);
  const corrected = await f.request('/api/accounts', {
    method: 'POST', cookie: support.cookie, body: merchantInput,
  });
  assert.equal(corrected.status, 201);
  const duplicate = await f.request('/api/accounts', {
    method: 'POST', cookie: support.cookie, body: merchantInput,
  });
  assert.equal(duplicate.status, 409);
});

test('pedidos isolam estabelecimentos e liberam dados do cliente apenas após retirada', async t => {
  const f = await fixture(t);
  const support = f.setup();
  const merchant = f.auth.createAccount(support, merchantInput);
  const other = f.auth.createAccount(support, { ...merchantInput, name: 'Estabelecimento B', username: 'loja-b' });
  const driver = f.auth.createAccount(support, { name: 'Entregador', username: 'entregador', password: PASSWORD, role: 'driver' });
  const merchantLogin = await f.login(merchant.username);
  const otherLogin = await f.login(other.username);
  const driverLogin = await f.login(driver.username);
  const created = await f.request('/api/orders', {
    method: 'POST', cookie: merchantLogin.cookie, body: { ...orderInput, merchantId: other.id },
  });
  assert.equal(created.status, 201);
  const order = created.body;
  assert.equal(order.merchantId, merchant.id);
  assert.equal(order.status, 'awaiting_customer');
  assert.equal(order.customerCpfLast4, undefined);
  assert.equal(order.delivery_hash, undefined);
  assert.equal(order.pickupCode, undefined);
  const otherState = await f.request('/api/state', { cookie: otherLogin.cookie });
  assert.deepEqual(otherState.body.orders, []);
  assert.equal((await f.request(`/api/orders/${order.id}/ready`, {
    method: 'POST', cookie: otherLogin.cookie, body: {},
  })).status, 403);
  const publicOrder = await f.request(`/api/customer/${order.customerToken}`);
  assert.equal(publicOrder.status, 200);
  assert.equal(publicOrder.body.customerName, undefined);
  assert.equal(publicOrder.body.customerPhone, undefined);
  assert.equal(publicOrder.body.destinationAddress, undefined);
  assert.equal((await f.request('/api/customer/token-inexistente')).status, 404);
  const approved = await f.request(`/api/customer/${order.customerToken}`, { method: 'POST', body: { accept: true } });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.status, 'searching');
  const online = await f.request('/api/availability', {
    method: 'POST', cookie: driverLogin.cookie, body: { online: true, lat: -23.55, lng: -46.63 },
  });
  assert.equal(online.status, 200);
  const available = (await f.request('/api/state', { cookie: driverLogin.cookie })).body.orders;
  assert.equal(available.length, 1);
  assert.equal(available[0].customerName, undefined);
  assert.equal(available[0].customerToken, undefined);
  const accepted = await f.request(`/api/orders/${order.id}/accept`, { method: 'POST', cookie: driverLogin.cookie, body: {} });
  assert.equal(accepted.status, 200);
  assert.match(accepted.body.pickupCode, /^\d{6}$/);
  assert.equal(accepted.body.customerName, undefined);
  assert.equal(accepted.body.customerPhone, undefined);
  const pickupBody = { code: accepted.body.pickupCode };
  assert.equal((await f.request(`/api/orders/${order.id}/pickup`, {
    method: 'POST', cookie: driverLogin.cookie, body: pickupBody,
  })).status, 403);
  assert.equal((await f.request(`/api/orders/${order.id}/pickup`, {
    method: 'POST', cookie: otherLogin.cookie, body: pickupBody,
  })).status, 403);
  const pickedUp = await f.request(`/api/orders/${order.id}/pickup`, {
    method: 'POST', cookie: merchantLogin.cookie, body: pickupBody,
  });
  assert.equal(pickedUp.status, 200);
  const inTransit = (await f.request('/api/state', { cookie: driverLogin.cookie })).body.orders[0];
  assert.equal(inTransit.status, 'in_transit');
  assert.equal(inTransit.customerName, orderInput.customerName);
  assert.equal(inTransit.customerPhone, orderInput.customerPhone);
  assert.equal(inTransit.pickupCode, undefined);
  assert.equal(inTransit.customerCpfLast4, undefined);
  assert.equal(inTransit.customerToken, undefined);
  const delivered = await f.request(`/api/orders/${order.id}/deliver`, {
    method: 'POST', cookie: driverLogin.cookie, body: { code: '0012' },
  });
  assert.equal(delivered.status, 200);
  assert.equal(delivered.body.status, 'delivered');
});
