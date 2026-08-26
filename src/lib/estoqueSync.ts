const ESTOQUE_EVENT = 'simplesx:estoque-atualizado';
const ESTOQUE_STORAGE_KEY = 'simplesx_estoque_atualizado_em';

export function avisarEstoqueAtualizado() {
  window.dispatchEvent(new Event(ESTOQUE_EVENT));
  try {
    localStorage.setItem(ESTOQUE_STORAGE_KEY, String(Date.now()));
  } catch {
    // O evento local ainda mantém a aba atual sincronizada.
  }
}

export function observarEstoqueAtualizado(callback: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === ESTOQUE_STORAGE_KEY) callback();
  };
  window.addEventListener(ESTOQUE_EVENT, callback);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(ESTOQUE_EVENT, callback);
    window.removeEventListener('storage', onStorage);
  };
}
