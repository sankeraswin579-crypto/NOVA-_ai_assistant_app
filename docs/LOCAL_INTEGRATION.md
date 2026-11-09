# Integrating the evolution into a local NOVA install

Target used in the examples: `D:\Documents\nova-ai-desktop`. Substitute your own path.

The integration is a **git merge of an unrelated history**. The evolution repository was
seeded from the same upstream commit (`8b32ba6`), so files that were not changed by either
side merge cleanly. Only files changed in *both* places can conflict.

Nothing in this document deletes a branch, force-pushes or resets your work.

## 0. What is protected

These are never part of a merge because they are git-ignored and not in any commit:

- `backend\.env` (and any `.env` you added) — your keys and URLs
- `backend\nova.db` (or wherever `NOVA_DATABASE_URL` points) — conversations, notes,
  documents
- `%APPDATA%\Nova\nova.db` — the packaged desktop app's database
- `node_modules`, `dist`, `build`, `.venv`

Confirm the incoming change set does not include them:

```powershell
git -C D:\Documents\nova-ai-desktop diff --name-only HEAD nova-evolution/main
```

You should see only source files: `backend/app/*.py`, `backend/migrations/*`,
`backend/alembic.ini`, `backend/tests/*`, `backend/requirements.txt`,
`backend/nova-api.spec`, `backend/.env.example`, `desktop/main.cjs`,
`desktop/tests/*`, `frontend/src/App.tsx`, `README.md`, `docs/*`, `CHANGELOG.md`,
`scripts/integrate-local.ps1`.

## 1. Inspect the local project first

```powershell
cd D:\Documents\nova-ai-desktop
git status
git branch -vv
git log --oneline -5
```

If `git status` shows uncommitted work, either commit it or stash it before continuing:

```powershell
git stash push -u -m "pre-nova-integration"
```

## 2. Back up (both ways)

A branch protects committed history; a folder copy protects everything else.

```powershell
git branch integration/backup-(Get-Date -Format yyyyMMdd-HHmmss)
robocopy D:\Documents\nova-ai-desktop D:\Documents\nova-ai-desktop-backup /E /XD node_modules .git dist release build .venv /XF nova.db
```

## 3. Integrate on a branch

```powershell
cd D:\Documents\nova-ai-desktop
git checkout -b integration/nova-evolution
git remote add nova-evolution D:\Documents\nova-evolution
git fetch nova-evolution main
git merge --no-ff nova-evolution/main --allow-unrelated-histories -m "merge: NOVA evolution increment 1"
```

If you would rather take it commit by commit:

```powershell
git rev-list --reverse --no-merges nova-evolution/main --not HEAD | ForEach-Object { git cherry-pick $_ }
```

## 4. Resolve conflicts

Expect conflicts only in files you changed locally that the evolution also changed:
`backend/app/rag.py`, `backend/app/main.py`, `backend/app/ai_engine.py`,
`backend/app/database.py`, `backend/app/config.py`, `backend/app/schemas.py`,
`backend/requirements.txt`, `desktop/main.cjs`, `frontend/src/App.tsx`, `README.md`.

Rules that keep behaviour intact:

- Take the evolution side for the three hardening fixes and the migration wiring unless you
  deliberately changed the same code.
- If you added your own endpoints or IPC handlers, keep them; the merge only adds.
- Never resolve a conflict by deleting a test. `backend/tests/*` should end up with the
  union of both sides.
- If `backend/app/database.py` conflicts, keep `ensure_schema()` and add anything you had
  on top of it — do not restore `Base.metadata.create_all()`.

```powershell
git status
git diff --name-only --diff-filter=U
# edit the files, then:
git add <files>
git commit
```

Abort and keep everything as it was:

```powershell
git merge --abort
```

## 5. Install and verify

```powershell
cd D:\Documents\nova-ai-desktop\backend
.\.venv\Scripts\Activate.ps1            # or create it: python -m venv .venv
pip install -r requirements.txt         # Alembic is new
python -m pytest -q
python -m alembic current               # expect 0001_initial (head)

cd ..\frontend
npm ci
npm run build

cd ..
.\scripts\run-dev.ps1
```

The first backend start migrates your existing `nova.db` in place: it is stamped
`0001_initial` and no table is rebuilt. Take the copy from step 2 anyway.

## 6. Roll back

```powershell
cd D:\Documents\nova-ai-desktop
git checkout main                        # or whatever your original branch was
git reset --hard integration/backup-<stamp>
```

The folder copy from step 2 restores anything that was never committed. If you stashed at
step 1: `git stash pop`.

## 7. About the script

`scripts\integrate-local.ps1` performs steps 1–5 above. It is **dry-run by default** and
only acts with `-Apply`:

```powershell
.\scripts\integrate-local.ps1                      # print the plan
.\scripts\integrate-local.ps1 -Apply -StashDirty   # do it
```

It was written for this integration but has not been executed on a Windows host, so read
the dry run before using `-Apply`, or follow this document by hand.
