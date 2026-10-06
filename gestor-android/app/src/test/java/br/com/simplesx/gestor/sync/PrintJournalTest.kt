package br.com.simplesx.gestor.sync

import org.junit.Assert.*
import org.junit.Test
import java.nio.file.Files

class PrintJournalTest {
    @Test fun successSurvivesRestartAndLostAcknowledgement() {
        val directory = Files.createTempDirectory("journal").toFile()
        try {
            var prints = 0
            assertTrue(PrintJournal(directory).execute("job1") { prints++ }.success)
            assertTrue(PrintJournal(directory).execute("job1") { prints++ }.success)
            assertEquals(1, prints)
            assertTrue(PrintJournal(directory).execute("job2") { prints++ }.success)
            assertEquals(2, prints)
        } finally { directory.deleteRecursively() }
    }

    @Test fun interruptedOrFailedPrintRequiresReviewInsteadOfRepeatingBytes() {
        val directory = Files.createTempDirectory("journal").toFile()
        try {
            var prints = 0
            assertFalse(PrintJournal(directory).execute("job") { prints++; error("Sem papel") }.success)
            assertFalse(PrintJournal(directory).execute("job") { prints++ }.success)
            directory.listFiles()!!.single().writeText("started")
            assertFalse(PrintJournal(directory).execute("job") { prints++ }.success)
            assertEquals(1, prints)
        } finally { directory.deleteRecursively() }
    }
}
