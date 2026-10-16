/** Oferece os dois PDAs e abre a confirmação nativa de instalação. */
import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { instalarPda, usePdaInstalacao } from '@/lib/pda-instalacao';

export function InstallPrompt() {
  const { pathname } = useLocation();
  const estado = usePdaInstalacao();
  const { instalado, podeInstalar, aguardandoLiberacao, plataforma, compativel, passos } = estado;
  const portal = pathname === '/';
  const marketplace = pathname === '/pedido' || pathname.startsWith('/pedido/');
  const app = marketplace ? 'Marketplace' : 'Gestor';
  const pda = portal ? 'portal' : marketplace ? 'marketplace' : 'gestor';
  const [aberto, setAberto] = useState(true);
  const [instalando, setInstalando] = useState(false);
  const [mostrarPassos, setMostrarPassos] = useState(false);
  const [aviso, setAviso] = useState<'aguardando' | 'recusado' | 'aceito' | null>(null);

  useEffect(() => {
    setAberto(true);
    setMostrarPassos(false);
    setAviso(null);
  }, [pda]);

  // Fechar recolhe o aviso, sem gravar uma preferência que faça o botão desaparecer.
  if (pathname === '/investidores' || (instalado && estado.app === pda)) return null;

  if (!aberto) return (
    <button
      type="button"
      className="fixed bottom-3 right-3 z-[70] flex items-center gap-2 rounded-xl border border-neutral-300 bg-white px-4 py-3 text-sm font-semibold text-neutral-900 shadow-lg"
      onClick={() => setAberto(true)}
      aria-label={portal ? 'Abrir instalação dos PDAs DoixP' : `Abrir instalação do PDA ${app}`}
    >
      <Download className="h-4 w-4" aria-hidden="true" /> Instalar PDA
    </button>
  );

  const instalar = async () => {
    if (!podeInstalar && (plataforma === 'ios' || !compativel)) {
      setAviso('aguardando');
      setMostrarPassos(plataforma === 'ios' || !compativel);
      return;
    }
    const pedido = instalarPda();
    setInstalando(true);
    setAviso(null);
    try {
      const resultado = await pedido;
      if (resultado === 'aceito') setAviso('aceito');
      else if (resultado === 'recusado') setAviso('recusado');
      else setAviso('aguardando');
    } finally {
      setInstalando(false);
    }
  };

  const botao = 'rounded-xl bg-neutral-950 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 disabled:opacity-60';
  // Uma navegação entre aplicativos precisa carregar o documento e o manifesto do destino.
  const precisaAbrirApp = estado.app !== pda;

  return (
    <aside className="fixed inset-x-3 bottom-3 z-[70] mx-auto flex max-w-xl flex-wrap items-center gap-3 rounded-2xl border border-neutral-300 bg-white p-4 shadow-xl" aria-label={portal ? 'Instalação dos PDAs DoixP' : `Instalação do PDA ${app}`}>
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-neutral-950 text-white">
        <Download className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-extrabold text-neutral-950">{portal ? 'Instalar PDA DoixP' : `Instalar PDA ${app}`}</p>
        <p className="mt-1 text-xs text-neutral-600">
          {portal ? 'Escolha o aplicativo que deseja instalar.' : `Tenha o ${app} DoixP na tela inicial do seu aparelho.`}
        </p>
      </div>
      <button type="button" className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-100" onClick={() => setAberto(false)} aria-label="Recolher aviso de instalação">
        <X className="h-4 w-4" />
      </button>

      {portal ? (
        <div className="grid basis-full grid-cols-2 gap-2">
          <a className={botao} href="/pedido">PDA Marketplace</a>
          <a className={botao} href="/gestor">PDA Gestor</a>
        </div>
      ) : (
        <>
          {precisaAbrirApp ? (
            <a className={`${botao} basis-full`} href={marketplace ? '/pedido' : '/gestor'}>Instalar PDA</a>
          ) : (
            <button type="button" className={`${botao} basis-full`} onClick={() => void instalar()} disabled={instalando || aviso === 'aceito'}>
              {instalando ? aguardandoLiberacao ? 'Preparando instalação…' : 'Confirme na janela do navegador…' : aviso === 'aceito' ? 'Instalação aceita' : 'Instalar PDA'}
            </button>
          )}
          <div className="basis-full text-xs leading-relaxed text-neutral-600" role="status" aria-live="polite">
            {aviso === 'aceito' ? 'O navegador está concluindo a instalação. Abra pelo ícone do aplicativo.'
              : instalando ? aguardandoLiberacao ? 'Aguarde enquanto o navegador prepara o pedido de instalação.' : 'Confirme a instalação na janela aberta pelo navegador.'
              : aviso === 'recusado' ? 'Você cancelou a instalação. Pode tentar novamente quando o navegador liberar o pedido.'
                : podeInstalar ? 'Toque em Instalar PDA e confirme a instalação na janela do navegador.'
                  : plataforma === 'ios' ? 'No iPhone ou iPad, a instalação é feita pelo menu Compartilhar do Safari.'
                    : !compativel ? 'Para instalar pelo botão, abra esta página no Chrome ou no Edge.'
                      : aviso === 'aguardando' ? 'O navegador ainda não liberou a instalação direta. Aguarde nesta página e toque novamente quando ela estiver disponível, ou veja as opções abaixo.'
                        : 'Preparando a instalação pelo navegador…'}
          </div>
          {!podeInstalar && aviso !== 'aceito' && !instalando && (
            <button type="button" className="text-xs font-semibold text-neutral-700 underline underline-offset-2" onClick={() => setMostrarPassos(!mostrarPassos)}>
              {mostrarPassos ? 'Fechar opções' : 'Outras opções de instalação'}
            </button>
          )}
          {mostrarPassos && !podeInstalar && (
            <ol className="basis-full list-decimal space-y-1 border-t border-neutral-200 pl-5 pt-3 text-xs leading-relaxed text-neutral-600">
              {passos.map((passo) => <li key={passo}>{passo}</li>)}
            </ol>
          )}
        </>
      )}
    </aside>
  );
}
