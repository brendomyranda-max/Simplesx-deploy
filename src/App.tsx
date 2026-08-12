import React, { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, type Modulo } from '@/store/auth';
import { AppShell } from '@/components/layout/AppShell';
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
import { RelatoriosPage } from '@/pages/RelatoriosPage';
import { PerdasPage } from '@/pages/PerdasPage';
import { FuncionariosPage } from '@/pages/FuncionariosPage';
import { ImpressorasPage } from '@/pages/ImpressorasPage';
import { ConfiguracoesPage } from '@/pages/ConfiguracoesPage';
import { configApi, estadoApi } from '@/lib/api';
import type { ConfigEmpresa } from '@/lib/types';

function Require({ mod, children }: { mod: Modulo; children: React.ReactNode }) {
  const { can } = useAuth();
  const location = useLocation();
  if (!can(mod)) return <Navigate to="/" replace state={{ from: location }} />;
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
            <Require mod="gestor">
              <Dashboard />
            </Require>
          }
        />
        <Route
          path="/vendas"
          element={
            <Require mod="gestor">
              <VendasPage />
            </Require>
          }
        />
        <Route
          path="/estoque"
          element={
            <Require mod="gestor">
              <EstoquePage />
            </Require>
          }
        />
        <Route
          path="/entrada"
          element={
            <Require mod="gestor">
              <EntradaPage />
            </Require>
          }
        />
        <Route
          path="/validade"
          element={
            <Require mod="gestor">
              <ValidadePage />
            </Require>
          }
        />
        <Route
          path="/categorias"
          element={
            <Require mod="gestor">
              <CategoriasPage />
            </Require>
          }
        />
        <Route
          path="/financeiro"
          element={
            <Require mod="gestor">
              <FinanceiroPage />
            </Require>
          }
        />
        <Route
          path="/relatorios"
          element={
            <Require mod="gestor">
              <RelatoriosPage />
            </Require>
          }
        />
        <Route
          path="/perdas"
          element={
            <Require mod="gestor">
              <PerdasPage />
            </Require>
          }
        />
        <Route
          path="/funcionarios"
          element={
            <Require mod="gestor">
              <FuncionariosPage />
            </Require>
          }
        />
        <Route
          path="/impressoras"
          element={
            <Require mod="gestor">
              <ImpressorasPage />
            </Require>
          }
        />
        <Route
          path="/config"
          element={
            <Require mod="gestor">
              <ConfiguracoesPage />
            </Require>
          }
        />
        <Route
          path="/pdv"
          element={
            <Require mod="pdv_mercado">
              <PdvPage />
            </Require>
          }
        />
        <Route
          path="/restaurante"
          element={
            <Require mod="restaurante">
              <RestaurantePage />
            </Require>
          }
        />
        <Route
          path="/restaurante/comanda/:id"
          element={
            <Require mod="restaurante">
              <ComandaPage />
            </Require>
          }
        />
        <Route
          path="/restaurante/comanda/:id/pagamentos"
          element={
            <Require mod="restaurante">
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
  const { token } = useAuth();
  const [empresa, setEmpresa] = useState<ConfigEmpresa | null>(null);
  const [badges, setBadges] = useState<Record<string, number>>({});
  const navigate = useNavigate();

  useEffect(() => {
    if (!token) return;
    let alive = true;
    const load = async () => {
      try {
        const cfg = await configApi.get();
        if (alive) {
          setEmpresa(cfg);
          localStorage.setItem('simplesx_empresa', cfg.empresa_nome);
        }
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
    const onLogout = () => navigate('/login');
    window.addEventListener('simplesx:logout', onLogout);
    return () => window.removeEventListener('simplesx:logout', onLogout);
  }, [navigate]);

  if (!token) return <Login />;

  return (
    <Routes>
      <Route path="/" element={<InicioPage />} />
      <Route path="*" element={<ProtectedApp badges={badges} empresaNome={empresa?.empresa_nome} />} />
    </Routes>
  );
}
