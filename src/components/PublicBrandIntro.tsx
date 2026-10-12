/** Apresentação pública: a mesma marca é pré-renderizada e exibida junto ao login. */
import React from 'react';
import marca from '../content/marca.json';
import { BrandLogo } from './BrandLogo';
import { AppVersion } from './AppVersion';

export function PublicBrandIntro() {
  return (
    <section aria-labelledby="doixp-apresentacao" className="text-white">
      <a href="/" aria-label="DoixP — início" className="inline-flex items-center gap-3 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">
        <BrandLogo width={64} height={64} className="h-16 w-16 rounded-2xl" />
        <span className="text-2xl font-extrabold tracking-tight">{marca.nome}</span>
      </a>
      <AppVersion className="mt-3 text-xs font-semibold text-amber-200" />
      <h1 id="doixp-apresentacao" className="mt-6 max-w-xl text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
        {marca.chamada}
      </h1>
      <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-300">{marca.apresentacao}</p>
      <ul aria-label="Recursos do DoixP" className="mt-6 grid gap-x-5 gap-y-3 text-sm text-slate-200 sm:grid-cols-2">
        {marca.recursos.map((recurso) => <li key={recurso} className="flex items-center gap-2"><span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-white" />{recurso}</li>)}
      </ul>
      <nav aria-label="Conheça o DoixP" className="mt-7 flex flex-wrap gap-x-6 gap-y-3 text-sm font-semibold">
        <a href="/login" className="rounded text-white underline underline-offset-4 hover:text-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">Entrar no sistema</a>
        <a href="/investidores" className="rounded text-slate-300 underline underline-offset-4 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">Conheça o projeto DoixP</a>
      </nav>
    </section>
  );
}
