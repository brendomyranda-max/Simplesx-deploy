/**
 * Arquivo: App.tsx
 * Responsabilidade: Define as rotas, protege áreas autenticadas e libera cada módulo conforme as permissões.
 */

import React, { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, type Modulo } from '@/store/auth';
import type { AreaApp } from '@/lib/areas';
import { AppShell } from '@/components/AppShell';
import { Login } from '@/pages/Login';
import { InicioPage } from '@/pages/InicioPage';
import { Dashboard } from '@/pages/Dashboard';
import { PdvPage } from '@/pages/PdvPage';
import { VendasPage } from '@/pages/VendasPage';
import { RestaurantePage } from '@/pages/RestaurantePage';
import { ComandaPage } from '@/pages/ComandaPage';
import { PagamentosComanda } from '@/pages/PagamentosComanda';
import { EstoquePage } from '@/pages/EstoquePage';
import { EntradaPage } from '@/pages/EntradaPage';
import { ValidadePage } from '@/pages/ValidadePage';
import { CategoriasPage } from '@/pages/CategoriasPage';
import { FinanceiroPage } from '@/pages/FinanceiroPage';
import { FechamentoCaixaPage } from '@/pages/FechamentoCaixaPage';
import { RelatoriosPage } from '@/pages/RelatoriosPage';
import { PerdasPage } from '@/pages/PerdasPage';
import { FuncionariosPage } from '@/pages/FuncionariosPage';
import { ImpressorasPage } from '@/pages/ImpressorasPage';
import { ConfiguracoesPage } from '@/pages/ConfiguracoesPage';
import { FiscalPage } from '@/pages/FiscalPage';
import { authApi, configApi, estadoApi } from '@/lib/api';
import type { ConfigEmpresa } from '@/lib/types';

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

export default function App() {
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
    window.addEventListener('simplesx:logout', onLogout);
    return () => window.removeEventListener('simplesx:logout', onLogout);
  }, [navigate, clearSession]);

  if (iniciando) return <div className="flex min-h-screen items-center justify-center bg-slate-950 text-sm text-slate-300">Verificando sessão…</div>;
  if (!token) return <Login />;

  return (
    <Routes>
      <Route path="/" element={<InicioPage />} />
      <Route path="*" element={<ProtectedApp badges={badges} empresaNome={empresa?.empresa_nome} />} />
    </Routes>
  );
}
