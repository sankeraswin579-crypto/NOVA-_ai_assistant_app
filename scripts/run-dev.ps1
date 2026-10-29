$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Write-Host "Start backend and frontend in separate PowerShell windows:"
Write-Host "1) cd `"$root\backend`"; .\.venv\Scripts\Activate.ps1; uvicorn app.main:app --reload --host 127.0.0.1 --port 8765"
Write-Host "2) cd `"$root\frontend`"; npm install; npm run dev"
Write-Host "3) Optional desktop shell: cd `"$root\desktop`"; npm install; npm run dev"
