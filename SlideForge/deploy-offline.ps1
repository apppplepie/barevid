param(
    [string]$ServerHost = "10.192.11.108",
    [string]$ServerUser = "root",
    [string]$ServerPassword = "hillstone",
    [string]$RemoteDir = "/hillstone/SlideForge",
    [string]$Platform = "linux/amd64",
    [bool]$AutoStartDockerDesktop = $true,
    [int]$DockerStartTimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"

function Test-RequiredCommand {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Missing required command: $Name"
    }
}

function Invoke-Step {
    param(
        [Parameter(Mandatory = $true)]
        [scriptblock]$Script,
        [Parameter(Mandatory = $true)]
        [string]$ErrorMessage
    )

    & $Script
    if ($LASTEXITCODE -ne 0) {
        throw $ErrorMessage
    }
}

function Test-DockerReady {
    docker info | Out-Null
    return ($LASTEXITCODE -eq 0)
}

function Start-DockerDesktopIfNeeded {
    param([int]$TimeoutSeconds = 120)

    if (Test-DockerReady) {
        return
    }

    $desktopCandidates = @(
        "$Env:ProgramFiles\Docker\Docker\Docker Desktop.exe",
        "${Env:ProgramFiles(x86)}\Docker\Docker\Docker Desktop.exe",
        "$Env:LocalAppData\Programs\Docker\Docker\Docker Desktop.exe"
    )

    $desktopExe = $desktopCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    if (-not $desktopExe) {
        throw "Docker daemon is not running and Docker Desktop executable was not found."
    }

    Write-Host "==> Docker daemon is down, starting Docker Desktop..."
    Start-Process -FilePath $desktopExe | Out-Null

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 3
        if (Test-DockerReady) {
            Write-Host "==> Docker daemon is ready."
            return
        }
    }

    throw "Docker daemon did not become ready within $TimeoutSeconds seconds."
}

function Invoke-RemoteCommand {
    param(
        [string]$CommandText,
        [string]$HostName,
        [string]$UserName,
        [string]$Password
    )

    $sshpass = Get-Command sshpass -ErrorAction SilentlyContinue
    $plink = Get-Command plink -ErrorAction SilentlyContinue

    if ($Password -and $sshpass) {
        & $sshpass.Source -p $Password ssh -o StrictHostKeyChecking=accept-new "$UserName@$HostName" $CommandText
        return
    }

    if ($Password -and $plink) {
        & $plink.Source -batch -ssh -pw $Password "$UserName@$HostName" $CommandText
        return
    }

    & ssh -o StrictHostKeyChecking=accept-new "$UserName@$HostName" $CommandText
}

function Copy-ToRemote {
    param(
        [string[]]$LocalFiles,
        [string]$HostName,
        [string]$UserName,
        [string]$RemotePath,
        [string]$Password
    )

    $sshpass = Get-Command sshpass -ErrorAction SilentlyContinue
    $pscp = Get-Command pscp -ErrorAction SilentlyContinue

    if ($Password -and $sshpass) {
        foreach ($file in $LocalFiles) {
            & $sshpass.Source -p $Password scp -o StrictHostKeyChecking=accept-new $file "$UserName@$HostName`:$RemotePath/"
        }
        return
    }

    if ($Password -and $pscp) {
        foreach ($file in $LocalFiles) {
            & $pscp.Source -batch -pw $Password $file "$UserName@$HostName`:$RemotePath/"
        }
        return
    }

    foreach ($file in $LocalFiles) {
        & scp -o StrictHostKeyChecking=accept-new $file "$UserName@$HostName`:$RemotePath/"
    }
}

Write-Host "==> Checking local dependencies..."
Test-RequiredCommand docker
Test-RequiredCommand scp
Test-RequiredCommand ssh

Write-Host "==> Checking Docker daemon..."
if ($AutoStartDockerDesktop) {
    Start-DockerDesktopIfNeeded -TimeoutSeconds $DockerStartTimeoutSeconds
}
else {
    Invoke-Step -Script { docker info | Out-Null } -ErrorMessage "Docker daemon is not running. Start Docker Desktop first, then rerun this script."
}

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ImagesDir = Join-Path $ProjectRoot "images"
$BackendEnvFile = Join-Path $ProjectRoot "backend/.env"

if (-not (Test-Path $ImagesDir)) {
    New-Item -ItemType Directory -Path $ImagesDir | Out-Null
}

$BackendImage = "slideforge-backend:offline"
$FrontendImage = "slideforge-frontend:offline"
$BackendTar = Join-Path $ImagesDir "slideforge-backend-offline.tar"
$FrontendTar = Join-Path $ImagesDir "slideforge-frontend-offline.tar"

Write-Host "==> Building backend image ($BackendImage) for $Platform ..."
Invoke-Step -Script { docker buildx build --platform $Platform -t $BackendImage -f backend/Dockerfile . --load } -ErrorMessage "Backend image build failed."

Write-Host "==> Building frontend image ($FrontendImage) for $Platform ..."
Invoke-Step -Script { docker buildx build --platform $Platform -t $FrontendImage -f frontend/Dockerfile . --load } -ErrorMessage "Frontend image build failed."

Write-Host "==> Saving images to tar files..."
Invoke-Step -Script { docker save -o $BackendTar $BackendImage } -ErrorMessage "Saving backend image tar failed."
Invoke-Step -Script { docker save -o $FrontendTar $FrontendImage } -ErrorMessage "Saving frontend image tar failed."

Write-Host "==> Ensuring remote directory exists: $RemoteDir"
Invoke-RemoteCommand -CommandText "mkdir -p $RemoteDir" -HostName $ServerHost -UserName $ServerUser -Password $ServerPassword

if (Test-Path $BackendEnvFile) {
    Write-Host "==> Syncing backend/.env to remote..."
    Invoke-RemoteCommand -CommandText "mkdir -p $RemoteDir/backend" -HostName $ServerHost -UserName $ServerUser -Password $ServerPassword
    Copy-ToRemote -LocalFiles @($BackendEnvFile) -HostName $ServerHost -UserName $ServerUser -RemotePath "$RemoteDir/backend" -Password $ServerPassword
}
else {
    Write-Host "==> WARN: backend/.env not found locally, skip env sync."
}

Write-Host "==> Uploading tar files to $ServerUser@$ServerHost ..."
Copy-ToRemote -LocalFiles @($BackendTar, $FrontendTar) -HostName $ServerHost -UserName $ServerUser -RemotePath $RemoteDir -Password $ServerPassword

$remoteScript = @(
    "set -e",
    "docker load -i $RemoteDir/slideforge-backend-offline.tar",
    "docker load -i $RemoteDir/slideforge-frontend-offline.tar",
    "docker tag slideforge-backend:offline slideforge-backend:latest",
    "docker tag slideforge-frontend:offline slideforge-frontend:latest",
    "cd $RemoteDir",
    "docker compose up -d --no-build",
    "docker compose ps"
) -join " && "

Write-Host "==> Loading images and starting containers on remote host..."
Invoke-RemoteCommand -CommandText $remoteScript -HostName $ServerHost -UserName $ServerUser -Password $ServerPassword

Write-Host ""
Write-Host "Done."
Write-Host "Backend:  http://$ServerHost`:8000"
Write-Host "Frontend: http://$ServerHost`:3000"
