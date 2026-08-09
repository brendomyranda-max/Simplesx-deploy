const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v));

// Famílias de unidades com fator de conversão para a base da família.
const FAMILIAS = {
  count: { UN: 1, PC: 1, PCT: 1, CX: 1, DZ: 12 },
  mass: { G: 1, KG: 1000 },
  volume: { ML: 1, L: 1000, LT: 1000 },
};

export const UNIDADES = ['UN', 'KG', 'G', 'L', 'ML', 'CX', 'PC', 'DZ', 'PCT', 'LT'];

function normalizar(u) {
  return String(u || '').trim().toUpperCase();
}

// Converte uma quantidade de uma unidade para outra da mesma família.
// Retorna null se as unidades forem incompatíveis.
export function converterQuantidade(qtd, deUnidade, paraUnidade) {
  const de = normalizar(deUnidade);
  const para = normalizar(paraUnidade);
  const q = num(qtd);
  if (de === para) return q;
  for (const fam of Object.values(FAMILIAS)) {
    if (fam[de] !== undefined && fam[para] !== undefined) {
      return (q * fam[de]) / fam[para];
    }
  }
  return null;
}

export function unidadeCompativel(deUnidade, paraUnidade) {
  const de = normalizar(deUnidade);
  const para = normalizar(paraUnidade);
  if (de === para) return true;
  for (const fam of Object.values(FAMILIAS)) {
    if (fam[de] !== undefined && fam[para] !== undefined) return true;
  }
  return false;
}

// Custo de uma linha da ficha: quantidade convertida x custo do insumo.
export function custoLinha(quantidade, unidade, insumoUnidade, insumoCusto) {
  const q = converterQuantidade(quantidade, unidade, insumoUnidade);
  if (q === null) return null;
  return q * num(insumoCusto);
}

export function arredondar(v, casas = 2) {
  const f = Math.pow(10, casas);
  return Math.round((num(v) + Number.EPSILON) * f) / f;
}
