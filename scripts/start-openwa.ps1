param([switch]$NoBrowser, [switch]$Automatic, [switch]$Background)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$openwaRoot = Join-Path $projectRoot 'integrations\OpenWA'
$runtimeRoot = Join-Path $projectRoot 'data\openwa-host'
if (-not (Test-Path -LiteralPath (Join-Path $openwaRoot 'node_modules\concurrently'))) { throw 'Install OpenWA dependencies first. See docs\OPENWA.md.' }
New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
$stopPath = Join-Path $runtimeRoot 'stop'
if (Test-Path -LiteralPath $stopPath) {
    if ($Automatic) { Write-Output 'OpenWA remains stopped by your choice. Use Start OpenWA to resume.'; exit }
    Remove-Item -LiteralPath $stopPath
}
$running = Get-NetTCPConnection -LocalPort 2785,2886 -State Listen -ErrorAction SilentlyContinue
if (-not $running) {
    $env:PUPPETEER_CACHE_DIR = Join-Path $openwaRoot '.browser-cache'
    $nodeExecutable = (Get-Command node -ErrorAction Stop).Source
    $watcher = Join-Path $PSScriptRoot 'watch-openwa.ps1'
    Start-Process -FilePath 'powershell.exe' -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File "' + $watcher + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden
    Write-Output 'OpenWA recovery supervisor requested.'
} elseif (($running.LocalPort | Select-Object -Unique).Count -lt 2) {
    throw 'One OpenWA port is already occupied. Check the existing process before starting another instance.'
} else { Write-Output 'The OpenWA ports are already listening.' }
if (-not $Background) {
    $deadline = (Get-Date).AddSeconds(100)
    $ready = $false
    while ((Get-Date) -lt $deadline) {
        try { $ready = (Invoke-RestMethod -Uri 'http://127.0.0.1:2785/api/health/live' -TimeoutSec 3).status -eq 'ok' } catch { $ready = $false }
        if ($ready) { break }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) { throw 'OpenWA is not ready. Check data\openwa-host\health.json for recovery status.' }
    Write-Output 'OpenWA API is running. Check each account for linked-device status.'
}
if (-not $NoBrowser) { Start-Process 'http://localhost:2886' }
