import { useEffect, useState } from 'react';
import { Trash2, Plus, PackageX, Eye, ReceiptText, User, CalendarClock } from 'lucide-react';
import { AnimatedPage } from '@/components/anim';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Spinner, Textarea, useToast } from '@/components/ui';
import { perdaApi, produtoApi } from '@/lib/api';
import type { Perda, Produto } from '@/lib/types';
import { fmtBRL, fmtNum, fmtData, hojeLocal } from '@/lib/format';

export function PerdasPage() {
  const toast = useToast();
  const [de, setDe] = useState(hojeLocal());
  const [ate, setAte] = useState(hojeLocal());
  const [perdas, setPerdas] = useState<Perda[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [load, setLoad] = useState(true);
  const [modal, setModal] = useState(false);
  const [detalhe, setDetalhe] = useState<Perda | null>(null);
  const [form, setForm] = useState({ produto_id: '', quantidade: '1', motivo: '', origem: 'quebra', responsavel: '' });

  const loadAll = async () => {
    setLoad(true);
    try {
      const [p, pr] = await Promise.all([perdaApi.list({ de, ate }), produtoApi.list()]);
      setPerdas(p);
      setProdutos(pr.filter((x) => x.ativo && x.estoque_atual > 0));
    } catch (e: any) {
      toast('error', e?.error || 'Erro ao carregar');
    } finally {
      setLoad(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, [de, ate]);

  useEffect(() => {
    let dataAtual = hojeLocal();
    const timer = window.setInterval(() => {
      const novaData = hojeLocal();
      if (novaData !== dataAtual) {
        dataAtual = novaData;
        setDe(novaData);
        setAte(novaData);
      }
    }, 30000);
    return () => window.clearInterval(timer);
  }, []);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.produto_id) return toast('error', 'Selecione o produto');
    if (!Number(form.quantidade) || Number(form.quantidade) <= 0) return toast('error', 'Quantidade inválida');
    if (form.motivo.trim().length < 5) return toast('error', 'Informe uma observação com pelo menos 5 caracteres');
    try {
      await perdaApi.create({
        produto_id: Number(form.produto_id),
        quantidade: Number(form.quantidade),
        motivo: form.motivo || 'Não especificado',
        origem: form.origem,
        responsavel: form.responsavel || undefined,
      });
      toast('success', 'Perda registrada e estoque ajustado');
      setModal(false);
      setForm({ produto_id: '', quantidade: '1', motivo: '', origem: 'quebra', responsavel: '' });
      loadAll();
    } catch (err: any) {
      toast('error', err?.error || 'Erro ao registrar');
    }
  };

  const total = perdas.reduce((s, p) => s + p.valor_unitario * p.quantidade, 0);
  const unidades = perdas.reduce((s, p) => s + p.quantidade, 0);
  const perdasDoDetalhe = detalhe?.venda_id
    ? perdas.filter((p) => p.venda_id === detalhe.venda_id && p.origem === detalhe.origem)
    : detalhe ? [detalhe] : [];
  const totalDetalhe = perdasDoDetalhe.reduce((s, p) => s + p.valor_unitario * p.quantidade, 0);

  return (
    <AnimatedPage>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-800">Controle de Perdas</h1>
          <p className="text-sm text-slate-500">Registre e consulte os detalhes, motivos e observações de cada perda</p>
        </div>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setModal(true)}>Registrar perda</Button>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Field label="De (início do período)"><Input type="date" value={de} onChange={(e) => setDe(e.target.value)} /></Field>
        <Field label="Até (fim do período)"><Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></Field>
        <div className="flex gap-2 pb-0.5">
          <Badge color="red">Perdas {fmtBRL(total)}</Badge>
          <Badge color="amber">{fmtNum(unidades, 0)} unidades</Badge>
        </div>
      </div>

      {load ? (
        <Spinner />
      ) : perdas.length === 0 ? (
        <Card><EmptyState icon={<PackageX className="h-8 w-8" />} title="Nenhuma perda no período" /></Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="max-h-[560px] overflow-auto">
            <table className="w-full">
              <thead className="bg-slate-50 sticky top-0">
                <tr>
                  <th className="th">Data</th>
                  <th className="th">Produto</th>
                  <th className="th">Origem</th>
                  <th className="th">Motivo</th>
                  <th className="th text-right">Qtd</th>
                  <th className="th text-right">Valor</th>
                  <th className="th text-right">Detalhes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {perdas.map((p) => (
                  <tr key={p.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setDetalhe(p)}>
                    <td className="td">{fmtData(p.criado_em)}</td>
                    <td className="td font-semibold text-slate-800">{p.produto_nome || 'Produto removido'}</td>
                    <td className="td"><Badge color="red">{p.origem}</Badge></td>
                    <td className="td"><p className="max-w-xs truncate">{p.motivo}</p><button className="mt-1 text-[11px] font-bold text-brand-600 hover:underline" onClick={(e) => { e.stopPropagation(); setDetalhe(p); }}>Ver observação completa</button></td>
                    <td className="td text-right">{fmtNum(p.quantidade)}</td>
                    <td className="td text-right font-bold text-red-600">{fmtBRL(p.valor_unitario * p.quantidade)}</td>
                    <td className="td text-right"><Button size="sm" variant="secondary" icon={<Eye className="h-3.5 w-3.5" />} onClick={(e) => { e.stopPropagation(); setDetalhe(p); }}>Abrir</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title="Registrar perda">
        <form onSubmit={salvar} className="space-y-4">
          <Field label="Produto *">
            <Select value={form.produto_id} onChange={(e) => setForm({ ...form, produto_id: e.target.value })}>
              <option value="">Selecione...</option>
              {produtos.map((p) => (
                <option key={p.id} value={p.id}>{p.nome} · {fmtNum(p.estoque_atual)} {p.unidade}</option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantidade *">
              <Input type="number" step="any" min="0" value={form.quantidade} onChange={(e) => setForm({ ...form, quantidade: e.target.value })} />
            </Field>
            <Field label="Origem">
              <Select value={form.origem} onChange={(e) => setForm({ ...form, origem: e.target.value })}>
                <option value="quebra">Quebra</option>
                <option value="validade">Vencido</option>
                <option value="roubo">Roubo / Furto</option>
                <option value="avaria">Avaria</option>
                <option value="outro">Outro</option>
              </Select>
            </Field>
          </div>
          <Field label="Observação / motivo *" hint="Explique o que causou a perda">
            <Textarea rows={3} value={form.motivo} onChange={(e) => setForm({ ...form, motivo: e.target.value })} placeholder="Ex.: Produto derrubado durante o atendimento..." />
          </Field>
          <Field label="Responsável">
            <Input value={form.responsavel} onChange={(e) => setForm({ ...form, responsavel: e.target.value })} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModal(false)}>Cancelar</Button>
            <Button type="submit">Registrar</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!detalhe} onClose={() => setDetalhe(null)} title={detalhe?.venda_numero ? `Perdas da venda ${detalhe.venda_numero}` : 'Detalhes da perda'} width="max-w-2xl">
        {detalhe && <div className="space-y-4">
          <div className="rounded-xl border border-red-200 bg-red-50 p-4">
            <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-red-500">Registro de perda</p><p className="text-lg font-extrabold text-slate-800">{detalhe.venda_numero ? `${perdasDoDetalhe.length} produto(s) da venda ${detalhe.venda_numero}` : detalhe.produto_nome || 'Produto removido'}</p>{detalhe.venda_numero && <p className="text-xs text-slate-500">Cancelamento no {detalhe.venda_tipo === 'pdv' ? 'PDV Mercado' : 'Restaurante'}</p>}</div><Badge color="red">{detalhe.origem}</Badge></div>
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full"><thead className="bg-slate-50"><tr><th className="th">Produto</th><th className="th text-right">Quantidade</th><th className="th text-right">Unitário</th><th className="th text-right">Total</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{perdasDoDetalhe.map((p) => <tr key={p.id}><td className="td"><p className="font-semibold text-slate-800">{p.produto_nome || 'Produto removido'}</p>{p.codigo_interno && <p className="font-mono text-[10px] text-slate-400">{p.codigo_interno}</p>}</td><td className="td text-right">{fmtNum(p.quantidade)} {p.unidade || 'un'}</td><td className="td text-right">{fmtBRL(p.valor_unitario)}</td><td className="td text-right font-bold text-red-600">{fmtBRL(p.valor_unitario * p.quantidade)}</td></tr>)}</tbody>
              <tfoot className="border-t-2 border-slate-200 bg-slate-50"><tr><td className="td font-bold" colSpan={3}>Total das perdas</td><td className="td text-right text-base font-extrabold text-red-600">{fmtBRL(totalDetalhe)}</td></tr></tfoot>
            </table>
          </div>
          <div className="rounded-xl border border-slate-200 p-4"><p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Observação registrada</p><p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{detalhe.motivo}</p></div>
          <div className="space-y-2 text-sm text-slate-600">
            <p className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-slate-400"/><b>Registrada em:</b> {fmtData(detalhe.criado_em)}</p>
            <p className="flex items-center gap-2"><User className="h-4 w-4 text-slate-400"/><b>Responsável:</b> {detalhe.responsavel || 'Não informado'}</p>
            {detalhe.venda_numero && <p className="flex items-center gap-2"><ReceiptText className="h-4 w-4 text-slate-400"/><b>Venda de origem:</b> {detalhe.venda_numero} · {detalhe.venda_tipo === 'pdv' ? 'PDV Mercado' : 'Restaurante'}</p>}
          </div>
          <div className="flex justify-end"><Button variant="secondary" onClick={() => setDetalhe(null)}>Fechar</Button></div>
        </div>}
      </Modal>
    </AnimatedPage>
  );
}
