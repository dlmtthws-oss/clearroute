<#
    Install-JarvisOrb.ps1

    Creates a desktop shortcut that launches Jarvis as a standalone, frameless
    app window opened straight to the orb (via the app's ?jarvis deep link).

    It uses Microsoft Edge or Google Chrome in "app mode" (--app=URL), which
    gives a chromeless window that looks and behaves like a standalone app —
    no tabs, no address bar — without installing anything.

    USAGE (in Windows PowerShell, not WSL):
        # 1. Set the URL once (see README for the reachable-URL requirement):
        #    the Jarvis app deployment (clearroute-jxav). It must be reachable
        #    without a Vercel login prompt.
        powershell -ExecutionPolicy Bypass -File .\Install-JarvisOrb.ps1 -Url "https://YOUR-JARVIS-URL"

        # optional: custom icon + custom shortcut name
        powershell -ExecutionPolicy Bypass -File .\Install-JarvisOrb.ps1 -Url "https://YOUR-JARVIS-URL" -IconPath "C:\path\to\jarvis.ico" -Name "Jarvis"

    Re-running it just overwrites the shortcut, so it is safe to run again to
    change the URL or icon.
#>

[CmdletBinding()]
param(
    # The reachable URL of the Jarvis app (clearroute-jxav). Edit the default
    # below, or pass -Url. Must load WITHOUT a Vercel SSO prompt (see README).
    [string]$Url = "https://REPLACE-WITH-YOUR-JARVIS-URL",

    # Shortcut name (becomes "<Name>.lnk" on the Desktop).
    [string]$Name = "Jarvis",

    # Optional path to a .ico file for the shortcut icon. If omitted, the
    # browser's own icon is used.
    [string]$IconPath = ""
)

$ErrorActionPreference = "Stop"

if ($Url -like "*REPLACE-WITH-YOUR-JARVIS-URL*") {
    Write-Error "Set -Url to your Jarvis app URL first (see the README). Example: -Url 'https://jarvis.example.com'"
    exit 1
}

# Deep-link straight to the orb. The app opens the Jarvis HUD when the page is
# loaded with ?jarvis (or #jarvis). Append with the right separator.
$sep = if ($Url.Contains("?")) { "&" } else { "?" }
$launchUrl = "$Url$sep" + "jarvis"

# Find a Chromium-based browser that supports --app mode (Edge preferred, then Chrome).
$candidates = @(
    (Join-Path $env:ProgramFiles        "Microsoft\Edge\Application\msedge.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"),
    (Join-Path $env:ProgramFiles        "Google\Chrome\Application\chrome.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
    (Join-Path $env:LOCALAPPDATA        "Google\Chrome\Application\chrome.exe")
)
$browser = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) {
    Write-Error "Could not find Microsoft Edge or Google Chrome. Install one, or edit this script to point at your browser."
    exit 1
}

# --app gives a frameless window; the extra flags open it like its own app
# instance rather than a new tab in an existing window.
$arguments = "--app=`"$launchUrl`" --new-window"

$desktop  = [Environment]::GetFolderPath("Desktop")
$lnkPath  = Join-Path $desktop ("$Name.lnk")

$shell    = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($lnkPath)
$shortcut.TargetPath       = $browser
$shortcut.Arguments        = $arguments
$shortcut.WorkingDirectory = Split-Path $browser
$shortcut.Description       = "Launch the Jarvis assistant orb"
# Default to the bundled orb icon (jarvis.ico beside this script) unless the
# caller passed their own -IconPath.
if (-not $IconPath) {
    $bundledIcon = Join-Path $PSScriptRoot "jarvis.ico"
    if (Test-Path $bundledIcon) { $IconPath = $bundledIcon }
}
if ($IconPath -and (Test-Path $IconPath)) {
    $shortcut.IconLocation = $IconPath
} else {
    $shortcut.IconLocation = "$browser,0"
}
$shortcut.Save()

Write-Host "Created shortcut:" -ForegroundColor Green
Write-Host "  $lnkPath"
Write-Host "  browser : $browser"
Write-Host "  opens   : $launchUrl"
Write-Host "  icon    : $(if ($IconPath) { $IconPath } else { "$browser (browser default)" })"
Write-Host ""
Write-Host "Double-click '$Name' on your Desktop to open the orb. Sign in once and it stays signed in." -ForegroundColor Cyan
