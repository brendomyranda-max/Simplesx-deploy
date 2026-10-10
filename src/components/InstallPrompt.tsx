/**
 * Arquivo: InstallPrompt.tsx
 * Responsabilidade: Oferece a instalação do PDA em tela cheia no Windows, Linux e Android.
 */

import { useState } from 'react';
import { Download, X } from 'lucide-react';
import { instalarPda, usePdaInstalacao } from '@/lib/pda-instalacao';

const OCULTO = 'simplexsa-instalacao-oculta';

function ocultoNaSessao() {
  try {
    return sessionStorage.getItem(OCULTO) === '1';
  } catch {
    return false;
  }
}

export function InstallPrompt() {
  const { instalado, podeInstalar, plataforma, passos } = usePdaInstalacao();
  const [oculto, setOculto] = useState(ocultoNaSessao);
  const [dica, setDica] = useState('');
  const mostraBanner = podeInstalar || plataforma === 'windows' || plataforma === 'linux' || plataforma === 'android' || plataforma === 'ios';

  if (instalado || oculto || !mostraBanner) return null;

  const fechar = () => {
    try {
      sessionStorage.setItem(OCULTO, '1');
    } catch {
      /* a sessão privada pode bloquear o armazenamento */
    }
    setOculto(true);
  };

  const instalar = async () => {
    const resultado = await instalarPda();
    if (resultado === 'aceito') setOculto(true);
    if (resultado === 'indisponivel') setDica(passos[0] || 'Use o Chrome ou o Edge e toque em Instalar de novo.');
  };

  return (
    <div className="fixed inset-x-3 bottom-3 z-[70] mx-auto flex max-w-xl items-center gap-3 rounded-2xl border border-brand-200 bg-white p-3 shadow-lg">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-600 text-white">
        <Download className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-extrabold text-slate-800">Instalar o PDA</p>
        <p className="text-xs text-slate-500">
          {dica
            ? dica
            : plataforma === 'ios' && !podeInstalar
              ? 'No iPhone ou iPad, use Compartilhar e depois Adicionar à Tela de Início. O app abre em tela cheia.'
              : 'Abre a DoixP em tela cheia no Windows, no Linux e no Android. Os dados continuam no servidor.'}
        </p>
      </div>
      <button type="button" className="rounded-xl bg-brand-600 px-3 py-2 text-sm font-semibold text-white" onClick={() => void instalar()}>
        Instalar
      </button>
      <button type="button" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100" onClick={fechar} aria-label="Fechar">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
