package br.com.simplesx.gestor.nfc

data class NfcTagReading(val uid: String, val technologies: List<String>)

enum class NfcReaderState(val description: String) {
    OFF("Leitura de cartões desligada neste aplicativo"),
    UNAVAILABLE("Este aparelho não tem leitor NFC"),
    SYSTEM_DISABLED("Ligue o NFC nas configurações do Android"),
    PAUSED("Volte ao Servidor DoixP para ler o cartão"),
    READY("Leitor pronto. Aproxime o cartão com esta tela aberta"),
    ERROR("Não foi possível iniciar o leitor NFC"),
}

fun nfcReaderState(available: Boolean, enabled: Boolean, resumed: Boolean): NfcReaderState = when {
    !available -> NfcReaderState.UNAVAILABLE
    !enabled -> NfcReaderState.SYSTEM_DISABLED
    !resumed -> NfcReaderState.PAUSED
    else -> NfcReaderState.READY
}

fun nfcUid(bytes: ByteArray): String {
    require(bytes.isNotEmpty()) { "O cartão não forneceu uma identificação NFC" }
    return bytes.joinToString("") { byte -> "%02X".format(byte.toInt() and 0xFF) }
}

class NfcReadGate {
    private var lastUid = ""
    private var lastAt = 0L

    fun accept(uid: String, elapsedMs: Long): Boolean {
        if (uid == lastUid && elapsedMs - lastAt in 0L until 2_000L) return false
        lastUid = uid
        lastAt = elapsedMs
        return true
    }
}
