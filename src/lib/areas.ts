/**
 * Arquivo: areas.ts
 * Responsabilidade: Define as áreas de navegação e mantém a última área escolhida.
 */

export type AreaApp = 'geral' | 'vendas' | 'gestao' | 'estoque' | 'configuracoes';

export const AREA_STORAGE_KEY = 'simplesx_area';

export function selecionarArea(area: AreaApp) {
  localStorage.setItem(AREA_STORAGE_KEY, area);
}

export function areaSelecionada(): AreaApp {
  const area = localStorage.getItem(AREA_STORAGE_KEY);
  if (area === 'vendas' || area === 'gestao' || area === 'estoque' || area === 'configuracoes') return area;
  return 'geral';
}
