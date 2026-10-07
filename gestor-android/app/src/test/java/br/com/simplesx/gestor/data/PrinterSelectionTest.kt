package br.com.simplesx.gestor.data

import org.junit.Assert.*
import org.junit.Test

class PrinterSelectionTest {
    private val printers = listOf(PrinterConfig(name = "Caixa"), PrinterConfig(name = "Cozinha"))

    @Test fun explicitRouteDoesNotFallBackToAnotherPrinter() {
        assertThrows(IllegalArgumentException::class.java) { selectPrinter(printers, "Etiquetas", "Caixa") }
        assertEquals("Cozinha", selectPrinter(printers, " cozinha ", "Caixa").name)
    }

    @Test fun missingDefaultRequiresCorrection() {
        assertThrows(IllegalArgumentException::class.java) { selectPrinter(printers, null, "Removida") }
        assertEquals("Caixa", selectPrinter(printers, null, "Caixa").name)
        assertEquals("Caixa", selectPrinter(printers, "", "").name)
    }
}
