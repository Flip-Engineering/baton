# Phase 86 liveness rerun — orchestrator assessment

## Trusted result and cleanup

The bounded reflexive rerun succeeded through Baton on the exact requested route:

- Run `run-dbe275e23261e7b1ba5d9815bc2dcf4b`
- worker `w-4`
- requested route `glm / glm-5.2 / xhigh`
- resolved harness `glm@claude-code-2.1.211+zai-anthropic`
- provider-observed model `glm-5.2`
- preserved result commit `e5f4fd27469b6eed175103aea1d213fd81ccb6c8`

The durable stop receipt at coordination event 88 records `remainingCount: 0`,
`killConfirmed: 1`, `processesObserved: 1`, `processesClosed: 1`, dispatch closed,
interactions resolved, and Run authority released. Application close then reported zero workers and
`closed: true`. The runner's compact JSON projected the returned stop view as null fields, so the
durable receipt—not those lossy runner fields—is the authoritative stop/reap evidence.

## Review disposition

The GLM report correctly distinguished fail-fast detection from OS containment and confirmed the
sticky-loss, single-event, post-loss-output rejection, and terminal-close properties. It also
identified an ordering defect: authority loss while a soft interrupt was already in flight did
not immediately escalate that waiter to a kill.

The coordinator now calls the existing `_beginStop(..., 'kill')` escalation path for a stopping
worker after authority loss. A deterministic test starts a wedged soft interrupt, removes
worktree availability, proves exactly one adapter kill, delivers `kill.confirmed`, and proves the
original interrupt waiter settles. Focused coordinator validation is 56/56 and the broad
integration batch is 76/76 after the correction.

## Dogfood AX findings retained

The rerun also exposed two application-level frictions that are not liveness defects:

1. the recipient spent many provider turns rediscovering the exact narrow verification command
   even though that command existed in Plan/Brief authority; recipient guidance must present the
   executable verification instruction directly and prominently; and
2. the original process exposed no authenticated attach coordinate, so the outer orchestrator
   could observe durable logs but could not semantically tell the active Run to conclude through
   Baton.

These findings remain in the integrated goal. The attach slice must reuse the resident Web command
bus and semantic Run actions rather than add another ledger or raw worker/PID control surface.
