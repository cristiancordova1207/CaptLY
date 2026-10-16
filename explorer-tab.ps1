# Abre una carpeta como pestaña nueva en la ventana del Explorador que tenga más pestañas.
# Si no hay ningún Explorador abierto, abre una ventana normal.
param([string]$Path)
$ErrorActionPreference = 'Stop'
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class W {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);
}
"@
$shell = New-Object -ComObject Shell.Application
function Tabs { @($shell.Windows() | Where-Object { $_ -and $_.FullName -like '*explorer.exe' }) }

try {
  $all = Tabs
  if (-not $all.Count) { Start-Process explorer.exe -ArgumentList "`"$Path`""; exit }
  $best = $all | Group-Object { [long]$_.HWND } | Sort-Object Count -Descending | Select-Object -First 1
  $hwnd = [IntPtr][long]$best.Name
  $before = $best.Count
  if ([W]::IsIconic($hwnd)) { [W]::ShowWindow($hwnd, 9) | Out-Null }
  [W]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [W]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero) # Alt: Windows deja cambiar el foco
  [W]::SetForegroundWindow($hwnd) | Out-Null
  Start-Sleep -Milliseconds 200
  (New-Object -ComObject WScript.Shell).SendKeys('^t')
  $new = $null
  for ($i = 0; $i -lt 40 -and -not $new; $i++) {
    Start-Sleep -Milliseconds 75
    $mine = @(Tabs | Where-Object { [long]$_.HWND -eq [long]$hwnd })
    if ($mine.Count -gt $before) { $new = @($mine | Where-Object { -not $_.LocationURL })[-1]; if (-not $new) { $new = $mine[-1] } }
  }
  if ($new) { $new.Navigate2($Path) } else { Start-Process explorer.exe -ArgumentList "`"$Path`"" }
} catch {
  Start-Process explorer.exe -ArgumentList "`"$Path`""
}
