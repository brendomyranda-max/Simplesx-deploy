/**
 * Arquivo: ConfiguracoesPage.tsx
 * Responsabilidade: Implementa a tela ConfiguracoesPage.tsx e coordena seus dados e ações.
 */

import { useEffect, useState } from 'react';
import { Settings, Save } from 'lucide-react';
import { AnimatedPage } from '@/components/AnimatedPage';
import { AppVersion } from '@/components/AppVersion';
import { PdaInstalacaoCard } from '@/components/PdaInstalacaoCard';
import { Button, Card, Field, Input, Select, Spinner, useToast } from '@/components/ui';
import { configApi, efiApi, type EfiConfig } from '@/lib/api';
import type { ConfigEmpresa } from '@/lib/types';

export function ConfiguracoesPage() {
  const toast = useToast();
  const [cfg, setCfg] = useState<ConfigEmpresa | null>(null);
  const [form, setForm] = useState<any>({});
  const [load, setLoad] = useState(true);
  const [saving, setSaving] = useState(false);
  const [efi, setEfi] = useState<EfiConfig | null>(null);
  const [payeeCode, setPayeeCode] = useState('');
  const [pixChave, setPixChave] = useState('');
  const [pixCidade, setPixCidade] = useState('');
  const [savingEfi, setSavingEfi] = useState(false);

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
        const payment = await efiApi.config();
        setEfi(payment);
        setPayeeCode(payment.payee_code || '');
        setPixChave(payment.pix_chave || '');
        setPixCidade(payment.pix_cidade || '');
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

  const salvarEfi = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingEfi(true);
    try {
      const payment = await efiApi.updateConfig({ payee_code: payeeCode, pix_chave: pixChave, pix_cidade: pixCidade });
      setEfi(payment);
      setPayeeCode(payment.payee_code || '');
      toast('success', 'Configurações de pagamento salvas');
    } catch (err: any) {
      toast('error', err?.error || 'Erro ao salvar configuração Efí');
    } finally {
      setSavingEfi(false);
    }
  };

  return (
    <AnimatedPage>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-800">Configurações</h1>
          <p className="text-sm text-slate-500">Preferências do sistema e instalação do PDA</p>
          <AppVersion className="mt-1 text-xs text-slate-500" />
        </div>
      </div>

      <div className="mb-4 space-y-4">
        <PdaInstalacaoCard />
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
        {efi && <Card className="p-5">
          <h2 className="mb-3 text-sm font-bold text-slate-700">Pagamentos Efí</h2>
          <div className="space-y-2 text-sm text-slate-600">
            <p>O checkout de cartão de crédito é criado pela DoixP e confirmado pela API Efí. A loja recebe sua parte automaticamente e a parte da plataforma fica na conta Efí principal.</p>
            <p>A tarifa de processamento da Efí fica por conta da loja recebedora. A referência pública é 3,49% no crédito à vista; no parcelado, a tarifa varia conforme o número de parcelas e o prazo de recebimento. A tarifa da Efí é separada de qualquer taxa de serviço da DoixP.</p>
            <p>Para vendas presenciais, registre crédito ou débito como maquininha e conclua a cobrança no terminal da loja. O Tap to Pay foi removido desta etapa.</p>
            <p>O checkout só fica disponível quando a plataforma estiver configurada com credenciais Efí e taxa de serviço, e esta loja informar o código de recebedor.</p>
          </div>
          <form onSubmit={salvarEfi} className="mt-4 space-y-3">
            <Field label="Código de recebedor Efí (payee_code)" hint="Copie o identificador da conta Efí da loja. Não informe client secret, senha ou certificado.">
              <Input value={payeeCode} onChange={(e) => setPayeeCode(e.target.value)} placeholder="Identificador da conta Efí" autoComplete="off" />
            </Field>
            <Field label="Chave Pix da loja" hint="O Pix manual continua sendo recebido diretamente na conta do estabelecimento.">
              <Input value={pixChave} onChange={(e) => setPixChave(e.target.value)} placeholder="CPF, CNPJ, e-mail, telefone ou chave aleatória" autoComplete="off" />
            </Field>
            <Field label="Cidade do recebedor Pix">
              <Input value={pixCidade} onChange={(e) => setPixCidade(e.target.value)} placeholder="Ex.: São Paulo" maxLength={15} />
            </Field>
            <p className="text-xs font-semibold text-slate-600">API da plataforma: {efi.api_configurada ? 'configurada' : 'aguardando credenciais e taxa Efí'} · Checkout desta loja: {efi.checkout_ativo ? 'disponível' : 'inativo'}</p>
            <Button type="submit" loading={savingEfi} icon={<Save className="h-4 w-4" />}>Salvar dados Efí e Pix</Button>
          </form>
        </Card>}
      </div>}
    </AnimatedPage>
  );
}
