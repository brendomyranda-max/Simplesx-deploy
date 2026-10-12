/**
 * Arquivo: [sistema].ts
 * Responsabilidade: Seleciona o instalador correspondente ao sistema solicitado.
 */

import { instaladorGestor } from '../../shared/gestor-releases.js';

export const onRequestGet: PagesFunction = async ({ params }) => {
  const sistema = String(params.sistema || '');
  const destino = instaladorGestor(sistema);
  if (!destino) return new Response('Instalador não encontrado', { status: 404 });
  return Response.redirect(destino, 302);
};
