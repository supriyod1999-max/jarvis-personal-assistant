$ErrorActionPreference = 'Stop'
$scanRepo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$scanTools = Join-Path $scanRepo 'output/security-tools'
$scanSource = Join-Path $scanTools ('source-' + [guid]::NewGuid().ToString('N'))
$scanArchive = Join-Path $scanTools 'gitleaks-8.30.1.zip'
$scanBinary = Join-Path $scanTools 'gitleaks.exe'
$scanExpected = 'd29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e'
New-Item -ItemType Directory -Force -Path $scanTools | Out-Null
# Reverify the pinned archive and extract on every run, including when cached.
if (-not (Test-Path -LiteralPath $scanArchive)) {
    Invoke-WebRequest -Uri 'https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_windows_x64.zip' -OutFile $scanArchive
}
if ((Get-FileHash -LiteralPath $scanArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $scanExpected) { throw 'Secret scanner archive checksum mismatch.' }
Expand-Archive -LiteralPath $scanArchive -DestinationPath $scanTools -Force
$scanFiles = & git -C $scanRepo -c core.quotepath=false ls-files --cached --others --exclude-standard
if ($LASTEXITCODE -ne 0) { throw 'Initialize the separate public repository before scanning.' }
New-Item -ItemType Directory -Path $scanSource | Out-Null
try {
    foreach ($scanRelative in $scanFiles) {
        $scanOriginal = [IO.Path]::GetFullPath((Join-Path $scanRepo $scanRelative))
        $scanCopy = [IO.Path]::GetFullPath((Join-Path $scanSource $scanRelative))
        if (-not $scanOriginal.StartsWith($scanRepo + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or -not $scanCopy.StartsWith($scanSource + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid source path.' }
        if ((Get-Item -LiteralPath $scanOriginal).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked files cannot be published.' }
        New-Item -ItemType Directory -Force -Path (Split-Path $scanCopy -Parent) | Out-Null
        Copy-Item -LiteralPath $scanOriginal -Destination $scanCopy
    }
    # Disable allow comments; report values remain fully redacted.
    & $scanBinary dir $scanSource --redact=100 --ignore-gitleaks-allow --no-banner --no-color --report-format json --report-path (Join-Path $scanTools 'findings.json')
    if ($LASTEXITCODE -ne 0) { throw 'Secret scan failed. Review the local redacted findings before publishing.' }
} finally {
    $scanCleanup = [IO.Path]::GetFullPath($scanSource)
    if (-not $scanCleanup.StartsWith([IO.Path]::GetFullPath($scanTools) + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe scan cleanup path.' }
    Remove-Item -LiteralPath $scanCleanup -Recurse -Force
}
