import { httpError } from './util.js';

// A impressão e a baixa usam os mesmos centavos e o mesmo percentual.
export function calcularContaIndividual(consumo, percentual) {
  if (typeof percentual !== 'number' || !Number.isFinite(percentual) || percentual < 0 || percentual > 100) {
    throw httpError(400, 'A porcentagem do garçom deve estar entre 0 e 100');
  }
  const subtotal = Number(consumo.toFixed(2));
  const taxa_servico = Number((subtotal * percentual / 100).toFixed(2));
  return { subtotal, taxa_servico, total: Number((subtotal + taxa_servico).toFixed(2)), taxa_garcom_pct: percentual };
}
