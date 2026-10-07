# Phase 11 governance evidence

Date: 2026-07-11

Scope: GV1-GV7 in `spec/phase11/governance.md`.

## Implemented boundary

- Claude result usage, Codex cumulative token snapshots, and Grok per-prompt metadata expose one
  canonical additive token/USD event contract while retaining raw accounting.
- Handles accumulate authoritative usage. Cumulative repeats and restart/resume baselines cannot
  double count; counter reset is conservative and never creates negative credit.
- 50/80/100% token-or-USD thresholds are durable policy facts. The hard threshold invokes normal
  confirmed two-phase kill and replay restores usage/threshold state.
- Mechanical watchdog rules act exactly once per turn: quiet working turns interrupt, three
  identical completed failures interrupt, and confirmed out-of-scope edits kill. Empty scope means
  unscoped; absolute paths are relativized only when they belong to the worker worktree.
- `createDriver()` creates a private per-worker home/tmp/vendor-config tree, strips ambient secret,
  provider, proxy, and code-injection environment variables, and passes a full replacement env.
  Credentials enter only through explicit env/file projection; logs contain key/file names and
  posture, never values. Confirmed/forced stop and crash reap the runtime scope.
- Codex turns receive native workspace-write plus network-deny policy. Grok starts with the native
  workspace sandbox profile. Claude receives an isolated settings file with its sandbox enabled
  and unsandboxed command/network escalation denied. Cards distinguish verified/native posture
  from configured-but-unverified controls.

## Validation

- Focused governance/runtime suite: 13/13 passing.
- Adapter/model/governance selection: 83/83 passing.
- Bare `node --test` from `impl/`: 486/486 passing, 0 failed.
- `git diff --check`: clean.

## Provider-backed boundary

`docs/reference/evidence/phase11-grok-governance-2026-07-11/run.mjs` passed all 16 checks against
Grok 0.1.216. It presence-checked (never read/logged) the existing Grok credential and projected
only `auth.json` into PID 31942's private mode-0700 `$HOME/.grok` with a mode-0600 credential file.
The native `workspace` sandbox denied an intentional `touch` outside the worker worktree with
`Operation not permitted`; the forbidden path remained absent. The exact requested model
`grok-composer-2.5-fast` then reported a canonical 11,811-token delta. Baton's deliberately tiny
one-token limit emitted the 50/80/100% threshold facts and automatically entered confirmed policy
kill. No verification verdict was fabricated for the killed task. Independent postconditions
proved the PID, runtime scope, task worktree, metadata file, and task branch absent. The credential
source path and value are absent from the raw event ledger.
