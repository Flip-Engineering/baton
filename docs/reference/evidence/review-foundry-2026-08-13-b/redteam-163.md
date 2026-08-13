# #163 RED-TEAM REPORT — adversarial attack on the quiescence-derived wave completion contract v1

[attempt: 5471bf44-610b-413d-a476-7a32a465f675 row-rt163]

- **Target:** `docs/reference/evidence/contract-foundry-2026-08-13/contract-163.md` (v1 — issue
  #163, the quiescence-derived completion control replacing the interpreter's `hardCapMs`
  wall-clock).
- **Date:** 2026-08-13
- **Verification HEAD:** `e371f704727cbca5fdff86af31ec8b154620a71f` — the worktree HEAD this report
  was written at, identical to the contract's claimed verification HEAD. Every `file:line` anchor
  below was re-verified against this HEAD.
- **NUL discipline honored:** `application.mjs` and `coordination-store.mjs` were probed with
  `grep -an`/`sed -n` only (3 NUL bytes each); no whole-file reads. `workflow-interpreter.mjs`,
  `wave-driver.mjs`, `wave.mjs`, `coordinator.mjs`, `application-semantics.mjs`, and the two red
  suites were read directly (NUL-free).
- **Access note:** `gh issue view 163` is not available — `gh` is unauthenticated in this session
  (no `GH_TOKEN`). The issue is read via the row brief, the contract, and `foundry-qa.md`, which
  fully summarize it; the foundry-qa's named hole is quoted and deepened below.
- **Scope:** the single deliverable
  `docs/reference/evidence/review-foundry-2026-08-13-b/redteam-163.md`; no source file was modified.
- **Bottom line:** **NOT FOLD-READY.** Two blocking holes (B1 the mid-thought false-quiescence
  — the exact classic failure the brief demands be attacked; B2 the unreadable-member infinite
  hang under `hardCapMs: null`), plus a named spec gap (B3). The `foundry-qa`'s one named hole is
  confirmed and deepened: the fix it proposes (`phase/liveness-aware` candidacy) does NOT close B2
  and is itself under-specified against the real taxonomy.

---

## 1. Citation audit (all at HEAD `e371f70`)

Every `file:line` anchor in the contract was re-verified this session. **No wrong citation found —
no automatic blocker.** Verified highlights:

- G1 loop condition `workflow-interpreter.mjs:736`; `startedAt` `:554`; `DEFAULT_DRIVER`
  `:414`; `normalizeDriver` `:416-422` — all exact.
- G2 `PRODUCTION_WORKFLOW_DRIVER` `application.mjs:117-119`; the `waves.run` facade default
  `request.driver ?? PRODUCTION_WORKFLOW_DRIVER` — re-verified at the facade method that the
  interpreter and suite share; `wave-driver.mjs:35-73` `DEFAULT_POLICY.hardCapMs` — exact.
- G3 inspect outline default `application.mjs:10931`; outline timing spread `:11039-11061`
  (`...timing` `:11052`, `progressClass` `:11061`) — exact. **But see B3:** the contract's
  conclusion "the quiescence check reads fields already present in the one poll it already takes"
  is an overclaim — `readView` (`workflow-interpreter.mjs:428-461`) returns a closed shape that
  DROPS `silenceMs`/`lastProgress.at`/`progressClass` (the return object is `:451-461`, no timing
  fields). The data exists in the outline; the loop's poll does not carry it.
- G4 `_followCategory` `:8010-8033` (null at `:8032` for anything not classified);
  `NOISE_TELEMETRY_OPERATIONAL_KINDS` `:85`; `_progressTiming` `:8137-8182` — exact.
- G5 `REARM_KINDS` `coordinator.mjs:71-76`; `_observeWatchdogEvent` `:9382`; `projectProgressClass`
  `application.mjs:505-520`; `PROGRESS_SILENCE_THRESHOLD_MS` `application-semantics.mjs:54` — exact.
- G6 `TERMINAL_PHASES` `:464-465`; `processMember` pending-delete `:733` — exact.
- G7 steering evidence channel `:798` — exact.
- G8 `wave.close` `wave.mjs:451-486` — exact.
- G9 D6 receipt `:609-617`; F14 key-set pin `workflow-as-data-red.test.mjs:705` — exact.
- G10 `LANE_DRIVER` `workflow-as-data-red.test.mjs:346` (passed at `:453`),
  `worker-orchestrated-swarm-red.test.mjs:77` (passed at `:493,528,566,665,717,767,827,871,976,1032,
  1082`) — all re-verified; every `waves.run` call passes `driver: LANE_DRIVER` explicitly; no suite
  row relies on `DEFAULT_DRIVER`.

Three non-citation findings surfaced during the audit are developed below (B2, B3, and the
D2.1 `stallTimeoutMs` ghost). No anchor is wrong; the holes are in the contract's *logic* and
*completeness*, not in its citations.

---

## 2. Attack on D1 — the quiescence bound (the brief's special-attention axis)

### 2.1 B1 — the predicate can declare quiescence while a member is mid-thought (false WAVE-QUIESCED). HOLE.

The candidate predicate is `silenceMs(role) >= windowMs` (D1.1), where `silenceMs` is
`outline.silenceMs` — a pure **time-since-last-meaningful-event** measure. It is not
phase/liveness-aware. The attack, against the REAL event taxonomy:

- **The reset set excludes the #67 liveness kinds.** `_followCategory`
  (`application.mjs:8010-8033`) classifies plan/execution/orchestration/context/evidence/result/
  cleanup/integration/recovery/verification as meaningful and returns `null` for everything else.
  `lifecycle.turn_started`, `lifecycle.turn_completed`, `approval.resolved`, `decision.settled`,
  and `question.answered` ALL fall to `null` — i.e., the exact five event kinds the #67
  watchdog treats as liveness re-arms (`REARM_KINDS`, `coordinator.mjs:71-76`) are **not** reset
  events at the run level. G5 says this contract "mirrors" the #67 machinery; it does not — it
  uses `_followCategory`, which is a *different* taxonomy that excludes the #67 liveness set.
- **A member actively turning reads fully silent.** During a long reasoning turn, a member emits
  `lifecycle.turn_started` (per turn), `content.tool_call`, `content.message` (noise, excluded),
  and `evidence.mapped` wrapping those noise kinds (excluded at `:8018`). No meaningful event
  fires between `task.claimed` and `run.result_*`/`task.transitioned`. `lastProgress.at` therefore
  does not advance and `silenceMs` grows for the whole turn.
- **The window does not bound a turn.** `windowMs = max(2 * maxObservedGapMs,
  QUIESCENCE_MIN_SILENT_POLLS * pollIntervalMs)` (D1.2). In production (D2.1) the floor is
  `8 * 20 000 ms = 160 s`. A member on a legitimate 5-minute reasoning turn passes 160 s of silence
  at 160 s while still 140 s from its next meaningful event. If the rest of the roster is quiet, it
  is a candidate at 160 s and the wave is declared WAVE-QUIESCED mid-thought. A turn longer than
  the derived window is the classic failure the brief names, and the cadence term cannot catch it:
  a turn is not bounded by `2 *` the roster's *observed* gaps.
- **The confirmation poll does not rescue.** D1.3 re-reads and requires `lastProgress.at`
  unchanged. A mid-thought member emits only noise between the two polls; noise does not advance
  `lastProgress.at`; the confirmation passes. The re-arm race is closed for *meaningful* events
  only, which is exactly the wrong set for a member that is alive-but-noise-only.
- **The pathological mix the brief demands is a false declaration.** Roster = silent-but-alive
  (mid-thought) + waiting-on-decision + dead-but-readable:
  - The stuck-decision early-break (D3.3, `:753-757`) fires only when **every** remaining member is
    stuck on a handled decision. The mix fails `.every()` (the mid-thought member is not stuck on a
    decision; the dead member has no handled key) — the stuck-break does NOT fire.
  - Quiescence candidacy: mid-thought member → `silenceMs` grows → candidate; waiting-on-decision
    member → `silenceMs` grows while it waits (even the answer, when it arrives, is
    `decision.settled`/`question.answered` — not meaningful) → candidate; dead-but-readable → grows
    → candidate. Confirmation poll: all three still "quiet" (noise-only) → **WAVE-QUIESCED declared
    with the mid-thought member cut off at the knee of its turn.**

**Fix (concrete, and stronger than the foundry-qa's):**
1. Gate candidacy on liveness, not just silence. A pending member is a candidate only when it is
   **both** `silenceMs >= windowMs` **and** not in an active turn. Use the run-level liveness data
   the runtime already computes: `progressClass !== 'silent'` (`projectProgressClass`,
   `application.mjs:505-520`, `PROGRESS_SILENCE_THRESHOLD_MS = 120 000`,
   `application-semantics.mjs:54`) is the floor — a member whose `progressClass` is `active`/
   `working` is mid-life and must never be a candidate.
2. Add the #67 liveness kinds to the reset set (or explicitly define the relationship): at minimum
   `lifecycle.turn_started` must reset the watch, because #67 already treats it as the
   "member is alive" signal. G5's "mirror" claim is only honest if the reset set actually includes
   the #67 re-arm set.
3. Because (1)+(2) can leave a *phase-stuck* member (phase `working`, no events, `progressClass`
   eventually `silent`) as a never-candidate, the design MUST pair the liveness gate with the
   terminalization rule in B2 — they are one design, not two. The foundry-qa's fix alone would
   create a hang for a phase-stuck member; see 2.2.

### 2.2 B2 — an unreadable member makes quiescence undeclareable → the wave hangs under `hardCapMs: null`. HOLE.

`readView` swallows every `inspect()`/`status()` throw (`workflow-interpreter.mjs:436-438`,
`catch { /* the run may be mid-stop */ }`) and returns `io = {}` — so an unreadable member reads as
`{ phase: null, terminal: false }`. `isTerminal` is false (`:464-465`), so the member stays in
`pending` forever (`:733`). Its `silenceMs` is `undefined` (no outline), and
`undefined >= windowMs` is `false` — it is **never** a quiescence candidate. The D1.1 wave
declaration requires **every** pending member to be a candidate, so a single unreadable member
makes quiescence impossible to declare.

At HEAD this is harmless — the loop's `hardCapMs` bails out. The contract removes the bail
(D2.1 `PRODUCTION_WORKFLOW_DRIVER.hardCapMs: null`; D2.3 `DEFAULT_DRIVER.hardCapMs: null`), and the
loop condition correctly honors the sentinel (D2.2 is a correct fix for the `number < null` trap,
verified). The result: **a permanently-unreadable member turns the production drive loop into an
infinite loop.** The completion control is not a total function over the state space: D1.4
terminalizes a member that reads as an unrecoverable terminal, but a member that reads as *neither*
terminal nor meaningful is undefined behavior.

Note the same gap bites the foundry-qa's proposed liveness gate: a phase-stuck-but-readable member
(phase `working`, `progressClass` eventually `silent`) would be gated out of candidacy forever, and
a dead-but-unreadable member has no `progressClass` at all.

The code itself treats unreadable members as a real path: the preOutcome capture (`:562-576`) reads
each member via `readView` and catches with `/* unreadable — settle at close */` (`:567`) — i.e., the
runtime expects `inspect()` can permanently fail, and today only the (soon-to-be-removed) `hardCapMs`
bails the drive loop out of that state. The contract replaces the bail-out without replacing the
recovery.

**Fix:** pin a closed unreadable-member rule in D1.4. Concretely: a still-pending member whose
`readView` returns no phase and no terminal for N consecutive polls (N a small evidence-count, e.g.
the confirmation pair + 1) is treated as terminalized-unrecoverable — the loop breaks via the D1.4
exit, `wave_terminalized_unrecoverable` is pushed, the survivors are stopped, and the receipt is
`WAVE-INCOMPLETE`. This makes the completion control total without reintroducing a clock (it is an
evidence-count of failed polls, the same law as the window floor).

### 2.3 B3 — the landing is under-specified: `readView` does not carry the quiescence fields. Amendment (blocks a faithful implementation).

G3's claim — "the quiescence check reads fields already present in the one poll it already takes" —
is not what the code supports. `readView` returns exactly
`{ phase, actions, attention, taskId, workerId, planDigest, task, terminal, terminalStatus }`
(`workflow-interpreter.mjs:451-461`). `silenceMs`, `lastProgress.at`, and `progressClass` ride the
`outline` (`io`) but are **dropped at the readView seam**. `_progressTiming` lives in
`application.mjs:8137-8182`; the outline carries the result (`:11052`); `readView` discards it.

A contract-faithful implementer following D1.1/D1.3 literally cannot compute `silenceMs(role)`
from the poll's `readView` result. They must either (a) extend `readView`'s return (a named change
the contract never specifies), or (b) add a second command — which violates D2.4(a)'s "the common
poll stays ONE command" and would break the A7 pin's premise.

**Fix:** name the readView extension in the contract — add `lastProgress`, `silenceMs`, and
`progressClass` (projected from `io`) to the returned closed shape, and anchor the D1.1 predicate
on those projected fields. The contract already cites the outline block; it must cite the readView
projection that makes the fields reach the loop.

---

## 3. Attack on D2 — the migration

**Mechanics: SOUND.** Verified: D2.2's sentinel handling is exactly right — a bare
`Date.now() - startedAt < driver.hardCapMs` with `hardCapMs: null` evaluates `number < null` to
`false` and would exit immediately; the rewritten condition
`(driver.hardCapMs === null || Date.now() - startedAt < driver.hardCapMs)` is the correct landing.
D2.1's change of `PRODUCTION_WORKFLOW_DRIVER` to `hardCapMs: null` genuinely de-clocks the shipped
`waves.run` path (verified the facade default `request.driver ?? PRODUCTION_WORKFLOW_DRIVER`). The
suite keeps `LANE_DRIVER.hardCapMs: 3000` at every `waves.run` call site (verified above). **OQ4 is
resolved SOUND:** `createWaveDriver` is invoked only in `recipes.mjs:468` (and re-exported at
`index.mjs:219`); the interpreter path (`baton.waves.start` → `startWave`) never arms the
wave-driver's 3 h loop, so the de-clocking is real and not undercut by a hidden 3 h teardown.

**Two honesty problems:**

- **D2.1's `stallTimeoutMs` parenthetical is a ghost.** The contract says `stallTimeoutMs` "remains
  the #67 per-member stall budget (a liveness bound, not a wave-completion clock — unchanged, cited
  not re-specified)." In the interpreter, `stallTimeoutMs` is parsed (`:419`) and returned (`:421`)
  but **never read by the drive loop** — there is no per-member stall detection in the interpreter
  at all. The #67 stall watchdog lives in `coordinator.mjs` (member-level), not in this loop. This
  matters because B2 is exactly the consequence of "no per-member stall in the interpreter": a
  dead member has no interpreter-side budget to remove it. The contract should either (a) delete
  the parenthetical, or (b) actually land a per-member stall rule and cite it. As written it
  overstates the field's role.
- **D2.4(b)'s suite-safety reasoning is logically invalid — the quiescence check is LIVE in the
  suite, and its fast floor is tiny.** D2.4(b) asserts "for an actively working roster no member is
  a candidate, so no confirmation poll ever fires." That conflates "active" with
  "recent meaningful event." The predicate is `silenceMs >= windowMs` and in the suite
  `windowMs = max(2 * maxObservedGapMs, 8 * 15 ms) = max(2 * gap, 120 ms)`. A member mid-LLM-
  generation for > 120 ms is a candidate regardless of being mid-turn. The suite backstop
  (`hardCapMs: 3000`) prevents *hangs*; it does NOT prevent a *false declaration* — a false
  `WAVE-QUIESCED` receipt fails the A11/F11/F14 assertions. The contract never gates the quiescence
  check; it argues it away. **Fix:** the cleanest landing is to gate the quiescence check on
  `hardCapMs === null` (quiescence is the *substitute* for the clock, layered only where no clock
  exists). Then the suite (`hardCapMs: 3000`) never runs the quiescence machinery, D2.4(c) is
  trivially true, and the production path is governed by quiescence exactly as D1 intends. This
  also makes A11 robust. Alternatively, gate on `driver.quiescenceEnabled !== false` (OQ3's
  configurable field) and have `LANE_DRIVER` set it `false`.

---

## 4. Attack on D3 — the honesty edge cases

- **D3.1 (quiet mid-harvest): SOUND.** The harvest (`:600`) runs after the drive loop returns and
  after `wave.close()` — no live roster exists mid-harvest. Verified the ordering
  (`preOutcome` `:562-576` → close → harvest). Correct.
- **D3.2 (post-declaration re-wake): SOUND.** The declaration is the loop exit; `wave.close()`
  stops every member (`wave.mjs:451-486`); the preOutcome re-read catches last-instant events. The
  two-race closing is structurally real.
- **D3.3 (stuck-break ordering): SOUND in placement, incomplete for the mix.** Preserved verbatim
  before the quiescence check is correct, and its map to `stuck_handled` → `WAVE-INCOMPLETE` is
  right. But as shown in 2.1, the `.every()` condition means a mixed roster (mid-thought + dead +
  waiting) escapes it and falls to the false quiescence — D3.3's guarantee ("a decision-stuck
  roster is NEVER reported WAVE-QUIESCED") holds only when the whole roster is decision-stuck.
- **D1.4's "survivor worktree state is still harvested" overclaims.** `harvestOne` reads the
  member's committed **result sha** (`git show` at the pin), not the live worktree. A survivor
  whose result sha does not contain the harvest path reports `harvest_miss` (unchanged) — uncommitted
  worktree state is never harvested. The sentence should read "survivor result-shas are still
  harvested," not "worktree state." Minor, but it is the same honesty standard the contract applies
  to itself.

---

## 5. Refusal vocabulary — SOUND

Verified: no new refusal code; the two named evidence lines (`wave_quiesced`,
`wave_terminalized_unrecoverable`) ride the established G7 `steering[]` channel; the exit-report
enum `{ 'pending_empty', 'stuck_handled', 'quiesced', 'terminalized_unrecoverable', 'hard_cap' }`
is closed and complete — it matches every loop exit: pending-empty (loop condition), stuck-break,
hard-cap, the new quiescence, the new unrecoverable-terminal. `hard_cap` correctly remains as the
suite-only exit. The note that a future OQ3 throwing-validation code is deliberately out of this
rung is honest. No blocker.

---

## 6. Acceptance pins — all RED verified; three shallow-greenability notes

All 11 pins assert at RED at HEAD (verified — no quiescence machinery exists; the loop has only the
two exits). A1/A5/A6/A8 shape claims match the current code exactly (e.g., A6's "`normalizeDriver`
has no null branch" is true at `:416-422`; A8's F14 key-set is the `:609-617` receipt). Three
pins need hardening:

- **A2 is shallow-greenable by a bare constant.** The pin asserts a roster with 30 s gaps is not
  quiesced at 30 s and is quiesced at ≥ 60 s. `windowMs = 60 000` (a bare constant) satisfies both
  assertions. The pin must vary the cadence across scenarios (a 10 s-gap roster quiesced at ≥ 20 s;
  a 60 s-gap roster at ≥ 120 s) so a constant cannot pass. As written it does not test "derived
  from the roster's own cadence."
- **A1 is shallow-greenable by a relabel.** A1 asserts the receipt shape, not the predicate. An
  implementation that relabels any `WAVE-INCOMPLETE` (non-`hard_cap`) as `WAVE-QUIESCED` + the
  evidence line would pass A1 while skipping D1.1 entirely. A2-A5 are the predicate pins; A1 should
  be marked shape-only or paired with a no-event counterexample.
- **A7's premise is false at HEAD.** It asserts the check "reads `silenceMs`/`lastProgress.at` from
  the outline `readView` ALREADY fetches" — but `readView` drops them (B3). The pin must assert the
  projected fields exist on the landed `readView` return (or that the landed check does not add a
  second command), not the pre-landing premise.

---

## 7. Open questions — verdicts

- **OQ1 (shared publish not executable): SOUND.** Verified this session: the facade dispatch is
  exactly `run.scratchpad.read` / `run.scratchpad.elevate` (`application.mjs:12522-12523`), no
  append surface; the durable-file fallback is the honest channel. The coordinator brief documents
  it; `foundry-qa` covers it. This row's deliverable likewise publishes to the durable file only.
- **OQ2 (hard-break vs exclude-and-continue): judgment, correctly pinned as hard-break**, with the
  D1.4 "worktree state" overclaim (section 4) corrected. Note the hard-break is what makes B2's
  unreadable-member rule natural to land at the same seam.
- **OQ3 (configurable floor): keep as a module constant by default is acceptable** under the
  no-arbitrary-limits law only because the derivation is documented; but see D2.4 — the suite needs
  the check off, which argues for the driver-field form (`quiescenceEnabled`, or gating on
  `hardCapMs === null`). Recommend the gating-on-null form; it needs no new field.
- **OQ4 (wave-driver 3 h cap): RESOLVED SOUND.** The wave-driver loop is not armed in the
  interpreter path (section 3). The de-clocking is real; leaving the wave-driver default unchanged
  is correct.
- **OQ5 (declaration snapshot vs preOutcome re-read): genuinely open.** The two snapshots can
  disagree; the contract chooses the declaration snapshot for quiescence evidence and preOutcome for
  settlement evidence. That split is defensible but should be pinned in the receipt (a per-outcome
  field naming which snapshot each `lastMeaningfulAt`/`silenceMs` came from) so a reviewer can
  distinguish a last-instant event from the declaration state.

---

## 8. Final verdict — NOT FOLD-READY

**Numbered blockers** (what + why + concrete fix):

1. **B1 — D1.1 can declare WAVE-QUIESCED while a member is mid-thought.** The candidate predicate
   is pure `silenceMs >= windowMs` with a reset set that excludes the #67 liveness kinds
   (`lifecycle.turn_started`, `decision.settled`, `question.answered`, `approval.resolved`); a
   member whose turn produces only noise reads fully silent; the D1.3 confirmation cannot rescue
   (noise does not advance `lastProgress.at`); and the pathological mix (silent-but-alive + dead +
   waiting-on-decision) escapes the stuck-break and false-declares. **Fix:** gate candidacy on
   liveness — a pending member whose `progressClass !== 'silent'` (or whose run is in an active
   turn phase) is never a candidate; add the #67 re-arm kinds to the reset set; and pair the gate
   with B2's terminalization rule so a phase-stuck member still terminates instead of hanging.
2. **B2 — an unreadable member makes quiescence undeclareable → infinite loop under
   `hardCapMs: null`.** `readView` swallows `inspect()` errors → `{ phase: null, terminal: false }`
   → member stays pending; `silenceMs` is `undefined` → never a candidate → the D1.1 "every pending
   member is a candidate" condition can never be satisfied, and D1.4 covers only readable
   unrecoverable terminals. The contract removes the hard cap while keeping the completion control
   non-total. **Fix:** a closed unreadable-member rule — a still-pending member unreadable for N
   consecutive polls is terminalized-unrecoverable (D1.4 exit), so the loop always terminates.
3. **B3 — the landing is under-specified: `readView` does not carry the quiescence fields.** G3's
   "already present in the one poll it already takes" is false at the seam; the landed code must
   extend `readView`'s return with `lastProgress`/`silenceMs`/`progressClass` or add a second
   command (breaking A7/D2.4(a)). **Fix:** name the `readView` projection in the contract and
   anchor D1.1/D1.3 on it.

**Secondary (fold-blocking together with the above, each with the fix in its section):**
D2.4(b)'s suite-safety reasoning is invalid and the quiescence check is live in the suite with a
120 ms floor (gate the check on `hardCapMs === null`); D2.1's `stallTimeoutMs` parenthetical is a
ghost; A2 is greenable by a bare constant; A1 is greenable by a relabel; D1.4 "worktree state"
overclaims (harvest reads result shas).

The `foundry-qa`'s single named hole is confirmed, and this report adds B2 and B3 that its proposed
fix does not close. When B1-B3 land with the secondary fixes, the contract is fold-ready: the
mechanics (loop sentinel, de-clocking, suite backstop, exit vocabulary, D6/F14 preservation) are all
verified sound, and the remaining work is entirely in the honesty of the predicate and the totality
of the completion control.
