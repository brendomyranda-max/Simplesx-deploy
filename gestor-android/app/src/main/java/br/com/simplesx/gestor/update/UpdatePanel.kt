package br.com.simplesx.gestor.update

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import br.com.simplesx.gestor.BuildConfig
import br.com.simplesx.gestor.data.AppConfig
import br.com.simplesx.gestor.sync.PrintSyncService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import java.io.File

@Composable
fun UpdatePanel(activity: ComponentActivity, config: AppConfig) {
    val updater = remember { AppUpdater(activity) }
    val scope = rememberCoroutineScope()
    var release by remember { mutableStateOf<UpdateRelease?>(null) }
    var apk by remember { mutableStateOf<File?>(null) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("Busque uma nova versão sem desinstalar o servidor.") }
    fun resumeService() {
        if (config.resumeAfterUpdate) {
            config.resumeAfterUpdate = false
            PrintSyncService.start(activity)
        }
    }
    val installer = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        resumeService()
        busy = false
        message = "Instalador fechado. Você pode buscar atualizações novamente."
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        message = if (activity.packageManager.canRequestPackageInstalls()) "Permissão concedida. Toque em Atualizar servidor."
        else "Autorize este servidor a instalar a atualização nas configurações do Android."
    }
    Text("Versão instalada: ${BuildConfig.VERSION_NAME}")
    Text(message)
    Button(enabled = !busy, modifier = Modifier.fillMaxWidth(), onClick = {
        scope.launch {
            busy = true
            try {
                val file = apk
                val available = release
                if (file != null && available != null) {
                    if (!activity.packageManager.canRequestPackageInstalls()) {
                        permission.launch(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
                        busy = false
                    } else {
                        withContext(Dispatchers.IO) { updater.validateApk(file, available) }
                        message = "Finalizando impressões em andamento…"
                        config.resumeAfterUpdate = config.serviceEnabled || config.resumeAfterUpdate
                        if (config.serviceEnabled || PrintSyncService.isRunning) PrintSyncService.stop(activity)
                        withTimeout(60_000) { while (PrintSyncService.isRunning) delay(250) }
                        message = "Confirme a atualização no instalador do Android."
                        installer.launch(updater.installIntent(file))
                    }
                } else if (available != null) {
                    message = "Baixando atualização…"
                    apk = withContext(Dispatchers.IO) {
                        updater.download(available) { percent -> activity.runOnUiThread { message = "Baixando atualização: $percent%" } }
                    }
                    message = "Versão ${available.version} pronta para instalar."
                    busy = false
                } else {
                    message = "Buscando atualizações…"
                    val latest = withContext(Dispatchers.IO) { updater.check() }
                    if (latest.versionCode > BuildConfig.VERSION_CODE) {
                        release = latest
                        message = "Versão ${latest.version} disponível."
                    } else { message = "O servidor já está atualizado." }
                    busy = false
                }
            } catch (error: Exception) {
                resumeService()
                message = "Não foi possível atualizar: ${error.message ?: "verifique a conexão e tente novamente"}"
                busy = false
            }
        }
    }) { Text(if (apk != null) "Atualizar servidor" else if (release != null) "Baixar atualização" else "Buscar atualizações") }
    if (release != null) {
        OutlinedButton(enabled = !busy, modifier = Modifier.fillMaxWidth(), onClick = { release = null; apk = null; message = "Busque a versão publicada novamente." }) { Text("Buscar outra vez") }
    }
    Text("O Android pedirá confirmação para instalar. O pareamento, as impressoras e as configurações são preservados.")
}
