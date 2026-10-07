import { useEffect, useRef, useState } from 'react';
import { Printer } from 'lucide-react';
import { Button, Field, Select } from '@/components/ui';
import { deviceApi, type DevicePrinter, type DeviceTask, type PrintDevice } from '@/lib/api';

const terminal = (task: DeviceTask) => ['success', 'failed', 'cancelled'].includes(task.status);
const connectionName = (value?: string) => ({ bluetooth: 'Bluetooth', network: 'Rede', usb: 'USB' }[value || ''] || value || '');

export function DevicePrinterTest({ device }: { device: PrintDevice }) {
  const [printerName, setPrinterName] = useState('');
  const [task, setTask] = useState<DeviceTask | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [readError, setReadError] = useState('');
  const attempt = useRef<{ printer: DevicePrinter; key: string } | null>(null);
  const sendingRef = useRef(false);
  const mounted = useRef(true);
  const printers = device.printers || [];
  const selected = printers.find((printer) => printer.name === printerName);
  const pending = !!task && !terminal(task);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!printerName && printers.length === 1) setPrinterName(printers[0].name);
  }, [printerName, printers]);

  useEffect(() => {
    if (!task || terminal(task)) return;
    const taskId = task.id;
    let stopped = false;
    let timer: number;
    const check = async () => {
      try {
        const result = await deviceApi.task(taskId);
        if (stopped) return;
        setTask(result);
        setReadError('');
        if (terminal(result)) return;
      } catch (error: any) {
        if (stopped) return;
        setReadError(error?.error || 'Não foi possível consultar o resultado');
      }
      if (!stopped) timer = window.setTimeout(check, 2000);
    };
    timer = window.setTimeout(check, 1000);
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [task?.id, task?.status]);

  const send = async () => {
    if (!selected || sendingRef.current || pending || !device.online) return;
    sendingRef.current = true;
    setSending(true);
    setSendError('');
    setReadError('');
    setTask(null);
    // Uma resposta perdida é consultada com a mesma chave, sem criar outro teste.
    attempt.current ??= { printer: selected, key: `android-test-${device.id}-${crypto.randomUUID()}` };
    try {
      const result = await deviceApi.test(device.id, attempt.current.printer, attempt.current.key);
      attempt.current = null;
      if (mounted.current) setTask(result.task);
    } catch (error: any) {
      if (error?.status >= 400 && error?.status < 500 && error.status !== 408) attempt.current = null;
      if (mounted.current) setSendError(error?.error || 'Não foi possível confirmar o envio');
    } finally {
      sendingRef.current = false;
      if (mounted.current) setSending(false);
    }
  };

  let result = '';
  if (task?.status === 'pending') result = `Teste na fila para ${printerName}. Aguardando o Gestor Android.`;
  if (task?.status === 'sent') result = `Teste recebido pelo Gestor Android para ${printerName}.`;
  if (task?.status === 'processing') result = `Gestor Android está imprimindo em ${printerName}…`;
  if (task?.status === 'success') result = `Gestor confirmou o envio para ${printerName}. Confira o teste no papel.`;
  if (task?.status === 'failed') result = `Falha no teste: ${task.erro_mensagem || 'O Gestor não conseguiu imprimir.'}`;
  if (task?.status === 'cancelled') result = 'Teste cancelado.';

  return (
    <div className="w-full space-y-2 rounded-lg bg-slate-50 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <Field label="Impressora para o teste">
            <Select aria-label={`Impressora para testar em ${device.nome}`} value={printerName}
              disabled={sending || pending || !!attempt.current || printers.length === 0}
              onChange={(event) => { setPrinterName(event.target.value); setTask(null); setSendError(''); setReadError(''); }}>
              <option value="">{printers.length ? 'Selecione a impressora' : 'Nenhuma impressora sincronizada'}</option>
              {printerName && !selected && <option value={printerName}>{printerName} (não sincronizada)</option>}
              {printers.map((printer) => <option key={printer.name} value={printer.name}>{printer.name} · {connectionName(printer.connection)}</option>)}
            </Select>
          </Field>
        </div>
        <Button size="sm" variant="secondary" icon={<Printer className="h-3.5 w-3.5" />} onClick={send}
          disabled={!selected || !device.online || pending} loading={sending}>
          {pending ? 'Aguardando resultado…' : sendError ? 'Verificar envio' : 'Testar impressora'}
        </Button>
      </div>
      {!device.online && <p className="text-xs text-amber-700">Abra o Gestor Android e ative Receber impressões para realizar o teste.</p>}
      {!printers.length && <p className="text-xs text-slate-500">Salve a impressora no Gestor Android e aguarde a sincronização.</p>}
      {result && <p role="status" className={`text-sm ${task?.status === 'failed' || task?.status === 'cancelled' ? 'text-red-700' : task?.status === 'success' ? 'text-emerald-700' : 'text-slate-700'}`}>{result}</p>}
      {sendError && <p role="alert" className="text-sm text-red-700">Envio não confirmado: {sendError}. Use Verificar envio para consultar ou concluir este mesmo teste.</p>}
      {readError && <p role="alert" className="text-sm text-amber-700">{readError}. O resultado ainda não foi confirmado; a consulta será repetida.</p>}
    </div>
  );
}
