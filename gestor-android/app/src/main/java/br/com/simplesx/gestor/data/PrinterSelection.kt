package br.com.simplesx.gestor.data

fun selectPrinter(printers: List<PrinterConfig>, route: String?, defaultName: String): PrinterConfig {
    val requested = route.orEmpty().trim().ifBlank { defaultName.trim() }
    if (requested.isNotBlank()) {
        return printers.firstOrNull { it.name.trim().equals(requested, ignoreCase = true) }
            ?: throw IllegalArgumentException("A rota de impressão \"$requested\" não está cadastrada neste Android. Confira o nome no gestor e no sistema web")
    }
    return printers.firstOrNull() ?: throw IllegalStateException("Cadastre uma impressora no gestor Android")
}
