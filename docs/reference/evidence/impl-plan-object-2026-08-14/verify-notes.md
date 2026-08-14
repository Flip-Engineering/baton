IMPL_PLAN_OBJECT-VERIFY v1
[attempt: e77f2ee4-14e6-48af-9958-a1d4c744e48b coordinator]

# Coordinator verify notes — impl-plan-object wave (2026-08-14)

VERDICT: **needs-fold with blockers**.

The row's scoped store-fold implementation is verified sound and green-earned: F1–F3 go
from RED to green through the impl, all five pins (F4, R1–R4) stay green, the named
adjacents are green-unchanged against regenerated HEAD baselines, NUL discipline holds,
and the acceptance suite is byte-immutable. But the suite is **8 pass / 47** — the 39
remaining RED rows are all blocked on the application.mjs surface leg (plan.read /
plan.write ports, CLI verbs, MCP tools, web refusal + divergence ledger, registry rows,
generated docs), which per the row brief is another wave's partition. Fold proceeds only
when that leg lands.

## Measured counts

- **Acceptance suite** `impl/test/orchestrator-plan-object-red.test.mjs` (47 tests):
  **8 pass / 39 fail**, verified twice in the row worktree (ws-3ebef23b) with identical
  passing-name lists. Passing exactly: F1 `plan-fold-unlanded`, F2 `plan-fold-unlanded`,
  F3 `plan-batch-kind-unregistered`, and pins F4, R1, R2, R3, R4.
- **Adjacents** (each diffed against a regenerated HEAD baseline — `git stash` of the
  row's store edit, rerun, restored):
  - `orchestrator-wake-red`: 36 tests / 6 pass / 30 fail — counts AND failing-name list
    byte-identical to HEAD.
  - `cross-deployment-knowledge-red`: 31 tests / 9 pass / 22 fail — identical to HEAD.
  - `kg-activation-red`: 6 tests / 5 pass / 1 fail — identical to HEAD.
- **Suite immutability**: sha256 `fe34f3263c4adaba2340ab47e1d1767fd157900fb9639b7c8dd5d3784253a99d`
  byte-identical in both worktrees before and after the row's work. Green was earned by the
  impl, never by suite edits.

## What is green and why (spot-audited)

1. **`plan-fold-unlanded` (F1/F2)** — spot-audited against the code: `foldPlanObjectEvent`
   in `impl/src/orchestrator-plan.mjs` is a real deterministic fold over the five plan.*
   event kinds (`plan.minted`, `plan.task_upserted`, `plan.task_transitioned`,
   `plan.focus_upserted`, `plan.task_evidence_linked`) with `requireExactKeys` shape
   validation, an idempotency-keyed prior-event check, and version-CAS semantics. Raw
   appends through `coordination-store._append` durably fold; the `_apply` dispatch routes
   these kinds before the `unsupported_event_kind` throw. No suite edit could manufacture
   this — the fold and its batch registration live in the impl.
2. **`plan-batch-kind-unregistered` (F3)** — spot-audited: `plan_auto_demote` is registered
   in the closed `_appendBatch` list via `...PLAN_OBJECT_BATCH_KINDS`, and the wave-close
   elevation emits it as ONE batch carrying the subtree's doing→todo demote (DR-3/H4.1),
   plus `plan.task_evidence_linked` events for done tasks citing `{coordinationSeq}`.
3. **Pins intact** — F4 (close/reopen byte-identical replay) and R1–R4 (facade denial,
   WAITING_ON closed five, SCRATCHPAD three, goal-plan `^plan:[a-f0-9]{64}$` refusing
   `plan:<hex32>`) all still green; snapshots stay byte-unchanged when `_campaignPlans` is
   empty, which is what keeps F4 and the adjacents pinned.

## What is NOT green and why (the 39 RED rows)

All 39 remaining failures are RED-by-design at HEAD and are NOT absorbed by this row; each
fails at a stage named for the application.mjs surface leg, owned by another wave per the
row brief:

- `plan-write-port-missing` — **30 rows** (M1–M5, S1–S8, N1–N2, L1–L7, A1–A5, W1–W2, Q1–Q2,
  O1): every one routes through `application.command('plan.write')`, which refuses
  `application_command_unavailable` until the plan.write direct port lands in application.mjs.
- `plan-read-port-missing` — 1 row: the plan.read direct port.
- `plan-status-law-missing` — 1 row (L6): port-level `plan_focus_invalid` refusal.
- `cli-plan-verbs-missing` — 3 rows (X1–X3): CLI verbs.
- `mcp-plan-tool-missing` — 1 row (X5): MCP tools.
- `registry-plan-rows-missing` — 2 rows (X6, X7): registry rows + generated docs.
- `web-plan-ledger-missing` — 1 row (X4): surface-divergence ledger.

Zero `coordination_projection_poisoned` in any run — the fold seams poison nothing.

## NUL discipline (verified)

`impl/src/coordination-store.mjs` and `impl/src/application.mjs` inspected with
`grep -an`/`sed -n`/`git diff`/`node -e` only (python3 is a broken asdf shim, exit 126).
3 NUL bytes preserved: present in the original at 1184615/1184631/1184657, now at
1190708/1190724/1190750 — a uniform +6093 shift from strictly-preceding additive edits; the
NUL-bearing template-literal cacheKey region is untouched. `application.mjs` untouched
(3 NUL bytes, no edits). New module `orchestrator-plan.mjs`: 0 NUL bytes. `node --check`
clean on both edited files.

## Row worktree surface (cleanliness)

`git status` in ws-3ebef23b shows exactly: `M impl/src/coordination-store.mjs`,
`?? impl/src/orchestrator-plan.mjs`, `?? docs/reference/evidence/impl-plan-object-2026-08-14/notes-row-plan-object.md`
— nothing else. No app-leg surface file touched, no suite edits, no pushes, no destructive
commands.

## DECISION_REQUEST — authority-class ambiguity (the coordinator wave binding)

`inferPlanAuthority` maps the string seat `worker:coordinator-wave<N>` to the wave
`wave:w<N>` by string-seat convention. This is a FALLBACK: the contract (D2/H2.1) does not
name a durable binding source for a coordinator's wave scope, and G8 excludes the `plan:*`
power class from every worker seat. Options for the surface leg / a ruling:

- **(a) String-seat fallback stands** (current code): the coordinator's wave scope is parsed
  from its seat id at admission time. Simple, no new ledger surface; but the binding is
  conventional, not durable, and a renamed seat silently changes scope.
- **(b) Roster binding**: the coordinator's wave scope resolves from the same
  `steering.registered` roster fold (`_waveRoleRuns`) that resolves pre-decomposed
  `ownedBy.run` (H2.2) — the waveId/waveRole the deployment registered, not a parsed seat.
  Durable and replay-derived, but requires the deployment to register coordinators and adds
  an unverified coupling this row could not test through the port-missing stages.
- **(c) Wave-scope assertion event**: a `plan.*`-adjacent event asserting the binding,
  reviewable like the rest of the ledger. Most durable, most surface — beyond this row's
  partition.

The row implements (a) behind `inferPlanAuthority` so the surface leg can swap (b)/(c) in
one place. Refusals that hinge on the class boundary
(`coordinator_authority_forbidden` with `gracefulPath: 'DECISION_REQUEST'`) carry the
marker in their detail. This request is forwarded to whoever folds the application.mjs leg
and the operator ruling on the coordinator wave binding.

## Incremental verification (round 2)

### Store diff audit (NUL discipline + additive-only proof)

`git diff impl/src/coordination-store.mjs` vs HEAD: **112 insertions / 2 deletions**, where
both "deletions" are single-line expansions (the `steering.registered` fold line and the
`snapshot()` line). Every hunk is additive — import seam, `PROJECTION_CHECKPOINT_FIELDS`
extension, `_resetProjection` map init, `_appendBatch` closed-list spread of
`...PLAN_OBJECT_BATCH_KINDS`, the guarded roster fold, the `_apply` dispatch branch, the
conditional `planObjects` snapshot spread, the `_planElevationAtWaveClose` hook + call in
`appendWaveClosed`, and four public accessors. No shared-region edit, no removal of existing
behavior, and the NUL-bearing cacheKey template-literal region is NOT in the diff (bytes
survive at the recorded +6093 shift). `node --check` clean on both files; the new
`orchestrator-plan.mjs` has 0 NUL bytes.

### Replay byte-identity — F4 extended to a plan-containing ledger (direct, by me)

Beyond the suite, I drove the real elevation seam: store with a fixed clock →
`steering.registered` roster row → `plan.minted` (alpha `doing`, beta `done`, both
`ownedBy.wave: wave:w1`) → **`appendWaveClosed`** with a valid closed 8-key payload, which
runs `_planElevationAtWaveClose` (admission-only). Asserted on the live ledger: alpha
auto-demotes `doing → todo` through the registered `plan_auto_demote` batch; beta stays
`done` and gains `plan.task_evidence_linked` citing `{coordinationSeq: <wave.closed seq>}`
(no clock). Then reopened the SAME ledger and asserted `deepStrictEqual(replay.snapshot(),
live)` — **byte-identical replay** — with equal event counts and identical demote/evidence
state. **Result: PASS** (5 events: registered, minted, closed, evidence-linked, auto-demote).

### Store-seam regression sweep (HEAD vs row, complete)

A 22-suite batch of store-seam-sensitive tests (wave close, snapshots, replay, steering
registration, plan-adjacent lanes, KG horizons) was run in BOTH worktrees — row
(ws-3ebef23b) and untouched HEAD (ws-78e942b4) — and diffed pass/fail per suite. The row's
changes must leave every count identical. Result: **identical pass/fail on all 22 suites.**

| suite | tests | pass | fail |
|---|---|---|---|
| phase11-coordination-store | 30 | 29 | 1 |
| phase11-control-integrity | 16 | 16 | 0 |
| phase11-governance | 17 | 17 | 0 |
| phase60-coordination-recovery | 7 | 7 | 0 |
| coordinator | 57 | 57 | 0 |
| wave-observability-red | 30 | 30 | 0 |
| phase63-canonical-order-authority | 11 | 11 | 0 |
| phase64-result-finalization-store | 7 | 7 | 0 |
| phase61-representation-store | 10 | 10 | 0 |
| phase10-completion | 28 | 28 | 0 |
| phase10.1-reconciliation | 19 | 19 | 0 |
| e2e | 4 | 2 | 2 |
| phase80-plan-revision-store | 6 | 6 | 0 |
| phase88-plan-route-authority | 7 | 7 | 0 |
| phase66-plan-authorized-recovery | 6 | 6 | 0 |
| kg-settlement-red | 24 | 24 | 0 |
| kg12-decisions-red | 18 | 18 | 0 |
| cli-wave-fidelity-red | 16 | 16 | 0 |
| workflow-as-data-red | 30 | 30 | 0 |
| worker-orchestrated-swarm-red | 16 | 16 | 0 |
| nested-orchestration-red | 15 | 7 | 8 |
| phase75-task-topology | 20 | 20 | 0 |

Notes on the sweep:
- Every suite's pass/fail counts are byte-identical between the row worktree and the
  untouched HEAD worktree — the row's additive store changes leave all store-seam behavior
  unchanged (the RED rows in `phase11-coordination-store` 29/1, `e2e` 2/2, and
  `nested-orchestration-red` 7/8 are the pre-existing HEAD baselines, unchanged by the row).
- `workflow-as-data-red` exceeded the batch runner's 120s cap once in the HEAD pass (no
  summary); rerun to completion it is green (30/0) in both worktrees, matching the row.
- One transient 29/1 was observed for `workflow-as-data-red` in the UNTOUCHED HEAD worktree
  (first explicit rerun), green on both subsequent reruns (30/0). This is a
  non-deterministic, timing-dependent baseline flake in that suite (timing-sensitive tests:
  "a stalled member is claimed", "refires are deduped by (runId, role)", "at most 3
  messageOnSpawn attempts") — it occurred in the worktree with NO row changes, so it is NOT
  attributable to this row. Noted here for the record; `gh` is unauthenticated in this
  environment so no issue could be filed.

## Fold blockers (for the next leg)

To go from needs-fold → sound, the application.mjs surface wave must land: the
`plan.write`/`plan.read` direct ports, CLI verbs X1–X3, MCP tool X5, web refusal +
surface-divergence ledger row X4, registry rows X6, and generated docs X7, plus the
port-level status law L6. Until then this verdict stands as-is.
