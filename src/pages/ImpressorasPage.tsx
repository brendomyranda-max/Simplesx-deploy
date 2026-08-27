import { useEffect, useState } from 'react';
import { Printer, Plus, Network, LayoutTemplate, RefreshCw, Pencil, Download, Smartphone, Trash2 } from 'lucide-react';
import { AnimatedPage } from '@/components/anim';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Spinner, Tabs, Toggle, useToast } from '@/components/ui';
import { impressoraApi, gestorApi, deviceApi, configApi, categoriaApi } from '@/lib/api';
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
  const [tab, setTab] = useState<'agentes' | 'etiquetas'>('agentes');
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
  const [devices, setDevices] = useState<any[]>([]);
  const [pairing, setPairing] = useState<{ pairing_id: string; code: string; expires_at: string } | null>(null);
  const [gerandoPairing, setGerandoPairing] = useState(false);
  const [gestorDeviceId, setGestorDeviceId] = useState('');

  const servidores = [
    ...devices.map((device) => ({ key: `android:${device.id}`, tipo: 'android', id: String(device.id), nome: device.nome, plataforma: 'Android', printers: device.printers || [], online: device.status === 'online' })),
    ...gestores.map((gestor) => ({ key: `desktop:${gestor.id}`, tipo: 'desktop', id: String(gestor.id), nome: gestor.nome, plataforma: 'Windows/Linux', printers: gestor.printers || [], online: !!gestor.ultima_conexao && Date.now() - new Date(gestor.ultima_conexao).getTime() < 60_000 })),
  ];
  const servidorSelecionado = servidores.find((servidor) => servidor.tipo === form.servidor_tipo && servidor.id === String(form.servidor_id || ''));

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
      const [a, e, cfg, g, cats, ds] = await Promise.all([
        impressoraApi.agentes(),
        impressoraApi.etiquetas(),
        configApi.get().catch(() => null),
        gestorApi.list().catch(() => []),
        categoriaApi.list(),
        deviceApi.list().catch(() => []),
      ]);
      setAgentes(a);
      setEtiquetas(e);
      setGestores(g);
      setCategorias(cats.filter((cat: any) => cat.ativo !== 0));
      setDevices(ds);
      setGestorDeviceId(String((cfg as any)?.config?.gestor_device_id || ''));
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

  const gerarPareamento = async () => {
    setGerandoPairing(true);
    try {
      setPairing(await deviceApi.pairingCode());
      toast('success', 'Código criado — ele expira em dez minutos');
    } catch (err: any) {
      toast('error', err?.error || 'Não foi possível gerar o pareamento');
    } finally {
      setGerandoPairing(false);
    }
  };

  const testarDevice = async (device: any) => {
    try {
      await deviceApi.test(device.id);
      toast('success', `Teste enviado para ${device.nome}`);
    } catch (err: any) {
      toast('error', err?.error || 'Não foi possível enviar o teste');
    }
  };

  const removerDevice = async (device: any) => {
    if (!window.confirm(`Excluir o gestor Android "${device.nome}"? O aplicativo precisará ser pareado novamente.`)) return;
    try {
      await deviceApi.remove(device.id);
      if (gestorDeviceId === device.id) {
        await configApi.update({ gestor_device_id: '' });
        setGestorDeviceId('');
      }
      setDevices((current) => current.filter((item) => item.id !== device.id));
      toast('success', 'Gestor Android excluído');
    } catch (err: any) {
      toast('error', err?.error || 'Não foi possível excluir o gestor Android');
    }
  };

  const selecionarDevice = async (deviceId: string) => {
    try {
      await configApi.update({ gestor_device_id: deviceId });
      setGestorDeviceId(deviceId);
      toast('success', deviceId ? 'Gestor Android definido como destino das impressões' : 'Destino Android removido');
    } catch (err: any) {
      toast('error', err?.error || 'Não foi possível salvar o destino');
    }
  };

  const selecionarFinalidade = async (campo: 'imprime_conta' | 'imprime_venda' | 'imprime_validade', routeId: string) => {
    const selecionado = Number(routeId) || 0;
    const rotasAfetadas = agentes.filter((agente) => agente[campo] || agente.id === selecionado);
    try {
      await Promise.all(rotasAfetadas.map((agente) => impressoraApi.atualizarAgente(agente.id, {
        ...agente,
        categorias: agente.categorias || [],
        [campo]: agente.id === selecionado,
      })));
      setAgentes((atuais) => atuais.map((agente) => ({ ...agente, [campo]: agente.id === selecionado })));
      const nomes = {
        imprime_conta: 'Fechamento de conta',
        imprime_venda: 'Cupom de venda',
        imprime_validade: 'Controle de validade',
      };
      toast('success', selecionado ? `${nomes[campo]} configurado` : `${nomes[campo]} sem impressão automática`);
    } catch (err: any) {
      toast('error', err?.error || 'Não foi possível salvar o destino de impressão');
      loadAll();
    }
  };

  const finalidadeSelecionada = (campo: 'imprime_conta' | 'imprime_venda' | 'imprime_validade') => {
    const selecionadas = agentes.filter((agente) => agente[campo]);
    return selecionadas.length === 1 ? String(selecionadas[0].id) : '';
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
        tipo: 'texto',
        conteudo: 'TESTE DE IMPRESSAO\n' + new Date().toLocaleString('pt-BR') + '\n\nAcentuacao: c a e i o u a o\nConexao com o gestor OK!',
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
    const timer = window.setInterval(() => {
      deviceApi.list().then(setDevices).catch(() => undefined);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, []);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (tab === 'agentes') {
        if (!form.nome) return toast('error', 'Informe o nome da rota');
        if (!form.servidor_tipo || !form.servidor_id) return toast('error', 'Selecione o servidor de impressão');
        const categoriasSelecionadas = (form.categorias || []).filter((id: number) => {
          const categoria = categorias.find((cat) => cat.id === id);
          return !categoria?.categoria_pai_id || !(form.categorias || []).includes(categoria.categoria_pai_id);
        });
        const payload = {
          nome: form.nome,
          ip: form.ip || '',
          porta: Number(form.porta) || 9100,
          tipo: 'impressora',
          protocolo: form.protocolo || 'cups',
          categorias: categoriasSelecionadas,
          imprime_pedidos: form.imprime_pedidos !== false,
          imprime_conta: !!form.imprime_conta,
          imprime_venda: !!form.imprime_venda,
          imprime_validade: !!form.imprime_validade,
          largura_mm: Number(form.largura_mm) === 58 ? 58 : 80,
          servidor_tipo: form.servidor_tipo || null,
          servidor_id: form.servidor_id || null,
          impressora_destino: form.impressora_destino || null,
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
    setForm({ nome: '', ip: '', porta: '9100', tipo: 'impressora', protocolo: 'cups', categorias: [], imprime_pedidos: true, imprime_conta: false, imprime_venda: false, imprime_validade: false, largura_mm: '80', altura_mm: '40', servidor_tipo: '', servidor_id: '', impressora_destino: '' });
    setModal(true);
  };

  const editarAgente = (a: any) => {
    setTab('agentes');
    setEditandoAgente(a.id);
    setForm({
      ...a,
      categorias: categorias.filter((cat) => cat.impressora_herdada_id === a.id).map((cat) => cat.id),
      imprime_pedidos: a.imprime_pedidos !== false,
      imprime_conta: !!a.imprime_conta,
      imprime_venda: !!a.imprime_venda,
      imprime_validade: !!a.imprime_validade,
      largura_mm: String(a.largura_mm || 80),
    });
    setModal(true);
  };

  const alternarCategoria = (categoria: any) => {
    const atuais = new Set<number>(form.categorias || []);
    const ids = categoria.categoria_pai_id
      ? [categoria.id]
      : [categoria.id, ...categorias.filter((cat) => cat.categoria_pai_id === categoria.id).map((cat) => cat.id)];
    const selecionar = !atuais.has(categoria.id);
    ids.forEach((id) => selecionar ? atuais.add(id) : atuais.delete(id));
    setForm({ ...form, categorias: [...atuais] });
  };

  return (
    <AnimatedPage>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-800">Impressoras</h1>
          <p className="text-sm text-slate-500">Cadastre a impressora e escolha quais categorias e subcategorias serão enviadas para ela</p>
        </div>
        <Button icon={<Plus className="h-4 w-4" />} onClick={abrir}>Novo</Button>
      </div>

      <Card className="mb-4 border-blue-200 bg-gradient-to-r from-blue-50 to-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-blue-600 text-white">
            <Download className="h-5 w-5" />
          </div>
          <div className="mr-auto">
            <p className="font-extrabold text-slate-800">Baixar Gestor de Impressoras</p>
            <p className="text-sm text-slate-500">Desktop 1.5.4 e Android 1.5.3 com etiquetas de validade centralizadas nos protocolos RAW.</p>
          </div>
          <a
            className="inline-flex items-center rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
            href="/downloads/gestor-windows"
          >
            Baixar para Windows (.exe)
          </a>
          <a
            className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            href="/downloads/gestor-linux"
          >
            Baixar para Linux (.AppImage)
          </a>
          <a
            className="inline-flex items-center rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100"
            href="/downloads/gestor-android"
          >
            Baixar para Android (.apk)
          </a>
        </div>
      </Card>

      <Card className="mb-4 border-emerald-200 p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-600 text-white">
            <Smartphone className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-extrabold text-slate-800">Gestor Android</p>
              <Badge color={devices.some((d) => d.status === 'online') ? 'green' : 'slate'}>
                {devices.length ? `${devices.length} dispositivo(s)` : 'nenhum pareado'}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Pareie o celular ou tablet para imprimir por rede ou Bluetooth. O código é válido por dez minutos e só pode ser usado uma vez.
            </p>
            <p className="mt-1 text-sm font-medium text-emerald-700">
              Para várias impressoras, use no APK os mesmos nomes das rotas cadastradas abaixo (por exemplo: Cozinha, Bar e Caixa).
            </p>
          </div>
          <Button variant="secondary" onClick={gerarPareamento} disabled={gerandoPairing}>
            {gerandoPairing ? 'Gerando…' : 'Gerar pareamento'}
          </Button>
        </div>

        {pairing && (
          <div className="mt-4 grid gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase text-emerald-700">ID do pareamento</p>
              <p className="break-all font-mono text-sm text-slate-800">{pairing.pairing_id}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-emerald-700">Código</p>
              <p className="font-mono text-xl font-black tracking-wider text-slate-900">{pairing.code}</p>
            </div>
          </div>
        )}

        {devices.length > 0 && (
          <div className="mt-4 space-y-3">
            <Field label="Destino padrão das impressões">
              <Select value={gestorDeviceId} onChange={(e) => selecionarDevice(e.target.value)}>
                <option value="">Usar gestor Windows/Linux</option>
                {devices.map((device) => <option key={device.id} value={device.id}>{device.nome} · {device.status}</option>)}
              </Select>
            </Field>
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {devices.map((device) => (
              <div key={device.id} className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-800">{device.nome}</p>
                  <p className="truncate text-xs text-slate-500">{device.plataforma} · {device.id}</p>
                  <p className="text-xs text-slate-400">
                    {device.ultima_conexao ? `Última conexão: ${new Date(device.ultima_conexao).toLocaleString('pt-BR')}` : 'Nunca conectou'}
                  </p>
                </div>
                <Badge color={device.status === 'online' ? 'green' : device.status === 'error' ? 'red' : 'slate'}>{device.status}</Badge>
                <Button size="sm" variant="secondary" icon={<Printer className="h-3.5 w-3.5" />} onClick={() => testarDevice(device)}>
                  Testar
                </Button>
                <Button size="sm" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => removerDevice(device)}>
                  Excluir
                </Button>
              </div>
            ))}
            </div>
          </div>
        )}
      </Card>

      <Card className="mb-4 border-violet-200 p-4">
        <div className="mb-4">
          <p className="font-extrabold text-slate-800">Destinos por finalidade</p>
          <p className="mt-1 text-sm text-slate-500">Escolha diretamente qual impressora recebe cada tipo de documento.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {([
            ['imprime_conta', 'Fechamento de conta', 'Conta das mesas e comandas'],
            ['imprime_venda', 'Cupom de venda', 'Comprovante das vendas do PDV'],
            ['imprime_validade', 'Controle de validade', 'Etiquetas de abertura e vencimento'],
          ] as const).map(([campo, titulo, descricao]) => {
            const quantidade = agentes.filter((agente) => agente[campo]).length;
            return (
              <Field key={campo} label={titulo}>
                <Select value={finalidadeSelecionada(campo)} onChange={(e) => selecionarFinalidade(campo, e.target.value)}>
                  <option value="">Não imprimir automaticamente</option>
                  {agentes.filter((agente) => agente.ativo !== 0).map((agente) => (
                    <option key={agente.id} value={agente.id}>
                      {agente.nome}{agente.impressora_destino ? ` → ${agente.impressora_destino}` : ''}
                    </option>
                  ))}
                </Select>
                <p className="mt-1 text-xs text-slate-400">{descricao}</p>
                {quantidade > 1 && <p className="mt-1 text-xs font-semibold text-amber-600">Há {quantidade} rotas antigas selecionadas. Escolha uma para corrigir.</p>}
              </Field>
            );
          })}
        </div>
      </Card>

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
          <p className="font-bold text-slate-800">Papel e driver</p>
          <p className="mt-1 text-sm leading-relaxed text-slate-500">
            O gestor reconhece as impressoras instaladas no Windows e no Linux. Para impressoras térmicas, mantenha no
            driver o papel de {bobina}mm e margens mínimas; impressoras comuns usam o papel configurado no próprio driver.
          </p>
        </Card>
      </div>

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <p className="font-bold text-slate-800">Impressão direta (gestor local)</p>
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
          Ao tocar em "Imprimir", o app envia o recibo direto para o gestor (sem diálogo do navegador),
          usando o serviço rodando em <code className="rounded bg-slate-100 px-1">http://127.0.0.1:8410</code>.
          Se o servidor estiver offline, a impressão cai automaticamente para o diálogo do navegador.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="flex items-center gap-3">
            <Toggle checked={direct} onChange={mudarDirect} label="Impressão direta via gestor" />
            <span className="text-sm text-slate-600">{direct ? 'Direto via gestor (sem diálogo)' : 'Diálogo do navegador'}</span>
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
          { value: 'agentes', label: 'Impressoras' },
          { value: 'etiquetas', label: 'Modelos de etiqueta' },
        ]}
      />

      {load ? (
        <Spinner />
      ) : (
        <div className="mt-4">
          {tab === 'agentes' && (
            agentes.length === 0 ? (
              <Card><EmptyState icon={<Network className="h-8 w-8" />} title="Nenhuma impressora" subtitle="Cadastre uma fila CUPS e depois selecione-a na categoria" /></Card>
            ) : (
              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="th">Nome</th>
                        <th className="th">Categorias vinculadas</th>
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
                              {categorias.filter((c) => c.impressora_herdada_id === a.id).length === 0
                                ? <span className="text-xs text-slate-400">Nenhuma categoria</span>
                                : categorias.filter((c) => c.impressora_herdada_id === a.id).map((cat) => <Badge key={cat.id} color="blue">{cat.categoria_pai_id ? `↳ ${cat.nome}` : cat.nome}</Badge>)}
                            </div>
                          </td>
                          <td className="td">
                            <div className="space-y-1">
                              {a.imprime_conta ? <Badge color="green">Imprime conta</Badge> : '—'}
                              {a.imprime_venda && <Badge color="blue">Cupom de venda</Badge>}
                              {a.imprime_validade && <Badge color="amber">Controle de validade</Badge>}
                              {a.servidor_tipo && <p className="text-xs text-slate-500">{a.servidor_tipo === 'android' ? 'Android' : 'Desktop'} → {a.impressora_destino || 'padrão do servidor'}</p>}
                            </div>
                          </td>
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

      <Modal open={modal} onClose={() => { setModal(false); setEditandoAgente(null); }} title={tab === 'agentes' ? (editandoAgente ? 'Editar impressora' : 'Nova impressora') : 'Novo modelo de etiqueta'}>
        <form onSubmit={salvar} className="space-y-4">
          {tab !== 'agentes' && (
            <Field label="Nome do modelo *">
              <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} autoFocus />
            </Field>
          )}
          {tab === 'agentes' && (
            <>
              <Field label="Nome da rota *">
                <Input value={form.nome || ''} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Ex.: Cozinha, Bar ou Caixa" autoFocus />
              </Field>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Servidor de impressão *">
                  <Select value={form.servidor_tipo && form.servidor_id ? `${form.servidor_tipo}:${form.servidor_id}` : ''} onChange={(e) => {
                    const [tipo, ...id] = e.target.value.split(':');
                    setForm({ ...form, servidor_tipo: tipo || '', servidor_id: id.join(':'), impressora_destino: '' });
                  }}>
                    <option value="">Selecione o servidor</option>
                    {servidores.map((servidor) => <option key={servidor.key} value={servidor.key}>{servidor.nome} · {servidor.plataforma} · {servidor.online ? 'online' : 'offline'}</option>)}
                  </Select>
                </Field>
                <Field label="Impressora dentro do servidor (opcional)">
                  <Select value={form.impressora_destino || ''} disabled={!servidorSelecionado} onChange={(e) => {
                    const printer = servidorSelecionado?.printers.find((item: any) => item.name === e.target.value);
                    setForm({ ...form, impressora_destino: e.target.value, largura_mm: String(printer?.width_mm || form.largura_mm || 80) });
                  }}>
                    <option value="">Usar a impressora padrão do servidor</option>
                    {form.impressora_destino && !servidorSelecionado?.printers.some((item: any) => item.name === form.impressora_destino) && <option value={form.impressora_destino}>{form.impressora_destino} (não sincronizada)</option>}
                    {(servidorSelecionado?.printers || []).map((printer: any) => <option key={printer.name} value={printer.name}>{printer.displayName || printer.name}</option>)}
                  </Select>
                </Field>
              </div>
              {servidores.length === 0 && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">Nenhum servidor sincronizado. Abra o Gestor Android, Windows ou Linux e aguarde alguns segundos.</p>}
              {servidorSelecionado && servidorSelecionado.printers.length === 0 && <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">Nenhuma impressora foi publicada por este servidor. Você pode salvar assim mesmo; o gestor usará sua impressora padrão.</p>}
              <Field label="Categorias que imprimem nesta impressora">
                <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">
                  {categorias.filter((cat) => !cat.categoria_pai_id).map((categoria) => (
                    <div key={categoria.id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 font-semibold text-slate-700 hover:bg-slate-50">
                        <input type="checkbox" checked={(form.categorias || []).includes(categoria.id)} onChange={() => alternarCategoria(categoria)} />
                        {categoria.nome}
                        <span className="text-xs font-normal text-slate-400">(inclui todas as subcategorias)</span>
                      </label>
                      {categorias.filter((sub) => sub.categoria_pai_id === categoria.id).map((sub) => (
                        <label key={sub.id} className="ml-7 flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
                          <input
                            type="checkbox"
                            checked={(form.categorias || []).includes(sub.id)}
                            disabled={(form.categorias || []).includes(categoria.id)}
                            onChange={() => alternarCategoria(sub)}
                          />
                          {sub.nome}
                        </label>
                      ))}
                    </div>
                  ))}
                  {categorias.length === 0 && <p className="px-2 py-3 text-sm text-slate-400">Nenhuma categoria cadastrada.</p>}
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
                  <Toggle checked={form.imprime_pedidos !== false} onChange={(v) => setForm({ ...form, imprime_pedidos: v })} label="Receber pedidos das categorias" />
                  <Toggle checked={!!form.imprime_conta} onChange={(v) => setForm({ ...form, imprime_conta: v })} label="Imprimir fechamento de conta" />
                  <Toggle checked={!!form.imprime_venda} onChange={(v) => setForm({ ...form, imprime_venda: v })} label="Imprimir cupom de venda (PDV)" />
                  <Toggle checked={!!form.imprime_validade} onChange={(v) => setForm({ ...form, imprime_validade: v })} label="Imprimir controle de validade" />
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
