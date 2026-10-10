/**
 * Arquivo: LancarCartaoPage.tsx
 * Responsabilidade: Monta o pedido e grava no cartão NFC quando ele é aproximado.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Minus, Nfc, Plus, Trash2 } from 'lucide-react';
import { AnimatedPage } from '@/components/AnimatedPage';
import { RestaurantCatalog } from '@/components/RestaurantCatalog';
import { Button, Card, Modal, Spinner, useToast } from '@/components/ui';
import { cartaoApi, categoriaApi, produtoApi } from '@/lib/api';
import type { NfcEvento } from '@/lib/api';
import { NFC_EVENTO } from '@/lib/useNfcBridge';
import type { Categoria, Produto } from '@/lib/types';
import { fmtBRL } from '@/lib/format';

interface ItemPedido {
  produto: Produto;
  quantidade: number;
}

export function LancarCartaoPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [load, setLoad] = useState(true);
  const [itens, setItens] = useState<ItemPedido[]>([]);
  const [espera, setEspera] = useState(false);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    Promise.all([produtoApi.list(undefined, 'restaurante'), categoriaApi.list()])
      .then(([lista, cats]) => {
        setProdutos(lista);
        setCategorias(cats);
      })
      .catch(() => toast('error', 'Não foi possível carregar o cardápio'))
      .finally(() => setLoad(false));
  }, []);

  const somar = (produto: Produto, delta: number) => {
    setItens((atual) => {
      const existente = atual.find((item) => item.produto.id === produto.id);
      if (!existente) return delta > 0 ? [...atual, { produto, quantidade: 1 }] : atual;
      const quantidade = existente.quantidade + delta;
      if (quantidade <= 0) return atual.filter((item) => item.produto.id !== produto.id);
      return atual.map((item) => item.produto.id === produto.id ? { ...item, quantidade: Math.min(quantidade, 99) } : item);
    });
  };

  const total = itens.reduce((soma, item) => soma + Number(item.produto.preco || 0) * item.quantidade, 0);

  const lancar = async (leitura: NfcEvento) => {
    if (enviando || !itens.length) return;
    setEnviando(true);
    try {
      const resultado = await cartaoApi.usar({
        acao: 'lancar',
        uid: leitura.uid,
        payload: leitura.payload,
        garcom_nome: localStorage.getItem('simplesx_garcom_fixo') || undefined,
        chave: crypto.randomUUID(),
        itens: itens.map((item) => ({ produto_id: item.produto.id, quantidade: item.quantidade })),
      });
      const falha = resultado.cozinha?.sem_rota?.[0] || resultado.cozinha?.falhas?.[0]?.erro;
      if (falha) toast('error', `Pedido guardado no cartão ${resultado.cartao}. A cozinha não recebeu: ${falha}`);
      else toast('success', `Pedido do cartão ${resultado.cartao} enviado à cozinha`);
      navigate(`/restaurante/comanda/${resultado.comanda_id}`);
    } catch (error: any) {
      toast('error', error?.error || 'Não foi possível lançar no cartão');
      setEnviando(false);
    }
  };

  useEffect(() => {
    if (!espera || enviando) return;
    const aoLer = (event: Event) => {
      const leitura = (event as CustomEvent<NfcEvento>).detail;
      if (!leitura?.uid && !leitura?.payload) return;
      void lancar(leitura);
    };
    window.addEventListener(NFC_EVENTO, aoLer);
    return () => window.removeEventListener(NFC_EVENTO, aoLer);
  }, [espera, enviando, itens]);

  if (load) return <Spinner />;

  return (
    <AnimatedPage>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-800">Lançar para cartão</h1>
          <p className="text-sm text-slate-500">Adicione os itens. Depois aproxime o cartão para guardar o pedido e enviar à cozinha.</p>
        </div>
        <Button variant="secondary" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate('/restaurante')}>Mesas</Button>
      </div>

      <RestaurantCatalog products={produtos} categories={categorias} onSelect={(produto) => somar(produto, 1)} />

      <Card className="p-4">
        <h2 className="text-sm font-bold text-slate-700">Pedido</h2>
        {itens.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Nenhum item ainda. Escolha no cardápio.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {itens.map((item) => (
              <div key={item.produto.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800">{item.produto.nome}</p>
                  <p className="text-xs text-slate-500">{fmtBRL(Number(item.produto.preco || 0) * item.quantidade)}</p>
                </div>
                <div className="flex items-center gap-1">
                  <Button type="button" size="sm" variant="secondary" onClick={() => somar(item.produto, -1)} aria-label={`Diminuir ${item.produto.nome}`}>
                    <Minus className="h-3.5 w-3.5" />
                  </Button>
                  <span className="w-8 text-center text-sm font-bold">{item.quantidade}</span>
                  <Button type="button" size="sm" variant="secondary" onClick={() => somar(item.produto, 1)} aria-label={`Aumentar ${item.produto.nome}`}>
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => somar(item.produto, -item.quantidade)} aria-label={`Remover ${item.produto.nome}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-extrabold text-slate-800">Total {fmtBRL(total)}</p>
          <Button type="button" disabled={!itens.length} icon={<Nfc className="h-4 w-4" />} onClick={() => setEspera(true)}>
            Aguardar cartão
          </Button>
        </div>
      </Card>

      <Modal open={espera} onClose={() => { if (!enviando) setEspera(false); }} title="Aproxime o cartão">
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <Nfc className="h-12 w-12 text-brand-600" />
          <p className="text-sm text-slate-600">
            O leitor identifica o cartão, guarda estes itens nessa mesa e envia o pedido à cozinha.
          </p>
          {enviando && <Spinner />}
        </div>
      </Modal>
    </AnimatedPage>
  );
}
