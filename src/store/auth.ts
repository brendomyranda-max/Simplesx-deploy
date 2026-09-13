/**
 * Arquivo: auth.ts
 * Responsabilidade: Mantém a sessão e as permissões no estado global do frontend.
 */

import { create } from 'zustand';
import { authApi } from '@/lib/api';
import type { AreaApp } from '@/lib/areas';

export type Modulo = 'gestor' | 'pdv_mercado' | 'restaurante';

const MODULOS_TOTAIS: Modulo[] = ['gestor', 'pdv_mercado', 'restaurante'];

interface AuthState {
  token: string | null;
  nome: string | null;
  perfil: string;
  modulos: Modulo[];
  areas: AreaApp[];
  setAuth: (nome: string, perfil: string, modulos?: Modulo[] | string[]) => void;
  saindo: boolean;
  clearSession: () => void;
  logout: () => Promise<void>;
  can: (modulo: Modulo) => boolean;
  canArea: (area: AreaApp) => boolean;
}

const TODAS_AREAS: AreaApp[] = ['geral', 'vendas', 'gestao', 'estoque', 'configuracoes'];

function extrairAreas(modulos: string[]): AreaApp[] {
  const marcadas = modulos
    .filter((m) => m.startsWith('area:'))
    .map((m) => m.slice(5) as AreaApp)
    .filter((a) => TODAS_AREAS.includes(a));
  // Funcionários antigos com Gestor continuam tendo acesso completo.
  return modulos.includes('gestor') && marcadas.length === 0 ? TODAS_AREAS : marcadas;
}

export const useAuth = create<AuthState>((set, get) => ({
  saindo: false,
  token: null,
  nome: null,
  perfil: 'admin',
  modulos: [],
  areas: [],
  setAuth: (nome, perfil, modulos) => {
    const lista = (Array.isArray(modulos) && modulos.length ? modulos : MODULOS_TOTAIS).filter(Boolean) as Modulo[];
    localStorage.setItem('simplesx_nome', nome);
    localStorage.setItem('simplesx_perfil', perfil || 'admin');
    localStorage.setItem('simplesx_modulos', JSON.stringify(lista));
    set({ token: 'cookie', nome, perfil: perfil || 'admin', modulos: lista, areas: extrairAreas(lista) });
  },
  clearSession: () => {
    localStorage.removeItem('simplesx_nome');
    localStorage.removeItem('simplesx_perfil');
    localStorage.removeItem('simplesx_modulos');
    localStorage.removeItem('simplesx_empresa');
    localStorage.removeItem('simplesx_area');
    set({ token: null, nome: null, perfil: 'admin', modulos: [], areas: [] });
  },
  logout: async () => {
    if (get().saindo) return;
    set({ saindo: true });
    try {
      await authApi.logout();
      get().clearSession();
    } finally {
      set({ saindo: false });
    }
  },
  can: (modulo) => {
    const { modulos } = get();
    if (!modulos || !modulos.length) return false;
    if (modulos.includes('gestor')) return true;
    return modulos.includes(modulo);
  },
  canArea: (area) => {
    const { areas } = get();
    return areas.includes('geral') || areas.includes(area);
  },
}));
