/**
 * Arquivo: ComandaPage.tsx
 * Responsabilidade: Implementa a tela ComandaPage.tsx e coordena seus dados e ações.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  UserPlus,
  Plus,
  Minus,
  Printer,
  Send,
  CheckCheck,
  Trash2,
  HandCoins,
  Users,
  ArrowRightLeft,
  GripVertical,
  MoreHorizontal,
  Pencil,
} from 'lucide-react';
import { AnimatedPage } from '@/components/AnimatedPage';
import { RestaurantCatalog } from '@/components/RestaurantCatalog';
import { ComboEscolha, adicionalCombo, comboCompleto } from '@/components/ComboFields';
import { TransferItemModal } from '@/components/TransferItemModal';
import { TransferTableModal } from '@/components/TransferTableModal';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Spinner, Toggle, useConfirm, useToast } from '@/components/ui';
import { comandaApi, produtoApi, impressoraApi, configApi, categoriaApi, authApi, retryOrder, type OrderSubmission, type TableTransferSubmission } from '@/lib/api';
import { useAuth } from '@/store/auth';
import type { Comanda, Produto, ComandaItem, Categoria } from '@/lib/types';
import { fmtBRL, fmtNum, fmtHora, FORMAS_PAGAMENTO, formaLabel } from '@/lib/format';
import { confirmarImpressao } from '@/lib/print-result';
import { taxaServicoAtual, type EdicaoTaxaServico } from '@/lib/taxa-servico';

const CORES = ['#0a0a0a', '#262626', '#404040', '#525252', '#737373', '#a3a3a3'];

export function ComandaPage() {
  const { id } = useParams();
  const comandaId = Number(id);
  const navigate = useNavigate();
  const location = useLocation();
  const inicial: Comanda | null = location.state?.comandaInicial?.id === comandaId ? location.state.comandaInicial : null;
  const [searchParams] = useSearchParams();
  const fecharAutomatico = useRef(searchParams.get('fechar') === '1');
  const toast = useToast();
  const confirm = useConfirm();
  const podeGerenciar = useAuth((s) => s.can('gestor'));

  const [comanda, setComanda] = useState<Comanda | null>(inicial);
  const comandaRef = useRef<Comanda | null>(inicial);
  const [load, setLoad] = useState(!inicial);
  const [pessoaSel, setPessoaSel] = useState<number | 'geral'>('geral');
  const [setor, setSetor] = useState('Cozinha');
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [opcoesCombo, setOpcoesCombo] = useState<Produto[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [setores, setSetores] = useState<string[]>(['Cozinha', 'Bar', 'Salão', 'Padaria', 'Etiquetas']);
  const [nomePessoa, setNomePessoa] = useState('');
  const [addPessoaAberto, setAddPessoaAberto] = useState(false);
  const [editPessoaId, setEditPessoaId] = useState<number | null>(null);
  const [editPessoaNome, setEditPessoaNome] = useState('');
  const [fechar, setFechar] = useState(false);
  const [baixar, setBaixar] = useState(false);
  const [liberarVazia, setLiberarVazia] = useState(false);
  const [cancelamento, setCancelamento] = useState<{ comandaId: number; chave: string; itens: ComandaItem[] } | null>(null);
  const [motivoCancelamento, setMotivoCancelamento] = useState('Cancelamento total solicitado pelo gestor');
  const [confirmarCancelamento, setConfirmarCancelamento] = useState(false);
  const [tipo, setTipo] = useState<'unica' | 'divisao' | 'individual'>('unica');
  const [taxaEditada, setTaxaEditada] = useState<EdicaoTaxaServico | null>(null);
  const taxa = taxaServicoAtual(comandaId, comanda?.taxa_garcom_pct, taxaEditada);
  const setTaxa = (valor: string) => setTaxaEditada({ comandaId, valor });
  const [forma, setForma] = useState('dinheiro');
  const [finalizando, setFinalizando] = useState(false);
  const finalizandoRef = useRef(false);
  const [enviandoCozinha, setEnviandoCozinha] = useState(false);
  const [imprimir, setImprimir] = useState<{ impressao: string; setor: string; pessoaId?: number; enviada: boolean } | null>(null);
  const [addProduto, setAddProduto] = useState<Produto | null>(null);
  const [comboChoices, setComboChoices] = useState<number[][]>([]);
  const [editandoItem, setEditandoItem] = useState<ComandaItem | null>(null);
  const [acoesItem, setAcoesItem] = useState<ComandaItem | null>(null);
  const [transferencia, setTransferencia] = useState<{ item: ComandaItem; mode: 'pessoa' | 'mesa' } | null>(null);
  const [transferenciaMesa, setTransferenciaMesa] = useState<Comanda | null>(null);
  const [transferindo, setTransferindo] = useState(false);
  const [arrastando, setArrastando] = useState<ComandaItem | null>(null);
  const [sobrePessoa, setSobrePessoa] = useState<string | null>(null);
  const transferenciaRef = useRef(false);
  const loadSequence = useRef(0);
  const loadingRequests = useRef(0);
  const [addQtd, setAddQtd] = useState(1);
  const [addObsSel, setAddObsSel] = useState<string[]>([]);
  const [addObsUnidades, setAddObsUnidades] = useState<string[][]>([[]]);
  const [addUnidade, setAddUnidade] = useState(0);
  const [aplicarEmConjunto, setAplicarEmConjunto] = useState(false);
  const [addCustom, setAddCustom] = useState('');
  const [addAcrSel, setAddAcrSel] = useState<number[]>([]);
  const [addAcrUnidades, setAddAcrUnidades] = useState<number[][]>([[]]);
  const [adicionando, setAdicionando] = useState(false);
  const adicionandoRef = useRef(false);
  const enviandoRef = useRef(false);
  const pendingRef = useRef<OrderSubmission | null>(null);
  const [pendente, setPendente] = useState<OrderSubmission | null>(null);
  const [actorId, setActorId] = useState<number | null>(null);
  const storageKey = actorId ? `simplesx_pedido:${actorId}:${comandaId}` : null;
  const [valoresIndiv, setValoresIndiv] = useState<Record<string, string>>({});
  const impressaoEmCurso = useRef(false);
  const [imprimindoConta, setImprimindoConta] = useState(false);

  const loadComanda = async (background = false) => {
    if (background && loadingRequests.current) return;
    loadingRequests.current++;
    const sequence = ++loadSequence.current;
    try {
      const atual = comandaRef.current;
      const c = background && atual?.id === comandaId && Number.isSafeInteger(atual.revisao)
        ? await comandaApi.atualizar(comandaId, atual.revisao)
        : await comandaApi.get(comandaId);
      if (sequence !== loadSequence.current) return;
      if (!('sem_alteracoes' in c)) { comandaRef.current = c; setComanda(c); }
    } catch (e: any) {
      toast('error', e?.error || 'Erro ao carregar comanda');
    } finally {
      loadingRequests.current--;
      if (sequence === loadSequence.current) setLoad(false);
    }
  };

  useEffect(() => {
    setTaxaEditada(null);
    setPessoaSel(Number(searchParams.get('pessoa')) > 0 ? Number(searchParams.get('pessoa')) : 'geral'); setAcoesItem(null); setTransferencia(null); setTransferenciaMesa(null); setArrastando(null);
    setFechar(false); setBaixar(false); setLiberarVazia(false); setCancelamento(null);
    let alive = true;
    comandaRef.current = inicial;
    setComanda(inicial); setLoad(!inicial);
    void loadComanda(!!inicial);
    if (inicial) {
      // A resposta da abertura serve só para esta entrada, sem deixar dados da
      // comanda no histórico do navegador para uma próxima sessão.
      const { comandaInicial: _, ...restante } = location.state;
      navigate(location.pathname + location.search, { replace: true, state: restante });
    }
    Promise.all([produtoApi.list(), categoriaApi.list()]).then(([ps, cs]) => {
      if (!alive) return;
      setProdutos(ps.filter((p) => p.exibir_restaurante)); setOpcoesCombo(ps); setCategorias(cs);
    }).catch(() => toast('error', 'Não foi possível carregar o cardápio'));
    impressoraApi.setores().then((s) => { if (alive) setSetores(s.map((x) => x.nome)); }).catch(() => {});
    const atualizar = () => { if (!document.hidden) void loadComanda(true); };
    const iv = setInterval(atualizar, 3000);
    document.addEventListener('visibilitychange', atualizar);
    return () => { alive = false; loadSequence.current++; clearInterval(iv); document.removeEventListener('visibilitychange', atualizar); };
  }, [comandaId]);

  useEffect(() => { authApi.me().then((user) => setActorId(user.id)).catch(() => {}); }, []);
  useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
      pendingRef.current = saved; setPendente(saved);
    } catch { pendingRef.current = null; setPendente(null); }
  }, [storageKey]);

  const pessoas = comanda?.pessoas || [];
  const pessoaCartao = pessoas.find(p=>p.id===pessoaSel && p.cartao_atendimento_id);
  const itens = comanda?.itens || [];
  const ativos = itens.filter((i) => i.status !== 'cancelado');
  const itensExibidos = pessoaCartao ? itens.filter(i=>i.pessoa_id===pessoaCartao.id) : itens;
  const ativosExibidos = itensExibidos.filter(i=>i.status!=='cancelado');
  const subtotalExibido = ativosExibidos.reduce((s,i)=>s+Number(i.quantidade)*Number(i.preco_unitario),0);
  const taxaExibida = pessoaCartao ? Number(comanda?.taxa_garcom_pct || 0) : Number(taxa || 0);
  const itensNovos = ativosExibidos.filter((i) => i.status === 'novo');
  const subtotal = useMemo(() => ativos.reduce((s, i) => s + Number(i.quantidade) * Number(i.preco_unitario), 0), [ativos]);
  const locked = comanda?.status !== 'aberta';
  const mesaVazia = ativos.length === 0 && !comanda?.comanda_origem_id &&
    !['aberta', 'pre_fechamento'].includes(comanda?.transfer_comanda_status || '') &&
    ['aberta', 'pre_fechamento'].includes(comanda?.status || '');
  const vendasAnteriores = comanda?.vendas_anteriores || [];
  const podeCancelarTudo = podeGerenciar && !pessoaCartao && !comanda?.comanda_origem_id &&
    ['aberta','pre_fechamento'].includes(comanda?.status || '') &&
    ['normal','cartao'].includes(comanda?.mesa?.tipo || 'normal') &&
    !['aberta','pre_fechamento'].includes(comanda?.transfer_comanda_status || '');
  const podeTransferir = (item: ComandaItem) => !locked && !transferindo && ['novo', 'enviado', 'entregue'].includes(item.status);

  const transferirItem = async (item: ComandaItem, mesaId: number, destinoId: number | null, pessoaId: number | null) => {
    if (transferenciaRef.current || locked) return false;
    transferenciaRef.current = true;
    setTransferindo(true);
    try {
      await comandaApi.transferirItem(comandaId, item.id, { mesa_destino_id: mesaId, comanda_destino_id: destinoId, pessoa_destino_id: pessoaId, versao: item.versao });
      setTransferencia(null); setAcoesItem(null);
      await loadComanda();
      const nome = pessoaId ? pessoas.find((p) => p.id === pessoaId)?.nome : 'Conta geral';
      toast('success', destinoId === comandaId ? `${item.nome} transferido para ${nome || 'outra pessoa'}` : `${item.nome} transferido para a mesa selecionada`);
      return true;
    } catch (e: any) {
      toast('error', e?.error || 'Não foi possível transferir o pedido');
      setTransferencia(null);
      await loadComanda();
      return false;
    } finally { transferenciaRef.current = false; setTransferindo(false); }
  };

  const abrirTransferenciaMesa = () => {
    if (!comanda || locked || transferenciaRef.current || finalizandoRef.current) return;
    if (adicionandoRef.current || enviandoRef.current || pendingRef.current) {
      toast('info', 'Aguarde a confirmação dos pedidos e do envio antes de transferir.'); return;
    }
    setTransferenciaMesa(comanda);
  };

  const transferirMesa = async (body: TableTransferSubmission) => {
    if (transferenciaRef.current || finalizandoRef.current || adicionandoRef.current || enviandoRef.current || pendingRef.current) return false;
    transferenciaRef.current = true; setTransferindo(true);
    try {
      const result = await comandaApi.transferirMesa(comandaId, body);
      setTransferenciaMesa(null);
      toast('success', `${result.itens_count} pedidos transferidos.${result.liberou_origem ? ' Mesa de origem liberada.' : ' A mesa de origem continua aberta.'}`);
      navigate(`/restaurante/comanda/${result.comanda_destino_id}`);
      return true;
    } catch (e: any) {
      toast('error', e?.error || 'Não foi possível confirmar a transferência');
      if (e?.status > 0 && e.status < 500) { setTransferenciaMesa(null); await loadComanda(); }
      return false;
    } finally { transferenciaRef.current = false; setTransferindo(false); }
  };

  const destinoPessoa = (pessoaId: number | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!arrastando || !podeTransferir(arrastando) || arrastando.pessoa_id === pessoaId) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setSobrePessoa(String(pessoaId));
    },
    onDragLeave: () => setSobrePessoa(null),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault(); setSobrePessoa(null); setArrastando(null);
      if (arrastando && podeTransferir(arrastando) && arrastando.pessoa_id !== pessoaId && comanda) {
        void transferirItem(arrastando, comanda.mesa_id, comanda.id, pessoaId);
      }
    },
  });

  const abrirTransferencia = (item: ComandaItem, mode: 'pessoa' | 'mesa') => {
    if (!podeTransferir(item)) return;
    setAcoesItem(null); setTransferencia({ item, mode });
  };

  const nomePessoaDe = (pessoaId: number | null) => {
    if (!pessoaId) return null;
    return pessoas.find((p) => p.id === pessoaId) || null;
  };

  const abrirAdicionar = (p: Produto) => {
    if (transferenciaRef.current || finalizandoRef.current || transferenciaMesa) return;
    if (pendingRef.current || adicionandoRef.current) { toast('error', 'Confirme o lançamento pendente antes de adicionar outro.'); return; }
    setEditandoItem(null);
    setAddProduto(p);
    setComboChoices([]);
    setAddQtd(1);
    setAddObsSel([]);
    setAddObsUnidades([[]]);
    setAddAcrSel([]);
    setAddAcrUnidades([[]]);
    setAddUnidade(0);
    setAplicarEmConjunto(false);
    setAddCustom('');
    setAdicionando(false);
  };

  const abrirEditarItem = async (item: ComandaItem) => {
    if (locked || item.status !== 'novo' || !item.produto_id) return;
    try {
      const produtoCompleto = produtos.find((p) => p.id === item.produto_id) || await produtoApi.get(item.produto_id);
      const linhas = String(item.observacao || '').split(/\n| · /).map((o) => o.replace(/^\(|\)$/g, '').trim()).filter(Boolean);
      const cadastrados = produtoCompleto.acrescimos || [];
      const ids: number[] = item.acrescimos_json ? JSON.parse(item.acrescimos_json) : [];
      const livres: string[] = [];
      for (const linha of linhas) {
        const adicionais = linha.startsWith('Adicionar: ') ? linha.slice('Adicionar: '.length).split(',').map((nome) => nome.trim()) : [];
        const reconhecidos = adicionais.map((nome) => cadastrados.find((extra) => extra.insumo_nome === nome));
        if (adicionais.length && reconhecidos.every(Boolean)) {
          if (!item.acrescimos_json) ids.push(...reconhecidos.map((extra) => extra!.insumo_id));
        } else {
          for (const parte of linha.split(',')) {
            const texto = parte.trim();
            if (texto) livres.push(texto);
          }
        }
      }
      setEditandoItem(item);
      setAddProduto(produtoCompleto);
      setAddQtd(Number(item.quantidade));
      setAddObsSel(livres);
      setAddObsUnidades([livres]);
      setAddAcrSel(ids);
      setAddAcrUnidades([ids]);
      setAplicarEmConjunto(true);
      setAddCustom('');
      setAdicionando(false);
    } catch (e: any) {
      toast('error', e?.error || 'Erro ao abrir o produto');
    }
  };

  const observacoesAtuais = aplicarEmConjunto ? addObsSel : (addObsUnidades[addUnidade] || []);
  const acrescimosAtuais = aplicarEmConjunto ? addAcrSel : (addAcrUnidades[addUnidade] || []);
  const valorDoAcrescimo = (id: number) => addProduto?.acrescimos?.find((item) => item.insumo_id === id)?.valor || 0;
  const somaAcrescimos = (ids: number[]) => ids.reduce((soma, id) => soma + valorDoAcrescimo(id), 0);
  const extraTotal = aplicarEmConjunto
    ? somaAcrescimos(addAcrSel) * addQtd
    : addAcrUnidades.slice(0, addQtd).reduce((soma, ids) => soma + somaAcrescimos(ids), 0);

  // Cada clique soma uma ocorrência. O botão "−" remove somente uma delas,
  // permitindo pedir, por exemplo, dois copos com a mesma observação.
  const adicionarObs = (o: string) => {
    if (aplicarEmConjunto) return setAddObsSel((prev) => [...prev, o]);
    setAddObsUnidades((prev) => prev.map((lista, i) => i === addUnidade ? [...lista, o] : lista));
  };

  const adicionarAcrescimo = (id: number) => {
    if (aplicarEmConjunto) return setAddAcrSel((prev) => [...prev, id]);
    setAddAcrUnidades((prev) => prev.map((lista, i) => i === addUnidade ? [...lista, id] : lista));
  };

  const removerAcrescimo = (id: number) => {
    const removerUm = (lista: number[]) => {
      const indice = lista.lastIndexOf(id);
      return indice < 0 ? lista : lista.filter((_, j) => j !== indice);
    };
    if (aplicarEmConjunto) return setAddAcrSel(removerUm);
    setAddAcrUnidades((prev) => prev.map((lista, i) => i === addUnidade ? removerUm(lista) : lista));
  };

  const removerObs = (o: string) => {
    const removerUma = (lista: string[]) => {
      const i = lista.lastIndexOf(o);
      return i < 0 ? lista : lista.filter((_, j) => j !== i);
    };
    if (aplicarEmConjunto) return setAddObsSel(removerUma);
    setAddObsUnidades((prev) => prev.map((lista, i) => i === addUnidade ? removerUma(lista) : lista));
  };

  const alterarQuantidade = (quantidade: number) => {
    const qtd = Math.min(50, Math.max(1, Math.floor(quantidade)));
    setAddQtd(qtd);
    setAddObsUnidades((prev) => Array.from({ length: qtd }, (_, i) => prev[i] || []));
    setAddAcrUnidades((prev) => Array.from({ length: qtd }, (_, i) => prev[i] || []));
    setAddUnidade((atual) => Math.min(atual, qtd - 1));
  };

  const alterarAplicarEmConjunto = (ativar: boolean) => {
    if (ativar) {
      setAddObsSel(addObsUnidades.flat());
      setAddAcrSel(addAcrUnidades.flat());
    } else {
      setAddObsUnidades(Array.from({ length: addQtd }, (_, i) => i === 0 ? [...addObsSel] : []));
      setAddAcrUnidades(Array.from({ length: addQtd }, (_, i) => i === 0 ? [...addAcrSel] : []));
    }
    setAddUnidade(0);
    setAplicarEmConjunto(ativar);
  };

  const adicionarPersonalizada = () => {
    const texto = addCustom.trim();
    if (!texto) return;
    adicionarObs(texto);
    setAddCustom('');
  };

  const enviarLancamento = async (submission: OrderSubmission) => {
    if (adicionandoRef.current || !storageKey) return;
    adicionandoRef.current = true; setAdicionando(true);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(submission));
      pendingRef.current = submission; setPendente(submission);
      await comandaApi.addItems(comandaId, submission);
      sessionStorage.removeItem(storageKey);
      pendingRef.current = null; setPendente(null);
      setAddProduto(null);
      toast('success', 'Pedido salvo na mesa. Pronto para enviar à cozinha.');
      await loadComanda();
    } catch (e: any) {
      if (e?.status >= 400 && e?.status < 500 && e.status !== 401) {
        sessionStorage.removeItem(storageKey); pendingRef.current = null; setPendente(null);
      } else {
        setAddProduto(null);
      }
      toast('error', e?.error || 'Não foi possível confirmar o pedido. Use Tentar novamente para consultar e concluir o mesmo lançamento.');
    } finally { adicionandoRef.current = false; setAdicionando(false); }
  };

  const confirmarAdicao = async () => {
    if (!addProduto || adicionandoRef.current || !storageKey) return;
    const gruposCombo = addProduto.tipo === 'combo' ? JSON.parse(addProduto.combo_grupos_json || '[]') as NonNullable<Produto['combo_grupos']> : [];
    if (!editandoItem && addProduto.tipo === 'combo' && !comboCompleto(gruposCombo, comboChoices)) { toast('error', 'Complete as escolhas do combo'); return; }
    if (editandoItem) {
      adicionandoRef.current = true; setAdicionando(true);
      try {
        const observacao = [...observacoesAtuais, addCustom.trim()].filter(Boolean).join('\n');
        await comandaApi.updateItem(comandaId, editandoItem.id, { observacao, acrescimos: addAcrSel });
        toast('success', `Observações de ${addProduto.nome} atualizadas`);
        setAddProduto(null); setEditandoItem(null);
        await loadComanda();
      } catch (e: any) { toast('error', e?.error || 'Erro ao editar observações'); }
      finally { adicionandoRef.current = false; setAdicionando(false); }
      return;
    }
    if (pendingRef.current) { await enviarLancamento(pendingRef.current); return; }
    const grupos = aplicarEmConjunto ? [addObsSel] : addObsUnidades.slice(0, addQtd);
    const gruposAcrescimo = aplicarEmConjunto ? [addAcrSel] : addAcrUnidades.slice(0, addQtd);
    await enviarLancamento({ chave: crypto.randomUUID(), itens: grupos.map((observacoes, index) => ({
      produto_id: addProduto.id, quantidade: aplicarEmConjunto ? addQtd : 1,
      pessoa_id: pessoaSel === 'geral' ? undefined : pessoaSel,
      observacao: [...observacoes, aplicarEmConjunto || index === addUnidade ? addCustom.trim() : ''].filter(Boolean).join('\n') || undefined,
      acrescimos: gruposAcrescimo[index] || [],
      ...(addProduto.tipo === 'combo' ? { combo_escolhas: comboChoices } : {}),
    })) });
  };

  const mudarStatus = async (item: ComandaItem, status: string) => {
    if (status === 'enviado') { await enviarCozinha([item.id]); return; }
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

  const imprimirConta = async (pessoaId?: number) => {
    if (impressaoEmCurso.current) return;
    impressaoEmCurso.current = true; setImprimindoConta(true);
    try {
      const r = pessoaId
        ? await impressoraApi.imprimirPessoa(comandaId, pessoaId)
        : await impressoraApi.imprimirComanda(comandaId, { setor, tipo: 'conta' });
      setImprimir({ impressao: r.impressao, setor: pessoaId ? 'Conta individual' : 'Pré-conta', pessoaId, enviada: !!r.jobs?.some(job=>job.ok) });
      toast('success', confirmarImpressao(r.jobs));
    } catch (e: any) { toast('error', e?.error || e?.message || 'Erro ao imprimir conta'); }
    finally { impressaoEmCurso.current = false; setImprimindoConta(false); }
  };
  const imprimirComanda = async () => {
    if (pessoaCartao || locked) { await imprimirConta(pessoaCartao?.id); return; }
    await enviarCozinha();
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

  const enviarCozinha = async (selectedIds?: number[]) => {
    if (!selectedIds && pessoaCartao) selectedIds = itensNovos.map(i=>i.id);
    if (enviandoRef.current || adicionandoRef.current || pendingRef.current) return;
    const ids = selectedIds || itensNovos.map((item) => item.id);
    if (!ids.length) { toast('info', 'Nenhum pedido novo para enviar'); return; }
    enviandoRef.current = true; setEnviandoCozinha(true);
    try {
      const r = await retryOrder(() => impressoraApi.imprimirComanda(comandaId, { setor, itens_ids: ids }));
      await loadComanda();
      if (r.sem_rota?.length) toast('error', `Sem impressora configurada: ${r.sem_rota.join(', ')}`);
      else if (r.falhas?.length) toast('error', `Fila incompleta: ${r.falhas[0].impressora}: ${r.falhas[0].erro}. Tente enviar novamente após corrigir a conexão.`);
      else toast('success', r.itens ? `${r.itens} item(ns) colocado(s) na fila de impressão` : 'Estes pedidos já foram enviados por outra tela');
    } catch (e: any) { toast('error', e?.error || 'Falha ao confirmar a fila. Tente enviar novamente; os itens já recebidos não serão duplicados.'); }
    finally { enviandoRef.current = false; setEnviandoCozinha(false); }
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

  useEffect(() => {
    if (fechar) iniciaValores();
  }, [fechar, taxa, comandaId]);

  const abrirFechamento = () => {
    if (!comanda || comanda.status === 'fechada') return;
    if (transferenciaRef.current || finalizandoRef.current) return;
    if (adicionandoRef.current || pendingRef.current || enviandoRef.current) {
      toast('info', 'Aguarde a confirmação do pedido e do envio antes de fechar a conta.');
      return;
    }
    if (pessoaCartao) { navigate(`/restaurante/recepcao?atendimento=${pessoaCartao.cartao_atendimento_id}&fechar=1`); return; }
    if (mesaVazia) { setLiberarVazia(true); return; }
    iniciaValores();
    setFechar(true);
  };

  useEffect(() => {
    if (!comanda || !fecharAutomatico.current) return;
    fecharAutomatico.current = false;
    // O atalho NFC usa o mesmo fluxo dos botões, inclusive para mesa vazia.
    abrirFechamento();
  }, [comanda]);

  const totalAplicado = Object.values(valoresIndiv).reduce((s, v) => s + (Number(v) || 0), 0);
  const dif = totalComTaxa - totalAplicado;

  const iniciarFechamento = () => {
    if (finalizandoRef.current) return false;
    if (adicionandoRef.current || pendingRef.current || enviandoRef.current || transferenciaRef.current) {
      toast('info', 'Aguarde a confirmação do pedido e do envio antes de fechar a conta.');
      return false;
    }
    finalizandoRef.current = true;
    setFinalizando(true);
    return true;
  };

  const falhaFechamento = (err: any, fallback: string) => {
    setFechar(false); setBaixar(false); setLiberarVazia(false);
    toast('error', err?.error || fallback);
    // A atualização da comanda não pode manter o diálogo e o botão presos.
    void loadComanda();
  };

  const liberarMesaVazia = async () => {
    if (!comanda || !iniciarFechamento()) return;
    try {
      const r = await comandaApi.fechar(comandaId, { tipo: 'unica', liberar_vazia: true });
      setLiberarVazia(false);
      toast('success', r.vendas_anteriores?.length ? 'Mesa liberada sem nova baixa. As vendas anteriores foram preservadas para conferência.' : 'Mesa vazia liberada sem cobrança.');
      navigate('/restaurante');
    } catch (err: any) {
      falhaFechamento(err, 'Não foi possível liberar a mesa vazia');
    } finally { finalizandoRef.current = false; setFinalizando(false); }
  };

  const abrirCancelamento = () => {
    if (!comanda || !podeCancelarTudo || finalizandoRef.current || transferenciaRef.current) return;
    if (adicionandoRef.current || pendingRef.current || enviandoRef.current) {
      toast('info', 'Aguarde a confirmação dos pedidos antes de cancelar a comanda.'); return;
    }
    setFechar(false); setBaixar(false); setLiberarVazia(false);
    setCancelamento({ comandaId, chave: crypto.randomUUID(), itens: [...ativos] });
    setMotivoCancelamento('Cancelamento total solicitado pelo gestor');
    setConfirmarCancelamento(false);
  };

  const cancelarTudo = async () => {
    if (!cancelamento || !confirmarCancelamento || motivoCancelamento.trim().length < 3 || !iniciarFechamento()) return;
    try {
      const r = await comandaApi.cancelar(cancelamento.comandaId, {
        chave: cancelamento.chave, confirmar: true, motivo: motivoCancelamento.trim(),
        itens: cancelamento.itens.map(({ id, versao }) => ({ id, versao })),
      });
      setCancelamento(null);
      toast('success', r.vendas_anteriores.length ? 'Pedidos cancelados e mesa liberada. Vendas antigas preservadas, sem estorno.' : 'Pedidos cancelados e mesa liberada, sem cobrança.');
      navigate('/restaurante');
    } catch (err: any) {
      toast('error', err?.error || 'Não foi possível cancelar a comanda');
      if (err?.status >= 400 && err?.status < 500) setCancelamento(null);
      void loadComanda();
    } finally { finalizandoRef.current = false; setFinalizando(false); }
  };

  const finalizar = async () => {
    if (!comanda || !iniciarFechamento()) return;
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
      falhaFechamento(err, 'Erro ao fechar comanda');
    } finally {
      finalizandoRef.current = false;
      setFinalizando(false);
    }
  };

  const preFechar = async () => {
    if (!comanda || !iniciarFechamento()) return;
    try {
      const r = await comandaApi.fechar(comandaId, {
        tipo,
        taxa_garcom_pct: Number(taxa || 0),
        forma,
        responsavel: comanda.garcom_nome || undefined,
        pre_fechar: true,
      });
      setFechar(false);
      if (r.mesa_liberada) { toast('success', r.mensagem || 'Mesa vazia liberada'); navigate('/restaurante'); return; }
      await loadComanda();
      try {
        const imp = await impressoraApi.imprimirComanda(comandaId, { setor, tipo: 'conta' });
        setImprimir({ impressao: imp.impressao, setor: 'Pré-conta', enviada: !!imp.jobs?.some(job=>job.ok) });
        toast('success', `${r.mensagem || 'Conta pré-fechada'} · ${confirmarImpressao(imp.jobs)}`);
      } catch (err: any) {
        toast('error', `Conta pré-fechada, mas a impressão não foi confirmada: ${err?.error || err?.message || 'falha de conexão'}. Use Reimprimir pré-conta para tentar novamente.`);
      }
    } catch (err: any) {
      falhaFechamento(err, 'Erro ao pré-fechar');
    } finally {
      finalizandoRef.current = false;
      setFinalizando(false);
    }
  };

  const abrirBaixa = () => {
    if (!comanda) return;
    if (mesaVazia) { abrirFechamento(); return; }
    setTipo((comanda.fechamento_tipo || 'unica') as 'unica' | 'divisao' | 'individual');
    setBaixar(true);
  };

  const finalizarBaixa = async () => {
    if (!comanda || !iniciarFechamento()) return;
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
      falhaFechamento(err, 'Erro ao baixar conta');
    } finally {
      finalizandoRef.current = false;
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
    if (!comanda || finalizandoRef.current) return;
    const pessoas_valores = Object.entries(valoresIndiv)
      .filter(([, v]) => {
        const n = Number(v);
        return !Number.isNaN(n) && n > 0;
      })
      .map(([k, v]) => ({ pessoa_id: k === 'geral' ? null : Number(k.slice(1)), valor: Number(v) }));
    if (!pessoas_valores.length) return toast('error', 'Aplique ao menos um valor a pagar');
    if (!iniciarFechamento()) return;
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
      falhaFechamento(err, 'Erro ao gerar contas individuais');
    } finally {
      finalizandoRef.current = false;
      setFinalizando(false);
    }
  };

  if (load) return <Spinner label="Carregando comanda..." />;
  if (!comanda) return <div className="py-20 text-center text-slate-400">Comanda não encontrada</div>;
  if (Number(searchParams.get('pessoa'))>0 && !pessoas.some(p=>p.id===Number(searchParams.get('pessoa')))) {
    return <AnimatedPage><Card className="space-y-4 p-5"><p className="font-bold">Este atendimento foi encerrado ou não está mais nesta mesa.</p><p className="text-sm text-slate-500">Consulte o cartão na Recepção para continuar com o atendimento atual.</p><Button onClick={()=>navigate('/restaurante/recepcao')}>Voltar à Recepção</Button></Card></AnimatedPage>;
  }

  const itensDaPessoa = (pessoaId: number | null) =>
    ativos.filter((i) => (pessoaId === null ? i.pessoa_id === null : i.pessoa_id === pessoaId));

  const preFechada = comanda.status === 'pre_fechamento';
  const avisoHistorico = comanda.status === 'fechada'
    ? comanda.fechamento_tipo === 'cancelada'
      ? 'Os pedidos foram cancelados e a mesa foi liberada, sem estornar as vendas anteriores. O histórico financeiro continua pendente de conferência.'
      : comanda.fechamento_tipo === 'sem_consumo'
        ? 'A ocupação da mesa foi encerrada sem nova baixa. As vendas anteriores continuam no histórico para conferência.'
        : 'A conta atual foi baixada e a mesa foi liberada. As vendas anteriores continuam no histórico para conferência.'
    : mesaVazia
      ? 'Como não há produtos ativos, você pode liberar apenas a mesa, preservando os registros anteriores.'
      : comanda.pode_fechar_pedidos_novos
        ? 'Os produtos ativos foram lançados depois da última venda. Você pode fechar a conta normalmente: somente esses novos pedidos serão cobrados, sem repetir as vendas antigas.'
        : 'Uma nova baixa está bloqueada: há produtos que podem ter sido cobrados antes. O histórico precisa de conferência para evitar cobrança e estoque duplicados.';

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
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          {!locked && !pessoaCartao && !comanda.comanda_origem_id && (comanda.mesa?.tipo || 'normal') === 'normal' && <Button variant="secondary" icon={<ArrowRightLeft className="h-4 w-4" />}
            disabled={transferindo || finalizando || adicionando || enviandoCozinha || !!pendente || !itens.some((i) => ['novo','enviado','entregue'].includes(i.status))}
            onClick={abrirTransferenciaMesa}>Transferir todos</Button>}
          <Select className="w-40" value={setor} onChange={(e) => setSetor(e.target.value)} disabled={locked}>
            {setores.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
          <Button variant="secondary" icon={<Printer className="h-4 w-4" />} loading={imprimindoConta} onClick={imprimirComanda}>
            {pessoaCartao ? 'Imprimir pré-conta' : locked ? 'Reimprimir pré-conta' : 'Imprimir pedidos'}
          </Button>
          {!locked && !pessoaCartao && <Button variant="secondary" icon={<Printer className="h-4 w-4" />} loading={imprimindoConta} onClick={()=>void imprimirConta()}>Imprimir pré-conta</Button>}
          {pessoaCartao ? (
            <Button variant="success" icon={<HandCoins className="h-4 w-4" />} onClick={()=>navigate(`/restaurante/recepcao?atendimento=${pessoaCartao.cartao_atendimento_id}&fechar=1`)}>Fechar comanda individual</Button>
          ) : mesaVazia ? (
            <Button variant="secondary" icon={<CheckCheck className="h-4 w-4" />} onClick={abrirFechamento}>Liberar mesa vazia</Button>
          ) : !locked ? (
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
          {podeCancelarTudo && <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} disabled={finalizando || transferindo || adicionando || enviandoCozinha || !!pendente} onClick={abrirCancelamento}>Cancelar tudo e liberar mesa</Button>}
        </div>
      </div>

      {pessoaCartao && <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 p-4">
        <div><p className="font-bold">Comanda individual · {pessoaCartao.nome}</p><p className="text-sm text-slate-500">Os novos pedidos serão lançados para esta pessoa na mesa {comanda.mesa?.numero}.</p></div>
        <Button onClick={()=>navigate(`/restaurante/recepcao?atendimento=${pessoaCartao.cartao_atendimento_id}&fechar=1`)}>Fechar comanda individual</Button>
      </Card>}

      {pendente && <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm text-amber-900">{adicionando ? 'Confirmando lançamento…' : 'Lançamento aguardando confirmação. Tente novamente para concluir sem duplicar.'}</p>
        <Button loading={adicionando} onClick={() => void enviarLancamento(pendente)}>Tentar novamente</Button>
      </div>}

      {vendasAnteriores.length > 0 && <div role="alert" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">Comanda nº {comanda.id}: vendas {vendasAnteriores.map((v) => `#${v.id}`).join(', ')} já registradas.</p>
        <p className="mt-1">Esses números são de vendas, não de comandas. O histórico precisa de conferência; isso não significa que há um fechamento em andamento.</p>
        <p className="mt-1">{avisoHistorico}</p>
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => navigate('/restaurante')}>Voltar às mesas</Button>
      </div>}

      {comanda.status === 'fechada' && comanda.fechamento_tipo === 'cancelada' && <div role="status" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">Comanda cancelada pelo Gestor. A mesa foi liberada sem nova cobrança. Os pedidos continuam no histórico como cancelados.</div>}

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
            <RestaurantCatalog products={produtos} categories={categorias} onSelect={abrirAdicionar} />
          )}

          {/* Pessoas */}
          {!locked && (
            <Card className="p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-slate-700">Pessoas:</span>
                <button
                  {...destinoPessoa(null)}
                  onClick={() => setPessoaSel('geral')}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${sobrePessoa === 'null' ? 'ring-2 ring-brand-500 ring-offset-2' : ''} ${pessoaSel === 'geral' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'}`}
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
                      {...(p.status !== 'baixado' ? destinoPessoa(p.id) : {})}
                      role="button"
                      tabIndex={0}
                      onClick={() => setPessoaSel(p.id)}
                      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setPessoaSel(p.id); } }}
                      className={`group flex cursor-pointer items-center gap-1.5 rounded-full py-1 pl-3 pr-1 text-xs font-semibold ${sobrePessoa === String(p.id) ? 'ring-2 ring-brand-500 ring-offset-2' : ''} ${pessoaSel === p.id ? 'text-white' : 'bg-slate-100 text-slate-600'}`}
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
              <h2 className="text-sm font-bold text-slate-700">{pessoaCartao ? `Pedidos de ${pessoaCartao.nome}` : 'Itens'} ({ativosExibidos.length})</h2>
              {!locked && itensNovos.length > 0 && (
                <Button size="sm" variant="secondary" icon={<Send className="h-3.5 w-3.5" />} loading={enviandoCozinha} onClick={() => void enviarCozinha()}>
                  Enviar
                </Button>
              )}
            </div>
            {!locked && ativos.length > 0 && <p className="mb-3 text-xs text-slate-500">Clique em um pedido para alterar ou transferir. No computador, arraste para a pessoa desejada.</p>}
            {ativosExibidos.length === 0 ? (
              <EmptyState icon={<Plus className="h-6 w-6" />} title="Nenhum item na comanda" subtitle="Adicione produtos ao lado" />
            ) : (
              <div className="space-y-2">
                {itensExibidos.map((item) => {
                  const pessoa = nomePessoaDe(item.pessoa_id);
                  return (
                    <div key={item.id} className={`rounded-xl bg-slate-50 px-3 py-2 ${arrastando?.id === item.id ? 'opacity-50' : ''}`}
                      draggable={podeTransferir(item)}
                      onDragStart={(e) => {
                        if (!podeTransferir(item)) { e.preventDefault(); return; }
                        setArrastando(item); e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('application/x-simplexsa-item', String(item.id));
                      }}
                      onDragEnd={() => { setArrastando(null); setSobrePessoa(null); }}
                    >
                      <button type="button"
                        className={`flex w-full items-center justify-between gap-2 rounded-lg text-left ${podeTransferir(item) ? 'hover:bg-slate-100' : ''}`}
                        disabled={!podeTransferir(item)}
                        aria-label={`Alterar pedido: ${item.nome}, ${pessoa?.nome || 'Conta geral'}`}
                        onClick={() => setAcoesItem(item)}
                      >
                        {podeTransferir(item) && <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-slate-400" aria-hidden="true" />}
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                            <span>{item.nome}</span>
                            {pessoa && (
                              <span className="rounded-full px-2 py-0.5 text-[10px] font-bold text-white" style={{ backgroundColor: pessoa.cor }}>
                                {pessoa.nome}
                              </span>
                            )}
                          </p>
                          {item.observacao && String(item.observacao).split('\n').map((obs, i) => (
                            <p key={i} className="text-[11px] text-amber-600">({obs})</p>
                          ))}
                          {item.responsavel && <p className="mt-1 text-[11px] text-slate-500">Lançado por {item.responsavel}</p>}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Badge color={item.status === 'entregue' ? 'green' : item.status === 'enviado' ? 'blue' : 'amber'}>
                            {item.status}
                          </Badge>
                          <span className="w-16 text-right text-sm font-bold text-slate-700">
                            {fmtNum(item.quantidade)}x {fmtBRL(item.preco_unitario * item.quantidade)}
                          </span>
                          {podeTransferir(item) && <MoreHorizontal className="h-4 w-4 shrink-0 text-slate-500" />}
                        </div>
                      </button>
                      {!!item.impressoes?.length && <p className={`mt-1 text-xs ${item.impressoes.some((p) => ['erro', 'failed', 'cancelled', 'ausente'].includes(p.status)) ? 'font-semibold text-red-600' : 'text-slate-500'}`}>
                        {item.impressoes.some((p) => ['erro', 'failed', 'cancelled', 'ausente'].includes(p.status))
                          ? `Verificar impressão: ${item.impressoes.find((p) => p.erro)?.erro || 'Trabalho não concluído. Confira o servidor de impressão.'}`
                          : item.impressoes.every((p) => ['feito', 'success'].includes(p.status)) ? 'Enviado à impressora'
                            : item.impressoes.some((p) => ['processando', 'processing', 'sent', 'enviado'].includes(p.status)) ? 'Impressão em andamento' : 'Na fila de impressão'}
                      </p>}
                      {!locked && !transferindo && ['novo', 'enviado'].includes(item.status) && (
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
            <h2 className="mb-3 text-sm font-bold text-slate-700">{pessoaCartao ? `Conta de ${pessoaCartao.nome}` : 'Resumo da mesa'}</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-slate-500">
                <span>Subtotal</span>
                <span className="font-semibold text-slate-800">{fmtBRL(subtotalExibido)}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Taxa de serviço ({taxaExibida}%)</span>
                <span className="font-semibold text-slate-800">{fmtBRL(subtotalExibido * taxaExibida / 100)}</span>
              </div>
              <div className="flex justify-between border-t border-slate-100 pt-2">
                <span className="font-bold text-slate-700">Total</span>
                <span className="text-lg font-extrabold text-brand-600">{fmtBRL(subtotalExibido * (1+taxaExibida/100))}</span>
              </div>
              {!pessoaCartao && <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 p-2.5">
                <span className="text-xs font-semibold text-slate-500">Taxa %</span>
                <Input aria-label="Taxa de serviço (%)" type="number" min="0" max="100" step="0.1" className="!w-20 !py-1 text-right" value={taxa} onChange={(e) => setTaxa(e.target.value)} />
              </div>}
              {!pessoaCartao && <Button type="button" variant="ghost" size="sm" onClick={() => setTaxa('0')}>Sem taxa de serviço</Button>}
            </div>

            {!locked && !pessoaCartao && (
              <div className="mt-4 border-t border-slate-100 pt-3">
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Por pessoa</h3>
                <div className="space-y-2">
                  {[{ id: null, nome: 'Conta geral', cor: '#64748b', status: 'pendente' }, ...pessoas].map((p) => {
                    const personItems = ativos.filter((i) => i.pessoa_id === p.id);
                    const total = personItems.reduce((sum, i) => sum + i.quantidade * i.preco_unitario, 0);
                    return <div key={p.id ?? 'geral'} {...(p.status !== 'baixado' ? destinoPessoa(p.id) : {})}
                      className={`rounded-xl border-2 p-3 transition-colors ${sobrePessoa === String(p.id) ? 'border-brand-500 bg-brand-50' : 'border-slate-100 bg-slate-50'}`}>
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="flex items-center gap-2 font-semibold text-slate-700"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.cor }} />{p.nome}</span>
                        <span className="font-bold text-slate-800">{fmtBRL(total)}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{arrastando && arrastando.pessoa_id !== p.id ? 'Solte aqui para transferir' : `${personItems.length} lançamento(s)`}</p>
                    </div>;
                  })}
                </div>
              </div>
            )}

            {pessoaCartao ? (
              <Button className="mt-4 w-full" size="lg" onClick={abrirFechamento}>Fechar comanda individual</Button>
            ) : mesaVazia ? (
              <Button variant="secondary" className="mt-4 w-full" size="lg" icon={<CheckCheck className="h-5 w-5" />} onClick={abrirFechamento}>Liberar mesa vazia</Button>
            ) : !locked ? (
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
            {podeCancelarTudo && <Button variant="danger" className="mt-2 w-full" icon={<Trash2 className="h-4 w-4" />} disabled={finalizando || transferindo || adicionando || enviandoCozinha || !!pendente} onClick={abrirCancelamento}>Cancelar tudo e liberar mesa</Button>}
          </Card>
        </div>
      </div>

      <Modal open={!!acoesItem} onClose={() => setAcoesItem(null)} title="Alterar pedido">
        {acoesItem && <div className="space-y-3">
          <p className="font-bold text-slate-800">{fmtNum(acoesItem.quantidade)} × {acoesItem.nome}</p>
          <p className="text-sm text-slate-500">{nomePessoaDe(acoesItem.pessoa_id)?.nome || 'Conta geral'} · {acoesItem.status}</p>
          {acoesItem.status === 'novo' && !!acoesItem.produto_id && <Button className="w-full" variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => { setAcoesItem(null); void abrirEditarItem(acoesItem); }}>Editar observações</Button>}
          <Button className="w-full" variant="secondary" icon={<Users className="h-4 w-4" />} onClick={() => abrirTransferencia(acoesItem, 'pessoa')}>Transferir para outra pessoa</Button>
          <Button className="w-full" variant="secondary" icon={<ArrowRightLeft className="h-4 w-4" />} onClick={() => abrirTransferencia(acoesItem, 'mesa')}>Transferir para outra mesa</Button>
        </div>}
      </Modal>
      {transferencia && <TransferItemModal item={transferencia.item} source={comanda} initialMode={transferencia.mode} busy={transferindo}
        onClose={() => setTransferencia(null)} onTransfer={transferirItem} />}
      {transferenciaMesa && <TransferTableModal source={transferenciaMesa} busy={transferindo} onClose={() => setTransferenciaMesa(null)} onTransfer={transferirMesa} />}

      <Modal open={!!cancelamento} onClose={() => { if (!finalizandoRef.current) setCancelamento(null); }} title="Cancelar tudo e liberar mesa">
        <div className="space-y-4">
          <p className="text-sm text-slate-700">Isso encerra a comanda nº {cancelamento?.comandaId} e cancela todos os seus pedidos ativos. A mesa ficará livre, sem nova cobrança ou movimentação de estoque.</p>
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">Use somente se deseja cancelar os pedidos, não para registrar um pagamento recebido. Vendas e pagamentos já registrados não serão apagados, cancelados ou estornados. Perdas anteriores e o histórico dos pedidos serão preservados.</div>
          <Field label="Motivo do cancelamento">
            <Input aria-label="Motivo do cancelamento total" value={motivoCancelamento} maxLength={300} disabled={finalizando} onChange={(e) => setMotivoCancelamento(e.target.value)} />
          </Field>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" aria-label="Confirmo cancelar os pedidos sem estornar vendas" className="mt-1" checked={confirmarCancelamento} disabled={finalizando} onChange={(e) => setConfirmarCancelamento(e.target.checked)} />
            <span>Confirmo cancelar os pedidos e liberar a mesa, sem estornar vendas antigas.</span>
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => navigate('/restaurante')}>Voltar às mesas</Button>
            <Button variant="secondary" disabled={finalizando} onClick={() => setCancelamento(null)}>Manter comanda</Button>
            <Button variant="danger" loading={finalizando} disabled={!confirmarCancelamento || motivoCancelamento.trim().length < 3} onClick={cancelarTudo}>Confirmar cancelamento</Button>
          </div>
        </div>
      </Modal>

      <Modal open={liberarVazia} onClose={() => { if (!finalizandoRef.current) setLiberarVazia(false); }} title="Liberar mesa vazia">
        <div className="space-y-4">
          <p className="text-sm text-slate-700">A comanda nº {comanda.id} não tem produtos ativos. Esta ação encerra somente a ocupação e deixa a mesa disponível novamente.</p>
          <p className="text-sm text-slate-600">Não gera venda, cobrança, pagamento, impressão ou movimentação de estoque. O histórico permanece intacto.</p>
          {vendasAnteriores.length > 0 && <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">As vendas {vendasAnteriores.map((v) => `#${v.id}`).join(', ')} continuarão registradas e precisam ser conferidas separadamente. Liberar a mesa não cancela nem regulariza essas vendas.</div>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => navigate('/restaurante')}>Voltar às mesas</Button>
            <Button variant="secondary" disabled={finalizando} onClick={() => setLiberarVazia(false)}>Cancelar</Button>
            <Button variant="success" loading={finalizando} onClick={liberarMesaVazia}>Confirmar liberação</Button>
          </div>
        </div>
      </Modal>

      {/* Fechamento */}
      <Modal open={fechar} onClose={() => { if (!finalizandoRef.current) setFechar(false); }} title="Fechamento da comanda" width="max-w-2xl">
        <div className="space-y-4">
          {comanda.pode_fechar_pedidos_novos && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Esta baixa inclui somente os novos pedidos listados abaixo. As vendas anteriores {vendasAnteriores.map((v) => `#${v.id}`).join(', ')} ficam preservadas e não serão cobradas novamente. A conferência do histórico continua pendente.
          </div>}
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
            <Field label="Taxa de serviço (%)" hint="Informe 0 quando o cliente não pagar a taxa.">
              <Input aria-label="Taxa de serviço no fechamento (%)" type="number" min="0" max="100" step="0.1" value={taxa} onChange={(e) => setTaxa(e.target.value)} />
              <Button type="button" variant="ghost" size="sm" onClick={() => setTaxa('0')}>Sem taxa de serviço</Button>
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
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" disabled={finalizando} onClick={() => setFechar(false)}>Fechar esta tela</Button>
            <Button variant="ghost" onClick={() => navigate('/restaurante')}>Voltar às mesas</Button>
          </div>
        </div>
      </Modal>

      {/* Baixar conta pré-fechada */}
      <Modal open={baixar} onClose={() => { if (!finalizandoRef.current) setBaixar(false); }} title="Baixar conta paga" width="max-w-md">
        <div className="space-y-4">
          {comanda.pode_fechar_pedidos_novos && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Somente os novos pedidos serão baixados. As vendas antigas não serão cobradas novamente e continuam preservadas para conferência.</p>}
          <div className="rounded-xl bg-slate-50 p-3 text-center">
            <p className="text-xs text-slate-400">Total da conta</p>
            <p className="text-2xl font-extrabold text-brand-600">{fmtBRL(totalComTaxa)}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Taxa de serviço (%)" hint="Informe 0 quando o cliente não pagar a taxa.">
              <Input aria-label="Taxa de serviço na baixa (%)" type="number" min="0" max="100" step="0.1" value={taxa} onChange={(e) => setTaxa(e.target.value)} />
              <Button type="button" variant="ghost" size="sm" onClick={() => setTaxa('0')}>Sem taxa de serviço</Button>
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
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" disabled={finalizando} onClick={() => setBaixar(false)}>Fechar esta tela</Button>
            <Button variant="ghost" onClick={() => navigate('/restaurante')}>Voltar às mesas</Button>
          </div>
        </div>
      </Modal>

      {/* Adicionar produto */}
      <Modal open={!!addProduto} onClose={() => { if (adicionandoRef.current) return; setAddProduto(null); setEditandoItem(null); }} title={editandoItem ? 'Observações do produto' : 'Adicionar produto'} width="max-w-md">
        {addProduto && (
          <fieldset disabled={adicionando} className="space-y-4">
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-sm font-bold text-slate-800">{addProduto.nome}</p>
              <p className="text-xs text-slate-500">{addProduto.preco != null ? fmtBRL(addProduto.preco) : 'Sem preço de venda · valor base R$ 0,00'}</p>
            </div>
            {addProduto.tipo === 'combo' && !editandoItem && <ComboEscolha grupos={(JSON.parse(addProduto.combo_grupos_json || '[]') as NonNullable<Produto['combo_grupos']>).map((g) => ({ ...g, opcoes: g.opcoes.map((o) => ({ ...o, nome: opcoesCombo.find((p) => p.id === o.produto_id)?.nome })) }))} escolhas={comboChoices} onChange={setComboChoices} />}

            <Field label="Quantidade">
              <div className="flex items-center gap-2">
                {!editandoItem && <Button type="button" variant="secondary" size="sm" className="h-9 w-9 p-0" onClick={() => alterarQuantidade(addQtd - 1)}>
                  <Minus className="h-4 w-4" />
                </Button>}
                <Input
                  type="number"
                  min={1}
                  className="w-20 text-center"
                  value={addQtd}
                  disabled={!!editandoItem}
                  onChange={(e) => alterarQuantidade(Number(e.target.value) || 1)}
                />
                {!editandoItem && <Button type="button" variant="secondary" size="sm" className="h-9 w-9 p-0" onClick={() => alterarQuantidade(addQtd + 1)}>
                  <Plus className="h-4 w-4" />
                </Button>}
              </div>
            </Field>

            {!editandoItem && addQtd > 1 && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-slate-700">Aplicar em conjunto</p>
                    <p className="text-[11px] text-slate-500">Mantém {addQtd}x em uma linha; desligado permite observar cada unidade.</p>
                  </div>
                  <Toggle checked={aplicarEmConjunto} onChange={alterarAplicarEmConjunto} label="Aplicar observações em conjunto" />
                </div>
              </div>
            )}

            {!aplicarEmConjunto && !editandoItem && addQtd > 1 && (
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: addQtd }, (_, i) => (
                  <Button key={i} type="button" size="sm" variant={addUnidade === i ? 'primary' : 'secondary'} onClick={() => setAddUnidade(i)}>
                    Unidade {i + 1}{addObsUnidades[i]?.length ? ` (${addObsUnidades[i].length})` : ''}
                  </Button>
                ))}
              </div>
            )}

            {(addProduto.acrescimos?.length || 0) > 0 && (
              <Field label="Acréscimo de produto" hint="Entra como observação. O valor é o preço de venda do insumo.">
                <div className="flex flex-wrap gap-1.5">
                  {addProduto.acrescimos!.map((acrescimo) => (
                    <button
                      key={acrescimo.insumo_id}
                      type="button"
                      onClick={() => adicionarAcrescimo(acrescimo.insumo_id)}
                      className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100"
                    >
                      + {acrescimo.insumo_nome} ({fmtBRL(acrescimo.valor)})
                    </button>
                  ))}
                </div>
              </Field>
            )}

            {(addProduto.comentarios?.length || 0) > 0 ? (
              <Field label="Observações automáticas">
                <div className="flex flex-wrap gap-1.5">
                  {addProduto.comentarios!.map((o) => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => adicionarObs(o)}
                      className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-brand-100 hover:text-brand-700"
                    >
                      + {o}
                    </button>
                  ))}
                </div>
              </Field>
            ) : (addProduto.acrescimos?.length ? null : (
              <p className="text-xs text-slate-400">Este produto não tem observações cadastradas.</p>
            ))}

            {(acrescimosAtuais.length > 0 || observacoesAtuais.length > 0) && (
              <div className="space-y-1 rounded-xl bg-brand-50 p-3">
                <p className="text-xs font-bold text-brand-700">Observações adicionadas</p>
                {acrescimosAtuais.map((id, i) => {
                  const acrescimo = addProduto.acrescimos?.find((item) => item.insumo_id === id);
                  return (
                    <div key={`acr-${id}-${i}`} className="flex items-center justify-between text-xs text-brand-800">
                      <span>(Adicionar: {acrescimo?.insumo_nome || 'Acréscimo'} · {fmtBRL(acrescimo?.valor || 0)})</span>
                      <button type="button" className="font-bold text-red-500" onClick={() => removerAcrescimo(id)}>− remover</button>
                    </div>
                  );
                })}
                {observacoesAtuais.map((o, i) => (
                  <div key={`${o}-${i}`} className="flex items-center justify-between text-xs text-brand-800">
                    <span>({o})</span>
                    <button type="button" className="font-bold text-red-500" onClick={() => removerObs(o)}>− remover</button>
                  </div>
                ))}
              </div>
            )}

            <Field label="Observação personalizada">
              <div className="flex gap-2">
                <Input value={addCustom} onChange={(e) => setAddCustom(e.target.value)} placeholder="Digite uma observação..." />
                <Button type="button" variant="secondary" onClick={adicionarPersonalizada}>Adicionar</Button>
              </div>
            </Field>

            {pessoaSel !== 'geral' && (
              <p className="text-xs text-slate-500">
                Item lançado para {pessoas.find((p) => p.id === pessoaSel)?.nome || 'a pessoa selecionada'}.
              </p>
            )}

            <div className="rounded-xl bg-slate-50 p-3 text-center">
              <p className="text-xs text-slate-400">Total</p>
              <p className="text-xl font-extrabold text-brand-600">{fmtBRL(((addProduto.preco || 0) + (addProduto.tipo === 'combo' ? adicionalCombo(JSON.parse(addProduto.combo_grupos_json || '[]'), comboChoices) : 0)) * addQtd + extraTotal)}</p>
            </div>

            <Button className="w-full" loading={adicionando} disabled={!storageKey || (addProduto.tipo === 'combo' && !editandoItem && !comboCompleto(JSON.parse(addProduto.combo_grupos_json || '[]'), comboChoices))} onClick={confirmarAdicao}>
              {editandoItem ? 'Salvar observações' : `Adicionar ${addQtd}x ${addProduto.nome}`}
            </Button>
          </fieldset>
        )}
      </Modal>

      {/* Impressão preview */}
      <Modal open={!!imprimir} onClose={() => setImprimir(null)} title={`Comanda · ${imprimir?.setor || ''}`}>
        <div className="mx-auto w-64 rounded-lg border-2 border-dashed border-slate-300 bg-white p-3 font-mono text-[11px] leading-4">
          <pre className="whitespace-pre-wrap text-slate-800">{imprimir?.impressao}</pre>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setImprimir(null)}>Fechar</Button>
          <Button icon={<Printer className="h-4 w-4" />} loading={imprimindoConta} onClick={() => void imprimirConta(imprimir?.pessoaId)}>{imprimir?.enviada ? 'Reimprimir pré-conta' : 'Tentar imprimir novamente'}</Button>
        </div>
      </Modal>
    </AnimatedPage>
  );
}
