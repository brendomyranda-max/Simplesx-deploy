import test from 'node:test';
import assert from 'node:assert/strict';
import { DeliveryService } from '../server/service.js';
import { Auth } from '../server/auth.js';

function fixture(t) {
  let date = new Date('2026-10-05T12:00:00Z');
  const now = () => date;
  const service = new DeliveryService({ now });
  const auth = new Auth(service, { now });
  t.after(() => service.close());
  const support = auth.createAccount(null, { name: 'Suporte', username: 'suporte', password: 'senha-teste-123' }, true);
  const merchant = auth.createAccount(support, { name: 'Loja A', username: 'loja.a', password: 'senha-teste-123', role: 'merchant', address: 'Rua da Loja, 10', phone: '11999990000', lat: -23.55, lng: -46.63 });
  const otherMerchant = auth.createAccount(support, { name: 'Loja B', username: 'loja.b', password: 'senha-teste-123', role: 'merchant', address: 'Rua Outra, 12', phone: '11999990001', lat: -23.56, lng: -46.64 });
  const driver = auth.createAccount(support, { name: 'Entregador A', username: 'moto.a', password: 'senha-teste-123', role: 'driver', phone: '11999990002' });
  const otherDriver = auth.createAccount(support, { name: 'Entregador B', username: 'moto.b', password: 'senha-teste-123', role: 'driver', phone: '11999990003' });
  const order = (overrides = {}) => service.createOrder(merchant, {
    reference: `PED-${Math.random().toString(16).slice(2)}`, customerName: 'Cliente Privado', customerPhone: '11987654321',
    customerCpfLast4: '0012', destinationAddress: 'Rua do Cliente, 99', destinationLat: -23.58, destinationLng: -46.67,
    distanceKm: 6, subsidy: 'full', ready: true, ...overrides,
  });
  const online = who => service.setAvailability(who, { online: true, lat: -23.55, lng: -46.63 });
  const pickup = (created, who = driver) => {
    online(who);
    service.orderAction(who, created.id, 'accept', {});
    const visible = service.snapshot(who).orders.find(o => o.id === created.id);
    service.orderAction(merchant, created.id, 'pickup', { code: visible.pickupCode });
  };
  return { service, auth, support, merchant, otherMerchant, driver, otherDriver, order, online, pickup, advance: value => { date = new Date(value); } };
}

test('frete em centavos, limites dos 5 km e rateio explícito da base', t => {
  const f = fixture(t);
  for (const [distanceKm, total] of [[0.01, 1000], [4.99, 1000], [5, 1000], [5.5, 1100], [7, 1400]]) {
    for (const subsidy of ['full', 'base', 'half']) {
      const quote = f.service.quote(f.merchant, { distanceKm, subsidy });
      assert.equal(quote.totalCents, total);
      assert.equal(quote.merchantCents + quote.customerCents, total);
      assert.equal(quote.merchantCents, subsidy === 'full' ? total : subsidy === 'base' ? 1000 : 500);
    }
  }
  for (const distanceKm of [0, -1, Infinity, NaN, 'abc']) assert.throws(() => f.service.quote(f.merchant, { distanceKm, subsidy: 'base' }));
  assert.throws(() => f.service.updateSettings(f.merchant, { extraKmCents: 300 }));
});

test('concordância do cliente precede oferta e mudança de tarifa não altera pedido', t => {
  const f = fixture(t);
  f.online(f.driver);
  const created = f.order({ subsidy: 'base' });
  assert.equal(created.status, 'awaiting_customer');
  assert.ok(created.customerToken);
  assert.equal(f.service.snapshot(f.driver).orders.length, 0);
  assert.throws(() => f.service.orderAction(f.driver, created.id, 'accept', {}));
  f.service.updateSettings(f.support, { extraKmCents: 900 });
  assert.equal(f.service.customerOrder(created.customerToken).customerCents, 200);
  f.service.customerDecision(created.customerToken, { accept: true });
  const offered = f.service.snapshot(f.driver).orders.find(o => o.id === created.id);
  assert.equal(offered.totalCents, 1200);
  assert.equal(offered.status, 'searching');
  assert.throws(() => f.service.customerDecision(created.customerToken, { accept: false }));
});

test('recusa do comprador cancela sem disponibilizar corrida', t => {
  const f = fixture(t);
  const created = f.order({ subsidy: 'half' });
  f.service.customerDecision(created.customerToken, { accept: false });
  assert.equal(f.service.snapshot(f.merchant).orders.find(o => o.id === created.id).status, 'cancelled');
  f.online(f.driver);
  assert.throws(() => f.service.orderAction(f.driver, created.id, 'accept', {}));
});

test('aceite único, uma corrida por motorista e autorização entre lojas', async t => {
  const f = fixture(t);
  const first = f.order();
  const second = f.order();
  f.online(f.driver);
  f.online(f.otherDriver);
  const result = await Promise.allSettled([f.driver, f.otherDriver].map(who => Promise.resolve().then(() => f.service.orderAction(who, first.id, 'accept', {}))));
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
  const winner = result[0].status === 'fulfilled' ? f.driver : f.otherDriver;
  assert.throws(() => f.service.orderAction(winner, second.id, 'accept', {}));
  assert.throws(() => f.service.orderAction(f.otherMerchant, first.id, 'ready', {}));
  assert.equal(f.service.snapshot(f.otherMerchant).orders.length, 0);
});

test('dados do comprador só são liberados após retirada validada pela loja', t => {
  const f = fixture(t);
  const created = f.order({ ready: false });
  f.online(f.driver);
  f.service.orderAction(f.driver, created.id, 'accept', {});
  const before = f.service.snapshot(f.driver).orders.find(o => o.id === created.id);
  assert.match(before.pickupCode, /^\d{6}$/);
  assert.equal(before.customerName, undefined);
  assert.equal(before.customerPhone, undefined);
  assert.equal(before.destinationAddress, undefined);
  assert.equal(f.service.snapshot(f.merchant).orders[0].pickupCode, undefined);
  assert.throws(() => f.service.orderAction(f.driver, created.id, 'pickup', { code: before.pickupCode }));
  assert.throws(() => f.service.orderAction(f.merchant, created.id, 'pickup', { code: before.pickupCode }));
  f.service.orderAction(f.merchant, created.id, 'ready', {});
  f.service.orderAction(f.merchant, created.id, 'pickup', { code: before.pickupCode });
  const after = f.service.snapshot(f.driver).orders.find(o => o.id === created.id);
  assert.equal(after.customerName, 'Cliente Privado');
  assert.equal(after.destinationAddress, 'Rua do Cliente, 99');
  assert.equal(after.pickupCode, undefined);
  const serialized = JSON.stringify(f.service.snapshot(f.driver));
  for (const field of ['customerCpfLast4', 'deliveryHash', 'deliverySalt', 'password_hash']) assert.ok(!serialized.includes(field));
  assert.throws(() => f.service.orderAction(f.otherDriver, created.id, 'deliver', { code: '0012' }));
  f.service.orderAction(f.driver, created.id, 'deliver', { code: '0012' });
  assert.equal(f.service.snapshot(f.merchant).orders.find(o => o.id === created.id).status, 'delivered');
});

test('cinco códigos incorretos bloqueiam a entrega e persistem ocorrência', t => {
  const f = fixture(t);
  const created = f.order();
  f.pickup(created);
  for (let attempt = 0; attempt < 5; attempt++) assert.throws(() => f.service.orderAction(f.driver, created.id, 'deliver', { code: '9999' }));
  assert.throws(() => f.service.orderAction(f.driver, created.id, 'deliver', { code: '0012' }));
  const state = f.service.snapshot(f.support);
  assert.equal(state.orders.find(o => o.id === created.id).status, 'incident');
  assert.ok(state.incidents.some(i => i.orderId === created.id));
});

test('cliente ausente exige contatos em sequência e suporte decide devolução', t => {
  const f = fixture(t);
  const created = f.order();
  f.pickup(created);
  assert.throws(() => f.service.orderAction(f.driver, created.id, 'contact-merchant', { note: 'Cliente não atende' }));
  assert.throws(() => f.service.orderAction(f.driver, created.id, 'report', { kind: 'unreachable', note: 'Cliente ausente' }));
  f.service.orderAction(f.driver, created.id, 'contact-customer', { note: 'Ligação sem resposta' });
  f.service.orderAction(f.driver, created.id, 'contact-merchant', { note: 'Loja avisada; aguardar orientação' });
  f.service.orderAction(f.driver, created.id, 'report', { kind: 'unreachable', note: 'Duas tentativas sem resposta' });
  assert.throws(() => f.service.orderAction(f.driver, created.id, 'resolve', { resolution: 'returned', note: 'Devolvido', compensationCents: 1000 }));
  f.service.orderAction(f.support, created.id, 'resolve', { resolution: 'returned', note: 'Loja confirmou recebimento da devolução', compensationCents: 1000 });
  assert.equal(f.service.snapshot(f.support).orders.find(o => o.id === created.id).status, 'returned');
});

test('denúncia de fraude suspende preventivamente e só suporte libera', t => {
  const f = fixture(t);
  const created = f.order();
  f.pickup(created);
  f.service.orderAction(f.merchant, created.id, 'report', { kind: 'fraud', note: 'Solicito análise de divergência na retirada' });
  assert.throws(() => f.online(f.driver));
  assert.throws(() => f.service.reviewDriver(f.driver, f.driver.id, { suspended: false, note: 'Liberar' }));
  f.service.reviewDriver(f.support, f.driver.id, { suspended: false, note: 'Documentos e retirada conferidos com a loja' });
  f.service.orderAction(f.support, created.id, 'resolve', { resolution: 'resume', note: 'Entrega autorizada após análise' });
  f.online(f.driver);
  f.service.orderAction(f.driver, created.id, 'deliver', { code: '0012' });
});

test('semanas encerradas, fechamento e pagamento sem duplicar corridas', t => {
  const f = fixture(t);
  const created = f.order();
  f.pickup(created);
  f.service.orderAction(f.driver, created.id, 'deliver', { code: '0012' });
  assert.throws(() => f.service.closeWeek(f.support, { weekStart: '2026-10-05' }));
  f.advance('2026-10-12T03:01:00Z');
  f.service.closeWeek(f.support, { weekStart: '2026-10-05' });
  const settlements = f.service.snapshot(f.support).settlements;
  assert.equal(settlements.length, 1);
  assert.equal(settlements[0].cents, 1200);
  f.service.closeWeek(f.support, { weekStart: '2026-10-05' });
  assert.equal(f.service.snapshot(f.support).settlements.length, 1);
  assert.throws(() => f.service.markPaid(f.driver, settlements[0].id, { reference: 'COMPROVANTE-001' }));
  f.service.markPaid(f.support, settlements[0].id, { reference: 'COMPROVANTE-001' });
  assert.equal(f.service.snapshot(f.driver).settlements[0].status, 'paid');
  assert.equal(f.service.snapshot(f.otherDriver).settlements.length, 0);
});

test('localização antiga e suspensão impedem novas corridas', t => {
  const f = fixture(t);
  const created = f.order();
  assert.throws(() => f.service.orderAction(f.driver, created.id, 'accept', {}));
  f.online(f.driver);
  f.advance('2026-10-05T12:30:00Z');
  assert.throws(() => f.service.orderAction(f.driver, created.id, 'accept', {}));
  f.service.reviewDriver(f.support, f.driver.id, { suspended: true, note: 'Cadastro em análise pelo suporte' });
  assert.throws(() => f.online(f.driver));
});
