import type { Categoria, Produto } from './types';

export function categoryDescendants(categories: Categoria[], id: number): Set<number> {
  const ids = new Set([id]);
  for (const current of ids) {
    categories.filter((c) => c.ativo && c.categoria_pai_id === current).forEach((c) => ids.add(c.id));
  }
  return ids;
}

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();

export function restaurantProducts(products: Produto[], categories: Categoria[], categoryId: number | null, search: string): Produto[] {
  const ids = categoryId === null ? null : categoryDescendants(categories, categoryId);
  const term = normalize(search);
  return products.filter((p) => p.ativo && p.exibir_restaurante !== 0 &&
    (!term || normalize(p.nome).includes(term)) && (!ids || p.categorias.some((c) => ids.has(c.id))));
}
