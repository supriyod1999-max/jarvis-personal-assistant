$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$pidFile = Join-Path $projectRoot 'data\openwa-host\process.json'
$runtimeRoot = Split-Path -Parent $pidFile
New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
Set-Content -LiteralPath (Join-Path $runtimeRoot 'stop') -Value 'Stopped by the owner; automatic startup must not resume.'
if (-not (Test-Path -LiteralPath $pidFile)) { Write-Output 'No launcher-owned OpenWA process was recorded.'; exit }
$metadata = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
$process = Get-Process -Id $metadata.pid -ErrorAction SilentlyContinue
if ($process) {
    $recordedStart = if ($metadata.startedAt -is [DateTime]) { [DateTimeOffset]$metadata.startedAt } else { [DateTimeOffset]::Parse([string]$metadata.startedAt) }
    if ([Math]::Abs($process.StartTime.ToUniversalTime().Ticks - $recordedStart.UtcTicks) -gt 10000) { throw 'The recorded process id now belongs to a different process. Nothing was stopped.' }
    & (Join-Path $env:SystemRoot 'System32\taskkill.exe') /PID $metadata.pid /T /F | Out-Null
}
if ($metadata.supervisorPid) {
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        if (-not (Get-Process -Id $metadata.supervisorPid -ErrorAction SilentlyContinue)) { break }
        Start-Sleep -Milliseconds 500
    }
    if (Get-Process -Id $metadata.supervisorPid -ErrorAction SilentlyContinue) { throw 'OpenWA stop was requested, but the supervisor has not exited yet. Wait before starting it again.' }
}
Write-Output 'Stopped the launcher-owned OpenWA process tree. Saved data is retained.'
