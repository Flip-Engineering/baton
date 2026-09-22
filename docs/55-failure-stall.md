# 55 — Failure-stall to forced review: a count-derived park (issue #188)

Status: design, 2026-09-22, seat wake-lead3 (swarm-wake-20260921). No pin is landed yet; §7 is
the contract an implementation lane writes red-first (docs/44).

Related: #67 (silence-stall, the sibling fact), #163 (quiescence and the no-clock law), #10 (the
attention vocabulary), #182 (death certificates), #258 (budgets and stall handling), #71 (the
attention inbox this park's item is delivered through), #67's failure half as the adopting
comparison (`docs/reference/evidence/pm-comparison-2026-08-13/pm-dag.md` C4, `pm-redteam.md` §4).

## 1. The fact

A **failure verdict** is a terminal event whose disposition is one of the failure classes the run
phase enum already closes (`failed`, `denied`, `inconclusive`) — `CANONICAL_RUN_PHASES`,
`impl/src/application-semantics.mjs:21-25`, with `APPLICATION_TERMINAL_CANONICAL` at :108-110 as
the canonical-phase subset. A **success verdict** is `completed`.

The **failure-stall count** of a run is the number of CONSECUTIVE failure verdicts in ledger-seq
order. A success verdict resets it to zero. The count is derived in the fold that already derives
`progressClass` and the run's terminal cause (`impl/src/application-observation.mjs:518-540`), so
every surface reads one field and no surface counts verdicts of its own. A fold replay yields the
same count and the same park seq.

Consecutive, not cumulative: consecutive verdicts describe a run that keeps producing failing
work. A cumulative count would park a long run whose failures are separated by successes.

## 2. The park

When the count reaches the deployment's threshold (§5), the run parks. The park writes ONE durable
row `run.parked {reason: 'failure_stall', count, threshold, atSeq}`.

- The park stops NEW member spawns for that run. A spawn requested while parked refuses with a
  named code that carries the park row's seq.
- The park never stops, kills or interrupts a live member, and never writes a terminal phase. A
  parked run is not quiesced (#163): its live members keep running, and their verdicts still fold
  into the count.
- The park clears when an orchestrator answers the attention item of §3 (`run.unparked {reason:
  'orchestrator_answer', atSeq}`), or when a success verdict folds after that answer
  (`reason: 'success'`). A cleared park does not clear the count's history; the next failure
  verdict after a clear continues the count from zero.

## 3. The attention item

A park emits exactly ONE attention row, of the new kind `failure_stall`, in the shape the
attention array carries today (its closed kind set is `CANONICAL_ATTENTION_KINDS`,
`impl/src/application-semantics.mjs:33-36`, eight kinds; this design adds the ninth).

The row's payload carries the park's own evidence:

```
{ runId, count, threshold, verdicts: [ { memberId, attemptId, disposition, atSeq, certificate } ] }
```

`verdicts` is the counted run of failure verdicts in ledger order; `certificate` is the death
certificate the failure path already records for a dead attempt
(`impl/src/holistic-runtime.mjs:393`, `impl/src/production-convergence-state.mjs:193`) — the park
adds no second evidence store. One row per park, never one per verdict.

## 4. The wake reason

`failure_stall` joins the closed `WAKE_REASONS` set. That set has no producer in
`application-semantics.mjs` today; it is pinned by the attention-inbox lane
(`impl/test/orchestrator-wake-red.test.mjs:267`, reason #71). The failure-stall row is added to the
set in the same change that implements this park, AFTER the #71 set is on the tree, so the pinned
set and its producer move together.

## 5. The threshold

The threshold is deployment policy: an operator-declared value, `stallPolicy.failureCount`. It
selects WHEN a review is requested; it bounds no action, so it is not a cutoff on an agent control
flow (#258/#541 class). Unset means the park never fires — a run with no declared threshold keeps
going and no forced review is emitted. Its registry row lands in `impl/src/limits.mjs` in the
change that implements the park, and that row names `stallPolicy.failureCount` as the derivation.

## 6. What stays out

- **No clock and no rate.** Nothing here reads elapsed time or a per-window rate (#163).
- **No fault attribution.** The park names verdicts and their evidence. The repository has no
  provider-taxonomy row that classifies every failure, and this design does not guess one
  (`docs/53`).
- **No member action.** No member's lifecycle, checkpoint or custody changes because a run parked.
- **Not #67.** A silent run and a failing run are two independent facts; each parks on its own
  derivation, and a run can be both.

## 7. Pins (red-first)

Every row below fails on the current tree and passes only with the mechanism (docs/44; a new pin
lands in `impl/scripts/expected-red-tests.json` with reason `#188` until its row passes).

| row | asserts |
|---|---|
| FS-1 | threshold N declared: N consecutive failure verdicts park the run — one `run.parked` row and one `failure_stall` attention row. N-1 verdicts park nothing. |
| FS-2 | a success verdict between failures resets the count: N-1 failures, one `completed`, N-1 failures park nothing. |
| FS-3 | a parked run refuses a new spawn with the park's own code and seq, and writes no terminal phase; a live member's next verdict still folds. |
| FS-4 | clearing: an orchestrator answer writes `run.unparked {reason: 'orchestrator_answer'}` and a following spawn is admitted; a success verdict after the answer writes `reason: 'success'`. |
| FS-5 | the attention row carries the counted verdicts in ledger order with each attempt's certificate, and exactly one row exists per park (a second park emits its own row). |
| FS-6 | no threshold declared: any number of consecutive failure verdicts parks nothing. |
| FS-7 | the count is fold-derived: replaying the same ledger yields the same count and the same park seq, and the run view's `failureStall` field equals the fold's. |

## 8. Migration

- `CANONICAL_ATTENTION_KINDS` gains `failure_stall`; the generated vocabulary is regenerated with
  `node impl/scripts/surface-gate.mjs --write` in the same change (docs/36 §7.4 rule).
- The run outline gains `failureStall: {count, threshold: number|null, parked: boolean}`, projected
  in `impl/src/application-observation.mjs` beside `progressClass`; the CLI/Web/MCP projections
  carry it through their existing view plumbing, never a second field name.
- `WAKE_REASONS` gains `failure_stall` after #71's set is on the tree (§4).
- The spawn admission path gains the parked-run refusal, in the same place it already refuses for
  admission state (`impl/src/runtime-admission.mjs`), so one refusal path owns the run's spawn gate.

## 9. Seam map

| seam | today | this design |
|---|---|---|
| the fold that derives run facts | `application-observation.mjs:518-540` (`projectProgressClass`) | carries `failureStall` on the same derivation |
| death certificates | `holistic-runtime.mjs:393`, `production-convergence-state.mjs:193` | read as the attention payload's evidence; unchanged |
| attention kinds (closed set) | `application-semantics.mjs:33-36` | `failure_stall` joins; regeneration covers docs/36 |
| wake reasons (closed set) | pinned by `impl/test/orchestrator-wake-red.test.mjs:267` (reason #71) | gains `failure_stall` with this park |
| run lifecycle rows | the run's own append-only ledger | `run.parked` / `run.unparked` join it |
| spawn gate | `runtime-admission.mjs` | refuses a spawn into a parked run, naming the park row |
| threshold | none | `stallPolicy.failureCount`, a registry row in `limits.mjs`, unset = never park |
