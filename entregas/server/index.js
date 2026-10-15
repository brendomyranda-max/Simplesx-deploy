import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DeliveryService } from './service.js';
import { createApp } from './app.js';

const folder = fileURLToPath(new URL('../data/', import.meta.url));
const filename = process.env.ENTREGAS_DB || path.join(folder, 'entregas.sqlite');
mkdirSync(path.dirname(filename), { recursive: true });
const service = new DeliveryService({ filename, offerRadiusKm: Number(process.env.ENTREGAS_RAIO_OFERTAS_KM || 10) });
const app = createApp(service, { secureCookie: process.env.ENTREGAS_HTTPS === '1' });
const port = Number(process.env.ENTREGAS_PORT || 3100);
const host = process.env.ENTREGAS_HOST || '127.0.0.1';
const server = app.listen(port, host, () => console.log(`DoixP Entregas: http://${host}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { service.close(); process.exit(0); }));
