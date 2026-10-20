import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { onlineApi } from '@/lib/api';
import type { OnlineStore } from '@/lib/types';
import { Button, Card, Field, Input, Select } from '@/components/ui';

const dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const formulario = (loja: OnlineStore) => ({
  aceitacao_automatica: loja.aceitacao_automatica === 1,
  horario_automatico: loja.horario_automatico === 1,
  horario_abertura: loja.horario_abertura || '18:00',
  horario_fechamento: loja.horario_fechamento || '23:00',
  horario_dias: loja.horario_dias || [0, 1, 2, 3, 4, 5, 6],
  horario_fuso: loja.horario_fuso || 'America/Sao_Paulo',
});

export function FuncionamentoDelivery({ loja, onSaved }: { loja: OnlineStore; onSaved: (loja: OnlineStore) => void }) {
  const [form, setForm] = useState(() => formulario(loja));
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState('');
  useEffect(() => { setForm(formulario(loja)); }, [loja]);
  const salvar = async (body: Partial<OnlineStore>) => {
    setSalvando(true); setErro(''); setMensagem('');
    try {
      onSaved(await onlineApi.updateStore(body));
      setMensagem('Funcionamento salvo.');
    } catch (error: any) { setErro(error?.error || 'Não foi possível salvar o funcionamento.'); }
    finally { setSalvando(false); }
  };
  return <Card className="space-y-4 p-5">
    <h2 className="font-bold text-slate-800">Funcionamento do delivery e cardápio</h2>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-slate-600">{!loja.ativo ? 'Loja pausada ou ainda não publicada.' : loja.aberta_agora === 0 ? 'Fora do horário de funcionamento.' : 'Loja aberta.'}</p>
      <Button type="button" variant="secondary" disabled={salvando} onClick={() => salvar({ ativo: loja.ativo ? 0 : 1 })}>{loja.ativo ? 'Pausar loja' : 'Ativar loja'}</Button>
    </div>
    <form onSubmit={(event) => {
      event.preventDefault();
      salvar({ ...form, aceitacao_automatica: form.aceitacao_automatica ? 1 : 0, horario_automatico: form.horario_automatico ? 1 : 0 });
    }}>
      <fieldset disabled={salvando} className="space-y-4 disabled:opacity-60">
        {loja.aceita_pedidos_online !== 0 && <div>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={form.aceitacao_automatica} onChange={(event) => setForm({ ...form, aceitacao_automatica: event.target.checked })} />Aceitar pedidos automaticamente</label>
          <p className="mt-1 text-xs text-slate-500">Os pedidos entram em preparo e são enviados à impressora configurada. Pedidos por Pix aguardam você confirmar o recebimento.</p>
          <Link to="/impressoras" className="mt-2 inline-block text-sm font-semibold text-brand-700 underline">Configurar impressora dos pedidos do delivery</Link>
        </div>}
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={form.horario_automatico} onChange={(event) => setForm({ ...form, horario_automatico: event.target.checked })} />Abrir e fechar por horário</label>
        {form.horario_automatico && <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Abrir às"><Input type="time" required aria-label="Abrir às" value={form.horario_abertura} onChange={(event) => setForm({ ...form, horario_abertura: event.target.value })} /></Field>
            <Field label="Fechar às"><Input type="time" required aria-label="Fechar às" value={form.horario_fechamento} onChange={(event) => setForm({ ...form, horario_fechamento: event.target.value })} /></Field>
          </div>
          <fieldset><legend className="mb-2 text-sm font-semibold text-slate-700">Dias de abertura</legend><div className="flex flex-wrap gap-3">{dias.map((dia, index) => <label key={dia} className="flex items-center gap-1 text-sm text-slate-700"><input type="checkbox" checked={form.horario_dias.includes(index)} onChange={(event) => setForm({ ...form, horario_dias: event.target.checked ? [...form.horario_dias, index] : form.horario_dias.filter((value) => value !== index) })} />{dia}</label>)}</div></fieldset>
          <Field label="Fuso horário"><Select aria-label="Fuso horário" value={form.horario_fuso} onChange={(event) => setForm({ ...form, horario_fuso: event.target.value })}>
            <option value="America/Sao_Paulo">Brasília</option><option value="America/Manaus">Manaus</option><option value="America/Rio_Branco">Rio Branco</option><option value="America/Noronha">Fernando de Noronha</option>
          </Select></Field>
          <p className="text-xs text-slate-500">Se o fechamento for de madrugada, vale o dia em que a loja abriu. Fora do horário, a loja sai da vitrine e o link mostra o cardápio com aviso de fechado.</p>
        </>}
        <p className="text-xs text-slate-500">A pausa manual permanece até você ativar a loja novamente, mesmo dentro do horário programado.</p>
        {erro && <p role="alert" className="text-sm text-red-600">{erro}</p>}
        {mensagem && <p role="status" className="text-sm text-emerald-700">{mensagem}</p>}
        <Button type="submit" loading={salvando}>Salvar funcionamento</Button>
      </fieldset>
    </form>
  </Card>;
}

export function ConfiguracaoFuncionamentoDelivery() {
  const [loja, setLoja] = useState<OnlineStore | null>(null);
  const [erro, setErro] = useState('');
  useEffect(() => { onlineApi.store().then(setLoja).catch((error) => setErro(error?.error || 'Não foi possível carregar o delivery.')); }, []);
  return loja ? <FuncionamentoDelivery loja={loja} onSaved={setLoja} /> : <p className="text-sm text-slate-500" role="status">{erro || 'Carregando funcionamento do delivery…'}</p>;
}
