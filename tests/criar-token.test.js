import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import SqliteDb from '../server/sqlite-db.js';
import { verificarSenha } from '../shared/util.js';

test('CLI cria dono com senha do ambiente, não a imprime e recusa senha nos argumentos', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'simplesx-token-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = { ...process.env, SIMPLESX_DB: path.join(dir, 'teste.db'), SIMPLESX_SENHA_DONO: 'senha-ficticia-do-teste' };
  const args = [fileURLToPath(new URL('../server/criar-token.js', import.meta.url)), 'Estabelecimento Teste', '11222333000181', 'dono'];
  const result = spawnSync(process.execPath, args, { env, encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Token:\s+[A-F0-9]{48}/);
  assert.equal((result.stdout + result.stderr).includes(env.SIMPLESX_SENHA_DONO), false);
  const db = new SqliteDb(env.SIMPLESX_DB);
  try {
    const users = db.prepare('SELECT usuario, senha_hash FROM funcionarios').all().results;
    assert.equal(users.length, 1);
    assert.equal(users[0].usuario, 'dono');
    assert.equal(await verificarSenha(env.SIMPLESX_SENHA_DONO, users[0].senha_hash), true);
  } finally {
    db.close();
  }
  const rejected = spawnSync(process.execPath, [...args, 'senha-passada-no-argumento'], { env, encoding: 'utf8' });
  assert.ifError(rejected.error);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /não passe senhas como argumento/);
  assert.equal((rejected.stdout + rejected.stderr).includes('senha-passada-no-argumento'), false);
});
