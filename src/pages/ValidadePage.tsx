import { useEffect, useRef, useState } from 'react';
import { CalendarClock, Plus, Printer, Search, ScanBarcode, CheckCircle2, Trash2 } from 'lucide-react';
import { AnimatedPage } from '@/components/anim';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Spinner, Tabs, useToast } from '@/components/ui';
import { validadeApi, produtoApi, impressoraApi } from '@/lib/api';
import type { ValidadeControle, Produto } from '@/lib/types';
import { fmtData, fmtNum, diasAte, hojeLocal } from '@/lib/format';
import { printReceipt } from '@/lib/print';

export function ValidadePage() {
  const [tab, setTab] = useState<'ativos' | 'todos'>('ativos');
  const [controles, setControles] = useState<ValidadeControle[]>([]);
  const [load, setLoad] = useState(true);
  const [abrir, setAbrir] = useState(false);
  const [produto, setProduto] = useState<Produto | null>(null);
  const [codigo, setCodigo] = useState('');
  const [nEncontrado, setNEncontrado] = useState(false);
  const [qtd, setQtd] = useState('1');
  const [dataAbertura, setDataAbertura] = useState(hojeLocal());
  const [dataVencimento, setDataVencimento] = useState('');
  const [diasAberto, setDiasAberto] = useState('');
  const [temperatura, setTemperatura] = useState('');
  const [responsavel, setResponsavel] = useState('');
  const [obs, setObs] = useState('');
  const [etiqueta, setEtiqueta] = useState<{ impressao: string; etiqueta: any } | null>(null);
  const [imprimindo, setImprimindo] = useState(false);
  const toast = useToast();
  const printRef = useRef<HTMLDivElement>(null);

  const loadList = async () => {
    setLoad(true);
    try {
      const rows = await validadeApi.list(tab === 'ativos' ? { status: 'ativo' } : {});
      setControles(rows);
    } catch (e: any) {
      toast('error', e?.error || 'Erro ao carregar');
    } finally {
      setLoad(false);
    }
  };

  useEffect(() => {
    loadList();
  }, [tab]);

  const buscar = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!codigo.trim()) return;
    try {
      const p = await produtoApi.buscar(codigo.trim());
      setProduto(p);
      setNEncontrado(false);
      setDiasAberto(p.validade_aberto_dias ? String(p.validade_aberto_dias) : '');
      setTemperatura(p.temperatura || '');
    } catch {
      setProduto(null);
      setNEncontrado(true);
    }
  };

  const criar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!produto) return;
    try {
      const novo = await validadeApi.criar({
        produto_id: produto.id,
        quantidade: Number(qtd || 1),
        tipo: 'aberto',
        data_abertura: dataAbertura,
        data_vencimento: dataVencimento || undefined,
        validade_aberto_dias: diasAberto ? Number(diasAberto) : undefined,
        temperatura: temperatura || undefined,
        responsavel: responsavel || undefined,
        observacoes: obs || undefined,
      });
      toast('success', `Validade registrada. Vence em ${novo.data_vencimento}`);
      setAbrir(false);
      setProduto(null);
      setCodigo('');
      setDiasAberto('');
      setDataVencimento('');
      setQtd('1');
      loadList();
    } catch (err: any) {
      toast('error', err?.error || 'Erro ao registrar');
    }
  };

  const imprimir = async (id: number) => {
    setImprimindo(true);
    try {
      const r = await impressoraApi.imprimirEtiqueta(id);
      setEtiqueta(r);
    } catch (e: any) {
      toast('error', e?.error || 'Erro ao gerar etiqueta');
    } finally {
      setImprimindo(false);
    }
  };

  const statusBadge = (v: ValidadeControle) => {
    const d = diasAte(v.data_vencimento);
    if (v.status !== 'ativo') return <Badge color="slate">{v.status}</Badge>;
    if (d !== null && d < 0) return <Badge color="red">Vencido há {-d}d</Badge>;
    if (d === 0) return <Badge color="red">Vence hoje</Badge>;
    if (d !== null && d <= 3) return <Badge color="amber">Vence em {d}d</Badge>;
    return <Badge color="green">Vence em {d}d</Badge>;
  };

  return (
    <AnimatedPage>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-800">Controle de Validade</h1>
          <p className="text-sm text-slate-500">Produtos abertos, fabricação e etiquetas de validade</p>
        </div>
        <div className="flex items-center gap-2">
          <Tabs
            value={tab}
            onChange={(v) => setTab(v as 'ativos' | 'todos')}
            tabs={[
              { value: 'ativos', label: 'Ativos' },
              { value: 'todos', label: 'Todos' },
            ]}
          />
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setAbrir(true)}>Nova validade</Button>
        </div>
      </div>

      {load ? (
        <Spinner />
      ) : controles.length === 0 ? (
        <Card>
          <EmptyState icon={<CalendarClock className="h-8 w-8" />} title="Nenhum controle de validade" subtitle="Abra um produto para gerar o vencimento e a etiqueta" />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Produto</th>
                  <th className="th">Qtd</th>
                  <th className="th">Abertura</th>
                  <th className="th">Vencimento</th>
                  <th className="th">Temperatura</th>
                  <th className="th">Responsável</th>
                  <th className="th">Status</th>
                  <th className="th text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {controles.map((v) => (
                  <tr key={v.id} className="hover:bg-slate-50/60">
                    <td className="td font-semibold text-slate-800">{v.produto_nome}</td>
                    <td className="td">{fmtNum(v.quantidade)} {v.unidade}</td>
                    <td className="td">{fmtData(v.data_abertura)}</td>
                    <td className="td font-semibold">{v.data_vencimento}</td>
                    <td className="td">
                      <Badge color={v.temperatura === 'congelado' ? 'blue' : v.temperatura === 'refrigerado' ? 'purple' : 'slate'}>
                        {v.temperatura || 'Ambiente'}
                      </Badge>
                    </td>
                    <td className="td text-slate-500">{v.responsavel || '-'}</td>
                    <td className="td">{statusBadge(v)}</td>
                    <td className="td">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="secondary" icon={<Printer className="h-3.5 w-3.5" />} onClick={() => imprimir(v.id)}>
                          Etiqueta
                        </Button>
                        {v.status === 'ativo' && (
                          <>
                            <Button size="sm" variant="success" icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={async () => { await validadeApi.concluir(v.id); loadList(); }}>
                              Concluir
                            </Button>
                            <Button size="sm" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={async () => {
                              if (confirm('Descartar produto vencido? Isso registra uma perda.')) {
                                await validadeApi.descartar(v.id);
                                loadList();
                              }
                            }}>
                              Descartar
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal open={abrir} onClose={() => setAbrir(false)} title="Nova validade (produto aberto)" width="max-w-xl">
        <form onSubmit={buscar}>
          <Field label="Passe o código de barras ou busque">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <ScanBarcode className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input className="pl-9 font-mono" value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="código..." />
              </div>
              <Button type="submit" icon={<Search className="h-4 w-4" />}>Buscar</Button>
            </div>
          </Field>
        </form>
        {nEncontrado && <p className="mt-2 text-sm text-amber-600">Produto não encontrado.</p>}
        {produto && (
          <form onSubmit={criar} className="mt-4 space-y-3">
            <div className="rounded-xl bg-slate-50 p-3 text-sm">
              <b>{produto.nome}</b> · estoque {fmtNum(produto.estoque_atual)} {produto.unidade}
              {produto.validade_aberto_dias && <p className="text-xs text-slate-500">Validade padrão após abrir: {produto.validade_aberto_dias} dias</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Quantidade">
                <Input type="number" step="0.001" value={qtd} onChange={(e) => setQtd(e.target.value)} />
              </Field>
              <Field label="Validade após abrir (dias)">
                <Input type="number" value={diasAberto} onChange={(e) => setDiasAberto(e.target.value)} />
              </Field>
              <Field label="Data de abertura">
                <Input type="date" value={dataAbertura} onChange={(e) => setDataAbertura(e.target.value)} />
              </Field>
              <Field label="Vencimento (auto)" hint="calculado com os dias acima">
                <Input type="date" value={dataVencimento} onChange={(e) => setDataVencimento(e.target.value)} />
              </Field>
              <Field label="Temperatura">
                <Select value={temperatura} onChange={(e) => setTemperatura(e.target.value)}>
                  <option value="">Ambiente</option>
                  <option value="refrigerado">Refrigerado</option>
                  <option value="congelado">Congelado</option>
                </Select>
              </Field>
              <Field label="Responsável">
                <Input value={responsavel} onChange={(e) => setResponsavel(e.target.value)} />
              </Field>
            </div>
            <Field label="Observações">
              <Input value={obs} onChange={(e) => setObs(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setAbrir(false)}>Cancelar</Button>
              <Button type="submit" icon={<CalendarClock className="h-4 w-4" />}>Registrar e gerar etiqueta</Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!etiqueta} onClose={() => setEtiqueta(null)} title="Etiqueta de validade">
        <div className="mb-4 rounded-xl bg-slate-50 p-3 text-center">
          <p className="text-xs text-slate-400">Impressão térmica · largura da bobina configurada em Impressoras</p>
        </div>
        <div ref={printRef} className="mx-auto w-60 rounded-lg border-2 border-dashed border-slate-300 bg-white p-3 font-mono text-[11px] leading-4">
          <pre className="whitespace-pre-wrap text-slate-800">{etiqueta?.impressao}</pre>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setEtiqueta(null)}>Fechar</Button>
          <Button icon={<Printer className="h-4 w-4" />} onClick={() => printReceipt(printRef.current)}>Imprimir</Button>
        </div>
      </Modal>
    </AnimatedPage>
  );
}
