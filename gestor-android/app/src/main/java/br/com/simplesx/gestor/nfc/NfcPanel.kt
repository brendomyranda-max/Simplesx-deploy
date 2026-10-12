package br.com.simplesx.gestor.nfc

import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import br.com.simplesx.gestor.BuildConfig
import br.com.simplesx.gestor.data.AppConfig
import br.com.simplesx.gestor.network.SimplexsaApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun NfcPanel(activity: ComponentActivity, config: AppConfig, paired: Boolean, onOpenDoixP: () -> Unit,
    onReadInDoixP: (NfcTagReading) -> Boolean, onStatus: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    var enabled by remember { mutableStateOf(config.nfcEnabled) }
    var state by remember { mutableStateOf(NfcReaderState.OFF) }
    var testMode by rememberSaveable { mutableStateOf(false) }
    val testingNow by rememberUpdatedState(testMode)
    val pairedNow by rememberUpdatedState(paired)
    val readInDoixP by rememberUpdatedState(onReadInDoixP)
    var restart by remember { mutableStateOf(0) }
    var lastReading by remember { mutableStateOf<NfcTagReading?>(null) }
    var localStatus by remember { mutableStateOf("Aguardando cartão") }
    var deliveryStatus by remember { mutableStateOf("Nenhuma leitura enviada") }
    var terminalStatus by remember { mutableStateOf("Aguardando envio") }
    var connectionStatus by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var checkingConnection by remember { mutableStateOf(false) }
    var eventId by remember { mutableStateOf<Long?>(null) }
    var eventWasTest by remember { mutableStateOf(false) }

    LaunchedEffect(state, lastReading, deliveryStatus) {
        onStatus("NFC: ${state.description}" + (lastReading?.let { " · UID ${it.uid} · $deliveryStatus" } ?: ""))
    }

    DisposableEffect(activity, enabled, restart) {
        val reader = if (enabled) NfcReader(activity,
            onTag = onTag@{ reading ->
                if (sending) return@onTag
                val isTest = testingNow
                lastReading = reading
                localStatus = "OK · UID ${reading.uid} · ${reading.technologies.joinToString() }"
                eventId = null
                terminalStatus = "Aguardando envio"
                if (readInDoixP(reading)) {
                    deliveryStatus = "UID entregue à DoixP neste celular"
                    terminalStatus = "Confira a confirmação da comanda na tela de atendimento."
                    return@onTag
                }
                if (!pairedNow) {
                    deliveryStatus = "Leitura local OK. Pareie este aparelho para enviar ao DoixP."
                    return@onTag
                }
                sending = true
                deliveryStatus = if (isTest) "Enviando diagnóstico…" else "Enviando identificação…"
                scope.launch {
                    val result = withContext(Dispatchers.IO) {
                        runCatching {
                            val api = SimplexsaApi(config)
                            if (isTest) api.testNfc(reading.uid).getLong("id")
                            else api.postNfc(reading.uid).id
                        }
                    }
                    result.fold({ id ->
                        eventWasTest = isTest
                        eventId = id
                        deliveryStatus = "OK · ${if (isTest) "Diagnóstico" else "Leitura"} aceito pelo servidor"
                    }, {
                        deliveryStatus = "Falha no envio: ${it.message}"
                        terminalStatus = "A leitura não chegou ao servidor. Confira a conexão e o pareamento."
                    })
                    sending = false
                }
            },
            onState = { state = it },
            onError = { localStatus = it },
        ) else null
        if (reader != null) {
            activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            runCatching { reader.start() }.onFailure {
                state = NfcReaderState.ERROR
                localStatus = "Falha ao iniciar leitor: ${it.message}"
            }
        } else state = NfcReaderState.OFF
        onDispose {
            reader?.close()
            activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }

    LaunchedEffect(paired) {
        eventId = null
        connectionStatus = ""
    }

    LaunchedEffect(eventId, paired) {
        val id = eventId ?: return@LaunchedEffect
        if (!paired) return@LaunchedEffect
        terminalStatus = "Aguardando a tela DoixP que solicitou o cartão (até 60 segundos)…"
        val deadline = android.os.SystemClock.elapsedRealtime() + 60_000
        while (android.os.SystemClock.elapsedRealtime() < deadline) {
            val result = withContext(Dispatchers.IO) { runCatching { SimplexsaApi(config).nfcReceived(id) } }
            if (result.getOrNull() == true) {
                terminalStatus = if (eventWasTest) "OK · Teste recebido na tela DoixP. Nenhum pedido foi lançado."
                    else "OK · Leitura recebida na tela DoixP. Confira a confirmação do pedido nessa tela."
                return@LaunchedEffect
            }
            if (result.isFailure) {
                terminalStatus = "Falha ao conferir a chegada: ${result.exceptionOrNull()?.message}"
                return@LaunchedEffect
            }
            delay(2_000)
        }
        terminalStatus = "Servidor recebeu, mas nenhuma tela confirmou. Abra o DoixP na mesma conta e aproxime novamente."
    }

    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Column(Modifier.weight(1f)) {
            Text("Ativar cartões NFC", fontWeight = FontWeight.Bold)
            Text(state.description, style = MaterialTheme.typography.bodySmall)
        }
        Switch(enabled, onCheckedChange = { enabled = it; config.nfcEnabled = it })
    }
    Text("Identificação pelo UID do cartão. O texto gravado não é aberto nem enviado.", style = MaterialTheme.typography.bodySmall)
    Button(onClick = {
        enabled = true
        config.nfcEnabled = true
        testMode = false
        onOpenDoixP()
    }, enabled = !sending, modifier = Modifier.fillMaxWidth()) { Text("Abrir DoixP e usar cartões NFC") }
    OutlinedButton(onClick = {
        enabled = true
        config.nfcEnabled = true
        testMode = false
        restart += 1
        terminalStatus = "Na DoixP web, abra uma ação de cartão e selecione ${config.deviceName} em Onde aproximar o cartão."
    }, enabled = paired && !sending, modifier = Modifier.fillMaxWidth()) { Text("Usar como leitor para outro aparelho") }
    Text("Leitor compartilhado: ${config.deviceName}. Pareie na mesma conta, selecione este nome na web ou no PDA e deixe esta tela aberta e desbloqueada.", style = MaterialTheme.typography.bodySmall)
    Text("Dentro desta tela, o cartão usa o login da DoixP e não depende do serviço de impressão. Para enviar a leitura a outro aparelho, pareie este servidor. Mantenha a tela interna aberta para ler cartões.", style = MaterialTheme.typography.bodySmall)
    Text("${Build.MANUFACTURER} ${Build.MODEL} · Android ${Build.VERSION.RELEASE} · Servidor ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.bodySmall)
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(onClick = {
            runCatching { activity.startActivity(Intent(Settings.ACTION_NFC_SETTINGS)) }
                .onFailure { localStatus = "Abra Configurações → Conexões → NFC no celular." }
        }, modifier = Modifier.weight(1f)) { Text("Configurações NFC") }
        OutlinedButton(onClick = { restart += 1 }, enabled = enabled && !sending,
            modifier = Modifier.weight(1f)) { Text("Reiniciar leitor") }
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Column(Modifier.weight(1f)) {
            Text("Modo de teste (sem pedidos)", fontWeight = FontWeight.Bold)
            Text(if (testMode) "Teste ligado. Desligue para usar comandas." else "Leituras enviadas para o atendimento.",
                style = MaterialTheme.typography.bodySmall)
        }
        Switch(testMode, enabled = !sending, onCheckedChange = { testMode = it })
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Button(onClick = {
            testMode = true
            enabled = true
            config.nfcEnabled = true
            lastReading = null
            eventId = null
            localStatus = "Aproxime o cartão para testar a leitura"
            deliveryStatus = "Aguardando cartão"
            terminalStatus = "Deixe o sistema web aberto na mesma conta"
            restart += 1
        }, enabled = !sending, modifier = Modifier.weight(1f)) { Text("Testar cartão") }
        OutlinedButton(onClick = {
            checkingConnection = true
            connectionStatus = "Conferindo conexão…"
            scope.launch {
                val result = withContext(Dispatchers.IO) { runCatching { SimplexsaApi(config).testNfc() } }
                connectionStatus = result.fold({ "Conexão OK · ${it.optString("estabelecimento")}" },
                    { "Falha na conexão: ${it.message}" })
                checkingConnection = false
            }
        }, enabled = paired && !checkingConnection && !sending,
            modifier = Modifier.weight(1f)) { Text(if (checkingConnection) "Testando…" else "Testar conexão") }
    }
    if (connectionStatus.isNotBlank()) Text(connectionStatus, style = MaterialTheme.typography.bodySmall)
    Text("1. Cartão no celular: $localStatus", style = MaterialTheme.typography.bodySmall)
    Text("2. Envio ao DoixP: $deliveryStatus", style = MaterialTheme.typography.bodySmall)
    Text("3. Chegada à tela: $terminalStatus", style = MaterialTheme.typography.bodySmall)
    lastReading?.let { Text("Último UID: ${it.uid}", fontWeight = FontWeight.Bold) }
    Text("Mantenha o Servidor ou a DoixP aberta dentro dele na tela, com o celular desbloqueado. Ao trocar para Chrome ou outro app, o Android pausa este leitor e pode abrir o texto do cartão.",
        style = MaterialTheme.typography.bodySmall)
    Text("Para atender, desligue o modo de teste, abra Mesas → Adicionar com cartão ou Lançar para cartão e aguarde a aproximação.",
        style = MaterialTheme.typography.bodySmall)
}
