import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadConfigFromFile } from 'vite';

const marca = JSON.parse(readFileSync('src/content/marca.json', 'utf8'));
const config = await loadConfigFromFile({ command: 'build', mode: 'production' });
const plugin = config.config.plugins.find((p) => p.name === 'doixp-apresentacao-publica');
const template = readFileSync('index.html', 'utf8');
const resultado = plugin.transformIndexHtml(template);

test('HTML inicial apresenta a marca sem JavaScript ou API, com o mesmo componente do login', () => {
  assert.match(resultado.html, /<h1\b/);
  assert.ok(resultado.html.includes(marca.chamada));
  assert.ok(resultado.html.includes(marca.apresentacao));
  for (const recurso of marca.recursos) assert.ok(resultado.html.includes(recurso));
  assert.match(resultado.html, /href="\/login"/);
  assert.match(resultado.html, /href="\/investidores"/);
  assert.doesNotMatch(resultado.html, /doixp:apresentacao-publica/);
  assert.match(readFileSync('src/pages/Login.tsx', 'utf8'), /<PublicBrandIntro\s*\/>/);
  assert.match(readFileSync('src/App.tsx', 'utf8'), /if \(iniciando\).*<PublicBrandIntro\s*\/>/);
});

test('metadados identificam DoixP, o domínio oficial e a marca sem avaliações inventadas', () => {
  const tags = resultado.tags;
  assert.equal(tags.filter((t) => t.tag === 'title').length, 1);
  assert.equal(tags.find((t) => t.tag === 'title').children, marca.titulo);
  assert.ok(tags.every((tag) => tag.injectTo === 'head'));
  assert.equal(tags.find((t) => t.attrs?.name === 'description').attrs.content, marca.descricao);
  assert.equal(tags.filter((t) => t.attrs?.rel === 'canonical').length, 1);
  assert.equal(tags.find((t) => t.attrs?.rel === 'canonical').attrs.href, marca.url);
  assert.doesNotMatch(tags.find((t) => t.attrs?.name === 'robots').attrs.content, /noindex/);
  assert.equal(tags.find((t) => t.attrs?.property === 'og:site_name').attrs.content, 'DoixP');
  const jsonLd = JSON.parse(tags.find((t) => t.attrs?.type === 'application/ld+json').children);
  const website = jsonLd['@graph'].find((item) => item['@type'] === 'WebSite');
  assert.equal(website.name, 'DoixP');
  assert.equal(website.url, marca.url);
  assert.doesNotMatch(JSON.stringify(jsonLd), /aggregateRating|review|offers|sameAs/);
});

test('sitemap contém somente a página pública oficial e robots permite renderizar os recursos', () => {
  const sitemap = readFileSync('public/sitemap.xml', 'utf8');
  const urls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
  assert.deepEqual(urls, [marca.url]);
  assert.match(sitemap, /xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9"/);
  const robots = readFileSync('public/robots.txt', 'utf8');
  assert.match(robots, /Sitemap: https:\/\/doixp.com\/sitemap.xml/);
  assert.doesNotMatch(robots, /^Disallow:\s*\/$/m);
  assert.doesNotMatch(robots, /Disallow:\s*\/(assets|brand|icons|dashboard)/);
});

test('telas privadas, acompanhamento e cópias do deploy não são resultados de pesquisa', () => {
  const headers = readFileSync('public/_headers', 'utf8');
  const regras = headers.split(/\n\s*\n/).map((r) => r.split('\n').filter((l) => l && !l.startsWith('#')));
  const noindex = regras.filter((r) => r.slice(1).some((l) => /X-Robots-Tag:.*noindex/.test(l))).map((r) => r[0]);
  const app = readFileSync('src/App.tsx', 'utf8');
  const paths = [...app.matchAll(/path="([^"]+)"/g)].map((m) => m[1]);
  for (const path of paths.filter((p) => !['/', '*', '/investidores'].includes(p) && !p.startsWith('/pedido'))) {
    assert.ok(noindex.some((pattern) => pattern.endsWith('*') && path.startsWith(pattern.slice(0, -1))), path);
  }
  assert.ok(noindex.includes('/login*'));
  assert.ok(noindex.includes('/pedido/:slug/acompanhar/*'));
  assert.ok(noindex.includes('https://simplesx-projeto-beta.pages.dev/*'));
  assert.ok(noindex.includes('https://:version.simplesx-projeto-beta.pages.dev/*'));
  assert.ok(!noindex.includes('/') && !noindex.includes('/*'));
  assert.doesNotMatch(headers, /unsafe-eval/);
});
