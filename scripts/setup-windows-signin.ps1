[CmdletBinding()]
param([string]$EnrollmentFile, [switch]$Remove, [switch]$Inspect, [switch]$Update, [switch]$RepairPermissions)
$ErrorActionPreference = 'Stop'
if ((@($Inspect, $Remove, $Update, $RepairPermissions | Where-Object { $_ }).Count -gt 1) -or (($Inspect -or $Remove -or $Update -or $RepairPermissions) -and $EnrollmentFile)) { throw 'Choose inspection, removal, update, permissions repair, or enrollment, separately.' }
$providerId = '{981119E4-88BD-4F29-A9BA-C1A8968BE10E}'
$installRoot = Join-Path $env:ProgramFiles 'JARVIS Windows Signin'
$nativeRoot = Join-Path $env:ProgramData 'JARVIS-WindowsSignin'
$providerDll = Join-Path $installRoot 'jarvis-credential-provider.dll'
$classPath = "SOFTWARE\Classes\CLSID\$providerId"
$providerPath = "SOFTWARE\Microsoft\Windows\CurrentVersion\Authentication\Credential Providers\$providerId"
$registry = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryView]::Registry64)
function Read-Default([string]$Path) {
    $key = $registry.OpenSubKey($Path)
    if (-not $key) { return $null }
    try { return $key.GetValue('') } finally { $key.Dispose() }
}
function Exists-Key([string]$Path) {
    $key = $registry.OpenSubKey($Path)
    if (-not $key) { return $false }
    $key.Dispose(); return $true
}
function Require-PlainDirectory([string]$Path) {
    if (Test-Path -LiteralPath $Path) {
        $entry = Get-Item -LiteralPath $Path -Force
        if (-not $entry.PSIsContainer -or ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Setup refused a redirected or unexpected directory.' }
    }
}
try {
    if ($Inspect) {
        [ordered]@{
            registered = (Exists-Key $providerPath)
            expectedDllRegistered = ((Read-Default ($classPath + '\InprocServer32')) -eq $providerDll)
            nativeVaultPresent = (Test-Path -LiteralPath (Join-Path $nativeRoot 'vault.bin'))
            installFolder = $installRoot
            bootTimePhoneTransport = $false
        } | ConvertTo-Json
        return
    }
    $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this setup as administrator. Windows will ask you to approve elevation.' }
    Require-PlainDirectory $installRoot; Require-PlainDirectory $nativeRoot
    if ($RepairPermissions) {
        if ((Read-Default ($classPath + '\InprocServer32')) -ne $providerDll -or (Read-Default $providerPath) -ne 'JARVIS phone sign-in') { throw 'The exact installed JARVIS provider was not found.' }
        $responses = Join-Path $nativeRoot 'responses'
        Require-PlainDirectory $responses
        $ownerSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        $existing = Get-Acl -LiteralPath $responses
        $owners = @($existing.Access | Where-Object {$_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -eq $ownerSid})
        if ($owners.Count -ne 1) { throw 'The enrolled response-folder owner does not match this Windows account. No permissions changed.' }
        $proofs = @(Get-ChildItem -LiteralPath $responses -File -Force)
        if ($proofs.Count -gt 4096) { throw 'Too many response files for a bounded repair.' }
        foreach ($proof in $proofs) {
            if ($proof.Name -notmatch '^[a-fA-F0-9]{8}-(?:[a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12}\.sig$' -or ($proof.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Unexpected or redirected response file. No permissions changed.' }
        }
        # This folder contains only public signatures, never the password vault.
        # SYSTEM and Administrators must inherit access on files Node creates.
        $acl = New-Object Security.AccessControl.DirectorySecurity
        $acl.SetSecurityDescriptorSddlForm("O:BAG:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;GRGWGXSD;;;$ownerSid)")
        Set-Acl -LiteralPath $responses -AclObject $acl
        foreach ($proof in $proofs) {
            $fileAcl = New-Object Security.AccessControl.FileSecurity
            $fileAcl.SetSecurityDescriptorSddlForm("D:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;GRGWGXSD;;;$ownerSid)")
            Set-Acl -LiteralPath $proof.FullName -AclObject $fileAcl
        }
        Copy-Item -LiteralPath $PSCommandPath -Destination (Join-Path $installRoot 'setup-windows-signin.ps1') -Force
        Write-Output 'Public approval-folder inheritance repaired for SYSTEM and Administrators. Existing public signatures repaired. Password vault, enrollment, sign-in registry and Windows policy were not changed.'
        return
    }
    if ($Update) {
        if ((Read-Default ($classPath + '\InprocServer32')) -ne $providerDll -or (Read-Default $providerPath) -ne 'JARVIS phone sign-in' -or -not (Test-Path -LiteralPath (Join-Path $nativeRoot 'vault.bin'))) { throw 'The exact enrolled JARVIS installation was not found. No update was performed.' }
        $buildRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\output\windows-signin\build\Release'))
        $backup = Join-Path $installRoot 'jarvis-credential-provider.before-update.dll'
        Copy-Item -LiteralPath $providerDll -Destination $backup -Force
        try {
            Copy-Item -LiteralPath (Join-Path $buildRoot 'jarvis-credential-provider.dll') -Destination $providerDll -Force
            & (Join-Path $installRoot 'jarvis-provider-test.exe') $providerDll
            if ($LASTEXITCODE -ne 0) { throw 'Updated provider interface check failed.' }
        } catch {
            Copy-Item -LiteralPath $backup -Destination $providerDll -Force
            throw 'Provider update failed and the prior binary was restored. No enrollment or registration changed.'
        }
        Copy-Item -LiteralPath $PSCommandPath -Destination (Join-Path $installRoot 'setup-windows-signin.ps1') -Force
        Write-Output 'Native provider updated. No password vault opened, enrollment repeated, registry changed, lock or reboot initiated.'
        return
    }
    if ($Remove) {
        # Never touch any other provider, filters, Windows Hello or sign-in policy.
        $registeredDll = Read-Default ($classPath + '\InprocServer32')
        if ((Exists-Key $classPath) -and $registeredDll -ne $providerDll) { throw 'Provider registration does not match this installer. Nothing was removed.' }
        if ((Exists-Key $providerPath) -and (Read-Default $providerPath) -ne 'JARVIS phone sign-in') { throw 'Provider name does not match this installer. Nothing was removed.' }
        # Removing the vault first also rejects serialization by an already-loaded tile.
        foreach ($name in @('vault.bin', 'challenge.txt', 'status.txt', 'notification.txt', 'trace.txt')) {
            $path = Join-Path $nativeRoot $name
            if (Test-Path -LiteralPath $path) {
                if ((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing a redirected native file.' }
                Remove-Item -LiteralPath $path -Force
            }
        }
        $registry.DeleteSubKeyTree($providerPath, $false)
        $registry.DeleteSubKeyTree($classPath, $false)
        # Retain only non-secret leftovers, allowing a clean native re-enrollment.
        # Both absolute sources and destinations stay in their explicitly named parent.
        $suffix = '.disabled-' + [Guid]::NewGuid().ToString('N')
        foreach ($root in @($nativeRoot, $installRoot)) {
            if (Test-Path -LiteralPath $root) {
                $resolved = [IO.Path]::GetFullPath($root)
                $retired = [IO.Path]::GetFullPath($root + $suffix)
                if ((Split-Path $resolved) -ne (Split-Path $retired) -or $resolved -notin @($nativeRoot, $installRoot)) { throw 'Removal path check failed.' }
                Move-Item -LiteralPath $resolved -Destination $retired
            }
        }
        Write-Output 'JARVIS Windows sign-in disabled and its enrolled vault removed. Your ordinary Windows sign-in providers were not changed. Non-secret setup leftovers were retained in disabled folders.'
        return
    }
    if (-not $EnrollmentFile) { throw 'Provide the public enrollment file exported from the local JARVIS Settings card.' }
    $config = Get-Item -LiteralPath $EnrollmentFile
    if ($config.PSIsContainer -or $config.Length -gt 4096 -or $config.Length -eq 0) { throw 'Invalid public enrollment file.' }
    if ((Exists-Key $classPath) -or (Exists-Key $providerPath) -or (Test-Path -LiteralPath $installRoot) -or (Test-Path -LiteralPath $nativeRoot)) { throw 'Previous setup files or registration exist. Inspect them and use the removal/re-enrollment procedure before installing again.' }
    $buildRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\output\windows-signin\build\Release'))
    $files = @('jarvis-credential-provider.dll', 'jarvis-signin-enroll.exe', 'jarvis-provider-test.exe')
    foreach ($file in $files) { if (-not (Test-Path -LiteralPath (Join-Path $buildRoot $file) -PathType Leaf)) { throw 'Build the native Windows sign-in components first.' } }
    # Fixed admin-owned destination. No DLL is loaded from a user-writable folder at sign-in.
    $directorySecurity = New-Object Security.AccessControl.DirectorySecurity
    $directorySecurity.SetSecurityDescriptorSddlForm('O:BAG:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;GRGX;;;BU)')
    [IO.Directory]::CreateDirectory($installRoot, $directorySecurity) | Out-Null
    foreach ($file in $files) { Copy-Item -LiteralPath (Join-Path $buildRoot $file) -Destination (Join-Path $installRoot $file) }
    Copy-Item -LiteralPath $PSCommandPath -Destination (Join-Path $installRoot 'setup-windows-signin.ps1')
    & (Join-Path $installRoot 'jarvis-provider-test.exe') $providerDll
    if ($LASTEXITCODE -ne 0) { throw 'The installed provider failed its unregistered interface test. No Windows registration was changed.' }
    & (Join-Path $installRoot 'jarvis-signin-enroll.exe') $config.FullName
    if ($LASTEXITCODE -ne 0) { throw 'Native enrollment was cancelled or rejected. No Windows registration was changed.' }
    $class = $registry.CreateSubKey($classPath)
    try { $class.SetValue('', 'JARVIS phone sign-in') } finally { $class.Dispose() }
    try {
        $server = $registry.CreateSubKey($classPath + '\InprocServer32')
        try { $server.SetValue('', $providerDll); $server.SetValue('ThreadingModel', 'Apartment') } finally { $server.Dispose() }
        $provider = $registry.CreateSubKey($providerPath)
        try { $provider.SetValue('', 'JARVIS phone sign-in') } finally { $provider.Dispose() }
    } catch {
        $registry.DeleteSubKeyTree($providerPath, $false); $registry.DeleteSubKeyTree($classPath, $false)
        throw 'Registration failed and was rolled back. The encrypted vault remains; run the removal tool before retrying.'
    }
    Write-Output 'JARVIS phone sign-in installed for a controlled live test. No reboot or lock was initiated. Use your normal Windows PIN/password if it fails.'
    Write-Output ('Removal: powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $installRoot 'setup-windows-signin.ps1') + '" -Remove')
} finally { $registry.Dispose() }
