import { useState } from 'react';
import { motion } from 'framer-motion';
import { KeyRound, ScanBarcode, User, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/store/auth';
import { authApi, setToken } from '@/lib/api';
import { Button, Field, Input, useToast } from '@/components/ui';
import { useNavigate } from 'react-router-dom';

export function Login() {
  const [etapa, setEtapa] = useState<'token' | 'pessoa'>('token');
  const [token, setTokenVal] = useState('');
  const [tokenNome, setTokenNome] = useState('');
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [loading, setLoading] = useState(false);
  const { setAuth } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const validarToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return toast('error', 'Informe o token de acesso');
    setLoading(true);
    try {
      const r = await authApi.login(token.trim());
      setTokenNome(r.nome);
      setEtapa('pessoa');
    } catch (err: any) {
      toast('error', err?.error || 'Falha na validação do token');
    } finally {
      setLoading(false);
    }
  };

  const entrarPessoa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usuario.trim() || !senha) return toast('error', 'Informe usuário e senha');
    setLoading(true);
    try {
      const r = await authApi.funcionario(usuario, senha);
      const tk = `func:${r.id}`;
      setToken(tk);
      setAuth(tk, r.nome, r.perfil, r.modulos);
      toast('success', `Bem-vindo(a), ${r.nome}!`);
      navigate('/');
    } catch (err: any) {
      toast('error', err?.error || 'Falha no login');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-brand-950 to-slate-900 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 26 }}
        className="w-full max-w-md"
      >
        <div className="mb-6 flex flex-col items-center">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.15, type: 'spring', stiffness: 300, damping: 18 }}
            className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-500 text-3xl font-extrabold text-white shadow-2xl shadow-brand-500/40"
          >
            S
          </motion.div>
          <h1 className="text-2xl font-extrabold text-white">SimplesX</h1>
          <p className="mt-1 text-sm text-slate-400">Sistema completo para seu negócio</p>
        </div>

        <div className="card p-6">
          {etapa === 'token' ? (
            <form onSubmit={validarToken} className="space-y-4">
              <div className="mb-1 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-200">Etapa 1 de 2</h2>
                <span className="text-xs text-slate-500">Token do dispositivo</span>
              </div>
              <Field label="Token de acesso" hint="Informe o token gerado nas Configurações ou por um administrador">
                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    autoFocus
                    className="pl-9 font-mono"
                    placeholder="Cole seu token aqui..."
                    value={token}
                    onChange={(e) => setTokenVal(e.target.value)}
                  />
                </div>
              </Field>
              <Button type="submit" loading={loading} className="w-full" size="lg" icon={<ScanBarcode className="h-5 w-5" />}>
                {loading ? 'Validando...' : 'Continuar'}
              </Button>
            </form>
          ) : (
            <form onSubmit={entrarPessoa} className="space-y-4">
              <div className="mb-1 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-200">Etapa 2 de 2</h2>
                <span className="text-xs text-slate-500">Identificação do usuário</span>
              </div>
              <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span className="truncate">Token validado: {tokenNome}</span>
              </div>
              <Field label="Usuário">
                <div className="relative">
                  <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    autoFocus
                    className="pl-9"
                    placeholder="nome de usuário"
                    value={usuario}
                    onChange={(e) => setUsuario(e.target.value)}
                  />
                </div>
              </Field>
              <Field label="Senha">
                <Input
                  type="password"
                  placeholder="••••••••"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                />
              </Field>
              <Button type="submit" loading={loading} className="w-full" size="lg" icon={<ScanBarcode className="h-5 w-5" />}>
                {loading ? 'Entrando...' : 'Entrar'}
              </Button>
              <button
                type="button"
                onClick={() => {
                  setEtapa('token');
                  setTokenNome('');
                  setSenha('');
                }}
                className="flex w-full items-center justify-center gap-1 text-xs text-slate-400 hover:text-slate-200"
              >
                <ArrowLeft className="h-3 w-3" /> Usar outro token
              </button>
            </form>
          )}
        </div>
        <p className="mt-4 text-center text-xs text-slate-500">
          Precisa de acesso? Fale com o administrador para obter um token e seu usuário.
        </p>
      </motion.div>
    </div>
  );
}
