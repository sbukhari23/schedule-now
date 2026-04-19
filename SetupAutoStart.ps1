$ErrorActionPreference = 'Stop'

$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcherPath = Join-Path $appDir 'StartScheduleApp.bat'
$startupDir = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupDir 'Schedule Now.lnk'

if (-not (Test-Path $launcherPath)) {
    throw "Launcher not found: $launcherPath"
}

$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $launcherPath
$shortcut.WorkingDirectory = $appDir
$shortcut.WindowStyle = 1
$shortcut.IconLocation = "$env:SystemRoot\System32\SHELL32.dll,220"
$shortcut.Save()

Write-Host "Startup shortcut created: $shortcutPath"
Write-Host "The app will auto-launch at next sign-in."
