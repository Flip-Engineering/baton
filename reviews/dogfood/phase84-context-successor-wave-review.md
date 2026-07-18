# Phase 84 context successor-wave review

Reviewed only `impl/src/coordination-store.mjs` bytes 344064–356352 from immutable partition `context-partition:caff0d9974c0626fd3bce62e4c2f2c1e3dc418f3b7087001d8e77767ae313f8c` (content digest `d076a6321cd827ebc3a8b2862d3c7c973e4ee68dbff9afaaa84fb35fae00c418`).

## Finding: failed and cancelled tasks cannot preserve resource-release truth

**Severity: High — stop/reap and cleanup settlement**

`_validateTaskResourceReleasePayload` rejects a release unless `task.status === 'completed'`, even though the same predicate also binds the release to an already-terminal `taskVersion`, `terminalEvent`, assignee, and run. This status check occurs before mapped operational evidence is evaluated, so cleanup evidence for a failed or cancelled terminal task is refused as a stale target regardless of its validity.

The remainder of the validator demonstrates that this record is cleanup truth rather than result acceptance: it requires all release checks to be true, an absent worktree and runtime, a detached or historical session with recovery closed, and either a never-started process or an exact start/terminal lifecycle. It also binds the event to policy authority and `task.resources_released:<taskId>:<terminalEvent>`.

The consequence is visible at the start of `_normalizeContextMapCleanupReceipt`: cleanup targets are derived with `_taskResourceReleases.get(child.taskId)`. A failed or cancelled child can require exactly the same process, runtime, session, and worktree cleanup as a completed child, but this validator cannot produce its durable release record. Operational cleanup may have happened, yet the coordination store cannot preserve that exact cleanup fact for the receipt. Keeping the separate context-settlement rule that only a completed child may contribute an accepted result does not require discarding cleanup truth for other terminal states.

**Recommended correction:** admit resource-release evidence for any `TERMINAL` task while retaining the existing exact version, terminal-event, worker, run, evidence, lifecycle, digest, and policy-authority checks. Continue to reject failed or cancelled children as accepted context-map results. Add coverage showing that valid release evidence for failed and cancelled tasks is recorded, nonterminal tasks remain ineligible, and cleanup admission does not change result settlement.
