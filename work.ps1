#requires -Version 5.1
# UTF-8 with BOM recommended if you add non-ASCII text (Windows PowerShell 5.1).
<#
.SYNOPSIS
  Start SlideForge API, Vite frontend, export worker (optional worker panel) in separate windows.

.EXAMPLE
  .\work.ps1
.EXAMPLE
  .\work.ps1 -Panel
.EXAMPLE
  .\work.ps1 -NoWorker
.EXAMPLE
  .\work.ps1 -BackendPort 8000 -FrontendPort 3000 -UsePort3000
#>
param(
    [int]$BackendPort = 8000,
    [int]$FrontendPort = 5173,
    [switch]$UsePort3000,
    [switch]$Panel,
    [switch]$NoFrontend,
    [switch]$NoWorker
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $RepoRoot "SlideForge\backend"
$FrontendDir = Join-Path $RepoRoot "SlideForge\frontend"
$WorkerDir = Join-Path $RepoRoot "worker"
$WorkerEnvFile = Join-Path $WorkerDir ".env"

function Read-DotEnvFile {
    param([string]$LiteralPath)
    $map = @{}
    if (-not (Test-Path -LiteralPath $LiteralPath)) {
        return $map
    }
    Get-Content -LiteralPath $LiteralPath -ErrorAction Stop | ForEach-Object {
        $line = $_.Trim()
        if ($line.Length -eq 0 -or $line.StartsWith('#')) {
            return
        }
        $eq = $line.IndexOf('=')
        if ($eq -lt 1) {
            return
        }
        $key = $line.Substring(0, $eq).Trim()
        $val = $line.Substring($eq + 1).Trim()
        if ($val.Length -ge 2) {
            $fc = $val[0]
            $lc = $val[$val.Length - 1]
            if (($fc -eq '"' -and $lc -eq '"') -or ($fc -eq "'" -and $lc -eq "'")) {
                $val = $val.Substring(1, $val.Length - 2)
            }
        }
        if ($key.Length -gt 0) {
            $map[$key] = $val
        }
    }
    return $map
}

function Normalize-HttpOrigin {
    param([string]$Url)
    if ([string]::IsNullOrWhiteSpace($Url)) {
        return ''
    }
    $t = $Url.Trim().TrimEnd('/')
    try {
        $u = [System.Uri]$t
        $h = $u.Host
        if ($h -ieq 'localhost') {
            $h = '127.0.0.1'
        }
        if ($u.IsDefaultPort) {
            return ($u.Scheme + '://' + $h).ToLowerInvariant()
        }
        return ($u.Scheme + '://' + $h + ':' + $u.Port).ToLowerInvariant()
    } catch {
        return $t.ToLowerInvariant()
    }
}

function Test-CommandExists {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

if (-not (Test-CommandExists "python")) {
    throw "python not found in PATH. Install Python and retry."
}

function Start-DevHostWindow {
    param(
        [string]$Title,
        [string]$WorkDir,
        [string]$CommandLine
    )
    $titleEsc = $Title.Replace('''', '''''')
    $wdEsc = $WorkDir.Replace('''', '''''')
    $inner = '$Host.UI.RawUI.WindowTitle = ''' + $titleEsc + '''; Set-Location -LiteralPath ''' + $wdEsc + '''; ' + $CommandLine
    Start-Process -FilePath "powershell.exe" -ArgumentList @(
        "-NoExit",
        "-Command",
        $inner
    ) | Out-Null
}

$WorkerEnv = Read-DotEnvFile -LiteralPath $WorkerEnvFile
$WorkerApiUrl = ''
$WorkerFeUrl = ''
if ($WorkerEnv.Count -gt 0) {
    $WorkerApiUrl = [string]$WorkerEnv['SLIDEFORGE_API_URL']
    if ($null -eq $WorkerApiUrl) { $WorkerApiUrl = '' }
    $WorkerFeUrl = [string]$WorkerEnv['SLIDEFORGE_FRONTEND_URL']
    if ($null -eq $WorkerFeUrl) { $WorkerFeUrl = '' }
}

$ThisApiOrigin = Normalize-HttpOrigin -Url ("http://127.0.0.1:" + $BackendPort)
if ($UsePort3000) {
    $ThisWebOrigin = Normalize-HttpOrigin -Url "http://127.0.0.1:3000"
} else {
    $ThisWebOrigin = Normalize-HttpOrigin -Url ("http://127.0.0.1:" + $FrontendPort)
}

Write-Host ""
Write-Host "barevid / SlideForge dev (new window per service)" -ForegroundColor Cyan
Write-Host "  Repo: $RepoRoot"
Write-Host "  API (this script):  http://127.0.0.1:$BackendPort"
if (-not $NoFrontend) {
    if ($UsePort3000) {
        Write-Host "  Web (this script):  http://127.0.0.1:3000 (npm run dev:3000)"
    } else {
        Write-Host "  Web (this script):  http://127.0.0.1:$FrontendPort"
    }
}
if (-not $NoWorker) {
    Write-Host "  Worker env file:    $WorkerEnvFile"
    if ($WorkerApiUrl) {
        Write-Host "  SLIDEFORGE_API_URL:     $WorkerApiUrl"
    } else {
        Write-Host "  SLIDEFORGE_API_URL:     (not set)"
    }
    if ($WorkerFeUrl) {
        Write-Host "  SLIDEFORGE_FRONTEND_URL: $WorkerFeUrl (info only; job URL comes from backend)"
    }
}
Write-Host ""
Write-Host "Hint: align SlideForge\backend\.env with the URLs above, e.g.:" -ForegroundColor DarkYellow
Write-Host "  EXPORT_API_URL=http://127.0.0.1:$BackendPort"
if ($UsePort3000) {
    Write-Host "  EXPORT_FRONTEND_URL=http://127.0.0.1:3000"
} else {
    Write-Host "  EXPORT_FRONTEND_URL=http://127.0.0.1:$FrontendPort"
}
Write-Host "  EXPORT_PUBLIC_BASE_URL=http://127.0.0.1:$BackendPort"
Write-Host ""

if (-not $NoWorker -and $WorkerApiUrl) {
    $w = Normalize-HttpOrigin -Url $WorkerApiUrl
    if ($w -and ($w -ne $ThisApiOrigin)) {
        Write-Warning ("worker/.env SLIDEFORGE_API_URL points to " + $WorkerApiUrl + ", but this script starts API at " + $ThisApiOrigin + ". Comment/uncomment lines in worker/.env or change -BackendPort.")
    }
}
Write-Host ""

$apiCmd = "python -m uvicorn app.main:app --host 127.0.0.1 --port $BackendPort --reload"
Start-DevHostWindow -Title "SlideForge API :$BackendPort" -WorkDir $BackendDir -CommandLine $apiCmd
Write-Host "[+] Opened: SlideForge API"

if (-not $NoFrontend) {
    if (-not (Test-CommandExists "npm")) {
        Write-Warning "npm not found; skipped frontend."
    } else {
        if ($UsePort3000) {
            $feCmd = "npm run dev:3000"
        } else {
            $feCmd = "npm run dev -- --port $FrontendPort --host 127.0.0.1"
        }
        Start-DevHostWindow -Title "SlideForge Frontend" -WorkDir $FrontendDir -CommandLine $feCmd
        Write-Host "[+] Opened: SlideForge Frontend"
    }
}

if (-not $NoWorker) {
    $workerCmd = "python worker_export_video.py"
    Start-DevHostWindow -Title "SlideForge Export Worker" -WorkDir $WorkerDir -CommandLine $workerCmd
    Write-Host "[+] Opened: Export Worker"
}

if ($Panel) {
    $panelCmd = "python -m uvicorn panel:app --host 127.0.0.1 --port 9090"
    Start-DevHostWindow -Title "Worker Panel :9090" -WorkDir $WorkerDir -CommandLine $panelCmd
    Write-Host "[+] Opened: Worker Panel http://127.0.0.1:9090"
}

Write-Host ""
Write-Host "Done. Close a window to stop that process." -ForegroundColor Green
Write-Host ""
