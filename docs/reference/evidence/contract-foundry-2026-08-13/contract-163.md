# Issue #163 — de-clock the wave completion: a quiescence-derived end for the interpreter's drive loop

The implementation contract for issue #163: the workflow-as-data interpreter bounds every wave by a
wall clock (`hardCapMs`; the shipped production cadence carries 3h after the #153 repair), and the
campaign control law bans clocks as controls. This contract replaces the clock completion with a
**quiescence-derived completion**: the wave ends when the full (non-terminal) roster produces no
meaningful events across a declared evidence window — a window derived from the roster's OWN event
cadence, never a bare constant — or when a member terminalizes unrecoverably. It is a **Ring-2
contract** (ground truths → decisions → refusal vocabulary → red-first acceptance pins → open
questions). It **specifies behavior**; it does not amend implementation in this artifact. It
mirrors — it does not re-specify — the #67 in-flight-gate liveness machinery (`REARM_KINDS`,
`meaningfulEventAt`, `projectProgressClass`) as the evidence-derived precedent the quiescence
predicate is built on.

- **Date:** 2026-08-13
- **Version:** v1 → **v2 (folded)**. v2 integrates the row red-team (`redteam-163.md`, same dir),
  the review-foundry wave-b QA (`review-qa.md` §2, section 2.4 instruction set), the
  top-orchestrator decision DR-1(a) (hard-break for v1, law), and the operator-facing evidence from
  issue #163. Each fold input is resolved in the `## Fold record` at the end of this file. The
  fold-notes file is `fold-163.md` (same dir).
- **Status:** DRAFT v2 — implementation contract (red-first; no code landed for this rung).
- **Verification HEAD:** `e371f704727cbca5fdff86af31ec8b154620a71f` ("Baton private effective-tree
  snapshot"), the tree this contract (v1 and v2) was verified against. Every `file:line` citation
  below was re-verified this session — once for v1, and again for v2 — with `grep -an`/`sed -n`/
  `Read` at this HEAD, not inherited. The one NUL-bearing file whose anchors are grep/sed-verified,
  never whole-file read: `application.mjs`. `workflow-interpreter.mjs`, `coordinator.mjs`, `wave.mjs`,
  `wave-driver.mjs`, `application-semantics.mjs`, and both red suites were read directly (NUL-free).
- **Brief:** `row-quiescence.md` (same dir) — read fully; `foundry-brief.md` (same dir) — the shared
  frame, read first. Fold frame: `docs/reference/evidence/fold-2026-08-13-b/foundry-brief.md`
  (shared fold frame) and `row-fold-163.md` (row brief). The blind-QA law of the fold frame binds:
  on conflict, `redteam-163.md` governs over the QA cross-check.
- **Scope of the rung, in one sentence:** the interpreter's drive loop loses `hardCapMs` as a
  production control; a wave completes when (a) every remaining member has produced no meaningful
  event across a roster-derived evidence window — a named `WAVE-QUIESCED` verdict with per-member
  last-meaningful-event evidence — or (b) a member terminalizes unrecoverably (hard-break, DR-1(a)),
  or (c) a member is terminalized-unrecoverable by the totality rule (B2); the wall-clock `hardCapMs`
  survives ONLY as the suite's fast-policy backstop.

---

## Ground truths (verified this session)

- **G1 — the drive loop is wall-clock-bounded, and that is the clock being de-clocked.** The loop
  condition is `while (pending.size > 0 && Date.now() - startedAt < driver.hardCapMs)`
  (`workflow-interpreter.mjs:736`); `startedAt` is stamped once the roster is live
  (`:554`). `hardCapMs` is the sole completion control for a roster that never empties
  `pending`. The module default carries a cap: `DEFAULT_DRIVER = Object.freeze({ pollIntervalMs: 15,
  stallTimeoutMs: 400, hardCapMs: 3000 })` (`:414`), and `normalizeDriver` validates
  `pollIntervalMs`/`stallTimeoutMs`/`hardCapMs` as positive safe integers, silently falling back to
  the default on any invalid value (`:416-422`).
- **G2 — the shipped production cadence supplies the 3h clock.** `PRODUCTION_WORKFLOW_DRIVER =
  Object.freeze({ pollIntervalMs: 20_000, stallTimeoutMs: 20 * 60_000, hardCapMs: 3 * 3_600_000 })`
  (`application.mjs:117-119`); the `waves.run` facade defaults to it
  (`return runWorkflow(baton, specOrPath, { repoRoot, driver: request.driver ??
  PRODUCTION_WORKFLOW_DRIVER })`, `:11645`). The wave driver's own default policy carries the same
  3h cap (`DEFAULT_POLICY`, `wave-driver.mjs:35-73`, `hardCapMs: 3 * 3_600_000`) — but it is NOT
  armed in the interpreter path (`createWaveDriver` is invoked only from `recipes.mjs:468`; the
  interpreter path `baton.waves.start` → `startWave` never arms the wave-driver's 3h loop), so the
  de-clocking below is real and not undercut by a hidden 3h teardown (OQ4, RESOLVED SOUND).
- **G3 — the inspect outline ALREADY carries the quiescence data, but the loop's poll does NOT
  project it; the fold names the projection (B3).** `run.inspect` defaults to depth `'outline'`
  (`const request = deepFreeze({ depth: 'outline', ...clone(rawRequest) })`, `application.mjs:10931`).
  The outline block (`:11039-11061`) computes `const timing = this._progressTiming(current, view)`
  (`:11041`) and spreads `...timing` into the outline (`:11052`) — so `outline.lastProgress.at` (the
  member's last meaningful-event timestamp) and `outline.silenceMs` ride every outline — plus
  `progressClass: clone(view.progressClass ?? null)` (`:11061`). The interpreter's `readView`
  (`workflow-interpreter.mjs:428-461`) reads the outline (`try { insp = await handle.inspect(); }`,
  `:436`; `const io = insp?.outline ?? {}`, `:437`) but returns a CLOSED shape —
  `{ phase, actions, attention, taskId, workerId, planDigest, task, terminal, terminalStatus }`
  (`:451-461`) — that DROPS `lastProgress`/`silenceMs`/`progressClass`. So v1's claim that "the
  quiescence check reads fields already present in the one poll it already takes" is an overclaim at
  the seam: the data exists in the outline, the poll does not carry it. **The fold (B3) names the
  `readView` projection extension** — the landed `readView` return adds
  `lastProgress: io.lastProgress ?? null`, `silenceMs: io.silenceMs ?? null`,
  `progressClass: io.progressClass ?? null` — and D1.1/D1.3 anchor on those projected fields. This
  keeps the common poll at ONE command (D2.4(a)/A7).
- **G4 — the meaningful-event semantics (which event kinds reset the quiescence watch).**
  `_progressTiming` computes `lastProgress.at` from the LAST event in the run's coordination log
  that `_followCategory` classifies as meaningful and `_eventBelongsToRun` attributes to the run
  (`application.mjs:8137-8182`, specifically `:8149-8151`), and `silenceMs = terminal ? 0 :
  boundedDuration(observedMs, lastMs)` (`:8179`). `_followCategory`
  (`:8010-8033`) classifies plan/execution/orchestration/context/evidence/result/cleanup/
  integration/recovery/verification kinds as meaningful and EXCLUDES noise telemetry:
  `NOISE_TELEMETRY_OPERATIONAL_KINDS = new Set(['content.tool_call', 'content.message'])`
  (`:85`) — an `evidence.mapped` wrapping a noise kind returns `null`, i.e. NOT meaningful
  (`:8018`). `_eventBelongsToRun` (`:8035`) scopes the log to the run.
- **G5 — the #67 member-level liveness machinery is the precedent to mirror, and it is
  evidence-derived, never clock-derived.** `REARM_KINDS = Object.freeze(['approval.resolved',
  'decision.settled', 'lifecycle.turn_started', 'question.answered'])` (`coordinator.mjs:71-76`);
  `_observeWatchdogEvent` treats everything else as silence:
  `if (!REARM_KINDS.includes(event.kind)) return; // EVERYTHING ELSE IS SILENCE` (`:9382`). The
  run-level analog of the liveness data is `projectProgressClass` (`application.mjs:505-520`),
  which returns `{ class, silenceMs, meaningfulEventAt }` and classes a run `silent` at
  `silenceMs >= PROGRESS_SILENCE_THRESHOLD_MS` (`:516`) — the declared 120 s threshold
  (`PROGRESS_SILENCE_THRESHOLD_MS = 120_000`, `application-semantics.mjs:54`). This contract's
  quiescence law is the WAVE-level form of the same idea: a roster-level liveness/silence bound that
  declares "no evidence of progress," never "too slow."
- **G6 — the loop already removes terminal members from the watch; unrecoverable terminalization is
  detectable at that seam.** `TERMINAL_PHASES = new Set(['work_completed', 'completed',
  'result_ready', 'cancelled', 'failed', 'stopped', 'denied', 'closed'])`
  (`workflow-interpreter.mjs:464`); `isTerminal` includes `v.terminal === true` and
  `terminalStatus === 'completed'` (`:465`); `processMember` deletes a terminal member from
  `pending` (`if (isTerminal(v)) { pending.delete(role); doneRoles.add(role); }`, `:733`). The
  success terminals are `{ work_completed, completed, result_ready }`; the unrecoverable terminals
  are `{ cancelled, failed, stopped, denied }` (`closed` is the post-close phase, not a member's own
  terminal during the drive).
- **G7 — a named `steering[]` evidence line is the established honesty channel.** The
  ≤3-attempt messageOnSpawn budget exhausts to `steering.push({ role, evidence:
  'steering_message_undelivered' })` (`workflow-interpreter.mjs:798`) — an entry keyed by
  `evidence` only, carrying no `trigger`. The quiescence evidence lines ride the same channel.
- **G8 — members are stopped at wave close; post-declaration re-wake is structurally impossible.**
  `wave.close()` calls `entry.run.stop(reason)` for every member (`wave.mjs:451-486`). Once the
  drive loop exits and `wave.close()` runs (after preOutcome capture, `workflow-interpreter.mjs:
  580`), no member can produce a meaningful event.
- **G9 — the D6 receipt is EXACTLY seven keys, sorted; per-member evidence must ride inside
  `outcomes[]`, never as a new top-level field.** The receipt is `{ basis, harvest, manifestDigest,
  outcomes, steering, verdict, waveId }` (`workflow-interpreter.mjs:609-617`), and the F14 suite pin
  asserts `Object.keys(receipt)` equals exactly `['basis','harvest','manifestDigest','outcomes',
  'steering','verdict','waveId']` in ACTUAL sorted order (`workflow-as-data-red.test.mjs:705`). A
  top-level addition breaks F14; per-member last-meaningful-event evidence is an additive field on
  each `outcomes[]` entry (`{ role, phase, terminal, resultSha, report? }`, built at
  `workflow-interpreter.mjs:582-596`).
- **G10 — the suite runs the interpreter on a fast pinned policy and every happy-path row asserts
  members settle.** `LANE_DRIVER = Object.freeze({ pollIntervalMs: 15, stallTimeoutMs: 400,
  hardCapMs: 3000 })` (`workflow-as-data-red.test.mjs:346`, passed at `:453`;
  `worker-orchestrated-swarm-red.test.mjs:77`, passed at `:493,528,566,665,717,767`). The F11/F14
  rows assert every member settles `result_ready` and the receipt is the seven-key D6 shape
  (`workflow-as-data-red.test.mjs:705-717`). No suite row drives a member to an unrecoverable
  terminal phase (verified this session). The quiescence rung must not slow these rows.
- **G11 — the run-level liveness floor (B1's gate).** `projectProgressClass`
  (`application.mjs:505-520`) returns exactly one of `terminal:<cause>`,
  `blocked_interaction:<detail>`, `silent`, `progressing` (precedence: terminal → blocked →
  silent-threshold → progressing). `progressClass !== 'silent'` means the run is mid-life
  (`progressing`), blocked on an interaction, or terminal — in every case it must never be treated
  as quiescent. The reverse is NOT true: `progressClass === 'silent'` is NOT proof the run is dead —
  a member mid-turn whose meaningful silence exceeds the threshold reads `silent` while still
  legitimately turning (the operator-facing evidence: "silence is not even weak evidence of death
  for silent-turnless workers"). That is exactly why the phase gate of D1.1 is the structural fix.
- **G12 — an unreadable member reads `{ phase: null, terminal: false }` and would hang the loop
  without a totality rule (B2).** `readView` swallows every `inspect()`/`status()` throw
  (`workflow-interpreter.mjs:435-436`, `catch { /* the run may be mid-stop */ }`) and returns
  `io = {}` for the member (`:437`), so an unreadable member is `phase: null, terminal: false`,
  `isTerminal` false (`:464-465`), and `silenceMs === undefined`. The runtime already treats
  permanent unreadability as a real path: the preOutcome capture reads each member via `readView`
  and catches with `/* unreadable — settle at close */` (`:567`). At HEAD the hard cap bails the
  loop out of a permanently-unreadable member; the fold removes the cap (D2.1/D2.3) and therefore
  MUST replace the recovery — D1.4's totality rule.
- **G13 — `stallTimeoutMs` is a ghost in the interpreter loop.** `normalizeDriver` parses
  `stallTimeoutMs` (`workflow-interpreter.mjs:419`) and returns it (`:421`) but the drive loop never
  reads it — there is NO per-member stall detection in the interpreter. The #67 stall watchdog is
  member-level in `coordinator.mjs` (`:71-76`, `:9382`), not in this loop. v1's D2.1 parenthetical
  claiming `stallTimeoutMs` "remains the #67 per-member stall budget" overstated the field's role;
  the fold deletes that claim (secondary) and the interpreter-side removal of an unreadable/stuck
  member is the D1.4 totality rule, not `stallTimeoutMs`.

---

## D1 — the quiescence bound

The wave's completion control becomes the roster's own silence, observed across a window derived
from the roster's own event cadence. A wall clock remains ONLY as the suite's backstop (D2).

### D1.1 — the quiescence predicate (which events reset it, and what "quiet" means)

The reset set is the union of TWO event semantics, both cited, not re-specified:

1. **The run-level meaningful-event semantics of G4** — `_followCategory` (`application.mjs:8010-8033`):
   plan, execution, orchestration, context, evidence, result, cleanup, integration, recovery, and
   verification kinds reset a member's quiescence watch; noise telemetry (`content.tool_call` /
   `content.message` wrapped in `evidence.mapped`, `application.mjs:85,8018`) NEVER resets it. A
   member emits its `lastProgress.at` and `silenceMs` on every outline the interpreter already reads
   (G3) and on every projected `readView` (B3).
2. **The #67 liveness re-arm kinds (B1's reset-set extension)** — `lifecycle.turn_started`,
   `decision.settled`, `question.answered`, `approval.resolved` (`REARM_KINDS`, `coordinator.mjs:71-76`)
   ALSO reset a member's quiescence watch. These kinds are NOT `_followCategory`-meaningful (they
   return `null` from `_followCategory`) and do NOT advance `lastProgress.at`; the extension is what
   makes G5's "mirror" claim honest at the run level — the same event set #67 treats as "the member
   is alive" must re-arm the wave-level watch. Because the projected fields are meaningful-event-
   derived, the liveness re-arm is an EVENT-LEVEL reset: the landing must source it from the same
   coordination log `_progressTiming` reads (or a projected `livenessRearmedAt`), while the phase
   gate below is the primary structural protection for a mid-turn member.

- **Member quiescence candidate.** A member still in `pending` is a quiescence candidate at a poll
  IFF **all three** hold:
  - **`silenceMs(role) >= windowMs`**, where `silenceMs` is the projected `readView.silenceMs`
    (0 for a terminal member — but terminal members have already left `pending`, G6) and `windowMs`
    is D1.2; AND
  - **`progressClass(role) === 'silent'`** (B1 — a member whose `progressClass` is `progressing`,
    `blocked_interaction:*`, or `terminal:*` is NEVER a candidate, regardless of `silenceMs`; G11);
    AND
  - **`phase(role) NOT IN ACTIVE_TURN_PHASES`** (B1/H1a — a member whose run is in an active turn
    phase is NEVER a candidate, regardless of `silenceMs`; this is the structural answer to the
    mid-thought false-quiescence AND to the cold-start floor, where the window sits at its floor
    for the entire first turn).
  - **`ACTIVE_TURN_PHASES`** is a new named module-scope set (`workflow-interpreter.mjs`,
    documented derivation): the run phases from which a member can still autonomously reach a
    meaningful event — i.e., `CANONICAL_RUN_PHASES` (`application-semantics.mjs:20-25`) minus the
    terminal set (`APPLICATION_RUN_TERMINAL_PHASES`, `application.mjs:159-161`, plus the
    interpreter's `result_ready`/`closed`, `workflow-interpreter.mjs:464`) minus the operator-gated
    waits (`progressBlockedDetail` non-null, `application.mjs:492-504`). Concretely:
    `{ 'planning', 'queued', 'working', 'uncertain', 'verifying', 'result_selected', 'reviewing',
    'integrating', 'stopping' }`. `paused`/`interrupted` are NOT active-turn (a suspended run cannot
    emit without a resume); they are governed by `progressClass` alone (blocked-on-interaction →
    never a candidate; silent-and-unblocked → candidate). The set is derived, not arbitrary: it is
    the complement of the terminal and operator-gate sets within the canonical phase vocabulary, and
    must stay in sync with any phase-vocabulary change (fold-163.md records the boundary judgment).
- **A member with zero meaningful events since wave start** has `lastProgress.at === startedAt` (the
  `_progressTiming` default, `application.mjs:8158`) and `silenceMs` grows from wave start — that
  member is honestly "quiet across the window" once the three legs hold. The predicate does NOT
  require a prior meaningful event; BUT the honesty line of v1 ("a roster that never got going is a
  quiesced roster") is now qualified by the phase gate (H1a): "never started" and "first turn still
  running" are distinguishable — a member whose run is in an active turn phase is mid-turn, never
  "never got going."
- **Wave quiescence declaration.** The wave is declared quiesced at a poll when EVERY member still
  in `pending` is a quiescence candidate AND the declaration survives the D1.3 confirmation poll. A
  member whose `lastProgress.at` advanced (a new meaningful event landed) OR whose `progressClass`
  flipped from `silent` to non-`silent` (a liveness re-arm or a phase change) between the candidate
  poll and the confirmation poll is NOT quiet — the confirmation fails and the quiescence watch
  resets (the roster re-armed).

### D1.2 — the window is derived from the roster's own cadence, never a bare constant

*Kept as written (QA §2.4).*

`windowMs` is recomputed each poll from what the loop has observed:

```
windowMs = max(
  2 * maxObservedGapMs,                 // cadence term — the roster's own worst observed gap, doubled
  QUIESCENCE_MIN_SILENT_POLLS * pollIntervalMs   // observation floor — an evidence-count bound, not a wall clock
)
```

- `maxObservedGapMs` — the largest delta between consecutive DISTINCT meaningful-event timestamps
  (`lastProgress.at`) observed across ALL members since wave start, aggregated per member. This is
  pure roster-derived evidence: once a member has been seen to produce meaningful events 30 s apart,
  it is not quiescent until 60 s of silence (2× its own worst observed cadence). A member with a
  single meaningful event contributes no delta; a member with none contributes none — the cadence
  comes from the members that have produced, and the floor below covers the observation start.
- `QUIESCENCE_MIN_SILENT_POLLS` — a new named constant (module scope, `workflow-interpreter.mjs`,
  documented derivation): the number of consecutive silent polls that must be observed before a
  quiescence declaration may legally be attempted. It is an **evidence-count bound** (the loop must
  sample the roster silent N times), NOT a wall-clock control: `QUIESCENCE_MIN_SILENT_POLLS ×
  pollIntervalMs` is expressed through the driver's own sampling cadence. **Derivation:** it must
  exceed the confirmation-poll pair (D1.3 requires two consecutive all-quiet polls) and give the
  cadence tracker at least a few polls over which to observe inter-event gaps. The value 8 is the
  contract's default; it is configurable on the driver (`quiescenceMinPolls`) so a caller
  can tighten/loosen the observation floor without touching the cadence law (OQ3 resolves the
  config form: keep the module constant by default; the quiescence CHECK itself is gated on
  `hardCapMs === null` per D2.4, which needs no new driver field).
- The cadence term DOMINATES once observed: the floor exists solely so the first declaration is
  legally attempted only after the tracker has samples to observe — it is never the completion
  control for a roster that has produced events. No wall-clock constant enters the window.

### D1.3 — the confirmation poll (the declaration race)

*Kept as written (QA §2.4), anchored on the projected fields (B3).*

A quiescence declaration is a two-poll event. When the candidate check passes, the loop does NOT
break immediately: it performs one confirmation poll (a fresh `readView` of every still-pending
member — the same single-command poll it always takes, G3/B3) and declares quiescence IFF, on that
poll, (a) every still-pending member is STILL a quiescence candidate under the D1.1 three-leg
predicate — `silenceMs >= windowMs`, `progressClass === 'silent'`, phase not in `ACTIVE_TURN_PHASES`
— (b) no member's `lastProgress.at` advanced since the candidate poll, and (c) no member
terminalized unrecoverably in between. If any leg fails, the loop continues (the roster re-armed;
the cadence tracker keeps the now-larger observed gaps). The confirmation bounds the read-to-break
race: an event landing between the candidate poll and the confirmation poll is caught by the
confirmation's re-read; an event landing after the second poll is caught by the preOutcome capture
(`workflow-interpreter.mjs:562-576`, which re-reads each member before `wave.close`) — and after
`wave.close` no member can emit (G8). A mid-thought member emitting ONLY noise between the two
polls does NOT advance `lastProgress.at`, but it DOES fail leg (a) via the phase/progressClass gate
— the confirmation is honest for noise-only liveness too (B1).

### D1.4 — unrecoverable terminalization ends the loop promptly (hard-break, DR-1(a)) + the totality rule (B2)

**Hard-break (law, DR-1(a)).** If, at any poll, a member terminalizes with an unrecoverable phase —
`{ cancelled, failed, stopped, denied }` (G6) — the loop breaks immediately. The wave cannot reach
WAVE-OK (that member's harvest path has no result sha), so continuing to run the surviving members
spends compute on a wave whose harvest is already known incomplete; their **already-written result
shas** are still harvested (D3.1). This exit is distinct from the success-terminal path (a
`result_ready`/`work_completed`/`completed` member merely leaves `pending`, and the wave continues
toward the remaining roster). The top-orchestrator decision DR-1(a) pins hard-break for v1;
**exclude-and-continue is a NAMED FOLLOW-ON RUNG** whose spec should pin survivor-harvest semantics
— the fold records the 2026-08-13 evidence for it in the `## Fold record`.

**The totality rule (B2, replaces the removed hard-cap bail-out).** The completion control must be a
total function over the state space now that `hardCapMs: null` removes the clock. A still-pending
member is terminalized-unrecoverable — the loop breaks via THIS D1.4 exit, `wave_terminalized_
unrecoverable` is pushed, the survivors are stopped, and the receipt is `WAVE-INCOMPLETE` over the
`manifestDigest` basis — when, for **N consecutive polls**, the member is NOT a quiescence candidate
for a liveness-stall reason:

- **(a) unreadable** — its `readView` returns no phase and no terminal (`{ phase: null, terminal:
  false }`, G12): the member cannot even be read, so it can never satisfy the candidate predicate
  and would otherwise hold the roster open forever. This is the closed unreadable-member rule B2
  demands.
- **(b) phase-stuck** — its outline phase is in `ACTIVE_TURN_PHASES` while `progressClass ===
  'silent'` and neither `phase`, `lastProgress.at`, nor `progressClass` advanced across those N
  polls: the B1 liveness gate correctly makes it a never-candidate, so without this rule it would
  hang (B1's pairing requirement — the liveness gate and the terminalization rule are ONE design).

`N` is the **confirmation pair + 1 = 3** — an evidence-count derived from the D1.3 structure (the
loop must have sampled the stall N times), the same law as the window floor, never a wall clock. It
is configurable on the driver alongside `quiescenceMinPolls`. A member with `progressClass =
blocked_interaction:*` is NOT covered by this rule — it is neither silent nor phase-stuck; it is
waiting on an operator interaction (a live member whose decision could settle at any moment), and
the wave continues to wait for it. The stuck-decision break (D3.3) handles the handled-decision
sub-case; a genuine operator wait is a wave-level wait, not a stall (fold-163.md records this
boundary as a judgment call).

### D1.5 — the honest verdict shape (NOT WAVE-INCOMPLETE-by-clock)

`driveLane` returns a closed exit-report (it currently returns nothing); `runWorkflow` maps it to
the verdict:

- `driveLane` returns `{ exit: 'quiesced', perRole }` where `perRole[role] = { lastMeaningfulAt,
  silenceMs, progressClass }` is the last-poll snapshot for every member that was still in `pending`
  at declaration. For the other exits it returns `{ exit: 'pending_empty' | 'stuck_handled' |
  'terminalized_unrecoverable' | 'hard_cap' }`.
- `exit === 'quiesced'` → **`verdict: 'WAVE-QUIESCED'`, `basis: 'quiesced'`** — the named
  quiescence verdict the brief demands, NOT a clock-flavoured WAVE-INCOMPLETE. `runWorkflow` pushes
  the named evidence line `steering.push({ evidence: 'wave_quiesced' })` (the G7 channel, no
  `trigger`), and merges each member's `lastMeaningfulAt`/`silenceMs`/`progressClass` into its
  `outcomes[]` entry as additive fields — the D6 receipt stays EXACTLY the seven sorted keys
  (G9/F14).
- `exit === 'terminalized_unrecoverable'` → `verdict: 'WAVE-INCOMPLETE'`, `basis: manifestDigest`
  (unchanged), plus `steering.push({ role: <role>, evidence: 'wave_terminalized_unrecoverable' })`.
  This covers BOTH the hard-break on a readable unrecoverable terminal (D1.4 first paragraph) and
  the totality-rule terminalization of an unreadable/phase-stuck member (D1.4 second paragraph).
- `exit === 'pending_empty' | 'stuck_handled' | 'hard_cap'` → the existing computation verbatim
  (`everySettled && everyHarvested ? 'WAVE-OK' : 'WAVE-INCOMPLETE'`, `workflow-interpreter.mjs:
  602-605`). `hard_cap` cannot fire in production once D2 lands (the production driver is uncapped);
  it remains the suite backstop's exit.
- **The verdict is the exit's honest consequence, never a downgrade.** A quiesced wave is reported
  `WAVE-QUIESCED` with `basis 'quiesced'` regardless of `everySettled`/`everyHarvested` — the
  harvest entries that missed are reported as `harvest_miss` (unchanged), but the VERDICT names the
  reason the wave stopped, which is quiescence, not a miss.

---

## D2 — the migration

### D2.1 — the shipped cadence becomes quiescence-governed

`PRODUCTION_WORKFLOW_DRIVER` (`application.mjs:117-119`) becomes:

```js
const PRODUCTION_WORKFLOW_DRIVER = Object.freeze({
  pollIntervalMs: 20_000, stallTimeoutMs: 20 * 60_000, hardCapMs: null,
});
```

`hardCapMs: null` is the explicit **uncapped sentinel**: no wall-clock completion bound. The drive
is completed by D1 (quiescence), the D1.4 hard-break, and the D1.4 totality rule (B2). `pollIntervalMs`
and `stallTimeoutMs` stay in the driver shape for compatibility, but their roles are stated
honestly (secondary — v1's `stallTimeoutMs` parenthetical is deleted): `pollIntervalMs` is the
sampling rhythm the window floor is expressed through (D1.2); `stallTimeoutMs` is parsed and
returned but NEVER read by the drive loop (G13) — the #67 per-member stall watchdog is
member-level in `coordinator.mjs` (`:71-76`, `:9382`), cited not re-specified, and the
interpreter-side removal of an unreadable/stuck member is the D1.4 totality rule, not this field.

### D2.2 — `normalizeDriver` and the loop condition learn the sentinel

*Kept as written (QA §2.4).*

`normalizeDriver` (`workflow-interpreter.mjs:416-422`) must treat `hardCapMs === null` as an
explicit "no wall-clock bound" value (valid, distinct from `undefined`, which still falls back to
the default); a non-null value stays a positive safe integer. The loop condition
(`:736`) must honor the sentinel — a bare `Date.now() - startedAt < driver.hardCapMs` evaluates
`number < null` to `false` and would exit immediately, so the condition becomes:

```js
while (pending.size > 0 && (driver.hardCapMs === null || Date.now() - startedAt < driver.hardCapMs))
```

### D2.3 — the module default and the wave-driver default follow

`DEFAULT_DRIVER` (`workflow-interpreter.mjs:414`) becomes quiescence-governed
(`hardCapMs: null`) — the interpreter's own no-clock default, matching the production posture for
callers that do not pass a driver. `wave-driver.mjs`'s `DEFAULT_POLICY.hardCapMs`
(`:35-73`) is the wave driver's own cadence for the underlying wave machinery; it is left unchanged
in this rung (the interpreter's quiescence is the completion control; the wave-driver's 3h cap is
not the interpreter's loop clock) — OQ4 is RESOLVED SOUND: the wave-driver loop is never armed in
the interpreter path (`createWaveDriver` → `recipes.mjs:468` only), so the de-clocking is real.

### D2.4 — the suite-only backstop stays, the check is gated on `hardCapMs === null`, and the suite must not slow

The two red suites keep their fast pinned policy unchanged: `LANE_DRIVER` with `hardCapMs: 3000`
(`workflow-as-data-red.test.mjs:346`, `worker-orchestrated-swarm-red.test.mjs:77`). This is the
suite-only wall-clock backstop — the guarantee that a quiescence-machinery regression can never hang
the suite. The rung does not touch it.

**The quiescence check runs ONLY where no clock exists (secondary — v1's D2.4(b) reasoning is
replaced).** v1 argued the suite could not false-declare because "for an actively working roster no
member is a candidate" — that conflated "active" with "recent meaningful event" and was logically
invalid: in the suite `windowMs = max(2 * maxObservedGapMs, 8 * 15 ms) = max(2 * gap, 120 ms)`, so
a member mid-LLM-generation for > 120 ms is a candidate by the bare predicate regardless of being
mid-turn, and a false `WAVE-QUIESCED` receipt would fail the A11/F11/F14 assertions. **The fold
gates the quiescence check on `driver.hardCapMs === null`** — quiescence is the *substitute* for the
clock, layered only where no clock exists. The suite (`hardCapMs: 3000`) therefore NEVER runs the
quiescence machinery; the 120 ms floor concern is moot because the check is not live in the suite;
D2.4(c) is trivially true; and A11 is robust. This is the recommended landing (gating-on-null needs
no new driver field — OQ3's configurability resolves to this).

**Why the suite does not slow.** (a) The quiescence check reads the projected
`silenceMs`/`lastProgress.at`/`progressClass` fields from the outline `readView` ALREADY fetches in
the common poll (G3/B3) — no second command is added to the happy path. (b) The check itself is
gated off entirely under `LANE_DRIVER` (see above) — the suite never even evaluates the predicate.
(c) The only new work is O(roster) in-memory cadence bookkeeping per poll and, in a genuinely quiet
production wave, the single confirmation re-read (a poll of the same cost as any other). The fast
cadence (15 ms) and the 3000 ms backstop are unchanged (F11).

---

## D3 — the honesty edge cases

### D3.1 — a roster that goes quiet mid-harvest

The harvest (`spec.harvest.paths.map((entry) => harvestOne(...))`, `workflow-interpreter.mjs:600`)
runs AFTER the drive loop returns and AFTER `wave.close()` — members are already stopped (G8), so
there is no live roster to "go quiet" mid-harvest. The quiescence path is: drive loop declares
`WAVE-QUIESCED` → preOutcome capture reads each member's last outline (the `perRole` snapshot is
taken from the declaration poll, and the preOutcome re-read catches any last-instant event) →
`wave.close()` stops the members → harvest reads the settled `resultShas`. A quiet roster with
partial results is reported honestly: `WAVE-QUIESCED`, `basis 'quiesced'`, per-member
`lastMeaningfulAt`/`silenceMs`/`progressClass` in `outcomes[]`, and the harvest entries that found
no sha reported as `harvest_miss` exactly as today (a quiesced verdict is not downgraded to
WAVE-INCOMPLETE by a miss — D1.5). **Honesty fix (secondary):** the harvest reads each member's
committed **result sha** (`git show` at the pin), never the live worktree — a survivor whose result
sha does not contain the harvest path reports `harvest_miss` (unchanged). "Survivor worktree state
is still harvested" overclaimed; the correct claim is **survivor result-shas are still harvested**.

### D3.2 — can a member re-wake after quiescence is declared? **No — and the race is closed twice.**

- **Before the declaration completes:** a member re-waking during the D1.3 confirmation window (a
  new meaningful event advancing `lastProgress.at`, OR a `progressClass` flip out of `silent` — a
  liveness re-arm or a phase change) FAILS the confirmation — the wave is not declared quiesced, the
  watch resets, and the loop continues. This is the declaration race guard, now liveness-aware
  (B1).
- **After the declaration:** the declaration IS the loop exit. `runWorkflow` then captures
  preOutcome and calls `wave.close()`, which stops every member (`wave.mjs:451-486`); a member
  cannot produce a meaningful event after close (G8). An event that would have landed in the gap
  between the declaration poll and the close is caught by the preOutcome re-read
  (`workflow-interpreter.mjs:562-576`) and reflected in that member's outcome — and the quiescence
  verdict honestly reports the last-observed snapshot. The contract pins: **a member cannot re-wake
  after quiescence is declared**; the declaration is a terminal loop exit, and the machinery that
  makes it honest is the confirmation (D1.3) plus the preOutcome capture (G8).
- **The operator-facing honesty law (issue #163).** Silence is not even weak evidence of death for
  silent-turnless workers — a worker whose turns emit only noise (`lifecycle.turn_started`, tool
  calls, messages — none `_followCategory`-meaningful, G4/G11) reads fully silent for the whole
  turn, and a turn can be longer than the derived window (D1.2). B1's liveness gate — never
  candidate while `progressClass !== 'silent'` or in an active turn phase — is the STRUCTURAL answer
  to that class of false quiescence; the reset-set extension (D1.1) is the event-level mirror. The
  D3.2 re-wake law is about events AFTER declaration, and is distinct from mid-turn silence: the
  two-race closing means the declaration can never be reached while a member is mid-turn, and once
  reached, nothing can re-wake the roster.

### D3.3 — the stuck-decision early-break's place in the new law

The existing early-break — every remaining member stuck on a decision the policy already handled
(deferred/refused) → `break` (`workflow-interpreter.mjs:753-757`) — is preserved verbatim and is
evaluated BEFORE the quiescence check each poll. It is the fast, decision-specific exit: a
decision-stuck roster is NOT evidence-quiet (its members may still be turning), so quiescence would
not fire for it; the stuck-break names the real cause. Its exit is `stuck_handled`, mapping to the
existing `WAVE-INCOMPLETE` over the `manifestDigest` basis (D1.5) — a decision-stuck roster is
reported INCOMPLETE for cause, NEVER `WAVE-QUIESCED`. **Honesty fix (B1's mixed-roster note):** that
guarantee holds exactly for a whole-roster decision-stuck state — the `.every()` condition means a
MIXED roster (mid-thought + dead-but-readable + waiting-on-decision) escapes the stuck-break. Under
v1 that mix fell to a false quiescence; under v2 it does NOT: the mid-thought member fails the
candidate predicate via `progressClass`/phase (B1), the dead-but-readable member either reads as a
terminal (D1.4 hard-break) or as silent-and-candidate (D1.1), and the waiting-on-decision member is
`blocked_interaction:*` — never a candidate (G11). A mixed roster therefore continues driving, and
terminates via the D1.4 totality rule if a member is unreadable or phase-stuck (B2). The per-poll
order becomes: process members → unrecoverable-terminal check + totality rule (D1.4) → stuck-decision
break (existing) → quiescence candidate + confirmation (D1.1/D1.3) → sleep.

---

## Refusal vocabulary

The quiescence rung introduces NO new refusal code. It adds two **named evidence lines** (the G7
channel), and the exit-report sentinel is a closed enum:

| Code / value | Kind | Source | Context |
|---|---|---|---|
| `{ evidence: 'wave_quiesced' }` | named evidence line | new (`steering[]`) | Pushed by `runWorkflow` when `driveLane` exits `'quiesced'` — the G7 sibling of `steering_message_undelivered` (`workflow-interpreter.mjs:798`). |
| `{ role, evidence: 'wave_terminalized_unrecoverable' }` | named evidence line | new (`steering[]`) | Pushed by `runWorkflow` when a member terminalizes unrecoverably (D1.4 hard-break) OR is terminalized-unrecoverable by the totality rule (D1.4, B2). |
| `{ exit }` | closed enum | new (`driveLane` return) | `exit ∈ { 'pending_empty', 'stuck_handled', 'quiesced', 'terminalized_unrecoverable', 'hard_cap' }` — a closed set, never a free string. |
| `workflow_spec_invalid` etc. | reused codes | `workflow-interpreter.mjs:29-33` | The existing admission-time refusals are unchanged — the quiescence machinery refuses nothing new. |

The closed vocabulary above is complete: two named evidence lines plus the exit-report enum. The
exit-report enum is the contract's vocabulary for WHY the loop ended; the evidence lines make the
reason legible in the receipt without a new verdict-field grammar. The totality rule (B2) reuses the
existing `wave_terminalized_unrecoverable` line and the `terminalized_unrecoverable` exit — it adds
no vocabulary. Should OQ3's configurability later resolve to a THROWING validation (rather than the
silent fallback), the new code would be named in that resolution — it is deliberately NOT part of
this rung's vocabulary today.

---

## Red-first acceptance pins

RED = fails at HEAD (`e371f704727cbca5fdff86af31ec8b154620a71f`); GREEN = passes after this
contract's rung lands. Each pin asserts behavior, not implementation. Pins amended by the fold are
marked; A12/A13 are new.

| Pin | Assertion | At HEAD |
|---|---|---|
| A1 *(amended — shape-only, paired with a predicate counterexample)* | A wave whose full roster goes quiet (no meaningful event across the derived window, AND every member `progressClass === 'silent'`, AND no member in an active turn phase) receipts `verdict: 'WAVE-QUIESCED'`, `basis: 'quiesced'`, and a `steering[]` entry `{ evidence: 'wave_quiesced' }`. **Counterexample (kills relabel-greenability):** a wave whose ONLY remaining member is mid-turn (`progressClass !== 'silent'` or phase in `ACTIVE_TURN_PHASES`) with the rest quiet is NOT declared `WAVE-QUIESCED` — the D1.1 predicate must be live, not relabeled. | **RED** — the loop has no quiescence exit; the verdict enum is only `WAVE-OK`/`WAVE-INCOMPLETE` (`workflow-interpreter.mjs:604`). |
| A2 *(amended — cadence must vary across scenarios)* | The quiescence window is derived from the roster's own event cadence (`max(2 * maxObservedGapMs, QUIESCENCE_MIN_SILENT_POLLS * pollIntervalMs)`), never a bare constant: a roster observed to produce events **10 s apart is NOT quiesced at 10 s of silence, only at ≥ 20 s**; a roster observed at **60 s gaps is NOT quiesced at 60 s, only at ≥ 120 s**; a roster observed at **30 s gaps is NOT quiesced at 30 s, only at ≥ 60 s**. A bare constant cannot satisfy all three. | **RED** — no window machinery exists at all. |
| A3 *(amended — projected fields + reset-set union)* | The quiescence predicate resets on a run-level meaningful event per `_followCategory` (`application.mjs:8010-8033`) OR on a #67 liveness re-arm kind (`lifecycle.turn_started`/`decision.settled`/`question.answered`/`approval.resolved`, `coordinator.mjs:71-76`); noise telemetry (`content.tool_call`/`content.message`, `application.mjs:85,8018`) never resets it; a member with zero meaningful events since wave start is honestly "quiet across the window" once the three D1.1 legs hold (silence, `progressClass === 'silent'`, phase not active). | **RED** — no predicate exists. |
| A4 *(amended — liveness flip fails the confirmation)* | The declaration is a two-poll event: a member whose `lastProgress.at` advances OR whose `progressClass` flips out of `silent` between the candidate poll and the confirmation poll fails the declaration and the wave continues (the re-arm race is closed, meaningfully AND via liveness kinds). | **RED** — no confirmation poll exists. |
| A5 *(amended — "survivor result-shas")* | A member terminalizing unrecoverably (`cancelled`/`failed`/`stopped`/`denied`) ends the loop at that poll with `WAVE-INCOMPLETE` over the `manifestDigest` basis and the `wave_terminalized_unrecoverable` evidence line; the survivor **result-shas** are still harvested (`harvestOne` reads the committed result sha via `git show` at the pin, never the live worktree). | **RED** — a failed member merely leaves `pending` (`:733`); the loop waits for the rest or the hard cap. |
| A6 | `PRODUCTION_WORKFLOW_DRIVER` ships without a wall-clock completion control (`hardCapMs: null` sentinel); `normalizeDriver` accepts `null`; the loop condition honors the sentinel (`number < null` never exits the loop early). | **RED** — `application.mjs:117-119` still ships `hardCapMs: 3 * 3_600_000`; `normalizeDriver` has no null branch; `:736` would mis-evaluate the sentinel. |
| A7 *(amended — asserts the landed projection)* | The landed `readView` return projects `lastProgress`/`silenceMs`/`progressClass` from the outline (B3) so the check reads fields from the SAME single-command poll it already takes (G3) — the common poll stays ONE command, the `needStatus` gate is unchanged, and no happy-path row waits out the quiescence window. | **RED** — no quiescence check exists; `readView` (`:451-461`) drops the fields the pin's premise requires. |
| A8 | A roster quiet mid-harvest receipts honestly: `WAVE-QUIESCED` with per-member `lastMeaningfulAt`/`silenceMs`/`progressClass` additive fields riding `outcomes[]`, harvest entries that miss reported `harvest_miss`, and the D6 receipt key-set EXACTLY `['basis','harvest','manifestDigest','outcomes','steering','verdict','waveId']` (F14, `workflow-as-data-red.test.mjs:705`). | **RED** — no quiescence receipt exists; `WAVE-QUIESCED` is not in the enum. |
| A9 | Post-declaration re-wake is impossible: the declaration is the loop exit, `wave.close()` stops every member (`wave.mjs:451-486`), and any last-instant event is caught by the preOutcome re-read (`workflow-interpreter.mjs:562-576`). | **RED** — no declaration machinery exists (members are stopped at close today, but nothing asserts the re-wake law). |
| A10 | The stuck-decision early-break (`:753-757`) is preserved, evaluated BEFORE the quiescence check, and maps to `stuck_handled` → `WAVE-INCOMPLETE`/`manifestDigest` — a decision-stuck roster is NEVER reported `WAVE-QUIESCED`. A MIXED roster (mid-thought + dead + waiting) does NOT false-declare: the mid-thought member is never a candidate (B1). | **RED** — the early-break exists but the quiescence check it must precede does not; the ordering is unenforced. |
| A11 *(amended — the suite never runs the quiescence machinery)* | The two red suites pass on the byte-identical `LANE_DRIVER` (`hardCapMs: 3000`), every happy-path row exits via `pending.size === 0` and receipts `WAVE-OK`, and NO suite row runs the quiescence machinery at all — the check is gated on `hardCapMs === null` (D2.4), so the suite backstop (3000 ms) is the only completion control it sees, untouched (F11). | **RED** — quiescence machinery absent; the pin asserts the LANDED state preserves the fast policy AND the null-gate. |
| A12 *(new — totality, B2)* | The completion control is total: a still-pending member whose `readView` returns no phase and no terminal for N = confirmation-pair + 1 consecutive polls (unreadable, G12), OR whose phase is in `ACTIVE_TURN_PHASES` while `progressClass === 'silent'` with no phase/progress advance for N consecutive polls (phase-stuck, B1 pairing), is terminalized-unrecoverable via the D1.4 exit — `wave_terminalized_unrecoverable`, survivors stopped, receipt `WAVE-INCOMPLETE`. The drive loop terminates for every member state, with no clock. | **RED** — no totality rule exists; an unreadable member holds `pending` forever (`:733`) under `hardCapMs: null`. |
| A13 *(new — null-gating)* | The quiescence check evaluates ONLY when `driver.hardCapMs === null` (the no-clock sentinel); under `LANE_DRIVER.hardCapMs: 3000` the predicate is never evaluated, so the suite's 120 ms floor (D2.4, v1's invalid (b) claim) can never produce a false `WAVE-QUIESCED` in a suite row. | **RED** — no quiescence check exists and no gate exists. |

---

## Open questions

- **OQ1 — the `shared` scratchpad publish is not executable at this HEAD; the durable file is the
  only channel.** The frame requires publishing the final draft to the `shared` scratchpad partition
  (`foundry-brief.md:23-24`; `messageOnSpawn`, `workflow.json:45`). Verified THIS session: the
  agent-facing scratchpad surface at HEAD has READ and ELEVATE only — `grep -rn
  "run.scratchpad.append|run_scratchpad_append|scratchpad_append"` across `impl/` returns nothing,
  and the facade dispatch is exactly `run.scratchpad.read` / `run.scratchpad.elevate`
  (`application.mjs:12522-12523`). The internal worker write lane (`writeScratchpad`, the #33
  machinery) requires a worker run handle + live fence this session does not possess. The surface
  write verb is itself what the sibling #158 contract is drafting — RED at this HEAD. The coordinator
  brief documents the durable-file fallback — "fall back to the durable files `contract-<issue>.md`
  in this dir only where the shared post is absent — note which" (`coordinator-brief.md:12-13`) —
  and that fallback is this file. The gap is recorded so the coordinator can note it in
  `foundry-qa.md` rather than treat `shared` as authoritative. **Verdict (red-team §7): SOUND.**
- **OQ2 — unrecoverable terminalization: hard-break vs. exclude-and-continue. RESOLVED by DR-1(a)
  (top-orchestrator decision, law): hard-break for v1.** The first `cancelled/failed/stopped/denied`
  member stops the wave and harvests already-written result shas (D1.4) — deterministic and matching
  the receipt's `manifestDigest` basis. **Exclude-and-continue is a NAMED FOLLOW-ON RUNG**, and the
  fold records today's evidence for it: this campaign's foundries delivered through dead/limp
  members only because the current interpreter effectively continues (four complete suites outlived
  a premature coordinator verdict on 2026-08-13). The follow-on's spec should pin survivor-harvest
  semantics — which survivors are harvested, how their in-flight (unwritten) work is counted, and
  how the verdict reconciles a partially-harvested wave. Hard-break's adoption of the totality rule
  (B2) is natural at the same D1.4 seam.
- **OQ3 — the window floor's configurability. RESOLVED: keep as a module constant by default; gate
  the CHECK on `hardCapMs === null`.** `QUIESCENCE_MIN_SILENT_POLLS` (default 8) stays the
  evidence-count floor in D1.2, with its documented derivation (8 = > the confirmation pair of 2,
  plus room for the cadence tracker to observe gaps). The suite's need to never run the quiescence
  machinery is met by the D2.4 null-gate, which needs NO new driver field — the driver-field option
  (`quiescenceEnabled`) is recorded but not adopted. The totality-rule `N` (confirmation pair + 1 =
  3) is likewise an evidence-count, configurable on the driver alongside the floor.
- **OQ4 — `wave-driver.mjs`'s own 3h `DEFAULT_POLICY.hardCapMs`. RESOLVED SOUND.** The wave driver's
  underlying policy (`wave-driver.mjs:35-73`) carries its own `hardCapMs: 3 * 3_600_000`, but the
  wave-driver loop is NOT armed in the interpreter path (`createWaveDriver` → `recipes.mjs:468`
  only; the interpreter path `baton.waves.start` → `startWave` never arms it). The de-clocking is
  real and not undercut by a hidden 3h teardown; leaving the wave-driver default unchanged is
  correct.
- **OQ5 — the preOutcome re-read vs. the declaration snapshot. Kept open but pinned.** For a quiesced
  wave, per-member `lastMeaningfulAt`/`silenceMs`/`progressClass` come from the declaration poll's
  snapshot (the quiescence evidence), while the preOutcome capture (`workflow-interpreter.mjs:
  562-576`) re-reads each member before `wave.close` (the settlement evidence). The two can disagree
  (a member emitted between the declaration and the preOutcome read). The fold pins the split: the
  declaration snapshot is authoritative for the quiescence evidence (named per-outcome as
  `quiescenceLastMeaningfulAt`/`quiescenceSilenceMs`), and preOutcome remains settlement evidence —
  a reviewer can distinguish a last-instant event from the declaration state. A single merged
  snapshot remains a possible follow-on.

---

## Cross-references

- **`row-quiescence.md`** (same dir) — the row brief: D1 quiescence bound / D2 migration / D3
  honesty edge cases.
- **`foundry-brief.md`** (same dir) — the shared frame: Ring-2 form, no clocks, verified citations,
  publish-as-you-go, escalation posture.
- **`redteam-163.md`** (same dir) — the row red-team: B1 (§2.1), B2 (§2.2), B3 (§2.3), D2 attacks
  (§3), pins (§6), OQ verdicts (§7), final verdict (§8). All blockers and secondaries folded into
  v2; the `## Fold record` maps each.
- **`fold-163.md`** (same dir) — the fold notes: the attempt line, the blocker→resolution map, the
  judgment calls (the `ACTIVE_TURN_PHASES` boundary incl. `paused`/`interrupted`; the
  `blocked_interaction` non-totality boundary), and the fold record of the DR-1(a) evidence.
- **#67 stall-watchdog** (`stall-watchdog-2026-08-07/`, `coordinator.mjs:71-76,9382`) — the
  member-level liveness machinery this contract mirrors at the wave level; `REARM_KINDS`
  (`coordinator.mjs:71-76`), `PROGRESS_SILENCE_THRESHOLD_MS` (`application-semantics.mjs:54`),
  `projectProgressClass` (`application.mjs:505-520`).
- **#114 workflow-as-data interpreter** — `workflow-interpreter.mjs` (the file being de-clocked);
  the D6 receipt shape and F14 key-set pin (`workflow-as-data-red.test.mjs:705`).
- **#153 repair** — the 3h production cadence (`application.mjs:117-119`) this contract's D2.1
  changes.
- **`stall-watchdog-2026-08-07/suite-67-brief.md`** — the control-law line verbatim: "a
  slow-but-productive worker is NEVER declared stalled; no bound fires on elapsed time without an
  evidence check" — the law D1.1/D1.2 implement for the wave. The D1.1 liveness gate is the wave-level
  form of that law.

## Campaign-law constraints

- **No clocks.** The wall-clock `hardCapMs` is removed as a production control (D2.1); the
  quiescence window is derived from the roster's own event cadence (D1.2), never a bare constant;
  the floor is an evidence-count bound expressed through the driver's own sampling cadence. The
  suite-only `hardCapMs: 3000` backstop (D2.4) is a test guardrail, not a workflow control. The
  totality rule (D1.4, B2) is an evidence-count of failed polls (N = the confirmation pair + 1), the
  same law as the window floor — never a clock.
- **No arbitrary numeric limits.** `QUIESCENCE_MIN_SILENT_POLLS` (8) and the totality rule's `N` (3)
  are the new named constants; each has a documented evidence-count derivation (OQ3; D1.4) and both
  are configurable on the driver — observation/sampling bounds, never completion controls derived
  from an ungrounded number.
- **No redesign of landed SOUND law.** The stuck-decision early-break (`:753-757`) is preserved; the
  meaningful-event semantics (`_followCategory`) and the #67 liveness machinery are cited, not
  re-litigated (the reset-set union ADDS the #67 re-arm kinds — a mirror, not a re-specification);
  the D6/F14 receipt shape is preserved (G9).
- **Ring-2 form.** This contract specifies behavior; it does not amend implementation. Every
  `file:line` citation was verified at HEAD `e371f704` this session for both v1 and v2.
- **Deliverable boundary.** The sole deliverables are
  `docs/reference/evidence/contract-foundry-2026-08-13/contract-163.md` (this file, v2) and
  `docs/reference/evidence/contract-foundry-2026-08-13/fold-163.md` (the fold notes). Work was
  confined to `docs/reference/evidence/contract-foundry-2026-08-13/**`. No source files were
  modified.

---

## Fold record (v2)

Folded 2026-08-13 at verification HEAD `e371f704` from `redteam-163.md` (the row report — binding
under the blind-QA law, governing on conflict), `review-foundry-2026-08-13-b/review-qa.md` §2.4
(the QA instruction set), the top-orchestrator decision DR-1(a) (law), and the operator-facing
evidence from issue #163 (the campaign-level copy in `row-fold-163.md`). Each item resolves to
exactly one of **FOLDED** (integrated into the contract body), **KEPT** (verified sound / already
correct as written), or **ESCALATED** (decision made at the authority class and recorded). The
fold-notes file is `fold-163.md` (attempt line `[attempt: 31545279-5f3c-49ad-809b-2492a09b0efc
row-fold163]`).

| # | Fold input | Resolution |
|---|---|---|
| 1 | **B1** (redteam §2.1) — mid-thought false-quiescence: candidate predicate is pure `silenceMs >= windowMs` with a reset set excluding the #67 liveness kinds; a member whose turn emits only noise reads silent; the pathological mix (silent-but-alive + dead + waiting) escapes the stuck-break and false-declares. | **FOLDED** — D1.1 candidate predicate is now three legs: `silenceMs >= windowMs` AND `progressClass === 'silent'` AND phase not in the new named `ACTIVE_TURN_PHASES` set; the reset set is the union of `_followCategory`-meaningful kinds AND `REARM_KINDS` (`lifecycle.turn_started`/`decision.settled`/`question.answered`/`approval.resolved`); D1.3's confirmation is liveness-aware (a `progressClass` flip fails it); G11 records the liveness floor; D3.3 records the mixed-roster honesty (the mid-thought member is never a candidate, so a mixed roster cannot false-declare). |
| 2 | **B1 pairing** — the liveness gate can leave a phase-stuck member (phase `working`, no events, `progressClass` eventually `silent`) as a never-candidate → hang. | **FOLDED** — D1.4 totality rule leg (b) terminalizes a phase-stuck member (active-turn phase + `progressClass === 'silent'` + no phase/progress advance for N consecutive polls); the liveness gate and the terminalization rule are specified as ONE design, exactly as the red-team demanded. |
| 3 | **B2** (redteam §2.2) — unreadable-member non-totality: `readView` swallows `inspect()` throws → `{ phase: null, terminal: false }` → never a candidate → `hardCapMs: null` makes the drive loop infinite. | **FOLDED** — G12 records the unreadable seam (incl. the preOutcome `/* unreadable — settle at close */` precedent); D1.4 totality rule leg (a) terminalizes an unreadable member after N = confirmation-pair + 1 consecutive polls via the existing D1.4 exit; A12 is a new RED pin asserting totality. |
| 4 | **B3** (redteam §2.3) — landing under-specified: `readView` (`workflow-interpreter.mjs:451-461`) returns a closed shape that drops `lastProgress`/`silenceMs`/`progressClass`; v1's G3 overclaim. | **FOLDED** — G3 corrected and the projection NAMED: the landed `readView` return adds `lastProgress: io.lastProgress ?? null`, `silenceMs: io.silenceMs ?? null`, `progressClass: io.progressClass ?? null`; D1.1/D1.3 anchor on the projected fields; A7 asserts the landed projection (one-command poll preserved). |
| 5 | **Secondary: D2.4(b)** (redteam §3) — suite-safety reasoning logically invalid; the check is live in the suite with a 120 ms floor; a mid-LLM-generation member > 120 ms is a candidate → false `WAVE-QUIESCED` risk. | **FOLDED** — D2.4 gates the quiescence check on `driver.hardCapMs === null`; the suite (`hardCapMs: 3000`) never runs the quiescence machinery; the 120 ms floor concern is moot; A11 and A13 assert the gate. |
| 6 | **Secondary: D2.1 `stallTimeoutMs` ghost** (redteam §3) — parsed (`:419`) and returned (`:421`) but never read by the drive loop; the parenthetical overstated the field's role. | **FOLDED** — D2.1 parenthetical deleted; G13 records the ghost honestly; `stallTimeoutMs` stays in the driver shape for compatibility only; interpreter-side member removal is the D1.4 totality rule, not this field. |
| 7 | **Secondary: A2 shallow-greenable** (redteam §6) — `windowMs = 60 000` (a bare constant) satisfies the 30 s / 60 s assertions. | **FOLDED** — A2 now varies the cadence across three scenarios (10 s-gap → ≥ 20 s; 60 s-gap → ≥ 120 s; 30 s-gap → ≥ 60 s) so a bare constant cannot pass. |
| 8 | **Secondary: A1 shallow-greenable** (redteam §6) — relabeling any `WAVE-INCOMPLETE` as `WAVE-QUIESCED` + evidence line passes A1 while skipping D1.1. | **FOLDED** — A1 marked shape-only AND paired with a predicate counterexample (a mid-turn-only member + quiet rest is NOT quiesced), killing the relabel greenability. |
| 9 | **Secondary: D1.4 "worktree state" overclaim** (redteam §4) — `harvestOne` reads the committed result sha (`git show` at the pin), never the live worktree. | **FOLDED** — D1.4 and D3.1 now read "survivor result-shas are still harvested"; A5's wording fixed; an uncommitted-worktree-state sentence removed. |
| 10 | **QA §2.4 H1/H1a** (review-qa §2.3) — candidate predicate ignores the member's live phase/progressClass; cold-start floor (window sits at 160 s for the entire first turn) can false-declare a healthy long first turn. | **FOLDED** — SAME fix as row B1 (folded once, per the QA instruction "fold once"): the D1.1 three-leg predicate and the `ACTIVE_TURN_PHASES` gate are the H1/H1a cure; the "never started" vs "first turn still running" distinction is named in D1.1 (H1a). |
| 11 | **QA §2.4 keep-set** (review-qa §2.4 #2) — keep the D1.2 cadence derivation, the D1.3 two-poll confirmation, the D2.1 `hardCapMs: null` sentinel + `normalizeDriver` null branch + loop-condition fix, and the D6/F14 receipt preservation as written. | **KEPT** — D1.2, D1.3 (anchored on the projected fields per B3), D2.2, and G9/A8/F14 are unchanged from v1's text (D1.3 amended only to add the liveness-flip confirmation leg from B1, which the QA's H1 requires). |
| 12 | **QA §2.4 #3 → DR-1** (review-qa §6) — OQ2 escalated: hard-break vs exclude-and-continue. | **ESCALATED + RESOLVED as law** — DR-1(a): **hard-break for v1** (D1.4 first paragraph). Exclude-and-continue is a NAMED FOLLOW-ON RUNG; the fold records today's evidence (four complete suites outlived a premature coordinator verdict on 2026-08-13 — the current interpreter effectively continues through dead/limp members) in OQ2 and this record; the follow-on's spec should pin survivor-harvest semantics. |
| 13 | **Operator evidence (issue #163)** — "silence is not even weak evidence of death for silent-turnless workers"; B1's fix is the structural answer. | **FOLDED** — G11 records the law; D3.2 carries the operator-facing honesty paragraph tying the mid-turn silence to the B1 structural fix; the reset-set extension (D1.1) is the event-level mirror. |
| 14 | **OQ3** (redteam §7) — gating-on-null needs no new field; keep the module constant. | **FOLDED** — OQ3 RESOLVED to gating-on-`hardCapMs === null` (D2.4); the driver-field option recorded but not adopted. |
| 15 | **OQ4** (redteam §7) — wave-driver 3h cap not armed in the interpreter path. | **KEPT/RESOLVED** — OQ4 RESOLVED SOUND (G2 note; D2.3; red-team §3 verified `createWaveDriver` → `recipes.mjs:468` only). |
| 16 | **OQ5** (redteam §7) — declaration snapshot vs preOutcome re-read should be pinned in the receipt. | **FOLDED** — OQ5 pinned: declaration snapshot is the quiescence evidence (named `quiescenceLastMeaningfulAt`/`quiescenceSilenceMs` per outcome), preOutcome is settlement evidence; a merged snapshot remains a possible follow-on. |
| 17 | **Citation audit clean** (redteam §1) — every `file:line` anchor re-verified at HEAD `e371f70`; no wrong citation found; no automatic blocker. The three non-citation findings are rows 3/5/6. | **KEPT** — the audit is clean; the same discipline was re-applied to v2's new anchors (G3 projection, G11–G13, `ACTIVE_TURN_PHASES`, `progressBlockedDetail`) this fold session. |
| 18 | **D2 mechanics SOUND** (redteam §3) — D2.2's sentinel handling verified exactly right; D2.1's de-clocking real (the facade default `request.driver ?? PRODUCTION_WORKFLOW_DRIVER` is the shipped path); the wave-driver 3h loop is not armed in the interpreter path. | **KEPT** — D2.1/D2.2 as written (D2.1 with the `stallTimeoutMs` ghost corrected, row 6); OQ4 resolved (row 15). |
| 19 | **D3.3 mixed-roster incompleteness** (redteam §4) — the stuck-break guarantee holds only when the WHOLE roster is decision-stuck; a mixed roster (mid-thought + dead + waiting) escapes the `.every()` and falls to the quiescence law. | **FOLDED** — D3.3 amended with the honesty fix: under v2 the mid-thought member is never a candidate (B1, row 1), so a mixed roster cannot false-declare; unreadable/phase-stuck members terminate via the D1.4 totality rule (B2, rows 2/3). |
| 20 | **A7 premise false at HEAD** (redteam §6) — the pin asserts the check "reads `silenceMs`/`lastProgress.at` from the outline `readView` ALREADY fetches", but `readView` (`:451-461`) drops them (B3). | **FOLDED** — A7 amended to assert the LANDED projection (the projected fields exist on the landed `readView` return; the common poll stays ONE command). Bundled under B3 (row 4); made an explicit row here so the pin change is not a silent drop. |
| 21 | **All 11 pins RED verified** (redteam §6) — every pin asserts RED at HEAD; A1/A5/A6/A8 shape claims match the code exactly. | **KEPT** — recorded; the three greenability notes are rows 7/8/20. A12/A13 are new RED pins added by the fold (totality rule; null-gate). |
| 22 | **Refusal vocabulary SOUND** (redteam §5) — no new refusal code; the two evidence lines + the closed exit enum are complete and match every loop exit; `hard_cap` correctly stays suite-only. | **KEPT** — the vocabulary section is unchanged in v2; the totality rule reuses `wave_terminalized_unrecoverable`/`terminalized_unrecoverable`, adding no new code. |
| 23 | **QA §2.3 H2 (note)** — the D1.4 hard-break discards in-flight survivor work (mid-turn survivors stopped by `wave.close` never write their partial state). | **ESCALATED** — this is the authority-class judgment call DR-1(a) resolves: hard-break for v1 (already-written result-shas harvested); exclude-and-continue named follow-on rung pins survivor-harvest semantics (row 12). |
| 24 | **QA §2.2 spot-check** (review-qa §2.2) — every #163 anchor re-verified; no wrong anchor found. | **KEPT** — the QA's spot-check agrees with the red-team's citation audit (row 17): the anchors are sound; the holes are in logic/completeness, not citations. |
| 25 | **Blind-QA conflict resolution** (fold law — the QA was blind) — the QA's H1 fix (phase/liveness-aware predicate) is necessary but NOT sufficient alone: it would hang a phase-stuck member and still under-specify the landing (`readView` projection). The row report governs. | **FOLDED as row-governs** — the red-team's three-part B1 fix (row 1) + B2 pairing (row 2) + B3 projection (row 4) are the governing superset; the QA's H1/H1a is folded ONCE into that same predicate (per §2.4 "fold once"), not as a separate weaker rule. |
