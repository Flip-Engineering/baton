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
`meaningfulEventAt`) as the evidence-derived precedent the quiescence predicate is built on.

- **Date:** 2026-08-13
- **Status:** DRAFT — implementation contract (red-first; no code landed for this rung)
- **Verification HEAD:** `e371f704727cbca5fdff86af31ec8b154620a71f` ("Baton private effective-tree
  snapshot"), the tree this contract was verified against. Every `file:line` citation below was
  re-verified this session with `grep -an`/`sed -n`/`Read` at this HEAD, not inherited. The one
  NUL-bearing file whose anchors are grep/sed-verified, never whole-file read: `application.mjs`.
  `workflow-interpreter.mjs`, `coordinator.mjs`, `wave.mjs`, `wave-driver.mjs`,
  `application-semantics.mjs`, and both red suites were read directly (NUL-free).
- **Brief:** `row-quiescence.md` (same dir) — read fully; `foundry-brief.md` (same dir) — the shared
  frame, read first.
- **Scope of the rung, in one sentence:** the interpreter's drive loop loses `hardCapMs` as a
  production control; a wave completes when (a) every remaining member has produced no meaningful
  event across a roster-derived evidence window — a named `WAVE-QUIESCED` verdict with per-member
  last-meaningful-event evidence — or (b) a member terminalizes unrecoverably; the wall-clock
  `hardCapMs` survives ONLY as the suite's fast-policy backstop.

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
  3h cap (`DEFAULT_POLICY`, `wave-driver.mjs:35-73`, `hardCapMs: 3 * 3_600_000`).
- **G3 — the inspect outline ALREADY carries the quiescence data; the loop's poll needs no new
  command.** `run.inspect` defaults to depth `'outline'` (`const request = deepFreeze({ depth:
  'outline', ...clone(rawRequest) })`, `application.mjs:10931`). The outline block
  (`:11039-11061`) computes `const timing = this._progressTiming(current, view)` (`:11041`) and
  spreads `...timing` into the outline (`:11052`) — so `outline.lastProgress.at` (the member's last
  meaningful-event timestamp) and `outline.silenceMs` ride every outline — plus `progressClass:
  clone(view.progressClass ?? null)` (`:11061`). The interpreter's `readView` already reads the
  outline (`try { insp = await handle.inspect(); }`, `workflow-interpreter.mjs:436`;
  `const io = insp?.outline ?? {}`, `:437`), and the common poll is deliberately ONE command —
  `status()` is read ONLY when a steering policy needs it (`needStatus`, `:431-433`). The quiescence
  check therefore reads fields already present in the one poll it already takes.
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

---

## D1 — the quiescence bound

The wave's completion control becomes the roster's own silence, observed across a window derived
from the roster's own event cadence. A wall clock remains ONLY as the suite's backstop (D2).

### D1.1 — the quiescence predicate (which events reset it, and what "quiet" means)

The reset set is the run-level meaningful-event semantics of G4 — `_followCategory`
(`application.mjs:8010-8033`), cited, not re-specified: plan, execution, orchestration, context,
evidence, result, cleanup, integration, recovery, and verification kinds reset a member's
quiescence watch; noise telemetry (`content.tool_call` / `content.message` wrapped in
`evidence.mapped`, `application.mjs:85,8018`) NEVER resets it. A member emits its `lastProgress.at`
and `silenceMs` on every outline the interpreter already reads (G3).

- **Member quiescence candidate.** A member still in `pending` is a quiescence candidate at a poll
  iff `silenceMs(role) >= windowMs`, where `silenceMs` is `outline.silenceMs` (0 for a terminal
  member — but terminal members have already left `pending`, G6) and `windowMs` is D1.2. A member
  with zero meaningful events since wave start has `lastProgress.at === startedAt` (the
  `_progressTiming` default, `application.mjs:8158`) and `silenceMs` grows from wave start —
  that member is honestly "quiet across the window" once `silenceMs >= windowMs`; the predicate does
  NOT require a prior meaningful event (a roster that never got going is a quiesced roster, reported
  with the honest zero-evidence trail).
- **Wave quiescence declaration.** The wave is declared quiesced at a poll when EVERY member still
  in `pending` is a quiescence candidate AND the declaration survives the D1.3 confirmation poll. A
  member whose `lastProgress.at` advanced (a new meaningful event landed) between the candidate poll
  and the confirmation poll is NOT quiet — the confirmation fails and the quiescence watch resets
  (the roster re-armed).

### D1.2 — the window is derived from the roster's own cadence, never a bare constant

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
  contract's default; it is configurable on the driver (`quiescenceMinPolls`, see OQ3) so a caller
  can tighten/loosen the observation floor without touching the cadence law.
- The cadence term DOMINATES once observed: the floor exists solely so the first declaration is
  legally attempted only after the tracker has samples to observe — it is never the completion
  control for a roster that has produced events. No wall-clock constant enters the window.

### D1.3 — the confirmation poll (the declaration race)

A quiescence declaration is a two-poll event. When the candidate check passes, the loop does NOT
break immediately: it performs one confirmation poll (a fresh `readView` of every still-pending
member — the same single-command poll it always takes, G3) and declares quiescence IFF, on that
poll, (a) every still-pending member is STILL a quiescence candidate (`silenceMs >= windowMs`), (b)
no member's `lastProgress.at` advanced since the candidate poll, and (c) no member terminalized
unrecoverably in between. If any leg fails, the loop continues (the roster re-armed; the cadence
tracker keeps the now-larger observed gaps). The confirmation bounds the read-to-break race: an
event landing between the candidate poll and the confirmation poll is caught by the confirmation's
re-read; an event landing after the second poll is caught by the preOutcome capture
(`workflow-interpreter.mjs:562-576`, which re-reads each member before `wave.close`) — and after
`wave.close` no member can emit (G8).

### D1.4 — unrecoverable terminalization ends the loop promptly

If, at any poll, a member terminalizes with an unrecoverable phase — `{ cancelled, failed, stopped,
denied }` (G6) — the loop breaks immediately. The wave cannot reach WAVE-OK (that member's harvest
path has no result sha), so continuing to run the surviving members spends compute on a wave whose
harvest is already known incomplete; their already-written worktree state is still harvested (D3.1).
This exit is distinct from the success-terminal path (a `result_ready`/`work_completed`/`completed`
member merely leaves `pending`, and the wave continues toward the remaining roster).

### D1.5 — the honest verdict shape (NOT WAVE-INCOMPLETE-by-clock)

`driveLane` returns a closed exit-report (it currently returns nothing); `runWorkflow` maps it to
the verdict:

- `driveLane` returns `{ exit: 'quiesced', perRole }` where `perRole[role] = { lastMeaningfulAt,
  silenceMs }` is the last-poll snapshot for every member that was still in `pending` at
  declaration. For the other exits it returns `{ exit: 'pending_empty' | 'stuck_handled' |
  'terminalized_unrecoverable' | 'hard_cap' }`.
- `exit === 'quiesced'` → **`verdict: 'WAVE-QUIESCED'`, `basis: 'quiesced'`** — the named
  quiescence verdict the brief demands, NOT a clock-flavoured WAVE-INCOMPLETE. `runWorkflow` pushes
  the named evidence line `steering.push({ evidence: 'wave_quiesced' })` (the G7 channel, no
  `trigger`), and merges each member's `lastMeaningfulAt`/`silenceMs` into its `outcomes[]` entry as
  additive fields — the D6 receipt stays EXACTLY the seven sorted keys (G9/F14).
- `exit === 'terminalized_unrecoverable'` → `verdict: 'WAVE-INCOMPLETE'`, `basis: manifestDigest`
  (unchanged), plus `steering.push({ role: <role>, evidence: 'wave_terminalized_unrecoverable' })`.
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
is completed by D1 (quiescence) and the D1.4 unrecoverable-terminal exit. `pollIntervalMs` and
`stallTimeoutMs` stay: the poll cadence is the sampling rhythm the window floor is expressed through
(D1.2), and `stallTimeoutMs` remains the #67 per-member stall budget (a liveness bound, not a
wave-completion clock — unchanged, cited not re-specified).

### D2.2 — `normalizeDriver` and the loop condition learn the sentinel

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
not the interpreter's loop clock) — noted in OQ4.

### D2.4 — the suite-only backstop stays, and the suite must not slow

The two red suites keep their fast pinned policy unchanged: `LANE_DRIVER` with `hardCapMs: 3000`
(`workflow-as-data-red.test.mjs:346`, `worker-orchestrated-swarm-red.test.mjs:77`). This is the
suite-only wall-clock backstop — the guarantee that a quiescence-machinery regression can never hang
the suite. The rung does not touch it.

**Why the suite does not slow.** (a) The quiescence check reads `silenceMs`/`lastProgress.at` from
the outline `readView` ALREADY fetches in the common poll (G3) — no second command is added to the
happy path. (b) Happy-path rows exit via `pending.size === 0` (every member settles `result_ready`,
G10), and the quiescence candidate check runs only while `pending.size > 0` — for an actively
working roster no member is a candidate, so no confirmation poll ever fires. (c) The only new work
is O(roster) in-memory cadence bookkeeping per poll and, in a genuinely quiet wave, the single
confirmation re-read (a poll of the same cost as any other). The fast cadence (15 ms) and the 3000 ms
backstop are unchanged (F11).

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
`lastMeaningfulAt`/`silenceMs` in `outcomes[]`, and the harvest entries that found no sha reported
as `harvest_miss` exactly as today (a quiesced verdict is not downgraded to WAVE-INCOMPLETE by a
miss — D1.5).

### D3.2 — can a member re-wake after quiescence is declared? **No — and the race is closed twice.**

- **Before the declaration completes:** a member re-waking during the D1.3 confirmation window (a
  new meaningful event advancing `lastProgress.at`) FAILS the confirmation — the wave is not
  declared quiesced, the watch resets, and the loop continues. This is the declaration race guard.
- **After the declaration:** the declaration IS the loop exit. `runWorkflow` then captures
  preOutcome and calls `wave.close()`, which stops every member (`wave.mjs:451-486`); a member
  cannot produce a meaningful event after close (G8). An event that would have landed in the gap
  between the declaration poll and the close is caught by the preOutcome re-read
  (`workflow-interpreter.mjs:562-576`) and reflected in that member's outcome — and the quiescence
  verdict honestly reports the last-observed snapshot. The contract pins: **a member cannot re-wake
  after quiescence is declared**; the declaration is a terminal loop exit, and the machinery that
  makes it honest is the confirmation (D1.3) plus the preOutcome capture (G8).

### D3.3 — the stuck-decision early-break's place in the new law

The existing early-break — every remaining member stuck on a decision the policy already handled
(deferred/refused) → `break` (`workflow-interpreter.mjs:753-757`) — is preserved verbatim and is
evaluated BEFORE the quiescence check each poll. It is the fast, decision-specific exit: a
decision-stuck roster is NOT evidence-quiet (its members may still be turning), so quiescence would
not fire for it; the stuck-break names the real cause. Its exit is `stuck_handled`, mapping to the
existing `WAVE-INCOMPLETE` over the `manifestDigest` basis (D1.5) — a decision-stuck roster is
reported INCOMPLETE for cause, NEVER `WAVE-QUIESCED`. The per-poll order becomes: process members →
unrecoverable-terminal check (D1.4) → stuck-decision break (existing) → quiescence candidate +
confirmation (D1.1/D1.3) → sleep.

---

## Refusal vocabulary

The quiescence rung introduces NO new refusal code. It adds two **named evidence lines** (the G7
channel), and the exit-report sentinel is a closed enum:

| Code / value | Kind | Source | Context |
|---|---|---|---|
| `{ evidence: 'wave_quiesced' }` | named evidence line | new (`steering[]`) | Pushed by `runWorkflow` when `driveLane` exits `'quiesced'` — the G7 sibling of `steering_message_undelivered` (`workflow-interpreter.mjs:798`). |
| `{ role, evidence: 'wave_terminalized_unrecoverable' }` | named evidence line | new (`steering[]`) | Pushed by `runWorkflow` when a member terminalizes unrecoverably (D1.4). |
| `{ exit }` | closed enum | new (`driveLane` return) | `exit ∈ { 'pending_empty', 'stuck_handled', 'quiesced', 'terminalized_unrecoverable', 'hard_cap' }` — a closed set, never a free string. |
| `workflow_spec_invalid` etc. | reused codes | `workflow-interpreter.mjs:29-33` | The existing admission-time refusals are unchanged — the quiescence machinery refuses nothing new. |

The closed vocabulary above is complete: two named evidence lines plus the exit-report enum. The
exit-report enum is the contract's vocabulary for WHY the loop ended; the evidence lines make the
reason legible in the receipt without a new verdict-field grammar. Should OQ3 resolve to a THROWING
`quiescenceMinPolls` validation (rather than the existing silent fallback), the new code would be
named in OQ3's resolution — it is deliberately NOT part of this rung's vocabulary today.

---

## Red-first acceptance pins

RED = fails at HEAD (`e371f704727cbca5fdff86af31ec8b154620a71f`); GREEN = passes after this
contract's rung lands. Each pin asserts behavior, not implementation.

| Pin | Assertion | At HEAD |
|---|---|---|
| A1 | A wave whose full roster goes quiet (no meaningful event across the derived window) receipts `verdict: 'WAVE-QUIESCED'`, `basis: 'quiesced'`, and a `steering[]` entry `{ evidence: 'wave_quiesced' }`. | **RED** — the loop has no quiescence exit; the verdict enum is only `WAVE-OK`/`WAVE-INCOMPLETE` (`workflow-interpreter.mjs:604`). |
| A2 | The quiescence window is derived from the roster's own event cadence (`max(2 * maxObservedGapMs, QUIESCENCE_MIN_SILENT_POLLS * pollIntervalMs)`), never a bare constant: a roster observed to produce events 30 s apart is NOT quiesced at 30 s of silence, only at ≥ 60 s. | **RED** — no window machinery exists at all. |
| A3 | The quiescence predicate resets on a run-level meaningful event per `_followCategory` (`application.mjs:8010-8033`); noise telemetry (`content.tool_call`/`content.message`, `:85,8018`) never resets it; a member with zero meaningful events since wave start is honestly "quiet across the window" once `silenceMs >= windowMs`. | **RED** — no predicate exists. |
| A4 | The declaration is a two-poll event: a member whose `lastProgress.at` advances between the candidate poll and the confirmation poll fails the declaration and the wave continues (the re-arm race is closed). | **RED** — no confirmation poll exists. |
| A5 | A member terminalizing unrecoverably (`cancelled`/`failed`/`stopped`/`denied`) ends the loop at that poll with `WAVE-INCOMPLETE` over the `manifestDigest` basis and the `wave_terminalized_unrecoverable` evidence line; the survivor worktree state is still harvested. | **RED** — a failed member merely leaves `pending` (`:733`); the loop waits for the rest or the hard cap. |
| A6 | `PRODUCTION_WORKFLOW_DRIVER` ships without a wall-clock completion control (`hardCapMs: null` sentinel); `normalizeDriver` accepts `null`; the loop condition honors the sentinel (`number < null` never exits the loop early). | **RED** — `application.mjs:117-119` still ships `hardCapMs: 3 * 3_600_000`; `normalizeDriver` has no null branch; `:736` would mis-evaluate the sentinel. |
| A7 | The suite impact is nil: the quiescence check reads `silenceMs`/`lastProgress.at` from the outline `readView` ALREADY fetches (G3) — the common poll stays ONE command, the `needStatus` gate is unchanged, and no happy-path row waits out the quiescence window. | **RED** — no quiescence check exists (the one-command poll is preserved trivially because the check is absent; the pin asserts the LANDED check preserves it). |
| A8 | A roster quiet mid-harvest receipts honestly: `WAVE-QUIESCED` with per-member `lastMeaningfulAt`/`silenceMs` additive fields riding `outcomes[]`, harvest entries that miss reported `harvest_miss`, and the D6 receipt key-set EXACTLY `['basis','harvest','manifestDigest','outcomes','steering','verdict','waveId']` (F14, `workflow-as-data-red.test.mjs:705`). | **RED** — no quiescence receipt exists; `WAVE-QUIESCED` is not in the enum. |
| A9 | Post-declaration re-wake is impossible: the declaration is the loop exit, `wave.close()` stops every member (`wave.mjs:451-486`), and any last-instant event is caught by the preOutcome re-read (`workflow-interpreter.mjs:562-576`). | **RED** — no declaration machinery exists (members are stopped at close today, but nothing asserts the re-wake law). |
| A10 | The stuck-decision early-break (`:753-757`) is preserved, evaluated BEFORE the quiescence check, and maps to `stuck_handled` → `WAVE-INCOMPLETE`/`manifestDigest` — a decision-stuck roster is NEVER reported `WAVE-QUIESCED`. | **RED** — the early-break exists but the quiescence check it must precede does not; the ordering is unenforced. |
| A11 | The two red suites pass on the byte-identical `LANE_DRIVER` (`hardCapMs: 3000`), every happy-path row exits via `pending.size === 0` and receipts `WAVE-OK`, and no row's runtime stretches by the quiescence window (the suite-only backstop is untouched, F11). | **RED** — quiescence machinery absent; the pin asserts the LANDED state preserves the fast policy. |

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
  `foundry-qa.md` rather than treat `shared` as authoritative.
- **OQ2 — unrecoverable terminalization: hard-break vs. exclude-and-continue.** The brief's "OR a
  member terminalizes unrecoverably" is pinned as a hard-break (D1.4) — the wave stops at the first
  unrecoverable terminal because its harvest cannot succeed and continuing spends compute on a doomed
  wave. The alternative — exclude the failed member and keep driving the survivors to quiescence,
  preserving their in-flight work at the cost of wall time — is a genuine judgment call. This
  contract pins hard-break; a reviewer who wants survivor-completion should flag this pin.
- **OQ3 — the window floor's configurability.** `QUIESCENCE_MIN_SILENT_POLLS` (default 8) is the
  evidence-count floor in D1.2. Should it be a driver field (`quiescenceMinPolls`, validated by
  `normalizeDriver` with the existing silent-fallback), or a module constant? The no-arbitrary-limits
  law favors configurability with documented derivation (8 = > the confirmation pair of 2, plus room
  for the cadence tracker to observe gaps); the suite's fast policy may want a tighter floor. The
  contract keeps it a module constant by default and records the driver-field option here.
- **OQ4 — `wave-driver.mjs`'s own 3h `DEFAULT_POLICY.hardCapMs`.** The wave driver's underlying
  policy (`wave-driver.mjs:35-73`) carries its own `hardCapMs: 3 * 3_600_000`. This rung governs the
  INTERPRETER's drive loop, not the wave driver's cadence; whether the wave-driver's default should
  also lose its clock (or be scoped as a per-member liveness cadence) is left open — changing it is a
  separate rung with its own suite impact.
- **OQ5 — the preOutcome re-read vs. the declaration snapshot.** For a quiesced wave, per-member
  `lastMeaningfulAt`/`silenceMs` come from the declaration poll's snapshot, but the preOutcome
  capture (`workflow-interpreter.mjs:562-576`) re-reads each member before `wave.close`. If the two
  disagree (a member emitted between the declaration and the preOutcome read), which is authoritative
  for the `outcomes[]` evidence? The contract says the declaration snapshot is the quiescence
  evidence and the preOutcome is the settlement evidence; a reviewer may want a single merged
  snapshot.

---

## Cross-references

- **`row-quiescence.md`** (same dir) — the row brief: D1 quiescence bound / D2 migration / D3
  honesty edge cases.
- **`foundry-brief.md`** (same dir) — the shared frame: Ring-2 form, no clocks, verified citations,
  publish-as-you-go, escalation posture.
- **#67 stall-watchdog** (`stall-watchdog-2026-08-07/`, `coordinator.mjs:71-76,9382`) — the
  member-level liveness machinery this contract mirrors at the wave level; `PROGRESS_SILENCE_
  THRESHOLD_MS` (`application-semantics.mjs:54`).
- **#114 workflow-as-data interpreter** — `workflow-interpreter.mjs` (the file being de-clocked);
  the D6 receipt shape and F14 key-set pin (`workflow-as-data-red.test.mjs:705`).
- **#153 repair** — the 3h production cadence (`application.mjs:117-119`) this contract's D2.1
  changes.
- **`stall-watchdog-2026-08-07/suite-67-brief.md`** — the control-law line verbatim: "a
  slow-but-productive worker is NEVER declared stalled; no bound fires on elapsed time without an
  evidence check" — the law D1.1/D1.2 implement for the wave.

## Campaign-law constraints

- **No clocks.** The wall-clock `hardCapMs` is removed as a production control (D2.1); the 
  quiescence window is derived from the roster's own event cadence (D1.2), never a bare constant;
  the floor is an evidence-count bound expressed through the driver's own sampling cadence. The
  suite-only `hardCapMs: 3000` backstop (D2.4) is a test guardrail, not a workflow control.
- **No arbitrary numeric limits.** `QUIESCENCE_MIN_SILENT_POLLS` is the one new named constant; its
  derivation is documented (OQ3) and it is the observation floor, not the completion control.
- **No redesign of landed SOUND law.** The stuck-decision early-break (`:753-757`) is preserved; the
  meaningful-event semantics (`_followCategory`) and the #67 liveness machinery are cited, not
  re-litigated; the D6/F14 receipt shape is preserved (G9).
- **Ring-2 form.** This contract specifies behavior; it does not amend implementation. Every
  `file:line` citation was verified at HEAD `e371f704` this session.
- **Deliverable boundary.** The sole deliverable is
  `docs/reference/evidence/contract-foundry-2026-08-13/contract-163.md` (plus the `shared` publish
  OQ1 documents as not executable from this session's toolset). Work was confined to
  `docs/reference/evidence/contract-foundry-2026-08-13/**`. No source files were modified.
