# Thread wait state, CPU time and responsiveness of the app and its WebView2 processes.
# Usage: process-state.ps1 <pid>   -> JSON array
param([Parameter(Mandatory)] [int] $ProcessId)
$ErrorActionPreference = 'Stop'
$all = @(Get-CimInstance Win32_Process)
$ids = @($ProcessId)
do {
  $more = @($all | Where-Object { $ids -contains $_.ParentProcessId -and $ids -notcontains $_.ProcessId } | ForEach-Object { $_.ProcessId })
  $ids += $more
} while ($more.Count)
$out = foreach ($id in $ids) {
  $p = Get-Process -Id $id -ErrorAction SilentlyContinue
  if (-not $p) { continue }
  $cmd = ($all | Where-Object ProcessId -eq $id).CommandLine
  $type = if ($id -eq $ProcessId) { 'app' } elseif ($cmd -match '--type=([a-z-]+)') { $Matches[1] } else { 'browser' }
  $main = $p.Threads | Sort-Object StartTime | Select-Object -First 1
  [pscustomobject]@{ pid = $id; type = $type; cpuMs = [int]$p.TotalProcessorTime.TotalMilliseconds; threads = $p.Threads.Count
    mainThread = "$($main.ThreadState)/$($main.WaitReason)"; responding = $p.Responding }
}
ConvertTo-Json -InputObject @($out) -Compress
