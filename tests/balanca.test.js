/**
 * Arquivo: balanca.test.js
 * Responsabilidade: Testa validação e decodificação das etiquetas de balança.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { decodificarEtiquetaBalanca, ean13Valido } from '../shared/balanca.js';

function etiqueta(plu, medida) {
  const base = `2${String(plu).padStart(6, '0')}${String(medida).padStart(5, '0')}`;
  const soma = [...base].reduce((total, n, i) => total + Number(n) * (i % 2 === 0 ? 1 : 3), 0);
  return `${base}${(10 - (soma % 10)) % 10}`;
}

test('decodifica PLU e 742 gramas de uma etiqueta EAN-13', () => {
  const codigo = etiqueta(123, 742);
  assert.equal(ean13Valido(codigo), true);
  assert.deepEqual(decodificarEtiquetaBalanca(codigo), { plu: '000123', quantidade: 0.742 });
});

test('rejeita etiqueta com dígito verificador incorreto ou medida zero', () => {
  const codigo = etiqueta(123, 742);
  assert.equal(decodificarEtiquetaBalanca(`${codigo.slice(0, 12)}${(Number(codigo[12]) + 1) % 10}`), null);
  assert.equal(decodificarEtiquetaBalanca(etiqueta(123, 0)), null);
});
