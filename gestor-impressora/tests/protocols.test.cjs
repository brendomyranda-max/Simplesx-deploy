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
vm.runInContext(`${source.slice(start, end)}; this.bytesEscPos = bytesEscPos; this.bytesEtiqueta = bytesEtiqueta; this.layoutEtiqueta = layoutEtiqueta; this.layoutDriver = layoutDriver`, context)

test('ESC/POS inicializa, imprime, alimenta e corta', () => {
  const bytes = context.bytesEscPos('Ação 123', { alimentar: 2, cortar: true, larguraMm: 58 })
  assert.deepEqual([...bytes.subarray(0, 2)], [0x1b, 0x40])
  assert.match(bytes.toString('ascii'), /Acao 123/)
  assert.deepEqual([...bytes.subarray(-3)], [0x1d, 0x56, 0x00])
})

test('ESC/POS centraliza e restaura o alinhamento', () => {
  const bytes = context.bytesEscPos('Validade', { centralizar: true })
  assert.ok(bytes.includes(Buffer.from([0x1b, 0x61, 0x01])))
  assert.ok(bytes.includes(Buffer.from([0x1b, 0x61, 0x00])))
})

test('TSPL usa mídia contínua e cópias', () => {
  const command = context.bytesEtiqueta('TSPL', 'Etiqueta', { copias: 3, larguraMm: 58, dpi: 300 }).toString('ascii')
  assert.match(command, /^SIZE 58 mm,.*\r\nGAP 0 mm,0 mm\r\n/)
  assert.match(command, /TEXT 12,24,/)
  assert.match(command, /PRINT 3,1\r\n$/)
})

test('protocolos de etiqueta calculam posição centralizada', () => {
  const options = { copias: 1, larguraMm: 58, dpi: 203, centralizar: true }
  assert.match(context.bytesEtiqueta('TSPL', 'ABC', options).toString('ascii'), /TEXT 214,/)
  assert.match(context.bytesEtiqueta('ZPL', 'ABC', options).toString('ascii'), /\^FB464,1,0,C,0/)
  assert.match(context.bytesEtiqueta('CPCL', 'ABC', options).toString('ascii'), /TEXT 0 2 214 /)
  assert.match(context.bytesEtiqueta('EPL', 'ABC', options).toString('ascii'), /A214,/)
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

test('altura vazia mantém fonte e comprimento automáticos', () => {
  const layout = context.layoutEtiqueta('Linha 1\nLinha 2', { larguraMm: 58, dpi: 203 })
  assert.equal(layout.escalaFonte, 1)
  assert.ok(layout.altura >= 80)
})

test('altura fixa mantém fonte quando o conteúdo cabe', () => {
  const layout = context.layoutEtiqueta('Texto curto', { larguraMm: 58, alturaMm: 30, dpi: 203 })
  assert.equal(layout.escalaFonte, 1)
  assert.equal(layout.altura, 240)
})

test('altura fixa reduz conteúdo apenas quando necessário', () => {
  const texto = 'Produto com descricao muito longa que ocupa varias linhas\nQuantidade: 10\nPreco: 123,45'
  const layout = context.layoutEtiqueta(texto, { larguraMm: 40, alturaMm: 20, dpi: 203 })
  assert.ok(layout.escalaFonte < 1)
  assert.equal(layout.altura, 160)
  assert.ok(layout.margem * 2 + layout.linhas.length * layout.alturaLinha <= layout.altura)

  const driver = context.layoutDriver(texto, 40, 20)
  assert.ok(driver.cpi > 10)
  assert.ok(driver.lpi > 6)
  assert.equal(driver.alturaMm, 20)
})
