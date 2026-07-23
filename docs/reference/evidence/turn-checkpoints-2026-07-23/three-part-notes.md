## 1. the trap

Turn-based gating treated every `lifecycle.turn_completed {status:'completed'}` event as an automatic result claim, so ordinary pauses for thought, tools, or test suites immediately entered the trust gate and could be killed as `required_effect_absent`; only a literally pending blocking interaction record escaped that behavior.

## 2. decisions

The decision channel lets a worker block on a bounded option set, with an explicit free-response escape, while the orchestrator supplies the authoritative settlement exactly once; its durable lifecycle is expressed by `decision.requested`, `decision.settled`, and `decision.expired`, and an expired or stale-discarded request must never masquerade as an applied answer.

## 3. objects

The REPL layer is a read-eval-print loop over immutable, content-addressed cells that can be named, composed, and cited by digest, not a general code runtime; its concrete ceiling is the closed whitelist of 14 pure operations and four predicates, with effectful work remaining successor-Plan-gated.

## 4. memory

Baton divides knowledge into an ephemeral task horizon, a run-scoped workflow horizon, and the repo-scoped persistent Cairn project horizon, with explicit promotion between them; the governing persistence rule is that task knowledge dies with its task unless it is promoted before close, while project promotion requires an orchestrator-admit gate.

## 5. manifests

A `ReplManifest` is a distinct, content-addressed manifest whose authority comes from the durable `repl.manifest_admitted` event, not from a caller-provided owner field: shared manifests require a live orchestrator lease pinned to the manifest’s run, while `worker:<id>` manifests are accepted only when the store matches that role to the wrapper-derived worker identity.

## 6. steering

On a paused turn, `nudge` admits a fresh turn on the same task, bumps the turn fence, clears the budget stop, and re-arms the watchdog; `wait` records `turn.wait_noted` without consuming the pause, while `claim` runs the live trust gate to a `completed` or `failed` result, and only nudge and claim reserve the pause’s single-consumer state.
