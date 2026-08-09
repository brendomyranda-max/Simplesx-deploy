import { useEffect, useState } from 'react';
import { Trash2, Plus, PackageX } from 'lucide-react';
import { AnimatedPage } from '@/components/anim';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Spinner, useToast } from '@/components/ui';
import { perdaApi, produtoApi } from '@/lib/api';
import type { Perda, Produto } from '@/lib/types';
import { fmtBRL, fmtNum, fmtData, hojeLocal, addDiasLocal } from '@/lib/format';

export function PerdasPage() {
  const toast = useToast();
  const [de, setDe] = useState(addDiasLocal(-30));
  const [ate, setAte] = useState(hojeLocal());
  const [perdas, setPerdas] = useState<Perda[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [load, setLoad] = useState(true);
  const [modal, setModal] = useState(false);
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

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.produto_id) return toast('error', 'Selecione o produto');
    if (!Number(form.quantidade) || Number(form.quantidade) <= 0) return toast('error', 'Quantidade inválida');
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

  return (
    <AnimatedPage>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-800">Controle de Perdas</h1>
          <p className="text-sm text-slate-500">Registre quebras, vencidos e danificados</p>
        </div>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setModal(true)}>Registrar perda</Button>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Field label="De"><Input type="date" value={de} onChange={(e) => setDe(e.target.value)} /></Field>
        <Field label="Até"><Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></Field>
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
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {perdas.map((p) => (
                  <tr key={p.id}>
                    <td className="td">{fmtData(p.criado_em)}</td>
                    <td className="td font-semibold text-slate-800">{p.produto_nome || 'Produto removido'}</td>
                    <td className="td"><Badge color="red">{p.origem}</Badge></td>
                    <td className="td">{p.motivo}</td>
                    <td className="td text-right">{fmtNum(p.quantidade)}</td>
                    <td className="td text-right font-bold text-red-600">{fmtBRL(p.valor_unitario * p.quantidade)}</td>
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
          <Field label="Motivo">
            <Input value={form.motivo} onChange={(e) => setForm({ ...form, motivo: e.target.value })} placeholder="ex.: Derrubado, venceu hoje..." />
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
    </AnimatedPage>
  );
}
