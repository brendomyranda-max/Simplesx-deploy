package br.com.simplesx.gestor.web

data class NfcWebReading(val uid: String, val readAt: Long) {
    fun script(now: Long): String? {
        if (now - readAt !in 0L..15_000L) return null
        require(Regex("(?:[0-9A-F]{8}|[0-9A-F]{14}|[0-9A-F]{20})").matches(uid)) { "UID NFC inválido" }
        // Somente UID hexadecimal e número; nenhuma credencial cruza esta ponte.
        return "(function(){var r={uid:\"$uid\",lidoEm:$readAt};window.__doixpAndroidNfc=r;window.dispatchEvent(new CustomEvent('doixp:android-nfc',{detail:r}));})();"
    }
}
