import { httpError } from './util.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function keyFor(secret) {
  if (typeof secret !== 'string' || secret.length < 32) throw httpError(503, 'Segredo de entregas não configurado.');
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`DoixP delivery code v1:${secret}`));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decode(value) {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw httpError(400, 'Código cifrado inválido.');
  const text = value.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(text.padEnd(Math.ceil(text.length / 4) * 4, '=')), c => c.charCodeAt(0));
}

export async function cifrarCodigoEntrega(last4, reference, secret) {
  if (!/^\d{4}$/.test(last4) || !reference) throw httpError(400, 'Informe os últimos quatro números do CPF.');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(reference) }, await keyFor(secret), encoder.encode(last4));
  return `${base64url(iv)}.${base64url(new Uint8Array(ciphertext))}`;
}

export async function decifrarCodigoEntrega(value, reference, secret) {
  const parts = String(value || '').split('.');
  if (parts.length !== 2) throw httpError(400, 'Código cifrado inválido.');
  const iv = decode(parts[0]);
  if (iv.length !== 12) throw httpError(400, 'Código cifrado inválido.');
  try {
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(reference) }, await keyFor(secret), decode(parts[1]));
    const code = decoder.decode(plaintext);
    if (!/^\d{4}$/.test(code)) throw new Error('invalid');
    return code;
  } catch {
    throw httpError(409, 'Não foi possível recuperar o código de entrega deste pedido.');
  }
}
