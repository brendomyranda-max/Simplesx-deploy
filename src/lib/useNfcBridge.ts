/**
 * Arquivo: useNfcBridge.ts
 * Responsabilidade: Recebe leituras NFC do Gestor e entrega uma só vez ao terminal em foco.
 */

import { useEffect, useRef } from 'react';
import { CUPS_SERVER } from '@/lib/cupsPrint';
import { nfcApi, type NfcEvento } from '@/lib/api';

export const NFC_EVENTO = 'simplexsa:nfc';

interface NfcLocal {
  ativo: boolean;
  prefixo: string;
}

function editavel(alvo: EventTarget | null) {
  return alvo instanceof HTMLInputElement
    || alvo instanceof HTMLTextAreaElement
    || alvo instanceof HTMLSelectElement
    || (alvo instanceof HTMLElement && alvo.isContentEditable);
}

async function publicarLocal(texto: string) {
  const resposta = await fetch(`${CUPS_SERVER}/nfc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: texto }),
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(dados.error || 'O Servidor DoixP não recebeu a leitura NFC');
  return dados as NfcEvento;
}

function entregar(evento: NfcEvento) {
  window.dispatchEvent(new CustomEvent(NFC_EVENTO, { detail: evento }));
}

export function useNfcBridge(onLeitura: (evento: NfcEvento) => void) {
  const callbackRef = useRef(onLeitura);
  const vistos = useRef(new Set<number>());
  const localRef = useRef<NfcLocal>({ ativo: false, prefixo: 'NFC:' });

  useEffect(() => {
    callbackRef.current = onLeitura;
  }, [onLeitura]);

  useEffect(() => {
    const aoLer = (event: Event) => {
      const detalhe = (event as CustomEvent<NfcEvento>).detail;
      if (!detalhe?.id || vistos.current.has(detalhe.id)) return;
      vistos.current.add(detalhe.id);
      callbackRef.current(detalhe);
    };
    window.addEventListener(NFC_EVENTO, aoLer);
    return () => window.removeEventListener(NFC_EVENTO, aoLer);
  }, []);

  useEffect(() => {
    let ativo = true;
    const consultarLocal = async () => {
      try {
        const resposta = await fetch(`${CUPS_SERVER}/nfc`);
        if (!resposta.ok) throw new Error('offline');
        const dados = await resposta.json();
        if (ativo) localRef.current = { ativo: !!dados.ativo, prefixo: String(dados.prefixo || 'NFC:') };
      } catch {
        if (ativo) localRef.current = { ativo: false, prefixo: 'NFC:' };
      }
    };
    const consultarNuvem = async () => {
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
      try {
        const pendentes = await nfcApi.pendentes();
        for (const evento of pendentes) {
          if (vistos.current.has(evento.id)) continue;
          try {
            const consumido = await nfcApi.consumir(evento.id);
            entregar(consumido);
          } catch (error: any) {
            if (error?.status !== 409) break;
          }
        }
      } catch {
        /* a sessão ou a rede podem falhar sem interromper o PDV */
      }
    };
    consultarLocal();
    consultarNuvem();
    const local = setInterval(consultarLocal, 5000);
    const nuvem = setInterval(consultarNuvem, 2000);
    return () => {
      ativo = false;
      clearInterval(local);
      clearInterval(nuvem);
    };
  }, []);

  useEffect(() => {
    let buffer = '';
    let ultima = 0;
    const aoPressionar = (event: KeyboardEvent) => {
      const ponte = localRef.current;
      if (!ponte.ativo || !ponte.prefixo || editavel(event.target) || event.ctrlKey || event.altKey || event.metaKey) {
        buffer = '';
        return;
      }
      const agora = Date.now();
      if (ultima && agora - ultima > 120) buffer = '';
      ultima = agora;
      if (event.key === 'Enter') {
        const texto = buffer;
        buffer = '';
        if (!texto.startsWith(ponte.prefixo) || texto.length <= ponte.prefixo.length) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        publicarLocal(texto)
          .then(async (evento) => {
            try {
              const consumido = await nfcApi.consumir(evento.id);
              entregar(consumido);
            } catch (error: any) {
              if (error?.status !== 409) throw error;
            }
          })
          .catch((error: any) => {
            window.dispatchEvent(new CustomEvent('simplexsa:nfc-erro', { detail: error?.message || 'Falha na ponte NFC' }));
          });
        return;
      }
      if (event.key.length !== 1) return;
      buffer += event.key;
      if (ponte.prefixo.startsWith(buffer) || buffer.startsWith(ponte.prefixo)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      } else {
        buffer = '';
      }
    };
    window.addEventListener('keydown', aoPressionar, true);
    return () => window.removeEventListener('keydown', aoPressionar, true);
  }, []);
}
