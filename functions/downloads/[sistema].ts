/**
 * Arquivo: [sistema].ts
 * Responsabilidade: Seleciona o instalador correspondente ao sistema solicitado.
 */

const DOWNLOADS: Record<string, string> = {
  'gestor-windows': 'https://github.com/brendomyranda-max/Simplesx-deploy/releases/download/gestor-v1.5.10/simplexsa-gestor-win-x64.exe',
  'gestor-linux': 'https://github.com/brendomyranda-max/Simplesx-deploy/releases/download/gestor-v1.5.10/simplexsa-gestor-linux-x86_64.AppImage',
  'gestor-android': 'https://github.com/brendomyranda-max/Simplesx-deploy/releases/download/gestor-v1.5.10/simplexsa-gestor-android.apk',
};

export const onRequestGet: PagesFunction = async ({ params }) => {
  const sistema = String(params.sistema || '');
  const destino = DOWNLOADS[sistema];
  if (!destino) return new Response('Instalador não encontrado', { status: 404 });
  return Response.redirect(destino, 302);
};
