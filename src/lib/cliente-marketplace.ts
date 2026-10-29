import { useEffect } from 'react';
import { create } from 'zustand';
import { clienteApi, type ClienteMarketplace } from './api';
import { limparUltimoPedido } from './delivery-cliente';
import { gravarPontoCliente, lerPontoCliente, limparPontoCliente, type PontoCliente } from './localizacao-cliente';

export function pontoDoPerfil(cliente: ClienteMarketplace | null): PontoCliente | null {
  return cliente?.endereco && cliente.latitude != null && cliente.longitude != null
    ? { latitude: cliente.latitude, longitude: cliente.longitude, endereco: cliente.endereco, origem: 'endereco' } : null;
}

type Estado = {
  cliente: ClienteMarketplace | null;
  carregando: boolean;
  erro: string;
  definir: (cliente: ClienteMarketplace | null) => void;
  carregar: () => Promise<void>;
  sair: () => Promise<void>;
};
let consulta: Promise<void> | null = null;
let carregado = false;
let geracao = 0;
export const useClienteStore = create<Estado>((set) => ({
  cliente: null,
  carregando: true,
  erro: '',
  definir: (cliente) => {
    geracao++;
    carregado = true;
    const ponto = pontoDoPerfil(cliente);
    if (ponto) gravarPontoCliente(ponto);
    else limparPontoCliente();
    set({ cliente, carregando: false, erro: '' });
  },
  carregar: () => {
    if (consulta) return consulta;
    if (carregado) return Promise.resolve();
    set({ carregando: true, erro: '' });
    const atual = geracao;
    consulta = clienteApi.me().then((cliente) => {
      if (atual !== geracao) return;
      if (!lerPontoCliente()) {
        const ponto = pontoDoPerfil(cliente);
        if (ponto) gravarPontoCliente(ponto);
      }
      carregado = true;
      set({ cliente });
    }).catch((error) => {
      if (atual !== geracao) return;
      if (error?.status === 401) { carregado = true; set({ cliente: null }); }
      else set({ erro: error?.error || 'Não foi possível carregar sua conta.' });
    }).finally(() => { consulta = null; set({ carregando: false }); });
    return consulta;
  },
  sair: async () => {
    await clienteApi.logout();
    geracao++;
    limparPontoCliente();
    limparUltimoPedido();
    set({ cliente: null, erro: '', carregando: false });
    carregado = true;
  },
}));

if (typeof window !== 'undefined') window.addEventListener('doixp:cliente-expirado', () => {
  geracao++; carregado = true;
  useClienteStore.setState({ cliente: null, carregando: false, erro: '' });
});

export function useClienteMarketplace() {
  const estado = useClienteStore();
  useEffect(() => { void estado.carregar(); }, [estado.carregar]);
  return estado;
}
