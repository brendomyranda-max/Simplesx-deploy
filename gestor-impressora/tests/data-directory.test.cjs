const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { resolveDataDirectory } = require('../src/data-directory.cjs')
const { JobJournal } = require('../src/job-journal.cjs')

test('atualização de marca preserva configuração, bloqueio de instância e diário de impressão', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'simplexsa-update-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  assert.equal(resolveDataDirectory(root), path.join(root, 'simplexsa-gestor-impressora'))
  const previous = path.join(root, 'simplesx-gestor-impressora')
  await fs.mkdir(previous)
  const configuration = { token: 'credencial-ficticia', impressoraPadrao: 'Cozinha' }
  await fs.writeFile(path.join(previous, 'config.json'), JSON.stringify(configuration))
  const job = { id: 23, conteudo: 'Pedido já impresso', impressora: 'Cozinha' }
  let prints = 0
  await new JobJournal(previous).execute('server', job, async () => { prints++ })
  const afterUpdate = resolveDataDirectory(root)
  assert.equal(afterUpdate, previous)
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(afterUpdate, 'config.json'), 'utf8')), configuration)
  await new JobJournal(afterUpdate).execute('server', job, async () => { prints++ })
  assert.equal(prints, 1)
  // Uma pasta criada por outra tentativa de atualização não divide a instalação.
  await fs.mkdir(path.join(root, 'simplexsa-gestor-impressora'))
  assert.equal(resolveDataDirectory(root), previous)
})

test('instalação anterior com nome do produto também reutiliza os dados', () => {
  const root = path.resolve('dados-ficticios')
  const previous = path.join(root, 'SimplesX Gestor')
  assert.equal(resolveDataDirectory(root, value => value === path.join(previous, 'config.json')), previous)
})
