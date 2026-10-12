import { useEffect, useRef, useState } from 'react';
import { nfcApi, type NfcEvento, type NfcServidor } from '@/lib/api';
import { nfcScanLink } from '@/lib/nfcScanLink';
import { Button } from '@/components/ui';

/** Vincula a espera desta tela ao celular local ou a um servidor pareado pela internet. */
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
  const [servers, setServers] = useState<NfcServidor[]>([]);
  const [selected, setSelected] = useState('');
  const [serverError, setServerError] = useState('');
  const initialized = useRef(false);
  const start = useRef(onStart);
  start.current = onStart;
  const source = servers.find((s) => `${s.tipo}:${s.id}` === selected);

  useEffect(() => {
    if (!enabled || (!selected && !android) || (selected && !source)) return;
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
          callback.current({ uid: result.uid, payload: result.payload || '' });
        } else if (result.estado === 'expirado' || result.estado === 'cancelado') {
          finished = true;
          setLink(''); setMessage('A espera terminou. Prepare uma nova leitura.'); setRetry(true);
        }
      } catch (error: any) {
        if (!stopped) setMessage(error?.error || 'Não foi possível conferir a leitura. Verifique a conexão.');
      } finally { busy = false; }
    };
    if (selected) start.current();
    nfcApi.solicitar(source).then((request) => {
      id = request.id;
      if (stopped) { void nfcApi.cancelarSolicitacao(id).catch(() => {}); return; }
      if (!selected) setLink(nfcScanLink(window.location.origin, request.id, request.token));
      setMessage(selected ? `Aguardando cartão em ${source!.nome}. Mantenha esta tela aberta.` : 'Abra o leitor, aproxime o cartão e aguarde o retorno a esta tela.');
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
  }, [android, enabled, attempt, selected, source?.id]);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    const load = async () => {
      try {
        const list = await nfcApi.servidores();
        if (stopped) return;
        setServers(list); setServerError('');
        if (!initialized.current) {
          initialized.current = true;
          let saved = '';
          try { saved = localStorage.getItem('doixp-nfc-servidor') || ''; } catch { /* armazenamento indisponível */ }
          if (list.some((s) => `${s.tipo}:${s.id}` === saved)) setSelected(saved);
          else if (!android && list.length === 1) setSelected(`${list[0].tipo}:${list[0].id}`);
        }
      } catch (error: any) {
        if (!stopped) setServerError(error?.error || 'Não foi possível listar os servidores. Confira a conexão.');
      }
    };
    void load();
    const timer = setInterval(load, 10_000);
    return () => { stopped = true; clearInterval(timer); };
  }, [enabled, android]);

  return <div className="flex w-full flex-col items-center gap-2 rounded-xl bg-brand-50 p-4">
    <label className="w-full text-left text-sm font-semibold text-slate-700">Onde aproximar o cartão
      <select className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2" disabled={!enabled} value={selected} onChange={(e) => {
        setSelected(e.target.value);
        try { localStorage.setItem('doixp-nfc-servidor', e.target.value); } catch { /* armazenamento indisponível */ }
      }}>
        <option value="">{android ? 'Neste celular / PDA' : 'Selecione o servidor NFC'}</option>
        {servers.map((s) => <option key={`${s.tipo}:${s.id}`} value={`${s.tipo}:${s.id}`}>{s.nome} · {s.tipo === 'android' ? 'Android / PDA' : 'Computador'} · {s.online ? 'conectado' : 'sem conexão recente'}</option>)}
      </select>
    </label>
    {enabled && link && <a href={link} onClick={onStart} className="rounded-xl bg-brand-600 px-5 py-3 text-sm font-bold text-white">Ler cartão neste celular</a>}
    <p role="status" className="text-sm text-slate-600">{serverError || (!selected && !android ? 'Pareie um servidor nas configurações de impressão e selecione-o aqui.' : message)}</p>
    {enabled && retry && <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>Preparar novamente</Button>}
    {selected ? <p className="text-xs text-slate-500">No Android, ative NFC e deixe a tela do Servidor aberta e desbloqueada no aparelho leitor. No computador, ative o leitor USB no Servidor e mantenha sua janela em foco. A leitura chega a esta tela pela internet.</p>
      : android && <p className="text-xs text-slate-500">Se o leitor não abrir, <a className="underline" href="/downloads/gestor-android" target="_blank" rel="noreferrer">atualize o Servidor Android</a> e volte a esta tela.</p>}
  </div>;
}
