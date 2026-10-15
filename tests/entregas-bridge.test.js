import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { chamarEntregas } from '../shared/entregas-bridge.js';

test('DoixP Delivery assina a chamada para o servidor de motoboys sem expor segredo ao cliente', async () => {
  const secret = 'segredo-de-integracao-para-testes-com-mais-de-32-caracteres';
  const env = {
    ENTREGAS_API_URL: 'https://entregas.example.test',
    ENTREGAS_INTEGRATION_SECRET: secret,
    entregasFetch: async (url, init) => {
      assert.equal(url, 'https://entregas.example.test/api/integration/stores/42/orders');
      assert.equal(init.method, 'GET');
      assert.equal(init.body, undefined);
      const timestamp = init.headers['x-doixp-timestamp'];
      const expected = createHmac('sha256', secret).update(`${timestamp}.`).digest('hex');
      assert.equal(init.headers['x-doixp-signature'], expected);
      return Response.json([{ id: 'abc', status: 'searching' }]);
    },
  };
  assert.deepEqual(await chamarEntregas(env, '/api/integration/stores/42/orders'), [{ id: 'abc', status: 'searching' }]);
  await assert.rejects(chamarEntregas({ ...env, ENTREGAS_API_URL: 'http://localhost:3100' }, '/api/integration/stores/42/orders'), { status: 503 });
});
