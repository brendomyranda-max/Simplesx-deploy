export function Badge({
  children,
  color = 'slate',
  className = '',
}: {
  children: React.ReactNode;
  color?: 'slate' | 'green' | 'red' | 'amber' | 'blue' | 'purple' | 'brand';
  className?: string;
}) {
  const colors: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-600',
    green: 'bg-emerald-100 text-emerald-700',
    red: 'bg-red-100 text-red-700',
    amber: 'bg-amber-100 text-amber-700',
    blue: 'bg-blue-100 text-blue-700',
    purple: 'bg-purple-100 text-purple-700',
    brand: 'bg-brand-100 text-brand-700',
  };
  return <span className={`chip ${colors[color]} ${className}`}>{children}</span>;
}
