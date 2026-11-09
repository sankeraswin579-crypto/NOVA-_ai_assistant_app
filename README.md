# Nova AI Desktop

A cinematic dark-mode AI workspace with a React web UI, FastAPI backend, SQLite persistence, a multi-provider AI engine, and an Electron Windows desktop wrapper.

## Features
- Chat workspace with conversation history persisted in SQLite
- Central AI engine with Ollama, Google Gemini, OpenAI, Groq, and Anthropic provider routing, with per-call token usage where the provider reports it
- Streaming chat and Writer actions with provider health checks and explicit local/cloud modes
- Strict local-only default; cloud requests require an explicit mode change
- Read-only desktop project context for asking Nova questions about selected source files
- Project explorer with filtered tree, filename/content search, and import-aware local context retrieval
- AI code-change proposals with per-file review, explicit OS confirmation, stale-file checks, and backups
- Approved project test runs with bounded output and optional local-model failure explanations
- Supervised Agent Command Center with Architect, Developer, QA, and Security roles, shared task logs, and per-change approvals
- Create, search, edit, and delete notes
- PDF, DOCX, and TXT document extraction, local Ollama embeddings, vector retrieval, and cited Writer answers
- Web mode and Windows desktop packaging path
- Health endpoint and basic backend tests

Provider credentials are read only by the FastAPI backend from environment variables. They are never entered into or returned to the frontend.

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

## 2. Local AI and privacy modes
Nova defaults to **Local-only** mode. In this mode, the AI engine only uses a loopback Ollama endpoint and never falls back to a cloud provider. If local Ollama is unavailable or not configured, Nova shows a connection/configuration error instead of returning a canned answer. Chat messages and notes are stored in `backend/nova.db` by default.

To use local chat and document embeddings:
1. Install Ollama from https://ollama.com/
2. Download a chat and embedding model:
```powershell
ollama pull llama3.2:3b
ollama pull nomic-embed-text
```
3. Start Ollama and configure `backend/.env`:
```env
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.2:3b
OLLAMA_EMBEDDING_MODEL=nomic-embed-text
NOVA_AI_DEFAULT_MODE=local-only
```
4. Restart FastAPI. Imported documents are saved even when embeddings are unavailable, but Writer document Q&A requires a local embedding model and will report indexing errors.

## 3. Cloud providers
To enable cloud providers, configure the API host's `backend/.env` with one or more credentials and model names, then restart FastAPI:
```env
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.0-flash
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
GROQ_API_KEY=
GROQ_MODEL=llama-3.3-70b-versatile
```
In Settings, choose **Local-first** or **Cloud-first** (or select a cloud provider directly). These modes can send prompts and retrieved document excerpts to a cloud provider. **Local-only** prevents cloud requests even if credentials are configured. Provider API keys are never stored in the browser or desktop UI. Use the Settings connection test to check configured providers.

The mode can be set for a backend deployment with `NOVA_AI_DEFAULT_MODE=local-only|local-first|cloud-first`; the desktop user's explicit Settings selection takes precedence for their requests. Project files, project agents, code proposals, and test explanations remain restricted to a loopback API and local Ollama in every mode.

## 4. Build the web app
Build frontend:
```powershell
cd frontend
npm run build
```
Deploy `frontend/dist` to a static host (e.g. Vercel or Netlify). Deploy the FastAPI backend to a Python host that supports persistent storage, and set `VITE_API_BASE_URL` to the deployed API URL before building the frontend.

Important: SQLite on many ephemeral hosting services is not durable. Use a persistent disk or PostgreSQL for production. Configure CORS in `backend/.env` with the exact deployed frontend origin.

## 5. Build a Windows desktop installer
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

### Work with a local project
In the desktop app, choose **Project Explorer** or the folder icon in chat and select a folder. The explorer displays supported source/configuration files, searches filenames and contents on-device, previews selected files, and uses local import references to retrieve relevant related files for chat (up to 8 files / 40,000 characters). Common build/dependency folders, lockfiles, environment files, sensitive filenames, symlinks, and likely credential values are excluded or redacted. Project context is sent only to a loopback Nova API and a loopback Ollama endpoint; file contents are not saved to chat history.

Nova starts in read-only mode. To request an AI change, select safe source files, describe the task, and review each before/after proposal. Every file requires its own approval in an operating-system confirmation dialog; Nova verifies the file has not changed and creates a backup under the desktop app's user-data `project-backups` folder before applying it. Sensitive or truncated files cannot be written through proposals.

The Testing Assistant recognizes test scripts/runners from project manifests (currently `npm test`, `python -m pytest -q`, `cargo test`, and `go test ./...`). Choosing **Review & run** opens an OS confirmation showing the exact fixed command. Only those detected commands are available; Nova-generated commands are never executed. Runs have a five-minute timeout, a 1 MB output cap, and receive a minimal environment that excludes credentials and Nova/Ollama configuration. Output is displayed locally. **Ask Nova to explain failure** sends sanitized output and selected safe files only to the loopback Nova API/model; that explanation is not added to chat history.

The desktop shell enables the project-proposal and test-explanation API routes for its bundled loopback backend. If running FastAPI separately for desktop development, set `NOVA_LOCAL_PROJECT_TOOLS=1` in `backend/.env`; these endpoints remain disabled by default and reject non-loopback callers. Keep `OLLAMA_BASE_URL` on a loopback address to use project source with a model. Remote APIs and remote model endpoints are not allowed to receive project context.

### Use the Agent Command Center
Open **Agent Command Center**, choose a project in Project Explorer, then describe one task. Nova retrieves a bounded set of relevant safe files on-device and coordinates four local-model roles in order: Architect plans, Developer proposes per-file edits, QA reviews the validation plan, and Security reviews the source and proposed code when it fits the review limit. Prior agent results are passed as untrusted context to the next role.

The workflow is supervised, not autonomous: generated code remains a proposal until each file is individually approved in an operating-system dialog, with a backup and stale-file check. QA test commands are offered separately and only run after OS confirmation; output is sanitized before the QA agent receives it. No model-generated shell command is executed. Agent runs and event logs are saved to the local SQLite database; logs may contain agent-written excerpts, but project files are not uploaded as run records. Agent endpoints are disabled unless `NOVA_LOCAL_PROJECT_TOOLS=1` is enabled and accept only local callers/origins; project data is sent only to a loopback Nova API and loopback Ollama model. This MVP runs the four roles sequentially on the configured Ollama model; parallel execution, multi-provider model routing, and automatic retries are not enabled.

### Prepare an online API deployment
The API can run as a Docker container on a host that supports persistent volumes. Build from `backend/` and mount a persistent volume at `/data`; set `NOVA_DATABASE_URL=sqlite:////data/nova.db`, `NOVA_CORS_ORIGINS=*`, and optionally `OLLAMA_BASE_URL` / `OLLAMA_MODEL`. `*` permits Electron desktop and hosted web origins; use explicit trusted web origins when you only have a browser client. Configure the host's health check to `GET /api/health`. `backend/Dockerfile` includes the container setup. For a local Windows server, run `scripts/run-online-api.ps1`; use a trusted HTTPS reverse proxy before allowing internet access. These steps prepare the service, but do not provision a cloud account or publish it.

## 6. Tests
```powershell
cd backend
.\.venv\Scripts\Activate.ps1
pytest -q
```

Desktop project-access and Electron IPC security tests:
```powershell
cd desktop
npm test
```

## 7. GitHub
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
- Document text and Ollama embeddings are stored in the API's configured SQLite database; OCR and scanned-PDF extraction are not supported.
