$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..\backend")
if (!(Test-Path ".\.venv\Scripts\python.exe")) {
  py -3.11 -m venv .venv
}
& ".\.venv\Scripts\python.exe" -m pip install --upgrade pip
& ".\.venv\Scripts\python.exe" -m pip install -r requirements.txt
& ".\.venv\Scripts\python.exe" -m PyInstaller --noconfirm --clean --onefile --name nova-api --collect-all fastapi --collect-all sqlalchemy --collect-all pydantic_settings --collect-all uvicorn --hidden-import multipart launcher.py
Write-Host "Backend executable created at backend\dist\nova-api.exe"
