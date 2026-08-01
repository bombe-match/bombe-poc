$ErrorActionPreference = "Stop"
$LabRoot = $PSScriptRoot
$RunRoot = Join-Path $LabRoot "run"

Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.StartsWith($RunRoot, [StringComparison]::OrdinalIgnoreCase)
} | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}

Get-Process -Name "BombeLab" -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue

Remove-Item $RunRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $RunRoot -Force | Out-Null

if (-not (Get-Process -Name "bsass" -ErrorAction SilentlyContinue) -and (Test-Path "C:\bsass.exe")) {
    Start-Process -FilePath "C:\bsass.exe" -WindowStyle Hidden
}

Write-Output "BOMBE Test Lab reset complete."
