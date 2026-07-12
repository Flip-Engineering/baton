# Phase 23 — operational-log failure emergency reap

This interstitial safety contract was produced by recursive Baton dogfooding before the R4 design
gate. It does not weaken the append-only operational log or allow ordinary work to proceed after
authoritative storage fails.

## ER1 — poison remains fail-closed

An authoritative operational-log or coordination write failure poisons the coordinator. Every
ordinary public command continues to fail with the original typed integrity error. No result,
task transition, or stop event may be fabricated after the failure.

## ER2 — callback failure is contained

An adapter event that encounters poisoned storage cannot escape as an uncaught exception or an
unhandled runner promise rejection. The original fatal error remains observable to the owner.

## ER3 — emergency authority is stop-only and explicit

Only `kill(worker, actor, { emergency: true })` may cross the poisoned boundary. It cannot send,
resume, verify, integrate, publish, answer, or mutate durable state. A normal kill remains refused.

## ER4 — confirmation precedes cleanup

Emergency kill calls the attached adapter and waits for its native `kill.confirmed` event. Only
then may Baton mark the in-memory handle dead and remove the runtime scope and task worktree. The
result is explicitly `confirmed_unlogged` with `auditUnavailable: true`; it is never an ordinary
logged confirmation.

## ER5 — timeout is honest

If native confirmation does not arrive within the deployment stop deadline, emergency kill
returns `confirmation_timeout_unlogged`, leaves worktree ownership intact, and does not claim the
process is gone. Repeated emergency kill joins the same in-flight stop.

## ER6 — recursive proof runner failure is owned

Every long-lived runner task attaches its rejection handler immediately. Its `finally` requests
normal kill first and explicit emergency kill after storage poison. Success evidence requires
normal durable kill/reap; an emergency result is recorded as degraded evidence, never a pass.

## Acceptance

A red regression injects an operational append failure after a worker is live, proves ordinary
commands and ordinary kill fail closed, then proves explicit emergency kill receives native
confirmation and removes the owned worktree without creating a post-failure log event. A timeout
regression proves ownership is retained when confirmation never arrives.
