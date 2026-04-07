# 构建并推送 SlideForge（backend / frontend）与宣传页 barevidweb。
# 用法（PowerShell，在仓库根 barevid 下）：
#   .\scripts\dbp.ps1
# 若 Docker Hub 用户名不是 creepender42：
#   $env:DOCKER_HUB_USER = "你的用户名"; .\scripts\dbp.ps1
# 仅构建不推送：
#   .\scripts\dbp.ps1 -Push:$false

param(
    [string]$Registry = $env:DOCKER_HUB_USER,
    [switch]$Push = $true
)

$ErrorActionPreference = "Stop"
if (-not $Registry) { $Registry = "creepender42" }

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$SlideForge = Join-Path $RepoRoot "SlideForge"

Write-Host "Registry prefix: $Registry" -ForegroundColor Cyan

Push-Location $SlideForge
try {
    Write-Host "`n=== backend ===" -ForegroundColor Green
    docker build -f backend/Dockerfile -t "${Registry}/barevid-backend:latest" .
    Write-Host "`n=== frontend (SlideForge) ===" -ForegroundColor Green
    docker build -f frontend/Dockerfile -t "${Registry}/barevid-frontend:latest" .
}
finally {
    Pop-Location
}

Write-Host "`n=== barevidweb ===" -ForegroundColor Green
Push-Location $RepoRoot
try {
    docker build -f barevidweb/Dockerfile -t "${Registry}/barevidweb:latest" .
}
finally {
    Pop-Location
}

if ($Push) {
    Write-Host "`n=== docker push ===" -ForegroundColor Green
    docker push "${Registry}/barevid-backend:latest"
    docker push "${Registry}/barevid-frontend:latest"
    docker push "${Registry}/barevidweb:latest"
    Write-Host "`nDone. 服务器拉取示例：" -ForegroundColor Cyan
    Write-Host "  docker pull ${Registry}/barevid-backend:latest"
    Write-Host "  docker pull ${Registry}/barevid-frontend:latest"
    Write-Host "  docker pull ${Registry}/barevidweb:latest"
}
