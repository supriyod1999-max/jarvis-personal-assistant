param([switch]$NoBrowser, [switch]$Watch)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$nodePath = (Get-Command node -ErrorAction Stop).Source
$appUrl = 'http://127.0.0.1:4317'
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'dist\index.html'))) { throw 'Build Second Brain first: npm.cmd run build' }

function Test-BrainRunning {
    try { return (Invoke-RestMethod -Uri "$appUrl/api/health" -TimeoutSec 2).version -eq '0.1.0' } catch { return $false }
}

if (-not $Watch) {
    try { & (Join-Path $PSScriptRoot 'start-openwa.ps1') -NoBrowser -Automatic -Background } catch { Write-Warning 'OpenWA could not start; JARVIS will still start. Check the OpenWA launcher.' }
    if (-not (Test-BrainRunning)) {
        $arguments = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -Watch -NoBrowser' -f $PSCommandPath
        Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WorkingDirectory $projectRoot -WindowStyle Hidden
        for ($attempt = 0; $attempt -lt 20; $attempt++) {
            if (Test-BrainRunning) { break }
            Start-Sleep -Milliseconds 500
        }
    }
    if (-not (Test-BrainRunning)) { throw 'Second Brain could not start. Check data\server-error.log, or whether port 4317 is already in use.' }
    if (-not $NoBrowser) { Start-Process $appUrl }
    exit
}

$mutex = New-Object System.Threading.Mutex($false, 'Local\SecondBrainPersonalSupervisor4317')
$ownsMutex = $false
try {
    try { $ownsMutex = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $ownsMutex = $true }
    if (-not $ownsMutex) { exit }
    try { & (Join-Path $PSScriptRoot 'start-openwa.ps1') -NoBrowser -Automatic -Background } catch { Write-Warning 'OpenWA could not start; JARVIS will still start. Check the OpenWA launcher.' }
    if (Test-BrainRunning) { exit }
    $dataPath = Join-Path $projectRoot 'data'
    New-Item -ItemType Directory -Force -Path $dataPath | Out-Null
    $stopPath = Join-Path $dataPath 'stop-host'
    if (Test-Path -LiteralPath $stopPath) { Remove-Item -LiteralPath $stopPath }
    $delay = 2
    while ($true) {
        $startedAt = Get-Date
        $arguments = '"{0}"' -f (Join-Path $projectRoot 'server\index.mjs')
        $serverProcess = Start-Process -FilePath $nodePath -ArgumentList $arguments -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $dataPath 'server.log') -RedirectStandardError (Join-Path $dataPath 'server-error.log')
        @{ supervisorPid = $PID; serverPid = $serverProcess.Id; startedAt = $startedAt.ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $dataPath 'host.json')
        while (-not $serverProcess.HasExited) {
            if (Test-Path -LiteralPath $stopPath) {
                # Node observes the marker and closes its model workers first.
                if (-not $serverProcess.WaitForExit(15000)) {
                    & (Join-Path $env:SystemRoot 'System32\taskkill.exe') /PID $serverProcess.Id /T /F | Out-Null
                    $serverProcess.WaitForExit()
                }
                return
            }
            Start-Sleep -Seconds 1
            $serverProcess.Refresh()
        }
        if (Test-Path -LiteralPath $stopPath) { return }
        if (((Get-Date) - $startedAt).TotalSeconds -gt 60) { $delay = 2 }
        Start-Sleep -Seconds $delay
        $delay = [Math]::Min($delay * 2, 60)
    }
} finally {
    if ($ownsMutex) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
