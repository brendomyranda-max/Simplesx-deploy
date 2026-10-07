const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const os = require('node:os')
const { JobJournal } = require('../src/job-journal.cjs')

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8')
const syncSource = source.slice(source.indexOf('function sincronizar()'), source.indexOf('async function listarImpressoras('))

function fixture(t, { job, execute = async () => {}, disconnectError, ackError } = {}) {
  const calls = []
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'print-session-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const context = {
    app: { getPath: () => directory }, path, JobJournal, setInterval, clearInterval, setTimeout: () => {},
    config: { conectado: true, token: 'secret', deployUrl: 'https://example.test' },
    sincronizando: false, sincronizacaoAtual: null, sessaoId: 'current-session',
    ultimoContato: null, ultimoErro: '', ultimoJob: null, crypto,
    registrar: async () => calls.push('register'),
    api: async (endpoint) => {
      calls.push(endpoint)
      if (endpoint === '/gestor/disconnect' && disconnectError) throw new Error('Sem rede')
      return { jobs: job ? [job] : [] }
    },
    executarJob: execute,
    confirmarJob: async (_job, status) => {
      calls.push(status)
      if (status === 'feito' && ackError?.()) throw new Error('ACK sem rede')
      return { ok: true }
    },
    salvarConfig: async (config) => { context.config = config },
    statusAtual: () => ({ ...context.config }),
    notificarStatus: () => {},
  }
  vm.createContext(context)
  vm.runInContext(syncSource, context)
  return { context, calls }
}

test('desconectar aguarda o trabalho em andamento e impede novo polling', async (t) => {
  let started, finish
  const printing = new Promise((resolve) => { started = resolve })
  const completion = new Promise((resolve) => { finish = resolve })
  const { context: c, calls } = fixture(t, { job: { id: 1 }, execute: async () => { started(); await completion } })
  const first = c.sincronizar()
  assert.equal(c.sincronizar(), first)
  await printing
  const disconnect = c.desconectar()
  await Promise.resolve()
  assert.equal(c.config.conectado, false)
  assert.ok(!calls.includes('/gestor/disconnect'))
  finish()
  await disconnect
  assert.deepEqual(calls, ['register', '/gestor/pull', 'processando', 'feito', '/gestor/disconnect'])
  await c.sincronizar()
  assert.equal(calls.length, 5)
  assert.notEqual(c.sessaoId, 'current-session')
})

test('falha de rede ao desconectar mantém a recepção pausada', async (t) => {
  const { context: c, calls } = fixture(t, { disconnectError: true })
  await assert.rejects(c.desconectar(), /Sem rede/)
  assert.equal(c.config.conectado, false)
  assert.equal(c.ultimoContato, null)
  await c.sincronizar()
  assert.deepEqual(calls, ['/gestor/disconnect'])
})

test('falha no ACK não é reportada como erro da impressora e não reimprime no próximo pull', async (t) => {
  let prints = 0, failed = false
  const { context: c, calls } = fixture(t, { job: { id: 1 }, execute: async () => { prints++ }, ackError: () => {
    if (failed) return false
    failed = true; return true
  } })
  await c.sincronizar()
  assert.equal(c.ultimoJob.status, 'pendente')
  assert.ok(!calls.includes('erro'))
  await c.sincronizar()
  assert.equal(c.ultimoJob.status, 'feito')
  assert.equal(prints, 1)
})
