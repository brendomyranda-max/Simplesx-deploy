import { Loader2 } from 'lucide-react';

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-400">
      <Loader2 className="h-8 w-8 animate-spin text-brand-500" />
      {label && <p className="mt-2 text-sm">{label}</p>}
    </div>
  );
}
