# Issue #80 — The TG3 steering window vs provider turn-start latency — implementation contract

**Status:** v1.0 DRAFT
**Date:** 2026-08-07
**Verification HEAD:** `0b5df0c688638a857760dab04e5fdfccc30e942b` (current worktree HEAD)
**Brief:** `contract-80-brief.md` (this directory)

**Seed.** The one-shot 5-minute TG3 steering window can expire during a legitimately slow
next-turn start, killing a healthy worker mid-workflow (the #55-class incident). The issue's
refinement candidates were (a) per-route latency scaling and (b) a started-but-silent provider
turn as the cycle's answer. The brief's first job is an honest subsumption analysis against the
#67 stall-watchdog contract v1.1 (JUST folded): the #67 fold's in-flight-turn gate restores the
control-law line — no bound fires on elapsed time without an evidence check — and #80's case may
be LARGELY SUBSUMED. The contract must say precisely how much, honestly, then own the residual.

**Read-order executed.** (1) the issue — `gh issue view 80` is **unavailable in this worktree**
(`gh` is not authenticated; same limitation the #67 contract records), so the requirements ride
the brief's two refinement candidates plus the frontier-sweep Lane D note ("event-based liveness
(#67 + #80)", `docs/reference/evidence/frontier-sweep-2026-08-03/frontier-sweep.md:97-101`) and
the bidirectional-v3 decision-4 note ("TG3's window refinement (#80, cycle-latency): a slow
next-turn start must not expire a healthy cycle",
`docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md:128-130`); (2)
the #67 stall-watchdog contract v1.1 (`stall-watchdog-2026-08-07/stall-watchdog-contract.md`,
read whole); (3) the TG3 machinery (`impl/src/coordinator.mjs` — **0 NUL bytes**, verified by
`tr -cd '\000'`, read whole; anchors re-verified at HEAD, see §7); (4) the TG6 retirement ruling
(`trust-gate-steering-2026-08-02/trust-gate-steering-decisions.md` TG6 + the v1.0.2 disposition).
`application.mjs` (**3 NUL bytes**) was read by `sed -n` only.

**Cross-references (not re-specified here):** #67 (v1.1 — the watchdog liveness surface), #64
TG2/TG3 (the evidence classes and the one bounded steering cycle), #55 (the three-waves incident
— activity ≠ evidence), #10 (the waitingOn vocabulary), TG6 (coaching retirement). This contract
owns only the TG3 steering-cycle window's expiry semantics.

---

## 1. Ground truths (re-verified at HEAD)

| # | Ground truth | Verified anchor |
|---|--------------|-----------------|
| G1 | **The one-shot TG3 cycle arms at the pause-admission seam.** `_admitPauseRecord` mints the pause record at `turn_completed`; with no registered driver (`hasDriver` scan) it arms exactly ONE steering cycle via `_armSteeringCycle`. The window default is 300_000 ms (`this._progressNudgeWindowMs = opts.progressNudgeWindowMs ?? 300_000`). The nudge is delivered through the worker's control lane (`send(handle.id, this._buildProgressNudge(handle), 'nudge', { actor: 'policy' })`) best-effort — the window bounds the cycle whether or not the adapter accepts the prompt. | `coordinator.mjs:2076, 2123-2134, 1003, 2178-2181` |
| G2 | **The cycle's answer set is closed and farm-proofed.** `_steeringEvidenceQualifies`: `turn_started` → `true`; `scratchpad` → distinct content digest (per-cycle `digestSet`); `interaction` → `state === 'resolved'` + worker-matched (per-cycle `resolvedRequestIds`); `capability_op` → distinct extract digest. The first qualifying answer settles the cycle via `_settleSteeringCycle`: `turn.settled {basis: 'steering_answered'}`, task → `working`, no verdict, no gate dispatch. | `coordinator.mjs:2208-2238, 2259-2272` |
| G3 | **Expiry runs the full final evaluation with the steering receipt durable.** `_expireSteeringCycle` (guard `task.status !== 'paused'`), settles `turn.settled {basis: 'steering_expired'}`, task → `working`, then `_runTrustGate(handle, record.workerResult, { steered: { nudgeId, answered: false } })`. The `steered` receipt rides the gate error-event payload — "we asked and it never answered" is durable. | `coordinator.mjs:2276-2306` (`:2290` guard, `:2293-2297` settle, `:2303-2305` gate); `:13203` |
| G4 | **`turn_started` is the turn system's own start unit, adapter-gated.** `_observeSteeringCycle(handle, {kind: 'turn_started'})` fires on ANY `turn_started`, and `_steeringEvidenceQualifies` returns `true` for it. The adapters gate `turn_started` to real turn beginnings (one-start/one-terminal accounting; native `turn/started` notification; CLI `turn.started`). | `coordinator.mjs:12050, 2210`; `claude-session.mjs:884-894`; `codex-appserver.mjs:645-648`; `cli-adapters.mjs:120, 155` |
| G5 | **`resource.provider_call` rides the worker stream but is NOT a steering-cycle answer today.** It reaches `_handleEvent`'s default case and `_observeWatchdogEvent` → `_observeLogicalProviderCall`. `_observeSteeringCycle` is never called for it — a provider call for the seat buys zero liveness at the cycle. | `coordinator.mjs:12813-12814, 12824, 9151, 9067-9097` |
| G6 | **The `requested` phase exists in the phase machine; adapters emit `completed` only.** `LOGICAL_CALL_PHASES = ['requested', 'progress', 'completed', 'failed', 'cancelled']` (ACTUAL sorted order); `logicalCallTransition` accepts `requested` as a first phase and `requested → completed` as a terminal transition. Today every adapter emits `resource.provider_call` only at `phase: 'completed'` — at the provider RETURN. No `requested`-phase emission exists. | `coordinator.mjs:48, 76-103`; `claude-session.mjs:1124`; `cli-adapters.mjs:127, 163`; `codex-appserver.mjs:655-660` |
| G7 | **#67 v1.1 is a DRAFT fold, not shipped code.** `handle.turnInFlight` does NOT exist at HEAD (grep over `coordinator.mjs`: zero hits). The fold's D2 in-flight-turn gate, D1's decoupled 20-min stall budget, D4's kill ladder, and its stall-seam cycle are contract text. The subsumption analysis below is against the CONTRACT, not shipped behavior. | `stall-watchdog-contract.md` D1-D4; `grep -n turnInFlight impl/src/coordinator.mjs` (empty) |
| G8 | **The watchdog is working-only and does not govern the steering-cycle window.** `_armWatchdog` refuses non-`working` handles. During a steering cycle the TASK is `paused` while the HANDLE deliberately stays `working` — the cycle is a separate one-shot `_setTimeout` inside `_armSteeringCycle`; #67's gate does not touch it. | `coordinator.mjs:8733, 2116-2119, 2183-2194` |
| G9 | **#55's lesson is activity ≠ evidence.** The wave stall marker moves on ANY activity (`_activityProjection`: providerCalls, tokens, contentEvents, lastActivityAt) — that is precisely what #55 moved wrongly. TG2's answer classes are EVIDENCE (distinct-digest receipts, resolved interactions, turn boundaries), never raw activity counts. Whether a provider call for the seat is TG2-class evidence is a decision below, not an assumption. | `application.mjs:8041-8068`; `waiting-vocabulary-2026-08-06/grounding.md` §1.4 |
| G10 | **The campaign control law.** "Arbitrary turn-limits and time windows are the wrong class… Liveness and progress are judged from the event vocabulary (provider activity, receipt classes, process lifecycle) with COUNT-based bounds only on unanswered steering cycles; any clock is a deployment-class last resort for total silence, never the primary signal." A bigger window (candidate (a)) is a clock as a workflow control — banned. | `bidirectional-v3-decisions.md:134-140`; `trust-gate-steering-decisions.md` TG3 |
| G11 | **TG6's retirement ruling.** "No skeleton-first, no write-early-to-survive"; "produce your deliverable; progress verdicts evaluate finals, and one progress nudge precedes any verdict." The escape pressure #80 names — a worker that writes early garbage to survive the window — is exactly the class TG6 retired. The fix must not teach a new "beat the window" behavior. | `trust-gate-steering-decisions.md` TG6 + v1.0.2 disposition |
| G12 | **`_observeSteeringCycle`'s paused-only guard.** `if (task.status !== 'paused' && evidence?.kind !== 'interaction') continue;` — a paused task accepts any evidence kind; a non-paused task answers only on an interaction resolution (the blocked-worker unpark; liveness evidence from a still-blocked worker must not tear down the block). | `coordinator.mjs:2241-2256` (`:2251`) |

---

## 2. Subsumption analysis (first, honest)

The verdict: **#67 v1.1 closes the WATCHDOG half of #80 and the "started" half of the cycle; the
queued-start slice — the next turn not yet started — is the residual #80 owns.**

**Closed by #67 v1.1 — the watchdog half.** A next turn that HAS started but is silent — a
20-minute compile, a provider call that hangs but is still running — is never stall-declared by
the watchdog: the D2 in-flight-turn gate re-arms without declaring (`if (handle.turnInFlight ===
true) { this._armWatchdog(handle); return; }`), and the wall budget
(`DEFAULT_BUDGET.wallMin * 60_000`) is the operator-pinned hung-turn backstop. The control-law
line — **no bound fires on elapsed time without an evidence check** — is restored for the
watchdog. If #80's failure mode were the watchdog declaring a stall mid-turn, #67 closes it.
During a steering cycle the task is `paused` (G8), and #67's D4 rung 3 additionally gates any
reap on `turnInFlight === false` — a started-but-silent turn is never reaped, only escalated.

**Closed by the existing TG3 answer set — the "started-but-silent" half.** Candidate (b)'s first
half — "a started-but-silent provider turn counts as the cycle's answer" — is ALREADY the
behavior for the turn system's own start unit: `turn_started` is a first-class answer (G4). A
turn that has started, however silent its content, answers the cycle and settles `working`. The
cycle's job is "is the worker alive at the checkpoint," and a started turn is that evidence.
This half of #80 is subsumed by the SHIPPED TG3 answer set — not by #67, and it needs no code
change.

**The residual — the queued-start slice.** The next turn has NOT started: the harness has
dispatched its next-turn request (or is processing the progress nudge) but the provider seat has
not accepted it into the queue — no `turn_started`, no content, no TG2 receipt. Neither #67's
in-flight gate (which requires a started turn) nor the TG3 answer set (which requires
`turn_started` or TG2 evidence) has any evidence for this slice. The one-shot 5-minute window can
expire, and `_expireSteeringCycle` runs the FULL FINAL GATE on a mid-work checkpoint —
`required_effect_absent` on a required-edit plan with no diff yet. That is the #55-class kill: a
healthy worker killed for a slow next-turn start. **#80 owns this slice.**

**Not subsumed by #67's stall-seam cycle.** The #67 fold's D4 rung-2 stall-seam cycle is a
separate ladder for the stall-DECLARED path, with its own answer set (the D2 REARM_KINDS). The
pause-admission seam (`_admitPauseRecord`) is untouched by #67. The two one-shot timers are
independent surfaces; #80's contract must not conflate them.

---

## 3. Decisions

### D1 — The window is evidence-gated, never longer (candidate (a) rejected)

Per-route latency scaling (candidate (a)) is **REJECTED**. A larger window per route is a clock
as a workflow control — the campaign law (G10) bans it, and it re-introduces the "how long is
long enough" guessing the law exists to avoid (route latency is measured in the future, pinned to
yesterday's observed latency, and silently wrong for the next incident). The window's
`progressNudgeWindowMs` default (300_000, G1) stays a deployment knob, byte-unchanged; this
contract does not scale it by route or by any observed-latency feedback.

The window's **expiry** instead becomes evidence-gated: the cycle answers (settles `working`,
G2 semantics) on the START evidence below, so a legitimately-starting turn is consumed by the
cycle as an answer — it can never be expired by a clock while start evidence exists.

### D2 — The provider queue ack answers the cycle (candidate (b), extended)

**The new answer class.** `resource.provider_call {phase: 'requested', callId}` — the adapter's
durable receipt that a provider call for the worker's seat has been dispatched into the provider
queue — is added to the steering-cycle answer set. It is the evidence that "the next turn is
legitimately starting" at the seat layer, before any provider content returns.

- **Mint.** The adapters emit `resource.provider_call {phase: 'requested', callId}` at the moment
  a turn-start prompt is handed to the provider — the **provider queue ack**. The phase machine
  already accepts it (G6); no new wire kind, no new refusal code. Adapters where dispatch and
  `turn_started` are atomic (the claude pipe: `_writeUserFrame` emits `turn_started`
  synchronously at frame write, `claude-session.mjs:884-894`) need NO new emission — `turn_started`
  already answers (G4). The `requested`-phase emission is **mandatory** for native/emulated
  adapters where the provider can queue a dispatched turn before reporting its start
  (codex-appserver `turn/started`, `codex-appserver.mjs:645-648`; cli-adapters `turn.started`,
  `cli-adapters.mjs:120`) — that is the wire gap where `turn_started` lags the dispatch and the
  queued-start slice lives.
- **Answer.** `_steeringEvidenceQualifies` gains a `provider_call` evidence class: a
  `requested`-phase provider call for the seat answers the cycle. `_observeSteeringCycle` is
  called for `resource.provider_call` events (observation point: `_handleEvent`'s handling of the
  kind — today the default case at `:12813-12814`; the call is added beside the existing
  `_observeSteeringCycle` sites `:12050`/`:12451`). Phase/callId validity is a prerequisite — an
  invalid or duplicate call (`_observeLogicalProviderCall`'s `provider_call_id_invalid` /
  `provider_call_phase_invalid`, `:9075-9097`) is telemetry noise, never an answer. Scoping is
  **per-handle**, matching `turn_started`: the observation routes by the event's worker, so a call
  answers only when its worker IS the cycle's handle (the seat). Calls from any other worker —
  including the #47 readiness tier's probe receipts (`liveness-probe-*`,
  `route-liveness.mjs:346-350`, which mint `resource.provider_call {phase:'completed'}` for
  isolated probe workers) — never reach the seat's cycle.
- **What a `completed`-phase call means.** A `completed`-phase provider call (the provider
  RETURNED, G6) is the STRONGEST liveness — a call that both started and returned — and is also an
  answer: during an armed window a `completed` call can only belong to the next turn (the
  checkpoint's own turn completed before the pause). The answer set accepts `requested` **and**
  `completed` phases for the seat. The honest-stall discriminator (D3) is "NO provider call of
  either phase AND no `turn_started` AND no TG2-class receipt AND no resolved interaction within
  the window."
- **The anti-gaming bound.** The cycle is once-per-pause-record (G1); the first qualifying answer
  settles it. A worker that dispatches a provider call then hangs is the wall budget's backstop
  (G7), never a cycle re-arm — the same honesty the existing `turn_started` answer has. A worker
  cannot farm: one answer per record, and the FINAL still demands the real in-scope diff (TG2's
  no-content-floor rule, `trust-gate-steering-decisions.md` TG2). No new count bound is added —
  the one-shot is the bound.
- **Why not the nudge's own dispatch (the "dispatch receipt" option).** The steering nudge is
  delivered by the POLICY actor at arm time (`:2178-2181`). Counting the nudge's delivery as the
  cycle's answer would make the cycle **self-answering** — the arm action would always answer, and
  a genuinely dead worker whose adapter accepts a prompt but whose harness never responds would
  never be evaluated (the honest-stall discriminator would be dead on arrival). The worker-side
  provider queue ack is the honest START evidence; the policy-side nudge delivery is not. The
  `control.nudge` receipt (actor `'policy'`, `:7401-7408`) is explicitly NOT an answer class.

### D3 — The honest stall and the expiry disposition

**The discriminator.** "The turn never started" (the honest stall) = within the armed window,
NONE of: `lifecycle.turn_started`; `resource.provider_call {requested|completed}` for the seat; a
distinct TG2-class receipt (scratchpad/capability_op digest); a resolved interaction. This is a
strictly stronger silence signal than today (which is "no answer among the narrower set") — it
names the START as the missing evidence, so a legitimately-queued turn is distinguishable from a
dead worker.

**The disposition stays the full final evaluation; a constructive re-arm is REJECTED.** The
one-shot cycle IS the campaign's count-based bound (G10: "COUNT-based bounds only on unanswered
steering cycles"): ONE unanswered cycle precedes the final evaluation. A "constructive re-arm" (a
second nudge/cycle on expiry) converts the count-based bound into a clock — the exact class the
control law bans — and re-opens the indefinite-extension escape the issue names (the #105-class
"the worker is always just about to start" trap). The full final evaluation with
`steered: {nudgeId, answered: false}` is kept (`:2303-2305`): a genuinely start-less worker at a
checkpoint IS the honest stall, and the gate's verdict — including `required_effect_absent` on an
edit-free required-edit plan — is the correct anti-gaming outcome, the same judgment a FINAL with
no diff receives. The evidence-gating (D2) is what makes this honest: the expiry now fires only
when no start evidence exists.

**The expiry is receipted for #55-class debuggability.** Today the only durable trace is the
`steered` receipt on the gate error event (`:13203`). The contract augments the expiry with an
**evidence fold**: `_expireSteeringCycle` records, on the record's `steering` object, the
answer-class kinds observed during the window (`record.steering.observedEvidence`, appended at
each `_observeSteeringCycle` evidence evaluation — event identities only, no timestamps), and the
expiry carries a compact summary on BOTH the `turn.settled {basis:'steering_expired'}` payload
(`:2293-2297`) and the `steered` receipt (`:13203`): `{windowMs, startEvidenceObserved: boolean,
answerClasses: [...]}` (the observed kinds, in observation order, bounded to the closed
vocabulary). A post-mortem can then distinguish "the harness never dispatched a turn" (honest
stall → correct final) from "the provider accepted a call but the cycle still expired" (a defect
in the D2 evidence gate). No wall-clock is added beyond the existing `windowMs` knob — the fold is
event-identities, per the #88 CP4 shape law (`claim-preflight-contract.md:220-228`).

### D4 — The guard surface

`_observeSteeringCycle`'s paused-only guard (G12, `:2251`) is preserved and extended:
`provider_call` evidence answers only while the task is paused (the armed window). A non-paused
worker's provider calls are in-turn activity, not checkpoint-start evidence, and must not tear
down a block — the existing `evidence?.kind !== 'interaction'` non-paused rule is untouched. The
`resource.provider_call` observation reaches `_observeSteeringCycle` WITHOUT disturbing
`_observeWatchdogEvent` (which keeps its own provider-call tracking at `:9151`); the two
consumers stay independent. The #67 REARM_KINDS fold (which excludes `resource.provider_call`) is
not contradicted: the watchdog's re-arm set and the steering cycle's answer set are separate
surfaces with separate purposes (liveness re-arm vs checkpoint-start evidence), and #67's closed
set is byte-unchanged by this contract.

---

## 4. Refusal / observability vocabulary (closed)

| Kind / field / receipt | Reach | Fires when |
|------------------------|-------|------------|
| `resource.provider_call {phase: 'requested'}` (NEW emission; existing wire kind + existing phase, G6) | adapter stream → `_handleEvent` default case → `_observeSteeringCycle` + `_observeWatchdogEvent` | a turn-start prompt is dispatched into the provider queue (the provider queue ack, D2); adapters where dispatch and `turn_started` are atomic need no emission (G4) |
| `_steeringEvidenceQualifies` `provider_call` class (NEW branch) | coordinator answer evaluation | a valid `requested`/`completed`-phase provider call for the seat inside the armed window (D2) |
| `record.steering.observedEvidence` (NEW field) | in-memory record → expiry fold | every answer-class evidence evaluation during the window (D3) |
| `steered` receipt gain `{windowMs, startEvidenceObserved, answerClasses}` (NEW fields on the existing receipt) | gate error-event payload (`:13203`) + `turn.settled {basis:'steering_expired'}` payload (`:2293-2297`) | genuine window expiry (D3) — the #55-class post-mortem trace |
| `control.nudge` (existing) | coordinator ledger | the policy nudge delivery — explicitly NOT an answer class (D2, self-answering guard) |

No new worker-stream refusal code is introduced; `stateFailureCode` and the web mapper are
untouched. The window is a coordinator-internal timer, never a thrown error across the facade.
The wire sorted-key literals are unchanged: `LOGICAL_CALL_PHASES` (`coordinator.mjs:48`) is
already the ACTUAL-sorted literal and is reused, not duplicated. No new kind literal is added.

---

## 5. Acceptance pins (red-first)

RED = fails at HEAD; GREEN = passes at HEAD and is pinned.

| Pin | Assertion | Today |
|-----|-----------|-------|
| TW-01 | **`resource.provider_call` answers the steering cycle.** A valid `requested`-phase provider call for the seat inside the armed window settles the cycle (`turn.settled {basis: 'steering_answered'}`, task → `working`, zero gate events); a `completed`-phase call answers likewise. | **RED** (`_observeSteeringCycle` is never called for `resource.provider_call`, G5) |
| TW-02 | **The provider queue ack is emitted.** Native/emulated adapters emit `resource.provider_call {phase: 'requested', callId}` at turn-start dispatch; a staged slow-start adapter shows the ack arriving before `turn_started`; no `requested`-phase emission exists for the atomic adapters (claude pipe) where `turn_started` is synchronous with dispatch. | **RED** (all adapters emit `completed` only, G6) |
| TW-03 | **A queued start never expires the window.** Stage: a checkpoint pause arms the cycle; the next turn's provider call is `requested` at minute 4 of the window (no `turn_started`, no content); at expiry the cycle settles constructively — task `working`, ZERO gate events, ZERO `steered` receipts. | **RED** (no provider_call answer; `_expireSteeringCycle` runs the full final gate at `:2303-2305`) |
| TW-04 | **The honest stall still evaluates.** Stage: a checkpoint pause arms the cycle; NOTHING arrives (no `turn_started`, no provider call, no TG2 receipt, no resolved interaction); the window expires and the full final evaluation runs exactly as today with `steered: {nudgeId, answered: false}` durable on the gate error event. | **GREEN** (pin — today's T7b behavior, `trust-gate-steering-red.test.mjs:230-248`) |
| TW-05 | **The expiry is debuggable.** The genuine-expiry path (TW-04) carries the evidence fold — `{windowMs, startEvidenceObserved: false, answerClasses: []}` on the `turn.settled` payload and the `steered` receipt; a staged defect in the D2 gate (a `provider_call` ack IS observed in-window yet the cycle still expires) records `startEvidenceObserved: true` and `answerClasses: ['provider_call']` on the expiry, exposing the defect to a post-mortem. | **RED** (receipt is `steered` only, no fold, G3) |
| TW-06 | **`turn_started` remains a first-class answer (pin).** A resumed turn inside the window settles the cycle — zero gate events. | **GREEN** (pin, `:12050`/`:2210`, `trust-gate-steering-red.test.mjs:181-198`) |
| TW-07 | **The nudge never self-answers.** The policy nudge's own delivery (`control.nudge`, actor `'policy'`) does NOT settle the cycle; a staged adapter that accepts the nudge but never starts a turn still expires with `steered: {answered: false}`. | **GREEN** (pin — `control.nudge` is not in the answer set; the fold's TW-03 staging proves the discriminator) |
| TW-08 | **Once-per-record bound (pin).** The cycle is answered at most once per pause record; a worker emitting multiple provider calls answers exactly once (the first), and no second cycle arms for the same record. | **GREEN** (pin — one-shot arm at `:2134`, consume at `_settleSteeringCycle`) |
| TW-09 | **The watchdog surface is untouched.** `_armWatchdog`'s working-only refusal (`:8733`) and the #67 REARM_KINDS fold (which excludes `resource.provider_call`) are byte-unchanged; `_observeWatchdogEvent` keeps its own provider-call tracking (`:9151`). | **GREEN** (pin — no REARM set change in this contract) |
| TW-10 | **No clock is added anywhere.** The diff introduces zero new `setTimeout`/`Date.now()` deltas/`*Ms` knobs beyond the existing `progressNudgeWindowMs`; the queued-start answer is evidence (a provider call), never a window extension. | **RED** (the fix must not ship a bigger window; candidate (a) is rejected by construction) |

---

## 6. Campaign-law constraints and non-goals

- **No clocks as controls.** The window's `progressNudgeWindowMs` default is byte-unchanged; the
  fix is evidence-gated (D2) — a provider queue ack answers, nothing is extended. The genuine
  expiry (D3) stays the count-based bound: ONE unanswered cycle → the final. No new `*Ms` knob, no
  per-route latency table, no re-arm-on-expiry loop.
- **Every answer class is EVIDENCE, never a bigger window.** The three start/return markers —
  `turn_started`, `provider_call {requested}`, `provider_call {completed}` — are adapter-minted
  wire truths (unspoofable by worker text), distinct-digest/resolution classes stay as TG2 pins
  them, and `control.nudge` (the policy's own action) is explicitly excluded (D2).
- **No new event kinds, no new refusal codes.** The fix reuses `resource.provider_call` (existing
  kind) and the `requested` phase (existing `LOGICAL_CALL_PHASES` entry, G6). The observable
  additions are one emission per native/emulated adapter, one `_steeringEvidenceQualifies` branch,
  and two receipt-field gains (D3). `stateFailureCode` / the web mapper are untouched.
- **Sorted-key literals in ACTUAL order.** `LOGICAL_CALL_PHASES` is reused, not duplicated;
  `localeCompare` is banned. No new kind literal is introduced.
- **NUL-byte discipline.** `coordinator.mjs` (0 NUL) and `claude-session.mjs`/`cli-adapters.mjs`/
  `codex-appserver.mjs` (0 NUL each) were read whole; `application.mjs` (3 NUL) by `sed -n` only.
- **Non-goals.** Candidate (a) per-route latency scaling (rejected, D1); a constructive re-arm on
  expiry (rejected, D3); the #67 watchdog surface and REARM_KINDS (cross-ref, byte-unchanged);
  TG6 coaching retirement (already verified-closed, cross-ref G11); the wave driver's own stall
  clock and the #55 activity projection (cross-ref only, G9); re-specifying TG2/TG3 or #10's
  vocabulary (cross-referenced only).

---

## 7. Open questions

- **OQ-1 — Which adapters get the `requested`-phase emission first?** The atomic adapters (claude
  pipe) need none; the native/emulated ones (codex-appserver, cli-adapters `exec`) need it. The
  contract does not pin the order — the emission is per-adapter, gated on the adapter actually
  having a dispatch-before-start gap. Recommendation: land codex-appserver first (the `turn/started`
  lag is the observed #80 shape), cli-adapters second, and pin TW-02 against a staged
  slow-start adapter.
- **OQ-2 — Should a `progress`-phase provider call answer?** The phase machine has a `progress`
  phase (`:48`) that no adapter emits today. The contract accepts `requested` and `completed`
  (start and return). A `progress`-phase call is stream-telemetry mid-call; if an adapter later
  emits it, the evidence class extends by the same rule (a valid provider call for the seat inside
  the window). No code decision is needed until an adapter emits it — the guard is phase-validity,
  and the honest-stall discriminator already treats any valid provider call as start evidence.
- **OQ-3 — The `observedEvidence` fold bound.** The fold records answer-class kinds observed
  during the window (D3). Its size is bounded by the closed vocabulary (turn_started,
  provider_call, scratchpad, interaction, capability_op) and per-answer dedup; the contract leaves
  the exact cap to the implementer under the #88 CP4 shape law (event identities, replay-stable,
  no timer flakes). No count bound is a control mechanism here — it is a receipt-size bound.

---

## 8. Verification

- **HEAD pinned:** `0b5df0c688638a857760dab04e5fdfccc30e942b` (current worktree HEAD). Every
  anchor in §1 was re-verified by `grep -an`/`sed -n` on the current tree; `coordinator.mjs`
  (0 NUL bytes) was read whole. Sorted-key literals appear only as verified.
- **The residual is LIVE at HEAD:** `_steeringEvidenceQualifies` has no `provider_call` class
  (`:2208-2238`); no adapter emits `requested`-phase provider calls (G6); `_expireSteeringCycle`
  runs the full final gate on ANY unanswered window regardless of start evidence (`:2303-2305`);
  the `steered` receipt carries no evidence fold (`:13203`). The TW-03 queued-start failure is
  reproducible at HEAD with a staged slow-start adapter.
- **Deployment verification command** (Baton): executable `true`, arguments `[]`, expected exit 0.
