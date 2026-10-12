export function nfcScanLink(origin: string, id: string, token: string) {
  const base = new URL(origin);
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash
    || !/^[a-f0-9-]{36}$/.test(id) || !/^[A-F0-9]{64}$/.test(token)) throw new Error('Solicitação NFC inválida');
  const query = new URLSearchParams({ servidor: base.origin, id, token });
  return `intent://nfc/ler?${query}#Intent;scheme=doixp;package=br.com.simplesx.gestor;end`;
}
