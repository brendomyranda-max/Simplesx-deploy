/** Área administrativa que configura o catálogo publicado no site de pedidos. */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Camera, CheckCircle2, ChevronRight, ExternalLink, Link2, MapPin, PackagePlus, Pencil, Plus, Settings2, Store, UtensilsCrossed } from 'lucide-react';
import { AnimatedPage } from '@/components/AnimatedPage';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Tabs, Textarea, Toggle, useToast } from '@/components/ui';
import { onlineApi, produtoApi } from '@/lib/api';
import { FotoGaleria } from '@/components/FotoGaleria';
import { AcrescimoCadastro, lerAcrescimos, type LinhaAcrescimo } from '@/components/AcrescimoCadastro';
import type { CategoriaCardapio, CategoriaLoja, ModoEntrega, OnlineCatalogProduct, OnlineStore, Produto } from '@/lib/types';
import { fmtBRL } from '@/lib/format';
import { previaEntrega } from '@/lib/localizacao-cliente';
import { descricaoComIngredientes } from '@/lib/descricao-composto';

type Tab = 'cardapio' | 'loja';
type Draft = { price: string; description: string; ingredients: string; photoUrl: string; available: boolean; acrescimos: LinhaAcrescimo[]; categoriaId: string };

const numberInput = (value: string) => {
  const result = Number(value.replace(',', '.'));
  return Number.isFinite(result) ? result : NaN;
};

const emptyDraft = (product: OnlineCatalogProduct): Draft => ({
  price: product.preco == null ? '' : String(product.preco),
  description: product.descricao || '',
  ingredients: product.opcoes.filter((option) => option.tipo === 'removivel').map((option) => option.nome).join(', '),
  photoUrl: product.foto_url || '',
  available: product.disponivel === 1,
  categoriaId: product.cardapio_categoria_id ? String(product.cardapio_categoria_id) : '',
  acrescimos: product.opcoes.filter((option) => option.tipo === 'adicional' && option.insumo_id).map((option) => ({
    insumo_id: option.insumo_id || '',
    valor: String(option.preco_adicional),
    nome: option.nome,
  })),
});

export function OnlineCatalogPage({ embutido = false }: { embutido?: boolean }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('cardapio');
  const [products, setProducts] = useState<Produto[]>([]);
  const [catalog, setCatalog] = useState<OnlineCatalogProduct[]>([]);
  const [store, setStore] = useState<OnlineStore | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<OnlineCatalogProduct | null>(null);
  const [chooseProduct, setChooseProduct] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [insumos, setInsumos] = useState<Produto[]>([]);
  const [menuCategories, setMenuCategories] = useState<CategoriaCardapio[]>([]);
  const [categoriaNome, setCategoriaNome] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [list, onlineList, onlineStore, secoes] = await Promise.all([
        produtoApi.list(), onlineApi.products(), onlineApi.store(), onlineApi.menuCategories(),
      ]);
      setProducts(list);
      setCatalog(onlineList);
      setStore(onlineStore);
      setMenuCategories(secoes);
    } catch (error: any) {
      toast('error', error?.error || 'Não foi possível carregar o delivery');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { produtoApi.insumos().then(setInsumos).catch(() => setInsumos([])); }, []);

  const availableProducts = useMemo(() => products.filter((product) =>
    product.ativo && product.tipo !== 'insumo' && !catalog.some((onlineProduct) => onlineProduct.ativo !== 0 && onlineProduct.produto_id === product.id)), [products, catalog]);
  const openEditor = (product: OnlineCatalogProduct) => { setEditing(product); setDraft(emptyDraft(product)); setChooseProduct(false); };

  const addExisting = async (product: Produto) => {
    setSaving(true);
    try {
      const removiveis = (product.ficha || []).map((item, ordem) => ({ nome: item.insumo_nome || 'Ingrediente', tipo: 'removivel' as const, preco_adicional: 0, ordem, ativo: 1 }));
      const pagos = (product.acrescimos || []).map((item, indice) => ({
        nome: item.insumo_nome || 'Acréscimo', tipo: 'adicional' as const, preco_adicional: item.valor, insumo_id: item.insumo_id, ordem: removiveis.length + indice, ativo: 1,
      }));
      const online = await onlineApi.addProduct({
        produto_id: product.id,
        descricao: product.tipo === 'composto'
          ? descricaoComIngredientes((product.ficha || []).map((item) => item.insumo_nome || ''), product.observacoes || '')
          : (product.observacoes || ''),
        preco: product.preco,
        ativo: 1,
        opcoes: [...removiveis, ...pagos],
      });
      setCatalog((current) => [...current.filter((item) => item.produto_id !== online.produto_id), online]);
      openEditor(online);
      toast('success', 'Produto publicado no delivery');
    } catch (error: any) {
      toast('error', error?.error || 'Não foi possível adicionar o produto');
    } finally {
      setSaving(false);
    }
  };

  const saveProduct = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing || !draft) return;
    const price = numberInput(draft.price);
    if (!Number.isFinite(price) || price < 0) return toast('error', 'Informe o preço online');
    const lidos = lerAcrescimos(draft.acrescimos, insumos);
    if (lidos.erro) return toast('error', lidos.erro);
    const removables = [...new Set(draft.ingredients.split(',').map((ingredient) => ingredient.trim()).filter(Boolean))]
      .map((nome, ordem) => ({ nome, tipo: 'removivel' as const, preco_adicional: 0, ordem, ativo: 1 }));
    const pagos = lidos.itens.map((item, indice) => ({
      nome: item.nome, tipo: 'adicional' as const, preco_adicional: item.valor, insumo_id: item.insumo_id, ordem: removables.length + indice, ativo: 1,
    }));
    const nomes = new Set(pagos.map((item) => item.nome));
    const livres = editing.opcoes.filter((option) => option.tipo === 'adicional' && !option.insumo_id && !nomes.has(option.nome))
      .map((option, indice) => ({ nome: option.nome, tipo: 'adicional' as const, preco_adicional: option.preco_adicional, ordem: removables.length + pagos.length + indice, ativo: option.ativo ?? 1 }));
    const categoriaId = draft.categoriaId ? Number(draft.categoriaId) : null;
    const mudouCategoria = categoriaId !== (editing.cardapio_categoria_id ?? null);
    const ordem = mudouCategoria
      ? catalog.filter((item) => item.ativo !== 0 && item.id !== editing.id && (item.cardapio_categoria_id ?? null) === categoriaId).reduce((maximo, item) => Math.max(maximo, item.ordem), -1) + 1
      : editing.ordem;
    setSaving(true);
    try {
      const updated = await onlineApi.updateProduct(editing.id, {
        preco: price, descricao: draft.description, foto_url: draft.photoUrl || null, disponivel: draft.available ? 1 : 0,
        cardapio_categoria_id: categoriaId, ordem, opcoes: [...removables, ...pagos, ...livres],
      });
      setCatalog((current) => current.map((product) => product.id === updated.id ? updated : product));
      setEditing(null); setDraft(null);
      toast('success', 'Configuração salva no Cloudflare');
    } catch (error: any) {
      toast('error', error?.error || 'Não foi possível salvar a configuração');
    } finally {
      setSaving(false);
    }
  };

  const atualizarCardapio = async () => {
    const [onlineList, secoes] = await Promise.all([onlineApi.products(), onlineApi.menuCategories()]);
    setCatalog(onlineList);
    setMenuCategories(secoes);
  };

  const criarCategoria = async () => {
    const texto = categoriaNome.trim();
    if (texto.length < 2) return toast('error', 'Use um nome de categoria com pelo menos 2 letras');
    setSaving(true);
    try {
      setMenuCategories(await onlineApi.addMenuCategory(texto));
      setCategoriaNome('');
    } catch (error: any) {
      toast('error', error?.error || 'Não foi possível criar a categoria');
    } finally {
      setSaving(false);
    }
  };

  const moverCategoria = async (id: number, direcao: -1 | 1) => {
    const ordem = [...menuCategories].sort((a, b) => a.ordem - b.ordem || a.id - b.id);
    const indice = ordem.findIndex((categoria) => categoria.id === id);
    const destino = indice + direcao;
    if (indice < 0 || destino < 0 || destino >= ordem.length) return;
    const [item] = ordem.splice(indice, 1);
    ordem.splice(destino, 0, item);
    setSaving(true);
    try {
      const resposta = await onlineApi.organizeMenu({
        categorias: ordem.map((categoria, posicao) => ({ id: categoria.id, ordem: posicao })),
        produtos: [],
      });
      setMenuCategories(resposta.categorias);
      await atualizarCardapio();
    } catch (error: any) {
      toast('error', error?.error || 'Não foi possível organizar');
    } finally {
      setSaving(false);
    }
  };

  const apagarCategoria = async (id: number) => {
    setSaving(true);
    try {
      await onlineApi.removeMenuCategory(id);
      await atualizarCardapio();
    } catch (error: any) {
      toast('error', error?.error || 'Não foi possível apagar a categoria');
    } finally {
      setSaving(false);
    }
  };

  const aplicarCategoria = async (product: OnlineCatalogProduct, categoriaId: number | null) => {
    const grupo = catalog.filter((item) => item.ativo !== 0 && item.id !== product.id && (item.cardapio_categoria_id ?? null) === categoriaId);
    const ordem = grupo.reduce((maximo, item) => Math.max(maximo, item.ordem), -1) + 1;
    setSaving(true);
    try {
      await onlineApi.updateProduct(product.id, { cardapio_categoria_id: categoriaId, ordem });
      await atualizarCardapio();
    } catch (error: any) {
      toast('error', error?.error || 'Não foi possível aplicar a categoria');
    } finally {
      setSaving(false);
    }
  };

  const moverProduto = async (product: OnlineCatalogProduct, direcao: -1 | 1) => {
    const grupo = catalog.filter((item) => item.ativo !== 0)
      .filter((item) => (item.cardapio_categoria_id ?? null) === (product.cardapio_categoria_id ?? null))
      .sort((a, b) => a.ordem - b.ordem || a.id - b.id);
    const indice = grupo.findIndex((item) => item.id === product.id);
    const destino = indice + direcao;
    if (indice < 0 || destino < 0 || destino >= grupo.length) return;
    const ordem = [...grupo];
    const [item] = ordem.splice(indice, 1);
    ordem.splice(destino, 0, item);
    setSaving(true);
    try {
      await onlineApi.organizeMenu({
        categorias: [],
        produtos: ordem.map((atual, posicao) => ({ id: atual.id, cardapio_categoria_id: atual.cardapio_categoria_id ?? null, ordem: posicao })),
      });
      await atualizarCardapio();
    } catch (error: any) {
      toast('error', error?.error || 'Não foi possível organizar');
    } finally {
      setSaving(false);
    }
  };

  const removerProduto = async (product: OnlineCatalogProduct) => {
    setSaving(true);
    try {
      await onlineApi.removeProduct(product.id);
      if (editing?.id === product.id) { setEditing(null); setDraft(null); }
      await atualizarCardapio();
      toast('success', 'Produto removido do cardápio. Ele continua no estoque.');
    } catch (error: any) {
      toast('error', error?.error || 'Não foi possível remover do cardápio');
    } finally {
      setSaving(false);
    }
  };

  const activeProducts = catalog.filter((product) => product.ativo);
  const publicPath = store?.site_url || (store ? `/pedido/${store.slug}` : '/pedido');

  const conteudo = <>
    <div className="mb-5 flex flex-wrap items-center gap-3">
      {!embutido && <button type="button" onClick={() => navigate('/estoque?aba=delivery')} className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800" aria-label="Voltar para o estoque"><ArrowLeft className="h-4 w-4" /></button>}
      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-extrabold tracking-tight text-slate-800">Delivery</h1><Badge color="purple">Estoque</Badge></div><p className="mt-0.5 text-sm text-slate-500">Publique somente produtos que já estão cadastrados no estoque.</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="secondary" icon={<ExternalLink className="h-4 w-4" />} onClick={() => window.open('/pedido', '_blank', 'noopener,noreferrer')}>Ver o DoixP Delivery</Button><Button variant="secondary" icon={<ExternalLink className="h-4 w-4" />} onClick={() => window.open(publicPath, '_blank', 'noopener,noreferrer')}>Ver site</Button><Button variant="secondary" icon={<Settings2 className="h-4 w-4" />} onClick={() => window.open(`${publicPath}?configurar=1`, '_blank', 'noopener,noreferrer')}>Configurar no site</Button><Button icon={<Plus className="h-4 w-4" />} onClick={() => setChooseProduct(true)}>Adicionar do estoque</Button></div>
    </div>

    <Card className="mb-5 overflow-hidden border-brand-100 bg-gradient-to-r from-brand-50 via-white to-emerald-50 p-0"><div className="grid gap-4 p-5 sm:grid-cols-[1fr_auto] sm:items-center"><div className="flex gap-3"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-sm shadow-brand-600/30"><Store className="h-5 w-5" /></div><div><p className="text-sm font-bold text-slate-800">Cardápio conectado ao banco Cloudflare</p><p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">O preço e a descrição do site usam o produto do estoque. Cada pedido do site abre uma comanda de delivery.</p></div></div><div className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${store?.ativo ? 'border-emerald-200 bg-white/80 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}><CheckCircle2 className="h-4 w-4" />{store?.ativo ? 'Loja publicada' : 'Loja em rascunho'}</div></div></Card>

    <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><Tabs<Tab> tabs={[{ value: 'cardapio', label: 'Produtos do cardápio' }, { value: 'loja', label: 'Dados da loja' }]} value={tab} onChange={setTab} />{tab === 'cardapio' && <span className="text-xs font-semibold text-slate-500">{activeProducts.length} {activeProducts.length === 1 ? 'produto cadastrado' : 'produtos cadastrados'}</span>}</div>

    {tab === 'cardapio' ? <>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3"><Summary icon={<UtensilsCrossed className="h-4 w-4" />} label="No delivery" value={String(activeProducts.length)} hint="Produtos publicados ou pausados" color="brand" /><Summary icon={<Camera className="h-4 w-4" />} label="Com foto" value={String(activeProducts.filter((product) => product.foto_url).length)} hint="Importada da galeria" color="amber" /><Summary icon={<Link2 className="h-4 w-4" />} label="Link público" value={store?.ativo ? 'Publicado' : 'Rascunho'} hint={publicPath} color="emerald" /></div>
      <Card className="mb-4 space-y-3 p-5"><div><h2 className="font-bold text-slate-800">Categorias do cardápio</h2><p className="mt-1 text-sm text-slate-500">Crie as seções do delivery, aplique em cada produto e use Subir e Descer para organizar. Apagar a categoria deixa os itens no cardápio, sem essa seção. Remover tira o produto só do delivery.</p></div><div className="flex flex-wrap gap-2">{[...menuCategories].sort((a, b) => a.ordem - b.ordem || a.id - b.id).map((categoria, indice, lista) => <span key={categoria.id} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 py-1 pl-3 pr-1 text-xs font-bold text-slate-700">{categoria.nome}<Button type="button" size="sm" variant="ghost" disabled={saving || indice === 0} onClick={() => moverCategoria(categoria.id, -1)}>Subir</Button><Button type="button" size="sm" variant="ghost" disabled={saving || indice === lista.length - 1} onClick={() => moverCategoria(categoria.id, 1)}>Descer</Button><Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => apagarCategoria(categoria.id)}>Apagar</Button></span>)}{menuCategories.length === 0 && <span className="text-xs text-slate-400">Nenhuma categoria do cardápio ainda.</span>}</div><div className="flex flex-wrap gap-2"><Input value={categoriaNome} onChange={(event) => setCategoriaNome(event.target.value)} placeholder="Ex.: Lanches" maxLength={40} aria-label="Nome da categoria" /><Button type="button" loading={saving} onClick={criarCategoria}>Criar categoria</Button></div></Card>{loading ? <Card className="p-10 text-center text-sm text-slate-500">Carregando produtos…</Card> : activeProducts.length === 0 ? <Card className="p-5"><div className="flex flex-col items-center"><EmptyState icon={<UtensilsCrossed className="h-8 w-8" />} title="Nenhum produto no delivery" subtitle="Escolha um produto simples ou composto que já está no estoque." /><Button icon={<PackagePlus className="h-4 w-4" />} onClick={() => setChooseProduct(true)}>Adicionar produto</Button></div></Card> : <Card className="overflow-hidden p-0"><div className="hidden grid-cols-[52px_minmax(180px,1.3fr)_minmax(180px,.9fr)_110px_auto] gap-4 border-b border-slate-200 bg-slate-50 px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 md:grid"><span /><span>Produto</span><span>Categoria</span><span>Preço delivery</span><span /></div><div className="divide-y divide-slate-100">{activeProducts.map((product, index) => <div key={product.id} className="grid w-full grid-cols-[48px_1fr_auto] items-center gap-3 px-4 py-3 text-left md:grid-cols-[52px_minmax(180px,1.3fr)_minmax(180px,.9fr)_110px_auto] md:gap-4 md:px-5"><span className={`flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl text-lg ${product.foto_url ? 'bg-slate-100' : ['bg-amber-100', 'bg-rose-100', 'bg-emerald-100', 'bg-indigo-100'][index % 4]}`}>{product.foto_url ? <img className="h-full w-full object-cover" src={product.foto_url} alt="" /> : ['🍔', '🍟', '🥤', '🍗'][index % 4]}</span><span className="min-w-0"><b className="block truncate text-sm text-slate-800">{product.nome}</b><small className="mt-0.5 block truncate text-xs text-slate-500">{product.categoria_nome || 'Sem categoria'}</small><span className="mt-2 block md:hidden"><Select aria-label={`Categoria de ${product.nome}`} value={product.cardapio_categoria_id ? String(product.cardapio_categoria_id) : ''} disabled={saving} onChange={(event) => aplicarCategoria(product, event.target.value ? Number(event.target.value) : null)}><option value="">Sem categoria</option>{menuCategories.map((categoria) => <option key={categoria.id} value={categoria.id}>{categoria.nome}</option>)}</Select></span></span><span className="hidden md:block"><Select aria-label={`Categoria de ${product.nome}`} value={product.cardapio_categoria_id ? String(product.cardapio_categoria_id) : ''} disabled={saving} onChange={(event) => aplicarCategoria(product, event.target.value ? Number(event.target.value) : null)}><option value="">Sem categoria</option>{menuCategories.map((categoria) => <option key={categoria.id} value={categoria.id}>{categoria.nome}</option>)}</Select></span><span className="hidden text-sm font-bold text-slate-700 md:block">{product.preco == null ? '—' : fmtBRL(product.preco)}</span><span className="flex flex-wrap items-center justify-end gap-2"><Badge color={product.disponivel ? 'green' : 'slate'}>{product.disponivel ? 'Disponível' : 'Pausado'}</Badge><Button type="button" size="sm" variant="secondary" disabled={saving} onClick={() => moverProduto(product, -1)}>Subir</Button><Button type="button" size="sm" variant="secondary" disabled={saving} onClick={() => moverProduto(product, 1)}>Descer</Button><Button type="button" size="sm" variant="secondary" onClick={() => openEditor(product)} icon={<ChevronRight className="h-4 w-4" />}>Editar</Button><Button type="button" size="sm" variant="danger" disabled={saving} onClick={() => removerProduto(product)}>Remover</Button></span></div>)}</div></Card>}
    </> : <StoreSettings store={store} onSaved={(next) => setStore(next)} />}

    <Modal open={chooseProduct} onClose={() => setChooseProduct(false)} title="Adicionar do estoque"><div className="space-y-3"><p className="text-sm leading-relaxed text-slate-500">Só entram produtos simples ou compostos que já estão no estoque. Insumo não vai para o delivery.</p>{availableProducts.length > 0 ? <div className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">{availableProducts.map((product) => <button key={product.id} disabled={saving} type="button" onClick={() => addExisting(product)} className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-brand-50 disabled:opacity-50"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-100 text-brand-700"><Link2 className="h-4 w-4" /></span><span className="min-w-0 flex-1"><b className="block truncate text-sm text-slate-800">{product.nome}</b><small className="text-xs text-slate-500">{product.preco == null ? 'Sem preço base' : fmtBRL(product.preco)}</small></span><Plus className="h-4 w-4 text-brand-600" /></button>)}</div> : <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">Todos os produtos disponíveis já estão no cardápio.</p>}</div></Modal>

    <Modal open={!!editing && !!draft} onClose={() => { setEditing(null); setDraft(null); }} title="Configurar produto do delivery">{editing && draft && <form className="space-y-4" onSubmit={saveProduct}><div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3"><span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-amber-100 text-lg">{draft.photoUrl ? <img className="h-full w-full object-cover" src={draft.photoUrl} alt="" /> : '🍔'}</span><div className="min-w-0"><b className="block truncate text-sm text-slate-800">{editing.nome}</b><small className="text-xs text-slate-500">Produto do estoque · #{editing.produto_id}</small></div></div><Field label="Foto do produto" hint="Importe a foto da galeria. O cliente vê esta imagem no cardápio."><FotoGaleria value={draft.photoUrl} onChange={(photoUrl) => setDraft({ ...draft, photoUrl })} /></Field><div className="grid grid-cols-2 gap-3"><Field label="Preço no delivery"><Input inputMode="decimal" value={draft.price} onChange={(event) => setDraft({ ...draft, price: event.target.value })} placeholder="0,00" /></Field><Field label="Disponibilidade"><div className="flex h-[42px] items-center rounded-xl border border-slate-300 bg-white px-3"><Toggle checked={draft.available} onChange={(available) => setDraft({ ...draft, available })} label={draft.available ? 'Disponível' : 'Pausado'} /></div></Field></div><Field label="Categoria no cardápio" hint="A seção em que o cliente encontra este item. Sem categoria, ele fica no fim do cardápio."><Select value={draft.categoriaId} onChange={(event) => setDraft({ ...draft, categoriaId: event.target.value })}><option value="">Sem categoria</option>{menuCategories.map((categoria) => <option key={categoria.id} value={categoria.id}>{categoria.nome}</option>)}</Select></Field><AcrescimoCadastro linhas={draft.acrescimos} onChange={(acrescimos) => setDraft({ ...draft, acrescimos })} insumos={insumos.filter((item) => item.id !== editing.produto_id)} /><Field label="Descrição para o cliente" hint={products.find((item) => item.id === editing.produto_id)?.tipo === 'composto' ? 'Os ingredientes da ficha já estão escritos. Acrescente algo a mais se quiser.' : 'O cliente vê este texto no cardápio.'}><Textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} rows={3} placeholder="Conte o que vem neste item..." /></Field><Field label="Ingredientes removíveis" hint="Separe por vírgula. Para adicionais pagos, a próxima edição terá grupos e limites."><Textarea value={draft.ingredients} onChange={(event) => setDraft({ ...draft, ingredients: event.target.value })} rows={3} placeholder="Ex.: cebola, picles, molho..." /></Field><div className="flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-3"><Button type="button" variant="danger" disabled={saving} onClick={() => removerProduto(editing)}>Remover do cardápio</Button><div className="flex gap-2"><Button type="button" variant="secondary" onClick={() => { setEditing(null); setDraft(null); }}>Cancelar</Button><Button type="submit" loading={saving} icon={<Pencil className="h-4 w-4" />}>Salvar configuração</Button></div></div></form>}</Modal>
  </>;
  return embutido ? conteudo : <AnimatedPage>{conteudo}</AnimatedPage>;
}

function Summary({ icon, label, value, hint, color }: { icon: React.ReactNode; label: string; value: string; hint: string; color: 'brand' | 'amber' | 'emerald' }) {
  const colors = { brand: 'bg-brand-100 text-brand-700', amber: 'bg-amber-100 text-amber-700', emerald: 'bg-emerald-100 text-emerald-700' };
  return <Card className="flex items-center gap-3 p-4"><span className={`flex h-9 w-9 items-center justify-center rounded-xl ${colors[color]}`}>{icon}</span><span className="min-w-0"><small className="block text-[11px] font-semibold text-slate-500">{label}</small><b className="block text-base leading-tight text-slate-800">{value}</b><small className="block truncate text-[10px] text-slate-400">{hint}</small></span></Card>;
}

function CategoriasRede() {
  const toast = useToast();
  const [lista, setLista] = useState<CategoriaLoja[]>([]);
  const [nome, setNome] = useState('');
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => { onlineApi.categories().then(setLista).catch(() => setLista([])); }, []);
  const adicionar = async (valor: string) => {
    const texto = valor.trim();
    if (!texto) return;
    setOcupado(true);
    try { setLista(await onlineApi.addCategory(texto)); setNome(''); }
    catch (error: any) { toast('error', error?.error || 'Não foi possível criar a categoria'); }
    finally { setOcupado(false); }
  };
  return <Card className="space-y-4 p-5 lg:col-span-2"><div><h2 className="font-bold text-slate-800">Categoria no DoixP Delivery</h2><p className="mt-1 text-sm text-slate-500">O cliente procura hambúrgueres, pizzaria ou comida japonesa. A categoria surge quando esta loja cria o modelo dela e está publicada.</p></div><div className="flex flex-wrap gap-2">{lista.map((categoria) => <button key={categoria.id} type="button" disabled={ocupado} onClick={async () => { setOcupado(true); try { setLista(await onlineApi.removeCategory(categoria.id)); } catch (error: any) { toast('error', error?.error || 'Não foi possível remover'); } finally { setOcupado(false); } }} className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800">{categoria.nome} ×</button>)}{lista.length === 0 && <span className="text-xs text-slate-400">Nenhuma categoria criada para esta loja.</span>}</div><div className="flex flex-wrap gap-2"><Input value={nome} onChange={(event) => setNome(event.target.value)} placeholder="Ex.: Hambúrgueres" maxLength={40} /><Button type="button" loading={ocupado} onClick={() => adicionar(nome)}>Adicionar categoria</Button>{['Hambúrgueres', 'Pizzaria', 'Comida japonesa'].filter((item) => !lista.some((categoria) => categoria.nome.toLocaleLowerCase('pt-BR') === item.toLocaleLowerCase('pt-BR'))).map((item) => <Button key={item} type="button" variant="secondary" disabled={ocupado} onClick={() => adicionar(item)}>{item}</Button>)}</div></Card>;
}

function StoreSettings({ store, onSaved }: { store: OnlineStore | null; onSaved: (store: OnlineStore) => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ slug: '', nome: '', descricao: '', taxa: '0', valorKm: '', modo: 'cliente' as ModoEntrega, min: '', max: '', entrega: true, retirada: true, published: false, endereco: '', raio: '', latitude: null as number | null, longitude: null as number | null, pixChave: '', pixCidade: '' });
  const [saving, setSaving] = useState(false);
  const [lendoLocal, setLendoLocal] = useState(false);
  useEffect(() => {
    if (!store) return;
    setForm({
      slug: store.slug,
      nome: store.nome,
      descricao: store.descricao || '',
      taxa: String(store.taxa_entrega),
      valorKm: store.valor_por_km == null ? '' : String(store.valor_por_km).replace('.', ','),
      modo: store.modo_entrega === 'dividido' || store.modo_entrega === 'gratis' ? store.modo_entrega : 'cliente',
      min: store.tempo_min_entrega == null ? '' : String(store.tempo_min_entrega),
      max: store.tempo_max_entrega == null ? '' : String(store.tempo_max_entrega),
      entrega: !!store.aceita_entrega,
      retirada: !!store.aceita_retirada,
      published: !!store.ativo,
      endereco: store.endereco || '',
      raio: store.raio_entrega_km == null ? '' : String(store.raio_entrega_km).replace('.', ','),
      latitude: store.latitude ?? null,
      longitude: store.longitude ?? null,
      pixChave: store.pix_chave || '',
      pixCidade: store.pix_cidade || '',
    });
  }, [store]);
  const usarLocal = () => {
    if (!navigator.geolocation) return toast('error', 'Este aparelho não informa a localização.');
    setLendoLocal(true);
    navigator.geolocation.getCurrentPosition((posicao) => {
      setForm((atual) => ({ ...atual, latitude: posicao.coords.latitude, longitude: posicao.coords.longitude }));
      setLendoLocal(false);
      toast('success', 'Localização da loja pronta para salvar');
    }, () => {
      setLendoLocal(false);
      toast('error', 'Não foi possível ler a localização. Informe rua, número e cidade.');
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const valorTexto = form.valorKm.trim();
    const valorKm = valorTexto ? numberInput(valorTexto) : null;
    const taxa = numberInput(form.taxa);
    const min = form.min ? numberInput(form.min) : null;
    const max = form.max ? numberInput(form.max) : null;
    const raioTexto = form.raio.trim();
    const raio = raioTexto ? numberInput(raioTexto) : null;
    if (!form.nome.trim() || (!valorTexto && (!Number.isFinite(taxa) || taxa < 0)) || (min !== null && !Number.isFinite(min)) || (max !== null && !Number.isFinite(max))) return toast('error', 'Revise os dados da loja');
    if (valorTexto && (valorKm == null || !Number.isFinite(valorKm) || valorKm < 0 || valorKm > 1000)) return toast('error', 'O valor por km fica entre 0 e 1000');
    if (raioTexto && (raio == null || !Number.isFinite(raio) || raio < 0.1 || raio > 100)) return toast('error', 'O limite de entrega fica entre 0,1 e 100 km');
    setSaving(true);
    try {
      const next = await onlineApi.updateStore({
        slug: form.slug,
        nome: form.nome,
        descricao: form.descricao,
        taxa_entrega: valorTexto ? 0 : taxa,
        valor_por_km: valorTexto ? valorKm : null,
        modo_entrega: form.modo,
        tempo_min_entrega: min,
        tempo_max_entrega: max,
        aceita_entrega: form.entrega ? 1 : 0,
        aceita_retirada: form.retirada ? 1 : 0,
        ativo: form.published ? 1 : 0,
        endereco: form.endereco,
        latitude: form.latitude,
        longitude: form.longitude,
        raio_entrega_km: raio,
        pix_chave: form.pixChave.trim(),
        pix_cidade: form.pixCidade.trim(),
      });
      onSaved(next);
      toast('success', form.published ? 'Loja publicada' : 'Rascunho salvo');
    } catch (error: any) {
      toast('error', error?.error || 'Não foi possível salvar a loja');
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
      <CategoriasRede />
      <form onSubmit={save} className="contents">
        <Card className="space-y-5 p-5">
          <div><h2 className="font-bold text-slate-800">Identidade da loja</h2><p className="mt-1 text-sm text-slate-500">O cliente vê este nome e já entra no cardápio, com os mais vendidos e as categorias.</p></div>
          <Field label="Endereço público"><Input value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value.toLowerCase().replace(/\s+/g, '-') })} placeholder="minha-loja" /><p className="mt-1 text-[11px] text-slate-400">Seu link: /pedido/{form.slug || 'minha-loja'}</p></Field>
          <Field label="Nome exibido" hint="Outra loja não pode usar o mesmo nome. Maiúsculas e minúsculas contam como iguais."><Input value={form.nome} onChange={(event) => setForm((atual) => ({ ...atual, nome: event.target.value }))} maxLength={120} /></Field>
          <Field label="Descrição interna" hint="Não aparece na abertura do cardápio do cliente."><Textarea value={form.descricao} onChange={(event) => setForm({ ...form, descricao: event.target.value })} rows={3} /></Field>
          <Field label="Chave Pix" hint="CPF, CNPJ, e-mail, celular ou chave aleatória. O cliente paga direto esta chave. Deixe vazio para oferecer só dinheiro e maquininha."><Input value={form.pixChave} maxLength={77} onChange={(event) => setForm({ ...form, pixChave: event.target.value })} placeholder="chave@loja.com" /></Field>
          <Field label="Cidade do recebedor" hint="Entra no código Pix, com até 15 letras."><Input value={form.pixCidade} maxLength={40} onChange={(event) => setForm({ ...form, pixCidade: event.target.value })} placeholder="São Paulo" /></Field>
        </Card>
        <Card className="space-y-5 p-5">
          <div><h2 className="font-bold text-slate-800">Entrega e retirada</h2><p className="mt-1 text-sm text-slate-500">O limite é o máximo que esta loja entrega, como 3,5 km ou 10 km.</p></div>
          <Field label="Endereço da loja" hint="Rua, número e cidade. Ao alterar o texto, o ponto é localizado de novo ao salvar.">
            <Input value={form.endereco} onChange={(event) => setForm({ ...form, endereco: event.target.value, latitude: null, longitude: null })} placeholder="Rua, número e cidade" />
          </Field>
          <div className="flex flex-wrap gap-2">
            {[3.5, 5, 10].map((km) => <button key={km} type="button" onClick={() => setForm({ ...form, raio: String(km).replace('.', ',') })} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-700">{km.toLocaleString('pt-BR')} km</button>)}
          </div>
          <Field label="Limite máximo de entrega (km)"><Input value={form.raio} onChange={(event) => setForm({ ...form, raio: event.target.value })} inputMode="decimal" placeholder="10" /></Field>
          <Button type="button" variant="secondary" loading={lendoLocal} icon={<MapPin className="h-4 w-4" />} onClick={usarLocal}>Usar minha localização</Button>
          {form.latitude != null && form.longitude != null && <p className="text-xs text-slate-500">Ponto do aparelho definido. Ele vale até você alterar o endereço.</p>}
          <div className="flex flex-wrap gap-2" role="group" aria-label="Quem paga a entrega">
            {([['cliente', 'Cliente paga 100%'], ['dividido', 'Dividir'], ['gratis', 'Entrega grátis']] as const).map(([id, rotulo]) => (
              <button key={id} type="button" onClick={() => setForm({ ...form, modo: id })} className={`rounded-full border px-3 py-1 text-xs font-bold ${form.modo === id ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-200 bg-white text-slate-700'}`}>{rotulo}</button>
            ))}
          </div>
          <Field label="Valor por km" hint="A entrega usa este valor vezes a distância. A taxa fixa antiga só vale enquanto este campo estiver vazio.">
            <Input value={form.valorKm} onChange={(event) => setForm({ ...form, valorKm: event.target.value })} inputMode="decimal" placeholder="2,00" />
          </Field>
          <p className="text-xs text-slate-500">Exemplo: 7 km × R$ 2,00 = R$ 14,00. Dividido, o cliente paga R$ 7,00. Um produto de R$ 50,00 fica R$ 57,00.</p>
          {Number.isFinite(numberInput(form.valorKm)) && form.valorKm.trim() && <p className="text-xs text-slate-500">{previaEntrega(numberInput(form.valorKm), form.modo)}</p>}
          {!form.valorKm.trim() && Number.isFinite(numberInput(form.taxa)) && numberInput(form.taxa) > 0 && <p className="text-xs text-slate-500">Taxa fixa atual {fmtBRL(numberInput(form.taxa))}. Informe o valor por km para cobrar pela distância.</p>}
          <div className="grid grid-cols-2 gap-3"><Field label="Tempo mínimo (min)"><Input value={form.min} onChange={(event) => setForm({ ...form, min: event.target.value })} inputMode="numeric" /></Field><Field label="Tempo máximo (min)"><Input value={form.max} onChange={(event) => setForm({ ...form, max: event.target.value })} inputMode="numeric" /></Field></div>
          <div className="space-y-3 rounded-xl bg-slate-50 p-3"><Toggle checked={form.entrega} onChange={(entrega) => setForm({ ...form, entrega })} label="Aceitar entrega" /><Toggle checked={form.retirada} onChange={(retirada) => setForm({ ...form, retirada })} label="Aceitar retirada no balcão" /><Toggle checked={form.published} onChange={(published) => setForm({ ...form, published })} label="Publicar a loja para clientes" /></div>
          <div className="flex justify-end border-t border-slate-100 pt-3"><Button type="submit" loading={saving} icon={<Store className="h-4 w-4" />}>Salvar loja</Button></div>
        </Card>
      </form>
    </div>
  );
}
