# #80 RED-TEAM VERDICT — TG3-window implementation contract v1.0 DRAFT

**Red-teamer:** Baton adversarial red team (attempt r6-2026-08-07T03:27:54.621Z)
**Target:** `tg3-window-contract.md` (v1.0 DRAFT, 302 lines)
**Date:** 2026-08-07
**Working HEAD at attack time:** `8aa9f4c19e4832c589a234fa29743f4c830d72e1`

---

## 0. Method and execution facts

- Read the brief IN FULL first (`redteam-80-brief.md`), then the contract whole, then attacked in the brief's seven areas.
- **NUL-byte discipline** enforced exactly as the brief demands: `application.mjs` (3 NUL) and `coordination-store.mjs` (3 NUL) read by `sed -n`/`grep` only; `coordinator.mjs` (0 NUL) read whole; the adapter files read whole.
- **HEAD note (minor, not a blocker).** The contract pins "Verification HEAD: `0b5df0c…` (current worktree HEAD)" (§1 header, §8). The actual current HEAD is `8aa9f4c`. The delta between `0b5df0c` and `8aa9f4c` adds only the #79/#80 docs and the effective-tree snapshot — zero code changes — so **every code anchor re-verified at `8aa9f4c` is valid**. The contract's HEAD pin is stale by a doc-only commit; it should be corrected at fold time for the record.
- **Verification command** (Baton): executable `true`, args `[]`, expected exit 0.

---

## 1. Citation re-verification — ALL PASS (no wrong citations)

Every G1–G12 anchor plus every secondary citation was re-run at `8aa9f4c`. **No automatic blocker triggered.**

| Citation | Re-verified at HEAD |
|---|---|
| G1 `:2076, 2123-2134, 1003, 2178-2181` | ✓ `_admitPauseRecord` mints at turn_completed, `hasDriver` scan, one-shot arm, `_progressNudgeWindowMs ?? 300_000`, nudge send |
| G2 `:2208-2238, 2259-2272` | ✓ `_steeringEvidenceQualifies` (turn_started / scratchpad digest / resolved interaction / capability_op digest), `_settleSteeringCycle` → `working` |
| G3 `:2276-2306, 2290, 2293-2297, 2303-2305, 13203` | ✓ guard, settle, `_runTrustGate` with `steered`; `steered` rides the gate error event |
| G4 `:12050, 2210` + `claude-session.mjs:884-894` + `codex-appserver.mjs:645-648` + `cli-adapters.mjs:120,155` | ✓ `turn_started` observe site; `_writeUserFrame` emits synchronously; codex `turn/started`; CLI `turn.started` |
| G5 `:12813-12814, 12824, 9151, 9067-9097` | ✓ default case; `_observeWatchdogEvent` feed; provider_call → `_observeLogicalProviderCall`; invalid id/phase codes |
| G6 `:48, 76-103` + `claude-session.mjs:1124` + `cli-adapters.mjs:127,163` + `codex-appserver.mjs:655-660` | ✓ `LOGICAL_CALL_PHASES` literal + `logicalCallTransition` accepts `requested` as first phase and `requested→completed` terminal; adapters emit `completed` only (claude-session:1124, cli-adapters:127/163, codex:655-660) |
| G7 `stall-watchdog-contract.md` D1-D4; `grep -n turnInFlight` empty | ✓ `turnInFlight` = 0 hits at HEAD; REARM_KINDS = 0 hits at HEAD (see §2/B3) |
| G8 `:8733, 2116-2119, 2183-2194` | ✓ `_armWatchdog` refuses non-`working`; pause keeps handle working; cycle one-shot `_setTimeout` |
| G9 `application.mjs:8041-8068`; `grounding.md` §1.4 | ✓ `_activityProjection` (providerCalls/tokens/contentEvents/lastActivityAt) |
| G10 `bidirectional-v3-decisions.md:134-140`; TG3 | ✓ control-law wording |
| G11 TG6 + v1.0.2 | ✓ "no skeleton-first, no write-early-to-survive" |
| G12 `:2241-2256, 2251` | ✓ paused-only guard `if (task.status !== 'paused' && evidence?.kind !== 'interaction') continue` |
| D2 secondary: `:7401-7408` (control.nudge), `:9075-9097`, `route-liveness.mjs:346-350`, `:12813-12814`, `:12050`/`:12451` | ✓ `control.nudge` receipt at :7401-7416 (laneKind nudge); invalid id/phase codes; probe receipts mint `provider_call {phase:'completed'}` (`_mintProbeReceipts` :342-355, `PROBE_WORKER_PREFIX='liveness-probe-'` :9); default-case observation; observe sites |
| D3 secondary: `:2293-2297`, `:13203`, `claim-preflight-contract.md:220-228` | ✓ settle payload, `steered` receipt, CP4 shape law |
| TW-04 `trust-gate-steering-red.test.mjs:230-248`; TW-06 `:181-198` | ✓ T7b / T5 staging exists |

---

## 2. Subsumption attack (§2 + G7 + G8)

**Verdict: the analysis is HONEST in structure but under-marked for unshipped-work dependence. See B3.**

What is right:
- The analysis is declared "against the CONTRACT, not shipped behavior" in G7, and the read-order section names the #67 v1.1 contract explicitly. That satisfies the #114-B3/#97 depending-on-rows precedent at the ground-truth level.
- G8 is verified: the steering-cycle one-shot timer and the watchdog are independent surfaces; #67's in-flight-turn gate (contract text) does not touch the pause-admission seam.
- The "queued-start slice" is correctly identified as the residual #80 owns: the next turn has not started, so neither #67's gate (requires a started turn) nor the TG3 answer set (requires `turn_started` or TG2 evidence) has evidence. This is the honest partition.

What is wrong / under-marked:
1. **The "watchdog half closed" headline is true only under #67 contract text.** At HEAD the shipped watchdog is `stallMs: opts.watchdog?.stallMs ?? 120000` (`coordinator.mjs:1057-1058`, 2-min default, action `interrupt`, working-only at :8733). A mid-compile 20-min turn under the shipped 2-min default would be stall-declared — only #67's D2 in-flight gate restores the line. The contract says "If #80's failure mode were the watchdog declaring a stall mid-turn, #67 closes it" (§2) — honest — but the summary line "the watchdog half" is read as closed, and its closure is not stamped "depending-on-#67" in the places the consequences are used (D3's honest-stall framing, TW-09's REARM_KINDS half, D2's "the wall budget's backstop (G7)").
2. **D2's deferral bound is a #67 contract value.** "A worker that dispatches a provider call then hangs is the wall budget's backstop (G7)" — the 480-min wall budget is `DEFAULT_BUDGET.wallMin * 60_000` from the #67 contract. At HEAD the honest backstop for a dispatched-but-hung turn is the deployment-configured watchdog (default 2-min `stallMs`, or an operator override). The contract cites G7 (a depending-on-#67 row) as if it were the operative bound. See B2 item (4).

---

## 3. Residual fix evidence classes (D2 / D3) — the core attack

### 3.1 The `requested` class is a dispatch receipt, not a "provider queue ack" — **HOLE, blocker B2**

The contract's D2 wording: "the adapter's durable receipt that a provider call for the worker's seat has been **dispatched into the provider queue** — … the **provider queue ack** … at the moment a turn-start prompt is **handed to the provider**"; the vocabulary table: "a turn-start prompt is **dispatched into the provider queue** (the provider queue ack, D2)"; and D2's honesty framing: "The worker-side provider queue ack is the **honest START evidence**."

I re-pinned the actual emission point in `codex-appserver.mjs`. For the codex wire there are three distinct moments:

1. **Dispatch** — `prompt(worker, content, 'turn')` invokes `_sendRequest(session, 'turn/start', …)` (`:997`). The request is on the transport; the provider has not responded.
2. **Acceptance** — the `turn/start` *response* resolves and `session.activeTurn = { id: turnResult.turn.id }` (`:1005`); the provider has accepted a turn id. This is the true "queue ack."
3. **Start** — the `turn/started` notification arrives via the stream (`_onNotification`, `:645-648`). This is today's answer class (G4).

The #80 slice lives **between 1 and 2**: "the provider seat has not accepted it into the queue." To cover that slice the receipt must mint at **point 1 (dispatch, before the await)**, because the window can expire while the `turn/start` request is awaiting a slow acceptance. Therefore the mint point the contract needs is dispatch — and at that point the class **does not distinguish "dispatched at the provider" from "accepted into the provider queue."** A dead or hung provider after dispatch still yields the receipt.

Consequences that must be fixed before fold:
- **The class is weaker than the contract's name.** "Queue ack" and "honest START evidence" overstate a raw-dispatch receipt. It is the *weakest* start-class answer (weaker than `turn_started`, which proves the provider engaged).
- **The honest-stall discriminator has a known hole.** A dispatched-but-never-accepted turn (dead provider, transport drop) answers the cycle and defers the honest stall to the wall budget. That deferral is a real regression from the 5-min window to the wall budget (480 min under #67's `wallMin * 60_000`, or the deployed watchdog `stallMs` at HEAD) and the contract quantifies none of it.
- **The self-answering guard's precondition is unstated.** D2's rejection of the nudge's own dispatch is: "the arm action would always answer … the honest-stall discriminator would be dead on arrival." That argument is valid **only if the `requested`-minting dispatch is not itself a guaranteed arm-time consequence.** I verified the precondition HOLDS at HEAD: the arm sends `control.nudge` (mode `'nudge'`) only (`:2179`); mode `'turn'` dispatches flow through `nudgeTurn` — which *clears the steering timer first* (`_clearSteeringTimer(record)`, `:2433`) — or through `_deliver`/`_deliverFollowUp` under explicit gates (goal-plan continuation authority, run-sealed, `worker_stopping`, semantic-target drift, `:7268-7306`). So a `requested` receipt cannot fire purely from the arm action today. But the contract never pins this, and any future automatic-continuation path that dispatches a turn unconditionally at arm time would silently convert the `requested` receipt into a self-answer — killing the discriminator. **The precondition is load-bearing and must be contract text.**

### 3.2 The expiry does not re-check evidence at fire time — **HOLE, blocker B1 (the strongest blocker)**

The contract's central claim (D3): "The evidence-gating (D2) is what makes this honest: **the expiry now fires only when no start evidence exists.**" That is true at the **consume path** (a qualifying evidence settles before expiry) but is **not true at fire time**: `_expireSteeringCycle`'s only guard is `task.status !== 'paused'` (`:2290`); on any timer fire it settles `steering_expired` and runs the **full final gate** (`:2303-2305`) — unconditionally, without consulting whether start evidence was observed in-window.

Now consider the D2 consume path having a defect — a valid `provider_call {phase:'requested'}` for the seat arrives in-window, is routed to `_observeSteeringCycle`, and is appended to `record.steering.observedEvidence`, but the settle does not happen (a routing/guard bug in the new branch). The expiry then runs the **full final evaluation on a worker whose start evidence exists** — a harness defect killing a healthy worker. **That is the exact #55-class incident the issue exists to prevent, reproduced by the contract's own staged test and kept.**

The contract's own TW-05 stages precisely this: "a staged defect in the D2 gate (a `provider_call` ack IS observed in-window yet the cycle still expires) records `startEvidenceObserved: true` and `answerClasses: ['provider_call']` on the expiry, exposing the defect to a post-mortem." The pin is satisfied by *exposing the defect after the kill*. The red team rejects this disposition for three reasons:

1. The seed of #80 is "killing a healthy worker mid-workflow (the #55-class incident)." A defect in new code is a harness bug; killing the worker for it re-instantiates the incident.
2. The contract's own claim — "the expiry now fires only when no start evidence exists" — is literally false at fire time without the re-check.
3. The control-law line (G10: "no bound fires on elapsed time with **zero evidence check**") is violated in the defect case: the timer fires with start evidence present but unconsulted.

The fix is cheap, self-healing, and cannot be gamed (the evidence is adapter-minted wire truth):

> **`_expireSteeringCycle` must re-check `record.steering.observedEvidence` at fire time, before the final.** If the fold contains a start-class identity — `turn_started`, or a valid-phase `provider_call` (`requested`/`completed`, callId valid per `_observeLogicalProviderCall` :9075-9097) — settle **constructively** (`task → working`, `turn.settled {basis: 'steering_answered', via: 'evidence_gate_defect'}`, zero gate events) and receipt a named `steering.evidence_gate_defect` error event carrying the fold. Only when the fold is **empty of start-class evidence** (the honest stall) does the final run. TW-05 then proves the fix — the staged defect settles constructively with the defect receipt — instead of the kill.

This requires the fold to record start-class identities **after** phase/callId validity (the contract already routes invalid calls out via `_observeLogicalProviderCall` before `_observeSteeringCycle`, so the evidence-evaluation site is validity-gated by construction). Note the deliberate scope: the defensive settle applies only to the **identity-sufficient** start classes (`turn_started`, valid `provider_call`). The digest/resolution classes (scratchpad, capability_op, interaction) cannot be re-qualified from an identity-only fold; if one of *those* was observed-but-not-consumed, the expiry still runs the final — acceptable, because those are not the #80 classes and a post-mortem still sees them in `answerClasses`.

### 3.3 What is sound in the evidence design

- **Adapter-minted, per-handle scoped, durable and replay-derived:** the `requested` receipt is an adapter wire fact (unspoofable by worker text), routed by the event's worker to the seat's cycle; probe receipts (`liveness-probe-*`, `route-liveness.mjs:346-350`) mint `phase:'completed'` for isolated workers and never reach the seat's cycle (verified). The distinct-digest/resolution classes stay exactly as TG2 pins them. TW-08's once-per-record bound holds (one-shot arm :2134).
- **Phase validity as the prerequisite** (`provider_call_id_invalid` / `provider_call_phase_invalid`, :9075-9097) is the right gate — invalid calls are telemetry noise, never an answer.
- **A `completed` call in-window is the strongest liveness**, and its "can only belong to the next turn" reading is sound: the pause records at `turn_completed`, so the pre-pause turn's calls are done; a `completed` call in-window is a new turn's return.

---

## 4. Expiry disposition (D3)

**Verdict: SOUND in structure — with the B1 correction.** The "constructive re-arm is REJECTED" ruling is correct: a re-arm converts the count-based bound (G10: ONE unanswered cycle → the final) into a clock and re-opens the #105-class indefinite-extension escape. The full-final-with-`steered:{answered:false}` disposition is the right anti-gaming outcome for a genuinely start-less worker. The receipting (evidence fold on both `turn.settled` and `steered`) is the correct #55-class debuggability step, and the fold is event-identities per the #88 CP4 shape law. The only defect is the no-re-check-at-fire-time gap (B1).

One implementer note for the fold bound (OQ-3): with B1 in place, the fold **must preserve start-class identity distinctly** — it cannot collapse all classes into a dedup count and drop the class kind, because the expiry's re-check depends on seeing a `turn_started`/`provider_call` kind. The CP4 size bound still holds (closed vocabulary + per-answer dedup), but the shape law's "event identities" must keep the kind of the identity, not just a count.

---

## 5. Control-law line (D1 + §6)

**Verdict: SOUND.** Candidate (a) per-route latency scaling is correctly rejected as a clock-as-workflow-control (G10); the window default stays byte-unchanged; no new `*Ms` knob, no re-arm loop, no latency table. The count-based bound is preserved. The one line that brushes the law — the expiry firing on the timer — is exactly the point B1 tightens: the re-check makes "no bound fires on elapsed time with zero evidence check" true at fire time for the start classes. With B1, D1 + D3 + B1 form a clean line: a bigger window is banned; a count-based bound remains; and the timer cannot fire past existing start evidence.

---

## 6. TG6 compatibility

**Verdict: SOUND.** `resource.provider_call` is adapter-minted wire truth — a worker cannot forge it from its own text (the coordinator mints nothing from worker output; the observation is a wire event with phase/callId validity). D2 therefore does **not** teach a write-early-to-survive behavior: the receipt is not obtainable by producing output. The distinct-digest classes are untouched. The one-shot + final's no-content-floor rule (TG2) keeps the anti-farming bound. No new "beat the window" vocabulary is introduced.

---

## 7. Acceptance pins and open questions — per-item verdicts

| Pin | Verdict | Basis |
|---|---|---|
| TW-01 `provider_call` answers the cycle | **SOUND** | RED at HEAD (G5 verified); the answer path is specified |
| TW-02 provider queue ack emitted | **HOLE-adjacent** | RED at HEAD (G6 verified). The staging must pin the **dispatch-point** emission and honest naming per B2 (3.1); "the provider queue ack is emitted" carries the overstated name into the pin |
| TW-03 queued start never expires | **SOUND** | RED at HEAD (no provider_call answer; expiry runs the final). With B1, this also holds across a D2 consume defect |
| TW-04 honest stall still evaluates | **SOUND** | GREEN pin; T7b verified (`trust-gate-steering-red.test.mjs:230-248`) |
| TW-05 expiry debuggable | **HOLE → B1** | Stages the D2-gate defect and keeps the kill. With B1 the pin becomes: the staged defect settles constructively and receipts `steering.evidence_gate_defect` — the defect is exposed *and* the worker survives |
| TW-06 `turn_started` first-class (pin) | **SOUND** | GREEN pin; T5 verified (`:181-198`) |
| TW-07 nudge never self-answers | **SOUND-with-note** | GREEN pin. **Staging caveat:** "a staged adapter that accepts the nudge but never starts a turn" is *impossible for the atomic adapters* — for the claude pipe the nudge IS a turn start when idle (`_writeUserFrame` emits `turn_started` synchronously, `claude-session.mjs:884-894`). The staging must be a **buffering** adapter (codex-like: nudge → `nudgeQueue`, no turn start, `codex-appserver.mjs:971-975`), which the TW-03 fold staging already is. The pin's wording should name the buffering-kind staging so it is not vacuous. |
| TW-08 once-per-record bound (pin) | **SOUND** | GREEN pin; one-shot arm at `:2134`, consume at `_settleSteeringCycle` |
| TW-09 watchdog surface untouched | **HOLE-as-written → B3** | Splits into two halves: the shipped half (`_armWatchdog` working-only :8733, `_observeWatchdogEvent` provider-call tracking :9151) is GREEN at HEAD; the **#67 REARM_KINDS half is contract text — `REARM_KINDS` has zero hits at HEAD** and cannot be tested. Must be a depending-on-#67 row |
| TW-10 no clock added | **SOUND** | RED-first constraint; correct by construction (D1) |

| OQ | Verdict |
|---|---|
| OQ-1 codex-first emission order | **SOUND** — codex-first is right (the `turn/start` → `turn/started` gap is the observed #80 shape; verified `codex-appserver.mjs:997-1005` vs `:645-648`). Pin the emission point per B2 item (2). |
| OQ-2 `progress`-phase answer | **SOUND** — deferring is correct; the guard is phase-validity and any valid provider call is start evidence. No code decision until an adapter emits it. |
| OQ-3 `observedEvidence` fold bound | **SOUND-with-note** — CP4 shape law holds; with B1 the fold must keep start-class **identity** (kind), not just a dedup count, because the expiry re-check consumes it (see §4). |

---

## 8. Per-decision verdicts

| Decision | Verdict |
|---|---|
| D1 — evidence-gated, never longer (candidate (a) rejected) | **SOUND** |
| D2 — provider queue ack answers the cycle | **HOLE** → B2 (dispatch-receipt-vs-queue-ack evidence class; unstated self-answering precondition; unquantified deferral) |
| D3 — honest stall + expiry disposition | **HOLE** → B1 (expiry does not re-check evidence at fire time; kills a healthy worker on a D2 consume defect — the #55-class incident) |
| D4 — guard surface | **SOUND** — paused-only guard preserved; provider_call answers only while paused; watchdog consumers independent; the #67 REARM_KINDS non-contradiction is a depending-on-#67 row (see B3) |
| §2 Subsumption | **SOUND-with-required-marking** → B3 (analysis declared against #67 contract text, but the load-bearing consequences are not consistently stamped depending-on-#67) |
| §6 Control-law line | **SOUND** (with B1's tightening) |
| §6 TG6 compatibility | **SOUND** |

---

## 9. Final verdict: **NOT FOLD-READY**

Three numbered blockers. All have concrete fixes; none changes the contract's architecture.

### B1 — The expiry must re-check the evidence fold at fire time and settle constructively on observed start evidence. **(what / why / fix)**

- **What.** `_expireSteeringCycle` runs the full final gate on any timer fire (guard only `task.status !== 'paused'`, `:2290`), never consulting whether start evidence was observed during the window. TW-05 stages a D2-gate defect — a valid `provider_call` observed in-window yet the cycle still expires — and keeps the kill ("exposing the defect to a post-mortem").
- **Why.** A D2 consume-path defect then kills a healthy worker whose start evidence exists — the exact #55-class incident #80 exists to prevent, reproduced by the contract's own staged test. The contract's central claim "the expiry now fires only when no start evidence exists" is false at fire time, and the control-law line ("no bound fires on elapsed time with zero evidence check," G10) is violated in the defect case.
- **Fix.** At expiry, before running the final: if `record.steering.observedEvidence` contains a start-class identity (`turn_started`, or a valid-phase `provider_call` per `_observeLogicalProviderCall` :9075-9097), settle constructively — `task → working`, `turn.settled {basis: 'steering_answered', via: 'evidence_gate_defect'}`, zero gate events — and receipt a named `steering.evidence_gate_defect` error event with the fold. Run the final only when the fold is empty of start-class evidence (the genuine honest stall). Fold records start-class kinds after phase/callId validity. Rewrite TW-05 to assert the constructive settle + defect receipt.

### B2 — The `requested` class must be named and pinned honestly (dispatch receipt, not "queue ack"), its self-answering precondition made contract text, and its deferral quantified. **(what / why / fix)**

- **What.** D2 mints `resource.provider_call {phase:'requested'}` at turn-start dispatch — **before** the provider accepts — and names it "the provider queue ack" / "the honest START evidence." The class does not distinguish "dispatched at the provider" from "accepted into the provider queue," and a dead/hung provider after dispatch yields the receipt anyway, deflecting the honest stall to the wall budget.
- **Why.** (a) The overstatement is a real post-mortem hazard: a fold recording `provider_call {requested}` is not evidence the provider engaged. (b) The anti-gaming guard is valid only because the mode-`'turn'` dispatch is a gated steering/orchestrator admission, not an automatic arm-time consequence (verified: arm sends mode `'nudge'` only, `:2179`; `nudgeTurn` clears the steering timer first, `:2433`; `_deliver`/`_deliverFollowUp` carry gates, `:7268-7306`) — a precondition that must be pinned or a future automatic-continuation path silently kills the discriminator. (c) The deferral bound is unquantified and is a #67-contract value (480-min wall budget) that is not the shipped backstop (HEAD watchdog default 2-min `stallMs`, `:1057-1058`).
- **Fix.** (1) Rename the class in D2, the vocabulary table, and TW-02 to "the turn-start **dispatch receipt** (a turn-start request handed to the provider, before acceptance)" — the weakest start-class answer. (2) Pin the emission point: codex at the `_sendRequest('turn/start')` invocation before the await (`codex-appserver.mjs:997`), claude pipe none (atomic), cli-adapters at its exec/turn dispatch. (3) Add contract text: the `requested`-minting dispatch is a gated steering/orchestrator admission, never an automatic arm-time consequence; any automatic-continuation path must preserve this or the class is a self-answer. (4) Quantify the dispatch-without-acceptance deferral: it answers the cycle and defers the honest stall to the deployed wall budget — state the bound and mark it depending-on-#67. (5) The fold must record the provider_call **phase** (`requested` vs `completed`) so a post-mortem distinguishes "requested at dispatch, then accepted" (healthy slow-start) from "requested at dispatch, never started" (the deferred zombie).

### B3 — The unshipped-work dependence must be marked on every load-bearing row, not only in G7. **(what / why / fix)**

- **What.** The subsumption analysis and several pins depend on #67 v1.1 contract text (`REARM_KINDS`, the 480-min wall budget, the in-flight-turn gate) — none of which exists at HEAD (`turnInFlight` = 0 hits; `REARM_KINDS` = 0 hits). G7 declares the analysis is against the contract, satisfying the #114-B3/#97 precedent at the ground-truth level, but the consequences are not stamped: TW-09 bundles the #67 REARM_KINDS assertion into a GREEN pin with the shipped half; D2's "the wall budget's backstop (G7)" and §2's "watchdog half closed" read as operative at HEAD.
- **Why.** A GREEN pin that asserts contract text (REARM_KINDS byte-unchanged) is untestable at HEAD and would mislead the implementing team into skipping it; the "watchdog half closed" summary is only true once #67 ships.
- **Fix.** Split TW-09 into (a) the shipped half — `_armWatchdog` working-only `:8733`, `_observeWatchdogEvent` provider-call tracking `:9151` — GREEN at HEAD, and (b) a depending-on-#67 row — the REARM_KINDS non-change asserted against #67 contract text, verified when #67 folds. Stamp D2's wall-budget backstop and §2's watchdog-half verdict as depending-on-#67 rows. Correct the §8/§1 HEAD pin from `0b5df0c` to `8aa9f4c`.

---

**Bottom line.** The architecture is right — evidence-gated window, honest stall discriminator, count-based bound, TG6-clean, control-law-clean. Three doc-and-semantic blockers remain, all cheap: **B1** (make the expiry's evidence-gating true at fire time, so a D2 consume defect can never re-kill the #55-class worker), **B2** (name the `requested` class honestly and pin its emission point + self-answering precondition + deferral bound), **B3** (stamp every #67-dependent row). With B1–B3 applied, this contract is fold-ready.
