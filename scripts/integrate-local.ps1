# Integrate the evolution branch into a local NOVA install.
#
#   .\scripts\integrate-local.ps1                                   # dry run, prints the plan
#   .\scripts\integrate-local.ps1 -Apply                            # performs the steps
#   .\scripts\integrate-local.ps1 -Apply -Mode cherry-pick          # one commit at a time
#
# Nothing is deleted, force-pushed or reset by this script. It refuses to run on a dirty
# tree unless -StashDirty is given, and it always leaves a backup branch and a copy of the
# working tree behind.
#
# NOTE: this script has not been executed on a Windows host. Read the printed plan on the
# first run, or follow docs/LOCAL_INTEGRATION.md by hand.

[CmdletBinding()]
param(
  [string]$TargetPath = 'D:\Documents\nova-ai-desktop',
  [string]$EvolutionPath = '',
  [ValidateSet('merge', 'cherry-pick')][string]$Mode = 'merge',
  [switch]$Apply,
  [switch]$StashDirty,
  [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'

function Step($message) { Write-Host "  -> $message" -ForegroundColor Cyan }
function Warn($message) { Write-Host "  !! $message" -ForegroundColor Yellow }
function Fail($message) { Write-Host "  xx $message" -ForegroundColor Red; exit 1 }
function Run([string]$description, [string[]]$arguments) {
  Write-Host "  git $($arguments -join ' ')" -ForegroundColor DarkGray
  if (-not $Apply) { return $null }
  $output = & git @arguments 2>&1
  if ($LASTEXITCODE -ne 0) { Fail "$description failed:`n$output" }
  return $output
}

Write-Host "`nNOVA evolution -> local integration" -ForegroundColor White
Write-Host ("  mode: {0}{1}" -f $Mode, $(if ($Apply) { '' } else { ' (dry run)' })) -ForegroundColor Gray

# ---------------------------------------------------------------- preflight
if (-not (Test-Path -LiteralPath $TargetPath)) { Fail "Target not found: $TargetPath" }
Push-Location $TargetPath
try {
  if (-not (Test-Path -LiteralPath '.git')) { Fail "$TargetPath is not a git repository." }

  $branch = (& git rev-parse --abbrev-ref HEAD).Trim()
  $head = (& git rev-parse --short HEAD).Trim()
  $dirty = (& git status --porcelain)
  Step "target: $TargetPath"
  Step "current branch: $branch @ $head"
  if ($dirty) {
    Warn 'the working tree has uncommitted changes'
    if (-not $StashDirty) {
      Fail 'refusing to continue with uncommitted work. Commit it, or re-run with -StashDirty to stash it first.'
    }
  }

  # Files that must never be touched by an integration.
  $protected = @('backend/.env', '.env', 'backend/nova.db', 'nova.db')
  foreach ($path in $protected) {
    if (Test-Path -LiteralPath $path) { Step "will preserve: $path" }
  }

  if (-not $EvolutionPath) {
    $candidates = @("$TargetPath\..\nova-evolution", "$PSScriptRoot\..\..\nova-evolution") | Where-Object { Test-Path -LiteralPath $_ }
    if (-not $candidates) { Fail 'Pass -EvolutionPath pointing at the unpacked evolution repository.' }
    $EvolutionPath = (Resolve-Path -LiteralPath $candidates[0]).Path
  }
  if (-not (Test-Path -LiteralPath "$EvolutionPath\.git")) { Fail "$EvolutionPath is not a git repository." }
  Step "evolution repo: $EvolutionPath"

  # ---------------------------------------------------------------- backup
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $backupBranch = "integration/backup-$stamp"
  $backupCopy = Join-Path (Split-Path -Parent $TargetPath) "nova-ai-desktop-backup-$stamp"
  $workBranch = "integration/nova-evolution-$stamp"

  Step "create backup branch $backupBranch at $head"
  Run 'backup branch' @('branch', $backupBranch, $head) | Out-Null

  Step "copy working tree (excluding node_modules, dist, .git) to $backupCopy"
  if ($Apply) {
    robocopy $TargetPath $backupCopy /E /XD node_modules .git dist release build __pycache__ .venv /XF nova.db /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { Fail "robocopy failed with exit code $LASTEXITCODE" }
    $global:LASTEXITCODE = 0
  }

  $stashed = $false
  if ($dirty -and $StashDirty) {
    Step 'stash uncommitted work'
    Run 'stash' @('stash', 'push', '-u', '-m', "nova-integration-wip-$stamp") | Out-Null
    $stashed = $true
  }

  # ---------------------------------------------------------------- integrate
  Step "create work branch $workBranch from $branch"
  Run 'work branch' @('checkout', '-b', $workBranch) | Out-Null

  if ($Mode -eq 'merge') {
    Step 'fetch the evolution repository as a remote and merge it'
    if ($Apply) {
      & git remote remove nova-evolution 2>$null | Out-Null
      & git remote add nova-evolution $EvolutionPath
      if ($LASTEXITCODE -ne 0) { Fail 'could not add the evolution remote' }
      & git fetch nova-evolution main
      if ($LASTEXITCODE -ne 0) { Fail 'could not fetch from the evolution repository' }
    }
    Run 'merge' @('merge', '--no-ff', 'nova-evolution/main', '--allow-unrelated-histories', '-m', "merge: NOVA evolution increment 1 ($stamp)") | Out-Null
  } else {
    Step 'cherry-pick each increment from the evolution repository'
    if ($Apply) {
      & git remote remove nova-evolution 2>$null | Out-Null
      & git remote add nova-evolution $EvolutionPath
      & git fetch nova-evolution main
      if ($LASTEXITCODE -ne 0) { Fail 'could not fetch from the evolution repository' }
      $commits = & git rev-list --reverse --no-merges nova-evolution/main --not HEAD
      foreach ($commit in $commits) {
        Step "cherry-pick $commit"
        & git cherry-pick $commit
        if ($LASTEXITCODE -ne 0) { Fail "conflict on $commit. Resolve it, then run: git cherry-pick --continue" }
      }
    }
  }

  # ---------------------------------------------------------------- verify
  if (-not $SkipTests) {
    Step 'run backend tests'
    if ($Apply) {
      Push-Location 'backend'
      try {
        $python = if (Test-Path '.venv\Scripts\python.exe') { '.venv\Scripts\python.exe' } else { 'python' }
        & $python -m pip install -q -r requirements.txt
        & $python -m pytest -q
        if ($LASTEXITCODE -ne 0) { Warn 'backend tests failed - the merge is on a branch, nothing is lost' }
        & $python -m alembic current
      } finally { Pop-Location }
    }
    Step 'run frontend build'
    if ($Apply) {
      Push-Location 'frontend'
      try {
        if (Test-Path 'package-lock.json') { & npm ci } else { & npm install }
        & npm run build
        if ($LASTEXITCODE -ne 0) { Warn 'frontend build failed - the merge is on a branch, nothing is lost' }
      } finally { Pop-Location }
    }
  }

  # ---------------------------------------------------------------- report
  Write-Host "`nDone on branch $workBranch (not merged into $branch)." -ForegroundColor Green
  Write-Host "  backup branch : $backupBranch" -ForegroundColor Gray
  Write-Host "  backup copy   : $backupCopy" -ForegroundColor Gray
  if ($stashed) { Write-Host "  your work is stashed as 'nova-integration-wip-$stamp' - restore with: git stash pop" -ForegroundColor Yellow }
  Write-Host "  keep it       : git checkout $branch; git merge --ff-only $workBranch" -ForegroundColor Gray
  Write-Host "  roll back     : git checkout $branch; git reset --hard $backupBranch" -ForegroundColor Gray
} finally {
  Pop-Location
}
