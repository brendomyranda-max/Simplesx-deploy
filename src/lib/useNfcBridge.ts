/**
 * Arquivo: useNfcBridge.ts
 * Responsabilidade: Recebe leituras NFC do Gestor e entrega uma só vez ao terminal em foco.
 */

import { useEffect, useRef } from 'react';
import { CUPS_SERVER } from '@/lib/cupsPrint';
import { nfcApi, type NfcEvento } from '@/lib/api';
import { createNfcDelivery, type AndroidNfcReading } from './nfcDelivery';

export const NFC_EVENTO = 'simplexsa:nfc';
export const NFC_TESTE_EVENTO = 'simplexsa:nfc-teste';
const NFC_ESPERA = 'simplexsa:nfc-espera';
let receptores = 0;
let esperaAtual = 0;
declare global { interface Window { __doixpAndroidNfc?: AndroidNfcReading } }

// Registra a espera real, para a ponte não descartar uma leitura no dashboard.
export function useNfcLeitura(ativo: boolean, onLeitura: (evento: NfcEvento) => void, continuo = false) {
  const callback = useRef(onLeitura);
  callback.current = onLeitura;
  useEffect(() => {
    if (!ativo) return;
    let esperando = true;
    const retirar = () => {
      if (!esperando) return;
      esperando = false;
      receptores--;
      esperaAtual++;
      window.removeEventListener(NFC_EVENTO, aoLer);
    };
    const aoLer = (event: Event) => {
      if (!continuo) retirar();
      callback.current((event as CustomEvent<NfcEvento>).detail);
    };
    window.addEventListener(NFC_EVENTO, aoLer);
    receptores++;
    esperaAtual++;
    window.dispatchEvent(new Event(NFC_ESPERA));
    return retirar;
  }, [ativo, continuo]);
}

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
  const tipo = evento.origem === 'android-teste' ? NFC_TESTE_EVENTO : NFC_EVENTO;
  window.dispatchEvent(new CustomEvent(tipo, { detail: evento }));
}

export function useNfcBridge(onLeitura: (evento: NfcEvento) => void) {
  const callbackRef = useRef(onLeitura);
  const vistos = useRef(new Set<number>());
  const localRef = useRef<NfcLocal>({ ativo: false, prefixo: 'NFC:' });
  const deliveryRef = useRef<ReturnType<typeof createNfcDelivery> | null>(null);

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
    let consultando = false;
    let ultimaConsultaSemEspera = -Infinity;
    const delivery = createNfcDelivery({
      ready: () => receptores > 0,
      request: () => esperaAtual,
      visible: () => document.visibilityState === 'visible',
      identify: nfcApi.identificar,
      consume: nfcApi.consumir,
      deliver: entregar,
      error: (message) => window.dispatchEvent(new CustomEvent('simplexsa:nfc-erro', { detail: message })),
      pending: () => window.dispatchEvent(new Event('simplexsa:nfc-sem-espera')),
    });
    deliveryRef.current = delivery;
    const aoLerAndroid = (event?: Event) => {
      const reading = (event as CustomEvent<AndroidNfcReading> | undefined)?.detail || window.__doixpAndroidNfc;
      if (reading) void delivery.receiveNative(reading);
    };
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
      if (!ativo || consultando || document.visibilityState !== 'visible' || !document.hasFocus()) return;
      if (receptores === 0) {
        if (Date.now() - ultimaConsultaSemEspera < 15000) return;
        ultimaConsultaSemEspera = Date.now();
      }
      consultando = true;
      try {
        const pendentes = await nfcApi.pendentes();
        if (ativo && document.hasFocus()) await delivery.receiveCloud(pendentes);
      } catch {
        /* a sessão ou a rede podem falhar sem interromper o PDV */
      } finally {
        consultando = false;
      }
    };
    consultarLocal();
    consultarNuvem();
    aoLerAndroid();
    const aoEsperar = () => { void delivery.flushNative(); void consultarNuvem(); };
    window.addEventListener('doixp:android-nfc', aoLerAndroid);
    window.addEventListener(NFC_ESPERA, aoEsperar);
    document.addEventListener('visibilitychange', aoEsperar);
    const local = setInterval(consultarLocal, 5000);
    const nuvem = setInterval(consultarNuvem, 2000);
    return () => {
      ativo = false;
      delivery.dispose();
      deliveryRef.current = null;
      window.removeEventListener('doixp:android-nfc', aoLerAndroid);
      window.removeEventListener(NFC_ESPERA, aoEsperar);
      document.removeEventListener('visibilitychange', aoEsperar);
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
          .then((evento) => deliveryRef.current?.receiveCloud([evento]))
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
