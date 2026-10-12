package br.com.simplesx.gestor.nfc

import br.com.simplesx.gestor.web.doixpAddress
import br.com.simplesx.gestor.web.sameDoixPOrigin
import java.net.URI
import java.net.URLDecoder

data class NfcScanRequest(val server: String, val id: String, val token: String) {
    companion object {
        fun parse(value: String, configuredServer: String): NfcScanRequest {
            val uri = URI(value)
            require(uri.scheme == "doixp" && uri.host == "nfc" && uri.path == "/ler" && uri.userInfo == null && uri.port == -1 && uri.fragment == null) { "Link de leitura inválido" }
            val entries = uri.rawQuery.orEmpty().split('&').map {
                val parts = it.split('=', limit = 2)
                require(parts.size == 2) { "Solicitação NFC incompleta" }
                URLDecoder.decode(parts[0], "UTF-8") to URLDecoder.decode(parts[1], "UTF-8")
            }
            require(entries.size == 3 && entries.map { it.first }.toSet() == setOf("servidor", "id", "token")) { "Solicitação NFC inválida" }
            val params = entries.toMap()
            val server = doixpAddress(params.getValue("servidor"))
            require(server.path.orEmpty() in setOf("", "/")) { "Endereço da DoixP inválido" }
            val official = doixpAddress("https://doixp.com")
            val configured = runCatching { doixpAddress(configuredServer) }.getOrNull()
            require(sameDoixPOrigin(official, server.toString()) || (configured != null && sameDoixPOrigin(configured, server.toString()))) { "O endereço não pertence à DoixP configurada neste aparelho" }
            val id = params.getValue("id")
            val token = params.getValue("token")
            require(Regex("[a-f0-9-]{36}").matches(id) && Regex("[A-F0-9]{64}").matches(token)) { "Solicitação NFC inválida" }
            return NfcScanRequest(server.toString().trimEnd('/'), id, token)
        }
    }
}
