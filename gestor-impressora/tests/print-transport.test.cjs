const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const { externalFilePath } = require('../src/native-files.cjs')

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8')

function fixture(platform, config = {}) {
  const calls = [], files = new Map()
  const context = {
    Buffer, path: platform === 'win32' ? path.win32 : path.posix, externalFilePath,
    __dirname: platform === 'win32' ? String.raw`C:\installed\app.asar\src` : '/installed/app.asar/src',
    process: { platform }, config, crypto: { randomUUID: () => 'job-id' },
    app: { getPath: () => platform === 'win32' ? String.raw`C:\Temp` : '/tmp' },
    fs: { writeFile: async (file, content) => files.set(file, content), unlink: async () => {} },
    executarArquivo: async (file, args) => calls.push({ file, args }),
  }
  vm.createContext(context)
  vm.runInContext(source.slice(source.indexOf('function quebrarPorLargura'), source.indexOf('async function imprimirRaw(opcoes)')), context)
  return { print: context.imprimirRawAgora, calls, files }
}

test('Windows DRIVER usa o driver com altura automática e largura recebida do trabalho', async () => {
  const f = fixture('win32')
  await f.print({ texto: 'Teste\nConexão OK', larguraMm: 80 }, { name: 'Cupom' })
  const { args } = f.calls[0]
  assert.ok(args.includes(String.raw`C:\installed\app.asar.unpacked\src\windows-fit.ps1`))
  assert.equal(args[args.indexOf('-WidthMm') + 1], '80')
  assert.ok(Number(args[args.indexOf('-HeightMm') + 1]) >= 10)
})

test('Windows preserva altura fixa e protocolo RAW explícito', async () => {
  const driver = fixture('win32', { alturasImpressoras: { Caixa: 30 }, largurasImpressoras: { Caixa: 58 } })
  await driver.print({ texto: 'Teste', larguraMm: 80 }, { name: 'Caixa' })
  const { args } = driver.calls[0]
  assert.equal(args[args.indexOf('-HeightMm') + 1], '30')
  assert.equal(args[args.indexOf('-WidthMm') + 1], '58')
  const raw = fixture('win32', { protocolosImpressoras: { Caixa: 'ESC_POS' } })
  await raw.print({ texto: 'Teste' }, { name: 'Caixa' })
  assert.ok(raw.calls[0].args.includes(String.raw`C:\installed\app.asar.unpacked\src\windows-raw.ps1`))
  assert.deepEqual([...raw.files.values()][0].subarray(0, 2), Buffer.from([0x1b, 0x40]))
})

test('Linux usa ESC/POS em fila RAW sem sufixo, mantendo protocolo configurado', async () => {
  const raw = fixture('linux')
  await raw.print({ texto: 'Teste', alimentar: 3 }, { name: 'DieboldIM453H', raw: true })
  assert.ok(raw.calls[0].args.includes('raw'))
  assert.deepEqual([...raw.files.values()][0].subarray(0, 2), Buffer.from([0x1b, 0x40]))
  const tspl = fixture('linux', { protocolosImpressoras: { Etiqueta: 'TSPL' } })
  await tspl.print({ texto: 'Etiqueta' }, { name: 'Etiqueta', raw: true })
  assert.match([...tspl.files.values()][0].toString(), /^SIZE /)
})

test('Linux DRIVER conserva o processamento CUPS e a largura do trabalho', async () => {
  const f = fixture('linux')
  await f.print({ texto: 'Teste', larguraMm: 80 }, { name: 'Driver', raw: false })
  assert.ok(f.calls[0].args.some((arg) => arg.startsWith('media=Custom.80x')))
  assert.ok(!f.calls[0].args.includes('raw'))
})

test('erro de envio é propagado e arquivo temporário é removido', async () => {
  const calls = []
  const context = {
    Buffer, path, externalFilePath, __dirname, process: { platform: 'linux' }, config: {},
    crypto: { randomUUID: () => 'failure' }, app: { getPath: () => '/tmp' },
    fs: { writeFile: async () => {}, unlink: async (file) => calls.push(file) },
    executarArquivo: async () => { throw new Error('Spooler indisponível') },
  }
  vm.createContext(context)
  vm.runInContext(source.slice(source.indexOf('function quebrarPorLargura'), source.indexOf('async function imprimirRaw(opcoes)')), context)
  await assert.rejects(context.imprimirRawAgora({ texto: 'Teste' }, { name: 'Caixa' }), /Spooler indisponível/)
  assert.equal(calls.length, 1)
})
