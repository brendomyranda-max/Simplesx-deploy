/** Reconcilia somente cobranças históricas. A criação de pagamentos online foi retirada. */
import { httpError } from './util.js';

function baseUrl(env) {
  return String(env.EFI_ENVIRONMENT || 'sandbox').toLowerCase() === 'production'
    ? 'https://cobrancas.api.efipay.com.br'
    : 'https://cobrancas-h.api.efipay.com.br';
}

async function efiRequest(env, path, options = {}) {
  const base = baseUrl(env);
  const credentials = btoa(`${env.EFI_CLIENT_ID}:${env.EFI_CLIENT_SECRET}`);
  const authResponse = await fetch(`${base}/v1/authorize`, {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials' }),
  });
  const auth = await authResponse.json().catch(() => ({}));
  if (!authResponse.ok || !auth.access_token) throw httpError(503, 'Não foi possível autenticar o checkout Efí.');
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${auth.access_token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw httpError(response.status >= 500 ? 503 : 422, 'A Efí não aceitou a operação do checkout. Confira a conta e as permissões da API.');
  return result;
}

export async function confirmarCobrancaEfi(env, chargeId) {
  if (!/^\d{1,20}$/.test(String(chargeId || ''))) throw httpError(400, 'Referência de cobrança Efí inválida.');
  const result = await efiRequest(env, `/v1/charge/${encodeURIComponent(chargeId)}`);
  return result.data || {};
}

export async function consultarNotificacaoEfi(env, token) {
  if (!/^[A-Za-z0-9-]{16,80}$/.test(String(token || ''))) throw httpError(400, 'Notificação Efí inválida.');
  const result = await efiRequest(env, `/v1/notification/${encodeURIComponent(token)}`);
  return Array.isArray(result.data) ? result.data : [];
}
