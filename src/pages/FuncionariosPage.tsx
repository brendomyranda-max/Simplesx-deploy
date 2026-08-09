import { useEffect, useState } from 'react';
import { Users, Plus, Pencil, Trash2, KeyRound, ShieldCheck } from 'lucide-react';
import { AnimatedPage } from '@/components/anim';
import { Badge, Button, Card, EmptyState, Field, IconButton, Input, Modal, Select, Spinner, useToast } from '@/components/ui';
import { funcionarioApi } from '@/lib/api';
import type { Funcionario } from '@/lib/types';

const PERFIS = ['caixa', 'garcom', 'gerente', 'cozinha', 'admin'];

const MODULOS = [
  { key: 'gestor', label: 'Gestor (tudo)', desc: 'Aplicação completa' },
  { key: 'pdv_mercado', label: 'PDV Mercado', desc: 'Somente vendas no balcão' },
  { key: 'restaurante', label: 'Restaurante', desc: 'Somente mesas e comandas' },
];

const MODULO_COR: Record<string, any> = {
  gestor: 'brand',
  pdv_mercado: 'green',
  restaurante: 'orange',
};

const MODULO_LABEL: Record<string, string> = {
  gestor: 'Gestor',
  pdv_mercado: 'PDV',
  restaurante: 'Restaurante',
};

const modulosPadrao = (perfil: string): string[] => {
  if (perfil === 'admin' || perfil === 'gerente') return ['gestor'];
  return ['restaurante'];
};

export function FuncionariosPage() {
  const toast = useToast();
  const [lista, setLista] = useState<Funcionario[]>([]);
  const [load, setLoad] = useState(true);
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ nome: '', usuario: '', senha: '', perfil: 'caixa', pin: '', modulos: modulosPadrao('caixa') });

  const loadAll = async () => {
    setLoad(true);
    try {
      setLista(await funcionarioApi.list());
    } catch (e: any) {
      toast('error', e?.error || 'Erro ao carregar');
    } finally {
      setLoad(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const toggleModulo = (key: string) => {
    setForm((f) => ({
      ...f,
      modulos: f.modulos.includes(key) ? f.modulos.filter((m) => m !== key) : [...f.modulos, key],
    }));
  };

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nome.trim() || !form.usuario.trim()) return toast('error', 'Nome e usuário obrigatórios');
    if (!editId && !form.senha.trim()) return toast('error', 'Defina uma senha');
    if (!form.modulos.length) return toast('error', 'Selecione pelo menos um módulo de acesso');
    try {
      const body: any = { nome: form.nome, usuario: form.usuario, perfil: form.perfil, pin: form.pin || null, modulos: form.modulos };
      if (form.senha) body.senha_hash = form.senha;
      if (editId) {
        await funcionarioApi.update(editId, body);
        toast('success', 'Funcionário atualizado');
      } else {
        await funcionarioApi.create(body);
        toast('success', 'Funcionário criado');
      }
      setModal(false);
      setEditId(null);
      setForm({ nome: '', usuario: '', senha: '', perfil: 'caixa', pin: '', modulos: modulosPadrao('caixa') });
      loadAll();
    } catch (err: any) {
      toast('error', err?.error || 'Erro ao salvar');
    }
  };

  const abrir = (f?: Funcionario) => {
    const perfil = f?.perfil || 'caixa';
    setEditId(f?.id ?? null);
    setForm({
      nome: f?.nome || '',
      usuario: f?.usuario || '',
      senha: '',
      perfil,
      pin: f?.pin || '',
      modulos: f?.modulos?.length ? f.modulos : modulosPadrao(perfil),
    });
    setModal(true);
  };

  const perfilCor: Record<string, any> = {
    admin: 'red',
    gerente: 'brand',
    caixa: 'blue',
    garcom: 'green',
    cozinha: 'amber',
  };

  if (load) return <Spinner />;

  return (
    <AnimatedPage>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-800">Funcionários</h1>
          <p className="text-sm text-slate-500">Acesso por usuário/senha ou PIN no PDV</p>
        </div>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => abrir()}>Novo funcionário</Button>
      </div>

      {lista.length === 0 ? (
        <Card><EmptyState icon={<Users className="h-8 w-8" />} title="Nenhum funcionário cadastrado" /></Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Nome</th>
                  <th className="th">Usuário</th>
                  <th className="th">Perfil</th>
                  <th className="th">Acesso</th>
                  <th className="th">PIN</th>
                  <th className="th">Status</th>
                  <th className="th text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lista.map((f) => (
                  <tr key={f.id}>
                    <td className="td font-semibold text-slate-800">{f.nome}</td>
                    <td className="td">{f.usuario}</td>
                    <td className="td"><Badge color={perfilCor[f.perfil] || 'slate'}>{f.perfil}</Badge></td>
                    <td className="td">
                      <div className="flex flex-wrap gap-1">
                        {(f.modulos?.length ? f.modulos : []).map((m) => (
                          <Badge key={m} color={MODULO_COR[m] || 'slate'}>{MODULO_LABEL[m] || m}</Badge>
                        ))}
                        {!f.modulos?.length && <span className="text-xs text-slate-400">—</span>}
                      </div>
                    </td>
                    <td className="td">{f.pin ? <span className="inline-flex items-center gap-1"><KeyRound className="h-3 w-3 text-slate-400" />••••</span> : '-'}</td>
                    <td className="td">{f.ativo ? <Badge color="green">ativo</Badge> : <Badge color="red">inativo</Badge>}</td>
                    <td className="td">
                      <div className="flex justify-end">
                        <IconButton label="Editar" icon={<Pencil className="h-4 w-4" />} onClick={() => abrir(f)} />
                        <IconButton label={f.ativo ? 'Desativar' : 'Ativar'} variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={async () => {
                          if (!window.confirm(`Desativar ${f.nome}?`)) return;
                          try {
                            await funcionarioApi.update(f.id, { ativo: f.ativo ? 0 : 1 });
                            loadAll();
                          } catch (e: any) {
                            toast('error', e?.error || 'Erro');
                          }
                        }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={editId ? 'Editar funcionário' : 'Novo funcionário'}>
        <form onSubmit={salvar} className="space-y-4">
          <Field label="Nome *">
            <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Usuário *">
              <Input value={form.usuario} onChange={(e) => setForm({ ...form, usuario: e.target.value })} />
            </Field>
            <Field label={editId ? 'Nova senha (opcional)' : 'Senha *'}>
              <Input type="password" value={form.senha} onChange={(e) => setForm({ ...form, senha: e.target.value })} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Perfil">
              <Select
                value={form.perfil}
                onChange={(e) => {
                  const p = e.target.value;
                  setForm((f) =>
                    editId ? { ...f, perfil: p } : { ...f, perfil: p, modulos: modulosPadrao(p) }
                  );
                }}
              >
                {PERFIS.map((p) => <option key={p} value={p}>{p}</option>)}
              </Select>
            </Field>
            <Field label="PIN (opcional)">
              <Input maxLength={6} value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value })} placeholder="4-6 dígitos" />
            </Field>
          </div>
          <div>
            <Field label="Módulos de acesso" hint="Escolha o que este funcionário pode usar no login">
              <div className="grid gap-2 sm:grid-cols-3">
                {MODULOS.map((mod) => {
                  const ativo = form.modulos.includes(mod.key);
                  return (
                    <button
                      key={mod.key}
                      type="button"
                      onClick={() => toggleModulo(mod.key)}
                      className={`flex flex-col items-start gap-0.5 rounded-xl border-2 p-3 text-left transition-colors ${
                        ativo ? 'border-brand-500 bg-brand-50' : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <span className="flex items-center gap-2 text-sm font-bold text-slate-800">
                        <span
                          className={`flex h-4 w-4 items-center justify-center rounded border-2 ${
                            ativo ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white'
                          }`}
                        >
                          {ativo && <ShieldCheck className="h-3 w-3" />}
                        </span>
                        {mod.label}
                      </span>
                      <span className="mt-0.5 pl-6 text-[11px] leading-tight text-slate-500">{mod.desc}</span>
                    </button>
                  );
                })}
              </div>
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModal(false)}>Cancelar</Button>
            <Button type="submit">Salvar</Button>
          </div>
        </form>
      </Modal>
    </AnimatedPage>
  );
}
