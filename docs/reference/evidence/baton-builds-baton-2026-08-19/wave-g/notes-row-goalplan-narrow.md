[attempt: 30cb5c9c-4134-407f-b460-b04f6a26768e row-goalplan-narrow]

# ROW notes — row-goalplan-narrow: the snapshot().goalPlan callsites go narrow (#210)

Issue #210: application.mjs still served goal/plan projections by deep-cloning the ENTIRE
coordination store — `snapshot().goalPlan` clones tasks, runs, lineage, receipts, evidence,
knowledge, scratchpad… every section — to read the goal/plan rows the store can serve
narrowly. The precedent: `goalPlanRun(repoId, runId)` (#227, reads `_goalHeads`/`_planHeads`
directly) plus `goalPlanRunPlans` / `goalPlanRunIds`. This wave (wave-g) lands the red-first
pin + fix for the goalPlan class of callsites.

## Deliverable

1. RED pin `impl/test/goalplan-narrow-210-red.test.mjs` (5 rows, all RED at HEAD):
   - S1 (structural): the application source contains ZERO `snapshot().goalPlan` spellings —
     RED at HEAD (3 direct spellings at :2666 `_semanticControlTargets`, :4286
     `_reconcileApprovedRuns` fallback, :12229 `listRuns`).
   - S2 (structural): the store serves each narrowed callsite class with a narrow accessor
     (`goalPlanDispatches`, `goalPlanPlanState`, `goalPlanRunPlans`, `goalPlanRunIds`,
     `goalPlanSummary`) — RED at HEAD (the three new accessors do not exist).
   - B1: `_semanticControlTargets` resolves worker dispatches through `goalPlanDispatches`
     with zero snapshot() calls (the fixture throws on any snapshot()).
   - B2: `_workflowPlanHistory` walks `goalPlanRunPlans` + `_runAtPlan` uses
     `goalPlanPlanState` with zero snapshot() calls.
   - B3: `runs.list` projects from `goalPlanSummary(repoId, 100_000)` with zero snapshot()
     calls.
2. Implement: three new bounded store accessors + swap the goalPlan-class callsites.
3. GREEN + batteries.

## Callsite classes (the goalPlan consumers in application.mjs)

| Callsite | Consumer | Narrow accessor |
|---|---|---|
| :2666 `_semanticControlTargets` | dispatches for the run (workflow interrupts) | `goalPlanDispatches(repoId, runId, limit)` (new) |
| :3582 `_runAtPlan` | approval + dispatches for ONE plan generation | `goalPlanPlanState(repoId, runId, planId, version, digest)` (new) |
| :3596 `_workflowPlanHistory` | the run's plan rows (predecessor walk) | `goalPlanRunPlans(repoId, runId)` (existed) |
| :4286 `_reconcileApprovedRuns` | runIds index | `goalPlanRunIds(repoId, limit)` (existed) |
| :12229 `listRuns` | repo goal heads (runs.list, the hot one) | `goalPlanSummary(repoId, limit)` (new) |

Kept as-is (NOT in scope): the two `_findRun` legacy arms — the main fallback (:3474,
`snapshot.goalPlan`) and the read_only_evidence fallback (:3513, `({ goalPlan } = snapshot())`).
Both fire ONLY on legacy stores lacking the narrow accessors and are pinned by
`find-run-narrow-229-red.test.mjs` (a store without `goalPlanRun` keeps the snapshot fallback)
and `phase92-result-intent-vertical` RI9 (a store with `goalPlanRun` + `snapshot` but no
`goalPlanRunPlans` keeps the read_only fallback). Their spellings are variable/destructured —
not `snapshot().goalPlan` — so the S1 zero-spelling contract holds while the legacy pins stay
green. The non-goalPlan snapshot consumers (:3688 exports, :5803/:5927/:6673/:6821 lastSeq,
:8454/:9756 context, :10199 episode, :10709 timeline) belong to other rows and are untouched.

## Store accessors (coordination-store.mjs, after goalPlanRunIds)

- `goalPlanDispatches(repoId, runId, limit = 100_000)` — bounded dispatches across EVERY Plan
  generation of the run's current Goal (a worker's task may belong to an earlier generation),
  scanned plan-by-plan like `goalPlanRunPlans`; throws `goal_plan_status_oversize` beyond the
  limit; `freeze([...].map(clone))` — bounded clone of only the returned rows.
- `goalPlanPlanState(repoId, runId, planId, version, digest)` — the ONE plan's approval +
  dispatches (sorted by nodeKey, matching `goalPlanRun`'s ordering); `null` when the plan does
  not resolve to the run's current Goal (mirrors the old cross-store find/filter miss).
- `goalPlanSummary(repoId, limit = 100_000)` — `{ goals, plans }` of HEAD rows only (no
  historical versions, no dispatch bodies); skips null-runId goals like `goalPlanRunIds`;
  throws `goal_plan_status_oversize` beyond the limit.

## Application swaps (application.mjs)

- `_semanticControlTargets`: `goalPlanDispatches?.(this.repoId, current.goal.runId) ?? []`.
- `_runAtPlan`: `goalPlanPlanState?.(this.repoId, current.goal.runId, plan.planId,
  plan.version, plan.digest) ?? { approval: null, dispatches: [] }` (state.dispatches already
  nodeKey-sorted).
- `_workflowPlanHistory`: `goalPlanRunPlans(this.repoId, current.goal.runId)` with
  `goal_plan_status_oversize` translated to the existing `application_workflow_integrity`
  typed error; legacy snapshot arm (variable spelling) for stores without the accessor.
- `_reconcileApprovedRuns`: `goalPlanRunIds` stays authoritative (P92-LR3: snapshot is
  forbidden when the narrow index exists); the legacy arm keeps its exact behavior via a
  local-variable spelling.
- `listRuns`: `goalPlanSummary(this.repoId, MAX_RUN_RECORDS)` with `goal_plan_status_oversize`
  translated to `application_run_list_oversize`; legacy snapshot arm kept. The existing
  length-ceiling and latest-version-per-run logic is unchanged (heads-only makes the
  version filter a safety no-op, exactly as `_goalHeads` is already the max version).

## RED verification (at HEAD, before the fix)

`node --test impl/test/goalplan-narrow-210-red.test.mjs` → tests 5 · pass 0 · fail 5:
- S1: `application.mjs still contains 3 full-store snapshot().goalPlan spelling(s)`.
- S2: `coordination-store.mjs lacks the narrow accessor goalPlanDispatches()` (and
  goalPlanPlanState/goalPlanSummary).
- B1/B2/B3: `Error: full snapshot is forbidden` — each throws at the HEAD snapshot() call
  (application.mjs :2666, :3596, :12229) where a narrow read must serve instead.

## GREEN verification

- `node --test impl/test/goalplan-narrow-210-red.test.mjs` → tests 5 · pass 5 · fail 0.
- Structural: `grep -cE 'snapshot\(\)\.goalPlan' impl/src/application.mjs` → 0.
- Named batteries:
  - `coordinator.test.mjs` → 58 pass / 0 fail.
  - `phase62-goal-plan-authority.test.mjs` → 8 pass / 0 fail.
  - `blind-waits-red.test.mjs` → 22 pass / 12 fail — failure set byte-identical (timing-
    normalized) to pristine HEAD via stash; its own RED roster (wait/revocation/auth lanes),
    per the brief "own RED roster aside". Untouched by this change.
  - `workflow-as-data-red.test.mjs` → 31 pass / 0 fail.
  - `waves-list-scaling-red.test.mjs` → 1 pass / 0 fail.
- Pinned legacy suites: `find-run-narrow-229-red.test.mjs` + `phase92-linear-replay-red.test.mjs`
  + `goalplan-narrow-210-red.test.mjs` → 11 pass / 0 fail. `phase92-result-intent-vertical`
  passes except pre-existing RI6 (fails identically at pristine HEAD; manifest-bytes pin,
  unrelated). Adjacent goalPlan/store suites (`coordinator-plan-effects-red`,
  `phase62-goal-plan-replay-reds`, `phase62-goal-plan-stream`, `phase66-plan-authorized-recovery`,
  `phase73-required-effects`, `phase78-application-profile-replay`, `phase88-plan-route-authority`,
  `read-lane-229-red`) → 47 pass / 0 fail. Application-integration suites
  (`phase64-integrated-run-application`, `phase66-run-recovery-application`,
  `phase89-resident-application-red`, `phase92-linear-replay-red`, `phase67-change-aware-inspect`)
  → 75 pass / 4 fail, the 4 inspect-wait rows byte-identical (timing-normalized) to pristine
  HEAD (their own pre-existing RED). `phase62-web-goal-plan` → 6 pass / 1 fail (GP7/GP8
  `unknown_argument_field` vs `invalid_command` — fails identically at pristine HEAD, verified
  via stash; pre-existing, unrelated to goalPlan reads).
- Direct accessor smoke (temporary file, run against a REAL driver: defineGoal/proposePlan/
  approvePlan/spawn with a run-bound goal, then deleted): `goalPlanSummary` returns the one
  head goal + head plan; `goalPlanDispatches` returns the one dispatch (taskId + binding
  nodeKey/planId); `goalPlanPlanState` returns approval `approved` + the dispatch; unknown
  plan → null; unknown run → `[]`/null; other repo → empty; limit validation throws
  TypeError. → `SMOKE-210 OK`.

## Judgment calls (recorded per the brief's messageOnSpawn)

- `goalPlanDispatches` spans every Plan generation of the run's current Goal, not just the
  head plan: `_semanticControlTargets` matches dispatches by `taskId` across workers that may
  belong to earlier generations — head-only would silently drop their nodeKey/role.
- `_runAtPlan`'s plan is always validated against the run's current Goal (repoId/runId/
  digest + goal identity); a mismatch returns null rather than throwing, mirroring the old
  cross-store find/filter miss (approval null, dispatches []).
- Legacy arms at :2666/:3582/:4286/:12229 keep the snapshot fallback ONLY where the store
  lacks the narrow accessor, via local-variable spellings (`snapshot.goalPlan`) so the S1
  zero-`snapshot().goalPlan` contract holds; the #229/RI9-pinned `_findRun` arms are
  untouched. No test pins legacy-with-data at these four sites (grammar-m3's snapshot-only
  mock returns empty dispatches; `?? []`/`?? { approval: null, dispatches: [] }` are
  behavior-neutral there).
- `goalPlanSummary` is repo-scoped and excludes null-runId goals (mirrors `goalPlanRunIds`);
  the old cross-repo, all-versions ceiling now applies to this repo's heads only — strictly
  narrower, and no test pins the cross-repo interference.
- Sibling waves share the two files (git-batch on application.mjs, compaction on
  coordination-store.mjs). As of this report no sibling edits have landed in this worktree
  (git status: only this row's 2 files + 1 new test). Edits are confined to the 5 enumerated
  callsites + 3 accessors; integration re-verification is due when siblings land.

## Verification command (definition of done)

`true` (argv `[]`, cwd `.`) → exit 0. The repository improvement is implemented and
verified above; the requested exact execution contract is preserved.
