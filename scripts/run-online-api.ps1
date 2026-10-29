param(
  [string]$Port = "8000",
  [string]$DataDirectory = "$env:LOCALAPPDATA\NovaAI\server-data"
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$backend = Join-Path $root "backend"
$venvPython = Join-Path $backend ".venv\Scripts\python.exe"

if (!(Test-Path $venvPython)) {
  py -3.11 -m venv (Join-Path $backend ".venv")
}
& $venvPython -m pip install -r (Join-Path $backend "requirements.txt")
New-Item -ItemType Directory -Force -Path $DataDirectory | Out-Null
$databasePath = (Join-Path $DataDirectory "nova.db").Replace("\", "/")
$env:NOVA_DATABASE_URL = "sqlite:///$databasePath"
$env:NOVA_CORS_ORIGINS = "null,http://localhost:5173,http://127.0.0.1:5173"
& $venvPython -m uvicorn app.main:app --host 0.0.0.0 --port $Port
