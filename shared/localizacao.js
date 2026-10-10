import { kvGet, kvPut, sha256 } from './util.js';

const AGENTE = 'DoixP-Delivery/1.0 (https://doixp.com)';
const TOLERANCIA_KM = 0.15;

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
    latitude: Math.round(latitude * 1e6) / 1e6,
    longitude: Math.round(longitude * 1e6) / 1e6,
    endereco: String(endereco || '').slice(0, 180),
  };
}

async function buscarJson(url) {
  const resposta = await fetch(url, {
    headers: { 'User-Agent': AGENTE, Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!resposta.ok) return null;
  return resposta.json();
}

async function nominatim(consulta) {
  if (consulta.q) {
    const texto = /brasil|brazil/i.test(consulta.q) ? consulta.q : `${consulta.q}, Brasil`;
    const dados = await buscarJson(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=br&q=${encodeURIComponent(texto)}`);
    const item = Array.isArray(dados) ? dados[0] : null;
    return item ? pontoDe(Number(item.lat), Number(item.lon), item.display_name) : null;
  }
  const dados = await buscarJson(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${consulta.lat}&lon=${consulta.lng}`);
  return dados?.lat ? pontoDe(Number(dados.lat), Number(dados.lon), dados.display_name) : null;
}

async function photon(consulta) {
  const url = consulta.q
    ? `https://photon.komoot.io/api/?limit=1&lang=pt&q=${encodeURIComponent(consulta.q)}`
    : `https://photon.komoot.io/reverse?lang=pt&lat=${consulta.lat}&lon=${consulta.lng}`;
  const dados = await buscarJson(url);
  const item = dados?.features?.[0];
  const [longitude, latitude] = item?.geometry?.coordinates || [];
  const props = item?.properties || {};
  const endereco = [props.name, props.street, props.housenumber, props.city || props.county, props.state].filter(Boolean).join(', ');
  return pontoDe(Number(latitude), Number(longitude), endereco);
}

export async function localizar(env, consulta) {
  if (typeof env?.geocode === 'function') return env.geocode(consulta);
  const q = String(consulta?.q || '').trim().replace(/\s+/g, ' ');
  const lat = consulta?.lat == null || consulta?.lat === '' ? null : Number(consulta.lat);
  const lng = consulta?.lng == null || consulta?.lng === '' ? null : Number(consulta.lng);
  if (q.length < 5 && !coordenadaValida(lat, lng)) return null;
  const chave = `geo:v1:${await sha256(q ? q.toLocaleLowerCase('pt-BR') : `${lat.toFixed(4)},${lng.toFixed(4)}`)}`;
  const guardado = await kvGet(env, chave);
  if (guardado) {
    try { return JSON.parse(guardado); } catch { /* consulta de novo */ }
  }
  let ponto = null;
  try { ponto = await nominatim(q ? { q } : { lat, lng }); } catch { ponto = null; }
  if (!ponto) {
    try { ponto = await photon(q ? { q } : { lat, lng }); } catch { ponto = null; }
  }
  if (ponto) await kvPut(env, chave, JSON.stringify(ponto), { expirationTtl: 7 * 24 * 60 * 60 });
  return ponto;
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
