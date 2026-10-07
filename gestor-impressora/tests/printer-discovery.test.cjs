const assert = require('node:assert/strict')
const test = require('node:test')
const { createPrinterDiscovery, parseCupsPrinters, parseCupsOptions, parseWindowsPrinters, selectPrinter } = require('../src/printer-discovery.cjs')
const { externalFilePath } = require('../src/native-files.cjs')

const cupsState = 'printer Diebold80 disabled since Tue Oct 6 10:00:00 2026 -\n\tPaused\nprinter DieboldIM453H is idle.  enabled since Tue Oct 6 10:00:00 2026\nprinter HaoYinRAW now printing HaoYinRAW-1. enabled since Tue Oct 6 10:00:00 2026\n'
const cupsAccepting = 'Diebold80 accepting requests since Tue Oct 6\nDieboldIM453H accepting requests since Tue Oct 6\nHaoYinRAW not accepting requests since Tue Oct 6\n'
const cupsDefault = 'system default destination: DieboldIM453H\n'
const executeCups = async (_file, [flag]) => ({ stdout: { '-p': cupsState, '-a': cupsAccepting, '-d': cupsDefault }[flag] })

test('PowerShell usa scripts físicos no aplicativo instalado, inclusive com espaços no caminho', () => {
  for (const script of ['windows-printers.ps1', 'windows-raw.ps1', 'windows-fit.ps1']) {
    assert.equal(externalFilePath(`C:\\Program Files\\Gestor\\resources\\app.asar\\src\\${script}`),
      `C:\\Program Files\\Gestor\\resources\\app.asar.unpacked\\src\\${script}`)
    assert.equal(externalFilePath(`/opt/Gestor/resources/app.asar/src/${script}`),
      `/opt/Gestor/resources/app.asar.unpacked/src/${script}`)
    assert.equal(externalFilePath(`/projeto/src/${script}`), `/projeto/src/${script}`)
  }
})

test('CUPS distingue fila pausada, recusando trabalhos e padrão sem esconder impressoras', () => {
  const printers = parseCupsPrinters(cupsState, cupsAccepting, cupsDefault)
  assert.deepEqual(printers.map((p) => [p.name, p.enabled, p.accepting, p.isDefault]), [
    ['Diebold80', false, true, false], ['DieboldIM453H', true, true, true], ['HaoYinRAW', true, false, false],
  ])
  assert.equal(selectPrinter(printers).name, 'DieboldIM453H')
  assert.throws(() => selectPrinter(printers, 'Diebold80'), /pausada/)
  assert.throws(() => selectPrinter(printers, 'HaoYinRAW'), /recusando trabalhos/)
})

test('detecta as filas CUPS quando o Electron retorna vazio ou falha', async () => {
  for (const electronPrinters of [async () => [], async () => { throw new Error('Chromium indisponível') }]) {
    const discover = createPrinterDiscovery({ platform: 'linux', execute: executeCups, electronPrinters })
    assert.equal((await discover()).length, 3)
  }
})

test('metadados do Electron não apagam o estado CUPS e filas iguais não duplicam', async () => {
  const discover = createPrinterDiscovery({ platform: 'linux', execute: executeCups,
    electronPrinters: async () => [{ name: 'Diebold80', displayName: 'Diebold 80 mm', enabled: true }] })
  const printers = await discover()
  assert.equal(printers.length, 3)
  assert.equal(printers[0].displayName, 'Diebold 80 mm')
  assert.equal(printers[0].enabled, false)
})

test('falha na consulta da impressora padrão não apaga as filas Linux', async () => {
  const discover = createPrinterDiscovery({ platform: 'linux', electronPrinters: async () => [],
    execute: async (file, args) => {
      if (args[0] === '-d') throw new Error('no system default destination')
      return executeCups(file, args)
    } })
  assert.equal((await discover()).length, 3)
})

test('CUPS sem destinos é uma lista vazia, não uma falha do serviço', async () => {
  const discover = createPrinterDiscovery({ platform: 'linux', electronPrinters: async () => [],
    execute: async () => { throw Object.assign(new Error('lpstat'), { stderr: 'lpstat: No destinations added.' }) } })
  assert.deepEqual(await discover(), [])
})

test('CUPS parado informa a causa em vez de afirmar que não há impressoras', async () => {
  const discover = createPrinterDiscovery({ platform: 'linux', electronPrinters: async () => [],
    execute: async () => { throw Object.assign(new Error('lpstat'), { stderr: 'Scheduler is not running.' }) } })
  await assert.rejects(discover(), /CUPS indisponível.*Scheduler is not running/)
})

test('cliente CUPS ausente tem orientação específica', async () => {
  const discover = createPrinterDiscovery({ platform: 'linux', electronPrinters: async () => [],
    execute: async () => { throw Object.assign(new Error('spawn lpstat ENOENT'), { code: 'ENOENT' }) } })
  await assert.rejects(discover(), /Instale o cliente CUPS/)
})

test('preserva descoberta Electron se a consulta nativa falhar', async () => {
  const discover = createPrinterDiscovery({ platform: 'win32',
    execute: async () => { throw new Error('PowerShell bloqueado') },
    electronPrinters: async () => [{ name: 'Caixa' }] })
  assert.equal((await discover())[0].name, 'Caixa')
})

test('Windows reconhece UTF-8, BOM, resultado único e lista vazia', () => {
  const printers = parseWindowsPrinters('\uFEFF{"Name":"Balcão 80","Default":true,"WorkOffline":false}')
  assert.equal(printers[0].name, 'Balcão 80')
  assert.equal(printers[0].isDefault, true)
  assert.deepEqual(parseWindowsPrinters('[]'), [])
  assert.deepEqual(parseWindowsPrinters('null'), [])
})

test('Windows consulta o spooler sem depender da lista do Electron', async () => {
  const discover = createPrinterDiscovery({ platform: 'win32', electronPrinters: async () => [],
    execute: async (file, args, options) => {
      assert.equal(file, 'powershell.exe')
      assert.ok(args.includes('-NonInteractive'))
      assert.equal(options.windowsHide, true)
      return { stdout: JSON.stringify([{ Name: 'Caixa', Default: true }, { Name: 'Cozinha', WorkOffline: true }]) }
    } })
  const printers = await discover()
  assert.equal(printers.length, 2)
  assert.equal(selectPrinter(printers).name, 'Caixa')
  assert.throws(() => selectPrinter(printers, 'Cozinha'), /offline/)
})

test('destino explícito ou padrão salvo ausente não redireciona para outra impressora', () => {
  const printers = [{ name: 'Caixa', displayName: 'Cupom', isDefault: true }]
  assert.throws(() => selectPrinter(printers, 'Cozinha'), /não foi encontrada/)
  assert.throws(() => selectPrinter(printers, '', 'Cozinha'), /não foi encontrada/)
  assert.equal(selectPrinter(printers, 'cupom').name, 'Caixa')
})

test('não usa uma fila padrão pausada como alternativa automática', () => {
  const printers = [{ name: 'A', isDefault: true, enabled: false }, { name: 'B' }]
  assert.equal(selectPrinter(printers).name, 'B')
  assert.throws(() => selectPrinter([printers[0]]), /pausadas/)
  assert.throws(() => selectPrinter([]), /Adicione a impressora/)
})

test('cache evita consultar o spooler a cada polling; busca manual e expiração renovam a lista', async () => {
  let calls = 0, time = 0
  const discover = createPrinterDiscovery({ platform: 'linux', now: () => time, electronPrinters: async () => [],
    execute: async (file, args) => { if (file === 'lpstat') calls++; return executeCups(file, args) } })
  await Promise.all([discover(), discover(), discover({ force: true })])
  assert.equal(calls, 3)
  time = 3000
  await discover()
  assert.equal(calls, 3)
  await discover({ force: true })
  assert.equal(calls, 6)
  time = 19000
  await discover()
  assert.equal(calls, 9)
})

test('falha de descoberta não fica armazenada e permite recuperação', async () => {
  let fail = true
  const discover = createPrinterDiscovery({ platform: 'linux', electronPrinters: async () => [],
    execute: async (file, args) => { if (fail) throw new Error('Sem CUPS'); return executeCups(file, args) } })
  await assert.rejects(discover(), /Sem CUPS/)
  fail = false
  assert.equal((await discover()).length, 3)
})

test('detecta fila RAW pelo CUPS mesmo sem RAW no nome', async () => {
  const discover = createPrinterDiscovery({ platform: 'linux', electronPrinters: async () => [],
    execute: async (file, args) => file === 'lpoptions'
      ? { stdout: "printer-info=Diebold printer-make-and-model='Local Raw Printer' printer-state=3" }
      : executeCups(file, args) })
  assert.equal((await discover()).find((p) => p.name === 'DieboldIM453H').raw, true)
  assert.equal(parseCupsOptions("printer-make-and-model='TSPL Label Printer'").raw, false)
  assert.deepEqual(parseCupsOptions('copies=1'), {})
})

test('lpoptions ausente não impede listar as impressoras', async () => {
  const discover = createPrinterDiscovery({ platform: 'linux', electronPrinters: async () => [],
    execute: async (file, args) => {
      if (file === 'lpoptions') throw new Error('ENOENT')
      return executeCups(file, args)
    } })
  assert.equal((await discover()).length, 3)
})
