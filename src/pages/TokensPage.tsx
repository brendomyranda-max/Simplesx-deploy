import { useEffect, useState } from 'react';
import { KeyRound, Plus, Trash2, Copy } from 'lucide-react';
import { AnimatedPage } from '@/components/anim';
import { Badge, Button, Card, EmptyState, Field, IconButton, Input, Modal, Spinner, useToast } from '@/components/ui';
import { tokenApi } from '@/lib/api';

interface Token {
  id: number;
  nome: string;
  token: string;
  ativo: number;
  criado_em: string;
}

export function TokensPage() {
  const toast = useToast();
  const [tokens, setTokens] = useState<Token[]>([]);
  const [load, setLoad] = useState(true);
  const [modal, setModal] = useState(false);
  const [nome, setNome] = useState('');
  const [novoToken, setNovoToken] = useState('');

  const loadAll = async () => {
    setLoad(true);
    try {
      setTokens(await tokenApi.list());
    } catch (e: any) {
      toast('error', e?.error || 'Erro ao carregar');
    } finally {
      setLoad(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const criar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) return toast('error', 'Informe um nome');
    try {
      const r = await tokenApi.create(nome);
      setNovoToken(r.token);
      setNome('');
      loadAll();
    } catch (err: any) {
      toast('error', err?.error || 'Erro ao criar token');
    }
  };

  const copiar = () => {
    navigator.clipboard?.writeText(novoToken);
    toast('success', 'Token copiado');
  };

  return (
    <AnimatedPage>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-800">Tokens de Acesso</h1>
          <p className="text-sm text-slate-500">Use um token para entrar no sistema ou integrar apps</p>
        </div>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setModal(true)}>Criar token</Button>
      </div>

      {load ? (
        <Spinner />
      ) : tokens.length === 0 ? (
        <Card><EmptyState icon={<KeyRound className="h-8 w-8" />} title="Nenhum token criado" /></Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Nome</th>
                  <th className="th">Token</th>
                  <th className="th">Criado em</th>
                  <th className="th">Status</th>
                  <th className="th text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tokens.map((t) => (
                  <tr key={t.id}>
                    <td className="td font-semibold text-slate-800">{t.nome}</td>
                    <td className="td"><code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">{t.token.slice(0, 12)}…</code></td>
                    <td className="td text-slate-500">{t.criado_em?.slice(0, 10) || '-'}</td>
                    <td className="td">{t.ativo ? <Badge color="green">ativo</Badge> : <Badge color="red">inativo</Badge>}</td>
                    <td className="td">
                      <div className="flex justify-end">
                        <IconButton
                          label={t.ativo ? 'Desativar' : 'Ativar'}
                          icon={<span className={`h-2 w-2 rounded-full ${t.ativo ? 'bg-red-500' : 'bg-emerald-500'}`} />}
                          onClick={async () => {
                            await tokenApi.toggle(t.id);
                            loadAll();
                          }}
                        />
                        <IconButton label="Excluir" variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={async () => {
                          if (!window.confirm(`Excluir token "${t.nome}"?`)) return;
                          await tokenApi.remove(t.id);
                          loadAll();
                        }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={novoToken ? 'Token criado' : 'Criar token'}>
        {novoToken ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">Guarde este token agora — ele não será mostrado novamente:</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-xs text-slate-800">{novoToken}</code>
              <Button type="button" variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={copiar}>Copiar</Button>
            </div>
            <div className="flex justify-end">
              <Button type="button" onClick={() => { setNovoToken(''); setModal(false); }}>Fechar</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={criar} className="space-y-4">
            <Field label="Nome *">
              <Input value={nome} onChange={(e) => setNome(e.target.value)} autoFocus placeholder="ex.: Caixa 1, App integração" />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setModal(false)}>Cancelar</Button>
              <Button type="submit">Criar</Button>
            </div>
          </form>
        )}
      </Modal>
    </AnimatedPage>
  );
}
