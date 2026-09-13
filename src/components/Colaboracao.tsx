import { useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Heart } from 'lucide-react';
import { authApi } from '@/lib/api';
import { Button, Field, Input, useToast } from '@/components/ui';

export function Colaboracao() {
  const [aberto, setAberto] = useState(false);
  const [pix, setPix] = useState('');
  const [qr, setQr] = useState('');
  const [estado, setEstado] = useState('');
  const [valor, setValor] = useState('10,00');
  const [recebedor, setRecebedor] = useState('');
  const [loading, setLoading] = useState(false);
  const tentativa = useRef(0);
  const toast = useToast();
  const limpar = () => { tentativa.current++; setPix(''); setQr(''); setEstado(''); setLoading(false); };
  const gerar = async (event: React.FormEvent) => {
    event.preventDefault();
    limpar();
    const id = tentativa.current;
    setLoading(true);
    try {
      const resposta = await authApi.colaboracao(valor);
      const imagem = await QRCode.toDataURL(resposta.pix_copia_cola, { width: 280, margin: 4 });
      if (tentativa.current !== id) return;
      setPix(resposta.pix_copia_cola);
      setQr(imagem);
      setRecebedor(resposta.recebedor);
    } catch (error: any) {
      if (tentativa.current === id) setEstado(error?.error || 'Não foi possível gerar o Pix. Tente novamente.');
    } finally {
      if (tentativa.current === id) setLoading(false);
    }
  };
  return <div className="card mt-4 p-4 text-center">
    <button type="button" aria-expanded={aberto} onClick={() => { limpar(); setAberto(!aberto); }} className="inline-flex items-center gap-2 font-semibold text-brand-700"><Heart className="h-4 w-4" /> Quero colaborar com o SimplesX</button>
    <p className="mt-2 text-xs text-slate-500">Contribuição voluntária. Você pode criar sua conta e usar o sistema sem contribuir.</p>
    {aberto && <div className="mt-3">
      <form onSubmit={gerar} className="space-y-3 text-left">
        <Field label="Valor da contribuição (R$)"><Input required inputMode="decimal" placeholder="10,00" maxLength={9} value={valor} onChange={(e) => { limpar(); setValor(e.target.value); }} /></Field>
        <Button type="submit" loading={loading} className="w-full">Gerar QR Code Pix</Button>
      </form>
      {estado && <p role="status" className="text-sm text-slate-600">{estado}</p>}
      {qr && <img src={qr} alt="QR Code Pix para contribuição voluntária ao SimplesX" width={280} height={280} className="mx-auto max-w-full" />}
      {pix && <><p className="mt-2 text-sm font-semibold text-slate-700">Recebedor: {recebedor}</p><p className="mb-3 text-sm text-slate-600">Escaneie com o aplicativo do seu banco ou copie o código Pix. Confira o recebedor antes de confirmar.</p><textarea readOnly aria-label="Pix Copia e Cola" value={pix} className="mb-3 w-full rounded-lg border p-2 text-xs" /><Button type="button" variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(pix); toast('success', 'Código Pix copiado'); } catch { toast('error', 'Selecione e copie o código acima'); } }}>Copiar código Pix</Button></>}
    </div>}
  </div>;
}
