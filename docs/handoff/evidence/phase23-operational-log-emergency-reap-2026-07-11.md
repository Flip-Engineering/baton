# Phase 23 operational-log emergency reap evidence — 2026-07-11

## Outcome

Two concurrent exact-model Grok workers were launched through Baton to shape the R4 IR rung. The
host crossed ENOSPC while adapter events were being appended to the authoritative operational
log. The coordinator correctly poisoned ordinary authority, but the review runner's approval pump
observed that poison through `list()` and rejected before a handler was attached. Node surfaced
the original integrity error as an unhandled rejection, so the runner's `finally` did not execute.

Both native Grok processes nevertheless exited when their transport parent closed. Their two task
worktrees, branches, runtime homes, metadata, and detached parent worktree were then explicitly
removed and Git-pruned. A second bounded attempt reproduced the same failure and was likewise
fully reaped. Neither attempt is claimed as a review or a pass.

ER1–ER6 adds the missing degraded cleanup authority without weakening log truth. Ordinary
commands, including ordinary kill, still throw the original typed poison. Only
`kill(worker, actor, { emergency: true })` may cross that boundary. It sends no work, mutates no
durable task state, and writes no invented event. It waits for the adapter's native
`kill.confirmed`, then removes runtime/worktree ownership and returns
`confirmed_unlogged` with `auditUnavailable: true`.

If confirmation does not arrive before the deployment stop deadline, Baton returns
`confirmation_timeout_unlogged`, keeps ownership intact, and does not claim the process is gone.
The proof runner now attaches its pump rejection handler immediately, records the poison, and
falls back to explicit emergency kill only in its cleanup path. Any emergency result keeps the
evidence gate red.

## Validation

- Numbered contract: `spec/phase23/operational-log-emergency-reap.md`.
- Injected post-spawn operational-log poison: normal command and normal kill refuse; explicit
  emergency kill confirms and reaps without a forged log event.
- Injected missing confirmation: timeout remains degraded and the worktree-removal count stays
  zero.
- Surrounding Phase 11 coordination/control gate: 46/46.
- Canonical owned suite: 735/735; suite root reaped.

## Host finding

The workspace volume was at effectively zero reserve. A read-only audit found 2,012 stale
`baton-*` temporary roots and removed only those lifecycle-owned artifacts after verifying no
active Baton/Grok process. APFS reclaimed little immediately because multiple unrelated live
Codex processes retain one deleted 260 MB runtime binary; those processes were not killed. The R4
review runner therefore also has a configurable free-space preflight, but preflight is defense in
depth rather than a replacement for emergency reap under changing host pressure.

## Honest boundary

`confirmed_unlogged` is physical cleanup evidence returned to the live owner, not durable replay
truth. Restart reconciliation still treats the last durably claimed task as failed. Emergency
kill cannot make progress, verify, accept, integrate, publish, or repair storage; restart/replay is
required after cleanup.
