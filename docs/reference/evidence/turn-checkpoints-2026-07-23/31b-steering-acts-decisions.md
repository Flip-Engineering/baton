# 31-B decisions contract — steering acts, invalidation, attention classification (issue #31)

Status: v2, revised per `31b-redteam.md` (2026-07-23). Every numbered finding in that brief is
resolved below; see `## v2 revisions` at the end for the finding→resolution map. This revision
also carries the orchestrator's SHARED DECISIONS pinned across the 31-a/31-b sibling pair
(key space, story.mjs status ownership, attention classification, the coordination-store.mjs:10630
edit owner) — this contract honors them identically and states dependencies on 31-a rather than
duplicating its edits.

Ground truth: docs/35-turn-checkpoints.md v2 §2.2(6-8)/§2.3 (the binding, settled design — this
contract does not re-litigate the card-declaration default, `turn.paused` records, the `paused`
task state, `steering.registered`, or degenerate auto-settle; those are 31-a's scope,
`31a-pause-records-decisions.md`). This contract fixes shapes and code sites for 31-a's sibling
issue: the three steering acts a live driver takes on a paused task (nudge/wait/claim), the
invalidation nudge performs, the stall-watchdog interplay, and the honest `paused` projections on
RunView/wave/story/MCP that let a driver actually see and act on a pause. Every citation below was
read and re-verified in this tree for v2 (a background verification pass covering every disputed
site, cross-checked directly against source a second time for the load-bearing ones); several v1
citations had drifted or were simply wrong — corrected inline, drift noted where material.

Code this contract is grounded in:

- the single-consumer reservation + authority-op pattern that `claim` must NOT ride —
  `_resolveRecord` (coordinator.mjs:8245-8482, corrected from v1's :8245-8479): `state:'pending'→
  'resolving'→'resolved'`, a `resolvingDone` promise gate for racing callers (:8248-8256, verified
  verbatim — a second caller awaits `record.resolvingDone`, re-reads `record.state`, and either
  returns `already_resolved` or retries), COMMIT-after-adapter-ack discipline (reserve at :8261,
  `record.state = 'resolving'`; only commit after the adapter affirms delivery; roll back to
  `pending` on throw/refusal at :8424-8430/:8432-8438, corrected from v1's :8424-8438). This is the
  interaction-record (question/approval) delivery path; §2.2(6)'s R35-4 finding is that `claim`
  needs its own reservation of this shape over the **pause record**, not a call into this method
  (interaction records and pause records are different single-consumer families with different
  authority ops — delivering an answer is not settling a turn);
- the two lanes a naive "just re-send" nudge implementation would wrongly reach for, and why
  neither fits: the bare prompt lane `_deliver` (coordinator.mjs:5950-6099, corrected from v1's
  `send()` :5960-6098 — the method is `_deliver`, mode-dispatched `'turn'|'steer'|'nudge'|'send'`)
  does fence pre/post-check via the non-advancing `_fences.issue(workerId)` stamp (:6034, mirrors
  fence.mjs:22-26's `issue()`, which returns `{fence, turnEpoch}` without bumping any counter) and
  adapter `.prompt()` delivery, and logs `control.nudge`/`control.steer`/`control.send`
  (~:6088-6098) but calls **no** `_resetWatchdogTurn`, no `_fences.bumpTurn`, no `_clearBudgetStop`
  — ever, regardless of mode string (verified: none of the three appear anywhere in :5950-6099);
  and `_deliverFollowUp` (coordinator.mjs:6217-6312, corrected from v1's :6217-6317), which DOES do
  the full bundle (`_admitProviderTurn` :6234 — the governance/reserve gate, defined
  coordinator.mjs:2506-2564, corrected from v1's :2506-2560 — `_fences.bumpTurn` :6277,
  `_clearBudgetStop` :6301, `_resetWatchdogTurn` :6303), is reachable only through
  `reusableFollowUp` (:5995-5998, corrected from v1's :5995-5999), gated on
  `TERMINAL_TASK_STATUSES.has(task.status)` (:5997) — a `paused` task is deliberately **not**
  terminal (docs/35 §2.1 rule 3), so this gate excludes it. Worse, on a `paused` task whose worker
  handle is `idle`, plain `_deliver(mode:'turn')` hits `handle.status === 'idle' &&
  !reusableFollowUp` → `worker_not_active` (:6000, exact) before it ever reaches the bundle.
  **Neither existing lane admits a fresh turn on a paused task** — `nudge` is a new admission path
  that mirrors most of `_deliverFollowUp`'s post-ack bundle, not a call into either lane. **One
  seam `_deliverFollowUp` itself is NOT a template for**, found independently in this revision:
  after its adapter-ack check (:6270-6275) and `bumpTurn` (:6277), `_deliverFollowUp` calls
  `_createCoordinationRefinement` (:6280, defined :6891-6919) — which **mints a brand-new task id**
  (`${prior.id}:refinement-${seq}`, `createTask`+`claimTask`, :6898-6908) and repoints
  `handle.taskId` to it (:6916). That is correct for `_deliverFollowUp`'s own case (an idle worker
  picking up genuinely new follow-up work with no existing task to resume), but wrong for `nudge`:
  the paused task already exists, is already the SAME task the driver wants resumed, and 31-a's
  `paused→working` TRANSITIONS edge (`31a-pause-records-decisions.md` Part C rule 1) is defined as
  a same-task unpark, not a task replacement. `nudge`'s "task/handle status to working" step
  (Part B rule 4 below) uses the `_coordTransition`-based same-task unpark pattern instead — see
  that rule for the exact citation;
- watchdog re-arm and the stall-guard's paused-parity anchor — `_armWatchdog`/`_resetWatchdogTurn`
  (coordinator.mjs:7401-7425): the fired-timer body's inner guard `task.status !== 'working'`
  (:7408, verified verbatim: `if (!task || task.status !== 'working' ||
  handle.watchdogActions?.has('stall')) return;`) is the exact gate docs/35 §2.2(7) names
  load-bearing — today it silently protects `blocked`/`input_required`/etc.; `paused` joins that
  protection by the same string comparison, not a special case. **Correction to v1's rule 10**: the
  `lifecycle.turn_completed` handler does not re-arm the watchdog on completion — it **clears** it
  (`this._clearWatchdog(handle)`, coordinator.mjs:9900, corrected from v1's mistaken "re-arms on
  turn_completed" and from the brief's approximate `:9899`). Re-arm happens only at the next fresh
  turn *admission* — every `_resetWatchdogTurn` call site is inside an admission path (e.g.
  `_deliverFollowUp` :6303, plus the other admission sites at :2874/:4736/:6200/:7818/:8050) — which
  is exactly why `nudge`'s own bundle (Part B rule 3) must call it explicitly: nothing else will;
- the scratch/board-claim invalidation mirror — `_expireScratchClaims`/`_expireBoardClaims`
  (coordinator.mjs:7045-7066, exact) and their call site on a provider-turn failure,
  `_failProviderResult` (:10190-10202, the two calls at :10200-10201, exact). This is the CAS-expiry
  pattern (`expireScratchClaim(claim.id, claim.version, ...)`) nudge's invalidation step mirrors
  for claims pinned to the pre-pause fence — **scratch claims only** (docs/35 §2.2(6) names scratch
  claims; see Part B rule 5 for why board claims are excluded, not merely "also expired"). The trap
  it must NOT step in: `claimScratch` (coordinator.mjs:9118-9133) is a worker-authored re-entry
  point gated on `['working', 'input_required'].includes(task.status)` (:9122) and an
  `expectedFence` CAS against the WORKER TURN fence (`this._fences.check(workerId, ...)`, :9124,
  `fence: check.current.fence` stored on the claim record at :9131) — calling it from the
  invalidation step would require a worker-shaped fence argument that doesn't exist for
  policy-driven expiry, and its task-status gate does not (yet, pre-31-a) include `paused` at all.
  Board claims are structurally different, not just gated differently: `requestBoardClaim`
  (coordinator.mjs:9195-9203, gate :9199) is annotated in-source (:9193-9194) "the claim CAS
  carries a BOARD-scoped fence (fields.expectedBoardFence), never the worker turn fence — the
  claimScratch trap (F9)", and the actual CAS check lives in `coordination-store.mjs:12720-12721`
  (`const currentFence = this.boardFence(item.board); if (fields.expectedBoardFence !==
  currentFence) return {ok:false, result:'stale_board_fence', ...}`) — a board's own fence, never
  the worker's turn fence that `nudge`'s `bumpTurn` advances. The same
  `['working', 'input_required']` gate also guards `postScratchFact` (:9135, gate :9139),
  `submitBoardReport` (:9205, gate :9209) — all four (`claimScratch`/`postScratchFact`/
  `requestBoardClaim`/`submitBoardReport`) are 31-a's audit surface (the `paused` addition), noted
  here only because nudge's invalidation step must use the CAS-expiry mirror, never any of these
  four;
- the honest `paused`-phase projection sites, all independently re-verified (docs/35's blanket
  "run-phase derivation" is actually three distinct ternaries plus one attention-array site, not
  one) — **and one upstream seam v1 never named, the real blocker for all three (P1-3 below)**:
  - `_historicalProfileView` (application.mjs:4964-5000+), the replay/no-live-run-instance phase
    ternary at **:4979-4985** (corrected end-line from v1's :4979-4986 — line 4986 is
    `const runStop = ...`, not part of the ternary), fallback `node?.taskId ? 'running' :
    'approved'` (exact, :4985); runStop precedence at :4986-4988;
  - `_buildWorkflowView`'s multi-candidate concurrence ternary (application.mjs:6262-6390-ish, the
    phase assignment at :6376-6382, exact — `anyDispatched ? 'running' : 'approved'` at :6382);
    runStop precedence at :6383-6384;
  - `_buildView`'s single-task live ternary (application.mjs:6632-6680-ish, the phase assignment at
    :6669-6676, exact — `else if (node.taskId) phase = 'running';` at :6675) — the common case a
    wave member's `entry.run.status()` resolves through; runStop precedence at :6677-6679;
  - **the seam**: all three ternaries read `node.state` (or `attempt.state`) off a `projection`
    returned by `this._goalPlanStatus(current, observer)` (application.mjs:3932-3937), which calls
    straight through to `this.driver.coordinator.goalPlanStatus(...)` → the coordination-store's
    own `goalPlanStatus(fields, auth)` (coordination-store.mjs:10593). Inside it, the per-node
    state derivation is **coordination-store.mjs:10630** (verified exact, the brief's approximate
    `:10629-10631` lands precisely on this one line): `if (dispatched) state =
    dispatched.task?.status === 'completed' && !dispatched.task.acceptanceRevocation ? 'accepted' :
    (['failed', 'cancelled'].includes(dispatched.task?.status) ? dispatched.task.status :
    'dispatched');` — **any live non-terminal task status that isn't `'completed'`/`'failed'`/
    `'cancelled'` falls through to the literal string `'dispatched'`**, never `'paused'`. This
    means all three `node?.state === 'paused'` branches this contract's rule 14 adds are dead code
    — `node.state` can never equal `'paused'` — until coordination-store.mjs:10630 gains a `paused`
    arm. **This edit is 31-a's, not 31-b's** (per the orchestrator's pinned shared decision): 31-a
    owns `TRANSITIONS`/plan-node projection extension for the `paused` status
    (`31a-pause-records-decisions.md` Part C, whose own Part-intro admits :10630's derivation "out
    of the read budget for this pass" — this contract supplies the missing citation). Rule 14 below
    states this as an explicit cross-contract dependency: **the rule-14 branches are correct and
    dormant on their own, and become live the moment 31-a's :10630 edit lands** — this contract's
    red tests for rule 14 run against the 31-a-landed tree (Part G);
  - the attention-array construction in `_buildView` (application.mjs:6753-6773, the
    `interruption_uncertain` push at :6766-6772, exact);
  - the semantic-action derivation, `_semanticActions` (application.mjs:8697-8722-ish): an
    `attention.kind` allowlist at :8707 (exact: `if (!['answer_approval', 'answer_question',
    'answer_decision'].includes(attention.kind)`) **ANDed on the same line-pair with
    `!validText(attention.requestId, 4_096)` at :8708** (verified exact — a negated-OR
    early-`continue` guard, so both conditions must pass for an attention entry to become a
    candidate). `validText` (application.mjs:214-216) is a generic non-empty/no-null-byte/
    ≤4096-byte string check, not a UUID/format check — so `turn_checkpoint` entries clear it as
    long as they carry *some* non-empty `requestId`-named string, not a specifically
    interaction-shaped id (Part F rule 13 gives the exact fix);
  - `wave.mjs`'s `attentionFrom`/`terminalFrom` (:74-88, `terminalFrom` at :74-76, `attentionFrom`
    at :78-88) and `progress()` (:159-179), which read `view.phase`/`view.attention` off the
    RunView verbatim — no independent phase vocabulary of its own, so `paused` and
    `turn_checkpoint` flow through for free once the RunView sites above are honest (and, per the
    seam above, once 31-a's coordination-store.mjs:10630 edit lands);
  - `story.mjs`'s **worker**-status fold maps (a different status axis from the task-status
    `paused` above) — **corrected from v1**: the transition map is named **`LEGAL_TRANSITIONS`**
    (story.mjs:221-234), not `TRANSITIONS` (:223-231 as v1 mistakenly said — that name does not
    exist in this file). `NEVER_STALLED_STATUSES` (:113), `STATUS_PHRASE` object (:590-597),
    `statusPhrase()` function (:610-625), `ACTIVE_STATUSES` (:662) — all confirmed. **Per the
    orchestrator's pinned shared decision, this contract no longer treats story.mjs as
    out-of-scope**: 31-a's `31a-pause-records-decisions.md` Part C rule 5 already specifies
    `TURN_PAUSED: 'turn.paused'` added to `KIND`, `LEGAL_TRANSITIONS[KIND.TURN_PAUSED] =
    {from:['working'], to:'paused'}`, a symmetric `TURN_SETTLED: 'turn.settled'` with
    `{from:['paused'], to:'working'}`, and `'paused'` added to `WorkerStatus`/
    `NEVER_STALLED_STATUSES`/`ACTIVE_STATUSES` — **31-a's fold-set fix wins outright; this
    contract's own prior claim that "the worker goes idle, nothing new in story.mjs" (v1 Part F
    rule 15) is REJECTED by the orchestrator and removed in v2** (rule 15 below). Verified as not
    yet landed (grepped story.mjs for `paused`/`TURN_PAUSED`: no hits), so this contract states the
    dependency rather than re-deriving it;
  - the coordination-store task-status `TRANSITIONS` map itself (:121-125, confirmed current —
    `pending→{working,cancelled}`, `working→{input_required,completed,failed,cancelled}`,
    `input_required→{working,failed,cancelled}`; `paused` is not yet in it, which is 31-a's to add)
    — cited here only for completeness; this contract does not touch it;
- a naming collision this contract surfaces (not in docs/35's R35-1..8 list, which only names the
  `wave.settle`/`settle` collision): the MCP surface already uses the bare string `'nudge'` for
  something narrower than the new steering act, and **in more places than v1 named**. Grepped the
  full literal `'nudge'` in mcp-northbound.mjs: `fleet_run_steer`'s `mode` enum at **:293**
  (`['nudge', 'now', 'turn']` — corrected from v1's implied `['turn','steer','nudge']`, which is
  actually `fleet_send`'s enum, a different tool/field entirely); `fleet_run_workstream_notify`'s
  `delivery` enum at **:298** (`['nudge', 'now', 'turn']`); **a fourth site v1 never cited**,
  `baton_workstream_notify`'s `delivery` enum at **:345** (`['nudge', 'now', 'turn']` — a distinct
  tool from `fleet_run_workstream_notify`, not a duplicate of :298); `fleet_send`'s `mode` enum at
  **:392** (`['turn', 'steer', 'nudge']`); and `fleet_send`'s own validation echo at **:689**
  (`!['turn', 'steer', 'nudge'].includes(args.mode)`). Every one of these `'nudge'`/`delivery:'nudge'`
  literals is wired to the bare prompt lane (`_deliver`, coordinator.mjs:5950-6099) and logs
  `control.nudge` (:6090, exact) with **none** of the full-turn-admission bundle. Wiring docs/35's
  new `nudge` steering act onto any of these four existing enum members or the `control.nudge`
  event kind would silently degrade it to the bare lane it is defined to NOT be (rule 2 below).
  Separately, `baton_run_act` (mcp-northbound.mjs:20,38, mapped to the `run.act` application
  command) is the **existing generic semantic-action executor** — every current semantic action
  (`approve_plan`, `answer_question`, etc., surfaced through `_semanticActions`) already routes
  through it via `actionAuthority`; this is the mechanism rule 16 below uses to resolve the
  rule-13/rule-16 routing question without adding any new tool or enum member.

## Part A — Reservation and authority-op discipline for all three acts (§2.2(6), R35-4)

1. **Each steering act reserves its OWN single-consumer slot on 31-a's `_pausedTurns` pause
   record — none of them ride `_resolveRecord`'s reservation, and none of them create a new map
   or a new key space.** Per the orchestrator's pinned shared decision, the key space is 31-a's:
   `_pausedTurns`, keyed `pause:${task.id}:${seq}` (`31a-pause-records-decisions.md` Part B rule 2,
   task-scoped, not worker-scoped — "a worker's task identity is what a nudge/wait/claim act
   targets"), **reused unmodified by this contract**. v1 proposed a separate reservation "map/field
   ... keyed by `(workerId, taskId, turnEpoch)`, not `requestId`" — that was a second, competing key
   space and is withdrawn. `_resolveRecord` (coordinator.mjs:8245-8482) reserves and commits
   against `this._pending` interaction records (question/approval); a pause record (31-a) is a
   different durable family living in a different map, but it is 31-a's map, not a new one this
   contract mints. 31-a's record shape is `{state: 'pending', resolution: null, consumer: null,
   worker, taskId, turnEpoch, changedPathsDigest, mintedEvent}` and 31-a exercises only
   `'pending'`→`'resolved'` directly (its one resolution path, degenerate auto-settle). This
   contract's three acts extend that same record's `state` vocabulary with a transient
   `'resolving'` value — mirroring `_resolveRecord`'s shape (:8248-8256) for a second racing
   caller — used by `nudge` and `claim` only (rule 2); this is an additive use of the existing
   field on the existing record, not a modification of the key space or a second map. A second
   `nudge` or `claim` call against an already-`resolving` or already-`resolved` pause record gets
   `already_resolved`/a queued wait on `resolvingDone`, exactly like a second `respond()` on the
   same interaction — never a silent double-admission. **`wait` never enters this state machine at
   all** — see rule 6 (Part C) for why, and for the P0-1 fix this correction makes possible.
2. **Each act carries its own authority op — no shared "resolve with a mode flag" entry point.**
   `nudge` mints a *fresh-turn admission* (rule 3); `wait` mints *nothing* (rule 6); `claim` runs
   the *trust gate* against a fresh live capture (rule 8). These are three distinct durable
   effects with three distinct receipt shapes, not three branches of one delivery function —
   collapsing them into one entry point (as `_resolveRecord` collapses question/approval/
   publication into one `kind`-switched body) would force `wait`'s zero-cost path through the
   same reservation-commit machinery `nudge`/`claim` need for their side effects, which is
   needless weight for the one act defined to cost nothing. Only `nudge` and `claim` touch
   `record.state`; `wait` (rule 6) does not, by design, not merely by omission.

## Part B — `nudge`: a full fresh-turn admission, not a resend (§2.2(6) bullet 1)

3. **`nudge` performs the full sequence a fresh admission requires — not just the three fence/
   budget/watchdog calls v1 named.** In order: (a) reserve the pause record (rule 1) — no fence or
   watchdog state is touched before this commits to `'resolving'`; (b) `_admitProviderTurn`
   (coordinator.mjs:2506-2564, the same governance/reserve gate `_deliverFollowUp` calls at
   :6234) mints the provider-turn admission and queues any synchronously-emitted adapter events
   (`handle.turnAdmission = admission`, mirroring :6253); (c) on adapter ack, `_fences.bumpTurn
   (workerId)` (mirroring :6277); (d) **task/handle status to `working`, using the
   `_coordTransition` same-task unpark pattern, NOT `_deliverFollowUp`'s
   `_createCoordinationRefinement`** (the grounding section above explains why: `_deliverFollowUp`
   mints a brand-new task id at :6280/:6891-6919, which is correct for an idle worker picking up
   new work but wrong for resuming an existing paused task). The unpark mirrors the
   `input_required` respond() pattern exactly: the durable transition
   `this._coordTransition(task, 'working', ..., evidence, actor)` (mirroring coordinator.mjs:
   8462-8467's `if (task && this._coordination?.task(task.id)?.status === 'paused')` guard, adapted
   from that site's literal `'input_required'` check), plus the explicit in-memory parity writes
   `handle.status = 'working'` and `task.status = 'working'` (mirroring `clearPending`'s
   `handle.status === 'blocked'` branch, coordinator.mjs:8377-8386, specifically :8381-8385 —
   adapted from `handle.status === 'blocked'` to whatever idle/blocked-equivalent value a paused
   worker's handle carries); (e) `_clearBudgetStop(handle)` (mirroring :6301); (f)
   `_resetWatchdogTurn(handle)` (mirroring :6303) — this is the step that actually re-arms the
   watchdog (per the grounding section's correction: `turn_completed` only clears it at :9900, it
   never re-arms; only a fresh admission does, and this is nudge's own admission); (g) invalidate
   pre-nudge scratch claims (rule 5) — **after** (d)'s admission commits, inside the same
   reservation rollback boundary as (a)-(d), not before; (h) append the durable admission event, a
   `turn_started`-shaped record carrying the resolved pause record's id (the `followUp:true`
   payload shape at :6304-6309 is the template, adapted to carry `pauseId` instead of
   `followUp:true`); (i) drain the queued adapter events (mirroring :6310). A `nudge` act
   implementation that dispatches through either existing lane (`_deliver`'s bare prompt mode, or a
   call into `_deliverFollowUp` itself) silently reverts to "resend with no re-arm" or "resend into
   a new task id" — both are defects this rule forecloses by naming the full sequence, not just
   nudge's three most-visible fence/budget/watchdog effects.
4. **`nudge` requires the pause record's own reservation (rule 1) before touching any fence,
   watchdog, or task-status state.** Step (b) in rule 3 (provider-turn admission) is the first
   effect with any external visibility; everything before it in rule 3's sequence is reservation
   bookkeeping only.
5. **Pre-nudge SCRATCH claims CAS'd on the OLD (pre-`bumpTurn`) fence expire honestly, via the
   `_expireScratchClaims` mirror (coordinator.mjs:7045-7053) — never via `claimScratch` (the trap,
   §2.2(6) bullet 1, coordinator.mjs:9118) — and BOARD claims are explicitly OUT of scope, not
   merely handled the same way.** docs/35 §2.2(6) names SCRATCH claims only. v1's rule 5 expired
   both scratch and board claims through the same mirror; that is doubly wrong: (1) board claims
   CAS against a board-scoped fence (`coordination-store.mjs:12720-12721`,
   `fields.expectedBoardFence` vs `this.boardFence(item.board)`), never the worker turn fence
   `nudge`'s `bumpTurn` advances — a fence-filtered expiry keyed off the turn fence would find zero
   board claims to filter by construction, so "expire board claims whose fence predates the pause"
   is not merely out of scope, it is a category error against a field that doesn't exist on a board
   claim; (2) even for scratch claims, unconditional expiry (today's `_failProviderResult` behavior
   at :10200-10201, used on provider *failure*) is wrong for `nudge`, which is a policy-driven
   continuation, not a failure — expiring a scratch claim CAS'd on the CURRENT (post-nudge) fence
   would kill a claim the new turn hasn't superseded. **Fix: scratch-only, fence-filtered expiry.**
   The correct call is the version-CAS `expireScratchClaim(claim.id, claim.version, ...)` pair
   (coordinator.mjs:7048-7051) — the same primitive `_failProviderResult` already calls at
   :10200-10201, but filtered here to only the claims whose stored `fence` (coordinator.mjs:9131,
   `fence: check.current.fence`) is strictly less than the fence `bumpTurn` just minted — invoked
   with `reason: 'turn_nudged'` (or equivalent, distinguishing it from `provider_turn_failed` in the
   Part G red test). **Ordering, corrected from v1**: this runs AFTER step (d)'s admission commits
   (rule 3), inside the SAME reservation rollback boundary as the rest of the bundle — not before
   the fence commits, as v1 said. Running expiry before admission risked a state where claims are
   expired but no turn was ever admitted (if admission then throws); running it after, inside the
   rollback boundary, means a throw anywhere in the bundle rolls the reservation back to `pending`
   with no claim ever expired, and a successful commit is the only path that expires anything. A
   claim CAS'd on the post-nudge fence survives regardless of ordering — it was never in the
   pre-nudge fence-filtered set.

## Part C — `wait`: the legal zero-cost park (§2.2(6) bullet 2, P0-1 fix)

6. **`wait` is a no-op with a receipt, and it NEVER consumes the pause record's reservation.**
   v1's rule 6 said wait "consumes" the record (implying `state → 'resolved'`) while also claiming
   later acts stay legal on that same record — those two claims are contradictory under rule 1's
   own "second call against an already-`resolved` record gets `already_resolved`" rule, and under
   either reading the task wedges permanently: once every legal driver response to a pause is
   `wait`, and `wait` resolves the record, no `nudge` or `claim` can ever mint against it again.
   **Fix: `wait` does not touch `record.state` at all.** It appends a durable receipt via
   `appendAttributed` (mirroring `turn.paused`'s own mint, `31a-pause-records-decisions.md` Part B
   rule 2) — `turn.wait_noted {pauseId, actor}` — and returns. The pause record's reservation
   (rule 1) stays exactly as `_admitPauseRecord` left it, `state: 'pending'`, untouched by `wait`.
   Because `wait` never sets `state: 'resolving'` or `'resolved'`, a subsequent `nudge`, `claim`, or
   even another `wait` against the SAME pause record proceeds through rule 1's reservation exactly
   as if no `wait` had ever been called — there is no wedge, because there is nothing for `wait` to
   have consumed. This is what makes `wait` "legal" per §2.2(6): the driver is explicitly allowed
   to look at a paused task and do nothing yet, receipted for audit, without that inaction blocking
   any later act on the same pause. The Part G red test proves this directly: wait → nudge
   succeeds; wait → claim succeeds; wait → wait is an idempotent receipt (each call appends its own
   `turn.wait_noted` entry; none of them touch `state`).

## Part D — `claim` (renamed from v1 `settle`): the trust gate against a fresh capture (§2.2(6) bullet 3, R35-8, P0-2 fix)

7. **`claim` is the renamed act — v1 called it `settle`, which collides with the pre-existing
   `wave.settle` (wave.mjs:254, `async function settle({ timeoutMs = 60_000 } = {})`, the
   member-outcome settlement the wave facade already exposes).** Two different "settle" verbs at
   two different layers (a per-turn trust-gate act vs. a whole-wave outcome collector) would be a
   standing confusion at every call site and in every log; the rename is total, not partial — no
   internal variable, event kind, or test name should retain `settle` for this act.
8. **`claim` RE-RUNS the live trust gate at claim time — it does NOT evaluate against the pause
   record's stored `changedPathsDigest`.** v1's rule 8 said the opposite ("runs the trust gate ...
   against the PAUSE's diff evidence — the `changedPathsDigest`"), which is mechanically
   impossible: the trust gate is `_runTrustGate(handle, workerResult)` (coordinator.mjs:10213), and
   its capture phase calls `await this._worktrees.capture(handle.worktree ?? task.worktree, {...})`
   (:10233) LIVE, against the current worktree — it needs the full live `capture()` result shape
   (`captured.sha`, `captured.changedPaths`, plus the base/branch/sparse-checkout identity fields
   passed into the call), not a precomputed digest string. `changedPathsDigest` doesn't even appear
   as an *input* anywhere in the gate: `canonicalDigest(changedPaths)` is computed at :10262 FROM
   the live capture's own output, as one field of the path-scope-violation evidence payload — it is
   an output artifact of a live run, never a substitute input for one. This matches docs/35 §3
   exactly: "capture/verification/effects move to claim time, unchanged in content" — `claim`
   re-runs the SAME `_runTrustGate` call every ordinary provider-turn completion already makes
   (:9937, `Promise.resolve(handle.worktreeReady).then(() => this._runTrustGate(handle, wr))`), at
   claim time instead of turn-completion time. **`changedPathsDigest` serves attention/
   classification only** (Part F rules 12-13: it rides the `turn_checkpoint` attention entry so a
   driver can see roughly what changed before deciding to `claim`) — it is never gate input. This
   and the worker's own done-signal (an ordinary `'claim'`-carded turn completion) are named in
   docs/35 §2.2(6) as the ONLY two paths to required-effect/verification evaluation; `nudge` and
   `wait` are explicitly NOT evaluation paths. `claim`'s reservation (rule 1) commits only after
   this live gate evaluation durably lands (task.status transitions to `'completed'` or `'failed'`
   at :10491, `task.status = accept ? 'completed' : 'failed';` — the gate's only two terminal
   outcomes, verified by reading its full control flow; there is no third "re-parked" outcome — see
   rule 9), mirroring `_resolveRecord`'s reserve-before-adapter-ack / commit-after-affirm discipline
   (:8259-8267, :8424-8438) even though the operation on the other side of the reservation is a
   gate evaluation rather than an adapter call. The Part G red test asserts the same verdict shape
   a claim-path completion produces on an equivalent tree — never a digest comparison.
9. **`claim` never touches the fence table or the watchdog, and it moves the task to a terminal
   outcome, not an undefined "re-parked" one.** v1's rule 9 said claim moves "toward a terminal or
   re-parked outcome" without defining "re-parked" — the brief flagged this as undefined; verified
   against `_runTrustGate`'s actual control flow, there is no re-park path: the gate's only two
   task-status writes are `'completed'` (:10491, accept) or `'failed'` (:10491, reject, or one of
   the earlier `trustPhase` throw sites such as `forbidden_effect`/`path_scope` around
   :10246-10268). **Fix: cut "re-parked"; `claim` always resolves to the gate's ordinary terminal
   verdict — `completed` or `failed` — the same two outcomes any `'claim'`-carded turn's automatic
   gate run produces.** Unlike `nudge`, `claim` does not admit a fresh turn — there is no new turn
   to bump into or re-arm a watchdog for; the task is moving to a terminal outcome via the gate's
   verdict. A `claim` implementation that calls `_fences.bumpTurn` or `_resetWatchdogTurn` has
   confused itself with `nudge`.

## Part E — Stall-watchdog interplay is parity by construction, not a special case (§2.2(7))

10. **The 120s stall watchdog CLEARS on `turn_completed` and re-arms only at the next fresh-turn
    admission — corrected from v1's "re-arms on `turn_completed`", which had it backwards.**
    `lifecycle.turn_completed`'s handler calls `this._clearWatchdog(handle)` unconditionally at
    coordinator.mjs:9900 (the first thing it does, before branching on outcome); nothing about
    `pausable` cards changes that. `_resetWatchdogTurn` — the re-arm — fires only from admission
    sites (`_deliverFollowUp` :6303, plus :2874/:4736/:6200/:7818/:8050), never from the
    turn-completed handler itself. This is exactly why `nudge`'s own bundle (Part B rule 3 step f)
    must call `_resetWatchdogTurn` explicitly: a paused task's watchdog was cleared at pause time
    and stays cleared until something re-arms it, and nothing does that automatically. **`paused`
    joins the existing inner guard `task.status !== 'working'` (:7408) by the same string
    comparison that already protects `blocked`/`input_required`/`stopping`/etc.** — this requires
    zero new code in the watchdog body; it requires only that 31-a's `paused` task status exist and
    that nothing sets a paused task's status back to `'working'` except an admitted `nudge`/`claim`
    outcome. The stall watchdog's fired-timer body reads `task.status` fresh at fire time (:7407),
    so a task that became `paused` after the timer was armed is still protected — there is no race
    window where a pause "misses" the guard because the guard re-checks status, not a snapshot from
    arm-time. (And because the watchdog was cleared, not re-armed, at pause time in the first
    place, there is in practice no live timer to fire against a paused task at all — the guard is a
    second line of defense for any timer that outlives the clear, not the primary protection.)
11. **This is exactly why docs/35 §2.2(7) names the guard "load-bearing in the contract" —
    it is a single boolean comparison an unrelated refactor could silently narrow** (e.g.
    replacing `!== 'working'` with an explicit allowlist that a future new task status forgets to
    join). A red test pins the current comparison form, not just its current behavior.

## Part F — `turn_checkpoint` attention classification and honest `paused` projections (§2.3)

12. **A `paused` task gets a new attention entry, classified `turn_checkpoint`, pushed exactly
    like the existing phase-driven (not story-driven) precedent** — the `interruption_uncertain`
    push in `_buildView` (application.mjs:6766-6772, exact: `if (phase === 'interruption_uncertain')
    { allAttention.push({...}) }`). The new entry is `{ kind: 'turn_checkpoint', workerId, taskId,
    turnEpoch, changedPathsDigest, requestId: pauseId }` — **the `requestId: pauseId` field is new
    in v2** (see rule 13 for why it is required, not optional) — the pause record's own fields plus
    its reservation id, pushed when the task backing this run's node is `paused`, alongside — never
    instead of — any genuinely pending `answer_question`/`answer_approval`/`answer_decision`
    entries the same worker might independently carry. **This entry is dead until 31-a's
    coordination-store.mjs:10630 edit lands** (grounding section) — `phase` cannot become `'paused'`
    before that, so this push's guard never fires on the current tree; the Part G red test for this
    rule runs against the 31-a-landed tree.
13. **`_semanticActions` (application.mjs:8697-8722) gains `turn_checkpoint` in its attention
    allowlist at :8707, and its companion guard at :8708 needs no code change if rule 12's entry
    shape is followed.** v1's rule 13 named `nudge_turn`/`wait_turn`/`claim_turn` candidates but
    missed that :8707's allowlist check is ANDed on the same line-pair with `!validText(
    attention.requestId, 4_096)` at :8708 — an attention entry with no `requestId`-named field (or
    an empty one) is skipped regardless of `kind`. `validText` (application.mjs:214-216) is a
    generic non-empty/no-null-byte/≤4096-byte check, not a format check, so the pause record's own
    id (`pause:${task.id}:${seq}`, well under 4096 bytes) clears it trivially. **Fix: the
    `turn_checkpoint` attention entry (rule 12) carries `requestId: pauseId`, satisfying :8708
    verbatim with zero branching** — no kind-conditional carve-out of the guard is needed once the
    entry shape includes the field the guard already checks. The three new semantic-action
    candidate kinds — `nudge_turn`, `wait_turn`, `claim_turn` — get a `target` shape carrying
    `workerId`, `taskId`, `turnEpoch`, and `pauseId` (mirroring the existing `target` construction
    at :8709-8718 for interaction attention, which builds its `target` from `attention.requestId`
    the same way). These are the ONLY semantic-action entry points to the three acts; there is no
    separate "raw" nudge/wait/claim control surface parallel to how `send`/`steer` already exist as
    raw controls alongside semantic actions (rule 16 resolves the one place this could look
    ambiguous). docs/35 §2.3 rule 11's "no prompt-level prohibitions" concern is orthogonal (it is
    about driver-objective phrasing, not about there being two control surfaces).
14. **All three live phase ternaries get an explicit `paused` branch, checked before the
    terminal-state branches so a paused task is never misreported as `running`/`work_completed`/
    `failed` — and this rule's branches are a dormant dependency on 31-a's coordination-store.mjs
    edit, not a standalone fix (P1-3):**
    - `_historicalProfileView` (application.mjs:4979-4985): insert `: node?.state === 'paused' ?
      'paused'` ahead of the `node?.taskId ? 'running'` fallback (:4985) — a paused node currently
      falls through to `'running'`, which is exactly the "disguised as working" docs/35 §2.1 rule 3
      forbids.
    - `_buildWorkflowView`'s concurrence ternary (application.mjs:6382): the `anyDispatched
      ? 'running'` fallback is where a paused attempt currently lands; it needs the same explicit
      branch, checked before `anyDispatched`.
    - `_buildView`'s single-task ternary (application.mjs:6675): `else if (node.taskId)
      phase = 'running';` is the fallback a paused task currently hits; the explicit `paused`
      branch goes immediately before it. This is the site that matters most in practice — it is
      what a wave member's `entry.run.status()` resolves through in the common (non-Workflow) case.
    **Cross-contract dependency, not a duplicate edit**: all three branches key off `node.state`
    (or `attempt.state`), which is populated exclusively by `coordination-store.mjs:10630`'s
    ternary (grounding section). That line currently has no `paused` arm and maps a `paused` task's
    live non-terminal status to the literal string `'dispatched'`, never `'paused'` — so
    `node?.state === 'paused'` can never be true until :10630 is edited to add a `paused` arm. Per
    the orchestrator's pinned decision, **that edit is 31-a's** (its Part C `TRANSITIONS`/
    projection-extension scope), not this contract's; this contract adds the consuming branches
    here so they are correct and ready the moment 31-a's edit lands, and states the dependency
    explicitly rather than re-deriving or duplicating 31-a's edit. All three sites already run
    their `runStop`-precedence checks (`stopped`/`stopping` override everything, :4986-4988,
    :6383-6384, :6677-6679) AFTER the base ternary — `paused` must stay subordinate to those,
    exactly like `running`/`work_completed`/etc. do today: a stopping run reports `stopping`, never
    `paused`, even if the task itself is mid-pause.
15. **`wave.mjs` needs one new branch; `story.mjs` needs 31-a's fold-set fix, not the "no change"
    v1 claimed — corrected per the orchestrator's pinned decision, which REJECTS v1's stance:**
    - `wave.mjs`'s `progress()` (:159-179) and `attentionFrom` (:78-88) read `view.phase`/
      `view.attention` verbatim off the RunView `entry.run.status()` returns; once `view.phase`
      can be `'paused'` (pending 31-a's :10630 edit, rule 14) and `view.attention` can carry a
      `turn_checkpoint` entry, `progress()`'s per-member snapshot (`{role, phase, terminal,
      attention}`, :168-174 in v1's numbering — re-verify exact lines at implementation time)
      surfaces both with no wave.mjs code change beyond the one addition here. **Per the
      orchestrator's pinned shared decision, this contract's `'paused'` → `'turn_checkpoint'`
      mapping in `attentionFrom` supersedes 31-a's own boundary statement** (31-a's
      `31a-pause-records-decisions.md` Part C rule 5 explicitly left `attentionFrom` unchanged,
      "this contract does **not** add a `'paused'` → attention-class mapping there... a plain pause
      under 31-a surfaces as `phase: 'paused'` with `attention: null`", deferring visible-only
      escalation to 31-c). This contract adds it anyway, earlier than 31-a scoped: `attentionFrom`
      (:78-88) gains `if (phase === 'paused') return 'turn_checkpoint';` alongside its existing
      `awaiting_plan_approval`/`selection_required`/`input_required` mappings (:84-86, exact), so a
      `paused` member with no explicit `attention` override still gets a sensible default
      classification the way the other blocked-shaped phases do — the orchestrator's basis for
      superseding 31-a's null pin is that a driver needs SOME signal to know a pause exists before
      31-c's escalation-bound work ships, and `turn_checkpoint` is that signal, not an escalation.
    - `story.mjs`: v1 claimed the worker handle "goes `idle` exactly as today" and needs no new
      value; **the orchestrator has REJECTED that stance**. 31-a's `31a-pause-records-decisions.md`
      Part C rule 5 already specifies the fold-set fix this contract now defers to: `TURN_PAUSED:
      'turn.paused'` added to `KIND` (mirroring `QUESTION_ASKED: 'question.asked'`),
      `LEGAL_TRANSITIONS[KIND.TURN_PAUSED] = {from: ['working'], to: 'paused'}`, a symmetric
      `TURN_SETTLED: 'turn.settled'` with `{from: ['paused'], to: 'working'}`, `WorkerStatus`
      (story.mjs:37) gaining `'paused'`, and `NEVER_STALLED_STATUSES` (:113)/`ACTIVE_STATUSES`
      (:662) both gaining `'paused'`. **This contract does not implement any of that — it is
      31-a's edit, cited here as a dependency, not duplicated.** What this contract DOES still own,
      unchanged from v1: `statusPhrase()` (story.mjs:610-625) has no verdict-based override text for
      a `'paused'` worker beyond whatever 31-a's `LEGAL_TRANSITIONS`/`applyEvent` fold produces by
      default — a reviewer expecting a specific "paused" phrase in `statusPhrase`'s output should
      look at 31-a's fold behavior first, and this contract adds no `statusPhrase` text of its own.
      (Correction to v1's own citation while here: the existing verdict-based `statusPhrase`
      override — `if (w.status === 'idle' && w.lastVerdict) return w.lastVerdict.accept ? 'done
      (verified)' : 'idle (verification failed)';` — is at story.mjs:**615-617**, not the brief's
      approximate `:617-620`; :619-622 is the unrelated `input_required` question-text branch.)
16. **MCP inherits both projections through the existing generic semantic-action executor, with
    zero new tool and zero new enum member — resolving the rule-13/rule-16 tension in v1 by
    picking semantic-action-only routing and saying why.** v1's rule 16 said `_semanticActions`'s
    new candidates need "no MCP tool schema edit" in one sentence, then said the new act "needs its
    own verb at the MCP layer (a new tool or a new enum member)" or a compatibility-breaking
    redefinition in the next — directly contradicting rule 13's "these are the ONLY semantic-action
    entry points... no separate raw control surface." **Fix: drop the "new verb" branch entirely.**
    `baton_run_act` (mcp-northbound.mjs:20,38, mapped to the `run.act` application command) is
    already the generic executor every current semantic action (`approve_plan`, `answer_question`,
    etc.) routes through via `actionAuthority` — `nudge_turn`/`wait_turn`/`claim_turn` (rule 13)
    are ordinary new entries in that same registry, invoked the same way, with no MCP schema
    change: `fleet_run_status` (mcp-northbound.mjs:286, "Read the fresh bounded authoritative
    RunView for one Run") returns `phase: 'paused'` and the `turn_checkpoint` attention entry with
    no `enum:` constraint on either field (verified: no `enum:` appears on any RunView-shaped
    output field in the file), and `baton_run_act` relays whatever `_semanticActions` offers with
    no enum of action kinds to extend. **What this rule explicitly forecloses, corrected and
    expanded from v1**: do NOT wire the new `nudge` semantic action to any of the FOUR existing
    `'nudge'`-carrying enum members found in this revision — `fleet_run_steer`'s `mode` enum
    (:293), `fleet_run_workstream_notify`'s `delivery` enum (:298), `baton_workstream_notify`'s
    `delivery` enum (:345, a distinct tool v1 never cited), or `fleet_send`'s `mode` enum (:392,
    validation echo :689) — every one of these means "bare prompt lane, tagged nudge"
    (`control.nudge`, coordinator.mjs:6090) and carries none of rule 3's bundle. Because the new
    act routes exclusively through `baton_run_act`/`_semanticActions` (rule 13), there is no
    "second raw control surface" to reconcile — the apparent rule-13/rule-16 conflict in v1 was an
    artifact of rule 16 half-considering a raw-verb path that this contract's single-entry-point
    design (rule 13) never needed. No redefinition of any existing `'nudge'` literal is required or
    authorized (Part H).

## Part G — red tests first (a new `impl/test/turn-checkpoints-31b-red.test.mjs`)

- **Reservation (Part A):** a second `nudge`/`claim` call against a pause record already
  `resolving` gets the same-shape wait-then-already-resolved outcome `_resolveRecord` gives a
  racing `respond()` (mirroring the :8248-8256 shape); a pause record's reservation lives on
  31-a's `_pausedTurns` map under 31-a's `pause:${task.id}:${seq}` key, proven by admitting a
  `_pending` interaction record and a `_pausedTurns` pause record for the same task/worker and
  showing neither reservation's `state` transition touches the other's.
- **`nudge` (Part B):** on a `paused` task, `nudge` bumps the fence, admits a fresh provider-turn
  (governance gate observed, `handle.turnAdmission` cleared post-drain), transitions the SAME
  task (not a new refinement task id — asserted by comparing `task.id` before and after) to
  `working` via the `_coordTransition` pattern, clears any pending budget-stop timer, and re-arms
  the watchdog (`watchdogGeneration` changes, `watchdogActions`/`recentFailedActions` reset) —
  asserted directly against handle/task state, not inferred from a log line; the bare `_deliver
  (mode:'nudge')` lane is proven NOT to do any of this on the same fixture (today's behavior,
  unchanged); `_deliverFollowUp`'s `reusableFollowUp` gate is proven to refuse a paused
  (non-terminal) task's idle worker (`worker_not_active`, the :6000 path), showing why `nudge`
  cannot be that call, AND `_deliverFollowUp` itself is proven to mint a new task id on a
  reusable-follow-up fixture (distinguishing it from `nudge`'s same-task unpark, the seam this
  revision found); every SCRATCH claim CAS'd on the pre-nudge fence is expired via the version-CAS
  path with `reason: 'turn_nudged'` distinguishing it from `provider_turn_failed`, a scratch claim
  CAS'd on the post-nudge fence survives, and a BOARD claim (any fence) is proven NOT expired by
  nudge's invalidation step at all (asserting the board-fence CAS mechanism is untouched).
- **`wait` (Part C):** `wait` leaves the fence, watchdog generation, budget-stop timer, and every
  scratch/board claim byte-identical to their pre-wait state; the pause record's `state` stays
  `'pending'` (not `'resolved'`) and a `turn.wait_noted {pauseId, actor}` receipt is appended;
  wait → nudge succeeds on the SAME pause record; wait → claim succeeds on the SAME pause record;
  wait → wait is idempotent (each call appends its own receipt, `state` still `'pending'`); a
  `nudge` issued against a DIFFERENT later pause on the same task after a `wait` still succeeds
  (waiting once does not poison the worker).
- **`claim` (Part D):** `claim` triggers a fresh `_runTrustGate`-equivalent run (a live
  `_worktrees.capture()` call observed, not a digest read) and produces the same verdict shape a
  worker's own done-signal produces on an equivalent tree/diff; `claim` does not bump the fence or
  touch watchdog generation (asserted directly, distinguishing it from `nudge`); `claim` resolves
  to exactly `'completed'` or `'failed'` (no third outcome asserted or possible); no code path or
  event kind named `settle` for this act survives a repo-wide grep, **rephrased per the brief's P2
  finding to be writable**: no code path or event kind COLLIDING WITH `wave.mjs`'s `settle`
  survives the grep — 31-a's `turn.settled`/any future `TURN_SETTLED` kind is a legitimate,
  differently-named survivor and is explicitly excluded from this assertion; `wave.settle`
  (wave.mjs:254) is unaffected by the new act's presence — a wave using `claim` on a paused member
  still resolves through `wave.settle`'s existing outcome collection with no name collision at
  either layer.
- **Stall-guard parity (Part E):** a task stall-watchdog fired while `paused` performs no action
  (the :7408 guard fires exactly as it does for `blocked`/`input_required` today, verified by
  reusing the SAME parametrized fixture across all four statuses, not a paused-only fixture that
  could pass by accident); the guard's source is asserted to still read `task.status !== 'working'`
  verbatim (a source-string pin, catching a future narrowing refactor per rule 11); separately, a
  fixture proves `lifecycle.turn_completed` CLEARS the watchdog (not re-arms it) for a `pausable`
  card exactly as it does for a `'claim'` card today (pinning the P2 rule-10 correction).
- **Projections (Part F, run against the 31-a-landed tree):** each of the three phase ternaries
  (application.mjs:4979-4985, :6376-6382, :6669-6676) reports `paused`, not `running`/
  `work_completed`/`failed`, for a task in that state, checked before AND after a `runStop` is
  admitted (proving the `stopped`/`stopping` precedence still wins over `paused`, rule 14's
  subordination clause); a companion fixture on the CURRENT (pre-31-a) tree proves the same task
  reports `'dispatched'`-derived `'running'` today, pinning the dependency rather than asserting
  around it; `_buildView`'s attention array carries a `turn_checkpoint` entry (with `requestId:
  pauseId` satisfying :8708) alongside — never instead of — a genuinely pending `answer_question`
  for the same worker; `_semanticActions` offers `nudge_turn`/`wait_turn`/`claim_turn` candidates
  with correct `target` shapes and refuses them once the pause resolves; `wave.mjs`'s `progress()`
  reports `phase:'paused', attention:'turn_checkpoint'` for a paused member with no wave.mjs source
  change beyond the one `attentionFrom` branch (rule 15); a live wave whose member pauses twice and
  completes via two `nudge`s and one `claim`, with zero driver-objective "never pause" phrasing
  present — the docs/35 §2.3 rule 11 acceptance criterion, restated here because it is the
  acceptance test for this contract's acts specifically, not just 31-a's state machine.
- **MCP (Part F rule 16):** `fleet_run_status` on a paused run returns `phase:'paused'` and the
  `turn_checkpoint` attention entry with no schema change; `baton_run_act` accepts and executes
  `nudge_turn`/`wait_turn`/`claim_turn` action kinds with no new tool/enum registration beyond the
  action registry entries themselves; all FOUR existing `mode:'nudge'`/`delivery:'nudge'` literals
  (`fleet_run_steer` :293, `fleet_run_workstream_notify` :298, `baton_workstream_notify` :345,
  `fleet_send` :392/:689) on a NON-paused, ordinary active task are proven unchanged (still the
  bare lane, still `control.nudge`) — the collision named in this contract's grounding section is
  a wiring hazard flagged for implementation, not a behavior this contract changes, so the red
  suite pins today's behavior on all four sites as a regression guard against someone "fixing" one
  of them by accident while wiring the new act.

Then the full suite `node impl/scripts/run-suite.mjs` green from the worktree root, and the
wave-driver reviewer contract stays green (see Part I).

## Part H — boundaries

- **No change to the trust gate's content.** `claim` and a worker's own done-signal are the only
  two evaluation paths (docs/35 §2.2(6) bullet 3); this contract does not alter what the gate
  checks — only that `claim` triggers the SAME gate fresh, against a live capture, exactly as an
  ordinary turn completion does.
- **No stall-watchdog redesign.** The silence-vs-progress classification named in docs/35 §2.2(9)
  as a separate, smaller follow-up is out of scope here; this contract's only watchdog changes are
  the zero-new-code parity in Part E and `nudge`'s own explicit re-arm call (Part B rule 3), which
  is required precisely because nothing else re-arms it.
- **No new task-status transitions beyond what 31-a already defines.** `TRANSITIONS`
  (coordination-store.mjs:121-125) and its `paused` extension are 31-a's surface; this contract
  assumes `paused`/`working` transitions exist there and does not re-derive its edges. The
  coordination-store.mjs:10630 plan-node projection edit (Part F rule 14) is likewise 31-a's, named
  here as a dependency, not implemented by this contract.
- **No worker-status (story.mjs) redesign beyond what 31-a already defines.** Rule 15 states the
  orchestrator's pinned decision: 31-a's `TURN_PAUSED`/`TURN_SETTLED`/fold-set fix is the answer,
  and this contract depends on it rather than re-deriving or duplicating it. This contract adds no
  story.mjs code itself.
- **No MCP schema edits required, and no redefinition of any of the four existing
  `mode:'nudge'`/`delivery:'nudge'` literals** (`fleet_run_steer` :293, `fleet_run_workstream_notify`
  :298, `baton_workstream_notify` :345, `fleet_send` :392/:689). The naming collision in this
  contract's grounding section is named so implementation avoids it, not resolved by a
  compatibility-breaking rename of literals four tools already depend on. The new act routes
  exclusively through the existing `baton_run_act`/`_semanticActions` path (Part F rule 16) — no
  new tool, no new enum member, on either side of the rule-13/rule-16 question v1 left open.
- **No prompt-level steering language.** Consistent with docs/35 §2.3 rule 11: the acceptance
  bar for this contract's red suite is a live wave completing via real `nudge`/`claim` acts with
  no "never pause" phrasing in any driver objective.
- **No change to `wave.settle`.** The rename in Part D removes a NAME collision at the act layer;
  it does not touch `wave.mjs`'s existing `settle({timeoutMs = 60_000} = {})` outcome-collection
  function (wave.mjs:254), which keeps its name and behavior exactly as today.

## Part I — validation

Focused red suite (`impl/test/turn-checkpoints-31b-red.test.mjs`, once authored) green; then the
full suite `node impl/scripts/run-suite.mjs` green from the worktree root; the wave-driver
reviewer contract, run and verified green in this tree before and during this v2 revision:

```
node --test impl/test/wave-driver-red.test.mjs
```

(10/10 passing, 0 failed, exit 0 — verified directly in this worktree as part of drafting v2, not
assumed.)

## v2 revisions

Finding → resolution, in the brief's order:

- **P0-1 (wait/wedge contradiction)** — Fixed. Part C rule 6 rewritten: `wait` never touches
  `record.state`; it appends a `turn.wait_noted` receipt only. Part A rule 1 corrected in lockstep
  (only `nudge`/`claim` use `state:'resolving'`/`'resolved'`). Part G's wait tests rewritten to
  prove wait→nudge, wait→claim, and wait→wait-is-idempotent on the same record.
- **P0-2 (claim vs. `changedPathsDigest`)** — Fixed. Part D rule 8 rewritten: `claim` re-runs the
  live `_runTrustGate`/`_worktrees.capture()` path (coordinator.mjs:10213/:10233); `changedPathsDigest`
  is attention/classification evidence only (Part F rules 12-13), never gate input. Part G's claim
  test rewritten to assert the verdict shape, not a digest comparison.
- **P1-3 (paused renders as `running`, the real site)** — Fixed. Grounding section and Part F rule
  14 now name coordination-store.mjs:10630 as the actual `node.state` derivation site, state it
  maps live non-terminal statuses to `'dispatched'` today, and name the fix as 31-a's cross-contract
  dependency rather than duplicating it. Part G's projection tests now run against the
  31-a-landed tree with a companion fixture pinning today's pre-31-a behavior.
- **P1-4 (nudge's bundle omits admission machinery)** — Fixed. Part B rule 3 rewritten to name the
  full sequence (reserve → `_admitProviderTurn` + event queue → adapter ack → `bumpTurn` →
  `_coordTransition`-based same-task unpark → `_clearBudgetStop`/`_resetWatchdogTurn` →
  `turn_started` append carrying `pauseId` → drain queue), and explicitly excludes
  `_deliverFollowUp`'s `_createCoordinationRefinement` (which mints a new task id — wrong for
  resuming an existing paused task, a seam this revision found independently). Part G's nudge test
  now asserts `handle/task.status === 'working'` on the SAME task id, and watchdog re-arm directly.
- **P1-5 (over-invalidation)** — Fixed. Part B rule 5 rewritten: scratch-only (board claims CAS on
  a board-scoped fence, coordination-store.mjs:12720-12721, never the turn fence — a category
  error to fence-filter), fence-filtered (only claims whose stored fence predates the new
  `bumpTurn` stamp), and reordered to run AFTER successful admission inside the same reservation
  rollback boundary, not before. Part G's nudge test now asserts board claims are untouched.
- **P2 — Rule 10 backwards** — Fixed. Part E rule 10 and the grounding section corrected: the
  `turn_completed` handler CLEARS the watchdog (coordinator.mjs:9900); re-arm happens only at
  fresh-turn admission, which is why `nudge` must call `_resetWatchdogTurn` itself.
- **P2 — story.mjs map name/line** — Fixed. Corrected to `LEGAL_TRANSITIONS` (:221-234) throughout,
  not `TRANSITIONS` (:223-231). The `:617-620` verdict-override citation corrected to :615-617.
- **P2 — Rule 13's `validText(attention.requestId)` guard** — Fixed. Part F rule 12's
  `turn_checkpoint` attention entry now carries `requestId: pauseId`, satisfying application.mjs
  :8708's guard verbatim with no code branch.
- **P2 — MCP nudge enums also at :298/:345** — Fixed. Grounding section and Part F rule 16 now
  name all four sites (`fleet_run_steer` :293, `fleet_run_workstream_notify` :298,
  `baton_workstream_notify` :345 — a fourth tool v1 never cited, `fleet_send` :392/:689).
- **P2 — unwritable "no settle survives grep"** — Fixed. Part G rephrased to "no code path or
  event kind COLLIDING WITH `wave.mjs`'s `settle`", explicitly excluding 31-a's legitimate
  `turn.settled`/`TURN_SETTLED`.
- **P2 — Rule 9's undefined "re-parked outcome"** — Fixed (cut, not defined). Part D rule 9
  corrected: verified `_runTrustGate` has exactly two terminal outcomes (`completed`/`failed`,
  coordinator.mjs:10491); "re-parked" removed.
- **P2 — Rule 16 vs. rule 13 routing conflict** — Fixed. Part F rule 16 rewritten to pick
  semantic-action-only routing exclusively, grounded in the existing `baton_run_act`/`run.act`
  generic executor (mcp-northbound.mjs:20,38) every other semantic action already uses — no new
  MCP tool, no new enum member, and the "new verb" branch v1 left dangling is removed.
- **SHARED DECISIONS (key space, story.mjs, attention, coordination-store.mjs:10630 owner)** —
  Applied. Part A rule 1 now reuses 31-a's `_pausedTurns`/`pause:${task.id}:${seq}` key space
  unmodified (v1's competing key space withdrawn). Part F rule 15 applies the orchestrator's
  supersession of 31-a's story.mjs "no change" stance (31-a's `TURN_PAUSED` fold-set fix wins) and
  its supersession of 31-a's `attentionFrom` null pin (31-b's `'paused'`→`'turn_checkpoint'`
  mapping stands). Part F rule 14/grounding section name coordination-store.mjs:10630 as 31-a's
  edit, consumed but not duplicated here.
- **Grounding citations the brief said to keep** — Re-verified unchanged except where corrected
  above: `_resolveRecord` reservation shape (end-line corrected :8482), bare-lane stamp semantics
  (fence.mjs:22-26, coordinator.mjs:6034, confirmed), :7408 verbatim (confirmed), expiry mirrors
  :7045-7066/:10200-10201 (confirmed), phase ternary sites (end-lines corrected on two of three),
  :8707 allowlist location (confirmed, with the :8708 companion guard now factored in).
