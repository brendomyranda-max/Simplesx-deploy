const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { profiles } = require('../src/catalog/printer-profiles.json')
const source = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8')
const context = { Buffer }
vm.createContext(context)
vm.runInContext(source.slice(source.indexOf('function quebrarPorLargura'), source.indexOf('async function imprimirRawAgora')), context)

test('catálogo único contém somente parâmetros executáveis e referências documentais', () => {
  assert.equal(new Set(profiles.map(p => p.id)).size, profiles.length)
  for (const p of profiles) {
    assert.ok(['DRIVER', 'ESC_POS', 'DIEBOLD', 'ESC_BEMA', 'STAR_LINE', 'TSPL', 'ZPL', 'CPCL', 'EPL'].includes(p.protocol), p.id)
    assert.ok(p.widthMm >= 20 && p.widthMm <= 320, p.id)
    assert.ok(p.columnsNormal === null || p.columnsNormal >= 8 && p.columnsNormal <= 160, p.id)
    assert.ok(p.dpi >= 100 && p.dpi <= 1200, p.id)
    assert.ok(['FULL', 'PARTIAL', 'FEED_FULL', 'FEED_PARTIAL', 'NONE'].includes(p.cutMode), p.id)
    assert.ok(p.notes.length > 20 && new URL(p.source).protocol === 'https:', p.id)
  }
  const gradle = fs.readFileSync(path.join(__dirname, '../../gestor-android/app/build.gradle.kts'), 'utf8')
  assert.ok(gradle.includes('assets.srcDir("../../gestor-impressora/src/catalog")'))
})

test('Star Line usa fonte, alinhamento e todos os cortes nativos', () => {
  for (const [cutMode, n] of Object.entries({ FULL: 0, PARTIAL: 1, FEED_FULL: 2, FEED_PARTIAL: 3 })) {
    const bytes = context.bytesStarLine('Ação\nABC', { cutMode, centralizar: true, tamanhoFonte: 'large' })
    assert.ok(bytes.includes(Buffer.from([27, 105, 1, 1])))
    assert.ok(bytes.includes(Buffer.from([27, 29, 97, 1])))
    assert.deepEqual([...bytes.subarray(-3)], [27, 100, n])
    assert.ok(!bytes.includes(Buffer.from([29, 86])))
    assert.ok(!context.bytesStarLine('ABC', { cutMode, cortar: false }).includes(Buffer.from([27, 100])))
  }
  assert.ok(context.bytesStarLine('Teste', { tamanhoFonte: 'small' }).includes(Buffer.from([27, 30, 70, 1])))
  assert.ok(!context.bytesStarLine('Teste', { cutMode: 'NONE' }).includes(Buffer.from([27, 100])))
})

test('ESC/Bema usa corte e fonte nativos, reaplicando altura por linha', () => {
  const large = context.bytesBema('Ação\nABC', { tamanhoFonte: 'large', cutMode: 'PARTIAL' })
  assert.ok(large.includes(Buffer.from([27, 87, 1])))
  assert.ok(large.toString('ascii').includes('\x1bVAcao\n\x1bVABC\n'))
  assert.deepEqual([...large.subarray(-2)], [27, 109])
  assert.deepEqual([...context.bytesBema('ABC', { cutMode: 'FULL' }).subarray(-2)], [27, 119])
  assert.ok(context.bytesBema('ABC', { tamanhoFonte: 'small' }).includes(Buffer.from([15])))
  assert.ok(!large.includes(Buffer.from([29, 33])))
  assert.ok(!large.includes(Buffer.from([29, 86])))
  assert.ok(!context.bytesBema('ABC', { cutMode: 'NONE' }).includes(Buffer.from([27, 119])))
})
