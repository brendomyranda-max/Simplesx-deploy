package br.com.simplesx.gestor

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import br.com.simplesx.gestor.data.AppConfig
import br.com.simplesx.gestor.data.ConnectionType
import br.com.simplesx.gestor.data.PrinterConfig
import br.com.simplesx.gestor.network.SimplesXApi
import br.com.simplesx.gestor.print.EscPos
import br.com.simplesx.gestor.print.PrinterTransport
import br.com.simplesx.gestor.sync.PrintSyncService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val config = AppConfig(this)
        if (config.deviceToken.isNotBlank()) PrintSyncService.start(this)
        setContent { MaterialTheme { GestorScreen() } }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun GestorScreen() {
    val context = LocalContext.current
    val config = remember { AppConfig(context) }
    var deployUrl by remember { mutableStateOf(config.deployUrl) }
    var deviceName by remember { mutableStateOf(config.deviceName) }
    var pairingId by remember { mutableStateOf("") }
    var pairingCode by remember { mutableStateOf("") }
    var printers by remember { mutableStateOf(config.printers) }
    var selectedPrinterIndex by remember { mutableStateOf(0) }
    var printer by remember { mutableStateOf(printers.first()) }
    var serviceEnabled by remember { mutableStateOf(config.serviceEnabled) }
    var message by remember { mutableStateOf(config.lastStatus) }
    var bluetoothPrinters by remember { mutableStateOf(PrinterTransport.pairedBluetooth(context)) }
    var bluetoothExpanded by remember { mutableStateOf(false) }
    var openBluetoothAfterPermission by remember { mutableStateOf(false) }

    val permissions = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        val bluetoothAllowed = Build.VERSION.SDK_INT < 31 ||
            context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
        if (bluetoothAllowed) {
            bluetoothPrinters = PrinterTransport.pairedBluetooth(context)
            if (openBluetoothAfterPermission) bluetoothExpanded = true
        } else {
            message = "Permissão Bluetooth negada. Autorize Dispositivos próximos nas configurações do aplicativo."
        }
        openBluetoothAfterPermission = false
    }
    fun requestPermissions(openBluetoothPicker: Boolean = false) {
        val required = buildList {
            if (Build.VERSION.SDK_INT >= 31) add(Manifest.permission.BLUETOOTH_CONNECT)
            if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
        }.filter { context.checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (required.isNotEmpty()) {
            openBluetoothAfterPermission = openBluetoothPicker
            permissions.launch(required.toTypedArray())
        } else if (openBluetoothPicker) {
            bluetoothPrinters = PrinterTransport.pairedBluetooth(context)
            bluetoothExpanded = true
        }
    }

    fun background(block: () -> String) {
        CoroutineScope(Dispatchers.IO).launch {
            val result = runCatching(block).fold({ it }, { "Erro: ${it.message}" })
            withContext(Dispatchers.Main) { message = result }
        }
    }

    Scaffold(topBar = { TopAppBar(title = { Text("SimplesX Gestor") }) }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            StatusCard(serviceEnabled, config.deviceToken.isNotBlank(), message, config.lastJob)

            Section("Conexão com o SimplesX") {
                OutlinedTextField(deployUrl, { deployUrl = it }, label = { Text("Endereço do SimplesX") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(deviceName, { deviceName = it }, label = { Text("Nome deste gestor") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                if (config.deviceToken.isBlank()) {
                    OutlinedTextField(pairingId, { pairingId = it }, label = { Text("ID do pareamento") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(pairingCode, { pairingCode = it.uppercase() }, label = { Text("Código de pareamento") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    Button(onClick = {
                        config.deployUrl = deployUrl; config.deviceName = deviceName
                        background {
                            SimplesXApi(config).pair(pairingId, pairingCode)
                            PrintSyncService.start(context)
                            "Pareamento concluído e recepção iniciada"
                        }
                    }, modifier = Modifier.fillMaxWidth()) { Text("Parear aparelho") }
                } else Text("Aparelho pareado · ${config.deviceId}", color = MaterialTheme.colorScheme.primary)
            }

            Section("Impressora ESC/POS") {
                Text("Cadastre uma rota para cada impressora. O nome deve ser igual ao nome configurado no SimplesX (ex.: Cozinha, Bar ou Caixa).", style = MaterialTheme.typography.bodySmall)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    printers.forEachIndexed { index, item ->
                        OutlinedButton(onClick = { selectedPrinterIndex = index; printer = item }, modifier = Modifier.weight(1f)) {
                            Text(item.name, maxLines = 1)
                        }
                    }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = {
                        selectedPrinterIndex = -1
                        printer = PrinterConfig(name = "Nova rota", connection = ConnectionType.BLUETOOTH, widthMm = 58)
                    }, modifier = Modifier.weight(1f)) { Text("Adicionar") }
                    if (printers.size > 1 && selectedPrinterIndex >= 0) {
                        OutlinedButton(onClick = {
                            printers = printers.filterIndexed { index, _ -> index != selectedPrinterIndex }
                            config.printers = printers
                            selectedPrinterIndex = 0
                            printer = printers.first()
                        }, modifier = Modifier.weight(1f)) { Text("Excluir") }
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { printer = printer.copy(connection = ConnectionType.NETWORK) }, modifier = Modifier.weight(1f)) { Text("Rede") }
                    Button(onClick = {
                        printer = printer.copy(connection = ConnectionType.BLUETOOTH)
                        requestPermissions(openBluetoothPicker = true)
                    }, modifier = Modifier.weight(1f)) { Text("Bluetooth") }
                }
                OutlinedTextField(printer.name, { printer = printer.copy(name = it) }, label = { Text("Nome da rota no SimplesX") }, modifier = Modifier.fillMaxWidth())
                if (printer.connection == ConnectionType.NETWORK) {
                    OutlinedTextField(printer.host, { printer = printer.copy(host = it) }, label = { Text("IP da impressora") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(printer.port.toString(), { printer = printer.copy(port = it.toIntOrNull() ?: 9100) }, label = { Text("Porta") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                } else {
                    ExposedDropdownMenuBox(expanded = bluetoothExpanded, onExpandedChange = { expand ->
                        if (expand) requestPermissions(openBluetoothPicker = true) else bluetoothExpanded = false
                    }) {
                        OutlinedTextField(printer.bluetoothName.ifBlank { "Selecione um dispositivo pareado" }, {}, readOnly = true,
                            label = { Text("Impressora Bluetooth") }, trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(bluetoothExpanded) },
                            modifier = Modifier.menuAnchor().fillMaxWidth())
                        ExposedDropdownMenu(bluetoothExpanded, { bluetoothExpanded = false }) {
                            bluetoothPrinters.forEach { item -> DropdownMenuItem(text = { Text("${item.name} · ${item.address}") }, onClick = {
                                printer = printer.copy(bluetoothName = item.name, bluetoothAddress = item.address); bluetoothExpanded = false
                            }) }
                        }
                    }
                    Text("A impressora deve estar pareada nas configurações do Android.", style = MaterialTheme.typography.bodySmall)
                }
                Text("⚙ Tamanho do papel", fontWeight = FontWeight.Bold)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(58, 76, 80).forEach { width ->
                        OutlinedButton(onClick = { printer = printer.copy(widthMm = width) }, modifier = Modifier.weight(1f)) { Text("$width mm") }
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(100, 102).forEach { width ->
                        OutlinedButton(onClick = { printer = printer.copy(widthMm = width) }, modifier = Modifier.weight(1f)) { Text("$width mm") }
                    }
                }
                OutlinedTextField(
                    value = printer.widthMm.toString(),
                    onValueChange = { value -> value.toIntOrNull()?.takeIf { it in 20..320 }?.let { printer = printer.copy(widthMm = it) } },
                    label = { Text("Largura personalizada (20 a 320 mm)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Text("O comprimento acompanha somente o conteúdo impresso.", style = MaterialTheme.typography.bodySmall)
                Button(onClick = {
                    if (printer.name.isBlank()) {
                        message = "Informe o nome da rota da impressora"
                        return@Button
                    }
                    val updated = printers.toMutableList()
                    val duplicate = updated.indices.firstOrNull { index ->
                        index != selectedPrinterIndex && updated[index].name.equals(printer.name, ignoreCase = true)
                    } ?: -1
                    if (duplicate >= 0) {
                        message = "Já existe uma rota com esse nome"
                        return@Button
                    }
                    if (selectedPrinterIndex in updated.indices) updated[selectedPrinterIndex] = printer
                    else { updated.add(printer); selectedPrinterIndex = updated.lastIndex }
                    printers = updated
                    config.printers = updated
                    if (config.defaultPrinterName.isBlank()) config.defaultPrinterName = printer.name
                    val bluetoothAllowed = Build.VERSION.SDK_INT < 31 ||
                        context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
                    if (printer.connection == ConnectionType.BLUETOOTH && !bluetoothAllowed) {
                        message = "Autorize Dispositivos próximos para imprimir por Bluetooth"
                        requestPermissions(openBluetoothPicker = true)
                    } else {
                        background { PrinterTransport.send(context, printer, EscPos.ticket("SIMPLESX - TESTE DE IMPRESSAO\nRede/Bluetooth OK", widthMm = printer.widthMm)); "Teste enviado com sucesso" }
                    }
                }, modifier = Modifier.fillMaxWidth()) { Text("Salvar rota e imprimir teste") }
                OutlinedButton(onClick = {
                    config.defaultPrinterName = printer.name
                    message = "${printer.name} definida como rota padrão"
                }, modifier = Modifier.fillMaxWidth()) {
                    Text(if (config.defaultPrinterName.equals(printer.name, ignoreCase = true)) "Rota padrão" else "Definir como padrão")
                }
            }

            Section("Serviço em segundo plano") {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Column { Text("Receber impressões"); Text("Mantém uma notificação ativa", style = MaterialTheme.typography.bodySmall) }
                    Switch(serviceEnabled, onCheckedChange = {
                        requestPermissions(); config.deployUrl = deployUrl; config.deviceName = deviceName; config.printers = printers
                        serviceEnabled = it
                        if (it) PrintSyncService.start(context) else PrintSyncService.stop(context)
                    })
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable private fun Section(title: String, content: @Composable () -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(title, fontWeight = FontWeight.Bold); content()
        }
    }
}

@Composable private fun StatusCard(active: Boolean, paired: Boolean, status: String, lastJob: String) {
    Card(colors = CardDefaults.cardColors(containerColor = if (active) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant)) {
        Column(Modifier.fillMaxWidth().padding(16.dp)) {
            Text(if (active) "Serviço ativo" else "Serviço parado", fontWeight = FontWeight.Bold)
            Text(if (paired) status else "Aguardando pareamento")
            Text("Último trabalho: $lastJob", style = MaterialTheme.typography.bodySmall)
        }
    }
}
