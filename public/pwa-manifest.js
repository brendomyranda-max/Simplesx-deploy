(() => {
  const path = window.location.pathname;
  const marketplace = path === '/pedido' || path.startsWith('/pedido/');
  const gestor = path === '/gestor' || path.startsWith('/gestor/') || (path !== '/' && path !== '/investidores' && !marketplace);
  const app = marketplace ? 'marketplace' : gestor ? 'gestor' : 'portal';
  // Capture antes do bundle React: o navegador pode liberar a instalação enquanto ele carrega.
  const estado = window.doixpPwa = { app, promptEvent: null, installed: false };
  const avisar = () => window.dispatchEvent(new Event('doixp:pwa-change'));
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    estado.promptEvent = event;
    avisar();
  });
  window.addEventListener('appinstalled', () => {
    estado.promptEvent = null;
    estado.installed = true;
    avisar();
  });

  // Em produção o middleware já entrega este manifesto. Também funciona no servidor local.
  const manifesto = document.querySelector('link[rel="manifest"]');
  const destino = app === 'portal' ? '/manifest.webmanifest' : `/manifest-${app}.webmanifest`;
  if (manifesto && manifesto.getAttribute('href') !== destino) manifesto.setAttribute('href', destino);
  const tituloApple = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  const iconeApple = document.querySelector('link[rel="apple-touch-icon"]');

  if (marketplace) {
    if (tituloApple) tituloApple.content = 'Marketplace';
    if (iconeApple) iconeApple.href = '/icons/marketplace-192.png';
  } else if (gestor) {
    if (tituloApple) tituloApple.content = 'Gestor DoixP';
  }
})();
