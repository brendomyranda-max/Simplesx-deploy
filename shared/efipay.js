/**
 * Integração de checkout Efí. As credenciais ficam somente no ambiente do
 * servidor; cada loja armazena apenas o payee_code público da própria conta.
 */
import { estabelecimentoId, getConfigValue, httpError, setConfig } from './util.js';

function baseUrl(env) {
  return String(env.EFI_ENVIRONMENT || 'sandbox').toLowerCase() === 'production'
    ? 'https://cobrancas.api.efipay.com.br'
    : 'https://cobrancas-h.api.efipay.com.br';
}

export function efiCheckoutReady(env) {
  const fee = Number(env.EFI_PLATFORM_FEE_BPS);
  const callback = String(env.EFI_NOTIFICATION_URL || 'https://doixp.com/api/public/efipay/checkout/notificacao');
  let validCallback = false;
  try { validCallback = new URL(callback).protocol === 'https:'; } catch { /* callback inválido mantém checkout desligado */ }
  return Boolean(env.EFI_CLIENT_ID && env.EFI_CLIENT_SECRET && validCallback && Number.isInteger(fee) && fee > 0 && fee < 10000);
}

export async function efiCheckoutDisponivel(env, tenantId) {
  if (!efiCheckoutReady(env)) return false;
  const id = tenantId || estabelecimentoId(env);
  if (!id) return false;
  const row = await env.DB.prepare('SELECT valor FROM empresa_config WHERE estabelecimento_id=? AND chave=\'efi_payee_code\'').bind(id).first();
  const code = String(row?.valor || '').trim();
  return /^[A-Za-z0-9_-]{16,80}$/.test(code);
}

export async function getEfiConfigHandler(c, env) {
  return c.json({
    payee_code: await getConfigValue(env, 'efi_payee_code', ''),
    pix_chave: await getConfigValue(env, 'pix_chave', ''),
    pix_cidade: await getConfigValue(env, 'pix_cidade', ''),
    api_configurada: efiCheckoutReady(env),
    checkout_ativo: await efiCheckoutDisponivel(env, null),
  });
}

export async function putEfiConfigHandler(c, env) {
  const body = await c.req.json().catch(() => ({}));
  const code = String(body.payee_code || '').trim();
  const pixKey = body.pix_chave === undefined ? undefined : String(body.pix_chave || '').trim();
  const city = body.pix_cidade === undefined ? undefined : String(body.pix_cidade || '').trim();
  if (code && !/^[A-Za-z0-9_-]{16,80}$/.test(code)) return c.json({ error: 'Informe um payee_code Efí válido.' }, 400);
  if (pixKey !== undefined && pixKey.length > 200) return c.json({ error: 'Chave Pix inválida.' }, 400);
  if (city !== undefined && city.length > 15) return c.json({ error: 'A cidade deve ter no máximo 15 caracteres.' }, 400);
  if ((pixKey || city) && (!pixKey || city.length < 2)) return c.json({ error: 'Informe a chave Pix e a cidade para manter o Pix manual ativo.' }, 400);
  await setConfig(env, 'efi_payee_code', code);
  if (pixKey !== undefined) await setConfig(env, 'pix_chave', pixKey);
  if (city !== undefined) await setConfig(env, 'pix_cidade', city);
  if (pixKey !== undefined && city !== undefined) {
    await env.DB.prepare('UPDATE lojas_online SET pix_chave=?,pix_cidade=?,atualizado_em=? WHERE estabelecimento_id=?')
      .bind(pixKey || null, city || null, new Date().toISOString(), estabelecimentoId(env)).run();
  }
  return getEfiConfigHandler(c, env);
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

function allowedPaymentUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && ['pagamento.gerencianet.com.br', 'pagamento.efipay.com.br'].includes(url.hostname.toLowerCase());
  } catch { return false; }
}

export async function criarLinkCheckoutEfi(env, store, tenantId, key, items, total, deliveryFee, platformDelivery) {
  const config = await env.DB.prepare('SELECT valor FROM empresa_config WHERE estabelecimento_id=? AND chave=\'efi_payee_code\'').bind(tenantId).first();
  const payeeCode = String(config?.valor || '').trim();
  if (!efiCheckoutReady(env) || !/^[A-Za-z0-9_-]{16,80}$/.test(payeeCode)) {
    throw httpError(403, 'Checkout Efí indisponível. Configure as credenciais da plataforma e o payee_code da loja.');
  }
  const feeBps = Number(env.EFI_PLATFORM_FEE_BPS);
  const merchantBps = 10000 - feeBps;
  const linkItems = items.map((item) => ({
    name: String(item.nome).slice(0, 100), value: Math.round(item.preco_unitario * 100), amount: item.quantidade,
    marketplace: { mode: 2, repasses: [{ payee_code: payeeCode, percentage: merchantBps }] },
  }));
  if (deliveryFee > 0) {
    const deliveryItem = { name: 'Taxa de entrega', value: Math.round(deliveryFee * 100), amount: 1 };
    if (!platformDelivery) deliveryItem.marketplace = { mode: 2, repasses: [{ payee_code: payeeCode, percentage: 10000 }] };
    linkItems.push(deliveryItem);
  }
  const payload = {
    items: linkItems,
    metadata: { custom_id: key, notification_url: String(env.EFI_NOTIFICATION_URL || 'https://doixp.com/api/public/efipay/checkout/notificacao') },
    settings: { payment_method: 'credit_card', message: `Pedido DoixP ${String(store.nome || store.empresa_nome || '').slice(0, 30)}` },
  };
  const result = await efiRequest(env, '/v1/charge/one-step/link', { method: 'POST', body: JSON.stringify(payload) });
  const data = result.data || {};
  const chargeId = String(data.charge_id || '');
  const url = String(data.payment_url || '');
  if (!chargeId || !allowedPaymentUrl(url) || Number(data.total) !== Math.round(total * 100)) {
    throw httpError(502, 'A Efí retornou dados inválidos para o checkout.');
  }
  return { url, charge_id: chargeId };
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
