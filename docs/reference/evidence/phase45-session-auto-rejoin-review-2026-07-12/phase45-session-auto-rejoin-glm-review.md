# Phase 45 Supervised Startup Session Auto-Rejoin — Adversarial Review

## Verdict

**APPROVED with noted observation**. The supervised startup session auto-rejoin implementation (commit 56b2363) correctly fulfills SR1-SR10. Readiness fencing, eligible-set bounds, exact worktree/runtime preservation, identity/context/model/effort binding, degraded-versus-failed distinction, and complete lifecycle management are all present and correct. The implementation properly distinguishes opt-in terminal-session auto-rejoin from unimplemented in-flight turn continuation, and fixture crash simulation is handled honestly without homelab integration.

## P0-P1 findings

**No P0 or P1 defects found.** The implementation correctly:

* **SR1 (Explicit deployment authority):** `session-recovery-supervisor.mjs:14-18` validates exact bounded `maxSessions`, `maxStateRows`, `timeoutMs` with hard caps; no web/MCP/environment switches exist.
* **SR2 (Readiness barrier):** `coordinator.mjs:574-577` installs `session_recovery_pending` fence; `index.mjs:206,~310` wires supervisor startup before `ready` promise resolution; ordinary commands refuse until scan settles.
* **SR3 (Closed eligible set):** `coordinator.mjs:591-596` filters only `orphaned` handles with `native` persistence, existing task, and adapter declaring `resume` support; `session-recovery-supervisor.mjs:35` rejects `candidates.length > maxSessions` rather than silently truncating.
* **Exact preservation:** `coordinator.mjs:559-565` preserves exact worktree and runtime homes for eligible workers before fresh handshake; unsupported leftovers are still reaped via existing paths.
* **SR4 (Recovery trust gate):** `coordinator.mjs:1220-1350` reuses exact `recover()` transaction; validates context ownership, passes persisted model/effort to adapter, and requires native handshake to return identical session ID (`line 1289-1297`); refinement task created before authority visible.
* **SR5 (Honest partial failure):** `session-recovery-supervisor.mjs:43` throws `coordination_write_unavailable` to fail readiness (not degrade); `lines 46-47` collect individual failures and return `degraded` status for mismatch/exception/timeout.
* **SR6 (One supervisor, no duplicate attempt):** `session-recovery-supervisor.mjs:23-28` makes `start()` idempotent; `coordinator.mjs:37-47` runs sequential scan; manual `recover()` gated behind `startup` flag (`line 1221-1223`).
* **SR7 (Lifecycle/close):** `session-recovery-supervisor.mjs:64-68` kills and reaps exactly `_attached` workers; idempotent close; `coordinator.mjs:1884-1889` allows emergency kill during startup with authority bypass.
* **SR8 (Compatibility):** `index.mjs:198-206` validates only when `sessionRecoveryPolicy` present; absent policy retains synchronous close and manual recovery; provider polling defers to session readiness when both configured (SR8 second sentence, though provider supervisor startup ordering is not exercised in evidence).

## Required red tests

Existing red tests (`impl/test/phase45-session-auto-rejoin.test.mjs`) already cover the required adversarial gates:

* **SR1/SR8:** Public driver policy validation and `closeAsync()` requirement (`test lines 64-69`)
* **SR2/SR3:** Capacity refusal (`maxSessions + 1`) without prefix attempt (`test lines 43-46`)
* **SR2/SR5:** Coordination write loss fails readiness (`test lines 53-56`)
* **SR5/SR7:** Close during bounded attempt skips suffix and reaps attached (`test lines 48-51`)
* **SR2:** Readiness barrier blocks ordinary commands (`test lines 58-62`)
* **SR1/SR3/SR5/SR6:** Sequential scan, degraded results, idempotent start (`test lines 34-41`)
* **SR2-SR8:** Fixture restart with exact native session persistence, runtime preservation, refinement verification, and complete reap (`test lines 71-77`)

All spec-required red scenarios are evidenced; no additional red tests required.

## Observation

SR8's second sentence ("Provider polling/processing does not start until session readiness settles when both supervisors are configured") is implemented but not directly tested. The provider supervisor's tick check (`coordinator.mjs:~574-577`) would block, but the provider supervisor startup ordering itself is not verified in red evidence. This is a test coverage gap, not a defect.

## Implementation Fidelity

The implementation correctly distinguishes:
* **Implemented:** Opt-in terminal-session auto-rejoin with exact native session persistence, identity verification, and worktree/runtime preservation
* **Unimplemented:** In-flight turn continuation, vendor rewind/checkpoint depth, and provider-backed native resume proof (properly deferred to later phases per spec)

Fixture crash simulation (`test lines 71-77`) is honest: creates first driver, verifies native session, closes, replays from coordination, auto-rejoins through exact-identity handshake, verifies refinement, and confirms complete reap without claiming homelab or project-manager integration.