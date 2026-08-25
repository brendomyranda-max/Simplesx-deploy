import { useEffect, useState } from 'react';
import { Tags, Plus, Pencil, Trash2, Truck, Save, Printer, CornerDownRight } from 'lucide-react';
import { AnimatedPage } from '@/components/anim';
import { Badge, Button, Card, EmptyState, Field, IconButton, Input, Modal, Select, Spinner, Tabs, useToast } from '@/components/ui';
import { categoriaApi, fornecedorApi, impressoraApi, deviceApi, gestorApi } from '@/lib/api';
import type { Categoria, Fornecedor } from '@/lib/types';

const CORES = ['#6366f1', '#0ea5e9', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6'];

export function CategoriasPage() {
  const toast = useToast();
  const [tab, setTab] = useState<'categorias' | 'fornecedores'>('categorias');
  const [cats, setCats] = useState<Categoria[]>([]);
  const [forns, setForns] = useState<Fornecedor[]>([]);
  const [impressoras, setImpressoras] = useState<any[]>([]);
  const [servidores, setServidores] = useState<any[]>([]);
  const [load, setLoad] = useState(true);
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [nome, setNome] = useState('');
  const [cor, setCor] = useState(CORES[0]);
  const [categoriaPaiId, setCategoriaPaiId] = useState<number | null>(null);
  const [impressoraId, setImpressoraId] = useState<number | null>(null);
  const [servidorTipo, setServidorTipo] = useState('');
  const [servidorId, setServidorId] = useState('');
  const [contato, setContato] = useState('');
  const [telefone, setTelefone] = useState('');
  const [email, setEmail] = useState('');

  const loadAll = async () => {
    setLoad(true);
    try {
      const [c, f, i, devices, gestores] = await Promise.all([
        categoriaApi.list(), fornecedorApi.list(), impressoraApi.agentes(),
        deviceApi.list().catch(() => []), gestorApi.list().catch(() => []),
      ]);
      setCats(c);
      setForns(f);
      setImpressoras(i.filter((x: any) => x.ativo !== 0));
      setServidores([
        ...devices.map((d: any) => ({ tipo: 'android', id: String(d.id), nome: d.nome, plataforma: 'Android', online: d.status === 'online' })),
        ...gestores.map((g: any) => ({ tipo: 'desktop', id: String(g.id), nome: g.nome, plataforma: 'Windows/Linux', online: !!g.ultima_conexao && Date.now() - new Date(g.ultima_conexao).getTime() < 60_000 })),
      ]);
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
        let rotaId = impressoraId;
        if (!categoriaPaiId && servidorTipo && servidorId) {
          let rota = impressoras.find((item: any) => item.servidor_tipo === servidorTipo && String(item.servidor_id) === servidorId && !item.impressora_destino);
          if (!rota) {
            const servidor = servidores.find((item: any) => item.tipo === servidorTipo && item.id === servidorId);
            rota = await impressoraApi.criarAgente({
              nome: `Servidor ${servidor?.nome || servidorId}`,
              servidor_tipo: servidorTipo,
              servidor_id: servidorId,
              impressora_destino: null,
              categorias: [],
              imprime_pedidos: true,
              imprime_conta: false,
              largura_mm: 80,
            });
          }
          rotaId = rota.id;
        }
        const dados = { nome, cor, ativo: 1, categoria_pai_id: categoriaPaiId, impressora_agente_id: categoriaPaiId ? null : rotaId };
        if (editId) await categoriaApi.update(editId, dados);
        else await categoriaApi.create(dados);
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
    setCategoriaPaiId(categoria?.categoria_pai_id || null);
    setImpressoraId(categoria?.impressora_agente_id || null);
    const rotaAtual = impressoras.find((item: any) => item.id === categoria?.impressora_agente_id);
    if (rotaAtual?.servidor_tipo && !rotaAtual?.impressora_destino) {
      setServidorTipo(rotaAtual.servidor_tipo);
      setServidorId(String(rotaAtual.servidor_id || ''));
      setImpressoraId(null);
    } else {
      setServidorTipo('');
      setServidorId('');
    }
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
          <p className="text-sm text-slate-500">Categorias, subcategorias, impressoras e fornecedores integrados</p>
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
          <div className="space-y-3">
            {cats.filter((c) => !c.categoria_pai_id).map((c) => (
              <Card key={c.id} className="p-3">
                <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="h-8 w-8 rounded-lg" style={{ backgroundColor: c.cor }} />
                  <div>
                    <p className="text-sm font-bold text-slate-800">{c.nome}</p>
                    <p className="flex items-center gap-1 text-xs text-slate-500"><Printer className="h-3 w-3" />{c.impressora_herdada_nome || 'Sem impressora'}</p>
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
                </div>
                {cats.some((sub) => sub.categoria_pai_id === c.id) && (
                  <div className="mt-3 grid gap-2 border-t border-slate-100 pt-3 sm:grid-cols-2 lg:grid-cols-3">
                    {cats.filter((sub) => sub.categoria_pai_id === c.id).map((sub) => (
                      <div key={sub.id} className="flex items-center justify-between rounded-xl bg-slate-50 p-2.5">
                        <div className="flex items-center gap-2">
                          <CornerDownRight className="h-4 w-4 text-slate-400" />
                          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: sub.cor }} />
                          <div><p className="text-sm font-semibold text-slate-700">{sub.nome}</p><p className="text-xs text-slate-500">Herda: {sub.impressora_herdada_nome || 'sem impressora'}</p></div>
                        </div>
                        <IconButton label="Editar" icon={<Pencil className="h-4 w-4" />} onClick={() => abrir(sub)} />
                      </div>
                    ))}
                  </div>
                )}
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
            <>
            <Field label="Tipo / categoria principal">
              <Select value={categoriaPaiId || ''} onChange={(e) => { setCategoriaPaiId(e.target.value ? Number(e.target.value) : null); if (e.target.value) { setImpressoraId(null); setServidorTipo(''); setServidorId(''); } }}>
                <option value="">Categoria principal</option>
                {cats.filter((c) => !c.categoria_pai_id && c.id !== editId).map((c) => <option key={c.id} value={c.id}>Subcategoria de {c.nome}</option>)}
              </Select>
            </Field>
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
            {categoriaPaiId ? (
              <div className="rounded-xl bg-blue-50 p-3 text-sm text-blue-700">A subcategoria herdará automaticamente a impressora da categoria principal.</div>
            ) : (
              <Field label="Destino dos pedidos">
                <Select value={servidorTipo && servidorId ? `server:${servidorTipo}:${servidorId}` : impressoraId ? `route:${impressoraId}` : ''} onChange={(e) => {
                  const [kind, tipo, ...rest] = e.target.value.split(':');
                  if (kind === 'server') { setServidorTipo(tipo); setServidorId(rest.join(':')); setImpressoraId(null); }
                  else { setServidorTipo(''); setServidorId(''); setImpressoraId(kind === 'route' ? Number(tipo) : null); }
                }}>
                  <option value="">Sem destino configurado</option>
                  <optgroup label="Usar somente o servidor">
                    {servidores.map((s) => <option key={`${s.tipo}:${s.id}`} value={`server:${s.tipo}:${s.id}`}>{s.nome} · {s.plataforma} · {s.online ? 'online' : 'offline'}</option>)}
                  </optgroup>
                  <optgroup label="Usar uma rota/impressora específica">
                    {impressoras.filter((i) => i.impressora_destino || !i.servidor_tipo).map((i) => <option key={i.id} value={`route:${i.id}`}>{i.nome} ({i.largura_mm || 80}mm)</option>)}
                  </optgroup>
                </Select>
                <p className="mt-1 text-xs text-slate-500">Escolhendo somente o servidor, o gestor usará sua impressora padrão.</p>
              </Field>
            )}
            </>
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
