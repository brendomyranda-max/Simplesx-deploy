const ULTIMO_PEDIDO_KEY = 'doixp:ultimo-pedido';
const ROTA_ACOMPANHAMENTO = /^\/pedido\/[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])?\/acompanhar\/[a-zA-Z0-9_-]{16,100}$/;

export const SUPORTE_DOIXP_URL = 'https://wa.me/5511939417895';

export function whatsappDaLoja(numero?: string | null, pedidoId?: number) {
  const digits = String(numero || '').replace(/\D/g, '');
  const nacional = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
  if (!/^[1-9]\d{9,10}$/.test(nacional)) return null;
  const texto = pedidoId ? `Olá, preciso de ajuda com o pedido #${pedidoId}.` : 'Olá, preciso de ajuda com um pedido.';
  return `https://wa.me/55${nacional}?text=${encodeURIComponent(texto)}`;
}

export function gravarUltimoPedido(caminho: string) {
  if (!ROTA_ACOMPANHAMENTO.test(caminho)) return;
  try { window.localStorage.setItem(ULTIMO_PEDIDO_KEY, caminho); } catch { /* Armazenamento indisponível. O link ainda funciona. */ }
}

export function lerUltimoPedido() {
  try {
    const caminho = window.localStorage.getItem(ULTIMO_PEDIDO_KEY) || '';
    return ROTA_ACOMPANHAMENTO.test(caminho) ? caminho : null;
  } catch { return null; }
}

export function limparUltimoPedido() {
  try { window.localStorage.removeItem(ULTIMO_PEDIDO_KEY); } catch { /* Armazenamento indisponível. */ }
}
