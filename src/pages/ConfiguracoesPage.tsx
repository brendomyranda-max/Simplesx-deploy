/**
 * Arquivo: ConfiguracoesPage.tsx
 * Responsabilidade: Implementa a tela ConfiguracoesPage.tsx e coordena seus dados e ações.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings, Save, Nfc } from 'lucide-react';
import { AnimatedPage } from '@/components/AnimatedPage';
import { PdaInstalacaoCard } from '@/components/PdaInstalacaoCard';
import { Button, Card, Field, Input, Select, Spinner, useToast } from '@/components/ui';
import { configApi } from '@/lib/api';
import type { ConfigEmpresa } from '@/lib/types';

export function ConfiguracoesPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [cfg, setCfg] = useState<ConfigEmpresa | null>(null);
  const [form, setForm] = useState<any>({});
  const [load, setLoad] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const c = await configApi.get();
        setCfg(c);
        setForm({
          empresa_nome: c.empresa_nome,
          empresa_cnpj: c.empresa_cnpj || '',
          modo_operacao: c.modo,
          taxa_garcom_pct: c.taxa_garcom_pct,
          perda_timeout_min: c.perda_timeout_min,
          dias_vencimento_aviso: c.dias_vencimento_aviso,
        });
      } catch (e: any) {
        toast('error', e?.error || 'Erro ao carregar configurações');
      } finally {
        setLoad(false);
      }
    })();
  }, []);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await configApi.update({
        empresa_nome: form.empresa_nome,
        empresa_cnpj: form.empresa_cnpj,
        modo_operacao: form.modo_operacao,
        taxa_garcom_pct: Number(form.taxa_garcom_pct) || 0,
        perda_timeout_min: Number(form.perda_timeout_min) || 0,
        dias_vencimento_aviso: Number(form.dias_vencimento_aviso) || 7,
      });
      toast('success', 'Configurações salvas');
    } catch (err: any) {
      toast('error', err?.error || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatedPage>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-800">Configurações</h1>
          <p className="text-sm text-slate-500">Preferências do sistema e instalação do PDA</p>
        </div>
      </div>

      <div className="mb-4 space-y-4">
        <PdaInstalacaoCard />
        <Card className="border-brand-200 bg-brand-50/40 p-5">
          <div className="flex flex-wrap items-start gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-600 text-white">
              <Nfc className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-extrabold text-slate-800">Cartão NFC</h2>
              <p className="mt-1 text-sm text-slate-500">
                O cartão é o número da mesa. Ligue o NFC no Servidor DoixP. Em Mesas, use Adicionar com cartão para abrir,
                Lançar para cartão para montar o pedido e aproximar, e Fechamento de cartão para receber.
              </p>
              <div className="mt-3">
                <Button type="button" icon={<Nfc className="h-4 w-4" />} onClick={() => navigate('/restaurante')}>Abrir mesas</Button>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {load && <Spinner />}

      {cfg && <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-4 flex items-center gap-2">
            <Settings className="h-5 w-5 text-brand-600" />
            <h2 className="text-sm font-bold text-slate-700">Geral</h2>
          </div>
          <form onSubmit={salvar} className="space-y-4">
            <Field label="Nome da empresa / negócio">
              <Input value={form.empresa_nome} onChange={(e) => setForm({ ...form, empresa_nome: e.target.value })} />
            </Field>
            <Field label="CNPJ da empresa" hint="Usado na impressão das contas">
              <Input value={form.empresa_cnpj} onChange={(e) => setForm({ ...form, empresa_cnpj: e.target.value })} placeholder="00.000.000/0000-00" />
            </Field>
            <Field label="Modo de operação">
              <Select value={form.modo_operacao} onChange={(e) => setForm({ ...form, modo_operacao: e.target.value })}>
                <option value="mercado">Mercado / Loja</option>
                <option value="estoque">Estoque simplificado</option>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Taxa de garçom (%)">
                <Input type="number" step="0.1" min="0" max="100" value={form.taxa_garcom_pct} onChange={(e) => setForm({ ...form, taxa_garcom_pct: e.target.value })} />
              </Field>
              <Field label="Aviso de vencimento (dias)">
                <Input type="number" min="0" value={form.dias_vencimento_aviso} onChange={(e) => setForm({ ...form, dias_vencimento_aviso: e.target.value })} />
              </Field>
            </div>
            <Field label="Tempo de confirmação de perda (min)" hint="Após este tempo, itens pendentes na cozinha são marcados como perdidos">
              <Input type="number" min="0" value={form.perda_timeout_min} onChange={(e) => setForm({ ...form, perda_timeout_min: e.target.value })} />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" loading={saving} icon={<Save className="h-4 w-4" />}>Salvar</Button>
            </div>
          </form>
        </Card>
      </div>}
    </AnimatedPage>
  );
}
