package br.com.simplesx.gestor.update

import android.app.Activity
import android.app.ActivityOptions
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.addCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.lifecycleScope
import br.com.simplesx.gestor.MainActivity
import br.com.simplesx.gestor.data.AppConfig
import br.com.simplesx.gestor.sync.PrintSyncService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Mantém uma tela visível enquanto o Android confirma a substituição do APK. */
class UpdateInstallActivity : ComponentActivity() {
    private var sessionId = -1
    private var expectedCode = 0
    private var confirmation: Intent? = null
    private var message by mutableStateOf("Preparando a instalação da nova versão…")
    private val confirm = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        // O resultado definitivo vem da sessão, não do fechamento da tela de confirmação.
        message = "Aguardando o resultado da instalação no Android…"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        onBackPressedDispatcher.addCallback(this) { fail("Instalação cancelada. Toque em Atualizar servidor para tentar novamente.") }
        sessionId = savedInstanceState?.getInt("session", -1) ?: -1
        expectedCode = savedInstanceState?.getInt("version", 0) ?: intent.getIntExtra("version", 0)
        @Suppress("DEPRECATION")
        confirmation = savedInstanceState?.getParcelable("confirmation")
        setContent {
            MaterialTheme { Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text("Atualizar Servidor DoixP", style = MaterialTheme.typography.titleLarge)
                Text(message)
                if (confirmation != null) Button(onClick = { openConfirmation() }) { Text("Confirmar instalação no Android") }
                Button(onClick = { fail("Instalação cancelada. Sua versão e suas configurações foram preservadas.") }) { Text("Voltar ao servidor") }
            } }
        }
        if (intent.hasExtra(PackageInstaller.EXTRA_STATUS)) handleResult(intent)
        else {
            val session = if (sessionId==-1) null else packageManager.packageInstaller.getSessionInfo(sessionId)
            if (session==null || !session.isSealed) {
                if (sessionId!=-1) runCatching { packageManager.packageInstaller.abandonSession(sessionId) }
                prepare()
            } else message = "Aguardando confirmação da instalação no Android…"
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putInt("session", sessionId)
        outState.putInt("version", expectedCode)
        outState.putParcelable("confirmation", confirmation)
        super.onSaveInstanceState(outState)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleResult(intent)
    }

    private fun prepare() = lifecycleScope.launch {
        try {
            check(packageManager.canRequestPackageInstalls()) { "Autorize a instalação nas configurações do Android e tente novamente." }
            withContext(Dispatchers.IO) {
                val updater = AppUpdater(this@UpdateInstallActivity)
                val release = updater.cachedRelease() ?: error("Baixe novamente a atualização validada.")
                expectedCode = release.versionCode
                val file = updater.cachedApk()
                updater.validateApk(file, release)
                val installer = packageManager.packageInstaller
                val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
                    setAppPackageName(packageName)
                    setSize(file.length())
                    if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED)
                }
                sessionId = installer.createSession(params)
                installer.openSession(sessionId).use { session ->
                    session.openWrite("base.apk", 0, file.length()).use { output ->
                        file.inputStream().use { it.copyTo(output) }
                        session.fsync(output)
                    }
                    val callback = Intent(this@UpdateInstallActivity, UpdateInstallActivity::class.java)
                        .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                        .putExtra("version", expectedCode)
                    val flags = PendingIntent.FLAG_UPDATE_CURRENT or if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0
                    val options = if (Build.VERSION.SDK_INT >= 35) ActivityOptions.makeBasic()
                        .setPendingIntentCreatorBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED).toBundle() else null
                    session.commit(PendingIntent.getActivity(this@UpdateInstallActivity, sessionId, callback, flags, options).intentSender)
                }
            }
        } catch (error: Exception) { fail(error.message ?: "O Android não conseguiu iniciar a instalação.") }
    }

    private fun handleResult(result: Intent) {
        sessionId = result.getIntExtra(PackageInstaller.EXTRA_SESSION_ID, sessionId)
        expectedCode = result.getIntExtra("version", expectedCode)
        when (result.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION")
                val action = result.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
                if (action == null) { fail("O Android não forneceu a tela de confirmação."); return }
                confirmation = action
                message = "Confirme Atualizar na tela do Android para substituir a versão atual."
                openConfirmation()
            }
            PackageInstaller.STATUS_SUCCESS -> {
                setResult(Activity.RESULT_OK)
                startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK))
                finish()
            }
            else -> fail(result.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "Instalação recusada pelo Android. Tente novamente.")
        }
    }

    private fun openConfirmation() {
        confirmation?.let { action ->
            runCatching { confirm.launch(action) }.onFailure { fail("Não foi possível abrir a confirmação: ${it.message}") }
        }
    }

    private fun fail(detail: String) {
        if (sessionId != -1) runCatching { packageManager.packageInstaller.abandonSession(sessionId) }
        val config = AppConfig(this)
        if (config.resumeAfterUpdate) {
            config.resumeAfterUpdate = false
            config.updateTargetCode = 0
            PrintSyncService.start(this)
        }
        setResult(Activity.RESULT_CANCELED, Intent().putExtra("error", detail))
        finish()
    }
}
