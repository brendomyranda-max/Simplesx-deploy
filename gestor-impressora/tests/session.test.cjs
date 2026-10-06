const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8')
const syncSource = source.slice(source.indexOf('function sincronizar()'), source.indexOf('async function listarImpressoras()'))

function fixture({ job, execute = async () => {}, disconnectError } = {}) {
  const calls = []
  const context = {
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
    confirmarJob: async () => calls.push('confirmed'),
    salvarConfig: async (config) => { context.config = config },
    statusAtual: () => ({ ...context.config }),
    notificarStatus: () => {},
  }
  vm.createContext(context)
  vm.runInContext(syncSource, context)
  return { context, calls }
}

test('desconectar aguarda o trabalho em andamento e impede novo polling', async () => {
  let started, finish
  const printing = new Promise((resolve) => { started = resolve })
  const completion = new Promise((resolve) => { finish = resolve })
  const { context: c, calls } = fixture({ job: { id: 1 }, execute: async () => { started(); await completion } })
  const first = c.sincronizar()
  assert.equal(c.sincronizar(), first)
  await printing
  const disconnect = c.desconectar()
  await Promise.resolve()
  assert.equal(c.config.conectado, false)
  assert.ok(!calls.includes('/gestor/disconnect'))
  finish()
  await disconnect
  assert.deepEqual(calls, ['register', '/gestor/pull', 'confirmed', '/gestor/disconnect'])
  await c.sincronizar()
  assert.equal(calls.length, 4)
  assert.notEqual(c.sessaoId, 'current-session')
})

test('falha de rede ao desconectar mantém a recepção pausada', async () => {
  const { context: c, calls } = fixture({ disconnectError: true })
  await assert.rejects(c.desconectar(), /Sem rede/)
  assert.equal(c.config.conectado, false)
  assert.equal(c.ultimoContato, null)
  await c.sincronizar()
  assert.deepEqual(calls, ['/gestor/disconnect'])
})
