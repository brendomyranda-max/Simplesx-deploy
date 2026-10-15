import { randomBytes, randomUUID } from 'node:crypto';
import { DeliveryService } from '../server/service.js';
import { createApp } from '../server/app.js';

// The preview uses an isolated in-memory database and listens only on this computer.
const service = new DeliveryService();
const app = createApp(service);
const password = randomBytes(12).toString('base64url');
const auth = app.locals.auth;

const support = auth.createAccount(null, {
  name: 'Suporte demonstração', username: 'suporte.demo', password,
}, true);
const merchant = auth.createAccount(support, {
  name: 'Loja demonstração', username: 'loja.demo', password, role: 'merchant',
  phone: '11900000000', address: 'Av. Paulista, 1000 - São Paulo, SP',
  lat: -23.5632, lng: -46.6543,
});
auth.createAccount(support, {
  name: 'Entregador demonstração', username: 'entregador.demo', password, role: 'driver',
  phone: '11900000001', lat: -23.5625, lng: -46.6535,
});
const developerUsername = String(process.env.ENTREGAS_DEMO_DEV_USERNAME || '').trim().toLowerCase();
const developerPassword = process.env.ENTREGAS_DEMO_DEV_PASSWORD;
if (developerUsername || developerPassword) {
  if (!/^[a-z0-9._@+-]{3,80}$/.test(developerUsername) || typeof developerPassword !== 'string' || developerPassword.length < 8 || developerPassword.length > 128) {
    throw new Error('Credenciais de demonstração inválidas.');
  }
  // O acesso existe apenas neste banco em memória; a regra de 10 caracteres da API permanece intacta.
  const developer = { id: randomUUID(), name: 'Entregador de teste', username: developerUsername, role: 'driver' };
  service.db.prepare('INSERT INTO users(id,name,username,role,password_hash,created_at) VALUES(?,?,?,?,?,?)')
    .run(developer.id, developer.name, developer.username, developer.role, auth.hashPassword(developerPassword), new Date().toISOString());
  service.registerProfile(developer, { phone: '11900000004', lat: -23.5625, lng: -46.6535 });
}
service.createOrder(merchant, {
  reference: 'DEMO-001', customerName: 'Cliente demonstração', customerPhone: '11900000002',
  customerCpfLast4: '0000', destinationAddress: 'Rua Bela Cintra, 300 - São Paulo, SP',
  destinationLat: -23.5585, destinationLng: -46.6603, distanceKm: 4,
  subsidy: 'full', ready: true,
});
service.createOrder(merchant, {
  reference: 'DEMO-002', customerName: 'Outro cliente demonstração', customerPhone: '11900000003',
  customerCpfLast4: '0000', destinationAddress: 'Rua Augusta, 500 - São Paulo, SP',
  destinationLat: -23.5542, destinationLng: -46.6506, distanceKm: 7,
  subsidy: 'base', ready: false,
});

const port = Number(process.env.ENTREGAS_DEMO_PORT || 3101);
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`Demonstração local: http://127.0.0.1:${port}`);
  console.log(`Usuários: suporte.demo, loja.demo ou entregador.demo`);
  if (developerUsername) console.log(`Acesso adicional de teste no app do entregador: ${developerUsername}`);
  console.log(`Senha temporária para os três: ${password}`);
  console.log('Os dados de demonstração são apagados quando este processo termina.');
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => { service.close(); process.exit(0); }));
}
