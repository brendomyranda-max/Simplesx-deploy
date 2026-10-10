/** Descrição inicial do produto composto no delivery: os ingredientes da ficha, e o que o estabelecimento quiser acrescentar. */
export function descricaoComIngredientes(nomes: string[], extra = '') {
  const unicos: string[] = [];
  const vistos = new Set<string>();
  for (const bruto of nomes) {
    const nome = String(bruto || '').trim().replace(/\s+/g, ' ');
    if (!nome) continue;
    const chave = nome.toLocaleLowerCase('pt-BR');
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    unicos.push(nome);
  }
  const resto = extra.trim();
  if (!unicos.length) return resto;
  const lista = unicos.length === 1
    ? unicos[0]
    : unicos.length === 2
      ? `${unicos[0]} e ${unicos[1]}`
      : `${unicos.slice(0, -1).join(', ')} e ${unicos[unicos.length - 1]}`;
  if (!resto) return lista;
  const base = resto.toLocaleLowerCase('pt-BR');
  if (unicos.every((nome) => base.includes(nome.toLocaleLowerCase('pt-BR')))) return resto;
  return `${lista}. ${resto}`;
}
