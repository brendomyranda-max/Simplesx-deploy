package br.com.simplesx.gestor.nfc

import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import br.com.simplesx.gestor.data.AppConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Leitor solicitado pelo navegador. Ao terminar, retorna à tela que o abriu. */
class NfcScanActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val request = runCatching { NfcScanRequest.parse(intent.dataString.orEmpty(), AppConfig(this).deployUrl) }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContent {
            MaterialTheme {
                val scope = rememberCoroutineScope()
                var status by androidx.compose.runtime.remember { mutableStateOf("Preparando NFC…") }
                var sending by androidx.compose.runtime.remember { mutableStateOf(false) }
                var uid by rememberSaveable { mutableStateOf<String?>(null) }
                var error by androidx.compose.runtime.remember { mutableStateOf(request.exceptionOrNull()?.message.orEmpty()) }
                fun send(readUid: String) {
                    if (sending || request.isFailure) return
                    uid = readUid
                    sending = true
                    error = ""
                    status = "Cartão identificado. Enviando à sua tela DoixP…"
                    scope.launch {
                        val result = withContext(Dispatchers.IO) { runCatching { publish(request.getOrThrow(), readUid) } }
                        sending = false
                        result.fold({ finish() }, { error = it.message ?: "Falha ao enviar o cartão. Confira a internet e tente novamente." })
                    }
                }
                LaunchedEffect(Unit) { uid?.let { send(it) } }
                DisposableEffect(Unit) {
                    val reader = if (request.isSuccess) NfcReader(this@NfcScanActivity,
                        onTag = { reading -> if (uid == null && !sending) send(reading.uid) },
                        onState = { if (!sending && uid == null) status = it.description },
                        onError = { error = it },
                    ) else null
                    runCatching { reader?.start() }.onFailure { error = it.message.orEmpty() }
                    onDispose { reader?.close() }
                }
                Column(Modifier.fillMaxSize().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(20.dp, Alignment.CenterVertically)) {
                    Text("Leitor NFC DoixP", style = MaterialTheme.typography.headlineSmall)
                    Text(status)
                    uid?.let { Text("Cartão: $it") }
                    if (sending) CircularProgressIndicator()
                    if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
                    if (uid != null && !sending && request.isSuccess) Button(onClick = { send(uid!!) }) { Text("Tentar enviar novamente") }
                    if (uid == null && request.isSuccess) OutlinedButton(onClick = {
                        runCatching { startActivity(Intent(Settings.ACTION_NFC_SETTINGS)) }.onFailure { error = "Ligue o NFC nas configurações do Android." }
                    }) { Text("Ligar NFC nas configurações") }
                    OutlinedButton(onClick = { finish() }, enabled = !sending) { Text("Voltar à DoixP") }
                    Text("O cartão só identifica a comanda. Aguarde a confirmação do pedido na tela web.", style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }

    private fun publish(request: NfcScanRequest, uid: String) {
        val connection = URL("${request.server}/api/nfc/solicitacoes/${request.id}/leitura").openConnection() as HttpURLConnection
        try {
            connection.instanceFollowRedirects = false
            connection.requestMethod = "POST"
            connection.connectTimeout = 10_000
            connection.readTimeout = 15_000
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            val body = JSONObject().put("token", request.token).put("uid", uid)
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            val json = runCatching { JSONObject(text) }.getOrElse { throw IllegalStateException("A DoixP retornou uma resposta inválida (HTTP $code).") }
            check(code in 200..299 && json.optBoolean("ok")) { json.optString("error", "Não foi possível entregar a leitura (HTTP $code)") }
        } finally { connection.disconnect() }
    }
}
