/**
 * Arquivo: balanca.js
 * Responsabilidade: Valida e decodifica etiquetas EAN-13 geradas por balanças.
 */

// Formato suportado: 2 + PLU (6) + quantidade em g/ml (5) + DV EAN-13.
export function ean13Valido(codigo) {
  if (!/^\d{13}$/.test(String(codigo))) return false;
  const nums = [...String(codigo)].map(Number);
  const soma = nums.slice(0, 12).reduce((total, n, i) => total + n * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (soma % 10)) % 10 === nums[12];
}

export function decodificarEtiquetaBalanca(codigo) {
  const valor = String(codigo || '').trim();
  if (!/^2\d{12}$/.test(valor) || !ean13Valido(valor)) return null;
  const medida = Number(valor.slice(7, 12));
  if (!medida) return null;
  return { plu: valor.slice(1, 7), quantidade: medida / 1000 };
}
