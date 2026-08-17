import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes, pbkdf2Sync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import SqliteDb from './sqlite-db.js';
import { cnpjValido } from '../shared/util.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB_FILE = process.env.SIMPLESX_DB || path.join(ROOT, 'data', 'simplesx.db');
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const remoto = process.argv.includes('--remote');
const argumentos = process.argv.slice(2).filter((a) => a !== '--remote');
const [nome, cnpjInformado, usuario, senha] = argumentos;
const cnpj = String(cnpjInformado || '').replace(/\D/g, '');
if (!nome || !cnpjValido(cnpj) || !usuario || !senha) {
  console.error('Uso local:  npm run criar-token -- "Estabelecimento" 00000000000000 usuario "senha"');
  console.error('Uso deploy: npm run criar-token -- "Estabelecimento" 00000000000000 usuario "senha" --remote');
  process.exit(1);
}
if (senha.length < 8) {
  console.error('A senha do dono precisa ter pelo menos 8 caracteres.');
  process.exit(1);
}

const agora = new Date().toISOString();
const token = randomBytes(24).toString('hex').toUpperCase();
const tokenHash = createHash('sha256').update(token).digest('hex');
const senhaSalt = randomBytes(16).toString('hex');
const senhaHash = `pbkdf2:${senhaSalt}:${pbkdf2Sync(senha, senhaSalt, 100000, 32, 'sha256').toString('hex')}`;
const sqlValor = (v) => `'${String(v ?? '').replaceAll("'", "''")}'`;

if (remoto) {
  const q = sqlValor;
  const sql = [
    `INSERT INTO estabelecimentos(nome,cnpj,ativo,criado_em) VALUES (${q(nome.trim())},${q(cnpj)},1,${q(agora)});`,
    `INSERT INTO auth_tokens(estabelecimento_id,token_hash,nome,ativo,criado_em) VALUES (last_insert_rowid(),${q(tokenHash)},${q(`Acesso ${nome.trim()}`)},1,${q(agora)});`,
    `INSERT INTO funcionarios(estabelecimento_id,nome,usuario,senha_hash,perfil,modulos,ativo,criado_em) SELECT estabelecimento_id,'Dono',${q(usuario.trim())},${q(senhaHash)},'admin','gestor',1,${q(agora)} FROM auth_tokens WHERE token_hash=${q(tokenHash)};`,
    `INSERT INTO mesas(estabelecimento_id,numero,nome,capacidade,setor,status,tipo,ativo,criado_em) SELECT estabelecimento_id,9999,'Pagamentos Individuais',99,'Pagamentos','livre','pagamentos',1,${q(agora)} FROM auth_tokens WHERE token_hash=${q(tokenHash)};`,
    ...[
      ['modo_operacao', 'mercado'], ['taxa_garcom_pct', '10'], ['perda_timeout_min', '2'],
      ['empresa_nome', nome.trim()], ['empresa_cnpj', cnpj], ['dias_vencimento_aviso', '7'],
    ].map(([chave, valor]) => `INSERT INTO empresa_config(estabelecimento_id,chave,valor) SELECT estabelecimento_id,${q(chave)},${q(valor)} FROM auth_tokens WHERE token_hash=${q(tokenHash)};`),
  ].join(' ');
  const resultado = spawnSync('npx', ['wrangler', 'd1', 'execute', 'simplesx-db', '--remote', '--command', sql], {
    cwd: ROOT,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  if (resultado.status !== 0) process.exit(resultado.status || 1);
  console.log('\nEstabelecimento criado no deploy. Guarde o token: ele não será exibido novamente.\n');
  console.log(`  Estabelecimento: ${nome.trim()}`);
  console.log(`  Usuário dono:   ${usuario.trim()}`);
  console.log(`  Token:           ${token}\n`);
  process.exit(0);
}

const db = new SqliteDb(DB_FILE);

try {
  const estId = db.prepare('INSERT INTO estabelecimentos (nome, cnpj, ativo, criado_em) VALUES (?,?,1,?)')
    .bind(nome.trim(), cnpj, agora).run().meta.last_row_id;
  db.batch([
    db.prepare('INSERT INTO auth_tokens (estabelecimento_id, token_hash, nome, ativo, criado_em) VALUES (?,?,?,1,?)')
      .bind(estId, tokenHash, `Acesso ${nome.trim()}`, agora),
    db.prepare("INSERT INTO funcionarios (estabelecimento_id, nome, usuario, senha_hash, perfil, modulos, ativo, criado_em) VALUES (?,?,?,?, 'admin', 'gestor', 1, ?)")
      .bind(estId, 'Dono', usuario.trim(), senhaHash, agora),
    db.prepare("INSERT INTO mesas (estabelecimento_id, numero, nome, capacidade, setor, status, tipo, ativo, criado_em) VALUES (?,9999,'Pagamentos Individuais',99,'Pagamentos','livre','pagamentos',1,?)")
      .bind(estId, agora),
    ...[
      ['modo_operacao', 'mercado'], ['taxa_garcom_pct', '10'], ['perda_timeout_min', '2'],
      ['empresa_nome', nome.trim()], ['empresa_cnpj', cnpj], ['dias_vencimento_aviso', '7'],
    ].map(([chave, valor]) => db.prepare('INSERT INTO empresa_config (estabelecimento_id, chave, valor) VALUES (?,?,?)').bind(estId, chave, valor)),
  ]);
  console.log('\nEstabelecimento criado com sucesso. Guarde o token: ele não será exibido novamente.\n');
  console.log(`  Estabelecimento: ${nome.trim()}`);
  console.log(`  Usuário dono:   ${usuario.trim()}`);
  console.log(`  Token:           ${token}\n`);
} catch (e) {
  console.error('Não foi possível criar o estabelecimento:', e.message);
  process.exitCode = 1;
} finally {
  db.close();
}
