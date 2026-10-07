# #67 BLUE-TEAM SUITE REVIEW — attack the stall-watchdog red-first suite

**Verdict:** **NEEDS-FOLD**
**Date:** 2026-08-07
**Target:** `impl/test/stall-watchdog-red.test.mjs` (23 rows: 6 green PINs, 17 red at named stages)
**Contract:** `stall-watchdog-contract.md` v1.1 (folded) · **Fold:** `contract-fold.md` (blk-1..blk-9)
**Suite notes:** `suite-draft-notes.md` · **Brief:** `blueteam-67-brief.md` (this campaign)
**Review HEAD:** `ce7794f` (Baton private effective-tree snapshot; worktree HEAD)

**Read-order executed (in full):** (1) `stall-watchdog-contract.md` v1.1 — 6 ground-truth sections, 4
decisions (D1 decoupling, D2 closed re-arm set + feed + actor policy + in-flight-turn gate, D3
blocked-status escape + null-deadline default + ack extension, D4 kill ladder), the §3 closed
vocabulary, §4 acceptance pins SW-01..SW-12, §5 campaign laws, §6 OQ verdicts; (2) `contract-fold.md`
— all 9 blocker resolutions + 4 OQ verdicts; (3) `impl/test/stall-watchdog-red.test.mjs` — all 23
rows; (4) `suite-draft-notes.md` — row map, invented surfaces, PIN list, suite-law hygiene.

---

## 1. Verification performed (before claiming stage honesty)

### 1.1 The suite was run twice from the repo root (`node --test impl/test/stall-watchdog-red.test.mjs`)

| Run | tests | pass | fail | cancelled/skipped/todo | wall |
|-----|-------|------|------|------------------------|------|
| 1 | 23 | 6 | 17 | 0 / 0 / 0 | 4.45 s |
| 2 | 23 | 6 | 17 | 0 / 0 / 0 | 4.25 s |

The split is **deterministic across two consecutive runs** (matches `suite-draft-notes.md` §"Verified
split"; the draft records ~5.5 s / ~5.1 s, this review measured 4.45 s / 4.25 s — the split itself is
identical). All 17 failures are `AssertionError`s — **zero fixture errors / crashes**, so each red row
fails inside its own body, not in a `beforeEach`/helper. The 6 passes are exactly the six PINs
(B4, B5, C3, D3, D4, D5) as claimed.

### 1.2 Named-stage honesty (verified from the failure log)

Every red row's first failing assertion carries its named stage:

| Row | Failing stage (assertion text) | Row | Failing stage (assertion text) |
|-----|--------------------------------|-----|--------------------------------|
| A1 | `DEFAULT_WATCHDOG-missing` | C1 | `in-flight-turn-gate-missing` |
| A2 | `stall-exceeds-wall-admission-missing` | C2 | `in-flight-liveness-missing` |
| A3 | `stall-nonpositive-admission-missing` | D1 | `null-deadline-sweep-missing` |
| A4 | `stall-noninteger-admission-missing` | D2 | `interaction-ack-extension-missing` |
| A5 | `watchdog-config-disclosure-missing` | E1 | `stall-basis-missing` |
| B1 | `rearm-kinds-missing` | E2 | `stall-declared-reason-missing` |
| B2 | `chatty-idler-rearms` | E3 | `stall-seam-cycle-missing` |
| B3 | `any-event-rearm-killed` | E4 | `stall-seam-answer-set-missing` |
| — | — | E5 | `stall-lifetime-dedup-missing` |

The PIN-before-stage rows (D1, E1, E2) were confirmed to fail at the stage, not at their leading PIN
assertion: D1's PINs (`task.status === 'input_required'`, `raw.status === 'blocked'`) pass at HEAD and
the failure is the post-tick release assertion; E1's PIN (`stall window fires`) passes and the failure
is `payload.basis`; E2's PIN passes and the failure is the missing `stall_declared` reason.

### 1.3 Citations verified

The **two** NUL-bearing files (`application.mjs`, `coordination-store.mjs` — 3 NUL bytes each, verified
by `tr -cd '\000' | wc -c`) were read by `grep -an`/`sed -n` only, per campaign discipline.
`coordinator.mjs`, `application-deployment.mjs`, and `index.mjs` have **0** NUL bytes.

- `coordination-store.mjs:496` → `export const MAX_SCRATCHPAD_WORKER_ENTRIES = 128;` ✓ (B2 farm cap)
- `application.mjs:372-388` → `projectBlockedInteraction` returning `approve_plan` / `select_candidate`
  / `decision` / `answer_question` ✓; `application.mjs:408` → `if (blocked) return null;` (waitingOn
  null when blocked) ✓ (D3 PIN)
- `application.mjs:458` → `kind: 'provider_stalled'` in the waitingOn projection ✓ (G9)
- `application-semantics.mjs:59-63` → the closed five `WAITING_ON_KINDS` incl. `provider_stalled` ✓
- `application-deployment.mjs:1920` → `watchdog: { stallMs: DEFAULT_BUDGET.wallMin * 60_000 }` — the
  wall-derived 480-min override A1 pins ✓
- `index.mjs:1489` → `watchdog: opts.watchdog` pass-through, unvalidated (A2/A3/A4 seam) ✓
- `coordinator.mjs:8731-8746` → `_armWatchdog`: silent `stallMs > 0` guard at `:8733`, payload
  `{elapsedMs, action, mechanical}` at `:8743` (E1/A1 anchors) ✓
- `coordinator.mjs:9144-9146` → `_observeWatchdogEvent` any-event re-arm + `actor !== 'worker'` gate
  (B2/B3/B5 anchors) ✓
- `coordinator.mjs:12824` → the single feed, last line of `_handleEvent` — reached by every test-emitted
  event kind (each switch case `break`s to it; confirmed no `case 'lifecycle.turn_started'` and no
  early `return` on the suite's event kinds) ✓
- `coordinator.mjs:2913-2931` → `_sweepDeadlines`: `approval`/`publication` deny and `decision` expire
  branches only, **no `question` branch** (D1 anchor) ✓
- Invented surfaces all absent at HEAD (each 0 matches): `DEFAULT_WATCHDOG` in
  `application-deployment.mjs`, `REARM_KINDS` / `turnInFlight` / `stallSeamDigestSet` / `claimInteraction`
  in `coordinator.mjs` ✓

---

## 2. Verdict summary

**NEEDS-FOLD.** The suite's red-keeping power is real (the split is honest, the stages are honest, the
PINs discriminate their named wrong impls) but **incomplete on both axes the brief names**:

- **Green-side:** one fixture class (`stallMs: 0` in the sweep rows) contradicts the suite's own
  admission rows under a faithful v1.1 reading of D1/blk-6 — a correct implementation may not go
  all-green.
- **Red-side:** three concrete wrong implementations slip through the re-arm/control-law rows (an
  any-event re-arm in an evidence costume on `content.tool_call`/`content.file_edit`; a zombie
  `turnInFlight` that never clears — the mirror image of the stall bug; a ladder that never reaps and
  a stall that never clears), and the entire rung-3 reap receipt trail is untested.

Findings are numbered F1..F10, most-severe first. Each gives (row/gap + attack + concrete fix).

---

## 3. Numbered findings

### F1 — GREEN-SIDE BLOCKER: the sweep rows ride `stallMs: 0`, the exact value A3 brands a typed refusal `watchdog_stall_exceeds_wall`

- **Row/gap:** D1 (`stall-watchdog-red.test.mjs:684`), D2 (`:718`), D5
  (`:779`) construct `new Coordinator({ watchdog: { stallMs: 0, blockingInteractionTimeoutMs: 60 } })`
  directly through `setup()`. A3 (`:494-500`) asserts `createDriver({watchdog:{stallMs:0}})` **must
  refuse** `watchdog_stall_exceeds_wall`.
- **Attack (green-side):** D1/blk-6 pins the admission validation with "a violation is a typed refusal
  `watchdog_stall_exceeds_wall` (no silent fallback)" and "**the same check runs at `_armWatchdog` for
  defense-in-depth**". `_armWatchdog` is invoked on every spawn and every turn-start via
  `_resetWatchdogTurn` (`coordinator.mjs:8750-8755`). If a faithful implementer applies the same
  (throwing) check at `_armWatchdog`, then `coordinator.spawn(...)` in D1/D2/D5 throws with a fixture
  error — those three rows fail **before** their named stage (`null-deadline-sweep-missing` /
  `interaction-ack-extension-missing`) and a **correct** v1.1 implementation cannot go all-green. The
  suite simultaneously demands `stallMs: 0` be refused (A3) and uses it as a "watchdog disabled"
  fixture value in three rows. The "watchdog disabled" semantic is not pinned anywhere.
- **Concrete fix (two parts):**
  1. **Contract:** pin that the typed refusal fires **only at the deployment seam** (`createDriver` /
     `application-deployment.mjs`). The `_armWatchdog` defense-in-depth check is a **silent no-op**
     (log + refuse to arm) for a non-positive `stallMs` — the existing G3 guard
     (`coordinator.mjs:8733`) already refuses silently — and cannot throw for `stallMs >= wall`
     because the `Coordinator` does not know the deployment wall. Under this pin, `stallMs: 0` is an
     explicit, legal "liveness disabled" value at the coordinator level, and the sweep fixtures stop
     depending on an unstated edge.
  2. **Suite (defense-in-depth):** do not make the sweep rows depend on that pin alone — add a comment
     on D1/D2/D5 declaring the `stallMs: 0` = "watchdog disabled" fixture contract, or drive the sweep
     through a dedicated sweep-only config seam so the fixture value can never collide with the
     admission law.
- **Related fragility:** the `stallAction: 'none'` fixture value (10 occurrences — A5 `:514`, B2 `:547`,
  B3 `:565`, B4 `:589`, B5 `:611`, C1 `:638`, C2 `:649`, C3 `:660`, D4 `:763`, E1 `:800`) is **not in
  the contract's action vocabulary** (D1 pins `'escalate'`; `_applyWatchdogAction` at
  `coordinator.mjs:8761-8765` handles `kill`/`interrupt` today and gains `escalate`). It is a no-op at
  HEAD and under the D2 replacement only because unknown actions fall through silently. A correct impl
  that validates the action enum (a plausible hardening) breaks all ten rows. Pin `'none'` as the explicit
  no-op action in the contract (it is the natural realization of D4's "an unclaimed stall stays
  escalated" honest terminal under a test config), or have the fixtures use a contract-defined action.

### F2 — RED-SIDE (mirror image): no row exercises the turn-terminal clear path — a zombie `turnInFlight` holds liveness forever and passes C1/C2/C3 and the rung-3 reap gate

- **Row/gap:** the suite has `emitTurnStarted` (`:319`) but **no** `lifecycle.turn_completed`, crash, or
  exit emission anywhere (`grep lifecycle.turn_completed` = 0 matches). The turn-terminal clear path
  that D2/blk-5 pins ("cleared at the turn-terminal seam `:12307-12323` and the crash/exit terminal
  paths `:12844`") is never exercised.
- **Attack:** the brief names this exactly — "the in-flight-turn gate pass via a flag that never clears
  (a zombie turn holding liveness forever — the mirror image of the stall bug)". A wrong impl sets
  `handle.turnInFlight = true` on observed `turn_started` and never clears it: C1 passes (flag set),
  C2 passes (in-flight silence never declared), C3 passes (in-flight + activity). Because D4 rung-3 reap
  requires `turnInFlight === false`, the zombie also makes **reap impossible**, and no row catches the
  never-reap either (F4). The suite's control-law rows only prove the gate holds a *live* turn; they
  never prove the gate *releases* a completed turn. A worker whose turn completed (or whose process
  crashed) and whose flag never cleared becomes permanently undeclarable — the original bug's exact
  failure ("no bound can ever fire") in the other direction.
- **Concrete fix:** add rows that pin the clear path and the post-clear discrimination:
  1. after `lifecycle.turn_completed` (worker `wr.status === 'completed'`), `handle.turnInFlight === false`;
  2. a turn completes, then **silence > stallMs** → the stall **does** fire (the in-flight gate is gone);
  3. the crash path (`lifecycle.crashed`) and exit path clear the flag too;
  4. a mid-turn worker whose claimed stall-seam cycle expires unanswered is **not** reaped and the stall
     stays escalated (the never-mid-turn-reap half of SW-10 — currently untested, see F4).

### F3 — RED-SIDE (shallow-greenability): the any-event-killed rows never emit `content.tool_call` / `content.file_edit` — an any-event re-arm in an evidence costume passes

- **Row/gap:** B3's stream (`:570-576`) is `resource.provider_call` / `content.message` /
  `resource.tokens` only. The contract (D2) explicitly removes `content.tool_call` and
  `content.file_edit` from the re-arm set — tool_call "never touch `_touchWatchdog`"; file_edit runs
  the scope-orientation branch — but the suite never emits either kind (`grep content.tool_call` and
  `grep content.file_edit` = 0 matches each).
- **Attack:** "the ORIGINAL bug re-dressed": an impl that keeps the any-event re-arm but restricts it to
  "real work" events — `content.tool_call` (a tool call proves the worker is doing something) and
  `content.file_edit` (an edit proves progress) — passes **every** re-arm row: B2 (scratchpad stream has
  no tool_call), B3 (its stream has no tool_call), B4 (question.answered), B5 (steer/nudge). C2/C3 never
  emit tool_call either. The evidence costume is exactly the #55 lesson (activity ≠ evidence) that the
  fold was built to kill, and the suite does not see it.
- **Concrete fix:** add `content.tool_call` and an in-scope `content.file_edit` to the B3 stream (or a
  new any-event-killed row) and assert the stall fires. Both are red at HEAD (any-event re-arm holds
  the window) and green under the D2 replacement (each hits its own branch and returns). **Caveat:** the
  tool_call events must carry `status: 'completed'` / `exitCode: 0` (or no exitCode) so the
  `loopThreshold` detector (`coordinator.mjs:9161-9174`) stays quiet — a failed-exit tool_call stream
  mints `health.loop_suspected` and muddies the stage. The file_edit must be in-scope (`pathScope: ['.']`)
  so the scope-orientation branch does not mint a `scope_violation`.

### F4 — RED-SIDE (missing row): the rung-3 reap path is entirely untested — no receipt trail, no preserve-first ordering, no never-mid-turn gate, no positive `_clearStall` path

- **Row/gap:** E3 (`:824-836`) asserts `_armStallCycle` exists; E4 (`:838-854`) asserts a scratchpad note
  does not clear the stall; E5 (`:856-864`) asserts the digest Set exists. **None** drives the ladder to
  reap. The §3 vocabulary `worktree.progress_unchanged` / `worktree.progress_checkpointed` /
  `kill.requested` / `control.interrupt_requested` — D4 rung-3's whole receipt trail — is asserted
  nowhere in the suite.
- **Attack:** three wrong impls each pass E3/E4/E5: (a) one that **never reaps** (a claimed stall-seam
  cycle expires unanswered, nothing happens — the stall stays escalated forever with no stop; note
  OQ-2's "stays escalated" is the honest *unclaimed* terminal, but a wrong impl gets the same behavior
  on the *claimed* path); (b) one that **reaps without `_preserveProgressBeforeReap` first** (kills the
  worker with no `progress_unchanged`/`progress_checkpointed` receipt — the preserve-before-reap law,
  G12, unpinned); (c) one that **reaps mid-turn** (ignores the `turnInFlight === false` rung-3 gate —
  the never-mid-turn-reap law, unpinned). Conversely, the **positive** path — a qualifying D2 re-arm
  inside the claimed window calls `_clearStall(handle)` and the stall flag is removed and the watchdog
  re-armed fresh — is also untested, so an impl that **never clears** (a deadlocked ladder: neither
  clear on progress nor reap on silence) passes.
- **Concrete fix:** two new rows.
  1. **Full ladder to reap:** stall declared → `control.steer` claims (arms the stall-seam cycle) →
     cycle expires unanswered with `turnInFlight === false` → assert `_preserveProgressBeforeReap`
     receipts first (`worktree.progress_unchanged {state:'no_progress'}` or a pinned `progress_checkpointed`)
     → the stop is receipted (`kill.requested` / `control.interrupt_requested`) → `adapter.kill` called.
     Assert the receipt **order** (preserve-before-stop) so a wrong impl that stops first fails.
  2. **Positive clear:** stall declared → steer claims → a qualifying D2 re-arm (e.g. `lifecycle.turn_started`)
     inside the window → assert `_clearStall`: `stall` flag gone, `stallSeamDigestSet` cleared, watchdog
     re-armed fresh. This is the only place `_clearStall` may fire per D4; the row pins that the ladder's
     escape hatch exists and is reachable.

### F5 — RED-SIDE (shallow-greenability): E5 is existence-only, and the contract never specifies what a stall-seam "digest" even is

- **Row/gap:** E5 (`:862`) asserts `raw.stallSeamDigestSet instanceof Set`. Any impl can satisfy that by
  adding an unused `stallSeamDigestSet = new Set()` to every handle. The per-stall-LIFETIME dedup
  *semantics* — "one reused digest cannot answer successive cycles" (D4 rung 2) — are untested.
- **Attack:** a wrong impl with **per-cycle** dedup (digest set cleared at each cycle's end, the exact
  blk-4 loophole) passes E5 (a Set exists on the handle) and E4 (E4's scratchpad note is not a REARM kind
  at all, so per-cycle dedup never sees it). The discriminator needs **two successive claimed cycles
  answered by the same reused digest**: per-cycle dedup clears both (stall cleared), lifetime dedup
  clears once. There is also a contract ambiguity the suite inherits: the stall-seam cycle's answer set
  is the **D2 REARM kinds** (`approval.resolved`, `decision.settled`, `lifecycle.turn_started`,
  `question.answered`), none of which carry a TG2-style content digest — so the "digest" keying is
  unspecified (requestId? turnEpoch? event kind?). An unspecified key means the Set is never populated
  and the lifetime-dedup claim is untestable as written.
- **Concrete fix:** (a) in the contract, specify the digest source for the stall-seam cycle (e.g., the
  resolution `requestId` / the turn epoch — the identity that would let a worker "answer" successive
  cycles with the same event); (b) in the suite, add the two-cycle row: declare stall → claim → answer
  cycle 1 with a qualifying re-arm (assert `_clearStall`) → stall re-declares → claim → answer cycle 2
  with the **same** identity/digest → assert the stall does **not** clear.

### F6 — MISSING PIN: the `waitingOn: {kind: 'provider_stalled'}` projection is never asserted (whose-stall, worker direction)

- **Row/gap:** E1 (`:798-806`) asserts `health.stall_suspected.payload.basis` on the **ledger** event, but
  G9 / SW-02 / §3 say the honest surface also reads `waitingOn: {kind: 'provider_stalled'}` on the status
  view, derived from the last stall_suspected with no later worker-actor event. No row asserts the
  projection.
- **Attack:** the projection already exists at HEAD (`application.mjs:458`), so the correct impl gets it
  for free — the gap is not a red-keeping hole but a **missing PIN**: a wrong impl that mints the basis
  payload but stops wiring the `provider_stalled` projection (e.g., by minting the stall event outside
  the ledger surface the projection reads) would pass every row while the orchestrator sees a silently
  quiet worker instead of `provider_stalled`.
- **Concrete fix:** add a PIN row: after the stall fires, the stalled worker's status view reads
  `waitingOn: {kind: 'provider_stalled'}`; after a later worker-actor REARM event, the projection clears
  (G9's "no later worker-actor event"). Green at HEAD; kills a wrong impl that severs event→projection.

### F7 — HERMETICITY / #7 CLASS: B4's re-arm-vs-window margin is 2× — load-dependent flake risk on a PIN row

- **Row/gap:** B4 (PIN, `:588-607`) must see **no** suspicion: `stallMs: 60` with a 30 ms `setInterval`
  re-arm stream (`question.answered` every 30 ms). The real `_armWatchdog` timer (`_setTimeout`) fires
  at 60 ms; the interval must land within every 60 ms window or the stall fires and B4 false-REDs.
- **Attack:** the #7 load-flake class is exactly a wall-clock race between a test stream and a real
  timer. Under a busy CI the Node event loop can gap >60 ms between interval callbacks (timer coalescing
  under load, GC, another worker process on the box), the watchdog timer fires, `health.stall_suspected`
  lands, and a correct implementation's suite fails non-deterministically. C3 has the same class of risk
  but lower (its hold is sustained by the in-flight gate, not by interval cadence).
- **Concrete fix:** widen the margin on the must-not-stall rows — e.g. `stallMs: 300` with the 30 ms
  interval (10×) and a ~600 ms hold — or drive those windows through the injected `now()`/`tick()` seam
  instead of real timers. Keep the must-fire rows (B2/B3/E1) as-is (they are insensitive to delay). The
  suite-law note claims "no row depends on REAL wall time (the #7 flake class)" — B4 currently does, in
  the narrow but real sense that its green outcome depends on the real timer staying behind the interval.

### F8 — MISSING ROW (composition): the #105 escalation chain — escalate → ack → late answer → worker resumes — is never chained, and the post-escalation re-ask is untested

- **Row/gap:** D1 tests escalate-release, D2 tests ack-extension, D5 tests late-answer — each in
  isolation. No row chains **ack → extended deadline passes → still skipped → operator answers → lands**,
  and no row asserts the D3 "re-ask after release" admission (a released worker may re-ask; the one-pending
  admission still holds; the record is never closed).
- **Attack:** an impl that closes an **acked** record after its *extended* deadline passes passes both D2
  (D2 never advances past the extension to answer) and D5 (D5 never acks first). The composition is where
  blk-7's "non-destructive escalation" is really tested.
- **Concrete fix:** one chained row: block → `claimInteraction` (ack, +60) → advance past the original
  deadline (skip holds) → advance past the extension → sweep still skips → `respond` lands (`ok:true`) →
  worker resumes `working`. Optionally a second row: escalate → release → worker re-asks the same
  question → admission succeeds.

### F9 — MISSING ROW (durability): per-stall-LIFETIME dedup across a driver restart is untested (and the contract is silent on it)

- **Row/gap:** `handle.stallSeamDigestSet` and the `stall` flag are in-memory per-handle. A driver
  restart (recovery path repopulates handles) rebuilds the set empty; a "reused digest" from before the
  restart could answer a fresh cycle. The brief names this as a gap candidate; the contract does not
  specify whether the digest set survives restart.
- **Attack:** if the intent is that the stall lifetime is per-process (a restart resets all stall state),
  the suite should say so and a row should not be required; if the intent is durability, the suite must
  pin it. As written, neither is pinned and the implementer has no answerable contract.
- **Concrete fix:** either (a) contract: state the stall lifetime (flag + digest set) is per-process and
  a restart clears it — then no row is needed and the notes should record that decision; or (b) add a
  restart row: declare stall → persist/restart the driver → reused digest on the fresh lifetime must not
  carry over. Prefer (a) — it is the honest reading of the control law (a restarted worker is a fresh
  liveness subject).

### F10 — GREEN-SIDE RISK (fixture principal): D1/E2 read the orchestrator inbox with `WAVE_OWNER`, but the contract scopes the new reasons to "the run's orchestrator"

- **Row/gap:** D1 (`:707-710`) and E2 (`:815-818`) call `attentionFollow({scope: {runId}, targets: [...]},
  WAVE_OWNER)` with the harness's wave-driver principal (`:182`). The contract's attention-reason
  section says `stall_declared` / `interaction_expired` are "surfaced to the run's orchestrator (the
  same authority that reads `member_terminal`)".
- **Attack:** if the correct impl authorizes these new reason kinds to the **run owner** (the `owner`
  principal of the task/run) rather than to any orchestrator principal, `WAVE_OWNER` reads an empty page
  and D1/E2 fail at their reason assertions — a correct implementation goes red. The existing
  `member_terminal` wake is readable by `WAVE_OWNER` in the issue10 idiom, so the assumption is
  reasonable but unstated.
- **Concrete fix:** in the contract, pin the reader authority for the two new reason kinds (e.g.,
  "any orchestrator principal that can read `member_terminal` for the run" — the G8 inbox authority), or
  in the suite, use the run's owner principal for these reads. Whichever is chosen, the suite should not
  silently depend on the harness's wave-driver identity for the new reasons.

---

## 4. Control-law assessment (the brief's axis 3)

- **C3 (slow-but-productive) is discriminating.** A naive timer-only implementation (no re-arm set, no
  in-flight gate) fires the D1 window on elapsed time → C3 fails (suspicion != null). An any-event
  re-arm impl passes C3 but fails B3. A closed-set-only impl (no in-flight gate) fails C2 (turn in
  flight + zero events → declared) and C3. The trio B3+C2+C3 discriminates each wrong impl class
  **except** the two covered by F2 (zombie turn) and F3 (tool_call/file_edit costume).
- **"A bound fires on pure elapsed time and the suite FAILS to catch it":** the reverse direction is
  the live hole. The zombie `turnInFlight` (F2) is a bound that can **never** fire even for a genuinely
  dead worker, and the suite has no row that would catch it; the never-reap ladder (F4) is the same
  failure in the kill path. After a turn completes, no row asserts the stall can fire again — so the
  control law's "no bound fires without an evidence check" is tested on the *hold* side only, never on
  the *release* side.

---

## 5. Stage honesty + hermeticity notes (what holds)

- **Named stages are honest** — every red row fails at its named stage at HEAD (verified §1.2), the
  namespace imports probe absent exports with `assert.ok(...)` first (so `Object.isFrozen(undefined)`
  cannot spuriously pass a shape assertion), and the PIN-before-stage rows (D1/E1/E2) fail at the stage.
- **Hermetic** — ScriptableAdapter + MockAdapter only, no network, `mkdtempSync` repos/logs, `test.after`
  cleanup, no NUL-bearing file reads (verified §1.3). Fake timers are not used; the sweep rows drive the
  real `_sweepDeadlines` through the injected `now()` double + `tick()` — a real seam, fine per the law.
- **The wall-clock caveat is B4** (F7) — a must-not-stall PIN whose green outcome races the real
  `_armWatchdog` timer against a 30 ms interval, at 2× margin.

---

## 6. Bottom line

The suite is an honest, stage-clean, well-anchored red-first instrument, and its six PINs kill their
named wrong impls. It is **not fold-blocking-safe yet**: F1 can keep a *correct* implementation from
going all-green, and F2/F3/F4 let the two mirror-image bugs (any-event re-arm in a tool_call costume;
a zombie turn that never clears) and a deadlocked ladder pass the re-arm and kill-ladder rows entirely.
F5/F6/F7/F8/F9/F10 are smaller but concrete. Per the brief's output law the verdict is **NEEDS-FOLD**
with the numbered findings above as the fold work-list.

**Deployment verification command** (Baton): executable `true`, arguments `[]`, expected exit 0.
