import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCheck, HandCoins, Printer, Users } from 'lucide-react';
import { AnimatedPage } from '@/components/anim';
import { Badge, Button, Card, EmptyState, Modal, Spinner, useConfirm, useToast } from '@/components/ui';
import { comandaApi, impressoraApi } from '@/lib/api';
import type { Comanda, ComandaPessoa } from '@/lib/types';
import { fmtBRL, fmtNum, formaLabel } from '@/lib/format';
import { printReceipt } from '@/lib/print';

export function PagamentosComanda() {
  const { id } = useParams();
  const comandaId = Number(id);
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();

  const [comanda, setComanda] = useState<Comanda | null>(null);
  const [load, setLoad] = useState(true);
  const [baixando, setBaixando] = useState<number | null>(null);
  const [imprimir, setImprimir] = useState<{ impressao: string } | null>(null);
  const [imprimindoTodas, setImprimindoTodas] = useState(false);
  const impressaoRef = useRef<HTMLDivElement>(null);

  const loadComanda = async () => {
    try {
      const c = await comandaApi.get(comandaId);
      setComanda(c);
    } catch (e: any) {
      toast('error', e?.error || 'Erro ao carregar');
    } finally {
      setLoad(false);
    }
  };

  useEffect(() => {
    loadComanda();
    const iv = setInterval(loadComanda, 15000);
    return () => clearInterval(iv);
  }, [comandaId]);

  const individuais = useMemo(() => {
    if (!comanda?.individual_valores) return { valores: {}, formas: {} };
    try {
      return JSON.parse(comanda.individual_valores);
    } catch {
      return { valores: {}, formas: {} };
    }
  }, [comanda?.individual_valores]);

  const pessoas = comanda?.pessoas || [];
  const ativos = (comanda?.itens || []).filter((i) => i.status !== 'cancelado');
  const taxa = Number(comanda?.taxa_garcom_pct || 0);

  const totalDaPessoa = (pid: number) => {
    const v = individuais.valores?.[pid];
    if (v !== undefined) return Number(v);
    const sub = ativos
      .filter((i) => i.pessoa_id === pid)
      .reduce((s, i) => s + Number(i.quantidade) * Number(i.preco_unitario), 0);
    return sub * (1 + taxa / 100);
  };

  const formaPessoa = (pid: number) => individuais.formas?.[pid] || 'dinheiro';

  const itensDaPessoa = (pid: number) => ativos.filter((i) => i.pessoa_id === pid);

  const baixar = async (pessoa: ComandaPessoa) => {
    const total = totalDaPessoa(pessoa.id);
    if (total <= 0) return toast('error', 'Pessoa sem valor para baixar');
    confirm(
      `Baixar ${pessoa.nome || 'pessoa'}?`,
      `Será gerada a venda de ${fmtBRL(total)} (${formaLabel(formaPessoa(pessoa.id))}).\nA mesa de origem será liberada quando todas as pessoas forem baixadas.`,
      async () => {
        setBaixando(pessoa.id);
        try {
          const r = await comandaApi.baixarPessoa(comandaId, {
            pessoa_id: pessoa.id,
            forma: formaPessoa(pessoa.id),
            responsavel: comanda?.garcom_nome || undefined,
          });
          setComanda(r.comanda);
          if (r.fechou) {
            toast('success', 'Todas as pessoas baixadas — mesa liberada!');
            navigate('/restaurante');
          } else {
            toast('success', `Venda ${r.venda.numero} gerada (${fmtBRL(r.venda.total)})`);
          }
        } catch (e: any) {
          toast('error', e?.error || 'Erro ao baixar');
        } finally {
          setBaixando(null);
        }
      }
    );
  };

  const imprimirPessoa = async (pessoa: ComandaPessoa) => {
    try {
      const r = await impressoraApi.imprimirPessoa(comandaId, pessoa.id);
      setImprimir(r);
    } catch (e: any) {
      toast('error', e?.error || 'Erro ao imprimir');
    }
  };

  const imprimirTodas = async () => {
    const pendentes = pessoas.filter((p) => p.status !== 'baixado');
    if (!pendentes.length) return toast('error', 'Nenhuma pessoa pendente');
    setImprimindoTodas(true);
    try {
      const textos: string[] = [];
      for (const p of pendentes) {
        const r = await impressoraApi.imprimirPessoa(comandaId, p.id);
        textos.push(r.impressao);
      }
      setImprimir({ impressao: textos.join('\n\n==========\n\n') });
    } catch (e: any) {
      toast('error', e?.error || 'Erro ao imprimir');
    } finally {
      setImprimindoTodas(false);
    }
  };

  if (load) return <Spinner label="Carregando pagamentos..." />;
  if (!comanda) return <div className="py-20 text-center text-slate-400">Comanda não encontrada</div>;

  const baixadas = pessoas.filter((p) => p.status === 'baixado');
  const totalGeral = pessoas.reduce((s, p) => s + totalDaPessoa(p.id), 0);
  const totalBaixado = baixadas.reduce((s, p) => s + totalDaPessoa(p.id), 0);

  return (
    <AnimatedPage>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={() => navigate('/restaurante')} icon={<ArrowLeft className="h-4 w-4" />}>
            Voltar
          </Button>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-slate-800">Pagamentos Individuais</h1>
            <p className="text-sm text-slate-500">
              {comanda.cliente_nome || 'Conta'}
              {comanda.comanda_origem_id ? ` · Origem: comanda #${comanda.comanda_origem_id}` : ''} · Garçom:{' '}
              {comanda.garcom_nome || '—'} · {baixadas.length}/{pessoas.length} baixada(s)
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            icon={<Printer className="h-4 w-4" />}
            loading={imprimindoTodas}
            disabled={!pessoas.some((p) => p.status !== 'baixado')}
            onClick={imprimirTodas}
          >
            Imprimir todas
          </Button>
          <div className="rounded-xl bg-slate-800 px-4 py-2 text-right">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Baixado / Total</p>
            <p className="text-sm font-extrabold text-white">
              {fmtBRL(totalBaixado)} <span className="text-slate-400">/ {fmtBRL(totalGeral)}</span>
            </p>
          </div>
        </div>
      </div>

      {pessoas.length === 0 ? (
        <Card>
          <EmptyState icon={<Users className="h-6 w-6" />} title="Nenhuma pessoa" subtitle="Não há pessoas para baixar nesta conta" />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {pessoas.map((p) => {
            const itens = itensDaPessoa(p.id);
            const total = totalDaPessoa(p.id);
            const baixado = p.status === 'baixado';
            return (
              <Card key={p.id} className={`p-4 ${baixado ? 'opacity-70' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: p.cor }} />
                    <p className="truncate text-sm font-extrabold text-slate-800">{p.nome || `Pessoa ${p.id}`}</p>
                    {baixado ? (
                      <Badge color="green">Baixado</Badge>
                    ) : (
                      <Badge color="amber">Pendente</Badge>
                    )}
                  </div>
                  <p className="shrink-0 text-base font-extrabold text-brand-600">{fmtBRL(total)}</p>
                </div>

                <div className="mt-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-500">
                  {itens.length === 0 ? (
                    <p className="text-slate-400">Sem itens lançados</p>
                  ) : (
                    <div className="space-y-0.5">
                      {itens.map((i) => (
                        <div key={i.id} className="flex justify-between gap-2">
                          <span className="min-w-0 truncate">
                            {fmtNum(i.quantidade)}x {i.nome}
                          </span>
                          <span className="shrink-0 font-semibold">
                            {fmtBRL(Number(i.quantidade) * Number(i.preco_unitario))}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mt-3 flex items-center justify-between gap-2">
                  <p className="text-[11px] text-slate-400">
                    Pagamento: <span className="font-semibold text-slate-600">{formaLabel(formaPessoa(p.id))}</span>
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<Printer className="h-3.5 w-3.5" />}
                      onClick={() => imprimirPessoa(p)}
                    >
                      Imprimir conta
                    </Button>
                    <Button
                      variant={baixado ? 'secondary' : 'success'}
                      size="sm"
                      loading={baixando === p.id}
                      disabled={baixado}
                      icon={<CheckCheck className="h-3.5 w-3.5" />}
                      onClick={() => baixar(p)}
                    >
                      {baixado ? 'Baixado' : 'Baixar'}
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={!!imprimir} onClose={() => setImprimir(null)} title="Conta individual">
        <div ref={impressaoRef} className="mx-auto w-64 rounded-lg border-2 border-dashed border-slate-300 bg-white p-3 font-mono text-[11px] leading-4">
          <pre className="whitespace-pre-wrap text-slate-800">{imprimir?.impressao}</pre>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setImprimir(null)}>Fechar</Button>
          <Button icon={<Printer className="h-4 w-4" />} onClick={() => printReceipt(impressaoRef.current)}>Imprimir</Button>
        </div>
      </Modal>

      {comanda.status === 'pre_fechamento' && (
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-700">
          <HandCoins className="h-4 w-4 shrink-0" />
          <span>
            Baixe cada pessoa para gerar a venda individual. Quando todas forem baixadas, a mesa de origem é liberada
            automaticamente.
          </span>
        </div>
      )}
    </AnimatedPage>
  );
}
