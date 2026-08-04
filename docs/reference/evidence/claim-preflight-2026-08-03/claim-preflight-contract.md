# Claim-time liveness preflight — issue #88 implementation contract (v1.0)

Primary input: the GROUNDED memo `../trust-gate-steering-2026-08-02/claim-path-grounding.md`
(212 lines, fully cited). Epic context: `../trust-gate-steering-2026-08-02/trust-gate-steering-decisions.md`
v1.0 (TG1–TG7). Suite idiom: `impl/test/trust-gate-steering-red.test.mjs`.

Every existing-code claim below was re-verified 2026-08-03 against the CURRENT working tree
(post-#78, `impl/src/coordinator.mjs` md5 85a05b87aad73c24d080545a9a2dd3fc, 13501 lines, carries
uncommitted #78 board worker-half changes) via `grep -an` + `sed -n` only — coordinator.mjs and
application.mjs contain NUL bytes. The memo's line numbers have drifted; the numbers here are the
corrected ones.

## The finding (one paragraph)

`claimTurn` (coordinator.mjs:2492-2529) re-runs the FULL trust gate whose `required_effect`
phase (:12187-12204) reads ONLY the worktree capture tuple — one in-scope changed path or death.
Read-only provider-turn evidence (worker `content.tool_call`, analysis `content.message`) mints
NO gate-visible liveness anywhere the claim path looks. The #64 survivor's SCRATCHPAD_WRITE
worked by answering the TG2/TG3 steering cycle (`_observeSteeringCycle`, :2200 — the gate never
ran on that checkpoint), not by feeding the gate; under a registered driver no cycle is ever
armed (the guard at :2204-2205 skips records with no `steering`), so the same write is inert on
the drivered path. Fix the control point that failed — claim admission — not the worker's
prompt (TG6 bans that) and not the gate's acceptance strength (TG2's law: at final, the diff is
required — kept byte-for-byte).

## Ground truths (all re-verified post-#78)

1. **The claim path.** `claimTurn` (coordinator.mjs:2492-2529), in order: reserve the record's
   single-consumer slot (:2494, `_reservePauseRecord` :2304-2330 — "a throw or a refusal anywhere
   in the bundle rolls the record back to `pending` with nothing consumed", :2302; rollback body
   :2324-2328) → clear any armed steering timer (:2499) → resolve the live worker/task pair
   (:2500-2502, `_pausedActTargets` :2340-2346) → append `turn.settled {basis:'claim'}`
   (:2507-2511) and transition `paused → working` (:2512-2514) → `await worktreeReady` then
   `_runTrustGate(handle, record.workerResult ?? null)` (:2515-2518) → catch rolls back and
   rethrows (:2519-2522) → commit consumed (:2524) → `{ok:true, result:'claimed'}` (:2525-2528).
2. **The gate's only progress input is the capture tuple.** `required_effect` is skipped only
   for `analysis:true` briefs or briefs without `repository_edit` (:12187, TG5) and throws
   `required_effect_absent` when `!sha || !baseSha || sha === baseSha ||
   changedPaths.length === 0 || inScopeChangedPaths.length === 0` (:12189-12204), with evidence
   built solely from shas and path digests (:12195-12202). The catch maps it into the
   policy-failure kill set: `terminalCause {kind:'policy_failure', code}` (:12503), scratch/board
   claims expired (:12508-12509), `_beginStop(handle, 'kill', …, 'policy')` (:12514). The pause
   record's `changedPathsDigest` is documented in-code as "attention-only evidence and is never
   gate input" (:2066); the record carries `turnEpoch` and `mintedEvent: terminalEvent.seq`
   (:2060-2062) — an event-epoch bound, not a clock.
3. **Read-only evidence is real, durable, hub-observed — and gate-invisible.** Worker
   `content.tool_call` touches the stall watchdog and logical tool-call accounting
   (`_observeWatchdogEvent` :8821, branch :8832-8848) and provider-turn governance telemetry
   (:12906-12926, counted :12925). Worker `content.message` becomes sanitized attention prose
   (:11209-11211) and a watchdog touch. Neither mints any progress-ledger entry. The
   `no_progress` preservation determination also reads the worktree diff only (:8090-8116).
4. **Hub receipts exist for two coordination signals.** `scratchpad.write` mints a hub-actor
   `scratchpad.write_result` receipt (:11777-11780) and `ok:true` feeds `_observeSteeringCycle`
   (:11782-11785). `context.read` mints a hub-actor `context.read_result` (:11794-11797) and is
   deliberately NOT TG2 progress ("no _observeSteeringCycle is minted here", :11792). Post-#78,
   `board.claim` mints `board.claim_result` and is likewise deliberately NOT TG2/TG3 liveness
   (:11803-11812). Resolved interactions mint `question.answered` (:9451), `approval.resolved`
   (:9456), `decision.settled` (:9583) and answer an armed cycle (:9490, :9620).
5. **The driver is diff-blind at its own layer.** `implementContract` sets
   `finalization: 'claim-on-stall'` with `unproductiveNudgeBudget: 1` (recipes.mjs:537-546,
   policy overrides :557). The wave driver's treadmill keys on `checkpoint.changedPathsDigest`
   ALONE (wave-driver.mjs:583-598; one nudge per pause via `nudgedRequestIds`, :328/:578);
   `claimOnce` (:246-264) consumes the per-member `claimAttempted` (:247-248, minted per-member
   at :327), maps an `{ok:false}` claim to `code: result.result` (:252-255), and records refusal
   codes on the claims evidence (:261-263), itself annotated "claim is terminal on a stale
   checkpoint" (:17-19, :260-261).
6. **The registry lies about claim_turn.** `claim_turn`'s entry declares `destructive: false,
   irreversible: false, idempotent: true, priority: 'recommended'`
   (application-semantics.mjs:511-519, flag at :517) for an act that can kill a healthy worker.
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
`rollback()` restores `pending` with nothing consumed (:2324-2328), so a refusal leaves zero
events, zero transitions, zero gate runs; and a refused claim on a cycle-armed record leaves the
cycle ARMED — the driverless steering answer can still settle the pause `working`, where the
memo-order insertion (after the clear) would disarm it and strand the pause. The preflight awaits
`handle.worktreeReady` before reading the worktree, exactly as the gate dispatch does (:2516).

### CP2 — Trigger predicate: mirror the gate's own would-fire test, never trust attention-only fields

The preflight fires only when BOTH hold:

- **Would-fire:** `!task.brief?.analysis && task.brief?.requiredEffects?.includes('repository_edit')`
  (mirroring :12187 verbatim) AND a FRESH `_worktrees.capture` is diffless under the same
  five-way test as :12189 (`!sha || !baseSha || sha === baseSha || changedPaths.length === 0 ||
  inScopeChangedPaths.length === 0`).
- **Liveness-present:** the CP3 closed set finds ≥1 counted event inside the CP4 window.

The record's `changedPathsDigest` is NEVER a preflight input (:2066's law holds for the
preflight too): "diffless" comes from the same capture the gate would read, so the preflight
cannot refuse a claim the gate would have passed on a stale digest. Cost is one capture per
claim; claim is once per pause record — bounded.

### CP3 — The counted liveness set is CLOSED, hub-receipted or governance-counted

Exactly these worker-stream events count (actor classes shown are load-bearing):

1. `scratchpad.write_result` with `payload.ok === true` (hub-actor receipt, mint :11777-11780).
2. `context.read_result` with `payload.ok === true` (hub-actor admission receipt, mint
   :11794-11797).
3. `content.tool_call` with `actor === 'worker'` (governance-counted at :12906-12926;
   watchdog/logical accounting :8832-8848).
4. `content.message` with `actor === 'worker'` (analysis prose, :11209-11211).
5. `resource.provider_call` with `actor === 'worker'` (logical provider-call accounting,
   :8828-8830).
6. Interaction resolutions inside the window: `question.answered` (:9451), `approval.resolved`
   (:9456), `decision.settled` (:9583) — resolution-gated exactly per TG2; a pending interaction
   buys nothing.

The set is closed: any event kind not listed never counts. Rationale: every counted class is
either a hub-actor receipt (unspoofable by worker text, TG2's evidence law) or already
governance-counted telemetry the hub trusts for provider-turn policy — the preflight reads
evidence the hub already trusts, from the same per-worker log the gate's evidence_mapping draws
on. No content floor, per TG2: this is a liveness check, never deliverable.

### CP4 — The window is the pause epoch: event-epoch-bounded, never wall-time

The liveness window is the worker's own stream (`this._log.read(record.worker)`) restricted to
events with `e.turnEpoch === record.turnEpoch` AND `e.seq <= record.mintedEvent` — the pause
record's own epoch fields (:2060-2062). No clock, no `Date`, no `progressNudgeWindowMs`. A
paused worker cannot mint post-pause same-epoch events (it is parked until nudge/claim), so the
seq bound is belt-and-braces over the epoch bound. Rationale: campaign law — the bound is a
durable event identity, replay-stable, and immune to timer flakes.

### CP5 — What NEVER counts

- **TG-cycle answers alone.** A scratchpad write that answered an armed cycle already had its
  effect — `_settleSteeringCycle` (:2218-2232) settled that record `working`, so no pending
  record exists for `claimTurn` to preflight. The preflight exists for the DRIVERED path where
  no cycle exists (:2204-2205 skips steering-less records; T9 pins no cycle under a driver).
  Liveness NEVER counts toward acceptance: the final gate still demands the real in-scope diff
  (TG2's law, byte-for-byte; T2/T17 keep pinning it).
- **Lifecycle markers** (`lifecycle.turn_started`, `lifecycle.turn_completed`) — otherwise every
  pause would refuse; they are turn boundaries, not work evidence.
- **Driver/policy-actor events** (`turn.wait_noted`, nudge deliveries, `turn.settled`) —
  steering acts, not worker liveness.
- **Anything outside the CP4 window**, anything not in the CP3 set, and any worker-authored
  TEXT (output narratives stay `wrapProse`-class, never fact, per :11209-11211's CI4 rule).

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
(:2324-2328); the worker is NOT killed and stays `paused` (no `_beginStop`, no `terminalCause`);
NO `turn.settled`, NO gate event, NO verdict is minted; an armed steering cycle stays armed
(CP1). The refusal is a claimable-later signal: the same pauseId can be claimed again, and the
preflight re-evaluates on each attempt — once a fresh capture shows an in-scope diff the
would-fire test fails and the claim proceeds to the full gate. The refusal surfaces through the
existing lanes unchanged: application dispatch rethrows it as an application error with code
`claim_premature_liveness` (application.mjs:11896-11899), and the wave driver records it on the
claims evidence via `claimOnce`'s existing `code: result.result` mapping (wave-driver.mjs:252-255,
:261-263). The `reason` text is fixed-shape, hub-authored, sanitized — driver guidance, never
worker-bound; the follow-up nudge MAY carry TG4's sanitized {gate, detail} shape
(digests+counts, no path strings) so the judged worker can learn why on its next brief.

### CP7 — Post-memo receipt classes are excluded from v1

`board.claim_result {ok:true}` (:11803-11812, #78) and the `capability_op` steering-evidence
class (:2185-2196, BU-2-2) postdate the memo's grounded telemetry and are NOT in the CP3 set.
Rationale: minimal change — the grounded set reproduces the #88 receipt exactly (5 Bash
tool_calls + analysis messages); widening the liveness surface is its own evidence question
(Open question 1).

### CP8 — Wave-driver composition: per-pauseId claim attempts, one corrective nudge

Two bounded changes, both counts (never clocks):

- `claimAttempted` keys per pauseId instead of per-member (:247-248, :327): a refused claim must
  not consume the driver's one claim for the NEXT pause record, or the CP6 "claimable later"
  contract is void at the driver layer. `claimed` stays per-member (a completed claim still
  settles the member).
- On a `claim_premature_liveness` code the driver issues exactly ONE corrective nudge for the
  SAME pause (a dedicated `refusalNudged` flag per requestId, exempt from the L4
  one-nudge-per-pause dedup at :328/:578 exactly once). The nudge settles the pause `working`;
  the worker resumes and either produces the diff (next checkpoint claims clean) or re-parks
  diffless — and the treadmill still counts unchanged-digest re-parks against
  `unproductiveNudgeBudget` (:583-585), so a permanently diffless worker exhausts the budget and
  the member closes exactly as today. Worst case added latency: one nudge cycle per refusal —
  bounded by counts, no timers.

### CP9 — The honest-registry flip: `destructive: true`

application-semantics.mjs:517 flips `destructive: false → true` for `claim_turn`, and the
summary (:513) is reworded to name the full final evaluation and the refusal, e.g. "Re-run the
live trust gate against the exact paused task and resolve it to completed or failed — a final
evaluation that can kill the worker; refuses `claim_premature_liveness` while the worker shows
read-only liveness without an in-scope diff." Conformance implications, all verified safe:

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

### CP10 — The silent-worker path is untouched

A diffless pause with ZERO CP3 events inside the CP4 window falls through to today's full gate
and dies exactly as now (:12189-12204 → :12502-12515). No new task state, no third gate outcome
(TG1's law: deferral is non-dispatch — the preflight is claim ADMISSION, not a gate verdict).
T17 and T10b are the byte-identical pins; T11's terminal-cause and verdict shapes are
un-re-shaped. Farm bound: unchanged — the refusal settles nothing, consumes nothing but the
driver's existing nudge/claim budgets (CP8), and the FINAL still demands the real diff.

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
  counts (CP8); the steering-cycle interaction is untouched. Nothing in this contract reads
  wall time.

## Acceptance pins (red-first)

**(a) The #88 receipt restaged.** New row T18 in trust-gate-steering-red.test.mjs, on the T9/T17
idiom: registered driver (`recordDriver('steering.registered', …)`), mutable capture stub
(`let current = noDiff; capture: (...a) => current(...a)`), then — inside turn epoch 1, worker
actor — 5 read-only `content.tool_call` Bash-shaped events + 3 analysis `content.message`
events, then `lifecycle.turn_completed`. Claim → returns `{ok:false,
result:'claim_premature_liveness'}`; assert: task `paused`, record `pending` with
`consumer: null`, worker handle alive (not dead/stopping/exited, `adapter.calls.kill` empty),
ZERO `turn.settled {basis:'claim'}`, ZERO gate/verdict/error events. Then `current = withDiff`
and claim the SAME pauseId again → `{ok:true, result:'claimed'}`, task `completed` (the
preflight's would-fire test fails on the fresh capture; the full gate runs and passes).
Live restage: re-run the L2 lane harness
(`docs/reference/evidence/frontier-sweep-2026-08-03/run-l2-impl-wave.mjs`, glm seat) and capture
the refusal receipt as a dated evidence file alongside this contract.

**(b) The #64 control.** T17 and T10b stay green BYTE-IDENTICALLY (silent diffless drivered
claim still fails `required_effect_absent`, kills, names its gate per T11) — their fixtures emit
no CP3 events. ADD row T18b: the same drivered diffless pause with zero emitted liveness →
claim → task `failed`, `terminalCause {kind:'policy_failure', code:'required_effect_absent'}`,
kill observed — the preflight never engages for a silent worker.

**(c) The destructive-flag conformance rows.** New registry row: `claim_turn.destructive === true`,
`irreversible === false`, `idempotent === true`, summary names the final evaluation and the
refusal. New surface row in turn-checkpoints-31b5-surface-red.test.mjs: the advertised
claim_turn descriptor carries `destructive: true`. Full impl/test gate run: every pre-existing
row (phase67, phase87, phase89, mcp-*, grammar-m1 :268-276, 31b/31b5) byte-identical green.

**(d) Rollback honesty.** Inside T18, after the refusal assert the complete absence of partial
settle: `_pausedTurns.get(pauseId)` unchanged except state `pending`; the worker stream holds no
event with seq > the claim attempt attributable to the claim (no settle, no gate, no kill, no
claim-expiry); scratch and board claims intact; the watchdog untouched (`claimTurn` never touches
it — :2489-2490 docstring law); a concurrent second claim on the same pauseId is not poisoned by
the first refusal (reserve → refuse → reserve again works, per :2306-2314).

## Open questions

1. **Post-memo evidence classes.** Should `board.claim_result {ok:true}` (:11803-11812) and
   completed `capability_op` fetches (:2185-2196) join the CP3 set? Both are hub-receipted
   coordination work that postdates the memo; each needs its own grounding pass (live receipt +
   farm analysis) before admission. v1 answer: no.
2. **`irreversible`.** A successful claim that kills is not undoable; the memo's Option C flips
   only `destructive`. v1 keeps `irreversible: false` (the common outcomes — claimed-completed
   and refused — are non-destructive of principal state, and the flag pair's consumer semantics
   were not grounded in the memo). Flip both if the registry consumers read the pair jointly.
3. **Preflight capture cost.** CP2 pays one fresh `_worktrees.capture` per claim attempt. If
   dogfood shows capture latency mattering on claim-heavy waves, a digest short-circuit (skip
   the capture when the record's attention-only digest already proves a diff exists — safe
   direction only) is the named relaxation; the reverse short-circuit (trusting the digest to
   prove diffLESS) stays banned.
4. **Live-restage ownership.** Which dated evidence directory receives the re-run L2 receipt
   (new `claim-preflight-2026-08-XX/` vs. appending here), and whether the glm seat or a mock
   provider suffices for the restage to count as "live".
