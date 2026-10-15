import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeliveryService } from '../server/service.js';

const support = { id: 'support', role: 'support', name: 'Suporte' };
const merchant = { id: 'merchant', role: 'merchant', name: 'Loja' };
const otherMerchant = { id: 'merchant2', role: 'merchant', name: 'Outra loja' };
const driver = { id: 'driver', role: 'driver', name: 'Entregador' };
const otherDriver = { id: 'driver2', role: 'driver', name: 'Outro entregador' };

function fixture(t, filename = ':memory:') {
  let clock = new Date('2026-10-06T15:00:00Z');
  const service = new DeliveryService({ filename, now: () => clock });
  service.db.exec('CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT, role TEXT)');
  for (const actor of [support, merchant, otherMerchant, driver, otherDriver]) {
    service.db.prepare('INSERT INTO users(id,name,role) VALUES(?,?,?)').run(actor.id, actor.name, actor.role);
    if (actor.role !== 'support') service.registerProfile(actor, { phone: '11999999999', address: 'Rua da Loja, 10', lat: -23.55, lng: -46.64 });
  }
  t.after(() => service.close());
  const order = (options = {}) => service.createOrder(merchant, {
    reference: `PED-${Math.random()}`, customerName: 'Cliente Teste', customerPhone: '11988888888', customerCpfLast4: '0123',
    destinationAddress: 'Rua Particular, 99', destinationLat: -23.57641, destinationLng: -46.61812,
    distanceKm: 5, subsidy: 'base', ready: true, ...options,
  });
  const online = (actor = driver) => service.setAvailability(actor, { online: true, lat: -23.55, lng: -46.64 });
  const pickup = (created = order()) => {
    online();
    const accepted = service.orderAction(driver, created.id, 'accept');
    service.orderAction(merchant, created.id, 'pickup', { code: accepted.pickupCode });
    return service.snapshot(driver).orders.find(o => o.id === created.id);
  };
  return { service, order, online, pickup, setTime(value) { clock = new Date(value); } };
}

function status(code) { return err => err.status === code; }

test('tarifa aplica base de 5 km, frações proporcionais e rateio imutável', t => {
  const { service, order } = fixture(t);
  assert.equal(service.quote(merchant, { distanceKm: 2, subsidy: 'half' }).customerCents, 500);
  assert.deepEqual(service.quote(merchant, { distanceKm: 5.125, subsidy: 'base' }), { distanceKm: 5.125, baseCents: 1000, extraCents: 25, totalCents: 1025, merchantCents: 1000, customerCents: 25, subsidy: 'base' });
  assert.equal(service.quote(merchant, { distanceKm: 7, subsidy: 'full' }).customerCents, 0);
  const created = order({ distanceKm: 7 });
  service.updateSettings(support, { extraKmCents: 500 });
  assert.equal(service.snapshot(merchant).orders.find(o => o.id === created.id).totalCents, 1400);
  assert.equal(service.quote(merchant, { distanceKm: 7 }).totalCents, 2000);
  assert.throws(() => service.updateSettings(merchant, { extraKmCents: 1 }), status(403));
});

test('cliente deve aceitar sua parcela; link não expõe identidade; decisão é idempotente', t => {
  const { service, order, online } = fixture(t);
  const created = order({ subsidy: 'half' });
  online();
  assert.equal(service.snapshot(driver).orders.length, 0);
  assert.throws(() => service.orderAction(driver, created.id, 'accept'), status(409));
  const publicOrder = service.customerOrder(created.customerToken);
  assert.equal(publicOrder.customerName, undefined);
  assert.equal(publicOrder.customerCpfLast4, undefined);
  service.customerDecision(created.customerToken, { accept: true });
  service.customerDecision(created.customerToken, { accept: true });
  assert.throws(() => service.customerDecision(created.customerToken, { accept: false }), status(409));
  assert.equal(service.snapshot(driver).orders.length, 1);
});

test('reenvio da mesma referência evita duplicação, preserva token e valida CPF salgado', t => {
  const { service, order } = fixture(t);
  const first = order({ reference: 'ÚNICA' });
  assert.equal(order({ reference: 'ÚNICA' }).id, first.id);
  assert.equal(order({ reference: 'ÚNICA' }).customerToken, first.customerToken);
  assert.throws(() => order({ reference: 'ÚNICA', customerCpfLast4: '1234' }), status(409));
  assert.throws(() => order({ reference: 'ÚNICA', destinationAddress: 'Outro lugar' }), status(409));
  const persisted = service.db.prepare('SELECT detail,delivery_hash,delivery_salt FROM delivery_orders WHERE id=?').get(first.id);
  assert.ok(!persisted.detail.includes('0123'));
  assert.notEqual(persisted.delivery_hash, '0123');
  assert.ok(persisted.delivery_salt.length >= 32);
});

test('oferta preserva privacidade e somente retirada pronta revela cliente ao entregador', t => {
  const { service, order, online } = fixture(t);
  const created = order({ ready: false });
  online();
  const offer = service.snapshot(driver).orders[0];
  for (const field of ['customerName', 'customerPhone', 'destinationAddress', 'destinationLat', 'destinationLng', 'pickupCode', 'customerToken', 'delivery_hash']) assert.equal(offer[field], undefined, field);
  assert.deepEqual(offer.destinationApprox, { lat: -23.58, lng: -46.62 });
  const accepted = service.orderAction(driver, created.id, 'accept');
  assert.match(accepted.pickupCode, /^\d{6}$/);
  assert.equal(accepted.customerName, undefined);
  assert.equal(service.snapshot(merchant).orders[0].pickupCode, undefined);
  assert.equal(service.snapshot(support).orders[0].pickupCode, undefined);
  assert.throws(() => service.orderAction(merchant, created.id, 'pickup', { code: accepted.pickupCode }), status(409));
  service.orderAction(merchant, created.id, 'ready');
  service.orderAction(merchant, created.id, 'pickup', { code: accepted.pickupCode });
  const pickedUp = service.snapshot(driver).orders[0];
  assert.equal(pickedUp.customerName, 'Cliente Teste');
  assert.equal(pickedUp.destinationAddress, 'Rua Particular, 99');
  assert.equal(pickedUp.pickupCode, undefined);
  assert.equal(service.snapshot(otherMerchant).orders.length, 0);
  assert.throws(() => service.orderAction(otherDriver, created.id, 'deliver', { code: '0123' }), status(403));
});

test('localização vencida impede aceitar e apenas uma corrida ativa é permitida', t => {
  const { service, order, online, setTime } = fixture(t);
  const first = order(), second = order();
  online();
  setTime('2026-10-06T15:02:01Z');
  assert.equal(service.snapshot(driver).drivers[0].online, false);
  assert.throws(() => service.orderAction(driver, first.id, 'accept'), status(403));
  service.heartbeat(driver, { lat: -23.55, lng: -46.64 });
  service.orderAction(driver, first.id, 'accept');
  assert.throws(() => service.orderAction(driver, second.id, 'accept'), status(409));
  online(otherDriver);
  assert.throws(() => service.orderAction(otherDriver, first.id, 'accept'), status(409));
});

test('oferta alcança apenas entregadores online perto da loja e o aceite confere a região de novo', t => {
  const { service, order, online } = fixture(t);
  const created = order();
  online(driver);
  service.setAvailability(otherDriver, { online: true, lat: -22.90, lng: -43.20 });
  assert.equal(service.snapshot(driver).orders.some(row => row.id === created.id), true);
  assert.equal(service.snapshot(otherDriver).orders.some(row => row.id === created.id), false);
  assert.throws(() => service.orderAction(otherDriver, created.id, 'accept'), status(403));
  service.heartbeat(otherDriver, { lat: -23.55, lng: -46.64 });
  assert.equal(service.snapshot(otherDriver).orders.some(row => row.id === created.id), true);
  service.orderAction(otherDriver, created.id, 'accept');
  service.heartbeat(otherDriver, { lat: -22.90, lng: -43.20 });
  assert.equal(service.snapshot(otherDriver).orders.some(row => row.id === created.id), true);
});

test('pedido de venda confirmada cria uma só corrida e exige valor reservado integral ao entregador', t => {
  const { service, online } = fixture(t);
  service.db.prepare('UPDATE delivery_profiles SET online_establishment_id=? WHERE user_id=?').run(42, merchant.id);
  const input = {
    establishmentId: 42, reference: 'ONLINE-42-9', paymentReference: 'provider-payment-9', fundedDriverCents: 1400,
    customerName: 'Cliente Online', customerPhone: '11988888888', customerCpfLast4: '0042',
    destinationAddress: 'Rua Destino, 25', destinationLat: -23.57641, destinationLng: -46.61812,
    distanceKm: 7, subsidy: 'base', ready: false,
  };
  assert.throws(() => service.createIntegratedOrder({ ...input, fundedDriverCents: 1200 }), status(409));
  assert.throws(() => service.createIntegratedOrder({ ...input, establishmentId: 99 }), status(404));
  const created = service.createIntegratedOrder(input);
  assert.equal(created.status, 'searching');
  assert.equal(created.origin, 'online');
  assert.equal(created.paymentReference, 'provider-payment-9');
  assert.equal(created.fundedDriverCents, 1400);
  assert.equal(service.createIntegratedOrder(input).id, created.id);
  assert.throws(() => service.createIntegratedOrder({ ...input, reference: 'ONLINE-42-10' }), status(409));
  assert.throws(() => service.createIntegratedOrder({ ...input, paymentReference: 'provider-payment-10' }), status(409));
  online();
  assert.equal(service.snapshot(driver).orders.some(row => row.id === created.id), true);
  assert.equal(service.snapshot(driver).orders.find(row => row.id === created.id).paymentReference, undefined);
});

test('Pix manual conserva o frete aceito no checkout mesmo após mudança da tarifa', t => {
  const { service } = fixture(t);
  service.db.prepare('UPDATE delivery_profiles SET online_establishment_id=? WHERE user_id=?').run(7, merchant.id);
  service.updateSettings(support, { extraKmCents: 500 });
  const body = {
    establishmentId: 7, reference: 'PEDIDO-ONLINE-7', paymentReference: 'pix-manual:7:7', paymentMode: 'pix_confirmed_manually',
    customerName: 'Cliente Pix', customerPhone: '11988888888', customerCpfLast4: '0042',
    destinationAddress: 'Rua Destino, 25', destinationLat: -23.57, destinationLng: -46.62,
    distanceKm: 7, subsidy: 'base', ready: false,
    quotedTotalCents: 1400, quotedMerchantCents: 1000, quotedCustomerCents: 400,
  };
  const created = service.createIntegratedOrder(body);
  assert.equal(created.totalCents, 1400);
  assert.equal(created.customerCents, 400);
  assert.equal(created.fundedDriverCents, null);
  assert.equal(created.paymentMode, 'pix_confirmed_manually');
  assert.equal(service.createIntegratedOrder(body).id, created.id);
  assert.throws(() => service.createIntegratedOrder({ ...body, quotedCustomerCents: 500 }), status(409));
});

test('tentativas de código persistem apesar do erro e cinco bloqueiam com ocorrência', t => {
  const { service, order, online } = fixture(t);
  const created = order();
  online();
  const accepted = service.orderAction(driver, created.id, 'accept');
  const wrong = accepted.pickupCode === '000000' ? '999999' : '000000';
  for (let i = 0; i < 5; i++) assert.throws(() => service.orderAction(merchant, created.id, 'pickup', { code: wrong }), status(i === 4 ? 429 : 400));
  assert.equal(service.db.prepare('SELECT pickup_attempts FROM delivery_orders WHERE id=?').get(created.id).pickup_attempts, 5);
  assert.equal(service.snapshot(merchant).orders[0].status, 'incident');
  assert.equal(service.snapshot(support).incidents.length, 1);
  assert.throws(() => service.orderAction(merchant, created.id, 'pickup', { code: accepted.pickupCode }), status(409));
  service.orderAction(support, created.id, 'resolve', { resolution: 'resume', note: 'Conferência presencial concluída.' });
  service.orderAction(merchant, created.id, 'pickup', { code: accepted.pickupCode });
  for (let i = 0; i < 5; i++) assert.throws(() => service.orderAction(driver, created.id, 'deliver', { code: '5555' }), status(i === 4 ? 429 : 400));
  assert.equal(service.snapshot(driver).orders[0].status, 'incident');
});

test('cliente ausente exige contato em sequência, suporte define compensação explícita', t => {
  const { service, pickup, setTime } = fixture(t);
  const row = pickup();
  assert.throws(() => service.orderAction(driver, row.id, 'contact-merchant', { note: 'Ligação.' }), status(409));
  assert.throws(() => service.orderAction(driver, row.id, 'report', { kind: 'unreachable', note: 'Não atendeu.' }), status(409));
  service.orderAction(driver, row.id, 'contact-customer', { note: 'Ligação ao cliente sem resposta.' });
  service.orderAction(driver, row.id, 'contact-merchant', { note: 'Loja informada sobre ausência.' });
  service.orderAction(driver, row.id, 'report', { kind: 'unreachable', note: 'Aguardando orientação.' });
  assert.throws(() => service.orderAction(support, row.id, 'resolve', { resolution: 'returned', note: 'Mercadoria devolvida.' }), status(400));
  const returned = service.orderAction(support, row.id, 'resolve', { resolution: 'returned', note: 'Mercadoria devolvida e deslocamento validado.', compensationCents: 700 });
  assert.equal(returned.status, 'returned');
  assert.equal(returned.compensationCents, 700);
  setTime('2026-10-12T03:00:00Z');
  const settlements = service.closeWeek(support, { weekStart: '2026-10-05' });
  assert.equal(settlements[0].cents, 700);
  assert.equal(settlements[0].count, 1);
});

test('cancelamento após retirada exige suporte e suspeita de fraude mantém suspensão após resolver pedido', t => {
  const { service, pickup, online } = fixture(t);
  const row = pickup();
  assert.equal(service.orderAction(merchant, row.id, 'cancel').status, 'incident');
  service.orderAction(merchant, row.id, 'report', { kind: 'fraud', note: 'Verificar divergência na coleta.' });
  assert.equal(service.snapshot(driver).drivers[0].suspended, true);
  service.orderAction(support, row.id, 'resolve', { resolution: 'resume', note: 'Pedido pode prosseguir.' });
  assert.throws(() => online(), status(403));
  assert.throws(() => service.orderAction(driver, row.id, 'deliver', { code: '0123' }), status(403));
  service.reviewDriver(support, driver.id, { suspended: false, note: 'Análise independente concluída.' });
  service.orderAction(driver, row.id, 'deliver', { code: '0123' });
  assert.equal(service.snapshot(driver).orders[0].status, 'delivered');
});

test('fechamento respeita semana São Paulo, não duplica e pagamento requer referência', t => {
  const { service, pickup, setTime } = fixture(t);
  const row = pickup();
  service.orderAction(driver, row.id, 'deliver', { code: '0123' });
  assert.throws(() => service.closeWeek(support, { weekStart: '2026-10-06' }), status(400));
  setTime('2026-10-12T02:59:59Z');
  assert.throws(() => service.closeWeek(support, { weekStart: '2026-10-05' }), status(409));
  setTime('2026-10-12T03:00:00Z');
  const settlements = service.closeWeek(support, { weekStart: '2026-10-05' });
  assert.equal(settlements.length, 1);
  assert.equal(settlements[0].cents, 1000);
  assert.equal(service.closeWeek(support, { weekStart: '2026-10-05' })[0].id, settlements[0].id);
  assert.throws(() => service.markPaid(support, settlements[0].id, {}), status(400));
  const paid = service.markPaid(support, settlements[0].id, { reference: 'COMPROVANTE-1' });
  assert.equal(paid.status, 'paid');
  assert.equal(service.markPaid(support, paid.id, { reference: 'COMPROVANTE-1' }).id, paid.id);
  assert.throws(() => service.markPaid(support, paid.id, { reference: 'DIFERENTE' }), status(409));
  assert.equal(service.snapshot(otherDriver).settlements.length, 0);
});

test('disputa após fechamento bloqueia registro de pagamento até análise', t => {
  const { service, pickup, setTime } = fixture(t);
  const row = pickup();
  service.orderAction(driver, row.id, 'deliver', { code: '0123' });
  setTime('2026-10-12T03:00:00Z');
  const [settlement] = service.closeWeek(support, { weekStart: '2026-10-05' });
  service.orderAction(merchant, row.id, 'report', { kind: 'other', note: 'Cliente contesta recebimento.' });
  assert.throws(() => service.markPaid(support, settlement.id, { reference: 'PIX-1' }), status(409));
  service.orderAction(support, row.id, 'resolve', { resolution: 'resume', note: 'Recebimento confirmado na análise.' });
  assert.equal(service.markPaid(support, settlement.id, { reference: 'PIX-1' }).status, 'paid');
});

test('ocorrência retida fica fora do fechamento e pode entrar após resolução sem duplicar', t => {
  const { service, pickup, setTime } = fixture(t);
  const row = pickup();
  service.orderAction(driver, row.id, 'deliver', { code: '0123' });
  service.orderAction(merchant, row.id, 'report', { kind: 'other', note: 'Conferência pendente.' });
  setTime('2026-10-12T03:00:00Z');
  assert.deepEqual(service.closeWeek(support, { weekStart: '2026-10-05' }), []);
  service.orderAction(support, row.id, 'resolve', { resolution: 'resume', note: 'Entrega confirmada.' });
  assert.equal(service.closeWeek(support, { weekStart: '2026-10-05' })[0].cents, 1000);
});

test('SQLite persistente arbitra aceite entre conexões e preserva dados após reabrir', t => {
  const directory = mkdtempSync(join(tmpdir(), 'entregas-domain-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, 'database.sqlite');
  const { service, order, online } = fixture(t, filename);
  const row = order();
  online(); online(otherDriver);
  const second = new DeliveryService({ filename, now: () => new Date('2026-10-06T15:00:00Z') });
  t.after(() => second.close());
  service.orderAction(driver, row.id, 'accept');
  assert.throws(() => second.orderAction(otherDriver, row.id, 'accept'), status(409));
  assert.equal(second.snapshot(merchant).orders[0].driverId, driver.id);
});

test('registerProfile pode participar da transação de criação de conta', t => {
  const { service } = fixture(t);
  service.db.exec('BEGIN IMMEDIATE');
  service.db.prepare('INSERT INTO users(id,name,role) VALUES(?,?,?)').run('novo', 'Novo', 'driver');
  service.registerProfile({ id: 'novo', role: 'driver' }, {});
  service.db.exec('ROLLBACK');
  assert.equal(service.db.prepare('SELECT user_id FROM delivery_profiles WHERE user_id=?').get('novo'), undefined);
});
