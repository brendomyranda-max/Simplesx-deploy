/**
 * Ponto do cliente no navegador.
 * O GPS fica em observação e o endereço digitado pausa essa observação.
 * A sessão guarda o ponto para a página da loja reutilizar a mesma origem.
 * O texto da entrega usa a parte do cliente já calculada no servidor.
 */

import { fmtBRL } from '@/lib/format';
import type { ModoEntrega } from '@/lib/types';

export type PontoLocalizacao = {
  latitude: number;
  longitude: number;
  precisao_metros?: number;
  /** Instante informado pelo aparelho, em milissegundos desde Unix epoch. */
  atualizado_em?: number;
};

export type PontoCliente = PontoLocalizacao & {
  endereco: string;
  origem: 'gps' | 'endereco' | 'mapa';
};

const CHAVE = 'simplesx_ponto_cliente';
const PASSO_METROS = 40;
const PRAZO_GPS_MS = 18000;
const PRECISAO_DESEJADA_METROS = 50;
const VALIDADE_GPS_MS = 30 * 60 * 1000;

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
  try {
    const bruto = sessao()?.getItem(CHAVE);
    const ponto = bruto ? normalizarPontoCliente(JSON.parse(bruto)) : null;
    if (ponto?.origem === 'gps' && (!ponto.atualizado_em
      || Date.now() - ponto.atualizado_em > VALIDADE_GPS_MS
      || ponto.atualizado_em > Date.now() + 60000)) return null;
    return ponto;
  } catch {
    return null;
  }
}

export function gravarPontoCliente(ponto: PontoCliente) {
  const validado = normalizarPontoCliente(ponto);
  if (!validado) return;
  try {
    sessao()?.setItem(CHAVE, JSON.stringify(validado));
  } catch {
    // Bloqueio de armazenamento ou quota não deve impedir a escolha do endereço.
  }
}

export function limparPontoCliente() {
  try {
    sessao()?.removeItem(CHAVE);
  } catch {
    // Navegação privada pode bloquear também a remoção da sessão.
  }
}

export function coordenadaClienteValida(latitude: unknown, longitude: unknown): boolean {
  return typeof latitude === 'number' && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && typeof longitude === 'number' && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}

function normalizarPontoCliente(valor: unknown): PontoCliente | null {
  if (!valor || typeof valor !== 'object') return null;
  const ponto = valor as Partial<PontoCliente>;
  if (!coordenadaClienteValida(ponto.latitude, ponto.longitude)
    || typeof ponto.endereco !== 'string'
    || !['gps', 'endereco', 'mapa'].includes(ponto.origem ?? '')) return null;
  if (ponto.precisao_metros !== undefined && !numeroPositivo(ponto.precisao_metros)) return null;
  if (ponto.atualizado_em !== undefined && !numeroPositivo(ponto.atualizado_em)) return null;
  return {
    latitude: ponto.latitude!, longitude: ponto.longitude!, endereco: ponto.endereco.trim(), origem: ponto.origem!,
    ...(ponto.precisao_metros !== undefined ? { precisao_metros: ponto.precisao_metros } : {}),
    ...(ponto.atualizado_em !== undefined ? { atualizado_em: ponto.atualizado_em } : {}),
  };
}

function numeroPositivo(valor: unknown): valor is number {
  return typeof valor === 'number' && Number.isFinite(valor) && valor > 0;
}

function pontoDoGPS(posicao: GeolocationPosition): PontoLocalizacao | null {
  const { latitude, longitude, accuracy } = posicao.coords;
  if (!coordenadaClienteValida(latitude, longitude)) return null;
  return {
    latitude, longitude,
    ...(numeroPositivo(accuracy) ? { precisao_metros: accuracy } : {}),
    atualizado_em: numeroPositivo(posicao.timestamp) ? posicao.timestamp : Date.now(),
  };
}

function distanciaMetros(a: PontoLocalizacao, b: PontoLocalizacao): number {
  const rad = Math.PI / 180;
  const h = Math.sin((b.latitude - a.latitude) * rad / 2) ** 2
    + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin((b.longitude - a.longitude) * rad / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(Math.min(1, h)));
}

function mensagemErroGPS(codigo?: number): string {
  if (codigo === 1) return 'Localização não autorizada. Permita o acesso à localização nas configurações do navegador ou digite o endereço.';
  if (codigo === 3) return 'A localização demorou para responder. Tente novamente em um local aberto ou digite o endereço.';
  return 'Não foi possível ler a localização agora. Confira se a localização do aparelho está ligada ou digite o endereço.';
}

/** Busca um ponto recente e encerra o GPS assim que obtém boa precisão ou esgota o prazo. */
export function obterLocalizacaoAtual(): Promise<PontoLocalizacao> {
  const gps = typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
  if (!gps) return Promise.reject(new Error('Este aparelho não informa a localização. Digite o endereço.'));
  return new Promise((resolve, reject) => {
    let encerrado = false;
    let id: number | null = null;
    let melhor: PontoLocalizacao | null = null;
    const pagina = typeof document !== 'undefined' ? document : null;
    const finalizar = (erro?: string) => {
      if (encerrado) return;
      encerrado = true;
      clearTimeout(prazo);
      if (id !== null) gps.clearWatch(id);
      pagina?.removeEventListener('visibilitychange', visibilidade);
      if (erro || !melhor) reject(new Error(erro || mensagemErroGPS(3)));
      else resolve(melhor);
    };
    const visibilidade = () => {
      if (pagina?.hidden) finalizar('A busca de localização foi pausada. Volte à página e tente novamente.');
    };
    const prazo = setTimeout(() => finalizar(), PRAZO_GPS_MS);
    if (pagina?.hidden) {
      finalizar('Volte à página para usar a localização do aparelho.');
      return;
    }
    pagina?.addEventListener('visibilitychange', visibilidade);
    try {
      const observado = gps.watchPosition((posicao) => {
        if (encerrado) return;
        const ponto = pontoDoGPS(posicao);
        if (!ponto) return;
        if (!melhor || (ponto.precisao_metros ?? Infinity) <= (melhor.precisao_metros ?? Infinity)) melhor = ponto;
        if (melhor.precisao_metros !== undefined && melhor.precisao_metros <= PRECISAO_DESEJADA_METROS) finalizar();
      }, (erro) => {
        if (encerrado) return;
        // Uma primeira posição aproximada continua útil se o aparelho não conseguir refiná-la.
        finalizar(erro.code === 1 || !melhor ? mensagemErroGPS(erro.code) : undefined);
      }, { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 });
      if (encerrado) gps.clearWatch(observado);
      else id = observado;
    } catch {
      finalizar(mensagemErroGPS());
    }
  });
}

export function observarLocalizacao(avisos: {
  onPonto: (ponto: PontoLocalizacao) => void;
  onErro: (mensagem: string) => void;
}) {
  const gps = typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
  if (!gps) {
    avisos.onErro('Este aparelho não informa a localização. Digite o endereço para ver as distâncias.');
    return () => undefined;
  }
  const pagina = typeof document !== 'undefined' ? document : null;
  let ativo = true;
  let geracao = 0;
  let id: number | null = null;
  let ultimo: PontoLocalizacao | null = null;
  const pausar = () => {
    geracao++;
    if (id !== null) gps.clearWatch(id);
    id = null;
  };
  const limpar = () => {
    ativo = false;
    pausar();
    pagina?.removeEventListener('visibilitychange', visibilidade);
  };
  const iniciar = () => {
    if (!ativo || pagina?.hidden || id !== null) return;
    const atual = ++geracao;
    try {
      const observado = gps.watchPosition((posicao) => {
        if (!ativo || atual !== geracao || pagina?.hidden) return;
        const ponto = pontoDoGPS(posicao);
        if (!ponto) return;
        if (ultimo) {
          const distancia = distanciaMetros(ultimo, ponto);
          const anterior = ultimo.precisao_metros ?? Infinity;
          const precisao = ponto.precisao_metros ?? Infinity;
          const melhorou = Number.isFinite(precisao) && (anterior === Infinity || anterior - precisao >= Math.max(5, anterior * 0.2));
          if (!melhorou && (distancia < PASSO_METROS || (precisao > anterior && distancia <= precisao))) return;
        }
        ultimo = ponto;
        avisos.onPonto(ponto);
      }, (erro) => {
        if (!ativo || atual !== geracao || pagina?.hidden) return;
        if (erro.code === 1) limpar();
        avisos.onErro(mensagemErroGPS(erro.code));
      }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 12000 });
      if (!ativo || atual !== geracao || pagina?.hidden) gps.clearWatch(observado);
      else id = observado;
    } catch {
      limpar();
      avisos.onErro(mensagemErroGPS());
    }
  };
  const visibilidade = () => {
    if (pagina?.hidden) pausar();
    else iniciar();
  };
  pagina?.addEventListener('visibilitychange', visibilidade);
  iniciar();
  return limpar;
}
