import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  LayoutDashboard,
  ScanBarcode,
  ReceiptText,
  UtensilsCrossed,
  Boxes,
  PackagePlus,
  CalendarClock,
  Wallet,
  BarChart3,
  Trash2,
  Users,
  Printer,
  Settings,
  LogOut,
  Menu,
  X,
  Tags,
  Home,
  ClipboardCheck,
  FileCheck2,
} from 'lucide-react';
import { useAuth } from '@/store/auth';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  badge?: number | null;
}

interface NavGroup {
  title?: string;
  items: NavItem[];
}

export function AppShell({
  children,
  badges,
  empresaNome,
}: {
  children: React.ReactNode;
  badges?: Record<string, number>;
  empresaNome?: string;
}) {
  const [open, setOpen] = useState(false);
  const { nome, perfil, logout, can } = useAuth();
  const navigate = useNavigate();

  const isGestor = can('gestor');
  const isPdv = can('pdv_mercado');
  const isRest = can('restaurante');

  const sair = () => {
    logout();
    navigate('/login');
  };

  // Sem o Gestor, o painel lateral fica bloqueado: mostra só o conteúdo,
  // com um topo simples para voltar ao início (quando há mais de um módulo) e sair.
  if (!isGestor) {
    const modulosAtivos = [isPdv, isRest].filter(Boolean).length;
    return (
      <div className="flex min-h-viewport flex-col">
        <header className="sticky top-0 z-30 flex min-h-14 items-center gap-2.5 border-b border-slate-200 bg-white/80 px-3 pt-[env(safe-area-inset-top)] pb-1 backdrop-blur">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500 text-sm font-extrabold text-white shadow-md shadow-brand-500/30">
            S
          </div>
          <p className="min-w-0 truncate font-extrabold text-slate-800">{empresaNome || 'SimplesX'}</p>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {modulosAtivos > 1 && (
              <button
                className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                onClick={() => navigate('/')}
              >
                <Home className="h-4 w-4" /> Início
              </button>
            )}
            <span className="hidden text-xs font-semibold text-slate-500 sm:block">{nome || 'Usuário'}</span>
            <button
              onClick={sair}
              className="flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-700"
            >
              <LogOut className="h-4 w-4" /> Sair
            </button>
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] md:p-6">{children}</main>
      </div>
    );
  }

  const groups: NavGroup[] = [
    {
      items: [{ to: '/', label: 'Início', icon: <Home className="h-5 w-5" /> }],
    },
    {
      title: 'Gestor',
      items: [{ to: '/dashboard', label: 'Painel', icon: <LayoutDashboard className="h-5 w-5" /> }],
    },
    {
      title: 'Vendas',
      items: [
        { to: '/pdv', label: 'PDV Mercado', icon: <ScanBarcode className="h-5 w-5" /> },
        { to: '/vendas', label: 'Vendas', icon: <ReceiptText className="h-5 w-5" /> },
        { to: '/fiscal', label: 'NFC-e', icon: <FileCheck2 className="h-5 w-5" /> },
        { to: '/restaurante', label: 'Restaurante', icon: <UtensilsCrossed className="h-5 w-5" />, badge: badges?.mesas },
      ],
    },
    {
      title: 'Estoque',
      items: [
        { to: '/estoque', label: 'Estoque', icon: <Boxes className="h-5 w-5" />, badge: badges?.estoque_baixo },
        { to: '/entrada', label: 'Entrada de Mercadorias', icon: <PackagePlus className="h-5 w-5" /> },
        { to: '/validade', label: 'Controle de Validade', icon: <CalendarClock className="h-5 w-5" />, badge: badges?.validade },
        { to: '/categorias', label: 'Categorias', icon: <Tags className="h-5 w-5" /> },
      ],
    },
    {
      title: 'Gestão',
      items: [
        { to: '/financeiro', label: 'Financeiro', icon: <Wallet className="h-5 w-5" /> },
        { to: '/fechamento-caixa', label: 'Fechamento de Caixa', icon: <ClipboardCheck className="h-5 w-5" /> },
        { to: '/relatorios', label: 'Relatórios', icon: <BarChart3 className="h-5 w-5" /> },
        { to: '/perdas', label: 'Controle de Perdas', icon: <Trash2 className="h-5 w-5" />, badge: badges?.perdas },
        { to: '/funcionarios', label: 'Funcionários', icon: <Users className="h-5 w-5" /> },
        { to: '/impressoras', label: 'Impressoras', icon: <Printer className="h-5 w-5" /> },
      ],
    },
    {
      items: [
        { to: '/config', label: 'Configurações', icon: <Settings className="h-5 w-5" /> },
      ],
    },
  ];

  const perfilLabel = perfil === 'admin' ? 'Acesso total' : perfil.charAt(0).toUpperCase() + perfil.slice(1);

  const sidebar = (
    <div className="flex h-full flex-col bg-gradient-to-b from-slate-900 to-slate-950 text-slate-300">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500 text-base font-extrabold text-white shadow-lg shadow-brand-500/40">
          S
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-extrabold text-white">SimplesX</p>
          <p className="truncate text-[11px] text-slate-400">{empresaNome || 'Meu Negócio'}</p>
        </div>
        <button
          className="ml-auto rounded-lg p-1 text-slate-400 hover:bg-white/10 md:hidden"
          onClick={() => setOpen(false)}
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {groups.map((g, gi) => (
          <div key={gi}>
            {g.title && (
              <p className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">{g.title}</p>
            )}
            <div className="space-y-0.5">
              {g.items.map((it) => (
                <NavLink
                  key={it.to}
                  to={it.to}
                  end={it.to === '/'}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    `group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                      isActive ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && <span className="absolute inset-0 rounded-xl bg-white/10" />}
                      <span className="relative">{it.icon}</span>
                      <span className="relative flex-1 truncate">{it.label}</span>
                      {!!it.badge && it.badge > 0 && (
                        <span className="relative rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                          {it.badge}
                        </span>
                      )}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-white/10 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="mb-2 flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
            {String(nome || 'U').slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">{nome || 'Usuário'}</p>
            <p className="text-[11px] text-slate-400">{perfilLabel}</p>
          </div>
        </div>
        <button
          onClick={sair}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
        >
          <LogOut className="h-4 w-4" /> Sair
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-viewport">
      {/* Desktop sidebar */}
      <aside className="hidden md:block md:fixed md:inset-y-0 md:left-0 md:z-30 md:w-64">{sidebar}</aside>

      {/* Mobile sidebar */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              key="sidebar-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 z-40 bg-slate-900/60 md:hidden"
              onClick={() => setOpen(false)}
            />
            <motion.aside
              key="sidebar-drawer"
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'tween', duration: 0.2, ease: 'easeOut' }}
              className="fixed inset-y-0 left-0 z-50 w-64 md:hidden"
            >
              {sidebar}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main */}
      <div className="flex min-h-viewport min-w-0 flex-col md:pl-64">
        <header className="sticky top-0 z-30 flex min-h-14 shrink-0 items-center gap-1 border-b border-slate-200 bg-white/80 px-2 pt-[env(safe-area-inset-top)] pb-1 backdrop-blur md:hidden">
          <button
            className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100"
            onClick={() => setOpen(true)}
            aria-label="Abrir menu"
          >
            <Menu className="h-6 w-6" />
          </button>
          <button
            className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100"
            onClick={() => navigate('/')}
            aria-label="Ir para o início"
          >
            <Home className="h-6 w-6" />
          </button>
          <p className="ml-1 truncate font-extrabold text-slate-800">{empresaNome || 'SimplesX'}</p>
        </header>
        <main className="min-w-0 flex-1 p-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] md:p-6">{children}</main>
      </div>
    </div>
  );
}
