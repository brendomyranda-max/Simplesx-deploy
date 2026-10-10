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

export interface EstadoPda {
  plataforma: PlataformaPda;
  instalado: boolean;
  podeInstalar: boolean;
  emTelaCheia: boolean;
  swAtivo: boolean;
  compativel: boolean;
  passos: string[];
}

const estadoVazio: EstadoPda = {
  plataforma: 'outro',
  instalado: false,
  podeInstalar: false,
  emTelaCheia: false,
  swAtivo: false,
  compativel: false,
  passos: [],
};

let promptInstalacao: BeforeInstallPromptEvent | null = null;
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
    plataforma,
    instalado,
    podeInstalar: Boolean(promptInstalacao) && !instalado,
    emTelaCheia,
    swAtivo,
    compativel: Boolean(promptInstalacao) || navegadorCompativel(ua),
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

export function instalarPda(): Promise<'aceito' | 'recusado' | 'indisponivel'> {
  const atual = promptInstalacao;
  if (!atual) return Promise.resolve('indisponivel');
  let pedido: Promise<void>;
  try {
    pedido = atual.prompt();
  } catch {
    return Promise.resolve('indisponivel');
  }
  promptInstalacao = null;
  publicar();
  return pedido
    .then(() => atual.userChoice)
    .then((escolha) => {
      if (escolha.outcome === 'accepted') {
        instalado = true;
        publicar();
        prepararTelaCheia();
        return 'aceito' as const;
      }
      return 'recusado' as const;
    })
    .catch(() => 'indisponivel' as const);
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
  instalado = estaInstalado();
  emTelaCheia = lerTelaCheia();
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    promptInstalacao = event as BeforeInstallPromptEvent;
    publicar();
  });
  window.addEventListener('appinstalled', () => {
    promptInstalacao = null;
    instalado = true;
    publicar();
    prepararTelaCheia();
  });
  document.addEventListener('fullscreenchange', () => {
    emTelaCheia = lerTelaCheia();
    publicar();
  });
  const consulta = window.matchMedia('(display-mode: fullscreen), (display-mode: standalone), (display-mode: minimal-ui), (display-mode: window-controls-overlay)');
  consulta.addEventListener?.('change', () => {
    instalado = estaInstalado();
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
