import { Bike, BookOpen } from 'lucide-react';
import { useState } from 'react';
import { onlineApi } from '@/lib/api';
import type { OnlineStore } from '@/lib/types';

export function ModoCardapioOnline({
  aceitaPedidos, disabled = false, onChange,
}: {
  aceitaPedidos: boolean;
  disabled?: boolean;
  onChange: (aceitaPedidos: boolean) => void;
}) {
  return <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Funcionamento do cardápio online">
    {[
      { pedidos: true, label: 'Delivery', description: 'Receba pedidos de entrega ou retirada pelo site.', Icon: Bike },
      { pedidos: false, label: 'Apenas cardápio online', description: 'Mostre produtos, fotos e preços pelo seu link, sem sacola nem pedidos.', Icon: BookOpen },
    ].map(({ pedidos, label, description, Icon }) => <button
      key={label}
      type="button"
      aria-pressed={aceitaPedidos === pedidos}
      disabled={disabled}
      onClick={() => onChange(pedidos)}
      className={`rounded-xl border p-3 text-left text-sm transition-colors disabled:opacity-50 ${aceitaPedidos === pedidos ? 'border-brand-700 bg-brand-50 text-brand-800' : 'border-slate-200 bg-white text-slate-700'}`}
    >
      <b className="flex items-center gap-2"><Icon className="h-4 w-4 shrink-0" aria-hidden="true" />{label}</b>
      <span className="mt-1 block text-xs font-normal text-slate-500">{description}</span>
    </button>)}
  </div>;
}

export function ConfiguracaoCardapioOnline({ loja, onSaved }: { loja: OnlineStore; onSaved: (loja: OnlineStore) => void }) {
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const aceitaPedidos = loja.aceita_pedidos_online !== 0;
  const alterar = async (pedidos: boolean) => {
    if (salvando || pedidos === aceitaPedidos) return;
    setSalvando(true);
    setErro('');
    try {
      onSaved(await onlineApi.updateStore({ aceita_pedidos_online: pedidos ? 1 : 0 }));
    } catch (error: any) {
      setErro(error?.error || 'Não foi possível salvar o modo do cardápio.');
    } finally {
      setSalvando(false);
    }
  };
  return <div className="space-y-3">
    <h3 className="font-bold text-slate-800">Como você quer usar o cardápio?</h3>
    <ModoCardapioOnline aceitaPedidos={aceitaPedidos} disabled={salvando} onChange={alterar} />
    <p className="text-xs text-slate-500" role="status">{salvando ? 'Salvando…' : aceitaPedidos
      ? 'Os clientes podem montar a sacola e enviar pedidos pelo site.'
      : 'Seu link mostra o cardápio para consulta. A loja fica fora da vitrine do DoixP Delivery.'}</p>
    {!loja.ativo && <p className="text-xs text-slate-500">Publique a loja para liberar o acesso dos clientes ao link.</p>}
    {erro && <p className="text-sm text-red-600" role="alert">{erro}</p>}
  </div>;
}
