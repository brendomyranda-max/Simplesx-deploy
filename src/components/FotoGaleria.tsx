import { useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { fotoDaGaleria } from '@/lib/foto-galeria';

export function FotoGaleria({ value, onChange, largo = false }: { value: string; onChange: (foto: string) => void; largo?: boolean }) {
  const [erro, setErro] = useState('');
  const [lendo, setLendo] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className={`flex items-center justify-center overflow-hidden rounded-xl bg-slate-100 ${largo ? 'h-24 w-44' : 'h-16 w-16'}`}>
        {value ? <img src={value} alt="" className="h-full w-full object-cover" /> : <ImagePlus className="h-5 w-5 text-slate-400" />}
      </span>
      <label className="cursor-pointer rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
        {lendo ? 'Lendo a foto…' : 'Importar da galeria'}
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          disabled={lendo}
          onChange={async (event) => {
            const arquivo = event.target.files?.[0];
            event.target.value = '';
            if (!arquivo) return;
            setLendo(true);
            try {
              onChange(await fotoDaGaleria(arquivo));
              setErro('');
            } catch (error: any) {
              setErro(error?.message || 'Não foi possível usar esta foto');
            } finally {
              setLendo(false);
            }
          }}
        />
      </label>
      {value && <button type="button" className="text-xs font-semibold text-slate-500 underline" onClick={() => onChange('')}>Tirar foto</button>}
      {erro && <p className="w-full text-xs font-semibold text-rose-600">{erro}</p>}
    </div>
  );
}
