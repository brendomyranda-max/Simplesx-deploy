const DOWNLOADS: Record<string, string> = {
  'gestor-windows': 'https://github.com/brendomyranda-max/Simplesx-deploy/releases/download/gestor-v1.5.0/SimplesX-Gestor-win-x64.exe',
  'gestor-linux': 'https://github.com/brendomyranda-max/Simplesx-deploy/releases/download/gestor-v1.5.0/SimplesX-Gestor-linux-x86_64.AppImage',
  'gestor-android': 'https://github.com/brendomyranda-max/Simplesx-deploy/releases/latest/download/SimplesX-Gestor-android.apk',
};

export const onRequestGet: PagesFunction = async ({ params }) => {
  const sistema = String(params.sistema || '');
  const destino = DOWNLOADS[sistema];
  if (!destino) return new Response('Instalador não encontrado', { status: 404 });
  return Response.redirect(destino, 302);
};
