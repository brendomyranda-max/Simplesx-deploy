import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Boxes,
  ScanBarcode,
  UtensilsCrossed,
  Wallet,
  AlertTriangle,
  CalendarClock,
  TrendingUp,
  PackagePlus,
  ArrowRight,
  Trash2,
} from 'lucide-react';
import { AnimatedPage } from '@/components/anim';
import { Button, Card, StatCard, Spinner, Badge } from '@/components/ui';
import { estadoApi, relatorioApi, validadeApi, vendaApi } from '@/lib/api';
import type { EstadoSistema, ResumoRelatorio, Venda, ValidadeControle } from '@/lib/types';
import { fmtBRL, fmtData, diasAte, hojeLocal } from '@/lib/format';

export function Dashboard() {
  const [estado, setEstado] = useState<EstadoSistema | null>(null);
  const [resumo, setResumo] = useState<ResumoRelatorio | null>(null);
  const [ultimas, setUltimas] = useState<Venda[]>([]);
  const [vencendo, setVencendo] = useState<ValidadeControle[]>([]);
  const [load, setLoad] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [e, r, u, v] = await Promise.all([
          estadoApi.get(),
          relatorioApi.resumo(hojeLocal(), hojeLocal()),
          vendaApi.list(),
          validadeApi.list({ vencendo_dias: '7' }),
        ]);
        setEstado(e);
        setResumo(r);
        setUltimas(u.slice(0, 8));
        setVencendo(v.slice(0, 6));
      } catch {
        /* noop */
      } finally {
        setLoad(false);
      }
    })();
  }, []);

  if (load) return <Spinner label="Carregando..." />;

  const atalhos = [
    { to: '/pdv', label: 'Abrir PDV', icon: <ScanBarcode className="h-5 w-5" />, color: 'bg-brand-600 text-white' },
    { to: '/restaurante', label: 'Mesas', icon: <UtensilsCrossed className="h-5 w-5" />, color: 'bg-emerald-600 text-white' },
    { to: '/entrada', label: 'Entrada de Mercadorias', icon: <PackagePlus className="h-5 w-5" />, color: 'bg-blue-600 text-white' },
    { to: '/validade', label: 'Validade', icon: <CalendarClock className="h-5 w-5" />, color: 'bg-amber-500 text-white' },
  ];

  return (
    <AnimatedPage>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-800">Início</h1>
          <p className="text-sm text-slate-500">Visão geral do seu negócio hoje</p>
        </div>
        <div className="flex gap-2">
          <Link to="/pdv">
            <Button icon={<ScanBarcode className="h-4 w-4" />}>Nova venda</Button>
          </Link>
          <Link to="/restaurante">
            <Button variant="success" icon={<UtensilsCrossed className="h-4 w-4" />}>Restaurante</Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Faturamento hoje"
          value={fmtBRL(estado?.faturamento_hoje)}
          icon={<TrendingUp className="h-5 w-5" />}
          color="green"
          sub={`${estado?.vendas_hoje || 0} vendas`}
        />
        <StatCard label="Estoque baixo" value={estado?.estoque_baixo || 0} icon={<AlertTriangle className="h-5 w-5" />} color="red" />
        <StatCard label="Mesas ocupadas" value={estado?.mesas_ocupadas || 0} icon={<UtensilsCrossed className="h-5 w-5" />} color="blue" sub={`${estado?.comandas_abertas || 0} comandas`} />
        <StatCard label="Vencendo em 7 dias" value={estado?.validade_vencendo || 0} icon={<CalendarClock className="h-5 w-5" />} color="amber" />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {resumo && (
          <>
            <StatCard label="Lucro líquido" value={fmtBRL(resumo.lucro_liquido)} icon={<Wallet className="h-5 w-5" />} color="green" sub={`${resumo.margem_pct.toFixed(1)}% margem`} />
            <StatCard label="CMV" value={`${resumo.cmv_pct.toFixed(1)}%`} icon={<Boxes className="h-5 w-5" />} color="blue" sub={fmtBRL(resumo.cmv)} />
            <StatCard label="Despesas" value={fmtBRL(resumo.despesas)} icon={<Wallet className="h-5 w-5" />} color="red" />
            <StatCard label="Perdas" value={fmtBRL(resumo.perdas)} icon={<Trash2 className="h-5 w-5" />} color="amber" sub={`${estado?.perdas_hoje || 0} hoje`} />
          </>
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-bold text-slate-700">Últimas vendas</h2>
          {ultimas.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">Nenhuma venda registrada ainda</p>
          ) : (
            <div className="space-y-2">
              {ultimas.map((v) => (
                <div key={v.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-700">{v.numero}</p>
                    <p className="text-[11px] text-slate-400">{fmtData(v.criado_em)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-slate-800">{fmtBRL(v.total)}</p>
                    <Badge color={v.tipo === 'pdv' ? 'brand' : 'purple'}>{v.tipo === 'pdv' ? 'PDV' : 'Restaurante'}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-700">Ações rápidas</h2>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {atalhos.map((a, i) => (
                <Link key={a.to} to={a.to}>
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    whileHover={{ y: -2 }}
                    className="flex flex-col items-start gap-2 rounded-xl border border-slate-200 p-3 transition-colors hover:border-brand-300 hover:bg-brand-50/50"
                  >
                    <div className={`rounded-lg p-2 ${a.color}`}>{a.icon}</div>
                    <span className="text-sm font-semibold text-slate-700">{a.label}</span>
                  </motion.div>
                </Link>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-700">Vencendo em 7 dias</h2>
              <Link to="/validade" className="flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700">
                Ver todos <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            {vencendo.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-400">Nenhum produto vencendo</p>
            ) : (
              <div className="space-y-2">
                {vencendo.map((v) => {
                  const d = diasAte(v.data_vencimento);
                  return (
                    <div key={v.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-700">{v.produto_nome}</p>
                        <p className="text-[11px] text-slate-400">{v.temperatura || 'Ambiente'}</p>
                      </div>
                      <Badge color={d !== null && d < 0 ? 'red' : d !== null && d <= 3 ? 'amber' : 'green'}>
                        {d !== null && d < 0 ? `Vencido há ${-d}d` : d === 0 ? 'Vence hoje' : `${d}d`}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </div>
    </AnimatedPage>
  );
}
