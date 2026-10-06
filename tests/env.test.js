import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { serverEnv, projectEnv, localDatabasePath } from '../server/env.js';

test('servidor exige Turnstile real em produção e não expõe outras variáveis', () => {
  assert.throws(() => serverEnv({ NODE_ENV: 'production' }), /TURNSTILE_SITE_KEY/);
  assert.throws(() => serverEnv({ NODE_ENV: 'production', TURNSTILE_SITE_KEY: 'site-configurado' }), /TURNSTILE_SECRET_KEY/);
  for (const prefix of ['1', '2', '3']) {
    assert.throws(() => serverEnv({ NODE_ENV: 'production', TURNSTILE_SITE_KEY: `${prefix}x00000000000000000000AA` }), /produção/);
    assert.throws(() => serverEnv({ NODE_ENV: 'production', TURNSTILE_SITE_KEY: 'site-configurado', TURNSTILE_SECRET_KEY: `${prefix}x0000000000000000000000000000000AA` }), /produção/);
  }
  const config = serverEnv({ NODE_ENV: 'production', TURNSTILE_SITE_KEY: 'site-configurado', TURNSTILE_SECRET_KEY: 'valor-ficticio', COLABORACAO_PIX_CHAVE: ' pix@example.com ', SIMPLESX_SENHA_DONO: 'somente-no-processo' });
  assert.equal(config.COLABORACAO_PIX_CHAVE, undefined);
  assert.equal(config.SIMPLESX_SENHA_DONO, undefined);
  assert.equal(serverEnv({}).TURNSTILE_SECRET_KEY, '');
});

test('carregamento de .env preserva ambiente exportado e aceita arquivo ausente', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'simplesx-env-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, '.env');
  writeFileSync(file, 'SIMPLESX_ENV_TEST_EXISTING=arquivo\nSIMPLESX_ENV_TEST_NEW="valor do arquivo"\n');
  const moduleUrl = new URL('../server/env.js', import.meta.url).href;
  const script = `import { loadLocalEnv } from ${JSON.stringify(moduleUrl)};
    loadLocalEnv(${JSON.stringify(file)});
    loadLocalEnv(${JSON.stringify(path.join(dir, 'ausente'))});
    console.log(JSON.stringify([process.env.SIMPLESX_ENV_TEST_EXISTING, process.env.SIMPLESX_ENV_TEST_NEW]));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8', env: { ...process.env, SIMPLESX_ENV_TEST_EXISTING: 'exportado' },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), ['exportado', 'valor do arquivo']);
});

test('nova marca aceita configurações anteriores e mantém o banco local existente', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'simplexsa-config-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(projectEnv('DB', { SIMPLEXSA_DB: 'novo.db', SIMPLESX_DB: 'anterior.db' }), 'novo.db');
  assert.equal(projectEnv('SENHA_DONO', { SIMPLESX_SENHA_DONO: 'senha-anterior-ficticia' }), 'senha-anterior-ficticia');
  assert.equal(localDatabasePath(dir, {}), path.join(dir, 'data', 'simplexsa.db'));
  // Um arquivo anterior deve ser aberto no mesmo caminho, sem criar um banco vazio.
  const oldFile = path.join(dir, 'data', 'simplesx.db');
  mkdirSync(path.dirname(oldFile));
  writeFileSync(oldFile, 'banco-ficticio');
  assert.equal(localDatabasePath(dir, {}), oldFile);
  assert.equal(localDatabasePath(dir, { SIMPLESX_DB: 'personalizado.db' }), 'personalizado.db');
  assert.equal(localDatabasePath(dir, { SIMPLEXSA_DB: 'escolhido.db' }), 'escolhido.db');
});
