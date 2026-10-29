$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location (Join-Path $root "frontend")
if (!(Test-Path "node_modules")) { npm install }
npm run build
Set-Location (Join-Path $root "desktop")
if (!(Test-Path "node_modules")) { npm install }
if (!(Test-Path (Join-Path $root "backend\dist\nova-api.exe"))) {
  throw "Missing backend\dist\nova-api.exe. Run .\scripts\build-backend.ps1 first."
}
npm run dist
Write-Host "Installer output is in desktop\release"
