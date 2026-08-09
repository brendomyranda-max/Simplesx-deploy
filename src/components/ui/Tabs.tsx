import { motion } from 'framer-motion';

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
      {tabs.map((t) => (
        <motion.button
          key={t.value}
          whileTap={{ scale: 0.95 }}
          onClick={() => onChange(t.value)}
          className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
            value === t.value ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          {t.label}
        </motion.button>
      ))}
    </div>
  );
}
