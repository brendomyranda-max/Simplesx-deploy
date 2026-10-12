import { useEffect, useRef, useState } from 'react';
import { nfcApi, type NfcEvento } from '@/lib/api';
import { nfcScanLink } from '@/lib/nfcScanLink';
import { Button } from '@/components/ui';

/** Solicita uma leitura nativa vinculada à espera desta tela, inclusive no Chrome/PWA. */
export function NfcScanButton({ enabled, onRead, onStart }: {
  enabled: boolean;
  onRead: (reading: Pick<NfcEvento, 'uid' | 'payload'>) => void;
  onStart: () => void;
}) {
  const android = /Android/i.test(navigator.userAgent);
  const callback = useRef(onRead);
  callback.current = onRead;
  const [attempt, setAttempt] = useState(0);
  const [link, setLink] = useState('');
  const [message, setMessage] = useState('Preparando o leitor…');
  const [retry, setRetry] = useState(false);

  useEffect(() => {
    if (!android || !enabled) return;
    let stopped = false;
    let busy = false;
    let finished = false;
    let id: string | undefined;
    setLink(''); setRetry(false); setMessage('Preparando o leitor…');
    const poll = async () => {
      if (stopped || busy || finished || !id || document.visibilityState !== 'visible') return;
      busy = true;
      try {
        const result = await nfcApi.solicitacao(id);
        if (stopped) return;
        if (result.estado === 'lido' && result.uid) {
          finished = true;
          setLink(''); setMessage('Cartão recebido. Processando a comanda…');
          callback.current({ uid: result.uid, payload: '' });
        } else if (result.estado === 'expirado' || result.estado === 'cancelado') {
          finished = true;
          setLink(''); setMessage('A espera terminou. Prepare uma nova leitura.'); setRetry(true);
        }
      } catch (error: any) {
        if (!stopped) setMessage(error?.error || 'Não foi possível conferir a leitura. Verifique a conexão.');
      } finally { busy = false; }
    };
    nfcApi.solicitar().then((request) => {
      id = request.id;
      if (stopped) { void nfcApi.cancelarSolicitacao(id).catch(() => {}); return; }
      setLink(nfcScanLink(window.location.origin, request.id, request.token));
      setMessage('Abra o leitor, aproxime o cartão e aguarde o retorno a esta tela.');
      void poll();
    }).catch((error: any) => {
      if (!stopped) { setMessage(error?.error || 'Não foi possível preparar o leitor.'); setRetry(true); }
    });
    const timer = setInterval(poll, 1200);
    window.addEventListener('focus', poll);
    document.addEventListener('visibilitychange', poll);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener('focus', poll);
      document.removeEventListener('visibilitychange', poll);
      if (id) void nfcApi.cancelarSolicitacao(id).catch(() => {});
    };
  }, [android, enabled, attempt]);

  if (!android) return null;
  return <div className="flex w-full flex-col items-center gap-2 rounded-xl bg-brand-50 p-4">
    {enabled && link && <a href={link} onClick={onStart} className="rounded-xl bg-brand-600 px-5 py-3 text-sm font-bold text-white">Ler cartão neste celular</a>}
    <p role="status" className="text-sm text-slate-600">{message}</p>
    {enabled && retry && <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>Preparar novamente</Button>}
    <p className="text-xs text-slate-500">Se o leitor não abrir, <a className="underline" href="/downloads/gestor-android" target="_blank" rel="noreferrer">atualize o Servidor Android</a> e volte a esta tela.</p>
  </div>;
}
