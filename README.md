# Nova AI Desktop

A cinematic dark-mode AI workspace with a React web UI, FastAPI backend, SQLite persistence, optional Ollama local-model integration, and an Electron Windows desktop wrapper.

## Features
- Chat workspace with conversation history persisted in SQLite
- Local offline assistant fallback (no API key required)
- Optional local LLM through Ollama (`OLLAMA_BASE_URL`, `OLLAMA_MODEL`)
- Create, search, edit, and delete notes
- Local document text import (`.txt` and `.md` in this starter)
- Web mode and Windows desktop packaging path
- Health endpoint and basic backend tests

> This is a practical starter/MVP. The offline fallback is a lightweight local assistant, not a large language model. For private, more capable offline answers, install Ollama and download a model.

## Architecture
- `frontend/`: React + Vite UI
- `backend/`: FastAPI + SQLAlchemy + SQLite
- `desktop/`: Electron shell
- `scripts/`: Windows helper scripts

## Requirements
- Windows 10/11
- Node.js 20+ (LTS recommended)
- Python 3.11 or 3.12
- Git
- Optional: Ollama for local model inference

## 1. Run locally in development

Open PowerShell in the project folder.

### Backend
```powershell
cd backend
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn app.main:app --reload --host 127.0.0.1 --port 8765
```
API docs: http://127.0.0.1:8765/docs

### Frontend (new PowerShell window)
```powershell
cd frontend
npm install
Copy-Item .env.example .env
npm run dev
```
Open http://localhost:5173.

### Desktop (after frontend and backend are running)
In another PowerShell window:
```powershell
cd desktop
npm install
npm run dev
```
The desktop shell loads the local Vite UI. Keep the backend and Vite dev server running during development.

## 2. Offline mode
The backend's built-in local fallback works without an internet connection or API key. Chat messages and notes are stored in `backend/nova.db` by default. To use a local LLM:
1. Install Ollama from https://ollama.com/
2. Download a model, for example: `ollama pull llama3.2:3b`
3. Start Ollama and configure `backend/.env`:
```env
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.2:3b
```
4. Restart FastAPI. If Ollama is unavailable, Nova falls back to its offline response engine.

## 3. Build the web app
Build frontend:
```powershell
cd frontend
npm run build
```
Deploy `frontend/dist` to a static host (e.g. Vercel or Netlify). Deploy the FastAPI backend to a Python host that supports persistent storage, and set `VITE_API_BASE_URL` to the deployed API URL before building the frontend.

Important: SQLite on many ephemeral hosting services is not durable. Use a persistent disk or PostgreSQL for production. Configure CORS in `backend/.env` with the exact deployed frontend origin.

## 4. Build a Windows desktop installer
The desktop package can be built using Electron Builder. The production desktop app expects a bundled backend sidecar executable.

### Build backend sidecar
From project root:
```powershell
.\scripts\build-backend.ps1
```
This creates `backend/dist/nova-api.exe` with PyInstaller.

### Build desktop installer
```powershell
.\scripts\build-desktop.ps1
```
The script builds the React UI, installs Electron dependencies, then packages an installer into `desktop/release/`.

The Electron main process launches `resources/backend/nova-api.exe` in packaged mode. Keep the `backend/dist/nova-api.exe` build artifact available before packaging.

### Connect the desktop app to an online API
Deploy the FastAPI backend to a host with persistent storage and HTTPS, then configure its CORS origins to include the desktop app (`null`) and any web UI origins. In Nova Desktop, open **Settings**, enter the API base URL (for example `https://your-nova-api.example.com`), choose **Test connection**, then **Save server**. The URL is saved in the desktop app's user settings and is used for chat, notes, and documents. For web builds, set `VITE_API_BASE_URL` before running `npm run build`.

The desktop app defaults to its bundled local API. Do not expose the API publicly without authentication and rate limiting; the starter API does not add authentication by itself.

### Prepare an online API deployment
The API can run as a Docker container on a host that supports persistent volumes. Build from `backend/` and mount a persistent volume at `/data`; set `NOVA_DATABASE_URL=sqlite:////data/nova.db`, `NOVA_CORS_ORIGINS=*`, and optionally `OLLAMA_BASE_URL` / `OLLAMA_MODEL`. `*` permits Electron desktop and hosted web origins; use explicit trusted web origins when you only have a browser client. Configure the host's health check to `GET /api/health`. `backend/Dockerfile` includes the container setup. For a local Windows server, run `scripts/run-online-api.ps1`; use a trusted HTTPS reverse proxy before allowing internet access. These steps prepare the service, but do not provision a cloud account or publish it.

## 5. Tests
```powershell
cd backend
.\.venv\Scripts\Activate.ps1
pytest -q
```

## 6. GitHub
```powershell
git init
git add .
git commit -m "Build Nova AI Desktop starter"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/nova-ai-desktop.git
git push -u origin main
```
Do not commit `.env`, SQLite database files, virtual environments, `node_modules`, or build outputs. Review `.gitignore` first.

## Security and production notes
- The local desktop API binds to loopback only.
- Do not expose the API publicly without authentication, rate limiting, and a production database.
- The Ollama endpoint is optional and intended for local development.
- This starter stores imported text locally; it does not yet perform semantic vector search or OCR.
