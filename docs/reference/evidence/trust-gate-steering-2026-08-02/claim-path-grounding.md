# Claim-path grounding — issue #88 (trust-gate claim-path blind spot)

Grounding memo, code-verified 2026-08-03 against `impl/src/coordinator.mjs` (NUL-byte
discipline: grep -an + sed -n only), `impl/src/wave-driver.mjs`, `impl/src/recipes.mjs`,
`impl/src/application.mjs`, `impl/src/application-semantics.mjs`, and the folded #64
contract (`trust-gate-steering-decisions.md` v1.0, same directory).

Live receipt under investigation: a glm worker (L2 orientation lane,
`docs/reference/evidence/frontier-sweep-2026-08-03/run-l2-impl-wave.mjs` — seat glm-5.2,
`baton.recipes.implementContract`) ended turn 1 with NO in-scope diff but rich read-only
work evidence (5 read-only Bash `content.tool_call`s, 3 analysis `content.message`s, 1
wire emission). The driver claimed the pause; the gate's `required_effect` re-run judged
`required_effect_absent` and KILLED it. The #64 acceptance survivor had the identical
shape PLUS one admitted SCRATCHPAD_WRITE and lived.

Headline answer: **at claim time, nothing worker-side counts.** The gate's
`required_effect` phase reads exactly one input — the worktree capture tuple — and
read-only provider-turn evidence (tool calls, analysis messages) mints no
progress-ledger entry anywhere the claim path looks. It plausibly CAN count as
deferral-class liveness (the hub already trusts the same events for provider-governance
telemetry and the stall watchdog) but per TG2's folded law it must never count as
acceptance.

## 1. The claim-turn path: what `claim_turn` re-runs, in what order

`claimTurn` (coordinator.mjs:2471-2508), in order:

1. Reserve the pause record's single-consumer slot (`_reservePauseRecord`, :2473).
2. Clear any armed steering timer (:2478 — TG3 6c: the claim is its own answer).
3. Resolve the live worker/task pair (:2479-2481).
4. Append `turn.settled {basis:'claim'}` (:2486-2489) and transition `paused → working`
   (:2490-2492) — the gate's terminal transition is only legal from `working`.
5. `await worktreeReady`, then `_runTrustGate(handle, record.workerResult ?? null)`
   (:2494-2497). The record carries the turn's own worker result so a later claim
   "reproduces the SAME call an ordinary turn completion makes" (:2054-2057).
6. Commit the record consumed (:2501).

Inside `_runTrustGate` (:11893) the phases run: **capture** (:11911-11928 —
`_worktrees.capture` → `sha`, `changedPaths`) → **forbidden_effect** (:11930) →
**path_scope** (:11939) → **required_effect** (:11953-11975) → verify-environment
(toolchain/sparse identity) → atlas structural → coverage → referee → accept →
`verify.reverified` → evidence_mapping → promotion.

The `required_effect` phase (:11953-11975) reads EXACTLY the capture tuple:

- Skipped only when `task.brief.analysis === true` (TG5, :11951-11954) or the brief
  does not list `repository_edit` in `requiredEffects`.
- Throws `required_effect_absent` when `!sha || !baseSha || sha === baseSha ||
  changedPaths.length === 0 || inScopeChangedPaths.length === 0` (:11957-11959), with
  `requiredEffectEvidence` built solely from shas and path digests (:11962-11972).

It reads NO semantic progress ledger, NO event-stream scan, NO scratchpad fence, NO
provider telemetry. The pause record's `changedPathsDigest` is documented in-code as
"attention-only evidence and is never gate input" (:2056-2057); `opts.steered` (the
steering-expiry receipt, :2233) is verdict-payload decoration, never a judgment input.
**What flips absent→present: one in-scope changed path (`sha !== baseSha`,
`inScopeChangedPaths.length > 0`). Nothing else.**

The kill: the catch block maps `required_effect_absent` into the policy-failure kill
set (:12270-12284) — `terminalCause {kind:'policy_failure', code}`, scratch/board
claims expired, `_beginStop(handle, 'kill', …, 'policy')`.

## 2. The progress machinery: what is ledgered, what is not

Two different machines wear the "progress" name:

- **TG2/TG3 steering evidence** — the only worker-liveness ledger the hub keeps.
  `_observeSteeringCycle` (:2179) has exactly FOUR mint sites: resolved
  question/approval (:9455), resolved decision (:9585), `lifecycle.turn_started`
  (:11173), and `scratchpad.write` receipt `ok:true` (:11573-11575). Qualification
  (`_steeringEvidenceQualifies`, :2157-2176): a resumed turn always answers; a
  scratchpad receipt answers only on a DISTINCT `contentDigest`; an interaction
  answers only when RESOLVED inside the window. Board mutations were named in the
  folded contract (decisions.md:75) but are NOT wired — no mint site exists.
- **P1-C semantic-progress** (semantic-progress-2026-07-31/semantic-progress-decisions.md)
  — the run-view "you must act" projection that advertises `nudge_turn`/`wait_turn`/
  `claim_turn` on every `turn_checkpoint` attention entry (application.mjs:9592-9602,
  dispatch :11822-11829). It is a PROJECTION for the driver/operator. The gate never
  reads it.

Answers to the specific probes:

- **Scratchpad admissions are the ONLY worker-authored artifact signal** in any
  progress ledger — and they feed only the driverless steering cycle (see §3).
- **Read-only tool calls mint NO progress-ledger entry.** `content.tool_call` touches
  the stall watchdog (`_observeWatchdogEvent` → `_touchWatchdog`, :8787-8788), feeds
  logical tool-call accounting (:8797-8799) and provider-turn governance telemetry
  (:12674-12693) — all of it invisible to the claim path.
- **Analysis messages mint NO progress-ledger entry.** `content.message` becomes
  attention prose (:10999-11002) and a watchdog touch. Nothing else.
- `context.read` is deliberately NOT TG2 progress — the code says so in words
  (:11582: "no _observeSteeringCycle is minted here").
- The `no_progress` preservation determination (:8055-8082) also reads the worktree
  diff only.

So the glm worker's 5 Bash calls + 3 analysis messages + 1 wire emission were real,
durable, hub-observed — and weighed zero at every judgment point on the claim path.

## 3. The #64 survivor difference: the SCRATCHPAD_WRITE changed no gate input

The #64 acceptance survivor (decisions.md v1.0 acceptance bullet 1; red row T6,
trust-gate-steering-red.test.mjs:200-215) was DRIVERLESS, so its pause armed TG3's one
bounded steering cycle (`_armSteeringCycle`, :2110). Its admitted SCRATCHPAD_WRITE:

1. bumped the coordination-store scratchpad fence and returned a `contentDigest`
   (`writeScratchpad`, :10156-10193) — not a gate input;
2. minted `scratchpad.write_result {ok:true}` (hub actor) on the worker stream
   (:11566-11569) — not a gate input;
3. minted `_observeSteeringCycle(handle, {kind:'scratchpad', digest})` (:11573-11575)
   → distinct digest qualifies (:2161-2168) → `_settleSteeringCycle` (:2197-2211):
   `turn.settled {basis:'steering_answered'}` (:2205), task back to `working`,
   **no verdict, no gate dispatch**.

The survivor lived because the gate NEVER RAN on that checkpoint — not because the
gate's inputs differed. Both workers' `required_effect` inputs were the same empty
capture tuple; only one worker was ever evaluated.

In the #88 drivered run the same write would have been inert twice over: (a) a
registered driver means no cycle is ever armed (T9, trust-gate-steering-red.test.mjs:
294-307; the `_observeSteeringCycle` guard skips records with no `steering`, :2183);
(b) `claimTurn` never consults steering answers — it clears the timer (:2478) and runs
the gate directly (:2494-2497).

The driver is diff-blind at its own layer too: `implementContract` sets
`finalization: 'claim-on-stall'` with `unproductiveNudgeBudget: 1`
(recipes.mjs:537-546), and the wave driver's treadmill keys on
`checkpoint.changedPathsDigest` ALONE (wave-driver.mjs:583-598 — one nudge, unchanged
digest, `claimOnce` :246-263, itself annotated "claim is terminal on a stale
checkpoint", :17-19/:260-262). Read-only turn evidence moves neither sensor.

## 4. Design space (minimal-change options)

### Option A — claim-time liveness preflight: typed refusal, not a kill

Insertion: `claimTurn`, between :2478 and :2486 — before `turn.settled {basis:'claim'}`
is appended, while the reservation can still `rollback()`. Evaluate: would
`required_effect` fire (brief requires `repository_edit`, not `analysis`, diffless
capture/record) AND does the worker stream carry turn-scoped liveness (hub receipts —
`scratchpad.write_result ok:true`; governance-counted telemetry — `content.tool_call` /
`resource.provider_call`; resolved interactions — all readable from the same per-worker
log the gate's evidence_mapping already draws on) since the turn began? If yes:
`rollback()` and return `{ok:false, result:'claim_premature_liveness'}` — the pause
pends, the worker lives, the driver keeps steering. A SILENT diffless worker gets
today's full gate and dies, exactly as now.

Farm bound: unchanged. The refusal settles nothing and the FINAL still demands the
real in-scope diff — TG2's law (liveness, never deliverable) is preserved byte-for-byte.
One composition note: `claimAttempted` is per-member (wave-driver.mjs:327), so a refused
claim currently consumes the driver's one attempt — either key it per pauseId or let
the driver's existing stall cap close the run.

Suite movement: T10b (trust-gate-steering-red.test.mjs:327-346) and T17 (:498-514)
emit no liveness in their fixtures, so they stay green byte-identically; ADD rows —
liveness-rich edit-free claim refused (worker alive, pause pending, zero gate events)
and silent edit-free claim still fails `required_effect_absent`. wave-driver-red.test.mjs
gains a claim-refused recording row (`claimOnce` already records refusal codes,
wave-driver.mjs:260-263). decision-gate-trust-gate-red.test.mjs: untouched (DG1, :147,
pins the interaction-deferral shape — orthogonal).

### Option B — distinct gate outcome "no artifact yet": pause-coaching, not kill

Insertion: split `required_effect_absent` out of the kill set (:12270-12284) when the
gate ran from a claim on a pausable-checkpoint origin AND liveness exists — re-park (or
refuse the claim) and deliver the sanitized {gate, detail} verdict to the worker through
the nudge lane (TG4's channel; conversational feedback). Requires a bounded re-claim
budget (a count, never a clock) so claim stays eventually-terminal.

Suite movement: largest blast radius. T10b/T17 flip from `failed` to alive when liveness
is present; T11 (:352-370) terminal-cause pin reshapes; T2 (:155-165 — the anti-gaming
final pin) must be preserved by keying the mercy on checkpoint-origin + liveness.
This rewrites the gate's terminal contract for the drivered-final case the folded
contract explicitly assigned to the driver ("a driver claiming a checkpoint accepts the
final-evaluation risk", decisions.md TG1).

### Option C — keep the artifact requirement; document it

Worker-facing grammar variant is OFF-LAW: TG6 retired gate-coaching, and T15
(trust-gate-steering-red.test.mjs:473-479) scans recipes.mjs for `/trust.?gate/i`,
`/survive the gate/i`, `/no.?diff/i`, `/progress gate/i` — "produce a diff or die" is
exactly the skeleton-first coaching class the operator banned. Note the constraints
already teach SCRATCHPAD_WRITE verbatim (recipes.mjs:534-535, issue #62) — and under a
registered driver that channel is steering-inert, so documenting it as a survival
mechanism would be FALSE for drivered runs.

Driver/principal-facing variant is legal and cheap: `claim_turn`'s registry entry
(application-semantics.mjs:511-518) currently declares `destructive: false,
irreversible: false, priority: 'recommended'` — a surfacing lie for an act that can kill
a healthy worker. Flip `destructive: true` and name the full final evaluation in the
summary; extend the wave-driver.mjs:17-19 comment to name `required_effect_absent`.
(Check registry-digest consumers before flipping — the digest rides every action's
freshness token, application.mjs:9734.)

Zero-code mitigation available TODAY: `implementContract` accepts policy overrides
(recipes.mjs:548-567) — run the L2 lanes with `policy: {finalization: 'none'}` and claim
only at true finals.

## 5. Verdict

**Recommend Option A plus the Option-C driver-facing surfacing flip.** The #88 kill was
a DRIVER-decision failure, not a worker-behavior failure — the worker did legitimate
turn-1 reconnaissance, and the control point that failed is claim admission. Fix the
control point, not the judged worker's prompt (TG6 bans that) and not the gate's
acceptance strength (TG2's law: at final, the diff is required — keep it). A reads
evidence the hub already trusts for governance telemetry, and holds the campaign law:
the refusal is an eval-able control (a typed value the driver already records), it is
constructive (a "not yet — worker is alive" the driver can steer from instead of a
corpse), the follow-up nudge can carry TG4's sanitized verdict shape as conversational
feedback (closing ground truth 4, decisions.md — the judged worker learns why), and it
introduces no clocks — deferral consumes the driver's existing claim/nudge budget and
the bound stays at the final, where the farm bound has always lived. Take Option B only
if dogfood shows the refusal insufficient; Option C's worker-grammar form is banned by
TG6/T15.
