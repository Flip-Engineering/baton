# ROW BRIEF — the #229 bus-deadlock remediation contract

Deliverable: contract-bus-deadlock.md — NORMATIVE (no implementation).

## Ground to read first

- Issue #229 + its operator-escalation comment (the three legs, in priority order).
- impl/src/web-northbound.mjs — the serial command admission/dispatch path; reconcile
  long-polls (the prime suspect: a wedged reconcile holding the loop is invisible).
- impl/src/application-cli.mjs reconcile() — the client half of the long-poll.
- Tonight's measured fingerprint (from the issue): TCP accepts, HTTP never answers,
  process alive at idle CPU, restart is the only recovery, three occurrences at ≥4 waves.

## The contract must specify (closed, testable) — one section per leg

### LEG 1 — No single await chain owns the bus
Every long-running await in the web path is classified: admission (must be fast, bounded by
its OWN fairness budget), reconcile (long-poll, cancellable per LEG 2), read (never blocks
admission). The invariant: a readiness GET answers while ANY mix of reconciles and member
traffic is in flight — the red-first pin: a fixture resident serving 4+ concurrent member
drives answers /readyz within a measured window; today's HEAD wedges it (or the fixture
names why it cannot reproduce, which narrows the suspect).

### LEG 2 — Reconcile long-polls are cancellable and caller-bounded
A reconcile carries its client's declared patience (never a default-forever); cancellation
releases its loop slot on client disconnect OR patience expiry — and patience expiry is
TRANSPORT fairness (a new admission slot), never a member/work fate decision (the #163 law
is untouched: no work is killed by this; only the HTTP wait ends, reconcilable by idempotency
key). Named refusal/timeout code; idempotent re-entry contract.

### LEG 3 — Await-trace: wedges are diagnosable from the ledger
Every long-await entry/exit in the web path mints a bounded ledger event (holder identity,
commandId, start seq) — the next wedge's holder is readable from the store, not lsof
archaeology. Bounded: ring-buffered or capped per-holder; no unbounded event growth (#223).

## Hard bounds
Contract only; every invariant testable; NO clocks deciding work fate (transport fairness
only); cite the motivating measurement per section; refusal codes named.
