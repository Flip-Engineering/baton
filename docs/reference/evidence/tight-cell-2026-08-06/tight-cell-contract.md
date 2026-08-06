# Epic #102 — Tightly-coupled member groups (the cell) implementation contract (v1.1)

Attempt salt: `sw20260806011217` (idempotency key `sw20260806011217-cell-note`)
Date: 2026-08-06
Status: **DRAFT v1.1** — implementation contract, not an amendment to implementation.

**v1.1 fold note:** this revision folds the adversarial red team of 2026-08-06
(`contract-redteam.md`, verdict NOT FOLD-READY — 9 blockers, 7 major). Every anchor the red
team re-derived was re-verified against the working tree for this fold. The folds: the quorum
substrate is named as kernel work with an exact cell-aggregate derivation (Decision 6); the
`group.exact` self-contradiction is resolved by `group.seat` + `group.strict` — no
boolean-overloaded field anywhere (Decisions 1, 6); the collective result gains a derivation
law — the designated collector (Decision 7); the spawn mechanism is pinned to a named plan-mint
branch with its intent seam, node keys, and budget story (Decision 2); the grant-mint key
collision, the broadcast reply collapse, and the fence/delivery-mode losses are pinned
(Decisions 4, 5); the trust-gate division-of-labor mechanism is chosen with the #88 preflight
in mind (Decision 2); the failure vocabulary is regenerated from the composed code paths
(Decision 8); and the red suite gains the missing coverage rows (TC-20..TC-26). The
blocker → change map is `contract-fold.md`.

## Seed

The frontier sweep's collaboration-layer friction row: *"Workers can't see each other
cross-run (peer reads within a workflow)"* is filed as **#96** (the per-run horizon) and
**#102** (tight cells sidestep it by construction)
(`docs/reference/evidence/frontier-sweep-2026-08-03/orchestrator-friction-ledger.md:36`).
The REPL-level row names *#102's group bindings* as the object-passing answer
(`orchestrator-friction-ledger.md:44`). A **tight cell** is `N` same-seat agents bound as
**ONE** wave member: one `runId`, one run-scoped horizon, one collective result. The cell is
the executor unit #74's worker-orchestrated triage loop expects — a coordinator-worker
decomposes work, swarm members (the cell) execute it, the coordinator triages through
claim/report (`board-workerhalf-contract.md:16-23`).

The campaign control law is binding here: controls over agent work are eval-able,
constructive, or conversational — never clocks or turn limits. Count-based bounds and
event-vocabulary liveness only. Scanners stay shape-only; `localeCompare` is banned;
sorted-key closed-shape literals appear in ACTUAL sorted order; byte caps name cap+actual and
prefer graceful spillover (the #89 doctrine). Therefore this contract adds no per-worker TTL,
cell timeout, poll deadline, or turn budget — the cell's liveness and terminal semantics are
event/count-derived.

## Code-verified ground truth

Every anchor below was re-verified **this session** (2026-08-06) with NUL-safe `grep -an` and
targeted `sed -n` reads. `impl/src/application.mjs`, `impl/src/coordinator.mjs`, and
`impl/src/coordination-store.mjs` contain NUL bytes and were never opened whole.

1. **A wave member is validated as a closed shape, one run per member.** `validateMember`
   (`impl/src/wave.mjs:50-105`) checks `role` (non-empty string, `"work"` reserved,
   `wave.mjs:55-59`), `objective` (non-empty string), `scope` (array 1..64, unique, no bare
   directories, `wave.mjs:63-89`), and the optional `exact` closed route
   `{harness, model, effort}` with **no unknown keys** (`wave.mjs:90-97`). Manual routing
   requires `model` and `effort` together (`wave.mjs:98-103`). The members array is bounded
   1..64 and roles must be unique (`wave.mjs:163,169`).

2. **`createWave` starts exactly one run per member.** The member loop
   (`wave.mjs:193-212`) calls `baton.runs.start(member.objective, {...route, scope,
   driverKind:'wave', waveId, waveRole, waveStart:{roster, idempotencyKey}})` — one run per
   member, each recording `steering.registered` (`application.mjs:4515-4530`) with `waveId` +
   `waveRole`, and the pre-loop `wave.started` mint deduped by idempotency key
   (`application.mjs:4528-4542`). The wave handle's `runs` getter maps `role -> run`
   (`wave.mjs:504-507`). There is no group concept anywhere in `wave.mjs` today (verified:
   zero `cell`/`group` matches in `wave.mjs` and `impl/test/wave-driver-red.test.mjs`).

3. **The transport `waves.start` member schema is closed on FOUR keys, and member-level
   `exact` is REQUIRED today.** `objectSchema(properties, required)`'s second argument is the
   REQUIRED array, not the closed-key set; the closure comes from `additionalProperties:
   false` (`application-semantics.mjs:145-147`). The member item
   (`application-semantics.mjs:1572-1579`) declares four properties — `role`, `objective`,
   `exact`, `scope` — with `required: ['role', 'objective', 'exact']`: `scope` is admitted
   (optional), and member-level `exact` is required at the transport schema seam.
   `_normalizeWaveStart` (`application.mjs:11583-11630`) is closed on the same four keys
   (`application.mjs:11598`), shape-checks the objective only (the
   `wave.member.objective` byte law admits oversize with spill — `limits.mjs:57`), rejects a
   NUL byte in the objective, and independently requires member-level `exact`
   (`!member.exact || ...` refuses, `application.mjs:11601-11603`). Bare member-level
   `harness`/`model`/`effort` keys are refused as unknown keys at both transport seams.
   `startWave` (`application.mjs:11437-11472`) starts each member through the ORDINARY
   `run.start` admission and returns the detached `{waveId, members:[{role, runId}]}` shape.

4. **The one-run-many-workers binding exists today, via composition — and it is
   heterogeneous by construction.** `runWorkerOwnership(driver, runId)`
   (`application.mjs:2269-2284`) filters `coordinator.list()` by
   `task(handle.taskId)?.runId === runId`, bounded by `MAX_RUN_VIEW_WORKERS = 1_024`
   (`application.mjs:53`), and the run outline projects
   `ownership: {workers: ownedWorkers.length, workerIds: [sorted], closed}`
   (`application.mjs:5795-5796`; also `7341-7342`, `7767-7768`). The composition path mints
   `intent.composition.team.map((member) => ({...clone(singleNode), key: 'attempt:${member.role}',
   routes: exactPlanRoutes(member.route)}))` — N plan nodes under ONE run, but each with its
   **own** route (`application.mjs:4481-4491`). The cell is the homogeneous sibling: N workers,
   the SAME seat, ONE runId — a node set with identical routes and no role catalog.

5. **The run-scoped horizon is keyed by `runId`.** `_runHorizonNodeIds(runId)`
   (`coordinator.mjs:11060-11078`) is the closure of {the run's own KG nodes, nodes promoted
   under that runId, findings whose evidence cites the run's task/elevation events}. Every
   context-read kind intersects its results with this predicate AFTER lookup
   (`coordinator.mjs:10634-10657`); a foreign node refuses `context_scope_forbidden`
   (`coordinator.mjs:10653-10657`). The **workflow horizon (run-scoped)** tier
   (`docs/34-knowledge-horizons.md:51-52`) names the run-scoped contents — "all boards,
   packages, cells, REPL bindings, reports, and decision settlements for one run" — which the
   doc describes as the orchestrator's working memory "for a wave"; the predicate itself is
   run-scoped, and this contract's reading is run-scoped. Because a cell shares ONE `runId`,
   every cell worker's `taskId` is in `runTaskIds` (`coordinator.mjs:11063`), so every
   run-scoped node is readable by every cell worker — and a node promoted under a different
   run is not. This is the shared-horizon law, and it is exactly why the cell sidesteps #96 by
   construction.

6. **The C5 bounded broadcast delivers to every worker of a `runId`.**
   `sendMessage({kind, to, body})` (`coordinator.mjs:6793-6898`) accepts `kind ∈
   {inform, query, steer}` and a target that is EXACTLY `{workerId}` or `{runId}`
   (`coordinator.mjs:6803-6808`). A `{runId}` target broadcasts to
   `[...this._workers.values()].filter((handle) => this._tasks.get(handle.taskId)?.runId ===
   to.runId)` (`coordinator.mjs:6835`). The receipt is the broadcast receipt:
   `{ok:true, result:'sent', messageId, delivered: deliveries.filter((row) => row.ok).length,
   targetCount: workers.length}` (`coordinator.mjs:6893-6897`), with a per-worker
   `record.deliveries` Map (`coordinator.mjs:6841`). Delivery is hardcoded `'nudge'`
   (`coordinator.mjs:6868`). The body is graceful-spilled between
   `message.send.body` (2,048 bytes) and `spill.body` (1 MiB); beyond the ceiling draws the
   coaching refusal `spill_body_exceeded` (`limits.mjs:54,85`). The frame carries `messageId`
   for `inReplyTo`: the messageId mint is `coordinator.mjs:6838`; the
   `[MESSAGE ${kind} ${messageId} — UNTRUSTED]` frame wrap is `coordinator.mjs:6865-6866`
   (the #92 comment at `coordinator.mjs:6855-6857`).

7. **The current `waves.send` lane targets ONE worker per `runId`, not the C5 fan-out.**
   `sendWaveMember` (`application.mjs:11516-11579`) resolves
   `this.driver.coordinator.list().find((worker) => worker.runId === request.runId)`
   (`application.mjs:11523-11524`) — the FIRST worker — and `mintMemberBoardGrant`
   (`coordinator.mjs:11229-11251`) does the same `.find(...)` (`coordinator.mjs:11231`). For a
   cell this is a gap: a send/steer/claim-grant addressed to the cell's `runId` must reach
   ALL N workers.

8. **The board claim/report worker-half (#78, landed) is grant-scoped and per-worker.**
   `mintBoardGrant(entry, auth)` (`coordination-store.mjs:14892-15009`) has a closed entry
   shape (`coordination-store.mjs:14894`), proves the orchestrator's S-2 session lease,
   checks the board's `_boardRunBindings` binding at the mint's own seam
   (`coordination-store.mjs:14940`; the sibling read/admission paths check it at
   `coordination-store.mjs:14293,14783`), proves the **member coordinates** —
   `_taskByRun(memberRunId).assignee === workerId && taskVersion && status === 'working'`
   (`coordination-store.mjs:14949-14951`) — the worker generation record, and the
   **wave-membership** proof: both the member Run and the board Run must be
   steering-registered members of the SAME live wave, the sole cross-Run relaxation
   (`_waveMembershipOf`, `coordination-store.mjs:15018-15026`). The grant payload is closed:
   `{schemaVersion:1, grantId, grantDigest, waveId, board, boardRunId, memberRunId, workerId,
   taskId, taskVersion, processGeneration, permissions, state:'active', mintedEvent}`
   (`coordination-store.mjs:14998-15003`). Permissions are the orchestrator-selected subset of
   `read|claim|report`, selected by wave role: `coordinator-worker -> ['read']`, else
   `['read','claim','report']` (`coordinator.mjs:71-74`). Every mutation/read rebinds the
   grant to the authenticated worker stream and all recorded member coordinates; the grant's
   `workerId/taskId/processGeneration` must match the caller (`boardGrantPage`,
   `coordination-store.mjs:15037-15062`).

9. **The board grant rides `waves.send` claimGrant, server-side, persist-before-deliver.**
   `sendWaveMember` mints via `mintMemberBoardGrant` (`coordinator.mjs:11229-11251`), which
   resolves the member Run, selects permissions by `permissionsForWaveRole`
   (`coordinator.mjs:11244`), and appends `board.grant_minted` BEFORE the steer is deliverable
   (`application.mjs:11540-11546`). The delivered worker fact carries a `[BOARD_GRANT]` JSON
   block and never S-2 lease material. A worker reads the shared board through its authenticated
   L1 lane: `CONTEXT_READ: {"query":{"kind":"board","grantId":"...","cursor":null}, ...}`
   (`coordinator.mjs:10670-10693`) — the query carries no board/run/worker; those are derived
   from the active grant. Claim and report are worker-profile ops; claim CAS is
   `expectedBoardFence`, report CAS is `expectedClaimVersion` (`board-workerhalf-contract.md`,
   Decision 4); a report never closes an item — only the S-2 orchestrator transitions do.

10. **Quorum/terminal machinery exists per member, never per worker-count.** The wave driver
    treats a member terminal when `outline.terminal === true || applicationTerminal(phase) ||
    phase === SUCCESS_RESTING` (`wave-driver.mjs:535`); `SUCCESS_RESTING` is the phase
    `'result_ready'` (`wave-driver.mjs:27`) and `applicationTerminal` is the closed set
    `{completed, failed, cancelled, stopped, denied}` (`application-semantics.mjs:100-108`).
    `settle` materializes one outcome per member (`wave.mjs:427-445`); a member whose run never
    started is an outcome `{phase:'failed', terminalCause:'start', terminal:true}`
    (`wave.mjs:430-431`). The driver receipt's `basis ∈ {completed, stall, hard_cap, aborted}`,
    where `'completed'` means all members exited in any phase including failed/cancelled
    (`docs/37-wave-driver.md:84-88`). There is **no quorum law** anywhere in the wave machinery
    today — the cell introduces it.

11. **One run, one result section — and today that section is the FIRST worker's capture.**
    `materialize` (`wave.mjs:390-406`) reads the run's `result` section first
    (`run.inspect({depth:'section', section:'result'})`), falling back to the checkpoint-pin
    disambiguation only when `repoRoot` is passed. The run-view builder builds that result from
    `coordinator.result(workerId)` where `workerId` is `projection.nodes[0]`'s task assignee
    (`application.mjs:7393-7404`) — the run result is the FIRST worker's result, not a shared
    one. Each task gets its OWN worktree (`this._worktrees.create(task.id, ...)`,
    `coordinator.mjs:3573`), so N workers under one runId produce N divergent trees and
    nothing merges them. "The collective result is the run result" is false as a machinery
    claim until Decision 7 names the derivation.

12. **Byte ceilings that bound a cell's view.** The run outline is bounded by
    `MAX_RUN_VIEW_BYTES` (`application.mjs:52`); the wave progress snapshot by
    `MAX_WAVE_PROGRESS_BYTES` (`wave.mjs:21`); the worker count per run view by
    `MAX_RUN_VIEW_WORKERS = 1_024` (`application.mjs:53`). The member objective is bounded by
    `wave.member.objective` = 4,096 bytes with graceful spill to `spill.body` = 1 MiB
    (`limits.mjs:57,85`). A cell of `size` workers projects `size` rows in the run view and
    `size` worker deliveries in a broadcast receipt — all three ceilings must hold.

13. **The run-view builders derive run truth from the FIRST plan node only.** Both the live
    run-status builder (`application.mjs:7393-7430`) and `_historicalProfileView`
    (`application.mjs:5680-5700`) read `projection.nodes[0]` alone: phase, terminal, result,
    and terminalCause are the first node's, and `coordinator.result(workerId)` is the first
    node's worker's capture. For any multi-node run — composition today, a cell tomorrow —
    first-node truth is not run truth. The cell's quorum law (Decision 6) is impossible until
    this builder aggregates; that amendment is kernel work and Decision 6 owns it.

14. **A message record admits exactly ONE reply.** The reply lane refuses
    `message_depth_exceeded` when `parent.depth >= 1 || parent.reply`
    (`coordinator.mjs:12467-12470`) and stores the reply in a single slot (`parent.reply =
    replyEnvelope`, `coordinator.mjs:12511`); the envelope carries `from: workerId`
    (`coordinator.mjs:12508-12511`), so attribution exists but exclusivity is one reply per
    message. All N recipients of a `{runId}` broadcast share ONE `messageId`.

15. **Board grant mints are idempotency-indexed by the RAW caller key.** `_boardGrantMints`
    is replay-derived from `grant.mint:<grantDigest>:<callerKey>` event keys
    (`coordination-store.mjs:8755-8768`) and checked at mint time
    (`coordination-store.mjs:14992-14995`): an exact retry replays, a changed request under the
    same caller key refuses `board_replay_conflict`. The mint's effective event key is derived
    at `coordination-store.mjs:14979-14984`. The worker-op lane already namespaces by
    grantDigest — `<op>:<grantDigest>:<callerKey>` (`coordination-store.mjs:14795`, idiom
    comment `coordination-store.mjs:14734`) — the mint lane does not.

16. **The trust gate and the #88 preflight are per-worker, per-task.** Each task's worktree
    is captured by `_captureTrustWorktree(handle, task)` (`coordinator.mjs:2684-2694`); the
    `required_effect` verdict fires per claim when `!task.brief?.analysis &&
    task.brief?.requiredEffects?.includes('repository_edit')` and the fresh capture is
    diffless or in-scope-empty → `required_effect_absent` (`coordinator.mjs:12839-12849`) →
    `policy_failure` terminal (`coordinator.mjs:13719-13723`). `analysis: true` on a task
    brief is the EXISTING escape hatch documenting `repository_edit` as not-required (TG5,
    `coordinator.mjs:12839-12842`). The #88 claim-time liveness preflight
    (`coordinator.mjs:2615-2623`) mirrors the same would-fire test verbatim
    (`coordinator.mjs:2618-2620`) and stays per-worker.

## Decisions

### 1. The closed group field on a wave member — `{editing?, quorum?, seat, size, strict?}`

**Surface:** the `waves.start` member item (`application-semantics.mjs:1572-1579`),
`_normalizeWaveStart` (`application.mjs:11583-11630`), and `validateMember`
(`wave.mjs:50-105`).

**Shape (sorted-key closed literal):** `group` is an optional member field with the closed
shape:

```text
group: {editing?, quorum?, seat, size, strict?}
```

- `seat`: the closed exact-route object `{harness, model, effort}` — the SAME seat every cell
  worker is spawned with. Required when `group` is present. This is the homogeneity law: the
  cell is N workers of one seat. `seat` is a route object and ONLY a route object — no field
  in `group` is boolean-overloaded.
- `size`: integer, `2 <= size <= MAX_CELL_SIZE`. The number of same-seat agents. `MAX_CELL_SIZE`
  is a named, documented count-based circuit breaker set to `64` — the same bound as the wave
  member-array ceiling (`wave.mjs:163`), and comfortably under the run-view worker ceiling
  `MAX_RUN_VIEW_WORKERS = 1_024` (`application.mjs:53`) with headroom for the other run-view
  fields under `MAX_RUN_VIEW_BYTES` (`application.mjs:52`). A cell consumes ONE wave member slot;
  the per-run worker projection is what the size bound throttles.
- `quorum?`: optional integer, `1 <= quorum <= size`. The minimum number of cell workers that
  must reach a work rest for the cell to count as anything but failed. **Default `size`** —
  the strict default: any worker loss without a declared tolerance is `cell_below_quorum`.
- `strict?`: optional boolean, default `false`. When `true`, ANY member loss fails the cell
  with `cell_exact_breach` — the exact-size discipline, no degraded fallback (Decision 6).
  `strict: true` with `quorum < size` is a contradictory declaration and refuses
  `wave_group_invalid`.
- `editing?`: optional closed sorted array of member indexes (each an integer in
  `0..size-1`, unique; default ALL members). The trust-gate division of labor — members not
  listed carry `analysis: true` on their task brief (Decision 2).

**The schema inversion the refusal codes depend on:** member-level `exact` is REQUIRED at
both transport seams today (ground truth 3). The group design inverts it: the `waves.start`
schema row drops `exact` from the member item's `required` array and adds `group` to its
closed property set; the exact-XOR — **`group` present ⟺ member-level `exact` absent** — is
enforced in `_normalizeWaveStart` and `validateMember`, because the static `objectSchema`
helper (`application-semantics.mjs:145-147`) cannot express the XOR. Without this inversion a
group member without member-level `exact` would die in schema validation with a generic shape
error before any cell vocabulary can fire. Seam ownership is pinned: member-level `exact`
alongside `group` refuses `wave_group_route_conflict` at BOTH seams; bare member-level
`harness`/`model`/`effort` keys remain unknown-key refusals at the transport seams (the
closed member key set becomes `['role', 'objective', 'exact', 'scope', 'group']`) and refuse
`wave_group_route_conflict` only at the `createWave`/`validateMember` library seam
(`wave.mjs:98-103`). When `group` is present the group's `seat` is the single source of
truth.

**Refusal vocabulary:** `wave_group_invalid` (shape — including the `strict`/`quorum`
contradiction and out-of-range `editing` indexes), `wave_group_seat_missing` (group without
`seat`), `wave_group_route_conflict` (member-level route alongside `group.seat`),
`wave_member_role_reserved` unchanged. Validation is shape-only; no clock, no turn, no TTL.

**Rationale:** the member array bound (`wave.mjs:163`), the exact-route discipline
(`wave.mjs:90-97`), and the closed-shape conventions (`_normalizeWaveStart`,
`application.mjs:11598`) are all existing, verified seams. The group is additive to all three.
`size` is a count bound (allowed by campaign law); `quorum` is a count bound; `seat` reuses the
proven closed route validator; `strict` is the exact-size flag the red team required to be
un-overloaded; `editing` is the division-of-labor declaration the trust gate consumes.
Heterogeneous cells (per-worker route variation) are deliberately NOT v1 — the group's `seat`
is the single seat.

### 2. The N-spawns-one-run binding — identity and per-worker receipts

**Surface:** the wave start path (`wave.mjs:193-212`, `application.mjs:11437-11472`), the
run-start intent normalization (`application.mjs:1399-1462`, allowed keys at
`application.mjs:1399-1404`), the run-start plan mint (branch point
`application.mjs:4479-4491`; the workflow record the cell must NOT mint
`application.mjs:4551-4583`), and the trust-gate propagation (`coordinator.mjs:12839-12849`,
`coordinator.mjs:2615-2623`).

**Shape:** a cell member starts ONE run (unchanged `driverKind:'wave'` + `waveId` + `waveRole` +
`waveStart`), and that run's plan carries `size` homogeneous node entries instead of one `work`
node. The mechanism is a NEW, named branch in the run-start plan mint — **the cell branch** —
admitted by a new closed intent field `cell` (carrying the group's `{seat, size, quorum,
strict, editing}`) added to the intent-normalization allowed keys
(`application.mjs:1399-1404`); today that seam rejects any cell/group intent field, and
`startWave`/`_normalizeWaveStart` reject a member `group` key as unknown. The composition
idiom (`application.mjs:4481-4491`) proves the PROJECTION layer can hold N nodes under one
run, but it is NOT the cell's spawn path: it unavoidably builds the workflow role catalog, the
`attempts` block, strategy/workspace/join, and the v3 workflow record
(`application.mjs:4551-4583`), and divides `workflowNodeBudget(profile, team.length, ...)`
across the team (`application.mjs:4487-4489`, defined `application.mjs:1586`) — all of which
the cell forswears. The cell branch pins, exactly:

- node keys `cell:${waveRole}:${index}` for `index` in `0..size-1` — distinct, stable,
  sorted;
- the SAME objective (the member objective) on every node — the cell is homogeneous; labor
  divides through the board (Decision 4), never through per-node objectives;
- IDENTICAL `routes: exactPlanRoutes(group.seat)` on every node;
- NO role catalog, NO `attempts` block, NO strategy/workspace/join, NO v3 workflow record —
  the cell is not a workflow, and the plan mint's workflow block
  (`application.mjs:4551-4583`) is never entered for a cell;
- NO budget division: `workflowNodeBudget` is workflow-specific; cell nodes are funded
  exactly as today's single-node runs — the cell adds no numeric execution ceiling (campaign
  law).

Each node dispatches to its own task + worker; every task carries `task.runId === cellRunId`.
Identity is therefore:

- one runId (the cell member's run),
- `size` distinct `workerId`s, each with its own `taskId` and `taskVersion`,
- the run view projects `ownership: {workers: size, workerIds: [sorted], closed:false}`
  (`application.mjs:5795-5796`),
- `steering.registered` records the run ONCE with `waveId` + `waveRole`
  (`application.mjs:4515-4530`) — the cell is one wave member.

**Trust-gate propagation (the `required_effect` law for divided cells):** the trust gate is
per-worker, per-task (ground truth 16): under a `repository_edit`-required profile EVERY cell
worker's own capture must carry an in-scope diff, or that worker is policy-killed
(`coordinator.mjs:12839-12849`, `coordinator.mjs:13719-13723`) — and Decision 6 counts the
kill as a cell loss. An honestly-divided cell (a member whose share only reads/claims/reports
through the board) would be policy-killed for doing exactly its share. The chosen mechanism —
picked with the #88 preflight in mind — is the brief-level division, not a union verdict: the
cell branch sets `analysis: true` on the task brief of every member NOT listed in
`group.editing` (the existing TG5 escape hatch, `coordinator.mjs:12839-12842`), so the gate's
would-fire test and the #88 preflight's arm-check (`coordinator.mjs:2618-2620` — a verbatim
mirror of the gate's test) both compose UNCHANGED and per-worker. The cell's union capture
satisfies the effect through the listed members: each EDITING member's own capture must carry
the in-scope diff, and an idle editing member is still policy-killed loudly — the safe
direction is preserved. A dynamic or union gate verdict (one member's verdict depending on a
sibling's capture) is NOT v1 — the per-claim gate stays per-worker.

**Receipts per worker:** the wave handle for a cell member exposes a `cell` sub-view alongside
the run handle: `{role, runId, size, workers: [{workerId, taskId, taskVersion, spawnError}]}`.
A worker whose spawn refused (capacity, session, policy) is recorded as a per-worker
`spawnError` — never a run failure. A run is only `startError` when the run itself never
started (unchanged, `wave.mjs:208-210`).

**Refusal vocabulary:** `cell_spawn_refused` (per-worker spawn refusal, recorded, not thrown),
`wave_cell_start_invalid` (the run-level admission refuses a malformed cell request).

**Rationale:** the composition machinery already proves one run can hold N tasks/workers under
one `runId` (`application.mjs:4481-4491`, `application.mjs:2269-2284`); the cell uses the same
store-admitted shape (N tasks on one runId, one worker per task — a second claimant refuses
`already_assigned`, `coordination-store.mjs:12546-12565`) through its own plan-mint branch,
minus the per-role heterogeneity and the workflow record. Per-worker receipts keep the honest
truth — a lost worker is a typed per-worker fact, never a silent run failure.

### 3. The shared-horizon law — cell members read the same run-scoped tiers

**Surface:** the run-scoped context read (`coordinator.mjs:10634-10657`,
`_runHorizonNodeIds`, `coordinator.mjs:11060-11078`).

**Law:** every cell worker shares the cell `runId`; therefore every cell worker's `taskId` is in
`runTaskIds` (`coordinator.mjs:11063`), so the run-horizon predicate admits every run-scoped KG
node for EVERY cell worker — the run's own nodes, nodes promoted under the runId, and findings
citing the run's tasks/events (`coordinator.mjs:11064-11077`). A node promoted under a DIFFERENT
run is not in the horizon and refuses `context_scope_forbidden` (`coordinator.mjs:10653-10657`).

**Consequences:** a cell needs no re-seed workaround to share knowledge — the demo's elevate +
re-seed workaround (`orchestrator-friction-ledger.md:36`) disappears for cell members. Cross-cell
sharing (a node promoted under cell A readable by cell B) is #96 territory and is NOT v1.

**Documentation note:** `docs/34-knowledge-horizons.md` already uses "cells" for package
content units (`docs/34-knowledge-horizons.md:51,73-74` — "each wrapped cell mints a `Source`
KG node"). The docs sweep must disambiguate: the tight cell (this contract) is a wave-member
binding; the package cell is a content unit. Docs prose says "tight cell" or "wave cell" where
the two could meet; code identifiers follow this contract unqualified.

**Refusal vocabulary:** `context_scope_forbidden` (unchanged, `coordinator.mjs:10653-10657`) for
any read outside the shared run horizon.

**Rationale:** this is the entire point of the cell per the seed (`orchestrator-friction-ledger.md:36`).
It costs no new machinery — the runId-scoped horizon already exists and already admits all of a
run's tasks' nodes. The cell simply makes N workers share one runId.

### 4. Self-division via board claim/report — per-worker grants on the shared cell board

**Surface:** `waves.send` claimGrant (`application.mjs:11535-11557`), `mintMemberBoardGrant`
(`coordinator.mjs:11229-11251`), `mintBoardGrant` (`coordination-store.mjs:14892-15009`),
`boardGrantPage` (`coordination-store.mjs:15037-15062`), the grant-mint idempotency index
(`coordination-store.mjs:8755-8768`, `14992-14995`), and the worker claim/report lane
(`board-workerhalf-contract.md` Decisions 1, 4, 5).

**Shape:** the cell divides work through ONE shared board bound to the cell `runId` (or a
designated same-wave coordination Run — the sole cross-Run relaxation, the wave-membership
proof `coordination-store.mjs:15018-15026`). A `waves.send(..., claimGrant:{boardRunId,
board})` to the cell `runId` mints **one grant PER cell worker** — `size` grants, each bound
to its own `(workerId, taskId, taskVersion, processGeneration)` and all sharing
`memberRunId = cellRunId`, `boardRunId`, `waveId`. Each grant's permission subset follows
`permissionsForWaveRole` (`coordinator.mjs:71-74`). Each worker then:

1. `CONTEXT_READ` the shared board through its own grant
   (`coordinator.mjs:10670-10693`),
2. `board.claim` an item against `expectedBoardFence`,
3. work + `board.report` against its active claim version + exact observed item digest.

**Gap the cell closes:** the current grant mint resolves the member task by `_taskByRun(runId)`
(`coordination-store.mjs:15011-15016`) — the FIRST task of the run — and the coordinator
wrapper resolves the target worker by `.find((worker) => worker.runId === runId)`
(`coordinator.mjs:11231`). Both are single-worker assumptions. For the cell, the mint must
resolve the SPECIFIC member task by `(runId, workerId, taskVersion)`, not first-by-runId. The
report CAS (active-claim owner `(workerId, ownerTask)` + `expectedClaimVersion`,
`coordination-store.mjs:14854-14860`) already prevents a second cell worker from reporting
against the first worker's claim (`board-workerhalf-contract.md` Decision 4).

**Per-member mint keys (the idempotency law):** `_boardGrantMints` is indexed by the RAW
caller key (ground truth 15): `size` per-worker mints under ONE `waves.send` idempotencyKey
produce different requestDigests (workerId/taskId/grantDigest differ), so mint #2..N would
refuse `board_replay_conflict` (`coordination-store.mjs:14992-14995`). The mint lane therefore
derives a PER-MEMBER caller key — `<sendKey>:<workerId>` — for each of the `size` mints, the
same namespacing idiom the worker-op lane already uses (`<op>:<grantDigest>:<callerKey>`,
`coordination-store.mjs:14795`). Replay semantics are preserved verbatim: an exact retry of
the SAME member's mint under the same send key replays; changed content for the SAME member
under the same send key still refuses `board_replay_conflict`; distinct members under one send
key are distinct keys by construction.

**Grant delivery composes with the one-body broadcast:** the `size` minted grants ride the ONE
C5 broadcast body (Decision 5) as `size` `[BOARD_GRANT]` blocks, each labeled with its
`workerId`, sorted by member index; persist-before-deliver is unchanged
(`board.grant_minted` appends BEFORE the send is deliverable,
`application.mjs:11540-11546`). A worker consumes ONLY its own block. Foreign grant material
is inert — stated as the intent: every board lane rebinds the grant to the authenticated
worker stream and all recorded member coordinates (`boardGrantPage`,
`coordination-store.mjs:15037-15062`; the mint's member-coordinate proof,
`coordination-store.mjs:14949-14951`), so possession of a sibling's grantId is never authority
and draws the constant `board_worker_scope_refused`. One broadcast, one receipt, N per-worker
grants.

**Refusal vocabulary:** `board_worker_scope_refused` (constant pre-existence refusal for an
absent/foreign/generation-stale grant, `coordination-store.mjs:15037-15062`),
`board_replay_conflict`, `board_cursor_stale`, `board_item_not_open`, `conflict`,
`stale_board_fence` — all unchanged from #78.

**Rationale:** #78's grant is worker-bound by construction (`coordination-store.mjs:14949-14951`);
the cell only removes the single-worker resolution assumption and namespaces the mint key.
This is the "self-division" the brief demands: the cell is one member, but its workers divide
the member's work through the board envelope — mediated lateral coordination, never free
worker-to-worker messaging.

### 5. Broadcast receipts — waves.send to a cell runId reaches all N workers

**Surface:** `sendMessage` C5 runId fan-out (`coordinator.mjs:6835,6893-6897`), the reply
lane (`coordinator.mjs:12467-12470`, `12511`), `sendWaveMember`
(`application.mjs:11516-11579`).

**Shape:** a send/steer to a cell member routes through the C5 `{runId}` broadcast, not the
single-worker `.find(...)` lane. The receipt is the C5 broadcast receipt:
`{ok:true, result:'sent', messageId, delivered, targetCount: size}` where `delivered` is the
number of cell workers that acked and `targetCount = size` (`coordinator.mjs:6893-6897`). A
partial delivery (`delivered < size`) is an HONEST receipt, never an error — the message record
carries per-worker delivery truth in `record.deliveries` (`coordinator.mjs:6841`). The body
spill law is unchanged (`limits.mjs:54,85`); the frame carries `messageId` for `inReplyTo`
(`coordinator.mjs:6838`, wrap at `6865-6866`).

**The cell-broadcast reply law:** a message record admits exactly ONE reply today (ground
truth 14) — all N cell workers receive the SAME `messageId`, so the first reply would win and
the other N-1 would refuse `message_depth_exceeded`, a code that names depth rather than
contention. For a `{runId}`-targeted broadcast the reply slot becomes PER-MEMBER: each
delivered cell member's FIRST reply is admitted against that member's own per-member delivery
record (`record.deliveries`, `coordinator.mjs:6841`), and the record carries replies keyed by
`workerId` — attribution already exists (`from: workerId`,
`coordinator.mjs:12508-12511`). Depth stays 1 per member: a member's SECOND reply to the same
broadcast, and any reply to a reply, refuse `message_depth_exceeded`
(`coordinator.mjs:12467-12470`). A single-worker target has one member, so the non-cell lane
is byte-identical (TC-18).

**The fence CAS is dropped — stated, bounded, never presented as costless:** the current
`waves.send` lane is fence-checked (`expectedFence: target.fence`,
`application.mjs:11554-11555`; enforced in `coordinator.send`,
`coordinator.mjs:7256-7257`). `sendMessage` takes no fence, so a cell send carries NO
ordering/freshness CAS. v1 pins this as a known, bounded guarantee loss: the freshness story
for a cell send is the broadcast receipt plus the per-worker delivery records and the durable
per-worker `message.delivered` audit events; an orchestrator needing ordering awaits the
prior broadcast's receipt before issuing the next send.

**Honest delivery modes for cell targets:** the C5 broadcast hardcodes `'nudge'`
(`coordinator.mjs:6868`). A send to a cell runId therefore admits `delivery: 'nudge'` ONLY;
requesting `now` or `turn` for a cell target refuses `wave_cell_delivery_unsupported` at
`sendWaveMember` admission. Non-cell targets keep all three modes
(`application.mjs:11550,11559`).

**Refusal vocabulary:** `run_not_active` (no live worker under the runId,
`coordinator.mjs:6836`), `spill_body_exceeded` (beyond the spill ceiling,
`limits.mjs:85`), `wave_cell_delivery_unsupported` (non-nudge delivery mode for a cell
target), `message_depth_exceeded` (per-member reply law, unchanged code).
`cell_broadcast_partial` is NOT a code — it is the honest receipt shape
(`delivered < targetCount`).

**Rationale:** the C5 broadcast already exists and already produces per-worker receipts; the
cell makes the wave transport USE it for cell members instead of the single-worker lane
(`application.mjs:11523-11524`) — with the reply law, the fence loss, and the delivery-mode
restriction named rather than silently inherited. The orchestrator reads `delivered` vs
`targetCount` — the receipt is the broadcast truth, including when some workers are down.

### 6. Quorum terminal semantics — the cell-aggregate derivation (kernel work)

**Surface:** the run-status builder (`application.mjs:7393-7430`) and
`_historicalProfileView` (`application.mjs:5680-5700`) — the substrate; the wave driver
terminal predicate (`wave-driver.mjs:535`); `settle` outcomes (`wave.mjs:427-445`); the
driver receipt (`wave-driver.mjs:783-804`); the whole-run stop
(`application.mjs:4034-4070`); grant revocation (`coordination-store.mjs:8770-8775`).

**The substrate amendment — named as kernel work.** Today the run's phase, terminal, result,
and terminalCause derive from `projection.nodes[0]` ONLY (ground truth 13): worker #1 resting
would settle the whole cell run early, worker #1 dying would fail it outright, and `survived`
is uncountable from every previously-cited surface. This rung therefore amends the run-status
builder itself — **this is kernel work**, not wave-layer plumbing, and this contract says so —
to aggregate over ALL plan nodes of the run:

- **Cell members = the run's task set per runId.** Every task with `task.runId === cellRunId`
  — the same predicate as `runWorkerOwnership` (`application.mjs:2269-2284`) and
  `_runHorizonNodeIds`' `runTaskIds` (`coordinator.mjs:11063`) — one member per plan node
  (`cell:${waveRole}:${index}`, Decision 2).
- **Per-member state** is today's single-node phase/terminal/result logic applied PER NODE —
  each node's task → assignee → `coordinator.result(workerId)` — never the first node's
  state projected onto the run.
- **The cell aggregate** (closed, evaluable, event/count-derived):
  - `survived` = the count of members in a WORK-REST phase: the closed set `{completed,
    result_ready}` (`result_ready` is the wave driver's `SUCCESS_RESTING`,
    `wave-driver.mjs:27`). `stopped` and `denied` are NOT survivals — they are
    operator/authority endings and count as losses (an operator stopping 2 of 3 workers
    before they produce must never mint a dishonest completion).
  - `lost` = every terminal non-survivor — `failed`, `cancelled`, `stopped`, `denied`, and
    never-started (spawn-refused) — each receipted in `cell.lost` with its per-member cause
    (terminal phase, `policy_failure` code, or `spawnError`).
  - `live` = every member in no terminal phase.

**The cell's terminal law** — the member-level terminal the wave driver reads at
`wave-driver.mjs:535`; for a cell member it reads the AGGREGATE, never `nodes[0]`:

- `survived === size` → cell `phase: 'completed'` (terminal; the collective result
  materializes per Decision 7).
- `quorum <= survived < size` → the cell mints its terminal-ok outcome AT THE EVENT the count
  is reached: `phase: 'degraded'`, `cell.degraded: true`, `cell.lost` receipted. Members still
  live at mint are quiesced per the ordering law below — the outcome never mints while a
  member still writes.
- `lost > size - quorum` → quorum is unreachable (below-quorum-terminal): the cell mints
  `phase: 'failed'`, `terminalCause: 'cell_below_quorum'`, `resultSha: null` AT THE EVENT the
  count tips. A single death while quorum is still reachable does NOT fail the cell.
- `group.strict === true` and ANY member lost → `phase: 'failed'`,
  `terminalCause: 'cell_exact_breach'` — no degraded fallback.
- Otherwise (quorum still reachable, members live) the cell is NOT terminal: it waits on
  events, never on a clock.
- A worker that never started → `cell_member_lost` receipted in `cell.lost` with its
  per-worker `spawnError` (Decision 2).

The cell's outcome is ONE entry (the member role, `wave.mjs:427-445`) carrying:

```text
{ role, phase, terminal: true, narrative, resultSha, error: null,
  cell: { size, quorum, survived, lost: [{workerId, cause}], degraded: bool } }
```

**The quiescence ordering law (outcome mint ⟂ grant revocation ⟂ task terminality):** when
the cell outcome mints with members still live: (1) each live member's board grants are
revoked — `board.grant_revoked`; grants otherwise stay active until revocation or a
generation bump (`coordination-store.mjs:8770-8775`), and `boardGrantPage` checks no
member-task liveness; (2) each live member's worktree is captured CHECKPOINT-ONLY through the
existing seam (`_captureTrustWorktree`, `coordinator.mjs:2684-2694`) and receipted in the
cell receipt (Decision 7); (3) the whole-run stop reaps the remaining workers —
`_performRunStop` reaps ALL `targetWorkerIds` with strict completion accounting
(`remainingCount !== 0` throws, `application.mjs:4034-4070`; two-phase per worker,
`coordinator.mjs:7585-7588`); (4) the collective outcome mints. Never: an outcome minted
while a member still writes. The store-global single-writer lease
(`coordination_writer_busy`, `coordination-store.mjs:1256`) is never held by a cell member —
no writer-lease hazard maps to the cell.

**The liveness caveat, stated plainly:** quorum tolerates DEAD workers only and does not bound
waiting. A hung-but-alive straggler is neither `survived` nor `lost`; the cell cannot settle
while it could still tip either way, and "no partial-cell stop" means a straggler is reaped
only by stopping the WHOLE cell run (`application.mjs:4034-4070`) or by the wave driver's
pre-existing `stall`/`hard_cap` basis (`docs/37-wave-driver.md:84-88`) — clocks the wave
machinery already owns, not new cell vocabulary.

**Refusal vocabulary:** `cell_below_quorum`, `cell_member_lost`, `cell_exact_breach`, and the
terminal PHASE `'degraded'` (a phase value, not an error code). All are event/count-derived —
no clock, no turn limit.

**Rationale:** the wave driver's terminal predicate (`wave-driver.mjs:535`) and the settle
outcome loop (`wave.mjs:427-445`) are per-member; the cell's innovation is that ONE member's
terminal is a function of N worker terminals, and the strict default (`quorum = size`) honors
the campaign's no-arbitrary-limits law while still letting an operator declare tolerance. The
`degraded` phase is a distinct terminal so a downstream orchestrator can distinguish "the cell
finished with losses" from "the cell failed" — exactly the `basis` honesty of
`docs/37-wave-driver.md:84-88`.

### 7. The single collective result — the designated-collector law

**Surface:** `materialize` (`wave.mjs:390-406`), the settle outcome (`wave.mjs:427-445`), the
run-result derivation (`application.mjs:7393-7404`), per-task worktrees
(`coordinator.mjs:3573`), and the operator adoption seam (`application.mjs:956-960`,
handler `application.mjs:5045`; adoption projected per nodeKey at `application.mjs:7414`).

**Shape:** "the run result is shared across the run's workers" is false as a machinery claim
(ground truth 11): the run result is the FIRST worker's capture, and N cell workers produce N
divergent per-task worktrees with no merge. The derivation law for v1 is the **designated
collector**:

- The cell's member index 0 (`cell:${waveRole}:0`) is the collector. The collective result is
  the collector's captured result: the run's result section is minted from the collector's
  `coordinator.result(workerId)` + accepted-commit path (`application.mjs:7402-7414`), and
  `materialize` reads it unchanged (`wave.mjs:390-406`). `resultSha` in the cell's outcome is
  the collector's pin.
- Siblings' captures are CHECKPOINT-ONLY: each non-collector member's worktree capture is
  receipted in the CELL RECEIPT — the outcome's `cell` block carries
  `captures: [{workerId, taskId, captureDigest}]` for every member, sorted by member index —
  never merged, never surfaced as the run result.
- When the cell is `degraded`, the outcome names the covered survivors: `cell.collector`
  carries the collector's workerId and whether the collector survived. If the collector is
  lost but quorum held, `resultSha` is null and the receipt's per-member capture digests are
  the honest provenance; the EXISTING operator adoption seam (`run.adopt`,
  `application.mjs:956-960`; projected per nodeKey at `application.mjs:7414`) is the recovery
  lane — no new machinery.
- When the cell is `cell_below_quorum`/`cell_exact_breach`, `resultSha` is null and the
  outcome carries the typed cause. No per-worker result is surfaced at the wave level — the
  cell is one member.

**Rationale:** the designated collector (a) is chosen over a merge authority (b): no merge
machinery exists anywhere in the tree (the cell forswears the workflow join), and a merge
authority with a conflict story would be NEW kernel machinery the campaign law requires to be
eval-able. The collector law reuses the existing capture, result-section, and adoption seams
and makes provenance honest and cheap. The orchestrator assigns integration to member index 0
through the cell's brief and the board; the receipt's per-member digests keep every sibling's
work auditable without lying about the tree. One run, one result section
(`wave.mjs:390-406`), one member, one outcome (`wave.mjs:427-445`).

### 8. Failure vocabulary — the closed cell error/state code set

**Surface:** everywhere the cell touches a typed error or state.

The closed vocabulary (eval-able, constructive — no clocks, no turn limits), regenerated from
the composed code paths:

| code / phase | kind | meaning |
|---|---|---|
| `wave_group_invalid` | admission error | malformed `group` closed shape — including `strict: true` with `quorum < size` and out-of-range `editing` indexes |
| `wave_group_seat_missing` | admission error | `group` present without `seat` |
| `wave_group_route_conflict` | admission error | member-level route alongside `group.seat` |
| `wave_cell_start_invalid` | admission error | run-level cell request malformed |
| `wave_cell_delivery_unsupported` | admission error | `delivery: now\|turn` requested for a cell target — cell sends are nudge-only (Decision 5) |
| `cell_spawn_refused` | per-worker record | an individual worker spawn refused; never aborts the run |
| `cell_member_lost` | per-member receipt | a worker lost (spawn failure or terminal non-survival, cause receipted) before the collective rest |
| `cell_below_quorum` | terminal cause | `lost > size - quorum` — quorum unreachable (Decision 6) |
| `cell_exact_breach` | terminal cause | `group.strict: true` with any loss |
| `'degraded'` | terminal phase (a phase VALUE, not a code) | `quorum <= survived < size`; collective result materialized |
| `cell_broadcast_partial` | (not a code) | the honest receipt shape: `delivered < targetCount` |

Plus the unchanged machinery codes the cell composes — regenerated from the composed code
paths: the report owner-CAS codes TC-08's own oracle fires (`board_report_no_active_claim`,
`board_report_stale_claim_version`, `coordination-store.mjs:14854-14860`); the composed #78
admission codes (`board_grant_invalid`, `board_lease_required`, `board_session_mismatch`,
`board_run_closed`, `board_worker_command_invalid`, `board_claim_invalid`,
`board_report_invalid`); the board lane codes (`board_worker_scope_refused`,
`board_replay_conflict`, `board_cursor_stale`, `board_item_not_open`, `conflict`,
`stale_board_fence`); and the transport/context codes (`context_scope_forbidden`,
`run_not_active`, `spill_body_exceeded`, `message_depth_exceeded`,
`application_wave_start_invalid`, `application_run_view_oversize`).

**Rationale:** a closed, documented code set is the pre-condition for a red-first suite
(Decision 9). Every code is either an admission shape refusal, a per-worker record, or a
count/event-derived terminal — never a clock or turn limit.

### 9. The red-first suite is the pin the implementation must carry

**Surface:** `impl/test/` — suggested home `impl/test/tight-cell-red.test.mjs`, alongside
`wave-driver-red.test.mjs` and `board-workerhalf-red.test.mjs`. Every red row must fail against
today's machinery (no group field, single-worker send lane, first-by-runId grant mint,
raw-caller-key mint idempotency, one-reply-per-message, first-node run truth, per-worker
trust gate with no division mechanism, no quorum) and go green only on the cell
implementation.

**Rationale:** mirrors `board-workerhalf-contract.md`'s red-first acceptance discipline and the
campaign's explicit "controls are eval-able" law. Static/source assertions additionally pin the
"No Arbitrary Numeric Limits" law: any new numeric bound must name its cap + derivation.

## Non-goals

- **No cross-cell sharing** (a node promoted under cell A readable by cell B) — that is #96
  territory and is explicitly NOT v1. The shared-horizon law (Decision 3) is runId-scoped and
  closed.
- **No heterogeneous cells** — `group.seat` is the single seat; per-worker route variation is
  NOT v1.
- **No free worker-to-worker messaging inside the cell** — all coordination is mediated: the
  shared board (Decision 4), the shared run-scoped horizon (Decision 3), and the orchestrator.
  The directionality law of the bidirectional-v3 spine is unchanged.
- **No per-worker results at the wave level** — the cell is one member with one collective
  result (Decision 7). **No merge authority** — siblings' captures are checkpoint-only,
  receipted; no conflict-resolution machinery is introduced.
- **No per-cell grant** (one grant covering all workers) — grants stay per-worker; the grant's
  member coordinates require it (`coordination-store.mjs:14949-14951`).
- **No union or dynamic trust-gate verdicts** — the gate stays per-worker; the division of
  labor is declared statically via `group.editing` and the existing `analysis: true` brief
  hatch (Decision 2).
- **No fence CAS, and no `now`/`turn` delivery modes, for cell-targeted sends in v1** — the
  named, bounded guarantee loss of Decision 5; restoring either is a later rung.
- **No cell leader election, no nested orchestration, no coordinator-worker possession of
  `waves.send`** — unchanged from #78's non-goals (`board-workerhalf-contract.md:537-541`).
- **No cell worker recycling/migration mid-wave, no partial-cell stop** in v1.
- **No change to the non-cell path** — a wave with no `group` fields behaves byte-identically
  to today.
- **No new clocks, turn limits, cell timeouts, poll deadlines, or per-worker budgets.**
- **No implementation edits in this contract-authoring epic** — the implementation and red
  suite are subsequent campaign rungs.

## Red-first acceptance

Implementation begins by adding a focused red suite
(`impl/test/tight-cell-red.test.mjs`) and demonstrating that its positive rows fail against the
current machinery (no group validation, one-run-one-worker, single-worker send lane,
first-by-runId grant mint, raw-caller-key mint idempotency, one-reply-per-message, first-node
run truth, per-worker trust gate with no division mechanism, no quorum). Existing wave, board,
BD3, MCP, grammar, replay, and trust-gate suites remain unchanged and green; no existing
assertion is weakened to admit the new behavior.

| ID | Red state to prove first | Green acceptance oracle |
| --- | --- | --- |
| TC-01 | A wave member cannot declare a group today. | `waves.start` accepts the closed `group` field and `validateMember`/`_normalizeWaveStart` reject a malformed shape with `wave_group_invalid`. |
| TC-02 | A group without a seat is ambiguous. | `group` without `seat` refuses `wave_group_seat_missing` before any spawn. |
| TC-03 | Member-level route and group seat can conflict. | `group.seat` plus member-level `exact` refuses `wave_group_route_conflict` at BOTH transport and library seams; bare member-level `harness`/`model`/`effort` are unknown-key refusals at transport and refuse `wave_group_route_conflict` at the `createWave`/`validateMember` seam. |
| TC-04 | One member currently maps to exactly one run and one worker. | A cell member starts ONE run whose plan carries `size` homogeneous nodes keyed `cell:<waveRole>:<index>` with identical routes and objective and NO workflow record, role catalog, `attempts` block, or budget division; `run.status().ownership.workerIds.length === size` and every task's `task.runId === cellRunId`. |
| TC-05 | Cell workers are identity-collapsed today. | `size` distinct `workerId`s, each with its own `taskId` + `taskVersion`, all under the one `runId`; `steering.registered` records the run once. |
| TC-06 | A worker spawn refusal can abort the run. | A refused individual spawn records `cell_spawn_refused` per worker and the remaining workers run; the run itself never aborts. |
| TC-07 | Cross-run horizon gap: a node seeded in one run is invisible to another. | A node seeded under the cell runId is readable by EVERY cell worker (same run-scoped tiers); a node under a different run refuses `context_scope_forbidden` — the shared-horizon law. |
| TC-08 | The board grant mint is first-by-runId, single-worker. | A `waves.send(..., claimGrant)` to a cell runId mints `size` grants, each bound to its own `(workerId, taskId, taskVersion, processGeneration)` with `memberRunId = cellRunId`; a second worker cannot report against the first worker's claim (report owner CAS). |
| TC-09 | `waves.send` delivers to the first worker of a runId. | A send to a cell runId routes through the C5 runId fan-out and the receipt is `{ok:true, result:'sent', messageId, delivered, targetCount:size}`. |
| TC-10 | Partial delivery is a silent failure today. | A send with `delivered < size` returns the honest receipt (`delivered`, `targetCount:size`), no throw, per-worker delivery truth in the message record. |
| TC-11 | No quorum law exists. | size=3, quorum=2, 2 workers rest → cell `phase: 'degraded'`, `cell.degraded: true`, `cell.lost` lists the lost worker, `resultSha` non-null — derived from the aggregate (Decision 6), never `nodes[0]`. |
| TC-12 | A lost worker silently fails the member. | size=3, quorum=2, 1 worker rests and 2 are lost → quorum unreachable (`lost > size - quorum`) → cell `phase: 'failed'`, `terminalCause: 'cell_below_quorum'`, `resultSha: null`. |
| TC-13 | Exact-size discipline can silently degrade. | `group.strict: true` with any loss → `terminalCause: 'cell_exact_breach'`, never a degraded fallback. |
| TC-14 | A never-started worker is indistinguishable from a run failure. | A worker whose spawn refused is recorded `cell_member_lost` with its per-worker `spawnError`; the run itself is not `startError`. |
| TC-15 | The "collective" result is the first worker's capture with N-1 trees silently invisible. | Each of the `size` workers writes DISTINCT content in its own worktree; the wave outcome has exactly ONE entry for the cell role whose `resultSha` equals the COLLECTOR member's capture digest; the cell receipt carries every member's capture digest (`cell.captures`, sorted by member index); a `degraded` outcome names the covered survivors and whether the collector survived. |
| TC-16 | The implementation introduces clocks/turn limits. | Static/source assertions and event-driven tests show the cell vocabulary adds no time/TTL/turn field and no cadence-dependent truth. |
| TC-17 | A large cell overflows a bounded view. | A cell of `size <= MAX_CELL_SIZE` stays within `MAX_RUN_VIEW_BYTES` (`application.mjs:52`), `MAX_WAVE_PROGRESS_BYTES` (`wave.mjs:21`), and `MAX_RUN_VIEW_WORKERS` (`application.mjs:53`); a broadcast receipt carries exactly `targetCount = size`. |
| TC-18 | The cell changes non-cell behavior. | A wave with no `group` fields is byte-identical to today: same member schema, same single-worker send lane (fence CAS and all three delivery modes intact), same single-reply slot, same outcomes, same receipts. |
| TC-19 | The end-to-end #74 loop is not executable by a cell. | Live acceptance: a coordinator-worker posts granular items on a shared board, a cell of ≥2 same-seat members is granted, members read/contend/claim/report, the cell reaches `completed` (or honestly `degraded`), and the orchestrator closes the selected item with a single collective result — receipts keyed on durable ids/digests/events, never sleep duration, turn count, or polling count. |
| TC-20 | Worker #1's terminal settles or fails the whole run (first-node truth). | size=3, quorum=2: worker #1 resting while #2/#3 still run does NOT settle the cell (no outcome minted); worker #1 dying while quorum is still reachable does NOT fail the cell. The aggregate, never `nodes[0]`, is the terminal truth. |
| TC-21 | A broadcast admits exactly one reply; N-1 cell replies refuse `message_depth_exceeded`. | A cell broadcast admits EACH delivered member's FIRST reply, attributed by `workerId` against the per-member delivery record; a member's second reply, and any reply to a reply, refuse `message_depth_exceeded`. |
| TC-22 | N grant mints under one send key collide on the raw caller key. | `size` mints under one `waves.send` idempotencyKey all succeed (per-member caller keys — no `board_replay_conflict`); an exact retry of the same member's mint replays; a changed-content retry for the SAME member refuses `board_replay_conflict`. |
| TC-23 | An honestly-divided non-editing member is policy-killed by the per-worker gate. | With `group.editing` naming the editing members: a non-editing member producing no diff is NOT policy-killed (its brief carries `analysis: true`); an idle EDITING member still terminates `policy_failure`/`required_effect_absent`; the #88 preflight composes per-worker unchanged. |
| TC-24 | Cell sends silently inherit single-worker delivery guarantees. | `delivery: now\|turn` to a cell runId refuses `wave_cell_delivery_unsupported`; `nudge` is admitted; the send carries no fence CAS and the receipt plus per-worker delivery records are the freshness truth. |
| TC-25 | A quorum terminal can mint while a member still writes. | When the cell outcome mints with live members: live members' grants are revoked (`board.grant_revoked`) and their worktrees captured checkpoint-only and receipted BEFORE the outcome mints; the whole-run stop reaps the remainder with strict accounting. |
| TC-26 | Stopped/denied workers count as survivors. | size=3, quorum=2, an operator stops 2 workers before they rest → `survived = 1` → `lost > size - quorum` → cell `failed`/`cell_below_quorum`, never `completed`. |

The end-to-end TC-19 receipt must record: wave/member binding proof, the one runId + `size`
worker identities, the `size` grants with their member coordinates, worker-attributed claim and
report events, the broadcast receipt (`delivered`/`targetCount`), the collective terminal
(`completed`/`degraded`/`cell_below_quorum`), and the single collective `resultSha`. Its
assertions key on durable ids/digests/events and content/state predicates, never clocks.

## Open questions

1. **~~`group.exact` semantics~~ — RESOLVED in v1.1.** The route object is `group.seat`
   (`{harness, model, effort}`, homogeneity by construction); the exact-size discipline is the
   separate boolean `group.strict` (default `false`). No field is boolean-overloaded;
   `cell_exact_breach` keys on `group.strict === true` and is implementable (TC-13).
2. **~~Where the cell spawn lives~~ — RESOLVED in v1.1.** A dedicated cell branch of the
   run-start plan mint, admitted by a new closed `cell` intent field at the intent
   normalization seam (`application.mjs:1399-1404`), with node keys
   `cell:<waveRole>:<index>`, identical objectives/routes, no workflow record
   (`application.mjs:4551-4583` never entered), and no budget division. Composition is the
   proving idiom at the projection layer only, not the spawn path.
3. **Default quorum — RESOLVED, SOUND.** Strict (`quorum = size`) is the honest default and
   the rationale stands; v1.1 corrects the survivor set (`stopped`/`denied` count as losses,
   never survivals — Decision 6, TC-26).
4. **`waves.progress` projection — deferred (not blocking).** TC-15 already forces the one-row
   shape; the handle `cell` sub-view is additive.
5. **`MAX_CELL_SIZE = 64` derivation — deferred (not blocking).** Aligned with the wave
   member-array bound (`wave.mjs:163`) and well under `MAX_RUN_VIEW_WORKERS = 1_024`
   (`application.mjs:53`). If the red suite shows a smaller bound is needed to hold
   `MAX_RUN_VIEW_BYTES` (`application.mjs:52`) with a full run view, the number must be
   re-derived from the byte math and named.
