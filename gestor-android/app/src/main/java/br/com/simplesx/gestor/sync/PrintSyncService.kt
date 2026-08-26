package br.com.simplesx.gestor.sync

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat
import br.com.simplesx.gestor.MainActivity
import br.com.simplesx.gestor.data.AppConfig
import br.com.simplesx.gestor.data.PrinterConfig
import br.com.simplesx.gestor.data.PrinterProtocol
import br.com.simplesx.gestor.network.DeviceTask
import br.com.simplesx.gestor.network.SimplesXApi
import br.com.simplesx.gestor.print.EscPos
import br.com.simplesx.gestor.print.PrinterTransport
import br.com.simplesx.gestor.print.Tspl
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject

class PrintSyncService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var loop: Job? = null
    private lateinit var config: AppConfig

    override fun onCreate() {
        super.onCreate()
        config = AppConfig(this)
        createChannel()
        startForeground(NOTIFICATION_ID, notification("Conectando ao SimplesX…"))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (loop?.isActive != true) loop = scope.launch { syncLoop() }
        return START_STICKY
    }

    private suspend fun syncLoop() {
        var heartbeatCounter = 0
        while (scope.isActive && config.serviceEnabled) {
            try {
                check(config.deviceToken.isNotBlank()) { "Pareie este aparelho com o SimplesX" }
                val api = SimplesXApi(config)
                if (heartbeatCounter++ % 5 == 0) api.heartbeat()
                val tasks = api.pullTasks()
                config.lastStatus = "Online"
                updateNotification(if (tasks.isEmpty()) "Online · aguardando trabalhos" else "${tasks.size} trabalho(s) recebido(s)")
                tasks.forEach { executeTask(api, it) }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                config.lastStatus = "Erro: ${error.message ?: "falha de conexão"}"
                updateNotification(config.lastStatus)
            }
            delay(3_000)
        }
        stopSelf()
    }

    private fun executeTask(api: SimplesXApi, task: DeviceTask) {
        try {
            api.taskStatus(task, "processing")
            val route = task.payload.optStringAny("printer", "impressora")
            val printer = config.printerFor(route)
            val copies = task.payload.optIntAny("copies", "copias", default = 1).coerceIn(1, 20)
            val bytes = taskBytes(task, printer, copies)
            if (printer.protocol == PrinterProtocol.TSPL) PrinterTransport.send(this, printer, bytes)
            else repeat(copies) { PrinterTransport.send(this, printer, bytes) }
            api.taskStatus(task, "success", resultPrinter = printer.name)
            config.lastJob = "${task.type} → ${printer.name} · concluído"
        } catch (error: Exception) {
            val message = error.message ?: error.javaClass.simpleName
            runCatching { api.taskStatus(task, "failed", "PRINT_ERROR", message) }
            config.lastJob = "${task.type} · erro: $message"
        }
    }

    private fun taskBytes(task: DeviceTask, printer: PrinterConfig, copies: Int): ByteArray {
        if (task.type == "OPEN_CASH_DRAWER") {
            require(printer.protocol == PrinterProtocol.ESC_POS) { "Abertura de gaveta requer uma rota ESC/POS" }
            return EscPos.openDrawer()
        }
        val payload = task.payload
        val content = payload.optStringAny("content", "conteudo", "text", "texto")
        val fallback = if (task.type == "TEST_PRINTER") "SIMPLESX - TESTE DE IMPRESSAO\nConexao com o Gestor Android OK" else ""
        require(content.isNotBlank() || fallback.isNotBlank()) { "Trabalho sem conteúdo de impressão" }
        val cut = payload.optBooleanAny("cut", "cortar", default = true)
        val feed = payload.optIntAny("feed", "alimentar", default = 3)
        val text = content.ifBlank { fallback }
        return if (printer.protocol == PrinterProtocol.TSPL) Tspl.label(
            text, printer.widthMm, copies, printer.tsplPaperMode, printer.labelHeightMm, printer.gapMm,
        )
        else EscPos.ticket(text, feed, cut, printer.widthMm)
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
        .setContentTitle("SimplesX Gestor ativo")
        .setContentText(text)
        .setOngoing(true)
        .setContentIntent(PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE))
        .build()

    private fun updateNotification(text: String) {
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification(text))
    }

    override fun onDestroy() { scope.cancel(); super.onDestroy() }
    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val CHANNEL_ID = "simplesx_print_sync"
        private const val NOTIFICATION_ID = 8410

        fun start(context: Context) {
            val config = AppConfig(context)
            config.serviceEnabled = true
            context.startForegroundService(Intent(context, PrintSyncService::class.java))
        }

        fun stop(context: Context) {
            AppConfig(context).serviceEnabled = false
            context.stopService(Intent(context, PrintSyncService::class.java))
        }
    }
}
