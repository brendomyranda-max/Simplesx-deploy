const assert = require('node:assert/strict')
const test = require('node:test')
const { normalizeTypography, migrateTypography } = require('../src/typography.cjs')
const { rasterDocument } = require('../src/raster.cjs')
const { printWithTypography } = require('../src/print-typography.cjs')

const page = { width: 16, height: 2, heightMm: 2 / 203 * 25.4, data: Buffer.from([0x80, 0, 0x01, 0xff]).toString('base64') }

test('tipografia aceita tamanho fracionário, fonte e negrito e migra ajustes antigos', () => {
  assert.deepEqual(normalizeTypography({ sizePx: 15.5, family: 'Arial', bold: true, printableWidthMm: 48 }), { sizePx: 15.5, family: 'Arial', bold: true, printableWidthMm: 48 })
  assert.equal(migrateTypography('large').sizePx, 24)
  assert.equal(migrateTypography('small').sizePx, 9)
  for (const sizePx of [0, 5.9, 97, Infinity, NaN, 'abc']) assert.throws(() => normalizeTypography({ sizePx }))
  assert.throws(() => normalizeTypography({ family: 'fonte;invalida' }))
  assert.throws(() => normalizeTypography({ bold: 'true' }))
  assert.throws(() => normalizeTypography({ printableWidthMm: 1 }))
})

test('cupons raster preservam os pixels e usam comandos e cortes do protocolo escolhido', () => {
  for (const protocol of ['ESC_POS', 'ESC_BEMA', 'DIEBOLD']) {
    const output = rasterDocument(protocol, [page], { feed: 0, cut: false })
    const header = protocol === 'DIEBOLD' ? [27, 110, 0, 2, 2, 0] : [29, 118, 48, 0, 2, 0, 2, 0]
    assert.deepEqual(output, Buffer.from([...(protocol === 'DIEBOLD' ? [27, 77, 27, 93, 0] : [27, 64]), ...header, 0x80, 0, 1, 255, 10]))
  }
  assert.deepEqual([...rasterDocument('DIEBOLD', [page], { cutMode: 'FEED_PARTIAL' }).subarray(-2)], [27, 31])
  assert.deepEqual([...rasterDocument('ESC_BEMA', [page], { cutMode: 'PARTIAL' }).subarray(-2)], [27, 109])
  assert.deepEqual([...rasterDocument('ESC_POS', [page], { cutMode: 'PARTIAL' }).subarray(-3)], [29, 86, 1])
  const star = rasterDocument('STAR_LINE', [page], { feed: 0, cut: false })
  assert.deepEqual([...star.subarray(0, 10)], [27, 64, 27, 107, 2, 0, 0x80, 0, 1, 255])
  assert.equal(star.length, 2 + 4 + 48 + 1)
  assert.deepEqual([...star.subarray(10, -1)], Array(44).fill(0))
})

test('cupons longos são divididos em blocos sem perder linhas de pixels', () => {
  const data = Buffer.alloc(2 * 300, 0xaa)
  const output = rasterDocument('ESC_POS', [{ width: 16, height: 300, data: data.toString('base64') }], { feed: 0, cut: false })
  let offset = 2
  for (const rows of [128, 128, 44]) {
    assert.deepEqual([...output.subarray(offset, offset + 8)], [29, 118, 48, 0, 2, 0, rows, 0])
    offset += 8
    assert.deepEqual(output.subarray(offset, offset + rows * 2), data.subarray(0, rows * 2))
    offset += rows * 2
  }
  assert.equal(output.length, offset + 1)
})

test('etiquetas preservam formato binário, polaridade e cópias de cada linguagem', () => {
  const tspl = rasterDocument('TSPL', [page], { copies: 2, paperMode: 'GAP', gapMm: 3 })
  assert.ok(tspl.includes(Buffer.from('GAP 3 mm,0 mm')))
  assert.ok(tspl.includes(Buffer.from([0x7f, 0xff, 0xfe, 0])))
  assert.ok(tspl.toString('ascii').endsWith('PRINT 1,2\r\n'))
  const zpl = rasterDocument('ZPL', [page], { copies: 2 }).toString('ascii')
  assert.match(zpl, /\^GFA,4,4,2,800001FF\^FS/)
  assert.match(zpl, /\^PQ2/)
  const cpcl = rasterDocument('CPCL', [page], { copies: 3 })
  assert.ok(cpcl.includes(Buffer.from('CG 2 2 0 0 ')))
  assert.ok(cpcl.includes(Buffer.from([0x80, 0, 1, 255])))
  assert.ok(!cpcl.includes(Buffer.from('FORM')))
  const epl = rasterDocument('EPL', [page], { copies: 2 })
  assert.ok(epl.includes(Buffer.from('GW0,0,2,2,')))
  assert.ok(epl.toString('ascii').endsWith('P2\n'))
  assert.throws(() => rasterDocument('ESC_POS', [{ ...page, width: 15 }]), /Bitmap/)
})

test('driver imprime cada página e cópia com dimensões físicas e propaga falhas', async () => {
  const calls = [], scripts = []
  let destroyed = false, fail = false
  class BrowserWindow {
    loadURL = async () => {}
    webContents = {
      executeJavaScript: async (script) => { scripts.push(script); return script.includes('renderTypography') ? [{ ...page, png: 'data:image/png;base64,teste' }, { ...page, png: 'data:image/png;base64,teste' }] : undefined },
      print: (options, callback) => { calls.push(options); callback(!fail, fail ? 'Driver indisponível' : '') },
    }
    destroy() { destroyed = true }
  }
  const options = { BrowserWindow, printer: { name: 'Caixa' }, text: 'Pedido', typography: { sizePx: 15.5, family: 'Arial', bold: true }, widthMm: 58, dpi: 203, protocol: 'DRIVER', copies: 2 }
  await printWithTypography(options)
  assert.equal(calls.length, 4)
  assert.equal(calls[0].deviceName, 'Caixa')
  assert.equal(calls[0].pageSize.width, 58000)
  assert.equal(calls[0].margins.marginType, 'none')
  assert.equal(calls[0].scaleFactor, 100)
  assert.ok(scripts[0].includes('"sizePx":15.5'))
  assert.ok(destroyed)
  destroyed = false; fail = true
  await assert.rejects(printWithTypography(options), /Driver indisponível/)
  assert.ok(destroyed)
})
