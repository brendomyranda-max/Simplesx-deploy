import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import SqliteDb from './sqlite-db.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB_FILE = process.env.SIMPLESX_DB || path.join(ROOT, 'data', 'simplesx.db');
const args = process.argv.slice(2);
const remoto = args.includes('--remote');
const limpos = args.filter((a) => a !== '--remote');
const acao = (limpos[0] || 'listar').toLowerCase();
const id = Number(limpos[1]);

const ajuda = () => {
  console.log('Listar:     npm run tokens -- listar --remote');
  console.log('Desativar: npm run tokens -- desativar ID --remote');
  console.log('Ativar:    npm run tokens -- ativar ID --remote');
  console.log('Renovar:   npm run tokens -- renovar ID --remote');
  console.log('Apagar:    npm run tokens -- apagar ID --remote');
};

if (!['listar', 'desativar', 'ativar', 'renovar', 'apagar'].includes(acao) || (acao !== 'listar' && (!Number.isInteger(id) || id <= 0))) {
  ajuda();
  process.exit(1);
}

const listSql = `SELECT t.id AS token_id, e.id AS estabelecimento_id, e.nome AS estabelecimento,
 t.nome AS acesso, t.ativo, t.criado_em,
 (SELECT COUNT(*) FROM funcionarios f WHERE f.estabelecimento_id=e.id AND f.ativo=1) AS usuarios
 FROM auth_tokens t JOIN estabelecimentos e ON e.id=t.estabelecimento_id ORDER BY e.nome, t.id`;

let sql = listSql;
let novoToken = '';
if (acao === 'desativar') {
  sql = `DELETE FROM sessoes WHERE estabelecimento_id=(SELECT estabelecimento_id FROM auth_tokens WHERE id=${id}); UPDATE auth_tokens SET ativo=0 WHERE id=${id};`;
} else if (acao === 'ativar') {
  sql = `UPDATE auth_tokens SET ativo=1 WHERE id=${id};`;
} else if (acao === 'renovar') {
  novoToken = randomBytes(24).toString('hex').toUpperCase();
  const novoHash = createHash('sha256').update(novoToken).digest('hex');
  sql = `DELETE FROM sessoes WHERE estabelecimento_id=(SELECT estabelecimento_id FROM auth_tokens WHERE id=${id}); UPDATE auth_tokens SET token_hash='${novoHash}', ativo=1 WHERE id=${id};`;
} else if (acao === 'apagar') {
  sql = `DELETE FROM sessoes WHERE estabelecimento_id=(SELECT estabelecimento_id FROM auth_tokens WHERE id=${id}); DELETE FROM auth_tokens WHERE id=${id};`;
}

if (remoto) {
  const r = spawnSync('npx', ['wrangler', 'd1', 'execute', 'simplesx-db', '--remote', '--command', sql], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
  if (acao === 'renovar') {
    console.log('\nToken renovado. Guarde agora: ele não poderá ser consultado novamente.');
    console.log(`\n  Token: ${novoToken}\n`);
  }
  process.exit(0);
}

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const db = new SqliteDb(DB_FILE);
if (acao === 'listar') {
  console.table(db.prepare(listSql).all().results);
} else if (acao === 'desativar' || acao === 'apagar' || acao === 'renovar') {
  const token = db.prepare('SELECT estabelecimento_id FROM auth_tokens WHERE id=?').bind(id).first();
  if (!token) {
    console.error('Token não encontrado.');
    db.close();
    process.exit(1);
  }
  db.prepare('DELETE FROM sessoes WHERE estabelecimento_id=?').bind(token.estabelecimento_id).run();
  if (acao === 'desativar') {
    db.prepare('UPDATE auth_tokens SET ativo=0 WHERE id=?').bind(id).run();
    console.log('Token desativado.');
  } else if (acao === 'renovar') {
    const novoHash = createHash('sha256').update(novoToken).digest('hex');
    db.prepare('UPDATE auth_tokens SET token_hash=?, ativo=1 WHERE id=?').bind(novoHash, id).run();
    console.log('\nToken renovado. Guarde agora: ele não poderá ser consultado novamente.');
    console.log(`\n  Token: ${novoToken}\n`);
  } else {
    db.prepare('DELETE FROM auth_tokens WHERE id=?').bind(id).run();
    console.log('Token apagado; os dados do estabelecimento foram preservados.');
  }
} else {
  db.prepare('UPDATE auth_tokens SET ativo=1 WHERE id=?').bind(id).run();
  console.log('Token ativado.');
}
db.close();
