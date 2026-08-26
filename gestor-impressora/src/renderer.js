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
  $('versao').textContent = `Versão ${status.version || '—'}`
  $('estado').textContent = status.online ? 'Online' : 'Offline'
  $('estado').className = `badge ${status.online ? 'online' : 'offline'}`
  const j = status.ultimoJob
  $('job').textContent = j ? `#${j.id} · ${j.impressora} · ${j.status} · ${dataHora(j.em)}` : 'Nenhum'
}

async function carregarImpressoras() {
  const atual = estado?.impressoraPadrao || $('impressora').value
  try {
    const lista = await window.simplesx.listarImpressoras()
    $('impressora').innerHTML = '<option value="">Padrão do sistema</option>'
    const padrao = lista.find((p) => p.isDefault) || lista[0]
    if (padrao) $('impressora').options[0].dataset.nome = padrao.name
    for (const p of lista) {
      const option = document.createElement('option')
      option.value = p.name
      option.textContent = `${p.displayName || p.name}${p.isDefault ? ' (padrão)' : ''}${p.enabled === false ? ' — indisponível' : ''}`
      option.disabled = p.enabled === false
      $('impressora').appendChild(option)
    }
    const disponiveis = lista.filter((p) => p.enabled !== false).length
    $('scanResultado').textContent = `${lista.length} encontrada(s), ${disponiveis} disponível(is)`
    $('impressora').value = lista.some((p) => p.name === atual) ? atual : ''
    if (atual && !$('impressora').value) toast(`A impressora ${atual} não está mais disponível`)
  } catch (e) {
    $('impressora').innerHTML = '<option value="">Nenhuma impressora disponível</option>'
    $('scanResultado').textContent = 'Falha ao buscar impressoras'
    toast(`Erro: ${e.message}`)
  }
}

function impressoraSelecionada() {
  const select = $('impressora')
  return select.value || select.selectedOptions[0]?.dataset?.nome || ''
}

function larguraAtual(nome) {
  return Number(estado?.largurasImpressoras?.[nome]) || 58
}

function protocoloAtual(nome) {
  return estado?.protocolosImpressoras?.[nome] || 'DRIVER'
}

$('tamanho').onclick = () => {
  const nome = impressoraSelecionada()
  if (!nome) return toast('Selecione uma impressora primeiro')
  const largura = larguraAtual(nome)
  const comuns = [58, 76, 80, 100, 102]
  $('tamanhoImpressora').textContent = nome
  $('larguraPreset').value = comuns.includes(largura) ? String(largura) : 'custom'
  $('larguraCustom').value = largura
  $('protocolo').value = protocoloAtual(nome)
  $('larguraCustomLabel').hidden = $('larguraPreset').value !== 'custom'
  $('tamanhoDialog').showModal()
}
$('larguraPreset').onchange = () => { $('larguraCustomLabel').hidden = $('larguraPreset').value !== 'custom' }
$('salvarTamanho').onclick = async (event) => {
  event.preventDefault()
  const nome = impressoraSelecionada()
  const largura = $('larguraPreset').value === 'custom' ? Number($('larguraCustom').value) : Number($('larguraPreset').value)
  if (!Number.isFinite(largura) || largura < 20 || largura > 320) return toast('Informe uma largura entre 20 e 320 mm')
  try {
    const status = await window.simplesx.salvarImpressora(nome, largura, $('protocolo').value)
    render(status)
    $('tamanhoDialog').close()
    toast(`${nome}: ${largura} mm · ${$('protocolo').value.replace('_', '/')}`)
  } catch (e) { toast(`Erro: ${e.message}`) }
}

$('copiar').onclick = async () => { await navigator.clipboard.writeText($('token').textContent); toast('Token copiado') }
$('atualizar').onclick = async () => {
  $('atualizar').disabled = true
  $('scanResultado').textContent = 'Buscando impressoras…'
  try { await carregarImpressoras(); toast('Busca de impressoras concluída') }
  finally { $('atualizar').disabled = false }
}
$('salvar').onclick = async () => {
  $('salvar').disabled = true
  try {
    const status = await window.simplesx.salvar({
      ...estado,
      nome: $('nome').value,
      deployUrl: $('deployUrl').value,
      impressoraPadrao: $('impressora').value,
      iniciarComSistema: $('iniciar').checked,
    })
    render(status)
    toast('Configuração salva')
  } catch (e) {
    toast(`Erro: ${e.message}`)
  } finally {
    $('salvar').disabled = false
  }
}
$('testar').onclick = async () => {
  $('testar').disabled = true
  try { await window.simplesx.testar($('impressora').value); toast('Teste enviado') }
  catch (e) { toast(`Erro: ${e.message}`) }
  finally { $('testar').disabled = false }
}

window.simplesx.onStatus(render)
window.simplesx.status().then(async (s) => { render(s); await carregarImpressoras() })
