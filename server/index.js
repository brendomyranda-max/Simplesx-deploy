/**
 * Arquivo: index.js
 * Responsabilidade: Inicia o servidor local Express e conecta o roteador compartilhado ao SQLite.
 */

import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import SqliteDb from './sqlite-db.js';
import { handle } from '../shared/router.js';
import { loadLocalEnv, serverEnv } from './env.js';

loadLocalEnv();
const config = serverEnv();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB_FILE = process.env.SIMPLESX_DB || path.join(ROOT, 'data', 'simplesx.db');
const PORT = Number(process.env.PORT || 3001);

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const db = new SqliteDb(DB_FILE);
const env = {
  DB: db,
  ...config,
}; // sem AUTH_KV local => rate-limit em memória

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

function adapt(req, res) {
  const ctx = {
    env,
    params: {},
    user: null,
    req: {
      method: req.method,
      path: req.path,
      header: (n) => req.get(n),
      query: (n) => req.query[n],
      json: async () => req.body || {},
    },
    json: (data, status = 200, headers = {}) => {
      for (const [nome, valor] of Object.entries(headers)) res.setHeader(nome, valor);
      res.status(status).json(data);
      return { __sent: true };
    },
  };
  return ctx;
}

app.all('/api/*', async (req, res, next) => {
  try {
    await handle(adapt(req, res), env);
    if (!res.headersSent) next();
  } catch (e) {
    next(e);
  }
});

const dist = path.join(ROOT, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err, req, res, next) => {
  console.error('[server error]', err);
  res.status(500).json({ error: 'Erro interno' });
});

app.listen(PORT, process.env.HOST || '127.0.0.1', () => {
  console.log(`SimplesX local rodando em http://localhost:${PORT}`);
  console.log(`Banco: ${DB_FILE}`);
});
