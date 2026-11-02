$ErrorActionPreference = 'Stop'
$kokoroRoot = Split-Path $PSScriptRoot -Parent
$kokoroUv = (Get-Command uv -ErrorAction Stop).Source
$env:UV_PYTHON_INSTALL_DIR = Join-Path $kokoroRoot 'data/voice-python'
& $kokoroUv python install 3.11.15 --no-bin
if ($LASTEXITCODE -ne 0) { throw 'Python setup failed.' }
$kokoroPython = (& $kokoroUv python find 3.11.15).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Python 3.11.15 was not found.' }

$kokoroEnvironment = Join-Path $kokoroRoot 'integrations/kokoro/.venv'
$env:UV_CACHE_DIR = Join-Path $kokoroRoot 'data/voice-package-cache'
if (-not (Test-Path -LiteralPath $kokoroUv) -or -not (Test-Path -LiteralPath $kokoroPython)) { throw 'The existing project Python/uv installation is required. See VOICE-SETUP.md.' }
if (-not (Test-Path -LiteralPath (Join-Path $kokoroEnvironment 'Scripts/python.exe'))) {
    & $kokoroUv venv --python $kokoroPython $kokoroEnvironment
    if ($LASTEXITCODE -ne 0) { throw 'Kokoro environment creation failed.' }
}
& $kokoroUv pip sync --python (Join-Path $kokoroEnvironment 'Scripts/python.exe') --require-hashes (Join-Path $PSScriptRoot 'kokoro-packages.lock') --index-url https://pypi.org/simple
if ($LASTEXITCODE -ne 0) { throw 'Kokoro dependency installation failed.' }
& (Join-Path $kokoroEnvironment 'Scripts/python.exe') (Join-Path $PSScriptRoot 'download_kokoro.py')
if ($LASTEXITCODE -ne 0) { throw 'Kokoro model verification failed.' }
Write-Output 'Local Kokoro Daniel assets installed. Restart JARVIS after the speech checks pass.'
