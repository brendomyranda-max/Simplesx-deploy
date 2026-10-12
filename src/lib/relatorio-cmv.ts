import type { Categoria, ProdutoCmv } from './types';

export type OrdemCmv = 'lucro_desc' | 'lucro_asc' | 'margem_desc' | 'margem_asc' | 'categoria' | 'nome';
const normalizar = (texto: string) => texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();

export function filtrarProdutosCmv(produtos: ProdutoCmv[], categorias: Categoria[], categoria: string, busca: string, ordem: OrdemCmv): ProdutoCmv[] {
  const ids = new Set<number>(categoria && categoria !== 'sem' ? [Number(categoria)] : []);
  for (const id of ids) {
    for (const filha of categorias.filter((item) => item.categoria_pai_id === id)) ids.add(filha.id);
  }
  const termo = normalizar(busca);
  const lista = produtos.filter((produto) =>
    (!termo || normalizar(`${produto.nome} ${produto.codigo_interno || ''}`).includes(termo)) &&
    (!categoria || (categoria === 'sem' ? produto.categorias.length === 0 : produto.categorias.some((item) => ids.has(item.id))))
  );
  return lista.sort((a, b) => {
    const porNome = () => a.nome.localeCompare(b.nome, 'pt-BR') || a.id - b.id;
    if (ordem === 'nome') return porNome();
    if (ordem === 'categoria') {
      const nomeCategoria = (produto: ProdutoCmv) => produto.categorias.map((item) => item.nome).sort((x, y) => x.localeCompare(y, 'pt-BR')).join(', ') || 'Sem categoria';
      return nomeCategoria(a).localeCompare(nomeCategoria(b), 'pt-BR') || porNome();
    }
    const campo = ordem.startsWith('margem') ? 'margem_pct' : 'lucro_unitario';
    const x = a[campo], y = b[campo];
    // Produtos sem preço ficam no final em ambas as direções.
    if (x === null || y === null) return x === y ? porNome() : x === null ? 1 : -1;
    return (ordem.endsWith('_asc') ? x - y : y - x) || porNome();
  });
}
