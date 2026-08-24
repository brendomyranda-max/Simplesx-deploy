package br.com.simplesx.gestor.print

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import br.com.simplesx.gestor.data.ConnectionType
import br.com.simplesx.gestor.data.PrinterConfig
import java.net.InetSocketAddress
import java.net.Socket
import java.util.UUID

data class PairedPrinter(val name: String, val address: String)

object PrinterTransport {
    private val sppUuid: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

    fun pairedBluetooth(context: Context): List<PairedPrinter> {
        if (Build.VERSION.SDK_INT >= 31 && context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) return emptyList()
        val adapter = context.getSystemService(BluetoothManager::class.java)?.adapter ?: return emptyList()
        return adapter.bondedDevices.orEmpty().map { PairedPrinter(it.name ?: it.address, it.address) }.sortedBy { it.name }
    }

    fun send(context: Context, config: PrinterConfig, bytes: ByteArray) {
        when (config.connection) {
            ConnectionType.NETWORK -> sendNetwork(config, bytes)
            ConnectionType.BLUETOOTH -> sendBluetooth(context, config, bytes)
        }
    }

    private fun sendNetwork(config: PrinterConfig, bytes: ByteArray) {
        require(config.host.isNotBlank()) { "Informe o IP da impressora" }
        Socket().use { socket ->
            socket.connect(InetSocketAddress(config.host.trim(), config.port), 10_000)
            socket.soTimeout = 10_000
            socket.getOutputStream().use { it.write(bytes); it.flush() }
        }
    }

    private fun sendBluetooth(context: Context, config: PrinterConfig, bytes: ByteArray) {
        if (Build.VERSION.SDK_INT >= 31 && context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            throw SecurityException("Autorize o acesso aos dispositivos Bluetooth")
        }
        require(config.bluetoothAddress.isNotBlank()) { "Selecione uma impressora Bluetooth pareada" }
        val adapter = context.getSystemService(BluetoothManager::class.java)?.adapter
            ?: throw IllegalStateException("Bluetooth não disponível neste aparelho")
        check(adapter.isEnabled) { "Ative o Bluetooth" }
        adapter.cancelDiscovery()
        val device = adapter.getRemoteDevice(config.bluetoothAddress)
        device.createRfcommSocketToServiceRecord(sppUuid).use { socket ->
            socket.connect()
            socket.outputStream.use { it.write(bytes); it.flush() }
        }
    }
}
