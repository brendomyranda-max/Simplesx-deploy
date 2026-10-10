/**
 * Arquivo: Login.tsx
 * Responsabilidade: Implementa a tela Login.tsx e coordena seus dados e ações.
 */

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Building2, CreditCard, LogIn, User } from 'lucide-react';
import { useAuth } from '@/store/auth';
import { authApi, type SignupPolicy } from '@/lib/api';
import { Button, Field, Input, useToast } from '@/components/ui';
import { Investimento } from '@/components/Investimento';
import { BrandLogo } from '@/components/BrandLogo';
import { Turnstile } from '@/components/Turnstile';
import { useNavigate } from 'react-router-dom';

export function Login() {
  const [cadastro, setCadastro] = useState(false);
  const [condicoesCadastro, setCondicoesCadastro] = useState<SignupPolicy | null>(null);
  const [erroConfig, setErroConfig] = useState(false);
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
      .then((config) => {
        setTurnstileSiteKey(config.turnstile_site_key);
        setCondicoesCadastro(config.cadastro);
      })
      .catch(() => { setErroConfig(true); toast('error', 'Não foi possível carregar as informações de acesso'); });
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
          <BrandLogo className="mb-4 h-20 w-20 rounded-2xl shadow-2xl shadow-black/40" />
          <h1 className="text-2xl font-extrabold text-white">DoixP</h1>
          <p className="mt-1 text-sm text-slate-400">Acesso seguro ao seu estabelecimento</p>
        </div>
        <div className="card p-6">
          <div className="mb-5 grid grid-cols-2 gap-2">
            {[false, true].map((modo) => <Button key={String(modo)} type="button" disabled={loading} variant={cadastro === modo ? 'primary' : 'secondary'} onClick={() => { if (modo === cadastro) return; setCadastro(modo); setSenha(''); setTurnstileToken(''); }}>{modo ? 'Criar minha conta' : 'Entrar'}</Button>)}
          </div>
          {cadastro ? <div className="space-y-4">
            <div className="rounded-2xl border border-brand-100 bg-brand-50 p-5">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-brand-800"><CreditCard className="h-5 w-5" aria-hidden="true" /> Abertura da conta</div>
              {condicoesCadastro ? <>
                <p className="text-3xl font-extrabold tracking-tight text-slate-900">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: condicoesCadastro.moeda }).format(condicoesCadastro.valor_centavos / 100)}</p>
                <p className="mt-1 text-sm font-medium text-brand-700">Pagamento único para criar sua conta</p>
                <p className="mt-4 text-sm leading-relaxed text-slate-600">A conta será liberada após a confirmação do pagamento.</p>
              </> : <p role="status" className="text-sm text-slate-600">{erroConfig ? 'Não foi possível carregar o valor do cadastro. Recarregue a página para tentar novamente.' : 'Carregando condições do cadastro…'}</p>}
            </div>
            <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-900">O pagamento para novos cadastros está em preparação. A abertura de contas estará disponível assim que ele for liberado.</p>
            <Button type="button" disabled className="w-full" size="lg" icon={<CreditCard className="h-5 w-5" />}>Pagamento em preparação</Button>
            <p className="text-center text-xs text-slate-500">Já tem uma conta? Use a opção Entrar.</p>
          </div> : <form onSubmit={entrar} className="space-y-4">
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
              <Input type="password" required maxLength={128} autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} />
            </Field>
            {turnstileSiteKey ? (
              <Turnstile siteKey={turnstileSiteKey} onToken={receberTokenHumano} />
            ) : (
              <div className="rounded-lg bg-slate-100 p-3 text-center text-xs text-slate-500">{erroConfig ? 'Proteção de segurança indisponível. Recarregue a página para tentar novamente.' : 'Carregando proteção de segurança…'}</div>
            )}
            <Button type="submit" loading={loading} className="w-full" size="lg" icon={<LogIn className="h-5 w-5" />}>
              {loading ? 'Entrando...' : 'Entrar'}
            </Button>
          </form>}
        </div>
        <Investimento />
        <p className="mt-4 text-center text-xs text-slate-500">O CNPJ não substitui sua senha e não concede acesso sozinho.</p>
      </motion.div>
    </div>
  );
}
