/**
 * Arquivo: NfcBridge.tsx
 * Responsabilidade: Mantém a ponte NFC ativa enquanto a sessão do estabelecimento está aberta.
 */

import { useEffect } from 'react';
import { useToast } from '@/components/ui';
import { NFC_TESTE_EVENTO, useNfcBridge } from '@/lib/useNfcBridge';
import type { NfcEvento } from '@/lib/api';

export function NfcBridge() {
  const toast = useToast();
  useNfcBridge((evento) => {
    const codigo = evento.uid || evento.payload;
    toast('success', codigo ? `NFC lido: ${codigo}` : 'NFC lido');
  });
  useEffect(() => {
    const aoTestar = (event: Event) => {
      const leitura = (event as CustomEvent<NfcEvento>).detail;
      toast('success', `Teste NFC recebido: ${leitura.uid}. Leitor e conexão com esta tela funcionando.`);
    };
    const aoFalhar = (event: Event) => {
      toast('error', String((event as CustomEvent<string>).detail || 'Falha na ponte NFC'));
    };
    const aoEsperar = () => toast('info', 'Cartão lido. Abra Adicionar com cartão, Lançar para cartão ou Fechamento de cartão.');
    window.addEventListener('simplexsa:nfc-sem-espera', aoEsperar);
    window.addEventListener('simplexsa:nfc-erro', aoFalhar);
    window.addEventListener(NFC_TESTE_EVENTO, aoTestar);
    return () => {
      window.removeEventListener('simplexsa:nfc-sem-espera', aoEsperar);
      window.removeEventListener('simplexsa:nfc-erro', aoFalhar);
      window.removeEventListener(NFC_TESTE_EVENTO, aoTestar);
    };
  }, [toast]);
  return null;
}
