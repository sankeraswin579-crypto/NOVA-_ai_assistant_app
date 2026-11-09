# NOVA AI — evolution repository

This repository is the evolution line of
[`sankeraswin579-crypto/NOVA-_ai_assistant_app`](https://github.com/sankeraswin579-crypto/NOVA-_ai_assistant_app).
It was created so major development does not disturb a working local install.

- **Baseline commit** `437ae30` is an exact import of upstream `8b32ba6`. Nothing was
  rewritten to start this repo; the history shows the original tree as-is.
- Every change after the baseline is on a feature branch and merged with `--no-ff`, so
  each increment can be reviewed, reverted or cherry-picked on its own.

## Branch model

| Branch | Purpose |
| --- | --- |
| `main` | Integration branch. Only merges, never direct commits. |
| `fix/rag-retrieval-caps` | Document Q&A no longer fails past 50 documents / 2,000 chunks. |
| `fix/ipc-api-url-guard` | API-URL IPC handlers now require a trusted renderer. |
| `fix/agent-run-integrity` | A finished agent run's log is frozen except for approval decisions. |
| `feat/migrations` | Alembic schema migrations, with a safe upgrade path for existing databases. |
| `feat/anthropic-usage` | Anthropic provider plus per-call token usage. |

## What this increment contains

This is increment 1 of the sequencing in the audit: hardening first, then the schema
mechanism everything else depends on, then a new provider. It is deliberately not the
whole roadmap.

1. **RAG retrieval caps** — `retrieve_context` treated its size caps as errors on the
   result set. It now bounds the candidate set: the 50 most recent documents when no
   selection is given, and an id-paged chunk scan that keeps the best matches. Scoring,
   ordering and the "no matching context" error are unchanged.
2. **Electron IPC guard** — `nova:get-api-url` / `nova:set-api-url` were the only handlers
   without `assertTrustedRenderer`. A policy test now fails any handler registered without
   a guard.
3. **Agent run integrity** — event appends are rejected once a run is finished, except for
   `approval` events, which the Command Center's approve/reject flow needs.
4. **Migrations** — Alembic replaces `Base.metadata.create_all()`. `ensure_schema()` runs
   on startup, stamps a legacy `create_all` database at head instead of rebuilding it, and
   upgrades to head. Existing conversations, notes and documents are preserved.
5. **Anthropic provider + usage** — `AnthropicAdapter` speaks the Messages API (system
   prompt as a top-level field, alternating turns, must open with a user turn), and all
   adapters now report token usage when the provider does.

## Running it

Backend:

```bash
cd backend
python -m venv .venv && . .venv/bin/activate      # Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
cp .env.example .env                              # then fill in what you need
python -m pytest -q
python -m alembic current                         # shows the applied revision
uvicorn app.main:app --host 127.0.0.1 --port 8765
```

Frontend:

```bash
cd frontend
npm ci
npm run build                                     # tsc -b && vite build
```

Desktop (Windows): `scripts\run-dev.ps1` after creating `backend\.venv`.

## Database notes

- `NOVA_DATABASE_URL` still points wherever it did before; nothing about the file moves.
- On first start after upgrading, an existing database is stamped `0001_initial` and left
  untouched. A new database is created from the migration.
- New migrations: `python -m alembic revision --autogenerate -m "..."` from `backend/`,
  after changing `app/models.py`. Always review the generated file — SQLite cannot alter
  most column types in place, so those need a table rebuild.

## Environment

Secrets live in `.env`, which is git-ignored (`**/.env`). `.env.example` documents every
variable. `ANTHROPIC_MODEL` intentionally has no default: model ids change often and a
wrong default would send requests to a model your key may not have.

## Roadmap status

Done here: provider expansion (Anthropic), usage accounting, migrations, and three
hardening fixes from the audit.

Still open from the audit: loopback token auth for the API (the `null` CORS origin issue),
persisting a failed chat turn instead of leaving an orphan user message, returning document
metadata instead of full bodies from `GET /api/documents`, cancelling the SSE reader on
error in the frontend, and the Gemini history-slice edge case.

Not started (needs its own design and your approval): a permissioned tool-execution layer,
memory, knowledge graph, Codex workspace, computer use. Those are architectural changes,
not features to bolt on.
