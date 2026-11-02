$ErrorActionPreference = 'Stop'
$jarvisRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$jarvisVswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$jarvisVs = & $jarvisVswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $jarvisVs) { throw 'Microsoft C++ Build Tools are required.' }
$jarvisCmake = Join-Path $jarvisVs 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'
$jarvisCtest = Join-Path (Split-Path $jarvisCmake) 'ctest.exe'
$jarvisBuild = Join-Path $jarvisRoot 'output\remote-control\build'
& $jarvisCmake -S (Join-Path $jarvisRoot 'native\remote-control') -B $jarvisBuild -G 'Visual Studio 17 2022' -A x64
if ($LASTEXITCODE -ne 0) { throw 'Remote helper configuration failed.' }
& $jarvisCmake --build $jarvisBuild --config Release --parallel 2
if ($LASTEXITCODE -ne 0) { throw 'Remote helper build failed.' }
& $jarvisCtest --test-dir $jarvisBuild -C Release --output-on-failure
if ($LASTEXITCODE -ne 0) { throw 'Remote helper protocol checks failed.' }
