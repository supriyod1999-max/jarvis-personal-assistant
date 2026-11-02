# Interactive elevated setup launcher. No passwords pass through PowerShell.
$ErrorActionPreference = 'Stop'
$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$resultLog = Join-Path $workspaceRoot 'output\windows-signin\setup-result.txt'
try {
    # A failed pre-registration attempt leaves only our fixed setup program folder.
    # Clear that explicit prior attempt through the same narrow removal tool.
    $installRoot = Join-Path $env:ProgramFiles 'JARVIS Windows Signin'
    $snapshot = & (Join-Path $PSScriptRoot 'setup-windows-signin.ps1') -Inspect | ConvertFrom-Json
    if ((Test-Path -LiteralPath $installRoot) -and -not $snapshot.registered -and -not $snapshot.nativeVaultPresent) {
        if (-not (Test-Path -LiteralPath (Join-Path $installRoot 'setup-windows-signin.ps1'))) { throw 'Unexpected pre-existing program folder. Inspect it before continuing.' }
        & (Join-Path $PSScriptRoot 'setup-windows-signin.ps1') -Remove *> $resultLog
    }
    & (Join-Path $PSScriptRoot 'setup-windows-signin.ps1') -EnrollmentFile (Join-Path $env:USERPROFILE 'Downloads\JARVIS-Windows-enrollment.txt') *> $resultLog
    exit 0
} catch {
    $_.Exception.Message | Add-Content -LiteralPath $resultLog
    exit 1
}
