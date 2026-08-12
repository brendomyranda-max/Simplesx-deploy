import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  UserPlus,
  Plus,
  Minus,
  ScanBarcode,
  Printer,
  Send,
  CheckCheck,
  Trash2,
  HandCoins,
  Users,
  Search,
  Pencil,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { AnimatedPage } from '@/components/anim';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Spinner, useConfirm, useToast } from '@/components/ui';
import { comandaApi, mesaApi, produtoApi, impressoraApi, configApi } from '@/lib/api';
import type { Comanda, Produto, ComandaItem } from '@/lib/types';
import { fmtBRL, fmtNum, fmtHora, FORMAS_PAGAMENTO, formaLabel } from '@/lib/format';
import { printReceipt } from '@/lib/print';

const CORES = ['#6366f1', '#16a34a', '#f59e0b', '#ec4899', '#0ea5e9', '#ef4444'];

export function ComandaPage() {
  const { id } = useParams();
  const comandaId = Number(id);
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();

  const [comanda, setComanda] = useState<Comanda | null>(null);
  const [load, setLoad] = useState(true);
  const [pessoaSel, setPessoaSel] = useState<number | 'geral'>('geral');
  const [codigo, setCodigo] = useState('');
  const [filtro, setFiltro] = useState('');
  const [setor, setSetor] = useState('Cozinha');
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [setores, setSetores] = useState<string[]>(['Cozinha', 'Bar', 'Salão', 'Padaria', 'Etiquetas']);
  const [nomePessoa, setNomePessoa] = useState('');
  const [addPessoaAberto, setAddPessoaAberto] = useState(false);
  const [editPessoaId, setEditPessoaId] = useState<number | null>(null);
  const [editPessoaNome, setEditPessoaNome] = useState('');
  const [fechar, setFechar] = useState(false);
  const [baixar, setBaixar] = useState(false);
  const [tipo, setTipo] = useState<'unica' | 'divisao' | 'individual'>('unica');
  const [taxa, setTaxa] = useState('');
  const [forma, setForma] = useState('dinheiro');
  const [finalizando, setFinalizando] = useState(false);
  const [enviandoCozinha, setEnviandoCozinha] = useState(false);
  const [imprimir, setImprimir] = useState<{ impressao: string; setor: string } | null>(null);
  const [addProduto, setAddProduto] = useState<Produto | null>(null);
  const [editandoItem, setEditandoItem] = useState<ComandaItem | null>(null);
  const [addQtd, setAddQtd] = useState(1);
  const [addObsSel, setAddObsSel] = useState<string[]>([]);
  const [addCustom, setAddCustom] = useState('');
  const [adicionando, setAdicionando] = useState(false);
  const [valoresIndiv, setValoresIndiv] = useState<Record<string, string>>({});
  const bipRef = useRef<HTMLInputElement>(null);
  const impressaoRef = useRef<HTMLDivElement>(null);

  const loadComanda = async () => {
    try {
      const c = await comandaApi.get(comandaId);
      setComanda(c);
      if (!taxa) setTaxa(String(c.taxa_garcom_pct || 0));
    } catch (e: any) {
      toast('error', e?.error || 'Erro ao carregar comanda');
    } finally {
      setLoad(false);
    }
  };

  useEffect(() => {
    loadComanda();
    produtoApi.list(undefined, 'restaurante').then(setProdutos).catch(() => {});
    impressoraApi.setores().then((s) => setSetores(s.map((x) => x.nome))).catch(() => {});
    const iv = setInterval(loadComanda, 20000);
    return () => clearInterval(iv);
  }, [comandaId]);

  const pessoas = comanda?.pessoas || [];
  const itens = comanda?.itens || [];
  const ativos = itens.filter((i) => i.status !== 'cancelado');
  const itensNovos = ativos.filter((i) => i.status === 'novo');
  const subtotal = useMemo(() => ativos.reduce((s, i) => s + Number(i.quantidade) * Number(i.preco_unitario), 0), [ativos]);

  const nomePessoaDe = (pessoaId: number | null) => {
    if (!pessoaId) return null;
    return pessoas.find((p) => p.id === pessoaId) || null;
  };

  const abrirAdicionar = (p: Produto) => {
    setEditandoItem(null);
    setAddProduto(p);
    setAddQtd(1);
    setAddObsSel([]);
    setAddCustom('');
    setAdicionando(false);
  };

  const abrirEditarItem = async (item: ComandaItem) => {
    if (locked || item.status !== 'novo' || !item.produto_id) return;
    try {
      const produtoCompleto = produtos.find((p) => p.id === item.produto_id) || await produtoApi.get(item.produto_id);
      const automaticas = produtoCompleto.comentarios || [];
      const atuais = String(item.observacao || '').split(',').map((o) => o.trim()).filter(Boolean);
      setEditandoItem(item);
      setAddProduto(produtoCompleto);
      setAddQtd(Number(item.quantidade));
      setAddObsSel(automaticas.filter((o) => atuais.includes(o)));
      setAddCustom(atuais.filter((o) => !automaticas.includes(o)).join(', '));
      setAdicionando(false);
    } catch (e: any) {
      toast('error', e?.error || 'Erro ao abrir o produto');
    }
  };

  const toggleObs = (o: string) =>
    setAddObsSel((prev) => (prev.includes(o) ? prev.filter((x) => x !== o) : [...prev, o]));

  const confirmarAdicao = async () => {
    if (!addProduto) return;
    const observacao = [...addObsSel, addCustom.trim()].filter(Boolean).join(', ') || undefined;
    setAdicionando(true);
    try {
      if (editandoItem) {
        await comandaApi.updateItem(comandaId, editandoItem.id, { observacao });
        toast('success', `Observações de ${addProduto.nome} atualizadas`);
        setAddProduto(null);
        setEditandoItem(null);
        loadComanda();
        return;
      }
      await comandaApi.addItem(comandaId, {
        produto_id: addProduto.id,
        quantidade: addQtd,
        pessoa_id: pessoaSel === 'geral' ? undefined : pessoaSel,
        observacao,
        responsavel: comanda?.garcom_nome || undefined,
      });
      toast('success', `${addQtd}x ${addProduto.nome} adicionado`);
      setAddProduto(null);
      loadComanda();
    } catch (e: any) {
      toast('error', e?.error || 'Erro ao adicionar');
    } finally {
      setAdicionando(false);
    }
  };

  const adicionarCodigo = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = codigo.trim();
    if (!c) return;
    try {
      const p = await produtoApi.buscar(c, 'restaurante');
      abrirAdicionar(p);
      toast('success', `${p.nome} localizado`);
    } catch {
      toast('error', `Código ${c} não encontrado`);
    }
    setCodigo('');
    bipRef.current?.focus();
  };

  const mudarStatus = async (item: ComandaItem, status: string) => {
    if (status === 'cancelado') {
      confirm('Cancelar item?', `"${item.nome}" será cancelado${item.criado_em ? ' (após o tempo limite vira perda)' : ''}.`, async () => {
        await comandaApi.itemStatus(comandaId, item.id, status, comanda?.garcom_nome || undefined);
        loadComanda();
      });
      return;
    }
    await comandaApi.itemStatus(comandaId, item.id, status, comanda?.garcom_nome || undefined);
    loadComanda();
  };

  const imprimirComanda = async () => {
    try {
      const r = await impressoraApi.imprimirComanda(comandaId, { setor });
      setImprimir(r);
      loadComanda();
      if (r.sem_rota?.length) toast('error', `${r.sem_rota.length} item(ns) sem impressora configurada: ${r.sem_rota.join(', ')}`);
      else if (r.falhas?.length) toast('error', `Falha em ${r.falhas.map((f) => f.impressora).join(', ')}: ${r.falhas[0].erro}`);
      else toast('success', `${r.jobs?.length || 0} impressão(ões) enviada(s)`);
    } catch (e: any) {
      toast('error', e?.error || 'Erro ao imprimir');
    }
  };

  const salvarNomePessoa = async (p: Comanda['pessoas'][0]) => {
    const nome = editPessoaNome.trim();
    setEditPessoaId(null);
    if (!nome || nome === p.nome) return;
    try {
      await comandaApi.renamePessoa(comandaId, p.id, nome);
      loadComanda();
    } catch (e: any) {
      toast('error', e?.error || 'Erro ao renomear');
    }
  };

  const adicionarPessoa = (e: React.FormEvent) => {
    e.preventDefault();
    const nome = nomePessoa.trim();
    if (!nome) return toast('error', 'Informe o nome');
    comandaApi.addPessoa(comandaId, { nome, cor: CORES[pessoas.length % CORES.length] }).then(() => {
      setNomePessoa('');
      setAddPessoaAberto(false);
      loadComanda();
    });
  };

  const enviarCozinha = async () => {
    if (enviandoCozinha) return;
    setEnviandoCozinha(true);
    try {
      const r = await impressoraApi.imprimirComanda(comandaId, { setor });
      loadComanda();
      if (r.sem_rota?.length) toast('error', `${r.sem_rota.length} item(ns) sem impressora configurada: ${r.sem_rota.join(', ')}`);
      else if (r.falhas?.length) toast('error', `Falha em ${r.falhas.map((f) => f.impressora).join(', ')}: ${r.falhas[0].erro}`);
      else toast('success', `${r.itens} item(ns) enviado(s) para ${r.jobs?.length || 0} impressora(s)`);
    } catch (e: any) {
      toast('error', e?.error || 'Erro ao enviar para a cozinha');
    } finally {
      setEnviandoCozinha(false);
    }
  };

  const totalComTaxa = subtotal + subtotal * (Number(taxa || 0) / 100);

  const divisaoPessoas = Math.max(comanda?.pessoas_count || 1, pessoas.length || 1);

  const grupos = useMemo(() => {
    const out: { key: string; nome: string; cor?: string; itens: ComandaItem[]; subtotal: number }[] = [];
    for (const p of pessoas) {
      const its = ativos.filter((i) => i.pessoa_id === p.id);
      if (its.length)
        out.push({
          key: `p${p.id}`,
          nome: p.nome || `Pessoa ${p.id}`,
          cor: p.cor,
          itens: its,
          subtotal: its.reduce((s, i) => s + Number(i.quantidade) * Number(i.preco_unitario), 0),
        });
    }
    const geral = ativos.filter((i) => !i.pessoa_id);
    if (geral.length)
      out.push({
        key: 'geral',
        nome: 'Conta geral',
        itens: geral,
        subtotal: geral.reduce((s, i) => s + Number(i.quantidade) * Number(i.preco_unitario), 0),
      });
    return out;
  }, [ativos, pessoas]);

  const comTaxa = (v: number) => v + v * (Number(taxa || 0) / 100);

  const iniciaValores = () => {
    const v: Record<string, string> = {};
    for (const p of pessoas) {
      const sub = ativos
        .filter((i) => i.pessoa_id === p.id)
        .reduce((s, i) => s + Number(i.quantidade) * Number(i.preco_unitario), 0);
      v[`p${p.id}`] = comTaxa(sub).toFixed(2);
    }
    const subG = ativos
      .filter((i) => !i.pessoa_id)
      .reduce((s, i) => s + Number(i.quantidade) * Number(i.preco_unitario), 0);
    if (subG > 0) v['geral'] = comTaxa(subG).toFixed(2);
    setValoresIndiv(v);
  };

  const abrirFechamento = () => {
    iniciaValores();
    setFechar(true);
  };

  const totalAplicado = Object.values(valoresIndiv).reduce((s, v) => s + (Number(v) || 0), 0);
  const dif = totalComTaxa - totalAplicado;

  const finalizar = async () => {
    if (!comanda) return;
    setFinalizando(true);
    try {
      const r = await comandaApi.fechar(comandaId, {
        tipo,
        taxa_garcom_pct: Number(taxa || 0),
        forma,
        responsavel: comanda.garcom_nome || undefined,
      });
      toast('success', `Comanda fechada! Total ${fmtBRL(r.total)}`);
      setFechar(false);
      navigate('/restaurante');
    } catch (err: any) {
      toast('error', err?.error || 'Erro ao fechar comanda');
    } finally {
      setFinalizando(false);
    }
  };

  const preFechar = async () => {
    if (!comanda) return;
    setFinalizando(true);
    try {
      const r = await comandaApi.fechar(comandaId, {
        tipo,
        taxa_garcom_pct: Number(taxa || 0),
        forma,
        responsavel: comanda.garcom_nome || undefined,
        pre_fechar: true,
      });
      setFechar(false);
      loadComanda();
      const imp = await impressoraApi.imprimirComanda(comandaId, { setor, tipo: 'conta' });
      setImprimir({ impressao: imp.impressao, setor: imp.setor });
      toast('success', `${r.mensagem || 'Conta pré-fechada'} · ${imp.jobs?.length || 0} impressão(ões) enviada(s)`);
    } catch (err: any) {
      toast('error', err?.error || 'Erro ao pré-fechar');
    } finally {
      setFinalizando(false);
    }
  };

  const abrirBaixa = () => {
    if (!comanda) return;
    setTipo((comanda.fechamento_tipo || 'unica') as 'unica' | 'divisao' | 'individual');
    setBaixar(true);
  };

  const finalizarBaixa = async () => {
    if (!comanda) return;
    setFinalizando(true);
    try {
      const r = await comandaApi.fechar(comandaId, {
        tipo: (comanda.fechamento_tipo || 'unica') as any,
        taxa_garcom_pct: Number(taxa || 0),
        forma,
        responsavel: comanda.garcom_nome || undefined,
      });
      toast('success', `Conta baixada! Total ${fmtBRL(r.total)}`);
      setBaixar(false);
      navigate('/restaurante');
    } catch (err: any) {
      toast('error', err?.error || 'Erro ao baixar conta');
    } finally {
      setFinalizando(false);
    }
  };

  const reabrir = async () => {
    if (!comanda) return;
    try {
      await comandaApi.reabrir(comandaId);
      toast('success', 'Comanda reaberta — novos pedidos liberados');
      loadComanda();
    } catch (err: any) {
      toast('error', err?.error || 'Erro ao reabrir');
    }
  };

  const finalizarIndividual = async () => {
    if (!comanda) return;
    const pessoas_valores = Object.entries(valoresIndiv)
      .filter(([, v]) => {
        const n = Number(v);
        return !Number.isNaN(n) && n > 0;
      })
      .map(([k, v]) => ({ pessoa_id: k === 'geral' ? null : Number(k.slice(1)), valor: Number(v) }));
    if (!pessoas_valores.length) return toast('error', 'Aplique ao menos um valor a pagar');
    setFinalizando(true);
    try {
      const r = await comandaApi.fechar(comandaId, {
        tipo: 'individual',
        taxa_garcom_pct: Number(taxa || 0),
        forma,
        responsavel: comanda.garcom_nome || undefined,
        pessoas_valores,
      });
      setFechar(false);
      if (r.pre_fechamento && r.comanda_pagamentos_id) {
        toast('success', r.mensagem || 'Pagamentos individuais iniciados');
        navigate(`/restaurante/comanda/${r.comanda_pagamentos_id}/pagamentos`);
      } else {
        toast('success', `Contas individuais geradas! Total ${fmtBRL(r.total)}`);
        navigate('/restaurante');
      }
    } catch (err: any) {
      toast('error', err?.error || 'Erro ao gerar contas individuais');
    } finally {
      setFinalizando(false);
    }
  };

  if (load) return <Spinner label="Carregando comanda..." />;
  if (!comanda) return <div className="py-20 text-center text-slate-400">Comanda não encontrada</div>;

  const itensDaPessoa = (pessoaId: number | null) =>
    ativos.filter((i) => (pessoaId === null ? i.pessoa_id === null : i.pessoa_id === pessoaId));

  const locked = comanda.status !== 'aberta';
  const preFechada = comanda.status === 'pre_fechamento';

  return (
    <AnimatedPage>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={() => navigate('/restaurante')} icon={<ArrowLeft className="h-4 w-4" />}>
            Voltar
          </Button>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-slate-800">
              {comanda.mesa?.nome || `Mesa ${comanda.mesa_id}`}
            </h1>
            <p className="text-sm text-slate-500">
              Garçom: {comanda.garcom_nome || '—'} · Cliente: {comanda.cliente_nome || '—'} · Aberta às {fmtHora(comanda.mesa?.aberta_em)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select className="w-40" value={setor} onChange={(e) => setSetor(e.target.value)} disabled={locked}>
            {setores.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
          <Button variant="secondary" icon={<Printer className="h-4 w-4" />} onClick={imprimirComanda}>
            Imprimir
          </Button>
          {!locked ? (
            <Button variant="success" icon={<HandCoins className="h-4 w-4" />} onClick={abrirFechamento}>
              Fechar conta ({fmtBRL(totalComTaxa)})
            </Button>
          ) : preFechada && comanda.transfer_comanda_id ? (
            <Button
              variant="success"
              icon={<HandCoins className="h-4 w-4" />}
              onClick={() => navigate(`/restaurante/comanda/${comanda.transfer_comanda_id}/pagamentos`)}
            >
              Ver Pagamentos Individuais
            </Button>
          ) : preFechada ? (
            <Button variant="success" icon={<HandCoins className="h-4 w-4" />} onClick={abrirBaixa}>
              Baixar conta
            </Button>
          ) : null}
        </div>
      </div>

      {preFechada && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-brand-50 px-4 py-3">
          <p className="text-sm font-semibold text-brand-800">
            {comanda.transfer_comanda_id ? (
              <>
                Comanda em pré-fechamento — os itens foram transferidos para a mesa &quot;Pagamentos Individuais&quot;.
                A mesa {comanda.mesa?.nome || comanda.mesa_id} continua reservada até a baixa final.
              </>
            ) : (
              <>
                Conta pré-fechada — novos pedidos bloqueados. Imprima a conta e dê a baixa quando o pagamento for
                recebido. Você pode reabrir se precisar adicionar algo.
              </>
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            {comanda.transfer_comanda_id ? (
              <Button
                size="sm"
                icon={<HandCoins className="h-4 w-4" />}
                onClick={() => navigate(`/restaurante/comanda/${comanda.transfer_comanda_id}/pagamentos`)}
              >
                Baixar pessoas
              </Button>
            ) : (
              <>
                <Button size="sm" variant="secondary" icon={<Users className="h-4 w-4" />} onClick={reabrir}>
                  Reabrir
                </Button>
                <Button size="sm" icon={<HandCoins className="h-4 w-4" />} onClick={abrirBaixa}>
                  Baixar conta
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Produtos */}
        <div className="lg:col-span-2">
          {!locked && (
            <Card className="mb-4 p-4">
              <form onSubmit={adicionarCodigo} className="flex gap-2">
                <div className="relative flex-1">
                  <ScanBarcode className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-brand-500" />
                  <Input
                    ref={bipRef as any}
                    className="h-11 pl-10 font-mono"
                    placeholder="Passe o código de barras e ENTER"
                    value={codigo}
                    onChange={(e) => setCodigo(e.target.value)}
                  />
                </div>
                <Button type="submit" className="h-11">Adicionar</Button>
              </form>
              <div className="relative mt-2">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input className="pl-9" placeholder="Filtrar produtos..." value={filtro} onChange={(e) => setFiltro(e.target.value)} />
              </div>
              <div className="mt-3 grid max-h-80 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
                {produtos
                  .filter((p) => p.ativo && (!filtro || p.nome.toLowerCase().includes(filtro.toLowerCase())))
                  .slice(0, 24)
                  .map((p) => (
                    <motion.button
                      key={p.id}
                      whileHover={{ y: -2 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => abrirAdicionar(p)}
                      className="rounded-xl border border-slate-200 p-2.5 text-left transition-colors hover:border-brand-300 hover:bg-brand-50/40"
                    >
                      <p className="text-sm font-bold leading-tight text-slate-800">{p.nome}</p>
                      <p className="mt-0.5 text-xs font-bold text-brand-600">{p.preco != null ? fmtBRL(p.preco) : '—'}</p>
                    </motion.button>
                  ))}
              </div>
            </Card>
          )}

          {/* Pessoas */}
          {!locked && (
            <Card className="p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-slate-700">Pessoas:</span>
                <button
                  onClick={() => setPessoaSel('geral')}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${pessoaSel === 'geral' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'}`}
                >
                  Conta geral
                </button>
                {pessoas.map((p, i) =>
                  editPessoaId === p.id ? (
                    <form
                      key={p.id}
                      onSubmit={(e) => {
                        e.preventDefault();
                        salvarNomePessoa(p);
                      }}
                      className="flex items-center gap-1"
                    >
                      <Input
                        autoFocus
                        className="!h-7 !w-32 !py-0.5 text-xs"
                        value={editPessoaNome}
                        onChange={(e) => setEditPessoaNome(e.target.value)}
                        onBlur={() => setEditPessoaId(null)}
                      />
                      <button type="submit" className="rounded-full bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white">
                        OK
                      </button>
                    </form>
                  ) : (
                    <div
                      key={p.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setPessoaSel(p.id)}
                      className={`group flex cursor-pointer items-center gap-1.5 rounded-full py-1 pl-3 pr-1 text-xs font-semibold ${pessoaSel === p.id ? 'text-white' : 'bg-slate-100 text-slate-600'}`}
                      style={pessoaSel === p.id ? { backgroundColor: p.cor } : undefined}
                      title="Clique para selecionar · clique no lápis para renomear"
                    >
                      <span className="truncate">{p.nome || `Pessoa ${i + 1}`}</span>
                      <button
                        type="button"
                        aria-label="Renomear"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditPessoaId(p.id);
                          setEditPessoaNome(p.nome || `Pessoa ${i + 1}`);
                        }}
                        className="rounded-full p-0.5 opacity-40 transition-opacity hover:opacity-100"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    </div>
                  )
                )}
                <button
                  onClick={() => setAddPessoaAberto((v) => !v)}
                  className="flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-3 py-1 text-xs font-semibold text-slate-500 hover:border-brand-400 hover:text-brand-600"
                >
                  <UserPlus className="h-3.5 w-3.5" /> Adicionar
                </button>
              </div>
              {addPessoaAberto && (
                <form onSubmit={adicionarPessoa} className="flex items-center gap-2">
                  <Input
                    autoFocus
                    className="!h-8 flex-1"
                    placeholder="nome da nova pessoa"
                    value={nomePessoa}
                    onChange={(e) => setNomePessoa(e.target.value)}
                  />
                  <Button type="submit" size="sm">Adicionar</Button>
                </form>
              )}
            </Card>
          )}

          {/* Itens */}
          <Card className="p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-slate-700">Itens ({ativos.length})</h2>
              {!locked && itensNovos.length > 0 && (
                <Button size="sm" variant="secondary" icon={<Send className="h-3.5 w-3.5" />} loading={enviandoCozinha} onClick={enviarCozinha}>
                  Enviar
                </Button>
              )}
            </div>
            {ativos.length === 0 ? (
              <EmptyState icon={<Plus className="h-6 w-6" />} title="Nenhum item na comanda" subtitle="Adicione produtos ao lado" />
            ) : (
              <div className="space-y-2">
                {itens.map((item) => {
                  const pessoa = nomePessoaDe(item.pessoa_id);
                  return (
                    <div key={item.id} className="rounded-xl bg-slate-50 px-3 py-2">
                      <div
                        className={`flex items-center justify-between gap-2 ${!locked && item.status === 'novo' && item.produto_id ? 'cursor-pointer rounded-lg hover:bg-slate-100' : ''}`}
                        onClick={() => abrirEditarItem(item)}
                        role={!locked && item.status === 'novo' && item.produto_id ? 'button' : undefined}
                        tabIndex={!locked && item.status === 'novo' && item.produto_id ? 0 : undefined}
                        onKeyDown={(e) => {
                          if ((e.key === 'Enter' || e.key === ' ') && !locked && item.status === 'novo' && item.produto_id) abrirEditarItem(item);
                        }}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                            <span>{item.nome}</span>
                            {pessoa && (
                              <span className="rounded-full px-2 py-0.5 text-[10px] font-bold text-white" style={{ backgroundColor: pessoa.cor }}>
                                {pessoa.nome}
                              </span>
                            )}
                          </p>
                          {item.observacao && <p className="text-[11px] text-amber-600">* {item.observacao}</p>}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Badge color={item.status === 'entregue' ? 'green' : item.status === 'enviado' ? 'blue' : 'amber'}>
                            {item.status}
                          </Badge>
                          <span className="w-16 text-right text-sm font-bold text-slate-700">
                            {fmtNum(item.quantidade)}x {fmtBRL(item.preco_unitario * item.quantidade)}
                          </span>
                        </div>
                      </div>
                      {!locked && item.status !== 'entregue' && (
                        <div className="mt-1.5 flex gap-1.5">
                          {item.status === 'novo' && (
                            <Button size="sm" variant="secondary" icon={<Send className="h-3 w-3" />} onClick={() => mudarStatus(item, 'enviado')}>
                              Enviar
                            </Button>
                          )}
                          <Button size="sm" variant="success" icon={<CheckCheck className="h-3 w-3" />} onClick={() => mudarStatus(item, 'entregue')}>
                            Entregar
                          </Button>
                          <Button size="sm" variant="danger" icon={<Trash2 className="h-3 w-3" />} onClick={() => mudarStatus(item, 'cancelado')}>
                            Cancelar
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* Resumo */}
        <div>
          <Card className="md:sticky md:top-4 p-4">
            <h2 className="mb-3 text-sm font-bold text-slate-700">Resumo</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-slate-500">
                <span>Subtotal</span>
                <span className="font-semibold text-slate-800">{fmtBRL(subtotal)}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Taxa do garçom ({Number(taxa || 0)}%)</span>
                <span className="font-semibold text-slate-800">{fmtBRL(subtotal * (Number(taxa || 0) / 100))}</span>
              </div>
              <div className="flex justify-between border-t border-slate-100 pt-2">
                <span className="font-bold text-slate-700">Total</span>
                <span className="text-lg font-extrabold text-brand-600">{fmtBRL(totalComTaxa)}</span>
              </div>
              <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 p-2.5">
                <span className="text-xs font-semibold text-slate-500">Taxa %</span>
                <Input type="number" step="0.1" className="!w-20 !py-1 text-right" value={taxa} onChange={(e) => setTaxa(e.target.value)} />
              </div>
            </div>

            {!locked ? (
              <Button variant="success" className="mt-4 w-full" size="lg" icon={<HandCoins className="h-5 w-5" />} onClick={abrirFechamento}>
                Fechar conta
              </Button>
            ) : preFechada && comanda.transfer_comanda_id ? (
              <Button
                variant="success"
                className="mt-4 w-full"
                size="lg"
                icon={<HandCoins className="h-5 w-5" />}
                onClick={() => navigate(`/restaurante/comanda/${comanda.transfer_comanda_id}/pagamentos`)}
              >
                Baixar em Pagamentos Individuais
              </Button>
            ) : preFechada ? (
              <Button variant="success" className="mt-4 w-full" size="lg" icon={<HandCoins className="h-5 w-5" />} onClick={abrirBaixa}>
                Baixar conta
              </Button>
            ) : null}
          </Card>
        </div>
      </div>

      {/* Fechamento */}
      <Modal open={fechar} onClose={() => setFechar(false)} title="Fechamento da comanda" width="max-w-2xl">
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">1. Tipo de pagamento</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { v: 'unica' as const, l: 'Conta única', d: 'paga junto' },
                { v: 'divisao' as const, l: 'Dividir igual', d: 'por pessoa' },
                { v: 'individual' as const, l: 'Individual', d: 'aplicar valores' },
              ].map((o) => (
                <button
                  type="button"
                  key={o.v}
                  onClick={() => setTipo(o.v)}
                  className={`rounded-xl border-2 p-3 text-center transition-colors ${tipo === o.v ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:border-slate-300'}`}
                >
                  <p className="text-sm font-bold text-slate-800">{o.l}</p>
                  <p className="text-[11px] text-slate-400">{o.d}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Taxa do garçom (%)">
              <Input type="number" step="0.1" value={taxa} onChange={(e) => setTaxa(e.target.value)} />
            </Field>
            <Field label="Forma de pagamento">
              <Select value={forma} onChange={(e) => setForma(e.target.value)}>
                {FORMAS_PAGAMENTO.map((f) => (
                  <option key={f.valor} value={f.valor}>{f.label}</option>
                ))}
              </Select>
            </Field>
          </div>

          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">2. Produtos consumidos</p>
            <div className="max-h-56 space-y-3 overflow-y-auto rounded-xl border border-slate-100 p-3">
              {grupos.map((g) => (
                <div key={g.key}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 text-sm font-bold text-slate-700">
                      {g.cor && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: g.cor }} />}
                      <span className="truncate">{g.nome}</span>
                    </span>
                    <span className="shrink-0 text-sm font-bold text-slate-800">{fmtBRL(g.subtotal)}</span>
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {g.itens.map((i) => (
                      <div key={i.id} className="flex justify-between gap-2 text-xs text-slate-500">
                        <span className="min-w-0 truncate">
                          {fmtNum(i.quantidade)}x {i.nome}
                          {i.observacao && <span className="text-amber-600"> *</span>}
                        </span>
                        <span className="shrink-0 font-semibold">{fmtBRL(Number(i.quantidade) * Number(i.preco_unitario))}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {grupos.length === 0 && <p className="py-2 text-center text-xs text-slate-400">Sem itens ativos</p>}
            </div>
          </div>

          {tipo === 'divisao' && (
            <div className="rounded-xl bg-brand-50 p-3 text-center">
              <p className="text-xs text-brand-700">Divisão igual entre {divisaoPessoas} pessoa(s)</p>
              <p className="text-xl font-extrabold text-brand-600">{fmtBRL(totalComTaxa / divisaoPessoas)} por pessoa</p>
            </div>
          )}

          {tipo === 'individual' && (
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">3. Aplicar valores por pessoa</p>
              <div className="space-y-2 rounded-xl border border-slate-100 p-3">
                {pessoas.map((p) => {
                  const k = `p${p.id}`;
                  return (
                    <div key={k} className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-700">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: p.cor }} />
                        <span className="truncate">{p.nome || `Pessoa ${p.id}`}</span>
                      </span>
                      <div className="flex shrink-0 items-center gap-1">
                        <span className="text-xs text-slate-400">R$</span>
                        <Input
                          type="number"
                          step="0.01"
                          min={0}
                          className="!w-28 text-right"
                          value={valoresIndiv[k] ?? ''}
                          onChange={(e) => setValoresIndiv((v) => ({ ...v, [k]: e.target.value }))}
                        />
                      </div>
                    </div>
                  );
                })}
                {grupos.some((g) => g.key === 'geral') && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-700">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-slate-400" />
                      <span className="truncate">Conta geral</span>
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="text-xs text-slate-400">R$</span>
                      <Input
                        type="number"
                        step="0.01"
                        min={0}
                        className="!w-28 text-right"
                        value={valoresIndiv['geral'] ?? ''}
                        onChange={(e) => setValoresIndiv((v) => ({ ...v, geral: e.target.value }))}
                      />
                    </div>
                  </div>
                )}
                <div
                  className={`flex items-center justify-between rounded-lg p-2 text-xs font-bold ${
                    Math.abs(dif) < 0.01 ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
                  }`}
                >
                  <span>Total aplicado</span>
                  <span>
                    {fmtBRL(totalAplicado)}
                    {Math.abs(dif) >= 0.01 && <> · falta {fmtBRL(dif)}</>}
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="rounded-xl bg-slate-50 p-3 text-center">
            <p className="text-xs text-slate-400">Total da conta</p>
            <p className="text-2xl font-extrabold text-brand-600">{fmtBRL(totalComTaxa)}</p>
          </div>

          {tipo === 'individual' ? (
            <Button className="w-full" size="lg" loading={finalizando} icon={<Users className="h-5 w-5" />} onClick={finalizarIndividual}>
              Gerar contas individuais
            </Button>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" size="lg" loading={finalizando} icon={<Printer className="h-5 w-5" />} onClick={preFechar}>
                Pré-fechar e imprimir
              </Button>
              <Button size="lg" loading={finalizando} icon={<HandCoins className="h-5 w-5" />} onClick={finalizar}>
                Baixar agora ({fmtBRL(totalComTaxa)})
              </Button>
            </div>
          )}
        </div>
      </Modal>

      {/* Baixar conta pré-fechada */}
      <Modal open={baixar} onClose={() => setBaixar(false)} title="Baixar conta paga" width="max-w-md">
        <div className="space-y-4">
          <div className="rounded-xl bg-slate-50 p-3 text-center">
            <p className="text-xs text-slate-400">Total da conta</p>
            <p className="text-2xl font-extrabold text-brand-600">{fmtBRL(totalComTaxa)}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Taxa do garçom (%)">
              <Input type="number" step="0.1" value={taxa} onChange={(e) => setTaxa(e.target.value)} />
            </Field>
            <Field label="Forma de pagamento">
              <Select value={forma} onChange={(e) => setForma(e.target.value)}>
                {FORMAS_PAGAMENTO.map((f) => (
                  <option key={f.valor} value={f.valor}>{f.label}</option>
                ))}
              </Select>
            </Field>
          </div>
          <Button className="w-full" size="lg" loading={finalizando} icon={<HandCoins className="h-5 w-5" />} onClick={finalizarBaixa}>
            Confirmar baixa
          </Button>
        </div>
      </Modal>

      {/* Adicionar produto */}
      <Modal open={!!addProduto} onClose={() => { setAddProduto(null); setEditandoItem(null); }} title={editandoItem ? 'Observações do produto' : 'Adicionar produto'} width="max-w-md">
        {addProduto && (
          <div className="space-y-4">
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-sm font-bold text-slate-800">{addProduto.nome}</p>
              <p className="text-xs text-slate-500">{addProduto.preco != null ? fmtBRL(addProduto.preco) : '—'}</p>
            </div>

            <Field label="Quantidade">
              <div className="flex items-center gap-2">
                {!editandoItem && <Button type="button" variant="secondary" size="sm" className="h-9 w-9 p-0" onClick={() => setAddQtd(Math.max(1, addQtd - 1))}>
                  <Minus className="h-4 w-4" />
                </Button>}
                <Input
                  type="number"
                  min={1}
                  className="w-20 text-center"
                  value={addQtd}
                  disabled={!!editandoItem}
                  onChange={(e) => setAddQtd(Math.max(1, Number(e.target.value) || 1))}
                />
                {!editandoItem && <Button type="button" variant="secondary" size="sm" className="h-9 w-9 p-0" onClick={() => setAddQtd(addQtd + 1)}>
                  <Plus className="h-4 w-4" />
                </Button>}
              </div>
            </Field>

            {(addProduto.comentarios?.length || 0) > 0 ? (
              <Field label="Observações automáticas">
                <div className="flex flex-wrap gap-1.5">
                  {addProduto.comentarios!.map((o) => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => toggleObs(o)}
                      className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                        addObsSel.includes(o) ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              </Field>
            ) : (
              <p className="text-xs text-slate-400">Este produto não tem observações cadastradas.</p>
            )}

            <Field label="Observação personalizada">
              <Input value={addCustom} onChange={(e) => setAddCustom(e.target.value)} placeholder="Digite uma observação..." />
            </Field>

            {pessoaSel !== 'geral' && (
              <p className="text-xs text-slate-500">
                Item lançado para {pessoas.find((p) => p.id === pessoaSel)?.nome || 'a pessoa selecionada'}.
              </p>
            )}

            <div className="rounded-xl bg-slate-50 p-3 text-center">
              <p className="text-xs text-slate-400">Total</p>
              <p className="text-xl font-extrabold text-brand-600">{fmtBRL((addProduto.preco || 0) * addQtd)}</p>
            </div>

            <Button className="w-full" loading={adicionando} onClick={confirmarAdicao}>
              {editandoItem ? 'Salvar observações' : `Adicionar ${addQtd}x ${addProduto.nome}`}
            </Button>
          </div>
        )}
      </Modal>

      {/* Impressão preview */}
      <Modal open={!!imprimir} onClose={() => setImprimir(null)} title={`Comanda · ${imprimir?.setor || ''}`}>
        <div ref={impressaoRef} className="mx-auto w-64 rounded-lg border-2 border-dashed border-slate-300 bg-white p-3 font-mono text-[11px] leading-4">
          <pre className="whitespace-pre-wrap text-slate-800">{imprimir?.impressao}</pre>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setImprimir(null)}>Fechar</Button>
          <Button icon={<Printer className="h-4 w-4" />} onClick={() => printReceipt(impressaoRef.current)}>Imprimir</Button>
        </div>
      </Modal>
    </AnimatedPage>
  );
}
