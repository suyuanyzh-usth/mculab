# install-windows-service.ps1
# ------------------------------------------------------------------
# Purpose: install MCU Lab as a Windows service so it starts on boot
#          and nobody has to double-click a .bat file again.
#
# Usage (run PowerShell as Administrator, in this folder):
#     powershell -ExecutionPolicy Bypass -File deploy\install-windows-service.ps1
#     powershell -ExecutionPolicy Bypass -File deploy\install-windows-service.ps1 -Port 8080
#
# Uninstall:
#     powershell -ExecutionPolicy Bypass -File deploy\install-windows-service.ps1 -Uninstall
#
# NOTE: this only makes the app run permanently on THIS machine.
#       To reach it from any network, put it on a public server instead
#       (see docs/04-any-network-deployment.md) - or pair it with HTTPS.
# ------------------------------------------------------------------
param(
  [int]$Port = 8080,
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$ServiceName = 'MCULab'

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p = New-Object Security.Principal.WindowsPrincipal($id)
  return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Admin)) {
  Write-Host '[ERROR] Please run PowerShell as Administrator.' -ForegroundColor Red
  exit 1
}

if ($Uninstall) {
  if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Write-Host "Stopping and removing service $ServiceName ..."
    sc.exe stop $ServiceName | Out-Null
    Start-Sleep -Seconds 2
    sc.exe delete $ServiceName | Out-Null
    Write-Host 'Removed.' -ForegroundColor Green
  } else {
    Write-Host "Service $ServiceName is not installed."
  }
  exit 0
}

$root = Split-Path -Parent $PSScriptRoot
$entry = Join-Path $root 'server\index.js'
if (-not (Test-Path $entry)) {
  Write-Host "[ERROR] Cannot find $entry" -ForegroundColor Red
  exit 1
}

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  Write-Host '[ERROR] Node.js not found in PATH. Install Node 22+ first.' -ForegroundColor Red
  exit 1
}
$node = $nodeCmd.Source

# Stop / remove an older instance so the new settings take effect
if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
  Write-Host "Existing service found, reinstalling ..."
  sc.exe stop $ServiceName | Out-Null
  Start-Sleep -Seconds 2
  sc.exe delete $ServiceName | Out-Null
  Start-Sleep -Seconds 2
}

$binPath = '"' + $node + '" "' + $entry + '" --port ' + $Port + ' --host 0.0.0.0'
Write-Host "Installing service: $ServiceName"
Write-Host "  Binary : $binPath"

New-Service -Name $ServiceName `
  -BinaryPathName $binPath `
  -DisplayName 'MCU Lab (Microcontroller Teaching Platform)' `
  -Description '8051/STC89C52 online lab: C editor, compiler, schematic, simulation, instruments.' `
  -StartupType Automatic | Out-Null

# Allow inbound traffic so students on the LAN can reach it
$ruleName = "MCU Lab $Port"
if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP `
    -LocalPort $Port -Action Allow -Profile Private,Domain | Out-Null
  Write-Host "Firewall rule created: $ruleName (Private/Domain only)"
}

Start-Service -Name $ServiceName
Start-Sleep -Seconds 3

$svc = Get-Service -Name $ServiceName
Write-Host ''
Write-Host ("Service status: " + $svc.Status) -ForegroundColor Green
Write-Host ("Address        : http://localhost:" + $Port)
Write-Host ''
Write-Host 'Useful commands:'
Write-Host ("  Get-Service " + $ServiceName)
Write-Host ("  Restart-Service " + $ServiceName)
Write-Host ("  Stop-Service " + $ServiceName)
Write-Host ''
Write-Host 'Note: after editing platform code, run "Restart-Service MCULab" to apply.'
