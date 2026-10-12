export interface EdicaoTaxaServico {
  comandaId: number;
  valor: string;
}

// Uma edição explícita (inclusive vazio ou zero) tem prioridade sobre o polling.
export function taxaServicoAtual(comandaId: number, taxaSalva: number | null | undefined, edicao: EdicaoTaxaServico | null): string {
  return edicao?.comandaId === comandaId ? edicao.valor : String(taxaSalva ?? 0);
}
