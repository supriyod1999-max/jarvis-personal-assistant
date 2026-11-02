$ErrorActionPreference = 'Stop'
$voiceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $voiceRoot
$voiceUv = Join-Path $voiceRoot 'data\installers\uv.exe'
if (-not (Test-Path -LiteralPath $voiceUv)) {
    $voiceUv = (Get-Command uv -ErrorAction SilentlyContinue).Source
    if (-not $voiceUv) { throw 'Install the official uv package manager, then run this script again. See docs/VOICE-SETUP.md.' }
}
$env:UV_PYTHON_INSTALL_DIR = Join-Path $voiceRoot 'data\voice-python'
$env:UV_CACHE_DIR = Join-Path $voiceRoot 'data\voice-package-cache'
$voiceCommit = '5de7a54aa4e5e2baadb0182dde554908b48b85c2'
if (-not (Test-Path -LiteralPath 'integrations\chatterbox\pyproject.toml')) {
    & git clone https://github.com/resemble-ai/chatterbox.git integrations/chatterbox
    if ($LASTEXITCODE -ne 0) { throw 'Chatterbox download failed.' }
    & git -C integrations/chatterbox checkout $voiceCommit
    if ($LASTEXITCODE -ne 0) { throw 'Could not select the tested Chatterbox version.' }
}
$installedCommit = & git -C integrations/chatterbox rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or $installedCommit -ne $voiceCommit) { throw 'Chatterbox source differs from the tested version. Review it before reinstalling dependencies.' }
& $voiceUv python install 3.11.15 --no-bin
if ($LASTEXITCODE -ne 0) { throw 'Python installation failed.' }
if (-not (Test-Path -LiteralPath 'integrations\chatterbox\.venv\Scripts\python.exe')) {
    & $voiceUv venv --python 3.11.15 integrations/chatterbox/.venv
    if ($LASTEXITCODE -ne 0) { throw 'Voice environment creation failed.' }
}
& $voiceUv pip sync --python integrations/chatterbox/.venv/Scripts/python.exe --index https://download.pytorch.org/whl/cu128 --index-strategy unsafe-best-match scripts/chatterbox-packages.lock
if ($LASTEXITCODE -ne 0) { throw 'Voice dependencies could not be installed.' }
New-Item -ItemType Directory -Force -Path output/qa | Out-Null
& .\integrations\chatterbox\.venv\Scripts\python.exe scripts/download_voice.py
if ($LASTEXITCODE -ne 0) { throw 'Voice checkpoint download did not finish. Run setup again to resume.' }
& .\integrations\chatterbox\.venv\Scripts\python.exe server/voice_worker.py --check output/qa/chatterbox-check.wav
if ($LASTEXITCODE -ne 0) { throw 'The GPU speech check did not pass. See docs/VOICE-SETUP.md.' }
Write-Output 'Voice check complete. In Command, choose Test voice or Read reply aloud.'
