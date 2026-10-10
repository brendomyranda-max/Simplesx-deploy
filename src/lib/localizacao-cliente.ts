/**
 * Ponto do cliente no navegador.
 * O GPS fica em observação e o endereço digitado pausa essa observação.
 * A sessão guarda o ponto para a página da loja reutilizar a mesma origem.
 * O texto da entrega usa a parte do cliente já calculada no servidor.
 */

import { fmtBRL } from '@/lib/format';
import type { ModoEntrega } from '@/lib/types';

export type PontoCliente = {
  latitude: number;
  longitude: number;
  endereco: string;
  origem: 'gps' | 'endereco';
};

const CHAVE = 'simplesx_ponto_cliente';
const PASSO_GRAUS = 0.0008;

function sessao() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function fmtKm(valor: number) {
  return `${valor.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
}

type ResumoEntrega = {
  aceita_entrega?: number;
  modo_entrega?: string | null;
  valor_por_km?: number | null;
  taxa_cliente?: number | null;
  taxa_entrega?: number | null;
  entrega_gratis?: number | null;
};

export function textoEntrega(loja: ResumoEntrega) {
  if (!loja.aceita_entrega) return 'Retirada no balcão';
  if (loja.entrega_gratis === 1 || loja.modo_entrega === 'gratis') return 'Entrega grátis';
  if (loja.valor_por_km != null) {
    if (loja.taxa_cliente == null) return `${fmtBRL(loja.valor_por_km)}/km`;
    return loja.taxa_cliente > 0 ? `Entrega ${fmtBRL(loja.taxa_cliente)}` : 'Entrega grátis';
  }
  const taxa = loja.taxa_cliente != null ? loja.taxa_cliente : (loja.taxa_entrega ?? 0);
  return taxa > 0 ? `Entrega ${fmtBRL(taxa)}` : 'sem taxa';
}

export function taxaDaSacola(loja: ResumoEntrega | null) {
  if (!loja?.aceita_entrega) return 0;
  if (loja.valor_por_km != null && loja.taxa_cliente == null) return null;
  if (loja.taxa_cliente != null) return loja.taxa_cliente;
  if (loja.modo_entrega === 'gratis') return 0;
  return Number(loja.taxa_entrega) || 0;
}

export function textoCobrancaCliente(area: {
  modo_entrega?: string | null;
  valor_por_km?: number | null;
  valor_entrega?: number | null;
  taxa_cliente?: number | null;
  distancia_km?: number | null;
  entrega_gratis?: number | null;
} | null) {
  if (!area || area.taxa_cliente == null) return null;
  if (area.entrega_gratis === 1 || area.modo_entrega === 'gratis') {
    return area.valor_entrega != null ? `Entrega grátis. A loja paga ${fmtBRL(area.valor_entrega)}.` : 'Entrega grátis.';
  }
  if (area.modo_entrega === 'dividido' && area.distancia_km != null && area.valor_por_km != null && area.valor_entrega != null) {
    return `Entrega ${fmtBRL(area.taxa_cliente)} para você. ${fmtKm(area.distancia_km)} × ${fmtBRL(area.valor_por_km)} = ${fmtBRL(area.valor_entrega)}, dividido com a loja.`;
  }
  if (area.valor_por_km != null && area.distancia_km != null && area.valor_entrega != null) {
    return `Entrega ${fmtBRL(area.taxa_cliente)}. ${fmtKm(area.distancia_km)} × ${fmtBRL(area.valor_por_km)} = ${fmtBRL(area.valor_entrega)}.`;
  }
  if (area.taxa_cliente === 0) return 'Entrega grátis.';
  return `Entrega ${fmtBRL(area.taxa_cliente)}.`;
}

export function previaEntrega(valorPorKm: number, modo: ModoEntrega) {
  const baseCentavos = Math.round(70 * Math.round(valorPorKm * 100) / 10);
  const clienteCentavos = modo === 'gratis' ? 0 : modo === 'dividido' ? Math.floor(baseCentavos / 2) : baseCentavos;
  const base = baseCentavos / 100;
  const cliente = clienteCentavos / 100;
  const total = 50 + cliente;
  if (modo === 'gratis') return `Nesta loja, 7 km ficam ${fmtBRL(base)}. A entrega é grátis e a loja paga esse valor. Um produto de R$ 50,00 continua R$ 50,00.`;
  if (modo === 'dividido') return `Nesta loja, 7 km ficam ${fmtBRL(base)}. O cliente paga ${fmtBRL(cliente)} e um produto de R$ 50,00 fica ${fmtBRL(total)}.`;
  return `Nesta loja, 7 km ficam ${fmtBRL(base)} e o cliente paga esse valor. Um produto de R$ 50,00 fica ${fmtBRL(total)}.`;
}

export function lerPontoCliente(): PontoCliente | null {
  const bruto = sessao()?.getItem(CHAVE);
  if (!bruto) return null;
  try {
    const ponto = JSON.parse(bruto) as PontoCliente;
    if (!Number.isFinite(ponto.latitude) || !Number.isFinite(ponto.longitude)) return null;
    return ponto;
  } catch {
    return null;
  }
}

export function gravarPontoCliente(ponto: PontoCliente) {
  sessao()?.setItem(CHAVE, JSON.stringify(ponto));
}

export function observarLocalizacao(avisos: {
  onPonto: (ponto: { latitude: number; longitude: number }) => void;
  onErro: (mensagem: string) => void;
}) {
  if (!navigator.geolocation) {
    avisos.onErro('Este aparelho não informa a localização. Digite o endereço para ver as distâncias.');
    return () => undefined;
  }
  let ultimo: { latitude: number; longitude: number } | null = null;
  const id = navigator.geolocation.watchPosition(
    (posicao) => {
      const latitude = posicao.coords.latitude;
      const longitude = posicao.coords.longitude;
      if (ultimo && Math.abs(latitude - ultimo.latitude) < PASSO_GRAUS && Math.abs(longitude - ultimo.longitude) < PASSO_GRAUS) return;
      ultimo = { latitude, longitude };
      avisos.onPonto({ latitude, longitude });
    },
    (erro) => {
      avisos.onErro(erro.code === 1
        ? 'Localização não autorizada. Digite o endereço para ver quem entrega até você.'
        : 'Não foi possível ler a localização agora. Digite o endereço.');
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 12000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}
