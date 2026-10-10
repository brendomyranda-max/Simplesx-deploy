/** Cores prontas para a apresentação do cardápio quando a loja não usa capa. */

export const CORES_APRESENTACAO = ['#1f6c4c', '#c2410c', '#b45309', '#1d4ed8', '#7f1d1d', '#111827', '#e8b931'];

export function corApresentacao(valor: string) {
  const texto = valor.trim();
  return /^#[0-9a-fA-F]{6}$/.test(texto) ? texto.toLowerCase() : '';
}
