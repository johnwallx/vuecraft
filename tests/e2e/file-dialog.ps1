# Waits for a native file dialog owned by a process, prints its title, then presses
# Cancel (default) or the default Save/Open button (-Accept). It never types a path,
# so with -Accept the dialog uses the app's default path.
# Win32 only and scoped to the given process: it never queries other applications'
# windows (UI Automation over the whole desktop can stall on unresponsive apps).
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File file-dialog.ps1 -ProcessId 123 [-Accept]
param(
  [Parameter(Mandatory)] [int] $ProcessId,
  [switch] $Accept,
  [int] $TimeoutSec = 20
)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class FileDialogWin32 {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetDlgItem(IntPtr h, int id);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  public static IntPtr Find(uint pid) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      uint owner; GetWindowThreadProcessId(h, out owner);
      if (owner != pid || !IsWindowVisible(h)) return true;
      var cls = new StringBuilder(64); GetClassName(h, cls, 64);
      if (cls.ToString() == "#32770") { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
  public static string Title(IntPtr h) { var s = new StringBuilder(256); GetWindowText(h, s, 256); return s.ToString(); }
  public static bool Press(IntPtr dialog, int id) {
    IntPtr b = GetDlgItem(dialog, id);
    return b != IntPtr.Zero && PostMessage(b, 0x00F5, IntPtr.Zero, IntPtr.Zero); // BM_CLICK
  }
}
'@
$deadline = (Get-Date).AddSeconds($TimeoutSec)
$dialog = [IntPtr]::Zero
while ($dialog -eq [IntPtr]::Zero -and (Get-Date) -lt $deadline) {
  $dialog = [FileDialogWin32]::Find([uint32]$ProcessId)
  if ($dialog -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 150 }
}
if ($dialog -eq [IntPtr]::Zero) { throw "No file dialog appeared for process $ProcessId" }
$id = if ($Accept) { 1 } else { 2 }
Write-Output ([FileDialogWin32]::Title($dialog))
if (-not [FileDialogWin32]::Press($dialog, $id)) { throw "Button $id not found" }
