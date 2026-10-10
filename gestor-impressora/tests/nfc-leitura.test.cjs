const assert = require('node:assert/strict')
const test = require('node:test')
const { interpretarLeituraNfc } = require('../src/nfc-leitura.cjs')

test('aceita o número curto da mesa depois do prefixo', () => {
  const leitura = interpretarLeituraNfc({ nfcAtivo: true, nfcPrefixo: 'NFC:' }, 'NFC:7')
  assert.deepEqual(leitura, { uid: '7', payload: '7' })
})

test('remove o prefixo configurado e preserva o código', () => {
  const leitura = interpretarLeituraNfc({ nfcAtivo: true, nfcPrefixo: 'NFC:' }, 'NFC:7891000315507')
  assert.deepEqual(leitura, { uid: '7891000315507', payload: '7891000315507' })
})

test('recusa leitura com a ponte desligada ou sem o prefixo', () => {
  assert.throws(() => interpretarLeituraNfc({ nfcAtivo: false, nfcPrefixo: 'NFC:' }, 'NFC:1234'), /desligada/)
  assert.throws(() => interpretarLeituraNfc({ nfcAtivo: true, nfcPrefixo: 'NFC:' }, '12345678'), /prefixo/)
  assert.throws(() => interpretarLeituraNfc({ nfcAtivo: true, nfcPrefixo: '123' }, '12345678'), /Prefixo/)
})
