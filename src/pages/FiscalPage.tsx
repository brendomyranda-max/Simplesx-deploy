import { useEffect, useMemo, useState } from 'react';
import { FileCheck2, PackageSearch, ReceiptText, Save, XCircle } from 'lucide-react';
import { AnimatedPage } from '@/components/anim';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Spinner, Textarea, useToast } from '@/components/ui';
import { fiscalApi } from '@/lib/api';
import { fmtBRL } from '@/lib/format';

const vazio = {
  ativo: 0, ambiente: 'homologacao', provedor: 'simulador', razao_social: '', nome_fantasia: '', cnpj: '',
  inscricao_estadual: '', regime_tributario: 1, uf: '', codigo_municipio: '', municipio: '', cep: '',
  logradouro: '', numero_endereco: '', bairro: '', serie: 1, proximo_numero: 1, emitir_automaticamente: 0,
};

export function FiscalPage() {
  const toast = useToast();
  const [aba, setAba] = useState<'config'|'produtos'|'documentos'>('config');
  const [config, setConfig] = useState<any>(vazio);
  const [produtos, setProdutos] = useState<any[]>([]);
  const [documentos, setDocumentos] = useState<any[]>([]);
  const [editando, setEditando] = useState<any>(null);
  const [cancelando, setCancelando] = useState<any>(null);
  const [justificativa, setJustificativa] = useState('');
  const [busca, setBusca] = useState('');
  const [load, setLoad] = useState(true);
  const [saving, setSaving] = useState(false);

  const carregar = async () => {
    setLoad(true);
    try {
      const [c, p, d] = await Promise.all([fiscalApi.config(), fiscalApi.produtos(), fiscalApi.documentos()]);
      setConfig({ ...vazio, ...c }); setProdutos(p); setDocumentos(d);
    } catch (e: any) { toast('error', e?.error || 'Erro ao carregar módulo fiscal'); }
    finally { setLoad(false); }
  };
  useEffect(() => { carregar(); }, []);
  const set = (k: string, v: any) => setConfig((c: any) => ({ ...c, [k]: v }));

  const salvarConfig = async () => {
    setSaving(true);
    try { setConfig(await fiscalApi.salvarConfig(config)); toast('success', 'Configuração fiscal salva'); }
    catch (e: any) { toast('error', e?.error || 'Não foi possível salvar'); }
    finally { setSaving(false); }
  };
  const salvarProduto = async () => {
    setSaving(true);
    try { await fiscalApi.salvarProduto(editando.id, editando); setEditando(null); setProdutos(await fiscalApi.produtos()); toast('success', 'Tributação do produto salva'); }
    catch (e: any) { toast('error', e?.error || 'Não foi possível salvar'); }
    finally { setSaving(false); }
  };
  const confirmarCancelamento = async () => {
    setSaving(true);
    try { await fiscalApi.cancelar(cancelando.id, justificativa); setCancelando(null); setJustificativa(''); setDocumentos(await fiscalApi.documentos()); toast('success', 'Documento cancelado'); }
    catch (e: any) { toast('error', e?.error || 'Não foi possível cancelar'); }
    finally { setSaving(false); }
  };
  const filtrados = useMemo(() => produtos.filter((p) => `${p.nome} ${p.codigo_interno}`.toLowerCase().includes(busca.toLowerCase())), [produtos, busca]);
  const completos = produtos.filter((p) => String(p.ncm || '').replace(/\D/g, '').length === 8 && p.cfop && (config.regime_tributario === 1 ? p.csosn : p.cst_icms)).length;

  if (load) return <Spinner />;
  return <AnimatedPage>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-xl font-extrabold text-slate-800">NFC-e</h1><p className="text-sm text-slate-500">Configuração, tributação e documentos do estabelecimento</p></div>
      <Badge color={config.ativo ? 'green' : 'slate'}>{config.ativo ? `${config.ambiente} · ${config.provedor}` : 'Emissão desativada'}</Badge>
    </div>
    <div className="mb-4 flex gap-2 overflow-x-auto">
      {([['config','Emitente',FileCheck2],['produtos','Produtos fiscais',PackageSearch],['documentos','Documentos',ReceiptText]] as const).map(([id,label,Icon]) =>
        <Button key={id} variant={aba===id?'primary':'secondary'} icon={<Icon className="h-4 w-4" />} onClick={() => setAba(id)}>{label}</Button>)}
    </div>

    {aba === 'config' && <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-4 p-5">
        <div className="flex items-center justify-between"><h2 className="font-bold text-slate-800">Empresa emissora</h2>
          <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={!!config.ativo} onChange={e=>set('ativo',e.target.checked?1:0)} /> Ativar</label></div>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Razão social *"><Input value={config.razao_social} onChange={e=>set('razao_social',e.target.value)} /></Field><Field label="Nome fantasia"><Input value={config.nome_fantasia} onChange={e=>set('nome_fantasia',e.target.value)} /></Field></div>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="CNPJ *"><Input value={config.cnpj} onChange={e=>set('cnpj',e.target.value)} /></Field><Field label="Inscrição estadual *"><Input value={config.inscricao_estadual} onChange={e=>set('inscricao_estadual',e.target.value)} /></Field></div>
        <div className="grid gap-3 sm:grid-cols-3"><Field label="Regime"><Select value={config.regime_tributario} onChange={e=>set('regime_tributario',Number(e.target.value))}><option value={1}>Simples Nacional</option><option value={2}>Simples — excesso</option><option value={3}>Regime normal</option></Select></Field><Field label="UF *"><Input maxLength={2} value={config.uf} onChange={e=>set('uf',e.target.value.toUpperCase())} /></Field><Field label="Código IBGE *"><Input value={config.codigo_municipio} onChange={e=>set('codigo_municipio',e.target.value)} /></Field></div>
        <Field label="Município"><Input value={config.municipio} onChange={e=>set('municipio',e.target.value)} /></Field>
        <div className="grid gap-3 sm:grid-cols-3"><Field label="CEP *"><Input value={config.cep} onChange={e=>set('cep',e.target.value)} /></Field><Field label="Logradouro *"><Input value={config.logradouro} onChange={e=>set('logradouro',e.target.value)} /></Field><Field label="Número *"><Input value={config.numero_endereco} onChange={e=>set('numero_endereco',e.target.value)} /></Field></div>
        <Field label="Bairro *"><Input value={config.bairro} onChange={e=>set('bairro',e.target.value)} /></Field>
      </Card>
      <Card className="space-y-4 p-5">
        <h2 className="font-bold text-slate-800">Emissão</h2>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">O simulador testa o fluxo completo em homologação, mas não gera documento com validade fiscal.</div>
        <Field label="Ambiente"><Select value={config.ambiente} onChange={e=>set('ambiente',e.target.value)}><option value="homologacao">Homologação</option><option value="producao">Produção</option></Select></Field>
        <Field label="Provedor"><Select value={config.provedor} onChange={e=>set('provedor',e.target.value)}><option value="simulador">Simulador interno</option><option value="nuvem_fiscal">Nuvem Fiscal</option><option value="focus_nfe">Focus NFe</option></Select></Field>
        <Field label="Identificador da empresa no provedor"><Input value={config.provedor_empresa_id || ''} onChange={e=>set('provedor_empresa_id',e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Série"><Input type="number" min="1" value={config.serie} onChange={e=>set('serie',Number(e.target.value))} /></Field><Field label="Próximo número"><Input type="number" min="1" value={config.proximo_numero} onChange={e=>set('proximo_numero',Number(e.target.value))} /></Field></div>
        <label className="flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-sm"><input className="mt-1" type="checkbox" checked={!!config.emitir_automaticamente} onChange={e=>set('emitir_automaticamente',e.target.checked?1:0)} /><span><b>Emitir automaticamente</b><br/><span className="text-slate-500">Tenta emitir após concluir cada venda do PDV.</span></span></label>
        <div className="rounded-xl bg-slate-50 p-3 text-sm"><b>{completos} de {produtos.length}</b> produtos com cadastro fiscal mínimo completo.</div>
        <Button className="w-full" loading={saving} icon={<Save className="h-4 w-4" />} onClick={salvarConfig}>Salvar configuração</Button>
      </Card>
    </div>}

    {aba === 'produtos' && <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold text-slate-800">Tributação por produto</h2><p className="text-xs text-slate-500">Os códigos devem ser definidos com apoio da contabilidade.</p></div><Input className="max-w-xs" placeholder="Buscar produto" value={busca} onChange={e=>setBusca(e.target.value)} /></div>
      <div className="divide-y divide-slate-100">{filtrados.map(p=><button key={p.id} className="flex w-full items-center gap-3 py-3 text-left hover:bg-slate-50" onClick={()=>setEditando({...p})}><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-slate-700">{p.nome}</p><p className="text-xs text-slate-400">{p.codigo_interno || 'Sem código'} · {fmtBRL(p.preco)}</p></div><span className="font-mono text-xs text-slate-500">NCM {p.ncm || '—'} · CFOP {p.cfop || '—'}</span><Badge color={String(p.ncm||'').length===8?'green':'amber'}>{String(p.ncm||'').length===8?'Configurado':'Pendente'}</Badge></button>)}</div>
      {!filtrados.length && <EmptyState icon={<PackageSearch className="h-8 w-8" />} title="Nenhum produto encontrado" subtitle="Cadastre produtos antes de configurar a tributação." />}
    </Card>}

    {aba === 'documentos' && <Card className="p-5">
      <h2 className="mb-4 font-bold text-slate-800">Documentos emitidos</h2>
      <div className="divide-y divide-slate-100">{documentos.map(d=><div key={d.id} className="flex flex-wrap items-center gap-3 py-3"><div className="min-w-0 flex-1"><p className="text-sm font-bold text-slate-700">NFC-e {d.serie}/{d.numero} · Venda {d.venda_numero}</p><p className="truncate font-mono text-[11px] text-slate-400">{d.chave_acesso || d.referencia}</p></div><span className="text-sm font-bold">{fmtBRL(d.valor_total)}</span><Badge color={d.status==='cancelada'?'red':d.status==='simulada'?'amber':'green'}>{d.status}</Badge>{['simulada','autorizada'].includes(d.status)&&<Button size="sm" variant="danger" icon={<XCircle className="h-4 w-4" />} onClick={()=>setCancelando(d)}>Cancelar</Button>}</div>)}</div>
      {!documentos.length && <EmptyState icon={<ReceiptText className="h-8 w-8" />} title="Nenhuma NFC-e" subtitle="Os documentos emitidos aparecerão aqui." />}
    </Card>}

    <Modal open={!!editando} onClose={()=>setEditando(null)} title={editando?.nome || 'Produto fiscal'} width="max-w-2xl">{editando&&<div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3"><Field label="NCM *"><Input value={editando.ncm||''} onChange={e=>setEditando({...editando,ncm:e.target.value})} /></Field><Field label="CEST"><Input value={editando.cest||''} onChange={e=>setEditando({...editando,cest:e.target.value})} /></Field><Field label="CFOP *"><Input value={editando.cfop||'5102'} onChange={e=>setEditando({...editando,cfop:e.target.value})} /></Field></div>
      <div className="grid gap-3 sm:grid-cols-3"><Field label="Origem"><Select value={editando.origem??0} onChange={e=>setEditando({...editando,origem:Number(e.target.value)})}><option value={0}>0 — Nacional</option><option value={1}>1 — Importação direta</option><option value={2}>2 — Adquirida exterior</option><option value={3}>3 — Nacional, conteúdo importado</option></Select></Field>{config.regime_tributario===1?<Field label="CSOSN *"><Input value={editando.csosn||''} onChange={e=>setEditando({...editando,csosn:e.target.value})} placeholder="Ex.: 102" /></Field>:<Field label="CST ICMS *"><Input value={editando.cst_icms||''} onChange={e=>setEditando({...editando,cst_icms:e.target.value})} /></Field>}<Field label="Alíquota ICMS %"><Input type="number" step="0.01" value={editando.aliquota_icms||0} onChange={e=>setEditando({...editando,aliquota_icms:Number(e.target.value)})} /></Field></div>
      <div className="grid gap-3 sm:grid-cols-4"><Field label="CST PIS"><Input value={editando.cst_pis||'49'} onChange={e=>setEditando({...editando,cst_pis:e.target.value})} /></Field><Field label="PIS %"><Input type="number" step="0.01" value={editando.aliquota_pis||0} onChange={e=>setEditando({...editando,aliquota_pis:Number(e.target.value)})} /></Field><Field label="CST COFINS"><Input value={editando.cst_cofins||'49'} onChange={e=>setEditando({...editando,cst_cofins:e.target.value})} /></Field><Field label="COFINS %"><Input type="number" step="0.01" value={editando.aliquota_cofins||0} onChange={e=>setEditando({...editando,aliquota_cofins:Number(e.target.value)})} /></Field></div>
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={()=>setEditando(null)}>Fechar</Button><Button loading={saving} onClick={salvarProduto}>Salvar tributação</Button></div>
    </div>}</Modal>
    <Modal open={!!cancelando} onClose={()=>setCancelando(null)} title="Cancelar NFC-e" width="max-w-lg"><div className="space-y-4"><Field label="Justificativa (15 a 255 caracteres)"><Textarea rows={4} value={justificativa} onChange={e=>setJustificativa(e.target.value)} /></Field><div className="flex justify-end gap-2"><Button variant="secondary" onClick={()=>setCancelando(null)}>Voltar</Button><Button variant="danger" loading={saving} onClick={confirmarCancelamento}>Confirmar cancelamento</Button></div></div></Modal>
  </AnimatedPage>;
}
