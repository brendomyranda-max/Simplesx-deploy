package br.com.simplesx.gestor.web

import org.junit.Assert.*
import org.junit.Test

class NfcWebReadingTest {
    @Test fun `UID NTAG215 preserva zeros e chega como evento e estado para pagina carregando`() {
        val script = NfcWebReading("00A224B1C2D380", 100_000).script(100_100)!!
        assertTrue(script.contains("uid:\"00A224B1C2D380\",lidoEm:100000"))
        assertTrue(script.contains("window.__doixpAndroidNfc=r"))
        assertTrue(script.contains("CustomEvent('doixp:android-nfc'"))
    }

    @Test fun `leitura antiga ou futura nao e reinjetada ao recarregar`() {
        val reading = NfcWebReading("04A224B1C2D380", 100_000)
        assertNotNull(reading.script(115_000))
        assertNull(reading.script(115_001))
        assertNull(reading.script(99_999))
    }

    @Test fun `somente UID fisico hexadecimal pode entrar no JavaScript`() {
        for (uid in listOf("12345678", "00A224B1C2D380", "00112233445566778899")) {
            assertNotNull(NfcWebReading(uid, 100).script(101))
        }
        for (uid in listOf("COMANDA-001", "\"};alert(1)//", "04:a2:24:b1:c2:d3:80", "123")) {
            assertThrows(IllegalArgumentException::class.java) { NfcWebReading(uid, 100).script(101) }
        }
    }
}
