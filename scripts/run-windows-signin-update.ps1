$ErrorActionPreference = 'Stop'
$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$resultLog = Join-Path $workspaceRoot 'output\windows-signin\update-result.txt'
try {
    & (Join-Path $PSScriptRoot 'setup-windows-signin.ps1') -Update *> $resultLog
    exit 0
} catch { $_.Exception.Message | Add-Content -LiteralPath $resultLog; exit 1 }
