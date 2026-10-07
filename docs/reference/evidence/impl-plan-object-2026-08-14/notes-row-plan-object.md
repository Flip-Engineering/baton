[attempt: e77f2ee4-14e6-48af-9958-a1d4c744e48b row-plan-object]
# Row `row-plan-object` — implementation notes (2026-08-14)

## Scope landed (this row)

- `impl/src/orchestrator-plan.mjs` (NEW, ~550 lines) — the plan-object lane module the #161
  contract v2.0 FOLDED specifies: closed task shape (D1) with exact key-ORDER validation;
  content-derived identities (`planIdFor`/`taskIdFor`); DAG topology admission
  (`validatePlanTopology`); the deterministic fold (`foldPlanObjectEvent`) over the five event
  kinds; `planObjectSnapshot` (deterministic planId-sorted projection); the authority matrix
  (`inferPlanAuthority`); and the write lane `admitPlanWrite` with (identity, version)
  idempotency keys and requestDigest adjudication. Folds apply events; they never authorize
  (H2.3).
- `impl/src/coordination-store.mjs` (ADDITIVE — 112 insertions, 2 deletions where both
  "deletions" are one-line expansions, no shared-region edits, application.mjs untouched):
  - import seam from `./orchestrator-plan.mjs`
  - `PROJECTION_CHECKPOINT_FIELDS` += `_campaignPlans`, `_waveRoleRuns`
  - `_resetProjection` initializes both maps (empty at HEAD — replays of existing ledgers
    re-fold through `_apply` and never touch them; no checkpoint migration needed)
  - `_appendBatch` closed list += `...PLAN_OBJECT_BATCH_KINDS` (`plan_auto_demote`, H4.1)
  - `driver.recorded` `steering.registered` fold also records the
    `(waveId, waveRole) -> runId` roster index (H2.2), only when waveId/waveRole are non-empty
    strings — existing steering events without those fields fold identically
  - `_apply`: `PLAN_OBJECT_EVENT_KINDS.has(event.kind)` branch before the
    `unsupported_event_kind` throw, resolving `ownedBy.run` from the roster index
  - `snapshot()`: conditional `...(this._campaignPlans.size > 0 ? { planObjects: ... } : {})` —
    plan-free snapshots are byte-unchanged (F4 pin, adjacents)
  - `appendWaveClosed` += `this._planElevationAtWaveClose(...)` — the wave-close elevation
    (D2/P6): done tasks gain `plan.task_evidence_linked` events citing
    `{coordinationSeq: <wave.closed seq>}`; doing tasks demote to todo through ONE
    `plan_auto_demote` batch; no auto-promotion, no auto-reopen (the H4.2 reviewed-reject
    stays a surfaced review-authority write). No-ops when `_campaignPlans` is empty, so
    HEAD ledgers that never mint plans are unaffected. Replay re-folds the appended events;
    the hook runs at admission only.
  - public accessors: `campaignPlans()`, `campaignPlan(planId)`,
    `priorCoordinationEvent(key)` (idempotency-keyed prior event, G4/H1.1),
    `waveRoleRun(waveId, waveRole)` — placed beside `waveRegistry()`

## Acceptance results (`impl/test/orchestrator-plan-object-red.test.mjs`, 47 rows)

- Baseline at HEAD: 5 pass / 42 fail.
- After this row: **8 pass / 39 fail**. Newly green, exactly the stages this row owns:
  - F1 `plan-fold-unlanded` — raw `plan.minted` appends durably and folds
  - F2 `plan-fold-unlanded` — raw `plan.task_transitioned` folds
  - F3 `plan-batch-kind-unregistered` — `plan_auto_demote` registered in `_appendBatch`
  - F4 PIN, R1–R4 PINs still green (close/reopen replay identity; facade denial; WAITING_ON
    closed five; SCRATCHPAD three; goal-plan `^plan:[a-f0-9]{64}$` refusing `plan:<hex32>`).
- The remaining 39 RED rows are RED-by-design at HEAD and are NOT absorbed by this row; every
  one fails at its named stage owned by the application.mjs leg (another wave):
  - `plan-write-port-missing` (30 rows): M1–M5, S1–S8, N1–N2, L1–L7, A1–A5, W1–W2, Q1–Q2, O1 —
    all route through `application.command('plan.write')`, which refuses
    `application_command_unavailable` until the plan.write direct port lands.
  - `plan-read-port-missing` (1): O-adjacent plan.read port row.
  - `plan-status-law-missing` (1): L6 — the port-level `plan_focus_invalid` refusal.
  - `cli-plan-verbs-missing` (3): X1–X3 CLI verbs.
  - `mcp-plan-tool-missing` (1): X5 MCP tools.
  - `registry-plan-rows-missing` (2): X6 registry + X7 generated docs.
  - `web-plan-ledger-missing` (1): X4 surface-divergence ledger.
- Zero `coordination_projection_poisoned` in the run — the fold seams poison nothing.

## Adjacent suites (green-unchanged, proven against regenerated HEAD baselines)

- `orchestrator-wake-red`: 36 tests / 6 pass / 30 fail — identical to the recorded baseline.
- `cross-deployment-knowledge-red`: 31 tests / 9 pass / 22 fail — identical to HEAD baseline
  (regenerated via `git stash` of this row's store edit); failing-test name lists byte-identical.
- `kg-activation-red`: 6 tests / 5 pass / 1 fail — identical to HEAD baseline, same method.

## NUL discipline

- `impl/src/coordination-store.mjs` inspected with `grep -an`/`sed -n`/`git diff` only; byte
  reads via `node -e` (python3 is a broken asdf shim here, exit 126).
- 3 NUL bytes, present in the original at 1184615/1184631/1184657, now at
  1190708/1190724/1190750 — a uniform +6093 shift from strictly-preceding additive edits; the
  NUL-bearing template-literal cacheKey region itself is untouched.

## Judgment calls (recorded)

1. **Transition version discipline** (suite-derived, L3/L5/M4/M5): a transition admits when
   `expectedTaskVersion === task.taskVersion`; the OUTCOME version is `expected + 1` for
   `-> doing` and `-> todo` (a claim/re-open starts the next versioned round) but `expected`
   for `-> done` — immediate completion marking at the observed version, never a hidden bump.
   Encoded in `transitionOutcomeVersion` and mirrored by the upsert CAS (`current + 1` for an
   existing task, `1` for an absent one).
2. **Check order amended from H4.3**: shape → same-digest prior replay return (M2) → plan/task
   lookup → version-CAS → authority → reopen law → blockedBy gate → status law →
   changed-content-under-spent-key (`plan_replay_conflict`, M3). The CAS runs BEFORE the
   changed-content adjudication because L7's stale focus upsert reuses a spent key with
   different content and must learn `plan_stale_version`, not `plan_replay_conflict`.
3. **Auto-demote carrier**: the demote of the subtree's current doing task rides the same
   `plan.task_transitioned` kind inside the registered `plan_auto_demote` batch (the contract's
   kimi behavior, DR-3/H4.1) — no separate event kind was invented.
4. **`PROJECTION_INPUT_NONKG_EVENTS` fence untouched**: plan.* events do not feed the
   task/workflow horizon caches, so the non-KG fence list is deliberately NOT extended. If the
   surface leg later needs plan events in a horizon, that is its call, not this row's.
5. **`_campaignPlans` naming**: the contract's `_plans`/`_planTasks` projection names are
   already taken by the goal-plan fold in the store; naming-only deviation, shape is D1.
6. **Wave-close evidence links** cite `{coordinationSeq: <wave.closed seq>}` — the closed
   evidenceRef shape (G7) requires exactly one of `coordinationSeq`|`artifactId`, and the
   closure's seq is the durable, event-seq-anchored fact (no clocks).

## DECISION_REQUEST — authority-class ambiguity (the coordinator wave binding)

`inferPlanAuthority` maps the string seat `worker:coordinator-wave<N>` to the wave
`wave:w<N>` by string-seat convention. This is a FALLBACK: the contract (D2/H2.1) does not name
a durable binding source for a coordinator's wave scope, and G8 excludes the `plan:*` power
class from every worker seat. Options for the surface leg / a ruling:

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

This row implements (a) behind `inferPlanAuthority` so the surface leg can swap (b)/(c) in one
place. Refusals that hinge on the class boundary (`coordinator_authority_forbidden` with
`gracefulPath: 'DECISION_REQUEST'`) carry the marker in their detail.

## Verification commands run

- `node --check` on both files — clean.
- `node --test --test-reporter=tap test/orchestrator-plan-object-red.test.mjs` (cwd `impl/`) —
  8 pass / 39 fail, exactly as scoped above.
- Adjacent suites as listed above, baseline-diffed.
- **Direct smoke of the wave-close elevation hook** (suite rows W1/W2 block on the plan.write
  port, so the hook had no runnable row at HEAD; exercised through the public store API from a
  /tmp test outside the row partition, fixture idioms mirrored from the suite's F-rows —
  3 pass / 0 fail):
  - done task at wave close stays done and gains the durable
    `{coordinationSeq: <wave.closed seq>}` evidence link, marked in place (no version bump);
    the doing task in the same wave demotes to todo at taskVersion 2, riding a durable
    `plan_auto_demote` batch; close/reopen replays the identical `planObjects` projection.
  - a plan-free ledger closes with exactly one event (the closure) and a snapshot with NO
    `planObjects` key — HEAD ledgers are byte-unaffected.
  - a wave:w2 task is untouched by a wave:w1 close (the hook's wave filter).
- No push; no destructive commands; suite file untouched (`git status` shows only
  `impl/src/coordination-store.mjs` modified + `impl/src/orchestrator-plan.mjs` untracked +
  these notes).
