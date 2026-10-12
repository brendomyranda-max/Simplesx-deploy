import type { NfcEvento } from './api';

export interface AndroidNfcReading { uid: string; lidoEm: number }
const VALIDADE_LOCAL_MS = 15_000;

export function createNfcDelivery(options: {
  ready: () => boolean;
  request: () => number;
  visible: () => boolean;
  identify: (uid: string) => Promise<NfcEvento>;
  consume: (id: number) => Promise<NfcEvento>;
  deliver: (event: NfcEvento) => void;
  error: (message: string) => void;
  pending: () => void;
  now?: () => number;
}) {
  const now = options.now || Date.now;
  const seen = new Set<number>();
  const nativeSeen = new Set<string>();
  let pending: AndroidNfcReading | null = null;
  let nativeBusy = false;
  let cloudBusy = false;
  let disposed = false;
  const valid = (reading: AndroidNfcReading) => reading && /^[0-9A-Fa-f]{8}(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{12})?$/.test(reading.uid)
    && Number.isSafeInteger(reading.lidoEm) && now() - reading.lidoEm >= -1000 && now() - reading.lidoEm <= VALIDADE_LOCAL_MS;
  const remember = <T>(set: Set<T>, value: T) => {
    set.add(value);
    if (set.size > 200) set.delete(set.values().next().value!);
  };
  const deliver = (event: NfcEvento) => {
    if (disposed || seen.has(event.id)) return;
    remember(seen, event.id);
    options.deliver(event);
  };

  async function flushNative() {
    if (disposed || nativeBusy || cloudBusy || !pending || !options.ready() || !options.visible()) return;
    const reading = pending;
    pending = null;
    if (!valid(reading)) return;
    nativeBusy = true;
    const request = options.request();
    try {
      const event = await options.identify(reading.uid);
      if (!event.duplicate && options.ready() && options.request() === request) deliver(event);
    } catch (error: any) {
      if (!disposed) options.error(error?.error || 'O cartão foi lido, mas não chegou à comanda. Confira a conexão e aproxime novamente.');
    } finally { nativeBusy = false; }
  }

  async function receiveNative(reading: AndroidNfcReading) {
    if (disposed || nativeBusy || cloudBusy || !valid(reading)) return;
    const key = `${reading.lidoEm}:${reading.uid}`;
    if (nativeSeen.has(key)) return;
    remember(nativeSeen, key);
    pending = reading;
    if (!options.ready()) options.pending();
    await flushNative();
  }

  async function receiveCloud(events: NfcEvento[]) {
    if (disposed || cloudBusy || !options.visible()) return;
    cloudBusy = true;
    try {
      for (const event of events) {
        if (disposed || !options.visible()) break;
        const test = event.origem === 'android-teste';
        if (seen.has(event.id) || (!test && (!options.ready() || nativeBusy))) continue;
        const request = options.request();
        try {
          const consumed = await options.consume(event.id);
          if (test || (options.ready() && options.request() === request)) deliver(consumed);
          // Dá tempo de a ação fechar a espera antes de consumir outro cartão.
          if (!test) break;
        } catch (error: any) {
          if (error?.status !== 409) break;
        }
      }
    } finally { cloudBusy = false; }
  }
  return { receiveNative, receiveCloud, flushNative, dispose: () => { disposed = true; pending = null; } };
}
