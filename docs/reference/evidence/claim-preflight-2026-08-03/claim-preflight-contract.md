# Claim-time liveness preflight — issue #88 implementation contract (v1.1)

Primary input: the GROUNDED memo `../trust-gate-steering-2026-08-02/claim-path-grounding.md`
(212 lines, fully cited). Epic context: `../trust-gate-steering-2026-08-02/trust-gate-steering-decisions.md`
v1.0 (TG1–TG7). Suite idiom: `impl/test/trust-gate-steering-red.test.mjs`.

**Fold note (v1.1, 2026-08-04).** Adversarial red-team (`contract-redteam.md`, same directory)
verdict: **NOT FOLD-READY — 4 blockers**; all four folded here. (1) CP8 termination hole —
rewritten: the refuse→nudge→re-park loop is now bound by a per-member corrective-nudge COUNT
budget (`refusalNudgeBudget: 2`, grounded in the #64 acceptance's observed claim cadence of 2,
phase11-persistent-sessions:372/:379), consumed on delivery (D8 symmetry); exhaustion is
record-only and the pause pends to the driver's PRE-EXISTING stall clock → basis `'stall'` →
guaranteed close — named, no new clock, and CP8/CP10's "exactly as today"/"Farm bound:
unchanged" claims replaced with the honest closure story. (2) Preflight error path — specified
in CP1: try/catch mirroring :2519-2522, rollback-on-throw, `resolving` always released, typed
code surfaced through the existing lanes; pinned by T18c. (3) Acceptance gaps — added: T18d
(CP4 stale-epoch pin), pin (e) wave-driver rows, T18c (preflight throw), T18 capture-kwargs
spy, T18e (null-sha edge), ok:false-receipt exclusion. (4) Citations — all five named defects
corrected (application-semantics flag :517→:516 / entry :511-519→:511-518; governance count
:12925→ now :13267; recipes overrides :557→:558; `_reservePauseRecord` :2304-2330→:2305-2337 /
rollback :2324-2328→:2325-2330; CP8 budget anchor :583-585→:599/:605). Non-blocking amendments
folded: CP3's criterion now names the third class (watchdog-observed worker content events);
the swallowed-expiry `expiryPending` re-check (CP1); the registry version-bump policy named and
deferred (CP9); CP4's harness-envelope honesty stated; the six-suite claimTurn audit folded
into acceptance (c); Open question 1 scheduled at acceptance; Open question 4 decided.
Exoneration re-check at fold: two of the six non-suite call sites independently re-verified
(31b:205, phase11:372/379) — byte-identical claim SURVIVES.

Every existing-code claim below was re-verified 2026-08-03 against the then-current tree and
RE-BASED 2026-08-04 against the CURRENT working tree (post-#78 AND post-#81 — the orientation
epic landed and moved every coordinator.mjs anchor below claimTurn; `impl/src/coordinator.mjs`
md5 8e42ead5d5dc565bcbf84398a6ceceaa, 13844 lines) via `grep -an` + `sed -n` only —
coordinator.mjs and application.mjs contain NUL bytes. The memo's line numbers have drifted;
the numbers here are the corrected ones.

## The finding (one paragraph)

`claimTurn` (coordinator.mjs:2492-2529) re-runs the FULL trust gate whose `required_effect`
phase (:12530-12546) reads ONLY the worktree capture tuple — one in-scope changed path or death.
Read-only provider-turn evidence (worker `content.tool_call`, analysis `content.message`) mints
NO gate-visible liveness anywhere the claim path looks. The #64 survivor's SCRATCHPAD_WRITE
worked by answering the TG2/TG3 steering cycle (`_observeSteeringCycle`, :2200 — the gate never
ran on that checkpoint), not by feeding the gate; under a registered driver no cycle is ever
armed (the guard at :2204 skips records with no `steering`), so the same write is inert on
the drivered path. Fix the control point that failed — claim admission — not the worker's
prompt (TG6 bans that) and not the gate's acceptance strength (TG2's law: at final, the diff is
required — kept byte-for-byte).

## Ground truths (all re-verified post-#78, re-based post-#81)

1. **The claim path.** `claimTurn` (coordinator.mjs:2492-2529), in order: reserve the record's
   single-consumer slot (:2494, `_reservePauseRecord` :2305-2337 — "a throw or a refusal anywhere
   in the bundle rolls the record back to `pending` with nothing consumed", :2302; rollback arrow
   :2325-2330, the three assignments :2326-2328 with `finishResolving()` at :2329) → clear any
   armed steering timer (:2499) → resolve the live worker/task pair
   (:2500-2502, `_pausedActTargets` :2340-2346) → append `turn.settled {basis:'claim'}`
   (:2507-2511) and transition `paused → working` (:2512-2514) → `await worktreeReady` then
   `_runTrustGate(handle, record.workerResult ?? null)` (:2515-2518) → catch rolls back and
   rethrows (:2519-2522) → commit consumed (:2524) → `{ok:true, result:'claimed'}` (:2525-2528).
2. **The gate's only progress input is the capture tuple.** `required_effect` is skipped only
   for `analysis:true` briefs or briefs without `repository_edit` (:12530, TG5) and throws
   `required_effect_absent` when `!sha || !baseSha || sha === baseSha ||
   changedPaths.length === 0 || inScopeChangedPaths.length === 0` (:12532-12546), with evidence
   built solely from shas and path digests (:12538-12543). The catch maps it into the
   policy-failure kill set (:12845): `terminalCause {kind:'policy_failure', code}` (:12846),
   scratch/board claims expired (:12851-12852), `_beginStop(handle, 'kill', …, 'policy')`
   (:12857). The pause record's `changedPathsDigest` is documented in-code as "attention-only
   evidence and is never gate input" (:2066); the record carries `turnEpoch` and
   `mintedEvent: terminalEvent.seq` (:2060-2062) — an event-epoch bound, not a clock.
3. **Read-only evidence is real, durable, hub-observed — and gate-invisible.** Worker
   `content.tool_call` touches the stall watchdog and logical tool-call accounting
   (`_observeWatchdogEvent` :8845, branch :8856-8878) and provider-turn governance telemetry
   (:13249-13269, counted :13267). Worker `content.message` becomes sanitized attention prose
   (:11541-11543) and a watchdog touch. Neither mints any progress-ledger entry. The
   `no_progress` preservation determination also reads the worktree diff only (:8105-8141).
4. **Hub receipts exist for two coordination signals.** `scratchpad.write` mints a hub-actor
   `scratchpad.write_result` receipt (:12109-12112) and `ok:true` feeds `_observeSteeringCycle`
   (:12115-12117). `context.read` mints a hub-actor `context.read_result` (:12126-12129) and is
   deliberately NOT TG2 progress ("no _observeSteeringCycle is minted here", :12124). Post-#78,
   `board.claim` mints `board.claim_result` and is likewise deliberately NOT TG2/TG3 liveness
   (:12146-12156). Resolved interactions mint `question.answered` (:9475), `approval.resolved`
   (:9480), `decision.settled` (:9607) and answer an armed cycle (:9514, :9644).
5. **The driver is diff-blind at its own layer.** `implementContract` sets
   `finalization: 'claim-on-stall'` with `unproductiveNudgeBudget: 1` (recipes.mjs:537-546,
   policy overrides :558). The wave driver's treadmill keys on `checkpoint.changedPathsDigest`
   ALONE (wave-driver.mjs:599-614; one nudge per pause via `nudgedRequestIds`, :344/:594);
   `claimOnce` (:246-264) consumes the per-member `claimAttempted` (:247-248, minted per-member
   at :343), maps an `{ok:false}` claim to `code: result.result` (:252-255), and records refusal
   codes on the claims evidence (:261-263), itself annotated "claim is terminal on a stale
   checkpoint" (:17-19, :260-261).
6. **The registry lies about claim_turn.** `claim_turn`'s entry declares `destructive: false,
   irreversible: false, idempotent: true, priority: 'recommended'`
   (application-semantics.mjs:511-518, flag at :516) for an act that can kill a healthy worker.
   The flag rides the registry's authorityProjection (:1905/:1911/:1919) whose digest IS
   `APPLICATION_SEMANTIC_REGISTRY.digest` (:1958); that digest rides every action descriptor's
   `freshness.registryDigest` (application.mjs:9761) and every `run.inspect` envelope
   (application.mjs:9803). The application dispatch of `claim_turn` (application.mjs:11892-11899)
   already forwards an `{ok:false}` coordinator result as an application error carrying
   `claimed.result` as the code — the typed-refusal lane exists today. Checkpoint attention
   advertises nudge/wait/claim at application.mjs:9621.
7. **No suite pins claim_turn's flag today.** `grep -rn 'destructive' impl/test/ | grep -i claim`
   is empty. Existing destructive pins are generic or other-operation:
   phase87-semantic-action-authority.test.mjs:60 (`run.act` destructive true, :302 destructiveHint),
   phase67-progressive-agent-experience.test.mjs:165 (typeof boolean over all operations) and
   :460 (stop destructive true), phase89-resident-application-red.test.mjs:346 (`runs.list`
   deepEqual). Every registryDigest pin is dynamic or shape-only (phase67:214 pattern, :375/:622
   dynamic equality, phase89:253-312/:425 dynamic, mcp-reflex-board-package-red.test.mjs:243
   presence) — no static hex digest pin exists, so a flag flip breaks no existing row.
8. **Red rows that must not move.** trust-gate-steering-red.test.mjs (idiom: ScriptableAdapter
   :51-71, setup :80-106, `noDiff`/`withDiff` capture stubs :113-114, `emitTurnCompleted`
   :116-121, `emitScratchWrite` :123-128): T2 (:155 — edit-free final fails), T6 (:200 — scratchpad
   answers cycle), T9 (:294-307 — drivered run gets NO cycle), T10b (:327-346 — claim on
   cycle-armed record, full gate, no steering receipt), T11 (:352-370 — sanitized {gate, detail}
   verdict), T15 (:473-479 — no gate-beating coaching in shipped text), T17 (:498-514 — drivered
   claim on edit-free pause fails `required_effect_absent`). T10b and T17 fixtures emit ZERO
   counted liveness events (spawn → `lifecycle.turn_completed` → claim), so under CP3's closed
   set they stay green byte-identically. Live-receipt harness:
   `docs/reference/evidence/frontier-sweep-2026-08-03/run-l2-impl-wave.mjs`.

## Decisions

### CP1 — Insertion point and ordering: preflight before the timer clear and the settle

The preflight evaluates inside `claimTurn` AFTER targets resolution (:2500-2502) and BEFORE both
`_clearSteeringTimer(record)` (:2499) and the `turn.settled {basis:'claim'}` append (:2507-2511)
— i.e., the timer clear moves below the preflight block. Rationale: while the reservation is held,
`rollback()` restores `pending` with nothing consumed (:2325-2330), so a refusal leaves zero
events, zero transitions, zero gate runs; and a refused claim on a cycle-armed record leaves the
cycle ARMED — the driverless steering answer can still settle the pause `working`, where the
memo-order insertion (after the clear) would disarm it and strand the pause. The preflight awaits
`handle.worktreeReady` before reading the worktree, exactly as the gate dispatch does (:2516).

**Error path — rollback-on-throw, `resolving` always released.** The whole preflight block
(worktreeReady await, fresh capture, liveness scan) is wrapped in try/catch mirroring the gate
dispatch's own :2519-2522: on ANY preflight throw — a `worktreeReady` rejection or a
`_worktrees.capture` throw (`capture_failed` is a live code path, the no_progress capture's own
sibling at :8131) — the preflight runs `rollback()` and rethrows. The pause then returns to its
exact pre-claim state: record `pending` with `consumer: null`, `resolution: null`, and
`resolvingDone` released (`finishResolving()` inside the rollback arrow, :2325-2330 — a racing
claim parked at :2309 re-enters and proceeds); the armed steering cycle stays armed (the timer
clear is still below); zero events minted. Without this, a preflight throw would strand the
record in `resolving` forever: `resolvingDone` never releases, every subsequent claim/nudge/wait
hangs at :2309, and `_expireSteeringCycle`'s reservation guard (:2237-2238, `record.state !==
'pending' → return`) skips it — a zombie pause no authority can settle. The failure surfaces as
a typed code the driver can read: the rethrown error keeps its own `code` (e.g.
`capture_failed`), the application dispatch's error lane forwards it as an application error
(application.mjs:11897-11899), and `claimOnce`'s catch records `code: error?.code ?? null` on
the claims evidence (wave-driver.mjs:262) — no new plumbing.

**Swallowed-expiry re-check (count-lawful residue fix).** If the steering window fires DURING
the preflight's capture await, `_expireSteeringCycle` returns at the reservation guard
(:2237-2238) having done nothing — and the one-shot timer is spent, so a refused claim would
restore `pending` with a dead cycle that can never fire again. Fix: the guard-skip sets
`record.steering.expiryPending = true`; the refuse path (and only the refuse path) runs the
expiry synchronously after `rollback()`. One flag and one call — no new clock.

### CP2 — Trigger predicate: mirror the gate's own would-fire test, never trust attention-only fields

The preflight fires only when BOTH hold:

- **Would-fire:** `!task.brief?.analysis && task.brief?.requiredEffects?.includes('repository_edit')`
  (mirroring :12530 verbatim) AND a FRESH `_worktrees.capture` is diffless under the same
  five-way test as :12532 (`!sha || !baseSha || sha === baseSha || changedPaths.length === 0 ||
  inScopeChangedPaths.length === 0`).
- **Liveness-present:** the CP3 closed set finds ≥1 counted event inside the CP4 window.

The record's `changedPathsDigest` is NEVER a preflight input (:2066's law holds for the
preflight too): "diffless" comes from the same capture the gate would read, so the preflight
cannot refuse a claim the gate would have passed on a stale digest. Cost is one capture per
claim; claim is once per pause record — bounded.

The mirror is exact, not shallow — three fidelity laws, all pinned at acceptance:

1. **Capture kwargs:** the preflight's capture call carries the gate-identical authority kwargs
   (`vendor`, `model`, `ownerTaskId`, and the conditional `expectedBaseSha`, `expectedBranch`,
   `workerSparseCheckoutIdentity`, :12490-12498). An implementation capturing with WRONG kwargs
   behaves differently on real worktrees (an `expectedBaseSha` mismatch throws `capture_failed`
   → the CP1 error path), so T18's capture spy asserts the received kwargs verbatim.
2. **`baseSha` derivation:** `task.sessionContext?.baseSha ?? captured?.baseSha ?? null`
   (:12531) — a shallow mirror comparing only `captured.sha === captured.baseSha` diverges from
   the gate whenever `sessionContext.baseSha` differs.
3. **In-scope filter:** `inScopeChangedPaths = changedPaths.filter((path) =>
   pathInScope(task.brief.pathScope, path))` (:12511) — out-of-scope diffs never rescue a claim.

The `!sha || !baseSha` edge is would-fire TRUE (a capture returning null sha/baseSha is
diffless under the five-way test) — pinned by its own acceptance row. The double-capture cost
claim is sound: capture is diff-vs-base stable across repeated calls (the no_progress
determination at :8105-8141 depends on exactly that), so the preflight's extra capture cannot
flip the gate's own tuple.

### CP3 — The counted liveness set is CLOSED; every class is hub-receipted, governance-counted, or a watchdog-observed worker content event

Exactly these worker-stream events count (actor classes shown are load-bearing):

1. `scratchpad.write_result` with `payload.ok === true` (hub-actor receipt, mint :12109-12112).
2. `context.read_result` with `payload.ok === true` (hub-actor admission receipt, mint
   :12126-12129).
3. `content.tool_call` with `actor === 'worker'` (governance-counted at :13249-13269;
   watchdog/logical accounting :8856-8878).
4. `content.message` with `actor === 'worker'` (analysis prose, sanitized to attention prose at
   :11541-11543; admitted as a watchdog-observed worker content event, NOT as a hub receipt —
   it is governance-counted nowhere, and the criterion names this third class honestly rather
   than pretending receipt-status).
5. `resource.provider_call` with `actor === 'worker'` (logical provider-call accounting,
   :8852-8855).
6. Interaction resolutions inside the window: `question.answered` (:9475), `approval.resolved`
   (:9480), `decision.settled` (:9607) — resolution-gated exactly per TG2; a pending interaction
   buys nothing.

The set is closed: any event kind not listed never counts, and a FAILED receipt (`ok:false`
write/read results) never counts — only `ok === true` receipts qualify, pinned at acceptance.
Rationale: every counted class is either a hub-actor receipt (unspoofable by worker text, TG2's
evidence law), already governance-counted telemetry the hub trusts for provider-turn policy, or
worker content the hub already observes for the stall watchdog — the preflight reads evidence
the hub already trusts, from the same per-worker log the gate's evidence_mapping draws on. No
content floor, per TG2: this is a liveness check, never deliverable. No per-epoch dedup is
needed (≥1 gates a boolean; TG2's no-content-floor rule holds) — the farm bound lives in CP8's
corrective-nudge budget, not here.

### CP4 — The window is the pause epoch: event-epoch-bounded, never wall-time

The liveness window is the worker's own stream (`this._log.read(record.worker)`) restricted to
events with `e.turnEpoch === record.turnEpoch` AND `e.seq <= record.mintedEvent` — the pause
record's own epoch fields (:2060-2062). No clock, no `Date`, no `progressNudgeWindowMs`. A
paused worker cannot mint post-pause same-epoch events (it is parked until nudge/claim), so the
seq bound is belt-and-braces over the epoch bound. Rationale: campaign law — the bound is a
durable event identity, replay-stable, and immune to timer flakes. Honesty note, stated once:
`turnEpoch` rides the harness wire envelope, not worker text, so this anti-stale filter inherits
harness-envelope honesty rather than TG2's worker-text law — acceptable, and pinned by the
stale-epoch acceptance row.

### CP5 — What NEVER counts

- **TG-cycle answers alone.** A scratchpad write that answered an armed cycle already had its
  effect — `_settleSteeringCycle` (:2218-2231) settled that record `working`, so no pending
  record exists for `claimTurn` to preflight. The preflight exists for the DRIVERED path where
  no cycle exists (:2204 skips steering-less records; T9 pins no cycle under a driver).
  Liveness NEVER counts toward acceptance: the final gate still demands the real in-scope diff
  (TG2's law, byte-for-byte; T2/T17 keep pinning it).
- **Lifecycle markers** (`lifecycle.turn_started`, `lifecycle.turn_completed`) — otherwise every
  pause would refuse; they are turn boundaries, not work evidence.
- **Driver/policy-actor events** (`turn.wait_noted`, nudge deliveries, `turn.settled`) —
  steering acts, not worker liveness.
- **Anything outside the CP4 window**, anything not in the CP3 set, and any worker-authored
  TEXT (output narratives stay `wrapProse`-class, never fact, per :11541-11543's CI4 rule).

### CP6 — The refusal: `claim_premature_liveness`, typed, rollback-clean, claimable later

On CP2 fire: `rollback()` and return — no throw —

```
{ ok: false, result: 'claim_premature_liveness', pauseId, taskId: task.id, workerId: handle.id,
  liveness: { <per-class counts and content digests only — TG4 sanitized shape, no path strings,
              no worker prose> },
  reason: 'worker shows read-only liveness inside this pause epoch but no in-scope diff; '
        + 'nudge the worker to continue and claim the NEXT checkpoint, or wait — '
        + 'this pause remains claimable' }
```

Guarantees, all pinned at acceptance: the pause record persists `pending` with `consumer: null`
(:2325-2330); the worker is NOT killed and stays `paused` (no `_beginStop`, no `terminalCause`);
NO `turn.settled`, NO gate event, NO verdict is minted; an armed steering cycle stays armed
(CP1 — and if the window expired mid-preflight, the `expiryPending` re-check runs the expiry
synchronously after the rollback). A preflight THROW is not a refusal: it rolls back and
rethrows with its own typed code (CP1's error path), never minting `claim_premature_liveness`.
The refusal is a claimable-later signal: the same pauseId can be claimed again, and the
preflight re-evaluates on each attempt — once a fresh capture shows an in-scope diff the
would-fire test fails and the claim proceeds to the full gate. The refusal surfaces through the
existing lanes unchanged: application dispatch rethrows it as an application error with code
`claim_premature_liveness` (application.mjs:11896-11899), and the wave driver records it on the
claims evidence via `claimOnce`'s existing `code: result.result` mapping (wave-driver.mjs:252-255,
:261-263). The `reason` text is fixed-shape, hub-authored, sanitized — driver guidance, never
worker-bound; the follow-up nudge MAY carry TG4's sanitized {gate, detail} shape
(digests+counts, no path strings) so the judged worker can learn why on its next brief.

### CP7 — Post-memo receipt classes are excluded from v1

`board.claim_result {ok:true}` (:12146-12156, #78; the deliberate non-liveness is documented
in-code at :12149-12150) and the `capability_op` steering-evidence class (:2185-2196, BU-2-2)
postdate the memo's grounded telemetry and are NOT in the CP3 set. Rationale: minimal change —
the grounded set reproduces the #88 receipt exactly (5 Bash tool_calls + analysis messages);
widening the liveness surface is its own evidence question (Open question 1). Exclusion is the
conservative direction and creates NO new blind spot: a board-only/capability-only turn counts
for nothing at claim time TODAY, so v1 preserves the status quo exactly. Post-#78 waves make
`board.claim` common in legitimate recon, so the grounding pass (live receipt + farm analysis)
is a NAMED follow-up scheduled at acceptance — not an open-ended one.

### CP8 — Wave-driver composition: per-pauseId claim attempts, a COUNTED corrective-nudge budget

Three bounded changes, all counts (no new clock):

- `claimAttempted` keys per pauseId instead of per-member (:247-248, per-member mint :343): a
  refused claim must not consume the driver's one claim for the NEXT pause record, or the CP6
  "claimable later" contract is void at the driver layer. `claimed` stays per-member (a
  completed claim still settles the member).
- On a `claim_premature_liveness` code the driver issues exactly ONE corrective nudge for the
  SAME pause, drawn from a per-MEMBER corrective-nudge COUNT budget `refusalNudgeBudget: 2`
  (parallel to `unproductiveNudgeBudget`; the nudge is exempt from the L4 one-nudge-per-pause
  dedup at :344/:594 exactly once per refusal). **The budget number is 2, grounded in the #64
  acceptance's observed claim cadence:** the largest legitimate per-member claim cadence
  observed anywhere in the acceptance suite is 2 (phase11-persistent-sessions.test.mjs:372/:379
  claims two successive checkpoints of one native session; the #64 survivor needed only one
  steering answer before producing its diff). Two corrective nudges therefore cover every
  observed legitimate cadence with one to spare; a worker that needs a THIRD corrective cycle
  with no in-scope diff has exceeded every legitimate cadence on record and is treated as
  permanently diffless. The budget is consumed on DELIVERED acknowledgment, never on attempt —
  D8's law (:618-640) holds for corrective nudges exactly as for ordinary ones: a refused
  nudge delivery arrives as a VALUE (`{ok:false, result:'delivery_exception'}`) and consumes
  nothing, so a live worker's pause is never stranded to the stall reap through a transport
  fault (the K=3 unsteerable rule at :598 still bounds persistent failure).
- **Budget exhaustion is the honest closure, named exactly.** While budget remains: refuse →
  nudge (as above). Once exhausted: the refusal is recorded on the claims evidence (:262) with
  NO nudge; the pause pends; no new pauseId is minted (nothing settles the worker, so no
  `turn.paused`/`pause:${task.id}:${seq}` (:2059) ever re-enters the outline); the stall marker
  (`stallMarker` :151-157, which hashes the whole outline INCLUDING attention requestIds, fed
  into `markerParts` :493) stops changing; `lastMarkerAt` (:521) stops resetting; and the
  PRE-EXISTING wave stall clock fires (:656, `now - lastMarkerAt >= policy.stallTimeoutMs`).
  The D9 fan-out claim (:658-664) is then refused-and-recorded — the per-pauseId attempt was
  already consumed, so it no-ops, or it is refused again and tolerated; basis `'stall'`; the
  guaranteed close reaps the wave (:713-714, L1).

Why the budget is load-bearing — the termination hole without it: once `state.done` is set by
the treadmill (:605-608), every subsequent re-park enters the done branch (:585-593); with
per-pauseId `claimAttempted` each NEW pauseId triggers a fresh claim → refused (the worker has
fresh in-epoch liveness) → fresh corrective nudge → settle working → re-park, and NO count
binds the loop — `unproductiveNudgeBudget` was already spent getting to `done`, and L4's dedup
and the K=3 rule (:594, :598) don't apply to corrective nudges by construction. Simultaneously
the wave stall clock can never fire, because each re-park's new pauseId changes the stall
marker and resets `lastMarkerAt` (:521) every cycle — leaving the 3h `hardCapMs` WALL (:689)
as the only terminator: a clock in disguise, and a close with NO gate verdict ever. The
corrective budget closes that hole with a count; the stall clock it then defers to is the
driver layer's own PRE-EXISTING terminator (the K=3 unsteerable rule already defers to
stall/cap the same way, :595-598), so this contract introduces no clock.

The honest closure text (supersedes v1.0's "closes exactly as today"): TODAY a liveness-rich
diffless worker dies at the FIRST budget-exhausted claim — gate verdict, terminal. UNDER THIS
CONTRACT it is refused, corrected at most `refusalNudgeBudget` times, and then pends to the
driver's stall/cap reap with no gate verdict — for a permanently diffless worker that stays
alive, the terminal judgment MOVES from the gate to the driver's stall/cap reap. Worst case
added latency: (`refusalNudgeBudget` × one nudge cycle) + one `stallTimeoutMs` — bounded by
counts plus the driver's pre-existing stall clock, never a new timer.

### CP9 — The honest-registry flip: `destructive: true`

application-semantics.mjs:516 flips `destructive: false → true` for `claim_turn` (entry
:511-518), and the summary (:513) is reworded to name the full final evaluation and the
refusal, e.g. "Re-run the live trust gate against the exact paused task and resolve it to
completed or failed — a final evaluation that can kill the worker; refuses
`claim_premature_liveness` while the worker shows read-only liveness without an in-scope diff."
Conformance implications, all verified safe:

- The flip changes the registry authority digest (projection :1905-1937, digest :1958), which
  changes every action's `freshness.registryDigest` (application.mjs:9761) and every envelope
  digest (application.mjs:9803). ActionIds minted before a deploy carrying the flip fail
  freshness recheck after it — expected registry-versioning semantics, not a runtime migration.
- No existing row breaks: no static digest hex pins and no claim_turn flag pins exist anywhere
  in impl/test (ground truth 7). Generic rows (phase67:165 typeof-boolean, phase87:60 run.act,
  phase67:460 stop, phase89:346 runs.list) are untouched.
- ADD conformance rows (acceptance pin c): a registry row pinning `claim_turn.destructive === true`
  and the summary naming the final evaluation, plus a surface row in
  turn-checkpoints-31b5-surface-red.test.mjs (alongside :208-229) asserting the advertised
  claim_turn descriptor carries `destructive: true`.
- `irreversible` stays `false` in v1 — see Open question 2.
- **Version policy, named:** the registry's human-facing `version` stays `'1.3.0'`
  (application-semantics.mjs:1089) — phase87:61 pins it and acceptance (c) forbids moving
  pre-existing rows. The flip therefore moves the authority DIGEST without moving the version
  string: a small honest-registry gap this contract NAMES rather than hides. The version-bump
  policy is deferred to the registry-versioning pass (with Open question 2's `irreversible`
  consumers), not decided here.

### CP10 — The silent-worker path is untouched

A diffless pause with ZERO CP3 events inside the CP4 window falls through to today's full gate
and dies exactly as now (:12532-12546 → :12845-12858). No new task state, no third gate outcome
(TG1's law: deferral is non-dispatch — the preflight is claim ADMISSION, not a gate verdict).
T17 and T10b are the byte-identical pins; T11's terminal-cause and verdict shapes are
un-re-shaped.

Farm bound, stated honestly (supersedes v1.0's "unchanged"): for the SILENT worker the bound is
unchanged — the full gate kills at the first claim, byte-for-byte. For the LIVENESS-RICH
diffless worker the bound CHANGES BY DESIGN: the terminal judgment moves from the gate to
CP8's capped corrective-nudge budget plus the driver layer's PRE-EXISTING stall/cap reap —
named, never hidden behind "exactly as today". What does not move is the anti-gaming law: the
FINAL still demands the real in-scope diff (TG2, byte-for-byte), so no worker is ever accepted
on liveness — the farm bound still lives at the final, where it has always lived. The refusal
settles nothing and consumes nothing but the driver's existing nudge/claim budgets (CP8).

## Refusal vocabulary

- `claim_premature_liveness` — the ONE new result code. Returned (not thrown) by
  `Coordinator.claimTurn`; forwarded as the application error code by the `claim_turn` dispatch
  (application.mjs:11896-11899); recorded on wave-driver claims evidence as `code`
  (wave-driver.mjs:252-255, :261-263). No gate code, no terminal cause, no verdict payload —
  it names an ADMISSION refusal, and it never appears on the worker stream as a judgment.

## Campaign-law compliance

- **Eval-able:** the typed refusal IS the eval — a durable value on three existing evidence
  lanes (coordinator result, application error code, driver claims log). The acceptance rows
  assert the value directly; no rubric, no judge.
- **Constructive:** the refusal tells the driver what to do — nudge (the CP8 corrective nudge
  productizes exactly one) or wait — instead of handing it a corpse. The guidance `reason` is
  fixed-shape hub text naming the counted-signal classes and both options.
- **Conversational:** all evidence payloads are TG4's sanitized {gate, detail} class —
  digests and counts, never path strings, never worker prose; worker-bound follow-up rides the
  nudge/revision channel, not run.feedback (TG4's law).
- **No clocks:** the liveness window is event-epoch-bounded (CP4); the driver budgets are
  counts (CP8 — `claimAttempted` per pauseId, `refusalNudgeBudget: 2` per member); the
  steering-cycle interaction is untouched. The one clock on the CP8 closure path — the wave
  stall clock — is the driver layer's own PRE-EXISTING terminator (the K=3 unsteerable rule
  already defers to it), not a timer this contract introduces. Nothing in this contract reads
  wall time.

## Acceptance pins (red-first)

**(a) The #88 receipt restaged.** New row T18 in trust-gate-steering-red.test.mjs, on the T9/T17
idiom: registered driver (`recordDriver('steering.registered', …)`), mutable capture stub, then
— inside turn epoch 1, worker actor — 5 read-only `content.tool_call` Bash-shaped events + 3
analysis `content.message` events, then `lifecycle.turn_completed`. Claim → returns `{ok:false,
result:'claim_premature_liveness'}`; assert: task `paused`, record `pending` with
`consumer: null`, worker handle alive (not dead/stopping/exited, `adapter.calls.kill` empty),
ZERO `turn.settled {basis:'claim'}`, ZERO gate/verdict/error events. Then `current = withDiff`
and claim the SAME pauseId again → `{ok:true, result:'claimed'}`, task `completed` (the
preflight's would-fire test fails on the fresh capture; the full gate runs and passes).
**T18's capture stub honors the gate's capture contract** — `capture: (...a) => current(...a)`
ignores arguments and is NOT sufficient: the stub wraps a spy asserting the preflight captured
with the gate-identical kwargs (`vendor`, `model`, `ownerTaskId`, and the conditional
`expectedBaseSha`, `expectedBranch`, `workerSparseCheckoutIdentity`, :12490-12498), that the
would-fire mirror derives `baseSha` as `task.sessionContext?.baseSha ?? captured?.baseSha ??
null` (:12531), and that the in-scope filter is `pathInScope(task.brief.pathScope, path)`
(:12511) — a shallow mirror greens nothing here. The fixture ALSO plants one
`scratchpad.write_result {ok:false}` among the liveness events: the claim is refused on the
tool_calls alone, pinning that failed receipts never count (CP3). Edge row T18e: the capture
stub returns `{sha: null, baseSha: null, changedPaths: []}` with tool_call liveness present →
would-fire is TRUE on the `!sha || !baseSha` arm (:12532) → claim refused — a null capture
tuple is diffless, never a silent pass. Live restage: re-run the L2 lane harness
(`docs/reference/evidence/frontier-sweep-2026-08-03/run-l2-impl-wave.mjs`, glm seat) and capture
the refusal receipt as a dated evidence file IN THIS DIRECTORY
(`docs/reference/evidence/claim-preflight-2026-08-03/`) — Open question 4, decided at fold:
T18's mock-provider row is the real pin; the glm live receipt is corroborating evidence.

**(b) The #64 control.** T17 and T10b stay green BYTE-IDENTICALLY (silent diffless drivered
claim still fails `required_effect_absent`, kills, names its gate per T11) — their fixtures emit
no CP3 events. ADD row T18b: the same drivered diffless pause with zero emitted liveness →
claim → task `failed`, `terminalCause {kind:'policy_failure', code:'required_effect_absent'}`,
kill observed — the preflight never engages for a silent worker. ADD row T18d (the CP4
stale-epoch pin): worker emits liveness in turn epoch 1, then a turn boundary moves the stream
to epoch 2; the epoch-2 pause is diffless with ZERO epoch-2 events → claim → the preflight does
NOT engage (liveness from BEFORE the pause's epoch never counts) → FULL gate →
`required_effect_absent` kill. A whole-stream reader with no epoch/seq restriction greens this
row byte-identically while rescuing stuck workers — T18d is the anti-stale law's only pin.

**(c) The destructive-flag conformance rows.** New registry row: `claim_turn.destructive === true`,
`irreversible === false`, `idempotent === true`, summary names the final evaluation and the
refusal. New surface row in turn-checkpoints-31b5-surface-red.test.mjs: the advertised
claim_turn descriptor carries `destructive: true`. Full impl/test gate run: every pre-existing
row (phase67, phase87 — including :61's `version === '1.3.0'` pin, which does NOT move per
CP9's named version policy — phase89, mcp-*, grammar-m1 :268-276, 31b/31b5) byte-identical
green. **Suite blast radius, enumerated (the v1.0 contract audited only T10b/T17):** the six
claimTurn call sites OUTSIDE the trust-gate suite all survive byte-identical —
phase11-persistent-sessions:372/379 (brief omits `requiredEffects` → would-fire false →
preflight never engages), turn-checkpoints-31a-red:699 (claim `.catch(() => {})`,
zero-liveness fixture → gate path), turn-checkpoints-31b5-surface-red:247 (diffed pausedRun,
asserts `claimed.ok` → would-fire false), phase10-driver-e2e:112 (real worktree diff, expects
completed), bidirectional-driver-red:369 (diffed, expects claimed), turn-checkpoints-31b-red:205
(races a nudge; the loser gets `already_resolved` at reservation, :2308-2317, BEFORE the
preflight is reached). Two of the six were independently re-checked at fold (31b:205's
already_resolved-at-reservation and phase11's requiredEffects-free brief, :24-29) — the
exoneration holds against the current tree.

**(d) Rollback honesty.** Inside T18, after the refusal assert the complete absence of partial
settle: `_pausedTurns.get(pauseId)` unchanged except state `pending`; the worker stream holds no
event with seq > the claim attempt attributable to the claim (no settle, no gate, no kill, no
claim-expiry); scratch and board claims intact; the watchdog untouched (`claimTurn` never touches
it — :2489-2490 docstring law); a concurrent second claim on the same pauseId is not poisoned by
the first refusal (reserve → refuse → reserve again works, per :2306-2314). ADD row T18c (the
preflight-throw pin): the capture stub THROWS `capture_failed` on the claim's preflight capture
→ the claim REJECTS with the typed code (`capture_failed` surfaces through the application error
lane, application.mjs:11897-11899), the record returns to `pending` with `consumer: null` and
`resolvingDone` released (:2325-2330), the armed cycle stays armed, and a SECOND claim with a
healthy capture proceeds — `resolving` is never wedged (CP1's error path).

**(e) Wave-driver composition (CP8's pins — v1.0 had NONE).** New rows in
wave-driver-red.test.mjs on the claim-on-stall idiom: (i) a `claim_premature_liveness` refusal
is recorded on the claims evidence with its code (:252-255, :262); (ii) exactly ONE corrective
nudge is issued for the SAME requestId, exempt from the L4 dedup exactly once, and a refused
nudge DELIVERY consumes no budget (D8 symmetry); (iii) the NEXT pauseId (new checkpoint after
the corrective nudge) is claimed AGAIN — the per-pauseId `claimAttempted` keying leaves the new
pause record claimable; (iv) budget exhaustion → closure: with `refusalNudgeBudget` spent, a
further refusal is recorded with NO nudge, no new pauseId is minted, the stall marker
stabilizes, the pre-existing stall clock fires, the D9 fan-out claim no-ops/tolerates, basis
`'stall'`, and the guaranteed close reaps — termination by counts plus the driver's own stall
clock, never the 3h wall.

## Open questions

1. **Post-memo evidence classes.** Should `board.claim_result {ok:true}` (:12146-12156) and
   completed `capability_op` fetches (:2185-2196) join the CP3 set? Both are hub-receipted
   coordination work that postdates the memo; each needs its own grounding pass (live receipt +
   farm analysis) before admission. v1 answer: no — and per CP7 the grounding pass is a NAMED
   follow-up scheduled at acceptance (post-#78 waves make `board.claim` common in legitimate
   recon), not an open-ended one.
2. **`irreversible`.** A successful claim that kills is not undoable; the memo's Option C flips
   only `destructive`. v1 keeps `irreversible: false` (the common outcomes — claimed-completed
   and refused — are non-destructive of principal state, and the flag pair's consumer semantics
   were not grounded in the memo). Flip both if the registry consumers read the pair jointly.
3. **Preflight capture cost.** CP2 pays one fresh `_worktrees.capture` per claim attempt. If
   dogfood shows capture latency mattering on claim-heavy waves, a digest short-circuit (skip
   the capture when the record's attention-only digest already proves a diff exists — safe
   direction only) is the named relaxation; the reverse short-circuit (trusting the digest to
   prove diffLESS) stays banned.
4. **Live-restage ownership.** DECIDED at fold (v1.1): the re-run L2 receipt lands as a dated
   evidence file in THIS directory (`docs/reference/evidence/claim-preflight-2026-08-03/`);
   T18's mock-provider row is the real pin and the glm seat's live receipt is corroborating
   evidence — either seat suffices for the restage to count, with the mock row carrying the
   acceptance bar.
