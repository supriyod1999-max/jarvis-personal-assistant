param([switch]$Remove)
$ErrorActionPreference = 'Stop'
$jarvisProject = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$jarvisStartup = [Environment]::GetFolderPath('Startup')
if (-not $jarvisStartup) { throw 'Windows Startup folder is unavailable.' }
$jarvisLinkPath = Join-Path $jarvisStartup 'JARVIS Desktop.lnk'
if ($Remove) {
    if (Test-Path -LiteralPath $jarvisLinkPath) { Remove-Item -LiteralPath $jarvisLinkPath }
    Write-Output 'JARVIS desktop startup removed. Server startup is unchanged.'
    exit
}
$jarvisExecutable = Join-Path $jarvisProject 'output\desktop\JARVIS-win32-x64\JARVIS.exe'
if (-not (Test-Path -LiteralPath $jarvisExecutable -PathType Leaf)) { throw 'Package JARVIS Desktop before enabling login startup.' }
$jarvisShell = New-Object -ComObject WScript.Shell
$jarvisShortcut = $jarvisShell.CreateShortcut($jarvisLinkPath)
$jarvisShortcut.TargetPath = $jarvisExecutable
$jarvisShortcut.Arguments = '--background'
$jarvisShortcut.WorkingDirectory = $jarvisProject
$jarvisShortcut.WindowStyle = 7
$jarvisShortcut.Description = 'Open JARVIS at Windows sign-in as a quiet island. Microphone starts off.'
$jarvisShortcut.Save()
$jarvisReadback = $jarvisShell.CreateShortcut($jarvisLinkPath)
if ($jarvisReadback.TargetPath -ne $jarvisExecutable -or $jarvisReadback.Arguments -ne '--background') { throw 'The desktop startup shortcut could not be verified.' }
Write-Output 'Verified JARVIS desktop startup: compact island after Windows sign-in; microphone off.'
