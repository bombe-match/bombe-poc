param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("MAL", "EDR")]
    [string]$Role,

    [Parameter(Mandatory = $true)]
    [string]$Binary,

    [ValidateRange(15, 600)]
    [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"
$Role = $Role.ToUpperInvariant()
$Binary = (Resolve-Path $Binary).Path
$LabRoot = $PSScriptRoot
$BinRoot = Join-Path $LabRoot "bin"
$RunRoot = Join-Path $LabRoot "run"
$ResultPath = Join-Path $RunRoot "result.json"
$ServerUrl = "http://127.0.0.1:5137"
$Processes = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()

function Start-LabProcess {
    param([string]$Path, [string[]]$Arguments = @())

    if ($Arguments.Count -gt 0) {
        $process = Start-Process -FilePath $Path -ArgumentList $Arguments -WindowStyle Hidden -PassThru
    } else {
        $process = Start-Process -FilePath $Path -WindowStyle Hidden -PassThru
    }
    $Processes.Add($process)
    return $process
}

function Stop-LabProcesses {
    foreach ($process in $Processes) {
        if ($null -ne $process -and -not $process.HasExited) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        }
    }
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this script from an elevated PowerShell terminal."
}

foreach ($required in @("BombeLab.exe", "sample-malware.exe", "sample-edr.exe", "dummy.exe")) {
    if (-not (Test-Path (Join-Path $BinRoot $required))) {
        throw "Test Lab file is missing: $required"
    }
}
foreach ($target in @("HKLM:\SOFTWARE\BOMBE", "C:\Users\bombe\AppData\Local\bhrome\Login Data", "C:\bsass.exe")) {
    if (-not (Test-Path $target)) {
        throw "Playground target is missing: $target"
    }
}

Remove-Item $RunRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $RunRoot -Force | Out-Null

$malwareName = "BOMBE_EDR_FLAG_$([Guid]::NewGuid().ToString('N')).exe"
$malwarePath = Join-Path $RunRoot $malwareName
$edrPath = Join-Path $RunRoot "participant-edr.exe"

if ($Role -eq "MAL") {
    Copy-Item $Binary $malwarePath
    Copy-Item (Join-Path $BinRoot "sample-edr.exe") $edrPath
} else {
    Copy-Item (Join-Path $BinRoot "sample-malware.exe") $malwarePath
    Copy-Item $Binary $edrPath
}

$dummyPaths = 1..2 | ForEach-Object {
    $path = Join-Path $RunRoot "BOMBE_EDR_FLAG_$([Guid]::NewGuid().ToString('N')).exe"
    Copy-Item (Join-Path $BinRoot "dummy.exe") $path
    $path
}

try {
    if (-not (Get-Process -Name "bsass" -ErrorAction SilentlyContinue)) {
        Start-LabProcess "C:\bsass.exe" | Out-Null
    }

    $serverStdout = Join-Path $RunRoot "server.stdout.log"
    $serverStderr = Join-Path $RunRoot "server.stderr.log"
    $server = Start-Process -FilePath (Join-Path $BinRoot "BombeLab.exe") `
        -ArgumentList @("--expected-edr", $malwareName, "--result", $ResultPath) `
        -RedirectStandardOutput $serverStdout -RedirectStandardError $serverStderr `
        -WindowStyle Hidden -PassThru
    $Processes.Add($server)

    $ready = $false
    foreach ($attempt in 1..20) {
        try {
            Invoke-RestMethod -Uri "$ServerUrl/health" -TimeoutSec 1 | Out-Null
            $ready = $true
            break
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }
    if (-not $ready) {
        throw "BombeLab server did not become ready. See $serverStderr"
    }

    $env:BOMBE_SUBMIT_BASE_URL = $ServerUrl

    Start-LabProcess $edrPath | Out-Null
    Start-Sleep -Seconds 5

    # This is a public diagnostic sequence, not the production Battle launcher.
    foreach ($dummyPath in $dummyPaths) {
        Start-LabProcess $dummyPath | Out-Null
    }
    Start-LabProcess $malwarePath | Out-Null

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        $status = Invoke-RestMethod -Uri "$ServerUrl/status" -TimeoutSec 2
        $required = @($status.objectives | Where-Object { $_.role -eq $Role })
        if ($required.Count -gt 0 -and @($required | Where-Object { $_.verdict -eq "NOT_RECEIVED" }).Count -eq 0) {
            Start-Sleep -Seconds 3
            break
        }
        Start-Sleep -Seconds 1
    }

    Invoke-RestMethod -Method Post -Uri "$ServerUrl/finalize" -TimeoutSec 5 | Out-Null
    $result = Get-Content $ResultPath -Raw | ConvertFrom-Json
    Get-Content $ResultPath -Raw

    $playerObjectives = @($result.objectives | Where-Object { $_.role -eq $Role })
    if (@($playerObjectives | Where-Object { $_.verdict -ne "PASSED" }).Count -gt 0) {
        exit 2
    }
} finally {
    Stop-LabProcesses
    Remove-Item Env:BOMBE_SUBMIT_BASE_URL -ErrorAction SilentlyContinue
}
