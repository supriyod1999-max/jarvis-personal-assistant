param([int]$IgnoreProcessId)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class JarvisScreenProbe {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct MonitorInfo { public int Size; public Rect Monitor, Work; public uint Flags; }
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out Rect r);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref Point p);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr h, ref MonitorInfo info);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder name, int max);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  public static bool Fullscreen(uint ignorePid) {
    SetProcessDPIAware(); var h = GetForegroundWindow(); if (h == IntPtr.Zero) return true;
    uint pid; GetWindowThreadProcessId(h, out pid); if (pid == ignorePid) return false;
    var name = new StringBuilder(128); GetClassName(h, name, 128);
    if (name.ToString() == "Progman" || name.ToString() == "WorkerW" || name.ToString() == "Shell_TrayWnd") return false;
    Rect r; if (!GetClientRect(h, out r)) return true;
    var p = new Point(); if (!ClientToScreen(h, ref p)) return true;
    var info = new MonitorInfo(); info.Size = Marshal.SizeOf(info);
    if (!GetMonitorInfo(MonitorFromWindow(h, 2), ref info)) return true;
    return p.X <= info.Monitor.Left + 2 && p.Y <= info.Monitor.Top + 2
      && p.X + r.Right >= info.Monitor.Right - 2 && p.Y + r.Bottom >= info.Monitor.Bottom - 2;
  }
}
'@
$previousFullscreen = ''
while ($true) {
  if (-not (Get-Process -Id $IgnoreProcessId -ErrorAction SilentlyContinue)) { break }
  $currentFullscreen = [JarvisScreenProbe]::Fullscreen([uint32]$IgnoreProcessId).ToString().ToLowerInvariant()
  if ($currentFullscreen -ne $previousFullscreen) { [Console]::WriteLine($currentFullscreen); [Console]::Out.Flush(); $previousFullscreen = $currentFullscreen }
  Start-Sleep -Milliseconds 650
}
