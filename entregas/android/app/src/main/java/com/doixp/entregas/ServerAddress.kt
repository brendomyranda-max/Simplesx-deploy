package com.doixp.entregas

import java.net.URI
import java.util.Locale

/** The app trusts one complete origin, never a URL prefix or a wildcard domain. */
object ServerAddress {
    fun normalize(input: String, allowLocalHttp: Boolean): String {
        val value = input.trim()
        require(value.isNotEmpty() && value.none { it.isWhitespace() || it == '\\' }) {
            "Informe o endereço HTTPS da plataforma."
        }
        val uri = try { URI(value) } catch (_: Exception) {
            throw IllegalArgumentException("O endereço da plataforma é inválido.")
        }
        val scheme = uri.scheme?.lowercase(Locale.ROOT)
        val host = uri.host?.lowercase(Locale.ROOT)
        require(host != null && validHost(host)) { "Informe um domínio válido para a plataforma." }
        require(uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null &&
            (uri.rawPath.isNullOrEmpty() || uri.rawPath == "/")) {
            "Use somente o endereço do servidor, sem usuário, caminho, consulta ou fragmento."
        }
        require(uri.port == -1 || uri.port in 1..65535) { "A porta do servidor é inválida." }
        val authority = host + if (uri.port == -1) "" else ":${uri.port}"
        require(uri.rawAuthority.equals(authority, ignoreCase = true)) { "O endereço do servidor é inválido." }
        require(scheme == "https" || (scheme == "http" && allowLocalHttp && isLocalHost(host))) {
            "A plataforma precisa usar HTTPS. HTTP é permitido apenas em rede local na versão de desenvolvimento."
        }
        val port = when {
            uri.port == -1 || (scheme == "https" && uri.port == 443) || (scheme == "http" && uri.port == 80) -> ""
            else -> ":${uri.port}"
        }
        return "$scheme://$host$port"
    }

    private fun validHost(host: String): Boolean {
        if (host.startsWith("[") && host.endsWith("]")) {
            // URI validates the IPv6 grammar; zone IDs are intentionally unsupported.
            return ':' in host && '%' !in host
        }
        if (host.length > 253 || host.endsWith('.')) return false
        val labels = host.split('.')
        if (!labels.all { label -> label.length in 1..63 &&
                label.first().isLetterOrDigit() && label.last().isLetterOrDigit() &&
                label.all { it in 'a'..'z' || it in '0'..'9' || it == '-' } }) return false
        if (host.all { it.isDigit() || it == '.' }) return ipv4(host) != null
        return true
    }

    private fun ipv4(host: String): List<Int>? {
        val parts = host.split('.')
        if (parts.size != 4 || parts.any { it.isEmpty() || it.length > 3 || (it.length > 1 && it[0] == '0') }) return null
        val octets = parts.map { it.toIntOrNull() ?: return null }
        return octets.takeIf { values -> values.all { it in 0..255 } }
    }

    private fun isLocalHost(host: String): Boolean {
        if (host == "localhost" || host == "[::1]") return true
        val ip = ipv4(host) ?: return false
        return ip[0] == 127 || ip[0] == 10 ||
            (ip[0] == 192 && ip[1] == 168) ||
            (ip[0] == 172 && ip[1] in 16..31)
    }
}
