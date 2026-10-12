import { arquivoAtualizacaoGestor } from '../../shared/gestor-releases.js';

export const onRequestGet: PagesFunction = async ({ params }) => {
  const partes = params.arquivo;
  const arquivo = Array.isArray(partes) ? partes.join('/') : String(partes || '');
  const destino = arquivoAtualizacaoGestor(arquivo);
  if (!destino) return new Response('Atualização não encontrada', { status: 404 });
  // O cliente deve consultar a versão publicada novamente a cada busca.
  return new Response(null, { status: 302, headers: { Location: destino, 'Cache-Control': 'no-store' } });
};
