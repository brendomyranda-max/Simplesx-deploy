import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import path from 'node:path';

// Os aliases permitem atualizar instalações que já possuem um .env configurado.
export function projectEnv(name, source = process.env) {
  return source[`SIMPLEXSA_${name}`] || source[`SIMPLESX_${name}`];
}

export function localDatabasePath(root, source = process.env) {
  const configured = projectEnv('DB', source);
  if (configured) return configured;
  const previous = path.join(root, 'data', 'simplesx.db');
  return existsSync(previous) ? previous : path.join(root, 'data', 'simplexsa.db');
}

export function loadLocalEnv(file = fileURLToPath(new URL('../.env', import.meta.url))) {
  try {
    loadEnvFile(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

export function serverEnv(source = process.env) {
  const env = Object.fromEntries([
    'TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY',
  ].map((key) => [key, String(source[key] || '').trim()]));

  if (source.NODE_ENV === 'production') {
    for (const key of ['TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY']) {
      if (!env[key] || /^[123]x0{10,}/.test(env[key])) {
        throw new Error(`Configure ${key} de produção no ambiente do servidor`);
      }
    }
  }
  return env;
}
