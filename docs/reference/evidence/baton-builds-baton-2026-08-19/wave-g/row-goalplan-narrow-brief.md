# ROW — #210 goalPlan class: the snapshot().goalPlan callsites go narrow

Measured context (binds): the #229 chain killed 3 furnace instances and the scalar
class (4 lastSeq→eventCursor, d4a62b3c). 14 `coordination.snapshot()` callsites remain
in application.mjs; YOURS are the goalPlan class:

- :2666 `snapshot().goalPlan?.dispatches ?? []`
- :3513 `({ goalPlan } = snapshot())` (the legacy fallback arm beside _findRun's narrow path)
- :4286 `snapshot().goalPlan?.goals`
- :12229 `snapshot().goalPlan` (listRuns's full projection)
- :3474 (classify: full snapshot or goalPlan consumer — read it)

Each deep-clones the ENTIRE store (tasks, runs, lineage, receipts) to read goal/plan
rows the store can serve narrowly. The precedent: `goalPlanRun(repoId, runId)` (the
#227 narrow accessor, coordination-store.mjs — reads _goalHeads/_planHeads directly).

Deliverable (red-first):
1. RED pin impl/test/goalplan-narrow-210-red.test.mjs: for each callsite class — a
   narrow accessor exists in the store serving it (e.g. goalPlanDispatches(repoId?),
   goalPlanGoals(repoId)) OR the callsite already reads narrow; assert the
   application source contains ZERO `snapshot().goalPlan` spellings. RED at HEAD.
2. Implement: add the narrow store accessors (Map reads + bounded clone of ONLY the
   returned rows — mirror goalPlanRun's shape); swap the callsites. :12229 (listRuns)
   is the hot one — it feeds every runs.list; a `goalPlanSummary()` projection
   (bounded: goals+plans heads only, no dispatch bodies) is the right shape there.
3. GREEN + batteries: coordinator, phase62-goal-plan-authority, blind-waits (own RED
   roster aside), workflow-as-data, waves-list-scaling.

Your [attempt:] line verbatim in the first five lines of your notes file.
Scope: impl/src/application.mjs, impl/src/coordination-store.mjs, impl/test/**, this wave dir.
Report: docs/reference/evidence/baton-builds-baton-2026-08-19/wave-g/notes-row-goalplan-narrow.md
