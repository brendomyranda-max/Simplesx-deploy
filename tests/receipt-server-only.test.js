import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText).toString('base64');

for (const success of [true, false]) {
  test(`recibo usa somente servidor quando o envio ${success ? 'funciona' : 'falha'}`, async () => {
    // Sem DOM ou window disponíveis: qualquer tentativa de imprimir localmente falha no teste.
    const source = readFileSync('src/lib/print.ts', 'utf8').replace("'./cupsPrint'", JSON.stringify(moduleUrl(`
      export async function enviarViaDeploy(el, width) {
        if (el.textContent !== 'Conta Ana' || width !== '58') throw new Error('Recibo incorreto');
        return ${success};
      }
    `)));
    const { printReceipt } = await import(moduleUrl(source));
    const pending = printReceipt({ textContent: 'Conta Ana' }, '58');
    if (success) await pending;
    else await assert.rejects(pending, /Não foi possível enviar a impressão ao servidor/);
  });
}

test('resultado distingue fila aceita, ausência de rota e falha parcial', async () => {
  const { confirmarImpressao } = await import(moduleUrl(readFileSync('src/lib/print-result.ts', 'utf8')));
  assert.match(confirmarImpressao([{ ok: true, impressora: 'Caixa' }]), /enviada à fila/);
  assert.throws(() => confirmarImpressao([]), /Configure uma rota/);
  assert.throws(() => confirmarImpressao([
    { ok: true, impressora: 'Caixa' }, { ok: false, impressora: 'Bar', error: 'Servidor inativo' },
  ]), /1 envio\(s\) confirmado\(s\).*Bar: Servidor inativo/);
});
