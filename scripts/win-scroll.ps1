# Cadangan gulir mouse bila modul native tidak bisa dimuat.
# -Spec "p:X,Y,Notches,Restore"  (X,Y = koordinat fisik layar; X=Y=-99999 = di posisi kursor sekarang;
# Notches > 0 = ke bawah). Dikemas jadi satu teks berawalan "p:" karena PowerShell 5.1 -File
# menganggap argumen yang diawali "-" (angka negatif) sebagai nama parameter.
param([string]$Spec = 'p:-99999,-99999,3,1')
$ErrorActionPreference = 'Stop'
$v = $Spec.Substring(2).Split(',') | ForEach-Object { [int]$_ }
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Threading;
public static class BacaLayarMouse {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern void mouse_event(uint f, uint dx, uint dy, int data, UIntPtr extra);
  public static void Scroll(int x, int y, int notches, bool restore) {
    // Koordinat yang dikirim adalah piksel fisik per-monitor.
    bool aware = false;
    try { aware = SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch (Exception) { }
    if (!aware) SetProcessDPIAware();
    POINT old; GetCursorPos(out old);
    bool move = x != -99999 && y != -99999;
    if (move) { SetCursorPos(x, y); Thread.Sleep(40); }
    int n = Math.Abs(notches);
    for (int i = 0; i < n; i++) { mouse_event(0x0800, 0, 0, notches > 0 ? -120 : 120, UIntPtr.Zero); Thread.Sleep(30); }
    if (move && restore) { Thread.Sleep(80); SetCursorPos(old.X, old.Y); }
  }
}
"@
[BacaLayarMouse]::Scroll($v[0], $v[1], $v[2], $v[3] -eq 1)
