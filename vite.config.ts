import { defineConfig, type HtmlTagDescriptor, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PublicBrandIntro } from './src/components/PublicBrandIntro';
import marca from './src/content/marca.json';

// O conteúdo público já chega no HTML, sem depender do JavaScript ou da API.
// Reutilizar o componente evita uma apresentação diferente para os buscadores.
function apresentacaoPublica(): Plugin {
  return {
    name: 'doixp-apresentacao-publica',
    transformIndexHtml(html) {
      const apresentacao = renderToStaticMarkup(React.createElement(PublicBrandIntro));
      const dadosEstruturados = {
        '@context': 'https://schema.org',
        '@graph': [
          { '@type': 'WebSite', '@id': `${marca.url}#website`, name: marca.nome, url: marca.url, inLanguage: 'pt-BR' },
          { '@type': 'Organization', '@id': `${marca.url}#organization`, name: marca.nome, url: marca.url, logo: `${marca.url}brand/doixp-logo.png` },
        ],
      };
      const meta = (name: string, content: string): HtmlTagDescriptor => ({ tag: 'meta', attrs: { name, content } });
      const og = (property: string, content: string): HtmlTagDescriptor => ({ tag: 'meta', attrs: { property, content } });
      const tags: HtmlTagDescriptor[] = [
        { tag: 'title', children: marca.titulo },
        meta('description', marca.descricao),
        meta('application-name', marca.nome),
        meta('robots', 'index, follow, max-image-preview:large'),
        { tag: 'link', attrs: { rel: 'canonical', href: marca.url } },
        og('og:type', 'website'), og('og:locale', 'pt_BR'), og('og:site_name', marca.nome),
        og('og:title', marca.titulo), og('og:description', marca.descricao), og('og:url', marca.url),
        og('og:image', `${marca.url}brand/doixp-logo.png`), og('og:image:alt', 'Logotipo DoixP'),
        meta('twitter:card', 'summary'), meta('twitter:title', marca.titulo), meta('twitter:description', marca.descricao),
        meta('twitter:image', `${marca.url}brand/doixp-logo.png`),
        { tag: 'script', attrs: { type: 'application/ld+json', id: 'doixp-dados-estruturados' }, children: JSON.stringify(dadosEstruturados).replace(/</g, '\\u003c') },
      ];
      return {
        html: html.replace('<!-- doixp:apresentacao-publica -->', `<main class="min-h-screen bg-slate-950 p-6 sm:p-10"><div class="mx-auto max-w-4xl">${apresentacao}</div></main>`),
        // Não empurrar a declaração de charset para depois dos primeiros 1024 bytes.
        tags: tags.map((tag) => ({ ...tag, injectTo: 'head' as const })),
      };
    },
  };
}

export default defineConfig({
  plugins: [react(), apresentacaoPublica()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
});
