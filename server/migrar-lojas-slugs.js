import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { planejarSlugsLojas } from '../shared/loja-slug.js';

if (!process.argv.includes('--remote')) throw new Error('Informe --remote para atualizar os endereços das lojas no D1.');

function wrangler(args) {
  const result = spawnSync('npx', ['--no-install', 'wrangler', 'd1', 'execute', 'simplesx-db', '--remote', ...args, '--json'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'Falha ao acessar o D1');
  // Com --file, o Wrangler imprime o progresso do upload antes do JSON.
  const inicioJson = result.stdout.indexOf('[');
  if (inicioJson < 0) throw new Error(result.stdout || 'Resposta inválida do D1');
  const dados = JSON.parse(result.stdout.slice(inicioJson));
  if (dados.some((item) => item.success === false)) throw new Error('Falha ao atualizar os endereços no D1');
  return dados;
}

const dados = wrangler(['--command', 'SELECT estabelecimento_id,nome,slug FROM lojas_online; SELECT estabelecimento_id,slug FROM lojas_online_links;']);
const alteracoes = planejarSlugsLojas(dados[0].results, dados[1].results);
if (!alteracoes.length) {
  console.log('Endereços das lojas já usam seus nomes.');
} else {
  for (const loja of alteracoes) console.log(`/pedido/${loja.anterior} → /pedido/${loja.slug}`);
  if (!process.argv.includes('--dry-run')) {
    const dir = mkdtempSync(path.join(tmpdir(), 'doixp-slugs-'));
    try {
      const sql = (value) => `'${String(value).replaceAll("'", "''")}'`;
      const comandos = alteracoes.flatMap((loja) => [
        ...[loja.anterior, loja.slug].map((slug) => `INSERT INTO lojas_online_links (slug,estabelecimento_id) VALUES (${sql(slug)},${Number(loja.estabelecimento_id)}) ON CONFLICT(slug) DO UPDATE SET slug=CASE WHEN lojas_online_links.estabelecimento_id=excluded.estabelecimento_id THEN excluded.slug ELSE NULL END;`),
        `UPDATE lojas_online SET slug=${sql(loja.slug)} WHERE estabelecimento_id=${Number(loja.estabelecimento_id)};`,
      ]);
      const file = path.join(dir, 'slugs.sql');
      writeFileSync(file, comandos.join('\n'));
      wrangler(['--file', file]);
      console.log(`${alteracoes.length} endereço(s) atualizado(s). Links anteriores preservados.`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
