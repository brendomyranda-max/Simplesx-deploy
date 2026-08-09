import { useEffect, useState } from 'react';
import { PackagePlus, ScanBarcode, CheckCircle2, Search, History } from 'lucide-react';
import { AnimatedPage } from '@/components/anim';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Spinner, useToast } from '@/components/ui';
import { ProdutoForm } from '@/components/forms/ProdutoForm';
import { produtoApi, estoqueApi, fornecedorApi, categoriaApi, configApi } from '@/lib/api';
import type { Produto, Fornecedor, ConfigEmpresa, MovimentacaoEstoque } from '@/lib/types';
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
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [config, setConfig] = useState<ConfigEmpresa | null>(null);
  const [movs, setMovs] = useState<MovimentacaoEstoque[]>([]);
  const [loadMov, setLoadMov] = useState(true);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    fornecedorApi.list().then(setFornecedores).catch(() => {});
    configApi.get().then(setConfig).catch(() => {});
    estoqueApi
      .movimentacoes({ tipo: 'entrada' })
      .then(setMovs)
      .catch(() => {})
      .finally(() => setLoadMov(false));
  }, []);

  const buscar = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const c = codigo.trim();
    if (!c) return;
    try {
      const p = await produtoApi.buscar(c);
      setProduto(p);
      setProdutoNaoEncontrado(false);
      setCusto(p.custo ? String(p.custo) : '');
      setTemperatura(p.temperatura || '');
      setFornecedorId(p.fornecedor_id ? String(p.fornecedor_id) : '');
      setQtd('1');
    } catch {
      setProduto(null);
      setProdutoNaoEncontrado(true);
    }
  };

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!produto) return;
    setSalvando(true);
    try {
      await estoqueApi.entrada({
        produto_id: produto.id,
        quantidade: Number(qtd || 0),
        custo_unitario: custo === '' ? undefined : Number(custo),
        data_fabricacao: dataFabricacao || undefined,
        data_validade: dataValidade || undefined,
        temperatura: temperatura || undefined,
        fornecedor_id: fornecedorId ? Number(fornecedorId) : undefined,
        nota_fiscal: notaFiscal || undefined,
        responsavel: responsavel || undefined,
      });
      toast('success', `Entrada de ${qtd} ${produto.unidade} de ${produto.nome} registrada`);
      setProduto(null);
      setCodigo('');
      setQtd('1');
      setCusto('');
      setDataFabricacao('');
      setDataValidade('');
      setNotaFiscal('');
      const [p] = await Promise.all([produtoApi.list()]);
      const atual = p.find((x) => x.id === produto.id);
      if (atual) setProduto(atual);
      estoqueApi.movimentacoes({ tipo: 'entrada' }).then(setMovs).catch(() => {});
    } catch (err: any) {
      toast('error', err?.error || 'Erro na entrada');
    } finally {
      setSalvando(false);
    }
  };

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

            {produtoNaoEncontrado && (
              <div className="mt-4 flex items-center justify-between rounded-xl bg-amber-50 p-3 text-sm">
                <p className="text-amber-700">Produto com código <b>{codigo}</b> não encontrado.</p>
                <Button size="sm" variant="warning" onClick={() => setNovoProduto(true)}>Cadastrar agora</Button>
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
                  <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                </div>

                <form onSubmit={salvar} className="grid gap-3 sm:grid-cols-2">
                  <Field label="Quantidade">
                    <Input type="number" step="0.001" value={qtd} onChange={(e) => setQtd(e.target.value)} />
                  </Field>
                  <Field label="Custo unitário (R$)" hint="vazio usa o custo atual">
                    <Input type="number" step="0.01" value={custo} onChange={(e) => setCusto(e.target.value)} placeholder={fmtBRL(produto.custo)} />
                  </Field>
                  <Field label="Data de fabricação">
                    <Input type="date" value={dataFabricacao} onChange={(e) => setDataFabricacao(e.target.value)} />
                  </Field>
                  <Field label="Data de validade">
                    <Input type="date" value={dataValidade} onChange={(e) => setDataValidade(e.target.value)} />
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

            {!produto && !produtoNaoEncontrado && (
              <div className="mt-4 flex flex-col items-center py-10 text-center">
                <ScanBarcode className="mb-2 h-10 w-10 text-slate-300" />
                <p className="text-sm text-slate-400">Passe o código de barras para começar</p>
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
        onSaved={() => {
          setNovoProduto(false);
          setCodigo(produtoNaoEncontrado ? codigo : '');
        }}
      />
    </AnimatedPage>
  );
}
