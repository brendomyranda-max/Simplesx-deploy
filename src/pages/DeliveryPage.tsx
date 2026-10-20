/**
 * Pedidos do site e o acesso ao DoixP Delivery.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bike, BookOpen, ExternalLink, Printer } from 'lucide-react';
import { AnimatedPage } from '@/components/AnimatedPage';
import { RestauranteAbas } from '@/components/RestauranteAbas';
import { Badge, Button, Card, EmptyState, useToast } from '@/components/ui';
import { entregasApi, impressoraApi, pedidosApi, retryOrder } from '@/lib/api';
import type { CorridaPlataforma, PainelPedidos, PedidoDelivery } from '@/lib/types';
import { fmtBRL, fmtHora } from '@/lib/format';
import { fmtKm } from '@/lib/localizacao-cliente';
import { MOTOBOY_DOIXP_VISIVEL } from '@/lib/recursos-em-desenvolvimento';

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
  const [painel, setPainel] = useState<PainelPedidos>({ delivery: [], delivery_entregues: [], restaurante: [], prioridade: [] });
  const [load, setLoad] = useState(true);
  const [ocupado, setOcupado] = useState('');
  const [filtro, setFiltro] = useState<'pendentes' | 'entregues'>('pendentes');
  const [corridas, setCorridas] = useState<CorridaPlataforma[]>([]);
  const [integracaoErro, setIntegracaoErro] = useState('');
  const [codigos, setCodigos] = useState<Record<string, string>>({});
  const [denuncias, setDenuncias] = useState<Record<string, string>>({});
  const [denunciaAberta, setDenunciaAberta] = useState('');

  const carregar = async (silencioso = false) => {
    if (!silencioso) setLoad(true);
    try {
      const [pedidos, entregas] = await Promise.allSettled([
        pedidosApi.painel(),
        MOTOBOY_DOIXP_VISIVEL ? entregasApi.loja() : Promise.resolve({ orders: [] as CorridaPlataforma[] }),
      ]);
      if (pedidos.status === 'rejected') throw pedidos.reason;
      setPainel(pedidos.value);
      if (entregas.status === 'fulfilled') {
        setCorridas(entregas.value.orders);
        setIntegracaoErro('');
      } else {
        setIntegracaoErro(entregas.reason?.error || 'O serviço de motoboys ainda não está conectado.');
      }
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

  const imprimirPedido = async (comandaId: number, chave: string) => {
    setOcupado(chave);
    try {
      const resultado = await retryOrder(() => impressoraApi.imprimirComanda(comandaId, { tipo: 'cozinha' }));
      if (resultado.sem_rota?.length) toast('error', `Sem impressora vinculada: ${resultado.sem_rota.join(', ')}`);
      else if (resultado.falhas?.length) toast('error', `Fila incompleta: ${resultado.falhas[0].impressora}: ${resultado.falhas[0].erro}`);
      else if (resultado.itens) toast('success', `${resultado.itens} item(ns) enviado(s) para a impressora do servidor`);
      else toast('info', 'Estes itens já foram enviados ou não há itens novos para imprimir');
      await carregar(true);
    } catch (error: any) {
      toast('error', error?.error || 'Não foi possível enviar o pedido para a impressora');
    } finally {
      setOcupado('');
    }
  };

  const pedidosVisiveis = filtro === 'pendentes' ? painel.delivery : painel.delivery_entregues;

  const acaoCorrida = async (corrida: CorridaPlataforma, action: 'ready' | 'pickup' | 'report', body: Record<string, unknown> = {}) => {
    setOcupado(`corrida-${corrida.id}`);
    try {
      await entregasApi.acao(corrida.id, action, body);
      if (action === 'pickup') {
        setCodigos((old) => ({ ...old, [corrida.id]: '' }));
      }
      if (action === 'report') {
        setDenunciaAberta('');
        setDenuncias((old) => ({ ...old, [corrida.id]: '' }));
      }
      toast('success', action === 'ready' ? 'Pedido pronto para o motoboy.' : action === 'pickup' ? 'Retirada confirmada pelo código.' : 'Ocorrência enviada ao suporte; o entregador foi suspenso preventivamente.');
      await carregar(true);
    } catch (error: any) {
      toast('error', error?.error || 'Não foi possível atualizar a corrida.');
    } finally {
      setOcupado('');
    }
  };

  const tentarChamarMotoboy = async (id: number) => {
    setOcupado(`despacho-${id}`);
    try {
      await pedidosApi.chamarEntregador(id);
      toast('success', 'Pedido anunciado aos motoboys da região.');
      await carregar(true);
    } catch (error: any) {
      toast('error', error?.error || 'Não foi possível chamar o motoboy.');
    } finally { setOcupado(''); }
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
      const result = await pedidosApi.statusOnline(id, status);
      if (MOTOBOY_DOIXP_VISIVEL && result.despacho?.error) toast('error', `Pix registrado, mas o motoboy ainda não foi chamado: ${result.despacho.error}`);
      else toast('success', avisos[status]);
      if (result.impressao?.falhas?.length) toast('error', `Pedido aceito. Impressão pendente: ${result.impressao.falhas[0].erro}`);
      else if (result.impressao?.sem_rota?.length) toast('error', 'Pedido aceito. Configure a impressora do delivery em Impressoras.');
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
          <Button variant="secondary" icon={<BookOpen className="h-4 w-4" />} onClick={() => navigate('/estoque?aba=delivery')}>Cardápio online</Button>
          <Button variant="secondary" icon={<ExternalLink className="h-4 w-4" />} onClick={() => window.open('/pedido', '_blank', 'noopener,noreferrer')}>Ver o DoixP Delivery</Button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filtrar pedidos do delivery">
        <Button type="button" variant={filtro === 'pendentes' ? 'primary' : 'secondary'} onClick={() => setFiltro('pendentes')}>Para entregar ({painel.delivery.length})</Button>
        <Button type="button" variant={filtro === 'entregues' ? 'primary' : 'secondary'} onClick={() => setFiltro('entregues')}>Já entregues ({painel.delivery_entregues.length})</Button>
      </div>

      {MOTOBOY_DOIXP_VISIVEL && integracaoErro && <Card className="mb-4 p-3 text-sm text-amber-800">Motoboys da plataforma: {integracaoErro}</Card>}
      {MOTOBOY_DOIXP_VISIVEL && corridas.length > 0 && <section className="mb-5 space-y-3" aria-label="Corridas dos motoboys">
        <h2 className="text-sm font-bold text-slate-700">Corridas da plataforma</h2>
        {corridas.filter((corrida) => !['delivered', 'cancelled', 'returned'].includes(corrida.status)).map((corrida) => (
          <Card key={corrida.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><b>#{corrida.reference}</b><p className="text-sm text-slate-600">{corrida.customerName} · {corrida.destinationAddress}</p>
                <p className="text-xs text-slate-500">{corrida.status === 'searching' ? 'Procurando motoboy' : corrida.status === 'accepted' ? 'Motoboy aceitou' : corrida.status === 'in_transit' ? 'A caminho do cliente' : 'Em análise'} · Frete {fmtBRL(corrida.totalCents / 100)} · {fmtKm(corrida.distanceKm)}</p></div>
              <div className="flex flex-wrap items-center gap-2">
                {!corrida.ready && ['searching', 'accepted'].includes(corrida.status) && <Button size="sm" onClick={() => acaoCorrida(corrida, 'ready')} loading={ocupado === `corrida-${corrida.id}`}>Pedido pronto</Button>}
                {corrida.ready && corrida.status === 'accepted' && <><input aria-label={`Código de retirada da corrida ${corrida.reference}`} inputMode="numeric" pattern="[0-9]{6}" maxLength={6} placeholder="Código de 6 dígitos" className="w-40 rounded-lg border border-slate-300 p-2 text-sm" value={codigos[corrida.id] || ''} onChange={(event) => setCodigos((old) => ({ ...old, [corrida.id]: event.target.value.replace(/\D/g, '').slice(0, 6) }))} /><Button size="sm" disabled={(codigos[corrida.id] || '').length !== 6} onClick={() => acaoCorrida(corrida, 'pickup', { code: codigos[corrida.id] })} loading={ocupado === `corrida-${corrida.id}`}>Confirmar retirada</Button></>}
                {['accepted', 'in_transit'].includes(corrida.status) && <Button size="sm" variant="danger" onClick={() => setDenunciaAberta(denunciaAberta === corrida.id ? '' : corrida.id)}>Relatar suspeita</Button>}
              </div>
            </div>
            {denunciaAberta === corrida.id && <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
              <label className="block text-sm font-semibold text-slate-700">Descreva o motivo da suspeita
                <textarea className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm" rows={3} maxLength={2000} value={denuncias[corrida.id] || ''} onChange={(event) => setDenuncias((old) => ({ ...old, [corrida.id]: event.target.value }))} />
              </label>
              <Button size="sm" variant="danger" disabled={(denuncias[corrida.id] || '').trim().length < 5} onClick={() => acaoCorrida(corrida, 'report', { kind: 'fraud', note: denuncias[corrida.id].trim() })} loading={ocupado === `corrida-${corrida.id}`}>Enviar ao suporte e suspender preventivamente</Button>
            </div>}
          </Card>
        ))}
      </section>}

      {load ? <Card className="p-8 text-center text-sm text-slate-500">Carregando pedidos…</Card> : pedidosVisiveis.length === 0 ? (
        <Card><EmptyState icon={<Bike className="h-8 w-8" />} title={filtro === 'pendentes' ? 'Nenhum pedido para entregar' : 'Nenhum pedido entregue ainda'} subtitle={filtro === 'pendentes' ? 'Quando um cliente pedir pelo site, o pedido aparece aqui.' : 'Os pedidos concluídos aparecem aqui, mesmo depois do fechamento da comanda.'} /></Card>
      ) : (
        <div className="space-y-3">
          {pedidosVisiveis.map((pedido) => {
            const etapa = etapaDelivery(pedido);
            const corrida = corridas.find((item) => item.reference === `PEDIDO-ONLINE-${pedido.id}`);
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
                    {MOTOBOY_DOIXP_VISIVEL && pedido.entrega_plataforma === 1 && <p className="text-xs font-semibold text-brand-700">Motoboy DoixP · {corrida ? 'corrida ' + corrida.status : pedido.entrega_despacho_status === 'erro' ? 'chamada pendente de reenvio' : 'aguardando anúncio'}</p>}
                    {pedido.tipo_entrega === 'entrega' && pedido.valor_entrega != null && (
                      <p className="text-xs font-semibold text-slate-500">
                        {pedido.modo_entrega === 'gratis' || pedido.entrega_gratis === 1
                          ? `Entrega grátis para o cliente. A loja paga ${fmtBRL(pedido.valor_entrega)}.`
                          : `Cliente paga ${fmtBRL(pedido.taxa_entrega)} de entrega${(parteDaLoja(pedido) || 0) > 0 ? `. A loja paga ${fmtBRL(parteDaLoja(pedido))}.` : '.'}`}
                        {pedido.distancia_km != null ? ` ${fmtKm(pedido.distancia_km)}.` : ''}
                      </p>
                    )}
                    {pedido.status === 'confirmado' && (pedido.impressao_pendente || 0) > 0 && <p className="mt-1 text-xs font-semibold text-amber-700">Há itens pendentes de envio à impressora. Confira o destino configurado e use Imprimir pedido.</p>}
                    {pedido.etapa === 'entregue' && <p className="mt-1 text-xs font-semibold text-emerald-700">O cliente já vê esta etapa. A baixa do estoque continua no fechamento da comanda.</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {pedido.etapa === 'aguardando_pix' && <Button size="sm" onClick={() => mudarStatus(pedido.id, 'pix_recebido')} loading={ocupado === `status-${pedido.id}`}>Pix recebido</Button>}
                    {MOTOBOY_DOIXP_VISIVEL && pedido.entrega_plataforma === 1 && pedido.etapa !== 'aguardando_pix' && !corrida && pedido.entrega_despacho_status !== 'anunciada' && pedido.etapa !== 'cancelado' && <Button size="sm" onClick={() => tentarChamarMotoboy(pedido.id)} loading={ocupado === `despacho-${pedido.id}`}>Tentar chamar motoboy</Button>}
                    {pedido.etapa === 'recebido' && <Button size="sm" onClick={() => mudarStatus(pedido.id, 'confirmado')} loading={ocupado === `status-${pedido.id}`}>Confirmar</Button>}
                    {pedido.etapa === 'preparando' && pedido.tipo_entrega === 'entrega' && pedido.entrega_plataforma !== 1 && <Button size="sm" onClick={() => mudarStatus(pedido.id, 'saiu_entrega')} loading={ocupado === `status-${pedido.id}`}>Saiu para entrega</Button>}
                    {pedido.etapa === 'preparando' && pedido.tipo_entrega === 'retirada' && <Button size="sm" onClick={() => mudarStatus(pedido.id, 'pronto_retirada')} loading={ocupado === `status-${pedido.id}`}>Pronto para retirada</Button>}
                    {(pedido.etapa === 'saiu_entrega' || pedido.etapa === 'pronto_retirada') && (!corrida || pedido.tipo_entrega === 'retirada') && <Button size="sm" onClick={() => mudarStatus(pedido.id, 'entregue')} loading={ocupado === `status-${pedido.id}`}>{pedido.tipo_entrega === 'retirada' ? 'Marcar retirado' : 'Marcar entregue'}</Button>}
                    {filtro === 'pendentes' && pedido.comanda_id && pedido.comanda_status === 'aberta' && pedido.etapa !== 'aguardando_pix' && <Button size="sm" variant="secondary" icon={<Printer className="h-4 w-4" />} onClick={() => imprimirPedido(pedido.comanda_id!, `impressao-${pedido.id}`)} loading={ocupado === `impressao-${pedido.id}`}>Imprimir pedido</Button>}
                    {pedido.comanda_id && pedido.comanda_status !== 'fechada' && <Button size="sm" variant="secondary" onClick={() => navigate(`/restaurante/comanda/${pedido.comanda_id!}`)}>Abrir comanda</Button>}
                    {filtro === 'pendentes' && pedido.etapa !== 'entregue' && <Button size="sm" variant="danger" onClick={() => mudarStatus(pedido.id, 'cancelado')} loading={ocupado === `status-${pedido.id}`}>Cancelar</Button>}
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

    </AnimatedPage>
  );
}
