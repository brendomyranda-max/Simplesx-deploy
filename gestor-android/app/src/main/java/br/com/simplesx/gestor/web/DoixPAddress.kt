package br.com.simplesx.gestor.web

import java.net.URI

fun doixpAddress(value: String): URI {
    val uri = URI(value.trim().trimEnd('/'))
    require(uri.scheme == "https" && !uri.host.isNullOrBlank() && uri.userInfo == null && uri.query == null && uri.fragment == null) {
        "Configure um endereço HTTPS válido da DoixP antes de abrir o atendimento"
    }
    return uri
}

fun sameDoixPOrigin(base: URI, target: String): Boolean = runCatching {
    val uri = URI(target)
    uri.scheme == base.scheme && uri.host.equals(base.host, ignoreCase = true) &&
        (if (uri.port == -1) 443 else uri.port) == (if (base.port == -1) 443 else base.port) && uri.userInfo == null
}.getOrDefault(false)
