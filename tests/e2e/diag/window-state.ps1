# Native state of the app's main window, optionally minimizing or restoring it first.
# Win32 only and scoped to one process: no other application's windows are queried.
# Usage: window-state.ps1 <pid> [state|minimize|restore]   -> one line of JSON
param([Parameter(Mandatory)] [int] $ProcessId, [string] $Action = 'state')
$ErrorActionPreference = 'Stop'
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class VUECraftWindow {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint c);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsHungAppWindow(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int s);
  public static string State(uint pid, string action) {
    IntPtr w = IntPtr.Zero;
    EnumWindows((h, l) => { uint o; GetWindowThreadProcessId(h, out o);
      if (o == pid && IsWindowVisible(h) && GetWindow(h, 4) == IntPtr.Zero) { w = h; return false; } return true; }, IntPtr.Zero);
    if (w == IntPtr.Zero) return "{\"window\":false}";
    if (action == "minimize") ShowWindow(w, 6); else if (action == "restore") ShowWindow(w, 9);
    int cloaked; DwmGetWindowAttribute(w, 14, out cloaked, 4);
    return "{\"window\":true,\"hwnd\":" + w.ToInt64() + ",\"iconic\":" + IsIconic(w).ToString().ToLower()
      + ",\"hung\":" + IsHungAppWindow(w).ToString().ToLower()
      + ",\"foreground\":" + (GetForegroundWindow() == w).ToString().ToLower() + ",\"cloaked\":" + cloaked + "}";
  }
}
'@
[VUECraftWindow]::State([uint32]$ProcessId, $Action)
