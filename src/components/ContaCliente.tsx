import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { UserRound, X } from 'lucide-react';
import { clienteApi, type PedidoCliente } from '@/lib/api';
import { pontoDoPerfil, useClienteMarketplace } from '@/lib/cliente-marketplace';
import type { PontoCliente } from '@/lib/localizacao-cliente';
import { SeletorLocalizacao } from './SeletorLocalizacao';
import { fmtBRL } from '@/lib/format';

export function ContaCliente() {
  const { cliente, carregando, erro, carregar } = useClienteMarketplace();
  const [aberta, setAberta] = useState(false);
  return <>
    <button type="button" className="online-account-trigger" onClick={() => { if (erro) void carregar(); setAberta(true); }} disabled={carregando}>
      <UserRound aria-hidden="true" /><span>{carregando ? 'Carregando…' : cliente ? cliente.nome.split(' ')[0] : 'Entrar / cadastrar'}</span>
    </button>
    {aberta && <ModalContaCliente onClose={() => setAberta(false)} />}
  </>;
}

export function ModalContaCliente({ onClose }: { onClose: () => void }) {
  const { cliente, definir, sair, erro: erroConta } = useClienteMarketplace();
  const [cadastro, setCadastro] = useState(false);
  const [nome, setNome] = useState(cliente?.nome || '');
  const [telefone, setTelefone] = useState(cliente?.telefone || '');
  const [senha, setSenha] = useState('');
  const [endereco, setEndereco] = useState(cliente?.endereco || '');
  const [numero, setNumero] = useState(cliente?.numero || '');
  const [complemento, setComplemento] = useState(cliente?.complemento || '');
  const [ponto, setPonto] = useState<PontoCliente | null>(() => pontoDoPerfil(cliente));
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [pedidos, setPedidos] = useState<PedidoCliente[]>([]);
  const [estadoPedidos, setEstadoPedidos] = useState('Carregando pedidos…');
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>('input,button')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !ocupado) { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab') return;
      const elements = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),a[href],select,textarea') || [])].filter((el) => el.offsetParent !== null);
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); anterior?.focus(); };
  }, [onClose, ocupado]);

  useEffect(() => {
    if (!cliente) return;
    setNome(cliente.nome); setTelefone(cliente.telefone); setEndereco(cliente.endereco);
    setNumero(cliente.numero); setComplemento(cliente.complemento); setPonto(pontoDoPerfil(cliente));
    let ativo = true;
    clienteApi.pedidos().then((lista) => { if (ativo) { setPedidos(lista); setEstadoPedidos(lista.length ? '' : 'Você ainda não fez pedidos com esta conta.'); } })
      .catch(() => { if (ativo) setEstadoPedidos('Não foi possível carregar os pedidos. Abra sua conta novamente para tentar.'); });
    return () => { ativo = false; };
  }, [cliente]);

  const salvar = async (event: React.FormEvent) => {
    event.preventDefault(); setOcupado(true); setErro('');
    try {
      const perfil = { nome, endereco, numero, complemento, latitude: ponto?.latitude ?? null, longitude: ponto?.longitude ?? null };
      const salvo = cliente ? await clienteApi.atualizar(perfil)
        : cadastro ? await clienteApi.cadastro({ ...perfil, telefone, senha }) : await clienteApi.login(telefone, senha);
      definir(salvo); setSenha(''); onClose();
    } catch (error: any) { setErro(error?.error || 'Não foi possível salvar sua conta.'); }
    finally { setOcupado(false); }
  };

  return <div className="online-overlay online-account-overlay" role="dialog" aria-modal="true" aria-labelledby="account-title" ref={dialog}>
    <div className="online-checkout online-account">
      <button className="online-close" type="button" disabled={ocupado} onClick={onClose} aria-label="Fechar conta"><X /></button>
      <h2 id="account-title">{cliente ? 'Minha conta' : cadastro ? 'Criar minha conta' : 'Entrar na minha conta'}</h2>
      <p className="online-config-note">Nome, telefone e endereço ficam salvos para os seus próximos pedidos.</p>
      <form onSubmit={salvar}>
        {(cliente || cadastro) && <label>Seu nome<input autoComplete="name" required maxLength={120} value={nome} onChange={(event) => setNome(event.target.value)} /></label>}
        <label>Telefone com DDD<input type="tel" autoComplete={cliente || cadastro ? 'tel-national' : 'username'} required maxLength={30} value={telefone} readOnly={!!cliente} onChange={(event) => setTelefone(event.target.value)} placeholder="(11) 99999-9999" />{cliente && <small>Este é o telefone usado para entrar na sua conta.</small>}</label>
        {!cliente && <label>Senha<input type="password" required minLength={8} maxLength={128} autoComplete={cadastro ? 'new-password' : 'current-password'} value={senha} onChange={(event) => setSenha(event.target.value)} /><small>Pelo menos 8 caracteres.</small></label>}
        {(cliente || cadastro) && <>
          <SeletorLocalizacao label="Endereço salvo (opcional)" endereco={endereco} onEnderecoChange={setEndereco} value={ponto} onChange={setPonto} disabled={ocupado} />
          <label>Número ou s/n<input autoComplete="address-line2" maxLength={30} value={numero} onChange={(event) => setNumero(event.target.value)} /></label>
          <label>Complemento e referência<input maxLength={100} value={complemento} onChange={(event) => setComplemento(event.target.value)} placeholder="Apartamento, bloco, portão…" /></label>
        </>}
        {(erro || erroConta) && <p className="online-erro" role="alert">{erro || erroConta}</p>}
        <button className="online-place-order" type="submit" disabled={ocupado}>{ocupado ? 'Aguarde…' : cliente ? 'Salvar meus dados' : cadastro ? 'Criar conta' : 'Entrar'}</button>
      </form>
      {!cliente && <button className="online-account-switch" type="button" disabled={ocupado} onClick={() => { setCadastro(!cadastro); setErro(''); setSenha(''); }}>{cadastro ? 'Já tenho conta. Entrar' : 'Ainda não tenho conta. Cadastrar'}</button>}
      {cliente && <>
        <h3>Meus pedidos</h3>
        {estadoPedidos && <p className="online-config-note">{estadoPedidos}</p>}
        <div className="online-account-orders">{pedidos.map((pedido) => <Link key={pedido.id} to={`/pedido/${pedido.loja_slug}/acompanhar/${encodeURIComponent(pedido.chave)}`} onClick={onClose}>
          <b>{pedido.loja_nome} · #{pedido.id}</b><span>{new Date(pedido.criado_em).toLocaleDateString('pt-BR')} · {pedido.status === 'cancelado' ? 'Cancelado' : pedido.etapa.replaceAll('_', ' ')} · {fmtBRL(pedido.total)}</span>
        </Link>)}</div>
        <button className="online-account-switch" type="button" disabled={ocupado} onClick={async () => {
          setOcupado(true); setErro('');
          try { await sair(); onClose(); } catch (error: any) { setErro(error?.error || 'Não foi possível sair.'); }
          finally { setOcupado(false); }
        }}>Sair da minha conta</button>
      </>}
    </div>
  </div>;
}
