import { useEffect, useRef } from 'react';

interface BarcodeScannerOptions {
  enabled?: boolean;
  /** Intervalo máximo entre caracteres enviados pelo leitor. */
  timeoutMs?: number;
}

/**
 * Captura leitores USB/Bluetooth configurados como teclado mesmo quando um
 * botão ou uma área vazia da tela está com foco. Campos editáveis são
 * preservados para não interferir com a digitação normal do operador.
 */
export function useBarcodeScanner(
  onScan: (codigo: string) => void,
  { enabled = true, timeoutMs = 120 }: BarcodeScannerOptions = {}
) {
  const callbackRef = useRef(onScan);

  useEffect(() => {
    callbackRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!enabled) return;

    let buffer = '';
    let ultimoCaractere = 0;

    const limpar = () => {
      buffer = '';
      ultimoCaractere = 0;
    };

    const aoPressionar = (event: KeyboardEvent) => {
      const alvo = event.target as HTMLElement | null;
      const editavel =
        alvo instanceof HTMLInputElement ||
        alvo instanceof HTMLTextAreaElement ||
        alvo instanceof HTMLSelectElement ||
        Boolean(alvo?.isContentEditable);

      if (editavel || event.ctrlKey || event.altKey || event.metaKey) {
        limpar();
        return;
      }

      if (/^\d$/.test(event.key)) {
        const agora = Date.now();
        if (ultimoCaractere && agora - ultimoCaractere > timeoutMs) buffer = '';
        buffer += event.key;
        ultimoCaractere = agora;
        return;
      }

      if (event.key === 'Enter') {
        const codigo = buffer;
        limpar();
        if (codigo.length >= 4) {
          event.preventDefault();
          callbackRef.current(codigo);
        }
        return;
      }

      limpar();
    };

    window.addEventListener('keydown', aoPressionar);
    return () => window.removeEventListener('keydown', aoPressionar);
  }, [enabled, timeoutMs]);
}
