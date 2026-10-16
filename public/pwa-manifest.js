(() => {
  const path = window.location.pathname;
  const marketplace = path === '/pedido' || path.startsWith('/pedido/');
  const gestor = path === '/gestor' || path.startsWith('/gestor/') || (path !== '/' && path !== '/investidores' && !marketplace);
  const manifest = document.getElementById('pwa-manifest');
  const tituloApple = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  const iconeApple = document.querySelector('link[rel="apple-touch-icon"]');

  if (marketplace) {
    manifest.href = '/manifest-marketplace.webmanifest';
    tituloApple.content = 'Marketplace';
    iconeApple.href = '/brand/Logofood.png';
  } else if (gestor) {
    manifest.href = '/manifest-gestor.webmanifest';
    tituloApple.content = 'Gestor DoixP';
  }
})();
