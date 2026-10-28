package br.com.simplesx.gestor.print

/** Mantém a ordem, respeita escritas parciais e nunca reenvia um trabalho após falha. */
object ChunkedTransfer {
    fun send(bytes: ByteArray, chunkSize: Int = 512, delayMs: Long = 40,
             finishDelayMs: Long = 400, pause: (Long) -> Unit = { Thread.sleep(it) },
             write: (offset: Int, length: Int) -> Int) {
        require(chunkSize > 0)
        var offset = 0
        while (offset < bytes.size) {
            val length = minOf(chunkSize, bytes.size - offset)
            val written = write(offset, length)
            check(written in 1..length) { "Falha ao enviar dados à impressora após $offset bytes. Confira o papel antes de reenviar." }
            offset += written
            if (offset < bytes.size && delayMs > 0) pause(delayMs)
        }
        if (bytes.isNotEmpty() && finishDelayMs > 0) pause(finishDelayMs)
    }
}
