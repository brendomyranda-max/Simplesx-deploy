/**
 * Site público de delivery.
 * O cliente só vê produtos publicados a partir do estoque.
 * Quem entra com o módulo Gestor da DoixP ganha a aba Configurar.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, ChevronRight, Flame, Heart, MapPin, Minus, Plus,
  Search, ShoppingBag, Settings2, Store, X, Check, Bike,
  CreditCard, UtensilsCrossed, PackagePlus,
} from 'lucide-react';
import { toDataURL } from 'qrcode';
import { fmtBRL } from '@/lib/format';
import { authApi, onlineApi, onlinePublicApi, produtoApi } from '@/lib/api';
import type { AreaEntrega, CategoriaCardapio, CategoriaLoja, ModoEntrega, OnlineCatalogProduct, OnlineStore, Produto } from '@/lib/types';
import { fmtKm, lerPontoCliente, previaEntrega, taxaDaSacola, textoCobrancaCliente, textoEntrega } from '@/lib/localizacao-cliente';
import { Marketplace } from '@/pages/Marketplace';
import { BrandLogo } from '@/components/BrandLogo';
import { FotoGaleria } from '@/components/FotoGaleria';
import { descricaoComIngredientes } from '@/lib/descricao-composto';
import { AcrescimoCadastro, lerAcrescimos, type LinhaAcrescimo } from '@/components/AcrescimoCadastro';
import './online-storefront.css';

type Product = {
  id: number;
  category: string;
  name: string;
  description: string;
  price: number;
  photo: string | null;
  available: boolean;
  ingredients: { id: number; name: string }[];
  additions: { id: number; name: string; price: number }[];
  sold: number;
};

type CartItem = {
  key: string;
  product: Product;
  quantity: number;
  removed: string[];
  additions: string[];
  note: string;
};

type Aba = 'cardapio' | 'configurar';

const addOnPrice = (item: CartItem) => item.additions.reduce((total, name) => total + (item.product.additions.find((add) => add.name === name)?.price || 0), 0);

function paraCardapio(produto: OnlineCatalogProduct): Product {
  const preco = Number(produto.preco);
  return {
    id: produto.id,
    category: produto.categoria_nome || 'Outros',
    name: produto.nome,
    description: produto.descricao || '',
    price: Number.isFinite(preco) ? preco : 0,
    photo: produto.foto_url,
    available: produto.disponivel === 1 && produto.ativo !== 0,
    ingredients: produto.opcoes.filter((opcao) => opcao.tipo === 'removivel').map((opcao) => ({ id: opcao.id, name: opcao.nome })),
    additions: produto.opcoes.filter((opcao) => opcao.tipo === 'adicional').map((opcao) => ({ id: opcao.id, name: opcao.nome, price: opcao.preco_adicional })),
    sold: Math.max(0, Number(produto.vendidos) || 0),
  };
}

function idCategoria(nome: string, indice: number) {
  const base = nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `secao-cat-${indice}-${base || 'categoria'}`;
}

function marca(nome: string) {
  const texto = nome.trim() || 'Delivery';
  const partes = texto.split(/\s*&\s*|\s+\be\b\s+/i);
  if (partes.length === 2 && partes[0] && partes[1]) {
    return <>{partes[0].toLocaleLowerCase('pt-BR')}<span>&amp;</span>{partes[1].toLocaleLowerCase('pt-BR')}</>;
  }
  return <>{texto}</>;
}

function tempoEntrega(loja: OnlineStore) {
  if (loja.tempo_min_entrega == null && loja.tempo_max_entrega == null) return null;
  if (loja.tempo_min_entrega != null && loja.tempo_max_entrega != null) return `${loja.tempo_min_entrega}–${loja.tempo_max_entrega} min`;
  return `${loja.tempo_min_entrega ?? loja.tempo_max_entrega} min`;
}

function valorMonetario(texto: string) {
  const limpo = texto.replace(/[^0-9,.-]/g, '');
  const normalizado = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo;
  const valor = Number(normalizado);
  return Number.isFinite(valor) ? valor : null;
}

export function OnlineStorefront() {
  const { chave, slug } = useParams();
  if (chave) return <AcompanharPedido />;
  if (!slug) return <Marketplace />;
  return <LojaOnline />;
}

function LojaOnline() {
  const { slug: slugRota } = useParams();
  const [params] = useSearchParams();
  const configurarNaUrl = params.get('configurar') === '1';
  const navigate = useNavigate();
  const [loja, setLoja] = useState<OnlineStore | null>(null);
  const [catalogo, setCatalogo] = useState<OnlineCatalogProduct[]>([]);
  const [estoque, setEstoque] = useState<Produto[]>([]);
  const [categoriasCardapio, setCategoriasCardapio] = useState<CategoriaCardapio[]>([]);
  const [podeConfigurar, setPodeConfigurar] = useState(false);
  const [aba, setAba] = useState<Aba>(configurarNaUrl ? 'configurar' : 'cardapio');
  const [estado, setEstado] = useState<'carregando' | 'pronto' | 'vazio' | 'erro'>('carregando');
  const [mensagem, setMensagem] = useState('');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customizing, setCustomizing] = useState<Product | null>(null);
  const [configurando, setConfigurando] = useState<OnlineCatalogProduct | null>(null);
  const [estoqueAberto, setEstoqueAberto] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  useEffect(() => {
    let ativo = true;
    setEstado('carregando');
    (async () => {
      let gestor = false;
      try {
        const sessao = await authApi.me();
        gestor = Array.isArray(sessao.modulos) && sessao.modulos.includes('gestor');
      } catch {
        gestor = false;
      }
      let lojaAdmin: OnlineStore | null = null;
      let produtosAdmin: OnlineCatalogProduct[] = [];
      let produtosEstoque: Produto[] = [];
      let secoes: CategoriaCardapio[] = [];
      if (gestor) {
        try {
          [lojaAdmin, produtosAdmin, produtosEstoque, secoes] = await Promise.all([
            onlineApi.store(),
            onlineApi.products(),
            produtoApi.list(),
            onlineApi.menuCategories(),
          ]);
        } catch {
          lojaAdmin = null;
        }
      }
      if (!ativo) return;
      const dono = Boolean(gestor && lojaAdmin && slugRota === lojaAdmin.slug);
      if (dono && lojaAdmin) {
        setPodeConfigurar(true);
        setLoja(lojaAdmin);
        setCatalogo(produtosAdmin.filter((produto) => produto.ativo !== 0));
        setCategoriasCardapio(secoes);
        setEstoque(produtosEstoque.filter((produto) => produto.ativo && (produto.tipo === 'produto' || produto.tipo === 'composto')));
        setAba(configurarNaUrl ? 'configurar' : 'cardapio');
        setEstado('pronto');
        return;
      }
      setPodeConfigurar(false);
      setCategoriasCardapio([]);
      setAba('cardapio');
      if (!slugRota) {
        setEstado('vazio');
        return;
      }
      try {
        const ponto = lerPontoCliente();
        const publico = await onlinePublicApi.store(slugRota, ponto ? { lat: ponto.latitude, lng: ponto.longitude } : undefined);
        if (!ativo) return;
        setLoja(publico.loja);
        setCatalogo(publico.produtos);
        setEstado('pronto');
      } catch (error: any) {
        if (!ativo) return;
        setMensagem(error?.error || 'Esta loja não está disponível.');
        setEstado('erro');
      }
    })();
    return () => { ativo = false; };
  }, [slugRota, navigate, configurarNaUrl]);

  const visiveis = useMemo(() => catalogo
    .filter((produto) => aba === 'configurar' || (produto.preco != null && produto.disponivel === 1 && produto.ativo !== 0))
    .map(paraCardapio), [catalogo, aba]);

  const cartCount = cart.reduce((total, item) => total + item.quantity, 0);
  const subtotal = cart.reduce((total, item) => total + (item.product.price + addOnPrice(item)) * item.quantity, 0);
  const taxaSacola = taxaDaSacola(loja);

  const addToCart = (item: Omit<CartItem, 'key' | 'quantity'>, quantity = 1) => {
    setCart((current) => {
      const found = current.find((cartItem) =>
        cartItem.product.id === item.product.id &&
        cartItem.removed.join('|') === item.removed.join('|') &&
        cartItem.additions.join('|') === item.additions.join('|') &&
        cartItem.note === item.note,
      );
      if (found) return current.map((cartItem) => cartItem.key === found.key ? { ...cartItem, quantity: cartItem.quantity + quantity } : cartItem);
      return [...current, { ...item, quantity, key: `${item.product.id}-${Date.now()}` }];
    });
    setCustomizing(null);
    setCartOpen(true);
  };

  const changeQuantity = (key: string, delta: number) => {
    setCart((current) => current.flatMap((item) => {
      if (item.key !== key) return [item];
      const quantity = item.quantity + delta;
      return quantity > 0 ? [{ ...item, quantity }] : [];
    }));
  };

  const recarregarDono = async () => {
    const [lojaAdmin, produtosAdmin, produtosEstoque, secoes] = await Promise.all([
      onlineApi.store(), onlineApi.products(), produtoApi.list(), onlineApi.menuCategories(),
    ]);
    setLoja(lojaAdmin);
    setCatalogo(produtosAdmin.filter((produto) => produto.ativo !== 0));
    setCategoriasCardapio(secoes);
    setEstoque(produtosEstoque.filter((produto) => produto.ativo && (produto.tipo === 'produto' || produto.tipo === 'composto')));
  };

  const publicarDoEstoque = async (produto: Produto) => {
    const acrescimos = (produto.acrescimos || []).map((item, ordem) => ({
      nome: item.insumo_nome || 'Acréscimo',
      tipo: 'adicional' as const,
      preco_adicional: item.valor,
      insumo_id: item.insumo_id,
      ordem,
      ativo: 1,
    }));
    const publicado = await onlineApi.addProduct({
      produto_id: produto.id,
      preco: produto.preco,
      descricao: produto.tipo === 'composto'
        ? descricaoComIngredientes((produto.ficha || []).map((item) => item.insumo_nome || ''), produto.observacoes || '')
        : (produto.observacoes || ''),
      foto_url: null,
      disponivel: 1,
      ativo: 1,
      ...(acrescimos.length ? { opcoes: acrescimos } : {}),
    });
    await recarregarDono();
    setEstoqueAberto(false);
    setConfigurando(publicado);
  };

  const alternarPausa = async (produto: OnlineCatalogProduct) => {
    const atualizado = await onlineApi.updateProduct(produto.id, { disponivel: produto.disponivel === 1 ? 0 : 1 });
    setCatalogo((atual) => atual.map((item) => item.id === atualizado.id ? { ...atualizado, vendidos: atualizado.vendidos ?? item.vendidos } : item));
  };

  const alternarPublicacao = async () => {
    if (!loja) return;
    const proxima = await onlineApi.updateStore({ ativo: loja.ativo ? 0 : 1 });
    setLoja(proxima);
  };

  const aplicarCategoria = async (produto: OnlineCatalogProduct, categoriaId: number | null) => {
    const grupo = catalogo.filter((item) => (item.cardapio_categoria_id ?? null) === categoriaId && item.id !== produto.id);
    const ordem = grupo.reduce((maximo, item) => Math.max(maximo, item.ordem), -1) + 1;
    await onlineApi.updateProduct(produto.id, { cardapio_categoria_id: categoriaId, ordem });
    await recarregarDono();
  };

  const moverProduto = async (produto: OnlineCatalogProduct, direcao: -1 | 1) => {
    const grupo = catalogo
      .filter((item) => (item.cardapio_categoria_id ?? null) === (produto.cardapio_categoria_id ?? null))
      .sort((a, b) => a.ordem - b.ordem || a.id - b.id);
    const indice = grupo.findIndex((item) => item.id === produto.id);
    const destino = indice + direcao;
    if (indice < 0 || destino < 0 || destino >= grupo.length) return;
    const ordem = [...grupo];
    const [item] = ordem.splice(indice, 1);
    ordem.splice(destino, 0, item);
    await onlineApi.organizeMenu({
      categorias: [],
      produtos: ordem.map((atual, posicao) => ({ id: atual.id, cardapio_categoria_id: atual.cardapio_categoria_id ?? null, ordem: posicao })),
    });
    await recarregarDono();
  };

  const apagarCategoria = async (id: number) => {
    await onlineApi.removeMenuCategory(id);
    await recarregarDono();
  };

  const moverCategoria = async (id: number, direcao: -1 | 1) => {
    const ordem = [...categoriasCardapio].sort((a, b) => a.ordem - b.ordem || a.id - b.id);
    const indice = ordem.findIndex((categoria) => categoria.id === id);
    const destino = indice + direcao;
    if (indice < 0 || destino < 0 || destino >= ordem.length) return;
    const [item] = ordem.splice(indice, 1);
    ordem.splice(destino, 0, item);
    const resposta = await onlineApi.organizeMenu({
      categorias: ordem.map((categoria, posicao) => ({ id: categoria.id, ordem: posicao })),
      produtos: [],
    });
    setCategoriasCardapio(resposta.categorias);
    await recarregarDono();
  };

  const removerDoCardapio = async (produto: OnlineCatalogProduct) => {
    await onlineApi.removeProduct(produto.id);
    setConfigurando((atual) => atual?.id === produto.id ? null : atual);
    await recarregarDono();
  };

  const salvarConfiguracao = async (produto: OnlineCatalogProduct, draft: { preco: string; descricao: string; ingredientes: string; foto: string; disponivel: boolean; acrescimos: LinhaAcrescimo[]; categoriaId: number | null }) => {
    const preco = Number(draft.preco.replace(',', '.'));
    if (!Number.isFinite(preco) || preco < 0) throw new Error('Informe o preço do delivery');
    const lidos = lerAcrescimos(draft.acrescimos, draft.acrescimos.map((linha) => ({ id: Number(linha.insumo_id), nome: linha.nome || '', preco: linha.preco })));
    if (lidos.erro) throw new Error(lidos.erro);
    const removiveis = [...new Set(draft.ingredientes.split(',').map((item) => item.trim()).filter(Boolean))]
      .map((nome, ordem) => ({ nome, tipo: 'removivel' as const, preco_adicional: 0, ordem, ativo: 1 }));
    const pagos = lidos.itens.map((item, indice) => ({
      nome: item.nome, tipo: 'adicional' as const, preco_adicional: item.valor, insumo_id: item.insumo_id, ordem: removiveis.length + indice, ativo: 1,
    }));
    const nomes = new Set(pagos.map((item) => item.nome));
    const livres = produto.opcoes.filter((opcao) => opcao.tipo === 'adicional' && !opcao.insumo_id && !nomes.has(opcao.nome))
      .map((opcao, indice) => ({ nome: opcao.nome, tipo: 'adicional' as const, preco_adicional: opcao.preco_adicional, ordem: removiveis.length + pagos.length + indice, ativo: opcao.ativo ?? 1 }));
    const opcoes = [...removiveis, ...pagos, ...livres];
    const mudouCategoria = (draft.categoriaId ?? null) !== (produto.cardapio_categoria_id ?? null);
    const ordem = mudouCategoria
      ? catalogo.filter((item) => item.id !== produto.id && (item.cardapio_categoria_id ?? null) === draft.categoriaId).reduce((maximo, item) => Math.max(maximo, item.ordem), -1) + 1
      : produto.ordem;
    const atualizado = await onlineApi.updateProduct(produto.id, {
      preco, descricao: draft.descricao, foto_url: draft.foto || null, disponivel: draft.disponivel ? 1 : 0,
      cardapio_categoria_id: draft.categoriaId, ordem, opcoes,
    });
    setCatalogo((atual) => atual.map((item) => item.id === atualizado.id ? { ...atualizado, vendidos: atualizado.vendidos ?? item.vendidos } : item));
    await recarregarDono();
    setConfigurando(null);
  };

  const enviarPedido = async (dados: { nome: string; telefone: string; entrega: 'entrega' | 'retirada'; endereco: string; pagamento: 'dinheiro' | 'maquininha'; valorEmDinheiro: number | null }) => {
    if (!loja?.slug) throw new Error('Loja indisponível');
    const chave = `web${crypto.randomUUID().replace(/-/g, '')}`;
    await onlinePublicApi.order(loja.slug, {
      chave,
      cliente_nome: dados.nome,
      telefone: dados.telefone,
      tipo_entrega: dados.entrega,
      endereco: dados.endereco,
      forma_pagamento: dados.pagamento,
      troco_para: dados.valorEmDinheiro,
      itens: cart.map((item) => ({
        cardapio_produto_id: item.product.id,
        quantidade: item.quantity,
        opcoes_ids: [
          ...item.product.ingredients.filter((ingrediente) => item.removed.includes(ingrediente.name)).map((ingrediente) => ingrediente.id),
          ...item.product.additions.filter((adicional) => item.additions.includes(adicional.name)).map((adicional) => adicional.id),
        ],
        observacao: item.note,
      })),
    });
    setCart([]);
    setCheckoutOpen(false);
    navigate(`/pedido/${loja.slug}/acompanhar/${chave}`);
  };

  const prazo = loja ? tempoEntrega(loja) : null;
  const configurandoAgora = podeConfigurar && aba === 'configurar';
  const resumoLoja = loja ? [
    loja.ativo ? 'Aceitando pedidos' : 'Cardápio do estabelecimento',
    prazo,
    loja.aceita_entrega ? textoEntrega(loja) : 'Retirada no balcão',
    loja.distancia_km != null ? `a ${fmtKm(loja.distancia_km)} de você` : '',
  ].filter(Boolean).join(' · ') : '';
  const pontoCliente = lerPontoCliente();
  const enderecoTopo = pontoCliente?.endereco
    ? (pontoCliente.endereco.length > 42 ? `${pontoCliente.endereco.slice(0, 42)}…` : pontoCliente.endereco)
    : '';

  return (
    <div className="online-storefront min-h-viewport">
      <header className="online-topbar">
        <Link className="online-brand" to="/pedido" aria-label="Voltar para o DoixP Delivery">
          {!loja?.nome && <span className="online-brand-mark"><BrandLogo aria-hidden="true" alt="" /></span>}
          <span>{loja?.nome || 'DoixP Delivery'}</span>
        </Link>
        <Link className="online-market-back" to="/pedido">Todas as lojas</Link>
        <div className="online-address"><MapPin aria-hidden="true" /><span>Entregar em</span><b>{enderecoTopo || (loja?.aceita_entrega ? 'Informar no pedido' : 'Retirada no balcão')}</b><ChevronRight aria-hidden="true" /></div>
        {aba === 'cardapio' && <button className="online-cart-trigger" type="button" onClick={() => setCartOpen(true)} aria-label={`Abrir sacola, ${cartCount} itens`}>
          <ShoppingBag aria-hidden="true" /><span>Sacola</span>{cartCount > 0 && <em>{cartCount}</em>}
        </button>}
      </header>

      <main id="inicio" className="online-main">
        <section className={`online-menu-section${configurandoAgora ? '' : ' online-menu-direto'}`} aria-labelledby="menu-title">
          {podeConfigurar && (
            <div className="online-config-switch" role="tablist" aria-label="Modo do delivery">
              <button type="button" className={aba === 'cardapio' ? 'active' : ''} onClick={() => setAba('cardapio')}>Cardápio</button>
              <button type="button" className={aba === 'configurar' ? 'active' : ''} onClick={() => setAba('configurar')}>Configurar</button>
            </div>
          )}
          {configurandoAgora ? (
            <div className="online-section-heading">
              <div>
                <p>SÓ QUEM TEM O GESTOR</p>
                <h2 id="menu-title">Configurar delivery</h2>
              </div>
              <label className="online-search"><Search aria-hidden="true" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar no cardápio" /></label>
            </div>
          ) : (
            <header className="online-loja-cabecalho">
              <div>
                <h1 id="menu-title">{loja?.nome || 'Delivery'}</h1>
                {resumoLoja && <p className="online-loja-resumo">{resumoLoja}</p>}
              </div>
              <label className="online-search"><Search aria-hidden="true" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar no cardápio" /></label>
            </header>
          )}
          {configurandoAgora && <p className="online-config-note">O cliente vê o nome da loja, os mais vendidos e todas as categorias. Publique só item do estoque que estiver disponível.</p>}
          {configurandoAgora && <CategoriasDaLoja onChange={(nomes) => setLoja((atual) => atual ? { ...atual, segmentos: nomes } : atual)} />}
          {configurandoAgora && loja && <NomeDaLoja loja={loja} onSaved={setLoja} />}
          {configurandoAgora && loja && <AreaDaLoja loja={loja} onSaved={setLoja} />}
          {estado === 'carregando' && <div className="online-empty"><b>Carregando o cardápio…</b></div>}
          {estado === 'vazio' && <div className="online-empty"><Store /><b>Abra o link da loja</b><span>O cliente entra pelo endereço publicado pelo estabelecimento.</span></div>}
          {estado === 'erro' && <div className="online-empty"><Store /><b>Loja indisponível</b><span>{mensagem}</span></div>}
          {estado === 'pronto' && (configurandoAgora ? (
            <>
              <CategoriasDoCardapio
                categorias={categoriasCardapio}
                onChange={setCategoriasCardapio}
                onMover={moverCategoria}
                onApagar={apagarCategoria}
                onAtualizar={recarregarDono}
              />
              <GestorCardapio
                produtos={catalogo.filter((produto) => !search.trim() || produto.nome.toLocaleLowerCase('pt-BR').includes(search.trim().toLocaleLowerCase('pt-BR')))}
                categorias={categoriasCardapio}
                buscando={Boolean(search.trim())}
                lojaAberta={loja?.ativo === 1}
                onPublicarLoja={alternarPublicacao}
                onAdicionar={() => setEstoqueAberto(true)}
                onEditar={setConfigurando}
                onPausar={alternarPausa}
                onRemover={removerDoCardapio}
                onMover={moverProduto}
                onAplicar={aplicarCategoria}
              />
            </>
          ) : (
            <CardapioRolavel produtos={visiveis} busca={search} onSelect={setCustomizing} />
          ))}
        </section>

        <section className="online-benefits">
          <div><Bike /><span><b>Entrega</b><small>{loja?.aceita_entrega ? (loja.raio_entrega_km != null ? `Até ${fmtKm(loja.raio_entrega_km)} do estabelecimento.` : 'No endereço informado no pedido.') : 'Esta loja não está aceitando entrega.'}</small></span></div>
          <div><CreditCard /><span><b>Pagamento</b><small>Dinheiro ou maquininha na entrega ou retirada.</small></span></div>
          <div><Heart /><span><b>Cardápio real</b><small>Só entra o que foi cadastrado no estoque.</small></span></div>
        </section>
      </main>

      <footer className="online-footer"><span className="online-brand">{loja?.nome || 'DoixP Delivery'}</span><p>Seu pedido, do seu jeito.</p><small>Uma experiência de pedidos com DoixP</small></footer>

      {aba === 'cardapio' && cartCount > 0 && <button className="online-mobile-cart" type="button" onClick={() => setCartOpen(true)}><ShoppingBag /><span><b>Ver sacola</b><small>{cartCount} {cartCount === 1 ? 'item' : 'itens'}</small></span><strong>{fmtBRL(subtotal)}</strong></button>}
      {customizing && <ProductCustomizer product={customizing} onClose={() => setCustomizing(null)} onAdd={addToCart} />}
      {configurando && <ConfigurarProduto produto={configurando} categorias={categoriasCardapio} composto={estoque.some((item) => item.id === configurando.produto_id && item.tipo === 'composto')} onClose={() => setConfigurando(null)} onSave={salvarConfiguracao} onRemover={removerDoCardapio} />}
      {estoqueAberto && <EstoquePicker produtos={estoque.filter((produto) => !catalogo.some((item) => item.produto_id === produto.id))} onClose={() => setEstoqueAberto(false)} onPick={publicarDoEstoque} />}
      {cartOpen && <CartDrawer cart={cart} subtotal={subtotal} deliveryFee={taxaSacola} onClose={() => setCartOpen(false)} onChange={changeQuantity} onCheckout={() => { setCartOpen(false); setCheckoutOpen(true); }} />}
      {checkoutOpen && loja && <CheckoutModal loja={loja} totalBase={subtotal} onClose={() => setCheckoutOpen(false)} onSubmit={enviarPedido} />}
    </div>
  );
}

function FotoProduto({ product, grande = false }: { product: Product; grande?: boolean }) {
  const classe = grande ? 'online-customizer-image' : 'online-product-image';
  return <div className={`${classe} ${product.photo ? 'tem-foto' : 'burger'}`}>{product.photo ? <img src={product.photo} alt="" /> : <span aria-hidden="true">🍽️</span>}{!product.available && <b>Pausado</b>}</div>;
}

const SUGESTOES = ['Hambúrgueres', 'Pizzaria', 'Comida japonesa'];

function CategoriasDaLoja({ onChange }: { onChange: (nomes: string[]) => void }) {
  const [lista, setLista] = useState<CategoriaLoja[]>([]);
  const [nome, setNome] = useState('');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const avisar = useRef(onChange);
  avisar.current = onChange;

  useEffect(() => {
    onlineApi.categories().then((categorias) => {
      setLista(categorias);
      avisar.current(categorias.map((categoria) => categoria.nome));
    }).catch((error: any) => setErro(error?.error || 'Não foi possível carregar as categorias'));
  }, []);

  const aplicar = async (valor: string) => {
    const texto = valor.trim();
    if (!texto) return;
    setOcupado(true);
    setErro('');
    try {
      const proximas = await onlineApi.addCategory(texto);
      setLista(proximas);
      onChange(proximas.map((categoria) => categoria.nome));
      setNome('');
    } catch (error: any) {
      setErro(error?.error || 'Não foi possível criar a categoria');
    } finally {
      setOcupado(false);
    }
  };

  const remover = async (id: number) => {
    setOcupado(true);
    setErro('');
    try {
      const proximas = await onlineApi.removeCategory(id);
      setLista(proximas);
      onChange(proximas.map((categoria) => categoria.nome));
    } catch (error: any) {
      setErro(error?.error || 'Não foi possível remover a categoria');
    } finally {
      setOcupado(false);
    }
  };

  return (
    <form className="online-category-box" onSubmit={(event) => { event.preventDefault(); aplicar(nome); }}>
      <div>
        <p className="online-eyebrow">CATEGORIA DA LOJA</p>
        <h3>Como o cliente encontra você</h3>
        <p>Crie o modelo desta loja. A categoria só aparece no DoixP Delivery depois que você publica.</p>
      </div>
      <div className="online-market-tags">
        {lista.map((categoria) => <button key={categoria.id} type="button" disabled={ocupado} onClick={() => remover(categoria.id)}>{categoria.nome} ×</button>)}
        {lista.length === 0 && <span>Nenhuma categoria ainda</span>}
      </div>
      <div className="online-category-add">
        <input value={nome} onChange={(event) => setNome(event.target.value)} placeholder="Ex.: Hambúrgueres" maxLength={40} />
        <button type="submit" disabled={ocupado}>Adicionar</button>
      </div>
      <div className="online-category-suggestions">
        {SUGESTOES.filter((item) => !lista.some((categoria) => categoria.nome.toLocaleLowerCase('pt-BR') === item.toLocaleLowerCase('pt-BR'))).map((item) => (
          <button key={item} type="button" disabled={ocupado} onClick={() => aplicar(item)}>{item}</button>
        ))}
      </div>
      {erro && <p className="online-erro">{erro}</p>}
    </form>
  );
}

function CategoriasDoCardapio({
  categorias, onChange, onMover, onApagar, onAtualizar,
}: {
  categorias: CategoriaCardapio[];
  onChange: (categorias: CategoriaCardapio[]) => void;
  onMover: (id: number, direcao: -1 | 1) => Promise<void>;
  onApagar: (id: number) => Promise<void>;
  onAtualizar: () => Promise<void>;
}) {
  const [nome, setNome] = useState('');
  const [rascunhos, setRascunhos] = useState<Record<number, string>>({});
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const ordem = [...categorias].sort((a, b) => a.ordem - b.ordem || a.id - b.id);
  const executar = async (acao: () => Promise<void>) => {
    setOcupado(true);
    setErro('');
    try { await acao(); }
    catch (error: any) { setErro(error?.error || error?.message || 'Não foi possível salvar'); }
    finally { setOcupado(false); }
  };
  const criar = () => executar(async () => {
    const texto = nome.trim();
    if (texto.length < 2) throw new Error('Use um nome de categoria com pelo menos 2 letras');
    onChange(await onlineApi.addMenuCategory(texto));
    setNome('');
  });
  return <form className="online-cardapio-org" onSubmit={(event) => { event.preventDefault(); criar(); }}>
    <p className="online-eyebrow">CARDÁPIO</p>
    <h3>Categorias do cardápio</h3>
    <p>Crie as seções que o cliente percorre, como Lanches e Bebidas. A ordem daqui é a ordem do cardápio. Isso não muda a categoria do DoixP Delivery.</p>
    <div className="online-cardapio-linha">
      <input value={nome} maxLength={40} onChange={(event) => setNome(event.target.value)} placeholder="Ex.: Lanches" aria-label="Nome da categoria" />
      <button type="submit" disabled={ocupado}>Criar categoria</button>
    </div>
    {ordem.map((categoria, indice) => <div key={categoria.id} className="online-cardapio-cat">
      <input
        value={rascunhos[categoria.id] ?? categoria.nome}
        maxLength={40}
        aria-label={`Nome da categoria ${categoria.nome}`}
        disabled={ocupado}
        onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault(); }}
        onChange={(event) => setRascunhos((atual) => ({ ...atual, [categoria.id]: event.target.value }))}
        onBlur={(event) => {
          const texto = event.target.value.trim();
          setRascunhos((atual) => {
            const proximo = { ...atual };
            delete proximo[categoria.id];
            return proximo;
          });
          if (!texto || texto === categoria.nome) return;
          executar(async () => {
            await onlineApi.updateMenuCategory(categoria.id, { nome: texto });
            await onAtualizar();
          });
        }}
      />
      <div className="online-gestor-actions">
        <button type="button" disabled={ocupado || indice === 0} onClick={() => executar(() => onMover(categoria.id, -1))}>Subir</button>
        <button type="button" disabled={ocupado || indice === ordem.length - 1} onClick={() => executar(() => onMover(categoria.id, 1))}>Descer</button>
        <button type="button" className="remover" disabled={ocupado} onClick={() => executar(() => onApagar(categoria.id))}>Apagar</button>
      </div>
    </div>)}
    {ordem.length === 0 && <span>Nenhuma categoria do cardápio ainda. Os itens ficam em Sem categoria até você aplicar uma.</span>}
    {erro && <p className="online-erro">{erro}</p>}
  </form>;
}

function gruposDoCardapio(produtos: OnlineCatalogProduct[], categorias: CategoriaCardapio[], mostrarVazias: boolean) {
  const ordem = [...categorias].sort((a, b) => a.ordem - b.ordem || a.id - b.id);
  const grupos = ordem.map((categoria) => ({
    chave: `c-${categoria.id}`,
    id: categoria.id,
    nome: categoria.nome,
    itens: [] as OnlineCatalogProduct[],
  }));
  const porId = new Map(grupos.map((grupo) => [grupo.id, grupo]));
  const semCategoria: OnlineCatalogProduct[] = [];
  for (const produto of produtos) {
    const grupo = produto.cardapio_categoria_id ? porId.get(produto.cardapio_categoria_id) : undefined;
    if (grupo) grupo.itens.push(produto);
    else semCategoria.push(produto);
  }
  const visiveis = mostrarVazias ? grupos : grupos.filter((grupo) => grupo.itens.length);
  if (semCategoria.length) visiveis.push({ chave: 'sem', id: 0, nome: 'Sem categoria', itens: semCategoria });
  return visiveis;
}

function GestorCardapio({
  produtos, categorias, buscando, lojaAberta, onPublicarLoja, onAdicionar, onEditar, onPausar, onRemover, onMover, onAplicar,
}: {
  produtos: OnlineCatalogProduct[];
  categorias: CategoriaCardapio[];
  buscando: boolean;
  lojaAberta: boolean;
  onPublicarLoja: () => Promise<void>;
  onAdicionar: () => void;
  onEditar: (produto: OnlineCatalogProduct) => void;
  onPausar: (produto: OnlineCatalogProduct) => Promise<void>;
  onRemover: (produto: OnlineCatalogProduct) => Promise<void>;
  onMover: (produto: OnlineCatalogProduct, direcao: -1 | 1) => Promise<void>;
  onAplicar: (produto: OnlineCatalogProduct, categoriaId: number | null) => Promise<void>;
}) {
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const grupos = gruposDoCardapio(produtos, categorias, !buscando);
  const executar = async (acao: () => Promise<void>) => {
    setOcupado(true);
    setErro('');
    try { await acao(); }
    catch (error: any) { setErro(error?.error || error?.message || 'Não foi possível salvar'); }
    finally { setOcupado(false); }
  };
  return <div>
    <div className="online-gestor-toolbar">
      <button className="online-photo-btn" type="button" onClick={onAdicionar}><PackagePlus /> Adicionar item do estoque</button>
      <button className="online-photo-btn claro" type="button" disabled={ocupado} onClick={() => executar(onPublicarLoja)}>{lojaAberta ? 'Pausar loja' : 'Publicar loja para o cliente'}</button>
    </div>
    {!lojaAberta && <p className="online-config-note">A loja está em rascunho. Publique para o cliente deixar de ver a loja como indisponível.</p>}
    {erro && <p className="online-erro">{erro}</p>}
    {grupos.map((grupo) => <section key={grupo.chave} className="online-gestor-grupo">
      <h3>{grupo.nome}</h3>
      {grupo.itens.length === 0 && <p className="online-config-note">Nenhum item nesta categoria. Aplique um produto nela pelo seletor.</p>}
      <div className="online-gestor-list">
        {grupo.itens.map((produto, indice) => <article key={produto.id} className="online-gestor-item">
          <span className={`online-gestor-thumb ${produto.foto_url ? 'tem-foto' : ''}`}>{produto.foto_url ? <img src={produto.foto_url} alt="" /> : '🍽️'}</span>
          <div>
            <b>{produto.nome}</b>
            <small>{produto.descricao || 'Sem descrição para o cliente'}</small>
            <label className="online-aplicar">Categoria no cardápio
              <select
                value={produto.cardapio_categoria_id ? String(produto.cardapio_categoria_id) : ''}
                disabled={ocupado}
                onChange={(event) => executar(() => onAplicar(produto, event.target.value ? Number(event.target.value) : null))}
              >
                <option value="">Sem categoria</option>
                {categorias.map((categoria) => <option key={categoria.id} value={categoria.id}>{categoria.nome}</option>)}
              </select>
            </label>
            <strong>{produto.preco == null ? 'Defina o preço' : fmtBRL(produto.preco)}</strong>
          </div>
          <div className="online-gestor-actions">
            <button type="button" disabled={ocupado || indice === 0} onClick={() => executar(() => onMover(produto, -1))}>Subir</button>
            <button type="button" disabled={ocupado || indice === grupo.itens.length - 1} onClick={() => executar(() => onMover(produto, 1))}>Descer</button>
            <button type="button" disabled={ocupado} onClick={() => onEditar(produto)}>Editar</button>
            <button type="button" disabled={ocupado} onClick={() => executar(() => onPausar(produto))}>{produto.disponivel === 1 ? 'Pausar' : 'Disponível'}</button>
            <button type="button" className="remover" disabled={ocupado} onClick={() => executar(() => onRemover(produto))}>Remover do cardápio</button>
          </div>
        </article>)}
      </div>
    </section>)}
    {produtos.length === 0 && <div className="online-empty"><PackagePlus /><b>Nenhum item no cardápio</b><span>Adicione um produto simples ou composto que já está no estoque. Não dá para inventar um item aqui.</span></div>}
  </div>;
}

function CardapioRolavel({ produtos, busca, onSelect }: { produtos: Product[]; busca: string; onSelect: (product: Product) => void }) {
  const termo = busca.trim().toLocaleLowerCase('pt-BR');
  const raiz = useRef<HTMLDivElement>(null);
  const lista = termo
    ? produtos.filter((product) => `${product.name} ${product.description}`.toLocaleLowerCase('pt-BR').includes(termo))
    : produtos;
  const grupos = useMemo(() => {
    const mapa = new Map<string, Product[]>();
    for (const produto of lista) {
      const nome = produto.category || 'Outros';
      if (!mapa.has(nome)) mapa.set(nome, []);
      mapa.get(nome)?.push(produto);
    }
    return [...mapa.entries()].map(([nome, itens], indice) => ({ nome, itens, id: idCategoria(nome, indice) }));
  }, [lista]);
  const maisVendidos = useMemo(() => (
    termo ? [] : produtos
      .filter((produto) => produto.sold > 0)
      .sort((a, b) => b.sold - a.sold || a.name.localeCompare(b.name, 'pt-BR'))
      .slice(0, 8)
  ), [produtos, termo]);
  const [ativa, setAtiva] = useState(maisVendidos[0] ? 'Mais vendidos' : (grupos[0]?.nome || ''));

  useEffect(() => {
    if (termo) return;
    const nomes = [...(maisVendidos.length ? ['Mais vendidos'] : []), ...grupos.map((grupo) => grupo.nome)];
    setAtiva((atual) => (nomes.includes(atual) ? atual : (nomes[0] || '')));
  }, [termo, grupos, maisVendidos.length]);

  useEffect(() => {
    const root = raiz.current;
    if (!root || termo || typeof IntersectionObserver === 'undefined') return;
    const secoes = [...root.querySelectorAll<HTMLElement>('[data-secao]')];
    if (!secoes.length) return;
    const observer = new IntersectionObserver((entries) => {
      const visiveis = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      const nome = visiveis[0]?.target.getAttribute('data-secao');
      if (nome) setAtiva(nome);
    }, { rootMargin: '-20% 0px -60% 0px', threshold: [0, 0.15] });
    secoes.forEach((secao) => observer.observe(secao));
    return () => observer.disconnect();
  }, [termo, grupos, maisVendidos.length]);

  const ir = (nome: string, id: string) => {
    setAtiva(nome);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (!produtos.length) {
    return <div className="online-empty"><Search /><b>Nada encontrado</b><span>Este cardápio ainda não tem esse item cadastrado.</span></div>;
  }
  if (termo && !lista.length) {
    return <div className="online-empty"><Search /><b>Nada encontrado</b><span>Este cardápio ainda não tem esse item cadastrado.</span></div>;
  }

  return (
    <div ref={raiz}>
      {!termo && (
        <div className="online-categories online-categories-fixas" aria-label="Categorias">
          {maisVendidos.length > 0 && <button type="button" className={ativa === 'Mais vendidos' ? 'active' : ''} onClick={() => ir('Mais vendidos', 'secao-mais-vendidos')}>Mais vendidos</button>}
          {grupos.map((grupo) => <button key={grupo.id} type="button" className={ativa === grupo.nome ? 'active' : ''} onClick={() => ir(grupo.nome, grupo.id)}>{grupo.nome}</button>)}
        </div>
      )}
      {termo ? (
        <div className="online-product-grid">
          {lista.map((product) => <ProductCard key={product.id} product={product} configurar={false} onSelect={() => onSelect(product)} />)}
        </div>
      ) : (
        <>
          {maisVendidos.length > 0 && (
            <section id="secao-mais-vendidos" data-secao="Mais vendidos" className="online-categoria" aria-labelledby="titulo-mais-vendidos">
              <h2 id="titulo-mais-vendidos">Mais vendidos</h2>
              <div className="online-best">
                {maisVendidos.map((product) => <ProductCard key={`venda-${product.id}`} product={product} configurar={false} onSelect={() => onSelect(product)} />)}
              </div>
            </section>
          )}
          {grupos.map((grupo) => (
            <section key={grupo.id} id={grupo.id} data-secao={grupo.nome} className="online-categoria" aria-labelledby={`${grupo.id}-titulo`}>
              <h2 id={`${grupo.id}-titulo`}>{grupo.nome}</h2>
              <div className="online-product-grid">
                {grupo.itens.map((product) => <ProductCard key={product.id} product={product} configurar={false} onSelect={() => onSelect(product)} />)}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}

function ProductCard({ product, configurar, onSelect }: { product: Product; configurar: boolean; onSelect: () => void }) {
  return <article className="online-product-card">
    <FotoProduto product={product} />
    <div className="online-product-body">
      <h3>{product.name}</h3><p>{product.description || 'Produto cadastrado no estoque.'}</p>
      <div className="online-product-bottom"><span><strong>{fmtBRL(product.price)}</strong></span><button type="button" onClick={onSelect} aria-label={configurar ? `Configurar ${product.name}` : `Adicionar ${product.name}`}>{configurar ? <Settings2 /> : <Plus />}</button></div>
    </div>
  </article>;
}

function ProductCustomizer({ product, onClose, onAdd }: { product: Product; onClose: () => void; onAdd: (item: Omit<CartItem, 'key' | 'quantity'>, quantity?: number) => void }) {
  const [removed, setRemoved] = useState<string[]>([]);
  const [additions, setAdditions] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [quantity, setQuantity] = useState(1);
  const total = (product.price + additions.reduce((sum, name) => sum + (product.additions.find((item) => item.name === name)?.price || 0), 0)) * quantity;
  const toggle = (name: string, selected: string[], set: (items: string[]) => void) => set(selected.includes(name) ? selected.filter((item) => item !== name) : [...selected, name]);
  return <div className="online-overlay" role="dialog" aria-modal="true" aria-labelledby="customizer-title">
    <div className="online-customizer">
      <button className="online-close" type="button" onClick={onClose} aria-label="Fechar"><X /></button>
      <FotoProduto product={product} grande />
      <div className="online-customizer-content">
        <p className="online-eyebrow">PERSONALIZE SEU PEDIDO</p><h2 id="customizer-title">{product.name}</h2><p>{product.description}</p><strong className="online-customizer-price">{fmtBRL(product.price)}</strong>
        {product.ingredients.length > 0 && <fieldset><legend>Quer tirar algum ingrediente? <small>opcional</small></legend>{product.ingredients.map((ingredient) => <label key={ingredient.id} className="online-choice"><span><input type="checkbox" checked={removed.includes(ingredient.name)} onChange={() => toggle(ingredient.name, removed, setRemoved)} /><i /> Tirar {ingredient.name}</span></label>)}</fieldset>}
        {product.additions.length > 0 && <fieldset><legend>Acréscimo de produto <small>opcional</small></legend>{product.additions.map((addition) => <label key={addition.name} className="online-choice"><span><input type="checkbox" checked={additions.includes(addition.name)} onChange={() => toggle(addition.name, additions, setAdditions)} /><i /> {addition.name}</span><b>+ {fmtBRL(addition.price)}</b></label>)}</fieldset>}
        <label className="online-note">Alguma observação?<textarea value={note} maxLength={140} onChange={(event) => setNote(event.target.value)} placeholder="Ex.: ponto da carne, alergias..." /><small>{note.length}/140</small></label>
      </div>
      <div className="online-customizer-footer"><div className="online-quantity"><button type="button" disabled={quantity === 1} onClick={() => setQuantity((value) => value - 1)}><Minus /></button><b>{quantity}</b><button type="button" onClick={() => setQuantity((value) => value + 1)}><Plus /></button></div><button className="online-add-button" type="button" onClick={() => onAdd({ product, removed, additions, note }, quantity)}>Adicionar <strong>{fmtBRL(total)}</strong></button></div>
    </div>
  </div>;
}

function ConfigurarProduto({ produto, categorias, composto = false, onClose, onSave, onRemover }: { produto: OnlineCatalogProduct; categorias: CategoriaCardapio[]; composto?: boolean; onClose: () => void; onSave: (produto: OnlineCatalogProduct, draft: { preco: string; descricao: string; ingredientes: string; foto: string; disponivel: boolean; acrescimos: LinhaAcrescimo[]; categoriaId: number | null }) => Promise<void>; onRemover: (produto: OnlineCatalogProduct) => Promise<void> }) {
  const [preco, setPreco] = useState(produto.preco == null ? '' : String(produto.preco));
  const [categoriaId, setCategoriaId] = useState(produto.cardapio_categoria_id ? String(produto.cardapio_categoria_id) : '');
  const [descricao, setDescricao] = useState(produto.descricao || '');
  const [ingredientes, setIngredientes] = useState(produto.opcoes.filter((opcao) => opcao.tipo === 'removivel').map((opcao) => opcao.nome).join(', '));
  const [acrescimos, setAcrescimos] = useState<LinhaAcrescimo[]>(produto.opcoes.filter((opcao) => opcao.tipo === 'adicional' && opcao.insumo_id).map((opcao) => ({ insumo_id: opcao.insumo_id || '', valor: String(opcao.preco_adicional), nome: opcao.nome })));
  const [insumos, setInsumos] = useState<Produto[]>([]);
  const [foto, setFoto] = useState(produto.foto_url || '');
  const [disponivel, setDisponivel] = useState(produto.disponivel === 1);
  useEffect(() => { produtoApi.insumos().then(setInsumos).catch(() => {}); }, []);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const visual = paraCardapio({ ...produto, preco: Number(preco.replace(',', '.')) || 0, descricao, foto_url: foto, disponivel: disponivel ? 1 : 0 });
  return <div className="online-overlay" role="dialog" aria-modal="true" aria-labelledby="config-title">
    <div className="online-customizer">
      <button className="online-close" type="button" onClick={onClose} aria-label="Fechar"><X /></button>
      {visual && <FotoProduto product={visual} grande />}
      <form className="online-customizer-content" onSubmit={async (event) => {
        event.preventDefault();
        setSalvando(true);
        setErro('');
        try {
          await onSave(produto, {
            preco, descricao, ingredientes, foto, disponivel, categoriaId: categoriaId ? Number(categoriaId) : null,
            acrescimos: acrescimos.map((linha) => {
              const insumo = insumos.find((item) => item.id === Number(linha.insumo_id));
              return { ...linha, nome: insumo?.nome || linha.nome, preco: insumo?.preco ?? linha.preco ?? null };
            }),
          });
        }
        catch (error: any) { setErro(error?.error || error?.message || 'Não foi possível salvar'); }
        finally { setSalvando(false); }
      }}>
        <p className="online-eyebrow">SOBRE O PRODUTO</p>
        <h2 id="config-title">{produto.nome}</h2>
        <p>Foto da galeria, descrição e preço. O nome vem do estoque.</p>
        <div className="online-config-fields">
          <label>Foto da galeria<FotoGaleria value={foto} onChange={setFoto} /></label>
          <label>Preço no delivery<input inputMode="decimal" value={preco} onChange={(event) => setPreco(event.target.value)} /></label>
          <label>Categoria no cardápio<select value={categoriaId} onChange={(event) => setCategoriaId(event.target.value)}><option value="">Sem categoria</option>{categorias.map((categoria) => <option key={categoria.id} value={categoria.id}>{categoria.nome}</option>)}</select></label>
          <AcrescimoCadastro linhas={acrescimos} onChange={setAcrescimos} insumos={insumos.filter((item) => item.id !== produto.produto_id)} />
          <label>Descrição{composto ? <small> Os ingredientes da ficha já estão escritos. Acrescente algo a mais se quiser.</small> : null}<textarea value={descricao} onChange={(event) => setDescricao(event.target.value)} rows={3} /></label>
          <label>Ingredientes que o cliente pode tirar<input value={ingredientes} onChange={(event) => setIngredientes(event.target.value)} placeholder="Separe por vírgula" /></label>
          <button className="online-photo-btn" type="button" onClick={() => setDisponivel((valor) => !valor)}>{disponivel ? 'Visível para o cliente' : 'Pausado para o cliente'}</button>
          {erro && <p className="online-erro">{erro}</p>}
          <button className="online-photo-btn claro" type="button" disabled={salvando} onClick={async () => { setSalvando(true); setErro(''); try { await onRemover(produto); } catch (error: any) { setErro(error?.error || error?.message || 'Não foi possível remover'); setSalvando(false); } }}>Remover do cardápio</button>
        </div>
        <div className="online-customizer-footer"><button className="online-add-button" type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar configuração'}</button></div>
      </form>
    </div>
  </div>;
}

function EstoquePicker({ produtos, onClose, onPick }: { produtos: Produto[]; onClose: () => void; onPick: (produto: Produto) => Promise<void> }) {
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  return <div className="online-overlay" role="dialog" aria-modal="true" aria-labelledby="estoque-title">
    <div className="online-checkout">
      <button className="online-close" type="button" onClick={onClose} aria-label="Fechar"><X /></button>
      <p className="online-eyebrow">ESTOQUE</p>
      <h2 id="estoque-title">Trazer para o delivery</h2>
      <p className="online-config-note">Só aparecem produto simples e composto já cadastrados. Não dá para inventar um item aqui.</p>
      {produtos.length === 0 ? <div className="online-empty"><UtensilsCrossed /><b>Nada novo no estoque</b><span>Cadastre o produto no estoque antes de publicar.</span></div> : <div className="online-stock-list">{produtos.map((produto) => <button key={produto.id} type="button" disabled={ocupado} onClick={async () => { setOcupado(true); setErro(''); try { await onPick(produto); } catch (error: any) { setErro(error?.error || 'Não foi possível publicar'); setOcupado(false); } }}><span>{produto.nome}</span><b>{produto.preco == null ? 'Sem preço' : fmtBRL(produto.preco)}</b></button>)}</div>}
      {erro && <p className="online-erro">{erro}</p>}
    </div>
  </div>;
}

function CartDrawer({ cart, subtotal, deliveryFee, onClose, onChange, onCheckout }: { cart: CartItem[]; subtotal: number; deliveryFee: number | null; onClose: () => void; onChange: (key: string, delta: number) => void; onCheckout: () => void }) {
  const taxaTexto = deliveryFee == null ? 'No endereço' : deliveryFee === 0 ? 'Grátis' : fmtBRL(deliveryFee);
  return <div className="online-overlay online-cart-overlay" role="dialog" aria-modal="true" aria-labelledby="cart-title"><aside className="online-cart-drawer"><header><div><p>SEU PEDIDO</p><h2 id="cart-title">Sua sacola</h2></div><button className="online-close" type="button" onClick={onClose} aria-label="Fechar sacola"><X /></button></header>{cart.length === 0 ? <div className="online-cart-empty"><ShoppingBag /><b>Sua sacola está vazia</b><span>Escolha um produto cadastrado.</span><button type="button" onClick={onClose}>Ver cardápio</button></div> : <><div className="online-cart-list">{cart.map((item) => <div className="online-cart-item" key={item.key}><div className={`online-cart-thumb ${item.product.photo ? 'tem-foto' : 'burger'}`}>{item.product.photo ? <img src={item.product.photo} alt="" /> : '🍽️'}</div><div><b>{item.product.name}</b>{item.removed.length > 0 && <small>Sem {item.removed.join(', ')}</small>}{item.additions.length > 0 && <small>+ {item.additions.join(', ')}</small>}{item.note && <small>“{item.note}”</small>}<strong>{fmtBRL((item.product.price + addOnPrice(item)) * item.quantity)}</strong></div><div className="online-mini-quantity"><button type="button" onClick={() => onChange(item.key, -1)}><Minus /></button><b>{item.quantity}</b><button type="button" onClick={() => onChange(item.key, 1)}><Plus /></button></div></div>)}</div><div className="online-summary"><p><span>Subtotal</span><b>{fmtBRL(subtotal)}</b></p><p><span>Taxa de entrega</span><b>{taxaTexto}</b></p><p className="online-total"><span>Total</span><b>{fmtBRL(subtotal + (deliveryFee || 0))}</b></p></div><button className="online-checkout-button" type="button" onClick={onCheckout}>Continuar <ChevronRight /></button></>}</aside></div>;
}

function NomeDaLoja({ loja, onSaved }: { loja: OnlineStore; onSaved: (loja: OnlineStore) => void }) {
  const [nome, setNome] = useState(loja.nome || '');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    setNome(loja.nome || '');
  }, [loja.nome]);

  const salvar = async () => {
    const texto = nome.trim();
    if (!texto) {
      setErro('Informe o nome da loja.');
      return;
    }
    setOcupado(true);
    setErro('');
    try {
      onSaved(await onlineApi.updateStore({ nome: texto }));
    } catch (error: any) {
      setErro(error?.error || 'Não foi possível salvar o nome');
    } finally {
      setOcupado(false);
    }
  };

  return (
    <section className="online-category-box online-aparencia">
      <p className="online-eyebrow">NOME DA LOJA</p>
      <h3>Como o cliente vê a loja</h3>
      <p>No cardápio aparece este nome. Outra loja não pode usar o mesmo nome, nem trocando maiúsculas por minúsculas.</p>
      <label>Nome da loja
        <input value={nome} maxLength={120} onChange={(event) => setNome(event.target.value)} />
      </label>
      <div className="online-where-actions">
        <button type="button" onClick={salvar} disabled={ocupado}>{ocupado ? 'Salvando…' : 'Salvar nome'}</button>
      </div>
      {erro && <p className="online-erro">{erro}</p>}
    </section>
  );
}

function PixDaLoja({ loja, onSaved }: { loja: OnlineStore; onSaved: (loja: OnlineStore) => void }) {
  const [chave, setChave] = useState(loja.pix_chave || '');
  const [cidade, setCidade] = useState(loja.pix_cidade || '');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    setChave(loja.pix_chave || '');
    setCidade(loja.pix_cidade || '');
  }, [loja.pix_chave, loja.pix_cidade]);

  const salvar = async () => {
    setOcupado(true);
    setErro('');
    try {
      onSaved(await onlineApi.updateStore({ pix_chave: chave.trim(), pix_cidade: cidade.trim() }));
    } catch (error: any) {
      setErro(error?.error || 'Não foi possível salvar o Pix');
    } finally {
      setOcupado(false);
    }
  };

  return (
    <section className="online-category-box online-aparencia">
      <p className="online-eyebrow">PIX DA LOJA</p>
      <h3>Chave que recebe os pedidos</h3>
      <p>O cliente paga direto esta chave. O valor não passa pela DoixP. Cada estabelecimento usa a própria chave. Deixe a chave vazia para oferecer só dinheiro e maquininha.</p>
      <label>Chave Pix
        <input value={chave} maxLength={77} onChange={(event) => setChave(event.target.value)} placeholder="CPF, CNPJ, e-mail, celular ou chave aleatória" />
      </label>
      <label>Cidade do recebedor
        <input value={cidade} maxLength={40} onChange={(event) => setCidade(event.target.value)} placeholder="São Paulo" />
      </label>
      <p>A cidade entra no código Pix, com até 15 letras. Onze números de um CPF válido entram como CPF. Celular pode ir com DDD, como 11988887777, quando não for um CPF.</p>
      <div className="online-where-actions">
        <button type="button" onClick={salvar} disabled={ocupado}>{ocupado ? 'Salvando…' : 'Salvar Pix'}</button>
      </div>
      {loja.pix_disponivel === 1 && <p>Pix ativo nesta loja.</p>}
      {erro && <p className="online-erro">{erro}</p>}
    </section>
  );
}

function AreaDaLoja({ loja, onSaved }: { loja: OnlineStore; onSaved: (loja: OnlineStore) => void }) {
  const [endereco, setEndereco] = useState(loja.endereco || '');
  const [raio, setRaio] = useState(loja.raio_entrega_km == null ? '' : String(loja.raio_entrega_km).replace('.', ','));
  const [valorKm, setValorKm] = useState(loja.valor_por_km == null ? '' : String(loja.valor_por_km).replace('.', ','));
  const [modo, setModo] = useState<ModoEntrega>(loja.modo_entrega === 'dividido' || loja.modo_entrega === 'gratis' ? loja.modo_entrega : 'cliente');
  const [latitude, setLatitude] = useState<number | null>(loja.latitude ?? null);
  const [longitude, setLongitude] = useState<number | null>(loja.longitude ?? null);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [lendo, setLendo] = useState(false);
  const valorNumero = Number(valorKm.trim().replace(',', '.'));

  useEffect(() => {
    setEndereco(loja.endereco || '');
    setRaio(loja.raio_entrega_km == null ? '' : String(loja.raio_entrega_km).replace('.', ','));
    setValorKm(loja.valor_por_km == null ? '' : String(loja.valor_por_km).replace('.', ','));
    setModo(loja.modo_entrega === 'dividido' || loja.modo_entrega === 'gratis' ? loja.modo_entrega : 'cliente');
    setLatitude(loja.latitude ?? null);
    setLongitude(loja.longitude ?? null);
  }, [loja.endereco, loja.raio_entrega_km, loja.latitude, loja.longitude, loja.valor_por_km, loja.modo_entrega]);

  const usarLocal = () => {
    if (!navigator.geolocation) {
      setErro('Este aparelho não informa a localização.');
      return;
    }
    setLendo(true);
    setErro('');
    navigator.geolocation.getCurrentPosition((posicao) => {
      setLatitude(posicao.coords.latitude);
      setLongitude(posicao.coords.longitude);
      setLendo(false);
    }, () => {
      setErro('Não foi possível ler a localização. Informe rua, número e cidade.');
      setLendo(false);
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
  };

  const salvar = async () => {
    const texto = raio.trim();
    const numero = texto ? Number(texto.replace(',', '.')) : null;
    const valorTexto = valorKm.trim();
    const valor = valorTexto ? Number(valorTexto.replace(',', '.')) : null;
    if (numero != null && (!Number.isFinite(numero) || numero < 0.1 || numero > 100)) {
      setErro('O limite fica entre 0,1 e 100 km.');
      return;
    }
    if (valorTexto && (valor == null || !Number.isFinite(valor) || valor < 0 || valor > 1000)) {
      setErro('O valor por km fica entre 0 e 1000.');
      return;
    }
    setOcupado(true);
    setErro('');
    try {
      onSaved(await onlineApi.updateStore({
        endereco,
        latitude,
        longitude,
        raio_entrega_km: numero,
        valor_por_km: valor,
        modo_entrega: modo,
        taxa_entrega: valorTexto ? 0 : loja.taxa_entrega,
      }));
    } catch (error: any) {
      setErro(error?.error || 'Não foi possível salvar a área');
    } finally {
      setOcupado(false);
    }
  };

  return (
    <section className="online-category-box online-where">
      <p className="online-eyebrow">ÁREA DE ENTREGA</p>
      <h3>Até onde esta loja entrega</h3>
      <p>O cliente só vê a loja na região quando a distância cabe neste limite. Pode ser 3,5 km, 10 km ou outro valor.</p>
      <label>Endereço da loja
        <input value={endereco} onChange={(event) => { setEndereco(event.target.value); setLatitude(null); setLongitude(null); }} placeholder="Rua, número e cidade" />
      </label>
      <div className="online-category-suggestions">
        {[3.5, 5, 10].map((km) => <button key={km} type="button" onClick={() => setRaio(String(km).replace('.', ','))}>{km.toLocaleString('pt-BR')} km</button>)}
      </div>
      <label>Limite máximo (km)
        <input inputMode="decimal" value={raio} onChange={(event) => setRaio(event.target.value)} placeholder="10" />
      </label>
      <div className="online-region-toggle" role="group" aria-label="Quem paga a entrega">
        {([['cliente', 'Cliente paga 100%'], ['dividido', 'Dividir'], ['gratis', 'Entrega grátis']] as const).map(([id, rotulo]) => (
          <button key={id} type="button" className={modo === id ? 'active' : ''} onClick={() => setModo(id)}>{rotulo}</button>
        ))}
      </div>
      <label>Valor por km
        <input inputMode="decimal" value={valorKm} onChange={(event) => setValorKm(event.target.value)} placeholder="2,00" />
      </label>
      <p className="online-where-note">Exemplo: 7 km × R$ 2,00 = R$ 14,00. Dividido, o cliente paga R$ 7,00. Um produto de R$ 50,00 fica R$ 57,00.</p>
      {valorKm.trim() && Number.isFinite(valorNumero) && <p className="online-where-note">{previaEntrega(valorNumero, modo)}</p>}
      {!valorKm.trim() && loja.taxa_entrega > 0 && <p className="online-where-note">Taxa fixa atual {fmtBRL(loja.taxa_entrega)}. Informe o valor por km para cobrar pela distância.</p>}
      <div className="online-where-actions">
        <button type="button" onClick={usarLocal} disabled={lendo}>{lendo ? 'Lendo localização…' : 'Usar minha localização'}</button>
        <button type="button" onClick={salvar} disabled={ocupado}>{ocupado ? 'Salvando…' : 'Salvar área'}</button>
      </div>
      {latitude != null && longitude != null && <p className="online-where-note">Ponto do aparelho definido. Ele vale até você alterar o endereço.</p>}
      {erro && <p className="online-erro">{erro}</p>}
    </section>
  );
}

function CheckoutModal({ loja, totalBase, onClose, onSubmit }: { loja: OnlineStore; totalBase: number; onClose: () => void; onSubmit: (dados: { nome: string; telefone: string; entrega: 'entrega' | 'retirada'; endereco: string; pagamento: 'dinheiro' | 'maquininha'; valorEmDinheiro: number | null }) => Promise<void> }) {
  const guardado = lerPontoCliente();
  const entregaPadrao = loja.aceita_entrega ? 'entrega' : 'retirada';
  const [delivery, setDelivery] = useState<'entrega' | 'retirada'>(entregaPadrao);
  const [payment, setPayment] = useState<'dinheiro' | 'maquininha'>('dinheiro');
  const [valorEmDinheiro, setValorEmDinheiro] = useState('');
  const [avisoPagamento, setAvisoPagamento] = useState('');
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [endereco, setEndereco] = useState(guardado?.origem === 'endereco' ? guardado.endereco : '');
  const [consulta, setConsulta] = useState(endereco);
  const [area, setArea] = useState<AreaEntrega | null>(null);
  const [medindo, setMedindo] = useState(false);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const aguardando = delivery === 'entrega' && loja.valor_por_km != null && area?.taxa_cliente == null;
  const taxa = delivery !== 'entrega' ? 0
    : area?.taxa_cliente != null ? area.taxa_cliente
    : loja.modo_entrega === 'gratis' ? 0
    : loja.valor_por_km != null ? 0
    : Number(loja.taxa_entrega) || 0;
  const fora = delivery === 'entrega' && area?.entrega_na_regiao === 0;
  const cobranca = textoCobrancaCliente(delivery === 'entrega' ? area : null);
  const totalPedido = totalBase + (aguardando ? 0 : taxa);
  const valorInformado = valorMonetario(valorEmDinheiro);
  const dinheiroInsuficiente = payment === 'dinheiro' && valorInformado != null && valorInformado < totalPedido;
  const troco = payment === 'dinheiro' && valorInformado != null && valorInformado >= totalPedido ? valorInformado - totalPedido : null;

  useEffect(() => {
    const timer = window.setTimeout(() => setConsulta(endereco.trim()), 700);
    return () => window.clearTimeout(timer);
  }, [endereco]);

  useEffect(() => {
    if (delivery !== 'entrega' || consulta.length < 5) {
      setArea(null);
      setMedindo(false);
      return undefined;
    }
    let ativo = true;
    setMedindo(true);
    onlinePublicApi.distance(loja.slug, { q: consulta })
      .then((dados) => { if (ativo) { setArea(dados); setErro(''); } })
      .catch((error: any) => {
        if (!ativo) return;
        setArea(null);
        setErro(error?.error || 'Não foi possível localizar este endereço. Inclua rua, número e cidade.');
      })
      .finally(() => { if (ativo) setMedindo(false); });
    return () => { ativo = false; };
  }, [consulta, delivery, loja.slug]);

  return (
    <div className="online-overlay" role="dialog" aria-modal="true" aria-labelledby="checkout-title">
      <form className="online-checkout" onSubmit={async (event) => {
        event.preventDefault();
        if (fora) {
          setErro(`Esta loja entrega até ${fmtKm(area?.raio_entrega_km || 0)}. Este endereço fica a ${fmtKm(area?.distancia_km || 0)}.`);
          return;
        }
        if (payment === 'dinheiro' && (valorInformado == null || valorInformado < totalPedido)) {
          setErro(`Informe um valor em dinheiro igual ou maior que ${fmtBRL(totalPedido)}.`);
          return;
        }
        setEnviando(true);
        setErro('');
        try {
          await onSubmit({ nome, telefone, entrega: delivery, endereco, pagamento: payment, valorEmDinheiro: payment === 'dinheiro' ? valorInformado : null });
        } catch (error: any) {
          setErro(error?.error || error?.message || 'Não foi possível enviar o pedido');
        } finally {
          setEnviando(false);
        }
      }}>
        <button className="online-close" type="button" onClick={onClose} aria-label="Voltar"><ArrowLeft /></button>
        <p className="online-eyebrow">QUASE LÁ</p>
        <h2 id="checkout-title">Finalizar pedido</h2>
        <label>Seu nome<input required value={nome} onChange={(event) => setNome(event.target.value)} placeholder="Como podemos te chamar?" /></label>
        <label>WhatsApp<input required inputMode="tel" value={telefone} onChange={(event) => setTelefone(event.target.value)} placeholder="(00) 00000-0000" /></label>
        <fieldset className="online-delivery-choice">
          <legend>Como você quer receber?</legend>
          {loja.aceita_entrega ? <label className={delivery === 'entrega' ? 'selected' : ''}><input type="radio" name="delivery" checked={delivery === 'entrega'} onChange={() => setDelivery('entrega')} /><Bike /><span><b>Receber em casa</b><small>{loja.tempo_min_entrega ? `A partir de ${loja.tempo_min_entrega} min` : 'Entrega'}</small></span><Check /></label> : null}
          {loja.aceita_retirada ? <label className={delivery === 'retirada' ? 'selected' : ''}><input type="radio" name="delivery" checked={delivery === 'retirada'} onChange={() => setDelivery('retirada')} /><Store /><span><b>Retirar no balcão</b><small>Sem taxa de entrega</small></span><Check /></label> : null}
        </fieldset>
        {delivery === 'entrega' && (
          <label>Endereço de entrega
            <input required value={endereco} onChange={(event) => { setEndereco(event.target.value); setErro(''); }} placeholder="Rua, número e cidade" />
            {medindo && <small>Calculando a distância…</small>}
            {area?.distancia_km != null && (
              <small className={fora ? 'online-distance fora' : 'online-distance'}>
                {fora
                  ? `Fora da área. Esta loja entrega até ${fmtKm(area.raio_entrega_km || 0)} e este endereço fica a ${fmtKm(area.distancia_km)}.`
                  : `A ${fmtKm(area.distancia_km)} da loja${area.raio_entrega_km != null ? ` · entrega até ${fmtKm(area.raio_entrega_km)}` : ''}`}
              </small>
            )}
            {cobranca && <small>{cobranca}</small>}
          </label>
        )}
        <fieldset className="online-payment">
          <legend>Forma de pagamento</legend>
          <div className="online-payment-options">
            {([['dinheiro', 'Dinheiro'], ['maquininha', 'Maquininha']] as const).map(([value, label]) => <label key={value} className={payment === value ? 'selected' : ''}><input type="radio" name="payment" checked={payment === value} onChange={() => { setPayment(value); setAvisoPagamento(''); }} />{label}</label>)}
            {(['Pix', 'Cartão de débito', 'Cartão de crédito'] as const).map((label) => <button key={label} type="button" className="indisponivel" title={`${label}: em breve`} aria-label={`${label}: em breve`} onClick={() => setAvisoPagamento(`${label} estará disponível em breve.`)}>{label}<small>Em breve</small></button>)}
          </div>
          {payment === 'dinheiro' && <div className="online-cash-change"><label>Vou pagar com<input required inputMode="decimal" value={valorEmDinheiro} onChange={(event) => { setValorEmDinheiro(event.target.value); setErro(''); }} placeholder="Ex.: 50,00" /></label><div><span>Total do pedido <b>{fmtBRL(totalPedido)}</b></span>{valorInformado != null && <span className={dinheiroInsuficiente ? 'insuficiente' : ''}>{dinheiroInsuficiente ? `Faltam ${fmtBRL(totalPedido - valorInformado)}` : `Troco ${fmtBRL(troco || 0)}`}</span>}</div></div>}
          <p className="online-pay-note">Dinheiro e maquininha são pagos na entrega ou na retirada. Pix, débito e crédito serão liberados em breve.</p>
          {avisoPagamento && <p className="online-payment-notice" role="status">{avisoPagamento}</p>}
        </fieldset>
        {erro && <p className="online-erro">{erro}</p>}
        <button className="online-place-order" type="submit" disabled={enviando || fora || aguardando || dinheiroInsuficiente}>{enviando ? 'Enviando…' : fora ? 'Fora da área de entrega' : aguardando ? 'Informe o endereço' : 'Fazer pedido'} <b>{fmtBRL(totalPedido)}</b></button>
      </form>
    </div>
  );
}

type Acompanhamento = Awaited<ReturnType<typeof onlinePublicApi.track>>;

const PASSOS_ENTREGA = [
  { id: 'recebido', titulo: 'Recebido', texto: 'O estabelecimento recebeu o pedido.' },
  { id: 'preparando', titulo: 'Sendo preparado', texto: 'A cozinha está preparando.' },
  { id: 'saiu_entrega', titulo: 'Saiu para entrega', texto: 'O pedido está a caminho.' },
  { id: 'entregue', titulo: 'Entregue', texto: 'Pedido entregue.' },
] as const;

const PASSOS_RETIRADA = [
  { id: 'recebido', titulo: 'Recebido', texto: 'O estabelecimento recebeu o pedido.' },
  { id: 'preparando', titulo: 'Sendo preparado', texto: 'A cozinha está preparando.' },
  { id: 'pronto_retirada', titulo: 'Pronto para retirada', texto: 'Você já pode buscar no balcão.' },
  { id: 'entregue', titulo: 'Retirado', texto: 'Pedido retirado.' },
] as const;

function rotuloPagamento(forma: string) {
  if (forma === 'pix') return 'Pix';
  if (forma === 'dinheiro') return 'Dinheiro';
  if (forma === 'maquininha' || forma === 'cartao') return 'Maquininha na entrega';
  return forma;
}

function PixDoPedido({ codigo, loja, aguardando }: { codigo: string; loja: string; aguardando: boolean }) {
  const [qr, setQr] = useState('');
  const [copiado, setCopiado] = useState(false);
  useEffect(() => {
    let ativo = true;
    toDataURL(codigo, { margin: 1, width: 220, errorCorrectionLevel: 'M' })
      .then((url) => { if (ativo) setQr(url); })
      .catch(() => { if (ativo) setQr(''); });
    return () => { ativo = false; };
  }, [codigo]);
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado(true);
    } catch {
      setCopiado(false);
    }
  };
  return (
    <div className="online-pix">
      <b>{aguardando ? `Pague com Pix para ${loja}` : `Pix de ${loja}`}</b>
      <span>{aguardando ? 'Abra o aplicativo do banco, leia o QR Code ou use o código copia e cola. O pagamento vai para a chave desta loja. O pedido só sobe para a cozinha depois que o Pix cair. O sistema não vê a conta do banco.' : 'A loja confirmou este Pix e o pedido já subiu.'}</span>
      {qr && <img src={qr} alt="QR Code do Pix desta loja" />}
      <textarea readOnly value={codigo} aria-label="Código Pix copia e cola" />
      <button type="button" onClick={copiar}>{copiado ? 'Código copiado' : 'Copiar código Pix'}</button>
    </div>
  );
}

function AcompanharPedido() {
  const { slug = '', chave = '' } = useParams();
  const [pedido, setPedido] = useState<Acompanhamento | null>(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    let ativo = true;
    let visto = false;
    let timer = 0;
    const buscar = async () => {
      try {
        const dados = await onlinePublicApi.track(slug, chave);
        if (!ativo) return;
        visto = true;
        setPedido(dados);
        setErro('');
        if (dados.etapa === 'cancelado' || dados.etapa === 'entregue') return;
        timer = window.setTimeout(buscar, 8000);
      } catch (error: any) {
        if (!ativo) return;
        if (!visto) setErro(error?.error || 'Não foi possível acompanhar este pedido');
        else timer = window.setTimeout(buscar, 8000);
      } finally {
        if (ativo) setCarregando(false);
      }
    };
    buscar();
    return () => {
      ativo = false;
      window.clearTimeout(timer);
    };
  }, [slug, chave]);

  const passos = pedido?.tipo_entrega === 'retirada' ? PASSOS_RETIRADA : PASSOS_ENTREGA;
  const indice = pedido ? passos.findIndex((passo) => passo.id === pedido.etapa) : -1;
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopiado(true);
    } catch {
      setCopiado(false);
    }
  };

  return (
    <div className="online-storefront min-h-viewport">
      <header className="online-topbar">
        <Link className="online-brand" to={`/pedido/${slug}`}>
          <span className="online-brand-mark"><Flame aria-hidden="true" /></span>
          <span>{marca(pedido?.loja || 'Delivery')}</span>
        </Link>
      </header>
      <main className="online-track-page">
        {carregando && !pedido && <div className="online-empty"><b>Buscando seu pedido…</b></div>}
        {erro && !pedido && (
          <div className="online-empty">
            <Store />
            <b>Pedido não encontrado</b>
            <span>{erro}</span>
            <Link to={`/pedido/${slug}`}>Voltar ao cardápio</Link>
          </div>
        )}
        {pedido && (
          <section className="online-track-card" aria-live="polite">
            <p className="online-eyebrow">{pedido.etapa === 'cancelado' ? 'PEDIDO ENCERRADO' : pedido.etapa === 'aguardando_pix' ? 'PAGUE COM PIX' : 'ACOMPANHAR PEDIDO'}</p>
            <h1>Pedido #{pedido.id}</h1>
            <p className="online-track-loja">{pedido.loja} · {pedido.tipo_entrega === 'retirada' ? 'Retirada no balcão' : 'Entrega'}</p>
            {pedido.etapa === 'aguardando_pix' && pedido.pix_copia_cola && <PixDoPedido codigo={pedido.pix_copia_cola} loja={pedido.loja} aguardando />}
            {pedido.etapa === 'cancelado' ? (
              <div className="online-track-cancel">
                <b>Pedido cancelado</b>
                <span>O estabelecimento cancelou este pedido. Se quiser, faça um novo pelo cardápio.</span>
              </div>
            ) : pedido.etapa === 'aguardando_pix' ? (
              <div className="online-track-wait">
                <b>Aguardando o pagamento</b>
                <span>A cozinha ainda não recebeu este pedido. Ele sobe quando a loja confirmar que o Pix caiu na conta dela.</span>
              </div>
            ) : (
              <ol className="online-track">
                {passos.map((passo, index) => {
                  const feito = indice > index || (pedido.etapa === 'entregue' && index === indice);
                  const atual = index === indice && pedido.etapa !== 'entregue';
                  return (
                    <li key={passo.id} className={feito ? 'feito' : atual ? 'atual' : ''}>
                      <i>{feito ? <Check /> : index + 1}</i>
                      <div>
                        <b>{passo.titulo}</b>
                        <span>{passo.texto}</span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
            <ul className="online-track-itens">
              {pedido.itens.map((item, index) => <li key={`${item.nome}-${index}`}>{item.quantidade}x {item.nome}</li>)}
            </ul>
            <p className="online-track-total"><span>Total</span><b>{fmtBRL(pedido.total)}</b></p>
            <p className="online-track-note">Pagamento: {rotuloPagamento(pedido.forma_pagamento)}.</p>
            {pedido.forma_pagamento === 'dinheiro' && pedido.troco_para != null && <p className="online-track-note">Você pagará com {fmtBRL(pedido.troco_para)} e receberá {fmtBRL(Math.max(0, pedido.troco_para - pedido.total))} de troco.</p>}
            {pedido.etapa !== 'cancelado' && pedido.etapa !== 'aguardando_pix' && pedido.forma_pagamento === 'pix' && pedido.pix_copia_cola && <PixDoPedido codigo={pedido.pix_copia_cola} loja={pedido.loja} aguardando={false} />}
            {pedido.tipo_entrega === 'entrega' && (pedido.entrega_gratis === 1 || pedido.modo_entrega === 'gratis') && <p className="online-track-note">Entrega grátis inclusa.</p>}
            {pedido.tipo_entrega === 'entrega' && pedido.modo_entrega !== 'gratis' && pedido.entrega_gratis !== 1 && (pedido.taxa_entrega || 0) > 0 && (
              <p className="online-track-note">Entrega {fmtBRL(pedido.taxa_entrega)} inclusa no total.{pedido.modo_entrega === 'dividido' && pedido.valor_entrega != null ? ' A loja paga a outra parte.' : ''}</p>
            )}
            <p className="online-track-note">Esta página atualiza sozinha. O link vale só para este pedido, nesta loja.</p>
            <div className="online-track-actions">
              <button type="button" onClick={copiar}>{copiado ? 'Link copiado' : 'Copiar link'}</button>
              <Link to={`/pedido/${slug}`}>Voltar ao cardápio</Link>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
