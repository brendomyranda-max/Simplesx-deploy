const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')

// O protocolo da impressora não permite confirmar papel após queda de energia.
// Um envio interrompido exige conferência; uma confirmação HTTP perdida apenas
// repete a confirmação, nunca os bytes já enviados.
class JobJournal {
  constructor(directory) { this.directory = directory }

  async execute(scope, job, print) {
    const key = crypto.createHash('sha256').update(`${scope}:${job.id}`).digest('hex')
    const file = path.join(this.directory, `${key}.json`)
    const digest = crypto.createHash('sha256').update(JSON.stringify({
      tipo: job.tipo, conteudo: job.conteudo, impressora: job.impressora,
      largura_mm: job.largura_mm, copias: job.copias, cortar: job.cortar, alimentar: job.alimentar,
    })).digest('hex')
    let previous
    try { previous = JSON.parse(await fs.readFile(file, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (previous) {
      if (previous.digest !== digest) throw new Error('Conteúdo do trabalho mudou. Confira a impressão antes de repetir.')
      if (previous.status === 'feito' || previous.status === 'erro') return previous
      return { status: 'erro', erro: 'Envio interrompido. Confira o papel antes de solicitar uma nova impressão.' }
    }
    await fs.mkdir(this.directory, { recursive: true })
    const save = async (state) => {
      const temporary = `${file}.tmp`
      const handle = await fs.open(temporary, 'w')
      try { await handle.writeFile(JSON.stringify({ ...state, digest })); await handle.sync() } finally { await handle.close() }
      await fs.rename(temporary, file)
    }
    await save({ status: 'iniciado' })
    let result
    try { await print(job); result = { status: 'feito' } }
    catch (error) { result = { status: 'erro', erro: `${error.message}. Confira a impressora antes de repetir.` } }
    await save(result)
    return result
  }
}

module.exports = { JobJournal }
