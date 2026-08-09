import { useEffect, useMemo, useRef, useState } from 'react';
import { ScanBarcode, Plus, Minus, Trash2, Search, Printer, X, Wallet, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { AnimatedPage } from '@/components/anim';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, useToast } from '@/components/ui';
import { produtoApi, vendaApi, configApi } from '@/lib/api';
import type { Produto, ConfigEmpresa } from '@/lib/types';
import { fmtBRL, fmtNum, FORMAS_PAGAMENTO, formaLabel } from '@/lib/format';
import { printReceipt } from '@/lib/print';

interface CartItem {
  produto: Produto;
  qtd: number;
}

export function PdvPage() {
  const toast = useToast();
  const [config, setConfig] = useState<ConfigEmpresa | null>(null);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [codigo, setCodigo] = useState('');
  const [garcons, setGarcons] = useState<string[]>([]);

  useEffect(() => {
    try {
      setGarcons(JSON.parse(localStorage.getItem('simplesx_garcons') || '[]'));
    } catch {
      /* ignore */
    }
  }, []);
  const [filtro, setFiltro] = useState('');
  const [responsavel, setResponsavel] = useState('');
  const [desconto, setDesconto] = useState('');
  const [pagar, setPagar] = useState(false);
  const [pgFormas, setPgFormas] = useState<{ forma: string; valor: string }[]>([{ forma: 'dinheiro', valor: '' }]);
  const [troco, setTroco] = useState(0);
  const [comprovante, setComprovante] = useState<any>(null);
  const [salvando, setSalvando] = useState(false);
  const bipRef = useRef<HTMLInputElement>(null);
  const comprovanteRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const coarse = window.matchMedia?.('(pointer: coarse)')?.matches;
    if (!coarse) bipRef.current?.focus();
    configApi.get().then(setConfig).catch(() => {});
    produtoApi.list(undefined, 'mercado').then(setProdutos).catch(() => {});
  }, []);

  const subtotal = useMemo(() => cart.reduce((s, i) => s + i.produto.preco! * i.qtd, 0), [cart]);
  const descValor = useMemo(() => Math.min(Number(desconto || 0), subtotal), [desconto, subtotal]);
  const total = Math.max(0, subtotal - descValor);

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
    setCart((c) => {
      const ex = c.find((i) => i.produto.id === p.id);
      if (ex) return c.map((i) => (i.produto.id === p.id ? { ...i, qtd: i.qtd + 1 } : i));
      return [...c, { produto: p, qtd: 1 }];
    });
  };

  const adicionarCodigo = (e: React.FormEvent) => {
    e.preventDefault();
    const c = codigo.trim();
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

  const mudarQtd = (id: number, delta: number) => {
    setCart((c) =>
      c
        .map((i) => (i.produto.id === id ? { ...i, qtd: i.qtd + delta } : i))
        .filter((i) => i.qtd > 0)
    );
  };

  const somaPagamentos = pgFormas.reduce((s, f) => s + Number(f.valor || 0), 0);

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
    setSalvando(true);
    try {
      const pagamentos = pgFormas.filter((f) => Number(f.valor) > 0);
      const r = await vendaApi.criar({
        itens: cart.map((i) => ({ produto_id: i.produto.id, quantidade: i.qtd })),
        pagamentos: pagamentos.length ? pagamentos.map((f) => ({ forma: f.forma, valor: Number(f.valor) })) : undefined,
        forma: 'dinheiro',
        desconto: descValor,
        responsavel: responsavel || undefined,
      });
      setComprovante(r);
      setPagar(false);
      setCart([]);
      setDesconto('');
      setPgFormas([{ forma: 'dinheiro', valor: '' }]);
      setProdutos((prev) =>
        prev.map((p) => {
          const it = cart.find((i) => i.produto.id === p.id);
          if (!it) return p;
          return p.tipo === 'composto'
            ? { ...p, estoque_possivel: (p.estoque_possivel ?? 0) - it.qtd }
            : { ...p, estoque_atual: p.estoque_atual - it.qtd };
        })
      );
      toast('success', `Venda ${r.numero} concluída`);
      lembrarGarcom(responsavel);
    } catch (e: any) {
      toast('error', e?.error || 'Erro ao finalizar venda');
    } finally {
      setSalvando(false);
    }
  };

  const abrirPagamento = () => {
    const resto = total;
    setPgFormas([{ forma: 'dinheiro', valor: resto > 0 ? String(resto.toFixed(2)) : '' }]);
    setTroco(0);
    setPagar(true);
  };

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
          <p className="text-sm text-slate-500">Passe o código, finalize e receba o pagamento</p>
        </div>
        {config && (
          <Badge color={config.modo === 'estoque' ? 'blue' : 'brand'}>
            {config.modo === 'estoque' ? 'Modo Controle de Estoque' : 'Modo Mercado'}
          </Badge>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left: products */}
        <div className="lg:col-span-2">
          <Card className="mb-4 p-4">
            <form onSubmit={adicionarCodigo} className="flex gap-2">
              <div className="relative flex-1">
                <ScanBarcode className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-brand-500" />
                <Input
                  ref={bipRef as any}
                  className="h-12 pl-10 font-mono text-base"
                  placeholder="Passe o código de barras e tecle ENTER"
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value)}
                />
              </div>
              <Button type="submit" className="h-12 px-5">Adicionar</Button>
            </form>
            <div className="relative mt-3">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input className="pl-9" placeholder="Filtrar produtos..." value={filtro} onChange={(e) => setFiltro(e.target.value)} />
            </div>
          </Card>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
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
        <div>
          <Card className="md:sticky md:top-4 flex flex-col p-4" >
            <h2 className="mb-3 text-sm font-bold text-slate-700">Carrinho</h2>
            <div className="max-h-72 flex-1 space-y-2 overflow-y-auto pr-1">
              {cart.length === 0 && (
                <p className="py-8 text-center text-sm text-slate-400">Nenhum item no carrinho</p>
              )}
              <AnimatePresence initial={false}>
                {cart.map((i) => (
                  <motion.div
                    key={i.produto.id}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.15 }}
                    className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-700">{i.produto.nome}</p>
                      <p className="text-[11px] text-slate-400">
                        {fmtBRL(i.produto.preco)} · {i.produto.tipo === 'composto' ? `disponível p/ ${fmtNum(disponivel(i.produto))} un` : `estoque ${fmtNum(disponivel(i.produto))} ${i.produto.unidade}`}
                      </p>
                    </div>
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
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
              <div className="flex justify-between text-sm text-slate-500">
                <span>Subtotal</span>
                <span>{fmtBRL(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between gap-2 text-sm text-slate-500">
                <span>Desconto</span>
                <Input type="number" step="0.01" className="w-28 !py-1 text-right" value={desconto} onChange={(e) => setDesconto(e.target.value)} placeholder="0,00" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-slate-700">Total</span>
                <span className="text-2xl font-extrabold text-brand-600">{fmtBRL(total)}</span>
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
                Finalizar ({fmtBRL(total)})
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

          <Button size="lg" className="w-full" disabled={somaPagamentos + 0.005 < total} loading={salvando} onClick={finalizar}>
            Confirmar venda
          </Button>
          {somaPagamentos + 0.005 < total && (
            <p className="text-center text-xs text-red-500">Faltam {fmtBRL(total - somaPagamentos)} para cobrir a venda</p>
          )}
        </div>
      </Modal>

      {/* Comprovante */}
      <Modal open={!!comprovante} onClose={() => setComprovante(null)} title="Comprovante" width="max-w-sm">
        {comprovante && (
          <div>
            <div ref={comprovanteRef} className="mx-auto w-64 rounded-lg border-2 border-dashed border-slate-300 bg-white p-3 font-mono text-[11px] leading-4">
              <p className="text-center font-bold">{config?.empresa_nome || 'MEU NEGÓCIO'}</p>
              <p className="text-center text-slate-500">CUPOM NÃO FISCAL</p>
              <p className="text-center">{comprovante.numero}</p>
              <div className="my-1 border-t border-dashed border-slate-300" />
              {comprovante.itens.map((it: any, i: number) => (
                <p key={i} className="flex justify-between gap-2">
                  <span className="truncate">{it.qtd}x {it.nome}</span>
                  <span>{fmtBRL(it.total)}</span>
                </p>
              ))}
              <div className="my-1 border-t border-dashed border-slate-300" />
              <p className="flex justify-between"><span>Subtotal</span><span>{fmtBRL(comprovante.subtotal)}</span></p>
              {comprovante.desconto > 0 && <p className="flex justify-between"><span>Desconto</span><span>-{fmtBRL(comprovante.desconto)}</span></p>}
              <p className="flex justify-between font-bold"><span>TOTAL</span><span>{fmtBRL(comprovante.total)}</span></p>
              {comprovante.pagamentos.map((pg: any, i: number) => (
                <p key={i} className="flex justify-between"><span>{formaLabel(pg.forma)}</span><span>{fmtBRL(pg.valor)}</span></p>
              ))}
              <p className="mt-1 text-center text-slate-500">{new Date().toLocaleString('pt-BR')}</p>
              <p className="text-center">Obrigado pela preferência!</p>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setComprovante(null)}>Fechar</Button>
              <Button icon={<Printer className="h-4 w-4" />} onClick={() => printReceipt(comprovanteRef.current)}>Imprimir</Button>
            </div>
          </div>
        )}
      </Modal>
    </AnimatedPage>
  );
}
