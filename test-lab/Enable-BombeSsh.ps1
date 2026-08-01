param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern("^ssh-(ed25519|rsa) ")]
    [string]$PublicKey
)

$ErrorActionPreference = "Stop"
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this script from an elevated PowerShell terminal."
}

$capability = Get-WindowsCapability -Online | Where-Object Name -Like "OpenSSH.Server*"
if ($capability.State -ne "Installed") {
    Add-WindowsCapability -Online -Name $capability.Name | Out-Null
}

$sshRoot = "C:\ProgramData\ssh"
$authorizedKeys = Join-Path $sshRoot "administrators_authorized_keys"
New-Item -ItemType Directory -Path $sshRoot -Force | Out-Null
Set-Content -Path $authorizedKeys -Value $PublicKey -Encoding ascii
& icacls.exe $authorizedKeys /inheritance:r /grant "Administrators:F" /grant "SYSTEM:F" | Out-Null

$configPath = Join-Path $sshRoot "sshd_config"
if (Test-Path $configPath) {
    $config = Get-Content $configPath
    $config = $config -replace "^#?PasswordAuthentication\s+.*$", "PasswordAuthentication no"
    $config = $config -replace "^#?PubkeyAuthentication\s+.*$", "PubkeyAuthentication yes"
    Set-Content -Path $configPath -Value $config -Encoding ascii
}

Set-Service -Name sshd -StartupType Automatic
Start-Service sshd

if (-not (Get-NetFirewallRule -Name "BOMBE-TestLab-SSH" -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -Name "BOMBE-TestLab-SSH" -DisplayName "BOMBE Test Lab SSH" `
        -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 | Out-Null
}

Write-Output "OpenSSH enabled with public-key authentication only."
