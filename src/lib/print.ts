const PAGE_STYLE_ID = 'simplesx-print-page';
const BOBINA_KEY = 'simplesx_bobina';

import { getDirectPrint, getPrinterForWidth, sendCupsPrint, enviarViaDeploy } from './cupsPrint';

export type Bobina = '80' | '58';

export function getBobina(): Bobina {
  const v = localStorage.getItem(BOBINA_KEY);
  return v === '58' ? '58' : '80';
}

export function setBobina(mm: Bobina) {
  localStorage.setItem(BOBINA_KEY, mm);
}

/**
 * Tenta imprimir direto pelo "Gestor de Impressoras CUPS" (sem diálogo).
 * Retorna true se o job foi enviado com sucesso.
 */
export async function printDirect(
  el: HTMLElement | null | undefined,
  width: Bobina = getBobina(),
  title?: string,
): Promise<boolean> {
  if (!getDirectPrint() || !el) return false;
  const text = (el.innerText || el.textContent || '').trim();
  if (!text) return false;
  const res = await sendCupsPrint({
    printer: getPrinterForWidth(width),
    title: title || document.title,
    text,
    width,
    cut: true,
    feed: width === '58' ? 3 : 0,
  });
  return res.ok;
}

function setPageSize(width: Bobina) {
  let s = document.getElementById(PAGE_STYLE_ID) as HTMLStyleElement | null;
  if (!s) {
    s = document.createElement('style');
    s.id = PAGE_STYLE_ID;
    document.head.appendChild(s);
  }
  s.textContent = `@media print { @page { size: ${width}mm auto; margin: 0; } }`;
}

/**
 * Imprime apenas o conteúdo do elemento passado (ticket/cupom/etiqueta).
 * Ordem de tentativa: (1) fila do deploy (gestor central conectado via
 * internet, funciona de qualquer dispositivo), (2) impressão direta via CUPS
 * local, (3) janela de impressão do navegador com o tamanho de papel da
 * bobina escolhida. O conteúdo é clonado para fora do #root e o layout do
 * app é ocultado no print, evitando páginas em branco.
 */
export async function printReceipt(
  el: HTMLElement | null | undefined,
  width: Bobina = getBobina(),
  title?: string,
) {
  if (await enviarViaDeploy(el, width)) {
    return;
  }
  if (await printDirect(el, width, title)) {
    return;
  }
  if (!el) {
    window.print();
    return;
  }
  document.querySelectorAll('body > .print-area').forEach((n) => n.remove());
  document.body.classList.remove('print-58');

  const clone = el.cloneNode(true) as HTMLElement;
  clone.classList.add('print-area');
  ['w-64', 'w-60', 'mx-auto', 'rounded-lg', 'border-2', 'border-dashed', 'border-slate-300'].forEach((c) =>
    clone.classList.remove(c)
  );

  setPageSize(width);
  document.body.classList.toggle('print-58', width === '58');
  const paperMm = Number(width);
  clone.style.setProperty('--print-paper-width', `${paperMm}mm`);
  clone.style.setProperty('--print-content-width', `${paperMm - 4}mm`);
  clone.style.setProperty('--print-padding', `${Math.max(2, paperMm * 0.04).toFixed(1)}mm`);
  clone.style.setProperty('--print-font-size', `${Math.max(10, Math.min(14, paperMm * 0.17)).toFixed(1)}px`);
  document.body.appendChild(clone);

  const cleanup = () => {
    clone.remove();
    document.body.classList.remove('print-58');
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
  setTimeout(cleanup, 60000);
}
