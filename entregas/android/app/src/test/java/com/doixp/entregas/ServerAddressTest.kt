package com.doixp.entregas

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class ServerAddressTest {
    @Test fun canonicalizesHttpsOrigin() {
        assertEquals("https://entregas.example.com", ServerAddress.normalize(" HTTPS://Entregas.Example.com:443/ ", false))
        assertEquals("https://example.com:8443", ServerAddress.normalize("https://example.com:8443", false))
        assertEquals("https://[::1]", ServerAddress.normalize("https://[::1]", false))
    }

    @Test fun releaseRequiresHttpsEvenOnPrivateNetworks() {
        listOf("http://localhost", "http://10.0.2.2:3100", "http://192.168.1.5", "http://example.com").forEach {
            assertThrows(it, IllegalArgumentException::class.java) { ServerAddress.normalize(it, false) }
        }
    }

    @Test fun debugAcceptsOnlyExplicitLoopbackAndPrivateAddressesForHttp() {
        listOf("localhost", "127.0.0.1", "[::1]", "10.0.2.2", "192.168.2.1", "172.16.1.1", "172.31.255.254").forEach {
            assertEquals("http://$it:3100", ServerAddress.normalize("http://$it:3100/", true))
        }
        listOf("example.com", "localhost.evil.com", "10.example.com", "172.15.0.1", "172.32.0.1", "192.169.0.1", "8.8.8.8", "0.0.0.0", "2130706433", "127.1", "010.0.0.1").forEach {
            assertThrows(it, IllegalArgumentException::class.java) { ServerAddress.normalize("http://$it", true) }
        }
    }

    @Test fun rejectsCredentialsPathsFragmentsAndAmbiguousAuthorities() {
        listOf("", "example.com", "javascript:alert(1)", "file:///tmp/index.html", "https://trusted.example@evil.example",
            "https://example.com/path", "https://example.com//", "https://example.com?x=1", "https://example.com#token",
            "https://example.com:0", "https://example.com:65536", "https://example.com:", "https://example.com\\@evil.example",
            "https://evil_example.com", "https://example.com.", "https://256.1.1.1",
            "https://[fe80::1%25eth0]").forEach {
            assertThrows(it, IllegalArgumentException::class.java) { ServerAddress.normalize(it, true) }
        }
    }
}
