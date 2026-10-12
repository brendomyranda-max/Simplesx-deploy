import { normalizarUidNfc } from './nfc.js';
import { httpError } from './util.js';

export function idDoCartao(body) {
  const payload = String(body?.payload || '').replace(/[\u0000-\u001F\u007F]/g, '').trim();
  const uid = normalizarUidNfc(body?.uid);
  // O cartão identifica a conta pelo serial físico, mesmo vazio ou com outro texto NDEF.
  // Leitores antigos que só fornecem o texto continuam aceitos quando não há UID.
  const bruto = (uid || payload).replace(/\s+/g, '');
  if (!/^[\x21-\x7E]{1,64}$/.test(bruto)) throw httpError(400, 'Aproxime um cartão NFC válido');
  return bruto.toUpperCase();
}

