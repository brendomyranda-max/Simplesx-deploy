import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Nfc, Printer, Users, Wallet } from 'lucide-react';
import { AnimatedPage } from '@/components/AnimatedPage';
import { RestauranteAbas } from '@/components/RestauranteAbas';
import { NfcScanButton } from '@/components/NfcScanButton';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Spinner, useToast } from '@/components/ui';
import { cartaoApi, mesaApi, type CartaoAtendimento, type NfcEvento } from '@/lib/api';
import { useNfcLeitura } from '@/lib/useNfcBridge';
import { useWebNfc } from '@/lib/useWebNfc';
import { fmtBRL, FORMAS_PAGAMENTO } from '@/lib/format';
import { printReceipt } from '@/lib/print';
import type { Mesa } from '@/lib/types';

type Cadastro = Pick<NfcEvento, 'uid' | 'payload'> & { cartao: string; chave: string };
type ContaEncerrada = { id: string; nome: string; mesa: number; total: number };
const nomeCliente = (a: CartaoAtendimento) => a.cliente_atual || a.cliente_nome;
const totalConta = (a: CartaoAtendimento, percentual = Number(a.taxa_garcom_pct)) => {
  const subtotal = Number(Number(a.subtotal).toFixed(2));
  const taxa = Number((subtotal*percentual/100).toFixed(2));
  return Number((subtotal+taxa).toFixed(2));
};

export function RecepcaoPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [atendimentos, setAtendimentos] = useState<CartaoAtendimento[]>([]);
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [load, setLoad] = useState(true);
  const [busca, setBusca] = useState('');
  const [espera, setEspera] = useState(false);
  const [exclusiva, setExclusiva] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const ocupadoRef = useRef(false);
  const versaoRef = useRef(0);
  const versao = versaoRef.current;
  const webNfc = useWebNfc();
  const [cadastro, setCadastro] = useState<Cadastro | null>(null);
  const [nome, setNome] = useState('');
  const [mesaId, setMesaId] = useState('');
  const [conta, setConta] = useState<CartaoAtendimento | null>(null);
  const [fechar, setFechar] = useState(false);
  const [forma, setForma] = useState('dinheiro');
  const [taxaEditada, setTaxaEditada] = useState<{ id: string; valor: string } | null>(null);
  const [encerrada, setEncerrada] = useState<ContaEncerrada | null>(null);
  const [impressao, setImpressao] = useState<string | null>(null);
  const impressaoRef = useRef<HTMLDivElement>(null);
  const taxaTexto = conta && taxaEditada?.id===conta.id ? taxaEditada.valor : String(conta?.taxa_garcom_pct ?? 0);
  const taxaPct = Number(taxaTexto);
  const taxaValida = taxaTexto.trim()!=='' && Number.isFinite(taxaPct) && taxaPct>=0 && taxaPct<=100;

  const carregar = async () => {
    try {
      const [lista, salao] = await Promise.all([cartaoApi.list(), mesaApi.list()]);
      setAtendimentos(lista);
      setMesas(salao.mesas.filter(m=>m.ativo && m.tipo==='normal'));
    } catch (e: any) { toast('error', e?.error || 'Não foi possível carregar a recepção'); }
    finally { setLoad(false); }
  };
  useEffect(() => {
    void carregar();
    const timer = setInterval(() => { if (!document.hidden && !ocupadoRef.current) void carregar(); }, 10000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const id = params.get('atendimento');
    if (!id || load) return;
    const a = atendimentos.find(item=>item.id===id);
    if (a) { setConta(a); setFechar(params.get('fechar')==='1'); }
    else toast('info', 'Este atendimento já foi encerrado. O cartão está disponível para novo cadastro.');
    setParams({}, { replace: true });
  }, [params, load, atendimentos]);

  const ler = async (leitura: Pick<NfcEvento,'uid'|'payload'>, atual = versaoRef.current) => {
    if (ocupadoRef.current || atual!==versaoRef.current) return;
    ocupadoRef.current=true; setOcupado(true);
    try {
      const resultado = await cartaoApi.consultar(leitura);
      if (atual!==versaoRef.current) return;
      webNfc.stop(); setEspera(false); versaoRef.current++;
      if (resultado.atendimento) { setConta(resultado.atendimento); setFechar(false); }
      else { setNome(''); setCadastro({...leitura,cartao:resultado.cartao,chave:crypto.randomUUID()}); }
    } catch (e: any) { toast('error', e?.error || 'Não foi possível identificar o cartão'); }
    finally { ocupadoRef.current=false; setOcupado(false); }
  };
  useNfcLeitura(espera && !ocupado && !exclusiva, leitura=>{ void ler(leitura,versao); });

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cadastro || ocupadoRef.current) return;
    ocupadoRef.current=true; setOcupado(true);
    try {
      const a = await cartaoApi.cadastrar({...cadastro,cliente_nome:nome,mesa_id:Number(mesaId),garcom_nome:localStorage.getItem('simplesx_garcom_fixo') || undefined});
      setCadastro(null);
      toast('success', a.encerrado_em ? 'Este cadastro já foi encerrado. Aproxime o cartão para um novo atendimento.' : `${nome} cadastrado na mesa ${mesas.find(m=>m.id===a.mesa_id)?.numero || ''}`);
      await carregar();
    } catch (e: any) { toast('error',e?.error || 'Não foi possível cadastrar o cartão'); }
    finally { ocupadoRef.current=false; setOcupado(false); }
  };
  const encerrar = async () => {
    if (!conta || !taxaValida || ocupadoRef.current) return;
    ocupadoRef.current=true; setOcupado(true);
    try {
      const r = await cartaoApi.fechar(conta.id,{forma,total:totalConta(conta,taxaPct),taxa_garcom_pct:taxaPct});
      setEncerrada({id:conta.id,nome:nomeCliente(conta),mesa:conta.mesa_numero,total:r.total});
      setConta(null); setFechar(false); setTaxaEditada(null);
      toast('success',r.sem_consumo ? 'Atendimento sem consumo encerrado. Cartão liberado.' : 'Conta individual encerrada. Cartão liberado.');
      await carregar();
    } catch (e: any) {
      toast('error',e?.error || 'Não foi possível fechar a conta');
      const lista = await cartaoApi.list().catch(()=>null);
      if (lista) { setAtendimentos(lista); setConta(lista.find(a=>a.id===conta.id) || null); }
    } finally { ocupadoRef.current=false; setOcupado(false); }
  };
  const prepararImpressao = async (id: string, percentual?: number) => {
    if (ocupadoRef.current || (percentual!==undefined && !taxaValida)) return;
    ocupadoRef.current=true; setOcupado(true);
    try {
      const r = await cartaoApi.conta(id,percentual===undefined ? {} : {taxa_garcom_pct:percentual});
      if (conta?.id===id) setConta({...conta,subtotal:r.subtotal});
      setImpressao(r.impressao);
    } catch (e: any) { toast('error',e?.error || 'Não foi possível preparar a conta para impressão'); }
    finally { ocupadoRef.current=false; setOcupado(false); }
  };
  const imprimir = async () => {
    if (ocupadoRef.current) return;
    ocupadoRef.current=true; setOcupado(true);
    try { await printReceipt(impressaoRef.current); }
    catch (e: any) { toast('error',e?.error || e?.message || 'Não foi possível imprimir a conta'); }
    finally { ocupadoRef.current=false; setOcupado(false); }
  };
  const verConta = (a: CartaoAtendimento) => navigate(`/restaurante/comanda/${a.comanda_id}?pessoa=${a.pessoa_id}`);
  const exibidos = atendimentos.filter(a=>`${nomeCliente(a)} ${a.cartao} ${a.mesa_numero}`.toLocaleLowerCase().includes(busca.toLocaleLowerCase()));

  return <AnimatedPage>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-xl font-extrabold text-slate-800">Recepção</h1><p className="text-sm text-slate-500">Entregue um cartão por cliente e vincule à mesa. O cartão fica com essa pessoa até encerrar a conta.</p></div>
      <RestauranteAbas atual="recepcao" />
    </div>
    <div className="mb-5 flex flex-wrap items-center gap-3">
      <Button icon={<Nfc className="h-4 w-4" />} onClick={()=>{versaoRef.current++; setExclusiva(!!webNfc.begin()); setEspera(true);}}>Cadastrar ou consultar cartão</Button>
      <Button variant="secondary" onClick={()=>navigate('/restaurante/lancar-cartao')}>Lançar para cartão</Button>
      <Badge color="green">{atendimentos.length} clientes em atendimento</Badge>
    </div>
    <Input aria-label="Buscar cliente, mesa ou cartão" placeholder="Buscar cliente, mesa ou cartão" value={busca} onChange={e=>setBusca(e.target.value)} className="mb-4" />
    {load ? <Spinner /> : !exibidos.length ? <Card><EmptyState icon={<Users className="h-6 w-6" />} title="Nenhum atendimento encontrado" subtitle="Aproxime um cartão para cadastrar o cliente e sua mesa." /></Card> :
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{exibidos.map(a=><Card key={a.id} className="p-4">
        <div className="flex justify-between gap-3"><h2 className="font-bold text-slate-800">{nomeCliente(a)}</h2><Badge color="purple">Mesa {a.mesa_numero}</Badge></div>
        <p className="mt-2 break-all text-xs text-slate-500">Cartão {a.cartao}</p>
        <p className="my-3 text-lg font-bold">{fmtBRL(totalConta(a))}</p>
        <div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={()=>verConta(a)}>Ver / lançar pedidos</Button><Button size="sm" icon={<Wallet className="h-4 w-4" />} onClick={()=>{setConta(a);setFechar(true);setForma('dinheiro');}}>Fechar comanda</Button></div>
      </Card>)}</div>}
    <Modal open={espera} title="Aproxime o cartão do cliente" onClose={()=>{if(!ocupadoRef.current){webNfc.stop();versaoRef.current++;setEspera(false);}}}>
      <div className="space-y-4 py-4 text-center"><Nfc className="mx-auto h-12 w-12 text-brand-600" />
        <NfcScanButton key={versao} enabled={!ocupado} webScan={webNfc.scan} onWebStart={()=>{webNfc.begin(true);setExclusiva(true);}} onStart={(exclusive=true)=>setExclusiva(exclusive)} onRead={leitura=>{void ler(leitura,versao);}} />
        <p className="text-sm text-slate-500">Depois da leitura, informe o nome do cliente e a mesa.</p>{ocupado && <Spinner />}
      </div>
    </Modal>
    <Modal open={!!cadastro} title="Cadastrar comanda individual" onClose={()=>{if(!ocupadoRef.current)setCadastro(null);}}>
      <form onSubmit={salvar} className="space-y-4">
        <p className="break-all text-sm text-slate-500">Cartão {cadastro?.cartao}</p>
        <Field label="Nome do cliente"><Input autoFocus required disabled={ocupado} maxLength={100} value={nome} onChange={e=>setNome(e.target.value)} /></Field>
        <Field label="Mesa"><Select required disabled={ocupado} value={mesaId} onChange={e=>setMesaId(e.target.value)}><option value="">Selecione a mesa</option>{mesas.map(m=><option key={m.id} value={m.id}>Mesa {m.numero} · {m.nome}</option>)}</Select></Field>
        {!mesas.length && <p className="text-sm text-amber-700">Cadastre uma mesa na aba Mesas para receber o cliente.</p>}
        <p className="text-sm text-slate-500">Os pedidos deste cartão vão para a conta individual do cliente nesta mesa.</p>
        <Button type="submit" loading={ocupado} disabled={!nome.trim() || !mesaId}>Salvar atendimento</Button>
      </form>
    </Modal>
    <Modal open={!!conta && !impressao} title={fechar ? 'Fechar comanda individual' : 'Cartão em atendimento'} onClose={()=>{if(!ocupadoRef.current){setConta(null);setTaxaEditada(null);}}}>
      {conta && <div className="space-y-4">
        <p className="font-bold">{nomeCliente(conta)} · Mesa {conta.mesa_numero}</p><p className="break-all text-xs text-slate-500">Cartão {conta.cartao}</p>
        {fechar && <div className="space-y-2"><Field label="Porcentagem do garçom (%)"><Input type="number" min={0} max={100} step="any" disabled={ocupado} value={taxaTexto} onChange={e=>setTaxaEditada({id:conta.id,valor:e.target.value})} /></Field>
          <Button size="sm" variant="secondary" disabled={ocupado} onClick={()=>setTaxaEditada({id:conta.id,valor:'0'})}>Sem taxa de serviço</Button>
          {!taxaValida && <p className="text-sm text-red-600">Informe uma porcentagem entre 0 e 100.</p>}
          <p className="text-xs text-slate-500">Este percentual vale somente para a conta deste cliente.</p></div>}
        <div className="space-y-1 text-sm"><p>Consumo: {fmtBRL(Number(conta.subtotal))}</p><p>Serviço ({taxaValida ? taxaPct : '—'}%): {taxaValida ? fmtBRL(totalConta(conta,taxaPct)-Number(Number(conta.subtotal).toFixed(2))) : '—'}</p><p className="text-lg font-bold">Total: {taxaValida ? fmtBRL(totalConta(conta,taxaPct)) : '—'}</p></div>
        <Button variant="secondary" icon={<Printer className="h-4 w-4" />} disabled={ocupado || !taxaValida} onClick={()=>void prepararImpressao(conta.id,taxaPct)}>Imprimir conta</Button>
        {fechar ? <><Field label="Forma de pagamento"><Select disabled={ocupado} value={forma} onChange={e=>setForma(e.target.value)}>{FORMAS_PAGAMENTO.map(f=><option key={f.valor} value={f.valor}>{f.label}</option>)}</Select></Field>
          <p className="text-sm text-slate-500">Confirme após receber o pagamento. A conta deste cliente será encerrada e o cartão ficará disponível para outro atendimento.</p>
          <Button loading={ocupado} disabled={!taxaValida} onClick={()=>void encerrar()}>{Number(conta.subtotal)===0 ? 'Encerrar atendimento' : 'Confirmar pagamento e liberar cartão'}</Button></> :
          <><p className="text-sm text-slate-500">Este cartão permanece vinculado ao cliente até fechar sua conta.</p><div className="flex gap-2"><Button onClick={()=>verConta(conta)}>Ver / lançar pedidos</Button><Button variant="secondary" onClick={()=>setFechar(true)}>Fechar comanda</Button></div></>}
      </div>}
    </Modal>
    <Modal open={!!encerrada && !impressao} title="Comanda encerrada" onClose={()=>{if(!ocupadoRef.current)setEncerrada(null);}}>
      {encerrada && <div className="space-y-4"><p className="font-bold">{encerrada.nome} · Mesa {encerrada.mesa}</p><p className="text-lg font-bold">Total: {fmtBRL(encerrada.total)}</p>
        <p className="text-sm text-slate-500">O cartão já está liberado para outro atendimento. Você pode imprimir a conta deste cliente agora.</p>
        <div className="flex flex-wrap gap-2"><Button icon={<Printer className="h-4 w-4" />} loading={ocupado} onClick={()=>void prepararImpressao(encerrada.id)}>Imprimir conta</Button><Button variant="secondary" disabled={ocupado} onClick={()=>setEncerrada(null)}>Concluir</Button></div>
      </div>}
    </Modal>
    <Modal open={!!impressao} title="Conta individual para impressão" onClose={()=>{if(!ocupadoRef.current)setImpressao(null);}}>
      <div ref={impressaoRef} className="mx-auto w-64 rounded-lg border-2 border-dashed border-slate-300 bg-white p-3 font-mono text-[11px] leading-4"><pre className="whitespace-pre-wrap">{impressao}</pre></div>
      <div className="mt-4 flex gap-2"><Button icon={<Printer className="h-4 w-4" />} loading={ocupado} onClick={()=>void imprimir()}>Imprimir</Button><Button variant="secondary" disabled={ocupado} onClick={()=>setImpressao(null)}>Voltar</Button></div>
    </Modal>
  </AnimatedPage>;
}
