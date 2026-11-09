# Changelog

## Unreleased — evolution increment 1

Baseline: upstream `sankeraswin579-crypto/NOVA-_ai_assistant_app` @ `8b32ba6`.

### Fixed

- **Document Q&A no longer fails on a large library.** `retrieve_context` raised
  `Select up to 50 documents for one question.` at 51 documents and
  `This knowledge base has too many indexed chunks for a single search.` above 2,000
  chunks, both reachable from the Writer picker's default "leave empty for all". It now
  selects the 50 most recent documents and scores chunks in id-paged batches, keeping the
  best matches. (`backend/app/rag.py`)
- **API-URL IPC handlers require a trusted renderer.** `nova:get-api-url` and
  `nova:set-api-url` were the only handlers without `assertTrustedRenderer`, so a
  compromised renderer could repoint the app at an attacker-controlled API.
  (`desktop/main.cjs`)
- **A finished agent run's log is frozen.** Only `approval` events may be appended after a
  run closes, so the audit trail of what the agents did cannot be rewritten.
  (`backend/app/main.py`)

### Added

- **Alembic migrations.** `ensure_schema()` replaces `Base.metadata.create_all()` and
  stamps a legacy database at head instead of rebuilding it. Initial revision
  `0001_initial` matches the existing models exactly. (`backend/migrations/`,
  `backend/alembic.ini`, `backend/app/database.py`)
- **Anthropic provider.** `AnthropicAdapter` for the Messages API, with a payload builder
  that normalises turns so a truncated history cannot produce a 400.
  (`backend/app/ai_engine.py`, `backend/app/config.py`)
- **Token usage accounting.** Adapters take an optional usage sink; `AIResult.usage` and
  the stream `done` event report `prompt_tokens` / `completion_tokens` when the provider
  supplies them. OpenAI and Groq need `stream_options.include_usage`, which is now sent.
- **Tests:** retrieval caps (2), IPC guard policy (2), agent-run integrity (extended),
  migrations (3), Anthropic payload/adapter/routing (4), usage plumbing (1).

### Changed

- `ProviderName`, both request schemas and the frontend provider union include `anthropic`.
- `backend/requirements.txt` adds `alembic>=1.13,<2.0`.
- `backend/nova-api.spec` ships `alembic.ini` and `migrations/` with the frozen sidecar.
- `backend/.env.example` documents the four `ANTHROPIC_*` variables.

### Removed

- Nothing. No files were deleted, renamed or moved.

### Upgrade notes

- Run `pip install -r requirements.txt` — Alembic is a new dependency.
- Existing `nova.db` files are migrated in place on first start; take a copy first anyway.
- Cloud routing order now includes Anthropic after OpenAI in `cloud-first` mode. Providers
  without a key and model are skipped, so behaviour is unchanged for existing setups.
