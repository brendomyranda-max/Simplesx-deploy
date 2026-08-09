const $ = (id) => document.getElementById(id)
let estado

function toast(texto) {
  $('toast').textContent = texto
  $('toast').classList.add('show')
  setTimeout(() => $('toast').classList.remove('show'), 2500)
}

function dataHora(value) {
  return value ? new Date(value).toLocaleString('pt-BR') : '—'
}

function render(status) {
  estado = status
  $('token').textContent = status.token
  $('nome').value = status.nome
  $('deployUrl').value = status.deployUrl
  $('iniciar').checked = status.iniciarComSistema
  $('hostname').textContent = status.hostname
  $('contato').textContent = dataHora(status.ultimoContato)
  $('porta').textContent = `127.0.0.1:${status.portaLocal}`
  $('erro').textContent = status.ultimoErro || ''
  $('estado').textContent = status.online ? 'Online' : 'Offline'
  $('estado').className = `badge ${status.online ? 'online' : 'offline'}`
  const j = status.ultimoJob
  $('job').textContent = j ? `#${j.id} · ${j.impressora} · ${j.status} · ${dataHora(j.em)}` : 'Nenhum'
}

async function carregarImpressoras() {
  const atual = estado?.impressoraPadrao || $('impressora').value
  const lista = await window.simplesx.listarImpressoras()
  $('impressora').innerHTML = '<option value="">Padrão do sistema</option>'
  for (const p of lista) {
    const option = document.createElement('option')
    option.value = p.name
    option.textContent = `${p.displayName || p.name}${p.isDefault ? ' (padrão)' : ''}`
    $('impressora').appendChild(option)
  }
  $('impressora').value = atual
}

$('copiar').onclick = async () => { await navigator.clipboard.writeText($('token').textContent); toast('Token copiado') }
$('atualizar').onclick = async () => { await carregarImpressoras(); toast('Impressoras atualizadas') }
$('salvar').onclick = async () => {
  const status = await window.simplesx.salvar({
    ...estado,
    nome: $('nome').value,
    deployUrl: $('deployUrl').value,
    impressoraPadrao: $('impressora').value,
    iniciarComSistema: $('iniciar').checked,
  })
  render(status)
  toast('Configuração salva')
}
$('testar').onclick = async () => {
  $('testar').disabled = true
  try { await window.simplesx.testar($('impressora').value); toast('Teste enviado') }
  catch (e) { toast(`Erro: ${e.message}`) }
  finally { $('testar').disabled = false }
}

window.simplesx.onStatus(render)
window.simplesx.status().then(async (s) => { render(s); await carregarImpressoras() })
