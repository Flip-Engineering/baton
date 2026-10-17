[attempt: 15c11102-ef3b-4c25-8161-8e283cb31eff row-quiescence-compat]

# The WAKE/QUIESCENCE COHERENCE contract — quiescence-compat (package ④ lifecycle-honesty)

The composition contract for the folded #163 quiescence predicate. The folded contract
(`docs/reference/evidence/contract-foundry-2026-08-13/contract-163.md`, v2+fold) is honest under a
silent assumption: **a member's silence is member-owned evidence.** Three wave-lifecycle states
break that assumption — a member **parked for a signal** (#181: its wake is a wave-internal
delivery the wave itself owes), a member **retrying** (#201: its silence is recovery-owned, a
re-drive scheduled behind a deployment-owned budget), and a member **silent-but-working** (the
operator law: silence is not even weak evidence of death for silent-turnless workers). This
contract specifies how those three states compose with the quiescence candidate predicate
(`progressClass`/liveness gating per the folded #163 D1.1) and extends the totality rule so the
composition is CLOSED — every member state maps to exactly one predicate class, and the drive
loop terminates for every state with no clock.

- **Date:** 2026-08-14 · **Row:** `row-quiescence-compat` · **Wave:** `lch-contracts-2026-08-14-wave-b-rd1`
- **Version:** v1 (first redrive row pass; fold-record-ready).
- **Status:** DRAFT — implementation contract (Ring-2: specifies behavior, amends no code).
- **Verification HEAD:** `09200e97c1be113946459d901c8fab56034d8a1f`. Every `file:line` citation
  below was verified THIS session with `grep -an`/`sed -n` at this HEAD. NUL discipline held: the
  two NUL-bearing anchors (`application.mjs`, `coordination-store.mjs`) were grep/sed-verified,
  never whole-file read. `workflow-interpreter.mjs`, `coordinator.mjs`,
  `application-semantics.mjs` were read directly.
- **Briefs:** `row-quiescence-compat.md` (this row — read fully), `foundry-brief.md` (redrive dir,
  read first). NOTE ON THE FRAME: the redrive `foundry-brief.md` still names the wave-A rows
  (`row-lc-fs`…`row-lc-ledger`); the wavefile (`lch-contracts.wavefile:9-36`) and the row briefs in
  this dir govern the actual redrive rows (`row-wake`, `row-death`, `row-retry`,
  `row-quiescence-compat`). Recorded as a frame discrepancy, not a refusal ground.

---

## Ground truths (verified this session at HEAD `09200e9`)

- **QC1 — the folded predicate's legs and its park ruling.** The folded #163 candidate predicate is
  three legs: `silenceMs >= windowMs` AND `progressClass === 'silent'` AND phase NOT IN
  `ACTIVE_TURN_PHASES` (`contract-163.md:183-194`). Its `ACTIVE_TURN_PHASES` ruling: "`paused`/
  `interrupted` are NOT active-turn (a suspended run cannot emit without a resume); they are
  governed by `progressClass` alone (blocked-on-interaction → never a candidate; silent-and-
  unblocked → candidate)" (`contract-163.md:202-206`). The totality rule covers exactly two legs —
  (a) unreadable, (b) phase-stuck — at N = confirmation-pair + 1 = 3 polls
  (`contract-163.md:286-309`, the operator-wait boundary at `:304-309`). This contract composes with, and extends, that predicate; it does
  not re-derive its window or confirmation law.
- **QC2 — a parked turn renders phase `paused`, and the park states are durable.** The durable task
  state machine parks at `input_required` and `paused`: `['working', new Set(['input_required',
  'paused', 'completed', 'failed', 'cancelled'])]`, `['input_required', new Set(['working',
  'failed', 'cancelled'])]`, and `['paused', new Set(['working', 'failed', 'cancelled'])]`
  (`coordination-store.mjs:139-144`; the `paused` comment: "a turn checkpoint parked pending a
  steering decision … a parked task must stay terminalizable by run stop / fleet drain",
  `:141-144`). The run-phase derivation renders a parked node honestly: `: node?.state ===
  'paused' ? 'paused'` under the comment "a parked turn is neither finished nor merely `running`;
  rendering it `running` is the dishonest projection the spec forbids"
  (`application.mjs:5852-5855`).
- **QC3 — NO attention kind covers a wave-internal message wait, so a parked-for-signal member
  reads `silent`.** The closed attention vocabulary is `CANONICAL_ATTENTION_KINDS =
  Object.freeze(['candidate_selection', 'answer_question', 'answer_approval', 'answer_decision',
  'turn_checkpoint', 'session_preservation', 'workflow_revision', 'workflow_recovery'])`
  (`application-semantics.mjs:29-35`) — no message-wait kind exists. `progressBlockedDetail`
  gates ONLY on `awaiting_plan_approval`/`selection_required` phases and
  `answer_question`/`answer_approval`/`answer_decision`/`turn_checkpoint` attention
  (`application.mjs:494-505`). Therefore a member parked awaiting a wave-internal signal — no
  operator attention, no gate phase — has `progressBlockedDetail === null`, and
  `projectProgressClass` classes it `silent` once `silenceMs >= 120_000`
  (`application.mjs:519-521`; `PROGRESS_SILENCE_THRESHOLD_MS = 120_000`,
  `application-semantics.mjs:54`). Under the folded predicate (QC1) with phase `paused`
  (QC2), that member is a **quiescence candidate**: the folded contract cannot distinguish
  "silent because dead/idle" from "silent because parked waiting for a delivery the wave itself
  owes."
- **QC4 — the wave's wake channels are best-effort, and delivery is durably receipted.** The
  `signalOnMembersDone` send wraps `run.message.send` in a swallow: `try { await
  handle._command('run.message.send', …) } catch { /* the recipient may already be terminal — the
  signal is best-effort */ }` (`workflow-interpreter.mjs:791-796`). `messageOnSpawn` bursts ≤3
  attempts against a DELIVERED `messageId` (`delivered > 0`), and on budget exhaustion pushes the
  named evidence line `steering.push({ role, evidence: 'steering_message_undelivered' })` — keyed
  by `evidence` only (`workflow-interpreter.mjs:818-849`, the line at `:845`). The store
  receipts message traffic durably: `message.sent` / `message.delivered` events
  (`coordination-store.mjs:8872`) and the BD3-C append-only lane audit receipts "message.sent /
  message.delivered" (`:13787-13790`). So the wave can ALWAYS tell delivered from undelivered —
  the arming/resolution data for a wake exists; nothing reads it at the (unlanded) quiescence
  seam.
- **QC5 — the campaign evidence: six coordinator-lifecycle instances of the turn-ended-before-
  delivery class, plus the recipient inversion and PARKED-FOREVER vocabulary.** The row-wake brief
  seeds it: "SIX instances today: signal recipients' turns ended before delivery —
  blue-team-b/suite-c/pm/dsh coordinators + lane-proof" (`row-wake.md:5`). Verified instances:
  the pm-comparison coordinator "wrote `pm-qa.md` BEFORE the rows' work was visible to it … the
  correct fallback, and the #181 lifecycle gap's fifth instance" (`pm-comparison-2026-08-13/
  landing-note.md:8`); the lane-proof "first correctly-addressed signal — and the coordinator's
  turn had already ended (the #181 lifecycle gap's sixth instance)" (`lane-proof-2026-08-13/
  landing-note.md:15`). The channel audit records the recipient inversion — the interpreter
  signals the complement of `signalRoles` (`workflow-interpreter.mjs:787-791` at this HEAD) and
  the coordinator "never received the signal it was briefed to wait for"
  (`channel-audit-2026-08-13/channels.md:157-191`). The lane-proof row verdict vocabulary names
  the failure shape: "PARKED-FOREVER (no answer, no escalation, no timeout honesty)"
  (`lane-proof-2026-08-13/row-lane-decision.md:26`). The dsh row pins the member-side analog:
  "a parked member is not woken on a signal either" (`dsh-comparison-2026-08-13/dsh-lifecycle.md:
  121-122`).
- **QC6 — no run-level retry state exists at HEAD.** `grep -an "retrying"` across
  `application.mjs`, `coordination-store.mjs`, `workflow-interpreter.mjs`, `coordinator.mjs`
  returns ZERO hits (verified this session). The store's retry vocabulary is context-effect retry
  (`context_retry_not_eligible`, `coordination-store.mjs:6051`; `context_child_failed` with
  `retryable: true`, `:7165-7166`) and verification retry (`run.verification_retry_admitted` /
  `run.verification_retry_completed`, `:8793-8799`) — neither is the durable member retry #201
  contracts. The event-category seam a retry SHOULD ride exists and is already meaningful:
  `driver.recorded` events whose payload kind starts `recovery.` classify `'recovery'` in
  `_followCategory` (`application.mjs:8032-8034`) — a recovery-category event advances
  `lastProgress.at` and resets the quiescence watch today, with zero changes.
- **QC7 — FOUND DEFECT in the folded #163: its `ACTIVE_TURN_PHASES` derivation names a set whose
  vocabulary does not include the phase an ordinary working member actually reads.** The folded
  contract derives the set from `CANONICAL_RUN_PHASES` (`contract-163.md:195-206`), which is
  `['planning', 'awaiting_approval', 'queued', 'working', 'paused', 'interrupted', 'uncertain',
  'verifying', 'result_ready', 'awaiting_selection', 'result_selected', 'reviewing',
  'integrating', 'completed', 'failed', 'cancelled', 'stopped', 'denied', 'stopping']`
  (`application-semantics.mjs:20-26`). But the run-phase derivation the outline actually carries
  emits **`'running'`** (`: node?.taskId ? 'running' : 'approved'`, `application.mjs:5855`) — and
  also `'approved'` (`:5855`), `'interruption_uncertain'` (`:5862-5864`), `'planning_failed'`
  (`:5769`), none of which are in `CANONICAL_RUN_PHASES`. A working member mid-turn therefore
  reads phase `'running'`, which the folded set does NOT contain — the phase leg of the folded
  predicate does not gate it, and it falls through to the bare `progressClass` leg. This is
  exactly the silent-but-working hole the fold's B1 was written to close. The dsh row's R5 is the
  same seam from the evidence side: "an attempted no-step turn (C3) is not distinguished from pure
  silence: the log has no `lifecycle.turn_attempted` row, so an empty member and a dead member
  read identically to the #67 evidence gate" (`dsh-comparison-2026-08-13/dsh-lifecycle.md:
  402-403`). Escalated as DECISION_REQUEST-QC7 below.
- **QC8 — the meaningful-event and silence machinery this contract composes with (cited, not
  re-specified).** `_followCategory` (`application.mjs:8012-8041`) with the noise exclusion
  `NOISE_TELEMETRY_OPERATIONAL_KINDS = new Set(['content.tool_call', 'content.message'])`
  (`:85`, applied at `:8020`); `_progressTiming` computes `lastProgress.at` from the last
  meaningful run-attributed event and `silenceMs: terminal ? 0 : boundedDuration(observedMs,
  lastMs)` (`application.mjs:8139-8190`, the silence arm at `:8186`); the outline spreads the
  timing and carries `progressClass` (`const timing = this._progressTiming(current, view)` at
  `:11043`, `...timing` at `:11052`, `progressClass: clone(view.progressClass ?? null)` at
  `:11061`).
- **QC9 — RED premises at HEAD: the loop is still clock-bounded and the projected fields are
  still dropped.** The drive loop condition is `while (pending.size > 0 && Date.now() - startedAt
  < driver.hardCapMs)` (`workflow-interpreter.mjs:783`); the production cadence still ships the
  3h cap (`PRODUCTION_WORKFLOW_DRIVER = Object.freeze({ pollIntervalMs: 20_000, stallTimeoutMs:
  20 * 60_000, hardCapMs: 3 * 3_600_000 })`, `application.mjs:117-119`; facade default at
  `:11670`). `readView` returns the closed shape `{ phase, actions, attention, taskId, workerId,
  planDigest, task, terminal, terminalStatus }` (`workflow-interpreter.mjs:442-476`) — no
  `lastProgress`/`silenceMs`/`progressClass` (the folded B3 projection is unlanded). The verdict
  enum is exactly two values, `everySettled && everyHarvested ? 'WAVE-OK' : 'WAVE-INCOMPLETE'`
  (`:628`), and the receipt is the seven sorted keys `{ basis, harvest, manifestDigest,
  outcomes, steering, verdict, waveId }` (`:631-639`).
- **QC10 — a parked member cannot re-arm itself; re-arm is delivery-owned.** The #67 liveness
  re-arm set is `REARM_KINDS = Object.freeze(['approval.resolved', 'decision.settled',
  'lifecycle.turn_started', 'question.answered'])` (`coordinator.mjs:71-76`); everything else is
  silence (`if (!REARM_KINDS.includes(event.kind)) return; // EVERYTHING ELSE IS SILENCE`,
  `coordinator.mjs:9681`, the watch hook at `:9231`). `lifecycle.turn_started` is stamped by the
  worker/orchestrator at turn start (`coordinator.mjs:2524`, `:3783`) — a parked member emits
  nothing; only a delivered wake (or an operator answer) can start its next turn. The
  silent-but-working and parked classes therefore share one structural fact: their liveness is
  invisible to event-kind inspection, which is why the predicate's structural legs (phase, arm,
  budget) — not elapsed silence — must carry the decision.

---

## D1 — the ownership law (the composition principle)

The folded predicate may treat a member's silence as death-evidence ONLY for silence the member
owns. Silence owned by the **wave** (an armed wake the wave owes the member), by **recovery** (an
armed retry behind a deployment-owned budget), or by the **provider** (mid-turn generation) is
never candidate-evidence. Formally, the candidate predicate of the folded #163 D1.1 gains a fourth
leg:

- **Leg 4 — no wave-owed obligation is ARMED against the member**: no undelivered wake within its
  delivery budget names this member recipient (D2), and no retry with unexhausted budget is armed
  for it (D3).

Legs 1–3 (silence window, `progressClass === 'silent'`, phase gate) are the folded contract's,
unamended except for the D4 vocabulary repair. The predicate remains live only under the folded
D2.4 gate (`driver.hardCapMs === null`).

## D2 — parked-for-signal × quiescence (#181 composition)

- **D2.1 — armed wake ⇒ never a candidate.** A wake is ARMED for member M when the wave owes M a
  delivery: an in-budget `messageOnSpawn` attempt (attempts < 3, no delivered receipt yet,
  `workflow-interpreter.mjs:822-848`), or a `signalOnMembersDone` that has either not yet fired
  (its role condition unmet) or fired without a `message.delivered` receipt for M (QC4). While a
  wake is armed for M, M is NEVER a quiescence candidate regardless of `silenceMs` — M's silence
  is the wave's own delivery debt (the lane-proof class: a correctly-addressed signal whose
  recipient's turn had already ended, QC5). The park visibility M surfaces (phase `paused`, QC2;
  and whatever park record row-wake's rung lands) is CONSUMED here; row-wake produces it — this
  contract pins only the predicate-side seam.
- **D2.2 — arm resolution is event-derived.** An arm resolves DELIVERED (a `message.delivered`
  receipt names M — which also resets the quiescence watch at event level, the folded A3 union, or
  via the `lifecycle.turn_started` the delivered wake provokes, QC10) or REFUSED (the budget
  exhausts and the existing named line `steering_message_undelivered` lands,
  `workflow-interpreter.mjs:845`; or the signal send's swallow at `:795-796` is superseded by a
  typed refusal per row-wake's rung). A refused arm no longer protects M: M returns to the bare
  three-leg predicate.
- **D2.3 — totality leg (c): the orphaned park.** The totality rule of the folded D1.4 gains a
  third leg. A still-pending member is terminalized-unrecoverable — via the SAME D1.4 exit, `N =
  3` consecutive polls (the folded evidence-count; no new constant) — when it is parked (phase
  `paused` per QC2, or the landed park record), an arm WAS armed for it, the arm's condition is
  settled-false (REFUSED, or fired-without-delivery-receipt), and no re-arm occurred across those
  N polls. The exit reuses `wave_terminalized_unrecoverable` verbatim with one additive closed
  detail: `cause: 'unreadable' | 'phase_stuck' | 'orphaned_park'` (the first two name the folded
  legs (a)/(b); the detail is additive, never a new code). PARKED-FOREVER is thereby structurally
  impossible at the wave level: a park the wave cannot satisfy becomes an honest terminal with
  evidence, not an eternal wait (`row-lane-decision.md:26`).
- **D2.4 — the operator park stays a wave-level wait (boundary preserved).** A member blocked on
  operator interaction (`blocked_interaction:*` per `progressBlockedDetail`,
  `application.mjs:494-505`) remains never-candidate and NOT totality-covered — the folded #163's
  recorded judgment (`contract-163.md:305-309`), not re-litigated here. The distinguisher between
  an operator park and a signal park is ownership: attention-kind gating (operator) vs armed
  delivery (wave). The predicate reads both — they are different legs.

## D3 — retrying × quiescence (#201 composition)

- **D3.1 — armed retry ⇒ never a candidate; the roster says so.** While a retry is ARMED for M
  (the #182 classifier returned retryable, the budget is unexhausted, the content-addressed
  re-drive is pending), M is NEVER a quiescence candidate: M's silence is recovery-owned. This is
  the predicate-side half of #201's "the roster shows `retrying` honestly" (`row-retry.md:5`) —
  the retry contract owns the ledger and the budget; this contract pins that the predicate READS
  it (the compatClass of D6).
- **D3.2 — retry transitions reset the watch at event level.** The retry-arm and the resume must
  land as meaningful events in the coordination log the timing projection already reads — the
  `recovery` category exists for exactly this shape (`driver.recorded` with a `recovery.`-prefixed
  payload kind classifies `'recovery'`, `application.mjs:8032-8034`, QC6), and the failure being
  classified is itself already meaningful (`task.transitioned` → `'execution'`,
  `run.stop_*` → `'cleanup'`, `application.mjs:8014-8027`). The classify gap (failure → arm) is
  covered twice: the failure event resets the watch, and leg 4 covers the arm. A retry backoff is
  NEVER expressible as waiting-out `silenceMs` — the budget is deployment-owned and event-counted,
  never a clock (campaign law).
- **D3.3 — exhausted retry leaves the never-candidate class (cross-contract boundary).** An
  exhausted retry MUST terminalize via the death contract's machinery (#182 suspicionClass — e.g.
  `watchdog_stall`/`provider_refusal` with retries exhausted) or otherwise resolve out of the
  armed state. A member that stays armed-forever on an exhausted budget is a coherence defect:
  leg 4 would make it a permanent never-candidate and hang the uncapped loop. This contract pins
  the boundary condition — **the armed class is finite by construction** — and the coordinator QA
  cross-checks it against `contract-retry.md`/`contract-death.md` (OQ2).

## D4 — silent-but-working × the vocabulary repair (QC7)

- **D4.1 — `ACTIVE_TURN_PHASES` is derived from the OBSERVED view-phase vocabulary, closed and
  named.** The set is the complement of the terminal and parked/operator-gated phases within the
  vocabulary the run-phase derivation actually emits (`application.mjs:5846-5862`, QC7), union the
  folded set. Concretely: `{ 'planning', 'approved', 'running', 'queued', 'working', 'uncertain',
  'interruption_uncertain', 'verifying', 'result_selected', 'reviewing', 'integrating',
  'stopping' }` plus the folded set's members that are observable. `running` (the ordinary
  working phase) and `approved` are active-turn; `interruption_uncertain` is active-turn (an
  attached-controllable worker may resume emission — fail-safe to never-candidate, with the
  phase-stuck leg (b) as the removal path). `paused`/`interrupted` stay NON-active (the folded
  ruling, QC1) — governed by `progressClass` plus D2's arm leg.
- **D4.2 — the sync law and the fail-safe direction.** The set's derivation is documented at
  module scope and must stay in sync with BOTH vocabularies — `CANONICAL_RUN_PHASES`
  (`application-semantics.mjs:20-26`) and the view-phase derivation (`application.mjs:5846-5862`).
  A phase NOT in the closed set is never a candidate (fail-safe toward never-candidate): an
  unknown phase must not manufacture a death verdict from silence — the operator law (QC10, and
  the folded `contract-163.md:449-456`). The cost of the fail-safe direction is totality-rule
  dependence, which legs (a)–(c) pay: any never-candidate state that cannot advance is
  terminalized on evidence counts, so the loop still terminates for every state, with no clock.

## D5 — the composition closure law (the coherence deliverable)

Every still-pending member state maps to EXACTLY ONE class, and the map is closed:

| State | Predicate class | Removal path if it never advances |
|---|---|---|
| active-turn (any D4.1 phase) incl. silent-but-working | never-candidate | totality leg (b) phase-stuck (folded) |
| parked, operator-gated (`blocked_interaction:*`) | never-candidate | none — wave-level wait (folded judgment, preserved) |
| parked-for-signal, wake ARMED | never-candidate (leg 4) | arm resolves (D2.2) or totality leg (c) orphaned-park |
| retrying, retry ARMED | never-candidate (leg 4) | resume (D3.2) or exhaustion → #182 terminalization (D3.3) |
| unreadable (`{ phase: null, terminal: false }`) | never-candidate | totality leg (a) (folded) |
| terminal (success) | leaves `pending` | — (`workflow-interpreter.mjs:780`) |
| terminal (unrecoverable) | hard-break | — (folded D1.4) |
| otherwise: silent, unowned, unparked, non-active phase | **candidate** | declaration (folded D1.3) |

No state is simultaneously candidate and wave-owed (leg 4 forbids it), and no never-candidate
state is non-totality-covered except the deliberate operator wait. This table IS the "keeps the
three honest about each other" deliverable: wake, retry, and work-liveness each get one predicate
class and one bounded exit.

## D6 — receipt honesty

The folded D1.5 receipt shape is preserved verbatim — EXACTLY the seven sorted keys `['basis',
'harvest', 'manifestDigest', 'outcomes', 'steering', 'verdict', 'waveId']`
(`workflow-interpreter.mjs:631-639`; F14). The compat state rides ADDITIVELY: each `outcomes[]`
entry may carry `compatClass` — a closed enum, `'{ active_turn, orphaned_park, parked_operator,
parked_signal, retrying, silent_candidate, terminal, unreadable }'` in ACTUAL sorted order — the
member's class at declaration/totality, so a `WAVE-QUIESCED` or `WAVE-INCOMPLETE` receipt
distinguishes "quiet and unowned" from "stranded park" / "mid-retry" without a new top-level
field. The `wave_terminalized_unrecoverable` line carries its closed `cause` detail (D2.3).

---

## Refusal vocabulary

This rung introduces NO new refusal code. It reuses the folded vocabulary (`wave_quiesced`,
`wave_terminalized_unrecoverable`, `steering_message_undelivered`) and adds only closed enums:

| Code / value | Kind | Source | Context |
|---|---|---|---|
| `{ evidence: 'wave_quiesced' }` | named evidence line | reused (folded #163) | Unchanged. |
| `{ role, evidence: 'wave_terminalized_unrecoverable', cause }` | named evidence line + CLOSED additive detail | reused + extended | `cause ∈ { 'unreadable', 'phase_stuck', 'orphaned_park' }` — additive field on the folded line, never a new code; `orphaned_park` is D2.3's leg (c). |
| `{ role, evidence: 'steering_message_undelivered' }` | named evidence line | existing (`workflow-interpreter.mjs:845`) | The refused-arm resolution of D2.2 — consumed, not changed. |
| `compatClass` | closed enum | new (additive `outcomes[]` field, D6) | `'{ active_turn, orphaned_park, parked_operator, parked_signal, retrying, silent_candidate, terminal, unreadable }'` — never a free string. |
| `ACTIVE_TURN_PHASES` | closed set | repaired (D4.1) | Derived from the observed vocabulary; the sync law (D4.2) governs changes. |

The vocabulary is complete: two additive closed enums and one additive detail field on an existing
evidence line. No new verdict-field grammar; the `WAVE-QUIESCED`/`WAVE-INCOMPLETE`/`WAVE-OK`
verdicts and their bases are the folded contract's.

---

## Red-first acceptance pins

Named stages: **STAGE-POLL** (the `driveLane` per-poll candidate predicate),
**STAGE-SIGNAL** (the `signalOnMembersDone` send loop, `workflow-interpreter.mjs:786-798`),
**STAGE-DECLARATION** (the folded two-poll confirmation + receipt build, `:603-639`),
**STAGE-TOTALITY** (the folded D1.4 exit), **STAGE-SUITE** (the red suites under
`LANE_DRIVER`). RED = fails at HEAD `09200e9`; GREEN = passes only for a correct impl. Every pin
carries a counterexample that kills its shallow-greenable form.

| Pin | Stage | Assertion | At HEAD |
|---|---|---|---|
| **Q1** | STAGE-POLL | A member with an ARMED wake (in-budget `messageOnSpawn` attempt, or an unfired/undelivered `signalOnMembersDone` naming it recipient) is NEVER a quiescence candidate, at any `silenceMs`; a wave whose only remaining member is such is NOT declared `WAVE-QUIESCED`. **Counterexample (kills the blanket-park greenability):** a member parked with NO arm, `progressClass === 'silent'`, non-active phase, past the window IS a candidate — a rule that makes all parks never-candidate fails here. | **RED** — no quiescence machinery exists (`:783` clock-bounded loop, QC9); no predicate leg reads the arm state (steering state `s.messaged`/`s.signaled`/store delivery receipts are never predicate inputs). |
| **Q2** | STAGE-SIGNAL | The best-effort swallow (`:795-796`) cannot silently strand: a signal that fired without a `message.delivered` receipt for a parked recipient, unresolved across N = 3 consecutive polls with no re-arm, terminalizes via the D1.4 exit — `wave_terminalized_unrecoverable` with `cause: 'orphaned_park'`, `WAVE-INCOMPLETE` over `manifestDigest`. **Counterexample:** a fired-and-delivered signal does NOT terminalize the recipient (the delivered receipt resolves the arm — a rule that terminalizes on fired-at-all fails a delivered-signal row). | **RED** — the catch exists with no follow-up machinery; `cause` exists nowhere. |
| **Q3** | STAGE-POLL | A member with an ARMED retry is NEVER a candidate; the retry-arm and resume events reset the watch (the `recovery` category, `application.mjs:8032-8034`); a member whose retry budget is EXHAUSTED is not in the armed class (it terminalizes via #182 or returns to the bare predicate). **Counterexample:** a wave whose only remaining member is mid-backoff between arm and resume is NOT declared `WAVE-QUIESCED` — and an exhausted-forever member does not hold the uncapped loop (the armed class is finite, D3.3). | **RED** — `'retrying'` exists nowhere in the source (QC6, zero grep hits); no retry ledger, no arm leg. |
| **Q4** | STAGE-POLL | A silent-but-working member reading phase `'running'` (the ordinary working phase, `application.mjs:5855`) or `'approved'`/`'interruption_uncertain'` is NEVER a candidate — `ACTIVE_TURN_PHASES` is derived from the OBSERVED vocabulary (D4.1), repairing the folded set's omission (QC7). **Counterexample (kills the everything-active greenability):** the Q1 counterexample leg — a `paused`, un-armed, `silent` member past the window IS a candidate; and the folded A1 counterexample (mid-turn `progressClass !== 'silent'`) still fails the declaration. An impl passing Q4 by treating every phase as active fails Q1's counterexample and the folded A2 window pins. | **RED** — no predicate exists; and the folded derivation (`contract-163.md:195-206`) names a set missing `'running'` — the defect this pin exists to close. |
| **Q5** | STAGE-DECLARATION | A `WAVE-QUIESCED` receipt reports each member's `compatClass` (closed enum, D6) in its `outcomes[]` entry, carries NO unresolved arm (leg 4 makes a declared-over arm unreachable — a receipt showing `compatClass: 'parked_signal'` with an arm still armed is a contract violation), and the receipt key-set remains EXACTLY `['basis', 'harvest', 'manifestDigest', 'outcomes', 'steering', 'verdict', 'waveId']` (F14). | **RED** — no declaration machinery; the verdict enum is `WAVE-OK`/`WAVE-INCOMPLETE` only (`:628`); `compatClass` exists nowhere. |
| **Q6** | STAGE-TOTALITY | The closure law (D5) holds as a testable property: for every member state in the closed map, the drive loop terminates under `hardCapMs: null` — specifically the rows the folded A12 did NOT cover: armed-wake-resolved-refused (leg c, Q2) and exhausted-retry (D3.3 boundary; the pin asserts the boundary condition is enforceable — an armed class with no exhaustion exit fails). | **RED** — no totality rule exists; an unreadable member already holds `pending` forever under the folded rung's own RED analysis (`contract-163.md:520`). |
| **Q7** | STAGE-SUITE | The compat legs run ONLY under the folded D2.4 gate (`driver.hardCapMs === null`); under the suites' `LANE_DRIVER` (`hardCapMs: 3000`) no compat predicate is evaluated, no `compatClass` is computed, and the fast rows' behavior is byte-identical (no second command in the common poll — the arm state is read from the steering state and store receipts the loop already holds). | **RED** — no gate, no predicate, no compat field exist (trivially RED with Q1–Q6; pinned so the landing cannot ship the compat legs ungated). |

---

## Open questions

- **OQ1 — the `shared` scratchpad publish is not executable at this HEAD; the durable file is the
  channel (recorded refusal, evidence per #158).** Verified THIS session: the facade surface is
  exactly `run.scratchpad.read` / `run.scratchpad.elevate` (`application.mjs:12654-12655`), and
  the store's write path hardcodes the worker partition — `const scope = \`worker:${fields.workerId}\``
  (`coordination-store.mjs:14169`) — so a member's publish lands worker-scoped, never `shared`
  (the channel audit's §1 verdict; `channel-audit-2026-08-13/channels.md:41-53`). Same posture as
  the folded #163's OQ1 (`contract-163.md:527-539`): this durable file is the deliverable, and the
  coordinator verifies it on disk per the #174 law.
- **OQ2 — the exhausted-retry boundary is cross-contract.** D3.3/Q6 pin the predicate-side
  condition (the armed class is finite), but the exhaustion exit itself is `contract-retry.md`'s
  (#201) and `contract-death.md`'s (#182) machinery — sibling rows of THIS wave, published in
  parallel. If their landed shapes disagree with this boundary (e.g. an exhausted retry parks the
  member instead of terminalizing), the coordinator QA must fold the conflict; the fallback
  reading of this contract is that an exhausted-but-parked member falls to D2's park rules (arm
  leg → orphaned-park totality), which keeps the closure law true either way. Recorded as a
  judgment call, not escalated further — the closure law is invariant to which sibling exit
  removes the state.
- **OQ3 — should `compatClass` also ride the totality exits' `steering[]` lines?** D6 puts it on
  `outcomes[]` only; the `wave_terminalized_unrecoverable` line carries `cause` instead. A
  steering-line `compatClass` would duplicate `cause` for the totality path and add nothing for
  the quiesced path (where `outcomes[]` already speaks). Kept minimal; a follow-on may revisit if
  the wake contract's receipts want the class at send time.
- **OQ4 — `interruption_uncertain` as active-turn (judgment call).** An attached-controllable
  worker may resume emission (fail-safe, D4.2); a truly dead-but-uncertain worker is removed by
  leg (b) phase-stuck on the same evidence counts as any other stuck phase. The alternative
  (classing it parked) would manufacture death verdicts from an evidence vacuum — rejected on the
  operator law. Recorded for the fold.

---

## DECISION_REQUEST — QC7 (authority-class ambiguity, escalated with options)

**The finding:** the folded #163's `ACTIVE_TURN_PHASES` is derived from
`CANONICAL_RUN_PHASES` (`contract-163.md:195-206`), but the observable outline phase of an
ordinary working member is `'running'` (`application.mjs:5855`) — absent from that vocabulary —
so the folded phase leg does not gate the exact member class (silent-but-working) it was folded
(B1/H1a) to protect. Amending a folded contract's derivation is above this row's authority class
(this row contracts the composition, not #163's text).

**Options:**
- **(a) RECOMMENDED — compose-over:** this contract ships D4.1 (the observed-vocabulary
  derivation, a superset) and flags QC7 into the fold record as a #163 v3 fold input; the
  coordinator QA records the seam. The folded contract's pins stay true (its A1 counterexample
  still fails a wrong impl); only the derivation's named basis is corrected where the predicate
  actually lands.
- **(b) Blocker:** treat QC7 as a needs-fold blocker on #163 — this contract's Q4 is written
  against the repaired set and would sit RED against the folded text until a #163 v3 fold lands.
- **(c) Informational:** record QC7, land the folded set verbatim, accept the silent-but-working
  hole at phase `'running'` — rejected by this row: it re-opens the B1 defeat the fold closed.

This contract proceeds on (a) under the row brief's "judgment calls recorded" law; the QA holds
the authority to re-classify.

---

## Judgment calls (recorded)

1. **Compose, don't re-specify.** The wake machinery (park/re-arm/wake-with-message) is
   row-wake's; the retry ledger/budget is row-retry's; death certificates are row-death's. This
   contract pins only what each state must look like TO the quiescence predicate and what the
   predicate promises back (leg 4, closure, receipt honesty). Sibling contracts were cited by
   brief + issue (#181/#201/#182), not by their unpublished text (parallel rows, same wave).
2. **Fail-safe direction for unknown phases: never-candidate** (D4.2/OQ4) — silence never
   manufactures a death verdict; totality legs pay the termination cost.
3. **`N = 3` for leg (c) reuses the folded derivation** (confirmation pair + 1) — no new numeric
   constant is introduced by this rung; the arm budget (≤3) is the existing `messageOnSpawn` law
   (`workflow-interpreter.mjs:822-828`), cited not re-derived.
4. **The operator wait remains the only non-totality-covered never-candidate class** — the folded
   judgment (`contract-163.md:305-309`) is preserved, not re-litigated; D2.4 states the
   ownership-based distinguisher.
5. **`compatClass` rides `outcomes[]` additively** — never a new top-level receipt key (the G9/F14
   law, QC9); `cause` rides the existing totality evidence line additively.
6. **The redrive frame discrepancy** (foundry-brief names wave-A rows) is recorded in the header,
   not acted on — the wavefile and row briefs govern.

## Cross-references

- `docs/reference/evidence/contract-foundry-2026-08-13/contract-163.md` — the folded quiescence
  contract (D1.1 predicate, D1.4 totality, D1.5 receipt, A1–A13 pins) this contract composes with.
- `row-wake.md`, `row-retry.md`, `row-death.md` (this dir) — the sibling producer contracts
  (#181/#201/#182); `coordinator-brief.md` — the QA cross-check that owns boundary conflicts (OQ2).
- `channel-audit-2026-08-13/channels.md` — the recipient-inversion and park evidence (QC5).
- `lane-proof-2026-08-13/landing-note.md`, `row-lane-decision.md` — the sixth #181 instance and
  the PARKED-FOREVER vocabulary.
- `pm-comparison-2026-08-13/landing-note.md`, `dsh-comparison-2026-08-13/dsh-lifecycle.md` — the
  fifth instance, the member-side analog (GT-B5), and the no-step-turn ambiguity (R5, QC7).
- `coordinator.mjs:71-76,9231,9681` (`REARM_KINDS`), `application.mjs:494-524`
  (`progressBlockedDetail`/`projectProgressClass`), `application-semantics.mjs:29-35,54` — the
  liveness machinery cited, not re-specified.

## Campaign-law constraints

- **No clocks.** The only counts this rung introduces are evidence counts reusing the folded
  derivations (leg (c)'s N = confirmation pair + 1); the retry backoff is event-counted and
  deployment-owned (D3.2); nothing new reads `Date.now()` as a control.
- **No arbitrary numeric limits.** No new numeric constant enters; the ≤3 messageOnSpawn budget
  and the 120 s silence threshold are cited existing law.
- **No redesign of landed SOUND law.** The stuck-decision break, the meaningful-event semantics,
  the #67 re-arm set, the D6/F14 receipt shape, and the folded #163 predicate legs 1–3 are cited
  and preserved; the one repair (D4.1) is escalated as DECISION_REQUEST-QC7.
- **Ring-2 form; deliverable boundary.** This contract specifies behavior and amends no
  implementation. The sole deliverable is this file
  (`docs/reference/evidence/lch-contracts-2026-08-14/redrive/contract-quiescence-compat.md`);
  work was confined to `docs/reference/evidence/lch-contracts-2026-08-14/redrive/**`. No source
  files were modified. The `shared` publish is refused with evidence (OQ1, #158).

---

## Addendum A — suite anchors re-verified at HEAD (Q7's premise)

The Q7 pin premises were verified directly at HEAD `09200e9`, not inherited from the folded
contract's HEAD:

- `LANE_DRIVER = Object.freeze({ pollIntervalMs: 15, stallTimeoutMs: 400, hardCapMs: 3000 })` —
  `test/workflow-as-data-red.test.mjs:346` and `test/worker-orchestrated-swarm-red.test.mjs:77`;
  the fast-capped policy drives every `waves.run` row in both suites
  (`worker-orchestrated-swarm-red.test.mjs:493,528,566,665,717,767,827`).
- The F14 receipt key pin asserts `Object.keys(receipt)` deep-equals `['basis', 'harvest',
  'manifestDigest', 'outcomes', 'steering', 'verdict', 'waveId']` "in sorted order"
  (`test/workflow-as-data-red.test.mjs:704-706`) — the D6/F14 law D6 composes with, and the reason
  `compatClass` must ride `outcomes[]` additively.

## Addendum B — fold-record-ready pin list

For the coordinator's cross-check and any fold of this contract. Each row: pin → stage → the
single fold question a reviewer must answer.

| Pin | Stage | Fold question |
|---|---|---|
| Q1 | STAGE-POLL | Does the landed predicate read the arm state (steering `s.messaged`/`s.signaled` + store delivery receipts) as leg 4 — and does the counterexample (parked, un-armed, silent, past window ⇒ candidate) still fail a blanket-park impl? |
| Q2 | STAGE-SIGNAL | Does leg (c) fire only on settled-false arms (fired-without-receipt or refused), reusing `wave_terminalized_unrecoverable` + `cause: 'orphaned_park'`, N = 3? |
| Q3 | STAGE-POLL | Does the retry ledger feed leg 4, do arm/resume events land in the `recovery` category, and is the armed class finite (exhaustion exits per #182)? — cross-check against `contract-retry.md` (OQ2). |
| Q4 | STAGE-POLL | Is `ACTIVE_TURN_PHASES` derived from the OBSERVED vocabulary (incl. `running`/`approved`/`interruption_uncertain`) — and is the folded #163's QC7 defect resolved per DECISION_REQUEST-QC7's adopted option? |
| Q5 | STAGE-DECLARATION | Does `compatClass` ride `outcomes[]` additively with the receipt still exactly the F14 seven keys, and is a declared-over arm structurally unreachable? |
| Q6 | STAGE-TOTALITY | Is the D5 closure map total under `hardCapMs: null` for the two rows the folded A12 did not cover (orphaned park, exhausted retry)? |
| Q7 | STAGE-SUITE | Are the compat legs gated on `hardCapMs === null` with the suites' `LANE_DRIVER` rows byte-identical in behavior (Addendum A anchors)? |

## Addendum C — citation-audit method (this session)

All `file:line` anchors in this contract were produced this session at HEAD
`09200e97c1be113946459d901c8fab56034d8a1f` via `grep -an` + `sed -n` (the two NUL-bearing
files, `application.mjs` and `coordination-store.mjs`, exclusively so), direct reads for
`workflow-interpreter.mjs`/`coordinator.mjs`/`application-semantics.mjs`/`application.mjs`
line-window prints, and `awk`/`grep -n` for the evidence markdown. The folded-contract anchors
(`contract-163.md:*`) were spot-verified against four regions (D1.1 legs `:183-194`,
`ACTIVE_TURN_PHASES` `:195-206`, totality `:286-309`, OQ1 `:527-539`) plus the A12 row (`:520`).
The `impl/test/` suite anchors are verified in Addendum A. No anchor in this file is inherited
from another contract's verification session without an explicit note.
