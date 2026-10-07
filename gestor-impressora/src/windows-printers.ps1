# Consulta o spooler mesmo quando o Chromium/Electron omite impressoras.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
    $printers = @(Get-CimInstance Win32_Printer | Select-Object Name, DriverName, Default, WorkOffline, PrinterState, PrinterStatus)
} catch {
    # Há instalações sem o provedor CIM funcional, mas com o spooler disponível.
    Add-Type -AssemblyName System.Drawing
    $defaultName = (New-Object System.Drawing.Printing.PrinterSettings).PrinterName
    $printers = @(foreach ($name in [System.Drawing.Printing.PrinterSettings]::InstalledPrinters) {
        [PSCustomObject]@{ Name = $name; Default = ($name -eq $defaultName) }
    })
}
ConvertTo-Json -InputObject $printers -Compress
