import { motion } from 'framer-motion';

export function StatCard({
  label,
  value,
  icon,
  color = 'brand',
  sub,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color?: 'brand' | 'green' | 'red' | 'amber' | 'blue';
  sub?: string;
}) {
  const colors = {
    brand: 'bg-brand-50 text-brand-600',
    green: 'bg-emerald-50 text-emerald-600',
    red: 'bg-red-50 text-red-600',
    amber: 'bg-amber-50 text-amber-600',
    blue: 'bg-blue-50 text-blue-600',
  };
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="card p-4"
    >
      <div className="flex items-center gap-3">
        <div className={`rounded-xl p-2.5 ${colors[color]}`}>{icon}</div>
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
          <p className="truncate text-lg font-extrabold text-slate-800">{value}</p>
          {sub && <p className="text-[11px] text-slate-400">{sub}</p>}
        </div>
      </div>
    </motion.div>
  );
}
