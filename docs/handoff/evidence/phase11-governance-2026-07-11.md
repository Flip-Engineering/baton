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

Pending execution of
`docs/reference/evidence/phase11-grok-governance-2026-07-11/run.mjs` after the implementation
commit. It presence-checks (never reads/logs) the existing Grok credential, projects only that
file into a private runtime home, runs the native workspace sandbox, proves canonical usage and an
automatic one-token hard-budget kill, then checks process/worktree/runtime/metadata/branch reap.
