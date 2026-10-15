import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomInt, randomUUID, createHash, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

const ACTIVE = new Set(['accepted', 'in_transit', 'incident']);
const TERMINAL = new Set(['delivered', 'cancelled', 'returned']);
const hash = value => createHash('sha256').update(value).digest('hex');
const error = (status, message, persist = false) => Object.assign(new Error(message), { status, persist });
const clean = (value, label, max = 500, required = true) => {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw error(400, `${label} inválido.`);
  return value.trim();
};
const coords = (lat, lng) => {
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw error(400, 'Informe uma localização válida.');
  return { lat, lng };
};
const distanceKm = (latA, lngA, latB, lngB) => {
  const radians = degrees => degrees * Math.PI / 180;
  const dLat = radians(latB - latA), dLng = radians(lngB - lngA);
  const arc = Math.sin(dLat / 2) ** 2 + Math.cos(radians(latA)) * Math.cos(radians(latB)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(arc)));
};

export class DeliveryService {
  constructor({ filename = ':memory:', now = () => new Date(), offerRadiusKm = 10 } = {}) {
    if (!Number.isFinite(offerRadiusKm) || offerRadiusKm <= 0 || offerRadiusKm > 100) throw error(400, 'Raio de ofertas inválido.');
    this.now = now;
    this.offerRadiusKm = offerRadiusKm;
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
    // Existing local databases predate the delivery/store integration.
    for (const [table, name, definition] of [
      ['delivery_profiles', 'online_establishment_id', 'INTEGER'],
      ['delivery_profiles', 'approved', 'INTEGER NOT NULL DEFAULT 1'],
      ['delivery_orders', 'origin', "TEXT NOT NULL DEFAULT 'manual'"],
      ['delivery_orders', 'payment_reference', 'TEXT'],
      ['delivery_orders', 'funded_driver_cents', 'INTEGER'],
      ['delivery_orders', 'payment_mode', "TEXT NOT NULL DEFAULT 'manual'"],
    ]) {
      if (!this._all(`PRAGMA table_info(${table})`).some(column => column.name === name)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    }
    this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS delivery_profiles_online_store ON delivery_profiles(online_establishment_id) WHERE online_establishment_id IS NOT NULL');
    this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS delivery_orders_payment_reference ON delivery_orders(payment_reference) WHERE payment_reference IS NOT NULL');
  }
  close() { this.db.close(); }
  _time() { return new Date(this.now()).toISOString(); }
  _get(sql, ...args) { return this.db.prepare(sql).get(...args); }
  _all(sql, ...args) { return this.db.prepare(sql).all(...args); }
  _run(sql, ...args) { return this.db.prepare(sql).run(...args); }
  _tx(fn) {
    if (this.db.isTransaction) return fn();
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (err) { this.db.exec(err.persist ? 'COMMIT' : 'ROLLBACK'); throw err; }
  }
  _role(actor, ...roles) {
    if (!actor?.id || !roles.includes(actor.role)) throw error(403, 'Acesso não autorizado.');
  }
  _profile(id) {
    const result = this._get('SELECT p.*, u.name, u.role FROM delivery_profiles p JOIN users u ON u.id=p.user_id WHERE p.user_id=?', id);
    if (!result) throw error(404, 'Cadastro não encontrado.');
    return result;
  }
  _order(id) {
    const row = this._get('SELECT * FROM delivery_orders WHERE id=?', id);
    if (!row) throw error(404, 'Entrega não encontrada.');
    return row;
  }
  _event(actor, orderId, type, note = '') {
    this._run('INSERT INTO delivery_events(id,order_id,actor_id,actor_role,type,note,created_at) VALUES(?,?,?,?,?,?,?)', randomUUID(), orderId, actor?.id ?? null, actor?.role ?? 'customer', type, note, this._time());
  }
  _transition(actor, row, status, type, note = '') {
    this._run('UPDATE delivery_orders SET status=?,updated_at=? WHERE id=?', status, this._time(), row.id);
    this._event(actor, row.id, type, note);
  }
  registerProfile(user, body = {}) {
    if (!['merchant', 'driver'].includes(user.role)) return;
    const phone = clean(body.phone ?? '', 'Telefone', 40, false);
    const address = clean(body.address ?? '', 'Endereço', 500, false);
    if (user.role === 'merchant' && !address) throw error(400, 'Informe o endereço do estabelecimento.');
    let lat = null, lng = null;
    if (body.lat != null || body.lng != null) ({ lat, lng } = coords(body.lat, body.lng));
    if (user.role === 'merchant' && lat == null) throw error(400, 'Informe a localização do estabelecimento.');
    const onlineId = body.onlineEstablishmentId == null || body.onlineEstablishmentId === '' ? null : Number(body.onlineEstablishmentId);
    if (onlineId != null && (user.role !== 'merchant' || !Number.isSafeInteger(onlineId) || onlineId <= 0)) throw error(400, 'ID do estabelecimento no delivery inválido.');
    this._run('INSERT INTO delivery_profiles(user_id,phone,address,lat,lng,location_at,online_establishment_id) VALUES(?,?,?,?,?,?,?)', user.id, phone, address, lat, lng, lat == null ? null : this._time(), onlineId);
  }
  settings(actor) {
    this._role(actor, 'support', 'merchant', 'driver');
    return { baseKm: 5, baseCents: 1000, extraKmCents: this._get('SELECT extra_km_cents FROM delivery_settings WHERE id=1').extra_km_cents };
  }
  updateSettings(actor, { extraKmCents } = {}) {
    this._role(actor, 'support');
    if (!Number.isInteger(extraKmCents) || extraKmCents < 0 || extraKmCents > 100000) throw error(400, 'Valor do quilômetro adicional inválido.');
    return this._tx(() => {
      this._run('UPDATE delivery_settings SET extra_km_cents=? WHERE id=1', extraKmCents);
      this._event(actor, null, 'settings_updated', `Quilômetro adicional: ${extraKmCents} centavos.`);
      return this.settings(actor);
    });
  }
  quote(actor, { distanceKm, subsidy = 'base' } = {}) {
    this._role(actor, 'support', 'merchant', 'driver');
    if (typeof distanceKm !== 'number' || !Number.isFinite(distanceKm) || distanceKm <= 0 || distanceKm > 1000) throw error(400, 'Distância deve ser maior que zero e de até 1.000 km.');
    if (!['full', 'base', 'half'].includes(subsidy)) throw error(400, 'Modalidade de subsídio inválida.');
    const extraCents = Math.round(Math.max(0, distanceKm - 5) * this.settings(actor).extraKmCents);
    const totalCents = 1000 + extraCents;
    const merchantCents = subsidy === 'full' ? totalCents : subsidy === 'base' ? 1000 : 500;
    return { distanceKm, baseCents: 1000, extraCents, totalCents, merchantCents, customerCents: totalCents - merchantCents, subsidy };
  }
  _available(profile) {
    const age = new Date(this.now()).getTime() - Date.parse(profile.location_at);
    return Boolean(profile.online && profile.approved && !profile.suspended && profile.lat != null && Number.isFinite(age) && age >= 0 && age <= 120000);
  }
  _inOfferRegion(profile, row) {
    const detail = JSON.parse(row.detail);
    return Number.isFinite(detail.merchantLat) && Number.isFinite(detail.merchantLng)
      && distanceKm(profile.lat, profile.lng, detail.merchantLat, detail.merchantLng) <= this.offerRadiusKm;
  }
  setAvailability(actor, { online, lat, lng } = {}) {
    this._role(actor, 'driver');
    if (typeof online !== 'boolean') throw error(400, 'Disponibilidade inválida.');
    return this._tx(() => {
      const profile = this._profile(actor.id);
      if (online && !profile.approved) throw error(403, 'Cadastro aguardando aprovação do suporte.');
      if (online && profile.suspended) throw error(403, 'Cadastro suspenso. Aguarde análise do suporte.');
      if (online) {
        coords(lat, lng);
        this._run('UPDATE delivery_profiles SET online=1,lat=?,lng=?,location_at=? WHERE user_id=?', lat, lng, this._time(), actor.id);
      } else this._run('UPDATE delivery_profiles SET online=0 WHERE user_id=?', actor.id);
      this._event(actor, null, online ? 'driver_online' : 'driver_offline');
      return this._driver(this._profile(actor.id), actor);
    });
  }
  heartbeat(actor, { lat, lng } = {}) {
    this._role(actor, 'driver');
    coords(lat, lng);
    this._profile(actor.id);
    this._run('UPDATE delivery_profiles SET lat=?,lng=?,location_at=? WHERE user_id=?', lat, lng, this._time(), actor.id);
    return this._driver(this._profile(actor.id), actor);
  }
  _driver(row, actor) {
    const value = { id: row.user_id, name: row.name, online: this._available(row), approved: Boolean(row.approved), suspended: Boolean(row.suspended) };
    if (actor.role === 'support' || actor.id === row.user_id) Object.assign(value, { phone: row.phone, lat: row.lat, lng: row.lng, locationAt: row.location_at, suspensionNote: row.suspension_note });
    return value;
  }
  _serialize(row, actor) {
    const d = JSON.parse(row.detail);
    const result = {
      id: row.id, reference: row.reference, status: row.status, merchantId: row.merchant_id, driverId: row.driver_id,
      merchantName: d.merchantName, merchantAddress: d.merchantAddress, merchantPhone: d.merchantPhone, merchantLat: d.merchantLat, merchantLng: d.merchantLng,
      distanceKm: d.distanceKm, baseCents: d.baseCents, extraCents: d.extraCents, totalCents: d.totalCents, merchantCents: d.merchantCents, customerCents: d.customerCents, subsidy: d.subsidy,
      ready: Boolean(row.ready), held: Boolean(row.hold), createdAt: row.created_at, updatedAt: row.updated_at, pickedUpAt: row.picked_up_at, deliveredAt: row.delivered_at, compensationCents: row.compensation_cents, compensationAt: row.compensation_at,
      destinationApprox: { lat: Math.round(d.destinationLat * 100) / 100, lng: Math.round(d.destinationLng * 100) / 100 },
    };
    const owns = actor.role === 'support' || (actor.role === 'merchant' && actor.id === row.merchant_id);
    const assigned = actor.role === 'driver' && actor.id === row.driver_id;
    if (owns) Object.assign(result, { origin: row.origin, paymentReference: row.payment_reference, fundedDriverCents: row.funded_driver_cents, paymentMode: row.payment_mode });
    if (owns || (assigned && row.picked_up_at)) Object.assign(result, { customerName: d.customerName, customerPhone: d.customerPhone, destinationAddress: d.destinationAddress, destinationLat: d.destinationLat, destinationLng: d.destinationLng });
    if (actor.role === 'merchant' && actor.id === row.merchant_id) result.customerToken = row.customer_token;
    if (assigned && !row.picked_up_at && ACTIVE.has(row.status)) result.pickupCode = row.pickup_code;
    if (owns || assigned) result.events = this._all('SELECT id,type,note,actor_role AS actorRole,created_at AS createdAt FROM delivery_events WHERE order_id=? ORDER BY rowid', row.id);
    else { delete result.reference; delete result.merchantId; delete result.driverId; }
    return result;
  }
  createOrder(actor, body = {}, integration = null) {
    this._role(actor, 'merchant');
    const profile = this._profile(actor.id);
    const reference = clean(body.reference, 'Referência', 100);
    const customerName = clean(body.customerName, 'Nome do cliente', 120);
    const customerPhone = clean(body.customerPhone, 'Telefone do cliente', 40);
    const customerCpfLast4 = clean(body.customerCpfLast4, 'Últimos quatro dígitos do CPF', 4);
    if (!/^\d{4}$/.test(customerCpfLast4)) throw error(400, 'Informe somente os quatro últimos dígitos do CPF.');
    const destinationAddress = clean(body.destinationAddress, 'Endereço de entrega', 500);
    const { lat: destinationLat, lng: destinationLng } = coords(body.destinationLat, body.destinationLng);
    if (body.ready != null && typeof body.ready !== 'boolean') throw error(400, 'Prontidão do pedido inválida.');
    let quote = this.quote(actor, body);
    if (integration && body.quotedTotalCents != null) {
      const total = body.quotedTotalCents, merchant = body.quotedMerchantCents, customer = body.quotedCustomerCents;
      if (!Number.isInteger(total) || total < 1000 || total > 1_000_000 || !Number.isInteger(merchant) || !Number.isInteger(customer)
        || merchant < 0 || customer < 0 || merchant + customer !== total
        || merchant !== (quote.subsidy === 'full' ? total : quote.subsidy === 'half' ? 500 : 1000)) throw error(409, 'A divisão do frete confirmada não confere.');
      quote = { ...quote, totalCents: total, extraCents: total - 1000, merchantCents: merchant, customerCents: customer };
    }
    if (integration && (integration.origin !== 'online' || !['provider_captured', 'pix_confirmed_manually'].includes(integration.paymentMode))) throw error(400, 'Origem do pagamento inválida.');
    if (integration?.paymentMode === 'provider_captured' && (!Number.isInteger(integration.fundedDriverCents) || integration.fundedDriverCents !== quote.totalCents)) throw error(409, 'O valor reservado para o entregador difere do frete calculado.');
    if (integration?.paymentMode === 'pix_confirmed_manually' && integration.fundedDriverCents != null) throw error(400, 'Pix manual não representa reserva do frete no provedor.');
    const normalized = { reference, customerName, customerPhone, destinationAddress, destinationLat, destinationLng, distanceKm: quote.distanceKm, subsidy: quote.subsidy, ready: Boolean(body.ready),
      ...(integration ? { totalCents: quote.totalCents, merchantCents: quote.merchantCents, customerCents: quote.customerCents } : {}) };
    const requestHash = hash(JSON.stringify(normalized));
    return this._tx(() => {
      const existing = this._get('SELECT * FROM delivery_orders WHERE merchant_id=? AND reference=?', actor.id, reference);
      if (existing) {
        if (existing.request_hash !== requestHash || existing.origin !== (integration?.origin || 'manual') || existing.payment_mode !== (integration?.paymentMode || 'manual') || existing.payment_reference !== (integration?.paymentReference || null) || !timingSafeEqual(scryptSync(customerCpfLast4, existing.delivery_salt, 32), Buffer.from(existing.delivery_hash, 'hex'))) throw error(409, 'Já existe uma entrega com esta referência e dados diferentes.');
        return this._serialize(existing, actor);
      }
      if (integration?.paymentReference && this._get('SELECT id FROM delivery_orders WHERE payment_reference=?', integration.paymentReference)) throw error(409, 'Este pagamento já está vinculado a outra entrega.');
      const id = randomUUID(), timestamp = this._time(), salt = randomBytes(16).toString('hex'), customerToken = randomBytes(32).toString('base64url');
      const detail = { ...quote, customerName, customerPhone, destinationAddress, destinationLat, destinationLng, merchantName: profile.name, merchantAddress: profile.address, merchantPhone: profile.phone, merchantLat: profile.lat, merchantLng: profile.lng };
      this._run(`INSERT INTO delivery_orders(id,merchant_id,reference,request_hash,status,detail,ready,pickup_code,delivery_hash,delivery_salt,customer_token,customer_token_hash,customer_decision,created_at,updated_at,origin,payment_reference,funded_driver_cents,payment_mode)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, actor.id, reference, requestHash, integration || quote.customerCents === 0 ? 'searching' : 'awaiting_customer', JSON.stringify(detail), Number(Boolean(body.ready)), String(randomInt(0, 1000000)).padStart(6, '0'), scryptSync(customerCpfLast4, salt, 32).toString('hex'), salt, customerToken, hash(customerToken), integration ? 1 : null, timestamp, timestamp, integration?.origin || 'manual', integration?.paymentReference || null, integration?.fundedDriverCents ?? null, integration?.paymentMode || 'manual');
      this._event(actor, id, 'created', integration?.paymentMode === 'provider_captured' ? 'Pedido online confirmado pelo provedor; frete reservado para o entregador.' : integration ? 'Pix conferido pela loja; repasse ao entregador será registrado separadamente.' : quote.customerCents > 0 ? 'Aguardando autorização do cliente para sua parcela do frete.' : 'Frete integralmente coberto pelo estabelecimento.');
      return this._serialize(this._order(id), actor);
    });
  }
  createIntegratedOrder(body = {}) {
    const establishmentId = Number(body.establishmentId);
    if (!Number.isSafeInteger(establishmentId) || establishmentId <= 0) throw error(400, 'Estabelecimento inválido.');
    const paymentReference = clean(body.paymentReference, 'Referência de pagamento', 150);
    const fundedDriverCents = body.fundedDriverCents;
    const merchant = this._onlineMerchant(establishmentId);
    const paymentMode = body.paymentMode === 'pix_confirmed_manually' ? 'pix_confirmed_manually' : 'provider_captured';
    return this.createOrder(merchant, body, { origin: 'online', paymentReference, fundedDriverCents, paymentMode });
  }
  _onlineMerchant(establishmentId) {
    const id = Number(establishmentId);
    if (!Number.isSafeInteger(id) || id <= 0) throw error(400, 'Estabelecimento inválido.');
    const merchant = this._get(`SELECT u.id,u.role,u.name FROM users u JOIN delivery_profiles p ON p.user_id=u.id
      WHERE p.online_establishment_id=? AND u.role='merchant'`, id);
    if (!merchant) throw error(404, 'Estabelecimento ainda não foi vinculado à operação de entregas.');
    return merchant;
  }
  integratedStoreOrders(establishmentId) {
    const merchant = this._onlineMerchant(establishmentId);
    return this._all("SELECT * FROM delivery_orders WHERE merchant_id=? AND origin='online' ORDER BY created_at DESC LIMIT 200", merchant.id)
      .map(row => this._serialize(row, merchant));
  }
  integratedStoreOrder(establishmentId, id) {
    const merchant = this._onlineMerchant(establishmentId);
    const row = this._order(id);
    if (row.merchant_id !== merchant.id || row.origin !== 'online') throw error(404, 'Entrega não encontrada para este estabelecimento.');
    return this._serialize(row, merchant);
  }
  integratedQuote(establishmentId, body = {}) {
    return this.quote(this._onlineMerchant(establishmentId), body);
  }
  integratedStoreAction(establishmentId, id, action, body = {}) {
    if (!['ready', 'pickup', 'cancel', 'report'].includes(action)) throw error(400, 'Ação de estabelecimento inválida.');
    const merchant = this._onlineMerchant(establishmentId);
    const row = this._order(id);
    if (row.merchant_id !== merchant.id || row.origin !== 'online') throw error(404, 'Entrega não encontrada para este estabelecimento.');
    return this.orderAction(merchant, id, action, body);
  }
  _customerRow(token) {
    if (typeof token !== 'string' || token.length > 100) throw error(404, 'Link de aprovação não encontrado.');
    const row = this._get('SELECT * FROM delivery_orders WHERE customer_token_hash=?', hash(token));
    if (!row) throw error(404, 'Link de aprovação não encontrado.');
    return row;
  }
  customerOrder(token) {
    const row = this._customerRow(token), d = JSON.parse(row.detail);
    return { id: row.id, reference: row.reference, merchantName: d.merchantName, status: row.status, distanceKm: d.distanceKm, totalCents: d.totalCents, merchantCents: d.merchantCents, customerCents: d.customerCents, decision: row.customer_decision == null ? null : Boolean(row.customer_decision) };
  }
  customerDecision(token, { accept } = {}) {
    if (typeof accept !== 'boolean') throw error(400, 'Decisão inválida.');
    return this._tx(() => {
      const row = this._customerRow(token);
      if (row.customer_decision != null) {
        if (Boolean(row.customer_decision) !== accept) throw error(409, 'Este frete já recebeu uma decisão.');
        return this.customerOrder(token);
      }
      if (row.status !== 'awaiting_customer') throw error(409, 'Esta entrega não está aguardando aprovação.');
      this._run('UPDATE delivery_orders SET customer_decision=? WHERE id=?', Number(accept), row.id);
      this._transition(null, row, accept ? 'searching' : 'cancelled', accept ? 'customer_accepted' : 'customer_declined');
      return this.customerOrder(token);
    });
  }
  _incident(actor, row, kind, note) {
    if (['cancelled', 'returned'].includes(row.status)) throw error(409, 'Esta entrega já foi encerrada.');
    const id = randomUUID();
    this._run('INSERT INTO delivery_incidents(id,order_id,driver_id,kind,note,created_at) VALUES(?,?,?,?,?,?)', id, row.id, row.driver_id, kind, note, this._time());
    if (row.status !== 'incident') this._run('UPDATE delivery_orders SET previous_status=? WHERE id=?', row.status, row.id);
    this._run('UPDATE delivery_orders SET hold=1 WHERE id=?', row.id);
    // Completed deliveries remain completed, but their receivable is held until review.
    this._transition(actor, row, row.status === 'delivered' ? 'delivered' : 'incident', 'incident_opened', note);
    return id;
  }
  _owner(actor, row, role) {
    this._role(actor, role);
    if ((role === 'merchant' ? row.merchant_id : row.driver_id) !== actor.id) throw error(403, 'Esta entrega não pertence ao seu cadastro.');
  }
  _checkCode(actor, row, type, code) {
    const pickup = type === 'pickup', column = pickup ? 'pickup_attempts' : 'delivery_attempts';
    if (row[column] >= 5) throw error(429, 'Código bloqueado. A entrega precisa de análise do suporte.');
    let valid = false;
    if (typeof code === 'string' && (pickup ? /^\d{6}$/ : /^\d{4}$/).test(code)) {
      valid = pickup ? timingSafeEqual(Buffer.from(code), Buffer.from(row.pickup_code)) : timingSafeEqual(scryptSync(code, row.delivery_salt, 32), Buffer.from(row.delivery_hash, 'hex'));
    }
    if (valid) return;
    this._run(`UPDATE delivery_orders SET ${column}=${column}+1,updated_at=? WHERE id=?`, this._time(), row.id);
    this._event(actor, row.id, `${type}_code_failed`, 'Tentativa de código inválido.');
    if (row[column] + 1 >= 5) this._incident(actor, row, 'code_attempts', 'Cinco tentativas inválidas de confirmação. Aguardando suporte.');
    throw error(row[column] + 1 >= 5 ? 429 : 400, row[column] + 1 >= 5 ? 'Código bloqueado após cinco tentativas. Acione o suporte.' : 'Código inválido.', true);
  }
  orderAction(actor, id, action, body = {}) {
    this._role(actor, 'support', 'merchant', 'driver');
    return this._tx(() => {
      const row = this._order(id);
      if (action === 'ready') {
        this._owner(actor, row, 'merchant');
        if (!['awaiting_customer', 'searching', 'accepted'].includes(row.status)) throw error(409, 'Não é possível alterar a prontidão desta entrega.');
        this._run('UPDATE delivery_orders SET ready=1,updated_at=? WHERE id=?', this._time(), id);
        this._event(actor, id, 'ready');
      } else if (action === 'accept') {
        this._role(actor, 'driver');
        const profile = this._profile(actor.id);
        if (!this._available(profile)) throw error(403, 'Fique online com a localização atualizada para aceitar entregas.');
        if (row.status !== 'searching') throw error(409, 'Esta entrega não está mais disponível.');
        if (!this._inOfferRegion(profile, row)) throw error(403, 'Esta corrida está fora da sua região de atendimento.');
        if (this._get("SELECT id FROM delivery_orders WHERE driver_id=? AND status IN ('accepted','in_transit','incident')", actor.id)) throw error(409, 'Conclua sua entrega atual antes de aceitar outra.');
        const result = this._run("UPDATE delivery_orders SET driver_id=?,status='accepted',updated_at=? WHERE id=? AND status='searching' AND driver_id IS NULL", actor.id, this._time(), id);
        if (!result.changes) throw error(409, 'Outra pessoa já aceitou esta entrega.');
        this._event(actor, id, 'accepted');
      } else if (action === 'pickup') {
        this._owner(actor, row, 'merchant');
        if (row.status !== 'accepted' || !row.ready) throw error(409, 'A entrega precisa estar aceita e o pedido pronto.');
        if (this._profile(row.driver_id).suspended) throw error(403, 'Entregador suspenso. Acione o suporte.');
        this._checkCode(actor, row, 'pickup', body.code);
        this._run('UPDATE delivery_orders SET picked_up_at=? WHERE id=?', this._time(), id);
        this._transition(actor, row, 'in_transit', 'picked_up');
      } else if (action === 'deliver') {
        this._owner(actor, row, 'driver');
        if (this._profile(actor.id).suspended) throw error(403, 'Cadastro suspenso. A conclusão depende do suporte.');
        if (row.status !== 'in_transit') throw error(409, 'A entrega precisa estar em trânsito.');
        this._checkCode(actor, row, 'delivery', body.code);
        this._run('UPDATE delivery_orders SET delivered_at=? WHERE id=?', this._time(), id);
        this._transition(actor, row, 'delivered', 'delivered');
      } else if (action === 'contact-customer' || action === 'contact-merchant') {
        this._owner(actor, row, 'driver');
        if (!row.picked_up_at || !['in_transit', 'incident'].includes(row.status)) throw error(409, 'Registre contatos após retirar o pedido.');
        const note = clean(body.note, 'Descrição do contato', 2000);
        if (action === 'contact-merchant' && !this._get("SELECT id FROM delivery_events WHERE order_id=? AND type='contact_customer'", id)) throw error(409, 'Tente contato com o cliente antes de acionar o estabelecimento.');
        this._event(actor, id, action.replace('-', '_'), note);
      } else if (action === 'report') {
        if (actor.role === 'merchant') this._owner(actor, row, 'merchant'); else this._owner(actor, row, 'driver');
        if (!['unreachable', 'fraud', 'other'].includes(body.kind)) throw error(400, 'Tipo de ocorrência inválido.');
        const note = clean(body.note, 'Descrição da ocorrência', 2000);
        if (body.kind === 'unreachable') {
          if (!row.picked_up_at) throw error(409, 'Cliente ausente só pode ser registrado após a retirada.');
          const contacts = this._all("SELECT type FROM delivery_events WHERE order_id=? AND type IN ('contact_customer','contact_merchant') ORDER BY rowid", id).map(e => e.type);
          if (contacts.indexOf('contact_customer') < 0 || contacts.indexOf('contact_merchant') <= contacts.indexOf('contact_customer')) throw error(409, 'Registre contato com o cliente e depois com o estabelecimento.');
        }
        this._incident(actor, row, body.kind, note);
        if (body.kind === 'fraud' && actor.role === 'merchant' && row.driver_id) this._suspend(actor, row.driver_id, note);
      } else if (action === 'cancel') {
        this._owner(actor, row, 'merchant');
        if (TERMINAL.has(row.status)) throw error(409, 'Esta entrega já foi encerrada.');
        const note = clean(body.note ?? 'Cancelamento solicitado pelo estabelecimento.', 'Motivo', 2000);
        if (row.picked_up_at || row.status === 'incident') this._incident(actor, row, 'cancellation', note);
        else this._transition(actor, row, 'cancelled', 'cancelled', note);
      } else if (action === 'resolve') {
        this._role(actor, 'support');
        if (!['resume', 'returned', 'cancelled'].includes(body.resolution)) throw error(400, 'Resolução inválida.');
        const note = clean(body.note, 'Justificativa da análise', 2000);
        if (!this._get("SELECT id FROM delivery_incidents WHERE order_id=? AND status='open'", id)) throw error(409, 'Não há ocorrência aberta nesta entrega.');
        if (row.status === 'delivered' && body.resolution !== 'resume') throw error(409, 'Entrega concluída permite liberar a retenção; estornos exigem análise financeira externa.');
        if (body.resolution === 'returned' && !row.picked_up_at) throw error(409, 'Só é possível devolver pedidos retirados.');
        if (row.picked_up_at && ['returned', 'cancelled'].includes(body.resolution)) {
          const totalCents = JSON.parse(row.detail).totalCents;
          if (!Number.isInteger(body.compensationCents) || body.compensationCents < 0 || body.compensationCents > totalCents) throw error(400, 'Defina explicitamente a compensação ao entregador, de zero até o frete total, em centavos.');
          this._run('UPDATE delivery_orders SET compensation_cents=?,compensation_at=? WHERE id=?', body.compensationCents, this._time(), id);
          this._event(actor, id, 'compensation_defined', `Compensação: ${body.compensationCents} centavos. ${note}`);
        }
        const status = body.resolution === 'resume' ? (row.status === 'delivered' ? 'delivered' : row.previous_status || (row.picked_up_at ? 'in_transit' : row.driver_id ? 'accepted' : 'searching')) : body.resolution;
        this._run("UPDATE delivery_incidents SET status='resolved',resolution=?,resolution_note=?,resolved_at=? WHERE order_id=? AND status='open'", body.resolution, note, this._time(), id);
        this._run('UPDATE delivery_orders SET hold=0,previous_status=NULL,pickup_attempts=0,delivery_attempts=0 WHERE id=?', id);
        this._transition(actor, row, status, 'incident_resolved', note);
      } else if (action === 'suspend') {
        this._role(actor, 'support');
        if (!row.driver_id) throw error(409, 'A entrega não possui entregador.');
        const note = clean(body.note, 'Motivo da suspensão', 2000);
        this._incident(actor, row, 'fraud', note);
        this._suspend(actor, row.driver_id, note);
      } else throw error(400, 'Ação desconhecida.');
      return this._serialize(this._order(id), actor);
    });
  }
  _suspend(actor, id, note) {
    this._run('UPDATE delivery_profiles SET suspended=1,online=0,suspension_note=? WHERE user_id=?', note, id);
    this._event(actor, null, 'driver_suspended', `${id}: ${note}`);
  }
  reviewDriver(actor, id, { suspended, note } = {}) {
    this._role(actor, 'support');
    if (typeof suspended !== 'boolean') throw error(400, 'Decisão de suspensão inválida.');
    note = clean(note, 'Justificativa da análise', 2000);
    return this._tx(() => {
      if (this._profile(id).role !== 'driver') throw error(400, 'Cadastro não pertence a um entregador.');
      this._run('UPDATE delivery_profiles SET approved=?,suspended=?,online=0,suspension_note=? WHERE user_id=?', Number(!suspended), Number(suspended), note, id);
      this._event(actor, null, 'driver_reviewed', `${id}: ${suspended ? 'suspensão mantida' : 'cadastro aprovado ou suspensão removida'}. ${note}`);
      return this._driver(this._profile(id), actor);
    });
  }
  _settlement(row) {
    const orders = this._all('SELECT order_id FROM delivery_settlement_orders WHERE settlement_id=? ORDER BY order_id', row.id).map(o => o.order_id);
    const held = Boolean(this._get('SELECT o.id FROM delivery_orders o JOIN delivery_settlement_orders s ON s.order_id=o.id WHERE s.settlement_id=? AND o.hold=1 LIMIT 1', row.id));
    return { id: row.id, driverId: row.driver_id, driverName: this._get('SELECT name FROM users WHERE id=?', row.driver_id)?.name, weekStart: row.week_start, cents: row.cents, count: orders.length, orders, status: row.status, held, reference: row.reference, createdAt: row.created_at, paidAt: row.paid_at };
  }
  closeWeek(actor, { weekStart } = {}) {
    this._role(actor, 'support');
    if (typeof weekStart !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) throw error(400, 'Informe a segunda-feira inicial no formato AAAA-MM-DD.');
    const date = new Date(`${weekStart}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== weekStart || date.getUTCDay() !== 1) throw error(400, 'A semana deve começar em uma segunda-feira válida.');
    const endDate = new Date(date.getTime() + 7 * 86400000).toISOString().slice(0, 10);
    const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(this.now()));
    if (localDate < endDate) throw error(409, 'A semana ainda não terminou no horário de São Paulo.');
    return this._tx(() => {
      const rows = this._all("SELECT o.* FROM delivery_orders o LEFT JOIN delivery_settlement_orders s ON s.order_id=o.id WHERE (o.status='delivered' OR (o.status IN ('returned','cancelled') AND o.compensation_cents>0)) AND o.hold=0 AND s.order_id IS NULL AND o.driver_id IS NOT NULL");
      const groups = new Map();
      for (const row of rows) {
        const deliveredDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(row.status === 'delivered' ? row.delivered_at : row.compensation_at));
        if (deliveredDate < weekStart || deliveredDate >= endDate) continue;
        if (!groups.has(row.driver_id)) groups.set(row.driver_id, []);
        groups.get(row.driver_id).push(row);
      }
      for (const [driverId, orders] of groups) {
        const settlementId = randomUUID(), cents = orders.reduce((sum, row) => sum + (row.status === 'delivered' ? JSON.parse(row.detail).totalCents : row.compensation_cents), 0);
        this._run('INSERT INTO delivery_settlements(id,driver_id,week_start,cents,created_at) VALUES(?,?,?,?,?)', settlementId, driverId, weekStart, cents, this._time());
        for (const row of orders) {
          this._run('INSERT INTO delivery_settlement_orders(order_id,settlement_id) VALUES(?,?)', row.id, settlementId);
          this._event(actor, row.id, 'settlement_closed', `Fechamento da semana ${weekStart}.`);
        }
      }
      this._event(actor, null, 'week_closed', weekStart);
      return this._all('SELECT * FROM delivery_settlements WHERE week_start=? ORDER BY created_at', weekStart).map(row => this._settlement(row));
    });
  }
  markPaid(actor, id, { reference } = {}) {
    this._role(actor, 'support');
    reference = clean(reference, 'Comprovante ou referência de pagamento', 200);
    return this._tx(() => {
      const row = this._get('SELECT * FROM delivery_settlements WHERE id=?', id);
      if (!row) throw error(404, 'Fechamento não encontrado.');
      if (row.status === 'paid') {
        if (row.reference !== reference) throw error(409, 'Pagamento já registrado com outra referência.');
        return this._settlement(row);
      }
      if (this._settlement(row).held) throw error(409, 'Há uma entrega em análise. Resolva a ocorrência antes de registrar o pagamento.');
      this._run("UPDATE delivery_settlements SET status='paid',reference=?,paid_at=? WHERE id=?", reference, this._time(), id);
      this._event(actor, null, 'settlement_paid', `${id}: ${reference}`);
      return this._settlement(this._get('SELECT * FROM delivery_settlements WHERE id=?', id));
    });
  }
  snapshot(actor) {
    this._role(actor, 'support', 'merchant', 'driver');
    let rows;
    if (actor.role === 'support') rows = this._all('SELECT * FROM delivery_orders ORDER BY created_at DESC');
    else if (actor.role === 'merchant') rows = this._all('SELECT * FROM delivery_orders WHERE merchant_id=? ORDER BY created_at DESC', actor.id);
    else {
      const profile = this._profile(actor.id);
      const available = this._available(profile);
      rows = this._all("SELECT * FROM delivery_orders WHERE driver_id=? OR (?=1 AND status='searching') ORDER BY created_at DESC", actor.id, Number(available))
        .filter(row => row.driver_id === actor.id || this._inOfferRegion(profile, row));
    }
    const orderIds = new Set(rows.filter(r => actor.role !== 'driver' || r.driver_id === actor.id).map(r => r.id));
    const drivers = this._all("SELECT p.*,u.name,u.role FROM delivery_profiles p JOIN users u ON u.id=p.user_id WHERE u.role='driver'").filter(r => actor.role === 'support' || r.user_id === actor.id || (actor.role === 'merchant' && rows.some(o => o.driver_id === r.user_id))).map(r => this._driver(r, actor));
    const incidents = this._all('SELECT id,order_id AS orderId,driver_id AS driverId,kind,note,status,resolution,resolution_note AS resolutionNote,created_at AS createdAt,resolved_at AS resolvedAt FROM delivery_incidents ORDER BY created_at DESC').filter(i => actor.role === 'support' || orderIds.has(i.orderId));
    const settlements = actor.role === 'merchant' ? [] : this._all('SELECT * FROM delivery_settlements ORDER BY created_at DESC').filter(r => actor.role === 'support' || r.driver_id === actor.id).map(r => this._settlement(r));
    const result = { settings: this.settings(actor), orders: rows.map(r => this._serialize(r, actor)), drivers, incidents, settlements };
    if (actor.role === 'support') result.events = this._all('SELECT id,order_id AS orderId,actor_id AS actorId,actor_role AS actorRole,type,note,created_at AS createdAt FROM delivery_events ORDER BY rowid DESC LIMIT 200');
    return result;
  }
}

export default DeliveryService;
