/* Ponte restrita à origem configurada no aplicativo Android. */
(() => {
  'use strict';
  const pending = new Map();
  let sequence = 0;
  let attached = null;
  const available = () => typeof window.DoixPNative?.postMessage === 'function';
  function attach() {
    const bridge = window.DoixPNative;
    if (attached === bridge) return;
    bridge.onmessage = event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      const entry = pending.get(String(message.id));
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(String(message.id));
      if (message.ok) entry.resolve(message.result || {});
      else entry.reject(new Error(message.error || 'Não foi possível concluir a ação no Android.'));
    };
    attached = bridge;
  }
  function request(command, args = {}) {
    if (!available()) return Promise.reject(new Error('Este recurso requer o aplicativo Android.'));
    attach();
    const id = String(++sequence);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('A ação demorou demais. Verifique as permissões e tente novamente.'));
      }, command === 'prepareTracking' ? 120000 : 15000);
      pending.set(id, { resolve, reject, timer });
      try { window.DoixPNative.postMessage(JSON.stringify({ id, command, args })); }
      catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
    });
  }
  window.DoixPAndroid = Object.freeze({ available, request });
})();
