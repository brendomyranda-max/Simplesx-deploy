import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCheck, RefreshCw, Store, UtensilsCrossed } from 'lucide-react';
import { AnimatedPage } from '@/components/anim';
import { Badge, Button, Card, EmptyState, Field, Input, Spinner, Textarea, useToast } from '@/components/ui';
import { fechamentoCaixaApi } from '@/lib/api';
import type { FechamentoCaixa, FechamentoCaixaResumo } from '@/lib/types';
import { fmtBRL, fmtData, hojeLocal } from '@/lib/format';
import { formaLabel } from '@/lib/format';
import { useAuth } from '@/store/auth';

const FORMAS = ['dinheiro', 'pix', 'credito', 'debito', 'vale', 'boleto', 'outro'];

export function FechamentoCaixaPage() {
  const toast = useToast();
  const responsavel = useAuth((s) => s.nome);
  const [data, setData] = useState(hojeLocal());
  const [resumo, setResumo] = useState<FechamentoCaixaResumo | null>(null);
  const [historico, setHistorico] = useState<FechamentoCaixa[]>([]);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [justificativa, setJustificativa] = useState('');
  const [load, setLoad] = useState(true);
  const [saving, setSaving] = useState(false);
  const [vendasConfirmadas, setVendasConfirmadas] = useState<number[]>([]);

  const carregar = async () => {
    setLoad(true);
    try {
      const [r, h] = await Promise.all([fechamentoCaixaApi.resumo(data), fechamentoCaixaApi.list()]);
      setResumo(r); setHistorico(h);
      setVendasConfirmadas(r.vendas.filter((v) => v.status === 'aguardando_fechamento').map((v) => v.id));
      setValores(Object.fromEntries(FORMAS.map((f) => [f, String((r.formas[f] || 0).toFixed(2))])));
    } catch (e: any) { toast('error', e?.error || 'Erro ao conferir o caixa'); }
    finally { setLoad(false); }
  };
  useEffect(() => { carregar(); }, [data]);

  const formasEsperadas = useMemo(() => {
    if (!resumo) return {} as Record<string, number>;
    const formas = { ...resumo.formas };
    for (const venda of resumo.vendas.filter((v) => v.status === 'aguardando_fechamento' && !vendasConfirmadas.includes(v.id))) {
      const pagamentos = venda.pagamentos || [];
      const pago = pagamentos.reduce((s, p) => s + Number(p.valor), 0);
      let troco = Math.max(0, pago - venda.total);
      for (const pg of pagamentos) {
        const forma = FORMAS.includes(pg.forma) ? pg.forma : 'outro';
        const desconta = forma === 'dinheiro' ? Math.min(troco, pg.valor) : 0;
        formas[forma] = (formas[forma] || 0) - pg.valor + desconta;
        troco -= desconta;
      }
    }
    return formas;
  }, [resumo, vendasConfirmadas]);
  const totalInformado = useMemo(() => FORMAS.reduce((s, f) => s + Number(valores[f] || 0), 0), [valores]);
  const totalEsperado = useMemo(() => FORMAS.reduce((s, f) => s + Number(formasEsperadas[f] || 0), 0), [formasEsperadas]);
  const diferenca = totalInformado - totalEsperado;

  const fechar = async () => {
    if (Math.abs(diferenca) >= 0.01 && justificativa.trim().length < 5) return toast('error', 'Justifique a diferença encontrada');
    setSaving(true);
    try {
      const r = await fechamentoCaixaApi.create({ data, valores: Object.fromEntries(FORMAS.map((f) => [f, Number(valores[f] || 0)])), vendas_confirmadas: vendasConfirmadas, justificativa, responsavel: responsavel || undefined });
      toast(r.status === 'conferido' ? 'success' : 'error', r.status === 'conferido' ? 'Caixa fechado e conferido' : `Caixa fechado com diferença de ${fmtBRL(r.diferenca)}`);
      setJustificativa(''); await carregar();
    } catch (e: any) { toast('error', e?.error || 'Erro ao fechar caixa'); }
    finally { setSaving(false); }
  };

  if (load || !resumo) return <Spinner />;
  return <AnimatedPage>
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-xl font-extrabold text-slate-800">Fechamento de Caixa</h1><p className="text-sm text-slate-500">Confira se as vendas do Mercado e Restaurante foram recebidas</p></div>
      <div className="flex items-end gap-2"><Field label="Data"><Input type="date" value={data} onChange={(e) => setData(e.target.value)} /></Field><Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={carregar}>Atualizar</Button></div>
    </div>
    <div className="mb-4 grid gap-3 md:grid-cols-3">
      <Card className="p-4"><div className="flex items-center gap-2 text-brand-600"><Store className="h-5 w-5"/><b>PDV Mercado</b></div><p className="mt-2 text-2xl font-extrabold">{fmtBRL(resumo.total_mercado)}</p><p className="text-xs text-slate-500">{resumo.vendas_mercado} vendas confirmadas</p></Card>
      <Card className="p-4"><div className="flex items-center gap-2 text-purple-600"><UtensilsCrossed className="h-5 w-5"/><b>Restaurante</b></div><p className="mt-2 text-2xl font-extrabold">{fmtBRL(resumo.total_restaurante)}</p><p className="text-xs text-slate-500">{resumo.vendas_restaurante} contas confirmadas</p></Card>
      <Card className={`p-4 ${resumo.vendas_canceladas ? 'border-amber-200 bg-amber-50' : ''}`}><div className="flex items-center gap-2 text-amber-700"><AlertTriangle className="h-5 w-5"/><b>Cancelamentos</b></div><p className="mt-2 text-2xl font-extrabold">{resumo.vendas_canceladas}</p><p className="text-xs text-slate-500">Vendas que não devem entrar no recebimento</p></Card>
    </div>
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="overflow-hidden"><div className="bg-slate-800 px-4 py-3 text-sm font-bold text-white">Conferência por forma de pagamento</div><div className="divide-y divide-slate-100">{FORMAS.map((forma) => { const esp = formasEsperadas[forma] || 0; const inf = Number(valores[forma] || 0); return <div key={forma} className="grid grid-cols-[1fr_110px_110px] items-center gap-3 px-4 py-3"><div><b className="text-sm text-slate-700">{forma === 'outro' ? 'Outros' : formaLabel(forma)}</b><p className="text-xs text-slate-400">Sistema: {fmtBRL(esp)}</p></div><Input type="number" step="0.01" className="text-right" value={valores[forma] || ''} onChange={(e) => setValores((v) => ({...v, [forma]: e.target.value}))}/><span className={`text-right text-sm font-bold ${Math.abs(inf - esp) < .01 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtBRL(inf - esp)}</span></div>; })}</div></Card>
      <div className="space-y-4"><Card className="p-4"><p className="text-xs font-bold uppercase text-slate-400">Resultado da conferência</p><div className="mt-3 flex justify-between"><span>Esperado pelas vendas</span><b>{fmtBRL(totalEsperado)}</b></div><div className="mt-2 flex justify-between"><span>Informado pelo operador</span><b>{fmtBRL(totalInformado)}</b></div><div className={`mt-3 flex justify-between rounded-xl p-4 text-lg font-extrabold ${Math.abs(diferenca) < .01 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}><span>{Math.abs(diferenca) < .01 ? 'Caixa confere' : diferenca > 0 ? 'Sobra' : 'Falta'}</span><span>{fmtBRL(diferenca)}</span></div>{Math.abs(diferenca) >= .01 && <Field label="Justificativa obrigatória"><Textarea rows={3} value={justificativa} onChange={(e) => setJustificativa(e.target.value)} placeholder="Explique a diferença encontrada..."/></Field>}<Button size="lg" className="mt-4 w-full" loading={saving} icon={<ClipboardCheck className="h-5 w-5"/>} onClick={fechar}>Confirmar fechamento</Button></Card>
      <Card className="p-4"><p className="mb-1 text-sm font-bold text-slate-700">Vendas verificadas ({resumo.vendas.length})</p><p className="mb-2 text-xs text-slate-400">Marque as operações que realmente foram vendas. As desmarcadas serão estornadas.</p><div className="max-h-64 overflow-auto divide-y divide-slate-100">{resumo.vendas.length === 0 ? <EmptyState icon={<ClipboardCheck className="h-7 w-7"/>} title="Nenhuma venda nesta data"/> : resumo.vendas.map((v) => <label key={v.id} className="flex cursor-pointer items-center justify-between gap-3 py-2 text-xs"><span className="flex items-center gap-2">{v.status === 'aguardando_fechamento' ? <input type="checkbox" checked={vendasConfirmadas.includes(v.id)} onChange={(e) => setVendasConfirmadas((ids) => e.target.checked ? [...ids, v.id] : ids.filter((id) => id !== v.id))}/> : <span className="w-3"/>}<span><b>{v.numero}</b> · {v.tipo === 'pdv' ? 'Mercado' : 'Restaurante'}</span></span><span className={v.status === 'cancelada' ? 'text-red-600' : v.status === 'aguardando_fechamento' ? 'text-amber-600' : 'text-emerald-600'}>{v.status === 'cancelada' ? 'Cancelada' : v.status === 'aguardando_fechamento' ? `${fmtBRL(v.total)} · confirmar` : fmtBRL(v.total)}</span></label>)}</div></Card></div>
    </div>
    <Card className="mt-4 overflow-hidden"><div className="px-4 py-3 text-sm font-bold">Histórico de fechamentos</div><div className="overflow-x-auto"><table className="w-full"><thead className="bg-slate-50"><tr><th className="th">Data</th><th className="th">Responsável</th><th className="th">Esperado</th><th className="th">Informado</th><th className="th">Diferença</th><th className="th">Status</th></tr></thead><tbody>{historico.slice(0, 20).map((h) => <tr key={h.id}><td className="td">{h.data}</td><td className="td">{h.responsavel || '-'}</td><td className="td">{fmtBRL(h.total_esperado)}</td><td className="td">{fmtBRL(h.total_informado)}</td><td className="td">{fmtBRL(h.diferenca)}</td><td className="td"><Badge color={h.status === 'conferido' ? 'green' : 'red'}>{h.status === 'conferido' ? <><CheckCircle2 className="mr-1 h-3 w-3"/>Conferido</> : 'Divergente'}</Badge></td></tr>)}</tbody></table></div></Card>
  </AnimatedPage>;
}
