import { useEffect, useRef, useState } from 'react';
import { nfcReadingMode, startWebNfc, type WebNfcScan } from './webNfc';

export function useWebNfc() {
  const current = useRef<WebNfcScan | null>(null);
  const [scan, setScan] = useState<WebNfcScan | null>(null);
  useEffect(() => () => { current.current?.close(); }, []);
  const stop = () => { current.current?.close(); };
  const begin = (force = false) => {
    current.current?.close();
    const mode = nfcReadingMode();
    const next = force || mode === 'auto' || mode === 'web' ? startWebNfc() : null;
    current.current = next;
    setScan(next);
    return next;
  };
  return { scan, begin, stop };
}
