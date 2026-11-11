# Issue #80 — The TG3 steering window vs provider turn-start latency — implementation contract

**Status:** v1.1 FOLD (3/3 red-team blockers folded, per `contract-redteam.md` §9)
**Date:** 2026-08-07
**Verification HEAD:** `2d9de15390bdfe8fc650a4199e45dd74629acfba` (current worktree HEAD)
**Fold:** `contract-fold.md` (this directory — the blocker → change map, all 3 + the OQ verdicts)
**Red-team:** `contract-redteam.md` (this directory — **NOT FOLD-READY** as written; every numbered blocker is folded below)
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
`application.mjs` (**3 NUL bytes**) was read by `sed -n` only; `coordination-store.mjs`
(**3 NUL bytes**) was read by `sed -n`/`grep -an` only.

**Cross-references (not re-specified here):** #67 (v1.1 — the watchdog liveness surface), #64
TG2/TG3 (the evidence classes and the one bounded steering cycle), #55 (the three-waves incident
— activity ≠ evidence), #10 (the waitingOn vocabulary), TG6 (coaching retirement). This contract
owns only the TG3 steering-cycle window's expiry semantics.

---

## 1. Ground truths (re-verified at the fold HEAD)

| # | Ground truth | Verified anchor |
|---|--------------|-----------------|
| G1 | **The one-shot TG3 cycle arms at the pause-admission seam.** `_admitPauseRecord` mints the pause record at `turn_completed`; with no registered driver (`hasDriver` scan) it arms exactly ONE steering cycle via `_armSteeringCycle`. The window default is 300_000 ms (`this._progressNudgeWindowMs = opts.progressNudgeWindowMs ?? 300_000`). The nudge is delivered through the worker's control lane (`send(handle.id, this._buildProgressNudge(handle), 'nudge', { actor: 'policy' })`) best-effort — the window bounds the cycle whether or not the adapter accepts the prompt. | `coordinator.mjs:2076, 2123-2134, 1003, 2178-2181` |
| G2 | **The cycle's answer set is closed and farm-proofed.** `_steeringEvidenceQualifies`: `turn_started` → `true`; `scratchpad` → distinct content digest (per-cycle `digestSet`); `interaction` → `state === 'resolved'` + worker-matched (per-cycle `resolvedRequestIds`); `capability_op` → distinct extract digest. The first qualifying answer settles the cycle via `_settleSteeringCycle`: `turn.settled {basis: 'steering_answered'}`, task → `working`, no verdict, no gate dispatch. | `coordinator.mjs:2208-2238, 2259-2272` |
| G3 | **Expiry runs the full final evaluation with the steering receipt durable.** `_expireSteeringCycle` (guard `task.status !== 'paused'`), settles `turn.settled {basis: 'steering_expired'}`, task → `working`, then `_runTrustGate(handle, record.workerResult, { steered: { nudgeId, answered: false } })`. The `steered` receipt rides the gate error-event payload — "we asked and it never answered" is durable. The fire-time evidence re-check the fold adds (D3/B1) runs BEFORE this full final. | `coordinator.mjs:2276-2306` (`:2290` guard, `:2293-2297` settle, `:2303-2305` gate); `:13206` |
| G4 | **`turn_started` is the turn system's own start unit, adapter-gated.** `_observeSteeringCycle(handle, {kind: 'turn_started'})` fires on ANY `turn_started`, and `_steeringEvidenceQualifies` returns `true` for it. The adapters gate `turn_started` to real turn beginnings (one-start/one-terminal accounting; native `turn/started` notification; CLI `turn.started`). | `coordinator.mjs:12053, 2210`; `claude-session.mjs:884-894`; `codex-appserver.mjs:645-648`; `cli-adapters.mjs:120, 155` |
| G5 | **`resource.provider_call` rides the worker stream but is NOT a steering-cycle answer today.** It reaches `_handleEvent`'s default case and `_observeWatchdogEvent` → `_observeLogicalProviderCall`. `_observeSteeringCycle` is never called for it — a provider call for the seat buys zero liveness at the cycle. | `coordinator.mjs:12816-12817, 12827, 9151, 9067-9097` |
| G6 | **The `requested` phase exists in the phase machine; adapters emit `completed` only.** `LOGICAL_CALL_PHASES = ['requested', 'progress', 'completed', 'failed', 'cancelled']` (ACTUAL sorted order); `logicalCallTransition` accepts `requested` as a first phase and `requested → completed` as a terminal transition. Today every adapter emits `resource.provider_call` only at `phase: 'completed'` — at the provider RETURN. No `requested`-phase emission exists. | `coordinator.mjs:48, 76-103`; `claude-session.mjs:1124`; `cli-adapters.mjs:127, 163`; `codex-appserver.mjs:655-660` |
| G7 | **#67 v1.1 is a DRAFT fold, not shipped code.** `handle.turnInFlight` does NOT exist at HEAD (grep over `coordinator.mjs`: zero hits); `REARM_KINDS` does NOT exist at HEAD (grep over `impl/src/`: zero hits). The fold's D2 in-flight-turn gate, D1's decoupled 20-min stall budget, D4's kill ladder, and its stall-seam cycle are contract text. The subsumption analysis below is against the CONTRACT, not shipped behavior. | `stall-watchdog-contract.md` D1-D4; `grep -n turnInFlight impl/src/coordinator.mjs` (empty); `grep -rn REARM_KINDS impl/src` (empty) |
| G8 | **The watchdog is working-only and does not govern the steering-cycle window.** `_armWatchdog` refuses non-`working` handles. During a steering cycle the TASK is `paused` while the HANDLE deliberately stays `working` — the cycle is a separate one-shot `_setTimeout` inside `_armSteeringCycle`; #67's gate does not touch it. | `coordinator.mjs:8733, 2116-2119, 2183-2194` |
| G9 | **#55's lesson is activity ≠ evidence.** The wave stall marker moves on ANY activity (`_activityProjection`: providerCalls, tokens, contentEvents, lastActivityAt) — that is precisely what #55 moved wrongly. TG2's answer classes are EVIDENCE (distinct-digest receipts, resolved interactions, turn boundaries), never raw activity counts. Whether a provider call for the seat is TG2-class evidence is a decision below, not an assumption. | `application.mjs:8041-8068`; `waiting-vocabulary-2026-08-06/grounding.md` §1.4 |
| G10 | **The campaign control law.** "Arbitrary turn-limits and time windows are the wrong class… Liveness and progress are judged from the event vocabulary (provider activity, receipt classes, process lifecycle) with COUNT-based bounds only on unanswered steering cycles; any clock is a deployment-class last resort for total silence, never the primary signal." A bigger window (candidate (a)) is a clock as a workflow control — banned. | `bidirectional-v3-decisions.md:134-140`; `trust-gate-steering-decisions.md` TG3 |
| G11 | **TG6's retirement ruling.** "No skeleton-first, no write-early-to-survive"; "produce your deliverable; progress verdicts evaluate finals, and one progress nudge precedes any verdict." The escape pressure #80 names — a worker that writes early garbage to survive the window — is exactly the class TG6 retired. The fix must not teach a new "beat the window" behavior. | `trust-gate-steering-decisions.md` TG6 + v1.0.2 disposition |
| G12 | **`_observeSteeringCycle`'s paused-only guard.** `if (task.status !== 'paused' && evidence?.kind !== 'interaction') continue;` — a paused task accepts any evidence kind; a non-paused task answers only on an interaction resolution (the blocked-worker unpark; liveness evidence from a still-blocked worker must not tear down the block). | `coordinator.mjs:2241-2256` (`:2251`) |
| G13 | **The shipped watchdog default is a 2-minute `stallMs`, working-only.** At HEAD `_armWatchdog` refuses non-`working` handles (`:8733`) and the resolved watchdog config defaults to `stallMs: opts.watchdog?.stallMs ?? 120000` (`:1057-1058`, action `interrupt`). A mid-compile 20-minute turn under the shipped 2-min default WOULD be stall-declared today — the #67 D2 in-flight gate is the restoration, and that is a **depending-on-#67** row (B3), not shipped behavior. | `coordinator.mjs:8731-8733, 1057-1058` |

---

## 2. Subsumption analysis (first, honest)

The verdict: **#67 v1.1 closes the WATCHDOG half of #80 and the "started" half of the cycle; the
queued-start slice — the next turn not yet started — is the residual #80 owns.**

**Closed by #67 v1.1 — the watchdog half (depending-on-#67 row).** A next turn that HAS started
but is silent — a 20-minute compile, a provider call that hangs but is still running — is never
stall-declared by the watchdog: the D2 in-flight-turn gate re-arms without declaring (`if
(handle.turnInFlight === true) { this._armWatchdog(handle); return; }`), and the wall budget
(`DEFAULT_BUDGET.wallMin * 60_000`) is the operator-pinned hung-turn backstop. The control-law
line — **no bound fires on elapsed time without an evidence check** — is restored for the
watchdog. If #80's failure mode were the watchdog declaring a stall mid-turn, #67 closes it.
**This closure is #67 contract text, not shipped behavior**: at HEAD the shipped watchdog default
is 2-min `stallMs` (G13), and a mid-compile 20-min turn under that shipped default WOULD be
stall-declared. During a steering cycle the task is `paused` (G8), and #67's D4 rung 3
additionally gates any reap on `turnInFlight === false` — a started-but-silent turn is never
reaped, only escalated.

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
separate ladder for the stall-DECLARED path, with its own answer set (the D2 REARM_KINDS — a
**depending-on-#67** surface, G7). The pause-admission seam (`_admitPauseRecord`) is untouched by
#67. The two one-shot timers are independent surfaces; #80's contract must not conflate them.

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

### D2 — The turn-start dispatch receipt answers the cycle (candidate (b), extended)

**The new answer class (named honestly, per B2).** `resource.provider_call {phase: 'requested',
callId}` — the adapter's durable receipt that a turn-start request has been **handed to the
provider, before the provider has accepted it** (the turn-start **dispatch receipt**) — is added
to the steering-cycle answer set. It is the evidence that "the next turn is legitimately
starting" at the seat layer, before any provider content returns. It is the **weakest**
start-class answer: it does not distinguish "dispatched at the provider" from "accepted into the
provider queue," and a dead or hung provider after dispatch still yields the receipt. It is
strictly weaker than `turn_started`, which proves the provider engaged. It is never called "the
provider queue ack" and never called "the honest START evidence" in this contract — those names
overstate a raw-dispatch receipt and are a post-mortem hazard (a fold recording `requested` is
not evidence the provider engaged).

- **Mint point pinned (per B2).** The adapters emit `resource.provider_call {phase: 'requested',
  callId}` at the turn-start **dispatch**, before the await: codex at the `_sendRequest(session,
  'turn/start', …)` invocation in the `mode === 'turn'` prompt path
  (`codex-appserver.mjs:997`, before `session.activeTurn = { id: turnResult.turn.id }` at
  `:1005`). The claude pipe is **atomic** — `_writeUserFrame` emits `turn_started` synchronously
  at frame write (`claude-session.mjs:884-894`), so it needs NO `requested`-phase emission
  (`turn_started` already answers, G4). cli-adapters emit at its exec/turn dispatch
  (`cli-adapters.mjs:120, 155`). The phase machine already accepts `requested` (G6); no new wire
  kind, no new refusal code.
- **Answer.** `_steeringEvidenceQualifies` gains a `provider_call` evidence class: a valid
  `requested`- OR `completed`-phase provider call for the seat answers the cycle.
  `_observeSteeringCycle` is called for `resource.provider_call` events (observation point:
  `_handleEvent`'s handling of the kind — today the default case at `:12816-12817`; the call is
  added beside the existing `_observeSteeringCycle` sites `:12053`/`:12454`). Phase/callId
  validity is a prerequisite — an invalid or duplicate call (`_observeLogicalProviderCall`'s
  `provider_call_id_invalid` / `provider_call_phase_invalid`, `:9067-9097`) is telemetry noise,
  never an answer. Scoping is **per-handle**, matching `turn_started`: the observation routes by
  the event's worker, so a call answers only when its worker IS the cycle's handle (the seat).
  Calls from any other worker — including the #47 readiness tier's probe receipts
  (`liveness-probe-*`, `route-liveness.mjs:346-350`, which mint
  `resource.provider_call {phase:'completed'}` for isolated probe workers) — never reach the
  seat's cycle.
- **What a `completed`-phase call means.** A `completed`-phase provider call (the provider
  RETURNED, G6) is the STRONGEST liveness — a call that both started and returned — and is also an
  answer: during an armed window a `completed` call can only belong to the next turn (the
  checkpoint's own turn completed before the pause). The answer set accepts `requested` **and**
  `completed` phases for the seat. The honest-stall discriminator (D3) is "NO provider call of
  either phase AND no `turn_started` AND no TG2-class receipt AND no resolved interaction within
  the window."
- **The zombie-answer discrimination (per the red-team brief).** A dispatch receipt cannot answer
  forever: the cycle is once-per-pause-record (G1), so a started-but-dead turn answers the cycle
  exactly ONCE, and the FINAL still demands the real in-scope diff (TG2's no-content-floor rule).
  What the `requested` receipt changes is only WHICH bound absorbs the deferred honest stall when
  the provider accepted nothing. The fold therefore records the provider_call **phase**
  (`requested` vs `completed`) so a post-mortem distinguishes "requested at dispatch, then
  accepted" (healthy slow-start) from "requested at dispatch, never started" (the deferred
  zombie) — the #55-class debug trace (D3's fold + B1's fire-time re-check consume this phase
  identity).
- **The anti-gaming bound (deferral quantified, depending-on-#67).** The cycle is
  once-per-pause-record (G1); the first qualifying answer settles it. A worker that dispatches a
  provider call then hangs answers the cycle and defers the honest stall to the deployed
  hung-turn backstop. That backstop is a **depending-on-#67 row**: at HEAD the shipped backstop
  is the deployment-configured watchdog — `stallMs: opts.watchdog?.stallMs ?? 120000`, 2-min
  default, operator-overridable (G13) — while #67 v1.1's contract text makes the wall budget
  (`DEFAULT_BUDGET.wallMin * 60_000` = 480 min) the operator-pinned hung-turn backstop. The
  contract's honest-stall line (D3) is framed against that deployed backstop and stamped
  depending-on-#67 (B3); it is never presented as a shipped 480-min bound. No re-arm: a
  dispatched-but-hung turn is never a cycle re-arm — the same honesty the existing `turn_started`
  answer has. A worker cannot farm: one answer per record, and the FINAL still demands the real
  in-scope diff (TG2's no-content-floor rule, `trust-gate-steering-decisions.md` TG2). No new
  count bound is added — the one-shot is the bound.
- **The self-answering guard's precondition is contract text (per B2).** The steering nudge is
  delivered by the POLICY actor at arm time (`:2178-2181`). Counting the nudge's delivery as the
  cycle's answer would make the cycle **self-answering** — the arm action would always answer, and
  a genuinely dead worker whose adapter accepts a prompt but whose harness never responds would
  never be evaluated (the honest-stall discriminator would be dead on arrival). That guard is
  valid ONLY because the `requested`-minting dispatch is a **gated steering/orchestrator
  admission**, never an automatic arm-time consequence — verified at HEAD: the arm sends mode
  `'nudge'` only (`:2179`); mode-`'turn'` dispatches flow through `nudgeTurn`, which clears the
  steering timer first (`_clearSteeringTimer(record)`, `:2433`), or through `_deliver` /
  `_deliverFollowUp` under explicit gates (goal-plan continuation authority, run-sealed,
  worker-stopping, semantic-target drift, `:7268-7306`). **This precondition is load-bearing: any
  future automatic-continuation path that dispatches a turn unconditionally at arm time would
  silently convert the `requested` receipt into a self-answer and kill the discriminator — such a
  path must preserve the gated-admission property.** The `control.nudge` receipt (actor `'policy'`,
  `:7401-7408`) is explicitly NOT an answer class.

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
no diff receives. The evidence-gating (D2) is what makes this honest: the expiry runs the full
final **only when the window's fold is empty of start-class evidence** (below, B1).

**The fire-time evidence re-check is mandatory (B1 — the strongest blocker).** `_expireSteeringCycle`
today runs the full final gate on any timer fire (guard `task.status !== 'paused'`, `:2290`),
without consulting whether start evidence was observed in-window. A D2 consume-path defect — a
valid `provider_call {phase:'requested'}` observed in-window, routed to
`_observeSteeringCycle`, appended to `record.steering.observedEvidence`, yet the settle does not
happen — would then run the full final evaluation on a worker whose start evidence exists: a
harness defect killing a healthy worker, the exact #55-class incident this issue exists to
prevent. **Therefore: at expiry, BEFORE running the final, `_expireSteeringCycle` re-checks
`record.steering.observedEvidence`. If the fold contains a start-class identity — `turn_started`,
or a valid-phase `provider_call` (`requested`/`completed`, callId valid per
`_observeLogicalProviderCall` :9067-9097) — the expiry settles CONSTRUCTIVELY: task → `working`,
`turn.settled {basis: 'steering_answered', via: 'evidence_gate_defect'}` (zero gate events), and
receipts a named `steering.evidence_gate_defect` error event carrying the fold. Only when the
fold is empty of start-class evidence (the genuine honest stall) does the full final run.** The
re-check is cheap, self-healing, and cannot be gamed (the evidence is adapter-minted wire truth,
validity-gated by `_observeLogicalProviderCall` before it ever reaches `_observeSteeringCycle`).
Deliberate scope: the defensive settle applies only to the **identity-sufficient** start classes
(`turn_started`, valid `provider_call`) — the digest/resolution classes (scratchpad,
capability_op, interaction) cannot be re-qualified from an identity-only fold; if one of *those*
was observed-but-not-consumed, the expiry still runs the final — acceptable, because those are
not the #80 classes and a post-mortem still sees them in `answerClasses`.

**The expiry is receipted for #55-class debuggability.** Today the only durable trace is the
`steered` receipt on the gate error event (`:13206`). The contract augments the expiry with an
**evidence fold**: `_expireSteeringCycle` records, on the record's `steering` object, the
answer-class kinds observed during the window (`record.steering.observedEvidence`, appended at
each `_observeSteeringCycle` evidence evaluation — event identities only, no timestamps; the
provider_call class keeps its **phase** identity, `requested` vs `completed`, per B2/D2 and
OQ-3), and the expiry carries a compact summary on BOTH the `turn.settled {basis:'steering_expired'}`
payload (`:2293-2297`) and the `steered` receipt (`:13206`): `{windowMs, startEvidenceObserved:
boolean, answerClasses: [...]}` (the observed kinds, in observation order, bounded to the closed
vocabulary). The B1 constructive settle carries the same fold on its `steering.evidence_gate_defect`
receipt. A post-mortem can then distinguish "the harness never dispatched a turn" (honest stall →
correct final) from "the provider accepted a call but the cycle still expired" (a defect in the
D2 evidence gate → constructive settle + defect receipt). No wall-clock is added beyond the
existing `windowMs` knob — the fold is event-identities, per the #88 CP4 shape law
(`claim-preflight-contract.md:220-228`). The fold must preserve the start-class **kind**
(identity), not collapse to a dedup count — the expiry's re-check consumes the kind (OQ-3).

### D4 — The guard surface

`_observeSteeringCycle`'s paused-only guard (G12, `:2251`) is preserved and extended:
`provider_call` evidence answers only while the task is paused (the armed window). A non-paused
worker's provider calls are in-turn activity, not checkpoint-start evidence, and must not tear
down a block — the existing `evidence?.kind !== 'interaction'` non-paused rule is untouched. The
`resource.provider_call` observation reaches `_observeSteeringCycle` WITHOUT disturbing
`_observeWatchdogEvent` (which keeps its own provider-call tracking at `:9151`); the two
consumers stay independent. The #67 REARM_KINDS fold (which excludes `resource.provider_call`) is
not contradicted — and is a **depending-on-#67 row** (B3): the watchdog's re-arm set and the
steering cycle's answer set are separate surfaces with separate purposes (liveness re-arm vs
checkpoint-start evidence), and #67's closed set (0 hits at HEAD, G7) is asserted byte-unchanged
against #67 contract text, verified when #67 folds.

---

## 4. Refusal / observability vocabulary (closed)

| Kind / field / receipt | Reach | Fires when |
|------------------------|-------|------------|
| `resource.provider_call {phase: 'requested'}` (NEW emission; existing wire kind + existing phase, G6) | adapter stream → `_handleEvent` default case → `_observeSteeringCycle` + `_observeWatchdogEvent` | a turn-start prompt is **handed to the provider** (the turn-start **dispatch receipt**, D2/B2); adapters where dispatch and `turn_started` are atomic need no emission (G4); emission point pinned — codex `:997` (before the await), cli at exec/turn dispatch |
| `_steeringEvidenceQualifies` `provider_call` class (NEW branch) | coordinator answer evaluation | a valid `requested`/`completed`-phase provider call for the seat inside the armed window (D2) |
| `record.steering.observedEvidence` (NEW field) | in-memory record → expiry fold | every answer-class evidence evaluation during the window (D3); the provider_call class records its **phase** identity (`requested` vs `completed`, OQ-3) |
| `steered` receipt gain `{windowMs, startEvidenceObserved, answerClasses}` (NEW fields on the existing receipt) | gate error-event payload (`:13206`) + `turn.settled {basis:'steering_expired'}` payload (`:2293-2297`) | genuine window expiry (D3) — the #55-class post-mortem trace |
| `steering.evidence_gate_defect` (NEW named error-event receipt) | coordinator error-event payload (gate-free) | the B1 constructive settle — expiry re-check found a start-class identity in the fold yet the cycle had not been consumed (D3/B1); carries the fold |
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
| TW-02 | **The turn-start dispatch receipt is emitted at the dispatch point.** Native/emulated adapters emit `resource.provider_call {phase: 'requested', callId}` when the turn-start request is handed to the provider — codex at `:997` before the `turn/start` await resolves (`:1005`), cli at its exec/turn dispatch; a staged slow-start adapter shows the receipt arriving before `turn_started`; no `requested`-phase emission exists for the atomic adapters (claude pipe) where `turn_started` is synchronous with dispatch. | **RED** (all adapters emit `completed` only, G6) |
| TW-03 | **A queued start never expires the window.** Stage: a checkpoint pause arms the cycle; the next turn's provider call is `requested` at minute 4 of the window (no `turn_started`, no content); at expiry the cycle settles constructively — task `working`, ZERO gate events, ZERO `steered` receipts. Holds across a D2 consume-path defect too (B1's fire-time re-check settles the same way). | **RED** (no provider_call answer; `_expireSteeringCycle` runs the full final gate at `:2303-2305`) |
| TW-04 | **The honest stall still evaluates.** Stage: a checkpoint pause arms the cycle; NOTHING arrives (no `turn_started`, no provider call, no TG2 receipt, no resolved interaction); the window expires with an empty fold of start-class evidence and the full final evaluation runs exactly as today with `steered: {nudgeId, answered: false}` durable on the gate error event. | **GREEN** (pin — today's T7b behavior, `trust-gate-steering-red.test.mjs:230-248`) |
| TW-05 | **A D2-gate defect never kills a healthy worker (B1).** Stage: a staged defect in the D2 gate — a valid `provider_call {phase:'requested'}` for the seat IS observed in-window and appended to `record.steering.observedEvidence`, yet the cycle is not settled — at expiry the fire-time re-check finds the start-class identity and settles CONSTRUCTIVELY: task → `working`, zero gate events, and a named `steering.evidence_gate_defect` error event carrying the fold (`startEvidenceObserved: true`, `answerClasses: ['provider_call']`). The worker survives; the defect is exposed by the receipt. | **RED** (no fold, no re-check; the expiry runs the full final and kills the worker, G3) |
| TW-06 | **`turn_started` remains a first-class answer (pin).** A resumed turn inside the window settles the cycle — zero gate events. | **GREEN** (pin, `:12053`/`:2210`, `trust-gate-steering-red.test.mjs:181-198`) |
| TW-07 | **The nudge never self-answers.** The policy nudge's own delivery (`control.nudge`, actor `'policy'`) does NOT settle the cycle; a staged **buffering-kind** adapter (codex-like: nudge → `nudgeQueue`, no turn start, `codex-appserver.mjs:971-975`) that accepts the nudge but never starts a turn still expires with `steered: {answered: false}`. The staging must be a buffering adapter, not an atomic one — for the claude pipe the nudge IS a turn start when idle (`claude-session.mjs:884-894`), so an "accepts but never starts" stage is impossible there. | **GREEN** (pin — `control.nudge` is not in the answer set; the fold's TW-03 staging proves the discriminator) |
| TW-08 | **Once-per-record bound (pin).** The cycle is answered at most once per pause record; a worker emitting multiple provider calls answers exactly once (the first), and no second cycle arms for the same record. | **GREEN** (pin — one-shot arm at `:2134`, consume at `_settleSteeringCycle`) |
| TW-09 | **The watchdog surface is untouched — split into two halves (B3).** (a) **Shipped half (GREEN at HEAD):** `_armWatchdog`'s working-only refusal (`:8733`) and `_observeWatchdogEvent`'s own provider-call tracking (`:9151`) are byte-unchanged by this contract. (b) **Depending-on-#67 row (untestable at HEAD):** the #67 REARM_KINDS fold (which excludes `resource.provider_call`) is asserted byte-unchanged against the #67 v1.1 contract text (`REARM_KINDS` = 0 hits at HEAD, G7) — verified when #67 folds. | **GREEN** for (a); **(b) is a depending-on-#67 row, not a shipped pin** |
| TW-10 | **No clock is added anywhere.** The diff introduces zero new `setTimeout`/`Date.now()` deltas/`*Ms` knobs beyond the existing `progressNudgeWindowMs`; the queued-start answer is evidence (a provider call), never a window extension. | **RED** (the fix must not ship a bigger window; candidate (a) is rejected by construction) |

---

## 6. Campaign-law constraints and non-goals

- **No clocks as controls.** The window's `progressNudgeWindowMs` default is byte-unchanged; the
  fix is evidence-gated (D2) — a provider call answers, nothing is extended. The genuine
  expiry (D3) stays the count-based bound: ONE unanswered cycle → the final, and the B1
  fire-time re-check makes "no bound fires on elapsed time with zero evidence check" true at fire
  time for the start classes. No new `*Ms` knob, no per-route latency table, no re-arm-on-expiry
  loop.
- **Every answer class is EVIDENCE, never a bigger window.** The three start/return markers —
  `turn_started`, `provider_call {requested}`, `provider_call {completed}` — are adapter-minted
  wire truths (unspoofable by worker text), distinct-digest/resolution classes stay as TG2 pins
  them, and `control.nudge` (the policy's own action) is explicitly excluded (D2).
- **No new event kinds, no new refusal codes.** The fix reuses `resource.provider_call` (existing
  kind) and the `requested` phase (existing `LOGICAL_CALL_PHASES` entry, G6). The observable
  additions are one emission per native/emulated adapter, one `_steeringEvidenceQualifies` branch,
  and the receipt-field gains (D3/B1). `stateFailureCode` / the web mapper are untouched.
- **Sorted-key literals in ACTUAL order.** `LOGICAL_CALL_PHASES` is reused, not duplicated;
  `localeCompare` is banned. No new kind literal is introduced.
- **NUL-byte discipline.** `coordinator.mjs` (0 NUL), `claude-session.mjs`/`cli-adapters.mjs`/
  `codex-appserver.mjs` (0 NUL each) were read whole; `application.mjs` (3 NUL) and
  `coordination-store.mjs` (3 NUL) by `sed -n`/`grep -an` only.
- **Depending-on-#67 posture (B3).** Every row whose closure rides #67 v1.1 contract text — the
  §2 watchdog half, D2's deferred-stall backstop, D4's REARM_KINDS non-contradiction, TW-09(b) —
  is stamped depending-on-#67 and names the target-state value (the wall budget
  `DEFAULT_BUDGET.wallMin * 60_000`; `REARM_KINDS`), per the #114-B3/#97 precedent. No such row
  reads as shipped behavior; the shipped half is G13 (2-min `stallMs` working-only watchdog).
- **Non-goals.** Candidate (a) per-route latency scaling (rejected, D1); a constructive re-arm on
  expiry (rejected, D3); a bigger window (rejected, D1 + TW-10); the #67 watchdog surface and
  REARM_KINDS (depending-on-#67 cross-ref, TW-09); TG6 coaching retirement (already
  verified-closed, cross-ref G11); the wave driver's own stall clock and the #55 activity
  projection (cross-ref only, G9); re-specifying TG2/TG3 or #10's vocabulary (cross-referenced
  only).

---

## 7. Open questions (verdicts folded)

- **OQ-1 — Which adapters get the `requested`-phase emission first? RESOLVED (per B2).** The
  atomic adapters (claude pipe) need none; the native/emulated ones (codex-appserver,
  cli-adapters `exec`) need it, and the emission point is pinned (codex at `:997` before the
  await; cli at exec/turn dispatch). Land codex-appserver first (the `turn/started` lag is the
  observed #80 shape), cli-adapters second, and pin TW-02 against a staged slow-start adapter.
- **OQ-2 — Should a `progress`-phase provider call answer? DEFERRED (sound).** The phase machine
  has a `progress` phase (`:48`) that no adapter emits today. The contract accepts `requested`
  and `completed` (start and return). A `progress`-phase call is stream-telemetry mid-call; if an
  adapter later emits it, the evidence class extends by the same rule (a valid provider call for
  the seat inside the window). No code decision is needed until an adapter emits it — the guard is
  phase-validity, and the honest-stall discriminator already treats any valid provider call as
  start evidence.
- **OQ-3 — The `observedEvidence` fold bound. RESOLVED-with-note (per B1 + CP4).** The fold
  records answer-class kinds observed during the window (D3). Its size is bounded by the closed
  vocabulary (turn_started, provider_call, scratchpad, interaction, capability_op) and per-answer
  dedup; the contract leaves the exact cap to the implementer under the #88 CP4 shape law (event
  identities, replay-stable, no timer flakes). **The fold must keep the start-class KIND
  (identity) — a `turn_started` / `provider_call` kind, and for provider_call the phase — not just
  a dedup count, because the B1 expiry re-check consumes the kind.** No count bound is a control
  mechanism here — it is a receipt-size bound.

---

## 8. Verification

- **HEAD pinned:** `2d9de15390bdfe8fc650a4199e45dd74629acfba` (current worktree HEAD). Every
  anchor in §1 was re-verified by `grep -an`/`sed -n` on the current tree; `coordinator.mjs`
  (0 NUL bytes) was read whole; `application.mjs` and `coordination-store.mjs` (3 NUL bytes
  each) by `sed -n`/`grep -an` only. The v1.0 pin (`0b5df0c`) and the red-team's attack-time pin
  (`8aa9f4c`) differ from the fold HEAD only by the #114 fence fix and doc-only commits; the
  #114 fence fix shifts `coordinator.mjs` anchors after `:10556` by **+3**, so this fold re-pins
  the five affected anchors (`:12050→:12053`, `:12451→:12454`, `:12813-12814→:12816-12817`,
  `:12824→:12827`, `:13203→:13206`) — each re-verified above. Sorted-key literals appear only as
  verified.
- **The residual is LIVE at HEAD:** `_steeringEvidenceQualifies` has no `provider_call` class
  (`:2208-2238`); no adapter emits `requested`-phase provider calls (G6); `_expireSteeringCycle`
  runs the full final gate on ANY unanswered window regardless of start evidence (`:2303-2305`);
  the `steered` receipt carries no evidence fold (`:13206`). The TW-03 queued-start failure is
  reproducible at HEAD with a staged slow-start adapter.
- **Deployment verification command** (Baton): executable `true`, arguments `[]`, expected exit 0.
