/**
 * Acréscimo de produto: um insumo entra como observação e cobra o próprio preço de venda.
 */

import { httpError, num } from './util.js';
import { arredondar } from './units.js';

export function precoDeVenda(valor) {
  const texto = typeof valor === 'string' ? valor.replace(',', '.') : valor;
  const numero = arredondar(texto);
  if (!Number.isFinite(numero) || numero <= 0 || numero > 10000) {
    throw httpError(400, 'Cadastre o preço de venda do insumo. Ele é o valor do acréscimo.');
  }
  return numero;
}

export async function normalizarAcrescimos(env, produtoId, lista) {
  if (lista == null) return [];
  if (!Array.isArray(lista) || lista.length > 30) throw httpError(400, 'Acréscimos inválidos');
  const vistos = new Set();
  const itens = [];
  for (const item of lista) {
    const insumoId = Number(item?.insumo_id);
    if (!Number.isInteger(insumoId) || insumoId <= 0) throw httpError(400, 'Escolha o insumo do acréscimo');
    if (produtoId && insumoId === Number(produtoId)) throw httpError(400, 'O acréscimo não pode ser o próprio produto');
    if (vistos.has(insumoId)) continue;
    vistos.add(insumoId);
    itens.push({ insumo_id: insumoId });
  }
  if (!itens.length) return [];
  const ph = itens.map(() => '?').join(',');
  const rows = await env.DB.prepare(`SELECT id, nome, tipo, ativo, preco FROM produtos WHERE id IN (${ph})`).bind(...itens.map((item) => item.insumo_id)).all();
  const mapa = new Map(rows.results.map((row) => [Number(row.id), row]));
  return itens.map((item) => {
    const insumo = mapa.get(item.insumo_id);
    if (!insumo || !num(insumo.ativo) || (insumo.tipo !== 'insumo' && insumo.tipo !== 'composto')) {
      throw httpError(400, 'Escolha um insumo cadastrado para o acréscimo');
    }
    return { insumo_id: item.insumo_id, valor: precoDeVenda(insumo.preco), nome: String(insumo.nome || '').trim() };
  });
}

export function idsAcrescimo(valor) {
  if (valor == null) return [];
  if (!Array.isArray(valor) || valor.length > 20) throw httpError(400, 'Acréscimos do lançamento inválidos');
  return valor.map((id) => {
    const numero = Number(id);
    if (!Number.isInteger(numero) || numero <= 0) throw httpError(400, 'Acréscimos do lançamento inválidos');
    return numero;
  });
}

export function selecionarAcrescimos(ids, cadastrados) {
  const mapa = new Map(cadastrados.map((item) => [Number(item.insumo_id), item]));
  return ids.map((id) => {
    const item = mapa.get(Number(id));
    if (!item) throw httpError(400, 'Acréscimo não cadastrado neste produto');
    return item;
  });
}

export function linhaAcrescimo(item) {
  return `Adicionar: ${item.insumo_nome || item.nome}`;
}

export function separarObservacao(texto, cadastrados) {
  const porLinha = new Map(cadastrados.map((item) => [linhaAcrescimo(item), item]));
  const ids = [];
  const livres = [];
  for (const bruto of String(texto || '').split('\n')) {
    const linha = bruto.trim();
    if (!linha) continue;
    const item = porLinha.get(linha);
    if (item) ids.push(Number(item.insumo_id));
    else livres.push(linha);
  }
  return { ids, livres };
}

export function observacaoComAcrescimos(texto, escolhidos) {
  const linhas = escolhidos.map(linhaAcrescimo);
  const bloqueados = new Set(linhas);
  const livres = String(texto || '').split('\n').map((linha) => linha.trim()).filter((linha) => linha && !bloqueados.has(linha));
  const observacao = [...linhas, ...livres].join('\n');
  if (observacao.length > 4000) throw httpError(400, 'Observação longa demais');
  return observacao;
}

export function precoComAcrescimos(base, escolhidos) {
  return arredondar(num(base) + escolhidos.reduce((soma, item) => soma + num(item.valor), 0));
}

export async function vincularInsumosOpcoes(env, options) {
  const ids = [...new Set(options.map((option) => option.insumo_id).filter(Boolean))];
  if (!ids.length) return options;
  const ph = ids.map(() => '?').join(',');
  const rows = await env.DB.prepare(`SELECT id, nome, tipo, ativo, preco FROM produtos WHERE id IN (${ph})`).bind(...ids).all();
  const mapa = new Map(rows.results.map((row) => [Number(row.id), row]));
  const vistos = new Set();
  for (const option of options) {
    if (!option.insumo_id) continue;
    if (option.tipo !== 'adicional') throw httpError(400, 'Somente acréscimo pode vincular um insumo');
    if (vistos.has(option.insumo_id)) throw httpError(400, 'Este insumo já está no acréscimo');
    vistos.add(option.insumo_id);
    const insumo = mapa.get(option.insumo_id);
    if (!insumo || !num(insumo.ativo) || (insumo.tipo !== 'insumo' && insumo.tipo !== 'composto')) {
      throw httpError(400, 'Escolha um insumo cadastrado para o acréscimo');
    }
    option.nome = String(insumo.nome || '').trim().slice(0, 100);
    option.preco_adicional = precoDeVenda(insumo.preco);
  }
  return options;
}
