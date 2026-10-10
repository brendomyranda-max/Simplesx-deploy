/**
 * Arquivo: PdaInstalacaoCard.tsx
 * Responsabilidade: Instala o PDA em tela cheia no Windows, no Linux e no Android.
 */

import { useState } from 'react';
import { Download, Maximize2, Monitor, Smartphone, Terminal } from 'lucide-react';
import { Button, Card } from '@/components/ui';
import { entrarTelaCheia, instalarPda, usePdaInstalacao } from '@/lib/pda-instalacao';
import { SISTEMAS_PDA, passosInstalacao } from '@/lib/pda-plataforma.js';

const icone = {
  windows: Monitor,
  linux: Terminal,
  android: Smartphone,
} as const;

export function PdaInstalacaoCard() {
  const estado = usePdaInstalacao();
  const [instalando, setInstalando] = useState(false);
  const [aviso, setAviso] = useState('');

  const instalar = async () => {
    const pedido = instalarPda();
    setInstalando(true);
    try {
      const resultado = await pedido;
      if (resultado === 'aceito') {
        setAviso('PDA instalado. Abra o SimplexS.A pela tela inicial ou pelo menu de aplicativos. Ele entra em tela cheia.');
      } else if (resultado === 'recusado') {
        setAviso('A instalação foi cancelada. O botão continua nesta tela.');
      } else {
        setAviso('O navegador ainda não liberou o botão direto. Siga o passo a passo deste sistema.');
      }
    } finally {
      setInstalando(false);
    }
  };

  return (
    <Card className="border-indigo-200 bg-gradient-to-r from-indigo-50 to-white p-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-indigo-600 text-white">
          <Download className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-extrabold text-slate-800">PDA em tela cheia</h2>
          <p className="mt-1 text-sm text-slate-500">
            Instale o SimplexS.A para abrir o sistema em tela cheia no Windows, no Linux e no Android.
            Os dados continuam no servidor. O Gestor de impressoras continua na tela Impressoras.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {SISTEMAS_PDA.map((sistema) => {
          const Icone = icone[sistema.id];
          const atual = estado.plataforma === sistema.id;
          return (
            <div
              key={sistema.id}
              className={atual
                ? 'rounded-xl border border-indigo-300 bg-white p-3'
                : 'rounded-xl border border-slate-200 bg-white/70 p-3'}
            >
              <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
                <Icone className="h-4 w-4 text-indigo-600" />
                {sistema.nome}
                {atual && <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">Este aparelho</span>}
              </div>
              <p className="mt-1 text-xs text-slate-500">{sistema.onde}</p>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {estado.instalado ? (
          <p className="text-sm font-semibold text-indigo-700">
            {estado.emTelaCheia
              ? 'O PDA está instalado e em tela cheia neste aparelho.'
              : 'O PDA está instalado neste aparelho.'}
          </p>
        ) : (
          <Button type="button" size="lg" onClick={() => void instalar()} loading={instalando} icon={<Download className="h-4 w-4" />}>
            Instalar PDA
          </Button>
        )}
        {!estado.emTelaCheia && (
          <Button type="button" variant="secondary" onClick={() => void entrarTelaCheia()} icon={<Maximize2 className="h-4 w-4" />}>
            {estado.instalado ? 'Abrir em tela cheia' : 'Usar em tela cheia agora'}
          </Button>
        )}
      </div>

      {aviso && <p className="mt-3 text-sm text-slate-600">{aviso}</p>}

      {!estado.instalado && !estado.podeInstalar && (
        <div className="mt-4">
          <p className="text-sm font-semibold text-slate-700">
            {estado.compativel
              ? 'Toque em Instalar PDA. Se a janela do sistema não abrir, conclua por aqui:'
              : 'Abra esta página no Chrome ou no Edge e toque em Instalar PDA. Neste navegador, o passo a passo é:'}
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-600">
            {estado.passos.map((passo) => <li key={passo}>{passo}</li>)}
          </ol>
        </div>
      )}

      <div className="mt-4 grid gap-3 border-t border-indigo-100 pt-4 sm:grid-cols-3">
        {SISTEMAS_PDA.map((sistema) => (
          <div key={sistema.id}>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{sistema.nome}</p>
            <ol className="mt-1 list-decimal space-y-1 pl-4 text-xs text-slate-500">
              {passosInstalacao(sistema.id, '').map((passo) => <li key={passo}>{passo}</li>)}
            </ol>
          </div>
        ))}
      </div>
    </Card>
  );
}
