/**
 * Arquivo: pda-instalacao.ts
 * Responsabilidade: Guarda o pedido de instalação do PDA e abre o sistema em tela cheia.
 */

import { useSyncExternalStore } from 'react';
import {
  detectarPlataforma,
  navegadorCompativel,
  passosInstalacao,
  type PlataformaPda,
} from '@/lib/pda-plataforma.js';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

declare global {
  interface Window {
    doixpPwa?: {
      app: 'portal' | 'gestor' | 'marketplace';
      promptEvent: BeforeInstallPromptEvent | null;
      installed: boolean;
    };
  }
}

export interface EstadoPda {
  app: 'portal' | 'gestor' | 'marketplace';
  plataforma: PlataformaPda;
  instalado: boolean;
  podeInstalar: boolean;
  aguardandoLiberacao: boolean;
  emTelaCheia: boolean;
  swAtivo: boolean;
  compativel: boolean;
  passos: string[];
}

const estadoVazio: EstadoPda = {
  app: 'portal',
  plataforma: 'outro',
  instalado: false,
  podeInstalar: false,
  aguardandoLiberacao: false,
  emTelaCheia: false,
  swAtivo: false,
  compativel: false,
  passos: [],
};

let pedidoEmAndamento: Promise<'aceito' | 'recusado' | 'indisponivel'> | null = null;
let aguardandoLiberacao = false;
let instalado = false;
let emTelaCheia = false;
let swAtivo = false;
let telaCheiaPedida = false;
const ouvintes = new Set<() => void>();
let snapshot: EstadoPda = estadoVazio;

function estaInstalado() {
  if (typeof window === 'undefined') return false;
  const modos = ['fullscreen', 'standalone', 'minimal-ui', 'window-controls-overlay'];
  if (modos.some((modo) => window.matchMedia(`(display-mode: ${modo})`).matches)) return true;
  return Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

function lerTelaCheia() {
  if (typeof document === 'undefined') return false;
  return Boolean(document.fullscreenElement) || window.matchMedia('(display-mode: fullscreen)').matches;
}

function montar(): EstadoPda {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const plataforma = detectarPlataforma(ua);
  return {
    app: typeof window === 'undefined' ? 'portal' : window.doixpPwa?.app || 'portal',
    plataforma,
    instalado,
    podeInstalar: Boolean(window.doixpPwa?.promptEvent) && !instalado && !pedidoEmAndamento,
    aguardandoLiberacao,
    emTelaCheia,
    swAtivo,
    compativel: Boolean(window.doixpPwa?.promptEvent) || navegadorCompativel(ua),
    passos: passosInstalacao(plataforma, ua),
  };
}

function publicar() {
  snapshot = montar();
  ouvintes.forEach((ouvir) => ouvir());
}

function prepararTelaCheia() {
  if (telaCheiaPedida || typeof window === 'undefined' || !estaInstalado()) return;
  if (window.matchMedia('(display-mode: fullscreen)').matches) return;
  telaCheiaPedida = true;
  const pedir = () => {
    void entrarTelaCheia().then((abriu) => {
      if (abriu) window.removeEventListener('pointerdown', pedir);
    });
  };
  window.addEventListener('pointerdown', pedir);
}

export function entrarTelaCheia(): Promise<boolean> {
  if (typeof document === 'undefined') return Promise.resolve(false);
  if (document.fullscreenElement) {
    emTelaCheia = true;
    publicar();
    return Promise.resolve(true);
  }
  const elemento = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
  };
  const pedido = elemento.requestFullscreen
    ? elemento.requestFullscreen()
    : elemento.webkitRequestFullscreen?.();
  if (!pedido) return Promise.resolve(false);
  return Promise.resolve(pedido)
    .then(() => {
      emTelaCheia = true;
      publicar();
      return true;
    })
    .catch(() => false);
}

type ResultadoInstalacao = 'aceito' | 'recusado' | 'indisponivel';

function abrirPedidoNativo(atual: BeforeInstallPromptEvent): Promise<ResultadoInstalacao> {
  // O evento só pode ser utilizado uma vez. Consuma antes de notificar os componentes.
  if (window.doixpPwa) window.doixpPwa.promptEvent = null;
  let pedido: Promise<void>;
  try {
    // Mantenha esta chamada síncrona dentro do clique, preservando a ativação do usuário.
    pedido = atual.prompt();
  } catch {
    return Promise.resolve('indisponivel');
  }
  return Promise.resolve(pedido)
    .then(() => atual.userChoice)
    .then((escolha) => {
      if (escolha.outcome === 'accepted') {
        return 'aceito' as const;
      }
      return 'recusado' as const;
    })
    .catch(() => 'indisponivel' as const);
}

export function instalarPda(): Promise<ResultadoInstalacao> {
  if (pedidoEmAndamento) return pedidoEmAndamento;
  const estado = window.doixpPwa;
  if (!estado || instalado) return Promise.resolve('indisponivel');
  let pedido: Promise<ResultadoInstalacao>;
  if (estado.promptEvent) {
    pedido = abrirPedidoNativo(estado.promptEvent);
  } else if (navigator.userActivation?.isActive) {
    // O primeiro toque pode ser o que libera beforeinstallprompt. Aproveite-o somente
    // enquanto a ativação transitória ainda existir, sem tentar contornar o navegador.
    aguardandoLiberacao = true;
    pedido = new Promise((resolve) => {
      const concluir = (resultado: ResultadoInstalacao | Promise<ResultadoInstalacao>) => {
        window.clearTimeout(limite);
        window.removeEventListener('doixp:pwa-change', tentar);
        aguardandoLiberacao = false;
        resolve(resultado);
        publicar();
      };
      const tentar = () => {
        if (estado.installed) concluir('aceito');
        else if (estado.promptEvent) {
          concluir(navigator.userActivation?.isActive
            ? abrirPedidoNativo(estado.promptEvent)
            : 'indisponivel');
        }
      };
      const limite = window.setTimeout(() => concluir('indisponivel'), 4000);
      window.addEventListener('doixp:pwa-change', tentar);
    });
  } else {
    return Promise.resolve('indisponivel');
  }
  pedidoEmAndamento = pedido
    .finally(() => {
      pedidoEmAndamento = null;
      publicar();
    });
  publicar();
  return pedidoEmAndamento;
}

export function usePdaInstalacao() {
  return useSyncExternalStore(
    (ouvir) => {
      ouvintes.add(ouvir);
      return () => ouvintes.delete(ouvir);
    },
    () => snapshot,
    () => estadoVazio,
  );
}

function iniciar() {
  if (typeof window === 'undefined') return;
  instalado = Boolean(window.doixpPwa?.installed) || estaInstalado();
  emTelaCheia = lerTelaCheia();
  window.addEventListener('doixp:pwa-change', () => {
    instalado = Boolean(window.doixpPwa?.installed) || estaInstalado();
    publicar();
    if (instalado) prepararTelaCheia();
  });
  document.addEventListener('fullscreenchange', () => {
    emTelaCheia = lerTelaCheia();
    publicar();
  });
  const consulta = window.matchMedia('(display-mode: fullscreen), (display-mode: standalone), (display-mode: minimal-ui), (display-mode: window-controls-overlay)');
  consulta.addEventListener?.('change', () => {
    instalado = Boolean(window.doixpPwa?.installed) || estaInstalado();
    emTelaCheia = lerTelaCheia();
    publicar();
    if (instalado) prepararTelaCheia();
  });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then(() => {
      swAtivo = true;
      publicar();
    }).catch(() => undefined);
  }
  prepararTelaCheia();
  publicar();
}

iniciar();
