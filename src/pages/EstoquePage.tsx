import { useEffect, useMemo, useState } from 'react';
import { Boxes, Plus, Search, Pencil, Trash2, ScanBarcode, PackageMinus, ChefHat, Layers, Wrench } from 'lucide-react';
import { AnimatedPage } from '@/components/anim';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
  Input,
  Modal,
  Field,
  Spinner,
  useConfirm,
  useToast,
} from '@/components/ui';
import { ProdutoForm } from '@/components/forms/ProdutoForm';
import { produtoApi, estoqueApi, configApi } from '@/lib/api';
import type { Produto, ConfigEmpresa, ProdutoTipo } from '@/lib/types';
import { fmtBRL, fmtNum } from '@/lib/format';

const TABS: { v: ProdutoTipo | 'todos'; label: string }[] = [
  { v: 'todos', label: 'Todos' },
  { v: 'produto', label: 'Produtos' },
  { v: 'composto', label: 'Compostos' },
  { v: 'insumo', label: 'Insumos' },
];

const TIPO_LABEL: Record<ProdutoTipo, string> = {
  produto: 'Produto',
  composto: 'Composto',
  insumo: 'Insumo',
};

export function EstoquePage() {
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [busca, setBusca] = useState('');
  const [tipo, setTipo] = useState<ProdutoTipo | 'todos'>('todos');
  const [load, setLoad] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [edit, setEdit] = useState<Produto | null>(null);
  const [ajuste, setAjuste] = useState<Produto | null>(null);
  const [ajusteQtd, setAjusteQtd] = useState('');
  const [ajusteMotivo, setAjusteMotivo] = useState('');
  const [config, setConfig] = useState<ConfigEmpresa | null>(null);
  const toast = useToast();
  const confirm = useConfirm();

  const carregar = async () => {
    setLoad(true);
    try {
      const [p, c] = await Promise.all([produtoApi.list(busca, undefined, tipo === 'todos' ? undefined : tipo), configApi.get()]);
      setProdutos(p);
      setConfig(c);
    } catch (e: any) {
      toast('error', e?.error || 'Erro ao carregar produtos');
    } finally {
      setLoad(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(carregar, 250);
    return () => clearTimeout(t);
  }, [busca, tipo]);

  const porCategoria = (p: Produto) => p.categorias?.map((c) => c.nome).join(', ') || '-';

  const remover = (p: Produto) => {
    confirm(
      `Excluir "${p.nome}"?`,
      'Remove o produto, os códigos de barras, lotes, entradas, movimentações e validades ligadas a ele. Vendas e perdas antigas são mantidas.',
      async () => {
        await produtoApi.remove(p.id);
        toast('success', 'Produto excluído');
        carregar();
      }
    );
  };

  const salvarAjuste = async () => {
    if (!ajuste) return;
    try {
      await estoqueApi.ajuste({
        produto_id: ajuste.id,
        quantidade_nova: Number(ajusteQtd),
        motivo: ajusteMotivo,
      });
      toast('success', 'Estoque ajustado');
      setAjuste(null);
      carregar();
    } catch (e: any) {
      toast('error', e?.error || 'Erro no ajuste');
    }
  };

  const somaEstoque = useMemo(() => produtos.reduce((s, p) => s + p.estoque_atual, 0), [produtos]);

  return (
    <AnimatedPage>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-800">Estoque</h1>
          <p className="text-sm text-slate-500">
            {produtos.length} produtos · {fmtNum(somaEstoque)} unidades
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input className="w-64 pl-9" placeholder="Buscar por nome ou código..." value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => { setEdit(null); setFormOpen(true); }}>
            Novo produto
          </Button>
        </div>
      </div>

      {load ? (
        <Spinner />
      ) : produtos.length === 0 ? (
        <Card>
          <EmptyState icon={<Boxes className="h-8 w-8" />} title="Nenhum produto encontrado" subtitle="Cadastre seu primeiro produto para começar" />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap gap-1.5 border-b border-slate-100 px-3 pt-3">
            {TABS.map((t) => (
              <button
                key={t.v}
                onClick={() => setTipo(t.v)}
                className={`rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
                  tipo === t.v ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Produto</th>
                  <th className="th">Código</th>
                  <th className="th">Categorias</th>
                  <th className="th">Estoque</th>
                  <th className="th">Mínimo</th>
                  <th className="th">Preço</th>
                  <th className="th">Custo</th>
                  <th className="th text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {produtos.map((p) => {
                  const baixo = p.estoque_atual <= p.estoque_minimo && p.tipo !== 'composto';
                  const tipoLabel = p.tipo || 'produto';
                  return (
                    <tr key={p.id} className="transition-colors hover:bg-slate-50/60">
                      <td className="td">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-slate-800">{p.nome}</p>
                          {tipoLabel === 'composto' && (
                            <span title={`${p.ficha_count ?? 0} insumos na ficha técnica`}>
                              <Badge color="purple">
                                <ChefHat className="h-3 w-3" /> {p.ficha_count ?? 0}
                              </Badge>
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-400">
                          {TIPO_LABEL[tipoLabel as ProdutoTipo]} · {p.marca || p.unidade}
                        </p>
                      </td>
                      <td className="td font-mono text-xs">{p.codigo_interno}</td>
                      <td className="td">{porCategoria(p)}</td>
                      <td className="td">
                        <Badge color={baixo ? 'red' : 'green'}>
                          {p.tipo === 'composto' ? `p/ ${fmtNum(p.estoque_possivel ?? 0)} un` : `${fmtNum(p.estoque_atual)} ${p.unidade}`}
                        </Badge>
                      </td>
                      <td className="td text-slate-500">{p.tipo === 'composto' ? '—' : fmtNum(p.estoque_minimo)}</td>
                      <td className="td font-semibold">{p.preco != null ? fmtBRL(p.preco) : <span className="text-slate-300">—</span>}</td>
                      <td className="td text-slate-500">{fmtBRL(p.custo)}</td>
                      <td className="td">
                        <div className="flex justify-end gap-1">
                          {p.tipo !== 'composto' && (
                            <IconButton label="Ajustar estoque" icon={<PackageMinus className="h-4 w-4" />} onClick={() => { setAjuste(p); setAjusteQtd(String(p.estoque_atual)); setAjusteMotivo(''); }} />
                          )}
                          <IconButton label="Editar" icon={<Pencil className="h-4 w-4" />} onClick={() => { setEdit(p); setFormOpen(true); }} />
                          <IconButton label="Excluir" variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => remover(p)} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <ProdutoForm open={formOpen} onClose={() => setFormOpen(false)} produto={edit} onSaved={carregar} />

      <Modal open={!!ajuste} onClose={() => setAjuste(null)} title={`Ajustar estoque: ${ajuste?.nome || ''}`}>
        <div className="space-y-4">
          <Field label="Nova quantidade" hint={`Estoque atual: ${fmtNum(ajuste?.estoque_atual)}`}>
            <Input type="number" step="0.001" value={ajusteQtd} onChange={(e) => setAjusteQtd(e.target.value)} autoFocus />
          </Field>
          <Field label="Motivo">
            <Input value={ajusteMotivo} onChange={(e) => setAjusteMotivo(e.target.value)} placeholder="Ex.: contagem física" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAjuste(null)}>Cancelar</Button>
            <Button onClick={salvarAjuste}>Aplicar ajuste</Button>
          </div>
        </div>
      </Modal>
    </AnimatedPage>
  );
}
