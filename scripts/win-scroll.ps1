# Cadangan gulir mouse bila modul native tidak bisa dimuat.
# X,Y = koordinat fisik layar (-1 = di posisi kursor sekarang). Notches > 0 = ke bawah.
param([int]$X = -1, [int]$Y = -1, [int]$Notches = 3, [int]$Restore = 1)
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Threading;
public static class BacaLayarMouse {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, int data, UIntPtr extra);
  public static void Scroll(int x, int y, int notches, bool restore) {
    SetProcessDPIAware();
    POINT old; GetCursorPos(out old);
    bool move = x >= 0 && y >= 0;
    if (move) { SetCursorPos(x, y); Thread.Sleep(40); }
    int n = Math.Abs(notches);
    for (int i = 0; i < n; i++) { mouse_event(0x0800, 0, 0, notches > 0 ? -120 : 120, UIntPtr.Zero); Thread.Sleep(30); }
    if (move && restore) { Thread.Sleep(80); SetCursorPos(old.X, old.Y); }
  }
}
"@
[BacaLayarMouse]::Scroll($X, $Y, $Notches, $Restore -eq 1)
