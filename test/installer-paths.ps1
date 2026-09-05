$ErrorActionPreference = 'Stop'

# The hosted runner is disposable. Never modify an installation on a developer's PC.
if ($env:CI -ne 'true' -or $env:RUNNER_OS -ne 'Windows' -or !$env:RUNNER_TEMP) {
    throw 'This installation test is restricted to a disposable Windows CI runner.'
}

$uninstallRegistry = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
$existing = @(Get-ChildItem -LiteralPath $uninstallRegistry -ErrorAction SilentlyContinue |
    Get-ItemProperty -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like '나무레이스 온라인*' })
if ($existing.Count -ne 0) { throw 'An existing Namu Race installation must not be touched.' }

$runnerTempRoot = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\')
$testRoot = Join-Path $runnerTempRoot ('namu-installer-' + [guid]::NewGuid().ToString('N'))
$firstDir = Join-Path $testRoot '첫 번째 폴더\namu-race-online'
$secondDir = Join-Path $testRoot '다른 설치 폴더\namu-race-online'
foreach ($target in @($testRoot, $firstDir, $secondDir)) {
    if (![IO.Path]::GetFullPath($target).StartsWith($runnerTempRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'The installer test path must stay inside the runner temp directory.'
    }
}
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
$installers = @(Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot '..\release') -Filter '*-setup.exe' -File)
if ($installers.Count -ne 1) { throw 'Exactly one newly built installer is required.' }
$installerPath = $installers[0].FullName
$appFile = '나무레이스 온라인.exe'

function Invoke-TestInstaller([string]$Arguments) {
    $installProcess = Start-Process -FilePath $installerPath -ArgumentList $Arguments -WindowStyle Hidden -PassThru
    if (!$installProcess.WaitForExit(90000)) {
        $installProcess.Kill($true)
        throw 'The test installer did not finish within 90 seconds.'
    }
    if ($installProcess.ExitCode -ne 0) { throw "Installer exited with $($installProcess.ExitCode)." }
}

Invoke-TestInstaller "/S /currentuser /D=$firstDir"
if (!(Test-Path -LiteralPath (Join-Path $firstDir $appFile))) { throw 'Custom installation path was ignored.' }

# Re-run the installer to move an existing installation, including spaces and Korean characters.
Invoke-TestInstaller "/S /currentuser /D=$secondDir"
if (!(Test-Path -LiteralPath (Join-Path $secondDir $appFile))) { throw 'Installation was not moved to the new path.' }
if (Test-Path -LiteralPath (Join-Path $firstDir $appFile)) { throw 'The old application was left behind.' }

# These are the same update flags used by electron-updater, without forcing an app launch.
Invoke-TestInstaller '--updated /S /currentuser'
if (!(Test-Path -LiteralPath (Join-Path $secondDir $appFile))) { throw 'Updating did not preserve the custom path.' }
$installed = @(Get-ChildItem -LiteralPath $uninstallRegistry |
    Get-ItemProperty -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like '나무레이스 온라인*' })
if ($installed.Count -ne 1 -or !$installed[0].DisplayIcon.StartsWith($secondDir, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The registered installation does not point to the selected folder.'
}

Write-Output '{"ok":true,"customPathInstalled":true,"oldPathRemoved":true,"updatePreservedPath":true}'
