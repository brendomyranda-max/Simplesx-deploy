import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import SqliteDb from './sqlite-db.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB_FILE = process.env.SIMPLESX_DB || path.join(ROOT, 'data', 'simplesx.db');

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const db = new SqliteDb(DB_FILE);
const rows = db.prepare('SELECT file, aplicada_em FROM _migrations ORDER BY file').all();
console.log('Migrações aplicadas:');
for (const r of rows.results) console.log(`  - ${r.file} (${r.aplicada_em})`);
console.log(`Banco: ${DB_FILE}`);
db.close();
