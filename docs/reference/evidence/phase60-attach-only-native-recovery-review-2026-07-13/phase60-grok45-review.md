## Verdict

**PASS.** At tree `915ae2f` (worktree clean), Phase 60 attach-only native recovery matches `spec/phase60/attach-only-native-recovery.md` for concurrent recovery authority, process-generation correlation, interrupt/kill, and exact group reap. Store, coordinator, and Grok/Claude/Codex adapters implement NR1–NR6 without a confirmed P0/P1 defect in committed source. Fixture suites `phase60-coordination-recovery` and phase-11 recovery RED/NR paths exercise the durable order and fail-closed replay gates.

## P0-P1 findings

No P0 or P1 defects confirmed in committed source for the Phase 60 recovery slice.

**Grounded strengths (not defects):**

- **Grok attach-only (NR1–NR2):** `impl/src/grok-acp.mjs` refuses non-resume `attachOnly` before child creation; resume uses `session/load` and refuses missing/unequal `sessionId` without synthesizing identity; attach-only returns after one `lifecycle.spawned` and does not start a turn until later `prompt`.
- **Concurrent recovery authority (NR6):** `Coordinator.recover` coalesces identical in-flight attempts per worker and returns `recovery_conflict` on changed identity (`_recoveryAttempts`). Startup recovery is sequential under `SessionRecoverySupervisor` and gated by exclusive startup authority. Manual recovery cannot race a second live attempt with a different digest.
- **Durable order (NR3–NR4):** `_recover` orders recovery request → attach-only spawn/identity → atomic `createAndClaimRecoveryRefinement` → `recordRecoveryContinuationIntent` → dialect dispatch → accepted/refused disposition. Exceptions, timeouts, and turn facts without typed `notSent` stay `dispatch_unknown` and never auto-redeliver (`_recoveryDispatchRefusal`).
- **Process generation + exact reap (NR5):** Generation is incremented and passed into adapter spawn; `process-lifecycle.mjs` correlates start/close/ready/reap-unconfirmed payloads; adapters call `reapOwnedProcessGroup` and emit `kill.confirmed` only after confirmed group ESRCH. Stale PID signalling is out of scope of ordinary group kill on owned generation.
- **Store integrity:** `CoordinationStore` atomic create+claim and refusal batches fail closed on torn newline-complete pairs (`recovery_batch_integrity`); contradictory operational evidence cannot prove `not_sent`.

**Retained later scope (not Phase 60 defects):** exactly-once provider delivery, treating local Ack as provider acceptance, in-flight native-turn recovery, public attach-only authority, and the NR4 operator resolution command. Graph-backed representations and goal/plan web authority remain Phase 61/62 (commit message at `915ae2f`).

**Non-blocking residual:** full NR7 “all three adapters + every crash boundary” matrix is distributed across `phase60-coordination-recovery`, `phase11-persistent-sessions`, and adapter unit tests rather than one monolithic file; coverage is present for the critical gates, not absent.

## Required corrections

None required for Phase 60 PASS at this revision. Do not expand this slice into Phase 61/62 representation or goal/plan authority work under the Phase 60 label.