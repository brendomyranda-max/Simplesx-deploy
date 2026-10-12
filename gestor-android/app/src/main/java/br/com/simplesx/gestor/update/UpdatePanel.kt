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
import androidx.compose.runtime.DisposableEffect
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
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout

@Composable
fun UpdatePanel(activity: ComponentActivity, config: AppConfig) {
    val updater = remember { AppUpdater(activity) }
    val scope = rememberCoroutineScope()
    var release by remember { mutableStateOf<UpdateRelease?>(null) }
    var busy by remember { mutableStateOf(false) }
    var continueAfterPermission by rememberSaveable { mutableStateOf(false) }
    var permissionPending by rememberSaveable { mutableStateOf(false) }
    var message by remember { mutableStateOf("Busque uma nova versão sem desinstalar o servidor.") }
    fun resumeService() {
        if (config.resumeAfterUpdate) {
            config.resumeAfterUpdate = false
            config.updateTargetCode = 0
            PrintSyncService.start(activity)
        }
    }
    val installer = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        resumeService()
        busy = false
        message = if (result.resultCode == Activity.RESULT_OK) "Atualização instalada. Abra o servidor para conferir a nova versão."
            else result.data?.getStringExtra("error") ?: "Instalação não concluída. Toque em Atualizar servidor para tentar novamente e confirme Atualizar no Android."
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        permissionPending = false
        if (activity.packageManager.canRequestPackageInstalls()) continueAfterPermission = true
        else { busy = false; message = "Permissão não concedida. Toque em Atualizar servidor e autorize a instalação para continuar." }
    }

    DisposableEffect(activity) {
        val observer = LifecycleEventObserver { _,event ->
            if (event==Lifecycle.Event.ON_RESUME && permissionPending && activity.packageManager.canRequestPackageInstalls()) {
                permissionPending=false
                continueAfterPermission=true
            }
        }
        activity.lifecycle.addObserver(observer)
        onDispose { activity.lifecycle.removeObserver(observer) }
    }

    suspend fun update(reuseDownloaded: Boolean = false) {
        busy = true
        try {
            message = "Buscando a versão publicada e verificando o download…"
            val prepared = withContext(Dispatchers.IO) {
                prepareUpdateDownload(BuildConfig.VERSION_CODE,reuseDownloaded,updater::check,
                    cached = { updater.cachedRelease()?.let { UpdateDownload(it,updater.cachedApk()) } },
                    download = { updater.download(it) { percent -> activity.runOnUiThread { message = "Baixando atualização: $percent%" } } })
            }
            if (prepared == null) {
                message = "O servidor já está atualizado."
                busy = false
                return
            }
            val available = prepared.release
            val file = prepared.file
            release = available
            if (!activity.packageManager.canRequestPackageInstalls()) {
                message = "Autorize a instalação. Ao voltar, o instalador abrirá automaticamente."
                permissionPending = true
                permission.launch(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
            } else {
                withContext(Dispatchers.IO) { updater.validateApk(file, available) }
                message = "Finalizando impressões em andamento…"
                config.resumeAfterUpdate = config.serviceEnabled || config.resumeAfterUpdate
                config.updateTargetCode = available.versionCode
                if (config.serviceEnabled || PrintSyncService.isRunning) PrintSyncService.stop(activity)
                withTimeout(60_000) { while (PrintSyncService.isRunning) delay(250) }
                message = "Confirme a atualização no instalador do Android."
                installer.launch(Intent(activity, UpdateInstallActivity::class.java).putExtra("version",available.versionCode))
            }
        } catch (error: Exception) {
            resumeService()
            release = null
            message = "Não foi possível atualizar: ${error.message ?: "verifique a conexão e tente novamente"}"
            busy = false
        }
    }
    LaunchedEffect(continueAfterPermission) {
        if (continueAfterPermission) {
            update(reuseDownloaded = true)
            continueAfterPermission = false
        }
    }
    Text("Versão instalada: ${BuildConfig.VERSION_NAME}")
    Text(message)
    Button(enabled = !busy && !permissionPending, modifier = Modifier.fillMaxWidth(), onClick = { scope.launch { update() } }) { Text("Atualizar servidor") }
    if (release != null) {
        OutlinedButton(enabled = !busy, modifier = Modifier.fillMaxWidth(), onClick = { release = null; message = "Busque a versão publicada novamente." }) { Text("Buscar outra vez") }
    }
    Text("O Android pedirá confirmação para instalar. O pareamento, as impressoras e as configurações são preservados.")
}
