import { useEffect, useState } from 'react';
import { Tags, Plus, Pencil, Trash2, Truck, Save } from 'lucide-react';
import { AnimatedPage } from '@/components/anim';
import { Badge, Button, Card, EmptyState, Field, IconButton, Input, Modal, Spinner, Tabs, useToast } from '@/components/ui';
import { categoriaApi, fornecedorApi } from '@/lib/api';
import type { Categoria, Fornecedor } from '@/lib/types';

const CORES = ['#6366f1', '#0ea5e9', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6'];

export function CategoriasPage() {
  const toast = useToast();
  const [tab, setTab] = useState<'categorias' | 'fornecedores'>('categorias');
  const [cats, setCats] = useState<Categoria[]>([]);
  const [forns, setForns] = useState<Fornecedor[]>([]);
  const [load, setLoad] = useState(true);
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [nome, setNome] = useState('');
  const [cor, setCor] = useState(CORES[0]);
  const [contato, setContato] = useState('');
  const [telefone, setTelefone] = useState('');
  const [email, setEmail] = useState('');

  const loadAll = async () => {
    setLoad(true);
    try {
      const [c, f] = await Promise.all([categoriaApi.list(), fornecedorApi.list()]);
      setCats(c);
      setForns(f);
    } catch {
      /* noop */
    } finally {
      setLoad(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) return toast('error', 'Informe o nome');
    try {
      if (tab === 'categorias') {
        if (editId) await categoriaApi.update(editId, { nome, cor, ativo: 1 });
        else await categoriaApi.create({ nome, cor });
        toast('success', editId ? 'Categoria atualizada' : 'Categoria criada');
      } else {
        if (editId) await fornecedorApi.update(editId, { nome, contato, telefone, email, ativo: 1 });
        else await fornecedorApi.create({ nome, contato, telefone, email });
        toast('success', editId ? 'Fornecedor atualizado' : 'Fornecedor criado');
      }
      setModal(false);
      setNome('');
      setEditId(null);
      loadAll();
    } catch (e: any) {
      toast('error', e?.error || 'Erro ao salvar');
    }
  };

  const abrir = (categoria?: Categoria, fornecedor?: Fornecedor) => {
    setEditId(categoria?.id ?? fornecedor?.id ?? null);
    setNome(categoria?.nome || fornecedor?.nome || '');
    setCor(categoria?.cor || CORES[0]);
    setContato(fornecedor?.contato || '');
    setTelefone(fornecedor?.telefone || '');
    setEmail(fornecedor?.email || '');
    setModal(true);
  };

  if (load) return <Spinner />;

  return (
    <AnimatedPage>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-800">Cadastros</h1>
          <p className="text-sm text-slate-500">Categorias e fornecedores</p>
        </div>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => abrir()}>
          Novo
        </Button>
      </div>

      <div className="mb-4">
        <Tabs
          value={tab}
          onChange={(v) => setTab(v as 'categorias' | 'fornecedores')}
          tabs={[
            { value: 'categorias', label: 'Categorias' },
            { value: 'fornecedores', label: 'Fornecedores' },
          ]}
        />
      </div>

      {tab === 'categorias' ? (
        cats.length === 0 ? (
          <Card>
            <EmptyState icon={<Tags className="h-8 w-8" />} title="Nenhuma categoria" />
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {cats.map((c) => (
              <Card key={c.id} className="flex items-center justify-between p-3">
                <div className="flex items-center gap-2.5">
                  <span className="h-8 w-8 rounded-lg" style={{ backgroundColor: c.cor }} />
                  <div>
                    <p className="text-sm font-bold text-slate-800">{c.nome}</p>
                    {!c.ativo && <Badge color="slate">inativa</Badge>}
                  </div>
                </div>
                <div className="flex">
                  <IconButton label="Editar" icon={<Pencil className="h-4 w-4" />} onClick={() => abrir(c)} />
                  <IconButton
                    label={c.ativo ? 'Desativar' : 'Ativar'}
                    variant="danger"
                    icon={<Trash2 className="h-4 w-4" />}
                    onClick={async () => {
                      await categoriaApi.update(c.id, { ...c, ativo: c.ativo ? 0 : 1 });
                      loadAll();
                    }}
                  />
                </div>
              </Card>
            ))}
          </div>
        )
      ) : forns.length === 0 ? (
        <Card>
          <EmptyState icon={<Truck className="h-8 w-8" />} title="Nenhum fornecedor" />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Nome</th>
                  <th className="th">Contato</th>
                  <th className="th">Telefone</th>
                  <th className="th">Email</th>
                  <th className="th text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {forns.map((f) => (
                  <tr key={f.id}>
                    <td className="td font-semibold text-slate-800">{f.nome}</td>
                    <td className="td">{f.contato || '-'}</td>
                    <td className="td">{f.telefone || '-'}</td>
                    <td className="td">{f.email || '-'}</td>
                    <td className="td">
                      <div className="flex justify-end">
                        <IconButton label="Editar" icon={<Pencil className="h-4 w-4" />} onClick={() => abrir(undefined, f)} />
                        <IconButton label="Desativar" variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={async () => {
                          await fornecedorApi.update(f.id, { ...f, ativo: 0 });
                          loadAll();
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

      <Modal open={modal} onClose={() => setModal(false)} title={tab === 'categorias' ? (editId ? 'Editar categoria' : 'Nova categoria') : editId ? 'Editar fornecedor' : 'Novo fornecedor'}>
        <form onSubmit={salvar} className="space-y-4">
          <Field label="Nome *">
            <Input value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />
          </Field>
          {tab === 'categorias' ? (
            <Field label="Cor">
              <div className="flex flex-wrap gap-2">
                {CORES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCor(c)}
                    className={`h-9 w-9 rounded-xl transition-transform ${cor === c ? 'ring-2 ring-slate-800 ring-offset-2 scale-110' : 'hover:scale-110'}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </Field>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Contato">
                <Input value={contato} onChange={(e) => setContato(e.target.value)} />
              </Field>
              <Field label="Telefone">
                <Input value={telefone} onChange={(e) => setTelefone(e.target.value)} />
              </Field>
              <Field label="Email">
                <Input value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModal(false)}>Cancelar</Button>
            <Button type="submit" icon={<Save className="h-4 w-4" />}>Salvar</Button>
          </div>
        </form>
      </Modal>
    </AnimatedPage>
  );
}
