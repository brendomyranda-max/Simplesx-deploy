import { useEffect, useState } from 'react';
import { ReceiptText, RotateCcw, Search, Store, UtensilsCrossed } from 'lucide-react';
import { AnimatedPage } from '@/components/anim';
import { Badge, Button, Card, EmptyState, Field, IconButton, Input, Modal, Spinner, useConfirm, useToast } from '@/components/ui';
import { vendaApi } from '@/lib/api';
import type { Venda, VendaItem, Pagamento } from '@/lib/types';
import { fmtBRL, fmtData, fmtNum, formaLabel, hojeLocal, addDiasLocal } from '@/lib/format';

export function VendasPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [vendas, setVendas] = useState<Venda[]>([]);
  const [de, setDe] = useState(addDiasLocal(-30));
  const [ate, setAte] = useState(hojeLocal());
  const [load, setLoad] = useState(true);
  const [busca, setBusca] = useState('');
  const [detalhe, setDetalhe] = useState<Venda | null>(null);
  const [detalheLoad, setDetalheLoad] = useState(false);

  const carregar = async () => {
    setLoad(true);
    try {
      const lista = await vendaApi.list({ de, ate });
      setVendas(lista);
    } catch (e: any) {
      toast('error', e?.error || 'Erro ao carregar vendas');
    } finally {
      setLoad(false);
    }
  };

  useEffect(() => {
    carregar();
  }, [de, ate]);

  const abrirDetalhe = async (v: Venda) => {
    setDetalheLoad(true);
    setDetalhe(v);
    try {
      const completa = await vendaApi.get(v.id);
      setDetalhe(completa);
    } catch (e: any) {
      toast('error', e?.error || 'Erro ao carregar venda');
    } finally {
      setDetalheLoad(false);
    }
  };

  const cancelar = (v: Venda) => {
    confirm(
      `Cancelar a venda ${v.numero}?`,
      'O estoque será devolvido e o valor estornado do financeiro. Não é possível desfazer.',
      async () => {
        await vendaApi.cancelar(v.id);
        toast('success', `Venda ${v.numero} cancelada`);
        setDetalhe(null);
        carregar();
      }
    );
  };

  const filtradas = busca
    ? vendas.filter((v) => v.numero.toLowerCase().includes(busca.toLowerCase()) || (v.responsavel || '').toLowerCase().includes(busca.toLowerCase()))
    : vendas;

  const somaTotal = filtradas.reduce((s, v) => s + v.total, 0);
  const somaHoje = vendas.filter((v) => v.status === 'concluida').reduce((s, v) => s + v.total, 0);

  return (
    <AnimatedPage>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-800">Histórico de Vendas</h1>
          <p className="text-sm text-slate-500">
            {filtradas.length} vendas · {fmtBRL(somaTotal)}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="De"><Input type="date" value={de} onChange={(e) => setDe(e.target.value)} /></Field>
          <Field label="Até"><Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></Field>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input className="w-52 pl-9" placeholder="Buscar por nº ou vendedor..." value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
        </div>
      </div>

      {load ? (
        <Spinner />
      ) : filtradas.length === 0 ? (
        <Card>
          <EmptyState icon={<ReceiptText className="h-8 w-8" />} title="Nenhuma venda no período" subtitle="As vendas feitas no PDV aparecem aqui" />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Venda</th>
                  <th className="th">Tipo</th>
                  <th className="th">Vendedor</th>
                  <th className="th text-right">Total</th>
                  <th className="th">Status</th>
                  <th className="th text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtradas.map((v) => (
                  <tr key={v.id} className="cursor-pointer transition-colors hover:bg-slate-50/60" onClick={() => abrirDetalhe(v)}>
                    <td className="td">
                      <p className="font-semibold text-slate-800">{v.numero}</p>
                      <p className="text-[11px] text-slate-400">{fmtData(v.criado_em)}</p>
                    </td>
                    <td className="td">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                        {v.tipo === 'restaurante' ? <UtensilsCrossed className="h-3.5 w-3.5" /> : <Store className="h-3.5 w-3.5" />}
                        {v.tipo === 'restaurante' ? 'Restaurante' : 'Mercado'}
                      </span>
                    </td>
                    <td className="td text-slate-500">{v.responsavel || '-'}</td>
                    <td className="td text-right font-bold text-slate-800">{fmtBRL(v.total)}</td>
                    <td className="td">
                      <Badge color={v.status === 'concluida' ? 'green' : 'red'}>
                        {v.status === 'concluida' ? 'Concluída' : 'Cancelada'}
                      </Badge>
                    </td>
                    <td className="td">
                      <div className="flex justify-end gap-1">
                        {v.status === 'concluida' && (
                          <div onClick={(e) => e.stopPropagation()}>
                            <IconButton
                              label="Cancelar venda"
                              variant="danger"
                              icon={<RotateCcw className="h-4 w-4" />}
                              onClick={() => cancelar(v)}
                            />
                          </div>
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

      <Modal open={!!detalhe} onClose={() => setDetalhe(null)} title={detalhe ? `Venda ${detalhe.numero}` : ''} width="max-w-2xl">
        {detalhe && (
          <div className="space-y-4">
            {detalheLoad ? (
              <Spinner />
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge color={detalhe.status === 'concluida' ? 'green' : 'red'}>
                      {detalhe.status === 'concluida' ? 'Concluída' : 'Cancelada'}
                    </Badge>
                    <span className="text-xs text-slate-400">{fmtData(detalhe.criado_em)}</span>
                  </div>
                  <span className="text-xs text-slate-500">
                    {detalhe.tipo === 'restaurante' ? 'Restaurante' : 'Mercado'} · vendedor: {detalhe.responsavel || '-'}
                  </span>
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="th">Item</th>
                        <th className="th text-right">Qtd</th>
                        <th className="th text-right">Preço</th>
                        <th className="th text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(detalhe.itens || []).map((i: VendaItem) => (
                        <tr key={i.id}>
                          <td className="td font-medium text-slate-800">{i.nome}</td>
                          <td className="td text-right">{fmtNum(i.quantidade)}</td>
                          <td className="td text-right text-slate-500">{fmtBRL(i.preco_unitario)}</td>
                          <td className="td text-right font-semibold">{fmtBRL(i.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="rounded-xl bg-slate-50 p-4">
                  <div className="flex justify-between text-sm text-slate-500">
                    <span>Subtotal</span>
                    <span>{fmtBRL(detalhe.subtotal)}</span>
                  </div>
                  {detalhe.desconto > 0 && (
                    <div className="flex justify-between text-sm text-red-600">
                      <span>Desconto</span>
                      <span>-{fmtBRL(detalhe.desconto)}</span>
                    </div>
                  )}
                  {detalhe.taxa_servico > 0 && (
                    <div className="flex justify-between text-sm text-slate-500">
                      <span>Taxa de serviço</span>
                      <span>{fmtBRL(detalhe.taxa_servico)}</span>
                    </div>
                  )}
                  <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 text-base font-extrabold text-slate-800">
                    <span>Total</span>
                    <span>{fmtBRL(detalhe.total)}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(detalhe.pagamentos || []).map((p: Pagamento, i: number) => (
                      <Badge key={i} color="blue">{formaLabel(p.forma)} · {fmtBRL(p.valor)}</Badge>
                    ))}
                  </div>
                </div>

                {detalhe.status === 'concluida' && (
                  <div className="flex justify-end">
                    <Button variant="danger" icon={<RotateCcw className="h-4 w-4" />} onClick={() => cancelar(detalhe)}>
                      Cancelar venda
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </Modal>
    </AnimatedPage>
  );
}
