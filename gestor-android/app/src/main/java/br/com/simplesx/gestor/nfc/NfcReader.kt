/** Lê somente o UID, sem abrir nem interpretar o texto gravado no cartão. */
package br.com.simplesx.gestor.nfc

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.os.Bundle
import android.os.SystemClock
import androidx.activity.ComponentActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner

class NfcReader(
    private val activity: ComponentActivity,
    private val onTag: (NfcTagReading) -> Unit,
    private val onState: (NfcReaderState) -> Unit,
    private val onError: (String) -> Unit,
) : DefaultLifecycleObserver {
    private val adapter = runCatching { NfcAdapter.getDefaultAdapter(activity) }.getOrNull()
    private val gate = NfcReadGate()
    private var attached = false
    private var active = false
    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == NfcAdapter.ACTION_ADAPTER_STATE_CHANGED) refresh()
        }
    }

    fun start() {
        if (attached) return
        ContextCompat.registerReceiver(activity, receiver,
            IntentFilter(NfcAdapter.ACTION_ADAPTER_STATE_CHANGED), ContextCompat.RECEIVER_EXPORTED)
        attached = true
        activity.lifecycle.addObserver(this)
        refresh()
    }

    override fun onResume(owner: LifecycleOwner) = refresh()

    override fun onPause(owner: LifecycleOwner) {
        stopHardware()
        onState(NfcReaderState.PAUSED)
    }

    private fun refresh() {
        val state = nfcReaderState(adapter != null, adapter?.isEnabled == true,
            activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED))
        if (state != NfcReaderState.READY) {
            stopHardware()
            onState(state)
            return
        }
        runCatching {
            if (!active) {
                adapter?.enableReaderMode(activity, { tag -> deliver(tag) },
                    NfcAdapter.FLAG_READER_NFC_A or NfcAdapter.FLAG_READER_NFC_B or
                        NfcAdapter.FLAG_READER_NFC_F or NfcAdapter.FLAG_READER_NFC_V or
                        NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK,
                    Bundle().apply { putInt(NfcAdapter.EXTRA_READER_PRESENCE_CHECK_DELAY, 250) })
                active = true
            }
        }.fold({ onState(NfcReaderState.READY) }, {
            active = false
            onState(NfcReaderState.ERROR)
            onError("Falha ao iniciar NFC: ${it.message}")
        })
    }

    private fun deliver(tag: Tag) {
        val reading = runCatching {
            NfcTagReading(nfcUid(tag.id), tag.techList.map { it.substringAfterLast('.') })
        }
        activity.runOnUiThread {
            if (!active || !attached) return@runOnUiThread
            reading.fold({
                if (gate.accept(it.uid, SystemClock.elapsedRealtime())) onTag(it)
            }, { onError(it.message ?: "Não foi possível identificar o cartão") })
        }
    }

    private fun stopHardware() {
        if (active) runCatching { adapter?.disableReaderMode(activity) }
        active = false
    }

    fun close() {
        if (!attached) return
        attached = false
        activity.lifecycle.removeObserver(this)
        activity.unregisterReceiver(receiver)
        stopHardware()
    }
}
