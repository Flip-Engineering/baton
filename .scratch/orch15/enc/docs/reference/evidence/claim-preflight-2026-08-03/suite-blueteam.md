# Blue-team: claim-preflight red suite (#88) — adversarial verification

(Target: `impl/test/claim-preflight-red.test.mjs` — 26 rows: §A T18/T18e; §B T18w/r/p/q +
pins T18b/d/s/x/y/z; §C T18h/g/c; §D T18f/i; §E CP9a/b; §F WD1 (pin) + WD2/3/4; §G pins
X1/X2/X3. Verified against the v1.1 post-fold contract
`docs/reference/evidence/claim-preflight-2026-08-03/claim-preflight-contract.md` +
`contract-fold.md`, and `impl/src/` ground truth at the CURRENT tree —
`impl/src/coordinator.mjs` md5 `8e42ead5d5dc565bcbf84398a6ceceaa`, 13 844 lines, byte-matching
the suite header's recorded pre-implementation tree. NUL-containing files (coordinator.mjs,
application.mjs) inspected via `grep -an`/`sed -n` only, 2026-08-04. Suite run from repo root:
`node --test impl/test/claim-preflight-red.test.mjs`, node v25.8.0.)

Verdict scale: **SOUND** = red for the named stage today, green only on a contract-correct
implementation, and a wrong implementation cannot pass it. **WEAK** = correctly staged and
discriminating in composition, but a named wrong implementation can pass it (false-green
hole). **VACUOUS** = passes without exercising the named behavior. **STAGED-WRONG** = the
row's red/green state does not track the named contract behavior.

## 0. Run record (exact counts)

```
ℹ tests 26
ℹ pass 10
ℹ fail 16
```

Passing (the 10 pins): T18b, T18d, T18s, T18x, T18y, T18z, WD1, X1, X2, X3.
Failing (the 16 red rows): T18, T18e, T18w, T18r, T18p, T18q, T18h, T18g, T18c, T18f, T18i,
CP9a, CP9b, WD2, WD3, WD4. **The measured 16 red / 10 pin split matches the declared split in
the suite header's Verification block exactly — no divergent row, reconciliation trivial.**
Four consecutive runs (one full + three confirmation) were byte-identical in counts and in
which rows failed — the timer-bearing rows (T18h/T18g 100 ms windows, WD 400 ms stall clock)
show no flake at this scale.

Every red row fails AT its named stage, none earlier (fixture bug) or later:

| Stage named by the row | Rows | Observed failure |
|---|---|---|
| `claim-preflight-missing` | T18, T18e, T18w, T18r, T18p, T18q, T18f, T18i (8 rows) | claim **RETURNED** `{"ok":true,"result":"claimed","outcome":"failed","verdict":null}` after the gate policy-kill — not a throw (see adjudication A4) |
| `cycle-ordering` | T18h | `the claim refuses BEFORE the timer clear (got claimed)` |
| `expiryPending-re-check` | T18g | `the claim still refuses (got claimed)` |
| typed-throw lane (CP1 error path) | T18c | `actual: 'claimed'` vs `__thrown__:capture_failed` — today the gate's own catch swallows `capture_failed` into claimed/failed (verified, §A4) |
| `registry-flag-lie` | CP9a, CP9b | `destructive` false ≠ true on the registry entry (:516) and on the authority projection |
| `driver-composition-missing` | WD2, WD3 | `wave_driver_policy_invalid: policy field "refusalNudgeBudget" is unknown` (freezePolicy, wave-driver.mjs:81) |
| `driver-composition-missing` | WD4 | claim_turn act calls `1 !== 4` — per-member `claimAttempted` stops after one (wave-driver.mjs:247-248) |

No fixture bugs observed. Every fixture-check assertion that precedes a red stage passes:
T18's planted stale-fence write lands `ok:false`; T18w/T18r's receipts land `ok:true`; T18q's
resolution mints `question.answered`; T18h's cycle arms (one `baton-progress-check:` prompt —
marker verified at coordinator.mjs:2105/:2127); T18d's second record carries `turnEpoch 2`;
T18s's post-pause receipt lands same-epoch with `seq > mintedEvent`; T18x/T18y's receipts land
`ok:false`; T18z's question stays unanswered. The red assertions are the first failures in
every row.

## 0.1 Hermeticity

**Fully hermetic.** Mock `ScriptableAdapter` (recorded calls, scripted emits), fake worktrees
(injected `capture`), tmp dirs under `os.tmpdir()` with `test.after` cleanup, and the
deterministic fake wave facade (`FakeRun`/`fakeBaton` — no live providers, no network). Real
short timers are used where the behavior under test IS a timer (T18h/T18g 100 ms steering
windows with 180 ms sleeps; T18c's 2 000 ms window cleared in `finally`; WD poll 20 ms / stall
400 ms / cap 30 000 ms). Suite duration ~1.8 s. The only wall-clock sensitivity is the
window-vs-sleep margin (~1.8×), acceptable on a local run; worth watching on a loaded CI.

## 1. Coverage map (contract clause → enforcing test)

### CP1 — insertion point, ordering, error path
- Preflight AFTER targets resolution, BEFORE `_clearSteeringTimer` (:2499) and the settle
  append (:2507-2511) → **T18h** (refused claim leaves the cycle armed: `steering.timer`
  non-null, `answered === false`, ordinary expiry then lands the gate WITH the steering
  receipt). Verified the insertion anchors: claimTurn :2492-2529, `_clearSteeringTimer`
  nulls `record.steering.timer` :2111-2117.
- Rollback-on-throw, `resolving` always released → **T18c** (+ the guarded second claim).
  Verified `_reservePauseRecord` :2305-2337: rollback restores `pending`/`consumer:
  null`/`resolution: null` and `finishResolving()` releases `resolvingDone`; a racing claim
  parked at :2309 re-enters via the recursive re-reserve.
- Swallowed-expiry `expiryPending` re-check → **T18g**. Verified the guard it exercises:
  `_expireSteeringCycle` returns untouched when `record.state !== 'pending'` (:2237-2238).
- Rollback honesty (acceptance d) → **T18** (record/state asserts, zero claim-attributable
  events, concurrent reserve→refuse→reserve re-entry).

### CP2 — the exact gate mirror
- Would-fire predicate (mirrors :12530) + fresh-capture five-way diffless test (:12532) →
  **T18** (headline), **T18e** (the `!sha || !baseSha` arm).
- Capture-kwargs fidelity (:12490-12498) → **T18's capture spy** (all captures deep-equal the
  gate's own; `vendor`/`ownerTaskId`/`expectedBaseSha`/`expectedBranch` asserted verbatim).
  Verified the gate's call site: it also passes conditional `effort` and
  `workerSparseCheckoutIdentity` — the deepEqual covers whatever the gate sends.
- `baseSha` derivation `sessionContext ?? captured ?? null` (:12531) → **T18f**.
- In-scope filter `pathInScope(task.brief.pathScope, path)` (:12511; `pathInScope` :565-568) →
  **T18i**.
- `changedPathsDigest` never a preflight input (:2066 doc law verified) → enforced by the
  capture spy (a digest-trusting shallow never captures → `captureCalls.length >= 3` fails).

### CP3 — the closed counted set
- `content.tool_call` actor worker (governance-counted :13249-13269, count at :13267 verified;
  watchdog branch :8856-8878 verified) → **T18** (5 Bash-shaped calls; first-seen `completed`
  is a `new` logical transition per `logicalCallTransition` :90-98 — the fixture's
  "governance-clean" claim checks out).
- `scratchpad.write_result {ok:true}` (mint :12109-12112 verified, hub-actor) → **T18w**.
- `context.read_result {ok:true}` (mint :12126-12129 verified) → **T18r**.
- `resource.provider_call` actor worker (watchdog accounting :8852-8855 verified) → **T18p**.
- Interaction resolutions (`question.answered` :9475 verified) → **T18q**; resolution-gating →
  **T18z** (pin).
- `content.message` actor worker (CI4 prose rule :11541-11543 verified) → planted in **T18**
  but NEVER load-bearing (5 tool_calls suffice for that refusal) — **NO discriminating row
  (BLOCKER 1)**.
- `approval.resolved` (:9480) and `decision.settled` (:9607) — mints verified to exist;
  **NO row stages either (BLOCKER 2)**.
- Failed receipts never count → **T18y** (pin; stale-fence write + invalid read, both
  `ok:false`) and the planted failed write inside **T18**.

### CP4 — the pause-epoch window
- Epoch bound (`e.turnEpoch === record.turnEpoch`; record fields :2060-2062 verified) →
  **T18d** (pin). Construction verified isolating: the epoch-1 events PASS the seq bound
  (`seq < mintedEvent` of the epoch-2 record), so only the epoch law excludes them.
- Seq bound (`e.seq <= record.mintedEvent`) → **T18s** (pin). Verified live that the bound is
  load-bearing: a paused worker's stream DOES grow same-epoch hub receipts (the
  `scratchpad.write` case :12102-12118 runs regardless of pause; the receipt inherits the
  event envelope's `turnEpoch`).
- No clock anywhere → behavioral: a wall-clock window reader counts both fixtures' events as
  recent and refuses → T18d AND T18s go red.

### CP5 — what never counts
- Lifecycle markers → **T18b** (pin; the window holds only `turn_started`/`turn_completed`).
- Pending interactions → **T18z** (pin).
- Failed receipts → **T18y** (pin).
- Driver/policy-actor events, TG-cycle answers alone, worker prose → no dedicated rows;
  acceptable (a nudge/settle resolves the record, so no pending record exists to claim —
  structurally unreachable in the harness).

### CP6 — the refusal value
- Shape (`ok:false`, `result:'claim_premature_liveness'`, pauseId/taskId/workerId, sanitized
  `liveness`, fixed-shape `reason` naming claimable-later) → **assertRefusalBasics**, reused
  by T18, T18e, T18w, T18r, T18p, T18q, T18f, T18i (prose-canary + path-string bans included).
- Rollback-clean, worker alive, zero events, claimable later → **T18** (incl. the third claim
  after `withDiff` → `claimed` → `completed`).
- A preflight throw is NOT a refusal → **T18c** (`__thrown__:capture_failed`, never the
  refusal code).

### CP7 — post-memo receipt classes excluded
- `board.claim_result` buys nothing → **T18x** (pin, `ok:false` variant only — see
  adjudication A2; the deliberately-non-liveness comment verified in-code at :12149-12150).
- `capability_op` steering-evidence class → no row (note; the class is admitted nowhere in
  the counted-set pins, and no fixture emits it — low-risk gap).

### CP8 — wave-driver composition
- Refusal code recorded on claims evidence (claimOnce lanes :252-263 verified) → **WD1** (pin).
- Exactly ONE corrective nudge, exempt from the L4 `nudgedRequestIds` dedup (:344/:594
  verified) exactly once → **WD2**.
- Budget consumed on DELIVERY (D8's value-shaped `delivery_exception` :618-640 verified) +
  per-pauseId `claimAttempted` → **WD3**.
- Exhaustion → record-only → stall-marker stabilizes (`stallMarker` :151-157, `markerParts`
  :493, `lastMarkerAt` :521 verified) → PRE-EXISTING stall clock (:656) → D9 no-op (:658-664)
  → basis `'stall'` → guaranteed close (:713-714) → **WD4**, which also pins the DEFAULT
  budget 2. `hardCapMs` 30 000 = 75× the 400 ms stall timeout makes "never the 3h wall"
  observable (a `hard_cap` basis fails).
- `refusalNudgeBudget` validation ("integer ≥ 0" per the suite's own invented-surface spec) —
  the `: 0` edge (record-only from the start) has **no row**; the existing `assertInteger`
  rejects `<= 0`, so a `>0`-only validation greens all four WD rows while violating the spec
  (minor, non-blocking).

### CP9 — the honest-registry flip
- `claim_turn.destructive: false → true` (entry :511-518, flag :516 verified), summary naming
  the final evaluation and the refusal → **CP9a**.
- `irreversible === false`, `idempotent === true`, version stays `'1.3.0'` (:1089 verified;
  phase87:61's pin verified to exist) → **CP9a** (pin half).
- The authority PROJECTION carries the flag → **CP9b**. Verified the projection is DERIVED
  from the same `authorizedActions` source (application-semantics.mjs:1907-1914) exported as
  `APPLICATION_DIGEST_PROJECTIONS` (:1942, digest :1946) — so CP9b cannot fail independently
  of CP9a; it pins the projection field-set, not a second literal.
- The contract-named 31b5 surface row (advertised descriptor carries `destructive: true`) →
  **NOT ADDED** — CP9b substitutes (see adjudication A3).

### CP10 — the silent-worker path is untouched
- Silent diffless drivered claim dies `required_effect_absent` → **T18b** (pin; kill mapping
  :12845-12858 verified).
- Gate-strength laws (T2/T10b/T11/T17) → not re-run here; they are the trust-gate suite's own
  rows, and acceptance (c)'s full-gate run is the arbiter (acceptable cross-suite split).

### Fold-added rows (all present)
T18c ✓, T18d ✓, T18e ✓, the four wave-driver rows (WD1-WD4) ✓, the T18 capture-kwargs spy ✓,
the planted ok:false receipt (T18 + T18y) ✓. The OQ4 live L2 restage receipt is by decision a
dated evidence file in this directory, not a suite row — **pending**, with T18's mock row
carrying the acceptance bar (note, not a gap).

### Untested (summary)
1. `content.message` as a sole counted class — **BLOCKER 1**.
2. `approval.resolved` / `decision.settled` resolutions — **BLOCKER 2**.
3. `refusalNudgeBudget: 0` validation edge (minor).
4. 31b5 surface row for the advertised descriptor (contract-named; A3).
5. T18x `ok:true` board receipt variant (needs the #78 grant machinery; A2).
6. `capability_op` exclusion (note).

## 2. Per-pin verdicts (false-green hunt)

- **P1 · T18b (#64 control) — SOUND.** The special-attention row. It really kills a silent
  worker at the NAMED gate, not an unrelated phase: with `changedPaths: []` the
  forbidden_effect (:12505) and path_scope (:12513) phases are structurally skipped (both
  require non-empty path sets), the five-way test fires at required_effect (:12532), and the
  kill mapping mints `terminalCause {kind:'policy_failure', code:'required_effect_absent'}`
  (:12845-12858) — the row asserts that exact kind+code, plus `outcome === 'failed'`, task
  `failed`, and `adapter.calls.kill.length >= 1`. A kill at any other phase mints a different
  code → red; a worktree/capture failure never enters the kill set → no kill call → red. Its
  named shallow — counting lifecycle markers — turns the claim into a refusal → red. Green
  today for the right reason: no preflight exists.
- **P2 · T18d (stale-epoch) — SOUND.** The fixture genuinely stages the trap: epoch-1
  liveness, a nudge settle, an epoch-2 re-park whose record carries `turnEpoch 2` (fixture
  assert passes today). The epoch-1 tool_calls have `seq < record2.mintedEvent`, so they pass
  a seq-only bound — the row isolates the EPOCH half exactly as named. A whole-stream reader
  and a wall-clock reader both refuse → red. Green today because no preflight exists.
- **P3 · T18s (seq bound) — SOUND.** Verified against live code that the premise holds: a
  paused worker's `scratchpad.write` is still admitted (the case has no pause guard), and the
  hub mints `write_result {ok:true}` carrying the event envelope's `turnEpoch` — so a
  same-epoch, post-pause, `seq > mintedEvent` receipt is a REAL shape, not a harness fiction.
  All three fixture asserts (ok:true, same epoch, outside the seq bound) pass today. An
  epoch-only reader counts it → refuses → red. The two pins partition CP4's two bounds with
  no overlap.
- **P4 · T18x (CP7 exclusion) — WEAK (minor; adjudicated A2).** The planted receipt is the
  `ok:false` variant (`board_claim_invalid` — a complete `ok:true` claim needs the #78 grant
  machinery the harness doesn't stage). The row kills an ok-BLIND board-receipt counter; an
  implementation that admits `board.claim_result {ok:true}` violates CP7 yet greens the whole
  suite. Not vacuous — the board class IS exercised — but the exclusion's strong form
  (never counts, even ok:true) has no oracle.
- **P5 · T18y (failed receipts) — SOUND.** Two independently-failed receipts (stale-fence
  write, invalid read), fixture asserts `ok:false` on both before the claim. Kills the
  ok-blind receipt counter for BOTH hub receipt classes.
- **P6 · T18z (pending interaction) — SOUND.** Question emitted, never answered (fixture
  asserts no `question.answered`). Kills counting `question.asked` itself. Note T18q/T18z
  together also pin the actor-blindness of resolution counting (`question.answered` mints
  with actor `orchestrator` at :9475 — CP3.6 lists the kind without an actor gate, and an
  implementation requiring `actor === 'worker'` fails T18q).
- **P7 · WD1 (claims-evidence lane) — SOUND.** Exercises the REAL `claimOnce` catch lane
  (wave-driver.mjs:261-263) against the fake facade: the fake's `act` throws the
  application-error-lane shape (`code: 'claim_premature_liveness'` on a thrown error —
  verified the lane exists at application.mjs:11896-11899). Post-implementation composition
  traced: the default budget issues one (unasserted) corrective nudge, then the pause pends
  to stall — `claims.length === 1`, the code, and basis `'stall'` are unchanged. Kills an
  implementation that drops or mangles the code on the corrective path.
- **P8 · X1 (claim-diffed-pause class) — SOUND.** Real `Coordinator.claimTurn` + real gate +
  counted liveness + a diffed capture → `claimed` → `completed`. Kills a preflight that
  refuses on liveness alone (skipping the would-fire capture test).
- **P9 · X2 (no-requiredEffects class) — SOUND.** Diffless + liveness + `requiredEffects: []`
  → `claimed`. Kills a preflight that skips the brief arm. Minor fidelity note: phase11's
  brief OMITS `requiredEffects` (verified :24-29) where X2 passes `[]` — both falsy under
  `?.includes()`, immaterial.
- **P10 · X3 (already_resolved class) — SOUND.** Replicates 31b:205's exact sequence
  (verified: nudge at :204 resolves, claim at :205 draws `already_resolved` from the
  reservation's state guard :2315-2317, BEFORE the preflight insertion point). With counted
  liveness present, a hoisted preflight refuses instead → red.

**X1-X3 facsimile question (special attention):** the pins call the REAL
`Coordinator.claimTurn` and the REAL gate — they replicate the six non-suite call sites'
behavior CLASSES, not the literal call sites. That is the correct scope: the literal
byte-identical exoneration is owned by the six suites' own rows (all six verified at their
cited lines — phase11:372/:379, 31a:699, 31b:205, 31b5:247, phase10:112, bidirectional:369)
and by acceptance (c)'s full-gate run; the class pins are this suite's early-warning
tripwires against wrong trigger-predicate arms (diff arm, brief arm, reservation ordering).
Not a false green: each pin greens on real behavior today and its named wrong implementation
fails it.

No VACUOUS and no STAGED-WRONG pins.

## 3. Teeth check (red rows vs plausible wrong implementations)

The brief's five named wrong implementations:

- **Preflight counting pre-epoch liveness** → caught by the PINS: T18d (epoch half) and T18s
  (seq half) both go red under any reader without the dual bound; a wall-clock window goes
  red on both. Composition sound.
- **Refusing but killing anyway** → caught by `assertWorkerAlive` + task-`paused` +
  zero-events inside `assertRefusalBasics`, reused by all eight refusal rows. A
  `_beginStop`/terminalCause on the refuse path fails at three independent asserts.
- **Rollback leaving `resolving` set (the wedge guards)** → **the guards are SOUND, they do
  not mask the bug.** `claimOutcomeGuarded`/the T18 `Promise.race` convert a wedge into a
  NAMED failure value (`__wedged__:resolving never released`) inside 3 s, and the assertions
  reject that value explicitly (`assert.notEqual` in T18c, `Array.isArray` + result asserts
  in T18). A wedged implementation fails loudly; nothing greens it. The guards only convert
  a suite-stalling hang into a diagnosis — exactly what a guard should do. T18's concurrent
  pair also exercises the real `:2309` re-entry (park on `resolvingDone`, re-reserve after
  rollback — verified :2308-2313).
- **Budget exhaustion minting a new pauseId or a new clock** → caught by WD4's frozen act
  counts (4 `claim_turn`, 3 `nudge_turn`, zero rows for cp-4/cp-final) and basis `'stall'`
  with `hardCapMs` 75× larger. A driver that settles/re-parks the worker changes act counts;
  a NEW timer that reaps changes the basis or adds settle acts. The "no new clock" half is
  necessarily indirect (negative law) — the counts+basis composition is a reasonable oracle
  (noted, acceptable).
- **A preflight that counts liveness but never rolls back** → caught by T18's record-state
  asserts (`pending`, `consumer: null`), the re-claim sequence (a consumed record answers
  `already_resolved` or wedges the guard), and the zero-events assert.

Row-level teeth notes:

- **T18 (headline) — SOUND.** Additionally kills: throw-instead-of-return (the normalization
  surfaces `__thrown__:*` and the shape asserts fail); digest-trusting shallow (never
  captures → `captureCalls.length >= 3` fails); wrong capture kwargs (deepEqual vs the gate's
  own call); prose/path leakage (canary + regex asserts); refusal-poisons-the-pause (the
  third claim must reach `completed`). The `liveness` block content itself (per-class counts
  and digests) is shape-asserted only via the sanitization bans — the contract's "per-class
  counts and content digests" is not positively enumerated (acceptable; the invented surface
  deliberately leaves the exact keys to the wave).
- **T18e — SOUND.** A null-sha shallow (treat null capture as "skip preflight") gate-kills →
  `claimed` → red; a crashing shallow rejects → `__thrown__` → red.
- **T18w/r/p/q — SOUND in composition.** Each plants exactly one counted class; an
  implementation missing that class gate-kills → red. (This is also what makes the two
  BLOCKER gaps precise: the class-membership teeth work row-by-row, and two classes have no
  row.)
- **T18h — SOUND.** Memo-order insertion (preflight AFTER the timer clear) leaves
  `steering.timer === null` → red; a refusal that consumes the cycle trips
  `answered === false`; a refusal that skips the receipt path trips the verdict/`steered`
  asserts after the ordinary expiry (the `steered` payload on gate errors verified at
  :12825, the expiry's `steering_expired` settle + gate dispatch at :2246-2256).
- **T18g — SOUND.** No re-check → the spent one-shot timer leaves a zombie `pending` record
  → the `task failed` assert never lands → red. The staging (one armed pended capture, a
  100 ms window inside the await) forces the guard skip at :2237-2238 deterministically.
- **T18c — SOUND.** Throw-mapped-to-refusal fails the `__thrown__:capture_failed` assert;
  no-rollback fails the record asserts AND the guarded second claim; timer-clear-on-throw
  fails the armed-cycle assert. Today the row is red because the gate's OWN capture path
  swallows `capture_failed` into claimed/failed (the gate's catch never rethrows — §A4).
- **T18f — SOUND.** The captured-vs-captured shallow proceeds (`'sha-base' !== 'sha-foreign'`)
  and the GATE's own sessionContext derivation kills it `required_effect_absent` →
  `claimed/failed` → red. Only the :12531 derivation refuses.
- **T18i — SOUND.** The no-inScope-filter shallow proceeds and dies `worker_path_scope_
  violation` at :12513-12527 → `claimed/failed` → red.
- **CP9a/CP9b — SOUND.** No flip → red (today); flag-only flip without the summary → red;
  moving `irreversible`/`idempotent` → red; bumping the version (the over-eager honesty fix)
  → red — the named version-policy gap is deliberately pinned shut.
- **WD2 — SOUND (layered).** Today it cannot see past freezePolicy (:81) — the red stage is
  the missing policy field, a proper subset of `driver-composition-missing`. Post-field, its
  teeth: L4 dedup applied to the corrective nudge → 1 `nudge_turn` → red; corrective nudge
  unbounded → wrong count on the second refusal (WD3/WD4 composition); wrong requestId →
  the per-row requestId asserts.
- **WD3 — SOUND.** Consume-on-attempt → the scripted `delivery_exception` burns budget → 3
  `nudge_turn` total → red; per-member `claimAttempted` → 1 claim → red; the failed delivery
  must surface as a D8-shaped evidence row (`error.code === 'delivery_exception'`). The
  four-fresh-pauseIds fixture makes per-pauseId keying observable at the act layer.
- **WD4 — SOUND; see A1 for the strict D9 no-op reading.** Non-default default budget (1 or
  3) → wrong nudge count → red; exhaustion still nudging → extra rows → red; reaping via the
  cap → basis `hard_cap` → red.

The only set-membership shallows with NO teeth anywhere: `content.message` counted
(BLOCKER 1), `approval.resolved`/`decision.settled` counted (BLOCKER 2), `board.claim_result
{ok:true}` excluded (A2, accepted), `capability_op` excluded (note).

## 4. Adjudications (the drafter's flags)

- **A1 · WD4's strict no-op reading — KEEP, do not soften.** The contract tolerates the D9
  fan-out being "refused-and-recorded … so it no-ops, OR it is refused again and tolerated."
  But the contract's own mechanism makes the no-op determinate in the deterministic facade:
  `claimOnce` checks `claimAttempted` at entry (:247-248 verified), so once the keying moves
  per-pauseId, the fan-out's claim on cp-final returns BEFORE `act()` — a fifth
  `act('claim_turn')` means the per-pauseId set was bypassed on the D9 path, which is exactly
  the regression WD4 exists to catch. The "tolerated" branch is reachable only via a race the
  single-threaded facade excludes, or via an implementation that doesn't route the fan-out
  through the guard. Softening the assert to "4 or 5" would blind the row to that bypass for
  zero benefit. Recommendation: keep WD4 strict; optionally amend the contract's "tolerated"
  clause to name it race-tolerance, not license for a second act on the deterministic path.
- **A2 · T18x's ok:true residual gap — ACCEPTABLE for v1, non-blocking.** The ok:false-only
  fixture is honest about its limit (named in the suite header). In composition the hole is
  narrow: T18y pins the ok-blindness law for receipts generically, so the residual requires
  an implementation to deliberately special-case `board.claim_result {ok:true}` INTO the
  closed set — an odd wrong implementation, and the harm direction is a wrongful REFUSAL
  (worker stays alive, pends to the stall reap) never a wrongful acceptance — TG2's
  final-diff law is untouched either way. The contract itself schedules the board-receipt
  grounding pass at acceptance (CP7/OQ1); the ok:true row belongs to that pass, when the #78
  grant-machinery fixture exists. Keep as a named follow-up, not a v1 blocker.
- **A3 · CP9b pinning the projection in lieu of booting the application — ACCEPTABLE
  substitution, flag for reconciliation.** The contract's acceptance (c) names a surface row
  in turn-checkpoints-31b5-surface-red.test.mjs asserting the ADVERTISED descriptor carries
  `destructive: true`; the suite substitutes the projection-level CP9b. Verified the
  substitution's coverage: the advertised descriptor is assembled at
  application.mjs:9739-9752 reading `definition.destructive` — the SAME registry field CP9a
  asserts — and the projection CP9b reads derives from the same source
  (application-semantics.mjs:1907-1914). The residual hole is a one-line assembly break
  (hardcoding `destructive` at :9749) with CP9a+CP9b both green: thin and brittle, but real,
  and the contract DID name the row. Fix either way: add the cheap 31b5 row in the wave
  (preferred — it also exercises the digest-riding descriptor path end-to-end) or amend
  acceptance (c) to name CP9b as the accepted substitute. Non-blocking.
- **A4 · The gate-kill RETURNS-not-throws discovery — VERIFIED TRUE against live code.**
  `_runTrustGate`'s catch (:12811ff) handles every gate failure internally: it mints the
  error event, transitions the task `failed`, applies the policy-kill mapping for the three
  codes (:12845-12858 — `terminalCause {kind:'policy_failure', code}`, scratch/board claim
  expiry, `_beginStop(handle, 'kill', …, 'policy')`), and does NOT rethrow. claimTurn's
  try/catch (:2515-2522) therefore only ever sees a `worktreeReady` rejection or a
  gate-internal crash; on a policy kill it commits and RETURNS
  `{ok:true, result:'claimed', outcome:'failed'}`. Empirically confirmed: all eight
  `claim-preflight-missing` rows observed exactly that returned envelope, and T18c confirmed
  the gate's own `capture_failed` is swallowed the same way. Consequence the wave must heed:
  CP6's refusal being a RETURN (never a throw) matches the gate's own convention — and the
  application error lane (:11896-11899, verified) is what turns the returned `{ok:false}`
  into the thrown error the wave driver's `claimOnce` catch records.
- **A5 · The expiryPending consumed-by-refuse-path-only design — SOUND for what it covers;
  one named residual, non-blocking.** Verified the mechanics end-to-end: the
  `_expireSteeringCycle` reservation guard (:2237-2238) returns untouched while the record is
  `resolving`, the one-shot timer is spent, and only the refuse path re-runs the expiry after
  `rollback()` (T18g pins exactly this). The residual the contract does NOT cover: a
  preflight THROW (T18c's path) AFTER the window fired mid-capture leaves the record
  `pending` with a spent timer and `expiryPending` set, and the throw path rethrows WITHOUT
  consuming the flag — the named zombie, reached via the error lane instead of the refuse
  lane. It stays non-blocking because (a) any later claim refusal consumes the flag and
  self-heals, (b) a nudge settles the record through the reservation path regardless of the
  cycle, and (c) it needs a three-way race (claim × capture-throw × window fire inside one
  capture await). T18c's 2 000 ms window deliberately avoids the combination, which is fine
  for what T18c names. Recommendation for the wave: consume `expiryPending` on the throw
  path too (the same one call after `rollback()` in the preflight catch), or amend CP1 to
  name the residue as accepted.

## 5. Drift findings (invented surfaces vs the contract)

Suite-side invented names, cross-checked against the v1.1 contract — **no drift**:

- The refusal value shape (header item 1) ≡ CP6 verbatim: `ok:false` /
  `result:'claim_premature_liveness'` / `pauseId` / `taskId` / `workerId` / sanitized
  `liveness` / fixed-shape `reason`; the suite's `/claimable/` assert matches the contract's
  fixed reason text ("this pause remains claimable").
- `record.steering.expiryPending` (header item 2) ≡ CP1; T18g pins the observable behavior
  rather than the flag name (correct — the flag is an implementation detail).
- Registry flags (CP9a) ≡ CP9: `destructive: true`, summary naming the final evaluation AND
  `claim_premature_liveness` (CP9's suggested rewording contains both), `irreversible:
  false`/`idempotent: true` unmoved, version `'1.3.0'` pinned per the named policy.
- `refusalNudgeBudget` (header item 4) ≡ CP8: default 2, per-member count, consumed on
  DELIVERED acknowledgment, D8-symmetric. The header's additive "integer ≥ 0" validation spec
  is consistent with the contract's "COUNT budget" phrasing but the `: 0` edge is untested
  (§1 CP8 note).
- `APPLICATION_DIGEST_PROJECTIONS` is a real export (:1942) and
  `.authority.actions.claim_turn` exists on it (CP9b's red failure proves both).
- Citation cosmetics (no semantic drift): the suite header's ":1888-1930 → digest :1946" and
  the contract's ":1905-1937 / :1958" both point at the same real machinery — the
  `authorityProjection` literal opens at :1888, its actions map at :1907-1914, the export at
  :1942, `authorityDigest` at :1946, and the registry freeze (carrying `digest:
  authorityDigest`) immediately after. Both citations are in-neighborhood; implementers will
  land on the right code from either.

Contract-side: none found. Every load-bearing existing-code claim re-verified this pass:
claimTurn :2492-2529 (order, catch, commit, return shape); `_reservePauseRecord` :2305-2337
and the rollback arrow :2325-2330; `_expireSteeringCycle` guard :2237-2238 and its
`steering_expired` + steered-receipt gate dispatch :2246-2256; the gate's capture kwargs
:12490-12498, TG5/required_effect :12530-12546, baseSha :12531, in-scope :12511, kill mapping
:12845-12858; the record's epoch fields :2060-2062 and the :2066 attention-only law;
`_observeSteeringCycle`'s steering-less guard :2204 and `_settleSteeringCycle` :2218-2231;
the CP3 evidence anchors (:12109-12112, :12115-12117, :12124-12129, :12146-12156, :8845-
8878, :13249-13269 with the count at :13267, :11541-11543, :9475/:9480/:9607, :8131);
application.mjs :11892-11899/:9761/:9803/:9621; application-semantics.mjs:511-518/:516/
:1089/:1888-1960; wave-driver.mjs :246-264/:343/:344/:594/:599-614/:618-640/:656/:658-664/
:689/:713-714, freezePolicy :71-81, `stallMarker` :151-157, `markerParts` :493,
`lastMarkerAt` :521; recipes.mjs:537-546/:558; ground truth 7 (`grep -rn 'destructive'
impl/test/ | grep -i claim` empty outside this suite) re-run and confirmed.

Header split reconciliation: declared 16 red / 10 pins = measured 16 fail / 10 pass, four
identical runs. Nothing to adjudicate.

## 6. Closing verdict

**NOT-READY** — the suite is honest (16/16 red at named stages, zero fixture bugs, ten
legitimate greens, fully hermetic, every load-bearing citation verified against the live
tree), but two of the six counted-liveness classes in CP3's CLOSED set have no discriminating
oracle: an implementation that silently narrows the counted set greens the whole suite. That
is precisely the failure mode the set-closure law exists to forbid, and both fixes are
one-row idioms the suite already contains.

Blockers:

1. **`content.message` (CP3.4) is never load-bearing in any row.** What: T18 plants 3
   analysis messages but also 5 tool_calls, which suffice for its refusal; no other row emits
   `content.message`. An implementation whose counted set omits worker `content.message`
   passes all 26 rows while violating CP3 — and this is the #88 receipt's own second class
   (analysis prose alongside the 5 Bash calls), admitted by the fold under the honest
   "watchdog-observed worker content" criterion (:11541-11543). Why: a closed set needs
   per-class membership teeth, and this class has none. Fix: add a messages-only row on the
   T18w/T18r idiom (stage: 3 `emitAnalysis` events, zero other liveness → claim →
   `assertRefusalBasics`).
2. **`approval.resolved` (:9480) and `decision.settled` (:9607) have no row.** What: CP3.6
   lists three resolution kinds; only `question.answered` is staged (T18q/T18z). An
   implementation counting questions but not approvals/decisions greens the suite. Why:
   same set-closure hole, smaller blast radius (the resolution-GATED law itself is pinned by
   T18q/T18z; only the enumeration is unpinned). Fix: extend the T18q idiom — one
   parametrized row over the three resolution mints, or two sibling rows (emit approval →
   `approve()`; emit decision → `decide()`; each resolved in-window → refused).

Non-blocking strengthenings (fold into the wave if convenient): the 31b5 surface row (A3);
consuming `expiryPending` on the preflight throw path or amending CP1 (A5); a
`refusalNudgeBudget: 0` validation row (§1 CP8); the T18x `ok:true` board-receipt row with
the #78 grant fixture, scheduled with the CP7/OQ1 grounding pass (A2); a `capability_op`
exclusion pin (§1 CP7 note); optionally tightening the contract's D9 "tolerated" clause per
A1. The OQ4 live L2 restage receipt (dated evidence file, this directory) remains pending by
decision — T18's mock row carries the acceptance bar.
