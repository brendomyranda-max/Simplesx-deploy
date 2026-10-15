import { httpError } from './util.js';

function config(env) {
  const secret = env.ENTREGAS_INTEGRATION_SECRET;
  const address = env.ENTREGAS_API_URL;
  if (typeof secret !== 'string' || secret.length < 32 || typeof address !== 'string') {
    throw httpError(503, 'Integração de entregadores ainda não configurada.');
  }
  let base;
  try { base = new URL(address); } catch { throw httpError(503, 'Endereço do serviço de entregas inválido.'); }
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) {
    throw httpError(503, 'Use um endereço HTTPS para o serviço de entregas.');
  }
  return { secret, base };
}

export async function chamarEntregas(env, path, { method = 'GET', body } = {}) {
  if (!/^\/api\/integration\/[a-zA-Z0-9/_-]+$/.test(path)) throw httpError(500, 'Caminho de integração inválido.');
  const { secret, base } = config(env);
  const raw = body === undefined ? '' : JSON.stringify(body);
  const timestamp = String(Date.now());
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signatureBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${raw}`));
  const signature = [...new Uint8Array(signatureBytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const url = new URL(path, base);
  const response = await (env.entregasFetch || fetch)(url.toString(), {
    method, headers: { Accept: 'application/json', 'x-doixp-timestamp': timestamp, 'x-doixp-signature': signature,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: raw }),
    signal: AbortSignal.timeout(8000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw httpError(response.status >= 500 ? 503 : response.status, result?.error || 'Serviço de entregas indisponível.');
  return result;
}
