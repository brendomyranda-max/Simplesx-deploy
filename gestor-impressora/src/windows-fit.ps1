param(
  [Parameter(Mandatory = $true)][string]$PrinterName,
  [Parameter(Mandatory = $true)][string]$FilePath,
  [Parameter(Mandatory = $true)][double]$WidthMm,
  [Parameter(Mandatory = $true)][double]$HeightMm
)

Add-Type -AssemblyName System.Drawing

$text = [System.IO.File]::ReadAllText($FilePath, [System.Text.Encoding]::UTF8)
$document = New-Object System.Drawing.Printing.PrintDocument
$document.PrinterSettings.PrinterName = $PrinterName
if (-not $document.PrinterSettings.IsValid) { throw "Impressora não encontrada: $PrinterName" }

$widthHundredths = [Math]::Max(1, [int][Math]::Round($WidthMm / 25.4 * 100))
$heightHundredths = [Math]::Max(1, [int][Math]::Round($HeightMm / 25.4 * 100))
$document.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize('SimplesX', $widthHundredths, $heightHundredths)
$document.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
$document.OriginAtMargins = $true

$handler = [System.Drawing.Printing.PrintPageEventHandler] {
  param($sender, $eventArgs)
  $bounds = New-Object System.Drawing.RectangleF(0, 0, $eventArgs.MarginBounds.Width, $eventArgs.MarginBounds.Height)
  $format = New-Object System.Drawing.StringFormat
  $format.Trimming = [System.Drawing.StringTrimming]::None
  $format.FormatFlags = [System.Drawing.StringFormatFlags]::LineLimit
  $fontSize = 10.0
  $font = $null
  try {
    while ($fontSize -ge 3.0) {
      if ($null -ne $font) { $font.Dispose() }
      $font = New-Object System.Drawing.Font('Consolas', $fontSize, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Point)
      $measured = $eventArgs.Graphics.MeasureString($text, $font, [int]$bounds.Width, $format)
      if ($measured.Height -le $bounds.Height -and $measured.Width -le $bounds.Width) { break }
      $fontSize -= 0.25
    }
    $eventArgs.Graphics.DrawString($text, $font, [System.Drawing.Brushes]::Black, $bounds, $format)
    $eventArgs.HasMorePages = $false
  } finally {
    if ($null -ne $font) { $font.Dispose() }
    $format.Dispose()
  }
}

$document.add_PrintPage($handler)
try { $document.Print() } finally {
  $document.remove_PrintPage($handler)
  $document.Dispose()
}
