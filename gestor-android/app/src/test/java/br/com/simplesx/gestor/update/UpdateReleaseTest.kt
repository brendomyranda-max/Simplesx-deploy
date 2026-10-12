package br.com.simplesx.gestor.update

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import br.com.simplesx.gestor.web.doixpAddress
import br.com.simplesx.gestor.web.sameDoixPOrigin

class UpdateReleaseTest {
    private val release = UpdateRelease("1.5.17", 30, "https://github.com/brendomyranda-max/Simplesx-deploy/releases/download/gestor-v1.5.17/servidor-doixp-android.apk", "a".repeat(64), 7_000_000)

    @Test fun officialReleaseIsValid() { assertEquals(release, release.validate()) }
    @Test fun refusesUntrustedOrCorruptedManifest() {
        listOf(release.copy(url = "https://example.com/app.apk"), release.copy(version = "../bad"), release.copy(sha256 = "bad"), release.copy(size = 0), release.copy(size = 101_000_000), release.copy(versionCode = 0)).forEach {
            assertTrue(runCatching { it.validate() }.isFailure)
        }
    }
    @Test fun browserOnlyKeepsDoixPOriginInsideApp() {
        val base = doixpAddress("https://doixp.com/")
        assertTrue(sameDoixPOrigin(base, "https://doixp.com/restaurante/lancar-cartao"))
        assertTrue(sameDoixPOrigin(base, "https://doixp.com:443/login"))
        listOf("https://doixp.com.evil.test/", "http://doixp.com/", "javascript:alert(1)", "file:///etc/test", "https://doixp.com:444/", "https://user@doixp.com/").forEach {
            assertFalse(sameDoixPOrigin(base, it))
        }
        assertTrue(runCatching { doixpAddress("http://doixp.com") }.isFailure)
    }
}
