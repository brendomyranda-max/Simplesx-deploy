export interface WebNfcReader extends EventTarget {
  scan(options: { signal: AbortSignal }): Promise<void>;
}
type ReaderConstructor = new () => WebNfcReader;
export interface WebNfcState {
  phase: 'starting' | 'ready' | 'read' | 'error' | 'closed';
  message: string;
  unavailable?: boolean;
}

export function webNfcAvailable(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && window.top === window
    && typeof (window as Window & { NDEFReader?: ReaderConstructor }).NDEFReader === 'function';
}

export function createWebNfcScan(reader: WebNfcReader, visible = () => document.visibilityState === 'visible') {
  const abort = new AbortController();
  const listeners = new Set<() => void>();
  let state: WebNfcState = { phase: 'starting', message: 'Ativando o NFC deste celular…' };
  let uid: string | null = null;
  let finished = false;
  const change = (next: WebNfcState) => { state = next; listeners.forEach((fn) => fn()); };
  const failed = (event: unknown) => {
    if (finished) return;
    const name = (event as { name?: string })?.name;
    const message = name === 'NotAllowedError'
      ? 'Autorize o NFC nas permissões deste site e tente novamente.'
      : name === 'NotSupportedError'
        ? 'Este navegador ou aparelho não oferece leitura NFC. Use um servidor conectado nas opções de leitura.'
        : 'Não foi possível ativar o NFC. Ligue o NFC do celular e tente novamente.';
    finished = true;
    change({ phase: 'error', message, unavailable: name === 'NotSupportedError' });
    abort.abort();
  };
  reader.addEventListener('reading', (event) => {
    if (finished || !visible()) return;
    // Usa exclusivamente o serial físico. Não interpreta nem abre o NDEF.
    const serial = (event as Event & { serialNumber?: unknown }).serialNumber;
    const normalized = typeof serial === 'string' ? serial.replace(/[\s:-]/g, '').toUpperCase() : '';
    if (!/^(?:[A-F0-9]{8}|[A-F0-9]{14}|[A-F0-9]{20})$/.test(normalized)) {
      change({ phase: 'ready', message: 'O cartão não forneceu um UID válido. Aproxime novamente ou use o leitor do servidor.' });
      return;
    }
    finished = true;
    uid = normalized;
    // Mantém a captura durante o envio do pedido, até a tela encerrar a sessão.
    // O mesmo toque não deve voltar ao tratamento de texto do Android no meio.
    change({ phase: 'read', message: 'Cartão identificado neste celular.' });
  });
  reader.addEventListener('readingerror', () => {
    if (!finished) change({ phase: 'ready', message: 'Não foi possível ler o cartão. Aproxime novamente. Se persistir, use o leitor do servidor nas opções.' });
  });
  // Precisa ocorrer diretamente no clique de Aguardar/Adicionar/Fechar cartão,
  // antes de qualquer efeito React, await ou consulta ao servidor.
  try {
    reader.scan({ signal: abort.signal }).then(() => {
      if (!finished) change({ phase: 'ready', message: 'NFC deste celular ativo. Aproxime o cartão.' });
    }).catch(failed);
  } catch (error) { failed(error); }
  return {
    state: () => state,
    subscribe: (fn: () => void) => { listeners.add(fn); fn(); return () => { listeners.delete(fn); }; },
    take: () => { const reading = uid; uid = null; return reading; },
    close: () => { finished = true; uid = null; abort.abort(); change({ phase: 'closed', message: 'Leitura encerrada.' }); },
  };
}
export type WebNfcScan = ReturnType<typeof createWebNfcScan>;

export function startWebNfc(): WebNfcScan | null {
  if (!webNfcAvailable()) return null;
  const Reader = (window as Window & { NDEFReader?: ReaderConstructor }).NDEFReader;
  if (!Reader) return null;
  try { return createWebNfcScan(new Reader()); }
  catch (error) {
    return createWebNfcScan(Object.assign(new EventTarget(), { scan: () => Promise.reject(error) }));
  }
}

export function nfcReadingMode() {
  try { return localStorage.getItem('doixp-nfc-modo') || 'auto'; } catch { return 'auto'; }
}
