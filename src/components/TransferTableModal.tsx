import { useEffect, useRef, useState } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import { Button, Field, Modal, Select, Spinner } from '@/components/ui';
import { mesaApi, type TableTransferSubmission } from '@/lib/api';
import type { Comanda, Mesa } from '@/lib/types';
import { fmtBRL, fmtNum } from '@/lib/format';

export function TransferTableModal({ source, busy, onClose, onTransfer }: {
  source: Comanda; busy: boolean; onClose: () => void;
  onTransfer: (body: TableTransferSubmission) => Promise<boolean>;
}) {
  const [tables, setTables] = useState<Mesa[]>([]);
  const [commands, setCommands] = useState<Comanda[]>([]);
  const [tableId, setTableId] = useState('');
  const [release, setRelease] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [pending, setPending] = useState(false);
  const intent = useRef<TableTransferSubmission | null>(null);
  const items = source.itens.filter((i) => ['novo', 'enviado', 'entregue'].includes(i.status));
  const hasLoss = source.itens.some((i) => i.status !== 'cancelado' && !['novo', 'enviado', 'entregue'].includes(i.status));
  const units = items.reduce((sum, i) => sum + Number(i.quantidade), 0);
  const total = items.reduce((sum, i) => sum + i.quantidade * i.preco_unitario, 0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(''); setTableId('');
    mesaApi.list().then((data) => {
      if (cancelled) return;
      setTables(data.mesas.filter((m) => m.ativo && (m.tipo || 'normal') === 'normal' && m.id !== source.mesa_id));
      setCommands(data.comandas);
    }).catch((e) => { if (!cancelled) setError(e?.error || 'Não foi possível carregar as mesas'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [source.mesa_id, retry]);
  const destinations = commands.filter((c) => c.mesa_id === Number(tableId));
  const table = tables.find((m) => m.id === Number(tableId));
  const ready = !!table && (destinations.length === 1 ? destinations[0].status === 'aberta' : destinations.length === 0 && table.status === 'livre');

  return <Modal open title="Transferir todos os produtos" onClose={() => { if (!busy && !pending) onClose(); }}>
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      if (busy || loading || (!intent.current && !ready)) return;
      intent.current ||= { chave: crypto.randomUUID(), mesa_destino_id: Number(tableId), comanda_destino_id: destinations[0]?.id ?? null,
        liberar_origem: release, itens: items.map((i) => ({ id: i.id, versao: i.versao })) };
      setPending(true);
      await onTransfer(intent.current);
    }}>
      <div className="rounded-xl bg-slate-50 p-3 text-sm">
        <p className="font-bold text-slate-800">{source.mesa?.nome || `Mesa ${source.mesa_id}`} → outra mesa</p>
        <p className="mt-1 text-slate-600">{items.length} lançamentos · {fmtNum(units)} unidades · {fmtBRL(total)} em produtos</p>
      </div>
      <p className="text-sm text-slate-600">Todos os pedidos ativos serão movidos juntos, mantendo valores, observações, status de preparo e a separação por pessoa. Os produtos já existentes no destino serão mantidos.</p>
      {loading ? <Spinner label="Carregando mesas..." /> : <Field label="Mesa de destino">
        <Select aria-label="Mesa de destino" value={tableId} disabled={busy || pending} onChange={(e) => setTableId(e.target.value)}>
          <option value="">Selecione a mesa</option>
          {tables.map((m) => {
            const cs = commands.filter((c) => c.mesa_id === m.id);
            const blocked = cs.length > 1 || cs.some((c) => c.status !== 'aberta') || (!cs.length && m.status !== 'livre');
            return <option key={m.id} value={m.id} disabled={blocked}>{m.nome || `Mesa ${m.numero}`} · {blocked ? 'indisponível' : cs.length ? 'aberta' : 'livre'}</option>;
          })}
        </Select>
        {!tables.length && !error && <p className="mt-1 text-sm text-slate-500">Nenhuma outra mesa do salão cadastrada.</p>}
      </Field>}
      {error && <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}<Button type="button" size="sm" variant="secondary" onClick={() => setRetry((v) => v + 1)}>Atualizar mesas</Button></div>}
      {table && !destinations.length && <p className="text-sm text-slate-500">A mesa de destino será aberta com a taxa de serviço da origem. Em uma mesa já aberta, vale a taxa do destino.</p>}
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" className="mt-1" checked={release} disabled={busy || pending || hasLoss} onChange={(e) => setRelease(e.target.checked)} />
        <span>Liberar mesa de origem após transferir<span className="mt-1 block text-xs text-slate-500">{hasLoss ? 'Há registros de perda na origem. A mesa precisará continuar aberta para conferência.' : 'Sem marcar, a mesa de origem continuará aberta. Não será registrado pagamento.'}</span></span>
      </label>
      {pending && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{busy ? 'Confirmando a transferência…' : 'Confirmação pendente. Tente novamente para consultar ou concluir a mesma transferência, sem duplicar.'}</p>}
      <p className="text-xs text-slate-500">Itens cancelados e registros de perda permanecem no histórico da origem. A transferência não imprime novamente nem movimenta o estoque.</p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" disabled={busy || pending} onClick={onClose}>Cancelar</Button>
        <Button type="submit" icon={<ArrowRightLeft className="h-4 w-4" />} loading={busy} disabled={busy || loading || (!pending && !ready)}>{pending && !busy ? 'Tentar novamente' : 'Transferir todos'}</Button>
      </div>
    </form>
  </Modal>;
}
