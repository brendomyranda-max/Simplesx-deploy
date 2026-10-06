import { useId, useState } from 'react';
import { ArrowRight, Building2, ChevronUp, TrendingUp } from 'lucide-react';

export function Investimento() {
  const [aberto, setAberto] = useState(false);
  const id = useId();

  return <section className="mt-4 overflow-hidden rounded-2xl border border-brand-200 bg-white shadow-soft">
    <div className="bg-gradient-to-br from-brand-50 via-white to-slate-50 p-5 text-left">
      <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-brand-600">
        <TrendingUp className="h-4 w-4" aria-hidden="true" /> O futuro da SimplesX
      </div>
      <h2 className="text-lg font-extrabold tracking-tight text-slate-900">Invista na SimplesX</h2>
      <p className="mt-1 font-semibold text-slate-700">Faça parte da nossa empresa.</p>
      <p className="mt-2 text-sm leading-relaxed text-slate-500">Conheça nossa trajetória, onde estamos e aonde queremos chegar.</p>
      <button type="button" aria-expanded={aberto} aria-controls={id} onClick={() => setAberto((value) => !value)}
        className="mt-4 inline-flex items-center gap-2 rounded-lg text-sm font-bold text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-500">
        {aberto ? 'Fechar apresentação' : 'Conhecer a proposta'}
        {aberto ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ArrowRight className="h-4 w-4" aria-hidden="true" />}
      </button>
    </div>
    {aberto && <div id={id} className="border-t border-brand-100 p-5 text-left">
      <div className="flex items-center gap-2 text-sm font-bold text-slate-800"><Building2 className="h-4 w-4 text-brand-600" aria-hidden="true" /> Proposta em preparação</div>
      <p className="mt-2 text-sm leading-relaxed text-slate-500">Estamos preparando a apresentação da SimplesX, com o momento atual da empresa, nossos objetivos e as condições para participar.</p>
      <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">A proposta completa será disponibilizada aqui.</p>
    </div>}
  </section>;
}
