import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import SqliteDb from './sqlite-db.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB_FILE = process.env.SIMPLESX_DB || path.join(ROOT, 'data', 'simplesx.db');
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const nome = process.argv[2] || 'Acesso SimplesX';
const db = new SqliteDb(DB_FILE);
const token = randomBytes(16).toString('hex').toUpperCase();

db.prepare('INSERT INTO auth_tokens (token, nome, ativo, criado_em) VALUES (?,?,1,?)')
  .bind(token, nome, new Date().toISOString())
  .run();

console.log('Token criado com sucesso!');
console.log('');
console.log('  Nome: ' + nome);
console.log('  Token: ' + token);
console.log('');
console.log('Use no login ou no header: Authorization: Bearer ' + token);
db.close();
