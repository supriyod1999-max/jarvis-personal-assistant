$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$openwaRoot = Join-Path $projectRoot 'integrations\OpenWA'
$runtimeRoot = Join-Path $projectRoot 'data\openwa-host'
$stopPath = Join-Path $runtimeRoot 'stop'
$mutex = New-Object System.Threading.Mutex($false, 'Local\JarvisOpenWASupervisor2785')
$ownsMutex = $false
try {
    try { $ownsMutex = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $ownsMutex = $true }
    if (-not $ownsMutex -or (Test-Path -LiteralPath $stopPath)) { exit }
    # Never adopt or kill an unrelated process based solely on its port.
    if (Get-NetTCPConnection -LocalPort 2785,2886 -State Listen -ErrorAction SilentlyContinue) { exit }
    $env:PUPPETEER_CACHE_DIR = Join-Path $openwaRoot '.browser-cache'
    $nodeExecutable = (Get-Command node -ErrorAction Stop).Source
    $launcher = Join-Path $PSScriptRoot 'openwa-host.mjs'
    $delay = 2
    while (-not (Test-Path -LiteralPath $stopPath)) {
        $started = Get-Date
        $process = Start-Process -FilePath $nodeExecutable -ArgumentList ('"' + $launcher + '"') -WorkingDirectory $openwaRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeRoot 'console.log') -RedirectStandardError (Join-Path $runtimeRoot 'errors.log')
        @{ pid = $process.Id; startedAt = $process.StartTime.ToUniversalTime().ToString('o'); supervisorPid = $PID } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeRoot 'process.json')
        $failures = 0
        while (-not $process.HasExited -and -not (Test-Path -LiteralPath $stopPath)) {
            try { $ready = (Invoke-RestMethod -Uri 'http://127.0.0.1:2785/api/health/live' -TimeoutSec 3).status -eq 'ok' } catch { $ready = $false }
            $age = ((Get-Date) - $started).TotalSeconds
            if ($ready) { $failures = 0; if ($age -gt 120) { $delay = 2 } }
            elseif ($age -gt 120) { $failures++ }
            @{ at = (Get-Date).ToUniversalTime().ToString('o'); state = $(if ($ready) { 'service-running' } elseif ($age -le 120) { 'starting' } else { 'service-unresponsive' }); consecutiveFailures = $failures; sessionStatus = 'Check individual accounts in JARVIS' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeRoot 'health.json')
            if ($failures -ge 3) { break }
            for ($i = 0; $i -lt 15 -and -not $process.HasExited -and -not (Test-Path -LiteralPath $stopPath); $i++) { Start-Sleep -Seconds 1; $process.Refresh() }
        }
        if (-not $process.HasExited) {
            & (Join-Path $env:SystemRoot 'System32\taskkill.exe') /PID $process.Id /T /F | Out-Null
            $process.WaitForExit()
        }
        if (Test-Path -LiteralPath $stopPath) { break }
        @{ at = (Get-Date).ToUniversalTime().ToString('o'); state = 'retrying'; retrySeconds = $delay } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeRoot 'health.json')
        for ($i = 0; $i -lt $delay -and -not (Test-Path -LiteralPath $stopPath); $i++) { Start-Sleep -Seconds 1 }
        $delay = [Math]::Min($delay * 2, 60)
    }
} finally {
    if ($ownsMutex) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
