/**
 * Painel que fica aberto na cozinha e no bar para acompanhar os lançamentos.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChefHat } from 'lucide-react';
import { AnimatedPage } from '@/components/AnimatedPage';
import { RestauranteAbas } from '@/components/RestauranteAbas';
import { Badge, Button, Card, EmptyState, useToast } from '@/components/ui';
import { comandaApi, pedidosApi } from '@/lib/api';
import type { LancamentoCozinha, PainelCozinha } from '@/lib/types';
import { fmtHora } from '@/lib/format';

function espera(minutos: number) {
  if (minutos < 1) return 'agora';
  return `${minutos} min`;
}

export function CozinhaPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [painel, setPainel] = useState<PainelCozinha>({ estacoes: [] });
  const [load, setLoad] = useState(true);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState('');
  const [recentes, setRecentes] = useState<string[]>([]);
  const [visto, setVisto] = useState<Set<string>>(() => new Set());
  const [atualizado, setAtualizado] = useState('');

  const carregar = async (silencioso = false) => {
    if (!silencioso) setLoad(true);
    try {
      const proximo = await pedidosApi.cozinha();
      const ids = proximo.estacoes.flatMap((estacao) => estacao.lancamentos.map((lancamento) => lancamento.id));
      setPainel(proximo);
      setErro('');
      setAtualizado(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      setVisto((anterior) => {
        if (anterior.size === 0 && !silencioso) return new Set(ids);
        const chegando = ids.filter((id) => !anterior.has(id));
        if (chegando.length) setRecentes(chegando);
        return new Set(ids);
      });
    } catch (error: any) {
      const mensagem = error?.error || 'Não foi possível atualizar a cozinha';
      if (!silencioso) toast('error', mensagem);
      setErro(mensagem);
    } finally {
      setLoad(false);
    }
  };

  useEffect(() => {
    carregar();
    const timer = setInterval(() => carregar(true), 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const total = painel.estacoes.reduce((soma, estacao) => soma + estacao.lancamentos.length, 0);
    const anterior = document.title;
    document.title = total ? `Cozinha (${total}) · SimplexS.A` : 'Cozinha · SimplexS.A';
    return () => { document.title = anterior; };
  }, [painel]);

  useEffect(() => {
    if (!recentes.length) return;
    const timer = setInterval(() => setRecentes([]), 8000);
    return () => clearInterval(timer);
  }, [recentes]);

  const marcarPronto = async (lancamento: LancamentoCozinha) => {
    setOcupado(lancamento.id);
    try {
      for (const item of lancamento.itens) {
        await comandaApi.itemStatus(lancamento.comanda_id, item.id, 'entregue');
      }
      toast('success', `${lancamento.lugar} marcado como pronto`);
      await carregar(true);
    } catch (error: any) {
      toast('error', error?.error || 'Não foi possível atualizar o lançamento');
    } finally {
      setOcupado('');
    }
  };

  return (
    <AnimatedPage>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-800">Área da cozinha</h1>
          <p className="text-sm text-slate-500">Deixe esta tela aberta. Os lançamentos do bar e da cozinha entram aqui sozinhos.</p>
        </div>
        <RestauranteAbas atual="cozinha" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${erro ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
          <span className={`h-2 w-2 rounded-full ${erro ? 'bg-red-500' : 'bg-emerald-500'}`} />
          {erro ? 'Sem atualização' : 'Acompanhando'}
        </span>
        {atualizado && <span>Atualizado às {atualizado}</span>}
        {erro && <span>{erro}</span>}
      </div>

      {load ? <Card className="p-8 text-center text-sm text-slate-500">Carregando lançamentos…</Card> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {painel.estacoes.map((estacao) => (
            <section key={estacao.id} className="min-w-0">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-extrabold uppercase tracking-wide text-slate-700">{estacao.nome}</h2>
                <Badge color={estacao.lancamentos.length ? 'amber' : 'slate'}>{estacao.lancamentos.length}</Badge>
              </div>
              {estacao.lancamentos.length === 0 ? (
                <Card><EmptyState icon={<ChefHat className="h-8 w-8" />} title={`Nenhum lançamento ${estacao.id === 'bar' ? 'no bar' : estacao.id === 'cozinha' ? 'na cozinha' : 'neste destino'}`} subtitle="Esta coluna continua aberta." /></Card>
              ) : (
                <div className="space-y-3">
                  {estacao.lancamentos.map((lancamento) => (
                    <Card key={lancamento.id} className={`p-4 ${recentes.includes(lancamento.id) ? 'ring-2 ring-amber-400' : ''}`}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <b className="text-slate-800">{lancamento.lugar}</b>
                            <Badge color={lancamento.status === 'enviado' ? 'blue' : 'amber'}>{lancamento.status === 'enviado' ? 'Lançado' : 'Na comanda'}</Badge>
                            {lancamento.canal === 'delivery' && <Badge color="purple">Delivery</Badge>}
                            <span className="text-xs font-semibold text-slate-500">{espera(lancamento.espera_min)} · {fmtHora(lancamento.criado_em)}</span>
                          </div>
                          <p className="mt-1 text-sm text-slate-600">{lancamento.cliente_nome || 'Sem cliente'}{lancamento.garcom_nome ? ` · ${lancamento.garcom_nome}` : ''}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" onClick={() => marcarPronto(lancamento)} loading={ocupado === lancamento.id}>Pronto</Button>
                          <Button size="sm" variant="secondary" onClick={() => navigate(`/restaurante/comanda/${lancamento.comanda_id}`)}>Abrir</Button>
                        </div>
                      </div>
                      <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-sm text-slate-700">
                        {lancamento.itens.map((item) => (
                          <li key={item.id}>{item.quantidade}x {item.nome}{item.observacao ? ` — ${item.observacao}` : ''}</li>
                        ))}
                      </ul>
                    </Card>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </AnimatedPage>
  );
}
