const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { JobJournal } = require('../src/job-journal.cjs')

test('ACK perdido e reinício não enviam novamente os bytes do trabalho', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'print-journal-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const job = { id: 1, conteudo: 'Pedido', impressora: 'Cozinha' }
  let prints = 0
  const print = async () => { prints++ }
  assert.equal((await new JobJournal(directory).execute('server', job, print)).status, 'feito')
  assert.equal((await new JobJournal(directory).execute('server', job, print)).status, 'feito')
  assert.equal(prints, 1)
  await new JobJournal(directory).execute('server', { ...job, id: 2 }, print)
  assert.equal(prints, 2)
  await assert.rejects(new JobJournal(directory).execute('server', { ...job, conteudo: 'Outro' }, print), /mudou/)
  assert.equal(prints, 2)
})

test('impressão interrompida ou com erro exige conferência e não duplica', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'print-journal-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  let prints = 0
  const job = { id: 1, conteudo: 'Pedido' }
  assert.equal((await new JobJournal(directory).execute('server', job, async () => { prints++; throw new Error('Sem papel') })).status, 'erro')
  assert.equal((await new JobJournal(directory).execute('server', job, async () => { prints++ })).status, 'erro')
  const file = path.join(directory, (await fs.readdir(directory))[0])
  const saved = JSON.parse(await fs.readFile(file, 'utf8'))
  await fs.writeFile(file, JSON.stringify({ ...saved, status: 'iniciado' }))
  assert.match((await new JobJournal(directory).execute('server', job, async () => { prints++ })).erro, /interrompido/)
  assert.equal(prints, 1)
})
