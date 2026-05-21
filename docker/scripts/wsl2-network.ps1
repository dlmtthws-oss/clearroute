# WSL2 Network Bridge — run this in PowerShell as Administrator on the mini PC
#
# WSL2 runs in a hidden virtual machine with its own IP. Windows doesn't
# automatically forward LAN traffic into it. This script:
#   1. Finds the WSL2 internal IP
#   2. Adds Windows port-proxy rules so LAN traffic reaches the containers
#   3. Opens Windows Firewall for those ports
#
# Run once after each WSL2 restart (WSL2 IP changes on reboot).
# Tip: set this as a Startup Task to run automatically.

param(
    [switch]$Remove   # Pass -Remove to undo all rules
)

$Ports = @(
    @{ Port = 80;    Desc = "Dify web UI" },
    @{ Port = 5678;  Desc = "n8n automation" },
    @{ Port = 11434; Desc = "Ollama API" },
    @{ Port = 3000;  Desc = "ClearRoute dev server" }
)

$FirewallRuleName = "WSL2-ClearRoute-MiniPC"

if ($Remove) {
    Write-Host "==> Removing port-proxy and firewall rules..." -ForegroundColor Yellow
    foreach ($p in $Ports) {
        netsh interface portproxy delete v4tov4 listenport=$($p.Port) listenaddress=0.0.0.0 2>$null
    }
    Remove-NetFireWallRule -DisplayName $FirewallRuleName -ErrorAction SilentlyContinue
    Write-Host "Done. Rules removed." -ForegroundColor Green
    exit 0
}

# Find WSL2 IP
$WslIp = (wsl hostname -I).Trim().Split(" ")[0]
if (-not $WslIp) {
    Write-Error "Could not determine WSL2 IP. Is WSL2 running?"
    exit 1
}
Write-Host "==> WSL2 internal IP: $WslIp" -ForegroundColor Cyan

# Windows LAN IP (for reference)
$WinIp = (Get-NetIPAddress -AddressFamily IPv4 |
          Where-Object { $_.IPAddress -notmatch '^(127\.|169\.|172\.)' -and $_.PrefixOrigin -ne 'WellKnown' } |
          Select-Object -First 1).IPAddress
Write-Host "==> Windows LAN IP:   $WinIp" -ForegroundColor Cyan
Write-Host ""

# Remove existing rules first (in case IP changed)
foreach ($p in $Ports) {
    netsh interface portproxy delete v4tov4 listenport=$($p.Port) listenaddress=0.0.0.0 2>$null
}
Remove-NetFireWallRule -DisplayName $FirewallRuleName -ErrorAction SilentlyContinue

# Add port-proxy rules
foreach ($p in $Ports) {
    Write-Host "  Forwarding 0.0.0.0:$($p.Port) -> $($WslIp):$($p.Port)  ($($p.Desc))"
    netsh interface portproxy add v4tov4 `
        listenport=$($p.Port) listenaddress=0.0.0.0 `
        connectport=$($p.Port) connectaddress=$WslIp
}

# Open firewall
$PortList = ($Ports | ForEach-Object { $_.Port }) -join ","
New-NetFireWallRule `
    -DisplayName $FirewallRuleName `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort $PortList | Out-Null

Write-Host ""
Write-Host "==> Done! Access from your laptop at:" -ForegroundColor Green
Write-Host "    Dify:    http://$WinIp"
Write-Host "    n8n:     http://$WinIp:5678"
Write-Host "    Ollama:  http://$WinIp:11434"
Write-Host "    Dev app: http://$WinIp:3000"
Write-Host ""
Write-Host "Save this IP in your laptop bookmarks or /etc/hosts." -ForegroundColor Yellow
