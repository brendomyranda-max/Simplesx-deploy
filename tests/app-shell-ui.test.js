import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import React, { Suspense } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import ts from 'typescript';

test('carregar uma tela preserva o menu e limita a espera ao conteúdo', async (t) => {
  const module = (source) => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  }).outputText).toString('base64');
  const mocks = {
    '@/components/ui': 'export const useToast=()=>()=>{};',
    '@/components/BrandLogo': 'export const BrandLogo=()=>null;',
    '@/components/AppVersion': 'export const AppVersion=()=>null;',
    '@/store/auth': 'export const useAuth=()=>({nome:"Teste",perfil:"admin",can:()=>true,canArea:()=>true,logout:async()=>{}});',
    '@/lib/areas': 'export const areaSelecionada=()=>"geral";',
  };
  let source = "import React from 'react';\n" + readFileSync('src/components/AppShell.tsx', 'utf8');
  for (const [name, mock] of Object.entries(mocks)) source = source.replaceAll(`'${name}'`, JSON.stringify(module(mock)));
  for (const name of ['react', 'react-router-dom', 'framer-motion', 'lucide-react']) {
    source = source.replaceAll(`'${name}'`, JSON.stringify(import.meta.resolve(name)));
  }
  const { AppShell } = await import(module(source));
  // O roteador usa layout effects no navegador; o teste renderiza o mesmo shell no servidor.
  const originalError = console.error;
  t.mock.method(console, 'error', (message, ...args) => {
    if (!String(message).includes('useLayoutEffect does nothing on the server')) originalError(message, ...args);
  });
  const pending = new Promise(() => {});
  function LoadingPage() { throw pending; }
  const html = renderToString(React.createElement(MemoryRouter, { initialEntries: ['/estoque'] },
    React.createElement(Suspense, { fallback: 'Carregando aplicação inteira' },
      React.createElement(AppShell, { empresaNome: 'Loja de teste' }, React.createElement(LoadingPage)))));
  assert.match(html, /aria-label="Abrir menu"/);
  assert.match(html, /Loja de teste/);
  assert.match(html, /role="status">Carregando…/);
  assert.doesNotMatch(html, /Carregando aplicação inteira/);
});
