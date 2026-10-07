# Issue #67 — The stall watchdog: from structurally inert to evidence-armed — implementation contract

**Status:** v1.1 FOLD (9/9 red-team blockers folded, per `contract-redteam.md` §7)
**Date:** 2026-08-07
**Verification HEAD:** `88198e56febffba8374e04b25af9d2b712869b35` (current worktree HEAD)
**Fold:** `contract-fold.md` (this directory — the blocker → change map, all 9 + the OQ verdicts)
**Red-team:** `contract-redteam.md` (this directory — **NOT FOLD-READY** as written; every numbered blocker is folded below)
**Brief:** `contract-67-brief.md` (this directory, 47 lines)

**Seed.** The #64 trust-gate steering campaign named the watchdog dead in three independent ways —
"Progress evidence must be farm-proof … 128 one-char notes buy the full 8h wall budget today; a
blocking question parks outside the watchdog with `deadlineAt: null`"
(`docs/reference/evidence/trust-gate-steering-2026-08-02/trust-gate-steering-decisions.md:31-34`),
"The stall watchdog is not a liveness bound (semantics A7, authority TG1/6b: production stallMs =
wallMin, any-event re-arm, blocked-status escape)" (`:35-37`). The issue body itself was
unavailable at drafting time (`gh` is not authenticated in this worktree), so the brief's
decisions and the two named red-team receipts carry the requirements; every code anchor below was
re-verified against the current tree at the verification HEAD.

**Read-order executed.** (1) the issue — unavailable, see above; (2) the receipts
(`trust-gate-steering-2026-08-02/redteam-semantics.md` A7, `redteam-authority.md` TG1/6b); (3) the
machinery (`impl/src/application-deployment.mjs`, `impl/src/coordinator.mjs`,
`impl/src/coordination-store.mjs`, `impl/src/application.mjs`, `impl/src/application-semantics.mjs`);
(4) the TG2 distinct-digest precedent and the landed #10 waitingOn vocabulary (`baecb18`); (5) the
red-team verdict (`contract-redteam.md`) and every anchor it cites. Anchors verified by
`grep -an`/`sed -n`; the **two** NUL-bearing files (`application.mjs`, `coordination-store.mjs`)
were read by grep/sed only — `coordinator.mjs` has **0** NUL bytes (verified by `tr -cd '\000'`)
and was read whole, per campaign discipline.

**Cross-references (not re-specified here):** #64 trust-gate steering (TG2 distinct-digest evidence
class + the explicit "#67's sibling" null-deadline default, TG3 the one bounded steering cycle), #10
waitingOn vocabulary, #55 the three-waves incident, #7 the load-flake cluster. Each is cited at the
decision it touches. This contract owns only the watchdog liveness surface.

---

## 1. Ground truths (re-verified at HEAD)

| # | Ground truth | Verified anchor |
|---|--------------|-----------------|
| G1 | **The stall budget is coextensive with the wall budget.** `DEFAULT_BUDGET = Object.freeze({tokens: 100_000_000, usd: 1_000, wallMin: 480, providerTurns: 2_048})`; `timeoutMs: DEFAULT_BUDGET.wallMin * 60_000`; `approvalTimeoutMs: DEFAULT_BUDGET.wallMin * 60_000`; and `watchdog: { stallMs: DEFAULT_BUDGET.wallMin * 60_000 }` — a stall takes **480 minutes** to declare in production, identical to the whole node wall budget. | `application-deployment.mjs:37-41, 900, 1913, 1920` |
| G2 | **The code default differs from the deployment override** (A7: "one stallTimeoutMs is three numbers"). Code default `this._watchdog = Object.freeze({stallMs: 120000, loopThreshold: 3, scopeAction, orientation, loopAction: 'interrupt', stallAction: 'interrupt'})` (2 min); production override 480 min (G1); the wave driver's own provider-stall clock is `stallTimeoutMs: 20 * 60_000` (20 min). | `coordinator.mjs:1057-1063`; `application-deployment.mjs:1920`; `wave-driver.mjs:39` |
| G3 | **The watchdog arms only on `working`.** `_armWatchdog`: `if (!(this._watchdog.stallMs > 0) \|\| handle.status !== 'working') return;` — a non-`working` handle is silently refused. The timer mints `health.stall_suspected` with `payload: {elapsedMs, action, mechanical: true}` then calls `_applyWatchdogAction(handle, stallAction)`. | `coordinator.mjs:8731-8746` (refusal `:8733`; mint `:8739-8745`) |
| G4 | **The any-event re-arm, and the turn-boundary accounting.** `_observeWatchdogEvent`: `if (event.actor !== 'worker') return; this._touchWatchdog(handle);` — every worker-actor event re-arms the full stall timer via `_touchWatchdog` (`if (handle.status === 'working') this._armWatchdog(handle)`). `lifecycle.turn_started` additionally calls `_resetWatchdogTurn`. The single feed is at `:12824` (the last line of `_handleEvent`). The turn-terminal path (`case 'lifecycle.turn_completed'`) clears the watchdog (`_clearWatchdog`); the machinery comment pins the design: "nothing else re-arms the watchdog: `lifecycle.turn_completed` CLEARS it and only a fresh-turn admission re-arms." The adapter gates `turn_started` to real turn beginnings (`beginsTurn = !session.turnInFlight`, one-start/one-terminal). | `coordinator.mjs:9144-9146, 8757-8759, 12824, 12307-12323`; `:2483-2486`; `claude-session.mjs:884-894` |
| G5 | **The chatty-idler cap.** `MAX_SCRATCHPAD_WORKER_ENTRIES = 128`. A worker can emit 128 one-char scratchpad notes (`scratchpad.write_result`); each rides the any-event re-arm (G4) — the A4/A7 farm. | `coordination-store.mjs:496`; `coordinator.mjs:12445, 2661` |
| G6 | **The blocked-status escape.** A blocking `question.asked` mints a `_pending` record with `deadlineAt: null`, then sets `handle.status = 'blocked'`, `handle.pendingQuestionId`, and `task.status = 'input_required'`. `_armWatchdog` refuses non-`working` (G3), so the parked worker is never stall-watched. `_sweepDeadlines` covers only `approval`/`publication` (deny) and `decision` (expire) — each only when `deadlineAt != null`. Blocking `question` records are **never swept**. | `coordinator.mjs:12614-12635` (`deadlineAt: null` at `:12620`; statuses at `:12631-12635`); `_sweepDeadlines` at `:2913` (deny `:2920-2921`, decision-expire `:2922-2924`), driven by `tick()` at `:1448` |
| G7 | **The decision-expiry release precedent.** `_expireDecision`: on expiry emits `decision.expired`, transitions the task `input_required` → `working` (`coordTransition`), answers the wire cancel best-effort, records `resolution = { disposition: 'expired' }`, sets `handle.status = 'working'`. **It also closes the record** — a late answer is rejected `already_resolved` (`if (record.state !== 'pending') return {ok:false, result:'already_resolved'}`) — which the D3 fold must NOT inherit (blk-7). | `coordinator.mjs:9951-9980` (`already_resolved` at `:9952`) |
| G8 | **The attention inbox is the orchestrator's escalator.** `attentionFollow` is scope-first, cursor-chained; reasons paged by `_attentionPage` (kinds today: `candidacy_review`, `member_terminal`); `_attentionReasons = []`. The facade `attentionWatch` dispatches `run.attention.watch`. | `coordinator.mjs:7015-7060, 7088, 7122-7145, 1197`; `application.mjs:12749-12763, 12296` |
| G9 | **The #10 waitingOn vocabulary is landed, and blocked short-circuits to null.** `WAITING_ON_KINDS = ['capacity_ceiling','dispatch_pending','plan_approval','provider_stalled','spawning']` (frozen, ACTUAL sorted order); `projectWaitingOn` returns **null when the member is blocked** (`if (blocked) return null;`) — `'blocked'` is NOT a waiting kind. The blocked state is a **separate** surface: `projectBlockedInteraction` → `{kind:'approve_plan'}` / `{kind:'select_candidate'}` / `{kind:'decision'}` / `{kind:'answer_question'}`. `provider_stalled` derives from the last `health.stall_suspected` with no later worker-actor event. | `application-semantics.mjs:59-63`; `application.mjs:390-408` (`blocked null` at `:408`), `372-388`, `455-458` |
| G10 | **The #64 steering-cycle machinery is live — and pause-scoped.** `_admitPauseRecord` parks the pause and arms ONE bounded steering cycle; `_armSteeringCycle` (window `_progressNudgeWindowMs ?? 300_000`, nudge delivered via the worker's control lane); `_expireSteeringCycle` requires `task.status === 'paused'` and, on expiry, `task.status = 'working'` + full final gate with `steered: {nudgeId, answered: false}`. The cycle's answer set is **TG2 evidence** (`_steeringEvidenceQualifies`: `turn_started`, `scratchpad`/`capability_op` distinct digests deduped **per cycle** in `steering.digestSet`, resolved interactions) — NOT the D2 re-arm kinds (blk-4). | `coordinator.mjs:2076-2140` (arm `:2134`), `2165-2200`, `2276-2320` (`paused` guard `:2290`); `_steeringEvidenceQualifies` `:2208-2238`; `_progressNudgeWindowMs` default `:1003` |
| G11 | **TG2's distinct-digest evidence class, with #67's sibling already named.** "receipts dedupe by content digest within the window. One distinct valid receipt answers the cycle; ten identical one-char notes count once"; "a blocking interaction older than its deadline (or a bounded deployment default when `deadlineAt` is null, #67's sibling) does not re-arm." | `trust-gate-steering-decisions.md:78-81` |
| G12 | **The preserve-before-reap precedent.** `_preserveProgressBeforeReap`: unchanged worktree → `worktree.progress_unchanged {state:'no_progress'}`; changed worktree → `worktree.progress_checkpointed` (a pinned sha). **Both are minted `actor: 'policy'`** — the reap's own receipts (blk-2: `progress_checkpointed` is self-contradictory as a worker re-arm). `_applyWatchdogAction` maps `kill`/`interrupt` → `_beginStop`. | `coordinator.mjs:8404-8460` (`progress_unchanged` `:8435-8439`, `progress_checkpointed` `:8448`); `:8761-8765` |
| G13 | **The wave-driver stall surfaces (cross-ref #55, not re-specified).** K=3 unsteerable; the stall clock and claim-on-stall fan-out; the #55 activity projection `{providerCalls, tokens, contentEvents, lastActivityAt}` (moved the wave stall marker on ANY activity — activity ≠ evidence is the #55 lesson). The coordinator watchdog is a separate liveness surface. | `wave-driver.mjs:668-673, 729-762, 39-40`; `application.mjs:8041-8068` (`_activityProjection`) |

---

## 2. Decisions

### D1 — Decouple the stall budget from the wall budget

Pin the decoupling the brief demands: a deployment-level stall budget that is **strictly smaller,
separately configured, honestly disclosed, and admission-checked**. The wiring at
`application-deployment.mjs:1920` stops deriving `stallMs` from `DEFAULT_BUDGET.wallMin`:

```js
// contract — application-deployment.mjs (replaces :1920)
// DEFAULT_WATCHDOG is frozen SEPARATELY from DEFAULT_BUDGET: the stall budget is a liveness
// bound on no-progress EVIDENCE, never the wall budget. 20 min matches the wave-driver's
// provider-stall outer backstop (wave-driver.mjs:39) — one coherent stall vocabulary.
const DEFAULT_WATCHDOG = Object.freeze({
  stallMs: 20 * 60_000,                       // strictly < DEFAULT_BUDGET.wallMin * 60_000 (480 min)
  blockingInteractionTimeoutMs: 20 * 60_000,  // the null-deadline default for blocking interactions (D3)
  loopThreshold: 3,
  loopAction: 'interrupt',
  stallAction: 'escalate',                    // was 'interrupt' — D4 rung 1, never a direct stop
});
watchdog: { ...DEFAULT_WATCHDOG }
```

- **Strictly smaller, separately configured.** `DEFAULT_WATCHDOG.stallMs` (20 min) is strictly less
  than `DEFAULT_BUDGET.wallMin * 60_000` (480 min, G1). The two constants are frozen independently;
  nothing in `DEFAULT_BUDGET` feeds the watchdog. `DEFAULT_WATCHDOG` is a new, separately-named
  deployment constant — a future change to the wall budget cannot silently change the stall budget.
- **Admission-checked (blk-6).** The only guard today is `stallMs > 0` (`coordinator.mjs:8733`) —
  a misconfigured `watchdog: { stallMs: 500 * 60_000 }` sails through and the bound can never fire
  before the node wall budget ends (the "bound that can never fire is the original bug reborn"
  failure). The deployment seam adds an admission check: `stallMs` must be a positive integer
  **strictly less than** the node wall `timeoutMs` (`DEFAULT_BUDGET.wallMin * 60_000`); a violation
  is a typed refusal `watchdog_stall_exceeds_wall` (no silent fallback). The same check runs at
  `_armWatchdog` for defense-in-depth. `blockingInteractionTimeoutMs` is validated positive-integer
  (it is an orchestrator-facing accountability bound, not a liveness bound — no strict-< requirement).
- **Honestly disclosed — at runtime, not only in a comment (blk-6).** The "honestly disclosed"
  claim is source-comment-only today: the application facade has **zero** `stallMs`/`watchdog`
  references (`grep -rn stallMs impl/src/application.mjs` is empty), so an operator cannot read
  what the watchdog measures from any status/view endpoint. The resolved watchdog config is
  exposed byte-stable on the deployment/run status surface (D2, §3): `{stallMs, basis:
  'no_progress_evidence', rearmKinds: [...]}` — the REARM set in ACTUAL sorted order. The knob
  measures **no-progress evidence, not speed**: the stall declares only "no evidence of progress
  for the window" (the D2 `basis` field), never "too slow."
- **The wall budget is untouched.** `timeoutMs` (`:900`) and `approvalTimeoutMs` (`:1913`) keep
  `DEFAULT_BUDGET.wallMin * 60_000`. The decoupling is one-directional: the watchdog shrinks, the
  wall budget does not. The wall budget is also the **operator-pinned backstop for a hung turn**
  (D2, blk-5): a turn that never terminates is the wall budget's problem, never the stall
  watchdog's kill.
- **The code default stays conservative.** `coordinator.mjs:1057`'s `stallMs: 120000` (2 min, G2)
  remains — a coordinator constructed without a deployment override declares stalls fast. The
  production override is now a bounded 20 min instead of 480 min.

### D2 — Progress-evidence re-arming (set + feed + actor policy together; kill the any-event re-arm)

The any-event re-arm (G4) is killed. The fold re-specifies D2 as **three coupled decisions at
once** (blk-2): the closed **set**, the **feed** that delivers it, and the **actor policy** that
was silently filtering most of the v1.0 set to death. The v1.0 set was largely inert: the retained
`event.actor !== 'worker'` gate filtered `control.steer` (actor `'orchestrator'`,
`coordinator.mjs:7404`), `verify.reverified` (actor `'policy'`, `:6463`/`:13011`), and
`worktree.progress_checkpointed` (actor `'policy'`, `:8448`) — and none of them rode the single
feed (`:12824`), which carries only the driver observation stream. Only `lifecycle.turn_started`
reliably reached the observer.

**The closed re-arm set.** Four kinds — the worker-observable progress evidence, nothing else:

```js
// contract — the closed re-arm set (frozen, ACTUAL sorted order — verified: the literal below
// IS its own [...set].sort() result)
const REARM_KINDS = Object.freeze([
  'approval.resolved',
  'decision.settled',
  'lifecycle.turn_started',
  'question.answered',
]);
```

- **`lifecycle.turn_started`** — the turn system's own progress unit (G4). Worker-mintable, gated by
  the adapter's one-start/one-terminal accounting (`claude-session.mjs:884-894`) — that discipline
  is a pinned **dependency of the closed set** (the residual named by the red-team: a loose adapter
  turns a turn-spammer into a perpetual re-armer; the one-start/one-terminal accounting is the bound).
- **`question.answered` / `approval.resolved` / `decision.settled`** — TG2's resolution-gated
  interactions (G11). They are minted only on resolution (`coordinator.mjs:9774, 9779, 9906`) and
  re-arm **only when they ride the worker observation stream** (a worker resolving its own blocking
  interaction — the `_handleEvent` case at `:12779-12796`). The coordinator's out-of-band `respond`
  API (`:9540`, actor default `'orchestrator'`) mints them directly to the ledger, **not through
  the feed** — an orchestrator answering over the API is an orchestrator action (like steer/nudge),
  not worker progress evidence, and does **not** re-arm. This closes the create-and-answer
  self-dealing loop (blk-2, red-team §2 Hole 3/4).

**Removed from the v1.0 set, each with its reason (blk-2):**
- `control.steer` — orchestrator claim, not worker evidence; it arms the stall-seam cycle (D4 rung
  2), it does not re-arm the watchdog. An orchestrator steering its own stall away would be a
  self-dealing loop (the red-team's honest note: the loop fails to re-arm today *only because the
  legitimate steer re-arm is broken too* — the fold keeps it broken by design).
- `verify.reverified` — minted `actor: 'policy'` on the policy verify path; it never rides the
  worker stream, and its re-arm value is loop-adjacent. The `loopThreshold` loop detector
  (`coordinator.mjs:1057`, `:9166-9174`) is the bound on repeated failures (OQ-4, resolved).
- `worktree.progress_checkpointed` — minted `actor: 'policy'` **by `_preserveProgressBeforeReap`
  itself** (G12) — the reap's own receipt, self-contradictory as a worker re-arm (a reaped worker
  simultaneously produces evidence that says "progress"). Dropped.

**The feed (one stream, exactly).** `_observeWatchdogEvent`'s only call site is the driver
observation stream at `:12824` (the last line of `_handleEvent`). The four REARM kinds reach it
through that stream:
- `lifecycle.turn_started` — rides it today (adapter-gated, `claude-session.mjs:884-894`).
- the three resolutions — ride it when the worker resolves its own interaction on the worker stream
  (`_handleEvent` `:12779-12796`; the re-arm fires through `_touchWatchdog`'s `working`-only guard,
  so it applies to a `working` worker — a resolved blocking interaction's release transition to
  `working` precedes the observer call, matching `clearPending`'s `blocked → working` parity in the
  `respond` path). No new feed seam is added for the `respond` API or the send/verify paths: the
  send path (`:7404`), the policy verify path (`:6463`/`:13011`), and the reap pre-check (`:8448`)
  do **not** feed the observer.

**The actor policy.** The blanket `if (event.actor !== 'worker') return;` is **removed** from
`_observeWatchdogEvent`. The closed set is the gate: an event re-arms only if its kind is in
`REARM_KINDS`. The kinds in the set are exactly the worker-observable ones, and the feed is the
worker observation stream — so the removed gate loses no protection (the kinds it used to filter
are no longer in the set), and the worker-actor resolutions it used to block now re-arm correctly.

**Code order (blk-8).** The v1.0 replacement put `if (!REARM_KINDS.includes(event.kind)) return;`
*before* the provider_call/tool_call observation branches, silently disabling
`_observeLogicalProviderCall` / `_observeLogicalToolCall` and the `loopThreshold` detector
(`:9166-9174`). The fold orders the function so the observation/loop-tracking branches run **first**
(gated on their own kind checks) and the REARM silence-return comes **last**:

```js
// contract — _observeWatchdogEvent (coordinator.mjs:9144-9146 replacement)
// Order (blk-8): the observation/loop-tracking branches run FIRST, gated on their own kind
// checks; the REARM_KINDS silence-return comes LAST so it can never shadow them.
_observeWatchdogEvent(handle, event) {
  if (event.kind === 'resource.provider_call') {
    this._observeLogicalProviderCall(handle, event.payload ?? {});
    return;
  }
  if (event.kind === 'content.tool_call') {
    const payload = event.payload ?? {};
    this._observeLogicalToolCall(handle, payload);
    // ... the loopThreshold detector (the recentFailedActions tail check, :9166-9174) —
    //     unchanged, runs here ...
    return;
  }
  if (event.kind === 'content.file_edit') {
    // ... the scope-orientation branch — unchanged, runs here ...
    return;
  }
  if (event.kind === 'lifecycle.turn_started') {
    handle.turnInFlight = true;      // liveness marker (blk-5): a turn in flight is not silence
    this._resetWatchdogTurn(handle); // turn-boundary reset (loop-tracking + fresh re-arm)
    return;
  }
  if (!REARM_KINDS.includes(event.kind)) return;   // EVERYTHING ELSE IS SILENCE
  this._touchWatchdog(handle);                     // progress evidence re-arms
}
```

**The in-flight-turn liveness gate (blk-5 — the control-law line).** The v1.0 mechanics could
declare a slow-but-productive worker stalled *and reaped*: D2 removed `content.tool_call` /
`resource.provider_call` / `resource.tokens` from re-arming, D1 pinned the window at 20 min, and a
25-minute compile emits zero REARM kinds for its whole run — D1 fires mid-compile, the nudge cannot
be answered (the worker is mid-tool-call, the control-lane prompt is not processed), the 300 s
cycle expires, and `_preserveProgressBeforeReap` preserves the *output* but not the *worker*. The
fold makes **no bound fire on elapsed time without an evidence check**: a turn in flight IS the
evidence check.

- `handle.turnInFlight` (new per-handle liveness marker, mirroring the adapter's
  `session.turnInFlight`): set `true` when `lifecycle.turn_started` is observed (above); cleared at
  the turn-terminal seam — the `_handleEvent` `lifecycle.turn_completed` case (`:12307-12323`, set
  `handle.turnInFlight = false` before `_clearWatchdog(handle)`) and the crash/exit terminal paths
  (`:12844`).
- **D1 gating:** in `_armWatchdog`'s timer callback (`:8736-8745`), after the existing
  working/status/stall checks, add: `if (handle.turnInFlight === true) { this._armWatchdog(handle);
  return; }` — a turn in flight is the turn system's own progress unit; the watchdog cannot
  honestly claim "no evidence of progress" while a turn is running, so the window re-arms without
  declaring. A 20-minute compile is **not** a stall.
- **The wall budget is the hung-turn backstop.** A turn that never terminates keeps `turnInFlight`
  true and never stall-declares — that is the honest outcome under the control law (the watchdog
  cannot distinguish a hung tool call from a long one on elapsed time alone). The node's own wall
  budget (`timeoutMs`, `DEFAULT_BUDGET.wallMin * 60_000`, G1) is the operator-pinned bound for a
  turn that exceeds its budget — a pre-existing, separate surface, not a new clock.
- **Rung 3 is additionally gated** on `turnInFlight === false` (D4) — even a declared stall cannot
  reap a worker mid-turn.

- **The set is closed and enumerated by name.** The four kinds map to the brief's classes and
  TG2's: a turn boundary → `lifecycle.turn_started`; TG2's resolution-gated interactions →
  `question.answered` / `approval.resolved` / `decision.settled` (earn progress only when resolved,
  and only when the worker stream delivers the resolution).
- **The digest gate holds at mint.** `worktree.progress_checkpointed` is minted only when the
  captured sha differs from base (`_preserveProgressBeforeReap`, G12); the unchanged case mints
  `worktree.progress_unchanged {state:'no_progress'}` (`:8435-8439`) — which is explicitly **NOT** a
  re-arm, it is the no-progress receipt. No content floor is needed at the watchdog (TG2): the farm
  bound lives at the final's real-diff demand.
- **A chatty idler buys nothing.** 128 one-char `scratchpad.write_result` notes (G5), heartbeats,
  `resource.provider_call`, `resource.tokens`, `content.tool_call`, status noise — none re-arm
  (SW-03/SW-05). The scratchpad write path and the observation branches still run for their own
  machinery; they simply never touch `_touchWatchdog`.
- **Orchestrator/policy actions never re-arm a worker's liveness.** `control.steer` / `control.nudge`
  arm the stall-seam cycle (D4 rung 2); `verify.reverified` and `worktree.progress_checkpointed`
  are not in the set. The closed set is the gate — no separate actor gate to leak through.

### D3 — The blocked-status escape (whose stall; the honest surface; the null-deadline default)

Pin whose stall a never-answered blocking question is, the **honest state surface**, then the
blocking-interaction default when `deadlineAt` is null.

- **A never-answered blocking question is a stall of the ORCHESTRATOR, not the worker.** The
  blocking `question.asked` parks the worker (`handle.status = 'blocked'`,
  `task.status = 'input_required'`, G6). The worker is not stalling — it is waiting on the
  orchestrator to answer. **`_armWatchdog`'s non-`working` refusal (G3) is retained and pinned**: a
  blocked worker is never stall-reaped for the orchestrator's un-answered question (SW-07). The
  D1/D2 watchdog surface applies only to workers in `working`.
- **The honest state is `blockedInteraction`, not a waiting kind (blk-3).** The v1.0 contract
  claimed a blocked worker reads `waitingOn: {kind: 'blocked'}`. That state does not exist: `'blocked'`
  is not in `WAITING_ON_KINDS` (G9), and `projectWaitingOn` returns **null** when the member is
  blocked (`application.mjs:408`) — blocked short-circuits the whole waitingOn projection. The
  blocked state is the **separate** `blockedInteraction` surface (`projectBlockedInteraction`,
  `application.mjs:372-388`): `{kind: 'approve_plan'}` / `{kind: 'select_candidate'}` /
  `{kind: 'decision'}` / `{kind: 'answer_question'}`. The contract's honest-state claim lives on
  **that** surface, and §5's no-new-waiting-kinds law is consistent (no 6th kind is invented).
- **The blocking-interaction default when `deadlineAt` is null.** The `question` record mints
  `deadlineAt: null` (G6) and is never swept. The contract fills the null with a bounded deployment
  default entering the **existing** `_sweepDeadlines` (G6), the #67's sibling TG2 already names:
  - `DEFAULT_WATCHDOG.blockingInteractionTimeoutMs` (D1, 20 min) is the effective deadline for a
    blocking `question` record whose `deadlineAt` is null:
    `effectiveDeadlineAt = record.deadlineAt ?? record.mintedAt + blockingInteractionTimeoutMs`
    (the record gains `mintedAt: this._now()` at mint — additive, mirroring the decision record's
    `deadlineAt: this._now() + request.deadlineMs` precedent at `coordinator.mjs:12775`).
  - `_sweepDeadlines` gains a `question` branch beside the decision branch (`:2922-2924`):
    **escalate, never reap, never close (blk-7).** On expiry, mint the attention reason
    `interaction_expired` into the orchestrator's inbox (G8, readable via `run.attention.watch`),
    release the worker to `working` per the `_expireDecision` release precedent (G7:
    `coordTransition` `input_required` → `working`, best-effort wire cancel,
    `handle.status = 'working'`), and receipt it as `question.expired` (the `decision.expired`
    analog) with `resolution = { disposition: 'escalated' }`.
  - **Escalation is not an answer, and it is not a close.** The question is recorded
    `disposition: 'escalated'`, never auto-answered with a fabricated answer. Crucially, the record
    is **NOT** closed the way `_expireDecision` closes decisions (`_resolveInteractionAuthority`
    is not called; `record.state` stays `'pending'`; `record.consumer` stays null) — so a late
    operator answer **still lands** via `respond` instead of being rejected `already_resolved`
    (G7 `:9952`). A released worker that still needs the input may re-ask (the one-pending
    admission still holds).
  - **Operator ack/claim extension (OQ-1, resolved — the missing orchestrator-side evidence
    check).** The v1.0 default was a time-only bound with zero evidence check on the orchestrator
    side: after 20 min a blocking question was swept even while a human was actively reviewing it
    (the #105 escalation lane, `question.asked {blocking:true}`). A new claim/ack surface on the
    attention reason (the `claim_turn`-shape claim, `coordinator.mjs:2541` / `wave-driver.mjs:397`)
    marks `interaction_expired` (or its pending `answer_question` entry) as **acknowledged-in-review**;
    an acknowledged interaction extends its effective deadline (per ack, `+ blockingInteractionTimeoutMs`)
    and is skipped by the sweep. A legitimate >20-min operator review is never preempted.

### D4 — The kill ladder (escalate → claim/nudge → reap, receipted, no silent kills, never mid-turn)

`_applyWatchdogAction` (G12) currently maps the stall action to an immediate `interrupt`. The
contract replaces the stall action with a three-rung ladder; each rung is receipted; **no silent
kills**.

- **Rung 1 — escalate.** The stall timer fires (D1 window, gated on no in-flight turn, D2) →
  `health.stall_suspected` mints with `basis: 'no_progress_evidence'` (D2) **and** a run-scoped
  attention reason `stall_declared` is minted into the orchestrator's inbox (G8). The stall action
  is `'escalate'` — a NEW `_applyWatchdogAction` branch that mints the reason and does **not** stop
  the worker (the existing `kill`/`interrupt` → `_beginStop` branches are untouched). Receipted:
  `health.stall_suspected` (which also surfaces as `waitingOn: {kind: 'provider_stalled'}` via G9).
- **Rung 2 — claim/nudge (blk-9: a specified stall-seam seam).** The orchestrator claims the stall
  by steering: a `control.steer` **or** `control.nudge` arms a **new** stall-seam cycle,
  `_armStallCycle(handle, task, {nudgeId, controlId})` — the existing `_armSteeringCycle` is
  pause-scoped (arms at pause admission, `:2134`; `_expireSteeringCycle` no-ops unless
  `task.status === 'paused'`, `:2290`) and would no-op on a `working` stall-seam worker. The
  stall-seam cycle is specified:
  - **Record shape:** `{kind: 'stall_seam', worker, taskId, nudgeId, controlId, mintedAt, windowMs,
    answered: false, basis: 'no_progress_evidence', lifetime}` — `lifetime` is the id of the current
    stall declaration (`handle.watchdogActions`'s `stall` flag), so successive nudges on the SAME
    stall share one lifetime.
  - **`working`-compatible expiry:** the cycle expires on `windowMs` (`_progressNudgeWindowMs ??
    300_000`) with a `working` task — it does NOT reuse the `paused`-only `_expireSteeringCycle`.
  - **The answer set is the D2 REARM_KINDS, not TG2 evidence (blk-4).** The existing cycle's answer
    set (`_steeringEvidenceQualifies`, `:2208-2238`) is TG2 evidence — `scratchpad`/`capability_op`
    distinct digests, deduped per-cycle — so a worker answered every nudge with one saved note and
    the ladder never reached reap (claim-then-idle). The stall-seam cycle answers **only** on a D2
    REARM kind observed inside the window. A scratchpad/capability note cannot clear a stall.
  - **Per-stall LIFETIME dedup (blk-4).** The cycle's digest set lives on the stall lifetime
    (`handle.stallSeamDigestSet`, cleared only when the stall is fully cleared), not per-cycle —
    one reused digest cannot answer successive cycles. (The `_steeringEvidenceQualifies` per-cycle
    `steering.digestSet` stays for the pause cycle; the stall-seam cycle does not use it.)
  - If the worker emits a qualifying D2 re-arm inside the window → the cycle resolves
    `steered: {nudgeId, answered: true}` and the stall clears: **`_clearStall(handle)`** (new — the
    stall-flag removal seam, blk-4) deletes `handle.watchdogActions`'s `stall` flag, clears
    `handle.stallSeamDigestSet`, and re-arms the watchdog fresh. `_clearStall` is called ONLY on a
    qualifying D2 re-arm inside the window — no other removal point.
  - Receipted: `control.steer` / `control.nudge`, then (on a qualifying re-arm) the re-arm kind
    itself.
- **Rung 3 — reap, gated on no in-flight turn (blk-5).** Only if the claimed stall-seam cycle
  expired unanswered (`steered: {nudgeId, answered: false}`) **and** `handle.turnInFlight === false`
  (the worker is genuinely unresponsive, not mid-computation) **and** the stall persists:
  `_preserveProgressBeforeReap` runs first (G12 — receipts `worktree.progress_unchanged
  {state:'no_progress'}` or pins a checkpoint), then `_applyWatchdogAction` with `kill`/`interrupt`
  → `_beginStop`. Receipted: `worktree.progress_unchanged` / `worktree.progress_checkpointed`, then
  `kill.requested` / `control.interrupt_requested`. A mid-compile worker whose cycle expires
  unanswered is **not** reaped — the stall stays escalated and the watchdog re-arms (D2).

- **An unclaimed stall stays escalated; it never auto-reaps.** If the orchestrator does not claim
  (no steer/nudge), the attention reason `stall_declared` persists in the inbox and the worker reads
  `provider_stalled`. A supervisor reap is always possible and receipted; the watchdog itself never
  silently kills.
- **K=3 (cross-ref #64/#55, not re-specified).** The wave-driver's three-waves-unsteerable rule
  (`wave-driver.mjs:668-673`) bounds the driver's own steering; the coordinator's stall seam uses
  one bounded stall-seam cycle per stall-declared lifetime. This contract adds no new count bound —
  the ladder is the bound.

---

## 3. Refusal / observability vocabulary (closed)

| Code / kind / reason | Reach | Fires when |
|----------------------|-------|------------|
| `health.stall_suspected` (existing) | coordinator ledger → `waitingOn: {kind: 'provider_stalled'}` (G9) | the D1 stall window fires (gated on no in-flight turn, D2); payload gains `basis: 'no_progress_evidence'` (D2) |
| attention reason `stall_declared` (NEW) | `run.attention.watch` (G8) | D4 rung 1 — stall declared, escalate, no stop |
| attention reason `interaction_expired` (NEW) | `run.attention.watch` (G8) | a blocking interaction's effective deadline passes (D3) |
| `question.expired` (NEW event kind) | coordinator ledger | the blocking-question escalation release (D3; the `decision.expired` analog, G7) |
| `worktree.progress_unchanged` (existing) | coordinator ledger | reap pre-check finds no progress (G12) — NOT a re-arm (D2) |
| `worktree.progress_checkpointed` (existing) | coordinator ledger | reap pre-check pins a changed sha (G12) — NOT a re-arm (D2; blk-2) |
| runtime watchdog config (NEW surface) | deployment/run status (readable byte-stable) | always — `{stallMs, basis: 'no_progress_evidence', rearmKinds: [ACTUAL-sorted]}` (D1, blk-6) |

**Attention-reason object shape (pinned, blk-6/§6).** The two new reasons carry a full reason
object, byte-stable, paged by `_attentionPage` like the existing kinds (G8):
- `stall_declared` → `{seq, runId, mintEpoch, mintedAt, kind: 'stall_declared', basis:
  'no_progress_evidence', workerId, stallMs}` — `runId` is the handle's task runId.
- `interaction_expired` → `{seq, runId, mintEpoch, mintedAt, kind: 'interaction_expired', requestId,
  interactionKind: 'question', disposition: 'escalated', effectiveDeadlineAt}`.
Both are surfaced to the run's orchestrator (the same authority that reads `member_terminal`), and
the ack/claim that extends the effective deadline (D3, OQ-1) is an orchestrator-only action on the
reason.

No new worker-stream refusal code is introduced, and `stateFailureCode` / the web mapper are
untouched: the watchdog never crosses the MCP/web facade as a thrown error — its escalations ride
the attention inbox and the ledger, and its config rides the status surface (a read, not a throw).
The `_armWatchdog` non-`working` refusal (G3) stays silent by design; the blocked state is
observable through `blockedInteraction` (G9), not a refusal code.

The wire sorted-key literals remain exactly as today: the closed-five `WAITING_ON_KINDS` literal
(G9) and the new four-kind `REARM_KINDS` literal (D2) are each written in ACTUAL sorted order.

---

## 4. Acceptance pins (red-first)

RED = fails at HEAD; GREEN = passes at HEAD and is pinned.

| Pin | Assertion | Today |
|-----|-----------|-------|
| SW-01 | **Stall budget decoupled + admission-checked.** `watchdog.stallMs` derives from a separately-frozen constant strictly smaller than `DEFAULT_BUDGET.wallMin * 60_000`; a deployment override ≥ the wall (or non-positive/non-integer) is refused `watchdog_stall_exceeds_wall`; the deployment config discloses it; the wall budget (`timeoutMs`, `approvalTimeoutMs`) is untouched. | **RED** (`stallMs = wallMin * 60_000` = 480 min, `application-deployment.mjs:1920`; no admission check anywhere, `coordinator.mjs:8733`) |
| SW-02 | **Stall declaration names its basis.** `health.stall_suspected` carries `basis: 'no_progress_evidence'` — the honest claim is "no evidence of progress," never "too slow." | **RED** (payload is `{elapsedMs, action, mechanical}` only, `coordinator.mjs:8739-8745`) |
| SW-03 | **Any-event re-arm killed.** A worker emitting only non-evidence events (scratchpad notes, heartbeats, provider calls, tool calls, tokens) never re-arms; the loop-tracking/observation branches still run. | **RED** (`_observeWatchdogEvent` re-arms on every worker-actor event, `coordinator.mjs:9144-9146`) |
| SW-04 | **Closed re-arm set + feed + actor policy.** Only the four kinds re-arm; the set is the frozen ACTUAL-sorted literal; the feed is the worker observation stream (`:12824`); orchestrator/policy kinds (`control.steer`, `control.nudge`, `verify.reverified`, `worktree.progress_checkpointed`) never re-arm; `worktree.progress_unchanged` is NOT a re-arm; everything else is silence. | **RED** (no set — any event re-arms; the v1.0 set is inert under the actor gate, blk-2) |
| SW-05 | **Chatty-idler farm closed.** 128 one-char `scratchpad.write_result` notes (the `MAX_SCRATCHPAD_WORKER_ENTRIES` cap, `coordination-store.mjs:496`) buy zero re-arms; the farm bound at the final still demands a real in-scope diff (TG2). | **RED** (each note re-arms) |
| SW-06 | **Blocked worker reads the honest state.** A worker parked on a blocking question reads `waitingOn: null` + `blockedInteraction: {kind: 'answer_question'\|'approve_plan'\|'select_candidate'\|'decision'}`, `task.status='input_required'`, `handle.status='blocked'`. (v1.0 pinned the nonexistent `waitingOn: {kind:'blocked'}` — a broken GREEN that was RED as written; re-specified on the landed surface, blk-3.) | **GREEN** (pin — the landed #10 vocabulary, `application.mjs:372-408`) |
| SW-07 | **Blocked worker never stall-killed.** `_armWatchdog`'s non-`working` refusal (G3) is retained; a blocked worker is never reaped for the orchestrator's un-answered question. | **GREEN** (pin) |
| SW-08 | **Null-deadline default + ack extension + non-destructive escalation.** A blocking question with `deadlineAt: null` gets a bounded deployment default entering `_sweepDeadlines`; an operator-acked interaction does not expire; on expiry it escalates (attention reason `interaction_expired` via `run.attention.watch`), releases the worker to `working`, records `disposition: 'escalated'`, keeps the record answerable (a late answer lands, never `already_resolved`) — never reaps, never fabricates, never closes. | **RED** (null deadline never swept; no attention reason; no release; the decision-expire precedent closes the record, `:9952`) |
| SW-09 | **Kill ladder: escalate first.** A stall-declared mints `health.stall_suspected` + attention reason `stall_declared`; the stall action is `escalate`, never a direct stop. | **RED** (stall → immediate `interrupt`, `coordinator.mjs:8761-8765`) |
| SW-10 | **Kill ladder: reap last, receipted, never mid-turn.** Reap requires the claimed stall-seam cycle to have expired unanswered AND no in-flight turn; `_preserveProgressBeforeReap` runs first (receipts `worktree.progress_unchanged` or pins a checkpoint); the stop is receipted. An unclaimed stall stays escalated, never auto-reaps; a mid-turn worker is never reaped. | **RED** (no ladder — immediate stop, no preserve, no receipt trail, no in-flight gate) |
| SW-11 | **(NEW) Admission-time `stall < wall`.** A misconfigured `watchdog.stallMs` ≥ the node wall `timeoutMs` (or non-positive/non-integer) is refused at the deployment seam with the typed refusal `watchdog_stall_exceeds_wall`; no bound can silently never fire. | **RED** (no such check; only `stallMs > 0`, `coordinator.mjs:8733`) |
| SW-12 | **(NEW) Runtime disclosure.** The resolved watchdog config `{stallMs, basis: 'no_progress_evidence', rearmKinds: [ACTUAL-sorted]}` is readable on the deployment/run status surface, byte-stable — not source-comment-only. | **RED** (facade has zero `stallMs`/`watchdog` references) |

---

## 5. Campaign-law constraints and non-goals

- **No clocks as controls.** The watchdog is a LIVENESS bound, not a workflow gate: it may only ever
  declare "no evidence of progress" (D2 basis), never "too slow." Every bound it pins is measured in
  evidence units (the closed re-arm set, the in-flight turn, distinct digests); time is the coarse
  outer backstop only. The D1 window is a **silence** bound — it re-arms without declaring while a
  turn is in flight (blk-5), so **no bound fires on elapsed time without an evidence check**. A
  20-minute compile is not a stall. The wall budget (`timeoutMs`) is a pre-existing, operator-pinned
  node bound — the hung-turn backstop, not a workflow gate.
- **No new waiting kinds.** `WAITING_ON_KINDS` (five) and `BLOCKING_INTERACTION_KINDS` (three) are
  byte-unchanged (G9). D3's honest state is the separate `blockedInteraction` surface, so the
  no-new-kinds law is consistent (blk-3). `provider_stalled` continues to ride
  `health.stall_suspected`.
- **No new refusal codes on the worker stream.** The escalations ride the attention inbox and the
  ledger; `stateFailureCode` and the web mapper are untouched. The new `watchdog_stall_exceeds_wall`
  refusal is a deployment-seam typed refusal (an admission error), not a worker-stream code.
- **Sorted-key literals in ACTUAL order.** `REARM_KINDS` (D2, four kinds) is written in ACTUAL sorted
  order (verified: the literal IS its own `.sort()` result); `localeCompare` is banned.
- **NUL-byte discipline (corrected, blk-1).** The **two** NUL-bearing files were verified by
  `grep -an`/`sed -n` only: `application.mjs` and `coordination-store.mjs` (3 NUL bytes each,
  `tr -cd '\000'`). `coordinator.mjs` has **0** NUL bytes and was read whole. (v1.0 mis-stated the
  NUL-bearing list; the red-team's `contract-redteam.md` methodology is the corrected truth.)
- **Non-goals.** Auto-answering an expired blocking question (D3 escalates, never fabricates, never
  closes); an auto-reap clock for unclaimed stalls (OQ-2, deferred); the wave driver's own stall
  clock (cross-ref #55 — the wave marker stays its own surface); re-specifying #64's TG2/TG3, #10's
  vocabulary, #55's projection, #7's load-flake cluster (cross-referenced only).

---

## 6. Open questions (verdicts folded)

The red-team's §6 verdicts are adopted (see `contract-fold.md`):

- **OQ-1 — attention-reason claim/ack surface: RESOLVED (fold-blocking).** A claim/ack on
  `stall_declared` / `interaction_expired` that extends the effective deadline is added (D3) — it is
  the missing orchestrator-side evidence check that keeps the D3 default from firing during
  legitimate review. Shape: the `claim_turn` precedent (`coordinator.mjs:2541`, `wave-driver.mjs:397`);
  per-ack `+ blockingInteractionTimeoutMs`; the acknowledged record is skipped by the sweep.
- **OQ-2 — unclaimed-stall residual: DEFERRED (not fold-blocking).** "Stays escalated, never
  auto-reaps" is the honest terminal under the control law; the claimed path is where the ladder was
  escapable (blk-4) and is fixed. A supervisor-armed reap already exists and is receipted. No
  auto-reap clock is added.
- **OQ-3 — `blockingInteractionTimeoutMs` value: RESOLVED (mechanism before value).** Keep 20 min
  provisionally; the pin is gated on the OQ-1 ack-extension mechanism. The value becomes a knob
  worth tuning only once the mechanism exists (a lived observation first).
- **OQ-4 — `verify.reverified {accept:false}`: RESOLVED (moot).** `verify.reverified` is removed
  from REARM_KINDS entirely (blk-2) — it never re-arms regardless of `accept`. The loop-detector
  bound (`loopThreshold`, `coordinator.mjs:1057`) is the answer for repeated failures.

---

## 7. Verification

- **HEAD pinned:** `88198e56febffba8374e04b25af9d2b712869b35` (current worktree HEAD). Every anchor
  in §1 was re-verified by `grep -an`/`sed -n` on the current tree; the two NUL-bearing files were
  never read whole. Sorted-key literals appear only as verified.
- **The five red-team holes are LIVE at HEAD:** (1) production `stallMs = wallMin * 60_000` = 480 min
  (`application-deployment.mjs:1920`); (2) any-event re-arm (`coordinator.mjs:9144-9146`); (3) the
  blocked-status park with `deadlineAt: null` (`coordinator.mjs:12620, 12631-12635`) unswept
  (`:2913`); (4) the immediate stall → `interrupt` stop (`:8761-8765`) with no ladder; (5) the
  TG2-evidence steering-cycle answer set (`_steeringEvidenceQualifies`, `:2208-2238`) that lets
  claim-then-idle walk the ladder. The #64 steering machinery (G10) and the #10 vocabulary (G9) are
  live and compose with the decisions.
- **Deployment verification command** (Baton): executable `true`, arguments `[]`, expected exit 0.
