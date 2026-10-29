/**
 * Arquivo: EstoquePage.tsx
 * Responsabilidade: Implementa a tela EstoquePage.tsx e coordena seus dados e ações.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Boxes, Plus, Search, Pencil, Trash2, PackageMinus, ChefHat } from 'lucide-react';
import { AnimatedPage } from '@/components/AnimatedPage';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
  Input,
  Select,
  Modal,
  Field,
  Spinner,
  useConfirm,
  useToast,
} from '@/components/ui';
import { ProdutoForm } from '@/components/ProdutoForm';
import { OnlineCatalogPage } from '@/pages/OnlineCatalogPage';
import { produtoApi, estoqueApi, configApi, categoriaApi } from '@/lib/api';
import type { Produto, ConfigEmpresa, ProdutoTipo, Categoria } from '@/lib/types';
import { fmtBRL, fmtNum } from '@/lib/format';
import { avisarEstoqueAtualizado } from '@/lib/estoqueSync';

const TABS: { v: ProdutoTipo | 'todos' | 'delivery'; label: string }[] = [
  { v: 'todos', label: 'Todos' },
  { v: 'produto', label: 'Produtos' },
  { v: 'composto', label: 'Compostos' },
  { v: 'combo', label: 'Combos' },
  { v: 'insumo', label: 'Insumos' },
  { v: 'delivery', label: 'Delivery' },
];

const TIPO_LABEL: Record<ProdutoTipo, string> = {
  produto: 'Produto',
  composto: 'Composto',
  combo: 'Combo',
  insumo: 'Insumo',
};

export function EstoquePage() {
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [busca, setBusca] = useState('');
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [categoria, setCategoria] = useState('');
  const [params] = useSearchParams();
  const [tipo, setTipo] = useState<ProdutoTipo | 'todos' | 'delivery'>(params.get('aba') === 'delivery' ? 'delivery' : 'todos');
  const [deliveryTick, setDeliveryTick] = useState(0);
  const [load, setLoad] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [abrindoEdicao, setAbrindoEdicao] = useState<number | null>(null);
  const [edit, setEdit] = useState<Produto | null>(null);
  const [ajuste, setAjuste] = useState<Produto | null>(null);
  const [ajusteQtd, setAjusteQtd] = useState('');
  const [ajusteMotivo, setAjusteMotivo] = useState('');
  const [config, setConfig] = useState<ConfigEmpresa | null>(null);
  const carregamentoSeq = useRef(0);
  const ativoRef = useRef(true);
  const toast = useToast();
  const confirm = useConfirm();

  const carregar = async () => {
    if (!ativoRef.current || tipo === 'delivery') return;
    const sequencia = ++carregamentoSeq.current;
    setLoad(true);
    try {
      const p = await produtoApi.list(busca, undefined, tipo === 'todos' ? undefined : tipo);
      if (ativoRef.current && sequencia === carregamentoSeq.current) setProdutos(p);
    } catch (e: any) {
      if (ativoRef.current && sequencia === carregamentoSeq.current) toast('error', e?.error || 'Erro ao carregar produtos');
    } finally {
      if (ativoRef.current && sequencia === carregamentoSeq.current) setLoad(false);
    }
  };

  useEffect(() => {
    let ativo = true;
    ativoRef.current = true;
    configApi.get().then((c) => { if (ativo) setConfig(c); })
      .catch((e: any) => { if (ativo) toast('error', e?.error || 'Erro ao carregar configurações'); });
    categoriaApi.list().then((lista) => { if (ativo) setCategorias(lista); })
      .catch((e: any) => { if (ativo) toast('error', e?.error || 'Erro ao carregar categorias'); });
    return () => { ativo = false; ativoRef.current = false; carregamentoSeq.current++; };
  }, []);

  useEffect(() => {
    carregamentoSeq.current++;
    if (tipo === 'delivery') return;
    const t = setTimeout(carregar, 250);
    return () => { clearTimeout(t); carregamentoSeq.current++; };
  }, [busca, tipo]);

  const porCategoria = (p: Produto) => p.categorias?.map((c) => c.nome).join(', ') || '-';

  const remover = (p: Produto) => {
    confirm(
      `Excluir "${p.nome}"?`,
      'Exclusão definitiva: remove o produto e todos os rastros ligados a ele, incluindo vendas completas, pagamentos, caixa, perdas, comandas, estoque e vencimentos. Esta ação não pode ser desfeita.',
      async () => {
        await produtoApi.remove(p.id);
        toast('success', 'Produto excluído');
        carregar();
      }
    );
  };

  const editarProduto = async (p: Produto) => {
    setAbrindoEdicao(p.id);
    try {
      // A listagem traz somente o resumo da ficha. A edição sempre precisa do
      // cadastro completo para preservar e permitir alterar insumos/categorias.
      setEdit(await produtoApi.get(p.id));
      setFormOpen(true);
    } catch (e: any) {
      toast('error', e?.error || 'Erro ao carregar o produto para edição');
    } finally {
      setAbrindoEdicao(null);
    }
  };

  const salvarAjuste = async () => {
    if (!ajuste) return;
    try {
      await estoqueApi.ajuste({
        produto_id: ajuste.id,
        quantidade_nova: Number(ajusteQtd),
        motivo: ajusteMotivo,
      });
      avisarEstoqueAtualizado();
      toast('success', 'Estoque ajustado');
      setAjuste(null);
      carregar();
    } catch (e: any) {
      toast('error', e?.error || 'Erro no ajuste');
    }
  };

  const produtosExibidos = useMemo(() => {
    if (!categoria) return produtos;
    if (categoria === 'sem') return produtos.filter((p) => !p.categorias?.length);
    const ids = new Set([Number(categoria)]);
    for (const id of ids) {
      categorias.filter((c) => c.categoria_pai_id === id).forEach((c) => ids.add(c.id));
    }
    return produtos.filter((p) => p.categorias?.some((c) => ids.has(c.id)));
  }, [produtos, categorias, categoria]);
  const somaEstoque = useMemo(() => produtosExibidos.reduce((s, p) => s + p.estoque_atual, 0), [produtosExibidos]);

  return (
    <AnimatedPage>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-800">Estoque</h1>
          <p className="text-sm text-slate-500">
            {tipo === 'delivery' ? 'Produtos do estoque publicados no site' : `${produtosExibidos.length} produtos · ${fmtNum(somaEstoque)} unidades`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {tipo !== 'delivery' && <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input className="w-64 pl-9" placeholder="Buscar por nome ou código..." value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>}
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => { setEdit(null); setFormOpen(true); }}>
            {tipo === 'delivery' ? 'Publicar no delivery' : 'Novo produto'}
          </Button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
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

      {tipo !== 'delivery' && <div className="mb-4 max-w-sm">
        <Field label="Filtrar por categoria">
          <Select aria-label="Filtrar por categoria" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
            <option value="">Todas as categorias</option>
            <option value="sem">Sem categoria</option>
            {categorias.map((c) => <option key={c.id} value={String(c.id)}>
              {c.categoria_pai_nome ? `${c.categoria_pai_nome} / ${c.nome}` : c.nome}
            </option>)}
          </Select>
        </Field>
      </div>}

      {tipo === 'delivery' ? (
        <OnlineCatalogPage key={deliveryTick} embutido />
      ) : load ? (
        <Spinner />
      ) : produtosExibidos.length === 0 ? (
        <Card>
          <EmptyState icon={<Boxes className="h-8 w-8" />} title="Nenhum produto encontrado" subtitle={busca || categoria || tipo !== 'todos' ? 'Tente outra busca, categoria ou tipo de produto.' : 'Cadastre seu primeiro produto para começar'} />
        </Card>
      ) : (
        <Card className="overflow-hidden">
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
                {produtosExibidos.map((p) => {
                  const baixo = p.estoque_atual <= p.estoque_minimo && p.tipo !== 'composto' && p.tipo !== 'combo';
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
                          {p.tipo === 'combo' ? 'Por escolha' : p.tipo === 'composto' ? `p/ ${fmtNum(p.estoque_possivel ?? 0)} un` : `${fmtNum(p.estoque_atual)} ${p.unidade}`}
                        </Badge>
                      </td>
                      <td className="td text-slate-500">{p.tipo === 'composto' || p.tipo === 'combo' ? '—' : fmtNum(p.estoque_minimo)}</td>
                      <td className="td font-semibold">{p.preco != null ? fmtBRL(p.preco) : <span className="text-xs text-slate-500">Sem preço</span>}</td>
                      <td className="td text-slate-500">{p.tipo === 'combo' ? 'Conforme escolhas' : fmtBRL(p.custo)}</td>
                      <td className="td">
                        <div className="flex justify-end gap-1">
                          {p.tipo !== 'composto' && p.tipo !== 'combo' && (
                            <IconButton label="Ajustar estoque" icon={<PackageMinus className="h-4 w-4" />} onClick={() => { setAjuste(p); setAjusteQtd(String(p.estoque_atual)); setAjusteMotivo(''); }} />
                          )}
                          <IconButton label={abrindoEdicao === p.id ? 'Carregando produto' : 'Editar'} icon={<Pencil className="h-4 w-4" />} onClick={() => editarProduto(p)} disabled={abrindoEdicao !== null} />
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

      <ProdutoForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        produto={edit}
        canalInicial={tipo === 'delivery' ? 'delivery' : 'cadastro'}
        onSaved={() => {
          avisarEstoqueAtualizado();
          if (tipo === 'delivery') setDeliveryTick((valor) => valor + 1);
          else carregar();
        }}
      />

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
