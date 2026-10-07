# Blue-team verification — `impl/test/issue10-waiting-vocabulary-red.test.mjs`

Date: 2026-08-06. Reviewer: blue team (attempt `bt-2026-08-06T20:17:48.311Z`).
Scope: the red-first suite against `waiting-vocabulary-contract.md` **v1.1** + `contract-fold.md`.
Contract surface: D1–D13, §3 kind contracts, §4 refusal vocabulary, §6 acceptance pins.

---

## 1. Run record (exact)

Command (repo root, per brief): `node --test impl/test/issue10-waiting-vocabulary-red.test.mjs`

| Run | tests | pass | fail | duration |
|---|---|---|---|---|
| 1 | 38 | 3 | 35 | 15 872 ms |
| 2 | 38 | 3 | 35 | 15 672 ms |
| 3 | 38 | 3 | 35 | 15 867 ms |

**Split matches the suite header exactly**: 38 tests — 35 RED fail, 3 PIN pass
(D9-INVARIANT, EXO-1, EXO-2). Stable across three consecutive runs (no flakes observed).
0 cancelled, 0 skipped, 0 todo.

NUL discipline re-checked: literal NUL bytes exist only in `application.mjs` (3) and
`coordination-store.mjs` (3); `coordinator.mjs`, `wave-driver.mjs`, `claude-session.mjs`,
`application-semantics.mjs` are plain text. All coordinator/wave-driver/application citations
below were read via `grep -an`/`sed -n`.

### 1.1 Per-row failure stage check

Every one of the 35 RED rows fails at an assertion tagged `stage[…]` — **none** fails at a PIN
assertion, **none** fails at a fixture/setup assertion. The failure stages actually exercised
(13 distinct):

| Stage tag | Rows that hit it |
|---|---|
| `dispatch-deferred-receipt-missing` | CC-START |
| `waiting-on-projection-missing` | CC-SHOW, CC-EXIT*, DP-EXIT-b*, SP-SHOW, DP-EXIT-c* |
| `dispatch-pending-projection-missing` | DP-START, DP-SHOW, DP-EXIT-a*, DP-EXIT-c* |
| `reduceMember-missing` | CC-HONEST, DP-HONEST, SP-HONEST, PA-HONEST, PS-HONEST*, D9-SHAPE |
| `stallMarker-missing` | CC-STRIP, DP-STRIP, SP-STRIP, PA-STRIP, PS-STRIP |
| `spawn-window-fields-missing` | SP-START-WT, SP-START-SPAWN, SP-START-RECOVERY, SP-EXIT-WT |
| `waiting-on-exit-missing` | SP-EXIT-SETTLED, PA-EXIT, DP-EXIT-c* |
| `spawn-refusal-missing` | SP-REFUSAL |
| `plan-approval-projection-missing` | PA-START, PA-SHOW |
| `provider-stalled-projection-missing` | PS-START, PS-SHOW, PS-EXIT* |
| `waiting-not-suppressed` | D9-COMPOUND |
| `digest-export-missing` | DIGEST |
| `waiting-on-enum-missing` | WAITING_ON_KINDS |

\* Rows whose *named* stage (per the header inventory) is a later exit/honest stage but which
today fail at an **earlier projection pre-condition**: CC-EXIT (`waiting-on-exit-missing`),
DP-EXIT-a/b/c (`waiting-on-exit-missing`), PS-EXIT (`waiting-on-exit-missing`), PS-HONEST
(`reduceMember-missing` before `waiting-on-honest-null-missing`). This is the normal red-first
signature when the entire field is absent: the first requirement in the row is the one that
fails. It is **not** a fixture bug — every pre-condition assertion is a legitimate feature
assertion (e.g. "B queued behind the ceiling projects waitingOn"). Once the projection is
landed, these rows re-fail (or pass) at their named exit stage.

Two header/observed mismatches, both benign in direction but worth recording:
- Header claims **14 distinct stages**; **13** are exercised (`waiting-on-honest-null-missing`
  never fires because PS-HONEST fails at `reduceMember-missing` first).
- Header claims "each [row] fails at its NAMED stage"; five rows fail one stage earlier, per
  the table above. See §5 drift 1.

### 1.2 STRIP failure mechanism confirmed

The five STRIP rows fail with `actual: 'hard_cap'`, `expected: 'stall'`. This is the exact
mechanism D10 pins: today `stallMarker` does **not** strip `waitingOn`, so the churning
`waitingOn` in `stripWave` resets the wave marker every poll, the stall clock never fires, and
the wave rides to `hardCapMs`. Under the correct strip the view is byte-static and the stall
clock fires at `stallTimeoutMs`. The rows drive the **real** `createWaveDriver` (export
confirmed at `wave-driver.mjs:257`) end-to-end against a scripted status stream — D10's "drive
the REAL driver marker" requirement is satisfied (not the issue55 local-helper trap,
`issue55-stall-liveness-red.test.mjs:135-142`, which strips only `cursor`).

---

## 2. Coverage map (contract → tests)

### 2.1 Decisions D1–D13

| Decision | Enforced by | Notes |
|---|---|---|
| D1 — additive field, never a phase | CC-SHOW PIN (`approvedB.phase==='running'`), DP-START PIN (`phase 'running'`), SP-SHOW PIN, PA-START PIN (`awaiting_plan_approval`), PA-EXIT PIN (`phase moves on approve`) | ✓ |
| D2 — exactly five closed kinds | WAITING_ON_KINDS (frozen enum, exact 5) | ✓ |
| D3 — `since` is an event epoch; `turnEpoch:null` for fence-less kinds | CC-START (receipt `taskCreatedSeq`), CC-SHOW/DP-START/SP-SHOW/PA-START (`turnEpoch null`), DP-START (`eventSeq===task.created.seq`), SP-SHOW (`eventSeq===task.claimed.seq`), PA-START (`eventSeq===plan.version_proposed.seq`), PS-START (`eventSeq===suspicion.seq` ∧ `turnEpoch===suspicion.turnEpoch`) | ✓, with a hole: **CC-SHOW never asserts `since.eventSeq === <receipt seq>`** (see Blocker 2) |
| D4 — honest-null law | CC-HONEST/DP-HONEST/SP-HONEST/PA-HONEST/PS-HONEST (reduceMember waiting classes), PS-HONEST (blocked member ⇒ `waitingOn:null`), CC-EXIT/PA-EXIT/DP-EXIT-a/c/SP-EXIT-SETTLED/PS-EXIT (`waitingOn===null` after exit) | ✓; the pure `null`→`working` reduceMember fallback is only indirectly pinned (EXO-1 claims a null-waiting checkpoint member; D9-SHAPE asserts checkpoint `waiting:false`) — no row calls `reduceMember([], null, null)` and asserts `'working'`. Minor. |
| D5 — two-arm receipt rule | CC-START (receipt mint + full payload + idempotency key + re-drive idempotent), CC-SHOW (Arm-1 `detail {vendor,ceiling,inFlight}`), DP-START (Arm-2 no-receipt + `detail {vendorRequested,reason}`), DP-EXIT-b (Arm-2→Arm-1 kind flip, never null mid-queue) | ✓; cancellation exit for `capacity_ceiling` (Arm 1) is untested — only `dispatch_pending` cancellation is (DP-EXIT-c) |
| D6 — spawning union, three windows, derived fields | SP-START-WT/SPAWN/RECOVERY (`spawnPending`/`spawnWindow` on `_publicHandle`), SP-EXIT-WT (worktree→spawn slide never through null), SP-SHOW (`waitingOn.kind==='spawning'`, `since===claimed.seq`), SP-EXIT-SETTLED | ✓; the **run-view `detail.window`** (`{workerId,taskId,vendor,window}` per §3) is never asserted (see Blocker 3); the `lifecycle.crashed`→terminal exit is untested |
| D7 — plan_approval fold + `detail {planVersion, proposalSeq}` | PA-START (kind, `since===proposal.seq`, detail.planVersion + detail.proposalSeq), PA-EXIT (approve clears) | ✓ approve path; the **stale/expiry edge** (`plan_approval_expired` refuses dispatch while the view reads phase `approved`, `waitingOn:null`) is **untested** — the contract §6 PA-EXIT marks it "pinned, not silently absent" (see Blocker 1) |
| D8 — provider_stalled rides existing mint, no new clock | PS-START (projects with suspicion seq + epoch), PS-EXIT (worker-content revival clears) | ✓ revival exit; the **stallAction terminal exit** is untested (all PS rows use `stallAction:'none'`); the grep-able "no new `setTimeout`/`*Ms` in the diff" constraint has **no suite row** |
| D9 — one reducer, five classes, pinned flags/suppression/invariant | HONEST rows ×5, D9-COMPOUND (waiting suppresses claim), D9-SHAPE (flags explicit on waiting + checkpoint shapes), D9-INVARIANT (checkpoint ⇒ 3 raw flags false) | ✓; D9-SHAPE never asserts the **interaction shape's `waiting:false`** nor the working shape's `waiting:false` — a wrong impl returning the blocked shape without a `waiting` field is not caught (see §5 drift / recommendations) |
| D10 — strip from stall marker | CC-STRIP, DP-STRIP, SP-STRIP, PA-STRIP, PS-STRIP (real driver marker) | ✓ |
| D11 — `worker_spawning` typed refusal on the union | SP-REFUSAL (all three windows refuse; ghost worker keeps `worker_not_active`) | ✓; `run_not_active` unchanged is not asserted here (covered by workflow-surface per D13, not in this suite) |
| D12 — three projection surfaces + digest asymmetry | CC-SHOW, DP-SHOW, SP-SHOW, PA-SHOW, PS-SHOW (view + outline + runs.list parity), DIGEST (waitingOn moves digest; cursor/progressClass/requiredAction stay stripped) | ✓ |
| D13 — suites that move / must not move | Not directly testable in this suite (cross-suite constraint). Header references it; issue55:189's marker-moves pin verified present at `issue55-stall-liveness-red.test.mjs:186-190`. | — |

### 2.2 §4 Refusal vocabulary

| String | Enforced by |
|---|---|
| `worker_spawning` (NEW) | SP-REFUSAL (typed, `ok:false`, carries workerId/runId, all three windows) |
| `worker_not_active` / `run_not_active` (UNCHANGED) | SP-REFUSAL PIN (`worker_not_active` for ghost worker) — `run_not_active` left to workflow-surface suite per D13 |
| `claim_premature_liveness` (UNCHANGED) | Not in this suite (lives in claim-preflight-red.test.mjs, MUST-NOT-MOVE per D13). #88 vacuity pins here: CC-START + PS-START assert `pausedTurns().length===0` |
| `plan_approval_expired` (UNCHANGED) | **No test** — Blocker 1 |
| `task.dispatch_deferred` (receipt, not refusal) | CC-START (event kind with payload + idempotency key) |

### 2.3 §6 Acceptance pins per kind (START / SHOW / EXIT / HONEST / STRIP)

| Kind | START | SHOW | EXIT | HONEST | STRIP | #88 |
|---|---|---|---|---|---|---|
| capacity_ceiling | ✓ CC-START | ✓ CC-SHOW* | ✓ CC-EXIT | ✓ CC-HONEST | ✓ CC-STRIP | ✓ CC-START |
| dispatch_pending | ✓ DP-START | ✓ DP-SHOW | ✓ DP-EXIT-a/b/c | ✓ DP-HONEST | ✓ DP-STRIP | **✗ header claims, test absent** |
| spawning | ✓ SP-START-WT/SPAWN/RECOVERY | ✓ SP-SHOW** | ✓ SP-EXIT-WT/SETTLED (crash-exit ✗) | ✓ SP-HONEST | ✓ SP-STRIP | ✗ (no pausedTurns check) |
| plan_approval | ✓ PA-START | ✓ PA-SHOW | ✓ PA-EXIT (expiry ✗) | ✓ PA-HONEST | ✓ PA-STRIP | ✗ (pre-dispatch, not asserted) |
| provider_stalled | ✓ PS-START | ✓ PS-SHOW | ✓ PS-EXIT (terminal ✗) | ✓ PS-HONEST | ✓ PS-STRIP | ✓ PS-START |

\* CC-SHOW lacks the contract's `since.eventSeq === <receipt seq>` assertion (Blocker 2).
\*\* SP-SHOW lacks the contract's `detail.window` assertion (Blocker 3).

### 2.4 D9 flag-semantics + digest rows

- INVARIANT (checkpoint ⇒ three spawn flags false): D9-INVARIANT (PIN) ✓ — but only the 3-flag
  half; `waitingOn === null` on a paused view is not assertable pre-impl and not asserted.
- COMPOUND (waiting beats checkpoint): D9-COMPOUND ✓.
- SHAPE (both flags on every return): D9-SHAPE — partial (waiting + checkpoint shapes only; see
  §5 drift / recommendations).
- Digest-asymmetry: DIGEST ✓ (both directions).

### 2.5 Contract requirements with NO test (gap summary)

1. **plan_approval stale/expiry edge** — `plan_approval_expired` refusal with view reading phase
   `approved`, `waitingOn:null` (D7, §6 PA-EXIT, §4). **No row.**
2. **CC-SHOW `since.eventSeq === <receipt seq>`** (D5 Arm 1, §6 capacity_ceiling SHOW). **Not asserted.**
3. **spawning run-view/outline/runs.list `detail.window`** (§3 shape law: `{workerId,taskId,vendor,window}`). **Not asserted** — only the coordinator-level `_publicHandle.spawnWindow` is.
4. **#88 vacuity for dispatch_pending** (`pausedTurns().length===0` on a pre-dispatch pending task). Header claims it; DP-START does not assert it.
5. **"No new wall-time timeout"** in the provider_stalled path (D8, §6 PS-START, §7 campaign law) — the contract calls it grep-able; no suite row greps for it.
6. **spawning crash exit** (`lifecycle.crashed phase:'spawn'|'worktree'` ⇒ terminal, `waitingOn:null`).
7. **provider_stalled stallAction terminal exit** (terminal ⇒ `waitingOn:null`).
8. **capacity_ceiling cancellation exit** (receipt then cancel).
9. **interaction/working reduceMember shapes carry explicit `waiting`** (D9 SHAPE "every return carries BOTH flags").
10. **spawning #88 vacuity** (no pause record mid-spawn).

---

## 3. FALSE-GREEN hunt — per-pin verdicts

### PIN 1 — D9-INVARIANT (PASS) → **SOUND** (low discrimination)

Staging: `driveredPause` drives the **real coordinator harness** — `ScriptableAdapter` spawn
resolves immediately, `lifecycle.turn_completed` parks the task `paused`, then the three raw
flags are read off the **real raw handle** (`coordinator._workers.get(handle.id)`). The pin
asserts on system state, not on the fixture. It would catch a fold that leaves `worktreeCreationPending`/`nativeSpawnPending`/`recoverySpawnPending` set at pause time. It cannot be
VACUOUS: it fails if the normal spawn→pause flow leaves a flag set. It is **low-discrimination**
only in that it asserts the happy-path end state, not the mid-spawn-pause interleaving (which is
prevented structurally by TRANSITIONS `pending→working|cancelled`). Also note it is one clause
short of the contract invariant (the `waitingOn === null` clause is not assertable pre-impl and
is not staged). Verdict: **SOUND**.

### PIN 2 — EXO-1 (PASS) → **SOUND**

Staging: `fakeWave` + **real `createWaveDriver`** + **real `reduceMember`**. A claim-ready
checkpoint (`cpAtt('cp-1', CLAIM_READY)` with `waitingOn` absent) must be claimed **exactly
once**. Asserts both `actCallsOf(...,'claim_turn').length === 1` and `receipt.claims.length ===
1` — two independent observations of the same real `act()` call. If the driver never claimed
(the count would be 0), the pin fails, so it is non-vacuous; the "exactly once" is enforced by
the real `claimedPauseIds` + unchanged-digest treadmill (`wave-driver.mjs:379`, `:640-645`).
It is the counterweight to D9-COMPOUND: an impl that over-suppresses every non-working member
fails this pin; an impl that fails to suppress waiting members fails D9-COMPOUND. Together they
pin the suppression scope from both sides. Verdict: **SOUND**.

### PIN 3 — EXO-2 (PASS) → **SOUND**

Staging: real driver + real reducer with an `answer_question` blocking interaction and no
`waitingOn`. Asserts `claim_turn === 0` through the real suppression path (`checkpoint &&
!reduced.blocked` at `wave-driver.mjs:556`). A wrong impl that reorders precedence so a null
`waitingOn` short-circuits ahead of the interaction check (producing a claimable `working`
class) fails this pin. Non-vacuous: it observes the real act-call stream. Verdict: **SOUND**.

**No pin is VACUOUS or STAGED-WRONG.** All three exercise real system code (coordinator harness
or real `createWaveDriver`/`reduceMember`) against scripted state and assert on observable
behavior, not on the fixture.

---

## 4. Teeth check — would a plausible WRONG implementation fail these red rows?

| Wrong-implementation shape | Caught by |
|---|---|
| Hardcode `waitingOn` on the view / shortcut | DP-START, SP-SHOW, PA-START, PS-START assert `since.eventSeq` equals the **live store event seq** (task.created / task.claimed / plan.version_proposed / health.stall_suspected); a fixed or invented seq fails. **Exception: CC-SHOW** (no eventSeq assertion) — see Blocker 2. |
| Project `waitingOn` but never clear | CC-EXIT, DP-EXIT-a/b/c, SP-EXIT-SETTLED, PA-EXIT, PS-EXIT assert strict `null` after real exit events. |
| Field absent when not waiting (undefined) | Exit rows use strict `=== null` (`node:assert/strict`), so `undefined` fails — pins the "always present" honest-null shape. |
| Receipt minted on every ceiling skip (no idempotency) | CC-START re-drives the pass 3× and counts exactly 1. |
| No receipt mint at all | CC-START (`got 0`). |
| `since` from wall clock | D3 rows assert event-seq equality; fence-less kinds assert `turnEpoch === null`. |
| Clock-based provider_stalled (new timer) | PS-START asserts the **existing** suspicion seq/epoch — a fabricated mint would need a matching seq. The "no new timer anywhere" clause itself is **not** grep-pinned (gap 5). |
| `reduceMember` returns `working` for a waiting shape | HONEST rows ×5 + D9-SHAPE. |
| Suppression missing (`!reduced.waiting` not added) | D9-COMPOUND (waiting+checkpoint member is claimed today — `1 !== 0`). |
| Over-suppression (suppress every non-working member) | EXO-1 (checkpoint without waitingOn must claim). |
| Precedence reorder (null waitingOn overrides interaction) | EXO-2. |
| Stripping fails (waitingOn left in stall hash) | 5 STRIP rows, driven on the real driver (fail `hard_cap` vs `stall`). |
| Refusal guards only one spawn window / bare `notSent` | SP-REFUSAL asserts typed `worker_spawning` in worktree + spawn + recovery windows and `worker_not_active` for a ghost. |
| Digest strips waitingOn (asymmetry reversed) | DIGEST asserts a waitingOn transition **moves** the digest while cursor/progressClass/requiredAction stay stripped. |
| Enum grown / unfrozen / wrong kind set | WAITING_ON_KINDS (frozen + exact 5). |

**Teeth verdict: strong overall.** The suite's weakest bites are exactly the three blockers in
§6 (CC-SHOW eventSeq, spawning view detail, plan_approval expiry) plus the untested exit edges
and D9-SHAPE's partial shape coverage.

---

## 5. Drift findings (suite header vs contract surface)

1. **"each fails at its NAMED stage (14 distinct stages)"** (header) → **13** stages exercised;
   five rows fail at an earlier projection pre-condition than their named stage (CC-EXIT,
   DP-EXIT-a/b/c, PS-EXIT). Direction is benign (feature wholly absent) but the header's
   phrasing overstates the claim. No fix required beyond the header wording.
2. **PIN LIST claim vs code**: header's pin list says "A claimed-but-undispatched task's
   `pausedTurns()` is empty — the #88 preflight is vacuously safe for every kind (CC-START,
   DP-START, PS-START)". CC-START and PS-START do assert it; **DP-START does not**. Either add
   the `pausedTurns` assertion to DP-START or correct the header.
3. **Naming drift**: DP rows describe the staged task as "claimed-but-undispatched"; the staging
   (`stallVendorFor` → `_resolveVendor` returns null) produces a task that is **created but
   never dispatched** (no claim minted). The contract D5 Arm 2's honest wording is "pending-with-binding / no dispatch outcome committed". The header's phrase is imprecise, not wrong.
4. **CC-SHOW row spec vs contract**: the header's CC-SHOW line lists `since.turnEpoch null +
   detail {vendor,ceiling,inFlight}` but omits the contract's `since.eventSeq === <receipt seq>`.
   This is a real coverage shortfall (Blocker 2), not just wording.
5. **"14 distinct stages"** (see drift 1) is the only count discrepancy in the verified-split
   block; the 35/3 counts are exact.

No contract-surface-name mismatches were found: the five kinds, the `WAITING_ON_KINDS` set, the
`spawnPending`/`spawnWindow` derived fields, `worker_spawning`, `task.dispatch_deferred`, the
three projection surfaces, and the `semanticViewDigest` export name all match the contract's
invented-surface list exactly.

---

## 6. Final verdict: **NOT-READY**

The suite is well-constructed, hermetic, stable, and its red/pin mechanics are sound — all 35
red rows fail at legitimate feature assertions, all 3 pins are SOUND, and the suppression triad
(D9-COMPOUND / EXO-1 / EXO-2) plus the real-driver STRIP rows give good teeth. But **three
contract-pinned requirements have no enforcing test**, and each lets a plausible wrong
implementation go green. They are additive row fixes, not redesigns.

### Blockers (numbered)

1. **plan_approval stale/expiry edge untested** (D7, §6 PA-EXIT, §4 `plan_approval_expired`).
   - *What*: no row stages an approval that goes stale and asserts the pinned view truth — phase
     `approved`, `waitingOn: null` — while dispatch still refuses `plan_approval_expired`.
   - *Why*: the contract explicitly marks this edge "pinned, not silently absent". A wrong impl
     that keys `waitingOn` on "no `plan.approval_decided`" (instead of the ladder phase) would
     keep `waitingOn = plan_approval` set after expiry — or, conversely, a wrong impl that clears
     `waitingOn` but keeps the phase `awaiting_plan_approval` — and every existing row still
     passes.
   - *Fix*: add a PA-EXIT-EXPIRY row: approve the plan, let the TTL expire, assert
     `view.waitingOn === null` ∧ `view.phase === 'approved'`, and that a dispatch attempt is
     refused with `plan_approval_expired` (mirroring the existing `approvalTtlMs` in the harness
     `goalPlanPolicy`). Note the harness `approvalTtlMs: 60*60*1000` would need lowering or a
     stub clock for a fast expiry.

2. **CC-SHOW does not assert `since.eventSeq === <receipt seq>`** (D5 Arm 1, §6 capacity_ceiling
   SHOW).
   - *What*: CC-SHOW asserts kind, `turnEpoch null`, and `detail {vendor,ceiling,inFlight}`, but
     never fetches the `task.dispatch_deferred` receipt to compare `since.eventSeq`.
   - *Why*: a wrong impl that stamps `capacity_ceiling.since` with the `task.created` seq (or any
     non-receipt seq) passes the suite, violating D5 Arm 1's "`since` = the receipt's seq" and
     blurring the D3 event-identity law at the exact point DP-EXIT-b's kind flip depends on it
     (the flip is asserted as a kind change but not as a `since` jump).
   - *Fix*: in CC-SHOW, read the receipt from `driver.coordination.events(1)` and assert
     `view.waitingOn.since.eventSeq === receipt.seq`, mirroring DP-START/SP-SHOW/PA-START.

3. **spawning run-view `detail.window` untested** (§3 shape law: every row carries `detail`,
   spawning `detail: {workerId, taskId, vendor, window}`).
   - *What*: SP-START-WT/SPAWN/RECOVERY assert the coordinator-level `_publicHandle` derived
     fields, and SP-SHOW asserts kind + `since`, but **no test** reads `waitingOn.detail.window`
     on the run view / outline / runs.list.
   - *Why*: the shape law's "never implementer-chosen" detail is the contract's guard against a
     detail-less or wrongly-windowed projection. A wrong impl that projects
     `{kind:'spawning'}` with `detail` missing `window` (or a constant window) passes all three
     surfaces today.
   - *Fix*: in SP-SHOW, assert `view.waitingOn.detail.window === 'spawn'` (and
     `workerId`/`taskId`/`vendor` present), and ideally drive the worktree/recovery windows
     through the view surfaces too.

### Non-blocking recommendations (do not gate, but close the same class of hole)

- DP-START: add the `pausedTurns().length === 0` #88 vacuity assertion the header already claims.
- Add a grep-style row (or an impl-plan check) asserting no new `setTimeout` / `*Ms` knob exists
  in the `waitingOn` derivation path (D8/§7 campaign law — the contract calls it grep-able).
- Add the `lifecycle.crashed phase:'spawn'|'worktree'` → terminal → `waitingOn:null` exit for
  spawning, and a terminal-`stallAction` exit for provider_stalled.
- Add a capacity_ceiling cancellation EXIT row (receipt present, then cancelled).
- Extend D9-SHAPE to assert the interaction shape (`blocked:true, waiting:false`) and the pure
  working shape (`blocked:false, waiting:false`) carry both flags explicitly, so a blocked shape
  without a `waiting` field is caught.
- Header hygiene: correct the "14 distinct stages" count and the DP-START pin-list claim.

---

## 7. Verification note

All citations relied on in this report were re-grepped/`sed -n`-read against the current tree:
`wave-driver.mjs` `reduceMember` (2-arg, no `waiting`), `stallMarker` (:168-174, strips
cursor/progressClass/requiredAction only), `createWaveDriver` exported (:257); `coordinator.mjs`
`_publicHandle` (:6703, no `spawnPending`/`spawnWindow`), `_ownsLocalResources` union
(:2014-2015), `sendMessage` (:6793, `worker_not_active` :6831, `run_not_active` :6836, unguarded
delivery :6868), `_dispatchPass` (:2886 dep gate / :2889 vendor-unresolved / :2891 ceiling skip),
`_resolveVendor` (:2916-2950, explicit+auto null returns), `health.stall_suspected` (:8674-8678,
working-only :8667); `application.mjs` `semanticViewDigest` (:259, module-private), run ladder
(:5693-5702), outline (:10879-10885), runs.list item (:11703-11721); `application-semantics.mjs`
pins (:49-54) — `WAITING_ON_KINDS`/`waitingOn` absent in every impl source file (grep count 0 in
application.mjs, wave-driver.mjs, coordinator.mjs, application-semantics.mjs);
`coordination-store.mjs` event shape (:1465 `seq`/`idempotencyKey`/`payload`), atomic
`_appendBatch` (:10927-10931), `coordinationForLog.events()` (:8799); `issue55-stall-liveness`
:186-190 marker-moves pin and :135-142 local helper. NUL-byte map re-verified.
