package br.com.simplesx.gestor.nfc

import org.junit.Assert.*
import org.junit.Test

class NfcIdentificationTest {
    @Test fun ntag215UidPreservesSevenBytesLeadingZeroAndSignedBytes() {
        assertEquals("04A224B1C2D380", nfcUid(byteArrayOf(0x04, 0xA2.toByte(), 0x24,
            0xB1.toByte(), 0xC2.toByte(), 0xD3.toByte(), 0x80.toByte())))
        assertEquals("00000000000001", nfcUid(byteArrayOf(0, 0, 0, 0, 0, 0, 1)))
        assertThrows(IllegalArgumentException::class.java) { nfcUid(byteArrayOf()) }
    }

    @Test fun readerOnlyBecomesReadyWithNfcEnabledAndActivityInForeground() {
        assertEquals(NfcReaderState.UNAVAILABLE, nfcReaderState(false, false, true))
        assertEquals(NfcReaderState.SYSTEM_DISABLED, nfcReaderState(true, false, true))
        assertEquals(NfcReaderState.PAUSED, nfcReaderState(true, true, false))
        // Voltar das configurações com o NFC ligado permite retomar a leitura.
        assertEquals(NfcReaderState.READY, nfcReaderState(true, true, true))
    }

    @Test fun repeatedCallbackDoesNotResubmitButAnotherCardOrANewTapCanProceed() {
        val gate = NfcReadGate()
        assertTrue(gate.accept("04A224B1C2D380", 5_000))
        assertFalse(gate.accept("04A224B1C2D380", 5_001))
        assertFalse(gate.accept("04A224B1C2D380", 6_999))
        assertTrue(gate.accept("04A224B1C2D380", 7_000))
        assertTrue(gate.accept("04A224B1C2D381", 7_001))
    }
}
