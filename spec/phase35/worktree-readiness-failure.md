# Phase 35 — truthful worktree readiness failure

## WF1 — coordinator-owned prerequisite

New-session checkout creation is an orchestrator prerequisite. Synchronous throws and asynchronous
rejections are normalized through one readiness promise before any worker may touch disk.

## WF2 — typed durable truth

A readiness failure emits exactly one `lifecycle.crashed` with `phase: worktree`, fixed
`code: worktree_unavailable`, and fixed non-leaking error text. It terminalizes the task as failed
and replays identically. Adapter fallback/refusal cannot relabel it as a spawn failure.

## WF3 — no worker effect

The readiness promise delivered to the adapter rejects. Conforming adapters create no child,
session, turn, file edit, or provider spend after that rejection. The Mock adapter waits before its
worker `turn_started` fact and never falls through to an undefined path.

## WF4 — complete cleanup

The pending spawn signal is aborted, the private runtime scope is removed, and new-task worktree
ownership is reaped idempotently even when creation failed after a partial side effect. A resume
context is not deleted by an unrelated adapter refusal.

## WF5 — stop race

If interrupt/kill already owns the worker when readiness fails, cancellation remains terminal and
no crash is appended. Cleanup still runs. This preserves the existing two-phase stop fence.

## WF6 — boundary

Raw checkout errors, repository paths, Git stderr, credentials, and host details do not enter the
durable operational event. This repair adds no retry, stash, authority expansion, or homelab path.
