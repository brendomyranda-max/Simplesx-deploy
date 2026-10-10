/**
 * Cadastro do acréscimo: o insumo entra como observação e cobra o próprio preço de venda.
 */

import { Plus, Trash2 } from 'lucide-react';
import { Button, Field, Select } from '@/components/ui';
import { fmtBRL } from '@/lib/format';

export interface LinhaAcrescimo {
  insumo_id: number | '';
  valor: string;
  nome?: string;
  preco?: number | null;
}

export function lerAcrescimos(linhas: LinhaAcrescimo[], insumos: { id: number; nome: string; preco?: number | null }[]) {
  const usados = new Set<number>();
  const itens: { insumo_id: number; nome: string; valor: number }[] = [];
  for (const linha of linhas) {
    if (linha.insumo_id === '') continue;
    const insumo = insumos.find((item) => item.id === Number(linha.insumo_id));
    const nome = insumo?.nome || linha.nome || '';
    const valor = Number(insumo?.preco ?? linha.preco);
    if (!nome || !Number.isFinite(valor) || valor <= 0 || valor > 10000) {
      return { erro: 'Cadastre o preço de venda do insumo. Ele é o valor do acréscimo.', itens: [] };
    }
    if (usados.has(Number(linha.insumo_id))) return { erro: 'Este insumo já está no acréscimo', itens: [] };
    usados.add(Number(linha.insumo_id));
    itens.push({ insumo_id: Number(linha.insumo_id), nome, valor });
  }
  return { erro: '', itens };
}

export function AcrescimoCadastro({
  linhas,
  onChange,
  insumos,
}: {
  linhas: LinhaAcrescimo[];
  onChange: (linhas: LinhaAcrescimo[]) => void;
  insumos: { id: number; nome: string; preco?: number | null }[];
}) {
  const alterar = (indice: number, patch: Partial<LinhaAcrescimo>) => {
    onChange(linhas.map((linha, i) => (i === indice ? { ...linha, ...patch } : linha)));
  };
  return (
    <Field label="Acréscimo de produto" hint="Escolha o insumo. No lançamento o garçom acrescenta como observação e o preço de venda do insumo soma no lanche.">
      <div className="space-y-2">
        {linhas.map((linha, indice) => {
          const insumo = insumos.find((item) => item.id === linha.insumo_id);
          const preco = Number(insumo?.preco ?? linha.preco);
          return (
          <div key={indice} className="flex flex-wrap items-center gap-2">
            <Select
              value={String(linha.insumo_id)}
              onChange={(event) => {
                const id = event.target.value ? Number(event.target.value) : '';
                const escolhido = insumos.find((item) => item.id === id);
                alterar(indice, {
                  insumo_id: id,
                  nome: escolhido?.nome || linha.nome,
                  preco: escolhido?.preco ?? null,
                  valor: escolhido?.preco != null ? String(escolhido.preco) : '',
                });
              }}
              className="min-w-[180px] flex-1"
            >
              <option value="">Selecione o insumo...</option>
              {linha.insumo_id !== '' && !insumos.some((item) => item.id === linha.insumo_id) && (
                <option value={linha.insumo_id}>{linha.nome || `Insumo ${linha.insumo_id}`}</option>
              )}
              {insumos.filter((item) => item.preco != null && Number(item.preco) > 0).map((item) => (
                <option key={item.id} value={item.id}>{item.nome} · {fmtBRL(item.preco)}</option>
              ))}
            </Select>
            <span className="w-28 text-sm font-bold text-slate-700">{Number.isFinite(preco) && preco > 0 ? fmtBRL(preco) : 'Sem preço de venda'}</span>
            <button
              type="button"
              onClick={() => onChange(linhas.filter((_, i) => i !== indice))}
              className="rounded-lg p-1.5 text-red-500 hover:bg-red-50"
              aria-label="Remover acréscimo"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          );
        })}
        {linhas.length === 0 && <p className="text-xs text-slate-400">Nenhum acréscimo cadastrado</p>}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          icon={<Plus className="h-4 w-4" />}
          onClick={() => onChange([...linhas, { insumo_id: '', valor: '' }])}
        >
          Adicionar acréscimo
        </Button>
      </div>
    </Field>
  );
}
