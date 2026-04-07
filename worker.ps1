#requires -Version 5.1
<#
.SYNOPSIS
  Start only the SlideForge export worker (worker_export_video.py).

.EXAMPLE
  .\worker.ps1
.EXAMPLE
  .\worker.ps1 -Foreground
    Run in this terminal (blocking) instead of a new window.
#>
param(
    [switch]$Foreground
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$WorkerDir = Join-Path $RepoRoot "worker"

function Test-CommandExists {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

if (-not (Test-CommandExists "python")) {
    throw "python not found in PATH. Install Python and retry."
}

if (-not (Test-Path -LiteralPath (Join-Path $WorkerDir "worker_export_video.py"))) {
    throw "worker_export_video.py not found under: $WorkerDir"
}

function Start-WorkerHostWindow {
    param(
        [string]$WorkDir,
        [string]$CommandLine
    )
    $title = "SlideForge Export Worker"
    $titleEsc = $title.Replace('''', '''''')
    $wdEsc = $WorkDir.Replace('''', '''''')
    $inner = '$Host.UI.RawUI.WindowTitle = ''' + $titleEsc + '''; Set-Location -LiteralPath ''' + $wdEsc + '''; ' + $CommandLine
    Start-Process -FilePath "powershell.exe" -ArgumentList @(
        "-NoExit",
        "-Command",
        $inner
    ) | Out-Null
}

Write-Host ""
Write-Host "SlideForge export worker" -ForegroundColor Cyan
Write-Host "  Repo:   $RepoRoot"
Write-Host "  Worker: $WorkerDir"
Write-Host "  Config: $(Join-Path $WorkerDir '.env')"
Write-Host ""

if ($Foreground) {
    Set-Location -LiteralPath $WorkerDir
    python worker_export_video.py
}
else {
    Start-WorkerHostWindow -WorkDir $WorkerDir -CommandLine "python worker_export_video.py"
    Write-Host "[+] Opened new window: SlideForge Export Worker" -ForegroundColor Green
    Write-Host "    Close that window to stop the worker." -ForegroundColor DarkGray
    Write-Host ""
}
