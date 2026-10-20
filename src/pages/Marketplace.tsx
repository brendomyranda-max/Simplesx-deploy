/**
 * Vitrine DoixP Delivery. Ao entrar, pede a localização e mostra quem entrega na região.
 */

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BadgePercent, Bike, Clock3, CookingPot, IceCreamBowl, MapPin, Pizza, Search, Sandwich, ShoppingBag, Store, UtensilsCrossed, X } from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import { lerUltimoPedido, SUPORTE_DOIXP_URL } from '@/lib/delivery-cliente';
import { FotoGaleria } from '@/components/FotoGaleria';
import { authApi, onlineApi, onlinePublicApi } from '@/lib/api';
import type { OnlineStore, RedePedidos } from '@/lib/types';
import { fmtKm, gravarPontoCliente, lerPontoCliente, observarLocalizacao, textoEntrega, type PontoCliente } from '@/lib/localizacao-cliente';
import './online-storefront.css';
import { CATEGORIAS_DELIVERY, categoriaPrincipalDelivery } from '../../shared/categorias-delivery.js';

const ICONES_CATEGORIAS: Record<string, typeof Store> = {
  promocao: BadgePercent, lanches: Sandwich, pizza: Pizza, acai: IceCreamBowl, marmitas: CookingPot,
};

function prazo(loja: RedePedidos['lojas'][number]) {
  if (loja.tempo_min_entrega == null && loja.tempo_max_entrega == null) return null;
  if (loja.tempo_min_entrega != null && loja.tempo_max_entrega != null) return `${loja.tempo_min_entrega}–${loja.tempo_max_entrega} min`;
  return `${loja.tempo_min_entrega ?? loja.tempo_max_entrega} min`;
}

export function Marketplace() {
  const [categoria, setCategoria] = useState('');
  const [busca, setBusca] = useState('');
  const [consulta, setConsulta] = useState('');
  const [rede, setRede] = useState<RedePedidos>({ categorias: [], lojas: [] });
  const [estado, setEstado] = useState<'carregando' | 'pronto' | 'erro'>('carregando');
  const [mensagem, setMensagem] = useState('');
  const [minhaLoja, setMinhaLoja] = useState<OnlineStore | null>(null);
  const [editandoPerfil, setEditandoPerfil] = useState(false);
  const [nomePerfil, setNomePerfil] = useState('');
  const [fotoPerfil, setFotoPerfil] = useState('');
  const [salvandoPerfil, setSalvandoPerfil] = useState(false);
  const [erroPerfil, setErroPerfil] = useState('');
  const [versaoLoja, setVersaoLoja] = useState(0);
  const [sacolaAberta, setSacolaAberta] = useState(false);
  const ultimoPedido = lerUltimoPedido();
  const pontoInicial = lerPontoCliente();
  const [ponto, setPonto] = useState<PontoCliente | null>(pontoInicial);
  const [regiao, setRegiao] = useState(true);
  const [endereco, setEndereco] = useState(pontoInicial?.origem === 'endereco' ? pontoInicial.endereco : '');
  const [consultaEndereco, setConsultaEndereco] = useState(pontoInicial?.origem === 'endereco' ? pontoInicial.endereco : '');
  const [gpsAtivo, setGpsAtivo] = useState(pontoInicial?.origem !== 'endereco');
  const [avisoLocal, setAvisoLocal] = useState('');
  const [buscandoEndereco, setBuscandoEndereco] = useState(false);
  const gpsAtivoRef = useRef(true);

  useEffect(() => {
    gpsAtivoRef.current = gpsAtivo;
  }, [gpsAtivo]);

  useEffect(() => {
    let ativo = true;
    authApi.me().then(async (sessao) => {
      if (!ativo || !sessao.modulos?.includes('gestor')) return;
      const loja = await onlineApi.store();
      if (ativo) setMinhaLoja(loja);
    }).catch(() => undefined);
    return () => { ativo = false; };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setConsulta(busca.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [busca]);

  useEffect(() => {
    const timer = window.setTimeout(() => setConsultaEndereco(endereco.trim()), 700);
    return () => window.clearTimeout(timer);
  }, [endereco]);

  useEffect(() => {
    if (!gpsAtivo) return undefined;
    return observarLocalizacao({
      onPonto: (coords) => {
        if (!gpsAtivoRef.current) return;
        const proximo: PontoCliente = { ...coords, endereco: '', origem: 'gps' };
        setPonto(proximo);
        gravarPontoCliente(proximo);
        setAvisoLocal('');
      },
      onErro: (texto) => setAvisoLocal(texto),
    });
  }, [gpsAtivo]);

  useEffect(() => {
    if (consultaEndereco.length < 5) return undefined;
    if (ponto?.origem === 'endereco' && consultaEndereco === ponto.endereco) return undefined;
    let ativo = true;
    setGpsAtivo(false);
    setBuscandoEndereco(true);
    onlinePublicApi.locate({ q: consultaEndereco })
      .then((local) => {
        if (!ativo) return;
        const proximo: PontoCliente = {
          latitude: local.latitude,
          longitude: local.longitude,
          endereco: local.endereco || consultaEndereco,
          origem: 'endereco',
        };
        setPonto(proximo);
        gravarPontoCliente(proximo);
        setRegiao(true);
        setAvisoLocal('');
      })
      .catch((error: any) => {
        if (!ativo) return;
        setAvisoLocal(error?.error || 'Não foi possível localizar este endereço. Inclua rua, número e cidade.');
      })
      .finally(() => { if (ativo) setBuscandoEndereco(false); });
    return () => { ativo = false; };
  }, [consultaEndereco, ponto?.endereco, ponto?.origem]);

  useEffect(() => {
    let ativo = true;
    setEstado('carregando');
    const carregar = () => onlinePublicApi.network({
      categoria,
      q: consulta,
      lat: ponto?.latitude,
      lng: ponto?.longitude,
      regiao: Boolean(ponto) && regiao,
    })
      .then((dados) => {
        if (!ativo) return;
        setRede(dados);
        setEstado('pronto');
      })
      .catch((error: any) => {
        if (!ativo) return;
        setMensagem(error?.error || 'Não foi possível carregar os restaurantes');
        setEstado('erro');
      });
    carregar();
    const timer = setInterval(carregar, 30000);
    window.addEventListener('focus', carregar);
    return () => { ativo = false; clearInterval(timer); window.removeEventListener('focus', carregar); };
  }, [categoria, consulta, ponto?.latitude, ponto?.longitude, regiao, versaoLoja]);

  const usarGps = () => {
    setEndereco('');
    setConsultaEndereco('');
    setAvisoLocal('');
    setRegiao(true);
    setGpsAtivo(true);
  };

  const abrirPerfil = () => {
    if (!minhaLoja) return;
    setNomePerfil(minhaLoja.nome || '');
    setFotoPerfil(minhaLoja.logo_url || '');
    setErroPerfil('');
    setEditandoPerfil(true);
  };

  const salvarPerfil = async (event: React.FormEvent) => {
    event.preventDefault();
    const nome = nomePerfil.trim();
    if (!nome) return setErroPerfil('Informe o nome do estabelecimento.');
    setSalvandoPerfil(true);
    setErroPerfil('');
    try {
      const atualizada = await onlineApi.updateStore({ nome, logo_url: fotoPerfil || null });
      setMinhaLoja(atualizada);
      setEditandoPerfil(false);
      setVersaoLoja((versao) => versao + 1);
    } catch (error: any) {
      setErroPerfil(error?.error || 'Não foi possível salvar o perfil.');
    } finally {
      setSalvandoPerfil(false);
    }
  };

  const vazioRegiao = Boolean(ponto) && regiao && !categoria && !consulta;
  const categorias = [
    ...CATEGORIAS_DELIVERY,
    ...rede.categorias.filter((item) => !CATEGORIAS_DELIVERY.some((principal) => principal.busca === categoriaPrincipalDelivery(item.busca))),
  ];

  return (
    <div className="online-storefront min-h-viewport">
      <header className="online-topbar">
        <Link className="online-brand" to="/pedido">
          <span className="online-brand-mark"><BrandLogo aria-hidden="true" alt="" /></span>
          <span>DoixP Delivery</span>
        </Link>
        <button className="online-cart-trigger online-market-cart-trigger" type="button" onClick={() => setSacolaAberta(true)} aria-label="Abrir sacola e acompanhar pedido">
          <ShoppingBag aria-hidden="true" /><span>Sacola</span>
        </button>
      </header>
      <main className="online-market">
        <nav className="online-customer-links" aria-label="Pedidos e suporte">
          {ultimoPedido && <Link className="online-track-shortcut" to={ultimoPedido}>Acompanhar meu pedido</Link>}
          <span>Cadastro (nome, CPF, telefone e endereço): em breve</span>
          <span>Código de confirmação (4 últimos dígitos do CPF): em breve</span>
          <a href={SUPORTE_DOIXP_URL} target="_blank" rel="noopener noreferrer">Suporte DoixP no WhatsApp</a>
        </nav>
        <section className="online-where online-market-location" aria-label="Sua localização">
          <div className="online-where-head">
            <MapPin aria-hidden="true" />
            <div>
              <b>{ponto?.endereco || (ponto ? 'Usando sua localização' : 'Encontre restaurantes próximos a você')}</b>
              <span>
                {ponto && regiao
                  ? 'Mostrando quem entrega até você.'
                  : ponto
                    ? 'Mostrando todas as lojas, com a distância.'
                    : 'É necessário informar sua localização para encontrar restaurantes próximos a você.'}
              </span>
            </div>
          </div>
          <label className="online-market-search">
            <Search aria-hidden="true" />
            <input value={endereco} onChange={(event) => setEndereco(event.target.value)} placeholder="Rua, número e cidade" aria-label="Endereço para encontrar restaurantes" />
          </label>
          <div className="online-region-toggle">
            <button type="button" className={ponto && regiao ? 'active' : ''} disabled={!ponto} onClick={() => setRegiao(true)}>Na minha região</button>
            <button type="button" className={ponto && !regiao ? 'active' : ''} onClick={() => setRegiao(false)}>Ver todas</button>
            <button type="button" onClick={usarGps}>Usar minha localização</button>
          </div>
          {buscandoEndereco && <p className="online-config-note">Localizando o endereço…</p>}
          {avisoLocal && <p className="online-erro">{avisoLocal}</p>}
          {ponto && !regiao && <p className="online-where-note">Lojas sem área definida continuam nesta lista.</p>}
        </section>
        {minhaLoja && (
          <div className="online-market-owner" style={minhaLoja.cor_capa ? { background: minhaLoja.cor_capa } : undefined}>
            {minhaLoja.logo_url && <img className="online-market-owner-backdrop" src={minhaLoja.logo_url} alt="" aria-hidden="true" />}
            <div className="online-market-owner-identity">
              <div className="online-market-owner-photo">
                {minhaLoja.logo_url ? <img src={minhaLoja.logo_url} alt={`Foto de ${minhaLoja.nome}`} /> : <b aria-hidden="true">{(minhaLoja.nome || 'L').trim().charAt(0).toLocaleUpperCase('pt-BR')}</b>}
              </div>
              <div>
                <b>{minhaLoja.nome || 'Sua loja'}</b>
                <span>{!minhaLoja.ativo ? 'Ainda em rascunho.' : minhaLoja.aceita_pedidos_online === 0 ? 'Apenas cardápio online pelo seu link.' : minhaLoja.modo_publicacao === 'cardapio' ? 'Recebendo pedidos pelo seu link.' : 'Publicada no DoixP Delivery.'} {minhaLoja.aceita_pedidos_online !== 0 && minhaLoja.modo_publicacao !== 'cardapio' && (minhaLoja.segmentos?.length ? minhaLoja.segmentos.join(' · ') : 'Crie uma categoria para o cliente encontrar você.')}</span>
              </div>
            </div>
            <div className="online-market-owner-actions">
              <button type="button" onClick={() => editandoPerfil ? setEditandoPerfil(false) : abrirPerfil()}>{editandoPerfil ? 'Fechar edição' : 'Editar nome e foto'}</button>
              <Link to={`/pedido/${minhaLoja.slug}?configurar=1`}>Configurar minha loja</Link>
            </div>
            {editandoPerfil && (
              <form className="online-market-owner-form" onSubmit={salvarPerfil}>
                <label>Nome do estabelecimento
                  <input value={nomePerfil} maxLength={120} onChange={(event) => setNomePerfil(event.target.value)} />
                </label>
                <div><b>Foto do estabelecimento</b><FotoGaleria value={fotoPerfil} onChange={setFotoPerfil} /></div>
                {erroPerfil && <p className="online-erro" role="alert">{erroPerfil}</p>}
                <button type="submit" disabled={salvandoPerfil}>{salvandoPerfil ? 'Salvando…' : 'Salvar perfil'}</button>
              </form>
            )}
          </div>
        )}
        <header className="online-market-explore">
          <h1>Explore DoixP Delivery</h1>
          <label className="online-market-search">
          <Search aria-hidden="true" />
          <input value={busca} onChange={(event) => setBusca(event.target.value)} placeholder="Buscar restaurante ou categoria" aria-label="Buscar restaurante ou categoria" />
          </label>
        </header>
        <section className="online-market-category-section" aria-labelledby="delivery-categorias">
          <h2 id="delivery-categorias">Categorias</h2>
          <div className="online-market-categories" aria-label="Categorias do DoixP Delivery">
            {categorias.map((item) => {
              const Icon = ICONES_CATEGORIAS[item.busca] || UtensilsCrossed;
              return <button key={item.busca} type="button" data-categoria={item.busca} aria-pressed={categoria === item.busca}
                className={categoria === item.busca ? 'active' : ''} onClick={() => setCategoria(categoria === item.busca ? '' : item.busca)}>
                <span><Icon aria-hidden="true" /></span>
                <b>{item.nome}</b>
              </button>;
            })}
          </div>
        </section>
        <section className="online-market-stores" aria-labelledby="delivery-lojas">
          <header className="online-market-stores-heading">
            <div><h2 id="delivery-lojas">Lojas</h2><p>{ponto && regiao ? 'Restaurantes que entregam na sua região.' : 'Explore as lojas disponíveis.'}</p></div>
            {categoria && <button type="button" onClick={() => setCategoria('')}>Ver todas as categorias</button>}
          </header>
        {estado === 'carregando' && <div className="online-empty"><b>Carregando restaurantes…</b></div>}
        {estado === 'erro' && <div className="online-empty"><Store /><b>DoixP Delivery indisponível</b><span>{mensagem}</span></div>}
        {estado === 'pronto' && rede.lojas.length === 0 && (
          <div className="online-empty">
            <Store />
            <b>{vazioRegiao ? 'Nenhum restaurante entrega nesta região ainda' : (categoria || consulta ? 'Nenhum restaurante nesta busca' : 'Nenhum restaurante publicado')}</b>
            <span>{vazioRegiao ? 'Informe outro endereço ou veja todas as lojas disponíveis.' : 'Experimente outra categoria ou busque pelo nome de uma loja.'}</span>
            {vazioRegiao && <button type="button" onClick={() => setRegiao(false)}>Ver todas</button>}
          </div>
        )}
        {estado === 'pronto' && rede.lojas.length > 0 && (
          <div className="online-market-grid">
            {rede.lojas.map((loja) => {
              const tempo = prazo(loja);
              return (
                <Link key={loja.slug} className="online-market-card" to={`/pedido/${loja.slug}`}>
                  <span className={`online-market-logo ${loja.capa_url ? 'tem-capa' : loja.logo_url ? 'tem-foto' : 'tem-cor'}`} style={!loja.capa_url && !loja.logo_url && loja.cor_capa ? { background: loja.cor_capa } : undefined}>
                    {loja.capa_url ? <img src={loja.capa_url} alt="" /> : loja.logo_url ? <><img className="online-market-logo-backdrop" src={loja.logo_url} alt="" /><img className="online-market-logo-avatar" src={loja.logo_url} alt="" /></> : <em>{(loja.nome || 'L').trim().charAt(0).toLocaleUpperCase('pt-BR')}</em>}
                    {loja.capa_url && loja.logo_url ? <i className="online-market-selo"><img src={loja.logo_url} alt="" /></i> : null}
                  </span>
                  <h2>{loja.nome}</h2>
                  <p>{loja.descricao || 'Cardápio com os produtos cadastrados no estoque.'}</p>
                  {loja.segmentos.length > 0 && <div className="online-market-tags">{loja.segmentos.map((nome) => <span key={nome}>{nome}</span>)}</div>}
                  <small>
                    {loja.distancia_km != null && <em className={loja.entrega_na_regiao === 0 ? 'online-distance fora' : 'online-distance'}>a {fmtKm(loja.distancia_km)}{loja.entrega_na_regiao === 0 ? ' · fora da área' : ''}</em>}
                    {loja.distancia_km != null ? ' · ' : null}
                    {loja.aceita_entrega ? <><Bike /> {textoEntrega(loja)}</> : textoEntrega(loja)}
                    {loja.raio_entrega_km != null ? <> · até {fmtKm(loja.raio_entrega_km)}</> : null}
                    {tempo ? <> · <Clock3 /> {tempo}</> : null}
                  </small>
                </Link>
              );
            })}
          </div>
        )}
        </section>
      </main>
      {sacolaAberta && <div className="online-overlay online-cart-overlay" role="dialog" aria-modal="true" aria-labelledby="market-cart-title">
        <aside className="online-cart-drawer">
          <header><div><p>SEU PEDIDO</p><h2 id="market-cart-title">Sua sacola</h2></div><button className="online-close" type="button" onClick={() => setSacolaAberta(false)} aria-label="Fechar sacola"><X /></button></header>
          <div className="online-cart-empty">
            <ShoppingBag aria-hidden="true" />
            {ultimoPedido ? <><b>Acompanhe seu pedido</b><span>Veja o andamento do seu último pedido neste navegador.</span><Link className="online-cart-track-link" to={ultimoPedido}>Acompanhar meu pedido</Link></> : <><b>Sua sacola está vazia</b><span>Escolha uma loja e adicione produtos ao pedido.</span></>}
            <button type="button" onClick={() => setSacolaAberta(false)}>Ver restaurantes</button>
          </div>
        </aside>
      </div>}
    </div>
  );
}
