/**
 * Arquivo: PrintSyncService.kt
 * Responsabilidade: Mantém heartbeat, busca tarefas e informa o resultado da impressão.
 */

package br.com.simplesx.gestor.sync

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import br.com.simplesx.gestor.MainActivity
import br.com.simplesx.gestor.data.AppConfig
import br.com.simplesx.gestor.data.PrinterConfig
import br.com.simplesx.gestor.data.PrinterProtocol
import br.com.simplesx.gestor.network.DeviceTask
import br.com.simplesx.gestor.network.SimplexsaApi
import br.com.simplesx.gestor.print.EscPos
import br.com.simplesx.gestor.print.PrinterCommands
import br.com.simplesx.gestor.print.PrinterTransport
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.File

class PrintSyncService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var loop: Job? = null
    private lateinit var config: AppConfig
    private var wakeLock: PowerManager.WakeLock? = null
    private var forgetPairingOnStop = false
    private var foregroundReady = false

    override fun onCreate() {
        super.onCreate()
        config = AppConfig(this)
        try {
            createChannel()
            // A conexão contínua com impressoras é connectedDevice. dataSync
            // tem limite de duração e não pode iniciar no boot no Android 15.
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification("Conectando à DoixP…"),
                if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE else 0)
            wakeLock = getSystemService(PowerManager::class.java)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "DoixP:PrintSync")
                .apply { acquire() }
            foregroundReady = true
        } catch (error: RuntimeException) {
            recordStartFailure(config, error)
            stopSelf()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!foregroundReady) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (intent?.action == ACTION_STOP) {
            config.serviceEnabled = false
            forgetPairingOnStop = intent.getBooleanExtra("forget_pairing", false)
            config.lastStatus = "Desconectando…"
        }
        if (loop?.isActive != true) loop = scope.launch { syncLoop() }
        return if (config.serviceEnabled) START_STICKY else START_NOT_STICKY
    }

    private suspend fun syncLoop() {
        var heartbeatCounter = 0
        // A impressão pode bloquear por mais tempo que o polling. Mantenha a
        // sessão enquanto termina os trabalhos, inclusive ao desconectar.
        val heartbeat = scope.launch {
            while (isActive) {
                delay(20_000)
                runCatching { SimplexsaApi(config).heartbeat() }
            }
        }
        while (scope.isActive && config.serviceEnabled) {
            var receivedTasks = false
            try {
                check(config.deviceToken.isNotBlank()) { "Pareie este aparelho com a DoixP" }
                val api = SimplexsaApi(config)
                if (heartbeatCounter++ % 5 == 0) api.heartbeat()
                val tasks = api.pullTasks()
                receivedTasks = tasks.isNotEmpty()
                config.lastStatus = "Online"
                updateNotification(if (tasks.isEmpty()) "Online · aguardando trabalhos" else "${tasks.size} trabalho(s) recebido(s)")
                tasks.forEach { executeTask(api, it) }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                config.lastStatus = "Erro: ${error.message ?: "falha de conexão"}"
                updateNotification(config.lastStatus)
            }
            if (!receivedTasks) delay(3_000)
        }
        heartbeat.cancelAndJoin()
        val disconnected = runCatching {
            if (config.deviceToken.isNotBlank()) SimplexsaApi(config).heartbeat("disconnected")
        }.isSuccess
        if (forgetPairingOnStop) {
            config.deviceToken = ""
            config.tokenExpiresAt = ""
        }
        config.lastStatus = if (disconnected) "Desconectado" else "Recepção parada. A sessão expira após 90 segundos sem contato."
        stopSelf()
    }

    private suspend fun executeTask(api: SimplexsaApi, task: DeviceTask) {
        var renewal: Job? = null
        try {
            if (api.taskStatus(task, "processing") != "processing") return
            renewal = scope.launch {
                while (isActive) {
                    delay(30_000)
                    runCatching { api.taskStatus(task, "processing") }
                }
            }
            val route = task.payload.optStringAny("printer", "impressora")
            var printerName = route
            val result = PrintJournal(File(filesDir, "print-journal")).execute("${config.deployUrl}:${config.deviceId}:${task.id}") {
                // Erros de configuração também precisam de confirmação final;
                // caso contrário a tarefa volta indefinidamente à fila.
                val printer = config.printerFor(route)
                printerName = printer.name
                val copies = task.payload.optIntAny("copies", "copias", default = 1).coerceIn(1, 20)
                val bytes = taskBytes(task, printer, copies)
                if (printer.protocol == PrinterProtocol.ESC_POS) repeat(copies) { PrinterTransport.send(this, printer, bytes) }
                else PrinterTransport.send(this, printer, bytes)
            }
            renewal.cancelAndJoin()
            if (result.success) {
                api.taskStatus(task, "success", resultPrinter = printerName)
                config.lastJob = "${task.type} → ${printerName.ifBlank { "padrão" }} · concluído"
            } else {
                api.taskStatus(task, "failed", "PRINT_CHECK_REQUIRED", result.error)
                config.lastJob = "${task.type} · conferir: ${result.error}"
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            val message = error.message ?: error.javaClass.simpleName
            config.lastJob = "${task.type} · confirmação pendente: $message"
        } finally {
            renewal?.cancelAndJoin()
        }
    }

    private fun taskBytes(task: DeviceTask, printer: PrinterConfig, copies: Int): ByteArray {
        if (task.type == "OPEN_CASH_DRAWER") {
            require(printer.protocol == PrinterProtocol.ESC_POS) { "Abertura de gaveta requer uma rota ESC/POS" }
            return EscPos.openDrawer()
        }
        val payload = task.payload
        val content = payload.optStringAny("content", "conteudo", "text", "texto")
        val fallback = if (task.type == "TEST_PRINTER") "DOIXP - TESTE DE IMPRESSAO\nConexao com o Servidor Android OK" else ""
        require(content.isNotBlank() || fallback.isNotBlank()) { "Trabalho sem conteúdo de impressão" }
        val cut = payload.optBooleanAny("cut", "cortar", default = true)
        val feed = payload.optIntAny("feed", "alimentar", default = 3)
        val text = content.ifBlank { fallback }
        return PrinterCommands.document(text, printer, copies, feed, cut, centered = task.type == "PRINT_LABEL")
    }

    private fun JSONObject.optStringAny(vararg keys: String): String {
        for (key in keys) if (has(key) && !isNull(key)) return optString(key)
        return ""
    }

    private fun JSONObject.optIntAny(vararg keys: String, default: Int): Int {
        for (key in keys) if (has(key) && !isNull(key)) return optInt(key, default)
        return default
    }

    private fun JSONObject.optBooleanAny(vararg keys: String, default: Boolean): Boolean {
        for (key in keys) if (has(key) && !isNull(key)) return optBoolean(key, default)
        return default
    }

    private fun createChannel() {
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Serviço de impressão", NotificationManager.IMPORTANCE_LOW)
        )
    }

    private fun notification(text: String) = NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(android.R.drawable.ic_menu_info_details)
        .setContentTitle("Servidor DoixP ativo")
        .setContentText(text)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setSilent(true)
        .setContentIntent(PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE))
        .build()

    private fun updateNotification(text: String) {
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification(text))
    }

    override fun onDestroy() {
        scope.cancel()
        // O Bluetooth pode estar conectando ou enviando. Nunca espere seu lock
        // na thread principal, pois isso causa o popup "aplicativo não responde".
        CoroutineScope(Dispatchers.IO).launch { PrinterTransport.closeConnections() }
        wakeLock?.takeIf { it.isHeld }?.release()
        wakeLock = null
        super.onDestroy()
    }

    override fun onTimeout(startId: Int, fgsType: Int) {
        config.serviceEnabled = false
        config.lastStatus = "Recepção parada pelo Android. Abra o Servidor DoixP e ative Receber impressões."
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }
    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val CHANNEL_ID = "simplesx_print_sync"
        private const val NOTIFICATION_ID = 8410
        private const val ACTION_STOP = "br.com.simplesx.gestor.STOP"

        private fun recordStartFailure(config: AppConfig, error: RuntimeException) {
            config.serviceEnabled = false
            config.lastStatus = "Recepção parada. Abra o Servidor DoixP e ative Receber impressões. Detalhe: ${error.message ?: error.javaClass.simpleName}"
            Log.e("PrintSyncService", "Não foi possível iniciar a recepção", error)
        }

        fun start(context: Context): Boolean {
            val config = AppConfig(context)
            if (config.deviceToken.isBlank()) {
                config.serviceEnabled = false
                config.lastStatus = "Pareie este aparelho com a DoixP"
                return false
            }
            config.serviceEnabled = true
            return try {
                context.startForegroundService(Intent(context, PrintSyncService::class.java))
                true
            } catch (error: RuntimeException) {
                recordStartFailure(config, error)
                false
            }
        }

        fun stop(context: Context, forgetPairing: Boolean = false) {
            val config = AppConfig(context)
            config.serviceEnabled = false
            try {
                context.startForegroundService(Intent(context, PrintSyncService::class.java)
                    .setAction(ACTION_STOP).putExtra("forget_pairing", forgetPairing))
            } catch (error: RuntimeException) {
                recordStartFailure(config, error)
                // Preserve a credencial até concluir os trabalhos e liberar a sessão.
                config.lastStatus = "Recepção parada. Abra o gestor e tente desconectar novamente. A sessão expira após 90 segundos sem contato."
            }
        }
    }
}
