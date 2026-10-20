import { kvGet, kvPut, sha256 } from './util.js';

const AGENTE = 'DoixP-Delivery/1.0 (https://doixp.com)';
const TOLERANCIA_KM = 0.15;
const CACHE_TTL = 7 * 24 * 60 * 60;
const memoria = new Map();
const pendentes = new Map();
const ESTADOS = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará',
  DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso',
  MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná',
  PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul',
  RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
};

export function coordenadaValida(latitude, longitude) {
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude >= -90 && latitude <= 90
    && longitude >= -180 && longitude <= 180;
}

export function distanciaKm(origem, destino) {
  const radiano = (grau) => (grau * Math.PI) / 180;
  const terra = 6371;
  const dLat = radiano(destino.latitude - origem.latitude);
  const dLng = radiano(destino.longitude - origem.longitude);
  const lat1 = radiano(origem.latitude);
  const lat2 = radiano(destino.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * terra * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function kmExibido(valor) {
  return Math.round(Number(valor) * 10) / 10;
}

export function dentroDoRaio(distancia, raio) {
  return Number.isFinite(distancia) && Number.isFinite(raio) && distancia <= Number(raio) + TOLERANCIA_KM;
}

function pontoDe(latitude, longitude, endereco = '') {
  if (!coordenadaValida(latitude, longitude)) return null;
  return {
    latitude,
    longitude,
    endereco: String(endereco || '').slice(0, 180),
  };
}

async function buscarJson(url) {
  const resposta = await fetch(url, {
    headers: { 'User-Agent': AGENTE, Accept: 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  if (!resposta.ok) return null;
  return resposta.json();
}

function normalizar(texto) {
  return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function noBrasil(latitude, longitude) {
  return coordenadaValida(latitude, longitude) && latitude >= -34 && latitude <= 6 && longitude >= -74 && longitude <= -28;
}

function consultaValida(consulta) {
  const q = String(consulta?.q || '').trim().replace(/\s+/g, ' ');
  const lat = consulta?.lat == null || consulta?.lat === '' ? null : Number(consulta.lat);
  const lng = consulta?.lng == null || consulta?.lng === '' ? null : Number(consulta.lng);
  if (q) {
    if (q.length < 5 || q.length > 350 || /[\u0000-\u001f\u007f]/.test(q)) return null;
    if (/^[\d\s-]+$/.test(q) && !/^\d{5}-?\d{3}$/.test(q)) return null;
    if ((lat == null) !== (lng == null) || (lat != null && !coordenadaValida(lat, lng))) return null;
    return { q, ...(lat == null ? {} : { lat, lng }) };
  }
  return noBrasil(lat, lng) ? { lat, lng } : null;
}

async function enderecoDoCep(consulta) {
  const match = consulta.q?.match(/(?:^|\D)(\d{5})-?(\d{3})(?!\d)/);
  if (!match) return null;
  const cep = `${match[1]}${match[2]}`;
  const dados = await buscarJson(`https://viacep.com.br/ws/${cep}/json/`);
  if (!dados || dados.erro || !dados.localidade || !ESTADOS[dados.uf]) return null;
  const restante = consulta.q.replace(match[0], ' ').replace(/^[\s,;-]+|[\s,;-]+$/g, '');
  return {
    cep, cidade: dados.localidade, uf: dados.uf, rua: dados.logradouro || '',
    q: [...new Set([dados.logradouro, restante, dados.bairro, dados.localidade, dados.uf, cep].filter(Boolean))].join(', '),
  };
}

function resultadoBrasileiro(item, cep) {
  const props = item?.properties || {};
  const [longitude, latitude] = item?.geometry?.coordinates || [];
  const pais = normalizar(props.countrycode || props.country);
  if (!['br', 'brasil', 'brazil'].includes(pais) || !noBrasil(latitude, longitude)) return null;
  if (cep) {
    if (normalizar(props.city || props.county) !== normalizar(cep.cidade)) return null;
    if (props.state && ![normalizar(cep.uf), normalizar(ESTADOS[cep.uf])].includes(normalizar(props.state))) return null;
    const codigo = String(props.postcode || '').replace(/\D/g, '');
    if (codigo.length === 8 && codigo !== cep.cep) return null;
    // Um CEP de rua não pode virar o centro da cidade quando faltam dados no mapa.
    if (cep.rua && ['city', 'county', 'state', 'country'].includes(props.type || props.osm_value)) return null;
  }
  const rua = [props.street, props.housenumber].filter(Boolean).join(', ');
  const endereco = [...new Set([props.name, rua, props.district || props.locality, props.city || props.county, props.state, props.postcode].filter(Boolean))].join(', ');
  const ponto = pontoDe(latitude, longitude, endereco);
  if (!ponto?.endereco) return null;
  return {
    ...ponto, fonte: 'photon',
    precisao: props.housenumber ? 'numero' : props.street || props.type === 'street' || props.osm_key === 'highway' ? 'rua' : props.type || props.osm_value || 'local',
  };
}

async function photon(base, consulta) {
  let cep = null;
  if (consulta.q) {
    try { cep = await enderecoDoCep(consulta); } catch { /* O endereço completo ainda pode ser pesquisado. */ }
    // Um CEP isolado sem a cidade confirmada não deve selecionar um lugar homônimo.
    if (/^\d{5}-?\d{3}$/.test(consulta.q) && !cep) return [];
  }
  const url = new URL(`${base}/${consulta.q ? 'api/' : 'reverse'}`);
  url.searchParams.set('limit', '5');
  // O idioma local dos dados preserva endereços brasileiros. O serviço público
  // não oferece "pt" na lista de traduções e rejeita esse parâmetro.
  if (consulta.q) {
    url.searchParams.set('q', cep?.q || consulta.q);
    url.searchParams.set('countrycode', 'BR');
    url.searchParams.set('bbox', '-74,-34,-28,6');
  } else {
    url.searchParams.set('radius', '1');
  }
  if (consulta.lat != null && consulta.lng != null) {
    url.searchParams.set('lat', String(consulta.lat));
    url.searchParams.set('lon', String(consulta.lng));
  }
  const dados = await buscarJson(url.toString());
  const vistos = new Set();
  const opcoes = [];
  for (const item of Array.isArray(dados?.features) ? dados.features : []) {
    const ponto = resultadoBrasileiro(item, cep);
    if (!ponto) continue;
    // Reverse só fornece a descrição: o destino continua sendo o ponto exato do GPS.
    if (!consulta.q) {
      if (distanciaKm({ latitude: consulta.lat, longitude: consulta.lng }, ponto) > 1.5) continue;
      ponto.latitude = consulta.lat;
      ponto.longitude = consulta.lng;
      ponto.precisao = 'gps';
    }
    const chave = `${ponto.latitude},${ponto.longitude}:${normalizar(ponto.endereco)}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    opcoes.push(ponto);
    if (opcoes.length === 5) break;
  }
  return opcoes;
}

function copiarOpcoes(opcoes) {
  return opcoes.map((ponto) => ({ ...ponto }));
}

export async function localizarOpcoes(env, consulta) {
  const entrada = consultaValida(consulta);
  if (!entrada) return [];
  if (typeof env?.geocode === 'function') {
    try {
      const resposta = await env.geocode(entrada);
      const opcoes = Array.isArray(resposta) ? resposta : resposta ? [resposta] : [];
      return opcoes.filter((ponto) => noBrasil(ponto?.latitude, ponto?.longitude)).slice(0, 5).map((ponto) => ({
        ...ponto,
        ...(!entrada.q ? { latitude: entrada.lat, longitude: entrada.lng, precisao: 'gps' } : {}),
      }));
    } catch { return []; }
  }
  const base = String(env?.PHOTON_URL || 'https://photon.komoot.io').replace(/\/+$/, '');
  const chave = `geo:v3:${await sha256(`${base}:${JSON.stringify({ ...entrada, ...(entrada.q ? { q: normalizar(entrada.q) } : {}) })}`)}`;
  const guardadoMemoria = memoria.get(chave);
  if (guardadoMemoria?.expira > Date.now()) return copiarOpcoes(guardadoMemoria.opcoes);
  if (pendentes.has(chave)) return copiarOpcoes(await pendentes.get(chave));
  const tarefa = (async () => {
    try {
      const guardado = await kvGet(env, chave);
      if (guardado) {
        const opcoes = JSON.parse(guardado);
        if (Array.isArray(opcoes) && opcoes.length && opcoes.every((ponto) => noBrasil(ponto?.latitude, ponto?.longitude))) return opcoes.slice(0, 5);
      }
    } catch { /* Um erro de cache não impede localizar o endereço. */ }
    let opcoes = [];
    try { opcoes = await photon(base, entrada); } catch { /* Falha do provedor é tratada pelo formulário. */ }
    if (opcoes.length) {
      try { await kvPut(env, chave, JSON.stringify(opcoes), { expirationTtl: CACHE_TTL }); } catch { /* Cache opcional. */ }
    }
    return opcoes;
  })();
  pendentes.set(chave, tarefa);
  try {
    const opcoes = await tarefa;
    if (memoria.size >= 256) memoria.delete(memoria.keys().next().value);
    memoria.set(chave, { opcoes, expira: Date.now() + (opcoes.length ? 300000 : 15000) });
    return copiarOpcoes(opcoes);
  } finally {
    pendentes.delete(chave);
  }
}

export async function localizar(env, consulta) {
  return (await localizarOpcoes(env, consulta))[0] || null;
}

function centavos(valor) {
  return Math.round(Number(valor) * 100);
}

export function cobrancaEntrega({ distanciaKm, valorPorKm, modo, taxaFixa = 0 }) {
  const modoNormal = modo === 'dividido' || modo === 'gratis' ? modo : 'cliente';
  const porKm = valorPorKm == null || valorPorKm === '' ? null : Number(valorPorKm);
  const temKm = Number.isFinite(porKm);
  const distancia = distanciaKm == null || distanciaKm === '' ? null : Number(distanciaKm);
  const semDistancia = temKm && !Number.isFinite(distancia);
  if (semDistancia) {
    return {
      modo_entrega: modoNormal,
      valor_por_km: porKm,
      valor_entrega: null,
      taxa_cliente: null,
      taxa_estabelecimento: null,
      entrega_gratis: modoNormal === 'gratis' ? 1 : 0,
    };
  }
  const km = temKm ? kmExibido(distancia) : null;
  const baseCentavos = temKm
    ? Math.round(Math.round(km * 10) * centavos(porKm) / 10)
    : centavos(taxaFixa || 0);
  const clienteCentavos = modoNormal === 'gratis' ? 0 : modoNormal === 'dividido' ? Math.floor(baseCentavos / 2) : baseCentavos;
  return {
    modo_entrega: modoNormal,
    valor_por_km: temKm ? porKm : null,
    valor_entrega: baseCentavos / 100,
    taxa_cliente: clienteCentavos / 100,
    taxa_estabelecimento: (baseCentavos - clienteCentavos) / 100,
    entrega_gratis: modoNormal === 'gratis' ? 1 : 0,
  };
}

export function areaDaLoja(loja, ponto) {
  const raio = loja?.raio_entrega_km == null || loja?.raio_entrega_km === '' ? null : Number(loja.raio_entrega_km);
  const semPonto = !ponto || loja?.latitude == null || loja?.longitude == null;
  let distancia = null;
  if (!semPonto) {
    distancia = distanciaKm(
      { latitude: Number(loja.latitude), longitude: Number(loja.longitude) },
      ponto,
    );
  }
  const configurada = Number.isFinite(raio);
  const cobranca = cobrancaEntrega({
    distanciaKm: distancia,
    valorPorKm: loja?.valor_por_km,
    modo: loja?.modo_entrega,
    taxaFixa: loja?.taxa_entrega,
  });
  return {
    distancia_km: distancia == null ? null : kmExibido(distancia),
    entrega_na_regiao: distancia == null ? null : (configurada ? (Number(loja.aceita_entrega) === 1 && dentroDoRaio(distancia, raio) ? 1 : 0) : null),
    raio_entrega_km: configurada ? raio : null,
    modo_entrega: cobranca.modo_entrega,
    valor_por_km: cobranca.valor_por_km,
    valor_entrega: cobranca.valor_entrega,
    taxa_cliente: cobranca.taxa_cliente,
    taxa_estabelecimento: cobranca.taxa_estabelecimento,
    entrega_gratis: cobranca.entrega_gratis,
  };
}
