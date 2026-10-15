import express from 'express';
import { fileURLToPath } from 'node:url';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Auth } from './auth.js';
import { installPrivacyRoutes } from './privacy.js';

export function createApp(service, options = {}) {
  const app = express();
  const auth = new Auth(service, options);
  app.locals.auth = auth;
  app.locals.service = service;
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' https://unpkg.com; style-src 'self' 'unsafe-inline' https://unpkg.com; img-src 'self' data: https://tile.openstreetmap.org https://unpkg.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    });
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.headers.origin) {
        let originHost;
        try { originHost = new URL(req.headers.origin).host; } catch { /* rejected below */ }
        if (originHost !== req.headers.host) return res.status(403).json({ error: 'Origem não autorizada.' });
      }
      if (!req.is('application/json')) return res.status(415).json({ error: 'Envie o conteúdo como JSON.' });
    }
    next();
  });
  app.use(express.json({ limit: '32kb', strict: true, verify: (req, res, buffer) => { req.rawBody = buffer; } }));
  const route = handler => (req, res, next) => {
    try {
      const result = handler(req, res);
      if (!res.headersSent) res.json(result ?? { ok: true });
    } catch (error) { next(error); }
  };
  app.get('/api/bootstrap', route(() => ({ needsSetup: auth.needsSetup() })));
  app.post('/api/setup', route((req, res) => {
    const user = auth.createAccount(null, req.body, true);
    auth.issue(user, res);
    res.status(201);
    return { user };
  }));
  app.post('/api/driver/register', route((req, res) => {
    const user = auth.registerDriver(req.body, req.socket.remoteAddress || 'local');
    auth.issue(user, res);
    res.status(201);
    return { user, approvalPending: true };
  }));
  app.post('/api/login', route((req, res) => {
    const user = auth.login(req.body, req.socket.remoteAddress || 'local');
    auth.issue(user, res);
    return { user };
  }));
  app.post('/api/logout', route((req, res) => { auth.logout(req, res); }));
  app.get('/api/customer/:token', route(req => service.customerOrder(req.params.token)));
  app.post('/api/customer/:token', route(req => service.customerDecision(req.params.token, req.body)));
  // Server-to-server only. The sales backend must verify capture with the PSP
  // before signing a dispatch request; a browser cannot assert payment.
  const verifyIntegration = (req, res, next) => {
    const secret = options.integrationSecret || process.env.ENTREGAS_INTEGRATION_SECRET;
    if (typeof secret !== 'string' || secret.length < 32) return res.status(503).json({ error: 'Integração de pedidos não configurada.' });
    const timestamp = req.header('x-doixp-timestamp');
    const signature = req.header('x-doixp-signature');
    const current = new Date(service.now()).getTime();
    if (!/^\d{13}$/.test(timestamp || '') || Math.abs(current - Number(timestamp)) > 300000 || !/^[a-f0-9]{64}$/i.test(signature || '')) {
      return res.status(401).json({ error: 'Assinatura da integração inválida.' });
    }
    const expected = createHmac('sha256', secret).update(timestamp).update('.').update(req.rawBody || Buffer.alloc(0)).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) return res.status(401).json({ error: 'Assinatura da integração inválida.' });
    next();
  };
  app.post('/api/integration/orders', verifyIntegration, route((req, res) => {
    res.status(201);
    return service.createIntegratedOrder(req.body);
  }));
  app.get('/api/integration/stores/:establishmentId/orders', verifyIntegration,
    route(req => service.integratedStoreOrders(req.params.establishmentId)));
  app.get('/api/integration/stores/:establishmentId/orders/:id', verifyIntegration,
    route(req => service.integratedStoreOrder(req.params.establishmentId, req.params.id)));
  app.post('/api/integration/stores/:establishmentId/quote', verifyIntegration,
    route(req => service.integratedQuote(req.params.establishmentId, req.body)));
  app.post('/api/integration/stores/:establishmentId/orders/:id/:action', verifyIntegration,
    route(req => service.integratedStoreAction(req.params.establishmentId, req.params.id, req.params.action, req.body)));
  installPrivacyRoutes(app, auth, service);
  app.use('/api', (req, res, next) => {
    req.user = auth.authenticate(req);
    if (!req.user) return res.status(401).json({ error: 'Entre na sua conta para continuar.' });
    next();
  });
  app.get('/api/me', route(req => ({ user: req.user })));
  app.get('/api/state', route(req => service.snapshot(req.user)));
  app.get('/api/accounts', route(req => auth.accounts(req.user)));
  app.post('/api/accounts', route((req, res) => { res.status(201); return auth.createAccount(req.user, req.body); }));
  app.patch('/api/settings', route(req => service.updateSettings(req.user, req.body)));
  app.post('/api/quote', route(req => service.quote(req.user, req.body)));
  app.post('/api/orders', route((req, res) => { res.status(201); return service.createOrder(req.user, req.body); }));
  app.post('/api/orders/:id/:action', route(req => service.orderAction(req.user, req.params.id, req.params.action, req.body)));
  app.post('/api/availability', route(req => service.setAvailability(req.user, req.body)));
  app.post('/api/location', route(req => service.heartbeat(req.user, req.body)));
  app.post('/api/drivers/:id/review', route(req => service.reviewDriver(req.user, req.params.id, req.body)));
  app.post('/api/settlements/close', route(req => service.closeWeek(req.user, req.body)));
  app.post('/api/settlements/:id/paid', route(req => service.markPaid(req.user, req.params.id, req.body)));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Operação não encontrada.' }));
  app.get('/driver', (req, res) => res.sendFile(fileURLToPath(new URL('../public/index.html', import.meta.url))));
  app.use(express.static(fileURLToPath(new URL('../public/', import.meta.url)), { index: 'index.html' }));
  app.use((error, req, res, next) => {
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) console.error('[entregas]', error.message);
    res.status(status).json({ error: status >= 500 ? 'Não foi possível concluir a operação.' : error.message });
  });
  return app;
}
