import { useEffect, useState } from 'react';
import {
  BarChart3,
  TrendingUp,
  PackageX,
  CalendarClock,
  AlertTriangle,
  Trash2,
  Wallet,
  Boxes,
  FolderTree,
  UserSquare2,
} from 'lucide-react';
import { AnimatedPage } from '@/components/anim';
import { Badge, Button, Card, EmptyState, Field, Input, Spinner, StatCard, Tabs, useToast } from '@/components/ui';
import { relatorioApi } from '@/lib/api';
import type { ResumoRelatorio, Produto, ValidadeControle } from '@/lib/types';
import { fmtBRL, fmtNum, diasAte, hojeLocal } from '@/lib/format';

function addDiasLocal(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function RelatoriosPage() {
  const toast = useToast();
  const [tab, setTab] = useState<'resumo' | 'vendas' | 'categoria' | 'funcionario' | 'estoque' | 'vencimentos' | 'perdas'>('resumo');
  const [de, setDe] = useState(addDiasLocal(-30));
  const [ate, setAte] = useState(hojeLocal());
  const [resumo, setResumo] = useState<ResumoRelatorio | null>(null);
  const [mais, setMais] = useState<any[]>([]);
  const [baixo, setBaixo] = useState<Produto[]>([]);
  const [venc, setVenc] = useState<ValidadeControle[]>([]);
  const [perdas, setPerdas] = useState<any[]>([]);
  const [porDia, setPorDia] = useState<{ dia: string; vendas: number; total: number }[]>([]);
  const [lucroCat, setLucroCat] = useState<{ categoria: string; faturamento: number; custo: number; lucro: number; vendas: number }[]>([]);
  const [vendasFunc, setVendasFunc] = useState<{ funcionario: string; vendas: number; faturamento: number; ticket: number }[]>([]);
  const [load, setLoad] = useState(true);

  const loadAll = async () => {
    setLoad(true);
    try {
      const [r, m, b, v, p, d, lc, vf] = await Promise.all([
        relatorioApi.resumo(de, ate),
        relatorioApi.maisVendidos(de, ate),
        relatorioApi.estoqueBaixo(),
        relatorioApi.vencimentos(30),
        relatorioApi.perdas(de, ate),
        relatorioApi.vendasPorDia(de, ate),
        relatorioApi.lucroCategoria(de, ate),
        relatorioApi.vendasFuncionario(de, ate),
      ]);
      setResumo(r);
      setMais(m);
      setBaixo(b);
      setVenc(v);
      setPerdas(p);
      setPorDia(d);
      setLucroCat(lc);
      setVendasFunc(vf);
    } catch (e: any) {
      toast('error', e?.error || 'Erro ao carregar relatórios');
    } finally {
      setLoad(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, [de, ate]);

  const maxDia = Math.max(...porDia.map((d) => d.total), 1);

  return (
    <AnimatedPage>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-800">Relatórios</h1>
          <p className="text-sm text-slate-500">Visão de desempenho do negócio</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="De"><Input type="date" value={de} onChange={(e) => setDe(e.target.value)} /></Field>
          <Field label="Até"><Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></Field>
        </div>
      </div>

      <Tabs
        value={tab}
        onChange={(v) => setTab(v as any)}
        tabs={[
          { value: 'resumo', label: 'Resumo' },
          { value: 'vendas', label: 'Mais vendidos' },
          { value: 'categoria', label: 'Lucro por categoria' },
          { value: 'funcionario', label: 'Vendas por vendedor' },
          { value: 'estoque', label: 'Estoque baixo' },
          { value: 'vencimentos', label: 'Vencimentos' },
          { value: 'perdas', label: 'Perdas' },
        ]}
      />

      {load ? (
        <Spinner />
      ) : (
        <>
          {tab === 'resumo' && resumo && (
            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatCard label="Faturamento" value={fmtBRL(resumo.faturamento)} icon={<TrendingUp className="h-5 w-5" />} color="green" sub={`${resumo.vendas_count} vendas`} />
                <StatCard label="Lucro bruto" value={fmtBRL(resumo.lucro_bruto)} icon={<Wallet className="h-5 w-5" />} color="brand" sub={`${resumo.margem_pct.toFixed(1)}% margem`} />
                <StatCard label="CMV" value={`${resumo.cmv_pct.toFixed(1)}%`} icon={<Boxes className="h-5 w-5" />} color="blue" sub={fmtBRL(resumo.cmv)} />
                <StatCard label="Ticket médio" value={fmtBRL(resumo.ticket_medio)} icon={<BarChart3 className="h-5 w-5" />} color="amber" />
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatCard label="Custo vendido" value={fmtBRL(resumo.custo_vendido)} icon={<PackageX className="h-5 w-5" />} color="red" />
                <StatCard label="Despesas" value={fmtBRL(resumo.despesas)} icon={<Wallet className="h-5 w-5" />} color="red" />
                <StatCard label="Perdas" value={fmtBRL(resumo.perdas)} icon={<Trash2 className="h-5 w-5" />} color="amber" />
                <StatCard label="Lucro líquido" value={fmtBRL(resumo.lucro_liquido)} icon={<TrendingUp className="h-5 w-5" />} color="green" />
              </div>

              <Card className="p-5">
                <h2 className="mb-3 text-sm font-bold text-slate-700">Vendas por dia</h2>
                {porDia.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-400">Sem vendas no período</p>
                ) : (
                  <div className="flex h-40 items-end gap-1 overflow-x-auto">
                    {porDia.map((d) => (
                      <div key={d.dia} className="flex min-w-[28px] flex-1 flex-col items-center gap-1" title={`${d.dia}: ${fmtBRL(d.total)}`}>
                        <div className="w-full rounded-t bg-gradient-to-t from-brand-600 to-brand-400" style={{ height: `${Math.max(4, (d.total / maxDia) * 100)}%` }} />
                        <span className="text-[9px] text-slate-400">{d.dia.slice(5)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          )}

          {tab === 'vendas' && (
            <div className="mt-4">
              {mais.length === 0 ? (
                <Card><EmptyState icon={<TrendingUp className="h-8 w-8" />} title="Sem vendas no período" /></Card>
              ) : (
                <Card className="overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="th">#</th>
                          <th className="th">Produto</th>
                          <th className="th text-right">Quantidade</th>
                          <th className="th text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {mais.map((m, i) => (
                          <tr key={i}>
                            <td className="td text-slate-400">{i + 1}º</td>
                            <td className="td font-semibold text-slate-800">{m.nome}</td>
                            <td className="td text-right">{fmtNum(m.qtd)}</td>
                            <td className="td text-right font-bold">{fmtBRL(m.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </div>
          )}

          {tab === 'categoria' && (
            <div className="mt-4">
              {lucroCat.length === 0 ? (
                <Card><EmptyState icon={<FolderTree className="h-8 w-8" />} title="Sem vendas no período" /></Card>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <StatCard label="Faturamento" value={fmtBRL(lucroCat.reduce((s, c) => s + c.faturamento, 0))} icon={<TrendingUp className="h-5 w-5" />} color="green" />
                    <StatCard label="Lucro" value={fmtBRL(lucroCat.reduce((s, c) => s + c.lucro, 0))} icon={<Wallet className="h-5 w-5" />} color="brand" />
                    <StatCard label="CMV" value={fmtBRL(lucroCat.reduce((s, c) => s + c.custo, 0))} icon={<Boxes className="h-5 w-5" />} color="red" />
                    <StatCard label="Categorias" value={String(lucroCat.length)} icon={<FolderTree className="h-5 w-5" />} color="blue" />
                  </div>
                  <Card className="overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="th">Categoria</th>
                            <th className="th text-right">Vendas</th>
                            <th className="th text-right">Faturamento</th>
                            <th className="th text-right">Custo</th>
                            <th className="th text-right">Lucro</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {lucroCat.map((c) => (
                            <tr key={c.categoria}>
                              <td className="td font-semibold text-slate-800">{c.categoria}</td>
                              <td className="td text-right">{c.vendas}</td>
                              <td className="td text-right">{fmtBRL(c.faturamento)}</td>
                              <td className="td text-right text-slate-500">{fmtBRL(c.custo)}</td>
                              <td className="td text-right font-bold text-emerald-600">{fmtBRL(c.lucro)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                </div>
              )}
            </div>
          )}

          {tab === 'funcionario' && (
            <div className="mt-4">
              {vendasFunc.length === 0 ? (
                <Card><EmptyState icon={<UserSquare2 className="h-8 w-8" />} title="Sem vendas no período" /></Card>
              ) : (
                <Card className="overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="th">Vendedor</th>
                          <th className="th text-right">Vendas</th>
                          <th className="th text-right">Faturamento</th>
                          <th className="th text-right">Ticket médio</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {vendasFunc.map((f) => (
                          <tr key={f.funcionario}>
                            <td className="td font-semibold text-slate-800">{f.funcionario}</td>
                            <td className="td text-right">{f.vendas}</td>
                            <td className="td text-right font-bold">{fmtBRL(f.faturamento)}</td>
                            <td className="td text-right text-slate-500">{fmtBRL(f.ticket)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </div>
          )}

          {tab === 'estoque' && (
            <div className="mt-4">
              {baixo.length === 0 ? (
                <Card><EmptyState icon={<AlertTriangle className="h-8 w-8" />} title="Nenhum produto com estoque baixo" subtitle="Tudo em dia!" /></Card>
              ) : (
                <Card className="overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="th">Produto</th>
                          <th className="th">Estoque</th>
                          <th className="th">Mínimo</th>
                          <th className="th">Fornecedor</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {baixo.map((p) => (
                          <tr key={p.id}>
                            <td className="td font-semibold text-slate-800">{p.nome}</td>
                            <td className="td"><Badge color="red">{fmtNum(p.estoque_atual)} {p.unidade}</Badge></td>
                            <td className="td">{fmtNum(p.estoque_minimo)}</td>
                            <td className="td">{p.fornecedor_nome || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </div>
          )}

          {tab === 'vencimentos' && (
            <div className="mt-4">
              {venc.length === 0 ? (
                <Card><EmptyState icon={<CalendarClock className="h-8 w-8" />} title="Nada vencendo nos próximos 30 dias" /></Card>
              ) : (
                <Card className="overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="th">Produto</th>
                          <th className="th">Vencimento</th>
                          <th className="th">Dias</th>
                          <th className="th">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {venc.map((v) => {
                          const d = diasAte(v.data_vencimento);
                          return (
                            <tr key={v.id}>
                              <td className="td font-semibold text-slate-800">{v.produto_nome}</td>
                              <td className="td">{v.data_vencimento}</td>
                              <td className="td">{d !== null ? d : '-'}d</td>
                              <td className="td">
                                <Badge color={d !== null && d < 0 ? 'red' : d !== null && d <= 3 ? 'amber' : 'green'}>
                                  {d !== null && d < 0 ? 'Vencido' : d === 0 ? 'Hoje' : 'OK'}
                                </Badge>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </div>
          )}

          {tab === 'perdas' && (
            <div className="mt-4">
              {perdas.length === 0 ? (
                <Card><EmptyState icon={<Trash2 className="h-8 w-8" />} title="Nenhuma perda no período" /></Card>
              ) : (
                <Card className="overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="th">Origem</th>
                          <th className="th">Motivo</th>
                          <th className="th text-right">Ocorrências</th>
                          <th className="th text-right">Unidades</th>
                          <th className="th text-right">Valor</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {perdas.map((p, i) => (
                          <tr key={i}>
                            <td className="td"><Badge color="red">{p.origem}</Badge></td>
                            <td className="td">{p.motivo}</td>
                            <td className="td text-right">{p.qtd}</td>
                            <td className="td text-right">{fmtNum(p.unidades)}</td>
                            <td className="td text-right font-bold text-red-600">{fmtBRL(p.valor)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </div>
          )}
        </>
      )}
    </AnimatedPage>
  );
}
