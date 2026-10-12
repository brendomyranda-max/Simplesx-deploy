package br.com.simplesx.gestor.update

import android.content.Intent
import android.app.Activity
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
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
    var continueAfterPermission by rememberSaveable { mutableStateOf(false) }
    var message by remember { mutableStateOf("Busque uma nova versão sem desinstalar o servidor.") }
    fun resumeService() {
        if (config.resumeAfterUpdate) {
            config.resumeAfterUpdate = false
            PrintSyncService.start(activity)
        }
    }
    val installer = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        resumeService()
        busy = false
        message = if (result.resultCode == Activity.RESULT_OK) "Atualização instalada. Abra o servidor para conferir a nova versão."
            else "Instalação não concluída. Toque em Atualizar servidor para tentar novamente e confirme Atualizar no Android."
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        if (activity.packageManager.canRequestPackageInstalls()) continueAfterPermission = true
        else { busy = false; message = "Permissão não concedida. Toque em Atualizar servidor e autorize a instalação para continuar." }
    }

    suspend fun update() {
        busy = true
        try {
            val available = release ?: withContext(Dispatchers.IO) { updater.cachedRelease() ?: updater.check() }
            if (available.versionCode <= BuildConfig.VERSION_CODE) {
                message = "O servidor já está atualizado."
                busy = false
                return
            }
            release = available
            message = "Baixando e verificando a atualização…"
            val file = apk ?: withContext(Dispatchers.IO) {
                if (updater.cachedRelease() == available) updater.cachedApk()
                else updater.download(available) { percent -> activity.runOnUiThread { message = "Baixando atualização: $percent%" } }
            }.also { apk = it }
            if (!activity.packageManager.canRequestPackageInstalls()) {
                message = "Autorize a instalação. Ao voltar, o instalador abrirá automaticamente."
                permission.launch(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
            } else {
                withContext(Dispatchers.IO) { updater.validateApk(file, available) }
                message = "Finalizando impressões em andamento…"
                config.resumeAfterUpdate = config.serviceEnabled || config.resumeAfterUpdate
                if (config.serviceEnabled || PrintSyncService.isRunning) PrintSyncService.stop(activity)
                withTimeout(60_000) { while (PrintSyncService.isRunning) delay(250) }
                message = "Confirme a atualização no instalador do Android."
                installer.launch(updater.installIntent(file))
            }
        } catch (error: Exception) {
            resumeService()
            apk = null
            release = null
            message = "Não foi possível atualizar: ${error.message ?: "verifique a conexão e tente novamente"}"
            busy = false
        }
    }
    LaunchedEffect(continueAfterPermission) {
        if (continueAfterPermission) {
            update()
            continueAfterPermission = false
        }
    }
    Text("Versão instalada: ${BuildConfig.VERSION_NAME}")
    Text(message)
    Button(enabled = !busy, modifier = Modifier.fillMaxWidth(), onClick = { scope.launch { update() } }) { Text("Atualizar servidor") }
    if (release != null) {
        OutlinedButton(enabled = !busy, modifier = Modifier.fillMaxWidth(), onClick = { release = null; apk = null; message = "Busque a versão publicada novamente." }) { Text("Buscar outra vez") }
    }
    Text("O Android pedirá confirmação para instalar. O pareamento, as impressoras e as configurações são preservados.")
}
