import { useEffect, useRef, useState } from 'react';
import { nfcApi, type NfcEvento, type NfcServidor } from '@/lib/api';
import { nfcScanLink } from '@/lib/nfcScanLink';
import { nfcReadingMode, webNfcAvailable, type WebNfcScan } from '@/lib/webNfc';
import { Button } from '@/components/ui';

/** Prioriza o leitor do próprio navegador, sem seleção obrigatória por pedido. */
export function NfcScanButton({ enabled, onRead, onStart, webScan = null, onWebStart }: {
  enabled: boolean;
  onRead: (reading: Pick<NfcEvento, 'uid' | 'payload'>) => void;
  onStart: (exclusive?: boolean) => void;
  webScan?: WebNfcScan | null;
  onWebStart?: () => void;
}) {
  const android = /Android/i.test(navigator.userAgent);
  const integrated = android && (/\bwv\b|DoixPServidor\//i.test(navigator.userAgent) || !!window.__doixpAndroidNfc);
  const callback = useRef(onRead);
  callback.current = onRead;
  const start = useRef(onStart);
  start.current = onStart;
  const [attempt, setAttempt] = useState(0);
  const [link, setLink] = useState('');
  const [message, setMessage] = useState('Identificando o leitor disponível…');
  const [retry, setRetry] = useState(false);
  const [servers, setServers] = useState<NfcServidor[]>([]);
  const [selected, setSelected] = useState(nfcReadingMode);
  const [readerName, setReaderName] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [serverError, setServerError] = useState('');
  const [localUnavailable, setLocalUnavailable] = useState(false);
  const useWeb = selected === 'web' || (selected === 'auto' && !localUnavailable && (webScan !== null || webNfcAvailable()));
  const useIntegrated = !useWeb && integrated && (selected === 'auto' || selected === 'integrado');
  const signature = servers.map((s) => `${s.tipo}:${s.id}${selected === 'auto' ? `:${s.online}` : ''}`).join('|');

  useEffect(() => {
    if (!enabled) return;
    if (useWeb) {
      start.current(true);
      setLink(''); setReaderName('NFC deste celular');
      if (!webScan) { setMessage('Toque em Ativar NFC para usar este celular.'); setRetry(true); return; }
      return webScan.subscribe(() => {
        const state = webScan.state();
        if (state.unavailable && selected === 'auto') setLocalUnavailable(true);
        const uid = webScan.take();
        setMessage(state.message);
        setRetry(state.phase === 'error' || state.phase === 'closed' || (state.phase === 'read' && !uid));
        if (uid) callback.current({ uid, payload: '' });
      });
    }
    if (useIntegrated) {
      start.current(false);
      setLink(''); setRetry(false); setReaderName('NFC integrado deste aparelho');
      setMessage('Aproxime o cartão. O leitor deste aparelho já está ativo.');
      return;
    }
    if (!loaded) return;
    let stopped = false;
    let busy = false;
    let finished = false;
    let id: string | undefined;
    setLink(''); setRetry(false); setReaderName(''); setMessage('Identificando o leitor disponível…');
    start.current(true);
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
    const prepare = async () => {
      let preferred = '';
      try { preferred = localStorage.getItem('doixp-nfc-servidor') || ''; } catch { /* armazenamento indisponível */ }
      const candidates = selected === 'auto'
        ? servers.filter((s) => s.online).sort((a, b) => Number(`${b.tipo}:${b.id}` === preferred) - Number(`${a.tipo}:${a.id}` === preferred))
        : servers.filter((s) => `${s.tipo}:${s.id}` === selected);
      let source: NfcServidor | undefined;
      let request;
      let error: any;
      for (const candidate of candidates) {
        if (stopped) return;
        try { request = await nfcApi.solicitar(candidate); source = candidate; break; }
        catch (failure: any) { error = failure; if (failure?.status !== 409) throw failure; }
      }
      if (!request) {
        if (error) throw error;
        if (!android || !['auto', 'nativo'].includes(selected)) throw { error: 'Nenhum leitor conectado disponível. Conecte o servidor ou escolha um leitor nas opções.' };
        request = await nfcApi.solicitar();
      }
      id = request.id;
      if (stopped) { void nfcApi.cancelarSolicitacao(id).catch(() => {}); return; }
      if (source) {
        setReaderName(source.nome);
        setMessage(`Aproxime o cartão em ${source.nome}. A leitura chegará a esta tela.`);
        try { localStorage.setItem('doixp-nfc-servidor', `${source.tipo}:${source.id}`); } catch { /* armazenamento indisponível */ }
      } else {
        setReaderName('Leitor Android');
        setLink(nfcScanLink(window.location.origin, request.id, request.token));
        setMessage('Este navegador não oferece Web NFC. Use Chrome no Android para ler aqui ou abra o leitor abaixo.');
      }
      void poll();
    };
    void prepare().catch((error: any) => {
      if (!stopped) { setMessage(error?.error || 'Não foi possível preparar o leitor.'); setRetry(true); }
    });
    const timer = setInterval(poll, 1200);
    window.addEventListener('focus', poll);
    document.addEventListener('visibilitychange', poll);
    return () => {
      stopped = true; clearInterval(timer);
      window.removeEventListener('focus', poll);
      document.removeEventListener('visibilitychange', poll);
      if (id) void nfcApi.cancelarSolicitacao(id).catch(() => {});
    };
  }, [enabled, selected, useWeb, useIntegrated, webScan, attempt, loaded, signature]);

  useEffect(() => {
    if (!enabled || ((useWeb || useIntegrated) && !optionsOpen)) return;
    let stopped = false;
    const load = async () => {
      try {
        const list = await nfcApi.servidores();
        if (!stopped) { setServers(list); setLoaded(true); setServerError(''); }
      } catch (error: any) {
        if (!stopped) {
          const message = error?.error || 'Não foi possível conferir os leitores conectados.';
          setServerError(message);
          if (!useWeb && !useIntegrated) { setMessage(message); setRetry(true); }
        }
      }
    };
    void load();
    const timer = setInterval(load, 10_000);
    return () => { stopped = true; clearInterval(timer); };
  }, [enabled, useWeb, useIntegrated, attempt, optionsOpen]);

  return <div className="flex w-full flex-col items-center gap-2 rounded-xl bg-brand-50 p-4">
    {readerName && <p className="text-sm font-bold text-brand-700">{readerName}</p>}
    <p role="status" className="text-sm text-slate-600">{message}</p>
    {enabled && retry && <Button variant="secondary" onClick={() => {
      if (useWeb) onWebStart?.(); else setAttempt((n) => n + 1);
    }}>{useWeb ? 'Ativar NFC' : 'Tentar novamente'}</Button>}
    {enabled && link && <a href={link} className="rounded-xl bg-brand-600 px-5 py-3 text-sm font-bold text-white">Abrir leitor Android</a>}
    <details className="w-full text-left text-xs text-slate-500" onToggle={(e) => setOptionsOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer">Opções de leitura</summary>
      <label className="mt-2 block">Leitor
        <select className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm" disabled={!enabled} value={selected} onChange={(e) => {
          const next = e.target.value;
          setSelected(next);
          setLocalUnavailable(false);
          try { localStorage.setItem('doixp-nfc-modo', next); } catch { /* armazenamento indisponível */ }
          if (next === 'web' || (next === 'auto' && webNfcAvailable())) onWebStart?.(); else webScan?.close();
        }}>
          <option value="auto">Automático</option>
          {webNfcAvailable() && <option value="web">NFC deste celular pelo navegador</option>}
          {integrated && <option value="integrado">NFC integrado deste aparelho</option>}
          {servers.map((s) => <option key={`${s.tipo}:${s.id}`} value={`${s.tipo}:${s.id}`}>{s.nome} · {s.online ? 'conectado' : 'sem conexão recente'}</option>)}
          {android && <option value="nativo">Leitor do aplicativo Android</option>}
        </select>
      </label>
      {serverError && <p className="mt-2">{serverError}</p>}
      <p className="mt-2">No navegador compatível, autorize NFC uma vez e mantenha a página aberta e o celular desbloqueado. Para ler em outro aparelho, mantenha o Servidor aberto nele. Um leitor atende uma tela por vez.</p>
    </details>
  </div>;
}
