export interface LinhaCmv {
  quantidade: number;
  unidade: string;
  insumo_unidade?: string;
  insumo_custo?: number;
}

// Famílias de unidades com fator para a base da família.
const FAMILIAS: Record<string, Record<string, number>> = {
  count: { UN: 1, PC: 1, PCT: 1, CX: 1, DZ: 12 },
  mass: { G: 1, KG: 1000 },
  volume: { ML: 1, L: 1000, LT: 1000 },
};

export const UNIDADES = ['UN', 'KG', 'G', 'L', 'ML', 'CX', 'PC', 'DZ', 'PCT', 'LT'];

function normalizar(u: string | undefined): string {
  return String(u || '').trim().toUpperCase();
}

export function converterQuantidade(qtd: number, deUnidade?: string, paraUnidade?: string): number | null {
  const de = normalizar(deUnidade);
  const para = normalizar(paraUnidade);
  if (de === para) return qtd;
  for (const fam of Object.values(FAMILIAS)) {
    if (fam[de] !== undefined && fam[para] !== undefined) {
      return (qtd * fam[de]) / fam[para];
    }
  }
  return null;
}

export function unidadeCompativel(deUnidade?: string, paraUnidade?: string): boolean {
  const de = normalizar(deUnidade);
  const para = normalizar(paraUnidade);
  if (de === para) return true;
  for (const fam of Object.values(FAMILIAS)) {
    if (fam[de] !== undefined && fam[para] !== undefined) return true;
  }
  return false;
}

export function custoLinha(quantidade: number, unidade?: string, insumoUnidade?: string, insumoCusto?: number): number | null {
  const q = converterQuantidade(quantidade, unidade, insumoUnidade);
  if (q === null) return null;
  return q * Number(insumoCusto || 0);
}

export function calcularCmv(linhas: LinhaCmv[]): number {
  let total = 0;
  for (const l of linhas) {
    const c = custoLinha(l.quantidade, l.unidade, l.insumo_unidade, l.insumo_custo);
    if (c === null) return 0;
    total += c;
  }
  return Math.round((total + Number.EPSILON) * 100) / 100;
}

export function formatarUnidadeInsuficiente(linhas: LinhaCmv[]): string | null {
  for (const l of linhas) {
    if (!unidadeCompativel(l.unidade, l.insumo_unidade)) {
      return `${l.unidade} incompatível com a unidade do insumo (${l.insumo_unidade})`;
    }
  }
  return null;
}
