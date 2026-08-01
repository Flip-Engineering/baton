# KG settlement contract v0.9 — LIFECYCLE + ORDERING red-team (2026-08-01)

**Contract under attack:** `kg-settlement-decisions.md` (D1–D5, the settle-window ritual).
**Angle:** lifecycle (who lives, who dies, when) and ordering (what precedes what, what survives a crash).
**Attacker role:** `lifecycle-attacker` (attempt `81395471-9395-4942-b0ea-63071ed5ddd6`).
**Grounding:** every claim is `file:line` against `impl/src/…`, the contract, and the demo verdict.
**Method:** adversarial trace of the six attacks below against the shipped code (coordination-store.mjs,
coordinator.mjs, wave-driver.mjs, run-lineage.mjs) and the demo receipt
(`kg-tiered-loop-2026-08-01/kg-loop-verdict.md`). Complement to `redteam-authority.md` (authority +
injection angle); the two reports overlap only on crash-retry idempotency (Attack 5 here ↔ §5 there),
and this report adds the lifecycle/ordering analysis that angle does not cover.

**Scope honesty (confirms F1).** D1–D5 are *proposed, unimplemented*. The shipped settle window at
`wave-driver.mjs:669` is `wave.settle()` immediately followed by `wave.close()` in the `finally` block
(`wave-driver.mjs:672-675`) — no elevate/lease/board-post calls exist there. The driver's only
knowledge accounting is receipt aggregation over `memberKnowledge` (`wave-driver.mjs:467,686-703`),
which *reads* `outline.knowledge.candidates` from member runs; it performs no ritual. So this report
evaluates the **design** of D1–D5 against the store primitives that design would compose, exactly as
`redteam-authority.md:4-11` does for its angle.

## Verdict summary

| # | Attack | Verdict | Amendment? |
|---|--------|---------|-----------|
| 1 | Member claimed-terminal with pending scratchpad writes (paused at checkpoint) | **DEFENDED** | minor (doc the store-status read) |
| 2 | Settlement task un-reaped after driver exit (promote never comes); lease TTL 30 min | **NEEDS-AMENDMENT** | post-TTL reaper + admit must enforce expiry |
| 3 | Default-on ledger growth per wave (worst case) | **NEEDS-AMENDMENT** | per-repo candidate cap / cross-wave reaper |
| 4 | D4 skips plan+link vs issue #59 re-drive continuity | **NEEDS-AMENDMENT** | elevate `plan` to a non-candidacy method lane (or document the loss) |
| 5 | Crash mid-hook exactly-once re-drive | **NEEDS-AMENDMENT** | pin board-post + settlement-task/lease keys to waveId/content identity |
| 6 | Doubts elevate but never candidate — silent sink | **NEEDS-AMENDMENT** | don't elevate doubts in v1, or give them a review path |

**Cross-cutting (lifecycle/ordering), all NEEDS-AMENDMENT:**
- (A) `run_stopping` does **not** gate elevate/settle — the contract's central premise is overstated; the real guard is stop-cleanup emptiness.
- (B) `admitWorkflowFinding` ignores lease expiry and parent-task liveness — the 30-min TTL is **not** admission-enforced.
- (C) D3 step 3 (settle) severs the note grounding chain *before* admission — admitted Findings carry only a 120-byte title + seq pointers in active state.

## Attack 1 — claimed-terminal while the scratchpad partition has pending writes

**Claim (attacker).** A member resolved through the driver's claim-on-stall path is marked settled by a
*driver-local* flag, while its turn was parked at a checkpoint. If the ritual fires against that member
its scratchpad may still hold "pending" writes (a half-flushed turn), so elevation could capture an
inconsistent/partial partition or race an in-flight write.

**Verdict: DEFENDED.** The store cannot elevate a non-terminal task, scratchpad writes are synchronous
durable appends (there is no in-flight/buffered write to race), and a parked member is never counted
terminal until `claim_turn` has resolved it.

### Evidence trace

- **Terminal is store-enforced, not driver-asserted.** `elevateTaskScratchpad` refuses a non-terminal
  task: `if (task && !TERMINAL.has(task.status)) throw … 'scratchpad_settlement_not_ready'`
  (`coordination-store.mjs:13234`). `TERMINAL = new Set(['completed','failed','cancelled'])`
  (`coordination-store.mjs:124`) — `paused`, `working`, `input_required` are **not** terminal. The
  coordinator wrapper independently gates on `['completed','failed','cancelled']`
  (`coordinator.mjs:9711-9713`). So a paused task cannot be elevated, full stop.
- **The driver's `claimed` flag is downstream of `claim_turn`, not a substitute for task status.**
  `claimOnce` calls `run.act('claim_turn', {})` (`wave-driver.mjs:243`) and only then sets
  `state.claimed = true` (`wave-driver.mjs:249`). A member counts as settled for the wave when
  `info.terminal || claimed` (`wave-driver.mjs:470,625`), but a *parked* member is explicitly kept live
  and steerable until then: `if (!terminal && !claimed) { … if (checkpoint && !reduced.blocked)
  paused.push(…)` (`wave-driver.mjs:471-479`).
- **`claim_turn` transitions the task to terminal *before* it returns (verified in code, not just the
  receipt).** `claimTurn` (`coordinator.mjs:2281`) reserves the pause record, then notes that the
  task-transition graph has no `paused → completed` edge (`coordinator.mjs:2290-2292`), so it unparks
  `paused → working` first (`task.status = 'working'`, `:2298-2300`) and then runs the trust gate
  `_runTrustGate(handle, record.workerResult)` (`:2303`) — "the SAME call an ordinary turn completion
  makes" (`:2018`). After the gate, `outcome = task.status` (`:2309`) is `completed` or `failed`, both
  terminal (`coordination-store.mjs:124`). So by the time the driver sets `claimed` (`wave-driver.mjs:249`),
  the store task is terminal. The demo verdict corroborates the shape (`kg-loop-verdict.md:16`).
- **There is no "pending write" in the store model.** Worker writes go through `writeScratchpad` →
  `this._coordination.writeScratchpad(…)` (`coordinator.mjs:9689-9693`) → `_append`
  (`coordination-store.mjs:1368`), a synchronous, durably-appended event. A write is either in the
  ledger (and thus in the partition projection) or it never happened; there is no buffer to flush. The
  only "trailing write racing the turn-completed frame" hazard the codebase calls out is for *board*
  claim/report, which is why those wrappers tolerate the `paused` status (`coordinator.mjs:9786,9799`)
  — a separate lane from elevation.
- **Post-stop elevation is a benign empty no-op, not a data race.** Even if a productized hook were
  misplaced *after* `wave.close()`, `reapRunScratchpads` (stop-cleanup) has already deleted the
  partition entries (`coordination-store.mjs:8220-8223`), so a late `elevateTaskScratchpad` finds
  `ids.length === 0` and returns `empty` (`coordination-store.mjs:13221-13227`). See cross-cutting (A).

### Caveat / minor amendment

Elevation reads the **store's** `task.status` live (`coordination-store.mjs:13234`); the driver's
`claimed` flag (`wave-driver.mjs:249`) is a different source of truth. If `claim_turn` has not yet
propagated to the task record when the ritual fires, elevation returns the typed refusal
`scratchpad_settlement_not_ready` — safe, but a *missed* elevation. D3 already captures such refusals
into `settlement.errors` (contract `:111-114`), so the failure is visible. **Minor amendment:** D3 step 2
should state explicitly that the ritual gates on the **store** task status (re-read, not the driver's
`claimed` flag), and that a `scratchpad_settlement_not_ready` refusal is retried once or recorded —
never silently dropped. This tightens the contract; it does not change the DEFENDED verdict, because the
store already refuses corruption.

## Attack 2 — the settlement task stays working after driver exit (promote never comes)

**Claim (attacker).** The settlement task is born `working` and is the lease's parent; if the
orchestrator never promotes, nothing reaps the task or the lease. The 30-min lease TTL is supposed to
bound the review window — are the lingering task/lease rows acceptable, and does the TTL actually bind?

**Verdict: NEEDS-AMENDMENT.** Lingering *within* the review window is by design (contract ground-truth
#6). But (i) there is **no reaper** for the post-window residue, so task/lease/candidate rows accumulate
without bound across waves; and (ii) the 30-min TTL is **not enforced at admission** (cross-cutting B),
so the lease stays *usable* past its expiry as long as `status` stays `'active'` — which, with no
reaper, it does forever.

### Evidence trace

- **The settlement task must stay `working` — by design.** Lease issuance requires the parent task to
  be `working`, assigned, and on a valid run: `if (task.status !== 'working' || …) fail(…
  'run_orchestrator_parent_inactive')` (`coordination-store.mjs:1582-1584`), and
  `_assertRunAdmissionOpen(task.runId)` (`coordination-store.mjs:1588`). On use, an inactive parent
  kills the lease: `if (task && task.status !== 'working') … 'run_orchestrator_parent_inactive'`
  (`coordination-store.mjs:1680`). Contract ground-truth #6 states this explicitly. So the task cannot
  be retired while admission is still possible.
- **Lease TTL derivation.** `expiresAt = min(session.expiresAt, issuedAt + leaseTtlMs)`
  (`coordination-store.mjs:1606-1609`); `leaseTtlMs: 30 * 60 * 1_000` (`run-lineage.mjs:27`). Revocation
  reasons include `parent_terminal` and `parent_run_stopping` (`run-lineage.mjs:18-20`).
- **Expiry is checked *on use only* and never mutates status.** `_activeRunOrchestratorLease` throws
  `run_orchestrator_lease_expired` when `Date.parse(now) >= Date.parse(lease.expiresAt)`
  (`coordination-store.mjs:1674`). But `lease.status` is set `'active'` at issuance
  (`coordination-store.mjs:7679`) and flips to `'revoked'` **only** on an explicit
  `run.orchestrator_lease_revoked` event (`coordination-store.mjs:7681`), emitted solely by
  `revokeRunOrchestratorLease` (`coordination-store.mjs:1821`). There is no periodic sweep: a grep for
  `reapLease|expireLease|sweep|reaper|review_window` across `coordination-store.mjs`/`coordinator.mjs`
  returns nothing. So an un-admitted, un-revoked lease sits at `status:'active'` with an `expiresAt` in
  the past, indefinitely.
- **The TTL does not bind admission.** `admitWorkflowFinding` checks `leaseRecord.status !== 'active'`
  and the digest/event/runId binding (`coordination-store.mjs:14544-14548`) — but it does **not** call
  `_activeRunOrchestratorLease` (`coordination-store.mjs:1670`), so it never consults `expiresAt`
  (`:1674`), parent liveness (`:1680`), or run_stopping (`:1684`). An admission against an
  expired-but-`active` lease therefore **succeeds**. The 30-min TTL is advisory for admission, not a
  hard bound. (Detailed in cross-cutting B.)
- **No reaper for the task either.** The settlement task is a normal task in `_tasks`; nothing
  auto-completes or cancels stale `working` tasks. `snapshot()` persists every task, run, and lease
  (`coordination-store.mjs:11316`), so the residue survives restarts.

### Failure scenario

A deployment runs 1 000 waves; the orchestrator promotes from 100. The other 900 each leave: 1
settlement task (`working`, forever), 1 lease (`active`, `expiresAt` long past, forever), and up to
128 candidate Findings + 128 board items per member (Attack 3). `_tasks`, `_runOrchestratorLeases`,
`_knowledgeNodes`, `_boardItems` grow monotonically. Worse, for any of the 900 the orchestrator can
still call `knowledge.promote` *now* and it will succeed despite the lease being years past its TTL —
the documented review window is not enforced.

### Amendment

1. **Add a post-TTL reaper** (idempotent, driver- or sweep-triggered): once `now > issuedAt +
   leaseTtlMs` and no `knowledge.workflow_admitted` has landed for that lease, revoke the lease with a
   new reason `review_window_expired` (add to `RUN_ORCHESTRATOR_REVOCATION_REASONS`,
   `run-lineage.mjs:18-20`) and cancel the settlement task. This bounds the residue to the TTL window.
2. **Make admission enforce the TTL** (cross-cutting B): route `admitWorkflowFinding` through
   `_activeRunOrchestratorLease` so expiry/parent-liveness/run_stopping are checked, not just
   `status==='active'`. Without this, amendment (1) alone does not close the hole — the lease stays
   usable until explicitly revoked.
3. **Retire un-admitted candidates** when the lease is reaped for `review_window_expired`: mark the
   candidate Findings `declined` (or drop the board items) so they do not accumulate (see Attack 3).

## Attack 3 — default-on ledger growth per wave (worst case)

**Claim (attacker).** D3 defaults `settlement: 'kg-ritual'` **on** (contract `:90-93`). Compute the
worst-case ledger/state growth per wave using the scratchpad ceilings, and test the contract's
honest-empty claim ("default-on costs nothing when unused").

**Verdict: NEEDS-AMENDMENT.** The per-wave bound is honest and the empty-wave claim is **DEFENDED**, but
the persistent state that survives the wave (candidate Findings + board items) is unbounded across
waves when admission lags — it is the same residue as Attack 2, quantified.

### Evidence trace — the ceilings

```
MAX_SCRATCHPAD_WRITE_REQUEST_BYTES = 16_384   (coordination-store.mjs:436)
MAX_SCRATCHPAD_ENTRY_BYTES         = 8_192    (coordination-store.mjs:437)
MAX_SCRATCHPAD_WORKER_ENTRIES      = 128      (coordination-store.mjs:438)  ← per-(run,worker) partition
MAX_SCRATCHPAD_SHARED_ENTRIES      = 512      (coordination-store.mjs:439)  ← per-run shared partition
MAX_SCRATCHPAD_BATCH_BYTES         = 2 MiB    (coordination-store.mjs:440)
```

- The worker partition (the elevation *source*) is capped at **128 entries** per `(runId, workerId)`
  (`coordination-store.mjs:438`); `entryIds.length > MAX_SCRATCHPAD_WORKER_ENTRIES` is rejected
  (`coordination-store.mjs:13190`). So a single member can contribute **≤ 128** elevated entries.
- The shared partition (the elevation *target*) is capped at **512** per run
  (`coordination-store.mjs:439`); `sharedIds.length + selected.length > MAX_SCRATCHPAD_SHARED_ENTRIES`
  throws `scratchpad_partition_exhausted` (`coordination-store.mjs:13241-13243`). 128 ≤ 512, so a
  single member never hits the shared cap; the cap bites only if the design later reuses one run's
  shared partition across many tasks (it does not today — each member has its own run).

### Worst case per wave (N members, each writing 128 notes; D4 elevates note+doubt)

Per elevated **note**, the ritual appends:
- elevation: `scratchpad.entry_elevated` + `scratch.fact_posted` = **2** (`coordination-store.mjs:13284-13289`; facts only for notes, `:13260`)
- candidacy: `board.item_posted` + `board.item_closed` + `knowledge.node_added` (candidate Finding) = **3** (`:13691`; close mints the Finding `:13726-13732`)
- settle: `scratch.fact_expired` = **1** (`:13378-13381`)

= **6 events per note**. Per member: `128 × 6 = 768`, plus one worker `partition_reaped` (`:13310`) and
one shared `partition_reaped` (`:13372`) = **770 events/member**. Per wave: **≈ N × 770 + lease
overhead** (settlement task `create+claim` = 2 via D1's atomic pair, `run.orchestrator_lease_issued` =
1) ≈ **N × 770 + 3**. A 10-member wave of maximal writers ≈ **7 703 events**, plus the byte ceiling
guards each scratchpad batch at 2 MiB (`coordination-store.mjs:1440-1442`).

**Persistent state that survives the wave** (not reaped by settle):
- **128 candidate Finding nodes per member** (`finding:board-close:<itemId>:<v>`,
  `coordination-store.mjs:13719`) — settle expires only *scratch-facts* (`:13378`), not candidate
  Findings; they await admission.
- **128 board items per member** (versioned, retained in `_boardItems`/`_boardItemHistory`,
  `:8250-8251`).

So a 10-member maximal wave leaves **1 280 candidate Findings + 1 280 board items** in active state,
indefinitely, until each is individually admitted or declined. Multiply across waves and the
un-admitted backlog grows without bound (Attack 2's residue, quantified).

### Honest-empty claim: DEFENDED

D3's "default-on costs nothing when unused" (contract `:92-93`) is **true**: an empty worker partition
early-returns `empty` with `reapEventSeq: null` and writes nothing (`coordination-store.mjs:13221-13227`);
an empty shared partition likewise (`:13353-13359`). A wave whose members write no scratchpad entries
performs zero ritual ledger writes. The growth risk is strictly a function of *used* partitions, and it
is bounded per wave — but not across waves.

### Amendment

1. **Bound cross-wave candidate accumulation.** Add a per-repo `candidatesAwaitingAdmission` ceiling
   (or a reaper tied to Attack 2's `review_window_expired` revoke) that retires surplus candidates.
   The per-wave cap (`MAX_SCRATCHPAD_SHARED_ENTRIES`, `:439`) bounds a single wave; nothing bounds the
   backlog.
2. **Resolve the contract's own open question** (red-team target, `:117-118`): one board item per note
   vs one digest item per member. At 128 notes/member the per-note rule is the growth driver; a
   per-member digest item would cut the candidate count by up to 128×. State which v1 ships.

## Attack 4 — D4 skips plan+link; issue #59 re-drive continuity destroyed?

**Claim (attacker).** D4 elevates only `note` + `doubt` and skips `plan` + `link` (contract `:122-128`).
Issue #59 wants re-drive continuity from dead attempts. A worker's `plan` *is* its method; if it is
skipped at elevation and the worker partition is reaped at stop, the re-drive cannot recover the dead
worker's in-flight procedure. Is re-drive continuity destroyed?

**Verdict: NEEDS-AMENDMENT.** Re-drive continuity does **not** read the dead worker's scratchpad `plan`
at all — it inherits the task brief, byte-identical, from the prior task. So D4's skip is *safe for
plan-dispatched tasks* (the method is the approved plan node, persisted separately) but is **data loss
for non-plan tasks**, where the worker's scratchpad `plan` is the only method record — and the
contract's own demo shape (`mandatory: false`) is exactly that case.

### Evidence trace

- **D4 skips plan+link; the skip is receipted, not preserved.** Dispositions record `orchestrator_skipped`
  for non-selected kinds when steering is registered (`coordination-store.mjs:13306`). The *content* of a
  skipped `plan` is never copied anywhere.
- **Re-drive continuity inherits the task brief, not the scratchpad.** `createAndClaimRecoveryRefinement`
  (`coordination-store.mjs:12130`) validates the refinement via `_validateRecoveryRefinementRequest`
  (`:2839`), which forces the new task's `brief`, `modelRequested`, `modelPolicy`, `effortRequested` to
  be **byte-identical** (`canonicalDigest` equality) to the prior task it refines
  (`coordination-store.mjs:2868-2873`). It never reads `priorTask`'s scratchpad or any `plan` entry.
  `createAndClaimRecoveryRefinement` is the documented escape pattern D1 mirrors (contract ground-truth
  #3, `:24-28`).
- **The dead worker's partition is destroyed at stop.** `reapRunScratchpads` (stop-cleanup) deletes
  every entry in every partition for the run, basis `run_stopped`
  (`coordination-store.mjs:8220-8223,13418,13432`). So a `plan` entry that was not elevated is gone from
  active state after `wave.close()`; it survives only in the durable event log.
- **The bifurcation.** Under a mandatory goal/plan policy, the method is the *approved plan node*
  persisted in `_planApprovals` (recovery verifies the gate, `_isDerivedPlanSemanticReview`,
  `coordination-store.mjs:12082-12092`) — D4's skip loses nothing. Under `mandatory: false` (the demo's
  own deployment, `kg-loop-verdict.md:46`), there is no plan node; the worker's scratchpad `plan` is the
  sole method artifact, and D4 discards it.

### Amendment

Pick one and state it in D4:
- **(a) Preferred for the `mandatory:false` shape:** elevate `plan` into a **non-candidacy method lane**
  — copy it to the shared partition (or a dedicated `method` scope) for replay, but mint **no**
  scratch-fact, **no** board item, **no** Finding. Re-drive can then read it; candidacy is unaffected.
  Cost: one `entry_elevated` per plan (no fact, no board item) — cheap.
- **(b) If (a) is declined:** document explicitly that re-drive continuity relies **solely** on the
  approved plan node / task brief and does **not** recover worker-authored procedure, making the loss
  intentional and bounded — and note that this leaves `mandatory:false` workers' methods unrecoverable.

The contract poses this exact question as an open red-team target (`:130-132`); it must close it.

## Attack 5 — crash mid-hook: exactly-once re-drive?

**Claim (attacker).** Walk a crash between ritual steps 2-3 (elevation vs settle) and between lease
materialization and board post. Do the `waveId`/`runId`-derived keys make re-drive exactly-once?

**Verdict: NEEDS-AMENDMENT.** The **store primitives** are exactly-once and DEFENDED; the **D3 driver
orchestration spec** is not — it does not pin deterministic idempotency keys for the per-note board post
or for the settlement-task/lease identity, so a re-drive that recomputes selection order can mint
duplicates or skip entries. (Authority §5, `redteam-authority.md:193-214`, nails the board-post-key gap;
this section adds the lifecycle ordering walk and the settlement-task/lease-key hazard.)

### Evidence trace — store primitives are exactly-once

- **Universal `_byKey` idempotency.** `_append` short-circuits on `this._byKey.get(key)`
  (`coordination-store.mjs:1358-1359`); `_appendBatch` rejects duplicate keys and sets each
  (`:1401,1451`). Every ritual op is an `_append`/`_appendBatch`, so every one is replay-safe by caller
  key.
- **Elevation.** Reap key `scratchpad.partition_reaped:<runId>:<taskId>:<fence>`
  (`coordination-store.mjs:13196`); on retry the prior reap is found and re-validated by digest against
  the **original** selection (`:13198-13214`), returning the **stable** `sharedEntryId`/`sourceEntryId`
  (`:13208-13214`). A retry cannot re-select different entries or double-mint `scratch.fact_posted`.
- **Settle.** Reap key `scratchpad.partition_reaped:<runId>:shared:<fence>` (`:13337`), same replay
  discipline (`:13339-13348`).
- **Lease.** `leaseId` is content-derived from the parent task/session identity
  (`coordination-store.mjs:1605`); the event key is `run.orchestrator_lease:<leaseId>` (`:1789,1647`),
  so re-issue under the same parent/session is a no-op replay (`:1772-1782`).
- **Admit.** Event keyed by `auth.key`; the admitted Finding id is deterministic
  `finding:workflow-admitted:<candidateFindingId>` (`:14500,14551`).
- **Board close → candidate.** The candidate Finding id is deterministic
  `finding:board-close:<itemId>:<itemVersion>` (`:13719`). The board itemId is
  `digest({board, ordinal, mintSeq})` (`:13686`) — deterministic **given** stable `events.length`
  (idempotent prior steps are replayed, not re-appended) and a content-derived post key.

### Crash walk 1 — between steps 2 (elevate) and 3 (settle)

Elevation's reap is durable. On re-drive: step 1 (`steering.registered`, idempotent by key), step 2
(elevate → reap-key replay, stable `sharedEntryId`), step 3 (settle, fresh — its reap key is
uncontested). **Exactly-once.** ✓

### Crash walk 2 — between lease materialization and board post

The lease event is durable. On re-drive: the D2 `knowledge.settlement_lease` op re-calls
`issueRunOrchestratorLease` → replay (`:1778`); no new event, so `events.length` is stable and the
board itemId's `mintSeq`/`ordinal` are deterministic. Board posts then proceed. **Exactly-once IF each
post uses a content-derived key** — which is the gap:

### The gap (NEEDS-AMENDMENT)

1. **Per-note board-post key is unspecified (cites authority §5).** `postBoardItem` is idempotent purely
   on the caller-supplied `auth.key` (`coordination-store.mjs:13672`); the store enforces nothing about
   *which note* the title came from. D3 step 4 (contract `:103-104`) does not pin a key formula. If the
   driver derives the key from a **wave-relative position** ("the Nth elevated note this wave") rather
   than from the elevation's stable identity (`sharedEntryId`/`sourceEntryId`, which the replay *does*
   return, `:13208-13214`), a re-drive that recomputes selection order slightly differently posts a
   **second, differently-keyed** item for already-candidated content, or skips an item whose original
   key no longer matches (`redteam-authority.md:198-207`).
2. **Settlement-task / lease-op key is not pinned to waveId (lifecycle hazard, this report).** The
   contract says the D2 lease op is "idempotent per runId" (contract `:77`) and the settlement run is
   `run-settlement:<waveId>` (contract `:102`). For `leaseId` to be stable across re-drive, the **D1
   settlement task id** must also be `waveId`-derived (it is the parent-task identity that
   `leaseId` hashes, `coordination-store.mjs:1598-1605`). D1 says only "idempotency by caller key,
   replay-exact" (contract `:57`) — it does not pin the task-id derivation. If the task id carries a
   nonce, `leaseId` changes on re-drive and the store mints a **second** lease (the `leaseId` conflict
   check at `:1792-1793` fires only for the *same* leaseId, not across two different ones).

### Amendment

1. **Pin the per-note board-post key** to the elevation's content identity, e.g.
   `board.candidacy:${waveId}:${sharedEntryId}` (or `sourceEntryId`), mirroring how
   `scratchpad.entry_elevated:${source.entryId}:${source.entryDigest}` (`:13282`) is keyed on stable
   content identity, not position. (Same fix as authority §5.)
2. **Pin the D1 settlement task id and the D2 lease-op caller key** to `waveId`-derived constants (e.g.
   task id `settlement-task:<waveId>`, lease key `run.orchestrator_lease:settlement:<waveId>`) so that
   `leaseId` is stable across re-drive and the lease-op replay path (`:1772-1782`) is actually reached.
   State both derivations in D1/D2.

## Attack 6 — doubts elevate but never candidate — silent sink?

**Claim (attacker).** D3 elevates `doubt` (it is in note+doubt) but explicitly excludes it from
candidacy (contract `:104-106`). Doubts mint no scratch-fact, so where does an elevated doubt *go*? Is
it a silent knowledge sink — cost paid to elevate, no review or admission path?

**Verdict: NEEDS-AMENDMENT (silent sink).** An elevated doubt is copied to the shared partition, gets
**no** scratch-fact (so it is invisible to horizons/scratch queries), is given **no** board item /
candidate Finding, and is then **deleted** at settle. Its content survives only in the durable
`scratchpad.entry_elevated` event, which nothing queries. The contract says "candidacy for doubts is the
orchestrator's call" but specifies no command or surface for that call.

### Evidence trace

- **Doubts are elevated.** D4 selects note+doubt (contract `:122-128`); `selected` includes both
  (`coordination-store.mjs:13239`), and each gets an `entry_elevated` event (`:13283-13286`) with its
  content copied into a shared entry on apply (`:8190-8194`).
- **But doubts mint no scratch-fact.** `if (source.kind === 'note') { … factPayload … }`
  (`coordination-store.mjs:13260`); `scratchFactId: factPayload?.id ?? null` (`:13280`). So a doubt's
  elevation carries `scratchFactId: null` — it has no entry in `_scratchFacts`, hence no horizon
  projection, no `checkScratch`/`readScratch` fact, no envRef grounding record.
- **And no candidacy.** D3 step 4 candidacies only elevated **notes** (contract `:103-104`); doubts are
  explicitly excluded (`:104-106`). No `board.item_posted`, no `finding:board-close:*`
  (`coordination-store.mjs:13717-13733`) is ever minted for a doubt.
- **And the shared entry is destroyed at settle.** `settleWorkflowScratchpad` dispositions every shared
  entry: notes → `reasonCode: 'min_readers'`, everything else (doubts) → `'type_ineligible'`
  (`coordination-store.mjs:13365`); the apply path then `delete`s every entry and clears the partition
  (`:8219-8223`). Doubts have no scratch-fact, so there is nothing to expire (`:13368` filters on
  `row.scratchFactId`). Net: the doubt's shared entry is gone from active state.

**Lifecycle of a doubt:** written (worker partition) → elevated to shared (one event, one transient
shared entry, **no fact**) → settled (`type_ineligible`, entry **deleted**). Final active-state
footprint: **zero**. Durable footprint: one `scratchpad.entry_elevated` event in the log, unqueried.

### Amendment

Pick one and state it in D3/D4:
- **(a) Cheapest honest v1:** do **not** elevate doubts at all — skip them like `plan`/`link`, record
  `orchestrator_skipped` (`:13306`). Zero cost, no sink. Defers the feature honestly.
- **(b) Complete fix:** give doubts a review path — a doubts board, or a `knowledge.promote_doubt`
  command (distinct from Finding admission) the orchestrator can call, with a queryable projection.
- **(c) Minimal-visibility fix:** mint a **non-admission** scratch-fact for doubts (`grounding:
  'open_question'`, say) so they at least surface in horizons / `readScratch` and are not invisible.
  Still no auto-candidacy, but no longer a silent sink.

The current design is the worst of both: it pays the elevation cost and then discards the result with
no path to act on it.

## Cross-cutting findings (lifecycle + ordering)

### (A) `run_stopping` does NOT gate elevate/settle — the contract's central premise is overstated

The contract rests on ground-truth #1 (contract `:15-18`) and F1 (`kg-loop-verdict.md:35-39`): the
settle window is "the only point in a shipped workflow where `run_stopping` does not forbid the ritual,"
and "`elevateTaskScratchpad` throws `run_stopping` once the run is stopping." The code does not bear this
out for the ritual ops:

- `_assertRunAdmissionOpen` (`coordination-store.mjs:7234-7239`) is called by `createTask` (`:12120`),
  `createAndClaimRecoveryRefinement` (`:12161`), `claimTask` (`:12202`), lease derivation (`:1588`) and
  use (`:1684`), the REPL/context paths, and `reapRunScratchpads` implicitly (it *requires* a stopping
  run, `:13392-13393`). It is **not** called by `elevateTaskScratchpad` (`:13185`), by
  `settleWorkflowScratchpad` (`:13328`), by `issueRunOrchestratorLease` for the *member* run (it checks
  only the settlement *parent* run, `:1588`), or by `admitWorkflowFinding` (`:14539`).

So nothing in the store refuses `elevate`/`settle` against a stopping *member* run. The ritual's
pre-close ordering is defended by a **different** mechanism than the contract claims: stop-cleanup
(`reapRunScratchpads`, `:13391`) deletes the partitions at close, so a post-close elevate finds an empty
partition (`:13221`) and is a benign no-op (as noted in Attack 1). The F1 receipt's
`coordination_projection_poisoned` / `run_stopping` arose from a different layer (the projection rebuild
during the hand-assembled demo), not from `elevateTaskScratchpad` itself.

**Consequence (NEEDS-AMENDMENT, documentation):** D3 and ground-truth #1 should state the *real*
invariant — "the ritual runs in the window because stop-cleanup has not yet reaped the partitions; a
post-close ritual is an empty no-op, not a `run_stopping` refusal" — so a productized hook author does
not rely on a store-level refusal that does not exist. The lease path (`:1588`) and admission
(cross-cutting B) are the only ritual ops with a run-status dependency, and even admission's is weaker
than claimed.

### (B) `admitWorkflowFinding` ignores lease expiry and parent liveness — the TTL is not admission-enforced

This is the sharpest lifecycle hole and the reason Attack 2's TTL is not a real bound.
`admitWorkflowFinding` (`coordination-store.mjs:14539-14571`) validates the lease with:

```js
const leaseRecord = this._runOrchestratorLeases.get(lease?.id);
if (!leaseRecord || leaseRecord.status !== 'active' || leaseRecord.leaseDigest !== lease?.digest
  || leaseRecord.issuedEvent !== lease?.issuedEvent || leaseRecord.parent?.runId !== runId) {
  throw new CoordinationRefusal('workflow admission lease binding is invalid', 'workflow_admit_lease_invalid');
}
```
(`coordination-store.mjs:14544-14548`). That is the entire lease check. It does **not** call
`_activeRunOrchestratorLease` (`:1670`), so it skips:
- expiry: `Date.parse(now) >= Date.parse(lease.expiresAt)` → `run_orchestrator_lease_expired` (`:1674`);
- parent liveness: `task.status !== 'working'` → `run_orchestrator_parent_inactive` (`:1680`);
- run_stopping: `_assertRunAdmissionOpen(lease.parent.runId)` (`:1684`).

The admission wrapper's own `this.tick()` (`coordinator.mjs:9832`) does not rescue this: `tick()` →
`_sweepDeadlines()` (`:1361,2517-2535`) sweeps worker worktree-authority, pending approvals/publications,
pending decisions, and stop-waiters — it never touches `_runOrchestratorLeases`. So no layer between the
caller and `admitWorkflowFinding` revokes an expired lease.

Combined with Attack 2's "no reaper, `status` stays `'active'` past expiry," an admission against a
lease that is hours/years past its 30-min TTL — and whose settlement task may even have been retired —
**succeeds** as long as `status==='active'` and the digest/event/runId match. The contract's promise
that "a call with a revoked/expired lease fails with the typed lease code" (contract `:151-152`) is
**not upheld** for the *expired* case at the admission gate; only the *revoked* case is (via
`status==='active'`).

**Amendment:** route `admitWorkflowFinding` through `_activeRunchestratorLease` (or replicate its three
checks inline: expiry `:1674`, parent-working `:1680`, `_assertRunAdmissionOpen` `:1684`). This makes
the 30-min TTL an actual admission bound and closes the interaction with Attack 2.

### (C) D3 step 3 severs the note grounding chain before admission (ordering)

D3 orders the ritual: step 2 elevate (mint note scratch-fact) → step 3 settle the shared partition
(reap entries + expire scratch-facts) → step 4 candidacy → [driver exits] → admission later
(contract `:96-110`). Because step 3 runs **before** admission, by the time the orchestrator admits:

- The note's **scratch-fact** (the knowledge-bearing artifact: value `{entryId, entryDigest, kind,
  treeBinding}` with `envRef.treeSha` grounding, `coordination-store.mjs:13263-13273`) is **expired**
  (`scratch.fact_expired` at settle, `:8237-8239` / `:13378`).
- The note's **shared entry** (its full `content`) is **deleted** (`:8220`).
- The admitted Finding's evidence is only `[...candidate.evidence, { coordinationSeq:
  candidate.observedSeq }]` (`:14501`) — seq pointers to the `board.item_closed` event — and the
  candidate Finding grounds to a board item whose **title is the note's first 120 bytes** (contract
  `:103`).

So a `grounding: 'verified'` Finding (the output of admission, `:14503`) carries, in active state, a
120-byte title and two seq pointers. The note's full content and its `envRef` tree-binding survive only
in the durable event log (`scratchpad.entry_elevated` payload), not in any queryable projection.

**Amendment (ordering):** either (a) reorder D3 so the shared `settle` (step 3) runs **after** the
admission window closes (e.g., defer it to the post-TTL reaper from Attack 2, or to an explicit
post-admission step), leaving the scratch-facts/entries live for the orchestrator to ground against; or
(b) have `admitWorkflowFinding` capture the note's full content + `envRef` into the admitted Finding's
own payload *before* settle can expire it. As written, the ritual produces weakly-grounded "verified"
Findings — the strongest grounding is ledger-recoverable but not active-state queryable.

## Appendix A — anchor map (verified line numbers)

| Anchor (brief) | Verified location | Notes |
|---|---|---|
| `createTask` :12103 | `coordination-store.mjs:12103` | exact; plan-mandatory refuse `:12111-12113` |
| `createAndClaimRecoveryRefinement` :12128 | `coordination-store.mjs:12130` | function starts `:12130` (`:12128` is the close of `createTask`); validation `:2839` |
| `elevateTaskScratchpad` :13181 | `coordination-store.mjs:13185` | `:13169-13183` is the reap-receipt helper above it; terminal check `:13234`, steering `:13237`, note-only fact `:13260` |
| `settleWorkflowScratchpad` :13330 | `coordination-store.mjs:13328` | exact-ish (`:13328`); doubt disposition `type_ineligible` `:13365` |
| `issueRunOrchestratorLease` :1770 | `coordination-store.mjs:1770` | exact; derivation `_deriveRunOrchestratorLeasePayload` `:1574-1626` |
| `_assertRunAdmissionOpen` :7234 | `coordination-store.mjs:7234` | exact; **not** called by elevate/settle/admit |
| `admitWorkflowFinding` :14539 | `coordination-store.mjs:14539` | exact; lease check `:14544-14548` (no expiry/liveness/stop) |
| board candidacy :13717 | `coordination-store.mjs:13717` | `_boardSuccessor` close branch; Finding id `:13719` |
| coordinator wrappers :9700/:9727/:9831 | `coordinator.mjs:9709` (`_settleTerminalScratchpad`), `:9727` (`settleWorkflowScratchpad`), `:9831` (`admitWorkflowFinding`) | writeScratchpad `:9689`; admit actor hardcoded `:9825-9826` |
| wave-driver settle window :660-680 | `wave-driver.mjs:669` (settle), `:672-675` (close) | **no ritual present**; claim-on-stall `:632-639`; `claimed` flag `:249,470,625` |
| run-lineage TTL :22-28 | `run-lineage.mjs:22-28` | exact; `leaseTtlMs: 30*60*1000` `:27`; revocation reasons `:18-20`; capabilities `:14-16` |

Additional anchors used: `_append`/`_appendBatch` `:1354`/`:1386`; `partition_reaped` apply `:8201-8234`;
`postBoardItem` `:13671`; `_activeRunOrchestratorLease` `:1670`; `reapRunScratchpads` `:13391`;
lease status apply `:7679`/`:7681`; scratchpad ceilings `:436-443`; `TERMINAL` `:124`;
`_validateRecoveryRefinementRequest` `:2839-2877`; `claimTurn` (task→terminal via trust gate)
`coordinator.mjs:2281-2314`; `_sweepDeadlines` (no lease sweep) `coordinator.mjs:2517-2535`.

## Appendix B — verdict-to-contract change list

| Verdict | Contract change |
|---|---|
| A1 DEFENDED (minor) | D3 step 2: state the ritual gates on **store** `task.status` (re-read), and that `scratchpad_settlement_not_ready` is retried/recorded, not dropped. |
| A2 NEEDS-AMENDMENT | New: post-TTL reaper — after `issuedAt+leaseTtlMs` with no admission, revoke lease (new reason `review_window_expired`, `run-lineage.mjs:18-20`) and cancel the settlement task; retire un-admitted candidates. |
| A3 NEEDS-AMENDMENT | Per-repo `candidatesAwaitingAdmission` ceiling or reaper-tied retirement; resolve one-item-per-note vs one-digest-per-member (contract `:117-118`). |
| A4 NEEDS-AMENDMENT | Elevate `plan` to a non-candidacy method lane (no fact/board/Finding), or document that re-drive continuity recovers only the approved plan node / task brief. |
| A5 NEEDS-AMENDMENT | Pin per-note board-post key to `board.candidacy:${waveId}:${sharedEntryId}`; pin D1 settlement-task id + D2 lease-op key to `waveId`-derived constants. |
| A6 NEEDS-AMENDMENT | Do not elevate doubts in v1 (skip + `orchestrator_skipped`), or give them a review path / non-admission fact. |
| XA NEEDS-AMENDMENT | Ground-truth #1 / D3: replace the "`run_stopping` forbids the ritual" framing with the real invariant — stop-cleanup emptiness, not a store refusal. |
| XB NEEDS-AMENDMENT | `admitWorkflowFinding` must enforce lease expiry + parent-liveness + run_stopping (route through `_activeRunOrchestratorLease`). |
| XC NEEDS-AMENDMENT | Reorder D3 step 3 (settle) to after the admission window, or have admission capture note content + `envRef` before settle expires it. |

**Net:** six NEEDS-AMENDMENT (A2–A6) + three cross-cutting NEEDS-AMENDMENT (XA–XC); one DEFENDED with a
minor doc fix (A1). No CONFIRMED-HOLE on the lifecycle/ordering angle — the store primitives are sound
and individually idempotent; every hole is a **contract spec gap** (un-pinned keys, missing reaper,
overstated gating, weak admission enforcement, severed grounding, silent doubt sink) that the shipped
code does not yet force because D1–D5 are not yet wired into any live path (F1). The highest-leverage
fix is **XB**: it is the only finding that makes an *already-shipped* primitive (`admitWorkflowFinding`)
behave contrary to a contract promise (the expired-lease admission), and it is the keystone for A2's TTL
bound to mean anything at all.
