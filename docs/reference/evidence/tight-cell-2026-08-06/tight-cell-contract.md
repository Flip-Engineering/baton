# Epic #102 — Tightly-coupled member groups (the cell) implementation contract (v1.0 DRAFT)

Attempt salt: `sw20260806011217` (idempotency key `sw20260806011217-cell-note`)
Date: 2026-08-06
Status: **DRAFT v1.0** — implementation contract, not an amendment to implementation.

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
   (`wave.mjs:504-506`). There is no group concept anywhere in `wave.mjs` today (verified:
   zero `cell`/`group` matches in `wave.mjs` and `impl/test/wave-driver-red.test.mjs`).

3. **The transport `waves.start` member schema is closed.** `application-semantics.mjs:1566-1590`
   declares the ordinary-profile row with `inputSchema` members item closed on
   `['role', 'objective', 'exact']`; `_normalizeWaveStart` (`application.mjs:11585-11630`)
   is closed on `['role', 'objective', 'exact', 'scope']`, shape-checks the objective only
   (the `wave.member.objective` byte law admits oversize with spill — `limits.mjs:57`), and
   rejects a NUL byte in the objective (`application.mjs:11600`). `startWave`
   (`application.mjs:11437-11477`) starts each member through the ORDINARY `run.start`
   admission and returns the detached `{waveId, members:[{role, runId}]}` shape.

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
   (`coordinator.mjs:10653-10657`). The **workflow horizon (run-scoped)** is the
   orchestrator's working memory for one run (`docs/34-knowledge-horizons.md:51-52`). Because a
   cell shares ONE `runId`, every cell worker's `taskId` is in `runTaskIds`
   (`coordinator.mjs:11063`), so every run-scoped node is readable by every cell worker — and a
   node promoted under a different run is not. This is the shared-horizon law, and it is
   exactly why the cell sidesteps #96 by construction.

6. **The C5 bounded broadcast delivers to every worker of a `runId`.**
   `sendMessage({kind, to, body})` (`coordinator.mjs:6793-6898`) accepts `kind ∈
   {inform, query, steer}` and a target that is EXACTLY `{workerId}` or `{runId}`
   (`coordinator.mjs:6803-6808`). A `{runId}` target broadcasts to
   `[...this._workers.values()].filter((handle) => this._tasks.get(handle.taskId)?.runId ===
   to.runId)` (`coordinator.mjs:6835`). The receipt is the broadcast receipt:
   `{ok:true, result:'sent', messageId, delivered: deliveries.filter((row) => row.ok).length,
   targetCount: workers.length}` (`coordinator.mjs:6896-6897`), with a per-worker
   `record.deliveries` Map (`coordinator.mjs:6841`). The body is graceful-spilled between
   `message.send.body` (2,048 bytes) and `spill.body` (1 MiB); beyond the ceiling draws the
   coaching refusal `spill_body_exceeded` (`limits.mjs:54,85`). The frame carries `messageId`
   for `inReplyTo` (`coordinator.mjs:6838`).

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
   checks the board's `_boardRunBindings` binding (`coordination-store.mjs:14293,14783`),
   proves the **member coordinates** — `_taskByRun(memberRunId).assignee === workerId &&
   taskVersion && status === 'working'` (`coordination-store.mjs:14949-14951`) — the worker
   generation record, and the **wave-membership** proof: both the member Run and the board Run
   must be steering-registered members of the SAME live wave, the sole cross-Run relaxation
   (`_waveMembershipOf`, `coordination-store.mjs:15018-15026`). The grant payload is closed:
   `{schemaVersion:1, grantId, grantDigest, waveId, board, boardRunId, memberRunId, workerId,
   taskId, taskVersion, processGeneration, permissions, state:'active', mintedEvent}`
   (`coordination-store.mjs:14998-15003`). Permissions are the orchestrator-selected subset of
   `read|claim|report`, selected by wave role: `coordinator-worker -> ['read']`, else
   `['read','claim','report']` (`coordinator.mjs:71-77`). Every mutation/read rebinds the
   grant to the authenticated worker stream and all recorded member coordinates; the grant's
   `workerId/taskId/processGeneration` must match the caller (`boardGrantPage`,
   `coordination-store.mjs:15037-15062`).

9. **The board grant rides `waves.send` claimGrant, server-side, persist-before-deliver.**
   `sendWaveMember` mints via `mintMemberBoardGrant` (`coordinator.mjs:11229-11251`), which
   resolves the member Run, selects permissions by `permissionsForWaveRole`
   (`coordinator.mjs:11244`), and appends `board.grant_minted` BEFORE the steer is deliverable
   (`application.mjs:11535-11557`). The delivered worker fact carries a `[BOARD_GRANT]` JSON
   block and never S-2 lease material. A worker reads the shared board through its authenticated
   L1 lane: `CONTEXT_READ: {"query":{"kind":"board","grantId":"...","cursor":null}, ...}`
   (`coordinator.mjs:10670-10693`) — the query carries no board/run/worker; those are derived
   from the active grant. Claim and report are worker-profile ops; claim CAS is
   `expectedBoardFence`, report CAS is `expectedClaimVersion` (`board-workerhalf-contract.md`,
   Decision 4); a report never closes an item — only the S-2 orchestrator transitions do.

10. **Quorum/terminal machinery exists per member, never per worker-count.** The wave driver
    treats a member terminal when `outline.terminal === true || applicationTerminal(phase) ||
    phase === SUCCESS_RESTING` (`wave-driver.mjs:535`); `applicationTerminal` is the closed set
    `{completed, failed, cancelled, stopped, denied}` (`application-semantics.mjs:100-108`).
    `settle` materializes one outcome per member (`wave.mjs:427-445`); a member whose run never
    started is an outcome `{phase:'failed', terminalCause:'start', terminal:true}`
    (`wave.mjs:430-431`). The driver receipt's `basis ∈ {completed, stall, hard_cap, aborted}`,
    where `'completed'` means all members exited in any phase including failed/cancelled
    (`docs/37-wave-driver.md:84-88`). There is **no quorum law** anywhere in the wave machinery
    today — the cell introduces it.

11. **One run, one result section.** `materialize` (`wave.mjs:390-406`) reads the run's
    `result` section first (`run.inspect({depth:'section', section:'result'})`), falling back to
    the checkpoint-pin disambiguation only when `repoRoot` is passed. The run result is shared
    across the run's workers — the collective result is the run result, not a per-worker
    artifact.

12. **Byte ceilings that bound a cell's view.** The run outline is bounded by
    `MAX_RUN_VIEW_BYTES` (`application.mjs:52`); the wave progress snapshot by
    `MAX_WAVE_PROGRESS_BYTES` (`wave.mjs:21`); the worker count per run view by
    `MAX_RUN_VIEW_WORKERS = 1_024` (`application.mjs:53`). The member objective is bounded by
    `wave.member.objective` = 4,096 bytes with graceful spill to `spill.body` = 1 MiB
    (`limits.mjs:57,85`). A cell of `size` workers projects `size` rows in the run view and
    `size` worker deliveries in a broadcast receipt — all three ceilings must hold.

## Decisions

### 1. The closed group field on a wave member — `{size, quorum?, exact}`

**Surface:** the `waves.start` member item (`application-semantics.mjs:1571-1589`),
`_normalizeWaveStart` (`application.mjs:11585-11630`), and `validateMember`
(`wave.mjs:50-105`).

**Shape (sorted-key closed literal):** `group` is an optional member field with the closed
shape:

```text
group: {exact, quorum?, size}
```

- `size`: integer, `2 <= size <= MAX_CELL_SIZE`. The number of same-seat agents. `MAX_CELL_SIZE`
  is a named, documented count-based circuit breaker set to `64` — the same bound as the wave
  member-array ceiling (`wave.mjs:163`), and comfortably under the run-view worker ceiling
  `MAX_RUN_VIEW_WORKERS = 1_024` (`application.mjs:53`) with headroom for the other run-view
  fields under `MAX_RUN_VIEW_BYTES` (`application.mjs:52`). A cell consumes ONE wave member slot;
  the per-run worker projection is what the size bound throttles.
- `quorum?`: optional integer, `1 <= quorum <= size`. The minimum number of cell workers that
  must reach a terminal rest for the cell to count as anything but failed. **Default `size`** —
  the strict default: any worker loss without a declared tolerance is `cell_below_quorum`.
- `exact`: the closed exact-route object `{harness, model, effort}` — the SAME seat every cell
  worker is spawned with. Required when `group` is present. This is the homogeneity law: the
  cell is N workers of one seat. When `group` is present, member-level `exact`/`harness`/
  `model`/`effort` are REFUSED (`wave_group_route_conflict`) — the group's seat is the single
  source of truth.

**Refusal vocabulary:** `wave_group_invalid` (shape), `wave_group_exact_missing` (group without
`exact`), `wave_group_route_conflict` (member-level route alongside `group.exact`),
`wave_member_role_reserved` unchanged. Validation is shape-only; no clock, no turn, no TTL.

**Rationale:** the member array bound (`wave.mjs:163`), the exact-route discipline
(`wave.mjs:90-97`), and the closed-shape conventions (`_normalizeWaveStart`,
`application.mjs:11598`) are all existing, verified seams. The group is additive to all three.
`size` is a count bound (allowed by campaign law); `quorum` is a count bound; `exact` reuses the
proven closed route validator. Heterogeneous cells (per-worker route variation) are deliberately
NOT v1 — the group's `exact` is the single seat.

### 2. The N-spawns-one-run binding — identity and per-worker receipts

**Surface:** the wave start path (`wave.mjs:193-212`, `application.mjs:11437-11477`) and the run
start plan mint (`application.mjs:4481-4491`).

**Shape:** a cell member starts ONE run (unchanged `driverKind:'wave'` + `waveId` + `waveRole` +
`waveStart`), and that run's plan carries `size` homogeneous node entries instead of one `work`
node — mirroring the composition multi-node idiom (`application.mjs:4481-4491`) but with
IDENTICAL `routes: exactPlanRoutes(group.exact)` for every node and NO role catalog / `attempts`
block (the cell is not a workflow). Each node dispatches to its own task + worker; every task
carries `task.runId === cellRunId`. Identity is therefore:

- one runId (the cell member's run),
- `size` distinct `workerId`s, each with its own `taskId` and `taskVersion`,
- the run view projects `ownership: {workers: size, workerIds: [sorted], closed:false}`
  (`application.mjs:5796`),
- `steering.registered` records the run ONCE with `waveId` + `waveRole`
  (`application.mjs:4515-4530`) — the cell is one wave member.

**Receipts per worker:** the wave handle for a cell member exposes a `cell` sub-view alongside
the run handle: `{role, runId, size, workers: [{workerId, taskId, taskVersion, spawnError}]}`.
A worker whose spawn refused (capacity, session, policy) is recorded as a per-worker
`spawnError` — never a run failure. A run is only `startError` when the run itself never
started (unchanged, `wave.mjs:208-210`).

**Refusal vocabulary:** `cell_spawn_refused` (per-worker spawn refusal, recorded, not thrown),
`wave_cell_start_invalid` (the run-level admission refuses a malformed cell request).

**Rationale:** the composition machinery already proves one run can hold N tasks/workers under
one `runId` (`application.mjs:4481-4491`, `application.mjs:2269-2284`); the cell reuses it
minus the per-role heterogeneity. Per-worker receipts keep the honest truth — a lost worker is
a typed per-worker fact, never a silent run failure.

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

**Refusal vocabulary:** `context_scope_forbidden` (unchanged, `coordinator.mjs:10653-10657`) for
any read outside the shared run horizon.

**Rationale:** this is the entire point of the cell per the seed (`orchestrator-friction-ledger.md:36`).
It costs no new machinery — the runId-scoped horizon already exists and already admits all of a
run's tasks' nodes. The cell simply makes N workers share one runId.

### 4. Self-division via board claim/report — per-worker grants on the shared cell board

**Surface:** `waves.send` claimGrant (`application.mjs:11535-11557`), `mintMemberBoardGrant`
(`coordinator.mjs:11229-11251`), `mintBoardGrant` (`coordination-store.mjs:14892-15009`),
`boardGrantPage` (`coordination-store.mjs:15037`), and the worker claim/report lane
(`board-workerhalf-contract.md` Decisions 1, 4, 5).

**Shape:** the cell divides work through ONE shared board bound to the cell `runId` (or a
designated same-wave coordination Run — the sole cross-Run relaxation, `coordination-store.mjs`
Decision 2 wave-membership proof). A `waves.send(..., claimGrant:{boardRunId, board})` to the
cell `runId` mints **one grant PER cell worker** — `size` grants, each bound to its own
`(workerId, taskId, taskVersion, processGeneration)` and all sharing `memberRunId = cellRunId`,
`boardRunId`, `waveId`. Each grant's permission subset follows `permissionsForWaveRole`
(`coordinator.mjs:71-77`). Each worker then:

1. `CONTEXT_READ` the shared board through its own grant
   (`coordinator.mjs:10670-10693`),
2. `board.claim` an item against `expectedBoardFence`,
3. work + `board.report` against its active claim version + exact observed item digest.

**Gap the cell closes:** the current grant mint resolves the member task by `_taskByRun(runId)`
(`coordination-store.mjs:15011-15015`) — the FIRST task of the run — and the coordinator
wrapper resolves the target worker by `.find((worker) => worker.runId === runId)`
(`coordinator.mjs:11231`). Both are single-worker assumptions. For the cell, the mint must
resolve the SPECIFIC member task by `(runId, workerId, taskVersion)`, not first-by-runId. The
report CAS (active-claim owner `(workerId, taskId)` + `expectedClaimVersion`) already prevents a
second cell worker from reporting against the first worker's claim
(`board-workerhalf-contract.md` Decision 4).

**Refusal vocabulary:** `board_worker_scope_refused` (constant pre-existence refusal for an
absent/foreign/generation-stale grant, `coordination-store.mjs:15039-15050`),
`board_replay_conflict`, `board_cursor_stale`, `board_item_not_open`, `conflict`,
`stale_board_fence` — all unchanged from #78.

**Rationale:** #78's grant is worker-bound by construction (`coordination-store.mjs:14949-14951`);
the cell only removes the single-worker resolution assumption. This is the "self-division" the
brief demands: the cell is one member, but its workers divide the member's work through the board
envelope — mediated lateral coordination, never free worker-to-worker messaging.

### 5. Broadcast receipts — waves.send to a cell runId reaches all N workers

**Surface:** `sendMessage` C5 runId fan-out (`coordinator.mjs:6835,6896-6897`), `sendWaveMember`
(`application.mjs:11516-11579`).

**Shape:** a send/steer to a cell member routes through the C5 `{runId}` broadcast, not the
single-worker `.find(...)` lane. The receipt is the C5 broadcast receipt:
`{ok:true, result:'sent', messageId, delivered, targetCount: size}` where `delivered` is the
number of cell workers that acked and `targetCount = size` (`coordinator.mjs:6896-6897`). A
partial delivery (`delivered < size`) is an HONEST receipt, never an error — the message record
carries per-worker delivery truth in `record.deliveries` (`coordinator.mjs:6841`). The body
spill law is unchanged (`limits.mjs:54,85`); the frame carries `messageId` for `inReplyTo`
(`coordinator.mjs:6838`).

**Refusal vocabulary:** `run_not_active` (no live worker under the runId,
`coordinator.mjs:6836`), `spill_body_exceeded` (beyond the spill ceiling,
`limits.mjs:85`), `cell_broadcast_partial` is NOT a code — it is the honest receipt shape
(`delivered < targetCount`).

**Rationale:** the C5 broadcast already exists and already produces per-worker receipts; the cell
simply makes the wave transport USE it for cell members instead of the single-worker lane
(`application.mjs:11523-11524`). The orchestrator reads `delivered` vs `targetCount` — the
receipt is the broadcast truth, including when some workers are down.

### 6. Quorum terminal semantics — degraded vs failed

**Surface:** the wave driver terminal predicate (`wave-driver.mjs:535`), `settle` outcomes
(`wave.mjs:427-445`), and the driver receipt (`wave-driver.mjs:783-804`).

**Shape:** at settle, the cell computes its collective terminal from `size` workers. Let
`survived` = the number of workers that reached a non-failed terminal rest (a phase in
`{completed, result_ready, stopped, denied}` — `applicationTerminal` minus `{failed, cancelled}`
plus `SUCCESS_RESTING`; the exact rest-set is a closed, evaluable predicate). The cell's outcome
is ONE entry (the member role, `wave.mjs:427-445`) carrying:

```text
{ role, phase, terminal: true, narrative, resultSha, error: null,
  cell: { size, quorum, survived, lost: [workerIds], degraded: bool } }
```

- `survived === size` → cell `phase: 'completed'` (collective result materialized).
- `quorum <= survived < size` → cell `phase: 'degraded'` — a distinct phase, NOT failed. The
  collective result IS materialized from the survivors; `cell.degraded: true`, `cell.lost`
  lists the lost workers.
- `survived < quorum` → cell `phase: 'failed'`, `terminalCause: 'cell_below_quorum'`,
  `resultSha: null`, `cell.lost` lists the lost workers.
- `group.exact === true` (exact-size discipline) and ANY worker lost → cell
  `phase: 'failed'`, `terminalCause: 'cell_exact_breach'` — no degraded fallback.
- A worker that never started → `cell_member_lost` recorded in `cell.lost` with its per-worker
  `spawnError` (from Decision 2's per-worker receipts).

**Refusal vocabulary:** `cell_below_quorum`, `cell_member_lost`, `cell_exact_breach`,
`cell_degraded` (a phase, not an error). All are event/count-derived — no clock, no turn limit.

**Rationale:** the wave driver's terminal predicate (`wave-driver.mjs:535`) and the settle
outcome loop (`wave.mjs:427-445`) are per-member; the cell's innovation is that ONE member's
terminal is a function of N worker terminals, and the strict default (`quorum = size`) honors
the campaign's no-arbitrary-limits law while still letting an operator declare tolerance. The
`degraded` phase is a distinct terminal so a downstream orchestrator can distinguish "the cell
finished with losses" from "the cell failed" — exactly the `basis` honesty of
`docs/37-wave-driver.md:84-88`.

### 7. The single collective result

**Surface:** `materialize` (`wave.mjs:390-406`) and the settle outcome (`wave.mjs:427-445`).

**Shape:** the cell produces ONE result for the wave member — the run's result section
(`wave.mjs:395-397`). `resultSha` in the cell's outcome is the single collective pin. When the
cell is `degraded`, the collective result is the survivors' result, honestly marked
(`cell.degraded: true`); when the cell is `cell_below_quorum`/`cell_exact_breach`, `resultSha`
is null and the outcome carries the typed cause. No per-worker result is surfaced at the wave
level — the cell is one member.

**Rationale:** one run, one result section (`wave.mjs:390-406`), one member, one outcome
(`wave.mjs:427-445`). Materializing per-worker results would break the member contract the wave
driver and `waves.progress` consume.

### 8. Failure vocabulary — the closed cell error/state code set

**Surface:** everywhere the cell touches a typed error or state.

The closed vocabulary (eval-able, constructive — no clocks, no turn limits):

| code / phase | kind | meaning |
|---|---|---|
| `wave_group_invalid` | admission error | malformed `group` closed shape |
| `wave_group_exact_missing` | admission error | `group` present without `exact` |
| `wave_group_route_conflict` | admission error | member-level route alongside `group.exact` |
| `wave_cell_start_invalid` | admission error | run-level cell request malformed |
| `cell_spawn_refused` | per-worker record | an individual worker spawn refused; never aborts the run |
| `cell_member_lost` | terminal cause | a worker lost (spawn failure or failed/cancelled terminal) before the collective rest |
| `cell_below_quorum` | terminal cause | `survived < quorum` at settle |
| `cell_exact_breach` | terminal cause | `group.exact === true` with any loss |
| `cell_degraded` | terminal phase | `quorum <= survived < size`; collective result materialized |
| `cell_broadcast_partial` | (not a code) | the honest receipt shape: `delivered < targetCount` |

Plus the unchanged machinery codes the cell composes: `board_worker_scope_refused`,
`board_replay_conflict`, `board_cursor_stale`, `context_scope_forbidden`, `run_not_active`,
`spill_body_exceeded`.

**Rationale:** a closed, documented code set is the pre-condition for a red-first suite
(Decision 9). Every code is either an admission shape refusal, a per-worker record, or a
count/event-derived terminal — never a clock or turn limit.

### 9. The red-first suite is the pin the implementation must carry

**Surface:** `impl/test/` — suggested home `impl/test/tight-cell-red.test.mjs`, alongside
`wave-driver-red.test.mjs` and `board-workerhalf-red.test.mjs`. Every red row must fail against
today's machinery (no group field, single-worker send lane, first-by-runId grant mint,
no quorum) and go green only on the cell implementation.

**Rationale:** mirrors `board-workerhalf-contract.md`'s red-first acceptance discipline and the
campaign's explicit "controls are eval-able" law. Static/source assertions additionally pin the
"No Arbitrary Numeric Limits" law: any new numeric bound must name its cap + derivation.

## Non-goals

- **No cross-cell sharing** (a node promoted under cell A readable by cell B) — that is #96
  territory and is explicitly NOT v1. The shared-horizon law (Decision 3) is runId-scoped and
  closed.
- **No heterogeneous cells** — `group.exact` is the single seat; per-worker route variation is
  NOT v1.
- **No free worker-to-worker messaging inside the cell** — all coordination is mediated: the
  shared board (Decision 4), the shared run-scoped horizon (Decision 3), and the orchestrator.
  The directionality law of the bidirectional-v3 spine is unchanged.
- **No per-worker results at the wave level** — the cell is one member with one collective
  result (Decision 7).
- **No per-cell grant** (one grant covering all workers) — grants stay per-worker; the grant's
  member coordinates require it (`coordination-store.mjs:14949-14951`).
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
first-by-runId grant mint, no quorum). Existing wave, board, BD3, MCP, grammar, replay, and
trust-gate suites remain unchanged and green; no existing assertion is weakened to admit the new
behavior.

| ID | Red state to prove first | Green acceptance oracle |
| --- | --- | --- |
| TC-01 | A wave member cannot declare a group today. | `waves.start` accepts the closed `group` field and `validateMember`/`_normalizeWaveStart` reject a malformed shape with `wave_group_invalid`. |
| TC-02 | A group without a seat is ambiguous. | `group` without `exact` refuses `wave_group_exact_missing` before any spawn. |
| TC-03 | Member-level route and group seat can conflict. | `group.exact` plus member-level `exact`/`harness`/`model`/`effort` refuses `wave_group_route_conflict`. |
| TC-04 | One member currently maps to exactly one run and one worker. | A cell member starts ONE run whose plan carries `size` homogeneous nodes; `run.status().ownership.workerIds.length === size` and every task's `task.runId === cellRunId`. |
| TC-05 | Cell workers are identity-collapsed today. | `size` distinct `workerId`s, each with its own `taskId` + `taskVersion`, all under the one `runId`; `steering.registered` records the run once. |
| TC-06 | A worker spawn refusal can abort the run. | A refused individual spawn records `cell_spawn_refused` per worker and the remaining workers run; the run itself never aborts. |
| TC-07 | Cross-run horizon gap: a node seeded in one run is invisible to another. | A node seeded under the cell runId is readable by EVERY cell worker (same run-scoped tiers); a node under a different run refuses `context_scope_forbidden` — the shared-horizon law. |
| TC-08 | The board grant mint is first-by-runId, single-worker. | A `waves.send(..., claimGrant)` to a cell runId mints `size` grants, each bound to its own `(workerId, taskId, taskVersion, processGeneration)` with `memberRunId = cellRunId`; a second worker cannot report against the first worker's claim (report owner CAS). |
| TC-09 | `waves.send` delivers to the first worker of a runId. | A send to a cell runId routes through the C5 runId fan-out and the receipt is `{ok:true, result:'sent', messageId, delivered, targetCount:size}`. |
| TC-10 | Partial delivery is a silent failure today. | A send with `delivered < size` returns the honest receipt (`delivered`, `targetCount:size`), no throw, per-worker delivery truth in the message record. |
| TC-11 | No quorum law exists. | size=3, quorum=2, 2 workers rest → cell `phase: 'degraded'`, `cell.degraded: true`, `cell.lost` lists the lost worker, `resultSha` non-null. |
| TC-12 | A lost worker silently fails the member. | size=3, quorum=2, 1 worker rests → cell `phase: 'failed'`, `terminalCause: 'cell_below_quorum'`, `resultSha: null`. |
| TC-13 | Exact-size discipline can silently degrade. | `group.exact: true` with any loss → `terminalCause: 'cell_exact_breach'`, never a degraded fallback. |
| TC-14 | A never-started worker is indistinguishable from a run failure. | A worker whose spawn refused is recorded `cell_member_lost` with its per-worker `spawnError`; the run itself is not `startError`. |
| TC-15 | Per-worker results can leak to the wave level. | The wave outcome has exactly ONE entry for the cell role with a single `resultSha`; no per-worker result surfaces on `waves.progress`. |
| TC-16 | The implementation introduces clocks/turn limits. | Static/source assertions and event-driven tests show the cell vocabulary adds no time/TTL/turn field and no cadence-dependent truth. |
| TC-17 | A large cell overflows a bounded view. | A cell of `size <= MAX_CELL_SIZE` stays within `MAX_RUN_VIEW_BYTES` (`application.mjs:52`), `MAX_WAVE_PROGRESS_BYTES` (`wave.mjs:21`), and `MAX_RUN_VIEW_WORKERS` (`application.mjs:53`); a broadcast receipt carries exactly `targetCount = size`. |
| TC-18 | The cell changes non-cell behavior. | A wave with no `group` fields is byte-identical to today: same member schema, same single-worker send lane, same outcomes, same receipts. |
| TC-19 | The end-to-end #74 loop is not executable by a cell. | Live acceptance: a coordinator-worker posts granular items on a shared board, a cell of ≥2 same-seat members is granted, members read/contend/claim/report, the cell reaches `completed` (or honestly `degraded`), and the orchestrator closes the selected item with a single collective result — receipts keyed on durable ids/digests/events, never sleep duration, turn count, or polling count. |

The end-to-end TC-19 receipt must record: wave/member binding proof, the one runId + `size`
worker identities, the `size` grants with their member coordinates, worker-attributed claim and
report events, the broadcast receipt (`delivered`/`targetCount`), the collective terminal
(`completed`/`degraded`/`cell_below_quorum`), and the single collective `resultSha`. Its
assertions key on durable ids/digests/events and content/state predicates, never clocks.

## Open questions

1. **`group.exact` semantics.** This contract reads `exact` as the closed exact-route seat
   `{harness, model, effort}` (homogeneity by construction). The alternative reading — `exact` as
   an exact-size boolean flag (`exact: true` = no degraded fallback) — would collide with the
   member-level `exact` route field's existing meaning (`wave.mjs:90-97`) and is less likely; if
   both are wanted, the exact-size flag should be a separate field (e.g. `group.strict`).
2. **Where the cell spawn lives.** This contract routes the N-node homogeneous plan through the
   run-start plan mint (`application.mjs:4481-4491` idiom). The alternative — the wave layer
   issuing N-1 additional coordinator spawns into the existing run after `runs.start` — would
   keep `run.start` unchanged but puts the cell's plan integrity in the wave layer. The plan-mint
   reading keeps the plan atomically committed before any dispatch (matching the composition
   integrity check, `application.mjs:4578-4583`).
3. **Default quorum.** Strict (`quorum = size`, this contract) vs majority (`ceil(size/2)`). The
   strict default matches the campaign's no-arbitrary-limits discipline (loss is loud unless an
   operator declares tolerance); a majority default would let a 3-worker cell lose one worker
   silently.
4. **`waves.progress` projection.** Should a cell project one collective member row with a
   `cell` sub-block (per-worker rows hidden), or per-worker rows grouped under the cell role?
   This contract assumes the former (the cell is one member); the per-worker truth lives in the
   wave handle's `cell` sub-view and the run view's `ownership.workerIds`.
5. **`MAX_CELL_SIZE = 64` derivation.** Aligned with the wave member-array bound
   (`wave.mjs:163`) and well under `MAX_RUN_VIEW_WORKERS = 1_024` (`application.mjs:53`). If the
   red suite shows a smaller bound is needed to hold `MAX_RUN_VIEW_BYTES`
   (`application.mjs:52`) with a full run view, the number must be re-derived from the byte math
   and named.
