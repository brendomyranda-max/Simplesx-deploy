import { useEffect, useMemo, useState } from 'react';
import { Plus, ScanBarcode, Trash2, Boxes, MessageSquare, X, ChefHat } from 'lucide-react';
import { Button, Field, Input, Modal, Select, Textarea, Toggle, useToast } from '@/components/ui';
import { categoriaApi, fornecedorApi, produtoApi } from '@/lib/api';
import type { Categoria, Fornecedor, Produto, ProdutoTipo } from '@/lib/types';
import { fmtBRL } from '@/lib/format';
import { UNIDADES, calcularCmv, converterQuantidade, custoLinha, unidadeCompativel } from '@/lib/cmv';

const TEMPERATURAS = [
  { v: '', label: 'Ambiente' },
  { v: 'refrigerado', label: 'Refrigerado' },
  { v: 'congelado', label: 'Congelado' },
];

const TIPOS: { v: ProdutoTipo; label: string; desc: string }[] = [
  { v: 'produto', label: 'Produto simples', desc: 'Vende e baixa o próprio estoque' },
  { v: 'insumo', label: 'Insumo', desc: 'Matéria-prima usada em fichas técnicas' },
  { v: 'composto', label: 'Produto composto', desc: 'Receita: baixa insumos do estoque ao vender' },
];

interface LinhaFicha {
  insumo_id: number | '';
  quantidade: string;
  unidade: string;
}

function initialState(p?: Produto | null) {
  return {
    tipo: (p?.tipo as ProdutoTipo) || 'produto',
    nome: p?.nome ?? '',
    codigo_interno: p?.codigo_interno ?? '',
    unidade: p?.unidade ?? 'UN',
    preco: p?.preco ?? '',
    custo: p?.custo ?? '',
    estoque_atual: p?.estoque_atual ?? '',
    estoque_minimo: p?.estoque_minimo ?? '',
    marca: p?.marca || '',
    validade_fabricacao_dias: p?.validade_fabricacao_dias || '',
    validade_aberto_dias: p?.validade_aberto_dias || '',
    temperatura: p?.temperatura || '',
    observacoes: p?.observacoes || '',
    fornecedor_id: p?.fornecedor_id || '',
    ativo: p ? !!p.ativo : true,
    exibir_restaurante: p ? !!p.exibir_restaurante : false,
    exibir_mercado: p ? !!p.exibir_mercado : false,
    codigos_barras: (p?.codigos_barras || []).map((c) => ({ codigo: c.codigo, principal: c.principal })),
    categoria_ids: (p?.categorias || []).map((c) => c.id),
    comentarios: (p?.comentarios || []).map((c) => c),
    ficha: ((p?.ficha || []) as any[]).map((i) => ({
      insumo_id: i.insumo_id,
      quantidade: String(i.quantidade ?? ''),
      unidade: i.unidade || 'UN',
    })) as LinhaFicha[],
  };
}

export function ProdutoForm({
  open,
  onClose,
  produto,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  produto?: Produto | null;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [insumos, setInsumos] = useState<Produto[]>([]);
  const [saving, setSaving] = useState(false);
  const [novoComentario, setNovoComentario] = useState('');
  const [form, setForm] = useState<any>(() => initialState(produto));

  useEffect(() => {
    if (!open) return;
    categoriaApi.list().then(setCategorias).catch(() => {});
    fornecedorApi.list().then(setFornecedores).catch(() => {});
    produtoApi.insumos().then(setInsumos).catch(() => {});
    setForm(initialState(produto));
    setNovoComentario('');
  }, [open, produto]);

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const setFicha = (i: number, k: string, v: any) => {
    setForm((f: any) => {
      const arr = [...f.ficha];
      arr[i] = { ...arr[i], [k]: v };
      return { ...f, ficha: arr };
    });
  };

  const insumoById = (id: number) => insumos.find((x) => x.id === id);

  const linhasCalculadas = useMemo(() => {
    return form.ficha
      .filter((l: LinhaFicha) => l.insumo_id !== '')
      .map((l: LinhaFicha) => {
        const ing = insumoById(Number(l.insumo_id));
        const qtd = Number(l.quantidade || 0);
        const custo = custoLinha(qtd, l.unidade, ing?.unidade, ing?.custo);
        return {
          ...l,
          ing,
          qtd,
          custo: custo,
          compativel: unidadeCompativel(l.unidade, ing?.unidade),
        };
      });
  }, [form.ficha, insumos]);

  const cmv = useMemo(() => {
    return calcularCmv(
      linhasCalculadas
        .filter((l: any) => l.custo !== null)
        .map((l: any) => ({ quantidade: l.qtd, unidade: l.unidade, insumo_unidade: l.ing?.unidade, insumo_custo: l.ing?.custo }))
    );
  }, [linhasCalculadas]);

  const unidadeIncompativel = linhasCalculadas.find((l: any) => l.qtd > 0 && !l.compativel);

  const precoNum = Number(form.preco || 0);
  const lucro = precoNum - cmv;
  const margem = precoNum > 0 ? (lucro / precoNum) * 100 : null;

  const adicionarComentario = () => {
    const texto = novoComentario.trim();
    if (!texto || form.comentarios.includes(texto)) return;
    set('comentarios', [...form.comentarios, texto]);
    setNovoComentario('');
  };

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nome.trim()) return toast('error', 'Informe o nome do produto');
    if (form.tipo === 'composto' && form.ficha.length === 0)
      return toast('error', 'Adicione pelo menos um insumo à ficha técnica');
    if (form.tipo === 'composto' && unidadeIncompativel)
      return toast('error', unidadeIncompativel.ing ? `Unidade incompatível: ${unidadeIncompativel.ing.nome}` : 'Unidade incompatível');
    if (form.tipo === 'composto' && Number(form.preco) <= 0)
      return toast('error', 'Informe o preço de venda do produto composto');
    setSaving(true);
    try {
      const payload = {
        tipo: form.tipo,
        nome: form.nome.trim(),
        codigo_interno: form.codigo_interno.trim(),
        unidade: form.unidade,
        preco: form.preco === '' ? null : Number(form.preco),
        custo: form.tipo === 'composto' ? undefined : Number(form.custo || 0),
        estoque_atual: form.tipo === 'composto' ? undefined : Number(form.estoque_atual || 0),
        estoque_minimo: form.tipo === 'composto' ? undefined : Number(form.estoque_minimo || 0),
        marca: form.marca.trim() || null,
        validade_fabricacao_dias: form.validade_fabricacao_dias === '' ? null : Number(form.validade_fabricacao_dias),
        validade_aberto_dias: form.validade_aberto_dias === '' ? null : Number(form.validade_aberto_dias),
        temperatura: form.temperatura || null,
        observacoes: form.observacoes.trim() || null,
        fornecedor_id: form.fornecedor_id ? Number(form.fornecedor_id) : null,
        ativo: form.ativo,
        exibir_restaurante: form.exibir_restaurante,
        exibir_mercado: form.exibir_mercado,
        codigos_barras: form.codigos_barras.filter((c: any) => c.codigo.trim()),
        categoria_ids: form.categoria_ids,
        comentarios: form.comentarios.map((c: string) => c.trim()).filter(Boolean),
        ficha:
          form.tipo === 'composto'
            ? form.ficha
                .filter((l: LinhaFicha) => l.insumo_id !== '' && Number(l.quantidade) > 0)
                .map((l: LinhaFicha) => ({ insumo_id: Number(l.insumo_id), quantidade: Number(l.quantidade), unidade: l.unidade }))
            : undefined,
      };
      if (produto) await produtoApi.update(produto.id, payload);
      else await produtoApi.create(payload);
      toast('success', produto ? 'Produto atualizado!' : 'Produto criado!');
      onSaved();
      onClose();
    } catch (e: any) {
      toast('error', e?.error || 'Erro ao salvar produto');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={produto ? `Editar: ${produto.nome}` : 'Novo produto'} width="max-w-3xl">
      <form onSubmit={salvar} className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-3">
          {TIPOS.map((t) => (
            <button
              key={t.v}
              type="button"
              onClick={() => set('tipo', t.v)}
              className={`rounded-xl border p-3 text-left transition-colors ${
                form.tipo === t.v
                  ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <p className={`text-sm font-bold ${form.tipo === t.v ? 'text-brand-700' : 'text-slate-700'}`}>{t.label}</p>
              <p className="text-[11px] leading-snug text-slate-400">{t.desc}</p>
            </button>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome *">
            <Input value={form.nome} onChange={(e) => set('nome', e.target.value)} placeholder="Ex.: X-Salada" />
          </Field>
          <Field label="Código interno">
            <Input value={form.codigo_interno} onChange={(e) => set('codigo_interno', e.target.value)} placeholder="gerado automaticamente" />
          </Field>
        </div>

        <div>
          <Field label="Códigos de barras" hint="O primeiro é o principal. Pode ter vários (secundários).">
            <div className="space-y-2">
              {form.codigos_barras.map((c: any, i: number) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={c.codigo}
                    onChange={(e) => {
                      const arr = [...form.codigos_barras];
                      arr[i] = { ...arr[i], codigo: e.target.value };
                      set('codigos_barras', arr);
                    }}
                    placeholder="Digite ou passe o leitor"
                    className="font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const arr = [...form.codigos_barras];
                      arr[i] = { ...arr[i], principal: 1 };
                      arr.forEach((x: any, j: number) => j !== i && (x.principal = 0));
                      set('codigos_barras', arr);
                    }}
                    className={`whitespace-nowrap rounded-lg px-2 py-1.5 text-xs font-bold ${c.principal ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                  >
                    {c.principal ? 'Principal' : 'Secundário'}
                  </button>
                  <button
                    type="button"
                    onClick={() => set('codigos_barras', form.codigos_barras.filter((_: any, j: number) => j !== i))}
                    className="rounded-lg p-1.5 text-red-500 hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={<ScanBarcode className="h-4 w-4" />}
                onClick={() => set('codigos_barras', [...form.codigos_barras, { codigo: '', principal: form.codigos_barras.length === 0 ? 1 : 0 }])}
              >
                Adicionar código
              </Button>
            </div>
          </Field>
        </div>

        {form.tipo === 'composto' ? (
          <div className="rounded-2xl border-2 border-brand-200 bg-brand-50/40 p-4">
            <div className="mb-3 flex items-center gap-2">
              <ChefHat className="h-5 w-5 text-brand-600" />
              <h3 className="text-sm font-bold text-slate-800">Ficha técnica (receita)</h3>
            </div>
            <p className="mb-3 text-xs text-slate-500">
              Adicione os insumos usados em uma unidade deste produto. O CMV é calculado automaticamente e a venda baixa os insumos do estoque.
            </p>
            <div className="space-y-2">
              {form.ficha.map((l: LinhaFicha, i: number) => {
                const ing = insumoById(Number(l.insumo_id));
                const c = custoLinha(Number(l.quantidade || 0), l.unidade, ing?.unidade, ing?.custo);
                const compat = unidadeCompativel(l.unidade, ing?.unidade);
                return (
                  <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-2">
                    <Select value={String(l.insumo_id)} onChange={(e) => setFicha(i, 'insumo_id', e.target.value ? Number(e.target.value) : '')} className="min-w-[180px] flex-1">
                      <option value="">Selecione o insumo...</option>
                      {insumos.map((ins) => (
                        <option key={ins.id} value={ins.id}>
                          {ins.nome} ({ins.unidade})
                        </option>
                      ))}
                    </Select>
                    <Input
                      type="number"
                      step="0.001"
                      min="0"
                      value={l.quantidade}
                      onChange={(e) => setFicha(i, 'quantidade', e.target.value)}
                      placeholder="Qtd"
                      className="w-24"
                    />
                    <Select value={l.unidade} onChange={(e) => setFicha(i, 'unidade', e.target.value)} className="w-20">
                      {UNIDADES.map((u) => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                    </Select>
                    <div className="w-32 text-right">
                      {ing && compat && l.quantidade ? (
                        <p className="text-xs font-bold text-slate-700">{fmtBRL(c ?? 0)}</p>
                      ) : ing && !compat ? (
                        <p className="text-xs font-bold text-red-500">unidade inválida</p>
                      ) : (
                        <p className="text-xs text-slate-400">-</p>
                      )}
                      {ing && (
                        <p className="text-[10px] text-slate-400">
                          {fmtBRL(ing.custo)}/{ing.unidade}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => set('ficha', form.ficha.filter((_: any, j: number) => j !== i))}
                      className="rounded-lg p-1.5 text-red-500 hover:bg-red-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={<Plus className="h-4 w-4" />}
                onClick={() => set('ficha', [...form.ficha, { insumo_id: '', quantidade: '', unidade: form.unidade || 'UN' }])}
              >
                Adicionar insumo
              </Button>
            </div>

            {unidadeIncompativel && (
              <p className="mt-2 text-xs text-red-500">
                {unidadeIncompativel.ing?.nome}: a unidade "{unidadeIncompativel.unidade}" não é compatível com a unidade do insumo ({unidadeIncompativel.ing?.unidade}).
              </p>
            )}

            <div className="mt-4 grid gap-3 rounded-xl bg-white p-3 sm:grid-cols-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">CMV unitário</p>
                <p className="text-lg font-extrabold text-slate-800">{fmtBRL(cmv)}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Preço venda</p>
                <p className="text-lg font-extrabold text-slate-800">{precoNum > 0 ? fmtBRL(precoNum) : '—'}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Lucro</p>
                <p className={`text-lg font-extrabold ${lucro >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{precoNum > 0 ? fmtBRL(lucro) : '—'}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Margem</p>
                <p className={`text-lg font-extrabold ${margem !== null && margem >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                  {margem !== null ? `${margem.toFixed(1)}%` : '—'}
                </p>
              </div>
            </div>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Unidade">
            <Select value={form.unidade} onChange={(e) => set('unidade', e.target.value)}>
              {UNIDADES.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </Select>
          </Field>
          <Field label="Preço venda (R$)">
            <Input type="number" step="0.01" value={form.preco} onChange={(e) => set('preco', e.target.value)} placeholder="0,00" />
          </Field>
          {form.tipo === 'composto' ? (
            <Field label="Custo (R$)" hint="Calculado pela ficha técnica">
              <Input type="number" step="0.01" value={form.tipo === 'composto' ? '' : form.custo} disabled placeholder="automático" />
            </Field>
          ) : (
            <Field label="Custo (R$)">
              <Input type="number" step="0.01" value={form.custo} onChange={(e) => set('custo', e.target.value)} placeholder="0,00" />
            </Field>
          )}
        </div>

        {form.tipo !== 'composto' && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Estoque atual">
              <Input type="number" step="0.001" value={form.estoque_atual} onChange={(e) => set('estoque_atual', e.target.value)} />
            </Field>
            <Field label="Estoque mínimo">
              <Input type="number" step="0.001" value={form.estoque_minimo} onChange={(e) => set('estoque_minimo', e.target.value)} />
            </Field>
            <Field label="Marca">
              <Input value={form.marca} onChange={(e) => set('marca', e.target.value)} />
            </Field>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Validade fechado (dias)">
            <Input type="number" value={form.validade_fabricacao_dias} onChange={(e) => set('validade_fabricacao_dias', e.target.value)} placeholder="ex.: 365" />
          </Field>
          <Field label="Validade após abrir (dias)">
            <Input type="number" value={form.validade_aberto_dias} onChange={(e) => set('validade_aberto_dias', e.target.value)} placeholder="ex.: 5" />
          </Field>
          <Field label="Temperatura">
            <Select value={form.temperatura} onChange={(e) => set('temperatura', e.target.value)}>
              {TEMPERATURAS.map((t) => (
                <option key={t.v} value={t.v}>{t.label}</option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Categorias">
            <div className="flex flex-wrap gap-1.5 rounded-xl border border-slate-200 p-2">
              {categorias.map((c) => {
                const on = form.categoria_ids.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() =>
                      set('categoria_ids', on ? form.categoria_ids.filter((x: number) => x !== c.id) : [...form.categoria_ids, c.id])
                    }
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${on ? 'text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                    style={on ? { backgroundColor: c.cor } : undefined}
                  >
                    {c.categoria_pai_id ? `↳ ${c.categoria_pai_nome} / ${c.nome}` : c.nome}
                  </button>
                );
              })}
              {categorias.length === 0 && <p className="text-xs text-slate-400">Nenhuma categoria cadastrada</p>}
            </div>
          </Field>
          <Field label="Fornecedor">
            <Select value={form.fornecedor_id} onChange={(e) => set('fornecedor_id', e.target.value)}>
              <option value="">Sem fornecedor</option>
              {fornecedores.map((f) => (
                <option key={f.id} value={f.id}>{f.nome}</option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Observações">
          <Textarea rows={2} value={form.observacoes} onChange={(e) => set('observacoes', e.target.value)} />
        </Field>

        <Field label="Observações automáticas" hint="Aparecem como atalhos ao lançar o produto no PDV/comanda.">
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5 rounded-xl border border-slate-200 p-2">
              {form.comentarios.map((c: string, i: number) => (
                <span key={i} className="flex items-center gap-1 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
                  {c}
                  <button
                    type="button"
                    onClick={() => set('comentarios', form.comentarios.filter((_: string, j: number) => j !== i))}
                    className="rounded-full text-red-400 hover:text-red-600"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {form.comentarios.length === 0 && (
                <p className="text-xs text-slate-400">Nenhuma observação cadastrada</p>
              )}
            </div>
            <div className="flex gap-2">
              <Input
                value={novoComentario}
                onChange={(e) => setNovoComentario(e.target.value)}
                placeholder="Ex.: sem cebola, bem passado..."
                onKeyDown={(e) => e.key === 'Enter' && adicionarComentario()}
              />
              <Button
                type="button"
                variant="secondary"
                icon={<Plus className="h-4 w-4" />}
                onClick={adicionarComentario}
                disabled={!novoComentario.trim()}
              >
                Adicionar
              </Button>
            </div>
          </div>
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl bg-slate-50 px-4 py-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-700">Aparece no Restaurante</p>
                <p className="text-[11px] text-slate-400">Disponível para lançar em comandas de mesa</p>
              </div>
              <Toggle checked={form.exibir_restaurante} onChange={(v) => set('exibir_restaurante', v)} />
            </div>
          </div>
          <div className="rounded-xl bg-slate-50 px-4 py-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-700">Aparece no PDV (Mercado)</p>
                <p className="text-[11px] text-slate-400">Disponível na venda rápida do PDV</p>
              </div>
              <Toggle checked={form.exibir_mercado} onChange={(v) => set('exibir_mercado', v)} />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-slate-700">Produto ativo</p>
            <p className="text-[11px] text-slate-400">Inativos não aparecem no PDV</p>
          </div>
          <Toggle checked={form.ativo} onChange={(v) => set('ativo', v)} />
        </div>

        {produto && produto.preco != null && (
          <p className="text-xs text-slate-400">Preço atual: {fmtBRL(produto.preco)} · Estoque atual: {produto.estoque_atual} {produto.unidade}</p>
        )}

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={saving} icon={<Boxes className="h-4 w-4" />}>
            {produto ? 'Salvar alterações' : 'Cadastrar produto'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
