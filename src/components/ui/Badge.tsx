/**
 * Arquivo: Badge.tsx
 * Responsabilidade: Componente visual reutilizável Badge.tsx usado para manter a interface consistente.
 */

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
    blue: 'bg-brand-100 text-brand-700',
    purple: 'bg-brand-100 text-brand-700',
    brand: 'bg-brand-100 text-brand-700',
  };
  return <span className={`chip ${colors[color]} ${className}`}>{children}</span>;
}
