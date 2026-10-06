package br.com.simplesx.gestor.sync

import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest

data class PrintResult(val success: Boolean, val error: String? = null)

/** Persiste o resultado antes do ACK HTTP. Um envio interrompido requer conferência. */
class PrintJournal(private val directory: File) {
    fun execute(key: String, print: () -> Unit): PrintResult {
        val hash = MessageDigest.getInstance("SHA-256").digest(key.toByteArray()).joinToString("") { "%02x".format(it) }
        val file = File(directory, "$hash.txt")
        if (file.exists()) {
            val state = file.readText()
            return when {
                state == "done" -> PrintResult(true)
                state.startsWith("failed\n") -> PrintResult(false, state.substringAfter('\n'))
                else -> PrintResult(false, "Envio interrompido. Confira o papel antes de solicitar nova impressão.")
            }
        }
        check(directory.exists() || directory.mkdirs()) { "Não foi possível criar o registro de impressão" }
        fun save(value: String) {
            val temporary = File(directory, "$hash.tmp")
            FileOutputStream(temporary).use { stream -> stream.write(value.toByteArray()); stream.fd.sync() }
            check(temporary.renameTo(file)) { "Não foi possível persistir o resultado da impressão" }
        }
        save("started")
        val result = try { print(); PrintResult(true) }
        catch (error: Exception) { PrintResult(false, "${error.message}. Confira a impressora antes de repetir.") }
        save(if (result.success) "done" else "failed\n${result.error}")
        return result
    }
}
