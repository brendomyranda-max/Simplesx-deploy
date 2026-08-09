import { create } from 'zustand';

export type Modulo = 'gestor' | 'pdv_mercado' | 'restaurante';

const MODULOS_TOTAIS: Modulo[] = ['gestor', 'pdv_mercado', 'restaurante'];

interface AuthState {
  token: string | null;
  nome: string | null;
  perfil: string;
  modulos: Modulo[];
  setAuth: (token: string, nome: string, perfil: string, modulos?: Modulo[] | string[]) => void;
  logout: () => void;
  can: (modulo: Modulo) => boolean;
}

export const useAuth = create<AuthState>((set, get) => ({
  token: null,
  nome: null,
  perfil: 'admin',
  modulos: [],
  setAuth: (token, nome, perfil, modulos) => {
    const lista = (Array.isArray(modulos) && modulos.length ? modulos : MODULOS_TOTAIS).filter(Boolean) as Modulo[];
    localStorage.setItem('simplesx_token', token);
    localStorage.setItem('simplesx_nome', nome);
    localStorage.setItem('simplesx_perfil', perfil || 'admin');
    localStorage.setItem('simplesx_modulos', JSON.stringify(lista));
    set({ token, nome, perfil: perfil || 'admin', modulos: lista });
  },
  logout: () => {
    localStorage.removeItem('simplesx_token');
    localStorage.removeItem('simplesx_nome');
    localStorage.removeItem('simplesx_perfil');
    localStorage.removeItem('simplesx_modulos');
    set({ token: null, nome: null, perfil: 'admin', modulos: [] });
  },
  can: (modulo) => {
    const { modulos } = get();
    if (!modulos || !modulos.length) return false;
    if (modulos.includes('gestor')) return true;
    return modulos.includes(modulo);
  },
}));
