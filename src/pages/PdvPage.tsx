import { useEffect, useMemo, useRef, useState } from 'react';
import { ScanBarcode, Plus, Minus, Trash2, Search, Printer, X, Wallet, RotateCcw, ShoppingCart, PackageCheck } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { AnimatedPage } from '@/components/anim';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Textarea, useToast } from '@/components/ui';
import { produtoApi, vendaApi, configApi } from '@/lib/api';
import type { Produto, ConfigEmpresa, Venda } from '@/lib/types';
import { fmtBRL, fmtNum, FORMAS_PAGAMENTO, formaLabel } from '@/lib/format';
import { printReceipt } from '@/lib/print';
import { observarEstoqueAtualizado } from '@/lib/estoqueSync';
import { useBarcodeScanner } from '@/lib/useBarcodeScanner';

interface CartItem {
  produto: Produto;
  qtd: number;
}

const PDV_CART_STORAGE = 'simplesx_pdv_cart';

function carregarCarrinho(): CartItem[] {
  try {
    const salvo = JSON.parse(localStorage.getItem(PDV_CART_STORAGE) || '[]');
    if (!Array.isArray(salvo)) return [];
    return salvo.filter(
      (item): item is CartItem =>
        Boolean(item?.produto?.id) && Number.isFinite(Number(item?.qtd)) && Number(item.qtd) > 0
    );
  } catch {
    return [];
  }
}

export function PdvPage() {
  const toast = useToast();
  const [config, setConfig] = useState<ConfigEmpresa | null>(null);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [cart, setCart] = useState<CartItem[]>(carregarCarrinho);
  const [codigo, setCodigo] = useState('');
  const [garcons, setGarcons] = useState<string[]>([]);

  useEffect(() => {
    try {
      setGarcons(JSON.parse(localStorage.getItem('simplesx_garcons') || '[]'));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (cart.length) localStorage.setItem(PDV_CART_STORAGE, JSON.stringify(cart));
    else localStorage.removeItem(PDV_CART_STORAGE);
  }, [cart]);

  useEffect(() => {
    let ativo = true;
    const atualizarProdutos = () => {
      produtoApi.list(undefined, 'mercado').then((lista) => {
        if (ativo) setProdutos(lista);
      }).catch(() => {});
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') atualizarProdutos();
    };
    const parar = observarEstoqueAtualizado(atualizarProdutos);
    window.addEventListener('focus', atualizarProdutos);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      ativo = false;
      parar();
      window.removeEventListener('focus', atualizarProdutos);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
  const [filtro, setFiltro] = useState('');
  const [responsavel, setResponsavel] = useState('');
  const [desconto, setDesconto] = useState('');
  const [pagar, setPagar] = useState(false);
  const [pgFormas, setPgFormas] = useState<{ forma: string; valor: string }[]>([{ forma: 'dinheiro', valor: '' }]);
  const [troco, setTroco] = useState(0);
  const [comprovante, setComprovante] = useState<any>(null);
  const [salvando, setSalvando] = useState(false);
  const [vendaReaberta, setVendaReaberta] = useState<Venda | null>(null);
  const [justificativa, setJustificativa] = useState('');
  const [motivosReducao, setMotivosReducao] = useState<Record<number, 'nao_pago' | 'duplicado_nao_vendido'>>({});
  const [ultimoProduto, setUltimoProduto] = useState<Produto | null>(null);
  const bipRef = useRef<HTMLInputElement>(null);
  const comprovanteRef = useRef<HTMLDivElement>(null);
  const reaberturaUrlIniciada = useRef(false);

  useEffect(() => {
    const coarse = window.matchMedia?.('(pointer: coarse)')?.matches;
    if (!coarse) bipRef.current?.focus();
    configApi.get().then(setConfig).catch(() => {});
    produtoApi.list(undefined, 'mercado').then(setProdutos).catch(() => {});
  }, []);

  const subtotal = useMemo(() => cart.reduce((s, i) => s + i.produto.preco! * i.qtd, 0), [cart]);
  const descValor = useMemo(() => Math.min(Number(desconto || 0), subtotal), [desconto, subtotal]);
  const total = Math.max(0, subtotal - descValor);
  const totalItens = useMemo(() => cart.reduce((s, i) => s + i.qtd, 0), [cart]);

  const imprimirComprovante = async () => {
    if (!comprovante?.venda_id) return printReceipt(comprovanteRef.current);
    try {
      const result = await vendaApi.imprimir(comprovante.venda_id);
      if (result.jobs?.length) toast('success', `Cupom enviado para ${result.jobs.length} impressora(s)`);
      else {
        toast('info', 'Nenhuma impressora configurada para Cupom de venda; abrindo impressão local');
        printReceipt(comprovanteRef.current);
      }
    } catch (error: any) {
      toast('error', error?.error || 'Não foi possível enviar o cupom ao gestor');
    }
  };

  const disponivel = (p: Produto) => (p.tipo === 'composto' ? (p.estoque_possivel ?? 0) : p.estoque_atual);

  const adicionar = (p: Produto) => {
    if (p.preco == null) {
      toast('error', `${p.nome} não tem preço cadastrado`);
      return;
    }
    if (disponivel(p) <= 0) {
      toast('error', p.tipo === 'composto' ? `${p.nome} sem insumos suficientes` : `${p.nome} sem estoque`);
      return;
    }
    const atual = cart.find((i) => i.produto.id === p.id)?.qtd || 0;
    if (atual >= disponivel(p)) {
      toast('error', `Quantidade máxima disponível de ${p.nome} atingida`);
      return;
    }
    setUltimoProduto(p);
    setCart((c) => {
      const ex = c.find((i) => i.produto.id === p.id);
      if (ex) return c.map((i) => (i.produto.id === p.id ? { ...i, qtd: i.qtd + 1 } : i));
      return [...c, { produto: p, qtd: 1 }];
    });
  };

  const adicionarPorCodigo = (valor: string) => {
    const c = valor.trim();
    if (!c) return;
    (async () => {
      try {
        const p = await produtoApi.buscar(c, 'mercado');
        adicionar(p);
        toast('success', `${p.nome} adicionado`);
      } catch {
        const local = produtos.find((x) => x.codigo_interno === c);
        if (local) adicionar(local);
        else toast('error', `Código ${c} não encontrado`);
      }
      setCodigo('');
      bipRef.current?.focus();
    })();
  };

  const adicionarCodigo = (e: React.FormEvent) => {
    e.preventDefault();
    adicionarPorCodigo(codigo);
  };

  useBarcodeScanner(adicionarPorCodigo, { enabled: !pagar && !comprovante });

  const mudarQtd = (id: number, delta: number) => {
    const item = cart.find((i) => i.produto.id === id);
    if (item && delta > 0 && item.qtd >= disponivel(item.produto)) return;
    if (item) setUltimoProduto(item.produto);
    setCart((c) =>
      c
        .map((i) => (i.produto.id === id ? { ...i, qtd: i.qtd + delta } : i))
        .filter((i) => i.qtd > 0)
    );
  };

  const somaPagamentos = pgFormas.reduce((s, f) => s + Number(f.valor || 0), 0);
  const reducoes = useMemo(() => {
    if (!vendaReaberta) return [];
    return (vendaReaberta.itens || []).map((antigo) => {
      const atual = cart.find((i) => i.produto.id === antigo.produto_id)?.qtd || 0;
      return { produto_id: Number(antigo.produto_id), nome: antigo.nome, quantidade: antigo.quantidade - atual };
    }).filter((i) => i.quantidade > 0);
  }, [vendaReaberta, cart]);

  const lembrarGarcom = (nome: string) => {
    if (!nome.trim()) return;
    setGarcons((prev) => {
      const next = [nome.trim(), ...prev.filter((g) => g.toLowerCase() !== nome.trim().toLowerCase())].slice(0, 10);
      localStorage.setItem('simplesx_garcons', JSON.stringify(next));
      return next;
    });
  };

  const finalizar = async () => {
    if (!cart.length) return;
    if (vendaReaberta && justificativa.trim().length < 5) {
      toast('error', 'Informe a justificativa da alteração');
      return;
    }
    if (vendaReaberta && reducoes.some((r) => !motivosReducao[r.produto_id])) {
      toast('error', 'Informe o destino de cada produto reduzido ou excluído');
      return;
    }
    setSalvando(true);
    try {
      const pagamentos = pgFormas.filter((f) => Number(f.valor) > 0);
      const itens = cart.map((i) => ({ produto_id: i.produto.id, quantidade: i.qtd }));
      const pagamentosNorm = pagamentos.map((f) => ({ forma: f.forma, valor: Number(f.valor) }));
      const r: any = vendaReaberta
        ? await vendaApi.ajustar(vendaReaberta.id, {
            itens, pagamentos: pagamentosNorm, desconto: descValor,
            responsavel: responsavel || undefined, justificativa: justificativa.trim(),
            reducoes: reducoes.map((x) => ({ produto_id: x.produto_id, motivo: motivosReducao[x.produto_id] })),
          })
        : await vendaApi.criar({
            itens, pagamentos: pagamentosNorm.length ? pagamentosNorm : undefined,
            forma: 'dinheiro', desconto: descValor, responsavel: responsavel || undefined,
          });
      const recibo = vendaReaberta ? {
        ...r, venda_id: r.id,
        itens: (r.itens || []).map((i: any) => ({ ...i, qtd: i.quantidade, preco: i.preco_unitario })),
      } : r;
      setComprovante(recibo);
      if (r.nfce_erro) toast('error', `Venda concluída, mas a NFC-e ficou pendente: ${r.nfce_erro}`);
      setPagar(false);
      setCart([]);
      setDesconto('');
      setPgFormas([{ forma: 'dinheiro', valor: '' }]);
      if (vendaReaberta) {
        produtoApi.list(undefined, 'mercado').then(setProdutos).catch(() => {});
      } else {
        setProdutos((prev) =>
          prev.map((p) => {
            const it = cart.find((i) => i.produto.id === p.id);
            if (!it) return p;
            return p.tipo === 'composto'
              ? { ...p, estoque_possivel: (p.estoque_possivel ?? 0) - it.qtd }
              : { ...p, estoque_atual: p.estoque_atual - it.qtd };
          })
        );
      }
      toast('success', vendaReaberta ? `Venda ${r.numero} ajustada e concluída` : `Venda ${r.numero} concluída`);
      lembrarGarcom(responsavel);
      setVendaReaberta(null);
      setJustificativa('');
      setMotivosReducao({});
    } catch (e: any) {
      toast('error', e?.error || 'Erro ao finalizar venda');
    } finally {
      setSalvando(false);
    }
  };

  const carregarVendaReaberta = async (vendaId: number) => {
    setSalvando(true);
    try {
      const venda = await vendaApi.reabrir(vendaId);
      const itensCart: CartItem[] = [];
      for (const item of venda.itens || []) {
        if (!item.produto_id) continue;
        const produto = produtos.find((p) => p.id === item.produto_id) || await produtoApi.get(item.produto_id);
        itensCart.push({ produto, qtd: item.quantidade });
      }
      setVendaReaberta(venda);
      setCart(itensCart);
      setDesconto(String(venda.desconto || ''));
      setResponsavel(venda.responsavel || '');
      setComprovante(null);
      toast('success', `Venda ${venda.numero} reaberta para conferência`);
    } catch (e: any) {
      toast('error', e?.error || 'Erro ao reabrir a venda');
    } finally {
      setSalvando(false);
    }
  };

  const reabrirVenda = () => {
    if (comprovante?.venda_id) carregarVendaReaberta(comprovante.venda_id);
  };

  useEffect(() => {
    const vendaId = Number(new URLSearchParams(window.location.search).get('reabrir'));
    if (!vendaId || !produtos.length || reaberturaUrlIniciada.current) return;
    reaberturaUrlIniciada.current = true;
    window.history.replaceState({}, '', window.location.pathname);
    carregarVendaReaberta(vendaId);
  }, [produtos]);

  const abrirPagamento = () => {
    const resto = total;
    setPgFormas([{ forma: 'dinheiro', valor: resto > 0 ? String(resto.toFixed(2)) : '' }]);
    setTroco(0);
    setPagar(true);
  };

  useEffect(() => {
    const atalhos = (e: KeyboardEvent) => {
      if (e.key === 'F2' && cart.length && !pagar && !comprovante) {
        e.preventDefault();
        abrirPagamento();
      }
      if (e.key === 'Escape' && pagar) setPagar(false);
    };
    window.addEventListener('keydown', atalhos);
    return () => window.removeEventListener('keydown', atalhos);
  }, [cart, pagar, comprovante, total]);

  const produtosFiltrados = useMemo(() => {
    const f = filtro.toLowerCase();
    return produtos
      .filter((p) => p.ativo)
      .filter((p) => !f || p.nome.toLowerCase().includes(f) || p.codigo_interno.toLowerCase().includes(f))
      .slice(0, 30);
  }, [produtos, filtro]);

  return (
    <AnimatedPage>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-800">PDV Mercado</h1>
          <p className="text-sm text-slate-500">{vendaReaberta ? `Ajustando a venda ${vendaReaberta.numero}` : 'Passe o código, finalize e receba o pagamento'}</p>
        </div>
        {config && (
          <Badge color={config.modo === 'estoque' ? 'blue' : 'brand'}>
            {config.modo === 'estoque' ? 'Modo Controle de Estoque' : 'Modo Mercado'}
          </Badge>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* Left: products */}
        <div className="lg:col-span-3">
          <Card className="mb-4 overflow-hidden border-slate-800 bg-slate-900 p-0">
            <div className="flex items-center justify-between border-b border-slate-700 px-4 py-2 text-white">
              <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest"><ScanBarcode className="h-4 w-4 text-emerald-400" /> Leitor de caixa</span>
              <span className="text-[11px] text-slate-400">ENTER adiciona · F2 recebe</span>
            </div>
            <div className="p-4">
            <form onSubmit={adicionarCodigo} className="flex gap-2">
              <div className="relative flex-1">
                <ScanBarcode className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-brand-500" />
                <Input
                  ref={bipRef as any}
                  className="h-14 border-slate-600 bg-white pl-10 font-mono text-lg font-bold"
                  placeholder="Bipe ou digite o código do produto"
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value)}
                />
              </div>
              <Button type="submit" className="h-14 px-5">Adicionar</Button>
            </form>
            {ultimoProduto ? (
              <motion.div key={ultimoProduto.id} initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} className="mt-3 flex items-center justify-between rounded-xl bg-emerald-400 px-4 py-3 text-emerald-950">
                <div className="flex min-w-0 items-center gap-3">
                  <PackageCheck className="h-7 w-7 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-wider opacity-70">Último produto registrado</p>
                    <p className="truncate text-base font-extrabold">{ultimoProduto.nome}</p>
                    <p className="font-mono text-xs opacity-70">Cód. {ultimoProduto.codigo_interno}</p>
                  </div>
                </div>
                <p className="ml-3 text-2xl font-black">{fmtBRL(ultimoProduto.preco)}</p>
              </motion.div>
            ) : (
              <div className="mt-3 rounded-xl border border-dashed border-slate-600 py-4 text-center text-sm text-slate-400">Caixa livre — aguardando o primeiro produto</div>
            )}
            <div className="relative mt-3">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input className="border-slate-600 bg-slate-800 pl-9 text-white placeholder:text-slate-500" placeholder="Buscar produto pelo nome..." value={filtro} onChange={(e) => setFiltro(e.target.value)} />
            </div>
            </div>
          </Card>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            <AnimatePresence initial={false}>
              {produtosFiltrados.map((p) => (
                <motion.button
                  key={p.id}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.15 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => adicionar(p)}
                  disabled={disponivel(p) <= 0}
                  className={`card flex flex-col items-start gap-1 p-3 text-left transition-colors ${
                    disponivel(p) <= 0 ? 'opacity-50' : 'hover:border-brand-300 hover:bg-brand-50/40'
                  }`}
                >
                  <p className="line-clamp-2 text-sm font-bold leading-snug text-slate-800">{p.nome}</p>
                  <p className="text-[11px] text-slate-400">
                    {p.tipo === 'composto'
                      ? `disponível p/ ${fmtNum(disponivel(p))} un`
                      : `estoque ${fmtNum(disponivel(p))} ${p.unidade}`}
                  </p>
                  <p className="text-base font-extrabold text-brand-600">{p.preco != null ? fmtBRL(p.preco) : '—'}</p>
                </motion.button>
              ))}
            </AnimatePresence>
            {produtosFiltrados.length === 0 && (
              <div className="col-span-full">
                <EmptyState icon={<ScanBarcode className="h-8 w-8" />} title="Nenhum produto para vender" subtitle="Cadastre produtos no Estoque" />
              </div>
            )}
          </div>
        </div>

        {/* Right: cart */}
        <div className="lg:col-span-2">
          <Card className="md:sticky md:top-4 flex flex-col overflow-hidden p-0" >
            <div className="flex items-center justify-between bg-slate-800 px-4 py-3 text-white">
              <h2 className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide"><ShoppingCart className="h-4 w-4 text-emerald-400" /> Cupom da venda</h2>
              <span className="rounded-full bg-slate-700 px-2.5 py-1 text-xs font-bold">{fmtNum(totalItens, 0)} itens</span>
            </div>
            <div className="grid grid-cols-[1fr_auto] border-b border-slate-200 bg-slate-50 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              <span>Descrição</span><span>Total</span>
            </div>
            <div className="max-h-[390px] min-h-48 flex-1 divide-y divide-dashed divide-slate-200 overflow-y-auto">
              {cart.length === 0 && (
                <div className="grid min-h-48 place-items-center px-6 text-center text-sm text-slate-400"><div><ShoppingCart className="mx-auto mb-2 h-9 w-9 text-slate-300" /><p>Nenhum produto lançado</p><p className="text-xs">Os itens aparecerão aqui conforme forem bipados</p></div></div>
              )}
              <AnimatePresence initial={false}>
                {cart.map((i, index) => (
                  <motion.div
                    key={i.produto.id}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.15 }}
                    className="grid grid-cols-[1fr_auto] gap-3 px-4 py-3 hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-800"><span className="mr-2 font-mono text-xs text-slate-400">{String(index + 1).padStart(3, '0')}</span>{i.produto.nome}</p>
                      <p className="mt-0.5 font-mono text-[10px] text-slate-400">{i.produto.codigo_interno}</p>
                      <p className="mt-1 text-xs font-semibold text-slate-500">{fmtNum(i.qtd)} {i.produto.unidade} × {fmtBRL(i.produto.preco)}</p>
                    </div>
                    <div className="flex flex-col items-end justify-between gap-2">
                      <p className="text-base font-extrabold text-slate-800">{fmtBRL(Number(i.produto.preco) * i.qtd)}</p>
                      <div className="flex items-center gap-1.5">
                      <button onClick={() => mudarQtd(i.produto.id, -1)} className="rounded-lg bg-white p-1 shadow-sm hover:bg-slate-100">
                        <Minus className="h-3.5 w-3.5 text-slate-600" />
                      </button>
                      <span className="w-7 text-center text-sm font-bold">{i.qtd}</span>
                      <button
                        onClick={() => mudarQtd(i.produto.id, 1)}
                        disabled={i.qtd >= disponivel(i.produto)}
                        className="rounded-lg bg-white p-1 shadow-sm hover:bg-slate-100 disabled:opacity-40"
                      >
                        <Plus className="h-3.5 w-3.5 text-slate-600" />
                      </button>
                      <button onClick={() => setCart((c) => c.filter((x) => x.produto.id !== i.produto.id))} className="rounded-lg p-1 text-red-500 hover:bg-red-50">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            <div className="space-y-2 border-t border-slate-200 bg-slate-50 p-4">
              <div className="flex justify-between text-sm text-slate-500">
                <span>Subtotal</span>
                <span>{fmtBRL(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between gap-2 text-sm text-slate-500">
                <span>Desconto</span>
                <Input type="number" step="0.01" className="w-28 !py-1 text-right" value={desconto} onChange={(e) => setDesconto(e.target.value)} placeholder="0,00" />
              </div>
              <div className="flex items-center justify-between rounded-xl bg-slate-800 px-4 py-3 text-white">
                <span className="text-sm font-bold uppercase tracking-wider">Total a pagar</span>
                <span className="text-3xl font-black text-emerald-400">{fmtBRL(total)}</span>
              </div>
              <Field label="Responsável (opcional)">
                <Input value={responsavel} onChange={(e) => setResponsavel(e.target.value)} list="garcons-list" />
                <datalist id="garcons-list">
                  {garcons.map((g) => (
                    <option key={g} value={g} />
                  ))}
                </datalist>
              </Field>
              <Button size="lg" className="w-full" disabled={!cart.length} onClick={abrirPagamento} icon={<Wallet className="h-5 w-5" />}>
                Receber pagamento · F2
              </Button>
            </div>
          </Card>
        </div>
      </div>

      {/* Pagamento */}
      <Modal open={pagar} onClose={() => setPagar(false)} title="Pagamento" width="max-w-md">
        <div className="space-y-4">
          <div className="rounded-xl bg-slate-50 p-3 text-center">
            <p className="text-xs text-slate-400">Total da venda</p>
            <p className="text-3xl font-extrabold text-brand-600">{fmtBRL(total)}</p>
          </div>

          <div className="space-y-2">
            {pgFormas.map((pg, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  className="input w-36"
                  value={pg.forma}
                  onChange={(e) => setPgFormas((fs) => fs.map((f, j) => (j === i ? { ...f, forma: e.target.value } : f)))}
                >
                  {FORMAS_PAGAMENTO.map((f) => (
                    <option key={f.valor} value={f.valor}>{f.label}</option>
                  ))}
                </select>
                <Input
                  type="number"
                  step="0.01"
                  className="flex-1 text-right"
                  placeholder="valor"
                  value={pg.valor}
                  onChange={(e) => setPgFormas((fs) => fs.map((f, j) => (j === i ? { ...f, valor: e.target.value } : f)))}
                />
                {i === 0 && pgFormas.length < 3 && (
                  <Button size="sm" variant="secondary" onClick={() => setPgFormas((fs) => [...fs, { forma: 'pix', valor: '' }])}>
                    +
                  </Button>
                )}
                {i > 0 && (
                  <Button size="sm" variant="ghost" onClick={() => setPgFormas((fs) => fs.filter((_, j) => j !== i))}>
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between rounded-xl bg-emerald-50 p-3">
            <span className="text-sm font-semibold text-emerald-700">Troco</span>
            <span className="text-xl font-extrabold text-emerald-700">{fmtBRL(Math.max(0, somaPagamentos - total))}</span>
          </div>

          {vendaReaberta && (
            <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-bold text-amber-800">Justificativa obrigatória pós-fechamento</p>
              <Textarea rows={3} placeholder="Descreva por que a venda foi alterada..." value={justificativa} onChange={(e) => setJustificativa(e.target.value)} />
              {reducoes.map((r) => (
                <Field key={r.produto_id} label={`${r.nome} · ${fmtNum(r.quantidade)} removido(s)`}>
                  <select className="input" value={motivosReducao[r.produto_id] || ''} onChange={(e) => setMotivosReducao((m) => ({ ...m, [r.produto_id]: e.target.value as any }))}>
                    <option value="">Selecione o motivo</option>
                    <option value="nao_pago">Produto não pago — registrar em perdas</option>
                    <option value="duplicado_nao_vendido">Duplicado / não vendido — devolver ao estoque</option>
                  </select>
                </Field>
              ))}
            </div>
          )}

          <Button size="lg" className="w-full" disabled={somaPagamentos + 0.005 < total} loading={salvando} onClick={finalizar}>
            Confirmar venda
          </Button>
          {somaPagamentos + 0.005 < total && (
            <p className="text-center text-xs text-red-500">Faltam {fmtBRL(total - somaPagamentos)} para cobrir a venda</p>
          )}
        </div>
      </Modal>

      {/* Comprovante */}
      <Modal open={!!comprovante} onClose={() => setComprovante(null)} title="Cupom da venda" width="max-w-md">
        {comprovante && (
          <div>
            <div ref={comprovanteRef} className="mx-auto w-72 rounded-sm border border-slate-300 bg-white p-4 font-mono text-[11px] leading-4 shadow-sm">
              <div className="text-center">
                <p className="text-sm font-black uppercase">{config?.empresa_nome || 'MEU NEGÓCIO'}</p>
                <p className="mt-1 text-[10px] uppercase tracking-widest text-slate-500">{comprovante.nfce ? 'NFC-e em homologação — sem valor fiscal' : 'Documento auxiliar de venda'}</p>
                {comprovante.nfce?.chave_acesso && <p className="mt-1 break-all font-mono text-[8px] text-slate-400">{comprovante.nfce.chave_acesso}</p>}
                <p className="font-bold">CUPOM NÃO FISCAL</p>
              </div>
              <div className="my-2 border-t border-dashed border-slate-400" />
              <p className="flex justify-between"><span>VENDA</span><b>{comprovante.numero}</b></p>
              <p className="flex justify-between"><span>EMISSÃO</span><span>{new Date().toLocaleString('pt-BR')}</span></p>
              {responsavel && <p className="flex justify-between"><span>OPERADOR</span><span className="max-w-36 truncate">{responsavel}</span></p>}
              <div className="my-2 border-t border-dashed border-slate-400" />
              <div className="grid grid-cols-[1fr_auto] gap-2 text-[9px] font-bold uppercase">
                <span>Item / Qtd × Unitário</span><span>Valor</span>
              </div>
              <div className="my-1 border-t border-dashed border-slate-300" />
              {comprovante.itens.map((it: any, i: number) => (
                <div key={i} className="mb-1">
                  <p className="truncate"><span className="mr-1 text-slate-400">{String(i + 1).padStart(3, '0')}</span>{it.nome}</p>
                  <p className="flex justify-between gap-2 pl-5 text-slate-600">
                    <span>{fmtNum(it.qtd)} × {fmtBRL(it.preco)}</span>
                    <b className="text-slate-900">{fmtBRL(it.total)}</b>
                  </p>
                </div>
              ))}
              <div className="my-2 border-t border-dashed border-slate-400" />
              <p className="flex justify-between"><span>ITENS</span><span>{fmtNum(comprovante.itens.reduce((s: number, it: any) => s + Number(it.qtd), 0), 0)}</span></p>
              <p className="flex justify-between"><span>Subtotal</span><span>{fmtBRL(comprovante.subtotal)}</span></p>
              {comprovante.desconto > 0 && <p className="flex justify-between"><span>Desconto</span><span>-{fmtBRL(comprovante.desconto)}</span></p>}
              <p className="mt-1 flex justify-between border-y border-dashed border-slate-400 py-1 text-sm font-black"><span>TOTAL R$</span><span>{fmtBRL(comprovante.total)}</span></p>
              {comprovante.pagamentos.map((pg: any, i: number) => (
                <p key={i} className="flex justify-between"><span>{formaLabel(pg.forma).toUpperCase()}</span><span>{fmtBRL(pg.valor)}</span></p>
              ))}
              {comprovante.pagamentos.reduce((s: number, pg: any) => s + Number(pg.valor), 0) > comprovante.total && (
                <p className="flex justify-between font-bold"><span>TROCO</span><span>{fmtBRL(comprovante.pagamentos.reduce((s: number, pg: any) => s + Number(pg.valor), 0) - comprovante.total)}</span></p>
              )}
              <div className="my-2 border-t border-dashed border-slate-400" />
              <p className="text-center font-bold">OBRIGADO PELA PREFERÊNCIA!</p>
              <p className="text-center text-[9px] text-slate-500">Confira seus produtos antes de sair do caixa</p>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setComprovante(null)}>Fechar</Button>
              <Button variant="secondary" loading={salvando} icon={<RotateCcw className="h-4 w-4" />} onClick={reabrirVenda}>Reabrir venda</Button>
              <Button icon={<Printer className="h-4 w-4" />} onClick={imprimirComprovante}>Imprimir</Button>
            </div>
          </div>
        )}
      </Modal>
    </AnimatedPage>
  );
}
