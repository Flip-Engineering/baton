# Codex capability-gap dogfood review

## Scope and evidence

This is a read-only classification review of `docs/handoff/evidence/capability-matrix.json` and section 6 of `docs/handoff/ISSUE-001-phase10-handoff.md`. It checks the matrix arithmetic, reconciles the handoff summary to the matrix, and prioritizes the already-recorded debt. It does not independently re-prove every row against implementation source, and it does not authorize or design phase-11 work.

## Count verification

Recounting the 107 entries in `capability-matrix.json` by each row's `status` produces:

| Status | Declared in matrix | Recounted from rows | Handoff section 6 | Result |
|---|---:|---:|---:|---|
| `SHIPPED` | 41 | 41 | 41 | verified |
| `DELIBERATELY-FENCED` | 22 | 22 | 22 | verified |
| `UNSHIPPED-DEBT` | 44 | 44 | 44 | verified |
| **Total** | **107** | **107** | **107 classified rows** | **verified** |

The status buckets are exhaustive in this evidence: 41 + 22 + 44 = 107, with no row outside those three labels. The 44 `UNSHIPPED-DEBT` rows also recount cleanly by priority: 7 high, 14 medium, and 23 low.

Two percentage readings make section 6's prose precise:

- Across the entire matrix, `UNSHIPPED-DEBT` is 44/107, or 41.1%; shipped is 38.3% and deliberately fenced is 20.6%.
- If deliberately fenced scope is removed, debt is 44/(41 + 44), or 51.8%, so “roughly half” is accurate for the non-fenced researched surface. Of all 66 non-shipped rows, 22/66, exactly one-third, are deliberately fenced, matching the handoff's “~⅓ of the missing” statement.

The counts are therefore verified as an internally consistent classification inventory. That conclusion should not be overstated as a fresh implementation audit: the matrix itself is the row-level evidence supplied for this task.

## Three highest-priority UNSHIPPED-DEBT clusters

The matrix contains seven individual high-priority debt rows. Section 6 ranks the following three themes first, and together they cover five of those seven rows. This review preserves that ordering because it is supported both by the per-row `high` labels and by the handoff's explicit priority list.

### 1. Worker-session continuity and branching

This is the broadest high-priority cluster, spanning three high-priority rows:

- `ACP session/load + session/resume (worker session resume without respawn)`;
- `codex thread/resume, thread/fork, rejoin-running-thread semantics`;
- `Worker session resume/fork through the driver (...)`.

The shared gap is not vendor protocol availability but driver reachability. The matrix records native resume/fork or load support across Claude, Codex, and Grok, while the coordinator exposes no general resume/fork command; Codex and Grok do not invoke their native resume paths, and Claude's constructor-time resume option is not supplied by the coordinator. The operational consequences recorded in the evidence are cold-spawn cost for every task, no mid-run worker crash recovery, and no fork-and-explore workflow. Section 6 correctly treats the vendor-specific ACP and Codex rows as protocol substrate for the cross-cutting driver gap, rather than as three unrelated projects.

The fencing distinction matters: coordinator-process restart persistence is fenced, but the matrix explicitly says mid-run worker-session resume is not. This cluster is therefore genuine `UNSHIPPED-DEBT`, not scope that should be moved into `DELIBERATELY-FENCED` merely because adjacent persistence work was deferred.

### 2. End-to-end budget enforcement

The high-priority `Budget enforcement end-to-end (...)` row is the sharpest resource-safety gap. The matrix says token telemetry is already logged, but `handle.budgetUsed` remains zero, `resource.budget_threshold` is never emitted, and the `wallMin`-derived timeout passed to session adapters is ignored. Thus the evidence distinguishes observation from enforcement: available usage inputs do not produce threshold alarms, hard stops, or a session wall-clock bound.

This ranks above additional telemetry and scheduling refinements because the current gap permits a live session worker to continue consuming time or quota until a human intervenes. The handoff's section-6 summary accurately describes this as a missing governance action around an already-wired control plane.

### 3. Watchdog signals wired to control action

The high-priority `Hub watchdog: stall/loop/budget signals wired to action (...)` row is related to budget enforcement but is a distinct control-loop gap. The matrix records that `story.signals()` computes stalled, looping, over-budget, and out-of-scope attention, while the coordinator does not consume those signals to interrupt or stop work. It also records producer/consumer mismatches: digest health and budget event kinds are listened for but not emitted, and several live-adapter payloads do not match the fields the signal fold expects.

The result is “signals without a control loop,” as section 6 puts it. Keeping this separate from budget enforcement is useful: budget enforcement accounts for resources and applies limits, whereas the watchdog detects unhealthy behavior and converts attention into a control action. Both are required for unattended workers, but they fail through different seams.

For completeness, the other two high-priority rows are the red-to-green acceptance gate and merge/integration plus git-push approval. They remain important `UNSHIPPED-DEBT`; they rank after the three clusters above because section 6 explicitly orders them fourth and fifth, while the first three address session recovery and unattended resource/control safety.

## Phase boundary

No phase-11 implementation belongs in this task. In particular, this review does not add a spec, change contracts, alter task or backlog state, implement session reuse, wire budget/watchdog behavior, or begin merge/integration work. References in the handoff to task #19, a governance-plane task, or `docs/25-capability-gap.md` are future-work context only. The deliverable here ends with evidence-based count verification and priority identification.
