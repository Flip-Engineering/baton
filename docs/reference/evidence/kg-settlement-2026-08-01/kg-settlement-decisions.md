# KG settlement epic contract — the settle-window ritual (v1.0, post-red-team fold)

(Red-teamed by baton wave: `redteam-authority.md` (claude-sonnet-5, 3 CONFIRMED-HOLEs + 3
NEEDS-AMENDMENTs) and `redteam-lifecycle.md` (glm-5.2 re-drive after a deepseek stream-death,
6 NEEDS-AMENDMENTs + 3 cross-cutting). Every amendment below cites its verdict. v0.9's seed
header and ground truth are preserved at the end of this document for traceability.)

## v1.0 decisions (folded)

### D1 — Store: one dedicated atomic settlement-task API (AMENDED: authority §1)

`createAndClaimSettlementTask(fields, attribution, auth)` on the coordination store,
mirroring `createAndClaimRecoveryRefinement`'s pair shape (one `task.created` +
`task.claimed` batch, relation `'settlement'`, brief capabilities exactly
`['baton_orchestrator']`, orchestrator actor only), bypassing plan-mandatory exactly as
recovery refinements do. **The objective is a hub-fixed constant** — the caller supplies NO
objective field at all (the constant templates only authority-less identifiers:
`settlement task for wave <waveId>`). Closed fields: `{id, runId, reservedWorkerId}` — with
`id` PINNED to `settlement-task:<waveId>` and `runId` to `run-settlement:<waveId>` so the
derived lease identity is stable across re-drive (lifecycle A5.2). Idempotency by caller
key, replay-exact.

### D2 — Application: four settlement commands on the S-3 rows (AMENDED: authority §2/§6, lifecycle XB)

Wire the S-3 kernel rows through `application.command` with `actor: 'orchestrator'`
server-derived:

- `scratchpad.elevate` → `coordinator.elevateTaskScratchpad(taskId, entryIds)`.
- `scratchpad.settle` → `coordinator.settleWorkflowScratchpad(runId, {expectedScratchpadFence, skips})`.
- `knowledge.promote` → `coordinator.admitWorkflowFinding(...)`, then independently-
  idempotent teardown (authority §4): (1) admit (store replay short-circuits a duplicate);
  (2) if the lease is not already revoked, revoke it (rule 16b); (3) if the settlement
  task is not already completed, complete it. Each step checks state and no-ops
  independently, so a crash anywhere is resolved by re-issuing the SAME command with the
  SAME idempotencyKey. The registry row's `liveMethod` is corrected from
  `promoteKnowledgeNode` to `admitWorkflowFinding` (authority bonus observation).
- NEW row `knowledge.settlement_lease` (embedded kernel): materializes the settlement
  run + parent task (D1) + issues the lease. **The lease session is derived server-side
  from the CALLING PRINCIPAL** (`principalId`/`sessionId` from the command principal; the
  `authorityDigest` hub-minted) — never from caller fields. Returns
  `{runId, taskId, lease: {id, digest, issuedEvent}}`. Idempotent per waveId.
- **Admission enforces the full lease check (lifecycle XB — the keystone):**
  `admitWorkflowFinding` is amended to route through `_activeRunOrchestratorLease`
  semantics — expiry (`run_orchestrator_lease_expired`), parent-task liveness
  (`run_orchestrator_parent_inactive`), `_assertRunAdmissionOpen`, AND the session binding
  (`principalId`/`sessionId`/`sessionAuthorityDigest` vs the lease session). This closes
  the expired-lease admission hole in the ALREADY-SHIPPED primitive AND the bearer-
  credential hole (authority §2) in one move: the lease is no longer presentable by an
  actor that did not acquire it.
- **v1 surface honesty (authority §2/§6):** the four commands are embedded-only, and that
  gate is STRUCTURAL, not registry metadata: the MCP tool table and CLI command map simply
  do not contain them (no `surfaces` amendment is made). The ritual is driven top-level
  only — never from a nested/`sessionAuthority`-bearing context; the four names are
  deliberately NOT added to `recursiveEffectCommands` or `RUN_ORCHESTRATOR_CAPABILITIES`,
  and D3's driver hook calls them only from the deployment's own top-level principal.

### D3 — Wave driver: the settle-window hook (AMENDED: lifecycle A1/A3/XC, authority §3/§5)

New driver policy field `settlement: 'kg-ritual' | 'none'`, default `'kg-ritual'`
(honest-empty DEFENDED: zero ritual ledger writes when no partition has entries —
lifecycle A3). Between "all members terminal" and `wave.close()`:

0. **Sweep (lifecycle A2, driver-triggered, no timers):** before anything else, revoke any
   prior settlement leases past TTL with no admission (new revocation reason
   `review_window_expired` added to `RUN_ORCHESTRATOR_REVOCATION_REASONS`), cancel their
   settlement tasks, retire their un-admitted candidates (drop the board items), and
   expire the related scratch facts. Bounded ≤ 16 leases per sweep; each step idempotent.
1. Per member run: `recordDriver('steering.registered', {runId})` (idempotent).
2. Per member whose **store** `task.status` is terminal (re-read from the store — NOT the
   driver's `claimed` flag; lifecycle A1 minor) with a non-empty worker partition:
   `scratchpad.elevate` selecting exactly the `note` and `plan` entries (D4). A
   `scratchpad_settlement_not_ready` refusal is recorded, never silently dropped.
3. If ANY member elevated ≥1 `note`: `knowledge.settlement_lease` once per wave, then for
   each elevated `note` ONE board item on board `wave-settlement:<waveId>`:
   - idempotencyKey PINNED to `board.candidacy:<waveId>:<sharedEntryId>` (authority §5);
   - title = the note's first 120 bytes, control characters stripped (authority §3);
   - detail = the note's FULL text bounded to the store's detail cap (lifecycle XC — the
     candidate then grounds to full note content, not a 120-byte stub, surviving the
     shared partition's stop-cleanup);
   - candidacy is note-only (doubts/plans never candidate — D4).
4. The wave receipt + terminal outlines gain `knowledge.candidatesAwaitingAdmission`
   (zero as 0), `knowledge.settlementRunId` when a lease was materialized, and
   `settlement.errors` bounded ≤ 8 (`{member, step, code}`). A step's typed refusal never
   aborts close.

**No shared-partition settle at close (lifecycle XC resolution):** the v0.9 step-3 settle
is REMOVED — stop-cleanup (`reapRunScratchpads`) reaps the shared partition at close
anyway, and the scratch facts stay live through the review window so the orchestrator can
ground against them; the sweep (step 0) expires them after TTL. The candidate's board
detail (step 3) is what preserves full note content past cleanup.

**Cross-wave growth bound (lifecycle A3):** one item per note (curation granularity wins
over one-digest-per-member); the sweep's candidate retirement is the cross-wave bound.

**The real pre-stop invariant (lifecycle XA, doc):** the ritual runs in the window because
stop-cleanup has not yet reaped the partitions; a post-close elevation is an empty no-op,
and the apply-layer effect gate (`_apply` run-stopping refusal receipted in demo v3)
forbids the mutation effects themselves. v0.9's "`_assertRunAdmissionOpen` forbids the
ritual" framing was wrong about the mechanism, right about the outcome.

### D4 — Elevation selection rule v1 (AMENDED: lifecycle A4/A6)

Elevate `note` + `plan`; skip `doubt` + `link` (`orchestrator_skipped` dispositions
receipted). Notes carry observations (knowledge lane: scratch-fact + candidacy). Plans
carry the worker's method — elevated into the NON-CANDIDACY method lane (shared entry, no
scratch-fact per store semantics, no board item, no Finding) so re-drive continuity (#59)
can recover procedure for non-plan tasks (the `mandatory:false` shape). Doubts are NOT
elevated in v1: elevation would mint a factless shared entry that settle deletes and
nothing queries (the silent sink, lifecycle A6) — a doubt review path is a follow-up
issue, filed at acceptance. Links remain skipped (derived references, elevate
meaninglessly without targets).

### D5 — Non-goals (unchanged, plus authority §6)

- No auto-admission anywhere; admission is D2's explicit command only.
- No nested/`sessionAuthority`-context dispatch of the ritual commands (v1 top-level only).
- No worker-facing read port, no REPL/context-program changes, no MCP/CLI enablement.
- No change to `promoteKnowledgeBatch`. No trust-gate changes (#64 is its own issue).
- No doubt review path (follow-up), no settlement-lease session-binding beyond
  `_activeRunOrchestratorLease` semantics.

## v1.0 acceptance (red-first)

A wave whose members write scratchpad entries completes with: `note`+`plan` entries
elevated (shared fence moved, dispositions receipted), candidacy materialized for notes
(candidate Findings queued with FULL note text in board detail, counts in receipt +
outlines), the settlement lease materialized with session bound to the calling principal,
stale leases swept (`review_window_expired`), runs stopped after all of it, and re-drive
of the same wave exactly-once (stable `leaseId`, no duplicate items/elevations — crash
walks 1+2). Admission via `knowledge.promote` promotes exactly the candidate, enforces
expiry/parent-liveness/session binding (typed codes), auto-revokes the lease, completes
the settlement task, and is idempotent-replayed on retry; admission with an expired,
revoked, or foreign-session lease fails with the typed code. Doubts and links are never
elevated; plan entries never mint facts, items, or Findings.

---

## v0.9 seed (preserved for traceability)

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
