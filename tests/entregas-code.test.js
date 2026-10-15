import test from 'node:test';
import assert from 'node:assert/strict';
import { cifrarCodigoEntrega, decifrarCodigoEntrega } from '../shared/entregas-code.js';

test('código da entrega preserva zero inicial, vincula-se ao pedido e não fica legível no banco', async () => {
  const secret = 'segredo-teste-para-integracao-doixp-entregas-123456';
  const encrypted = await cifrarCodigoEntrega('0042', 'LOJA-7-PED-9', secret);
  assert.equal(encrypted.includes('0042'), false);
  assert.equal(await decifrarCodigoEntrega(encrypted, 'LOJA-7-PED-9', secret), '0042');
  await assert.rejects(decifrarCodigoEntrega(encrypted, 'LOJA-7-PED-10', secret), { status: 409 });
  await assert.rejects(decifrarCodigoEntrega(encrypted, 'LOJA-7-PED-9', `${secret}-wrong`), { status: 409 });
});
