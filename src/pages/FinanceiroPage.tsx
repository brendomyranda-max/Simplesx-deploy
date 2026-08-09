import { useEffect, useState } from 'react';
import { Wallet, Plus, ArrowUpCircle, ArrowDownCircle, CheckCircle2, Clock } from 'lucide-react';
import { AnimatedPage } from '@/components/anim';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Spinner, Tabs, useToast } from '@/components/ui';
import { financeiroApi } from '@/lib/api';
import type { Lancamento, CaixaMov, Conta } from '@/lib/types';
import { fmtBRL, fmtData, fmtDataCurta, hojeLocal } from '@/lib/format';

export function FinanceiroPage() {
  const toast = useToast();
  const [tab, setTab] = useState<'lancamentos' | 'despesas' | 'pagar' | 'receber' | 'caixa'>('lancamentos');
  const [de, setDe] = useState(hojeLocal());
  const [ate, setAte] = useState(hojeLocal());
  const [lancamentos, setLancamentos] = useState<Lancamento[]>([]);
  const [despesas, setDespesas] = useState<Lancamento[]>([]);
  const [pagar, setPagar] = useState<Conta[]>([]);
  const [receber, setReceber] = useState<Conta[]>([]);
  const [caixa, setCaixa] = useState<CaixaMov[]>([]);
  const [load, setLoad] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<any>({});

  const loadAll = async () => {
    setLoad(true);
    try {
      const [l, d, p, r, c] = await Promise.all([
        financeiroApi.lancamentos({ de, ate }),
        financeiroApi.despesas(),
        financeiroApi.contasPagar(),
        financeiroApi.contasReceber(),
        financeiroApi.caixa(hojeLocal()),
      ]);
      setLancamentos(l);
      setDespesas(d);
      setPagar(p);
      setReceber(r);
      setCaixa(c);
    } catch (e: any) {
      toast('error', e?.error || 'Erro ao carregar');
    } finally {
      setLoad(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, [de, ate]);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (tab === 'despesas') {
        await financeiroApi.criarDespesa({
          descricao: form.descricao,
          categoria: form.categoria,
          valor: Number(form.valor),
          data: form.data || hojeLocal(),
          forma_pagamento: form.metodo,
        });
        toast('success', 'Despesa registrada');
      } else if (tab === 'pagar') {
        await financeiroApi.criarContaPagar({ descricao: form.descricao, fornecedor: form.parceiro, valor: Number(form.valor), data_vencimento: form.data });
        toast('success', 'Conta a pagar criada');
      } else if (tab === 'receber') {
        await financeiroApi.criarContaReceber({ descricao: form.descricao, cliente: form.parceiro, valor: Number(form.valor), data_vencimento: form.data });
        toast('success', 'Conta a receber criada');
      } else {
        await financeiroApi.criarCaixa({ tipo: form.tipo, valor: Number(form.valor), metodo: form.metodo, observacao: form.descricao });
        toast('success', 'Movimento de caixa registrado');
      }
      setModal(false);
      loadAll();
    } catch (err: any) {
      toast('error', err?.error || 'Erro ao salvar');
    }
  };

  const abrir = () => {
    setForm({
      descricao: '',
      categoria: '',
      valor: '',
      data: hojeLocal(),
      metodo: '',
      parceiro: '',
      tipo: 'entrada',
    });
    setModal(true);
  };

  const somaLanc = (tipo: string) => lancamentos.filter((l) => l.tipo === tipo).reduce((s, l) => s + l.valor, 0);

  if (load) return <Spinner />;

  return (
    <AnimatedPage>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-800">Financeiro</h1>
          <p className="text-sm text-slate-500">Lançamentos, contas e caixa</p>
        </div>
        <Button icon={<Plus className="h-4 w-4" />} onClick={abrir}>Novo lançamento</Button>
      </div>

      <Tabs
        value={tab}
        onChange={(v) => setTab(v as any)}
        tabs={[
          { value: 'lancamentos', label: 'Lançamentos' },
          { value: 'despesas', label: 'Despesas' },
          { value: 'pagar', label: 'A Pagar' },
          { value: 'receber', label: 'A Receber' },
          { value: 'caixa', label: 'Caixa' },
        ]}
      />

      {tab === 'lancamentos' && (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="De"><Input type="date" value={de} onChange={(e) => setDe(e.target.value)} /></Field>
            <Field label="Até"><Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></Field>
            <div className="flex gap-2 pb-0.5">
              <Badge color="green">Entradas {fmtBRL(somaLanc('receita'))}</Badge>
              <Badge color="red">Saídas {fmtBRL(somaLanc('despesa'))}</Badge>
              <Badge color={somaLanc('receita') - somaLanc('despesa') >= 0 ? 'brand' : 'red'}>
                Saldo {fmtBRL(somaLanc('receita') - somaLanc('despesa'))}
              </Badge>
            </div>
          </div>
          {lancamentos.length === 0 ? (
            <Card><EmptyState icon={<Wallet className="h-8 w-8" />} title="Sem lançamentos no período" /></Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="max-h-[520px] overflow-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      <th className="th">Data</th>
                      <th className="th">Descrição</th>
                      <th className="th">Categoria</th>
                      <th className="th">Método</th>
                      <th className="th text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {lancamentos.map((l) => (
                      <tr key={l.id}>
                        <td className="td">{fmtData(l.data)}</td>
                        <td className="td font-semibold text-slate-800">{l.descricao}</td>
                        <td className="td">{l.categoria || '-'}</td>
                        <td className="td">{l.metodo || '-'}</td>
                        <td className={`td text-right font-bold ${l.tipo === 'receita' ? 'text-emerald-600' : 'text-red-600'}`}>
                          {l.tipo === 'receita' ? '+' : '-'}{fmtBRL(l.valor)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {tab === 'despesas' && (
        <div className="mt-4">
          <DespesasList itens={despesas} onPagar={() => {}} />
        </div>
      )}

      {tab === 'pagar' && (
        <div className="mt-4">
          <ContasList itens={pagar} tipo="pagar" onAction={async (c) => { await financeiroApi.pagarConta(c.id); toast('success', 'Conta paga'); loadAll(); }} />
        </div>
      )}

      {tab === 'receber' && (
        <div className="mt-4">
          <ContasList itens={receber} tipo="receber" onAction={async (c) => { await financeiroApi.receberConta(c.id); toast('success', 'Conta recebida'); loadAll(); }} />
        </div>
      )}

      {tab === 'caixa' && (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            {(() => {
              const entrada = caixa.filter((c) => c.tipo === 'entrada').reduce((s, c) => s + c.valor, 0);
              const saida = caixa.filter((c) => c.tipo === 'saida').reduce((s, c) => s + c.valor, 0);
              return (
                <>
                  <Badge color="green">Entradas {fmtBRL(entrada)}</Badge>
                  <Badge color="red">Saídas {fmtBRL(saida)}</Badge>
                  <Badge color="brand">Saldo {fmtBRL(entrada - saida)}</Badge>
                </>
              );
            })()}
          </div>
          <Card className="overflow-hidden">
            <div className="max-h-[520px] overflow-auto">
              <table className="w-full">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    <th className="th">Horário</th>
                    <th className="th">Tipo</th>
                    <th className="th">Método</th>
                    <th className="th">Observação</th>
                    <th className="th text-right">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {caixa.map((c) => (
                    <tr key={c.id}>
                      <td className="td">{fmtData(c.data)}</td>
                      <td className="td">{c.tipo}</td>
                      <td className="td">{c.metodo || '-'}</td>
                      <td className="td">{c.observacao || '-'}</td>
                      <td className={`td text-right font-bold ${c.tipo === 'entrada' ? 'text-emerald-600' : 'text-red-600'}`}>
                        {fmtBRL(c.valor)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={`Novo ${tab === 'lancamentos' ? 'movimento' : tab}`}>
        <form onSubmit={salvar} className="space-y-4">
          {(tab === 'lancamentos' || tab === 'caixa') && (
            <Field label="Tipo">
              <Select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
                <option value="entrada">Entrada</option>
                <option value="saida">Saída</option>
              </Select>
            </Field>
          )}
          <Field label="Descrição *">
            <Input value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} autoFocus />
          </Field>
          {tab === 'despesas' && (
            <Field label="Categoria">
              <Input value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} placeholder="ex.: Aluguel, Energia..." />
            </Field>
          )}
          {(tab === 'pagar' || tab === 'receber') && (
            <Field label={tab === 'pagar' ? 'Fornecedor' : 'Cliente'}>
              <Input value={form.parceiro} onChange={(e) => setForm({ ...form, parceiro: e.target.value })} />
            </Field>
          )}
          <Field label="Valor (R$) *">
            <Input type="number" step="0.01" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} />
          </Field>
          <Field label="Data">
            <Input type="date" value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} />
          </Field>
          {(tab === 'despesas' || tab === 'caixa' || tab === 'lancamentos') && (
            <Field label="Método">
              <Select value={form.metodo} onChange={(e) => setForm({ ...form, metodo: e.target.value })}>
                <option value="">—</option>
                <option value="dinheiro">Dinheiro</option>
                <option value="pix">Pix</option>
                <option value="credito">Cartão crédito</option>
                <option value="debito">Cartão débito</option>
                <option value="boleto">Boleto</option>
              </Select>
            </Field>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModal(false)}>Cancelar</Button>
            <Button type="submit">Salvar</Button>
          </div>
        </form>
      </Modal>
    </AnimatedPage>
  );
}

function DespesasList({ itens }: { itens: Lancamento[]; onPagar: () => void }) {
  const soma = itens.reduce((s, i) => s + i.valor, 0);
  return (
    <div className="space-y-3">
      <Badge color="red">Total despesas {fmtBRL(soma)}</Badge>
      {itens.length === 0 ? (
        <Card><EmptyState icon={<ArrowDownCircle className="h-8 w-8" />} title="Nenhuma despesa" /></Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full">
              <thead className="bg-slate-50 sticky top-0">
                <tr>
                  <th className="th">Data</th>
                  <th className="th">Descrição</th>
                  <th className="th">Categoria</th>
                  <th className="th text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {itens.map((d) => (
                  <tr key={d.id}>
                    <td className="td">{fmtData(d.data)}</td>
                    <td className="td font-semibold text-slate-800">{d.descricao}</td>
                    <td className="td">{d.categoria || '-'}</td>
                    <td className="td text-right font-bold text-red-600">-{fmtBRL(d.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function ContasList({ itens, tipo, onAction }: { itens: Conta[]; tipo: 'pagar' | 'receber'; onAction: (c: Conta) => void }) {
  const pend = itens.filter((c) => c.status === 'pendente');
  const pago = itens.filter((c) => c.status !== 'pendente');
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Badge color="amber">{pend.length} pendentes · {fmtBRL(pend.reduce((s, c) => s + c.valor, 0))}</Badge>
        <Badge color="green">{pago.length} {tipo === 'pagar' ? 'pagas' : 'recebidas'}</Badge>
      </div>
      {itens.length === 0 ? (
        <Card><EmptyState icon={tipo === 'pagar' ? <ArrowDownCircle className="h-8 w-8" /> : <ArrowUpCircle className="h-8 w-8" />} title={`Nenhuma conta a ${tipo === 'pagar' ? 'pagar' : 'receber'}`} /></Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full">
              <thead className="bg-slate-50 sticky top-0">
                <tr>
                  <th className="th">Vencimento</th>
                  <th className="th">Descrição</th>
                  <th className="th">{tipo === 'pagar' ? 'Fornecedor' : 'Cliente'}</th>
                  <th className="th">Status</th>
                  <th className="th text-right">Valor</th>
                  <th className="th text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {itens.map((c) => (
                  <tr key={c.id}>
                    <td className="td">{fmtDataCurta(c.data_vencimento)}</td>
                    <td className="td font-semibold text-slate-800">{c.descricao}</td>
                    <td className="td">{(c as any).fornecedor || (c as any).cliente || '-'}</td>
                    <td className="td">
                      {c.status === 'pendente' ? (
                        <Badge color="amber"><Clock className="mr-1 h-3 w-3" /> pendente</Badge>
                      ) : (
                        <Badge color="green"><CheckCircle2 className="mr-1 h-3 w-3" /> {c.status}</Badge>
                      )}
                    </td>
                    <td className="td text-right font-bold text-slate-800">{fmtBRL(c.valor)}</td>
                    <td className="td text-right">
                      {c.status === 'pendente' && (
                        <Button size="sm" variant="success" onClick={() => onAction(c)}>
                          {tipo === 'pagar' ? 'Pagar' : 'Receber'}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
