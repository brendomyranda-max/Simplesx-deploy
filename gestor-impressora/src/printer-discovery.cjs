/** Descobre filas pelo sistema operacional e pelo Electron, sem ocultar filas pausadas. */
const path = require('node:path')
const { externalFilePath } = require('./native-files.cjs')

function parseCupsPrinters(state, accepting = '', defaultOutput = '') {
  const accepted = new Map()
  for (const line of accepting.split('\n')) {
    const match = line.match(/^(\S+)\s+(not )?accepting requests\b/i)
    if (match) accepted.set(match[1], !match[2])
  }
  const defaultName = defaultOutput.match(/system default destination:\s*(\S+)/)?.[1]
  return state.split('\n').flatMap((line) => {
    const match = line.match(/^printer\s+(\S+)\s+(.*)/)
    if (!match) return []
    const name = match[1]
    const enabled = !/\bdisabled\b/i.test(match[2])
    const accepts = accepted.get(name) ?? true
    return [{ name, displayName: name, isDefault: name === defaultName, enabled, accepting: accepts,
      state: !enabled ? 'pausada' : !accepts ? 'recusando trabalhos' : 'disponivel' }]
  })
}

function parseWindowsPrinters(output) {
  const parsed = JSON.parse(output.replace(/^\uFEFF/, '').trim() || '[]')
  return (Array.isArray(parsed) ? parsed : [parsed]).filter((p) => p?.Name).map((p) => ({
    name: p.Name, displayName: p.Name, description: p.DriverName || '',
    isDefault: p.Default === true, status: p.PrinterStatus,
    enabled: !(Number(p.PrinterState) & 1), accepting: p.WorkOffline !== true,
    state: Number(p.PrinterState) & 1 ? 'pausada' : p.WorkOffline === true ? 'offline' : 'disponivel',
  }))
}

function parseCupsOptions(output) {
  const model = output.match(/(?:^|\s)printer-make-and-model=(?:'([^']*)'|"([^"]*)"|(\S+))/)
  if (!model) return {}
  const description = model[1] ?? model[2] ?? model[3]
  return { description, raw: /^(?:Local )?Raw Printer$/i.test(description) }
}

async function nativePrinters(platform, execute) {
  if (platform === 'linux') {
    const options = { env: { ...process.env, LC_ALL: 'C' }, timeout: 5000 }
    const results = await Promise.allSettled(['-p', '-a', '-d'].map((flag) => execute('lpstat', [flag], options)))
    const [state, accepting, defaultResult] = results
    if (state.status === 'rejected') {
      const error = state.reason
      if (/No destinations added/i.test(`${error.stdout || ''}\n${error.stderr || ''}`)) return []
      if (error.code === 'ENOENT') throw new Error('Instale o cliente CUPS (lpstat/lp) para detectar e imprimir neste Linux')
      throw new Error(`CUPS indisponível: ${error.stderr?.trim() || error.message}. Verifique o serviço CUPS`)
    }
    const printers = parseCupsPrinters(state.value.stdout,
      accepting.status === 'fulfilled' ? accepting.value.stdout : '',
      defaultResult.status === 'fulfilled' ? defaultResult.value.stdout : '')
    return Promise.all(printers.map(async (printer) => {
      try {
        const { stdout } = await execute('lpoptions', ['-p', printer.name], options)
        return { ...printer, ...parseCupsOptions(stdout || '') }
      } catch { return printer }
    }))
  }
  if (platform === 'win32') {
    const { stdout } = await execute('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', externalFilePath(path.join(__dirname, 'windows-printers.ps1')),
    ], { timeout: 10_000, windowsHide: true, encoding: 'utf8' })
    return parseWindowsPrinters(stdout)
  }
  throw new Error('Consulta nativa não disponível nesta plataforma')
}

async function withTimeout(operation, milliseconds) {
  let timer
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('A descoberta do Electron não respondeu')), milliseconds) }),
    ])
  } finally { clearTimeout(timer) }
}

function createPrinterDiscovery({ platform = process.platform, execute, electronPrinters, ttl = 15_000, now = Date.now }) {
  let cache, cachedAt = 0, pending
  return async function discover({ force = false } = {}) {
    if (pending) return pending
    if (!force && cache && now() - cachedAt < ttl) return cache
    pending = (async () => {
      const [electron, native] = await Promise.allSettled([
        withTimeout(electronPrinters, 5000), nativePrinters(platform, execute),
      ])
      const printers = new Map()
      for (const result of [electron, native]) {
        if (result.status !== 'fulfilled') continue
        for (const printer of result.value) {
          if (!printer.name) continue
          const key = printer.name.toLocaleLowerCase('pt-BR')
          const previous = printers.get(key)
          printers.set(key, { enabled: true, accepting: true, state: 'disponivel', ...previous, ...printer,
            displayName: previous?.displayName || printer.displayName || printer.name })
        }
      }
      // Uma lista vazia do Electron não comprova que o spooler está funcionando.
      if (!printers.size && native.status === 'rejected') {
        throw new Error(`Não foi possível consultar as impressoras. ${native.reason.message}`)
      }
      cache = [...printers.values()]
      cachedAt = now()
      return cache
    })()
    try { return await pending } finally { pending = null }
  }
}

function selectPrinter(printers, requested = '', configured = '') {
  const name = String(requested || configured || '').trim()
  if (name) {
    const key = name.toLocaleLowerCase('pt-BR')
    const printer = printers.find((p) => [p.name, p.displayName].some((value) => value?.toLocaleLowerCase('pt-BR') === key))
    if (!printer) throw new Error(`A impressora "${name}" não foi encontrada. Atualize a lista e confira o nome instalado no sistema`)
    if (printer.enabled === false || printer.accepting === false) {
      throw new Error(`A impressora "${printer.name}" está ${printer.state || 'indisponível'}. Verifique a fila no sistema operacional`)
    }
    return printer
  }
  const available = printers.filter((p) => p.enabled !== false && p.accepting !== false)
  if (!available.length) throw new Error(printers.length
    ? 'As impressoras instaladas estão pausadas ou indisponíveis. Verifique as filas no sistema operacional'
    : 'Nenhuma impressora instalada. Adicione a impressora em Impressoras e scanners (Windows) ou no CUPS (Linux)')
  return available.find((p) => p.isDefault) || available[0]
}

module.exports = { createPrinterDiscovery, parseCupsPrinters, parseCupsOptions, parseWindowsPrinters, selectPrinter }
