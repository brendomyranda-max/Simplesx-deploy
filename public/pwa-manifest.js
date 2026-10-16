(() => {
  const path = window.location.pathname;
  const marketplace = path === '/pedido' || path.startsWith('/pedido/');
  const gestor = path === '/gestor' || path.startsWith('/gestor/') || (path !== '/' && path !== '/investidores' && !marketplace);
  const tituloApple = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  const iconeApple = document.querySelector('link[rel="apple-touch-icon"]');

  if (marketplace) {
    tituloApple.content = 'Marketplace';
    iconeApple.href = '/icons/marketplace-192.png';
  } else if (gestor) {
    tituloApple.content = 'Gestor DoixP';
  }
})();
