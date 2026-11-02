$ErrorActionPreference = 'Stop'
$project = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$source = Join-Path $env:LOCALAPPDATA 'Programs/OpenWhispr/resources/bin'
$target = Join-Path $project 'integrations/whisper'
$baseModel = Join-Path $env:USERPROFILE '.cache/openwhispr/whisper-models/ggml-base.bin'
$mediumModel = Join-Path $env:USERPROFILE '.cache/openwhispr/whisper-models/ggml-medium.bin'
if (-not (Test-Path -LiteralPath (Join-Path $source 'whisper-server-win32-x64.exe'))) { throw 'Install OpenWhispr first; its local Whisper runtime was not found.' }
if (-not (Test-Path -LiteralPath $baseModel) -and -not (Test-Path -LiteralPath $mediumModel)) { throw 'Download Whisper Base in OpenWhispr before running this setup.' }
if ((Test-Path -LiteralPath $baseModel) -and (Get-FileHash -LiteralPath $baseModel -Algorithm SHA256).Hash -ne '60ED5BC3DD14EEA856493D334349B405782DDCAF0028D4B5DF4088345FBA2EFE') { throw 'Whisper Base does not match the verified model. Wait for the download to finish or download it again.' }
New-Item -ItemType Directory -Force -Path $target | Out-Null
Get-ChildItem -LiteralPath $source -File | Where-Object {
  $_.Name -eq 'whisper-server-win32-x64.exe' -or $_.Name -like 'ggml*.dll' -or $_.Name -like 'vcruntime*.dll' -or $_.Name -in @('msvcp140.dll', 'vcomp140.dll', 'libomp140.x86_64.dll')
} | Copy-Item -Destination $target
Get-ChildItem -LiteralPath $target -File | Get-FileHash -Algorithm SHA256 | Select-Object @{Name='File';Expression={Split-Path $_.Path -Leaf}}, Hash | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $target 'installed-checksums.json')
Write-Output 'Local Whisper runtime copied. OpenWhispr and its downloaded model were not changed.'
