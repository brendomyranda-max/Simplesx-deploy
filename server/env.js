import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

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
    'COLABORACAO_PIX_CHAVE', 'COLABORACAO_PIX_NOME', 'COLABORACAO_PIX_CIDADE',
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
