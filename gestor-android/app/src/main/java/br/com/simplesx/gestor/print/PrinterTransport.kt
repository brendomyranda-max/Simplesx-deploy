/**
 * Arquivo: PrinterTransport.kt
 * Responsabilidade: Descobre impressoras e transmite bytes por USB, Bluetooth ou rede.
 */

package br.com.simplesx.gestor.print

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.Build
import br.com.simplesx.gestor.data.ConnectionType
import br.com.simplesx.gestor.data.PrinterConfig
import java.net.InetSocketAddress
import java.net.Socket
import java.util.UUID

data class PairedPrinter(val name: String, val address: String)
data class UsbPrinter(val name: String, val deviceName: String, val vendorId: Int, val productId: Int)

object PrinterTransport {
    private val sppUuid: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    private val bluetoothLock = Any()
    private val sendLock = Any()
    private var bluetoothSocket: BluetoothSocket? = null

    fun pairedBluetooth(context: Context): List<PairedPrinter> {
        if (Build.VERSION.SDK_INT >= 31 && context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) return emptyList()
        val adapter = context.getSystemService(BluetoothManager::class.java)?.adapter ?: return emptyList()
        check(adapter.isEnabled) { "Ative o Bluetooth para listar as impressoras pareadas" }
        return adapter.bondedDevices.orEmpty().map { PairedPrinter(it.name ?: it.address, it.address) }.sortedBy { it.name }
    }

    fun connectedUsb(context: Context): List<UsbPrinter> {
        val manager = context.getSystemService(UsbManager::class.java) ?: return emptyList()
        return manager.deviceList.values.filter { findBulkOut(it) != null }.map { device ->
            UsbPrinter(
                runCatching { device.productName }.getOrNull() ?: "USB ${device.vendorId}:${device.productId}",
                device.deviceName, device.vendorId, device.productId,
            )
        }.sortedBy { it.name }
    }

    fun requestUsbPermission(context: Context, config: PrinterConfig) {
        val manager = context.getSystemService(UsbManager::class.java)
            ?: throw IllegalStateException("USB não disponível neste aparelho")
        val device = findUsbDevice(manager, config)
            ?: throw IllegalStateException("Conecte a impressora USB ao Android")
        if (manager.hasPermission(device)) return
        val intent = PendingIntent.getBroadcast(
            context, 9220, Intent(ACTION_USB_PERMISSION).setPackage(context.packageName),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        manager.requestPermission(device, intent)
    }

    fun send(context: Context, config: PrinterConfig, bytes: ByteArray) = synchronized(sendLock) {
        when (config.connection) {
            ConnectionType.NETWORK -> sendNetwork(config, bytes)
            ConnectionType.BLUETOOTH -> sendBluetooth(context, config, bytes)
            ConnectionType.USB -> sendUsb(context, config, bytes)
        }
    }

    private fun sendNetwork(config: PrinterConfig, bytes: ByteArray) {
        require(config.port in 1..65535) { "Porta da impressora deve estar entre 1 e 65535" }
        require(config.host.isNotBlank()) { "Informe o IP da impressora" }
        Socket().use { socket ->
            TransportGuard.withTimeout(socket, 60_000) {
                socket.connect(InetSocketAddress(config.host.trim(), config.port), 10_000)
                socket.getOutputStream().apply {
                    ChunkedTransfer.send(bytes) { offset, length ->
                        write(bytes, offset, length)
                        flush()
                        length
                    }
                }
            }
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
        val address = config.bluetoothAddress.uppercase()
        val device = adapter.getRemoteDevice(address)
        check(device.bondState == BluetoothDevice.BOND_BONDED) {
            "A impressora ${config.bluetoothName.ifBlank { address }} não está mais pareada. Pareie novamente nas configurações do Android"
        }
        synchronized(bluetoothLock) {
            try {
                TransportGuard.connectAndSend(3, connect = { attempt ->
                    closeBluetoothLocked()
                    if (attempt > 0) Thread.sleep(350L * attempt)
                    cancelLegacyDiscovery(adapter)
                    val connecting = createBluetoothSocket(context, device, attempt)
                    bluetoothSocket = connecting
                    try {
                        TransportGuard.withTimeout(connecting, 12_000) { connecting.connect() }
                        connecting
                    } catch (error: Exception) {
                        closeBluetoothLocked()
                        throw error
                    }
                }, send = { connected ->
                    TransportGuard.withTimeout(connected, 60_000) {
                        connected.outputStream.apply {
                            ChunkedTransfer.send(bytes) { offset, length ->
                                write(bytes, offset, length)
                                flush()
                                length
                            }
                        }
                    }
                })
            } finally {
                closeBluetoothLocked()
            }
        }
    }

    @SuppressLint("MissingPermission") // Antes da API 31 basta BLUETOOTH_ADMIN, declarada no manifesto com maxSdkVersion=30.
    private fun cancelLegacyDiscovery(adapter: BluetoothAdapter) {
        if (Build.VERSION.SDK_INT >= 31) return
        try { adapter.cancelDiscovery() } catch (_: SecurityException) { /* Não bloqueia a conexão. */ }
    }

    private fun createBluetoothSocket(context: Context, device: BluetoothDevice, attempt: Int): BluetoothSocket {
        if (Build.VERSION.SDK_INT >= 31 && context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            throw SecurityException("Autorize o acesso aos dispositivos Bluetooth")
        }
        return when (attempt) {
            // Impressoras térmicas genéricas normalmente expõem SPP sem autenticação.
            0 -> device.createInsecureRfcommSocketToServiceRecord(sppUuid)
            1 -> device.createRfcommSocketToServiceRecord(sppUuid)
            // Alguns firmwares não publicam o UUID no SDP, mas aceitam RFCOMM 1.
            else -> BluetoothDevice::class.java.getMethod("createRfcommSocket", Int::class.javaPrimitiveType)
                .invoke(device, 1) as BluetoothSocket
        }
    }

    fun closeConnections() = synchronized(bluetoothLock) { closeBluetoothLocked() }

    private fun closeBluetoothLocked() {
        runCatching { bluetoothSocket?.close() }
        bluetoothSocket = null
    }

    private fun sendUsb(context: Context, config: PrinterConfig, bytes: ByteArray) {
        val manager = context.getSystemService(UsbManager::class.java)
            ?: throw IllegalStateException("USB não disponível neste aparelho")
        val device = findUsbDevice(manager, config)
            ?: throw IllegalStateException("Impressora USB desconectada")
        check(manager.hasPermission(device)) { "Autorize o acesso à impressora USB" }
        val (usbInterface, endpoint) = findBulkOut(device)
            ?: throw IllegalStateException("A impressora não possui uma saída USB compatível")
        val connection = manager.openDevice(device)
            ?: throw IllegalStateException("Não foi possível abrir a impressora USB")
        try {
            check(connection.claimInterface(usbInterface, true)) { "Não foi possível acessar a interface USB" }
            try {
                if (usbInterface.alternateSetting != 0) {
                    check(connection.setInterface(usbInterface)) { "Não foi possível selecionar a interface USB da impressora" }
                }
                val deadline = android.os.SystemClock.elapsedRealtime() + 60_000
                ChunkedTransfer.send(bytes) { offset, length ->
                    check(android.os.SystemClock.elapsedRealtime() < deadline) { "Tempo de envio USB esgotado. Confira a impressão antes de reenviar." }
                    connection.bulkTransfer(endpoint, bytes, offset, length, 10_000)
                }
            } finally {
                connection.releaseInterface(usbInterface)
            }
        } finally {
            connection.close()
        }
    }

    private fun findUsbDevice(manager: UsbManager, config: PrinterConfig): UsbDevice? =
        manager.deviceList.values.firstOrNull { it.deviceName == config.usbDeviceName && (config.usbVendorId == 0 ||
                it.vendorId == config.usbVendorId && it.productId == config.usbProductId) }
            ?: manager.deviceList.values.firstOrNull {
                config.usbVendorId != 0 && it.vendorId == config.usbVendorId && it.productId == config.usbProductId
            }

    private fun findBulkOut(device: UsbDevice) = (0 until device.interfaceCount).asSequence()
        .map { device.getInterface(it) }
        .flatMap { usbInterface ->
            (0 until usbInterface.endpointCount).asSequence().map { usbInterface to usbInterface.getEndpoint(it) }
        }
        .filter { (_, endpoint) ->
            endpoint.type == UsbConstants.USB_ENDPOINT_XFER_BULK && endpoint.direction == UsbConstants.USB_DIR_OUT
        }
        .sortedBy { (usbInterface, _) -> if (usbInterface.interfaceClass == UsbConstants.USB_CLASS_PRINTER) 0 else 1 }
        .firstOrNull()

    const val ACTION_USB_PERMISSION = "br.com.simplesx.gestor.USB_PERMISSION"
}
