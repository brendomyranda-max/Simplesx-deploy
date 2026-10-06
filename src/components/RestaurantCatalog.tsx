import { useMemo, useState } from 'react';
import { Search, ChevronRight, Utensils } from 'lucide-react';
import { Card, EmptyState, Input } from '@/components/ui';
import type { Categoria, Produto } from '@/lib/types';
import { restaurantProducts } from '@/lib/restaurantCatalog';
import { fmtBRL } from '@/lib/format';

export function RestaurantCatalog({ products, categories, onSelect }: {
  products: Produto[]; categories: Categoria[]; onSelect: (product: Produto) => void;
}) {
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [subId, setSubId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const active = useMemo(() => categories.filter((c) => c.ativo), [categories]);
  const roots = active.filter((c) => !c.categoria_pai_id || !active.some((parent) => parent.id === c.categoria_pai_id));
  const children = active.filter((c) => c.categoria_pai_id === categoryId);
  const current = active.find((c) => c.id === categoryId);
  const selectedSub = active.find((c) => c.id === subId);
  const visible = useMemo(() => restaurantProducts(products, active, subId ?? categoryId, search), [products, active, categoryId, subId, search]);
  const tabClass = (selected: boolean) => `rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${selected ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-brand-300 hover:bg-brand-50'}`;

  return (
    <Card className="mb-4 p-4">
      <h2 className="mb-3 text-sm font-bold text-slate-700">Cardápio</h2>
      <div className="flex flex-wrap gap-2" aria-label="Categorias do cardápio">
        <button type="button" aria-pressed={categoryId === null} className={tabClass(categoryId === null)} onClick={() => { setCategoryId(null); setSubId(null); }}>Tudo</button>
        {roots.map((category) => <button key={category.id} type="button" aria-pressed={categoryId === category.id} className={tabClass(categoryId === category.id)}
          onClick={() => { setCategoryId(category.id); setSubId(null); }}>{category.nome}</button>)}
      </div>
      {current && children.length > 0 && (
        <div className="mt-3 rounded-xl bg-slate-50 p-3">
          <p className="mb-2 text-xs font-semibold text-slate-500">Subcategorias de {current.nome}</p>
          <div className="flex flex-wrap gap-2" aria-label={`Subcategorias de ${current.nome}`}>
            <button type="button" aria-pressed={subId === null} className={tabClass(subId === null)} onClick={() => setSubId(null)}>Tudo em {current.nome}</button>
            {children.map((category) => <button key={category.id} type="button" aria-pressed={subId === category.id} className={tabClass(subId === category.id)} onClick={() => setSubId(category.id)}>{category.nome}</button>)}
          </div>
        </div>
      )}
      <div className="relative mt-3">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input className="pl-9" aria-label="Buscar produto no cardápio" placeholder={current ? `Buscar em ${selectedSub?.nome || current.nome}...` : 'Buscar produto pelo nome...'} value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <p className="my-3 flex items-center gap-1 text-xs text-slate-500" aria-live="polite">
        {current?.nome || 'Todo o cardápio'}{selectedSub && <><ChevronRight className="h-3 w-3" />{selectedSub.nome}</>} · {visible.length} produto(s)
      </p>
      {visible.length === 0 ? <EmptyState icon={<Utensils className="h-6 w-6" />} title="Nenhum produto encontrado" subtitle="Escolha outra categoria ou altere a busca." /> : (
        <div className="grid max-h-80 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
          {visible.map((product) => <button key={product.id} type="button" onClick={() => onSelect(product)}
            className="rounded-xl border border-slate-200 p-3 text-left transition-colors hover:border-brand-300 hover:bg-brand-50/40 focus-visible:outline-brand-500">
            <p className="text-sm font-bold leading-tight text-slate-800">{product.nome}</p>
            <p className="mt-1 text-xs font-bold text-brand-600">{product.preco != null ? fmtBRL(product.preco) : '—'}</p>
          </button>)}
        </div>
      )}
    </Card>
  );
}
