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

// Converte o consumo da ficha em unidades de estoque/embalagens do insumo.
// Ex.: 100 G de um insumo cuja UN contém 500 G = 0,2 UN.
// Sem conteúdo cadastrado, mantém a regra legada (custo por unidade de medida).
export function quantidadeEmUnidadesEstoque(quantidade, unidade, insumoUnidade, conteudoQuantidade, conteudoUnidade) {
  const conteudo = num(conteudoQuantidade);
  if (conteudo > 0 && conteudoUnidade) {
    const q = converterQuantidade(quantidade, unidade, conteudoUnidade);
    return q === null ? null : q / conteudo;
  }
  return converterQuantidade(quantidade, unidade, insumoUnidade);
}

export function custoLinhaEmbalagem(quantidade, unidade, insumoUnidade, insumoCusto, conteudoQuantidade, conteudoUnidade) {
  const q = quantidadeEmUnidadesEstoque(quantidade, unidade, insumoUnidade, conteudoQuantidade, conteudoUnidade);
  return q === null ? null : q * num(insumoCusto);
}

export function arredondar(v, casas = 2) {
  const f = Math.pow(10, casas);
  return Math.round((num(v) + Number.EPSILON) * f) / f;
}
