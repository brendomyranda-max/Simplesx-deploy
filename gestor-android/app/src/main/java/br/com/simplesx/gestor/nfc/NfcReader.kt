/**
 * Arquivo: NfcReader.kt
 * Responsabilidade: Lê a identificação e o texto de uma tag NFC enquanto o Gestor está aberto.
 */

package br.com.simplesx.gestor.nfc

import android.app.Activity
import android.nfc.NdefRecord
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.nfc.tech.Ndef
import android.os.Bundle

class NfcReader(
    private val activity: Activity,
    private val onTag: (uid: String, payload: String) -> Unit,
) {
    private val adapter: NfcAdapter? = NfcAdapter.getDefaultAdapter(activity)
    val available: Boolean get() = adapter != null
    val enabled: Boolean get() = adapter?.isEnabled == true

    fun start() {
        adapter?.enableReaderMode(
            activity,
            { tag -> deliver(tag) },
            NfcAdapter.FLAG_READER_NFC_A or NfcAdapter.FLAG_READER_NFC_B or
                NfcAdapter.FLAG_READER_NFC_F or NfcAdapter.FLAG_READER_NFC_V or
                NfcAdapter.FLAG_READER_NFC_BARCODE,
            Bundle(),
        )
    }

    fun stop() {
        adapter?.disableReaderMode(activity)
    }

    private fun deliver(tag: Tag) {
        val uid = tag.id.joinToString("") { byte -> "%02X".format(byte) }
        val payload = readText(tag).ifBlank { uid }
        activity.runOnUiThread { onTag(uid, payload) }
    }

    private fun readText(tag: Tag): String {
        val message = Ndef.get(tag)?.cachedNdefMessage ?: return ""
        return message.records.firstNotNullOfOrNull { recordText(it) }.orEmpty()
    }

    private fun recordText(record: NdefRecord): String? {
        if (record.tnf != NdefRecord.TNF_WELL_KNOWN || !record.type.contentEquals(NdefRecord.RTD_TEXT)) return null
        val bytes = record.payload
        if (bytes.isEmpty()) return null
        val languageLength = bytes[0].toInt() and 0x3F
        val encoding = if (bytes[0].toInt() and 0x80 == 0) Charsets.UTF_8 else Charsets.UTF_16
        val start = 1 + languageLength
        if (start > bytes.size) return null
        return bytes.copyOfRange(start, bytes.size).toString(encoding).trim()
    }
}
