/**
 * Arquivo: LancarCartaoPage.tsx
 * Responsabilidade: Monta o pedido e o registra na comanda identificada pelo cartão NFC.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Minus, Nfc, Plus, Trash2 } from 'lucide-react';
import { AnimatedPage } from '@/components/AnimatedPage';
import { RestaurantCatalog } from '@/components/RestaurantCatalog';
import { NfcScanButton } from '@/components/NfcScanButton';
import { Button, Card, Input, Modal, Spinner, useToast } from '@/components/ui';
import { ComboEscolha, adicionalCombo, comboCompleto, resumoEscolhasCombo } from '@/components/ComboFields';
import { cartaoApi, categoriaApi, produtoApi } from '@/lib/api';
import type { NfcEvento } from '@/lib/api';
import { useNfcLeitura } from '@/lib/useNfcBridge';
import { useWebNfc } from '@/lib/useWebNfc';
import type { Categoria, ComboGrupo, Produto } from '@/lib/types';
import { fmtBRL } from '@/lib/format';

interface ItemPedido {
  id: string;
  produto: Produto;
  quantidade: number;
  observacao: string;
  acrescimos: number[];
  comboChoices?: number[][];
}

const gruposCombo = (produto: Produto): ComboGrupo[] => produto.tipo === 'combo' ? JSON.parse(produto.combo_grupos_json || '[]') : [];
const precoItem = (item: ItemPedido) => Number(item.produto.preco || 0)
  + item.acrescimos.reduce((soma, id) => soma + Number(item.produto.acrescimos?.find((a) => a.insumo_id === id)?.valor || 0), 0)
  + adicionalCombo(gruposCombo(item.produto), item.comboChoices || []);

export function LancarCartaoPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [opcoesCombo, setOpcoesCombo] = useState<Produto[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [load, setLoad] = useState(true);
  const [itens, setItens] = useState<ItemPedido[]>([]);
  const [selecionado, setSelecionado] = useState<Produto | null>(null);
  const [quantidade, setQuantidade] = useState(1);
  const [comboChoices, setComboChoices] = useState<number[][]>([]);
  const [observacoes, setObservacoes] = useState<string[]>([]);
  const [acrescimos, setAcrescimos] = useState<number[]>([]);
  const [observacaoLivre, setObservacaoLivre] = useState('');
  const [espera, setEspera] = useState(false);
  const [leituraSolicitada, setLeituraSolicitada] = useState(false);
  const webNfc = useWebNfc();
  const esperaVersaoRef = useRef(0);
  const esperaVersao = esperaVersaoRef.current;
  const [enviando, setEnviando] = useState(false);
  const enviandoRef = useRef(false);

  useEffect(() => {
    Promise.all([produtoApi.list(undefined, 'restaurante'), categoriaApi.list(), produtoApi.list()])
      .then(([lista, cats, todasOpcoes]) => {
        setProdutos(lista);
        setCategorias(cats);
        setOpcoesCombo(todasOpcoes);
      })
      .catch(() => toast('error', 'Não foi possível carregar o cardápio'))
      .finally(() => setLoad(false));
  }, []);

  const abrirProduto = (produto: Produto) => {
    setSelecionado(produto);
    setQuantidade(1);
    setComboChoices([]);
    setObservacoes([]);
    setAcrescimos([]);
    setObservacaoLivre('');
  };

  const adicionarProduto = () => {
    if (!selecionado || (selecionado.tipo === 'combo' && !comboCompleto(gruposCombo(selecionado), comboChoices))) return;
    const observacao = [...observacoes, observacaoLivre.trim()].filter(Boolean).join('\n');
    const novo: ItemPedido = { id: crypto.randomUUID(), produto: selecionado, quantidade, observacao, acrescimos, ...(selecionado.tipo === 'combo' ? { comboChoices } : {}) };
    setItens((atual) => [...atual, novo]);
    setSelecionado(null);
  };

  const somar = (id: string, delta: number) => setItens((atual) => atual.map((item) => item.id === id ? { ...item, quantidade: Math.min(99, item.quantidade + delta) } : item).filter((item) => item.quantidade > 0));
  const total = itens.reduce((soma, item) => soma + precoItem(item) * item.quantidade, 0);
  const precoSelecionado = selecionado ? Number(selecionado.preco || 0)
    + acrescimos.reduce((soma, id) => soma + Number(selecionado.acrescimos?.find((a) => a.insumo_id === id)?.valor || 0), 0)
    + adicionalCombo(gruposCombo(selecionado), comboChoices) : 0;

  const lancar = async (leitura: Pick<NfcEvento, 'uid' | 'payload'>) => {
    if (enviandoRef.current || !itens.length) return;
    enviandoRef.current = true;
    setEnviando(true);
    try {
      const resultado = await cartaoApi.usar({
        acao: 'lancar',
        uid: leitura.uid,
        payload: leitura.payload,
        garcom_nome: localStorage.getItem('simplesx_garcom_fixo') || undefined,
        chave: crypto.randomUUID(),
        itens: itens.map((item) => ({ produto_id: item.produto.id, quantidade: item.quantidade,
          ...(item.observacao ? { observacao: item.observacao } : {}),
          ...(item.acrescimos.length ? { acrescimos: item.acrescimos } : {}),
          ...(item.comboChoices ? { combo_escolhas: item.comboChoices } : {}),
        })),
      });
      const falha = resultado.cozinha?.sem_rota?.[0] || resultado.cozinha?.falhas?.[0]?.erro;
      if (falha) toast('error', `Pedido salvo na comanda do cartão ${resultado.cartao}. A cozinha não recebeu: ${falha}`);
      else toast('success', `Pedido do cartão ${resultado.cartao} enviado à cozinha`);
      webNfc.stop();
      navigate(`/restaurante/comanda/${resultado.comanda_id}${resultado.pessoa_id ? `?pessoa=${resultado.pessoa_id}` : ''}`);
    } catch (error: any) {
      toast('error', error?.error || 'Não foi possível lançar no cartão');
      enviandoRef.current = false;
      setEnviando(false);
    }
  };

  useNfcLeitura(espera && !enviando && !leituraSolicitada, (leitura) => {
    if (leitura?.uid || leitura?.payload) void lancar(leitura);
  });

  if (load) return <Spinner />;

  return (
    <AnimatedPage>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-800">Lançar para cartão</h1>
          <p className="text-sm text-slate-500">Adicione os itens. Depois aproxime o cartão para identificar a comanda e enviar à cozinha.</p>
          <p className="text-xs text-slate-500">Cadastre o cliente e a mesa na Recepção antes do primeiro pedido.</p>
        </div>
        <Button variant="secondary" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate('/restaurante')}>Mesas</Button>
      </div>

      <RestaurantCatalog products={produtos} categories={categorias} onSelect={abrirProduto} />

      <Card className="p-4">
        <h2 className="text-sm font-bold text-slate-700">Pedido</h2>
        {itens.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Nenhum item ainda. Escolha no cardápio.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {itens.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800">{item.produto.nome}</p>
                  {item.comboChoices?.map((escolhas, i) => <p key={i} className="text-xs text-slate-500">{gruposCombo(item.produto)[i]?.nome}: {resumoEscolhasCombo(gruposCombo(item.produto)[i], escolhas)}</p>)}
                  {item.observacao && <p className="text-xs text-slate-500">{item.observacao}</p>}
                  {item.acrescimos.map((id, i) => <p key={`${id}-${i}`} className="text-xs text-slate-500">+ {item.produto.acrescimos?.find((a) => a.insumo_id === id)?.insumo_nome}</p>)}
                  <p className="text-xs text-slate-500">{fmtBRL(precoItem(item) * item.quantidade)}</p>
                </div>
                <div className="flex items-center gap-1">
                  <Button type="button" size="sm" variant="secondary" onClick={() => somar(item.id, -1)} aria-label={`Diminuir ${item.produto.nome}`}>
                    <Minus className="h-3.5 w-3.5" />
                  </Button>
                  <span className="w-8 text-center text-sm font-bold">{item.quantidade}</span>
                  <Button type="button" size="sm" variant="secondary" onClick={() => somar(item.id, 1)} aria-label={`Aumentar ${item.produto.nome}`}>
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => somar(item.id, -item.quantidade)} aria-label={`Remover ${item.produto.nome}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-extrabold text-slate-800">Total {fmtBRL(total)}</p>
          <Button type="button" disabled={!itens.length} icon={<Nfc className="h-4 w-4" />} onClick={() => { esperaVersaoRef.current++; setLeituraSolicitada(!!webNfc.begin()); setEspera(true); }}>
            Aguardar cartão
          </Button>
        </div>
      </Card>

      <Modal open={!!selecionado} onClose={() => setSelecionado(null)} title="Adicionar produto" width="max-w-md">
        {selecionado && <div className="space-y-4">
          <div className="rounded-xl bg-slate-50 p-3"><p className="font-bold">{selecionado.nome}</p><p className="text-sm text-slate-500">{selecionado.preco == null ? 'Sem preço de venda · valor base R$ 0,00' : fmtBRL(selecionado.preco)}</p></div>
          {selecionado.tipo === 'combo' && <ComboEscolha grupos={gruposCombo(selecionado).map((g) => ({ ...g, opcoes: g.opcoes.map((o) => ({ ...o, nome: opcoesCombo.find((p) => p.id === o.produto_id)?.nome })) }))} escolhas={comboChoices} onChange={setComboChoices} />}
          <div className="flex items-center gap-3"><span className="text-sm font-semibold">Quantidade</span><Button type="button" size="sm" variant="secondary" disabled={quantidade <= 1} onClick={() => setQuantidade((q) => q - 1)}><Minus className="h-4 w-4" /></Button><span className="w-6 text-center font-bold">{quantidade}</span><Button type="button" size="sm" variant="secondary" disabled={quantidade >= 99} onClick={() => setQuantidade((q) => q + 1)}><Plus className="h-4 w-4" /></Button></div>
          {!!selecionado.comentarios?.length && <div><p className="mb-2 text-sm font-semibold">Observações cadastradas</p><div className="flex flex-wrap gap-2">{selecionado.comentarios.map((texto) => <Button key={texto} type="button" size="sm" variant="secondary" onClick={() => setObservacoes((atual) => [...atual, texto])}>+ {texto}</Button>)}</div></div>}
          {!!selecionado.acrescimos?.length && <div><p className="mb-2 text-sm font-semibold">Acréscimo de produto</p><div className="flex flex-wrap gap-2">{selecionado.acrescimos.map((opcao) => <Button key={opcao.insumo_id} type="button" size="sm" variant="secondary" onClick={() => setAcrescimos((atual) => [...atual, opcao.insumo_id])}>+ {opcao.insumo_nome} ({fmtBRL(opcao.valor)})</Button>)}</div></div>}
          {(observacoes.length > 0 || acrescimos.length > 0) && <div className="space-y-1 rounded-xl bg-brand-50 p-3 text-sm"><p className="font-semibold">Observações adicionadas</p>{observacoes.map((texto, i) => <div key={`obs-${i}`} className="flex justify-between gap-2"><span>{texto}</span><button type="button" className="font-bold text-red-600" onClick={() => setObservacoes((atual) => atual.filter((_, j) => j !== i))}>Remover</button></div>)}{acrescimos.map((id, i) => <div key={`acr-${i}`} className="flex justify-between gap-2"><span>+ {selecionado.acrescimos?.find((a) => a.insumo_id === id)?.insumo_nome}</span><button type="button" className="font-bold text-red-600" onClick={() => setAcrescimos((atual) => atual.filter((_, j) => j !== i))}>Remover</button></div>)}</div>}
          <label className="block text-sm font-semibold">Observação personalizada<Input className="mt-1" value={observacaoLivre} maxLength={4000} onChange={(e) => setObservacaoLivre(e.target.value)} placeholder="Ex.: sem cebola, ponto da carne..." /></label>
          <p className="text-xs text-slate-500">Para observações diferentes, adicione o produto novamente.</p>
          <div className="rounded-xl bg-slate-50 p-3 text-center"><p className="text-xs text-slate-500">Total</p><p className="text-xl font-extrabold text-brand-600">{fmtBRL(precoSelecionado * quantidade)}</p></div>
          <Button className="w-full" type="button" disabled={selecionado.tipo === 'combo' && !comboCompleto(gruposCombo(selecionado), comboChoices)} onClick={adicionarProduto}>Adicionar {quantidade}x {selecionado.nome}</Button>
        </div>}
      </Modal>

      <Modal open={espera} onClose={() => { if (!enviandoRef.current) { webNfc.stop(); esperaVersaoRef.current++; setEspera(false); } }} title="Aproxime o cartão">
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <Nfc className="h-12 w-12 text-brand-600" />
          <NfcScanButton key={esperaVersao} enabled={!enviando} webScan={webNfc.scan} onWebStart={() => { webNfc.begin(true); setLeituraSolicitada(true); }} onStart={(exclusive = true) => setLeituraSolicitada(exclusive)} onRead={(reading) => { if (esperaVersaoRef.current === esperaVersao) void lancar(reading); }} />
          <p className="text-sm text-slate-600">
            Aproxime o cartão do leitor identificado acima. Os itens ficam na comanda do sistema.
          </p>
          <p className="text-xs text-slate-400">O cartão NTAG215 serve apenas como identificação. Nenhum pedido é gravado nele.</p>
          {enviando && <Spinner />}
        </div>
      </Modal>
    </AnimatedPage>
  );
}
