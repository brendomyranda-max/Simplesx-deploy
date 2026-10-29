/**
 * Arquivo: print.ts
 * Responsabilidade: Prepara recibos e escolhe a estratégia de impressão.
 */

const BOBINA_KEY = 'simplesx_bobina';

import { enviarViaDeploy } from './cupsPrint';

export type Bobina = '80' | '58';

export function getBobina(): Bobina {
  const v = localStorage.getItem(BOBINA_KEY);
  return v === '58' ? '58' : '80';
}

export function setBobina(mm: Bobina) {
  localStorage.setItem(BOBINA_KEY, mm);
}

/** Envia o recibo para a fila do servidor. Falhas são exibidas por quem chama. */
export async function printReceipt(
  el: HTMLElement | null | undefined,
  width: Bobina = getBobina(),
) {
  if (!await enviarViaDeploy(el, width)) {
    throw new Error('Não foi possível enviar a impressão ao servidor. Confira a configuração em Impressoras.');
  }
}
