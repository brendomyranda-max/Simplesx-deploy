/**
 * Arquivo: BootReceiver.kt
 * Responsabilidade: Reativa a sincronização de impressão após o Android iniciar.
 */

package br.com.simplesx.gestor.sync

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import br.com.simplesx.gestor.data.AppConfig

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action !in setOf(Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED)) return
        val config = AppConfig(context)
        if (config.serviceEnabled && config.deviceToken.isNotBlank()) PrintSyncService.start(context)
    }
}
