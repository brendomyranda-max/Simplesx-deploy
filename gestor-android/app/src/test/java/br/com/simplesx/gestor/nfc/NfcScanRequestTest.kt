package br.com.simplesx.gestor.nfc

import org.junit.Assert.*
import org.junit.Test
import java.net.URLEncoder

class NfcScanRequestTest {
    private val id = "12345678-1234-1234-1234-123456789abc"
    private val token = "A".repeat(64)
    private fun link(server: String = "https://doixp.com") = "doixp://nfc/ler?servidor=${URLEncoder.encode(server, "UTF-8")}&id=$id&token=$token"

    @Test fun `solicitacao do Chrome usa UID sem credencial de impressora`() {
        val request = NfcScanRequest.parse(link(), "https://doixp.com")
        assertEquals("https://doixp.com", request.server)
        assertEquals(id, request.id)
        assertEquals(token, request.token)
    }

    @Test fun `ambiente configurado e permitido mas URLs estranhas nao recebem o UID`() {
        assertEquals("https://teste.pages.dev", NfcScanRequest.parse(link("https://teste.pages.dev"), "https://teste.pages.dev").server)
        for (server in listOf("https://evil.example", "http://doixp.com", "https://doixp.com.evil.example", "https://user@doixp.com", "https://doixp.com/path", "https://doixp.com?x=1", "https://doixp.com#x")) {
            assertThrows(IllegalArgumentException::class.java) { NfcScanRequest.parse(link(server), "https://doixp.com") }
        }
    }

    @Test fun `link externo nao altera caminho nem admite parametros repetidos ou segredo invalido`() {
        for (url in listOf(link().replace("/ler?", "/outro?"), link().replace("doixp:", "https:"), link() + "&token=$token", link().replace(token, "123"), link() + "#fragment", link().replace("nfc/", "nfc:8080/"))) {
            assertThrows(IllegalArgumentException::class.java) { NfcScanRequest.parse(url, "https://doixp.com") }
        }
    }
}
