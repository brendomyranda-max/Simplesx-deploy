import { useEffect, useState } from 'react';
import { Printer, Plus, Network, LayoutTemplate, RefreshCw, Pencil, Download } from 'lucide-react';
import { AnimatedPage } from '@/components/anim';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Spinner, Tabs, Toggle, useToast } from '@/components/ui';
import { impressoraApi, gestorApi, configApi, categoriaApi } from '@/lib/api';
import { getBobina, setBobina, type Bobina } from '@/lib/print';
import {
  cupsHealth,
  cupsPrinters,
  getDirectPrint,
  getGestorToken,
  getPrinterForWidth,
  setDirectPrint,
  setGestorToken,
  setPrinterForWidth,
  type CupsPrinter,
} from '@/lib/cupsPrint';

export function ImpressorasPage() {
  const toast = useToast();
  const [tab, setTab] = useState<'setores' | 'agentes' | 'etiquetas'>('setores');
  const [setores, setSetores] = useState<any[]>([]);
  const [agentes, setAgentes] = useState<any[]>([]);
  const [etiquetas, setEtiquetas] = useState<any[]>([]);
  const [categorias, setCategorias] = useState<any[]>([]);
  const [load, setLoad] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<any>({});
  const [editandoAgente, setEditandoAgente] = useState<number | null>(null);
  const [bobina, setBobinaState] = useState<Bobina>(getBobina());
  const [cupsOnline, setCupsOnline] = useState<boolean | null>(null);
  const [cupsList, setCupsList] = useState<CupsPrinter[]>([]);
  const [printer80, setPrinter80State] = useState<string>(getPrinterForWidth('80'));
  const [printer58, setPrinter58State] = useState<string>(getPrinterForWidth('58'));
  const [direct, setDirectState] = useState<boolean>(getDirectPrint());
  const [gestorToken, setGestorTokenState] = useState<string>(getGestorToken());
  const [gestores, setGestores] = useState<any[]>([]);
  const [salvandoGestor, setSalvandoGestor] = useState(false);
  const [testandoGestor, setTestandoGestor] = useState(false);

  const mudarBobina = (mm: Bobina) => {
    setBobina(mm);
    setBobinaState(mm);
    toast('success', `Bobina de ${mm}mm salva`);
  };

  const carregarCups = async () => {
    const ok = await cupsHealth();
    setCupsOnline(ok);
    setCupsList(ok ? await cupsPrinters() : []);
  };

  useEffect(() => {
    carregarCups();
  }, []);

  const mudarPrinter = (width: Bobina, name: string) => {
    setPrinterForWidth(width, name);
    if (width === '80') setPrinter80State(name);
    else setPrinter58State(name);
    toast('success', `Impressora de ${width}mm: ${name || 'padrão do CUPS'}`);
  };

  const mudarDirect = (v: boolean) => {
    setDirectPrint(v);
    setDirectState(v);
    toast('success', v ? 'Impressão direta via CUPS ativada' : 'Impressão voltará a usar o diálogo do navegador');
  };

  const loadAll = async () => {
    setLoad(true);
    try {
      const [s, a, e, cfg, g, cats] = await Promise.all([
        impressoraApi.setores(),
        impressoraApi.agentes(),
        impressoraApi.etiquetas(),
        configApi.get().catch(() => null),
        gestorApi.list().catch(() => []),
        categoriaApi.list(),
      ]);
      setSetores(s);
      setAgentes(a);
      setEtiquetas(e);
      setGestores(g);
      setCategorias(cats.filter((cat: any) => cat.ativo !== 0));
      if (cfg?.config?.gestor_token && !gestorToken) {
        setGestorTokenState(cfg.config.gestor_token);
        setGestorToken(cfg.config.gestor_token);
      }
    } catch (err: any) {
      toast('error', err?.error || 'Erro ao carregar');
    } finally {
      setLoad(false);
    }
  };

  const salvarGestor = async () => {
    setSalvandoGestor(true);
    try {
      const t = gestorToken.trim();
      setGestorToken(t);
      await configApi.update({ gestor_token: t });
      const g = await gestorApi.list().catch(() => []);
      setGestores(g);
      toast('success', t ? 'Token do gestor salvo' : 'Token removido — impressões voltam ao modo local');
    } catch (err: any) {
      toast('error', err?.error || 'Erro ao salvar token');
    } finally {
      setSalvandoGestor(false);
    }
  };

  const testarGestor = async () => {
    setTestandoGestor(true);
    try {
      const res = await gestorApi.enviar({
        tipo: 'html',
        conteudo: '<meta charset="UTF-8"><pre>TESTE DE IMPRESSÃO\n' + new Date().toLocaleString('pt-BR') + '\n\nAcentuação: ç á é í ó ú ã õ\nConexão com o gestor OK!</pre>',
        gestor_token: gestorToken.trim() || undefined,
      });
      toast('success', 'Impressão enviada — confira a impressora (pode levar alguns segundos)');
    } catch (err: any) {
      toast('error', err?.error || 'Falha ao enviar teste');
    } finally {
      setTestandoGestor(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (tab === 'setores') {
        if (!form.nome) return toast('error', 'Informe o nome do setor');
        await impressoraApi.criarSetor({ nome: form.nome, padrao_impressora: form.padrao_impressora });
        toast('success', 'Setor criado');
      } else if (tab === 'agentes') {
        if (!form.nome) return toast('error', 'Selecione ou informe a fila CUPS');
        const payload = {
          nome: form.nome,
          ip: form.ip || '',
          porta: Number(form.porta) || 9100,
          tipo: 'impressora',
          protocolo: form.protocolo || 'cups',
          categorias: form.categorias || [],
          imprime_pedidos: form.imprime_pedidos !== false,
          imprime_conta: !!form.imprime_conta,
          largura_mm: Number(form.largura_mm) === 58 ? 58 : 80,
        };
        if (editandoAgente) await impressoraApi.atualizarAgente(editandoAgente, payload);
        else await impressoraApi.criarAgente(payload);
        toast('success', editandoAgente ? 'Rota de impressão atualizada' : 'Rota de impressão criada');
      } else {
        if (!form.nome) return toast('error', 'Informe o nome do modelo');
        await impressoraApi.criarEtiqueta({ nome: form.nome, largura_mm: Number(form.largura_mm) || 58, altura_mm: Number(form.altura_mm) || 40 });
        toast('success', 'Modelo criado');
      }
      setModal(false);
      setEditandoAgente(null);
      setForm({});
      loadAll();
    } catch (err: any) {
      toast('error', err?.error || 'Erro ao salvar');
    }
  };

  const abrir = () => {
    setEditandoAgente(null);
    setForm({ nome: '', padrao_impressora: '', ip: '', porta: '9100', tipo: 'impressora', protocolo: 'cups', categorias: [], imprime_pedidos: true, imprime_conta: false, largura_mm: '80', altura_mm: '40' });
    setModal(true);
  };

  const editarAgente = (a: any) => {
    setTab('agentes');
    setEditandoAgente(a.id);
    setForm({
      ...a,
      categorias: Array.isArray(a.categorias) ? a.categorias : [],
      imprime_pedidos: a.imprime_pedidos !== false,
      imprime_conta: !!a.imprime_conta,
      largura_mm: String(a.largura_mm || 80),
    });
    setModal(true);
  };

  const alternarCategoria = (id: number) => {
    const atuais: number[] = form.categorias || [];
    setForm({ ...form, categorias: atuais.includes(id) ? atuais.filter((x) => x !== id) : [...atuais, id] });
  };

  return (
    <AnimatedPage>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-800">Impressoras</h1>
          <p className="text-sm text-slate-500">Rotas por categoria, filas CUPS e etiquetas</p>
        </div>
        <Button icon={<Plus className="h-4 w-4" />} onClick={abrir}>Novo</Button>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card className="p-4">
          <p className="font-bold text-slate-800">Largura da bobina</p>
          <p className="mt-1 text-sm text-slate-500">Usada na impressão via navegador (cupom, comanda e etiqueta)</p>
          <div className="mt-3 flex gap-2">
            <Button
              variant={bobina === '80' ? 'primary' : 'secondary'}
              onClick={() => mudarBobina('80')}
            >
              80mm
            </Button>
            <Button
              variant={bobina === '58' ? 'primary' : 'secondary'}
              onClick={() => mudarBobina('58')}
            >
              58mm
            </Button>
          </div>
        </Card>

        <Card className="p-4">
          <p className="font-bold text-slate-800">Sem papel em branco (driver)</p>
          <p className="mt-1 text-sm leading-relaxed text-slate-500">
            Nesta máquina o papel de bobina já fica configurado no CUPS (largura imprimível {bobina === '80' ? '72mm' : '48mm'}).
            Em outros PCs (Windows), cadastre papel personalizado {bobina} × 297mm com margens 0 — senão o navegador
            imprime como A4 e gasta rolo à toa.
          </p>
        </Card>
      </div>

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <p className="font-bold text-slate-800">Impressão direta (CUPS)</p>
            {cupsOnline === null ? (
              <Badge color="slate">verificando…</Badge>
            ) : cupsOnline ? (
              <Badge color="green">servidor ativo</Badge>
            ) : (
              <Badge color="red">servidor offline</Badge>
            )}
          </div>
          <Button size="sm" variant="secondary" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={carregarCups}>
            Atualizar
          </Button>
        </div>
        <p className="mt-1 text-sm leading-relaxed text-slate-500">
          Ao tocar em "Imprimir", o app envia o recibo direto para o CUPS (sem diálogo do navegador),
          usando o "Gestor de Impressoras CUPS" rodando em <code className="rounded bg-slate-100 px-1">http://127.0.0.1:8410</code>.
          Se o servidor estiver offline, a impressão cai automaticamente para o diálogo do navegador.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="flex items-center gap-3">
            <Toggle checked={direct} onChange={mudarDirect} label="Impressão direta via CUPS" />
            <span className="text-sm text-slate-600">{direct ? 'Direto via CUPS (sem diálogo)' : 'Diálogo do navegador'}</span>
          </div>
          <Field label="Impressora da bobina 80mm">
            <Select value={printer80} onChange={(e) => mudarPrinter('80', e.target.value)}>
              <option value="">— (padrão do CUPS)</option>
              {cupsList.map((p) => (
                <option key={p.name} value={p.name}>{p.name}{p.raw ? ' (ESC/POS)' : ''}</option>
              ))}
            </Select>
          </Field>
          <Field label="Impressora da bobina 58mm">
            <Select value={printer58} onChange={(e) => mudarPrinter('58', e.target.value)}>
              <option value="">— (padrão do CUPS)</option>
              {cupsList.map((p) => (
                <option key={p.name} value={p.name}>{p.name}{p.raw ? ' (ESC/POS)' : ''}</option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <p className="font-bold text-slate-800">Conexão direta com o deploy (gestor central)</p>
            {gestores.length === 0 ? (
              <Badge color="slate">sem gestor pareado</Badge>
            ) : (
              <Badge color="green">{gestores.length} gestor(es)</Badge>
            )}
          </div>
        </div>
        <p className="mt-1 text-sm leading-relaxed text-slate-500">
          Todos os prints do app passam pelo servidor e chegam ao gestor local (identificado pelo IP), que imprime
          via CUPS — funciona de qualquer dispositivo conectado, mesmo fora da mesma rede. Cole aqui o token que o
          gestor mostra ao iniciar.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 p-3">
          <Download className="h-5 w-5 text-blue-600" />
          <div className="mr-auto">
            <p className="text-sm font-bold text-slate-800">Instalar o Gestor de Impressoras</p>
            <p className="text-xs text-slate-500">Instale no computador conectado às impressoras e copie o token exibido.</p>
          </div>
          <a
            className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            href="https://github.com/brendomyranda-max/Simplesx-deploy/releases/latest/download/SimplesX-Gestor-win-x64.exe"
          >
            Windows
          </a>
          <a
            className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            href="https://github.com/brendomyranda-max/Simplesx-deploy/releases/latest/download/SimplesX-Gestor-linux-x86_64.AppImage"
          >
            Linux
          </a>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 flex items-end gap-2">
            <Field label="Token do gestor">
              <Input
                value={gestorToken}
                onChange={(e) => setGestorTokenState(e.target.value)}
                placeholder="ex.: a1b2c3d4e5f60718"
                className="font-mono"
              />
            </Field>
            <Button
              variant="secondary"
              onClick={salvarGestor}
              disabled={salvandoGestor}
            >
              {salvandoGestor ? 'Salvando…' : 'Salvar'}
            </Button>
            <Button icon={<Printer className="h-4 w-4" />} onClick={testarGestor} disabled={testandoGestor}>
              {testandoGestor ? 'Enviando…' : 'Testar impressão'}
            </Button>
          </div>
          <div className="text-sm text-slate-600">
            {gestores.length === 0 ? (
              <p>Nenhum gestor registrado ainda. Inicie o gestor no PC das impressoras e cole o token aqui.</p>
            ) : (
              <ul className="space-y-1">
                {gestores.map((g) => {
                  const online = g.ultima_conexao && Date.now() - new Date(g.ultima_conexao).getTime() < 60_000;
                  const atual = g.token === (gestorToken.trim() || undefined);
                  return (
                    <li key={g.id} className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-700">
                        {g.nome} <span className="font-mono text-xs text-slate-500">{g.ip}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        {atual && <Badge color="blue">usando</Badge>}
                        <Badge color={online ? 'green' : 'red'}>{online ? 'online' : 'offline'}</Badge>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </Card>

      <Tabs
        value={tab}
        onChange={(v) => setTab(v as any)}
        tabs={[
          { value: 'setores', label: 'Setores' },
          { value: 'agentes', label: 'Impressoras e categorias' },
          { value: 'etiquetas', label: 'Modelos de etiqueta' },
        ]}
      />

      {load ? (
        <Spinner />
      ) : (
        <div className="mt-4">
          {tab === 'setores' && (
            setores.length === 0 ? (
              <Card><EmptyState icon={<Printer className="h-8 w-8" />} title="Nenhum setor cadastrado" subtitle="ex.: Cozinha, Bar, Confeitaria" /></Card>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {setores.map((s) => (
                  <Card key={s.id} className="p-4">
                    <div className="flex items-center justify-between">
                      <p className="font-bold text-slate-800">{s.nome}</p>
                      <Badge color="green">ativo</Badge>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">Impressora padrão: <span className="font-semibold text-slate-700">{s.padrao_impressora || '—'}</span></p>
                  </Card>
                ))}
              </div>
            )
          )}

          {tab === 'agentes' && (
            agentes.length === 0 ? (
              <Card><EmptyState icon={<Network className="h-8 w-8" />} title="Nenhuma rota de impressão" subtitle="Vincule uma fila CUPS às categorias do cardápio" /></Card>
            ) : (
              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="th">Nome</th>
                        <th className="th">Categorias dos pedidos</th>
                        <th className="th">Fechamento</th>
                        <th className="th">Bobina</th>
                        <th className="th"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {agentes.map((a) => (
                        <tr key={a.id}>
                          <td className="td font-semibold text-slate-800">{a.nome}</td>
                          <td className="td">
                            <div className="flex max-w-md flex-wrap gap-1">
                              {(a.categorias || []).length === 0 ? <span className="text-xs text-slate-400">Nenhuma</span> :
                                (a.categorias || []).map((id: number) => {
                                  const cat = categorias.find((c) => c.id === id);
                                  return cat ? <Badge key={id} color="blue">{cat.nome}</Badge> : null;
                                })}
                            </div>
                          </td>
                          <td className="td">{a.imprime_conta ? <Badge color="green">Imprime conta</Badge> : '—'}</td>
                          <td className="td">{a.largura_mm || 80}mm</td>
                          <td className="td text-right">
                            <Button size="sm" variant="secondary" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => editarAgente(a)}>Editar</Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )
          )}

          {tab === 'etiquetas' && (
            etiquetas.length === 0 ? (
              <Card><EmptyState icon={<LayoutTemplate className="h-8 w-8" />} title="Nenhum modelo de etiqueta" /></Card>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {etiquetas.map((e) => (
                  <Card key={e.id} className="p-4">
                    <p className="font-bold text-slate-800">{e.nome}</p>
                    <p className="mt-1 text-sm text-slate-500">{e.largura_mm} × {e.altura_mm} mm</p>
                  </Card>
                ))}
              </div>
            )
          )}
        </div>
      )}

      <Modal open={modal} onClose={() => { setModal(false); setEditandoAgente(null); }} title={tab === 'agentes' ? (editandoAgente ? 'Editar rota de impressão' : 'Nova rota de impressão') : `Novo ${tab === 'setores' ? 'setor' : 'modelo de etiqueta'}`}>
        <form onSubmit={salvar} className="space-y-4">
          {tab !== 'agentes' && (
            <Field label={tab === 'etiquetas' ? 'Nome do modelo *' : 'Nome *'}>
              <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} autoFocus />
            </Field>
          )}
          {tab === 'setores' && (
            <Field label="Impressora padrão">
              <Select value={form.padrao_impressora} onChange={(e) => setForm({ ...form, padrao_impressora: e.target.value })}>
                <option value="">—</option>
                {agentes.map((a) => <option key={a.id} value={a.nome}>{a.nome} ({a.ip})</option>)}
              </Select>
            </Field>
          )}
          {tab === 'agentes' && (
            <>
              <Field label="Fila CUPS *">
                <Select value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })}>
                  <option value="">Selecione a impressora</option>
                  {form.nome && !cupsList.some((p) => p.name === form.nome) && <option value={form.nome}>{form.nome}</option>}
                  {cupsList.map((p) => <option key={p.name} value={p.name}>{p.name}{p.raw ? ' (RAW/ESC-POS)' : ''}</option>)}
                </Select>
              </Field>
              {!cupsOnline && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">O gestor local está inacessível neste dispositivo. Abra esta tela no computador do gestor para listar as filas CUPS.</p>}
              <Field label="Categorias enviadas para esta impressora">
                <div className="grid max-h-48 grid-cols-1 gap-2 overflow-y-auto rounded-xl border border-slate-200 p-3 sm:grid-cols-2">
                  {categorias.map((cat) => (
                    <label key={cat.id} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" checked={(form.categorias || []).includes(cat.id)} onChange={() => alternarCategoria(cat.id)} className="h-4 w-4 rounded border-slate-300" />
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: cat.cor }} />
                      {cat.nome}
                    </label>
                  ))}
                </div>
              </Field>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Largura da bobina">
                  <Select value={form.largura_mm} onChange={(e) => setForm({ ...form, largura_mm: e.target.value })}>
                    <option value="80">80mm</option>
                    <option value="58">58mm</option>
                  </Select>
                </Field>
                <div className="space-y-2 pt-6">
                  <Toggle checked={form.imprime_pedidos !== false} onChange={(v) => setForm({ ...form, imprime_pedidos: v })} label="Imprimir pedidos das categorias" />
                  <Toggle checked={!!form.imprime_conta} onChange={(v) => setForm({ ...form, imprime_conta: v })} label="Imprimir fechamento de conta" />
                </div>
              </div>
            </>
          )}
          {tab === 'etiquetas' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Largura (mm)">
                <Input type="number" value={form.largura_mm} onChange={(e) => setForm({ ...form, largura_mm: e.target.value })} />
              </Field>
              <Field label="Altura (mm)">
                <Input type="number" value={form.altura_mm} onChange={(e) => setForm({ ...form, altura_mm: e.target.value })} />
              </Field>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModal(false)}>Cancelar</Button>
            <Button type="submit">Salvar</Button>
          </div>
        </form>
      </Modal>
    </AnimatedPage>
  );
}
