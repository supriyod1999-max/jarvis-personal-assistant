$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$dataPath = Join-Path $projectRoot 'data'
New-Item -ItemType Directory -Force -Path $dataPath | Out-Null
Set-Content -LiteralPath (Join-Path $dataPath 'stop-host') -Value 'Stop requested by the user launcher.'
Write-Output 'Stop requested. A launcher-managed host will close shortly. A server started in a terminal must be stopped in that terminal.'
