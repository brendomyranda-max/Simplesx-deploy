/**
 * Arquivo: InicioPage.tsx
 * Responsabilidade: Implementa a tela InicioPage.tsx e coordena seus dados e ações.
 */

import { Investimento } from '@/components/Investimento';
import { useMemo } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  LayoutDashboard,
  ScanBarcode,
  UtensilsCrossed,
  Wallet,
  Boxes,
  Settings,
  LogOut,
  ArrowRight,
  Building2,
  Lock,
} from 'lucide-react';
import { useAuth, type Modulo } from '@/store/auth';
import { Button, useToast } from '@/components/ui';
import { selecionarArea, type AreaApp } from '@/lib/areas';

interface AreaCard {
  key: AreaApp;
  titulo: string;
  descricao: string;
  icon: React.ReactNode;
  to: string;
  corIcone: string;
}

// Estas são as cinco portas de entrada do Gestor. Todas usam as mesmas telas e
// permissões; a diferença é quais grupos o menu mostrará depois da escolha.
const AREAS: AreaCard[] = [
  {
    key: 'geral',
    titulo: 'Geral',
    descricao: 'Visão completa com painel, vendas, estoque, gestão, análises e configurações.',
    icon: <LayoutDashboard className="h-7 w-7" />,
    to: '/dashboard',
    corIcone: 'text-brand-600 bg-brand-50',
  },
  {
    key: 'vendas',
    titulo: 'Vendas',
    descricao: 'PDV, histórico de vendas, NFC-e e atendimento do restaurante.',
    icon: <ScanBarcode className="h-7 w-7" />,
    to: '/pdv',
    corIcone: 'text-emerald-600 bg-emerald-50',
  },
  {
    key: 'gestao',
    titulo: 'Gestão',
    descricao: 'Financeiro, fechamento de caixa e controle de perdas.',
    icon: <Wallet className="h-7 w-7" />,
    to: '/financeiro',
    corIcone: 'text-violet-600 bg-violet-50',
  },
  {
    key: 'estoque',
    titulo: 'Estoque',
    descricao: 'Estoque, validades, categorias e entrada de mercadorias.',
    icon: <Boxes className="h-7 w-7" />,
    to: '/estoque',
    corIcone: 'text-amber-600 bg-amber-50',
  },
  {
    key: 'configuracoes',
    titulo: 'Configurações',
    descricao: 'Funcionários, impressoras e preferências da empresa.',
    icon: <Settings className="h-7 w-7" />,
    to: '/funcionarios',
    corIcone: 'text-sky-600 bg-sky-50',
  },
];

interface ModuloCard {
  key: Modulo;
  titulo: string;
  descricao: string;
  icon: React.ReactNode;
  to: string;
  gradiente: string;
  corIcone: string;
  bloqueadoMsg: string;
}

const MODULOS: ModuloCard[] = [
  {
    key: 'gestor',
    titulo: 'Gestor',
    descricao: 'Aplicação completa: vendas, estoque, financeiro, relatórios e configurações.',
    icon: <LayoutDashboard className="h-7 w-7" />,
    to: '/dashboard',
    gradiente: 'from-brand-500 to-indigo-600',
    corIcone: 'text-brand-600 bg-brand-50',
    bloqueadoMsg: 'Sem permissão para o Gestor',
  },
  {
    key: 'pdv_mercado',
    titulo: 'PDV Mercado',
    descricao: 'Vendas rápidas no balcão, leitura de código de barras e recebimento.',
    icon: <ScanBarcode className="h-7 w-7" />,
    to: '/pdv',
    gradiente: 'from-emerald-500 to-teal-600',
    corIcone: 'text-emerald-600 bg-emerald-50',
    bloqueadoMsg: 'Bloqueado — acesse pelo Gestor',
  },
  {
    key: 'restaurante',
    titulo: 'Restaurante',
    descricao: 'Mesas, comandas, divisão de contas e atendimento por pessoa.',
    icon: <UtensilsCrossed className="h-7 w-7" />,
    to: '/restaurante',
    gradiente: 'from-orange-500 to-amber-600',
    corIcone: 'text-orange-600 bg-orange-50',
    bloqueadoMsg: 'Bloqueado — acesse pelo Gestor',
  },
];

export function InicioPage() {
  const { nome, logout, saindo, can, areas } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const disponiveis = useMemo(() => MODULOS.filter((m) => can(m.key)), [can]);
  const possuiGestor = can('gestor');
  const areasDisponiveis = AREAS.filter((area) => areas.includes('geral') || areas.includes(area.key));

  // Tudo começa bloqueado: quem tem Gestor entra em PDV/Restaurante pelo Gestor.
  const estaBloqueado = (key: Modulo): boolean => {
    if (!can(key)) return true;
    if (key !== 'gestor' && can('gestor')) return true;
    return false;
  };

  // Com apenas um módulo liberado, entra direto nele (ex.: só restaurante)
  const unico = disponiveis.length === 1 ? disponiveis[0] : null;
  const unicaArea = possuiGestor && areasDisponiveis.length === 1 ? areasDisponiveis[0] : null;

  const entrar = (mod: ModuloCard) => {
    if (estaBloqueado(mod.key)) {
      toast('info', mod.bloqueadoMsg);
      return;
    }
    navigate(mod.to);
  };

  const entrarNaArea = (area: AreaCard) => {
    selecionarArea(area.key);
    navigate(area.to);
  };

  const sair = async () => {
    try {
      await logout();
      navigate('/login', { replace: true });
    } catch {
      toast('error', 'Não foi possível sair da conta. Verifique a conexão e tente novamente.');
    }
  };

  if (unico) return <Navigate to={unico.to} replace />;
  if (unicaArea) {
    selecionarArea(unicaArea.key);
    return <Navigate to={unicaArea.to} replace />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-brand-950 to-slate-900 p-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 26 }}
        className="w-full max-w-4xl"
      >
        <div className="mb-8 flex flex-col items-center text-center">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.1, type: 'spring', stiffness: 300, damping: 18 }}
            className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-500 text-3xl font-extrabold text-white shadow-2xl shadow-brand-500/40"
          >
            S
          </motion.div>
          <h1 className="text-2xl font-extrabold text-white">SimplexS.A</h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-400">
            <Building2 className="h-4 w-4" />
            {nome || 'Bem-vindo(a)!'}
          </p>
        </div>

        {possuiGestor ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {areasDisponiveis.map((area, i) => (
              <motion.button
                key={area.key}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.12 + i * 0.07, type: 'spring', stiffness: 260, damping: 22 }}
                whileHover={{ y: -4 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => entrarNaArea(area)}
                className="card group flex min-h-48 flex-col items-center gap-3 p-5 text-center transition-colors hover:border-white/20"
              >
                <span className={`flex h-14 w-14 items-center justify-center rounded-2xl shadow-lg ${area.corIcone}`}>{area.icon}</span>
                <h2 className="mt-1 block w-full border-b border-brand-400/20 pb-3 text-2xl font-black tracking-tight text-brand-400 drop-shadow-sm">
                  {area.titulo}
                </h2>
                <span className="block text-sm leading-relaxed text-slate-400">{area.descricao}</span>
                <span className="mt-auto flex items-center gap-1 text-xs font-bold text-slate-500 transition-colors group-hover:text-white">
                  Entrar <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
              </motion.button>
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
          {MODULOS.map((mod, i) => {
            const bloqueado = estaBloqueado(mod.key);
            return (
              <motion.button
                key={mod.key}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.12 + i * 0.08, type: 'spring', stiffness: 260, damping: 22 }}
                whileHover={bloqueado ? undefined : { y: -4 }}
                whileTap={bloqueado ? undefined : { scale: 0.97 }}
                onClick={() => entrar(mod)}
                className={`card group relative flex flex-col items-start gap-3 p-5 text-left transition-colors ${
                  bloqueado ? 'opacity-50 hover:border-white/10' : 'hover:border-white/20'
                }`}
              >
                {bloqueado && (
                  <span className="absolute right-4 top-4 flex items-center gap-1 rounded-full bg-slate-800/80 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    <Lock className="h-3 w-3" /> Bloqueado
                  </span>
                )}
                <span className={`flex h-12 w-12 items-center justify-center rounded-xl ${mod.corIcone}`}>{mod.icon}</span>
                <span className="w-full">
                  <span className="flex items-center justify-between">
                    <span className="text-base font-extrabold text-white">{mod.titulo}</span>
                    {!bloqueado && (
                      <ArrowRight className="h-4 w-4 text-slate-500 transition-transform group-hover:translate-x-0.5 group-hover:text-white" />
                    )}
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-slate-400">{mod.descricao}</span>
                  {bloqueado && mod.key !== 'gestor' && (
                    <span className="mt-2 block text-[11px] font-semibold text-slate-500">Acessível apenas pelo Gestor</span>
                  )}
                </span>
              </motion.button>
            );
          })}
          </div>
        )}

        {disponiveis.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="card mt-4 p-6 text-center text-sm text-slate-400"
          >
            Nenhum módulo liberado para este usuário. Fale com o administrador.
          </motion.div>
        )}

        <Investimento />
        <div className="mt-8 text-center">
          <Button variant="secondary" icon={<LogOut className="h-4 w-4" />} onClick={sair} loading={saindo}>
            Sair
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
