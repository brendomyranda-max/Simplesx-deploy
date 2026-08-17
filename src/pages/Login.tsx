import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Building2, ScanBarcode, User } from 'lucide-react';
import { useAuth } from '@/store/auth';
import { authApi } from '@/lib/api';
import { Button, Field, Input, useToast } from '@/components/ui';
import { Turnstile } from '@/components/Turnstile';
import { useNavigate } from 'react-router-dom';

export function Login() {
  const [cnpj, setCnpj] = useState('');
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [loading, setLoading] = useState(false);
  const [turnstileSiteKey, setTurnstileSiteKey] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const { setAuth } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const receberTokenHumano = useCallback((token: string) => setTurnstileToken(token), []);

  useEffect(() => {
    authApi.config()
      .then((config) => setTurnstileSiteKey(config.turnstile_site_key))
      .catch(() => toast('error', 'Proteção de segurança indisponível'));
  }, []);

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cnpj.replace(/\D/g, '').length !== 14) return toast('error', 'Informe um CNPJ válido');
    if (!usuario.trim() || !senha) return toast('error', 'Informe usuário e senha');
    if (!turnstileToken) return toast('error', 'Confirme que você é humano');
    setLoading(true);
    try {
      const r = await authApi.funcionario(cnpj, usuario, senha, turnstileToken);
      setAuth(r.nome, r.perfil, r.modulos);
      toast('success', `Bem-vindo(a), ${r.nome}!`);
      navigate('/');
    } catch (err: any) {
      setTurnstileToken('');
      window.turnstile?.reset();
      toast('error', err?.error || 'Falha no login');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-brand-950 to-slate-900 p-4">
      <motion.div initial={{ opacity: 0, scale: 0.96, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center">
          <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-500 text-3xl font-extrabold text-white shadow-2xl shadow-brand-500/40">S</div>
          <h1 className="text-2xl font-extrabold text-white">SimplesX</h1>
          <p className="mt-1 text-sm text-slate-400">Acesso seguro ao seu estabelecimento</p>
        </div>
        <div className="card p-6">
          <form onSubmit={entrar} className="space-y-4">
            <Field label="CNPJ da empresa" hint="O CNPJ identifica o ambiente da sua empresa">
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input autoFocus inputMode="numeric" autoComplete="organization" className="pl-9" placeholder="00.000.000/0000-00" value={cnpj} onChange={(e) => setCnpj(e.target.value)} />
              </div>
            </Field>
            <Field label="Usuário">
              <div className="relative">
                <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input autoComplete="username" className="pl-9" value={usuario} onChange={(e) => setUsuario(e.target.value)} />
              </div>
            </Field>
            <Field label="Senha">
              <Input type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} />
            </Field>
            {turnstileSiteKey ? (
              <Turnstile siteKey={turnstileSiteKey} onToken={receberTokenHumano} />
            ) : (
              <div className="rounded-lg bg-slate-100 p-3 text-center text-xs text-slate-500">Carregando proteção de segurança…</div>
            )}
            <Button type="submit" loading={loading} className="w-full" size="lg" icon={<ScanBarcode className="h-5 w-5" />}>
              {loading ? 'Entrando...' : 'Entrar'}
            </Button>
          </form>
        </div>
        <p className="mt-4 text-center text-xs text-slate-500">O CNPJ não substitui sua senha e não concede acesso sozinho.</p>
      </motion.div>
    </div>
  );
}
