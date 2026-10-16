/** Configuração do Pix direto ao estabelecimento, com confirmação manual. */
import { estabelecimentoId, getConfigValue, setConfig } from './util.js';

export async function getPixConfigHandler(c, env) {
  return c.json({
    pix_chave: await getConfigValue(env, 'pix_chave', ''),
    pix_cidade: await getConfigValue(env, 'pix_cidade', ''),
  });
}

export async function putPixConfigHandler(c, env) {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.pix_chave !== 'string' || typeof body.pix_cidade !== 'string') {
    return c.json({ error: 'Informe os campos de chave Pix e cidade.' }, 400);
  }
  const chave = body.pix_chave.trim();
  const cidade = body.pix_cidade.trim();
  if (chave.length > 200) return c.json({ error: 'Chave Pix inválida.' }, 400);
  if (cidade.length > 15) return c.json({ error: 'A cidade deve ter no máximo 15 caracteres.' }, 400);
  if ((chave || cidade) && (!chave || cidade.length < 2)) return c.json({ error: 'Informe a chave Pix e a cidade, ou deixe os dois campos vazios para desativar.' }, 400);
  await setConfig(env, 'pix_chave', chave);
  await setConfig(env, 'pix_cidade', cidade);
  await env.DB.prepare('UPDATE lojas_online SET pix_chave=?,pix_cidade=?,atualizado_em=? WHERE estabelecimento_id=?')
    .bind(chave || null, cidade || null, new Date().toISOString(), estabelecimentoId(env)).run();
  return getPixConfigHandler(c, env);
}
