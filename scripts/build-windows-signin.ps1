$ErrorActionPreference = 'Stop'
$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$vswherePath = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path -LiteralPath $vswherePath)) { throw 'Install Microsoft C++ Build Tools and Windows SDK first.' }
$installationPath = & $vswherePath -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $installationPath) { throw 'Microsoft C++ installation is not complete.' }
$cmakePath = Join-Path $installationPath 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'
$ctestPath = Join-Path (Split-Path $cmakePath) 'ctest.exe'
if (-not (Test-Path -LiteralPath $cmakePath)) { throw 'Install the C++ CMake tools component.' }
$sourcePath = Join-Path $workspaceRoot 'native\windows-signin'
$buildPath = Join-Path $workspaceRoot 'output\windows-signin\build'
& $cmakePath -S $sourcePath -B $buildPath -G 'Visual Studio 17 2022' -A x64
if ($LASTEXITCODE -ne 0) { throw 'Windows sign-in configuration failed.' }
& $cmakePath --build $buildPath --config Release --parallel 2
if ($LASTEXITCODE -ne 0) { throw 'Windows sign-in build failed.' }
& $ctestPath --test-dir $buildPath -C Release --output-on-failure
if ($LASTEXITCODE -ne 0) { throw 'Windows native prerequisite verification failed.' }
