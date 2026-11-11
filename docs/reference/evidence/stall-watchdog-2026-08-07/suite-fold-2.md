# #67 SUITE-FOLD-2 — blue-team findings folded into the stall-watchdog red-first suite

**Verdict:** NEEDS-FOLD → **FOLDED**
**Date:** 2026-08-07
**Source:** `suite-blueteam.md` (F1–F7 in scope; F8/F9/F10 are contract-side / composition candidates, not
part of this suite-fold — see §Deferred)
**Target:** `impl/test/stall-watchdog-red.test.mjs` (23 rows → **27 rows**)
**Contract:** `stall-watchdog-contract.md` v1.1 — **unchanged** (no v1.2 contract movement required; two
findings resolve inside the suite with the v1.1 pin already in force)
**Brief:** `suite-fold-2-brief.md` · Suite notes: `suite-draft-notes.md` (updated alongside this map)

---

## Measured split after the fold

```
$ node --test --test-reporter=spec impl/test/stall-watchdog-red.test.mjs   # repo root
ℹ tests 27
ℹ pass 7
ℹ fail 20
```

Two consecutive runs of the folded suite (both from the repo root, default profile):

| Run | tests | pass | fail | wall |
|-----|-------|------|------|------|
| 1 | 27 | 7 | 20 | 19.8 s |
| 2 | 27 | 7 | 20 | 18.1 s |

The split is **deterministic**. The 7 passes are exactly the PIN rows (B4, B5, C3, D3, D4, D5, **+E8**);
the 20 failures are the RED rows, each confirmed to fail at its NAMED stage (see the row inventory in the
test-file header; the fold re-verified every stage from the failure log). RED rows added by the fold:
C4 (`in-flight-turn-clear-missing`), E6 (`stall-seam-cycle-missing` first assertion, then
`stall-reap-receipt-missing`), E7 (`stall-clear-missing`). PIN added: E8 (`provider_stalled` whose-stall).

---

## F1 — GREEN-SIDE BLOCKER: sweep rows ride `stallMs: 0` (the exact value A3 brands a typed refusal)

- **Finding:** D1/D2/D5 constructed `new Coordinator({ watchdog: { stallMs: 0, … } })` through `setup()`,
  while A3 pins `createDriver({watchdog:{stallMs:0}})` **must refuse** `watchdog_stall_exceeds_wall`.
  Under a faithful v1.1 reading (the same check re-runs at `_armWatchdog` for defense-in-depth) a
  correct implementation throws on those spawns and goes red **before** its named stage. The related
  fragility: `stallAction: 'none'` (10 occurrences) is outside the contract's action vocabulary — a
  correct impl that validates the enum breaks all ten rows.
- **Resolution (suite-side; no contract movement):**
  1. **Re-threaded the sweep rows** (D1, D2, D5) to a valid minimal stallMs — `stallMs: 100` with
     `stallAction: 'escalate'` and the existing `blockingInteractionTimeoutMs: 60`. Each row carries a
     fixture-contract comment declaring: a **valid positive** stallMs (never 0); the sweep is driven
     through the injected `now()`/`tick()` seam; the worker is **blocked the whole window**, so
     `_armWatchdog`'s existing non-`working` refusal (the G3 guard, `coordinator.mjs:8731-8733`) keeps
     the watchdog silent regardless of the value. The "watchdog disabled" fixture semantic is therefore
     never needed and never collides with the admission law.
  2. **Removed the invented `stallAction: 'none'`** everywhere (A5, B2, B3, B4, B5, C1, C2, C3, D4,
     E1) → `'escalate'`, the contract's D1 action.
  3. **Contract pin held as-is:** the typed refusal fires only at the deployment seam
     (`createDriver`); `_armWatchdog`'s defense-in-depth is a **silent no-op** for a non-positive
     `stallMs` (the existing G3 guard already refuses silently) and cannot throw for `stallMs >= wall`
     because the `Coordinator` does not know the deployment wall. This is the v1.1 blk-6 pin — no v1.2
     movement needed.
- **Verified:** all three rows still fail at their named stages at HEAD
  (`null-deadline-sweep-missing`, `interaction-ack-extension-missing`); the ten `'escalate'` rows
  unchanged in their red/pin status.

## F2 — RED-SIDE (mirror image): the turn-terminal CLEAR path was never exercised

- **Finding:** the suite observed `lifecycle.turn_started` (C1/C2/C3) but never
  `lifecycle.turn_completed` / crash — a wrong impl that sets `turnInFlight = true` and **never clears
  it** passes C1/C2/C3 (a zombie turn holding liveness forever) and makes rung-3 reap impossible
  (`turnInFlight === false` is the reap gate). No row proved the gate *releases* a completed turn.
- **Resolution (suite-side):**
  - Added the `emitTurnCompleted(adapter, handle, workerResult, turnEpoch)` helper (the suite's first
    turn-terminal emission).
  - Added **C4** `(RED: stage[in-flight-turn-clear-missing])` — a two-part row:
    1. `turn_started` → `turn_completed {status:'completed'}` → `handle.turnInFlight === false`;
    2. the **crash terminal** — a fresh spawn, `turn_started`, then `lifecycle.crashed
       {code:'provider_crashed'}` → `handle.turnInFlight === false`.
    Both parts run on a coordinator with `progressNudgeWindowMs: 60_000` so the pausable card's
    pause-hold steering cycle never expires mid-row (its trust gate would terminalize the task —
    orthogonal to the flag-clear being pinned). A wrong impl that never clears the flag fails on the
    first assertion at `stage[in-flight-turn-clear-missing]`.
  - The blue-team's suggested "a completed turn then silence > stallMs → the stall fires" half is
    contract-consistent only for a **pausable** card (a completed turn parks to `task.status
    'paused'`; the watchdog refuses non-`working`). Under a claim card the turn_started REARM re-arms
    the watchdog — so a post-clear fire row would be asserting the D2 re-arm, which B4/E4 already pin.
    C4 pins the clear itself, which is the mirror-image gap.
- **Verified:** C4 fails at `stage[in-flight-turn-clear-missing]` at HEAD (both `turnInFlight`
  assertions RED); the completed-turn and crash paths are both asserted.

## F3 — RED-SIDE (shallow-greenability): the any-event-killed rows never emitted `content.tool_call` / `content.file_edit`

- **Finding:** B3's stream was `resource.provider_call` / `content.message` / `resource.tokens` only —
  the ORIGINAL bug re-dressed: an impl that keeps the any-event re-arm but restricts it to "real work"
  events (`content.tool_call`, `content.file_edit`) passes every re-arm row.
- **Resolution (suite-side):** B3's stream is now a 5-way rotation that adds the real evidence events:
  `resource.provider_call` → `content.message` → `resource.tokens` → **`content.tool_call`**
  (payload `{command:'git status', status:'completed', exitCode:0, callId, threadId, turnId}` — the
  `exitCode: 0` keeps the `loopThreshold` detector quiet, so no `health.loop_suspected` muddies the
  stage) → **`content.file_edit`** (payload `{path:'out.txt'}` — **no** `content` field, in-scope, so
  the scope-orientation branch at `_observeWatchdogEvent` continues without a `scope_violation`).
  The stall still fires at HEAD (any-event re-arm holds the window); under the D2 replacement each real
  event hits its own branch and returns without `_touchWatchdog`.
- **Verified:** B3 still fails at `stage[any-event-rearm-killed]` at HEAD; the new events carry the
  exact shapes the blue-team caveat demanded (loop detector quiet, scope clean).

## F4 — RED-SIDE (missing row): the rung-3 reap path and the positive `_clearStall` path were untested

- **Finding:** E3/E4/E5 asserted the seam *exists*; none drove the ladder to reap. Three wrong impls
  pass (never-reap; reap-without-preserve-first; reap-mid-turn), and the positive `_clearStall` path
  (a qualifying D2 re-arm clears the flag) is untested — an impl that **never clears** (deadlocked
  ladder) passes.
- **Resolution (suite-side):** two new rows.
  - **E6** `(RED)` — **full ladder to reap with the receipt trail + preserve-first ordering.** Drive:
    spawn → `stallMs: 60` fires `health.stall_suspected` → `assert _armStallCycle` exists (fails at
    `stage[stall-seam-cycle-missing]` at HEAD) → `control.steer` claims in try/catch (arms the
    stall-seam cycle) → the claimed window expires unanswered (`clock.now = 100 ≫ progressNudgeWindowMs
    25`, `tick()`) with `turnInFlight === false` → assert the **preserve-first receipts land before the
    stop**: `worktree.progress_unchanged` / `worktree.progress_checkpointed` at a ledger index before
    `kill.requested` / `control.interrupt_requested`, then `adapter.calls.kill.length > 0` (all fail at
    `stage[stall-reap-receipt-missing]` for the never-reap / stop-first / never-stop wrong impls). The
    worktree override supplies `capture`/`retainCheckpoint`/`resolveCheckpoint` with valid 40-hex shas,
    so the correct impl's `_preserveProgressBeforeReap` runs the `progress_checkpointed` path
    (`task.sessionContext?.baseSha` is undefined in the coordinator harness).
  - **E7** `(RED)` — **positive clear is reachable.** Drive: spawn → stall fires → steer claims →
    `assert _clearStall` exists (fails at `stage[stall-clear-missing]` at HEAD) → a **qualifying D2
    re-arm** (`question.answered`) inside the window → assert `raw.watchdogActions?.has('stall') ===
    false`, `stallSeamDigestSet.size === 0`, and `adapter.calls.kill.length === 0` (a clear is not a
    reap). This is the only place `_clearStall` may fire per D4; the row pins the ladder's escape hatch
    is real and reachable.
  - **Never-mid-turn-reap (the third wrong impl):** unreachable by construction — a mid-turn worker's
    claimed cycle is answered by the `turn_started` REARM (turn_started is in the closed set and sets
    the liveness marker), so `turnInFlight === false` at the expiry is the honest pre-condition. This is
    documented here (and in the E6 row comment) rather than asserted, because the assertion would be a
    no-op under any contract-consistent implementation.
- **Verified:** E6 fails at `stage[stall-seam-cycle-missing]` at HEAD (first assertion); E7 fails at
  `stage[stall-clear-missing]`. Under the correct impl both drive past the seam to the receipt / clear
  assertions.

## F5 — RED-SIDE (shallow-greenability): E5 was existence-only, and the digest source is unspecified

- **Finding:** `raw.stallSeamDigestSet instanceof Set` is satisfiable by an unused `new Set()` on every
  handle. The per-stall-LIFETIME dedup *semantics* — one reused digest cannot answer successive cycles
  — were untested, and the contract never specifies the digest source.
- **Resolution (suite-side):** E5 gains the content assertions the report names, plus one suite-side
  decision on the contract ambiguity:
  1. `raw.stallSeamDigestSet instanceof Set` (unchanged), **plus**
  2. `raw.stallSeamDigestSet.size === 0` — a fresh stall lifetime starts with **no** answered
     identities (a wrong impl that pre-seeds or never clears the set fails), and
  3. `typeof coordinator._clearStall === 'function'` — the only path that clears the set exists.
  - **Two-cycle discriminator — deferred with a documented reason:** the report's suggested row
    (answer cycle 1, stall re-declares, answer cycle 2 with the same identity, assert the stall does
    **not** clear) is contract-inconsistent as written: a qualifying D2 re-arm **inside the window**
    calls `_clearStall`, which clears the digest set along with the flag — so a fresh stall lifetime
    legitimately accepts the same digest again. The "one reused digest cannot answer successive cycles"
    claim only discriminates a wrong impl that clears the set **per-cycle but keeps the flag** — a
    contradiction the contract forbids. This is recorded as a **v1.2 contract-note candidate** (see
    §Deferred); the suite pins the reachable parts (empty-at-declaration + `_clearStall` is the only
    clearer) instead of a no-op row.
- **Verified:** E5 fails at `stage[stall-lifetime-dedup-missing]` at HEAD (first assertion still the
  Set existence); the content assertions are green-side (they pass only under the correct impl).

## F6 — MISSING PIN: the `waitingOn: {kind: 'provider_stalled'}` projection was never asserted

- **Finding:** E1 asserts the stall *basis* on the ledger event, but G9/SW-02 say the honest surface
  also reads `waitingOn: {kind: 'provider_stalled'}` on the status view. No row asserted the
  projection — a wrong impl that mints the basis but severs event→projection passes everything while
  the orchestrator sees a silently quiet worker.
- **Resolution (suite-side):** added **E8** `(PIN)` — the whose-stall PIN.
  - `silentWorkerAdapter()` — a worker whose spawn ack lands (and the `worktreeReady` handshake
    completes) but which **never enters a turn** — the honest `provider_stalled` subject (the in-flight
    gate protects only a worker whose flag is SET; a turnless working worker has no liveness evidence).
  - `harnessApp` with `watchdog: { stallMs: 1000, stallAction: 'escalate' }` → start + approve → the
    stall fires on silence → assert `view.waitingOn.kind === 'provider_stalled'`,
    `detail.workerId === wid`, `detail.action === 'escalate'`.
  - **Clear side (G9):** a REARM stream (`lifecycle.turn_started`, worker-actor, every 100ms ≪
    stallMs) re-arms the watchdog so no fresh suspicion fires; the projection clears (a later
    worker-actor event after the last stall_suspected). Asserted with a 3s harness `until` — no
    wall-clock flake (the #7 class).
- **Verified:** green at HEAD (both halves — the projection already exists at `application.mjs:458`,
  the clear at the G9 seam); kills an impl that severs event→projection.

## F7 — HERMETICITY / #7 CLASS: B4's re-arm-vs-window margin was 2×

- **Finding:** B4 (PIN) at `stallMs: 60` with a 30ms interval re-arm stream must see **no** suspicion.
  Under CI load a >60ms event-loop gap lets the real `_armWatchdog` timer fire and the PIN
  false-REDs — the #7 load-flake class. C3 had the same class at lower risk.
- **Resolution (suite-side):** re-based both must-not-stall rows off **event ordering**, never a 2×
  wall margin:
  - **B4:** `stallMs: 300` with the 30ms interval and a ~900ms hold — a **10×** margin. The resolution
    kinds land 10× per window; the hold spans ~3 windows, so even a coalesced interval cannot gap past
    a full window. `findStall(..., 900)`.
  - **C3:** same re-base — `stallMs: 300`, `~900ms` hold — 10× margin on the in-flight gate + provider
    activity.
  - The must-fire rows (B2/B3/E1) are unchanged — they are insensitive to delay (they *want* the
    suspicion).
- **Verified:** B4 and C3 still PASS at HEAD (both PINs green); the marginal cases now require a
  300ms+ event-loop stall — outside the #7 class.

---

## Deferred (contract-side / not in this fold)

- **F8** (composition chain: ack → extended deadline passes → still skipped → answer lands) — a D3
  composition candidate for a later contract/suite pass; the three isolated rows (D1/D2/D5) already
  cover each leg.
- **F9** (per-stall-LIFETIME dedup across a driver restart) — the contract's honest reading is a
  per-process stall lifetime (a restarted worker is a fresh liveness subject); preferred resolution is
  a **v1.2 contract note** stating the lifetime is per-process, after which no row is needed.
- **F10** (D1/E2 read the orchestrator inbox with `WAVE_OWNER`) — a v1.2 contract-note candidate: pin
  the reader authority for `stall_declared` / `interaction_expired` to "any orchestrator principal that
  can read `member_terminal` for the run" (the G8 inbox authority). No suite change needed if pinned.

**v1.2 note:** `stall-watchdog-contract.md` is **unchanged** by this fold. Three findings surface
v1.2-note candidates (the F5 digest-source ambiguity, the F9 restart durability, the F10 reader
authority) — all documented here, none requiring contract movement for the suite to be fold-blocking-safe.
