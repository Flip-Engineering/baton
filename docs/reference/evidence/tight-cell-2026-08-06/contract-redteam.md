# Epic #102 tight-cell contract — adversarial red team (v1.0 DRAFT under review)

Date: 2026-08-06
Target: `docs/reference/evidence/tight-cell-2026-08-06/tight-cell-contract.md` (fleet-drafted, deepseek worker)
Method: every anchor re-derived against the working tree with NUL-safe `grep -an` / targeted
`sed -n` reads of `impl/src/{wave,wave-driver,application,application-semantics,coordinator,coordination-store,limits}.mjs`,
plus the cited docs (`docs/34`, `docs/37`, `orchestrator-friction-ledger.md`, `board-workerhalf-contract.md`).

**Verdict: NOT FOLD-READY — 9 blockers (7 MAJOR, 2 MINOR).** The anchor discipline is better
than fleet-drafted feared — no fabricated anchors — but one citation substantively mis-states
the schema it cites, and the four load-bearing design claims (quorum terminal, collective
result, N-spawn mechanism, broadcast/grant composition) each hit machinery the contract never
names. Details below; blockers are numbered at the end.

---

## 1. Citation ledger (attack surface 1)

~40 distinct anchors checked. **No hallucinated anchors** — every cited function, line range,
constant, and doc row exists and says approximately what the contract claims. That is the good
news. The defects:

### 1a. SUBSTANTIVE mis-statement — the `waves.start` member schema (BLOCKER 8)

Anchor 3 claims the member item is "closed on `['role', 'objective', 'exact']`"
(`application-semantics.mjs:1566-1590`). Re-derived truth:

- `objectSchema(properties, required = Object.keys(properties))` returns
  `{type:'object', properties, required, additionalProperties: false}`
  (`application-semantics.mjs:145-147`). The second argument is the **required** array, not the
  closed-key set.
- The member item (`application-semantics.mjs:1572-1579`) declares **four** properties —
  `role, objective, exact, scope` — with `required: ['role','objective','exact']` and
  `additionalProperties: false`. It is closed on FOUR keys; `scope` IS admitted (optional).
- Consequence the contract never states: **member-level `exact` is REQUIRED at the transport
  seams today** — both in the schema's `required` array and in `_normalizeWaveStart`
  (`!member.exact || ...` refuses, `application.mjs:11601-11603`). Decision 1's
  `wave_group_route_conflict` / `wave_group_exact_missing` design requires inverting a
  currently-required field into a conditionally-forbidden one. The static `objectSchema`
  helper cannot express that XOR; the schema row must drop `exact` from `required` and the XOR
  must move into `_normalizeWaveStart`/`validateMember`. As drafted, a group member without
  member-level `exact` dies in MCP schema validation with a generic shape error before any
  cell vocabulary can fire, and TC-02/TC-03 cannot be routed as written.
- Related seam-skew: member-level bare `harness`/`model`/`effort` keys are already refused as
  unknown keys at both transport seams (closed on `['role','objective','exact','scope']` in
  `_normalizeWaveStart`, `application.mjs:11598`). So `wave_group_route_conflict` for those
  three keys can only ever fire at the `createWave`/`validateMember` library seam
  (`wave.mjs:98-103`). The contract must pin which seam owns which refusal.

### 1b. Cosmetic imprecisions (not blockers; fix in passing)

- `coordinator.mjs:6838` is cited for "the frame carries `messageId` for `inReplyTo`" — 6838
  is the messageId **mint**; the frame is the `[MESSAGE ${kind} ${messageId} — UNTRUSTED]`
  wrap at ~6858 (the #92 comment at 6855-6857 is the honest anchor).
- Anchor 8 cites `coordination-store.mjs:14293,14783` for the mint's `_boardRunBindings`
  check — those are the sibling read/admission paths' checks; `mintBoardGrant`'s own binding
  check is at `coordination-store.mjs:14940` (uncited). Claim is true; anchor is misaddressed.
- `docs/34-knowledge-horizons.md:51-52` — the workflow-horizon definition spans 50-51 and
  says "the orchestrator's working memory **for a wave**"; the contract paraphrases "for one
  run". Run-scoped is correct; the paraphrase inverts the doc's own scope noun.
- Off-by-ones: `wave.mjs:504-506` (runs getter spans 504-507); `_taskByRun` cited 15011-15015
  (spans 15011-15016); `_normalizeWaveStart` cited 11585-11630 (starts 11583); `startWave`
  cited 11437-11477 (ends ~11472); `permissionsForWaveRole` cited 71-77 (spans 71-74).

### 1c. Verified exact (sample of the load-bearing ones)

`wave.mjs:50-105` validateMember ✓; 163/169 member bound + role uniqueness ✓; 193-212 member
loop with `baton.runs.start(... driverKind:'wave', waveId, waveRole, waveStart)` ✓; 390-406
materialize ✓; 427-445 settle outcomes (430-431 never-started member) ✓. Zero `cell`/`group`
matches (case-insensitive) in `wave.mjs` and `impl/test/wave-driver-red.test.mjs` ✓ (the file
exists). `application.mjs:52/53` ceilings ✓; 2269-2284 `runWorkerOwnership` ✓; 4481-4491
composition team map ✓; 5795-5796/7341-7342/7767-7768 ownership projections ✓; 11437
startWave ✓; 11516-11579 sendWaveMember with `.find(...)` at 11523 ✓; 11600 NUL rejection ✓.
`application-semantics.mjs:100-108` `applicationTerminal` = {completed, failed, cancelled,
stopped, denied} ✓. `coordinator.mjs:6793-6898` sendMessage ✓; 6835 broadcast filter ✓; 6836
`run_not_active` ✓ (exact); 6841 `deliveries: new Map()` ✓ (exact); 6896-6897 receipt ✓;
10634-10657 horizon intersect + `context_scope_forbidden` ✓; 11060-11078
`_runHorizonNodeIds` ✓ (11063 `runTaskIds` ✓); 11229-11251 `mintMemberBoardGrant` with
`.find` at 11231 ✓ (exact); 71-74 `permissionsForWaveRole` ✓. `coordination-store.mjs:14892-
15009` mintBoardGrant ✓; 14894 closed 11-key entry ✓; 14949-14951 member-coordinate proof
✓ (exact); 14998-15003 closed grant payload ✓ (exact); 15018-15026 `_waveMembershipOf` ✓;
15037-15062 boardGrantPage ✓. `limits.mjs:54` (message.send.body 2048), `:57`
(wave.member.objective 4096), `:85` (spill.body 1 MiB) ✓ all exact. `wave-driver.mjs:535`
terminal predicate ✓ (exact); basis ∈ {completed, stall, hard_cap, aborted}
(`wave-driver.mjs:414,514,704,735,741,787`; `docs/37-wave-driver.md:84-86`) ✓. Seed rows:
`orchestrator-friction-ledger.md:36` (#96/#102 row) ✓ exact; `:44` (#102 group-bindings row)
✓ exact. `board-workerhalf-contract.md:16-23` seed ✓; `:537-541` non-goals ✓; Decision 4 CAS
(`:299-321`) ✓.

---

## 2. Per-decision verdicts

### D1 — closed group field `{size, quorum?, exact}`: **HOLE** (blocker 8)

The validator reuses are real and the refusal vocabulary is eval-able, but the decision is
written against a mis-read schema (§1a): member `exact` is required today, not optional, and
the contract never names the required-array inversion its own refusal codes depend on. Fix:
state that the `waves.start` schema row drops `exact` from `required`, that the
exact-XOR (`group.exact` present ⟺ member `exact` absent) is enforced in
`_normalizeWaveStart` + `validateMember`, and which seam emits `wave_group_route_conflict`
for bare `harness`/`model`/`effort` keys.

### D2 — N-spawns-one-run binding: **HOLE** (blocker 4)

The binding *shape* is sound and store-admitted (see surface 2 below): N tasks on one runId,
one worker per task. The *mechanism* is not:

- The only existing multi-node plan path is `intent.composition`
  (`application.mjs:4481-4491`), and it unavoidably builds the **workflow role catalog, the
  `attempts` block, strategy/workspace/join, and the v3 workflow record**
  (`application.mjs:4551-4583`), and divides `workflowNodeBudget(profile, team.length, ...)`
  across the team (`application.mjs:4486-4489`). The contract's own words — "NO role catalog /
  attempts block (the cell is not a workflow)" — cannot be satisfied by the path it cites as
  the proving idiom. "The composition machinery already proves one run can hold N
  tasks/workers" is true at the *projection* layer only.
- The intake seam is missing from the surface list: run-start intent normalization
  (`application.mjs:1399-1462`, allowed keys at 1399) rejects any new cell/group intent field
  today, and `startWave`/`_normalizeWaveStart` reject a member `group` key. TC-01 knows this;
  D2's surface list does not.
- Unpinned per-node rules: plan nodes need distinct `key`s (`attempt:${member.role}` today —
  what are the cell's N keys?), distinct objectives, and a budget story (the composition
  budget division is workflow-specific; what funds N homogeneous nodes?).
- OQ2 nominally chose the plan-mint reading, but with these seams unnamed the choice is
  unexecutable as a contract.

Fix: name the new plan-mint branch (or admit composition-reuse with synthetic roles and own
the contradiction), add `application.mjs:1399-1462` + the node-key/budget rules to the
surface, and extend TC-04 to pin node keys and the absence of any workflow record.

### D3 — shared-horizon law: **SOUND**

Verified end to end: `_runHorizonNodeIds` admits a node iff `node.runId === runId`, or
`node.taskId ∈ runTaskIds` (all tasks with `task.runId === runId`,
`coordinator.mjs:11063-11067`), or its evidence cites the run's task/elevation events
(11068-11076); run-scoped read kinds intersect after lookup, foreign reads refuse
`context_scope_forbidden` (10653-10657). Given D2's invariant (every cell task's
`runId === cellRunId`), every cell worker reads every run-scoped node — the #96 sidestep is
real and costs no new machinery. One documentation note: `docs/34:51,73-74` already uses
"cells" for package content units ("each wrapped cell mints a `Source` KG node") — the
contract's "cell" collides with an existing docs term; rename or disambiguate in the docs
sweep.

### D4 — per-worker grants on the shared board: **HOLE** (blocker 5)

The diagnosis is correct and precisely anchored: `_taskByRun` returns the first task of the
run (`coordination-store.mjs:15011-15016`), `mintMemberBoardGrant` resolves the first worker
(`.find`, `coordinator.mjs:11231`), and the member-coordinate proof
(`memberTask.assignee === workerId && version && status==='working'`,
`coordination-store.mjs:14949-14951`) means **today a grant for cell worker #2+ always
refuses** `board_worker_scope_refused`. The report owner-CAS claim is verified
(`board_report_no_active_claim` + `board_report_stale_claim_version`,
`coordination-store.mjs:14854-14861`, re-checked in the in-append gate). Three holes:

1. **Grant-mint idempotency collision.** `_boardGrantMints` is indexed by the RAW caller key
   (`coordination-store.mjs:8759-8768`, replay-derived; checked at 14992-14995). N per-worker
   mints under ONE `waves.send` idempotencyKey produce different requestDigests (workerId /
   taskId / grantDigest differ) → mint #2..N refuse `board_replay_conflict`. The worker-op
   lane already namespaces by grantDigest (`<op>:<grantDigest>:<callerKey>`,
   `coordination-store.mjs:14800-14801`) precisely to avoid this; the mint path does not.
   Fix: pin per-worker mint key derivation (e.g. `grant.mint:<grantDigest>:<sendKey>:<workerId>`
   — i.e. derive a distinct caller key per worker) in the contract.
2. **Grant delivery vs broadcast composition.** Today the grant rides the `[BOARD_GRANT]`
   JSON block inside the single-worker's steer text (`application.mjs:11546-11551`). D5 routes
   cell sends through the C5 broadcast, which delivers ONE identical body to all N workers.
   Either every worker receives all N grants' material (grantIds are bearer-proofed by the
   coordinate rebind — `boardGrantPage` 15039-15045, `admitWorkerBoardCommand` 14775-14781 —
   so possession is unexploitable, but the contract never says this is the intent), or the
   mint lane needs N per-worker deliveries (defeating the single broadcast receipt). Unpinned
   either way.
3. **Vocabulary omission.** TC-08's own oracle fires codes the contract's vocabulary never
   lists: `board_report_no_active_claim`, `board_report_stale_claim_version` (and the mint's
   `board_grant_invalid`, `board_lease_required`, `board_session_mismatch`,
   `board_run_closed`). See D8.

### D5 — broadcast receipts: **HOLE** (blocker 6)

C5 verified as cited: `{runId}` fan-out over `this._workers` filtered by task runId
(`coordinator.mjs:6834-6836`), honest partial receipt
`{ok:true, result:'sent', messageId, delivered, targetCount}` (6893-6897), per-worker
`record.deliveries` (6841) plus durable per-worker `message.delivered` audit events. Three
unpinned regressions/collapses:

1. **Reply collapse.** A message record admits exactly ONE reply: `if (parent.depth >= 1 ||
   parent.reply) refuse('message_depth_exceeded')` (`coordinator.mjs:12467-12470`), and
   `parent.reply = replyEnvelope` is a single slot (12511). All N cell workers receive the
   SAME `messageId`; the first reply wins and the other N-1 are refused with a code that
   names depth, not contention. Attribution per se exists (`from: workerId` in the envelope,
   12503-12510) — exclusivity is the hole. The contract never mentions replies. Fix: pin the
   cell reply policy (per-worker reply slots keyed by workerId, or declare cell broadcasts
   one-way with a documented refusal) and add a red row.
2. **Fence-CAS loss.** The current `waves.send` lane is fence-checked
   (`expectedFence: target.fence`, `application.mjs:11551-11553`; enforced in
   `coordinator.send`, `coordinator.mjs:7256`). `sendMessage` takes no fence — cell sends
   silently drop the ordering/freshness CAS. The contract presents the lane switch as
   costless ("the cell simply makes the wave transport USE it"); it is not.
3. **Delivery-mode collapse.** `waves.send` supports `delivery: nudge|now|turn`
   (`application.mjs:11546,11559`); the C5 broadcast hardcodes `'nudge'`
   (`coordinator.mjs:6863`). What happens to `delivery` for a cell member is unpinned.

### D6 — quorum terminal: **HOLE** (blockers 1, 2) — the deepest problem in the contract

1. **No substrate: the run's terminal truth is first-node-derived.** Both run-view builders
   derive phase, terminal, result, and terminalCause from `projection.nodes[0]` ONLY:
   `const node = projection.nodes[0]; ... workerId = task?.assignee` then
   `phase = node.state === 'accepted' ? ... : 'failed' ...` (`application.mjs:7393-7430`;
   same pattern in `_historicalProfileView`, `application.mjs:5680-5700`). Consequences for a
   cell run:
   - Worker #1 resting flips the WHOLE cell run to `result_ready`/`completed` while N-1
     workers still run — the wave driver's predicate (`wave-driver.mjs:535`) settles the
     member early. Quorum never gets to count.
   - Worker #1 dying marks the run `failed` regardless of how healthy workers #2..N are —
     quorum never gets to forgive.
   - `survived` has **no source** in any projection the wave driver or `settle` reads; D6's
     surface list (`wave-driver.mjs:535`, `wave.mjs:427-445`, `wave-driver.mjs:783-804`)
     omits the run-status builder where the truth must be aggregated.
   Fix: name the per-worker terminal-truth source (run-status aggregation over all plan
   nodes, or a wave-handle-level aggregation over `ownership.workerIds` with per-worker
   `coordinator.result` reads) and add `application.mjs:7393-7430` to D6's surfaces; add a
   red row "worker#1 terminal does not settle the cell".
2. **`group.exact === true` can never hold — `cell_exact_breach` is dead code.** D1 defines
   `group.exact` as the REQUIRED closed route OBJECT `{harness, model, effort}`; a boolean
   `exact: true` refuses `wave_group_invalid` at admission. Yet D6's fourth bullet, TC-13's
   setup ("`group.exact: true` with any loss"), and D8's `cell_exact_breach` row all key on
   the boolean reading — the very reading OQ1 calls "less likely" and self-colliding. The
   contract contradicts itself in its normative text. Fix: resolve OQ1 before fold — rename
   the exact-size flag (`group.strict`) or drop `cell_exact_breach` from v1 — then repair
   D6/TC-13/D8.
3. **`survived` counts stopped/denied workers as survivors.** The rest-set `{completed,
   result_ready, stopped, denied}` means an operator who stops 2 of 3 workers before they
   produce anything yields `survived = 3` → cell `completed`, collective result minted from
   one worker's tree. A dishonest quorum. Fix: `survived` counts work-rest phases
   (`{completed, result_ready}`) only; `stopped`/`denied` go to `lost` (or a third, named
   bucket).
4. **Liveness caveat the "no clocks" claim needs.** Quorum tolerates DEAD workers only. A
   hung-but-alive straggler is neither `survived` nor `lost`, so the cell cannot settle and
   the wave resolves via the driver's pre-existing `stall`/`hard_cap` basis (a clock the wave
   machinery already owns — fine, but the contract should say plainly that quorum does not
   bound waiting and "no partial-cell stop" means a straggler can only be reaped by stopping
   the whole cell run).
5. Reap mechanics are otherwise fine: run stop reaps ALL of the run's workers
   (`stopRunTargets(current.targetWorkerIds, ...)` with strict completion accounting —
   `remainingCount !== 0` throws — `_performRunStop`, `application.mjs:4034-4070`), two-phase
   per worker (`coordinator.mjs:7587`). "No partial-cell stop" matches the machinery.
6. The prompt's writer-lease framing does not map: `coordination_writer_busy` is the
   store-global single-writer lease (`coordination-store.mjs:1256`), never held by a cell
   member. The real terminal-vs-writers hazard is (1) plus: **nothing revokes surviving
   workers' board grants or quiesces their worktrees when the cell outcome mints** — grants
   stay active until `board.grant_revoked` or a generation bump
   (`coordination-store.mjs:8772`; `boardGrantPage` checks no member-task liveness). Pin the
   ordering: cell outcome mint ⟂ grant revocation ⟂ task terminality.

### D7 — single collective result: **HOLE** (blocker 3)

Anchor 11's "the run result is shared across the run's workers" is **false as a machinery
claim**. The result section is built from `coordinator.result(workerId)` where `workerId` is
`nodes[0]`'s task assignee (`application.mjs:7395-7402`) — the run result is the FIRST
worker's result. Meanwhile each task gets its OWN worktree
(`this._worktrees.create(task.id, ...)`, `coordinator.mjs:3573`), so N cell workers produce N
divergent trees, and nothing merges them (the cell is forsworn as a workflow — no join).
"One collective result" as drafted = first-completer's tree, with N-1 trees silently
invisible. TC-15 ("exactly ONE entry ... single `resultSha`") greens on exactly that shallow
behavior — it pins shape, not provenance. Fix: pin the derivation — e.g. a designated
result-owner node, or the existing per-node adoption seam (`run.adopt(runId, nodeKey,
resultSha, ...)`, `application.mjs:957`; projected per nodeKey at 7414) — and strengthen
TC-15 to distinguish N divergent worker trees (each worker writes distinct content; the
collective `resultSha` must match the named derivation, and `degraded` must name which
survivors' trees it covers).

### D8 — failure vocabulary: **HOLE** (blocker 9)

Not closed as claimed. Missing: `board_report_no_active_claim`,
`board_report_stale_claim_version` (the codes TC-08's own oracle fires), plus the composed #78
admission codes `board_grant_invalid`, `board_lease_required`, `board_session_mismatch`,
`board_run_closed`, `board_worker_command_invalid`, `board_claim_invalid`,
`board_report_invalid`. D4 names `board_item_not_open`, `conflict`, `stale_board_fence`; D8's
"closed" table omits them. `cell_exact_breach` keys on the impossible boolean (blocker 2).
`cell_degraded` is listed as a "terminal phase" while D6/TC-11 name the phase `'degraded'` —
code/phase skew. Fix: regenerate the table from the composed code paths, or drop the word
"closed".

### D9 — red-first suite: **SOUND in discipline, incomplete in coverage**

The discipline (every red row fails today) is honestly satisfied — no group field, first-only
send lane, first-by-runId mint, no quorum, first-node results all verified absent/present as
claimed, and both referenced suite homes exist. Coverage gaps: no row pins the reply collapse
(D5), the grant-mint key derivation (D4), the trust-gate interaction (surface 3), per-node
key/budget rules (D2), or result provenance (TC-15 is shape-only). TC-13 is unimplementable
as written (blocker 2). TC-06's "the run itself never aborts" and TC-11/12's quorum oracles
cannot be greened until blocker 1's substrate exists — the suite would be red against ANY
implementation that only touches the cited surfaces.

---

## 3. Attack-surface answers (as posed)

1. **Citations** — §1: no fabrications; one substantive mis-statement (blocker 8), four
   cosmetic imprecisions.
2. **One-run-N-workers binding** — The store admits exactly one shape: **N tasks on one run,
   one worker per task**. `claimTask` refuses a second claimant (`already_assigned`) and CASes
   the version (`stale_version`) (`coordination-store.mjs:12546-12565`); one task claimed by N
   workers is impossible. The contract says the right shape ("each node dispatches to its own
   task + worker; every task carries `task.runId === cellRunId`"). The run view admits N
   workers (`runWorkerOwnership`, `application.mjs:2269-2284`; ownership projection
   5795-5796). What does NOT exist is the spawn mechanism that isn't a workflow — blocker 4.
3. **Trust gate + preflight** — Per-worker, per-task, verified: per-task worktrees
   (`coordinator.mjs:3573`), gate capture via `_captureTrustWorktree(handle, task)`
   (2684-2694), the `required_effect` verdict per claim
   (`sha === baseSha || changedPaths.length === 0 || inScopeChangedPaths.length === 0` →
   `required_effect_absent`, 12844-12861) → `policy_failure` terminal (13719-13723). An idle
   member **cannot** hide behind a productive sibling — its own capture is empty and it is
   killed loudly; that direction is safe, and the #88 liveness preflight stays per-worker
   (2551-2606). The hole is the reverse, and it is **blocker 7**: under a
   `repository_edit`-required profile EVERY cell worker must produce an in-scope diff in its
   own worktree; an honestly-divided cell (a member that only reads/claims/reports through
   the board) gets policy-killed and counted as a cell loss under D6. The contract never
   mentions the trust gate, `requiredEffects`, or per-worker worktrees; D2's homogeneous
   nodes inherit the member profile's `requiredEffects` for all N. Fix: state how
   `requiredEffects` propagate to cell nodes and either constrain cell profiles or define a
   cell-level effect judgment; add a red row.
4. **Quorum terminal** — What reaps the rest: the run stop (`_performRunStop` reaps all
   `targetWorkerIds` with strict accounting, two-phase per worker) — machinery SOUND. What
   breaks: the terminal signal itself (blocker 1), the dead-code exact-breach (blocker 2),
   stopped/denied counted as survivors (D6.3), and no grant/worktree quiescence ordering at
   cell terminal (D6.6). A "quorum terminal minting a result while a member still writes" is
   reachable TODAY through the first-node projection: worker#1 rests → run reads terminal →
   settle mints the outcome and materializes the result while workers#2..N hold live grants
   and dirty worktrees; the subsequent close reaps them mid-work.
5. **Broadcast** — Receipt attribution is per-worker and durable (`record.deliveries` +
   per-worker `message.delivered` events) ✓; reply attribution exists but is SINGLE-SLOT —
   N-1 cell replies refused `message_depth_exceeded` (blocker 6); depth is fine (broadcast
   depth 0, reply depth 1); identity is fine (distinct workerIds). Fence-CAS and
   delivery-mode losses unpinned.
6. **Self-division exclusion** — **SOUND.** One active claim per item
   (`existing.active → result:'conflict'`), fence CAS (`stale_board_fence`), in-append
   re-check gate (`coordination-store.mjs:14525-14552`, 14802-14819), report owner-CAS on
   `(workerId, ownerTask)` + `expectedClaimVersion` (14854-14861), grants non-transferable
   across members (workerId+taskId+processGeneration rebind). Two cell members cannot hold
   the same item; the second gets a clean conflict. The contract pins the report half in
   TC-08; the claim half is machinery-verified.
7. **Single collective result** — **HOLE (blocker 3).** First-worker's capture, N divergent
   per-task worktrees, no merge, no named derivation, TC-15 greens the shallow behavior.
8. **Acceptance pins vs shallow implementation** — Strong: TC-04 (kills the "N independent
   runs" cheat — `ownership.workerIds.length === size` + per-task runId), TC-05, TC-07,
   TC-09/10, TC-17, TC-18, TC-19. Weak/absent: TC-15 (no provenance), TC-13 (impossible as
   written), TC-11/12 (oracles fine, substrate unnamed), no rows for reply policy, mint-key
   derivation, trust-gate interaction, or node-key/budget rules.

## 4. Open questions — fold verdicts

1. **OQ1 (`group.exact` semantics): FOLD-BLOCKING.** The normative text already baked in the
   boolean reading OQ1 calls unlikely (D6 bullet 4, TC-13, D8). Resolve to `group.strict` (or
   drop the exact-size discipline) before fold.
2. **OQ2 (spawn location): FOLD-BLOCKING as enumerated.** The plan-mint choice is made but
   its seams (intent normalization `application.mjs:1399-1462`, the composition-only branch
   4479-4491, node keys, budget) are unnamed; TC-04/TC-06/TC-18 cannot be implemented against
   the cited surfaces alone.
3. **OQ3 (default quorum): resolved — SOUND.** Strict (`quorum = size`) is the honest default
   and the rationale is correct; nothing further needed. (But fix D6.3's survivor set.)
4. **OQ4 (progress projection): deferred — OK.** TC-15 already forces the one-row shape; the
   handle `cell` sub-view is additive. Not blocking.
5. **OQ5 (`MAX_CELL_SIZE = 64`): deferred — OK.** Named cap with derivation and a re-derive
   trigger; byte headroom is real (`view.run.bytes` = 512 KiB, `limits.mjs:96`; 64 workerIds
   ≈ 3 KB). TC-17 carries the proof.

## 5. Blockers (numbered)

1. **[D6, MAJOR] Quorum has no substrate.** Run phase/terminal/result derive from
   `projection.nodes[0]` only (`application.mjs:7393-7430`; `_historicalProfileView`
   5680-5700). Worker#1 settles or fails the whole cell run; `survived` is uncountable from
   every cited surface. Name the per-worker terminal-truth source and add the run-status
   builder to D6's surfaces; red-row "worker#1 terminal does not settle the cell".
2. **[D6+D1, MAJOR] `group.exact === true` self-contradiction.** `exact` is the required
   route object; the boolean exact-size reading is admission-invalid. `cell_exact_breach` is
   dead code; TC-13 unimplementable. Resolve OQ1 (`group.strict` or drop); repair D6/TC-13/D8.
3. **[D7, MAJOR] Collective-result provenance unpinned.** "Shared across the run's workers"
   is false (first worker's result, `application.mjs:7395-7402`); N divergent per-task
   worktrees (`coordinator.mjs:3573`); no derivation rule; TC-15 greens the shallow lie. Pin
   the derivation (designated node or `run.adopt`) and strengthen TC-15.
4. **[D2, MAJOR] Spawn mechanism unpinned.** The cited composition idiom drags the workflow
   record/role catalog/attempts/budget division the contract forswears
   (`application.mjs:4479-4491,4551-4583`); the intent-normalization seam (1399-1462) and
   node-key/budget rules are absent from the surfaces.
5. **[D4, MAJOR] Grant-mint idempotency collision.** `_boardGrantMints` is raw-caller-key
   indexed (`coordination-store.mjs:8759-8768,14992-14995`): mint #2..N under one send key
   refuse `board_replay_conflict`. Pin per-worker mint-key derivation; pin how `[BOARD_GRANT]`
   material composes with the one-body broadcast.
6. **[D5, MAJOR] Reply collapse + silent guarantee loss.** One reply slot per broadcast
   (`coordinator.mjs:12467-12470,12511`) — N-1 cell replies refused `message_depth_exceeded`;
   contract silent. Cell sends also drop the fence CAS (`application.mjs:11551-11553` vs
   `coordinator.mjs:7256`) and the `now`/`turn` delivery modes (`coordinator.mjs:6863`).
   Pin reply policy; acknowledge or restore the CAS/modes.
7. **[Trust gate, MAJOR] `required_effect` vs cell division of labor unaddressed.**
   Per-worker verdicts (`coordinator.mjs:12844-12861,13719-13723`) policy-kill any cell
   member whose honest share produces no in-scope diff; D6 counts that as cell loss. Pin
   requiredEffects propagation for homogeneous nodes + a red row.
8. **[D1, MINOR — automatic]** Schema citation mis-stated: `['role','objective','exact']` is
   the REQUIRED array, not the closed set; `scope` is the fourth admitted key; member `exact`
   is required at both transport seams (`application-semantics.mjs:145-147,1572-1579`;
   `application.mjs:11601-11603`). The exact-XOR inversion must be specified.
9. **[D8, MINOR]** Vocabulary not closed: omits the report-CAS codes its own TC-08 fires
   (`board_report_no_active_claim`, `board_report_stale_claim_version`) and the other composed
   #78 admission codes; `cell_degraded` phase-name skew vs TC-11's `'degraded'`.

**Sound as drafted:** D3 (shared horizon — verified end to end), surface 6 (claim exclusion),
D2's binding *shape* (N tasks/one run is the store's admitted model), reap mechanics
(run stop reaps all N, strict accounting), D9's red-first discipline (coverage gaps
notwithstanding), and the citation corpus except §1a/§1b.

---

*Red-team method note: `impl/src/application.mjs`, `coordinator.mjs`, and
`coordination-store.mjs` contain NUL bytes; all reads were `grep -an` / `sed -n` ranged, never
whole-file. No implementation files were modified; this report is the only artifact written.*
