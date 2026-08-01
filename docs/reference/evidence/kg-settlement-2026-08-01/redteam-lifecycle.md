# KG settlement contract v0.9 — lifecycle & ordering red-team

**Angle:** LIFECYCLE + ORDERING. Every claim grounded in `file:line`.
**Date:** 2026-08-01
**Attempt:** `f6ea8c4f-0b03-493c-8418-ffd0e29b557d` (lifecycle-attacker)
**Contract under test:** `docs/reference/evidence/kg-settlement-2026-08-01/kg-settlement-decisions.md`
**Gap receipts:** `docs/reference/evidence/kg-tiered-loop-2026-08-01/kg-loop-verdict.md` (F1, F2, wiring constraints)

## Scope & method

- Anchors read and verified:
  - `coordination-store.mjs` — `createTask` :12103, `createAndClaimRecoveryRefinement` :12130,
    `elevateTaskScratchpad` :13185, `settleWorkflowScratchpad` :13328, `issueRunOrchestratorLease`
    :1770, `_assertRunAdmissionOpen` :7234, `admitWorkflowFinding` :14539, board candidacy :13717,
    `_activeRunOrchestratorLease` :1670, `admitBoardCommand` :13494, `_apply` for
    `scratchpad.partition_reaped` :8201, scratchpad bounds :438-443.
  - `coordinator.mjs` — `_settleTerminalScratchpad` :9709, `settleWorkflowScratchpad` :9727,
    `admitWorkflowFinding` :9831, `releaseTerminalTaskResources` :1815, `writeScratchpad` :9665,
    `claimTurn` :2281, `_admitPauseRecord` :1988, worker-gate 'paused' comments :9783-9816.
  - `application.mjs` dispatch :11767.
  - `application-semantics.mjs` S-3 rows :1436-1510 (`scratchpad.elevate` :1436,
    `scratchpad.settle` :1447, `knowledge.promote` :1480-1487), terminal canon :99-107.
  - `wave-driver.mjs` settle window :660-680, claim path :238-256, terminal derivation :458,
    claim-on-stall fan-out :635-658, basis computation :621-627.
  - `run-lineage.mjs` TTL default :22-28.
- Read-only review: no `impl/` edits. Only write target: this report.

## Verdict summary

| # | Attack | Verdict |
|---|--------|---------|
| 1 | Claimed-terminal member with pending scratchpad writes (checkpoint pause) | **NEEDS-AMENDMENT** |
| 2 | Settlement task/lease orphaned after driver exit; TTL 30 min | **CONFIRMED-HOLE** (two sub-holes) |
| 3 | Default-on ledger growth worst case vs `MAX_SCRATCHPAD_SHARED_ENTRIES` | **NEEDS-AMENDMENT** |
| 4 | D4 skips plan+link → re-drive continuity (issue #59) | **DEFENDED** (rationale needs correction) |
| 5 | Crash mid-hook (steps 2↔3, lease↔board post) exactly-once | **CONFIRMED-HOLE** (board-post key + lease-TTL-window) |
| 6 | Doubts elevate but never candidate — silent sink | **CONFIRMED-HOLE** |

---

## Findings

### 1. Claimed-terminal vs pending scratchpad writes (checkpoint pause) — NEEDS-AMENDMENT

**Question.** Can a member be counted terminal by the driver while its worker scratchpad
partition still has writes in flight from a checkpoint pause, so the settle-window elevation
reaps a partition that excludes them?

**Mechanism.**

1. A worker parks at a turn checkpoint. `_admitPauseRecord` mints `turn.paused`, sets
   `task.status = 'paused'`, and keeps the pause record `pending` when a driver is registered
   (`coordinator.mjs:1988-2037`). The task is live, **not** terminal — `TERMINAL` is
   `{completed, failed, cancelled}` (`coordination-store.mjs:124`), and the run phase `paused`
   is not in `APPLICATION_TERMINAL_CANONICAL` (`application-semantics.mjs:99-101`).
2. The coordinator's own worker gates explicitly accommodate **trailing writes racing the
   turn-completed frame**: `paused` is in the allowed task-status set for board/scratch/repl
   traffic "so a trailing write racing the turn-completed frame must not be spuriously refused"
   (`coordinator.mjs:9783-9786, 9796-9799, 9631-9632`). `writeScratchpad` allows
   `working | input_required | paused` (`coordinator.mjs:9671`).
3. The driver's `claim-on-stall` finalization claims **every pending-paused member** at wave
   stall (`wave-driver.mjs:635-639`), and the L6-done path claims a member whose digest is
   unchanged past budget (`wave-driver.mjs:563-565, 580-588`). A successful `claim_turn`
   unparks the task and re-runs the live trust gate to `completed`/`failed`
   (`coordinator.mjs:2281-2314`). From then on `task.status` is terminal, so a trailing write
   that lands after the claim is refused `worker_not_active` (`coordinator.mjs:9671-9673`).
4. The settle-window elevation then runs against the **current durable fence**
   (`coordinator.mjs:9722` reads it; `coordination-store.mjs:13216-13219` CAS-checks it) and
   reaps the partition (`coordination-store.mjs:13317` → `_apply` deletes every entry and bumps
   the fence, :8219-8224). The refused trailing write never enters the partition.

**Result.** There is a real, if narrow, race: a write that was admissible while the task was
`paused` (the exact case the code comments at `coordinator.mjs:9783-9799` say must be admitted)
is silently dropped if the claim lands before it. The elevation/settle cannot see it, and the
reap makes it unrecoverable from the partition (the immutable ledger still holds prior events,
but the entry itself is gone). The contract's step 2-3 ordering has **no quiesce barrier**
between "claim → terminal" and "elevate/reap".

**Verdict: NEEDS-AMENDMENT.** Amendment text:

> D3 step 2 must not elevate a partition whose terminal is fresh off a claim. Introduce a
> durable partition-seal barrier: `claimTurn`/`claim_turn` must append a
> `scratchpad.partition_sealed` marker (or the store's `elevateTaskScratchpad` must refuse
> `scratchpad_settlement_not_ready` while any pause record for the task is still `pending` /
> while the task's terminal event is newer than the last `scratchpad.entry_written` for the
> scope). Equivalently, the driver must require a quiesce poll: after basis=completed, one
> status/fence re-read with no new `entry_written` in the scope before elevating. The elevation
> selecting "exactly the note and doubt entries" is only honest if the partition is sealed.

Note also the *false-terminal* direction is defended: the driver only counts a paused member
settled via `claimed === true` (`wave-driver.mjs:470, 624-626`), and `claimed` is only set on a
successful `claim_turn` (`wave-driver.mjs:243-249`), which durably terminals the task; a
scope-mismatch/stale claim leaves `claimed=false` and the member is re-read
(`wave-driver.mjs:644-657`). A store-side elevation of a genuinely `paused` task is refused by
the `TERMINAL` gate (`coordination-store.mjs:13233-13236`).

---

### 2. Settlement task orphan: who reaps it after driver exit? — CONFIRMED-HOLE

**Question.** D3 step 4 materializes a settlement run + working parent task + 30-min lease. If
`knowledge.promote` never comes, what reaps them?

**Grounding.**

- The lease TTL is `leaseTtlMs: 30 * 60 * 1_000` (`run-lineage.mjs:27`); the lease `expiresAt`
  is `min(session.expiresAt, issuedAt + TTL)` (`coordination-store.mjs:1606-1609`).
- The store is a single-writer event log with **no background reaper**: no `setInterval` /
  TTL sweep exists, and the run/task/lease maps are never pruned — `_runOrchestratorLeases`,
  `_runs`, `_tasks` have no `.delete` call sites (`grep` over `coordination-store.mjs`).
  `revokeRunOrchestratorLease` (:1799) is the only path to `status: 'revoked'`, and nothing
  calls it automatically.
- An expired lease stays `status: 'active'` in `_runOrchestratorLeases`; `runOrchestratorLease`
  returns the row regardless of expiry (:1825-1827). The 30-min TTL only bites when the lease is
  *used*: `_activeRunOrchestratorLease` (:1674) and `admitBoardCommand` (:13561) check
  `expiresAt`. **The workflow-admission gate does not.**
- `admitWorkflowFinding` validates `leaseRecord.status !== 'active'`, digest, issuedEvent, and
  parent runId — **but never checks `expiresAt`** (`coordination-store.mjs:14544-14548`).
  So a caller holding the lease coordinates can `knowledge.promote` **after** the TTL has
  passed and the admission succeeds. The TTL is decorative for the one act it was designed to
  gate.

**Result.** Two holes:

1. **Orphaned rows.** If promote never comes, every wave leaves: one open settlement run
   (`run-settlement:<waveId>`, never sealed), one working `relation: 'settlement'` task, and one
   active-but-expired lease row — none of which any shipped path reaps. Accumulates one tuple
   per wave, unboundedly. (Contrast: member runs are reaped at `wave.close`
   (`wave-driver.mjs:669-675`); the synthetic settlement run is created outside the wave and is
   not a member, so close never touches it.)
2. **TTL not enforced at admission.** `knowledge.promote` after expiry succeeds
   (`coordination-store.mjs:14539-14571`), so the contract's own ordering device
   ("rule 16b ordering", `kg-settlement-decisions.md` D2) is bypassable by timing.

**Verdict: CONFIRMED-HOLE.** Amendment text:

> (a) `admitWorkflowFinding` must enforce the lease TTL exactly as
> `_activeRunOrchestratorLease` does — add
> `if (Date.parse(this._clock()) >= Date.parse(leaseRecord.expiresAt)) throw
> 'run_orchestrator_lease_expired'` (mirror `coordination-store.mjs:1674`). (b) Define a
> settlement-run lifecycle with a reaper: on lease expiry (checked at next
> `knowledge.settlement_lease` call and at store open/replay boundary), revoke the lease with
> reason `superseded`, cancel the settlement task, and seal the settlement run — or, minimally,
> extend `reapRunScratchpads`' family with a `settlement.sweep(runId)` that terminalizes a
> settlement run whose lease expired. (c) State in D2 that an un-promoted settlement is garbage
> collected by (b); "the settlement task must outlive the wave" must be bounded, not forever.

---

### 3. Default-on ledger growth per wave (worst case) — NEEDS-AMENDMENT

**Question.** D3 defaults `settlement: 'kg-ritual'`. What is the worst-case ledger/KG growth
per wave under the store's real caps?

**Caps.** `MAX_SCRATCHPAD_WORKER_ENTRIES = 128` (`coordination-store.mjs:438`),
`MAX_SCRATCHPAD_SHARED_ENTRIES = 512` (:439), `MAX_SCRATCHPAD_STOP_PARTITIONS_PER_PASS = 64`
(:443).

**Worst-case event math per wave** (M members with non-empty partitions; shared cap 512):

| Step | Events | Grounding |
|---|---|---|
| Worker reaps (1 per member) | `M` | `coordination-store.mjs:13309-13316` |
| Elevations: 1 `entry_elevated` per selected + 1 `scratch.fact_posted` per **note** | ≤ `512 × 2 = 1024` | :13283-13292, cap :13241 |
| Board posts: 1 `board.item_posted` per elevated note | ≤ `512` | :13691 |
| Board closes: 1 `board.item_closed` + 1 `knowledge.node_added` (candidate Finding) per note | ≤ `512 × 2 = 1024` | :13717-13732 |
| Shared settle: 1 `partition_reaped` + 1 `scratch.fact_expired` per active shared fact | ≤ `1 + 512 = 513` | :13371-13381 |
| Settlement materialization (run + task create/claim + lease) | ~`4-6` | D1/D2 mirror `recovery_refinement_create_claim` batch :12163-12166 |
| **Total** | **≈ `M + 3,077`** | |

KG growth: up to **512 `grounding:'observed'` candidate Finding nodes** per wave, minted
unconditionally at board close (`coordination-store.mjs:13717-13732`), plus — if every candidate
is admitted — 512 `verified` findings + 512 `DerivedFrom` edges (`coordination-store.mjs:14500-14512`).

**What is *not* a hole:** the "honest-empty" claim holds. With no scratchpad entries, elevation
returns `empty` with no append (:13220-13227), settle returns `empty` (:13353-13359), and step 4
requires ≥1 elevated, so no lease/board. Default-on costs nothing for empty waves. — the 
`candidatesAwaitingAdmission: 0` receipt convention is driver-side only.

**What is a hole:**

1. **Unbounded cross-wave KG accumulation.** Candidate Findings are permanent nodes; nothing in
   the contract reaps or demotes an unadmitted candidate. 512/wave × 100 waves = ~51k `observed`
   nodes of possibly-unreviewed material. The board-close candidacy is unconditional by design
   ("no gate here; Part D is the later, explicit settle-time gate", :13713-13716) — so default-on
   materializes candidacy for **every** wave even when no orchestrator will ever review it.
2. **All-or-nothing elevation under the shared cap.** A member whose selection would push the
   shared partition past 512 gets `scratchpad_partition_exhausted` and the *whole* member's
   elevation fails (`coordination-store.mjs:13241-13243`) — e.g. 5 members × 128 worker entries
   = 640 potential; the first-comers win the cap, later members lose everything. The driver
   records ≤8 typed errors (`kg-settlement-decisions.md` D3), so a wave with >8 failures silently
   truncates its error report.
3. **Board-item count is uncapped by the driver** (1 per note, up to 512). The contract's own
   red-team target ("is one-item-per-note right, or one digest item per member?") is left open.

**Verdict: NEEDS-AMENDMENT.** Amendment text:

> (a) Cap board candidacy: default to **one digest board item per member** (or a
> `settlement.maxBoardItems` policy field, default small), not one item per note. (b) Make the
> shared-cap elevation **partial**: elevate up to the remaining `MAX_SCRATCHPAD_SHARED_ENTRIES`
> budget and dispose the overflow as `orchestrator_skipped` (reasonCode `shared_cap`), instead
> of all-or-nothing `scratchpad_partition_exhausted`. (c) Define a candidate lifecycle: an
> unadmitted candidate Finding should be demotable/expirable (e.g. `knowledge.candidate_expired`
> at horizon digest) rather than permanent — or require an explicit `settlement: 'kg-ritual'`
> opt-in per wave rather than default-on, so candidacy materialization is a reviewed choice.

---

### 4. D4 skips plan+link — re-drive continuity (issue #59) — DEFENDED (rationale needs correction)

**Question.** Elevation selects only `note`+`doubt` and skips `plan`+`link`
(`kg-settlement-decisions.md` D4). The worker's plan IS its method — does skipping it destroy
re-drive continuity for dead attempts?

**Grounding.**

- Re-drive continuity in the shipped recovery model comes from **checkpoint pins + `turn.settled`
  replay**, not from the shared scratchpad: "re-drive is the ONLY recovery for terminalized
  members … salted objectives; checkpoint pins", "Steering continuity comes from `turn.settled`
  replay, not driver memory" (`docs/reference/evidence/wave-durability-2026-07-30/wave-durability-decisions.md:50,69-73`).
  The recovery-refinement path records an explicit `recovery.continuation_intent`
  (`coordination-store.mjs:12757-12780`); it does not read the prior worker partition.
- The plan is **never destroyed**: `scratchpad.entry_written` events are immutable ledger rows
  (`coordination-store.mjs:13160`) and the event log `_events` is append-only, never pruned
  (grep: no slice/shift/delete on `_events`; reads slice from it, e.g. :8581). D4 only controls
  what is *elevated* into the shared partition / board.
- The shared partition is a **transient staging area** anyway: the very next step
  (`scratchpad.settle`, step 3) reaps and **deletes every shared entry** (`coordination-store.mjs:8219-8223`).
  Elevating plans would only prolong their deletion by one step — they would still never reach
  the board (step 4 candidacy is notes-only).

**What is wrong with the contract's rationale.** D4 says "plans are ephemeral procedure whose
value dies with the task". That is factually false — the plan persists in the ledger, and it
remains readable *from the ledger* after the task dies. What is true is narrower: the plan is
not *surfaced* (no fact, no board item, no candidacy). And once the worker partition is reaped,
the plan is no longer readable via the `scratchpadSnapshot` family
(`coordination-store.mjs:13060` reads the live partition, which the reap empties) — a
re-drive/recovery that *wants* the dead attempt's method has no supported read. The wave-durability
re-drive path doesn't need it, but the contract offers nothing for plan-aware continuation.

**Verdict: DEFENDED** for the shipped re-drive path (checkpoint-pin + `turn.settled` replay is
unaffected by elevation selection), with a **NEEDS-AMENDMENT** correction:

> D4's "value dies with the task" rationale is wrong and should say: *plans and links are not
> elevated because the shared partition is a notes/doubts staging area reaped at settle, and
> because candidacy is notes-only; the plan remains reconstructable from the immutable ledger.*
> Adopt the contract's own red-team suggestion and make the rule a driver policy field
> (`settlement.elevateKinds`, default `['note','doubt']`) so a deployment that wants
> plan/link continuity can opt in. If plan-aware re-drive is a goal, add a documented read
> (`replayScratchpadEntries(runId)` over `scratchpad.entry_written`) rather than relying on
> elevation.

---

### 5. Crash mid-hook: exactly-once re-drive? — CONFIRMED-HOLE

**Question.** Walk a crash between steps 2-3 (elevate → settle) and between lease and board
post (step 4). Do the waveId/runId-derived keys make re-drive exactly-once?

**Idempotency inventory (verified):**

| Operation | Idempotency key | Deterministic? | Re-drive after crash |
|---|---|---|---|
| `elevateTaskScratchpad` | `scratchpad.partition_reaped:${runId}:${taskId}:${fence}` (:13196) | Yes (runId+taskId+fence) | **Yes** — if the batch landed, the worker partition is empty and step 2 skips (`:13220-13227`); if it didn't, it runs fresh. The `_appendBatch` is atomic (:13317), no partial state. |
| `settleWorkflowScratchpad` | `scratchpad.partition_reaped:${runId}:shared:${fence}` (:13337) | Yes (runId+shared+fence) | **Yes, only if the driver re-reads the current shared fence** — each elevation bumps the shared fence (`:8200`), so a cached pre-elevation fence yields `stale_scratchpad_fence` (:13349-13351). |
| `knowledge.settlement_lease` | `run.orchestrator_lease:${leaseId}` (:1789); `leaseId = run-orchestrator-lease:${digest(identity)}` (:1605), identity incl. `parentTaskVersion` (:1595-1604) | Yes **iff** the re-drive does NOT re-create the settlement task (a new version → new leaseId → *new* lease). The D2 design ("re-calling returns the existing lease") requires a find-by-runId-first materialization. | **Conditional.** |
| Board posts/closes | `envelope.idempotencyKey` (:13593); itemId mints from `mintSeq = events.length` (:13686) | **No by default** — a fresh `idempotencyKey` on re-drive mints a NEW itemId (`:13686`), and the prior-lookup replay (:13593-13632) only fires if the same key is re-sent with an identical requestDigest. | **Duplicate board items unless the driver derives the key deterministically** (e.g. from the shared entryId). The contract does not mandate this key derivation — its "all keys derive from waveId/runId — verify" is **unverified for board posts**. |

**The lease-TTL window breaks replay.** `admitBoardCommand` checks lease liveness (status
`active` AND `expiresAt` in the future, :13560-13563) **before** the idempotency-prior lookup
(:13593). A re-drive that resumes >30 min after the lease was issued (TTL `run-lineage.mjs:27`)
gets `board_lease_required` on the *replay* of an already-posted item — exactly-once becomes
"refused", not "replayed". The contract's acceptance ("a second driver run over the same wave
idempotent") is therefore bounded to the lease window.

**Crash-between-steps-2-and-3:** defended (elevation batch atomic; settle key fresh-read;
see inventory). **Crash-between-lease-and-board-post:** CONFIRMED-HOLE — board posts are not
exactly-once under a re-drive unless the driver passes deterministic keys, and the lease TTL can
turn replays into refusals.

**Verdict: CONFIRMED-HOLE.** Amendment text:

> (a) Mandate the board-post idempotency key in D3 step 4: each item keyed
> `board.wave-settlement:<waveId>:<sharedEntryId>` (deterministic across re-drives because the
> elevated shared entryId is itself deterministic given runId+source entry+digest,
> `coordination-store.mjs:13249-13252`). The itemId is derived, so a replay returns the prior
> item. (b) Order `admitBoardCommand`'s replay check **before** the lease-liveness gate so an
> idempotent replay of an already-posted/closed item does not require a live lease (or make the
> settlement lease renewable for the settle-window duration). (c) State in D3 that the driver
> must re-read `scratchpadFence(runId, 'shared')` at settle time — never cache it across the
> elevation step. (d) Keep the D2 "find existing settlement task by runId" materialization so
> the lease key is stable across re-drives.

---

### 6. Doubts elevate but never candidate — silent sink — CONFIRMED-HOLE

**Question.** D3 step 2 elevates `doubt` entries into the shared partition; step 4 candidacy is
notes-only. Is the doubt a silent sink?

**Mechanism.**

1. Step 2 elevates `doubt` entries to the shared partition (selection `note`+`doubt`,
   `kg-settlement-decisions.md` D4). No `scratch.fact_posted` is minted for doubts — the fact
   path is `if (source.kind === 'note')` only (`coordination-store.mjs:13260`). No board item.
2. Step 3 (`scratchpad.settle`) reaps the shared partition. `_apply` for
   `scratchpad.partition_reaped` **deletes every shared entry** and the scope bucket
   (`coordination-store.mjs:8219-8223`), bumping the fence (:8224). The elevated doubts are
   therefore **deleted by the very next step** of the same ritual. The settle's dispositions
   mark them `not_eligible` / `type_ineligible` (:13362-13365) — a ledger record that they
   existed and were discarded, nothing more.
3. The contract claims "candidacy for doubts is the orchestrator's call, v1 excludes it
   deliberately" — but there is **nothing left to call on**: no board item, no fact, no surviving
   shared entry, and the receipt's `candidatesAwaitingAdmission` counts board items (notes),
   not doubts. The orchestrator has no surface to review a doubt; the doubt's only trace is two
   ledger events (`entry_elevated` + `partition_reaped` disposition).

**Result.** Doubts — which D4 itself classifies as knowledge-bearing open questions — are
elevated to a staging area and destroyed within the same ritual. The elevation is theater; the
"orchestrator's call" is structurally unreachable. **Silent sink: CONFIRMED.**

**Verdict: CONFIRMED-HOLE.** Amendment text (pick one, or combine):

> (a) Surface doubts: post one **open** (never closed) board item per elevated doubt on
> `wave-settlement-doubts:<waveId>` so they persist for orchestrator review, and exclude
> `doubt` entries from the step-3 settle reap (disposition `retained` instead of `not_eligible`,
> `coordination-store.mjs:13362-13365`). (b) If doubts are not to be surfaced in v1, the
> contract must say so honestly — D4's "knowledge-bearing, orchestrator's call" framing is
> false; replace it with "doubt entries are elevated then discarded at settle; surfacing doubts
> is a v2 item". (c) Alternatively mint `scratch.fact_posted` for doubts too (extend
> `coordination-store.mjs:13260` past `note`) so an elevated doubt at least leaves a durable
> fact the horizon can cite, and add a receipt line
> `knowledge.doubtsElevated: <count>` so the loss is visible.

---

## Amendments required (consolidated)

1. **Quiesce barrier before elevation** (finding 1) — seal the worker partition at
   claim/terminal, or refuse elevation while a pause record is pending / a trailing write could
   land.
2. **Enforce lease TTL at `admitWorkflowFinding`** (finding 2a) — mirror
   `coordination-store.mjs:1674`.
3. **Settlement-run reaper** (finding 2b) — expire → revoke → cancel → seal an unpromoted
   settlement run; bound "outlive the wave".
4. **Cap/curate board candidacy** (finding 3) — one digest item per member (or a policy cap);
   partial elevation under the shared cap; a candidate lifecycle (demote/expire unadmitted
   candidates).
5. **Correct D4 rationale + `settlement.elevateKinds` policy field** (finding 4) — plans are
   not destroyed (immutable ledger); provide a ledger replay read if plan-aware re-drive is a goal.
6. **Deterministic board-post idempotency keys** (finding 5a) —
   `board.wave-settlement:<waveId>:<sharedEntryId>`; replay-before-liveness in
   `admitBoardCommand` (5b); fresh shared-fence read at settle (5c); find-by-runId settlement
   task materialization (5d).
7. **Surface doubts** (finding 6) — open doubt board items, retain doubt-kind shared entries at
   settle, or honestly document the discard.

## Evidence index

- `coordination-store.mjs:124` — `TERMINAL = {completed, failed, cancelled}` (paused excluded).
- `coordination-store.mjs:438-443` — scratchpad caps (worker 128 / shared 512 / stop passes 64).
- `coordination-store.mjs:13216-13243` — elevation fence CAS, task-terminal gate, shared-cap
  all-or-nothing refusal.
- `coordination-store.mjs:13260-13291` — note-only fact minting; per-entry elevation events.
- `coordination-store.mjs:13317, 13371-13381` — atomic elevation batch; settle batch shape.
- `coordination-store.mjs:13713-13732` — board close mints candidate Finding unconditionally.
- `coordination-store.mjs:14539-14571` — `admitWorkflowFinding` lease checks (no `expiresAt`).
- `coordination-store.mjs:1605-1625, 1670-1685` — lease identity derivation; expiry check only
  in `_activeRunOrchestratorLease`.
- `coordination-store.mjs:1770-1797, 1799-1823` — lease issue/revoke; revoke is the only
  revocation path.
- `coordination-store.mjs:8201-8234` — `partition_reaped` deletes entries; fence bump.
- `coordination-store.mjs:13560-13632` — board admission lease-liveness before replay lookup.
- `coordination-store.mjs:13686` — board itemId mints from `mintSeq` (not re-drive-deterministic).
- `coordinator.mjs:1815-1840` — `releaseTerminalTaskResources` reaps worker partition empty at
  terminal (currently no call sites; a future caller would kill the settle-window elevation).
- `coordinator.mjs:2281-2314` — `claimTurn` re-runs the gate to completed/failed (terminal).
- `coordinator.mjs:9665-9707` — `writeScratchpad` gate; `worker_not_active` after terminal.
- `coordinator.mjs:9709-9725` — `_settleTerminalScratchpad`; current-fence read at call time.
- `coordinator.mjs:9783-9799` — `paused` is live; trailing-write race acknowledged for worker traffic.
- `wave-driver.mjs:238-256, 458, 470, 563-565, 580-588, 621-680` — claim semantics, terminal
  derivation, settle window.
- `run-lineage.mjs:22-28` — default lease TTL 30 min.
- `application-semantics.mjs:99-107, 1436-1510` — terminal canon; S-3 kernel rows
  (`knowledge.promote` liveMethod is still `promoteKnowledgeNode` at :1486 — D2 must amend it).
- `docs/reference/evidence/wave-durability-2026-07-30/wave-durability-decisions.md:50,69-73` —
  re-drive continuity = checkpoint pins + `turn.settled` replay.
