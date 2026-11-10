# Installer test for the production NSIS package (per-user install, no admin).
# Installs silently and checks files, registry and the .vuecraft association (.vue and .mapw left
# alone). Launches the installed app, adds a node, saves through the real Save As dialog into
# Documents, closes, relaunches, reopens through the real Open dialog, and opens the file again
# through its association (as a double-click does). Opens a development-era .mapw document (group,
# two layers, a connection, rich text, a link and a file attachment, an embedded image), saves it as
# .vuecraft and checks nothing but the format marker changed, exports SVG through the real dialog,
# and double-clicks the upgraded file. Finally uninstalls silently and checks cleanup and that every
# user document is untouched.
# Drives the app with Windows UI Automation (built into Windows) and window messages, so no
# keyboard input or focus is needed: hands off the dialogs while it runs.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File installer-test.ps1 -Installer <setup.exe>
param(
  [Parameter(Mandatory)] [string] $Installer,
  [string] $Fixture
)
$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1 leaves $PSScriptRoot empty in parameter defaults, so resolve it here.
if (-not $Fixture) { $Fixture = Join-Path $PSScriptRoot '..\fixtures\native\r1-full.mapw' }
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$A = [System.Windows.Automation.AutomationElement]
$AE = [System.Windows.Automation.AutomationElement] # not $P: PowerShell names are case-insensitive ($p is used below)
$Scope = [System.Windows.Automation.TreeScope]
$Version = '0.1.0-beta.1'
$Publisher = 'John Wall'
$results = [ordered]@{}
function Check($name, $ok, $detail = '') {
  $results[$name] = if ($ok) { "PASS $detail" } else { "FAIL $detail" }
  Write-Output ("{0} {1} {2}" -f ($(if ($ok) { 'PASS' } else { 'FAIL' })), $name, $detail)
}
function Cond($prop, $value) { New-Object System.Windows.Automation.PropertyCondition($prop, $value) }
function All($a, $b) { New-Object System.Windows.Automation.AndCondition($a, $b) }
function Poll([scriptblock] $f, [int] $sec = 20) {
  $end = (Get-Date).AddSeconds($sec)
  do { $r = & $f; if ($r) { return $r }; Start-Sleep -Milliseconds 250 } while ((Get-Date) -lt $end)
  return $null
}
function MainWindow($procId) {
  Poll { $A::RootElement.FindFirst($Scope::Children, (All (Cond ($AE::ProcessIdProperty) $procId) (Cond ($AE::ControlTypeProperty) ([System.Windows.Automation.ControlType]::Window)))) }
}
function Button($win, $name) {
  Poll { $win.FindFirst($Scope::Descendants, (All (Cond ($AE::NameProperty) $name) (Cond ($AE::ControlTypeProperty) ([System.Windows.Automation.ControlType]::Button)))) }
}
function Invoke($el) { $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() }
function CloseWindow($win) { $win.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern).Close() }
# The common file dialog is owned by the app window, so it sits under it in the UIA tree.
function FileDialog($win) {
  Poll { $win.FindFirst($Scope::Children, (Cond ($AE::ClassNameProperty) '#32770')) }
}
# File-name box: Win32 Edit 1001 (Save) or 1148 (Open). Confirm: Win32 Button 1 (the folder
# listing also has items with id 1, so match the class too). Narrow conditions keep the search
# away from the listing, which is slow to walk.
function ChooseFile($dlg, $path) {
  $edit = Poll { foreach ($id in '1001', '1148') { $e = $dlg.FindFirst($Scope::Descendants, (All (Cond ($AE::ClassNameProperty) 'Edit') (Cond ($AE::AutomationIdProperty) $id))); if ($e) { return $e } } }
  if (-not $edit) { throw 'file name box not found in the dialog' }
  # The edit has no UIA Value pattern and the dialog ignores WM_SETTEXT, so type into it with
  # WM_CHAR (no keyboard focus needed): select all, then one message per character.
  $h = [IntPtr]$edit.Current.NativeWindowHandle
  $null = [DialogWin32]::SendMessageP($h, 0x00B1, [IntPtr]0, [IntPtr](-1)) # EM_SETSEL all
  foreach ($ch in $path.ToCharArray()) { $null = [DialogWin32]::SendMessageP($h, 0x0102, [IntPtr][int]$ch, [IntPtr]::Zero) } # WM_CHAR
  $text = New-Object System.Text.StringBuilder 1024
  $null = [DialogWin32]::SendMessageText($h, 0x000D, [IntPtr]1024, $text) # WM_GETTEXT (works across processes)
  $dlgHwnd = [IntPtr]$dlg.Current.NativeWindowHandle
  if ($text.ToString() -ne $path) {
    # Never confirm a wrong name (it would save into the dialog's default folder): cancel.
    $null = [DialogWin32]::PostMessage([DialogWin32]::GetDlgItem($dlgHwnd, 2), 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
    throw "file name box holds '$($text.ToString())', not the intended path; dialog cancelled"
  }
  # Confirm with the dialog's own button 1 (IDOK), BM_CLICK.
  $ok = [DialogWin32]::GetDlgItem($dlgHwnd, 1)
  if ($ok -eq [IntPtr]::Zero) { throw 'confirm button not found in the dialog' }
  $null = [DialogWin32]::PostMessage($ok, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) # BM_CLICK
}
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class DialogWin32 {
  [DllImport("user32.dll", EntryPoint = "SendMessageW")] public static extern IntPtr SendMessageP(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll", EntryPoint = "SendMessageW", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessageText(IntPtr h, uint m, IntPtr w, System.Text.StringBuilder l);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr h, int id);
}
'@
function ReadJson($path) { Get-Content $path -Raw -Encoding UTF8 | ConvertFrom-Json }
function Canonical($obj) { $obj | ConvertTo-Json -Depth 40 -Compress }
# Launches the installed app (or opens $doc through the shell) and returns its process and window.
function Launch([string] $doc) {
  if ($doc) {
    $known = @(Get-Process vuecraft -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
    Start-Process -FilePath $doc
    $proc = Poll { Get-Process vuecraft -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$installDir*" -and $known -notcontains $_.Id } | Select-Object -First 1 }
  } else { $proc = Start-Process -FilePath $exe -PassThru }
  if (-not $proc) { throw "no VUECraft process started for '$doc'" }
  [pscustomobject]@{ Proc = $proc; Win = (MainWindow $proc.Id) }
}
function TitleShows($app, $fileName) { Poll { $w = MainWindow $app.Proc.Id; if ($w -and $w.Current.Name -like "*$fileName*") { $w } } }
function Shows($win, $label) { [bool](Poll { $win.FindFirst($Scope::Descendants, (Cond ($AE::NameProperty) $label)) } 10) }
# Registry state of a file extension under HKCU\Software\Classes, for before/after comparison.
function ExtState($ext) {
  $k = "HKCU:\Software\Classes\$ext"
  if (-not (Test-Path $k)) { return 'absent' }
  $i = Get-Item $k
  $values = ($i.Property | Sort-Object | ForEach-Object { "$_=$((Get-ItemProperty $k).$_)" }) -join ';'
  $subkeys = (Get-ChildItem $k | ForEach-Object { $_.PSChildName } | Sort-Object) -join ','
  "values[$values] subkeys[$subkeys]"
}
# On any failure: close test instances, uninstall, and remove the association leftover the
# uninstaller could leave (only when it holds nothing but installer values), so reruns start clean.
function Cleanup {
  Get-Process vuecraft -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$installDir*" } | Stop-Process -Force
  $un = Join-Path $installDir 'uninstall.exe'
  if (Test-Path $un) { Start-Process -FilePath $un -ArgumentList '/S' -Wait; Start-Sleep -Seconds 3 }
  $k = 'HKCU:\Software\Classes\.vuecraft'
  if ($before['.vuecraft'] -eq 'absent' -and (Test-Path $k)) {
    $i = Get-Item $k
    if ($i.SubKeyCount -eq 0 -and -not (@($i.Property) | Where-Object { $_ -notin @('(default)', 'VUECraft Map_backup') }) -and [string]::IsNullOrEmpty((Get-ItemProperty $k).'(default)')) { Remove-Item $k }
  }
}
function Uninstall-Keys { Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' | Where-Object { (Get-ItemProperty $_.PSPath).DisplayName -like 'VUECraft*' } }

$installDir = Join-Path $env:LOCALAPPDATA 'VUECraft'
$exe = Join-Path $installDir 'vuecraft.exe'
$docDir = Join-Path ([Environment]::GetFolderPath('MyDocuments')) ("VUECraft install test " + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$doc = Join-Path $docDir 'installed-test.vuecraft'
$legacy = Join-Path $docDir 'legacy-r1.mapw'
$upgraded = Join-Path $docDir 'upgraded.vuecraft'
$svg = Join-Path $docDir 'upgraded.svg'

# 0. Refuse to touch an existing installation.
if ((Test-Path $installDir) -or (Uninstall-Keys)) { throw "VUECraft is already installed for this user ($installDir); not touching it." }
if (-not (Test-Path $Fixture)) { throw "fixture not found: $Fixture" }
$before = @{}
foreach ($ext in '.vuecraft', '.mapw', '.vue') { $before[$ext] = ExtState $ext }
New-Item -ItemType Directory -Path $docDir | Out-Null
Copy-Item $Fixture $legacy

try {
# 1. Silent per-user install.
$p = Start-Process -FilePath $Installer -ArgumentList '/S' -Wait -PassThru
Check 'install exit code 0' ($p.ExitCode -eq 0) "exit=$($p.ExitCode)"
Check 'installed executable' (Test-Path $exe) $exe
foreach ($f in 'LICENSE-MIT', 'LICENSE-APACHE', 'THIRD_PARTY_NOTICES.md') { Check "installed $f" (Test-Path (Join-Path $installDir $f)) }
$installedNotices = Join-Path $installDir 'THIRD_PARTY_NOTICES.md'
Check 'installed notices include the WebView2 loader license and notice' ((Test-Path $installedNotices) -and (Select-String -Path $installedNotices -SimpleMatch 'Microsoft Edge WebView2 Loader' -Quiet) -and (Select-String -Path $installedNotices -SimpleMatch 'Antlr3.Runtime' -Quiet))
$key = Uninstall-Keys | Select-Object -First 1
$entry = if ($key) { Get-ItemProperty $key.PSPath }
Check 'uninstall entry: name, version, publisher' ($entry -and $entry.DisplayName -eq 'VUECraft' -and $entry.DisplayVersion -eq $Version -and $entry.Publisher -eq $Publisher) "'$($entry.DisplayName)' '$($entry.DisplayVersion)' '$($entry.Publisher)'"
$hdr = [System.IO.File]::ReadAllBytes($exe); $pe = [BitConverter]::ToInt32($hdr, 0x3C)
Check 'GUI subsystem (no console window)' ([BitConverter]::ToUInt16($hdr, $pe + 0x5C) -eq 2)
$vi = (Get-Item $exe).VersionInfo
Check 'executable version and copyright' ($vi.ProductVersion -eq $Version -and $vi.LegalCopyright -eq "Copyright (c) 2026 $Publisher") "product='$($vi.ProductName)' version='$($vi.ProductVersion)' copyright='$($vi.LegalCopyright)'"
$progId = (Get-ItemProperty 'HKCU:\Software\Classes\.vuecraft' -ErrorAction SilentlyContinue).'(default)'
$command = if ($progId) { (Get-ItemProperty "HKCU:\Software\Classes\$progId\shell\open\command" -ErrorAction SilentlyContinue).'(default)' }
Check '.vuecraft registered to the installed program' ($command -like "*$exe*") "progid='$progId' command='$command'"
Check '.vue and .mapw registrations untouched' ((ExtState '.vue') -eq $before['.vue'] -and (ExtState '.mapw') -eq $before['.mapw']) ".vue: $(ExtState '.vue'); .mapw: $(ExtState '.mapw')"

# 2. Launch from the installed location, add a node, Save As into Documents.
$app = Launch
Check 'installed app window opens' ([bool]$app.Win) "pid=$($app.Proc.Id)"
Invoke (Button $app.Win 'Add Node')
Start-Sleep -Milliseconds 500
Invoke (Button $app.Win "Save As$([char]0x2026)")
$dlg = FileDialog $app.Win
Check 'Save As dialog opens' ([bool]$dlg)
ChooseFile $dlg $doc
$saved = Poll { if (Test-Path $doc) { Start-Sleep -Milliseconds 300; ReadJson $doc } }
Check 'document saved to Documents' ([bool]$saved) $doc
Check 'saved document is a VUECraft file with the new node' ($saved.format -eq 'vuecraft' -and @($saved.nodes).Count -eq 1) ("format=$($saved.format) nodes=" + @($saved.nodes).Count)
CloseWindow $app.Win
Check 'app closes after saving (no unsaved prompt)' ($app.Proc.WaitForExit(15000))

# 3. Relaunch and reopen through the Open dialog.
$app2 = Launch
Check 'relaunched as a new process' ([bool]$app2.Win -and $app2.Proc.Id -ne $app.Proc.Id) "pid=$($app2.Proc.Id)"
Invoke (Button $app2.Win "Open$([char]0x2026)")
$dlg2 = FileDialog $app2.Win
Check 'Open dialog opens' ([bool]$dlg2)
ChooseFile $dlg2 $doc
$titled = TitleShows $app2 'installed-test.vuecraft'
Check 'document reopened (window title names the file)' ([bool]$titled) $(if ($titled) { $titled.Current.Name })
$label = $saved.nodes[0].label
Check 'reopened node is shown' (Shows $app2.Win $label) "label='$label'"
CloseWindow $app2.Win
Check 'app closes' ($app2.Proc.WaitForExit(15000))

# 4. Open the document through its .vuecraft association, as a double-click in Explorer does.
$app3 = Launch $doc
$assocTitled = TitleShows $app3 'installed-test.vuecraft'
Check 'double-clicked .vuecraft opens in VUECraft' ([bool]$assocTitled) $(if ($assocTitled) { $assocTitled.Current.Name })
CloseWindow $app3.Win
Check 'app closes (association launch)' ($app3.Proc.WaitForExit(15000))

# 5. Development-era .mapw document: open, Save As .vuecraft (lossless), export SVG.
$legacyHash = (Get-FileHash $legacy).Hash
$app4 = Launch
Invoke (Button $app4.Win "Open$([char]0x2026)")
ChooseFile (FileDialog $app4.Win) $legacy
$legacyTitled = TitleShows $app4 'legacy-r1.mapw'
Check 'legacy .mapw document opens' ([bool]$legacyTitled) $(if ($legacyTitled) { $legacyTitled.Current.Name })
Check 'legacy content is shown (group member, second layer, connection label)' ((Shows $app4.Win 'Beta') -and (Shows $app4.Win 'Notes') -and (Shows $app4.Win 'explains'))
Invoke (Button $app4.Win "Save As$([char]0x2026)")
ChooseFile (FileDialog $app4.Win) $upgraded
$up = Poll { if (Test-Path $upgraded) { Start-Sleep -Milliseconds 300; ReadJson $upgraded } }
$expected = ReadJson $Fixture; $expected.format = 'vuecraft'
Check 'saved as .vuecraft: nodes, connection, layers, rich text, attachments, image unchanged' ($up -and (Canonical $up) -eq (Canonical $expected)) ("nodes=$(@($up.nodes).Count) edges=$(@($up.edges).Count) layers=$(@($up.layers).Count) format=$($up.format)")
Invoke (Button $app4.Win "Export SVG$([char]0x2026)")
ChooseFile (FileDialog $app4.Win) $svg
$svgText = Poll { if (Test-Path $svg) { Start-Sleep -Milliseconds 300; Get-Content $svg -Raw -Encoding UTF8 } }
$svgOk = $false
if ($svgText) { try { $x = [xml]$svgText; $svgOk = $x.DocumentElement.LocalName -eq 'svg' -and $svgText -match 'Beta' -and $svgText -match 'Notes' -and $svgText -match 'explains' -and $svgText -match '<image' } catch { $svgOk = $false } }
Check 'SVG export: well-formed, labels and the embedded image present' $svgOk $svg
CloseWindow $app4.Win
Check 'app closes after Save As and export (no unsaved prompt)' ($app4.Proc.WaitForExit(15000))
Check 'legacy .mapw file left unchanged' ((Get-FileHash $legacy).Hash -eq $legacyHash)

# 6. Double-click the upgraded document.
$app5 = Launch $upgraded
Check 'double-clicked upgraded .vuecraft opens with its content' ([bool](TitleShows $app5 'upgraded.vuecraft') -and (Shows $app5.Win 'Notes'))
CloseWindow $app5.Win
Check 'app closes (upgraded document)' ($app5.Proc.WaitForExit(15000))

# 7. Silent uninstall; program files and registration gone, the user's documents untouched.
$hashes = @{}; foreach ($f in $doc, $legacy, $upgraded, $svg) { if (Test-Path $f) { $hashes[$f] = (Get-FileHash $f).Hash } }
$u = Start-Process -FilePath (Join-Path $installDir 'uninstall.exe') -ArgumentList '/S' -Wait -PassThru
$gone = Poll { if (-not (Test-Path $exe)) { $true } } 30
Check 'uninstall removes the program' ([bool]$gone) "exit=$($u.ExitCode)"
# The silent uninstaller re-launches itself from a temp copy and finishes (hooks included)
# after the program files are gone, so wait for the registry state too.
Check 'uninstall entry removed' ([bool](Poll { if (-not (Uninstall-Keys)) { $true } } 20))
Check '.vuecraft association back to its previous state' ([bool](Poll { if ((ExtState '.vuecraft') -eq $before['.vuecraft']) { $true } } 20)) (ExtState '.vuecraft')
Check '.vue and .mapw registrations still untouched' ((ExtState '.vue') -eq $before['.vue'] -and (ExtState '.mapw') -eq $before['.mapw'])
Check 'user documents kept and unchanged' ($hashes.Count -eq 4 -and -not ($hashes.Keys | Where-Object { -not (Test-Path $_) -or (Get-FileHash $_).Hash -ne $hashes[$_] })) "$($hashes.Count) files in $docDir"

} catch {
  Check "script completed" $false "$_"
} finally {
  Cleanup
}

$failed = @($results.Values | Where-Object { $_ -like 'FAIL*' }).Count
Write-Output "SUMMARY: $($results.Count - $failed)/$($results.Count) passed; document folder kept: $docDir"
if ($failed) { exit 1 }
