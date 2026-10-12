package br.com.simplesx.gestor.update

import java.io.File
import org.junit.Assert.*
import org.junit.Test

class UpdateDownloadTest {
    private fun release(code: Int) = UpdateRelease("1.5.$code",code,"https://github.com/brendomyranda-max/Simplesx-deploy/releases/download/gestor-v1.5.$code/servidor-doixp-android.apk","a".repeat(64),100)

    @Test fun anOldDownloadNeverHidesThePublishedVersion() {
        val calls=mutableListOf<String>()
        val saved=UpdateDownload(release(32),File("old.apk"))
        val result=prepareUpdateDownload(32,false,check={ calls.add("check");release(33) },cached={ saved },download={ calls.add("download");File("new.apk") })
        assertEquals(listOf("check","download"),calls)
        assertEquals(33,result?.release?.versionCode)
        assertEquals("new.apk",result?.file?.name)
    }
    @Test fun returningFromPermissionCanInstallTheVerifiedDownloadOffline() {
        val saved=UpdateDownload(release(33),File("download.apk"))
        val result=prepareUpdateDownload(32,true,check={ error("offline") },cached={ saved },download={ error("must reuse") })
        assertEquals(saved,result)
    }
    @Test fun aNewClickChecksForUpdatesButDoesNotDownloadTheSameFileTwice() {
        var checks=0
        val saved=UpdateDownload(release(33),File("download.apk"))
        assertEquals(saved,prepareUpdateDownload(32,false,check={ checks++;release(33) },cached={ saved },download={ error("must reuse") }))
        assertEquals(1,checks)
    }
    @Test fun currentVersionDoesNotInvokeDownload() {
        assertNull(prepareUpdateDownload(33,false,check={ release(33) },cached={ null },download={ error("already installed") }))
    }
}
