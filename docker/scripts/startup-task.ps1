# Startup Task — run at Windows login to auto-restore WSL2 port forwarding.
#
# WSL2's internal IP changes every time it restarts, so port-proxy rules
# become stale after reboot. This script re-applies them automatically.
#
# HOW TO REGISTER AS A STARTUP TASK (run once in Admin PowerShell):
#
#   $action  = New-ScheduledTaskAction -Execute "powershell.exe" `
#                -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSScriptRoot\startup-task.ps1`""
#   $trigger = New-ScheduledTaskTrigger -AtLogOn
#   $settings = New-ScheduledTaskSettingsSet -RunOnlyIfNetworkAvailable
#   Register-ScheduledTask -TaskName "WSL2-ClearRoute-Network" `
#       -Action $action -Trigger $trigger -Settings $settings `
#       -RunLevel Highest -Force
#
# After registering, it will run silently at every login.

# Re-use the main network script
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& "$scriptDir\wsl2-network.ps1"
