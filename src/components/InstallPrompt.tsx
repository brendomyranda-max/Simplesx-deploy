/**
 * Arquivo: InstallPrompt.tsx
 * Responsabilidade: Oferece a instalação do PDA correspondente à página atual.
 */

import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { instalarPda, usePdaInstalacao } from '@/lib/pda-instalacao';

const OCULTO = 'doixp-instalacao-nativa-v1';

function ocultoNaSessao(chave: string) {
  try {
    return sessionStorage.getItem(chave) === '1';
  } catch {
    return false;
  }
}

export function InstallPrompt() {
  const { pathname } = useLocation();
  const { instalado, podeInstalar, plataforma, passos } = usePdaInstalacao();
  const marketplace = pathname === '/pedido' || pathname.startsWith('/pedido/');
  const gestor = pathname === '/gestor' || pathname.startsWith('/gestor/') || (pathname !== '/' && pathname !== '/investidores' && !marketplace);
  const app = marketplace ? 'Marketplace' : 'Gestor';
  const chaveOculto = `${OCULTO}:${marketplace ? 'marketplace' : 'gestor'}`;
  const [oculto, setOculto] = useState(() => ocultoNaSessao(chaveOculto));
  const [mostrarPassos, setMostrarPassos] = useState(false);
  // Android, Windows e Linux só exibem o botão quando o navegador já pode abrir
  // a confirmação nativa. Assim o CTA nunca vira um botão de instruções nesses sistemas.
  const mostraBanner = podeInstalar || plataforma === 'ios';

  useEffect(() => {
    setOculto(ocultoNaSessao(chaveOculto));
    setMostrarPassos(false);
  }, [chaveOculto]);

  if (instalado || oculto || !mostraBanner || (!marketplace && !gestor)) return null;

  const fechar = () => {
    try {
      sessionStorage.setItem(chaveOculto, '1');
    } catch {
      /* a sessão privada pode bloquear o armazenamento */
    }
    setOculto(true);
  };

  const instalar = async () => {
    // iOS não oferece beforeinstallprompt; o botão abre instruções em vez de não fazer nada.
    if (plataforma === 'ios' || !podeInstalar) {
      setMostrarPassos(true);
      return;
    }

    const resultado = await instalarPda();
    if (resultado === 'aceito') setOculto(true);
    if (resultado === 'indisponivel') setMostrarPassos(true);
  };

  return (
    <aside className="fixed inset-x-3 bottom-3 z-[70] mx-auto flex max-w-xl flex-wrap items-center gap-3 rounded-2xl border border-brand-200 bg-white p-3 shadow-lg" aria-label={`Instalação do PDA ${app}`}>
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-600 text-white">
        <Download className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-extrabold text-slate-800">Instalar {app} DoixP</p>
        <p className="text-xs text-slate-500">
          {podeInstalar
            ? `Instale o ${app} diretamente neste aparelho.`
            : `No iPhone ou iPad, adicione o ${app} à tela inicial pelo Safari.`}
        </p>
      </div>
      <button type="button" className="rounded-xl bg-brand-600 px-3 py-2 text-sm font-semibold text-white" onClick={() => void instalar()}>
        {podeInstalar && plataforma !== 'ios' ? 'Instalar' : 'Como instalar'}
      </button>
      <button type="button" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100" onClick={fechar} aria-label="Fechar aviso de instalação">
        <X className="h-4 w-4" />
      </button>
      {mostrarPassos && (
        <div className="basis-full border-t border-slate-100 pt-3">
          <p className="text-sm font-bold text-slate-800">Como instalar o {app}</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs leading-relaxed text-slate-600">
            {passos.map((passo) => <li key={passo}>{passo}</li>)}
          </ol>
          <button type="button" className="mt-3 text-xs font-semibold text-brand-700 underline underline-offset-2" onClick={() => setMostrarPassos(false)}>
            Fechar instruções
          </button>
        </div>
      )}
    </aside>
  );
}
