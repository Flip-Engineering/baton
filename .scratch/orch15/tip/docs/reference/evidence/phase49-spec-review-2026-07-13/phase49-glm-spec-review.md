# Phase 49 Cairn Selective Promotion — Adversarial GLM Spec Review

**Commit**: 43b64df  
**Reviewed**: 2026-07-13

## Verdict

**REVISE** — Three P0 defects and two P1 gaps block safe deployment. The closed candidate taxonomy has a bootstrapping circular dependency, the Scratch quarantine design lacks a release mechanism, and causal edge requirements are underspecified for Counterexamples.

## P0-P1 findings

### P0-1: Scratch promotion bootstrapping circular dependency

**Location**: SP3(4)

**Defect**: SP3(4) requires "every counted task has a live `verified_task_outcome` Finding." This creates a circular dependency: the first Scratch fact can never be promoted because no task yet has a `verified_task_outcome` Finding. Verification is async, so the system deadlocks at zero promotions.

**Failure Scenario**: At system start, a Scratch fact is read by 10 completed tasks. All lack `verified_task_outcome` Findings because verification hasn't completed. Promotion refuses permanently. The system never accumulates verified findings.

**Required Correction**: Replace with "every counted task is **terminal** (`completed`, `failed`, or `cancelled`) and has a **durable terminal event**." Verification status should affect Finding confidence/grounding, not candidacy.

---

### P0-2: Derived Scratch facts have no promotion path

**Location**: SP3 line 58 + coordination-repl.md §287

**Defect**: SP3 excludes "derived Scratch" from promotion. Coordination-repl.md §287 states derived facts "remain quarantined until an independent oracle links it," but Phase 49 defines no such oracle. Derived facts can never become Knowledge Graph nodes, making the Bench useless for SMT checking or formal methods.

**Failure Scenario**: A worker uses `bench_run` to check an SMT constraint. The result is `grounding:'derived'`. Phase 49 permanently excludes it. The fact never reaches the Knowledge Graph, so the fleet recomputes the same check on every relevant task.

**Required Correction**: Add a fifth candidate class: "`scratch.fact_posted` with `grounding:'derived'`, same `repoId`, at least `minScratchReaders` distinct completed tasks, **and** a `knowledge.promoted` Finding of kind `'FormalVerification'` or `'IndependentCheck'` that explicitly verifies the derived claim."

---

### P0-3: Causal edge requirements incomplete for Counterexample→Task

**Location**: SP3(3) + SP5

**Defect**: SP5 states "Counterexample → Task is `ObservedIn`" but this edge type is semantically wrong for counterexamples produced by task failure. The spec doesn't specify whether different `driver.kind` values should map to different edge types.

**Failure Scenario**: A `recovery.claimed_without_spawn` event promotes a Counterexample. The system creates a `Counterexample → Task ObservedIn` edge, but the counterexample was *produced by* the task, not merely observed in it. Recall queries traversing `ProducedBy` fail to find the originating task.

**Required Correction**: Replace with "Counterexample → Task is `ObservedIn` **or** `ProducedBy` depending on source kind: `integration.incomplete`, `integration.refused`, `publication.refused` → `ObservedIn`; `recovery.claimed_without_spawn` → `ProducedBy`."

---

### P1-1: Result exposes coordination timing side-channel

**Location**: SP8

**Defect**: SP8 exposes `{nodeId, type, trigger, sourceSeq}`. The `sourceSeq` field leaks absolute coordination timing, creating a side-channel for inferring operational cadence and failure rates.

**Failure Scenario**: An attacker observes `sourceSeq` clustering around specific ranges, revealing bursts of `publication.refused` events indicating a publication bug storm.

**Required Correction**: Replace `sourceSeq` with `relativeSeq = observedSeq - sourceSeq`. Keep absolute `sourceSeq` only in the durable receipt.

---

### P1-2: Closed candidate taxonomy missing intervention kinds

**Location**: SP3(2) + coordination-repl.md §8

**Defect**: SP3(2) accepts only `control.stop_requested`, `follow_up.requested`, `publication.authorized`, `publication.denied`. Coordination-repl.md §8 lists 7 intervention types. Phase 49 excludes `control.send`, `control.steer`, `control.nudge`, `control.interrupt_requested`, `kill.requested`, meaning orchestrator steering never creates Decision nodes.

**Failure Scenario**: An orchestrator issues `control.steer` to redirect a worker. It doesn't promote to a Decision node. Recall queries for "Decisions that informed this task" miss the steering, creating incomplete causal history.

**Required Correction**: Expand SP3(2) to include all 7 intervention kinds from coordination-repl.md §8.

---

## Required contract corrections

### SP3 corrections

1. **SP3(2) expansion**: Add `control.send`, `control.steer`, `control.nudge`, `control.interrupt_requested`, `kill.requested`, `control.recovery_requested` to the accepted `driver.recorded` kinds.

2. **SP3(4) bootstrapping fix**: Replace "every counted task has a live `verified_task_outcome` Finding" with "every counted task is terminal (`completed`, `failed`, or `cancelled`) and has a durable terminal event (`task.terminal`, `integration.completed`, `publication.completed`, or `verification.completed`)."

3. **SP3 derived facts addition**: Add: "5. `scratch.fact_posted` with `grounding:'derived'`, same `repoId`, at least `minScratchReaders` distinct completed tasks, **and** a `knowledge.promoted` Finding of kind `'FormalVerification'` or `'IndependentCheck'` → observed `Finding`, trigger `scratch.cited_derived`."

### SP5 correction

Replace "Counterexample → Task is `ObservedIn`" with "Counterexample → Task is `ObservedIn` **or** `ProducedBy` depending on source kind: `integration.incomplete`, `integration.refused`, `publication.refused` → `ObservedIn`; `recovery.claimed_without_spawn` → `ProducedBy`."

### SP8 correction

Replace "ordered `{nodeId, type, trigger, sourceSeq}` summaries" with "ordered `{nodeId, type, trigger, relativeSeq}` summaries, where `relativeSeq = observedSeq - sourceSeq`."

---

## Summary

Phase 49 is structurally rigorous on idempotency, replay protection, and policy locking. However, the bootstrapping circular dependency prevents first promotion, the Scratch quarantine lacks a release mechanism, and causal edge requirements are underspecified. The three P0 defects block safe deployment. REVISE before implementation.