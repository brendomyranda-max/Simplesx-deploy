/**
 * Arquivo: NfcBridge.tsx
 * Responsabilidade: Mantém a ponte NFC ativa enquanto a sessão do estabelecimento está aberta.
 */

import { useEffect } from 'react';
import { useToast } from '@/components/ui';
import { useNfcBridge } from '@/lib/useNfcBridge';

export function NfcBridge() {
  const toast = useToast();
  useNfcBridge((evento) => {
    const codigo = evento.payload || evento.uid;
    toast('success', codigo ? `NFC lido: ${codigo}` : 'NFC lido');
  });
  useEffect(() => {
    const aoFalhar = (event: Event) => {
      toast('error', String((event as CustomEvent<string>).detail || 'Falha na ponte NFC'));
    };
    window.addEventListener('simplexsa:nfc-erro', aoFalhar);
    return () => window.removeEventListener('simplexsa:nfc-erro', aoFalhar);
  }, [toast]);
  return null;
}
