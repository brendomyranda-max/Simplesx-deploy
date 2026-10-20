/**
 * Arquivo: App.tsx
 * Responsabilidade: Define as rotas, protege áreas autenticadas e libera cada módulo conforme as permissões.
 */

import React, { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth, type Modulo } from '@/store/auth';
import type { AreaApp } from '@/lib/areas';
import { AppShell } from '@/components/AppShell';
import { InstallPrompt } from '@/components/InstallPrompt';
import { NfcBridge } from '@/components/NfcBridge';
import { PublicBrandIntro } from '@/components/PublicBrandIntro';
import { PortalPage } from '@/pages/PortalPage';
import { authApi, configApi, estadoApi } from '@/lib/api';
import type { ConfigEmpresa } from '@/lib/types';

const Login = lazy(() => import('@/pages/Login').then((module) => ({ default: module.Login })));
const InicioPage = lazy(() => import('@/pages/InicioPage').then((module) => ({ default: module.InicioPage })));
const Dashboard = lazy(() => import('@/pages/Dashboard').then((module) => ({ default: module.Dashboard })));
const PdvPage = lazy(() => import('@/pages/PdvPage').then((module) => ({ default: module.PdvPage })));
const VendasPage = lazy(() => import('@/pages/VendasPage').then((module) => ({ default: module.VendasPage })));
const RestaurantePage = lazy(() => import('@/pages/RestaurantePage').then((module) => ({ default: module.RestaurantePage })));
const RecepcaoPage = lazy(() => import('@/pages/RecepcaoPage').then((module) => ({ default: module.RecepcaoPage })));
const DeliveryPage = lazy(() => import('@/pages/DeliveryPage').then((module) => ({ default: module.DeliveryPage })));
const CozinhaPage = lazy(() => import('@/pages/CozinhaPage').then((module) => ({ default: module.CozinhaPage })));
const LancarCartaoPage = lazy(() => import('@/pages/LancarCartaoPage').then((module) => ({ default: module.LancarCartaoPage })));
const ComandaPage = lazy(() => import('@/pages/ComandaPage').then((module) => ({ default: module.ComandaPage })));
const PagamentosComanda = lazy(() => import('@/pages/PagamentosComanda').then((module) => ({ default: module.PagamentosComanda })));
const EstoquePage = lazy(() => import('@/pages/EstoquePage').then((module) => ({ default: module.EstoquePage })));
const EntradaPage = lazy(() => import('@/pages/EntradaPage').then((module) => ({ default: module.EntradaPage })));
const ValidadePage = lazy(() => import('@/pages/ValidadePage').then((module) => ({ default: module.ValidadePage })));
const CategoriasPage = lazy(() => import('@/pages/CategoriasPage').then((module) => ({ default: module.CategoriasPage })));
const FinanceiroPage = lazy(() => import('@/pages/FinanceiroPage').then((module) => ({ default: module.FinanceiroPage })));
const FechamentoCaixaPage = lazy(() => import('@/pages/FechamentoCaixaPage').then((module) => ({ default: module.FechamentoCaixaPage })));
const RelatoriosPage = lazy(() => import('@/pages/RelatoriosPage').then((module) => ({ default: module.RelatoriosPage })));
const PerdasPage = lazy(() => import('@/pages/PerdasPage').then((module) => ({ default: module.PerdasPage })));
const FuncionariosPage = lazy(() => import('@/pages/FuncionariosPage').then((module) => ({ default: module.FuncionariosPage })));
const ImpressorasPage = lazy(() => import('@/pages/ImpressorasPage').then((module) => ({ default: module.ImpressorasPage })));
const ConfiguracoesPage = lazy(() => import('@/pages/ConfiguracoesPage').then((module) => ({ default: module.ConfiguracoesPage })));
const FiscalPage = lazy(() => import('@/pages/FiscalPage').then((module) => ({ default: module.FiscalPage })));
const InvestidoresPage = lazy(() => import('@/pages/InvestidoresPage'));
const OnlineStorefront = lazy(() => import('@/pages/OnlineStorefront').then((module) => ({ default: module.OnlineStorefront })));
const OnlineFallback = () => <div className="flex min-h-screen items-center justify-center bg-[#fcfbf7] text-sm text-slate-500">Carregando cardápio…</div>;

function RedirecionaPedidos() {
  const [params] = useSearchParams();
  const aba = params.get('aba');
  if (aba === 'restaurante' || aba === 'prioridade') return <Navigate to="/restaurante/cozinha" replace />;
  return <Navigate to="/restaurante/delivery" replace />;
}

function Require({ mod, area, children }: { mod: Modulo; area?: AreaApp; children: React.ReactNode }) {
  const { can, canArea } = useAuth();
  const location = useLocation();
  if (!can(mod) || (area && can('gestor') && !canArea(area))) return <Navigate to="/" replace state={{ from: location }} />;
  return <>{children}</>;
}

function ProtectedApp({
  badges,
  empresaNome,
}: {
  badges: Record<string, number>;
  empresaNome?: string;
}) {
  return (
    <AppShell badges={badges} empresaNome={empresaNome}>
      <Routes>
        <Route
          path="/dashboard"
          element={
            <Require mod="gestor" area="geral">
              <Dashboard />
            </Require>
          }
        />
        <Route
          path="/vendas"
          element={
            <Require mod="gestor" area="vendas">
              <VendasPage />
            </Require>
          }
        />
        <Route
          path="/estoque"
          element={
            <Require mod="gestor" area="estoque">
              <EstoquePage />
            </Require>
          }
        />
        <Route
          path="/entrada"
          element={
            <Require mod="gestor" area="estoque">
              <EntradaPage />
            </Require>
          }
        />
        <Route
          path="/validade"
          element={
            <Require mod="gestor" area="estoque">
              <ValidadePage />
            </Require>
          }
        />
        <Route
          path="/categorias"
          element={
            <Require mod="gestor" area="estoque">
              <CategoriasPage />
            </Require>
          }
        />
        <Route
          path="/financeiro"
          element={
            <Require mod="gestor" area="gestao">
              <FinanceiroPage />
            </Require>
          }
        />
        <Route
          path="/fechamento-caixa"
          element={<Require mod="gestor" area="gestao"><FechamentoCaixaPage /></Require>}
        />
        <Route
          path="/relatorios"
          element={
            <Require mod="gestor" area="geral">
              <RelatoriosPage />
            </Require>
          }
        />
        <Route
          path="/perdas"
          element={
            <Require mod="gestor" area="gestao">
              <PerdasPage />
            </Require>
          }
        />
        <Route
          path="/funcionarios"
          element={
            <Require mod="gestor" area="configuracoes">
              <FuncionariosPage />
            </Require>
          }
        />
        <Route
          path="/impressoras"
          element={
            <Require mod="gestor" area="configuracoes">
              <ImpressorasPage />
            </Require>
          }
        />
        <Route
          path="/config"
          element={
            <Require mod="gestor" area="configuracoes">
              <ConfiguracoesPage />
            </Require>
          }
        />
        <Route path="/fiscal" element={<Require mod="gestor" area="vendas"><FiscalPage /></Require>} />
        <Route
          path="/pdv"
          element={
            <Require mod="pdv_mercado" area="vendas">
              <PdvPage />
            </Require>
          }
        />
        <Route
          path="/restaurante"
          element={
            <Require mod="restaurante" area="vendas">
              <RestaurantePage />
            </Require>
          }
        />
        <Route
          path="/restaurante/recepcao"
          element={<Require mod="restaurante" area="vendas"><RecepcaoPage /></Require>}
        />
        <Route
          path="/restaurante/lancar-cartao"
          element={
            <Require mod="restaurante" area="vendas">
              <LancarCartaoPage />
            </Require>
          }
        />
        <Route path="/restaurante/pedidos" element={<Require mod="restaurante" area="vendas"><RedirecionaPedidos /></Require>} />
        <Route
          path="/restaurante/delivery"
          element={
            <Require mod="restaurante" area="vendas">
              <DeliveryPage />
            </Require>
          }
        />
        <Route
          path="/restaurante/cozinha"
          element={
            <Require mod="restaurante" area="vendas">
              <CozinhaPage />
            </Require>
          }
        />
        <Route path="/restaurante/cardapio-online" element={<Navigate to="/estoque?aba=delivery" replace />} />
        <Route
          path="/restaurante/comanda/:id"
          element={
            <Require mod="restaurante" area="vendas">
              <ComandaPage />
            </Require>
          }
        />
        <Route
          path="/restaurante/comanda/:id/pagamentos"
          element={
            <Require mod="restaurante" area="vendas">
              <PagamentosComanda />
            </Require>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}

function SessionApp() {
  const { token, setAuth, clearSession } = useAuth();
  const [iniciando, setIniciando] = useState(true);
  const [empresa, setEmpresa] = useState<ConfigEmpresa | null>(null);
  const [badges, setBadges] = useState<Record<string, number>>({});
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    authApi.me()
      .then((sessao) => { if (alive) setAuth(sessao.nome, sessao.perfil, sessao.modulos); })
      .catch(() => undefined)
      .finally(() => { if (alive) setIniciando(false); });
    return () => { alive = false; };
  }, [setAuth]);

  useEffect(() => {
    if (!token) { setEmpresa(null); setBadges({}); return; }
    let alive = true;
    const load = async () => {
      if (document.hidden) return;
      try {
        const cfg = await configApi.get();
        if (alive) {
          setEmpresa(cfg);
          localStorage.setItem('simplesx_empresa', cfg.empresa_nome);
        }
        if (!alive) return;
        const est = await estadoApi.get();
        if (alive) {
          setBadges({
            mesas: est.mesas_ocupadas,
            estoque_baixo: est.estoque_baixo,
            validade: est.validade_vencendo,
            perdas: est.perdas_hoje,
          });
        }
      } catch {
        /* servidor indisponível */
      }
    };
    load();
    const iv = setInterval(load, 60000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [token]);

  useEffect(() => {
    const onLogout = () => { clearSession(); navigate('/login', { replace: true }); };
    window.addEventListener('simplexsa:logout', onLogout);
    return () => window.removeEventListener('simplexsa:logout', onLogout);
  }, [navigate, clearSession]);

  if (iniciando) return <main className="min-h-screen bg-slate-950 p-6 sm:p-10"><div className="mx-auto max-w-4xl"><PublicBrandIntro /><p role="status" className="mt-8 text-sm text-slate-400">Verificando sessão…</p></div></main>;
  if (!token) return <Login />;

  return (
    <>
    <NfcBridge />
    <Routes>
        <Route path="/gestor" element={<Navigate to="/dashboard" replace />} />
      <Route path="/" element={<InicioPage />} />
      <Route path="*" element={<ProtectedApp badges={badges} empresaNome={empresa?.empresa_nome} />} />
    </Routes>
    </>
  );
}

// A apresentação é pública e não depende da disponibilidade da API de sessão.
export default function App() {
  return <>
    <InstallPrompt />
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-slate-500" role="status">Carregando…</div>}>
    <Routes>
    <Route path="/investidores" element={<Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-slate-950 text-sm text-slate-300">Carregando apresentação…</div>}><InvestidoresPage /></Suspense>} />
    <Route path="/" element={<PortalPage />} />
    <Route path="/gestor/*" element={<SessionApp />} />
    {/* Vitrine pública: propositalmente fora da sessão e do AppShell do Gestor. */}
    <Route path="/pedido" element={<Suspense fallback={<OnlineFallback />}><OnlineStorefront /></Suspense>} />
    <Route path="/pedido/:slug/acompanhar/:chave" element={<Suspense fallback={<OnlineFallback />}><OnlineStorefront /></Suspense>} />
    <Route path="/pedido/:slug" element={<Suspense fallback={<OnlineFallback />}><OnlineStorefront /></Suspense>} />
    <Route path="*" element={<SessionApp />} />
  </Routes>
    </Suspense>
  </>;
}
