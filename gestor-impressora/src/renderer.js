/**
 * Arquivo: renderer.js
 * Responsabilidade: Controla os campos e estados visuais da janela do gestor desktop.
 */

const $ = (id) => document.getElementById(id)
let estado
let impressoras = []

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
  $('estado').textContent = status.online ? 'Online' : status.conectado === false ? 'Desconectado' : 'Offline'
  $('estado').className = `badge ${status.online ? 'online' : 'offline'}`
  const j = status.ultimoJob
  $('job').textContent = j ? `#${j.id} · ${j.impressora} · ${j.status} · ${dataHora(j.em)}${j.erro ? ` · ${j.erro}` : ''}` : 'Nenhum'
}

async function carregarImpressoras() {
  const atual = $('impressora').value || estado?.impressoraPadrao || ''
  try {
    const lista = await window.simplexsa.listarImpressoras()
    impressoras = lista
    $('impressora').innerHTML = '<option value="">Padrão do sistema</option>'
    const disponiveis = lista.filter((p) => p.enabled !== false && p.accepting !== false)
    const padrao = disponiveis.find((p) => p.isDefault) || disponiveis[0]
    if (padrao) $('impressora').options[0].dataset.nome = padrao.name
    for (const p of lista) {
      const option = document.createElement('option')
      option.value = p.name
      const indisponivel = p.enabled === false || p.accepting === false
      option.textContent = `${p.displayName || p.name}${p.isDefault ? ' (padrão)' : ''}${indisponivel ? ` — ${p.state || 'indisponível'}` : ''}`
      $('impressora').appendChild(option)
    }
    $('scanResultado').textContent = lista.length
      ? `${lista.length} encontrada(s), ${disponiveis.length} disponível(is). Filas pausadas devem ser retomadas no sistema.`
      : 'Nenhuma fila instalada. Adicione a impressora em Impressoras e scanners (Windows) ou no CUPS (Linux) e busque novamente.'
    if (atual && !lista.some((p) => p.name === atual)) {
      const ausente = document.createElement('option')
      ausente.value = atual
      ausente.textContent = `${atual} — não encontrada`
      $('impressora').appendChild(ausente)
    }
    $('impressora').value = atual
    return true
  } catch (e) {
    // Uma falha temporária não deve apagar o destino salvo nem escolher outra fila.
    if (atual && !$('impressora').value) {
      const salva = document.createElement('option')
      salva.value = atual
      salva.textContent = `${atual} — consulta indisponível`
      $('impressora').appendChild(salva)
      $('impressora').value = atual
    }
    $('scanResultado').textContent = `Falha ao buscar impressoras: ${e.message}`
    toast(`Erro: ${e.message}`)
    return false
  }
}

function impressoraSelecionada() {
  const select = $('impressora')
  return select.value || select.selectedOptions[0]?.dataset?.nome || ''
}

function larguraAtual(nome) {
  return Number(estado?.largurasImpressoras?.[nome]) || 58
}

function alturaAtual(nome) {
  const altura = Number(estado?.alturasImpressoras?.[nome])
  return Number.isFinite(altura) && altura >= 10 ? altura : null
}

function protocoloAtual(nome) {
  return estado?.protocolosImpressoras?.[nome] ||
    (impressoras.find((p) => p.name === nome)?.raw || /RAW$/i.test(nome) ? 'ESC_POS' : 'DRIVER')
}

function dpiAtual(nome) {
  return Number(estado?.dpisImpressoras?.[nome]) || 203
}

$('tamanho').onclick = () => {
  const nome = impressoraSelecionada()
  if (!nome) return toast('Selecione uma impressora primeiro')
  const largura = larguraAtual(nome)
  const comuns = [58, 76, 80, 100, 102]
  $('tamanhoImpressora').textContent = nome
  $('larguraPreset').value = comuns.includes(largura) ? String(largura) : 'custom'
  $('larguraCustom').value = largura
  $('altura').value = alturaAtual(nome) ?? ''
  $('protocolo').value = protocoloAtual(nome)
  $('dpi').value = dpiAtual(nome)
  $('larguraCustomLabel').hidden = $('larguraPreset').value !== 'custom'
  $('tamanhoDialog').showModal()
}
$('larguraPreset').onchange = () => { $('larguraCustomLabel').hidden = $('larguraPreset').value !== 'custom' }
$('salvarTamanho').onclick = async (event) => {
  event.preventDefault()
  const nome = impressoraSelecionada()
  const largura = $('larguraPreset').value === 'custom' ? Number($('larguraCustom').value) : Number($('larguraPreset').value)
  if (!Number.isFinite(largura) || largura < 20 || largura > 320) return toast('Informe uma largura entre 20 e 320 mm')
  const alturaTexto = $('altura').value.trim()
  const altura = alturaTexto === '' ? null : Number(alturaTexto)
  if (altura !== null && (!Number.isFinite(altura) || altura < 10 || altura > 500)) return toast('Informe uma altura entre 10 e 500 mm ou deixe vazia')
  try {
    const dpi = Number($('dpi').value)
    if (!Number.isInteger(dpi) || dpi < 100 || dpi > 1200) return toast('Informe um DPI entre 100 e 1200')
    const status = await window.simplexsa.salvarImpressora(nome, largura, altura, $('protocolo').value, dpi)
    render(status)
    $('tamanhoDialog').close()
    toast(`${nome}: ${largura} × ${altura ?? 'auto'} mm · ${dpi} DPI · ${$('protocolo').value.replace('_', '/')}`)
  } catch (e) { toast(`Erro: ${e.message}`) }
}

$('copiar').onclick = async () => { await navigator.clipboard.writeText($('token').textContent); toast('Token copiado') }
$('desconectar').onclick = async () => {
  $('desconectar').disabled = true
  try {
    render(await window.simplexsa.desconectar())
    toast('Servidor desconectado. Ele já pode ser vinculado a outro estabelecimento.')
  } catch (error) {
    toast(`${error.message}. A recepção foi pausada; a sessão expira após 90 segundos sem contato.`)
  } finally { $('desconectar').disabled = false }
}
$('atualizar').onclick = async () => {
  $('atualizar').disabled = true
  $('scanResultado').textContent = 'Buscando impressoras…'
  try { if (await carregarImpressoras()) toast('Busca de impressoras concluída') }
  finally { $('atualizar').disabled = false }
}
$('salvar').onclick = async () => {
  $('salvar').disabled = true
  try {
    const status = await window.simplexsa.salvar({
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
  try { await window.simplexsa.testar($('impressora').value); toast('Teste enviado') }
  catch (e) { toast(`Erro: ${e.message}`) }
  finally { $('testar').disabled = false }
}

window.simplexsa.onStatus(render)
window.simplexsa.status().then(async (s) => { render(s); await carregarImpressoras() }).catch((e) => toast(`Erro: ${e.message}`))
