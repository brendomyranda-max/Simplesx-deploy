import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UtensilsCrossed, Users, Plus, Pencil, Trash2, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { AnimatedPage } from '@/components/anim';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Spinner, useConfirm, useToast } from '@/components/ui';
import { mesaApi, funcionarioApi } from '@/lib/api';
import type { Mesa, Funcionario } from '@/lib/types';
import { fmtBRL, fmtHora } from '@/lib/format';

export function RestaurantePage() {
  const toast = useToast();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [data, setData] = useState<{ mesas: Mesa[]; comandas: any[] }>({ mesas: [], comandas: [] });
  const [load, setLoad] = useState(true);
  const [abrir, setAbrir] = useState<Mesa | null>(null);
  const [garcom, setGarcom] = useState('');
  const [cliente, setCliente] = useState('');
  const [pessoas, setPessoas] = useState('1');
  const [novaMesa, setNovaMesa] = useState(false);
  const [mNumero, setMNumero] = useState('');
  const [mCapacidade, setMCapacidade] = useState('4');
  const [mSetor, setMSetor] = useState('Salão');
  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([]);

  useEffect(() => {
    const fixo = localStorage.getItem('simplesx_garcom_fixo') || '';
    if (fixo) setGarcom(fixo);
    funcionarioApi.list().then(setFuncionarios).catch(() => {});
  }, []);

  const garconsDisponiveis = funcionarios.filter((f) => f.perfil === 'garcom' && f.ativo);

  const selecionarGarcom = (nome: string) => {
    setGarcom(nome);
    if (nome) localStorage.setItem('simplesx_garcom_fixo', nome);
    else localStorage.removeItem('simplesx_garcom_fixo');
  };

  const loadData = async () => {
    setLoad(true);
    try {
      setData(await mesaApi.list());
    } catch (e: any) {
      toast('error', e?.error || 'Erro ao carregar mesas');
    } finally {
      setLoad(false);
    }
  };

  useEffect(() => {
    loadData();
    const iv = setInterval(loadData, 30000);
    return () => clearInterval(iv);
  }, []);

  const comandaDaMesa = (mesaId: number) => data.comandas.find((c) => c.mesa_id === mesaId);
  const abertas = data.comandas.filter((c) => c.status === 'aberta').length;

  const abrirMesa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!abrir) return;
    try {
      const comanda = await mesaApi.abrir(abrir.id, {
        garcom_nome: garcom,
        cliente_nome: cliente,
        pessoas_count: Number(pessoas || 1),
      });
      toast('success', `Mesa ${abrir.numero} aberta`);
      setAbrir(null);
      navigate(`/restaurante/comanda/${comanda.id}`);
    } catch (err: any) {
      toast('error', err?.error || 'Erro ao abrir mesa');
    }
  };

  const criarMesa = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await mesaApi.create({ numero: Number(mNumero), capacidade: Number(mCapacidade || 4), setor: mSetor });
      toast('success', 'Mesa criada');
      setNovaMesa(false);
      loadData();
    } catch (err: any) {
      toast('error', err?.error || 'Erro ao criar mesa');
    }
  };

  if (load) return <Spinner />;

  return (
    <AnimatedPage>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-800">Restaurante</h1>
          <p className="text-sm text-slate-500">{abertas} comandas abertas</p>
        </div>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setNovaMesa(true)}>Nova mesa</Button>
      </div>

      {data.mesas.length === 0 ? (
        <Card>
          <EmptyState icon={<UtensilsCrossed className="h-8 w-8" />} title="Nenhuma mesa cadastrada" />
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {data.mesas
            .filter((m) => m.ativo)
            .map((m, i) => {
              const com = comandaDaMesa(m.id);
              const preFechada = com?.status === 'pre_fechamento';
              const ocupada = (m.status === 'ocupada' || preFechada) && com;
              const isPagamentos = m.tipo === 'pagamentos';
              const aoClicar = () => {
                if (isPagamentos && com) return navigate(`/restaurante/comanda/${com.id}/pagamentos`);
                if (com) return navigate(`/restaurante/comanda/${com.id}`);
                if (!isPagamentos) setAbrir(m);
              };
              return (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                >
                  <motion.div
                    whileHover={{ y: -3 }}
                    onClick={aoClicar}
                    className={`relative cursor-pointer rounded-2xl border-2 p-4 shadow-soft transition-colors ${
                      isPagamentos
                        ? 'border-indigo-200 bg-indigo-50/60 hover:bg-indigo-100'
                        : preFechada
                          ? 'border-amber-300 bg-amber-50 hover:bg-amber-100'
                          : ocupada
                            ? 'border-emerald-300 bg-emerald-50 hover:bg-emerald-100'
                            : 'border-slate-200 bg-white hover:border-brand-300'
                    }`}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-2xl font-extrabold text-slate-800">
                        {isPagamentos ? <UtensilsCrossed className="inline h-6 w-6 text-indigo-500" /> : m.numero}
                      </span>
                      {ocupada ? (
                        preFechada ? (
                          <Badge color="amber">Pré-fechada</Badge>
                        ) : (
                          <Badge color="green">
                            <Users className="mr-1 h-3 w-3" /> {com.pessoas_count}
                          </Badge>
                        )
                      ) : isPagamentos ? (
                        <Badge color="purple">Individuais</Badge>
                      ) : (
                        <Badge color="slate">Livre</Badge>
                      )}
                    </div>
                    {isPagamentos ? (
                      <p className="text-sm font-bold text-indigo-700">{m.nome}</p>
                    ) : (
                      <p className="text-sm text-slate-500">{m.nome} · {m.capacidade} lugares</p>
                    )}
                    <p className="text-[11px] text-slate-400">{isPagamentos ? 'baixa individual por pessoa' : m.setor || '—'}</p>
                    {ocupada && (
                      <div className={`mt-2 border-t pt-2 text-sm ${preFechada ? 'border-amber-200' : 'border-emerald-200'}`}>
                        {preFechada ? (
                          <p className="text-[11px] font-semibold text-amber-700">
                            {isPagamentos ? 'Aguardando baixa individual' : 'Conta pré-fechada · aguarda baixa'}
                          </p>
                        ) : (
                          <>
                            <p className="font-semibold text-emerald-800">{fmtBRL(com.total)}</p>
                            <p className="text-[11px] text-emerald-600">
                              {com.itens_count} itens · aberta {fmtHora(com.criado_em)} · {com.garcom_nome || 'sem garçom'}
                            </p>
                          </>
                        )}
                      </div>
                    )}
                    {isPagamentos && !com && (
                      <p className="mt-1 text-[11px] text-indigo-500">Nenhuma conta pendente</p>
                    )}
                  </motion.div>
                </motion.div>
              );
            })}
        </div>
      )}

      <Modal open={!!abrir} onClose={() => setAbrir(null)} title={`Abrir mesa ${abrir?.numero || ''}`}>
        <form onSubmit={abrirMesa} className="space-y-4">
          <Field label="Garçom" hint="Fica fixo até você trocar">
            <Select value={garcom} onChange={(e) => selecionarGarcom(e.target.value)} autoFocus>
              <option value="">Sem garçom</option>
              {garconsDisponiveis.map((f) => (
                <option key={f.id} value={f.nome}>{f.nome}</option>
              ))}
            </Select>
          </Field>
          <Field label="Nome do cliente (opcional)">
            <Input value={cliente} onChange={(e) => setCliente(e.target.value)} />
          </Field>
          <Field label="Quantidade de pessoas">
            <Input type="number" min={1} value={pessoas} onChange={(e) => setPessoas(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setAbrir(null)}>Cancelar</Button>
            <Button type="submit" icon={<ArrowRight className="h-4 w-4" />}>Abrir mesa</Button>
          </div>
        </form>
      </Modal>

      <Modal open={novaMesa} onClose={() => setNovaMesa(false)} title="Nova mesa">
        <form onSubmit={criarMesa} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Número *">
              <Input type="number" value={mNumero} onChange={(e) => setMNumero(e.target.value)} autoFocus />
            </Field>
            <Field label="Capacidade">
              <Input type="number" value={mCapacidade} onChange={(e) => setMCapacidade(e.target.value)} />
            </Field>
          </div>
          <Field label="Setor">
            <Select value={mSetor} onChange={(e) => setMSetor(e.target.value)}>
              <option>Salão</option>
              <option>Terraço</option>
              <option>Balcão</option>
              <option>Delivery</option>
            </Select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setNovaMesa(false)}>Cancelar</Button>
            <Button type="submit" icon={<Plus className="h-4 w-4" />}>Criar mesa</Button>
          </div>
        </form>
      </Modal>
    </AnimatedPage>
  );
}
