const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8')
const start = source.indexOf('function quebrarPorLargura')
const end = source.indexOf('async function imprimirRawAgora')
assert.ok(start >= 0 && end > start, 'geradores de protocolo não encontrados')
const context = { Buffer }
vm.createContext(context)
vm.runInContext(`${source.slice(start, end)}; this.bytesEscPos = bytesEscPos; this.bytesEtiqueta = bytesEtiqueta`, context)

test('ESC/POS inicializa, imprime, alimenta e corta', () => {
  const bytes = context.bytesEscPos('Ação 123', { alimentar: 2, cortar: true, larguraMm: 58 })
  assert.deepEqual([...bytes.subarray(0, 2)], [0x1b, 0x40])
  assert.match(bytes.toString('ascii'), /Acao 123/)
  assert.deepEqual([...bytes.subarray(-3)], [0x1d, 0x56, 0x00])
})

test('TSPL usa mídia contínua e cópias', () => {
  const command = context.bytesEtiqueta('TSPL', 'Etiqueta', { copias: 3, larguraMm: 58, dpi: 300 }).toString('ascii')
  assert.match(command, /^SIZE 58 mm,.*\r\nGAP 0 mm,0 mm\r\n/)
  assert.match(command, /TEXT 12,24,/)
  assert.match(command, /PRINT 3,1\r\n$/)
})

test('ZPL usa DPI na largura e finaliza o documento', () => {
  const command = context.bytesEtiqueta('ZPL', 'Zebra', { copias: 2, larguraMm: 58, dpi: 300 }).toString('ascii')
  assert.match(command, /\^PW685/)
  assert.match(command, /\^PQ2\n\^XZ\n$/)
})

test('CPCL usa o DPI configurado e finaliza o documento', () => {
  const command = context.bytesEtiqueta('CPCL', 'Portátil', { copias: 4, larguraMm: 58, dpi: 300 }).toString('ascii')
  assert.match(command, /^! 0 300 300 89 4\r\nPW 685\r\n/)
  assert.match(command, /FORM\r\nPRINT\r\n$/)
})

test('EPL usa largura, mídia contínua e cópias', () => {
  const command = context.bytesEtiqueta('EPL', 'Antiga', { copias: 5, larguraMm: 58, dpi: 300 }).toString('ascii')
  assert.match(command, /^N\nq685\nQ89,0\n/)
  assert.match(command, /P5\n$/)
})
