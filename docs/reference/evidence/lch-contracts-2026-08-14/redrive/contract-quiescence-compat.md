# The WAKE/QUIESCENCE COHERENCE contract — parked-for-signal (#181), retrying (#201), and silent-but-working members against the folded #163 quiescence predicate

[attempt: fcd0b7ea-f684-4c3c-a417-19cf736c8509 row-quiescence-compat]

The implementation contract for `row-quiescence-compat` (package ④ lifecycle-honesty, the
`waves.run` operator surface): the composition contract that keeps the wave's three non-terminal
member kinds honest about each other under the folded quiescence predicate (issue #163, contract
`contract-163.md` v2). It is a **Ring-2 contract** (ground truths → decisions → closed refusal
vocabulary → red-first acceptance pins → open questions), specifies behavior, and does not amend
implementation in this artifact. Every `file:line` citation below was re-verified this session at
HEAD `09200e9` ("baton workflow base impl-gate-digest-2026-08-14-wave-a") with `grep -an`/`sed -n`/
`Read` — the NUL discipline applies exactly as the foundry names it: `application.mjs` and
`coordination-store.mjs` are NUL-bearing (confirmed this session: 13,540 NUL bytes and 17,432 NUL
bytes respectively), so their anchors are grep/sed-verified, never whole-file read;
`workflow-interpreter.mjs`, `coordinator.mjs`, `wave.mjs`, and `application-semantics.mjs` were read
directly (NUL-free).

- **Date:** 2026-08-14
- **Version:** v1
- **Status:** DRAFT v1 — implementation contract (red-first; no code landed for this rung).
- **Verification HEAD:** `09200e9` (the current worktree HEAD, `git log -1` confirmed this session).
- **Brief:** `row-quiescence-compat.md` (same dir) — read fully; `foundry-brief.md` (same dir) — the
  shared frame, read first. The folded contract: `contract-163.md` (v2, `contract-foundry-2026-08-13/`),
  read fully and re-anchored at this HEAD where line numbers shifted.
- **Scope of the rung, in one sentence:** define how a **parked-for-signal** member (#181 — a
  coordinator or member waiting on `signalOnMembersDone`), a **retrying** member (#201 — durable
  classify-then-resume, RED at HEAD), and a **silent-but-working** member are each read by the D1.1
  quiescence candidate predicate of the folded #163, so the wave can neither false-declare
  `WAVE-QUIESCED` while a live member waits/retries/turns, nor hang forever on a member no wake can
  reach.

---

## Ground truths (verified this session at HEAD `09200e9`)

- **G1 — the folded #163 quiescence law is the frame, and it is NOT landed at HEAD.** The folded
  predicate (contract-163.md D1.1) is three legs: a still-`pending` member is a quiescence candidate
  IFF (a) `silenceMs >= windowMs` (projected `readView.silenceMs`; window per D1.2 =
  `max(2 * maxObservedGapMs, QUIESCENCE_MIN_SILENT_POLLS * pollIntervalMs)`), AND (b)
  `progressClass(role) === 'silent'`, AND (c) `phase(role) NOT IN ACTIVE_TURN_PHASES`. The
  declaration is a two-poll confirmation (D1.3); a member whose `lastProgress.at` advances or whose
  `progressClass` flips out of `silent` between the two polls fails the confirmation. Unrecoverable
  terminalization ends the loop promptly (D1.4 hard-break), and a still-pending member that is
  unreadable or phase-stuck for N = confirmation-pair + 1 consecutive polls is
  terminalized-unrecoverable by the totality rule (D1.4/B2). **At HEAD this entire machinery is
  absent**: the drive loop is still `while (pending.size > 0 && Date.now() - startedAt <
  driver.hardCapMs)` (`workflow-interpreter.mjs:783`, `hardCapMs: 3000` default at `:414`), the
  production cadence still ships `hardCapMs: 3 * 3_600_000` (`application.mjs:117-119`), and
  `readView` returns a closed shape that DROPS the quiescence inputs (G5). This contract composes
  the three member kinds against the *folded* predicate — it specifies what the landed predicate
  must read, so the #163 rung and this rung land coherent.
- **G2 — the interpreter's `readView` still drops the predicate inputs (the B3 seam, RED).**
  `readView` (`workflow-interpreter.mjs:442-476`) reads the inspect outline (`const io =
  insp?.outline ?? {}`, `:451`) and returns a closed shape `{ phase, actions, attention, taskId,
  workerId, planDigest, task, terminal, terminalStatus }` (`:465-475`) — it does NOT project
  `lastProgress`/`silenceMs`/`progressClass`, which the outline DOES carry: `run.inspect` defaults
  to `depth: 'outline'` (`application.mjs:10933`), the outline block computes `const timing =
  this._progressTiming(current, view)` (`:11043`), spreads `...timing` (`:11054`), and appends
  `progressClass: clone(view.progressClass ?? null)` (`:11063`). The folded #163 names this
  projection (B3): the landed `readView` adds `lastProgress`, `silenceMs`, `progressClass`. This
  contract's composition pins depend on that landed projection.
- **G3 — the progressClass reducer is total and its precedence is terminal → blocked → silent →
  progressing.** `projectProgressClass` (`application.mjs:507-522`): `APPLICATION_RUN_TERMINAL_PHASES`
  → `terminal:<cause>` (`:510-513`); a non-null `progressBlockedDetail` → `blocked_interaction:
  <detail>` (`:514-517`); `silenceMs >= PROGRESS_SILENCE_THRESHOLD_MS` (120_000,
  `application-semantics.mjs:54`) → `silent` (`:518-520`); else `progressing` (`:521`). The blocked
  detail is computed by `progressBlockedDetail` (`application.mjs:494-503`): `awaiting_plan_approval`
  → `approve_plan`, `selection_required` → `select_candidate`, a pending
  `answer_question`/`answer_approval`/`answer_decision` attention → `answer_required`, a
  `turn_checkpoint` attention → `turn_checkpoint`. **A member parked on an interaction is
  `blocked_interaction:*` — by G11 of the folded #163, NEVER a quiescence candidate regardless of
  `silenceMs`.** The run-level terminal set is `APPLICATION_RUN_TERMINAL_PHASES = { completed,
  failed, cancelled, denied, stopped }` (`application.mjs:161`).
- **G4 — the meaningful-event semantics (which event kinds reset the quiescence watch).**
  `_progressTiming` (`application.mjs:8139-8184`) filters the coordination log to events that
  `_followCategory` (`:8012-8035`) classifies as meaningful AND `_eventBelongsToRun` (`:8037`)
  attributes to the run, and computes `lastProgress.at` from the last such event and `silenceMs =
  terminal ? 0 : boundedDuration(observedMs, lastMs)` (`:8181`). `_followCategory` classifies
  plan/execution/orchestration/context/evidence/result/cleanup/integration/recovery/verification
  kinds as meaningful and EXCLUDES noise telemetry: `NOISE_TELEMETRY_OPERATIONAL_KINDS =
  { 'content.tool_call', 'content.message' }` (`:85`), an `evidence.mapped` wrapping a noise kind
  returns `null` (`:8020`). `REARM_KINDS = { 'approval.resolved', 'decision.settled',
  'lifecycle.turn_started', 'question.answered' }` (`coordinator.mjs:71-76`) are the #67 liveness
  re-arm kinds — NOT `_followCategory`-meaningful, yet the folded D1.1 extends the reset set with
  them (the run-level mirror of the member-level `_observeWatchdogEvent` law:
  `if (!REARM_KINDS.includes(event.kind)) return; // EVERYTHING ELSE IS SILENCE`,
  `coordinator.mjs:9681`).
- **G5 — the park states map to canonical `blocked_interaction:*` attention, never to a phase the
  quiescence predicate can reach.** `attentionFrom(outline)` (`wave.mjs:143-159`): an `input_required`
  member with no attention surfaces `'blocked_interaction:answer_required'` (`:153`); a `paused`
  member surfaces `'turn_checkpoint'` (`:157`). The canonical phase mapping is `input_required →
  'working'` (`LEGACY_RUN_PHASE_MAP`, `application-semantics.mjs:72`) and the member-state mapping is
  `input_required → 'blocked'` (`:79`). So a parked-for-signal member reads phase `working` (an
  ACTIVE_TURN_PHASES phase) with `blocked_interaction:*` progressClass: **leg (b) fails it as a
  candidate even before leg (c) is consulted.** `ACTIVE_TURN_PHASES` is NOT present at HEAD
  (grep across `workflow-interpreter.mjs`, `application.mjs`, `application-semantics.mjs` returns
  nothing this session) — it is the folded #163's new named set
  `{ 'planning', 'queued', 'working', 'uncertain', 'verifying', 'result_selected', 'reviewing',
  'integrating', 'stopping' }` (contract-163.md D1.1; `paused`/`interrupted` are NOT active-turn —
  a suspended run cannot emit without a resume).
- **G6 — the #181 wake-on-signal root cause is still at HEAD: an inverted recipient filter.** The
  interpreter's `signalOnMembersDone` block (`workflow-interpreter.mjs:786-798`) fires when every
  named role is terminal (`[...signalRoles].every((role) => doneRoles.has(role) ||
  !handles.has(role))`, `:787-788`) and builds
  `const recipients = [...handles.keys()].filter((role) => !signalRoles.has(role))` (`:791`), then
  sends the message to every NON-signal role and records the recipients in `steering[]` (`:797`).
  The channel audit's finding names the mismatch exactly — "the interpreter builds
  `recipients = [...handles.keys()].filter((role) => !signalRoles.has(role))` (the audit's
  `:739-751` at its verification HEAD `e371f704`; the same filter sits at `:791` at this HEAD), with
  `signalRoles = ["coordinator"]`, delivering the result message to the four ROWS and NOT to the
  coordinator" (`channels.md` §4, `channel-audit-2026-08-13/`), filed as the #181 root cause. The
  corrected #175 semantics (`signalOnMembersDone` names the WATCHED rows; the remaining member — the
  coordinator — is the recipient) is what the day's wavefiles pin, and this redrive's own wavefile
  carries it: `signalOnMembersDone row-wake,row-death,row-retry,row-quiescence-compat result
  "All four rows settled (you are the remaining member — the pinned #175 semantics)…"`
  (`lch-contracts.wavefile:42`, this dir). **At HEAD the coordinator-addressed signal is delivered
  away from the coordinator — the parked-for-signal member's wake is structurally lost.**
- **G7 — the day's six coordinator-lifecycle instances are the requirement source.** Six seats in
  the 2026-08-13/14 foundries record the same lifecycle gap — the coordinator parked waiting on a
  `signalOnMembersDone` that never arrives (or arrives to the wrong recipients). The two
  ordinals the sources themselves assign are preserved (pm = fifth, lane-proof = sixth); the four
  earlier instances are the foundry seats that precede them in the day:
  - `suite-foundry-2026-08-13-c/coordinator-brief.md:7` — "wave-a's QA verdict'd four healthy rows
    dead from dark channels" (the base suite wave-a instance: the coordinator blind-synthesized
    without the signal; the base suite's own record is `suite-foundry-2026-08-13/suite-qa.md:11`,
    "`signalOnMembersDone` has NOT fired").
  - `blue-team-2026-08-13-b/blueteam-qa.md:11-12` — "`signalOnMembersDone` has **not** fired. Only
    `messageOnSpawn` and a checkpoint nudge arrived this session."
  - `dsh-comparison-2026-08-13/dsh-qa.md:13-14` — identical record: "`signalOnMembersDone` has
    **not** fired."
  - `pm-comparison-2026-08-13/landing-note.md:5-8` — "the #181 lifecycle gap's **fifth** instance"
    (the coordinator wrote `pm-qa.md` before the rows' work was visible to it; it "synthesized from
    the briefs + digest rather than fabricate attribution" — the correct fallback, and still a
    blind-coordinator instance).
  - `lane-proof-2026-08-13/landing-note.md:15` — "the #181 lifecycle gap's **sixth** instance":
    "signalOnMembersDone (corrected #175 semantics) | **NOT RECEIVED by the coordinator** | the
    first correctly-addressed signal — and the coordinator's turn had already ended."
  - `lifecycle-contracts-2026-08-14-contract-qa.checkpoint-30401b32.patch:36` — the predecessor of
    THIS redrive: "| signalOnMembersDone | `result` to the coordinator once `row-lc-fs,
    row-lc-launch,row-lc-members,row-lc-ledger` are all terminal | — | NOT RECEIVED |", and `:186`
    "Signal absent. `signalOnMembersDone` did not fire; the four watched rows are not terminal."
  Every instance is the SAME member kind: a **parked-for-signal member** whose wake is lost, which
  this contract must keep honest under the quiescence predicate — it is `blocked_interaction:*`
  (never a candidate, G3/G5), so a predicate alone can never un-park it; the WAKE side (#181) must
  deliver, or the wave waits on an operator interaction forever.
- **G8 — there is no `retrying` state and no death-certificate machinery at HEAD (#201, #182 RED).**
  `grep -an` for `retrying` across `application.mjs`, `coordinator.mjs`, `wave.mjs`,
  `workflow-interpreter.mjs`, `application-client.mjs` returns nothing; `suspicionClass` and every
  named death-certificate cause (`provider_refusal`, `capacity_reap`, `watchdog_stall`,
  `wave_close_teardown`, `credential_death`, `explicit_stop`, `clean_terminal`) return nothing across
  `impl/src/*.mjs` (the single `watchdog_stall_exceeds_wall` match at `index.mjs:1112` is the #67
  member-level watchdog refusal, not a death certificate). The `#201` classify-then-resume state
  machine and the `#182` suspicion vocabulary are contracts to be written, not code at HEAD. The
  folded #163's phase gate (`phase NOT IN ACTIVE_TURN_PHASES`) and totality rule (D1.4/B2) are the
  seams this contract pins a retrying member onto.
- **G9 — `wave.close()` stops every member; post-declaration re-wake is structurally impossible.**
  `wave.close()` calls `entry.run.stop(reason)` for every member (`wave.mjs:492-528`, the loop at
  `:500-523`, `await entry.run.stop(reason)` at `:503`). The folded #163's D3.2 pins the re-wake law
  on this: once quiescence is declared and `wave.close()` runs, no member can produce a meaningful
  event. For the wake/quiescence coherence this means: a parked-for-signal member that never receives
  its signal is NOT resolved by wave close — it is stopped mid-park and its outcome is the coarse
  `stopped` terminal (the lane-proof landing-note records exactly this: "the coordinator wrote its QA
  … both 'stopped' verdicts are the wave-close teardown of already-finished members — the receipt's
  coarse terminal vocabulary — #182's class", `lane-proof-2026-08-13/landing-note.md:24-26`).
- **G10 — the shared-publish surface is gapped by construction at HEAD (#158).** The facade dispatch
  is exactly `run.scratchpad.read` / `run.scratchpad.elevate` (`application.mjs:12654-12655`) — there
  is no `run.scratchpad.append`/`write` verb. The store's worker write lane (`writeScratchpad`,
  `coordination-store.mjs:14130`) hard-binds the scope: `const scope = \`worker:${fields.workerId}\``
  (`:14169`), and the worker partition has a hard cap `MAX_SCRATCHPAD_WORKER_ENTRIES` (`:14172`) — a
  bare `shared`-scope publish by a seat that is not a live worker is unwritable. The `shared` scope
  exists only via the elevation path (`:8383-8495`, `scope: 'shared'` at `:8440/8444/8463`), which
  requires an elevation source row. This is the exact #158 gap the foundry-brief names; the publish
  refusal is recorded in OQ1.

---

## Decisions

- **D1 — a parked-for-signal member is `blocked_interaction:*` and is therefore NEVER a quiescence
  candidate; the wave must wait for the wake, and the #181 fix is the un-park.** The folded #163's
  G11 already excludes `blocked_interaction:*` from the candidate predicate; the park states map to
  `blocked_interaction:answer_required` / `turn_checkpoint` (G5). This contract therefore does NOT
  add a new predicate leg for parked members — it pins the composition: **the parked member's
  quiescence status is `blocked_interaction:*` (never a candidate) AND its phase is in
  ACTIVE_TURN_PHASES (leg (c) also fails it)**, so the only way a wave containing a parked member can
  end is (a) the wake is delivered and the member acts (the #181 fix — correct the recipient filter
  at `workflow-interpreter.mjs:791` so the signal reaches the coordinator it is addressed to), or
  (b) an operator interaction resolves it, or (c) the D1.4 hard-break/totality rule fires for another
  member. **The predicate alone must NEVER declare `WAVE-QUIESCED` over a wave whose still-pending
  roster includes a parked member** — that would be a false quiescence exactly of the class the folded
  #163's G11 names.
- **D2 — the parked member is distinguishable from a dead member by the same fields the predicate
  already reads.** A parked member reads `progressClass: 'blocked_interaction:*'` and
  `phase: 'working'` (canonical, G5); a dead-but-readable member reads `progressClass:
  'terminal:*'` (G3) or a terminal phase; an unreadable member reads `{ phase: null, terminal: false }`
  (the D1.4 totality rule's leg (a), contract-163.md G12). No new field is required to tell them
  apart — the composition contract is that the landed predicate and totality rule together cover
  parked (never candidate, wave waits), terminal (leaves `pending`, G1/G6 of the folded contract),
  unreadable/phase-stuck (totality rule), and nothing is left to the clock.
- **D3 — a retrying member (#201) must read as an active-turn member, never a candidate, for the
  duration of a legitimate retry.** The folded #163's leg (c) (`phase NOT IN ACTIVE_TURN_PHASES`)
  is the structural gate: the landed `#201` state machine must place an actively-retrying member's
  canonical phase inside `ACTIVE_TURN_PHASES` (`working` is the natural landing — the classify-then-
  resume classification precedes the resume, and the resume IS `working`), so leg (c) fails it as a
  candidate while the retry is live. Two consequences, both pinned here:
  - A retry's classify/resume events must be `_followCategory`-meaningful (recovery/integration kinds
    through `driver.recorded`, G4) so `lastProgress.at` advances and leg (a) also fails — the retry
    is evidence of life, not silence.
  - A retry that never resolves is the **D1.4 totality-rule leg (b) case**: phase in
    `ACTIVE_TURN_PHASES` while `progressClass === 'silent'` and neither phase, `lastProgress.at`, nor
    `progressClass` advanced for N consecutive polls → terminalized-unrecoverable. The retry state
    must NOT be excluded from that rule — a forever-retrying member is a phase-stuck member, and the
    wave must end via the totality rule, never hang on a retry loop.
- **D4 — a silent-but-working member is protected by the phase gate, and this is the operator law
  the folded #163 already records.** "Silence is not even weak evidence of death for silent-turnless
  workers" (contract-163.md G11/D3.2): a member mid-turn in an active phase with
  `progressClass === 'silent'` (silence ≥ 120 s, G3) is NEVER a candidate because leg (c) fails it.
  This contract adds nothing to that law for the single-member case; the composition obligation is at
  the WAVE level: **`WAVE-QUIESCED` may only be declared when EVERY still-pending member is a
  candidate under all three legs.** A wave whose only silent members are silent-but-working (active
  phase) is a wave that keeps driving, and its termination path is the totality rule (phase-stuck
  only after N no-advance polls) or genuine quiescence (members that have left the active phases and
  sit silent).
- **D5 — the wake/quiescence coherence rule (the three-way composition).** At any poll, the
  still-`pending` roster is partitioned by the predicate inputs:
  - `blocked_interaction:*` (parked-for-signal, D1) → never a candidate → the wave waits;
  - `terminal:*` → leaves `pending` (G1 folded), no composition issue;
  - active-turn phase (`phase ∈ ACTIVE_TURN_PHASES`), `progressClass` any of
    `progressing`/`silent`/`blocked_interaction:*` → never a candidate by leg (c) (and for
    `blocked_interaction:*` also by leg (b)) → the wave waits;
  - `progressClass === 'silent'` AND `phase NOT IN ACTIVE_TURN_PHASES` → candidate, subject to the
    D1.3 two-poll confirmation and the D1.4 totality rule.
  A wave reaches `WAVE-QUIESCED` only when the fourth bucket is the ENTIRE still-`pending` roster at
  two consecutive polls (D1.3) and no member is unreadable/phase-stuck (D1.4). **This partition is
  closed over the three member kinds the row brief names** — parked-for-signal (#181), retrying
  (#201), silent-but-working — and over the dead/terminal and unreadable cases; there is no state a
  member can be in that the predicate+totality pair does not classify.
- **D6 — judgment call (recorded): the retry state's canonical phase.** The #201 row brief pins
  classify-then-resume but does not name the canonical phase for an actively-retrying member. This
  contract resolves it to `working` (an ACTIVE_TURN_PHASES member), because (a) the resume leg of a
  retry is indistinguishable from ordinary `working` work, (b) `paused` is excluded from
  ACTIVE_TURN_PHASES by the folded #163's boundary judgment (a suspended run cannot emit without a
  resume), and a retry is NOT a suspension, and (c) any other choice (a dedicated `retrying` phase)
  would require amending `ACTIVE_TURN_PHASES` and the canonical phase vocabulary — an authority-class
  boundary this row does not own. **If the #201 row brief or the coordinator requires a distinct
  `retrying` phase, that is a DECISION_REQUEST UP with two options** (keep `working` + a
  `state: 'retrying'` field riding the outline, vs. add `'retrying'` to `ACTIVE_TURN_PHASES` and the
  canonical vocabulary).
- **D7 — the coarse `stopped` terminal on wave close is not a quiescence verdict, and the receipt
  must say so.** A parked-for-signal member stopped by `wave.close()` (G9) receipts `stopped` — the
  coarse terminal the lane-proof landing-note records (#182's class). This contract pins: a wave that
  closes with a still-parked member is `WAVE-INCOMPLETE` over the `manifestDigest` basis (the D1.5
  verdict mapping of the folded #163), NEVER `WAVE-QUIESCED` — the wave did not quiesce; it closed
  over a member whose wake never arrived. The #182 contract is the sibling that names the cause; this
  contract only requires the verdict not to lie about the reason the wave stopped.

---

## Refusal vocabulary

This rung introduces NO new refusal code. It adds NO new evidence line (the folded #163 already owns
`wave_quiesced` and `wave_terminalized_unrecoverable`). The composition is expressed through the
EXISTING closed vocabulary:

| Code / value | Kind | Source | Context |
|---|---|---|---|
| `blocked_interaction:<detail>` | progressClass value | `application.mjs:507-522` (detail at `:494-503`) | The park state's honest class: `answer_required`/`approve_plan`/`select_candidate`/`turn_checkpoint` (G3/G5). This contract treats it as the parked member's read — never a candidate (D1). |
| `terminal:<cause>` | progressClass value | `application.mjs:507-522` | The dead-but-readable member's class; the folded #163's D1.4 hard-break / G6 terminal-removal governs it. |
| `stopped` | terminal phase | `APPLICATION_RUN_TERMINAL_PHASES`, `application.mjs:161` | The wave-close teardown terminal (G9). NOT a quiescence verdict (D7). |
| `{ evidence: 'wave_quiesced' }` | named evidence line | folded #163, new at that rung | Pushed only when the D5 partition is entirely bucket-4 for two consecutive polls. This contract asserts the precondition (no parked/retrying/active member may be present). |
| `{ role, evidence: 'wave_terminalized_unrecoverable' }` | named evidence line | folded #163, new at that rung | The D1.4 totality-rule terminalization of an unreadable or phase-stuck member (G1). A forever-retrying member (D3) and an unreadable member ride this line. |
| `stuck_handled` → `WAVE-INCOMPLETE` | exit + verdict | `workflow-interpreter.mjs:800-804` (existing early-break), folded #163 D3.3 | A decision-stuck roster is never `WAVE-QUIESCED`; preserved verbatim, evaluated before the quiescence check. |

The closed vocabulary is complete: this rung adds no code and no evidence line; it constrains when
the folded #163's two evidence lines may fire (D5) and requires the verdict to name the true reason
(D7).

---

## Red-first acceptance pins

RED = fails at HEAD (`09200e9`); GREEN = passes after this rung AND the folded #163 rung land
together (this rung composes against the landed predicate; the two rungs are mutually dependent —
a pin here is green only once both land). Each pin asserts behavior, not implementation. "Named
stages" refer to the folded #163's stage names where the assertion lives.

| Pin | Assertion | At HEAD |
|---|---|---|
| **C1** *(stage: D1.1 candidate predicate)* | A wave whose only still-`pending` member is **parked-for-signal** — `progressClass: 'blocked_interaction:*'` (e.g. `blocked_interaction:answer_required` via `input_required`, G5) — is NOT declared `WAVE-QUIESCED` at any number of silent polls: the parked member is never a candidate (G11/D1). The wave either receives its wake (the #181 fix: the corrected recipient filter at `workflow-interpreter.mjs:791` delivers the coordinator-addressed signal) or ends via the totality rule / hard-break / operator resolution — never by quiescence over a parked member. | **RED** — no quiescence machinery exists at all (G1); worse, the parked member's wake is structurally lost at HEAD (G6: the inverted filter delivers the signal away from the coordinator). A today-impl that only added a bare `silenceMs >= windowMs` predicate would ALSO fail C1 (the parked member reads `blocked_interaction:*`, which a bare-silence predicate would wrongly accept) — the pin is not shallow-greenable by relabeling. |
| **C2** *(stage: D1.1 three-leg predicate — phase gate)* | A **silent-but-working** member — `progressClass: 'silent'` (silence ≥ 120 s, G3) with `phase ∈ ACTIVE_TURN_PHASES` (e.g. `working`, `uncertain`, `verifying`) — is NOT a quiescence candidate: leg (c) fails it. A wave whose still-`pending` roster is exactly such members keeps driving and never false-declares. | **RED** — no predicate exists; a bare-silence predicate that ignored the phase gate would declare a mid-turn member quiescent — the exact false-quiescence class the folded #163's G11/D3.2 names. |
| **C3** *(stage: D1.4 totality rule, leg (b) — phase-stuck)* | A **forever-retrying** member (the #201 classify-then-resume state never resolving) is terminalized-unrecoverable after N = confirmation-pair + 1 consecutive polls in which its phase stayed in `ACTIVE_TURN_PHASES`, `progressClass === 'silent'`, and neither phase/`lastProgress.at`/`progressClass` advanced — the wave receipts `WAVE-INCOMPLETE` with `{ role, evidence: 'wave_terminalized_unrecoverable' }`, never `WAVE-QUIESCED`, never a hang. | **RED** — no `retrying` state exists (G8), no totality rule exists, and the drive loop is clock-bounded (G1) — a forever-retrying member would be bailed out by `hardCapMs`, not terminated for cause. |
| **C4** *(stage: D1.5 honest verdict + D7)* | A wave that closes with a still-parked member (its wake never delivered) receipts `WAVE-INCOMPLETE` over the `manifestDigest` basis, NOT `WAVE-QUIESCED` — the coarse `stopped` terminal on that member (G9) is reported as the wave-close teardown, never as quiescence. | **RED** — `WAVE-QUIESCED` is not in the verdict enum (`verdict = everySettled && everyHarvested ? 'WAVE-OK' : 'WAVE-INCOMPLETE'`, `workflow-interpreter.mjs:628`), so the lying-verdict class cannot exist at HEAD; the pin asserts the LANDED state does not create it. |
| **C5** *(stage: D1.1 reset-set union + #181 wake)* | The **wake is a park-resolving event, not silence, and the predicate never mis-reads it as quiet**: a parked-for-signal member that receives its `signalOnMembersDone` wake (corrected #175 semantics — the named roles are the WATCHED rows, the remaining member is the recipient, `lch-contracts.wavefile:42`) resolves out of `blocked_interaction:*` and proceeds to work. The wake arrives via `run.message.send` → a `message.sent` coordination event (`coordination-store.mjs:13787-13790`), which is NOT `_followCategory`-meaningful and NOT in `REARM_KINDS` (G4) — so the wake alone does not advance `lastProgress.at`. What keeps the wave honest is the park class itself: while parked the member is `blocked_interaction:*` and never a candidate (D1), and once the wake resolves the park the member's subsequent meaningful act (the `task.transitioned`/execution event of resuming) advances `lastProgress.at` — the wake can neither be read as "the roster went quiet" (the member is never a candidate while blocked) nor as a false reset (the member's next act is genuinely meaningful). | **RED** — the wake never reaches the coordinator at HEAD (G6); no predicate exists to mis-read it. |
| **C6** *(stage: D1.3 two-poll confirmation)* | A member that flips `progressClass` out of `silent` between the candidate poll and the confirmation poll — a park resolving to an interaction answer, a retry resuming, a wake arriving — fails the confirmation and the wave continues: the parked/retrying/silent-but-working member's liveness is honored by the confirmation race exactly as the folded #163's D1.3 pins. | **RED** — no confirmation poll exists; no predicate exists. |
| **C7** *(stage: D5 closed partition)* | The still-`pending` partition at any poll is closed: every member is classified by the predicate inputs as (i) `blocked_interaction:*` (parked — never a candidate), (ii) `terminal:*`/terminal phase (leaves `pending`), (iii) active-turn phase (never a candidate), or (iv) silent-and-not-active (candidate) — with (i)/(iii) distinguished from (iv) purely by the fields the landed `readView` projects (`progressClass`, `phase`, `silenceMs`, `lastProgress.at`, G2/G3/G5), and the totality rule (D1.4) covering unreadable/phase-stuck. No member state falls outside the classification. | **RED** — the landed `readView` projection does not exist (G2), so the partition's inputs are not even available; `blocked_interaction:*` and active-turn phases are projected at the outline (G3/G5) but dropped by the interpreter seam. |

---

## Open questions

- **OQ1 — the `shared` scratchpad publish is not executable at this HEAD; the durable file is the
  only channel. REFUSAL RECORDED (evidence, #158).** The frame requires publishing the final draft to
  the `shared` scratchpad partition (`foundry-brief.md:23`; the wavefile's `messageOnSpawn`, this
  dir). Verified this session: the agent-facing scratchpad surface at HEAD is READ and ELEVATE only —
  `run.scratchpad.read` / `run.scratchpad.elevate` (`application.mjs:12654-12655`), and `grep -an`
  for `run.scratchpad.append|scratchpad_append` across `impl/` returns nothing. The store's worker
  write lane (`writeScratchpad`, `coordination-store.mjs:14130`) hard-binds
  `scope = \`worker:${fields.workerId}\`` (`:14169`) and refuses a non-worker seat
  (`auth?.actor !== 'worker'`, `:14132`) — a `shared`-scope publish by this seat is unwritable by
  construction. The `shared` scope exists only via the elevation path, which needs an elevation
  source row this session does not possess. This is the exact #158 gap; the coordinator-brief's
  durable-file fallback ("fall back to the durable files … where the shared post is absent", this
  dir) is satisfied by this file. The refusal is the evidence, not silence.
- **OQ2 — the retry state's canonical phase (D6) is a recorded judgment call with an escalation
  option.** If the #201 row brief (or the coordinator's cross-check) requires a distinct `retrying`
  phase rather than `working` + a `state` field, the canonical-phase vocabulary and
  `ACTIVE_TURN_PHASES` both change — an authority-class boundary this row does not own. Escalation
  path: DECISION_REQUEST UP with the two options (D6). Until resolved, this contract pins `working`.
- **OQ3 — does the parked-for-signal member's wait have a bound, and whose authority class sets
  it?** The folded #163 explicitly excludes `blocked_interaction:*` from the totality rule ("a
  genuine operator wait is a wave-level wait, not a stall" — contract-163.md D1.4 boundary judgment).
  This contract agrees: a parked member's wait is unbounded by the predicate, and the wave waits for
  the wake. But an unbounded wait on a LOST wake (the #181 class, G6/G7) is a forever-wave. The
  resolution is the #181 fix itself (the wake arrives) plus the D7 honesty (a wave closed over a
  still-parked member is INCOMPLETE, not QUIESCED) — NOT a new numeric stall bound. If the
  coordinator wants a bound on the park wait, that is a DECISION_REQUEST UP (the no-clocks / no-
  arbitrary-limits laws bind; any bound must be evidence-count-derived, never a wall clock).
- **OQ4 — the interaction between the totality rule and a park that resolves to `turn_checkpoint`.**
  A `paused` member surfaces `turn_checkpoint` (G5), which `progressBlockedDetail` classifies as
  `blocked_interaction:turn_checkpoint` (`application.mjs:501`). The #67 stall watchdog and the
  drive loop's checkpoint handling (`workflow-interpreter.mjs:773-774`) nudge/claim that checkpoint.
  This contract treats the paused member as `blocked_interaction:*` (never a candidate, D1). Whether
  a `turn_checkpoint` member that is neither nudged nor claimed for the totality-rule N should be
  phase-stuck-terminalized is left OPEN — it is a `paused` member (excluded from ACTIVE_TURN_PHASES
  by the folded boundary judgment), and the checkpoint machinery is a live wave-driver concern the
  coordinator-brief may want pinned. Default posture: a `turn_checkpoint` park is an operator wait
  like any other, never terminalized by this rung.
- **OQ5 — the receipt's per-member quiescence evidence fields.** The folded #163's OQ5 pins the
  declaration snapshot vs. the preOutcome re-read split (quiescence evidence named
  `quiescenceLastMeaningfulAt`/`quiescenceSilenceMs` per outcome; preOutcome is settlement evidence).
  This contract adds: for a wave that closes with a still-parked member (D7), the per-outcome fields
  must ALSO carry the park class (`progressClass: 'blocked_interaction:*'`, `phase: 'working'`) so a
  reviewer can distinguish "closed over a parked member" from "quiesced." The exact field shape rides
  the #163 landing and the #182 contract's cause vocabulary; kept open here, pinned as a requirement.

---

## Cross-references

- **`row-quiescence-compat.md`** (this dir) — the row brief: the wake/quiescence coherence contract
  over parked (#181), retrying (#201), and silent-but-working members; evidence = the folded contract
  + the day's six coordinator-lifecycle instances (G7).
- **`foundry-brief.md`** (this dir) — the shared frame: Ring-2 form, no clocks, verified citations,
  NUL discipline, publish-or-refuse (#158 → OQ1).
- **`contract-163.md`** (`contract-foundry-2026-08-13/`, v2) — the folded quiescence contract this
  rung composes against: D1.1 three-leg predicate + reset-set union, D1.2 window derivation, D1.3
  confirmation, D1.4 hard-break + totality rule, D1.5 verdict shape, G11 liveness floor, D3.2
  re-wake law, OQ1/OQ5 precedents.
- **`channel-audit-2026-08-13/channels.md`** §4 — the #181 root cause citation (inverted recipient
  filter at `workflow-interpreter.mjs:791`; the coordinator-addressed signal delivered to the rows).
- **`lane-proof-2026-08-13/landing-note.md`** — the sixth coordinator-lifecycle instance; the coarse
  `stopped` terminal class (#182's class); the corrected #175 semantics the wavefiles pin.
- **#67 stall-watchdog** — `REARM_KINDS` (`coordinator.mjs:71-76`), `_observeWatchdogEvent`
  silence-return (`:9681`), `PROGRESS_SILENCE_THRESHOLD_MS` (`application-semantics.mjs:54`) — the
  member-level liveness law the folded #163 mirrors at wave level.
- **`contract-death.md`** / **`contract-retry.md`** (sibling rows, this dir) — the #182 and #201
  contracts; D3 and C3 of this contract name their landing seams.

## Campaign-law constraints

- **No clocks.** This contract adds no time mechanism. The parked member's wait (OQ3) is unbounded
  by the predicate; the retry's totality-rule N is the folded #163's evidence count
  (confirmation-pair + 1); the 120 s `PROGRESS_SILENCE_THRESHOLD_MS` is the existing cited semantic
  constant (G3), not a new control.
- **No arbitrary numeric limits.** No new numeric constant is introduced. The retry's N and the
  window floor are the folded #163's evidence-count constants, cited not re-specified.
- **No redesign of landed SOUND law.** The stuck-decision early-break (`workflow-interpreter.mjs:
  800-804`), the meaningful-event semantics (`_followCategory`), the #67 liveness kinds, and the
  park-state attention mapping (G5) are all cited, never re-litigated. The composition adds
  constraints, not new machinery.
- **Ring-2 form.** This contract specifies behavior; it does not amend implementation. Every
  `file:line` citation was verified at HEAD `09200e9` this session (G1–G10).
- **Deliverable boundary.** The sole deliverable is
  `docs/reference/evidence/lch-contracts-2026-08-14/redrive/contract-quiescence-compat.md` (this
  file). Work was confined to `docs/reference/evidence/lch-contracts-2026-08-14/redrive/**`. No
  source files were modified.
