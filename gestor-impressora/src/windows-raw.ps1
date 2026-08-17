param(
  [Parameter(Mandatory = $true)][string]$PrinterName,
  [Parameter(Mandatory = $true)][string]$FilePath
)

$source = @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class RawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private class DOC_INFO_1 {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }

  [DllImport("winspool.drv", SetLastError=true, CharSet=CharSet.Unicode)]
  private static extern bool OpenPrinter(string name, out IntPtr printer, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError=true)] private static extern bool ClosePrinter(IntPtr printer);
  [DllImport("winspool.drv", SetLastError=true, CharSet=CharSet.Unicode)]
  private static extern int StartDocPrinter(IntPtr printer, int level, [In] DOC_INFO_1 docInfo);
  [DllImport("winspool.drv", SetLastError=true)] private static extern bool EndDocPrinter(IntPtr printer);
  [DllImport("winspool.drv", SetLastError=true)] private static extern bool StartPagePrinter(IntPtr printer);
  [DllImport("winspool.drv", SetLastError=true)] private static extern bool EndPagePrinter(IntPtr printer);
  [DllImport("winspool.drv", SetLastError=true)]
  private static extern bool WritePrinter(IntPtr printer, byte[] bytes, int count, out int written);

  public static void Send(string printerName, byte[] bytes) {
    IntPtr printer;
    if (!OpenPrinter(printerName, out printer, IntPtr.Zero)) throw new Win32Exception();
    try {
      var info = new DOC_INFO_1 { pDocName = "SimplesX", pDataType = "RAW" };
      if (StartDocPrinter(printer, 1, info) == 0) throw new Win32Exception();
      try {
        if (!StartPagePrinter(printer)) throw new Win32Exception();
        try {
          int written;
          if (!WritePrinter(printer, bytes, bytes.Length, out written) || written != bytes.Length) throw new Win32Exception();
        } finally { EndPagePrinter(printer); }
      } finally { EndDocPrinter(printer); }
    } finally { ClosePrinter(printer); }
  }
}
'@

Add-Type -TypeDefinition $source
[RawPrinter]::Send($PrinterName, [System.IO.File]::ReadAllBytes($FilePath))
