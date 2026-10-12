import { useEffect, useMemo, useState } from 'react';
import { Boxes, RefreshCw } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Field, Input, Select, Spinner, useToast } from '@/components/ui';
import { relatorioApi } from '@/lib/api';
import { fmtBRL, fmtNum } from '@/lib/format';
import { filtrarProdutosCmv, type OrdemCmv } from '@/lib/relatorio-cmv';
import type { RelatorioCmv } from '@/lib/types';

export function CmvProdutos() {
  const toast = useToast();
  const [dados, setDados] = useState<RelatorioCmv>({ produtos: [], categorias: [] });
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(false);
  const [categoria, setCategoria] = useState('');
  const [busca, setBusca] = useState('');
  const [ordem, setOrdem] = useState<OrdemCmv>('lucro_desc');

  const carregar = async () => {
    setCarregando(true);
    setErro(false);
    try { setDados(await relatorioApi.cmvProdutos()); }
    catch (error: any) { setErro(true); toast('error', error?.error || 'Não foi possível carregar o CMV'); }
    finally { setCarregando(false); }
  };
  useEffect(() => { void carregar(); }, []);
  const produtos = useMemo(() => filtrarProdutosCmv(dados.produtos, dados.categorias, categoria, busca, ordem), [dados, categoria, busca, ordem]);

  return (
    <div className="mt-4 space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-800">CMV por produto</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">Preços e custos atuais do cadastro, inclusive o custo da ficha técnica dos produtos compostos. Esta lista não depende do período de vendas.</p>
            <p className="mt-1 max-w-3xl text-xs text-slate-500">Lucro bruto unitário = preço − custo. Margem = lucro ÷ preço. CMV = custo ÷ preço. Não inclui despesas, impostos, descontos ou taxa de serviço.</p>
          </div>
          <Button variant="secondary" size="sm" icon={<RefreshCw className="h-4 w-4" />} loading={carregando} onClick={carregar}>Atualizar custos</Button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Buscar produto">
            <Input aria-label="Buscar produto no CMV" placeholder="Nome ou código" value={busca} onChange={(event) => setBusca(event.target.value)} />
          </Field>
          <Field label="Categoria" hint="Categorias principais incluem suas subcategorias.">
            <Select aria-label="Categoria do CMV" value={categoria} onChange={(event) => setCategoria(event.target.value)}>
              <option value="">Todas as categorias</option>
              <option value="sem">Sem categoria</option>
              {dados.categorias.map((item) => {
                const pai = dados.categorias.find((outro) => outro.id === item.categoria_pai_id);
                return <option key={item.id} value={item.id}>{pai ? `${pai.nome} / ` : ''}{item.nome}</option>;
              })}
            </Select>
          </Field>
          <Field label="Ordenar por">
            <Select aria-label="Ordenação do CMV" value={ordem} onChange={(event) => setOrdem(event.target.value as OrdemCmv)}>
              <option value="lucro_desc">Maior lucro unitário → menor</option>
              <option value="lucro_asc">Menor lucro unitário → maior</option>
              <option value="margem_desc">Maior margem (%) → menor</option>
              <option value="margem_asc">Menor margem (%) → maior</option>
              <option value="categoria">Categoria (A–Z)</option>
              <option value="nome">Produto (A–Z)</option>
            </Select>
          </Field>
        </div>
      </Card>
      {carregando ? <Spinner label="Calculando CMV dos produtos..." /> : erro ? (
        <Card><EmptyState icon={<Boxes className="h-8 w-8" />} title="Não foi possível carregar os produtos" subtitle="Use Atualizar custos para tentar novamente." /></Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Badge color="blue">{produtos.length} produto(s)</Badge>
            {produtos.some((item) => item.custo === 0) && <Badge color="amber">{produtos.filter((item) => item.custo === 0).length} com custo zerado — confira o cadastro</Badge>}
            {produtos.some((item) => item.lucro_unitario === null) && <Badge color="slate">{produtos.filter((item) => item.lucro_unitario === null).length} sem preço de venda</Badge>}
          </div>
          {produtos.length === 0 ? (
            <Card><EmptyState icon={<Boxes className="h-8 w-8" />} title="Nenhum produto encontrado" subtitle="Cadastre produtos ou ajuste a busca e a categoria." /></Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="max-h-[640px] overflow-auto">
                <table className="w-full whitespace-nowrap">
                  <thead className="sticky top-0 bg-slate-50"><tr>
                    <th className="th">Produto</th><th className="th">Categorias</th><th className="th">Unidade</th>
                    <th className="th text-right">Custo unitário</th><th className="th text-right">Preço de venda</th>
                    <th className="th text-right">Lucro bruto / un.</th><th className="th text-right">Margem (%)</th><th className="th text-right">CMV (%)</th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {produtos.map((item) => (
                      <tr key={item.id}>
                        <td className="td"><p className="font-semibold text-slate-800">{item.nome}</p><p className="text-xs text-slate-400">{item.codigo_interno || 'Sem código'}{item.tipo === 'composto' ? ' · Ficha técnica' : ''}</p></td>
                        <td className="td whitespace-normal">{item.categorias.map((cat) => cat.nome).join(', ') || 'Sem categoria'}</td>
                        <td className="td">{item.unidade}</td>
                        <td className={`td text-right ${item.custo === 0 ? 'text-amber-700' : 'text-slate-600'}`}>{fmtBRL(item.custo)}</td>
                        <td className="td text-right">{item.preco !== null && item.preco > 0 ? fmtBRL(item.preco) : '—'}</td>
                        <td className={`td text-right font-bold ${(item.lucro_unitario ?? 0) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{item.lucro_unitario === null ? '—' : fmtBRL(item.lucro_unitario)}</td>
                        <td className={`td text-right font-semibold ${(item.margem_pct ?? 0) < 0 ? 'text-red-600' : 'text-slate-700'}`}>{item.margem_pct === null ? '—' : `${fmtNum(item.margem_pct, 1)}%`}</td>
                        <td className="td text-right text-slate-500">{item.cmv_pct === null ? '—' : `${fmtNum(item.cmv_pct, 1)}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
