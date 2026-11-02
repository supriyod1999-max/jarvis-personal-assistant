param([switch]$SkipChecks, [switch]$PublishRelease)
$ErrorActionPreference = 'Stop'
$jarvisRoot = Split-Path $PSScriptRoot -Parent
$jarvisAndroid = Join-Path $jarvisRoot 'android'
if (-not $env:JAVA_HOME) {
    $jarvisJdk = Get-ChildItem 'C:\Program Files\Microsoft' -Directory -Filter 'jdk-21*' | Sort-Object Name -Descending | Select-Object -First 1
    if (-not $jarvisJdk) { throw 'Set JAVA_HOME to JDK 17 or newer before building.' }
    $env:JAVA_HOME = $jarvisJdk.FullName
}
$jarvisSdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (-not (Test-Path -LiteralPath $jarvisSdk)) { throw 'Install the Android SDK or set ANDROID_HOME.' }
$jarvisSdkProperty = $jarvisSdk.Replace('\', '/').Replace(':', '\:')
Set-Content -LiteralPath (Join-Path $jarvisAndroid 'local.properties') -Value "sdk.dir=$jarvisSdkProperty" -Encoding ascii
$jarvisTasks = @('assembleDebug')
if (-not $SkipChecks) { $jarvisTasks += @('testDebugUnitTest', 'lintDebug') }
& (Join-Path $jarvisAndroid 'gradlew.bat') -p $jarvisAndroid @jarvisTasks --no-daemon
if ($LASTEXITCODE -ne 0) { throw 'Android checks failed; the distribution APK was not replaced.' }
$jarvisApk = Join-Path $jarvisAndroid 'app\build\outputs\apk\debug\app-debug.apk'
foreach ($jarvisDestination in @('output\android', 'public\downloads', 'dist\downloads')) {
    $jarvisFolder = Join-Path $jarvisRoot $jarvisDestination
    New-Item -ItemType Directory -Force -Path $jarvisFolder | Out-Null
    Copy-Item -LiteralPath $jarvisApk -Destination (Join-Path $jarvisFolder 'JARVIS.apk') -Force
}
$jarvisHash = (Get-FileHash -LiteralPath $jarvisApk -Algorithm SHA256).Hash
Set-Content -LiteralPath (Join-Path $jarvisRoot 'output\android\SHA256.txt') -Value "$jarvisHash  JARVIS.apk" -Encoding ascii
$jarvisWatchApk = Join-Path $jarvisAndroid 'wear\build\outputs\apk\debug\wear-debug.apk'
foreach ($jarvisDestination in @('output\android', 'public\downloads', 'dist\downloads')) {
    Copy-Item -LiteralPath $jarvisWatchApk -Destination (Join-Path $jarvisRoot "$jarvisDestination\JARVIS-Watch.apk") -Force
}
$jarvisWatchHash = (Get-FileHash -LiteralPath $jarvisWatchApk -Algorithm SHA256).Hash
Add-Content -LiteralPath (Join-Path $jarvisRoot 'output\android\SHA256.txt') -Value "$jarvisWatchHash  JARVIS-Watch.apk" -Encoding ascii
Write-Output "Android preview built: $(Join-Path $jarvisRoot 'output\android\JARVIS.apk')"
if ($PublishRelease) {
    if ($SkipChecks) { throw 'Run all Android checks before publishing an automatic-update release.' }
    $jarvisNodePath = (Get-Command node -ErrorAction Stop).Source
    & $jarvisNodePath (Join-Path $jarvisRoot 'scripts\publish-android-release.mjs') --publish
    if ($LASTEXITCODE -ne 0) { throw 'Android release publication failed.' }
}
