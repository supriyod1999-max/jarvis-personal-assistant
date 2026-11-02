$ErrorActionPreference = 'Stop'
$kokoroGpuRoot = Split-Path $PSScriptRoot -Parent
$kokoroGpuUv = (Get-Command uv -ErrorAction Stop).Source
$env:UV_PYTHON_INSTALL_DIR = Join-Path $kokoroGpuRoot 'data/voice-python'
& $kokoroGpuUv python install 3.11.15 --no-bin
if ($LASTEXITCODE -ne 0) { throw 'Python setup failed.' }
$kokoroGpuPython = (& $kokoroGpuUv python find 3.11.15).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Python 3.11.15 was not found.' }

$kokoroGpuEnvironment = Join-Path $kokoroGpuRoot 'integrations/kokoro-gpu/.venv'
$env:UV_CACHE_DIR = Join-Path $kokoroGpuRoot 'data/voice-package-cache'
if (-not (Test-Path -LiteralPath (Join-Path $kokoroGpuRoot 'data/voice-models/kokoro/manifest.json'))) { throw 'Set up the verified Kokoro shared voice/phonemizer assets first.' }
if (-not (Test-Path -LiteralPath (Join-Path $kokoroGpuEnvironment 'Scripts/python.exe'))) {
    & $kokoroGpuUv venv --python $kokoroGpuPython $kokoroGpuEnvironment
    if ($LASTEXITCODE -ne 0) { throw 'Kokoro GPU environment creation failed.' }
}
& $kokoroGpuPython (Join-Path $PSScriptRoot 'download_kokoro_gpu.py')
if ($LASTEXITCODE -ne 0) { throw 'Pinned Kokoro GPU download failed.' }
Push-Location -LiteralPath $kokoroGpuRoot
try {
    & $kokoroGpuUv pip sync --python (Join-Path $kokoroGpuEnvironment 'Scripts/python.exe') --require-hashes scripts/kokoro-gpu-packages.lock --index-url https://pypi.org/simple --link-mode copy
    if ($LASTEXITCODE -ne 0) { throw 'Pinned Kokoro GPU installation failed.' }
} finally { Pop-Location }
Write-Output 'GPU runtime installed separately. Stop other GPU voice workers before testing; no drivers were changed.'
