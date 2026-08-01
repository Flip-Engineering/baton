# KG settlement epic contract — the settle-window ritual (v0.9, pre-red-team)

(Seed: issue #63 + demo v3/v3b receipts, docs/reference/evidence/kg-tiered-loop-2026-08-01/.
The tiered knowledge loop is implemented, suite-green, and UNREACHABLE: zero live call sites
for elevateTaskScratchpad / settleWorkflowScratchpad / admitWorkflowFinding; the ritual is
pre-stop-only by design (`run_stopping`); the shipped wave driver always stops member runs
first. Demo v3b proved the working shape by hand-assembling the stack: ritual between
member-resting and wave close. This contract productizes that shape WITHOUT moving
authority: the orchestrator-admit gate stays the only promotion path, and admission stays
an explicit orchestrator act — the operator's model: "elevation task → workflow → project
is done by the orchestrator at end of task and end of workflow.")

## Ground truth (all receipted in the demo evidence)

1. **The settle window exists but nothing uses it.** The wave driver's run loop reaches a
   moment where every member is terminal/resting and the runs are still OPEN (before
   `wave.close()`, `wave-driver.mjs` settle→close). That is the only point in a shipped
   workflow where `run_stopping` does not forbid the ritual.
2. **The facade hides the store.** `createWaveDriver(baton, policy)` holds the embedded
   facade; `driver.coordination` is private to the deployment. Any driver-level ritual must
   therefore ride application commands — which do not exist for the ritual
   (`application_command_unavailable` for the S-3 kernel rows). The commands come first;
   the driver hook is thin.
3. **The lease needs a parent task; mandatory policies refuse ad-hoc tasks.** The
   orchestrator lease binds a working parent task carrying `baton_orchestrator`;
   `createTask` under a mandatory goal/plan policy refuses non-plan tasks
   (`goal_plan_required`). The existing escape pattern is dedicated atomic APIs
   (`createAndClaimRecoveryRefinement` bypasses plan-mandatory for hub-internal relations).
4. **Curation is real but small.** Demo v3b elevated note+doubt and skipped plan
   (procedure, not knowledge). The four entry kinds have semantics: `note` and `doubt` are
   knowledge-bearing; `plan` is ephemeral procedure; `link` is derived reference.
5. **Gate honesty is a hard constraint.** KG-A v1 deliberately shipped no auto-admit call
   site. This contract must not smuggle auto-promotion in through the driver: candidacy is
   materialized, admission is an explicit orchestrator act.
6. **The settlement task must outlive the wave.** Admission can happen after the driver
   exits (orchestrator reviews first). The lease's parent task must stay `working` (a
   `parent_terminal` revocation kills the lease); the settlement run is synthetic and never
   "stops" (`_assertRunAdmissionOpen` only checks `_runStops`).

## The question

Does every shipped wave gain a settle-window ritual — worker scratchpads elevated to the
workflow partition, candidacy materialized for review, the workflow partition reaped at
close — with admission wired as an explicit orchestrator command? Or does the loop stay a
demo-only hand assembly?

## Decisions (draft, to be red-teamed)

### D1 — Store: one dedicated atomic settlement-task API

`createAndClaimSettlementTask(fields, attribution, auth)` on the coordination store,
mirroring `createAndClaimRecoveryRefinement`'s pair shape (one `task.created` +
`task.claimed` batch, relation `'settlement'`, brief capabilities exactly
`['baton_orchestrator']`, orchestrator actor only). It bypasses plan-mandatory the same
way recovery refinements do: settlement is hub-internal hygiene, not plan work. Closed
fields: `{id, runId, reservedWorkerId, objective}`; objective bounded ≤ 512 bytes, never
worker text (no injection lane). Idempotency by caller key, replay-exact.

Red-team targets: is a new relation the right shape vs a flag on relation 'root'? Does
bypassing plan-mandatory weaken the goal/plan authority story (the task does no repository
work — it is a lease anchor, and its brief is hub-fixed)?

### D2 — Application: four settlement commands on the existing S-3 rows

Wire the S-3 kernel rows through `application.command` with `actor: 'orchestrator'`
server-derived and the principal bound exactly as the other control commands:

- `scratchpad.elevate` → `coordinator.elevateTaskScratchpad(taskId, entryIds)` (the
  Coordinator wrapper already derives runId/worker/fence and refuses non-terminal tasks).
- `scratchpad.settle` → `coordinator.settleWorkflowScratchpad(runId, {expectedScratchpadFence, skips})`.
- `knowledge.promote` → `coordinator.admitWorkflowFinding(runId, candidateFindingId,
  policy, lease)`; on success the same command revokes the lease (rule 16b ordering) and
  completes the settlement task — one atomic caller-visible act.
- NEW row `knowledge.settlement_lease` (embedded kernel): materializes the settlement
  run + parent task (via D1) + issues the lease; returns the lease coordinates
  `{runId, taskId, lease: {id, digest, issuedEvent}}` the caller needs for
  `knowledge.promote`. Idempotent per runId: re-calling returns the existing lease.

All four are control effect, embedded surface only in v1 (MCP/CLI surface enablement is a
follow-up; the registry rows' `surfaces` field is amended exactly there when enabled).

Red-team targets: command argument authority (any principal? the embedded facade is the
local-owner — same trust tier as `run.stop`); the auto-revoke in `knowledge.promote`
(one-act semantics vs an explicit revoke command); the settlement lease op's return shape
leaking leaseDigest to any caller (it is the admission secret — but the caller IS the
orchestrator tier).

### D3 — Wave driver: the settle-window hook

New driver policy field `settlement: 'kg-ritual' | 'none'`, default `'kg-ritual'`
(honest-empty: a wave with no scratchpad entries performs no ledger writes beyond the
receipt, so default-on costs nothing when unused). Between "all members terminal" (post
`wave.settle`) and `wave.close()`:

1. Per member run: `recordDriver('steering.registered', {runId})` — idempotent, and the
   driver's own nudges/claims already constitute steering; the registration is the
   elevation precondition (rule 19/20) either way.
2. Per member with a terminal task and a non-empty worker scratchpad partition:
   `scratchpad.elevate` selecting exactly the `note` and `doubt` entries (D4).
3. Per member: `scratchpad.settle` on the shared partition (reaps + expires facts).
4. If ANY member elevated ≥1 entry: `knowledge.settlement_lease` per wave (one settlement
   run per wave, `run-settlement:<waveId>`), then for each elevated `note` entry ONE
   board item on board `wave-settlement:<waveId>` titled from the note's first 120 bytes,
   posted and closed — candidacy materialized. `doubt` entries elevate to the shared
   partition but do NOT auto-candidate (a doubt is a question, not a finding; candidacy
   for doubts is the orchestrator's call, v1 excludes it deliberately).
5. The wave receipt + each member's terminal outline gain
   `knowledge.candidatesAwaitingAdmission: <count>` (zero as 0, never missing — KG-A rule
   3 style) and, when a lease was materialized, `knowledge.settlementRunId`.

Driver failure semantics: a step's typed refusal is captured into the receipt
(`settlement.errors: [{member, step, code}]`, bounded ≤ 8) and never aborts the wave's
close — settlement is best-effort hygiene layered on a completed wave, and the wave's own
outcome is already decided.

Red-team targets: default-on vs opt-in; per-wave vs per-member settlement runs; board
noise (bounded by `MAX_SCRATCHPAD_SHARED_ENTRIES` per run — a wave could still mint tens
of items; is one-item-per-note right, or one digest item per member?); the note-only
candidacy rule; idempotent re-drive after a crash mid-hook (all keys derive from
waveId/runId — verify).

### D4 — Elevation selection rule (v1)

Elevate `note` + `doubt`; skip `plan` + `link`. Rationale: notes carry observations,
doubts carry open questions — both knowledge-bearing; plans are ephemeral procedure whose
value dies with the task; links derive their value from targets and elevate meaninglessly
without them. Dispositions still record `orchestrator_skipped` for the skipped kinds, so
the ledger shows the curation.

Red-team targets: is skipping `plan` data loss (a worker's plan IS its method — worth
keeping for replay continuity, issue #59's re-drive continuity)? Should the rule be a
driver policy field (`settlement.elevateKinds`)?

### D5 — What this contract does NOT do

- No auto-admission anywhere. The gate stays the only path; admission is D2's explicit
  command.
- No worker-facing read port (KG-A4 territory, unchanged).
- No REPL/context-program changes. No MCP/CLI surface enablement (follow-up).
- No change to `promoteKnowledgeBatch` (the causal scratch-fact path is untouched).
- No changes to the trust gate (#64 is its own issue).

## Acceptance (red-first)

A wave whose members write scratchpad entries completes with: entries elevated (shared
fence moved, dispositions receipted), candidacy materialized (candidate Findings queued,
count in the receipt + outlines), the settlement lease materialized and its coordinates
sufficient for an immediate `knowledge.promote` call, the shared partition reaped, the
runs stopped AFTER all of it, and a second driver run over the same wave idempotent
(no duplicate elevations/items/leases). Admission via the new command promotes exactly
the candidate and auto-revokes the lease; a second call is idempotent-replayed; a call
with a revoked/expired lease fails with the typed lease code.
