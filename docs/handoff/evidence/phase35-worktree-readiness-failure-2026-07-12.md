# Phase 35 truthful worktree readiness failure handoff — 2026-07-12

## Outcome

Baton no longer swallows checkout creation failure into `null` and lets an adapter discover an
undefined path later. New-session readiness is a Coordinator-owned prerequisite. Both synchronous
throws and asynchronous rejections produce exactly one orchestrator-authored
`lifecycle.crashed` with fixed `phase: "worktree"`, `code: "worktree_unavailable"`, and fixed
non-leaking text. Task/run/route attribution stays intact and replay remains terminally failed.

The same rejecting readiness promise reaches the adapter, pending spawn is aborted, the private
runtime is removed, and new-task worktree ownership is reaped idempotently. A stop that already
owns the worker remains cancelled without a competing crash. Generic adapter spawn refusal also
reaps newly allocated task ownership but does not delete a resume-owned worktree. Mock waits for
readiness before announcing a worker turn or touching disk, and it does not duplicate the
Coordinator's typed failure as a worker crash.

## Verification

- WF1–WF6 coordinator/Mock failure, stop-race, and resume-ownership contracts: 4/4.
- Adapter/coordinator/Phase 10/10.1/governance focused gate: 154/154.
- Canonical owner-managed zero-quota suite: 824/824.
- `git diff --check`: clean.

## Recursive Baton evidence

`docs/reference/evidence/phase35-worktree-readiness-local-2026-07-12/` runs the public assembled
driver against Baton's actual dirty checkout—the condition that first broke Phase 34 dogfood. All
12 checks pass: dirty prerequisite present, failed terminal state, one typed fixed-message crash,
no worker turn/edit, no raw repository path, and absent worktree, metadata, runtime, and branch.
Only the sanitized authoritative crash event is retained in the evidence ledger.

The first evidence attempt caught two crash facts: the Coordinator's correct prerequisite failure
and Mock's later duplicate of the rejected promise. Mock now treats `worktree_unavailable` as
already owned by the Coordinator and emits no fabricated native lifecycle fact.

## Honest boundary

This phase does not auto-stash a dirty checkout, retry Git, launch a provider, expand repository
scope, or claim that every possible filesystem failure is recoverable. It establishes truthful
failure and complete ownership cleanup. External Quartermaster vetting and the full preserved
capability/system backlog remain next. No homelab integration is introduced.
