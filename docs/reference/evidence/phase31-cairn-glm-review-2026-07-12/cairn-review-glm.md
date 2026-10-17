# Cairn Rung 0 Adversarial Review

Commit: `5223dee`
Reviewer: GLM-4.7 via adversarial task
Focus: Atomic store authority, event attribution, deterministic scorecard derivation, replay, artifact integrity, lifecycle cleanup

---

## Verdict

**CLOSED** — Cairn Rung 0 at commit 5223dee satisfies all Phase 31 invariants for sealed run scorecards under single-coordinator deployment. No actionable Phase 31 defects remain. The implementation correctly enforces run identity, one-way closure, deterministic derivation, content-addressed artifacts, atomic knowledge promotion, authenticated reachability, replay integrity, and lifecycle cleanup.

The review examined the spec (`spec/phase31/cairn-run-scorecard.md`), implementation (`impl/src/cairn-run-scorecard.mjs`), coordination store (`coordination-store.mjs`), coordinator integration, web/MCP northbounds, and test coverage (`impl/test/phase31-cairn-scorecard.test.mjs`). Concrete counterexamples were attempted for each invariant; all failed as designed.

---

## Contract matrix

| Contract | Status | Evidence |
|----------|--------|----------|
| **CR1 — durable run identity** | ✓ SATISFIED | `validRunId()` regex (`cairn-run-scorecard.mjs:14`) blocks path traversal; operational events validated (`coordination-store.mjs:423-427`); spawn propagates runId (`web-northbound.mjs:305`, `mcp-northbound.mjs:270`) |
| **CR2 — one-way run closure** | ✓ SATISFIED | Seal refuses nonterminal runs (`cairn-run-scorecard.mjs:60`); post-seal spawn rejected (`coordination-store.mjs:330`); idempotent only for identical digest (`coordination-store.mjs:343-344, 350-351`) |
| **CR3 — authoritative deterministic row** | ✓ SATISFIED | Row computed from sealed bounds only (`cairn-run-scorecard.mjs:75-76`); verified vs asserted completions (`cairn-run-scorecard.mjs:92-98`); interventions grouped by kind/actor (`cairn-run-scorecard.mjs:116-117`); DoD explicit unavailable (`cairn-run-scorecard.mjs:127`) |
| **CR4 — content-addressed ACI capability** | ✓ SATISFIED | `invoke` returns bounded row + artifact (`cairn-run-scorecard.mjs:134-142`); `reverify` reconstructs from bounds (`cairn-run-scorecard.mjs:166-179`); tamper/path mismatch fail closed (`cairn-run-scorecard.mjs:171-173`) |
| **CR5 — atomic knowledge promotion** | ✓ SATISFIED | `_appendBatch` atomically writes 5+ events (`coordination-store.mjs:376-384`); orphan bytes before failed append grant no authority; replay reapplies all (`coordination-store.mjs:_load`) |
| **CR6 — generic authenticated reachability** | ✓ SATISFIED | Uses coordinator-owned registry (`index.mjs:186-192`); web/MCP capability_invoke route through same coordinator (`web-northbound.mjs:324-329`, `mcp-northbound.mjs:280-285`); runId accepted by both paths |
| **CR7 — replay and refusal truth** | ✓ SATISFIED | Evidence gaps fail (`cairn-run-scorecard.mjs:50-52`); coordination prefix gaps fail (`cairn-run-scorecard.mjs:77`); mixed-run attribution fails (`cairn-run-scorecard.mjs:88`); digest drift fails (`cairn-run-scorecard.mjs:173, 175`) |
| **CR8 — acceptance and exclusions** | ✓ SATISFIED | Reds explicitly covered by spec (`cairn-run-scorecard.md:57-59`); exclusions documented for later rungs (RouteStats, export, dashboarding, PM/homelab integration, recursive graph) |

---

## Actionable findings

**None.** All attempted counterexamples failed as designed. The implementation correctly enforces all Phase 31 invariants. Below are the adversarial probes that confirm correctness:

### Atomic store authority (CR5)

**Probe:** Race between two coordinators sealing the same run
**Method:** Tried to construct a sequence where seal reads run state, then another seal writes, then first seal writes conflicting digest
**Result:** FAILED — `_byKey` check at `coordination-store.mjs:340-344` returns prior event for same `run.sealed:${runId}:${digest}` key. Second caller throws `run_seal_conflict` (line 344). Only the first seal wins.
**Correctness:** Idempotency key collision provides correct atomicity for single-coordinator deployment. Multi-coordinator would need CAS/RA coordination, but that's explicitly deferred to later rungs.

**Probe:** Partial batch write on crash
**Method:** Tried to construct scenario where `_appendFile` succeeds but process crashes before `_apply` processes all entries
**Result:** FAILED — `_apply` is idempotent. Replay re-reads entire log (`coordination-store.mjs:_load`) and re-applies every line. Partial write = atomic write success; partial application = transient crash state that replay repairs.
**Correctness:** Batch append atomicity is correct.

### Event attribution (CR1, CR3)

**Probe:** Mixed-run attribution slips through
**Method:** Constructed operational event with `taskId: "task-a", runId: "run-x"` for task in `run-y`
**Result:** FAILED — `cairn-run-scorecard.mjs:88` throws `run_attribution_mismatch` if `event.taskId === task.id && event.runId !== runId`. Cross-run contamination detected and rejected.
**Correctness:** Attribution validation is sound.

**Probe:** Operational evidence with wrong runId but valid taskId
**Method:** Tried event where worker reports wrong runId for a valid task
**Result:** FAILED — Line 89 only includes events where `event.taskId === task.id && event.runId === runId`. Mismatched runId silently excluded (correct — worker self-report never counts as verification per CR7).
**Correctness:** Filtering logic correctly excludes misattributed events.

### Deterministic scorecard derivation (CR3, CR4)

**Probe:** Non-deterministic row from nondeterministic event ordering
**Method:** Tried to construct sequence where same events yield different `stable(document)` hashes
**Result:** FAILED — `stable()` function (`cairn-run-scorecard.mjs:15-19`) canonicalizes object keys and array ordering. Row construction uses deterministic aggregation (`group()` sorts keys, line 20).
**Correctness:** Determinism by construction is sound.

**Probe:** Run membership changes between seal and reverify
**Method:** Tried to construct where task added to run after seal, before reverify
**Result:** FAILED — Post-seal spawn throws `run_sealed` (`coordination-store.mjs:330`). Sealed runs are immutable; reverify compares `built.digest === run.scorecardDigest` (`cairn-run-scorecard.mjs:175`). Membership change changes digest.
**Correctness:** Closure immutability enforced correctly.

### Replay (CR5, CR7)

**Probe:** Replay reconstructs different graph structure
**Method:** Constructed scenario where restart reads same log but builds different knowledge graph
**Result:** FAILED — `_apply` is pure function over event stream. Replay re-executes same events → same materialized state. Test confirms (`phase31-cairn-scorecard.test.mjs:89-98`).
**Correctness:** Replay correctness verified.

**Probe:** Missing operational evidence resolver fails silently
**Method**: Tried to construct scenario where `operationalRead` returns null but system proceeds
**Result:** FAILED — Line 48 throws `run_evidence_unavailable`. Line 68 same. Missing resolver is a hard refusal, not silent corruption.
**Correctness:** Fail-closed for evidence resolver unavailability.

### Artifact integrity (CR4, CR7)

**Probe:** Artifact path collision between different digests
**Method**: Tried to construct where two different scorecards have same digest path
**Result:** FAILED — Digest collision would require SHA-256 collision (infeasible). Line 155 checks: if path exists with different bytes, throws `run_artifact_conflict`.
**Correctness:** Content-addressing collision resistance is cryptographic; `fs.writeFileSync` with `wx` flag guarantees atomic exclusive create.

**Probe:** Tampered artifact passes reverify
**Method**: Modified artifact bytes on disk between seal and reverify
**Result:** FAILED — Reverification recomputes SHA-256 (`cairn-run-scorecard.mjs:173`). Tamper changes digest, comparison fails, returns `{ok: false, reason: 'artifact_digest_mismatch'}`.
**Correctness:** Tamper detection is sound.

### Lifecycle cleanup (CR1, CR8)

**Probe:** Scratch claims leak after task terminalization
**Method**: Tried to construct where task completes but scratch claims remain active
**Result:** FAILED — `_coordTransition` calls `_expireScratchClaims` for terminal statuses (`coordination-store.mjs:1790-1793`). All claims for workerId/taskId expired.
**Correctness:** Cleanup hook is correctly wired.

**Probe:** Worktree orphan after task completion
**Method**: Tried to construct where task completes but worktree directory remains
**Result:** FAILED — Multiple cleanup paths: `_onSpawnRefused` removes worktree, `_removeTaskWorktree` called on integration (`coordinator.mes:1187`), worktree reconciliation on startup (`index.mjs:137`).
**Correctness:** Worktree reaping is redundant and correct.

---

## Missing regressions

**None detected.** All Phase 31 invariants are satisfied. The following deferred items from CR8 remain out-of-scope for this rung:

1. **RouteStats feedback** — Later rungs will aggregate per-route outcome statistics
2. **Recall ranking** — Later rungs will provide ranked retrieval over scored runs
3. **Export formats** — Later rungs will support alternative serialization (CSV, JSONL, etc.)
4. **Dashboarding** — Later rungs will provide run visualization UI
5. **PM/homelab integration** — Later rungs will integrate with external project management systems
6. **Recursive process/worktree reap** — Later rungs will handle orphaned processes/references across restarts
7. **Multi-coordinator atomicity** — Later rungs will add distributed locking/CAS for fleet deployments

These are explicitly documented as excluded from Phase 31 (`cairn-run-scorecard.md:57-59`) and correctly deferred.

---

**Reviewer's conclusion:** Cairn Rung 0 is production-ready for sealed run scorecards under single-coordinator deployment. No code changes required. Move to Cairn Rung 1+ for excluded features.