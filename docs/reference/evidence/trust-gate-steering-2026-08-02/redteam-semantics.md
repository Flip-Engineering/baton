# Red-team: trust-gate steering contract v0.9 — GATE SEMANTICS + LIFECYCLE

(Adversarial review of `trust-gate-steering-decisions.md` v0.9. Angle: gate semantics and
lifecycle. Every claim is grounded in file:line against `impl/src/`. Verdicts:
CONFIRMED-HOLE = the contract's claim is false or its mechanism cannot work as written;
DEFENDED = the attack fails, the contract/code already covers it; NEEDS-AMENDMENT = the
contract is directionally right but under-specified in a way that changes the outcome.)

## Summary table

| # | Attack | Verdict | One-line basis |
|---|--------|---------|----------------|
| A1 | TG1: `required_effect` is "the lone progress judgment" | CONFIRMED-HOLE | The referee/accept phase (coordinator.mjs:11238-11247, referee.mjs:424-431) is a second, larger progress judgment; skipping one `throw` leaves it in place — and lets an edit-free turn be ACCEPTED |
| A2 | TG1: "final" is undefined for un-driven runs | CONFIRMED-HOLE | No finality marker exists anywhere in the turn_completed dispatch (:10741-10806); the exit path (:10843-10859) runs no gate — an un-driven run can end with zero final evaluation |
| A3 | TG1 × `claim_turn`: every claim re-runs the full gate | NEEDS-AMENDMENT | `claimTurn` has no final/intermediate flag (:2295-2327); the driver's stall fan-out claims every parked member mid-run (wave-driver.mjs:640-648) |
| A4 | TG2: scratchpad-write farming manufactures "progress" | CONFIRMED-HOLE | Receipts are unspoofable but farmable: 128 one-char entries (coordination-store.mjs:438), each re-arming a 480-min production stall clock (application-deployment.mjs:1710) |
| A5 | TG2: board spam / decision churn | DEFENDED (board) / NEEDS-AMENDMENT (decisions) | Workers have no board-post lane (only orchestrator caller at coordinator.mjs:9987); BD-A caps concurrency, not sequential churn (:10999-11025) |
| A6 | TG3: `nudge_turn` undeliverable at the verdict points | CONFIRMED-HOLE | `nudgeTurn` binds only to a pending pause record on a `paused` task (:2114-2119, :2148-2150); the auto-settle consumes that record BEFORE the gate runs (:2057 → :10802); the other two verdict points have no record at all |
| A7 | TG3: "one `stallTimeoutMs`" is layer-confused | NEEDS-AMENDMENT | The name exists only in the wave driver (20 min, wave-driver.mjs:35); the run layer's production stall is 480 min (application-deployment.mjs:1710); the code default is 2 min (coordinator.mjs:999) |
| A8 | Retry-4 kill receipt vs the contract's chain | NEEDS-AMENDMENT | Spine is code-verified, but the gate's kill mints `kill.requested`, never `control.interrupt_requested` (:7167) — F2's surviving receipt line implies a second stop authority escalated (:7130-7157); primary jsonl is gone |
| A9 | Missed hole: no verdict-free gate outcome exists | CONFIRMED-HOLE | The gate's only outcomes are terminal `completed`/`failed` (:11380, :11423; :11472-11482); "coverage keeps evaluating" contradicts "WITHOUT a gate verdict" — coverage is referee-computed (:11234-11247) |
| A10 | Missed hole: `parkedUnsettled` deferral × TG2 = un-gateable worker | CONFIRMED-HOLE | Turns ending on a pending interaction already skip the gate entirely (:10769-10775); TG2 would also credit the parking question as progress |

---

## A1 — TG1: `required_effect` is NOT the lone progress judgment

The contract (lines 57-61) claims the other phases "are diff-present by construction (they
only fire when a diff exists)" and that `required_effect` "is the lone progress judgment and
the lone mover." Reading `_runTrustGate` (coordinator.mjs:11119) in code order:

- **capture** :11140-11151 — snapshot; no judgment.
- **forbidden_effect** :11152-11161 — fires only when `changedPaths.length > 0`. Diff-present. ✓
- **path_scope** :11163-11178 — fires only when `outOfScopeChangedPaths.length > 0`. Diff-present. ✓
- **required_effect** :11178-11196 — fires when the brief requires `repository_edit` AND
  (`!sha || !baseSha || sha === baseSha || changedPaths.length === 0 || inScopeChangedPaths.length === 0`).
  The only diff-ABSENT structural phase.
- **environment** :11201-11216 — toolchain/sparse-checkout mismatch, reachable only AFTER
  required_effect passes and verify worktrees are created (:11197-11200). Effectively
  diff-present today, but see A9: it is not free to "keep evaluating" per turn.
- **referee + accept** :11238-11247 — `_referee` runs the deployment verification command in
  the sandbox; `closedVerificationVerdict` (:399-408) maps a non-zero exit to
  `candidate_failed`; `accept()` (referee.mjs:424-431) requires `verdict.reverified &&
  verdict.passed`, plus `redGreen` / `coverageOfChange` / `mutationPassed` when opted in
  (referee.mjs:426-429; application.mjs:10226-10229).
- **terminal transition** :11380 `const terminalStatus = accept ? 'completed' : 'failed'`,
  applied at :11423; exceptions land in the catch's failure transition (:11472-11482).

Two independent falsifications:

1. **The accept phase is a progress judgment.** "Does the candidate pass the deployment
   verification command" — a command every profile sets (application-deployment.mjs:879-885)
   — is exactly "is the work done yet." A mid-workflow worker whose tree does not yet pass
   yields `candidate_failed` → `accept=false` → terminal `failed` (:11423). The opted-in
   hardening checks (`requireRedGreen`: did you write the failing test first;
   `requireCoverage`: is the change covered) are methodology/progress judgments, not safety
   properties. So even if TG1 defers `required_effect`, a gate that continues to the referee
   at an intermediate turn still kills (or worse, completes — next point) the mid-workflow
   worker. `required_effect` is the lone DIFF-ABSENT structural check; it is not the lone
   progress judgment.

2. **Worse: without the :11178 throw, an edit-free turn is ACCEPTED.** On an unchanged tree
   the verification command runs against what is effectively the base tree and (for a healthy
   repo) passes → `refereeAccept=true` → `accept=true` → `terminalStatus='completed'`
   (:11380-11423). Today the `required_effect` throw at :11183 is the ONLY thing standing
   between "first turn of reads + scratchpad writes" and "task completed with zero diff."
   TG1's acceptance test demands that worker be "alive and `working` afterward" — skipping
   one throw does not produce that outcome; it produces either `failed` (red base tests) or
   `completed` (green base tests). The contract never names the third outcome.

**Amendment (merged into A9 below):** TG1 must specify a new non-terminal gate outcome, and
the per-turn evaluation set must be redefined as capture/forbidden_effect/path_scope ONLY.

## A2 — TG1: where is FINAL for an un-driven run?

The contract's own red-team target asks: "the auto_no_driver path now let un-driven runs
skip the gate entirely (it must still evaluate at THEIR final — where is that)?" Answer,
from code: **nowhere — no such signal exists.**

- All four production harness adapters declare `turnCompletion: 'pausable'`
  (kimi-acp.mjs:182, codex-appserver.mjs:314, claude-session.mjs:488, grok-acp.mjs:238), so
  every completed turn mints a pause record (:10792-10795).
- With no `steering.registered` driver for the run, `_admitPauseRecord` auto-settles
  (:2051-2062 — the `hasDriver` scan at :2051-2054, the settle at :2057-2061) and the
  dispatcher falls through to `_runTrustGate` (:10797-10803).
- Nothing in `lifecycle.turn_completed`, the pause record, or the dispatch marks a turn as
  the run's LAST turn. The worker's exit is handled by `lifecycle.exited` (:10843-10859):
  `failActiveTask` is true only when `!turnWasTerminal` (:10845, flag from :10403) — the
  task is failed with the exit event as evidence, NO gate run. When `turnWasTerminal` is
  true (clean exit after a terminal turn), the task is left non-terminal — again no gate.

Concrete hole under TG1: an un-driven worker whose final turn is edit-free →
turn_completed → auto-settle → (required_effect deferred per TG1) → `working` → worker
exits → `turnWasTerminal=true` → no failure, no gate, ever. The task hangs non-terminal
until the run is stopped by budget or operator. Conversely (A1 point 2), if the gate still
runs minus `required_effect`, the same turn COMPLETES the task edit-free. Either way the
contract's acceptance line "A plan requiring repository_edit fails an EDIT-FREE final
answer exactly as today (anti-gaming preserved)" is not delivered by the v0.9 text — the
machinery that would identify "final" on the un-driven path does not exist and is not
specified.

Note the existing deferral precedent the contract could have cited but didn't:
`parkedUnsettled` (:10769-10775) already skips the gate for turns ending on a pending
blocking interaction — "Deferral, never exemption: the post-settlement continuation turn
faces the gate." That deferral is safe ONLY because the interaction's answer guarantees a
continuation turn. No equivalent guarantee exists for "the worker will produce another
turn" — which is precisely the guarantee TG1 needs.

**Amendment:** define FINAL for the un-driven path explicitly: (a) the gate's full form
(including required_effect and referee/accept) runs at `lifecycle.exited` with
`turnWasTerminal=true` and task non-terminal, against the last turn's workerResult, BEFORE
the task may complete; and (b) any turn that the run layer cannot prove is non-final gets
the partial (safety-only) gate from A9. Without (a), anti-gaming is void for un-driven
runs — the exact class the demo v3b retry-4 worker belonged to.

## A3 — TG1 × `claim_turn`: the driver path still gates every checkpoint

`claimTurn` (coordinator.mjs:2295-2327) re-runs the same `_runTrustGate` (:2316-2319) whose
"only two outcomes are `completed` and `failed`" (comment :2291-2294). There is no
final/intermediate parameter. The wave driver claims at three distinct non-final points:
L6 done-member claim (wave-driver.mjs:569-575), treadmill claim (:587-595), and — most
damaging — the claim-on-stall fan-out, which claims EVERY pending-paused member when the
wave's stall clock trips (:640-648), regardless of that member's doneness.

The contract's "the gate runs at … the driver's final `claim_turn`, exactly as today"
names a distinction that does not exist in code. "Exactly as today" is false: today the
gate runs at every claim, and claims are mid-run driver finalization acts, not run
completion. A member parked at the moment the wave stalls gets a full gate run —
`required_effect` included — mid-workflow.

Partial defense: the L6 done/treadmill claims ARE the driver's doneness judgment, so
gating there is arguably gating "at final" for that member. The stall fan-out is not.

**Amendment:** `claimTurn` gains an explicit finality basis recorded in its receipt
(`basis: 'driver_final' | 'stall_fanout'`); TG1's deferral applies to any claim that is not
`driver_final`, and the stall fan-out must steer (TG3) before it may claim-gate. This also
makes the driver's claim cadence legible to the verdict receipt the contract wants.

## A4 — TG2: scratchpad-write farming

The auth path, verified end to end: the worker emits `scratchpad.write` on its
authenticated stream (:10861-10865); `writeScratchpad` checks the fence (the literal
`'current'` is admitted for prose workers — :9693-9700, the #48 erratum) and the
idempotencyKey shape (:9695-9700), then the store binds `actor:'worker',
principalId:workerId` (:13206-13210) and receipts it as `scratchpad.write_result`,
`actor:'hub'` (:10868-10871).

The contract's "unspoofable by the worker" is TRUE and IRRELEVANT. The attack is not
spoofing receipts — it is farming admissions the hub will honestly receipt:

- Distinct idempotencyKeys mint distinct entries; same key + changed content is a conflict
  (:13227-13230), same key + same content is an idempotent replay (:13224-13240). Nothing in
  `normalizeScratchpadEntry` requires non-trivial content. The only hard bound is
  `MAX_SCRATCHPAD_WORKER_ENTRIES = 128` (coordination-store.mjs:438, enforced :13245).
- Every write is a worker-actor event → `_observeWatchdogEvent` re-arms the stall clock
  (:8315-8317: `if (event.actor !== 'worker') return; this._touchWatchdog(handle)`). In
  production that clock is 480 minutes (application-deployment.mjs:1710; DEFAULT_BUDGET at
  :34-38). One one-char write per 8-hour window defeats the stall watchdog.
- The remaining bound is the per-task wall budget stop (:8038-8043 → `_beginStop`) — also
  480 minutes in production (nodeBudget, application-deployment.mjs:877-878).

So TG2's own red-team target — "can a worker farm scratchpad writes to stay alive
indefinitely (the stall window + TG3's steering cycle is the bound — is the loop tight
enough)?" — answers NO, the loop is not tight: ≤128 trivial writes × a 480-min silence
clock, plus an EXTRA continuation window from TG3 every time a verdict looms, yields a
worst-case liveness grant on the order of the full task wall budget for near-zero work.
And the farmed evidence is task-ephemeral (worker-scope scratchpad dies with the task;
only orchestrator elevation makes it durable — kg-loop-verdict.md F1), so TG2 would count
as "progress" bytes that can never outlive the task.

**Amendment:** progress credit must be content-classed and rate-bounded: e.g., at most one
progress credit per distinct content-digest prefix per stall window; entries below a
minimum content bound earn liveness (watchdog touch) but not progress; the run-layer
progress-stall window must be named and far smaller than the wall budget (see A7).

## A5 — TG2: board mutations and decision churn

**Board: DEFENDED.** A worker cannot spam post/retitle: there is no `case 'board.*'` in
the coordinator's event switch (the worker's only inbound lanes are the interaction
family, scratchpad, lifecycle, resource). The sole coordinator caller of `postBoardItem`
is the orchestrator settlement path (:9987); board commands route through
`admitBoardCommand` — an application/orchestrator lane (application-semantics.mjs:1359,
:1370). `postBoardItem` itself binds identity hub-side (`itemId` hub-derived,
:13813-13816) but performs no actor check — the defense is the call graph, not the store.
Board CLAIMS by workers are fence-bound and expired at terminal/nudge (:7560-7567,
:2153-2169). If a future worker-facing board lane opens, this defense evaporates and the
store's missing actor check becomes load-bearing — worth one line in the contract.

**Decisions: NEEDS-AMENDMENT.** BD-A's one-pending-decision admission is real and covers
pending AND resolving (:10999-11025, `control.decision_already_pending_rejected`). But it
bounds CONCURRENCY, not CHURN: a worker may run trivial questions sequentially forever,
each `decision.requested` + resolution earning TG2 progress credit. Worse, questions
interact with the gate-skip — see A10. The contract's parenthetical "(the BD-A
one-pending-decision admission already caps live decisions at one)" answers a question
nobody asked.

**Amendment:** TG2 credits RESOLVED interactions only, at most one progress credit per
parked episode, and zero credit for an interaction that parked the task past a
deployment-bounded idle threshold.

## A6 — TG3: `nudge_turn` deliverability at each verdict point

`nudgeTurn` (coordinator.mjs:2193-2268) binds to a PAUSE RECORD: `_reservePauseRecord`
requires the record `pending` (:2114-2119) and `_pausedActTargets` requires
`task.status === 'paused'` (:2148-2150). Now walk the contract's three verdict points:

1. **`required_effect_absent` at final (checkpoint pause).** The record exists — but the
   auto_no_driver path RESOLVES it (:2057 `_resolvePauseAuthority`) BEFORE the dispatcher
   reaches the gate (:10802). By the time the verdict exists, `nudgeTurn` on that record
   returns `already_resolved`. On the driven path the record survives, so TG3 is
   deliverable there — but the demo that motivates this epic (retry 4) was the UN-driven
   path. TG3 as written is mechanically undeliverable at its own headline verdict point
   without an unwritten reorder (hold the record open across the gate; only settle after
   the steering cycle closes).
2. **`no_progress` preservation.** This verdict arises inside `_preserveProgressBeforeReap`
   (:7603-7609), which runs during an in-flight stop (:7693, :7727, :8505). The worker is
   mid-reap; there is no pause record; the task is not `paused`. Delivering TG3 here means
   NOT reaping, re-driving the worker, waiting a window, then re-capturing — a different
   mechanism than `nudge_turn`, unspecified by the contract.
3. **Stall escalation.** The run-layer watchdog fires while `handle.status === 'working'`
   (:7903-7916) — mid-turn, no pause record. The bare `control.nudge` lane that DOES reach
   a working worker "calls no `_admitProviderTurn`/`bumpTurn`/`_clearBudgetStop`/
   `_resetWatchdogTurn` at all" (comment :2187-2191) — it cannot re-arm the stall clock,
   so the verdict lands anyway. Undeliverable as a steering cycle.

Dead-worker semantics (the one point that transfers cleanly): `nudgeTurn`'s
`adapter.prompt` failure rolls the record back to `pending` and returns
`delivery_exception`/`delivery_refused` (:2203-2222). The wave driver already productizes
the right discipline: K=3 consecutive delivery failures → unsteerable, let the stall clock
judge (wave-driver.mjs:582). The run layer has no such budget; the contract should
import it verbatim.

**Amendment:** (a) reorder the auto-settle so the pause record survives the partial gate
and TG3's cycle resolves it; (b) extend the steering act to `working` tasks (a mid-turn
nudge that re-arms the watchdog, i.e. `_resetWatchdogTurn` on delivery ack); (c) for the
reap path, define steer-before-reap as a distinct act (defer the stop one window, re-drive,
re-capture); (d) import the K=3 unsteerable rule with the verdict receipt naming it.

## A7 — TG3: what is "one `stallTimeoutMs`" in production?

The contract's continuation window is "deployment policy, default one `stallTimeoutMs`."
That identifier exists ONLY in the wave driver and recipes: `stallTimeoutMs: 20 * 60_000`
(wave-driver.mjs:35; recipes.mjs:63, :541). The RUN layer's analog is `watchdog.stallMs`:
code default 120 000 ms (coordinator.mjs:999) — but the production deployment OVERRIDES it
to `DEFAULT_BUDGET.wallMin * 60_000` = 480 minutes (application-deployment.mjs:1710, with
DEFAULT_BUDGET at :34-38).

So "one `stallTimeoutMs`" is three different numbers depending on layer: 20 min (driver),
2 min (run-layer code default), 8 h (run-layer as actually deployed). The contract's own
red-team target asks whether the extra window "double[s] worst-case turn latency for
genuinely dead workers (bounded by stallTimeoutMs — acceptable)" — if the window inherits
the production run-layer stall clock, the answer is not "double": it is +480 minutes of
budget burn per genuinely-dead un-driven worker before the verdict lands. That is the same
8-hour window the main angle flagged, now confirmed in the deployment wiring itself.

**Amendment:** name the layer and the number. The continuation window should be a new,
explicit deployment policy (suggested order: the driver's 20-min shape or smaller), NOT an
inheritance of `watchdog.stallMs`; the verdict receipt must carry the window actually
granted. Separately, reconsider application-deployment.mjs:1710 — a stall watchdog set to
the wall budget is a watchdog that cannot bark before the coffin closes.

## A8 — The retry-4 kill receipt, re-derived

Primary evidence status: `.baton/kg-tiered-loop-v3b-kgv20260801063404/` is GONE (verified
2026-08-02); no repo reference to run id `kgv20260801063404` survives; both receipt JSONs
in `kg-tiered-loop-2026-08-01/` document the SUCCESSFUL v3b landing (retry 9) and contain
zero kill-chain events (grep: `required_effect|auto_no_driver|progress_unchanged|interrupt|
kill` — no hits). The only surviving account is the F2 narrative in `kg-loop-verdict.md`:
"the progress gate interrupted and killed it mid-turn (`control.interrupt_requested` →
`kill.confirmed` → `worktree.progress_unchanged {state:'no_progress'}`)."

Adjudicating the contract's chain (turn_completed → auto_no_driver settle → trust gate →
required_effect_absent → interrupt/kill → progress_unchanged) against code:

- turn_completed → pause → auto_no_driver settle → gate: :10792-10803 with :2051-2062.
  Code-consistent (all four production adapters are pausable — A2).
- gate → `required_effect_absent` on a no-diff capture: :11178-11196. Code-consistent.
- `required_effect_absent` → stop: the catch block sets `terminalCause {kind:
  'policy_failure'}` and calls `_beginStop(handle, 'kill', undefined, 'policy')`
  (:11491-11501). **`_beginStop` with mode 'kill' mints `kill.requested`, NEVER
  `control.interrupt_requested`** (:7167: `const reqKind = mode === 'kill' ?
  'kill.requested' : 'control.interrupt_requested'`). The interrupt kind is minted only by
  interrupt-mode stops: driver/operator interrupts (:6923, :6937) or the watchdog's
  default `stallAction: 'interrupt'` (:1004, :7933).
- The ONLY code path emitting both kinds in one stop is ESCALATION: an interrupt waiter
  already in flight, then a kill arrives and escalates it (:7130-7157, minting
  `kill.requested` with `escalation: true`).
- `worktree.progress_unchanged {state:'no_progress'}`: minted by
  `_preserveProgressBeforeReap` during stop cleanup (:7603-7609; callers :7693, :7727,
  :8505). Code-consistent.

Verdict: the contract's SPINE (turn_completed → gate → required_effect_absent → kill →
progress_unchanged) is code-verified. The "interrupt/kill" element does not match the
gate's own stop, and F2's `control.interrupt_requested` implies a SECOND stop authority
interrupted first — most plausibly the manual drive's `run.complete()`/interrupt (the same
verdict doc's attempt #7 receipts "Blind `run.complete()` spam reaps a healthy worker"),
with the gate's kill then escalating the waiter. "Killed mid-turn" (F2) vs "killed at
turn_completed" (contract) is the worker-side vs gate-side view of the same reap: the
worker had begun its next turn (reads + three admitted SCRATCHPAD_WRITEs, per the seed)
when the kill landed.

**Amendment:** correct the seed's chain to "`required_effect_absent` → `kill.requested` →
`kill.confirmed` (the kill possibly escalating an in-flight driver interrupt,
coordinator.mjs:7130-7157)", and mark the interrupt element UNVERIFIABLE — the primary
jsonl was cleaned. Do not let a motivational receipt carry an event the gate cannot mint.

## A9 — Missed hole: the phase list is architecturally incoherent verdict-free

The contract holds two sentences simultaneously: "Intermediate pauses settle as `working`
WITHOUT a gate verdict" and "The other phases (capture, forbidden_effect, path_scope,
environment, coverage) keep evaluating at every turn completion." The gate as built has no
verdict-free evaluation: every path through `_runTrustGate` ends in a TERMINAL transition
(`completed`/`failed` at :11380-11423) or a failure transition in the catch (:11472-11482).
Beyond that:

- **Coverage cannot be evaluated without a verdict.** "Coverage" as a gate property is
  `verdict.coverageOfChange`, computed by the referee from base/verify sandboxes
  (:11234-11247; referee.mjs:428). "Keep evaluating coverage at every turn" REQUIRES
  running the referee at every turn — which produces `candidate_failed` for mid-workflow
  code — which must then be silently discarded to honor "WITHOUT a gate verdict." The
  contract keeps the fruit and discards the tree.
- **Environment is not a free per-turn check.** It requires creating verify (and base
  verify) worktrees (:11197-11216) — real git machinery per turn — and today it is reached
  only AFTER required_effect passes, i.e. only when a diff exists. Reordering it before
  the deferral point changes its cost and trigger semantics; the contract doesn't mention
  either.
- **The "diff-present by construction" parenthetical is true of exactly two phases**
  (forbidden_effect :11154, path_scope :11165) and false of the rest of the list.

**Amendment:** specify the partial gate explicitly: per-turn evaluation = capture +
forbidden_effect + path_scope ONLY (all throw before the verifier at :11197); environment,
atlas structural, coverage, referee/accept run ONLY at final (A2's definition). This also
fixes A1: the mid-turn worker can then neither fail nor COMPLETE at an intermediate turn.

## A10 — Missed hole: `parkedUnsettled` × TG2 = the un-gateable worker

Already in today's code, a turn that ends with a pending blocking interaction SKIPS the
gate entirely (:10769-10775: `parkedUnsettled` → `break`). Compose with TG1+TG2:

1. Worker ends EVERY turn with a trivial pending question → the gate never runs
   (parkedUnsettled break), or defers (TG1) — same effect.
2. Under TG2, the question ITSELF is progress evidence
   (`question.asked`/`decision.requested` are in the contract's evidence class).
3. Each answer (if any answerer exists) re-drives a continuation turn that ends with
   another question; each cycle re-credits progress and re-skips the gate.
4. In an un-driven run with no answerer, the worker parks `input_required`; the watchdog
   cannot fire (`_applyWatchdogAction` requires status `working`/`blocked`, :7931), and
   interaction lifetimes are deployment-bounded at up to 480 min
   (application-deployment.mjs:851, :1706).

Questions are thus strictly cheaper than scratchpad writes for staying alive (A4): they
suppress the gate AND earn progress credit AND require no content at all. The contract
missed this interaction entirely — its TG2 evidence list and the pre-existing gate-skip
compose into a worker that is un-gateable for the life of the task.

**Amendment:** (a) TG2 credits RESOLVED interactions only; (b) an interaction whose
parking suppressed the gate earns ZERO progress credit for that episode; (c) consecutive
parked episodes without an intervening in-scope diff are rate-bounded per run, and the
verdict receipt names the bound when it fires.

## Required amendments (consolidated)

1. **Define the third gate outcome** (A1/A9): per-turn = capture/forbidden_effect/
   path_scope only; a new non-terminal `deferred` outcome settles intermediate pauses
   `working` with no terminal transition. Environment/atlas/coverage/referee/accept run
   only at final.
2. **Define FINAL for un-driven runs** (A2): full gate at `lifecycle.exited` with
   `turnWasTerminal=true` and task non-terminal, before any completion; without this,
   anti-gaming is void on the exact path that killed the retry-4 surveyor.
3. **Finality on the driven path** (A3): `claimTurn` receipt carries a finality basis;
   stall fan-out claims steer (TG3) before gating.
4. **Content-classed, rate-bounded progress credit** (A4/A5/A10): resolved interactions
   only, one credit per parked episode, zero credit for gate-suppressing questions,
   digest-classed scratchpad credit, 128-entry cap cited as the hard bound.
5. **Reorder auto-settle + extend steering** (A6): pause record survives the partial gate;
   mid-turn steer act re-arms the watchdog; steer-before-reap defined for the preservation
   path; import the driver's K=3 unsteerable rule (wave-driver.mjs:582).
6. **Name the window** (A7): new explicit continuation-window policy (order of the
   driver's 20 min), never `watchdog.stallMs`; receipt carries the granted window;
   reconsider the 480-min production stall override (application-deployment.mjs:1710).
7. **Correct the receipt's event chain** (A8): `kill.requested`, not
   `control.interrupt_requested`, is the gate's stop; mark the interrupt element
   unverifiable (primary jsonl cleaned).

## Appendix: code landmarks used

- Gate: coordinator.mjs:11119 (_runTrustGate), :11152-11161 (forbidden_effect),
  :11163-11178 (path_scope), :11178-11196 (required_effect), :11197-11216 (verify
  worktrees + environment), :11234-11247 (coverage + referee + accept), :11380-11423
  (terminal transition), :11458-11501 (catch + policy kill), referee.mjs:424-431 (accept),
  coordinator.mjs:399-408 (closedVerificationVerdict outcomes).
- Dispatch/pause: :10741-10806 (turn_completed), :10769-10775 (parkedUnsettled deferral),
  :2003-2063 (_admitPauseRecord + auto_no_driver), :2295-2327 (claimTurn), :2193-2268
  (nudgeTurn), :2114-2119/:2148-2150 (pause-record binding).
- Watchdog/budget: :998-1004 (defaults), :7901-7917 (stall), :7931-7935 (actions),
  :8315-8317 (any worker event re-arms), :8038-8043 (wall-budget stop);
  application-deployment.mjs:1710 (production stall = 480 min), :34-38 (DEFAULT_BUDGET),
  :877-885 (nodeBudget + requiredEffects).
- Stop path: :7128-7230 (_beginStop; :7167 reqKind; :7130-7157 escalation), :7573-7610
  (_preserveProgressBeforeReap / no_progress), :10843-10859 (lifecycle.exited), :10403
  (turnWasTerminal).
- Coordination evidence: :10861-10873 (scratchpad.write → write_result), :9689-9711
  (write admission, 'current' fence), coordination-store.mjs:13205-13250 (store write,
  128 cap at :438), :10999-11025 (one pending decision), :9987 (sole postBoardItem
  caller), application-semantics.mjs:1359/:1370 (board via admitBoardCommand).
- Driver: wave-driver.mjs:35 (stallTimeoutMs 20 min), :566-620 (L6 nudge + budgets),
  :582 (K=3 unsteerable), :640-648 (stall claim fan-out).
- Cards: kimi-acp.mjs:182, codex-appserver.mjs:314, claude-session.mjs:488,
  grok-acp.mjs:238 (all `turnCompletion: 'pausable'`); coordinator.mjs:2657-2659
  (_turnCompletionOf).
- Receipts: docs/reference/evidence/kg-tiered-loop-2026-08-01/kg-loop-verdict.md (F2);
  kg-loop-receipt.json / kg-loop-live-receipt.json (successful landing only — no kill
  chain); `.baton/kg-tiered-loop-v3b-kgv20260801063404/` confirmed absent 2026-08-02.
