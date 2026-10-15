import { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { Button, Input, Select } from '@/components/ui';
import type { ComboGrupo, Produto } from '@/lib/types';
import { fmtBRL } from '@/lib/format';

export function ComboCadastro({ grupos, produtos, onChange }: { grupos: ComboGrupo[]; produtos: Produto[]; onChange: (grupos: ComboGrupo[]) => void }) {
  const alterar = (indice: number, grupo: ComboGrupo) => onChange(grupos.map((item, i) => i === indice ? grupo : item));
  return <div className="space-y-3 rounded-xl border border-brand-200 bg-brand-50/40 p-4">
    <div><h3 className="font-bold">Grupos de escolha do combo</h3><p className="text-xs text-slate-600">Defina quantos itens o cliente escolhe em cada grupo. O preço do combo é o preço base; cada opção pode ter acréscimo.</p></div>
    {grupos.map((grupo, indice) => <div key={indice} className="space-y-2 rounded-lg border bg-white p-3">
      <div className="flex gap-2"><Input aria-label="Nome do grupo" placeholder="Ex.: Esfihas, refrigerante ou lanche" value={grupo.nome} onChange={(e) => alterar(indice, { ...grupo, nome: e.target.value })} /><Input aria-label="Quantidade de escolhas" type="number" min={1} max={30} className="w-24" value={grupo.quantidade} onChange={(e) => alterar(indice, { ...grupo, quantidade: Number(e.target.value) })} /><Button type="button" variant="secondary" onClick={() => onChange(grupos.filter((_, i) => i !== indice))}>Remover</Button></div>
      <p className="text-xs text-slate-500">O cliente escolhe {grupo.quantidade || 0} item(ns), podendo repetir a mesma opção.</p>
      {grupo.opcoes.map((opcao, pos) => <div key={pos} className="flex gap-2">
        <Select aria-label="Produto disponível" value={opcao.produto_id || ''} onChange={(e) => alterar(indice, { ...grupo, opcoes: grupo.opcoes.map((o, i) => i === pos ? { ...o, produto_id: Number(e.target.value) } : o) })}>
          <option value="">Escolha produto cadastrado</option>{produtos.filter((p) => p.id === opcao.produto_id || !grupo.opcoes.some((o) => o.produto_id === p.id)).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </Select>
        <Input aria-label="Acréscimo em reais" type="number" min="0" step="0.01" className="w-28" placeholder="+ R$" value={opcao.adicional} onChange={(e) => alterar(indice, { ...grupo, opcoes: grupo.opcoes.map((o, i) => i === pos ? { ...o, adicional: Number(e.target.value) } : o) })} />
        <Button type="button" variant="secondary" onClick={() => alterar(indice, { ...grupo, opcoes: grupo.opcoes.filter((_, i) => i !== pos) })}>×</Button>
      </div>)}
      <Button type="button" variant="secondary" onClick={() => alterar(indice, { ...grupo, opcoes: [...grupo.opcoes, { produto_id: 0, adicional: 0 }] })}>Adicionar opção</Button>
    </div>)}
    <Button type="button" variant="secondary" onClick={() => onChange([...grupos, { nome: '', quantidade: 1, opcoes: [] }])}>Adicionar grupo</Button>
  </div>;
}

export function ComboEscolha({ grupos, escolhas, onChange }: { grupos: ComboGrupo[]; escolhas: number[][]; onChange: (escolhas: number[][]) => void }) {
  const [aberto, setAberto] = useState(0);
  const alterar = (indice: number, produtoId: number, delta: number) => {
    const atuais = escolhas[indice] || [];
    if (delta > 0 && atuais.length >= grupos[indice].quantidade) return;
    const pos = atuais.lastIndexOf(produtoId);
    if (delta < 0 && pos < 0) return;
    const proximos = delta > 0 ? [...atuais, produtoId] : atuais.filter((_, i) => i !== pos);
    onChange(grupos.map((_, i) => i === indice ? proximos : (escolhas[i] || [])));
    if (delta > 0 && proximos.length === grupos[indice].quantidade) {
      const pendentes = grupos.map((grupo, i) => (escolhas[i] || []).length < grupo.quantidade ? i : -1).filter((i) => i >= 0 && i !== indice);
      const seguinte = pendentes.find((i) => i > indice) ?? pendentes[0] ?? -1;
      setAberto(seguinte);
    }
  };
  return <div className="space-y-3">{grupos.map((grupo, indice) => {
    const selecionados = escolhas[indice] || [];
    const faltam = Math.max(0, grupo.quantidade - selecionados.length);
    return <section key={indice} className="rounded-lg border p-3">
      <button type="button" className="flex w-full items-center justify-between gap-2 text-left" aria-expanded={aberto === indice} onClick={() => setAberto(aberto === indice ? -1 : indice)}>
        <span className="text-sm font-bold">{grupo.nome} · {selecionados.length}/{grupo.quantidade}</span>
        <span className={`text-xs font-semibold ${faltam ? 'text-amber-700' : 'text-green-700'}`}>{faltam ? `Faltam ${faltam}` : 'Concluído · alterar'}</span>
      </button>
      {aberto === indice && <div className="mt-3 space-y-2">
        {grupo.opcoes.map((opcao) => {
          const quantidade = selecionados.filter((id) => id === opcao.produto_id).length;
          const nome = opcao.nome || `Produto ${opcao.produto_id}`;
          return <div key={opcao.produto_id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2 py-2">
            <button type="button" className="min-w-0 flex-1 text-left text-sm font-semibold" disabled={!faltam} onClick={() => alterar(indice, opcao.produto_id, 1)}>{nome}{opcao.adicional ? <span className="block text-xs font-normal text-slate-500">+ {fmtBRL(opcao.adicional)} por unidade</span> : null}</button>
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="secondary" aria-label={`Diminuir ${nome}`} disabled={!quantidade} onClick={() => alterar(indice, opcao.produto_id, -1)}><Minus className="h-3.5 w-3.5" /></Button>
              <span className="w-6 text-center text-sm font-bold" aria-label={`${quantidade} ${nome}`}>{quantidade}</span>
              <Button type="button" size="sm" variant="secondary" aria-label={`Adicionar ${nome}`} disabled={!faltam} onClick={() => alterar(indice, opcao.produto_id, 1)}><Plus className="h-3.5 w-3.5" /></Button>
            </div>
          </div>;
        })}
        <p className="text-xs text-slate-500">{faltam ? `Escolha mais ${faltam} para completar ${grupo.nome}.` : 'Limite atingido. Diminua uma opção para trocar.'}</p>
      </div>}
      {aberto !== indice && selecionados.length > 0 && <p className="mt-1 text-xs text-slate-500">{resumoEscolhasCombo(grupo, selecionados)}</p>}
    </section>;
  })}</div>;
}

export const comboCompleto = (grupos: ComboGrupo[], escolhas: number[][]) => grupos.length > 0 && grupos.every((g, i) => escolhas[i]?.length === g.quantidade && escolhas[i].every((id) => g.opcoes.some((o) => o.produto_id === id)));
export const adicionalCombo = (grupos: ComboGrupo[], escolhas: number[][]) => grupos.reduce((total, g, i) => total + (escolhas[i] || []).reduce((s, id) => s + (g.opcoes.find((o) => o.produto_id === id)?.adicional || 0), 0), 0);
export const resumoEscolhasCombo = (grupo: ComboGrupo, escolhas: number[]) => grupo.opcoes.map((opcao) => {
  const quantidade = escolhas.filter((id) => id === opcao.produto_id).length;
  return quantidade ? `${quantidade}x ${opcao.nome || `Produto ${opcao.produto_id}`}` : '';
}).filter(Boolean).join(', ');
