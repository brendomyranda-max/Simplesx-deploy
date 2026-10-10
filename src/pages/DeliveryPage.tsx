/**
 * Pedidos do site e o acesso ao DoixP Delivery.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bike, ExternalLink, Printer } from 'lucide-react';
import { AnimatedPage } from '@/components/AnimatedPage';
import { RestauranteAbas } from '@/components/RestauranteAbas';
import { Badge, Button, Card, EmptyState, useToast } from '@/components/ui';
import { impressoraApi, pedidosApi } from '@/lib/api';
import type { PainelPedidos, PedidoDelivery } from '@/lib/types';
import { fmtBRL, fmtHora } from '@/lib/format';
import { fmtKm } from '@/lib/localizacao-cliente';
import { printReceipt } from '@/lib/print';

function espera(minutos: number) {
  if (minutos < 1) return 'agora';
  return `${minutos} min`;
}

function parteDaLoja(pedido: PedidoDelivery) {
  if (pedido.valor_entrega == null) return null;
  return (Math.round(pedido.valor_entrega * 100) - Math.round(pedido.taxa_entrega * 100)) / 100;
}

function rotuloPagamento(forma: string) {
  if (forma === 'pix') return 'Pix';
  if (forma === 'dinheiro') return 'Dinheiro';
  if (forma === 'maquininha' || forma === 'cartao') return 'Maquininha na entrega';
  return forma;
}

function etapaDelivery(pedido: PedidoDelivery) {
  if (pedido.etapa === 'aguardando_pix') return { texto: 'Aguardando Pix', cor: 'amber' as const };
  if (pedido.etapa === 'preparando') return { texto: 'Sendo preparado', cor: 'amber' as const };
  if (pedido.etapa === 'saiu_entrega') return { texto: 'Saiu para entrega', cor: 'brand' as const };
  if (pedido.etapa === 'pronto_retirada') return { texto: 'Pronto para retirada', cor: 'green' as const };
  if (pedido.etapa === 'entregue') return { texto: pedido.tipo_entrega === 'retirada' ? 'Retirado' : 'Entregue', cor: 'green' as const };
  if (pedido.etapa === 'cancelado') return { texto: 'Cancelado', cor: 'red' as const };
  return { texto: 'Recebido', cor: 'amber' as const };
}

export function DeliveryPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [painel, setPainel] = useState<PainelPedidos>({ delivery: [], restaurante: [], prioridade: [] });
  const [load, setLoad] = useState(true);
  const [ocupado, setOcupado] = useState('');
  const etiquetaRef = useRef<HTMLPreElement>(null);

  const carregar = async (silencioso = false) => {
    if (!silencioso) setLoad(true);
    try {
      setPainel(await pedidosApi.painel());
    } catch (error: any) {
      toast('error', error?.error || 'Não foi possível carregar os pedidos');
    } finally {
      setLoad(false);
    }
  };

  useEffect(() => {
    carregar();
    const timer = setInterval(() => carregar(true), 15000);
    return () => clearInterval(timer);
  }, []);

  const imprimirEtiqueta = async (comandaId: number, chave: string) => {
    setOcupado(chave);
    try {
      const resultado = await pedidosApi.etiqueta({ comanda_id: comandaId });
      if (etiquetaRef.current) {
        etiquetaRef.current.textContent = resultado.impressao;
        await printReceipt(etiquetaRef.current, undefined, 'Etiqueta do pedido');
      }
      const falha = (resultado.jobs || []).find((job) => job.ok === false);
      toast(falha ? 'error' : 'success', falha?.error || 'Etiqueta do pedido enviada');
    } catch (error: any) {
      toast('error', error?.error || 'Não foi possível imprimir a etiqueta');
    } finally {
      setOcupado('');
    }
  };

  const enviarCozinha = async (comandaId: number, chave: string) => {
    setOcupado(chave);
    try {
      const resultado = await impressoraApi.imprimirComanda(comandaId, { tipo: 'cozinha' });
      if (resultado.sem_rota?.length) toast('error', `Sem impressora: ${resultado.sem_rota.join(', ')}`);
      else toast('success', 'Pedido enviado para a cozinha');
      await carregar(true);
    } catch (error: any) {
      toast('error', error?.error || 'Não foi possível enviar para a cozinha');
    } finally {
      setOcupado('');
    }
  };

  const mudarStatus = async (id: number, status: 'confirmado' | 'cancelado' | 'saiu_entrega' | 'pronto_retirada' | 'entregue' | 'pix_recebido') => {
    const chave = `status-${id}`;
    setOcupado(chave);
    const avisos = {
      pix_recebido: 'Pix confirmado. O pedido subiu para a cozinha.',
      confirmado: 'Pedido em preparo. O cliente já acompanha.',
      cancelado: 'Pedido cancelado. O cliente vê o cancelamento.',
      saiu_entrega: 'Pedido saiu para entrega.',
      pronto_retirada: 'Pedido pronto para retirada.',
      entregue: 'Cliente avisado. Feche a comanda para concluir o caixa.',
    };
    try {
      await pedidosApi.statusOnline(id, status);
      toast('success', avisos[status]);
      await carregar(true);
    } catch (error: any) {
      toast('error', error?.error || 'Não foi possível atualizar o pedido');
    } finally {
      setOcupado('');
    }
  };

  return (
    <AnimatedPage>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-800">DoixP Delivery</h1>
          <p className="text-sm text-slate-500">Pedidos que chegaram pelo site deste estabelecimento.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RestauranteAbas atual="delivery" />
          <Button variant="secondary" icon={<ExternalLink className="h-4 w-4" />} onClick={() => window.open('/pedido', '_blank', 'noopener,noreferrer')}>Ver o DoixP Delivery</Button>
        </div>
      </div>

      {load ? <Card className="p-8 text-center text-sm text-slate-500">Carregando pedidos…</Card> : painel.delivery.length === 0 ? (
        <Card><EmptyState icon={<Bike className="h-8 w-8" />} title="Nenhum pedido de delivery em aberto" subtitle="Quando um cliente pedir pelo site, o pedido aparece aqui. O DoixP Delivery mostra os outros restaurantes publicados." /></Card>
      ) : (
        <div className="space-y-3">
          {painel.delivery.map((pedido) => {
            const etapa = etapaDelivery(pedido);
            return (
              <Card key={pedido.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <b className="text-slate-800">{pedido.cliente_nome}</b>
                      <Badge color={etapa.cor}>{etapa.texto}</Badge>
                      <Badge color="blue">{pedido.tipo_entrega === 'retirada' ? 'Retirada' : 'Entrega'}</Badge>
                      <span className="text-xs font-semibold text-slate-500">{espera(pedido.espera_min)} · {fmtHora(pedido.criado_em)}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">{pedido.telefone}{pedido.endereco ? ` · ${pedido.endereco}` : ''}</p>
                    <p className="text-xs text-slate-400">Pagamento: {rotuloPagamento(pedido.forma_pagamento)} · {fmtBRL(pedido.total)}</p>
                    {pedido.forma_pagamento === 'dinheiro' && pedido.troco_para != null && <p className="text-xs font-semibold text-slate-600">Cliente paga com {fmtBRL(pedido.troco_para)} · Troco {fmtBRL(Math.max(0, pedido.troco_para - pedido.total))}</p>}
                    {pedido.forma_pagamento === 'pix' && pedido.etapa === 'aguardando_pix' && <p className="text-xs font-semibold text-slate-500">O cliente já tem o QR Code. O pedido só sobe depois que o Pix cair na conta da loja.</p>}
                    {pedido.forma_pagamento === 'pix' && pedido.etapa !== 'aguardando_pix' && <p className="text-xs font-semibold text-slate-500">Pix na chave desta loja. Confira o recebimento na conta do estabelecimento.</p>}
                    {pedido.tipo_entrega === 'entrega' && pedido.valor_entrega != null && (
                      <p className="text-xs font-semibold text-slate-500">
                        {pedido.modo_entrega === 'gratis' || pedido.entrega_gratis === 1
                          ? `Entrega grátis para o cliente. A loja paga ${fmtBRL(pedido.valor_entrega)}.`
                          : `Cliente paga ${fmtBRL(pedido.taxa_entrega)} de entrega${(parteDaLoja(pedido) || 0) > 0 ? `. A loja paga ${fmtBRL(parteDaLoja(pedido))}.` : '.'}`}
                        {pedido.distancia_km != null ? ` ${fmtKm(pedido.distancia_km)}.` : ''}
                      </p>
                    )}
                    {pedido.etapa === 'entregue' && <p className="mt-1 text-xs font-semibold text-emerald-700">O cliente já vê esta etapa. A baixa do estoque continua no fechamento da comanda.</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {pedido.etapa === 'aguardando_pix' && <Button size="sm" onClick={() => mudarStatus(pedido.id, 'pix_recebido')} loading={ocupado === `status-${pedido.id}`}>Pix recebido</Button>}
                    {pedido.etapa === 'recebido' && <Button size="sm" onClick={() => mudarStatus(pedido.id, 'confirmado')} loading={ocupado === `status-${pedido.id}`}>Confirmar</Button>}
                    {pedido.etapa === 'preparando' && pedido.tipo_entrega === 'entrega' && <Button size="sm" onClick={() => mudarStatus(pedido.id, 'saiu_entrega')} loading={ocupado === `status-${pedido.id}`}>Saiu para entrega</Button>}
                    {pedido.etapa === 'preparando' && pedido.tipo_entrega === 'retirada' && <Button size="sm" onClick={() => mudarStatus(pedido.id, 'pronto_retirada')} loading={ocupado === `status-${pedido.id}`}>Pronto para retirada</Button>}
                    {(pedido.etapa === 'saiu_entrega' || pedido.etapa === 'pronto_retirada') && <Button size="sm" onClick={() => mudarStatus(pedido.id, 'entregue')} loading={ocupado === `status-${pedido.id}`}>{pedido.tipo_entrega === 'retirada' ? 'Marcar retirado' : 'Marcar entregue'}</Button>}
                    {pedido.comanda_id && <Button size="sm" variant="secondary" onClick={() => enviarCozinha(pedido.comanda_id!, `cozinha-${pedido.id}`)} loading={ocupado === `cozinha-${pedido.id}`}>Enviar à cozinha</Button>}
                    {pedido.comanda_id && <Button size="sm" variant="secondary" icon={<Printer className="h-4 w-4" />} onClick={() => imprimirEtiqueta(pedido.comanda_id!, `etiqueta-${pedido.id}`)} loading={ocupado === `etiqueta-${pedido.id}`}>Etiqueta</Button>}
                    {pedido.comanda_id && <Button size="sm" variant="secondary" onClick={() => navigate(`/restaurante/comanda/${pedido.comanda_id!}`)}>Abrir comanda</Button>}
                    {pedido.etapa !== 'entregue' && <Button size="sm" variant="danger" onClick={() => mudarStatus(pedido.id, 'cancelado')} loading={ocupado === `status-${pedido.id}`}>Cancelar</Button>}
                  </div>
                </div>
                <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-sm text-slate-700">
                  {pedido.itens.map((item) => <li key={item.id}>{item.quantidade}x {item.nome}{item.observacao ? ` — ${item.observacao}` : ''}</li>)}
                </ul>
                {pedido.observacao && <p className="mt-2 text-xs text-slate-500">Obs.: {pedido.observacao}</p>}
              </Card>
            );
          })}
        </div>
      )}

      <pre ref={etiquetaRef} className="absolute -left-[9999px] top-0 w-72 whitespace-pre-wrap font-mono text-xs" />
    </AnimatedPage>
  );
}
