import { useEffect, useState } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import { Button, Field, Modal, Select, Spinner } from '@/components/ui';
import { comandaApi, mesaApi } from '@/lib/api';
import type { Comanda, ComandaItem, Mesa } from '@/lib/types';
import { fmtBRL, fmtNum } from '@/lib/format';

export function TransferItemModal({ item, source, initialMode, busy, onClose, onTransfer }: {
  item: ComandaItem; source: Comanda; initialMode: 'pessoa' | 'mesa'; busy: boolean;
  onClose: () => void;
  onTransfer: (item: ComandaItem, mesaId: number, comandaId: number | null, pessoaId: number | null) => Promise<boolean>;
}) {
  const [mode, setMode] = useState(initialMode);
  const [tables, setTables] = useState<Mesa[]>([]);
  const [commands, setCommands] = useState<Comanda[]>([]);
  const [tableId, setTableId] = useState('');
  const [personId, setPersonId] = useState('');
  const [destination, setDestination] = useState<Comanda | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingDestination, setLoadingDestination] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (mode !== 'mesa') return;
    let cancelled = false;
    setLoading(true); setError('');
    mesaApi.list().then((data) => {
      if (cancelled) return;
      setTables(data.mesas.filter((m) => m.ativo && m.tipo !== 'pagamentos' && m.id !== source.mesa_id));
      setCommands(data.comandas);
    }).catch((e) => { if (!cancelled) setError(e?.error || 'Não foi possível carregar as mesas'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [mode, source.mesa_id, retry]);

  useEffect(() => {
    let cancelled = false;
    setDestination(null); setPersonId('');
    const command = commands.find((c) => c.mesa_id === Number(tableId));
    if (mode !== 'mesa' || !command) { setLoadingDestination(false); return; }
    setLoadingDestination(true); setError('');
    comandaApi.get(command.id).then((data) => {
      if (cancelled) return;
      if (data.status !== 'aberta') throw new Error('A mesa está em pagamento. Escolha outra mesa.');
      setDestination(data);
    }).catch((e) => { if (!cancelled) setError(e?.error || e?.message || 'Não foi possível carregar as pessoas'); })
      .finally(() => { if (!cancelled) setLoadingDestination(false); });
    return () => { cancelled = true; };
  }, [mode, tableId, commands]);

  const currentCommand = mode === 'pessoa' ? source : destination;
  const person = personId ? Number(personId) : null;
  const samePerson = mode === 'pessoa' && person === item.pessoa_id;
  const selectedTable = tables.find((m) => m.id === Number(tableId));
  const existing = commands.find((c) => c.mesa_id === Number(tableId));
  const ready = mode === 'pessoa' ? !samePerson : !!selectedTable && (!existing || !!destination) && !error;

  return (
    <Modal open onClose={() => { if (!busy) onClose(); }} title="Transferir pedido">
      <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault();
        if (!ready || busy || loading || loadingDestination) return;
        await onTransfer(item, mode === 'pessoa' ? source.mesa_id : Number(tableId), currentCommand?.id ?? null, person);
      }}>
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="font-bold text-slate-800">{fmtNum(item.quantidade)} × {item.nome}</p>
          <p className="text-sm text-slate-500">{fmtBRL(item.quantidade * item.preco_unitario)} · {item.status}</p>
          <p className="mt-1 text-xs text-slate-500">O lançamento mantém suas observações, valor e status de preparo.</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" disabled={busy} variant={mode === 'pessoa' ? 'primary' : 'secondary'} onClick={() => { setMode('pessoa'); setPersonId(''); setError(''); }}>Outra pessoa</Button>
          <Button type="button" disabled={busy} variant={mode === 'mesa' ? 'primary' : 'secondary'} onClick={() => { setMode('mesa'); setPersonId(''); }}>Outra mesa</Button>
        </div>
        {mode === 'mesa' && (loading ? <Spinner label="Carregando mesas..." /> : <Field label="Mesa de destino">
          <Select aria-label="Mesa de destino" value={tableId} disabled={busy} onChange={(e) => { setTableId(e.target.value); setDestination(null); setPersonId(''); setError(''); setLoadingDestination(!!commands.find((c) => c.mesa_id === Number(e.target.value))); }}>
            <option value="">Selecione a mesa</option>
            {tables.map((m) => {
              const cs = commands.filter((c) => c.mesa_id === m.id);
              const blocked = cs.length > 1 || cs.some((c) => c.status !== 'aberta') || (!cs.length && m.status !== 'livre');
              return <option key={m.id} value={m.id} disabled={blocked}>{m.nome || `Mesa ${m.numero}`} · {blocked ? 'indisponível' : cs.length ? 'aberta' : 'livre'}</option>;
            })}
          </Select>
          {tables.length === 0 && <p className="mt-1 text-sm text-slate-500">Nenhuma outra mesa cadastrada.</p>}
        </Field>)}
        {error && <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}<Button type="button" size="sm" variant="secondary" className="ml-2" onClick={() => setRetry((v) => v + 1)}>Atualizar mesas</Button></div>}
        {loadingDestination ? <Spinner label="Carregando pessoas..." /> : (mode === 'pessoa' || selectedTable) && <Field label="Pessoa de destino">
          <Select aria-label="Pessoa de destino" value={personId} disabled={busy || (mode === 'mesa' && !!existing && !destination)} onChange={(e) => setPersonId(e.target.value)}>
            <option value="" disabled={mode === 'pessoa' && item.pessoa_id === null}>Conta geral{mode === 'pessoa' && item.pessoa_id === null ? ' (atual)' : ''}</option>
            {currentCommand?.pessoas.filter((p) => p.status !== 'baixado').map((p, index) => <option key={p.id} value={p.id} disabled={mode === 'pessoa' && p.id === item.pessoa_id}>{p.nome || `Pessoa ${index + 1}`}{mode === 'pessoa' && p.id === item.pessoa_id ? ' (atual)' : ''}</option>)}
          </Select>
        </Field>}
        {mode === 'mesa' && selectedTable && !existing && <p className="text-sm text-slate-500">A mesa será aberta e receberá o pedido na conta geral.</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Cancelar</Button>
          <Button type="submit" icon={<ArrowRightLeft className="h-4 w-4" />} loading={busy} disabled={!ready || loading || loadingDestination || busy}>Transferir pedido</Button>
        </div>
      </form>
    </Modal>
  );
}
