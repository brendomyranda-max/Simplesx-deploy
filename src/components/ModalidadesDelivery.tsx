export function ModalidadesDelivery({ entrega, retirada, onChange, disabled = false }: {
  entrega: boolean;
  retirada: boolean;
  onChange: (modalidades: { entrega: boolean; retirada: boolean }) => void;
  disabled?: boolean;
}) {
  return <div className="space-y-2">
    <label className="block text-sm font-semibold text-slate-700">Como o cliente recebe o pedido
      <select required aria-label="Como o cliente recebe o pedido" disabled={disabled}
        className="mt-2 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
        value={entrega ? (retirada ? 'ambos' : 'entrega') : retirada ? 'retirada' : ''}
        onChange={(event) => onChange({ entrega: event.target.value !== 'retirada', retirada: event.target.value !== 'entrega' })}>
        <option value="" disabled>Selecione uma opção</option>
        <option value="ambos">Entrega e retirada</option>
        <option value="retirada">Somente retirada</option>
        <option value="entrega">Somente entrega</option>
      </select>
    </label>
    {!entrega && retirada && <p className="text-sm text-slate-500">O cliente retira o pedido no estabelecimento, sem taxa de entrega.</p>}
  </div>;
}
