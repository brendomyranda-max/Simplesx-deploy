/**
 * Arquivo: main.tsx
 * Responsabilidade: Inicializa o React, o roteador e os provedores globais da interface.
 */

import '@/lib/pda-instalacao';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ToastProvider } from '@/components/ui';
import './index.css';

const desenvolvimentoLocal = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') && location.port === '5173';
if ('serviceWorker' in navigator && !desenvolvimentoLocal) {
  navigator.serviceWorker.register('/sw.js').catch(() => undefined);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>
);
