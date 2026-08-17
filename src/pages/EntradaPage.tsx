import { useEffect, useState } from 'react';
import { PackagePlus, ScanBarcode, CheckCircle2, Search, History, Link2, X } from 'lucide-react';
import { AnimatedPage } from '@/components/anim';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Spinner, useToast } from '@/components/ui';
import { ProdutoForm } from '@/components/forms/ProdutoForm';
import { produtoApi, estoqueApi, fornecedorApi, categoriaApi, configApi } from '@/lib/api';
import type { Produto, Fornecedor, Categoria, ConfigEmpresa, MovimentacaoEstoque } from '@/lib/types';
import { fmtBRL, fmtData, fmtNum, hojeLocal } from '@/lib/format';

export function EntradaPage() {
  const toast = useToast();
  const [produto, setProduto] = useState<Produto | null>(null);
  const [codigo, setCodigo] = useState('');
  const [qtd, setQtd] = useState('1');
  const [custo, setCusto] = useState('');
  const [dataFabricacao, setDataFabricacao] = useState('');
  const [dataValidade, setDataValidade] = useState('');
  const [temperatura, setTemperatura] = useState('');
  const [fornecedorId, setFornecedorId] = useState('');
  const [notaFiscal, setNotaFiscal] = useState('');
  const [responsavel, setResponsavel] = useState('');
  const [produtoNaoEncontrado, setProdutoNaoEncontrado] = useState(false);
  const [novoProduto, setNovoProduto] = useState(false);
  const [vincularCodigo, setVincularCodigo] = useState(false);
  const [produtoVinculoId, setProdutoVinculoId] = useState('');
  const [buscaProduto, setBuscaProduto] = useState('');
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [categoriaFiltro, setCategoriaFiltro] = useState('');
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [config, setConfig] = useState<ConfigEmpresa | null>(null);
  const [movs, setMovs] = useState<MovimentacaoEstoque[]>([]);
  const [loadMov, setLoadMov] = useState(true);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    fornecedorApi.list().then(setFornecedores).catch(() => {});
    configApi.get().then(setConfig).catch(() => {});
    produtoApi.list().then(setProdutos).catch(() => {});
    categoriaApi.list().then(setCategorias).catch(() => {});
    estoqueApi
      .movimentacoes({ tipo: 'entrada' })
      .then(setMovs)
      .catch(() => {})
      .finally(() => setLoadMov(false));
  }, []);

  const selecionarProduto = (p: Produto) => {
      setProduto(p);
      setProdutoNaoEncontrado(false);
      setCusto(p.custo ? String(p.custo) : '');
      setTemperatura(p.temperatura || '');
      setFornecedorId(p.fornecedor_id ? String(p.fornecedor_id) : '');
      setQtd('1');
      const fabricacao = hojeLocal();
      const vencimento = new Date(`${fabricacao}T12:00:00`);
      vencimento.setDate(vencimento.getDate() + Number(p.validade_fabricacao_dias || 0));
      setDataFabricacao(fabricacao);
      setDataValidade(p.validade_fabricacao_dias ? vencimento.toLocaleDateString('sv-SE') : '');
  };

  const buscar = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const c = codigo.trim();
    if (!c) return;
    try {
      const p = await produtoApi.buscar(c);
      selecionarProduto(p);
    } catch {
      setProduto(null);
      setProdutoNaoEncontrado(true);
    }
  };

  const confirmarVinculo = async () => {
    if (!produtoVinculoId) return toast('error', 'Selecione o produto correspondente');
    setSalvando(true);
    try {
      const p = await produtoApi.adicionarCodigo(Number(produtoVinculoId), codigo.trim());
      setProdutos((lista) => lista.map((x) => x.id === p.id ? p : x));
      selecionarProduto(p);
      setVincularCodigo(false);
      setProdutoVinculoId('');
      setBuscaProduto('');
      toast('success', `Código vinculado a ${p.nome}`);
    } catch (err: any) { toast('error', err?.error || 'Não foi possível vincular o código'); }
    finally { setSalvando(false); }
  };

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!produto) return;
    if (!dataFabricacao || !dataValidade) return toast('error', 'Informe as datas de fabricação e vencimento');
    setSalvando(true);
    try {
      const entrada = await estoqueApi.entrada({
        produto_id: produto.id,
        quantidade: Number(qtd || 0),
        custo_unitario: custo === '' ? undefined : Number(custo),
        data_fabricacao: dataFabricacao || undefined,
        data_validade: dataValidade || undefined,
        temperatura: temperatura || undefined,
        fornecedor_id: fornecedorId ? Number(fornecedorId) : undefined,
        nota_fiscal: notaFiscal || undefined,
        responsavel: responsavel || undefined,
        codigo_barras: codigo.trim() || undefined,
      });
      toast('success', `Entrada registrada. Novo estoque de ${produto.nome}: ${fmtNum(entrada.novo_saldo)} ${produto.unidade}`);
      const atualizado: Produto = {
        ...produto,
        estoque_atual: entrada.novo_saldo,
        custo: entrada.custo_medio,
        codigos_barras: entrada.codigo_barras && !produto.codigos_barras?.some((c) => c.codigo === entrada.codigo_barras)
          ? [...(produto.codigos_barras || []), { codigo: entrada.codigo_barras, principal: produto.codigos_barras?.length ? 0 : 1 }]
          : produto.codigos_barras,
      };
      setProduto(atualizado);
      setProdutos((lista) => lista.map((p) => p.id === atualizado.id ? atualizado : p));
      setCodigo('');
      setQtd('1');
      setCusto('');
      setDataFabricacao('');
      setDataValidade('');
      setNotaFiscal('');
      estoqueApi.movimentacoes({ tipo: 'entrada' }).then(setMovs).catch(() => {});
    } catch (err: any) {
      toast('error', err?.error || 'Erro na entrada');
    } finally {
      setSalvando(false);
    }
  };

  const produtosFiltrados = produtos.filter((p) => {
    const termo = buscaProduto.trim().toLowerCase();
    const texto = `${p.nome} ${p.codigo_interno || ''} ${(p.codigos_barras || []).map((c) => c.codigo).join(' ')}`.toLowerCase();
    const categoriaOk = !categoriaFiltro || (p.categorias || []).some((c) => {
      const cadastro = categorias.find((cat) => cat.id === c.id);
      return String(c.id) === categoriaFiltro || String(cadastro?.categoria_pai_id || '') === categoriaFiltro;
    });
    return categoriaOk && (!termo || texto.includes(termo));
  });

  return (
    <AnimatedPage>
      <div className="mb-5">
        <h1 className="text-xl font-extrabold tracking-tight text-slate-800">Entrada de Mercadorias</h1>
        <p className="text-sm text-slate-500">Registre entradas, lotes e validades</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <Card className="p-5">
            <form onSubmit={buscar}>
              <Field label="Passe o código de barras ou código interno">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <ScanBarcode className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      autoFocus
                      className="pl-9 font-mono"
                      placeholder="Ex.: 7894900011517"
                      value={codigo}
                      onChange={(e) => setCodigo(e.target.value)}
                    />
                  </div>
                  <Button type="submit" icon={<Search className="h-4 w-4" />}>Buscar</Button>
                </div>
              </Field>
            </form>

            <div className="my-4 flex items-center gap-3">
              <div className="h-px flex-1 bg-slate-200" />
              <span className="text-xs font-bold uppercase text-slate-400">ou pesquise o produto</span>
              <div className="h-px flex-1 bg-slate-200" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nome, código interno ou barras">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input className="pl-9" value={buscaProduto} onChange={(e) => setBuscaProduto(e.target.value)} placeholder="Ex.: arroz" />
                </div>
              </Field>
              <Field label="Categoria">
                <Select value={categoriaFiltro} onChange={(e) => setCategoriaFiltro(e.target.value)}>
                  <option value="">Todas as categorias</option>
                  {categorias.filter((c) => !c.categoria_pai_id).map((c) => (
                    <optgroup key={c.id} label={c.nome}>
                      <option value={c.id}>{c.nome} (toda)</option>
                      {categorias.filter((s) => s.categoria_pai_id === c.id).map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
                    </optgroup>
                  ))}
                </Select>
              </Field>
            </div>
            {(buscaProduto || categoriaFiltro) && !produto && (
              <div className="mt-3 max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
                {produtosFiltrados.slice(0, 40).map((p) => (
                  <button key={p.id} type="button" onClick={() => { selecionarProduto(p); setCodigo(''); }} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-brand-50">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-slate-700">{p.nome}</p>
                      <p className="text-[11px] text-slate-400">{p.codigo_interno || 'Sem código interno'} · {(p.categorias || []).map((c) => c.nome).join(', ') || 'Sem categoria'}</p>
                    </div>
                    <Badge color="blue">Estoque {fmtNum(p.estoque_atual)}</Badge>
                  </button>
                ))}
                {!produtosFiltrados.length && <p className="p-4 text-center text-sm text-slate-400">Nenhum produto encontrado</p>}
              </div>
            )}

            {produtoNaoEncontrado && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-amber-50 p-3 text-sm">
                <p className="text-amber-700">Produto com código <b>{codigo}</b> não encontrado.</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" icon={<Link2 className="h-4 w-4" />} onClick={() => setVincularCodigo(true)}>Vincular a produto existente</Button>
                  <Button size="sm" variant="warning" onClick={() => setNovoProduto(true)}>Cadastrar produto novo</Button>
                </div>
              </div>
            )}

            {produto && (
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
                <div className="mb-3 flex items-start justify-between">
                  <div>
                    <p className="text-base font-bold text-slate-800">{produto.nome}</p>
                    <p className="text-xs text-slate-500">
                      {produto.codigo_interno} · {produto.unidade} · Estoque atual: <b>{fmtNum(produto.estoque_atual)}</b>
                    </p>
                    {produto.categorias?.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {produto.categorias.map((c) => (
                          <Badge key={c.id} className="!bg-white">{c.nome}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                    <button type="button" title="Trocar produto" onClick={() => { setProduto(null); setCodigo(''); }} className="rounded-lg p-1 text-slate-400 hover:bg-white hover:text-slate-700"><X className="h-4 w-4" /></button>
                  </div>
                </div>

                <form onSubmit={salvar} className="grid gap-3 sm:grid-cols-2">
                  <Field label="Código de barras ou QR recebido" hint="Se for novo, será adicionado a este produto">
                    <div className="relative">
                      <ScanBarcode className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <Input className="pl-9 font-mono" value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Opcional" />
                    </div>
                  </Field>
                  <Field label="Quantidade">
                    <Input type="number" step="0.001" value={qtd} onChange={(e) => setQtd(e.target.value)} />
                  </Field>
                  <Field label="Custo unitário (R$)" hint="vazio usa o custo atual">
                    <Input type="number" step="0.01" value={custo} onChange={(e) => setCusto(e.target.value)} placeholder={fmtBRL(produto.custo)} />
                  </Field>
                  <Field label="Data de fabricação *">
                    <Input type="date" value={dataFabricacao} onChange={(e) => setDataFabricacao(e.target.value)} />
                  </Field>
                  <Field label="Data de vencimento *">
                    <Input type="date" min={dataFabricacao || undefined} value={dataValidade} onChange={(e) => setDataValidade(e.target.value)} />
                  </Field>
                  <Field label="Temperatura">
                    <Select value={temperatura} onChange={(e) => setTemperatura(e.target.value)}>
                      <option value="">Ambiente</option>
                      <option value="refrigerado">Refrigerado</option>
                      <option value="congelado">Congelado</option>
                    </Select>
                  </Field>
                  <Field label="Fornecedor">
                    <Select value={fornecedorId} onChange={(e) => setFornecedorId(e.target.value)}>
                      <option value="">Sem fornecedor</option>
                      {fornecedores.map((f) => (
                        <option key={f.id} value={f.id}>{f.nome}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Nota fiscal">
                    <Input value={notaFiscal} onChange={(e) => setNotaFiscal(e.target.value)} />
                  </Field>
                  <Field label="Responsável">
                    <Input value={responsavel} onChange={(e) => setResponsavel(e.target.value)} />
                  </Field>
                  <div className="sm:col-span-2">
                    <Button type="submit" loading={salvando} className="w-full" size="lg" icon={<PackagePlus className="h-5 w-5" />}>
                      Registrar entrada ({fmtNum(Number(qtd || 0))} {produto.unidade})
                    </Button>
                  </div>
                </form>
              </div>
            )}

            {!produto && !produtoNaoEncontrado && !buscaProduto && !categoriaFiltro && (
              <div className="mt-4 flex flex-col items-center py-10 text-center">
                <ScanBarcode className="mb-2 h-10 w-10 text-slate-300" />
                <p className="text-sm text-slate-400">Passe o código ou pesquise por nome e categoria</p>
              </div>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-700">
              <History className="h-4 w-4" /> Últimas entradas
            </h2>
            {loadMov ? (
              <Spinner />
            ) : movs.length === 0 ? (
              <EmptyState icon={<PackagePlus className="h-6 w-6" />} title="Nenhuma entrada registrada" />
            ) : (
              <div className="max-h-80 space-y-2 overflow-y-auto">
                {movs.slice(0, 30).map((m) => (
                  <div key={m.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-700">{m.produto_nome}</p>
                      <p className="text-[11px] text-slate-400">{fmtData(m.criado_em)} · {m.observacoes || ''}</p>
                    </div>
                    <Badge color="green">+{fmtNum(m.quantidade)}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-bold text-slate-700">Dicas</h2>
            <ul className="space-y-2 text-sm text-slate-500">
              <li className="flex gap-2"><span className="text-brand-500">•</span> O lote com validade é registrado automaticamente e aparece no Controle de Validade.</li>
              <li className="flex gap-2"><span className="text-brand-500">•</span> A entrada atualiza o estoque e o custo médio do produto.</li>
              <li className="flex gap-2"><span className="text-brand-500">•</span> Use a <b>Nota fiscal</b> para rastrear a origem da mercadoria.</li>
              <li className="flex gap-2"><span className="text-brand-500">•</span> Produtos novos podem ser cadastrados direto daqui.</li>
              <li className="flex gap-2"><span className="text-brand-500">•</span> Um mesmo produto pode ter vários códigos de barras de fornecedores ou embalagens.</li>
            </ul>
            {config?.modo === 'estoque' && (
              <p className="mt-3 rounded-xl bg-blue-50 p-3 text-xs text-blue-700">
                Modo <b>Controle de Estoque</b> ativo: preço não é obrigatório.
              </p>
            )}
          </Card>
        </div>
      </div>

      <ProdutoForm
        open={novoProduto}
        onClose={() => setNovoProduto(false)}
        codigoInicial={produtoNaoEncontrado ? codigo.trim() : ''}
        onSaved={(salvo) => {
          setNovoProduto(false);
          if (salvo) {
            setProdutos((lista) => [...lista.filter((p) => p.id !== salvo.id), salvo].sort((a, b) => a.nome.localeCompare(b.nome)));
            selecionarProduto(salvo);
          }
        }}
      />
      <Modal open={vincularCodigo} onClose={() => setVincularCodigo(false)} title="Vincular novo código de barras" width="max-w-lg">
        <div className="space-y-4">
          <div className="rounded-xl bg-blue-50 p-3 text-sm text-blue-700">
            O código <b className="font-mono">{codigo}</b> será adicionado ao produto escolhido. O estoque continuará unificado.
          </div>
          <Field label="Buscar produto">
            <Input value={buscaProduto} onChange={(e) => setBuscaProduto(e.target.value)} placeholder="Nome ou código interno" autoFocus />
          </Field>
          <Field label="Produto correspondente *">
            <Select value={produtoVinculoId} onChange={(e) => setProdutoVinculoId(e.target.value)}>
              <option value="">Selecione...</option>
              {produtos.filter((p) => `${p.nome} ${p.codigo_interno}`.toLowerCase().includes(buscaProduto.toLowerCase())).map((p) => (
                <option key={p.id} value={p.id}>{p.nome} · {p.codigo_interno || 'sem código'} · estoque {fmtNum(p.estoque_atual)}</option>
              ))}
            </Select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={salvando} onClick={() => setVincularCodigo(false)}>Cancelar</Button>
            <Button loading={salvando} icon={<Link2 className="h-4 w-4" />} onClick={confirmarVinculo}>Vincular e continuar entrada</Button>
          </div>
        </div>
      </Modal>
    </AnimatedPage>
  );
}
