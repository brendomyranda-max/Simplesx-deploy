package br.com.simplesx.gestor.sync

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import br.com.simplesx.gestor.data.AppConfig

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (AppConfig(context).serviceEnabled) PrintSyncService.start(context)
    }
}
