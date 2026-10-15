import { httpError, num } from './util.js';

export function gruposDoCombo(produto) {
  if (produto?.tipo !== 'combo') return [];
  try {
    const grupos = JSON.parse(produto.combo_grupos_json || '[]');
    return Array.isArray(grupos) ? grupos : [];
  } catch { return []; }
}

export async function validarGruposCombo(env, grupos, proprioId = null) {
  if (!Array.isArray(grupos) || !grupos.length || grupos.length > 12) throw httpError(400, 'O combo precisa de 1 a 12 grupos de escolha');
  const usados = new Set();
  const normalizados = grupos.map((grupo) => {
    const nome = String(grupo?.nome || '').trim();
    const quantidade = Number(grupo?.quantidade);
    const opcoes = grupo?.opcoes;
    if (!nome || nome.length > 80 || !Number.isInteger(quantidade) || quantidade < 1 || quantidade > 30 || !Array.isArray(opcoes) || !opcoes.length || opcoes.length > 40) {
      throw httpError(400, 'Grupo do combo inválido: informe nome, quantidade e produtos disponíveis');
    }
    const ids = new Set();
    return { nome, quantidade, opcoes: opcoes.map((opcao) => {
      const produto_id = Number(opcao?.produto_id);
      const adicional = Number(opcao?.adicional || 0);
      if (!Number.isInteger(produto_id) || produto_id <= 0 || produto_id === Number(proprioId) || ids.has(produto_id) || !Number.isFinite(adicional) || adicional < 0 || adicional > 10000) {
        throw httpError(400, `Opção inválida no grupo ${nome}`);
      }
      ids.add(produto_id); usados.add(produto_id);
      return { produto_id, adicional: Math.round(adicional * 100) / 100 };
    }) };
  });
  if (normalizados.reduce((s, grupo) => s + grupo.quantidade, 0) > 60) throw httpError(400, 'O combo pode ter até 60 escolhas no total');
  const produtos = (await env.DB.prepare('SELECT id, tipo, ativo FROM produtos WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify([...usados])).all()).results;
  if (produtos.length !== usados.size || produtos.some((p) => !num(p.ativo) || !['produto', 'composto'].includes(p.tipo))) {
    throw httpError(400, 'Escolha somente produtos simples ou compostos ativos deste estabelecimento');
  }
  return normalizados;
}

export async function montarCombo(env, produto, escolhas) {
  const grupos = gruposDoCombo(produto);
  if (!grupos.length || !Array.isArray(escolhas) || escolhas.length !== grupos.length) throw httpError(400, 'Escolhas do combo incompletas');
  const ids = [];
  let adicional = 0;
  for (let i = 0; i < grupos.length; i++) {
    const grupo = grupos[i];
    const selecionados = escolhas[i];
    if (!Array.isArray(selecionados) || selecionados.length !== grupo.quantidade) throw httpError(400, `Escolha ${grupo.quantidade} item(ns) em ${grupo.nome}`);
    for (const raw of selecionados) {
      const id = Number(raw);
      const opcao = grupo.opcoes.find((o) => o.produto_id === id);
      if (!opcao) throw httpError(400, `Produto não permitido em ${grupo.nome}`);
      ids.push(id);
      adicional += opcao.adicional;
    }
  }
  const unicos = [...new Set(ids)];
  const produtos = (await env.DB.prepare('SELECT id,nome,tipo,ativo FROM produtos WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(unicos)).all()).results;
  if (produtos.length !== unicos.length || produtos.some((p) => !num(p.ativo) || !['produto', 'composto'].includes(p.tipo))) throw httpError(409, 'Um produto do combo não está mais disponível');
  const nomes = new Map(produtos.map((p) => [num(p.id), p.nome]));
  const descreverGrupo = (selecionados, grupo) => grupo.opcoes.map((opcao) => {
    const quantidade = selecionados.filter((id) => Number(id) === opcao.produto_id).length;
    return quantidade ? `${quantidade}x ${nomes.get(opcao.produto_id)}` : '';
  }).filter(Boolean).join(', ');
  return {
    escolhas: escolhas.map((grupo) => grupo.map(Number)),
    adicional: Math.round(adicional * 100) / 100,
    descricao: escolhas.map((selecionados, index) => `${grupos[index].nome}: ${descreverGrupo(selecionados, grupos[index])}`).join(' · '),
    componentes: ids,
  };
}
