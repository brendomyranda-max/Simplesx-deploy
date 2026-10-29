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
  if ($('nfcAtivo').dataset.servidor !== String(!!status.nfcAtivo)) {
    $('nfcAtivo').checked = !!status.nfcAtivo
    $('nfcAtivo').dataset.servidor = String(!!status.nfcAtivo)
  }
  const prefixoServidor = status.nfcPrefixo || 'NFC:'
  if (document.activeElement !== $('nfcPrefixo') && $('nfcPrefixo').dataset.servidor !== prefixoServidor) {
    $('nfcPrefixo').value = prefixoServidor
    $('nfcPrefixo').dataset.servidor = prefixoServidor
  }
  $('nfcUltimo').textContent = status.ultimoNfc ? `${status.ultimoNfc.payload || status.ultimoNfc.uid} · ${dataHora(status.ultimoNfc.em)}` : 'Nenhuma'
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

function atualizarCamposImpressora() {
  const cupom = ['ESC_POS', 'DIEBOLD', 'ESC_BEMA', 'STAR_LINE'].includes($('protocolo').value)
  const diebold = $('protocolo').value === 'DIEBOLD'
  for (const option of $('cutMode').options) option.disabled = diebold && !['FULL', 'FEED_PARTIAL', 'NONE'].includes(option.value)
  $('cutMode').options[0].textContent = diebold ? 'Corte conforme configuração da Diebold' : 'Corte total'
  $('cutMode').options[3].textContent = diebold ? 'Corte com avanço otimizado (PD1.12+)' : 'Avançar e cortar parcial'
  if (diebold && ['PARTIAL', 'FEED_FULL'].includes($('cutMode').value)) $('cutMode').value = 'FULL'
  $('acabamentoCupom').hidden = !cupom
  $('midiaEtiqueta').hidden = !['TSPL', 'ZPL', 'CPCL', 'EPL'].includes($('protocolo').value)
  $('altura').disabled = cupom
  $('dpi').disabled = false
  $('alturaAjuda').textContent = cupom
    ? 'A altura acompanha o conteúdo. O DPI deve corresponder à cabeça da impressora para manter o tamanho escolhido em px.'
    : 'Deixe a altura vazia para acompanhar o conteúdo. Com altura fixa, textos longos continuam na próxima etiqueta mantendo a fonte.'
}
$('protocolo').onchange = atualizarCamposImpressora

function atualizarPreviaFonte() {
  $('previaFonte').style.fontSize = `${Math.max(6, Math.min(96, Number($('tamanhoFontePx').value) || 12))}px`
  $('previaFonte').style.fontFamily = $('modeloFonte').value
  $('previaFonte').style.fontWeight = $('fonteNegrito').checked ? '700' : '400'
}
for (const id of ['tamanhoFontePx', 'modeloFonte', 'fonteNegrito']) $(id).oninput = atualizarPreviaFonte

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
  const antiga = estado?.fontesImpressoras?.[nome]
  const tipografia = estado?.tipografiasImpressoras?.[nome] || { sizePx: antiga === 'small' ? 9 : antiga === 'large' ? 24 : 12, family: 'monospace', bold: false }
  $('tamanhoFontePx').value = tipografia.sizePx
  $('modeloFonte').value = tipografia.family
  $('fonteNegrito').checked = tipografia.bold
  $('larguraImprimivel').value = tipografia.printableWidthMm ?? ''
  atualizarPreviaFonte()
  const acabamento = estado?.acabamentosImpressoras?.[nome] || {}
  $('cutMode').value = acabamento.cutMode || 'FULL'
  $('feedLines').value = acabamento.feedLines ?? 3
  $('paperMode').value = acabamento.paperMode || 'CONTINUOUS'
  $('gapMm').value = acabamento.gapMm ?? 2
  atualizarCamposImpressora()
  $('larguraCustomLabel').hidden = $('larguraPreset').value !== 'custom'
  $('perfilImpressora').value = ''
  $('perfilAjuda').textContent = 'Confira a linguagem no autoteste. O perfil prepara os ajustes e só será salvo ao clicar em Salvar.'
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
    const sizePx = Number($('tamanhoFontePx').value)
    if (!Number.isFinite(sizePx) || sizePx < 6 || sizePx > 96) return toast('Informe o tamanho da fonte entre 6 e 96 px')
    const printableWidthMm = $('larguraImprimivel').value.trim() === '' ? null : Number($('larguraImprimivel').value)
    if (printableWidthMm !== null && (!Number.isFinite(printableWidthMm) || printableWidthMm < 10 || printableWidthMm > largura)) return toast('A largura imprimível deve ficar entre 10 mm e a largura do papel')
    const tipografia = { sizePx, family: $('modeloFonte').value, bold: $('fonteNegrito').checked, printableWidthMm }
    const acabamento = { cutMode: $('cutMode').value, feedLines: Number($('feedLines').value), paperMode: $('paperMode').value, gapMm: Number($('gapMm').value) }
    if (acabamento.paperMode !== 'CONTINUOUS' && altura === null && ['TSPL', 'ZPL', 'CPCL', 'EPL'].includes($('protocolo').value)) return toast('Informe a altura física da etiqueta')
    const status = await window.simplexsa.salvarImpressora(nome, largura, altura, $('protocolo').value, dpi, estado?.fontesImpressoras?.[nome] || 'normal', estado?.colunasImpressoras?.[nome] || null, acabamento, tipografia)
    render(status)
    $('tamanhoDialog').close()
    toast(`${nome}: ${largura} × ${altura ?? 'auto'} mm · ${sizePx} px · ${tipografia.family}${tipografia.bold ? ' · negrito' : ''} · ${dpi} DPI`)
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
      nfcAtivo: $('nfcAtivo').checked,
      nfcPrefixo: $('nfcPrefixo').value,
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

$('testarNfc').onclick = async () => {
  if ($('nfcAtivo').checked !== !!estado?.nfcAtivo || $('nfcPrefixo').value !== (estado?.nfcPrefixo || 'NFC:')) {
    toast('Salve a configuração antes de testar o NFC')
    return
  }
  $('testarNfc').disabled = true
  try {
    await window.simplexsa.lerNfc(`${estado.nfcPrefixo || 'NFC:'}TESTE1234`)
    toast('Leitura NFC enviada')
  } catch (e) {
    toast(`Erro: ${e.message}`)
  } finally {
    $('testarNfc').disabled = false
  }
}

let nfcBuffer = ''
let nfcUltimaTecla = 0
document.addEventListener('keydown', (event) => {
  if (!estado?.nfcAtivo) return
  const alvo = event.target
  if (alvo && ['INPUT', 'SELECT', 'TEXTAREA'].includes(alvo.tagName)) return
  const agora = Date.now()
  if (nfcUltimaTecla && agora - nfcUltimaTecla > 120) nfcBuffer = ''
  nfcUltimaTecla = agora
  if (event.key === 'Enter') {
    const texto = nfcBuffer
    nfcBuffer = ''
    const prefixo = estado.nfcPrefixo || 'NFC:'
    if (texto.startsWith(prefixo) && texto.length > prefixo.length) {
      event.preventDefault()
      window.simplexsa.lerNfc(texto).then(() => toast('Leitura NFC enviada')).catch((e) => toast(`Erro: ${e.message}`))
    }
    return
  }
  if (event.key.length === 1) nfcBuffer += event.key
})

window.simplexsa.onStatus(render)
function renderAtualizacao(status) {
  $('atualizacaoMensagem').textContent = status.message
  $('atualizarServidor').disabled = ['checking', 'downloading', 'downloaded', 'installing'].includes(status.phase)
  $('atualizarServidor').textContent = 'Atualizar servidor'
}
$('atualizarServidor').onclick = async () => {
  $('atualizarServidor').disabled = true
  try { renderAtualizacao(await window.simplexsa.atualizarServidor()) }
  catch (error) { toast(error.message); $('atualizarServidor').disabled = false }
}
window.simplexsa.onAtualizacao(renderAtualizacao)
window.simplexsa.atualizacaoStatus().then(renderAtualizacao).catch((error) => toast(error.message))
window.simplexsa.status().then(async (s) => { render(s); await carregarImpressoras() }).catch((e) => toast(`Erro: ${e.message}`))

let perfisImpressoras = []
window.simplexsa.listarPerfisImpressoras().then((profiles) => {
  perfisImpressoras = profiles
  for (const profile of profiles) {
    const option = document.createElement('option')
    option.value = profile.id
    option.textContent = profile.label
    $('perfilImpressora').appendChild(option)
  }
}).catch((error) => toast(`Não foi possível carregar perfis: ${error.message}`))
$('aplicarPerfil').onclick = () => {
  const profile = perfisImpressoras.find((p) => p.id === $('perfilImpressora').value)
  if (!profile) return toast('Escolha um perfil')
  $('protocolo').value = profile.protocol
  $('larguraPreset').value = [58, 76, 80, 100, 102].includes(profile.widthMm) ? String(profile.widthMm) : 'custom'
  $('larguraCustom').value = profile.widthMm
  $('larguraCustomLabel').hidden = $('larguraPreset').value !== 'custom'
  $('dpi').value = profile.dpi
  $('larguraImprimivel').value = profile.columnsNormal ? (profile.columnsNormal * 12 / profile.dpi * 25.4).toFixed(1) : ''
  $('cutMode').value = profile.cutMode
  $('feedLines').value = profile.feedLines
  $('perfilAjuda').textContent = profile.notes
  atualizarCamposImpressora()
  toast('Perfil aplicado. Confira os ajustes e clique em Salvar.')
}
