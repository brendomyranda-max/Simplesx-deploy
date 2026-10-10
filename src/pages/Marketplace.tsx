/**
 * Vitrine DoixP Delivery. Ao entrar, pede a localização e mostra quem entrega na região.
 */

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bike, Clock3, MapPin, Search, Store } from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import { authApi, onlineApi, onlinePublicApi } from '@/lib/api';
import type { OnlineStore, RedePedidos } from '@/lib/types';
import { fmtKm, gravarPontoCliente, lerPontoCliente, observarLocalizacao, textoEntrega, type PontoCliente } from '@/lib/localizacao-cliente';
import './online-storefront.css';

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
    onlinePublicApi.network({
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
    return () => { ativo = false; };
  }, [categoria, consulta, ponto?.latitude, ponto?.longitude, regiao]);

  const usarGps = () => {
    setEndereco('');
    setConsultaEndereco('');
    setAvisoLocal('');
    setRegiao(true);
    setGpsAtivo(true);
  };

  const vazioRegiao = Boolean(ponto) && regiao && !categoria && !consulta;

  return (
    <div className="online-storefront min-h-viewport">
      <header className="online-topbar">
        <Link className="online-brand" to="/pedido">
          <span className="online-brand-mark"><BrandLogo aria-hidden="true" alt="" /></span>
          <span>DoixP Delivery</span>
        </Link>
      </header>
      <main className="online-market">
        <p className="online-eyebrow">DOIXP DELIVERY</p>
        <h1>O que você quer pedir?</h1>
        <p className="online-market-lead">Ao entrar, pedimos sua localização para mostrar os restaurantes que entregam na sua região. Digite o endereço para ver a distância de cada um.</p>
        <section className="online-where" aria-label="Sua localização">
          <div className="online-where-head">
            <MapPin aria-hidden="true" />
            <div>
              <b>{ponto?.endereco || (ponto ? 'Usando sua localização' : 'Onde você está?')}</b>
              <span>
                {ponto && regiao
                  ? 'Mostrando quem entrega até você.'
                  : ponto
                    ? 'Mostrando todas as lojas, com a distância.'
                    : 'A localização serve para achar quem aceita entregar na sua região.'}
              </span>
            </div>
          </div>
          <label className="online-market-search">
            <Search aria-hidden="true" />
            <input value={endereco} onChange={(event) => setEndereco(event.target.value)} placeholder="Rua, número e cidade" />
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
        <label className="online-market-search">
          <Search aria-hidden="true" />
          <input value={busca} onChange={(event) => setBusca(event.target.value)} placeholder="Buscar restaurante ou categoria" />
        </label>
        {minhaLoja && (
          <div className="online-market-owner">
            <div>
              <b>{minhaLoja.nome || 'Sua loja'}</b>
              <span>{minhaLoja.ativo ? 'Publicada no DoixP Delivery.' : 'Ainda em rascunho.'} {minhaLoja.segmentos?.length ? minhaLoja.segmentos.join(' · ') : 'Crie uma categoria para o cliente encontrar você.'}</span>
            </div>
            <Link to={`/pedido/${minhaLoja.slug}?configurar=1`}>Configurar minha loja</Link>
          </div>
        )}
        <div className="online-categories" aria-label="Categorias do DoixP Delivery">
          <button type="button" className={categoria === '' ? 'active' : ''} onClick={() => setCategoria('')}>Todos</button>
          {rede.categorias.map((item) => (
            <button key={item.busca} type="button" className={categoria === item.busca ? 'active' : ''} onClick={() => setCategoria(item.busca)}>
              {item.nome} <small>{item.lojas}</small>
            </button>
          ))}
        </div>
        {estado === 'carregando' && <div className="online-empty"><b>Carregando restaurantes…</b></div>}
        {estado === 'erro' && <div className="online-empty"><Store /><b>DoixP Delivery indisponível</b><span>{mensagem}</span></div>}
        {estado === 'pronto' && rede.lojas.length === 0 && (
          <div className="online-empty">
            <Store />
            <b>{vazioRegiao ? 'Nenhum restaurante entrega nesta região ainda' : (categoria || consulta ? 'Nenhum restaurante nesta busca' : 'Nenhum restaurante publicado')}</b>
            <span>{vazioRegiao ? 'Cada estabelecimento define o limite, como 3,5 km ou 10 km. Você pode ver todas as lojas do DoixP Delivery.' : 'A categoria entra aqui quando o estabelecimento cria o modelo da loja e publica o cardápio.'}</span>
            {vazioRegiao && <button type="button" onClick={() => setRegiao(false)}>Ver todas</button>}
          </div>
        )}
        {estado === 'pronto' && rede.lojas.length > 0 && (
          <div className="online-market-grid">
            {rede.lojas.map((loja) => {
              const tempo = prazo(loja);
              return (
                <Link key={loja.slug} className="online-market-card" to={`/pedido/${loja.slug}`}>
                  <span className={`online-market-logo ${loja.capa_url ? 'tem-capa' : loja.cor_capa ? 'tem-cor' : loja.logo_url ? 'tem-foto' : ''}`} style={!loja.capa_url && loja.cor_capa ? { background: loja.cor_capa } : undefined}>
                    {loja.capa_url ? <img src={loja.capa_url} alt="" /> : loja.logo_url ? <img src={loja.logo_url} alt="" /> : (loja.cor_capa ? <em>{(loja.nome || 'L').trim().charAt(0).toLocaleUpperCase('pt-BR')}</em> : '🍽️')}
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
      </main>
    </div>
  );
}
