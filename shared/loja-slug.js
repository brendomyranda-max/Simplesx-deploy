export function slugDoNome(nome) {
  const slug = String(nome || '').normalize('NFD').replace(/\p{M}+/gu, '')
    .toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60).replace(/-+$/g, '') || 'restaurante';
  return slug.length < 3 ? `${slug}-loja` : slug;
}

function candidatoSlug(base, tentativa) {
  const sufixo = tentativa === 1 ? '' : `-${tentativa}`;
  return base.slice(0, 60 - sufixo.length).replace(/-+$/g, '') + sufixo;
}

export async function escolherSlugLoja(db, nome, estabelecimento) {
  const base = slugDoNome(nome);
  for (let tentativa = 1; ; tentativa++) {
    const slug = candidatoSlug(base, tentativa);
    const conflito = await db.prepare(
      `SELECT estabelecimento_id FROM lojas_online WHERE slug=? AND estabelecimento_id!=?
       UNION ALL SELECT estabelecimento_id FROM lojas_online_links WHERE slug=? AND estabelecimento_id!=? LIMIT 1`
    ).bind(slug, estabelecimento, slug, estabelecimento).first();
    if (!conflito) return slug;
  }
}

export function reservarLinkLoja(db, slug, estabelecimento) {
  // Um endereço antigo só pode continuar associado ao seu estabelecimento.
  // A restrição NOT NULL faz o batch inteiro falhar em caso de disputa.
  return db.prepare(
    `INSERT INTO lojas_online_links (slug, estabelecimento_id, criado_em) VALUES (?,?,?)
     ON CONFLICT(slug) DO UPDATE SET slug=CASE WHEN lojas_online_links.estabelecimento_id=excluded.estabelecimento_id THEN excluded.slug ELSE NULL END`
  ).bind(slug, estabelecimento, new Date().toISOString());
}

export function planejarSlugsLojas(lojas, links) {
  const reservados = new Map([...lojas, ...links].map((loja) => [loja.slug.toLowerCase(), loja.estabelecimento_id]));
  const alteracoes = [];
  for (const loja of [...lojas].sort((a, b) => a.estabelecimento_id - b.estabelecimento_id)) {
    const base = slugDoNome(loja.nome);
    let tentativa = 1;
    let slug = base;
    while (reservados.has(slug) && reservados.get(slug) !== loja.estabelecimento_id) slug = candidatoSlug(base, ++tentativa);
    reservados.set(slug, loja.estabelecimento_id);
    if (slug !== loja.slug) alteracoes.push({ estabelecimento_id: loja.estabelecimento_id, anterior: loja.slug, slug });
  }
  return alteracoes;
}

export async function migrarSlugsLojas(db) {
  const lojas = await db.prepare('SELECT estabelecimento_id, nome, slug FROM lojas_online').all();
  const links = await db.prepare('SELECT estabelecimento_id, slug FROM lojas_online_links').all();
  const alteracoes = planejarSlugsLojas(lojas.results, links.results);
  for (const loja of alteracoes) {
    await db.batch([
      reservarLinkLoja(db, loja.anterior, loja.estabelecimento_id),
      reservarLinkLoja(db, loja.slug, loja.estabelecimento_id),
      db.prepare('UPDATE lojas_online SET slug=? WHERE estabelecimento_id=?').bind(loja.slug, loja.estabelecimento_id),
    ]);
  }
  return alteracoes;
}
