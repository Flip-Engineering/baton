# 31-B decisions contract — steering acts, invalidation, attention classification (issue #31)

Ground truth: docs/35-turn-checkpoints.md v2 §2.2(6-8)/§2.3 (the binding, settled design — this
contract does not re-litigate the card-declaration default, `turn.paused` records, the `paused`
task state, `steering.registered`, or degenerate auto-settle; those are 31-a's scope,
`31a-pause-records-decisions.md`). This contract fixes shapes and code sites for 31-a's sibling
issue: the three steering acts a live driver takes on a paused task (nudge/wait/claim), the
invalidation nudge performs, the stall-watchdog interplay, and the honest `paused`
projections on RunView/wave/story/MCP that let a driver actually see and act on a pause. Every
citation below was read and verified in this tree; where a docs/35 v2 citation has drifted from
current line numbers (REPL-1/KG-1 landed after v2 was written), the current location is used and
the drift is noted.

Code this contract is grounded in:

- the single-consumer reservation + authority-op pattern that `claim` must NOT ride —
  `_resolveRecord` (coordinator.mjs:8245-8479): `state:'pending'→'resolving'→'resolved'`,
  a `resolvingDone` promise gate for racing callers (:8248-8256), COMMIT-after-adapter-ack
  discipline (reserve at :8261, only commit `record.consumer`/`record.resolution` after the
  adapter affirms delivery, roll back to `pending` on throw/refusal, :8424-8438). This is the
  interaction-record (question/approval) delivery path; §2.2(6)'s R35-4 finding is that `claim`
  needs its own reservation of this shape over the **pause record**, not a call into this method
  (interaction records and pause records are different single-consumer families with different
  authority ops — delivering an answer is not settling a turn);
- the two lanes a naive "just re-send" nudge implementation would wrongly reach for, and why
  neither fits: the bare prompt lane `send()` (coordinator.mjs:5960-6098, mode-dispatched
  `'turn'|'steer'|'nudge'|'send'`) does fence pre/post-check and adapter `.prompt()` delivery and
  logs `control.nudge`/`control.steer`/`control.send` (:6088-6098) but calls **no**
  `_resetWatchdogTurn`, no `_fences.bumpTurn`, no `_clearBudgetStop` — ever, regardless of mode
  string; and `_deliverFollowUp` (:6217-6317), which DOES do the full bundle
  (`_fences.bumpTurn` :6277, `_clearBudgetStop` :6301, `_resetWatchdogTurn` :6303), is reachable
  only through `reusableFollowUp` (:5995-5999), gated on
  `TERMINAL_TASK_STATUSES.has(task.status)` (:5997) — a `paused` task is deliberately **not**
  terminal (docs/35 §2.1 rule 3), so this gate excludes it. Worse, on a `paused` task whose worker
  handle is `idle`, plain `send(mode:'turn')` hits `handle.status === 'idle' && !reusableFollowUp`
  → `worker_not_active` (:6000) before it ever reaches the bundle. **Neither existing lane admits
  a fresh turn on a paused task** — `nudge` is a new admission path that mirrors
  `_deliverFollowUp`'s post-ack bundle, not a call into either lane;
- watchdog re-arm and the stall-guard's paused-parity anchor — `_armWatchdog`/`_resetWatchdogTurn`
  (coordinator.mjs:7401-7429): `_resetWatchdogTurn` clears `watchdogActions`/`recentFailedActions`/
  `scopeOrientation` and re-arms (:7420-7425); the fired-timer body's inner guard
  `task.status !== 'working'` (:7408) is the exact gate docs/35 §2.2(7) names load-bearing —
  today it silently protects `blocked`/`input_required`/etc.; `paused` joins that protection by
  the same string comparison, not a special case;
- the scratch/board-claim invalidation mirror — `_expireScratchClaims`/`_expireBoardClaims`
  (coordinator.mjs:7045-7066) and their call site on a provider-turn failure,
  `_failProviderResult` (:10190-10202, the two calls at :10200-10201). This is the CAS-expiry
  pattern (`expireScratchClaim(claim.id, claim.version, ...)`) nudge's invalidation step mirrors
  for claims pinned to the pre-pause fence. The trap it must NOT step in: `claimScratch`
  (coordinator.mjs:9118-9133) is a worker-authored re-entry point gated on
  `['working', 'input_required'].includes(task.status)` (:9122) and an `expectedFence` CAS
  (:9124) — calling it from the invalidation step would require a worker-shaped fence argument
  that doesn't exist for policy-driven expiry, and its task-status gate does not (yet, pre-31-a)
  include `paused` at all. The same `['working', 'input_required']` gate guards
  `postScratchFact` (:9139), `requestBoardClaim` (:9199), `submitBoardReport` (:9209) — all four
  are 31-a's audit surface (the `paused` addition), noted here only because nudge's invalidation
  step must use the CAS-expiry mirror, never any of these four;
- the honest `paused`-phase projection sites, all independently verified (docs/35's blanket
  "run-phase derivation" is actually three distinct ternaries plus one attention-array site, not
  one):
  - `_historicalProfileView` (application.mjs:4964-4994), the replay/no-live-run-instance phase
    ternary (:4979-4986);
  - `_buildWorkflowView`'s multi-candidate concurrence ternary (application.mjs:6262-6390,
    the phase assignment at :6376-6382);
  - `_buildView`'s single-task live ternary (application.mjs:6632-6679, the phase assignment at
    :6669-6676) — the common case a wave member's `entry.run.status()` resolves through;
  - `_buildView`'s attention-array construction (application.mjs:6753-6772), built from
    `story.workers[id].questionsPending`/`approvalsPending` plus `projectDecisionAttention`, with
    one precedent for a phase-driven (not story-driven) synthetic attention entry already in tree:
    the `interruption_uncertain` push at :6766-6772;
  - the semantic-action derivation, `_semanticActions` (application.mjs:8697-8720): an
    `attention.kind` allowlist (`['answer_approval', 'answer_question', 'answer_decision']`,
    :8707) that turns attention entries into actionable candidates with typed `target` shapes;
  - `wave.mjs`'s `attentionFrom`/`terminalFrom` (:74-88) and `progress()` (:159-179), which read
    `view.phase`/`view.attention` off the RunView verbatim — no independent phase vocabulary of
    its own, so `paused` and `turn_checkpoint` flow through for free once the RunView sites above
    are honest;
  - `story.mjs`'s **worker**-status fold maps (a different status axis from the task-status
    `paused` above): `TRANSITIONS` (:223-231, worker handle lifecycle:
    `idle→working→{blocked,input_required}→working→idle`), `NEVER_STALLED_STATUSES` (:113),
    `STATUS_PHRASE`/`statusPhrase` (:590-625), `ACTIVE_STATUSES` (:662-663). A `pausable` turn end
    is still a genuine `lifecycle.turn_completed` at the worker level
    (`[TURN_COMPLETED]: {from:['working'], to:'idle'}`, :224) — the worker handle goes `idle`,
    while the **task** goes `paused` (31-a). Story's worker-status maps need no new worker status
    for this contract; they are listed because a reviewer auditing "honest paused rendering"
    must not confuse the task-status axis (application/coordination-store) with the
    worker-status axis (story.mjs) — conflating them is the mistake this rule forecloses;
  - the coordination-store task-status `TRANSITIONS` map itself has moved:
    coordination-store.mjs:121-125 today (`pending→{working,cancelled}`,
    `working→{input_required,completed,failed,cancelled}`,
    `input_required→{working,failed,cancelled}`), not the `:115-120` docs/35 v2 cites — REPL-1's
    `_replManifestAdmissions`/REPL-2/KG-1 comment-and-field insertions (:100-117) pushed it down
    five lines. Cited here at its verified current location; the map itself is 31-a's to extend
    with `paused`, unchanged by this contract;
- a naming collision this contract surfaces (not in docs/35's R35-1..8 list, which only names the
  `wave.settle`/`settle` collision): the MCP surface already uses the bare string `'nudge'` for
  something narrower than the new steering act. `fleet_run_steer`'s `mode` enum
  (mcp-northbound.mjs:293) and `fleet_send`'s `mode` enum (:392) both include the literal
  `'nudge'`, and `fleet_send`'s own validation echoes it (:689,
  `!['turn', 'steer', 'nudge'].includes(args.mode)`). That `mode:'nudge'` is wired to the bare
  prompt lane (coordinator.mjs:5960-6098) and logs `control.nudge` (:6090) with **none** of the
  full-turn-admission bundle — it is today's lightweight "send a message tagged nudge" verb, not
  a pause-steering act. Wiring docs/35's new `nudge` steering act onto this existing mode string
  or its `control.nudge` event kind would silently degrade it to the bare lane it is defined
  to NOT be (rule 2 below). This is a wiring hazard to flag at implementation time, not a design
  change — docs/35's act is still named `nudge` per the settled design.

## Part A — Reservation and authority-op discipline for all three acts (§2.2(6), R35-4)

1. **Each steering act reserves its OWN single-consumer slot on the pause record — none of them
   ride `_resolveRecord`'s reservation.** `_resolveRecord` (coordinator.mjs:8245-8479) reserves
   and commits against `this._pending` interaction records (question/approval); a pause record
   (31-a) is a different durable family. A new pause-record reservation follows the same
   *shape* — `state: 'pending' → 'resolving' → 'resolved'`, a `resolvingDone` promise gate for a
   second caller racing the first (mirroring :8248-8256), commit only after the act's own durable
   append succeeds, rollback to `pending` on throw — but is its own map/field on the pause record,
   keyed by `(workerId, taskId, turnEpoch)` from `turn.paused`, not `requestId`. A second `nudge`,
   `wait`, or `claim` call against an already-`resolving` or already-`resolved` pause record gets
   `already_resolved`/a queued wait on `resolvingDone`, exactly like a second `respond()` on the
   same interaction — never a silent double-admission.
2. **Each act carries its own authority op — no shared "resolve with a mode flag" entry point.**
   `nudge` mints a *fresh-turn admission* (rule 3); `wait` mints *nothing* (rule 6); `claim` runs
   the *trust gate* against the pause's evidence (rule 8). These are three distinct durable
   effects with three distinct receipt shapes, not three branches of one delivery function —
   collapsing them into one entry point (as `_resolveRecord` collapses question/approval/
   publication into one `kind`-switched body) would force `wait`'s zero-cost path through the
   same reservation-commit machinery `nudge`/`claim` need for their side effects, which is
   needless weight for the one act defined to cost nothing.

## Part B — `nudge`: a full fresh-turn admission, not a resend (§2.2(6) bullet 1)

3. **`nudge` performs the exact bundle `_deliverFollowUp` performs after adapter ack** —
   `_fences.bumpTurn(workerId)` (mirroring :6277), `_clearBudgetStop(handle)` (mirroring :6301),
   `_resetWatchdogTurn(handle)` (mirroring :6303) — as a **new** admission path, not a call into
   `_deliverFollowUp` itself. `_deliverFollowUp` is reachable only via `reusableFollowUp`
   (:5995-5999), gated on `TERMINAL_TASK_STATUSES.has(task.status)`; a `paused` task is
   non-terminal by design (docs/35 §2.1 rule 3), so that gate is the wrong door. And the bare
   prompt lane `send()` (:5960-6098) — reachable via `mode:'nudge'` today — never calls any of the
   three bundle members regardless of mode string (verified: none of `_resetWatchdogTurn`,
   `_fences.bumpTurn`, `_clearBudgetStop` appear between :5960-6098). A `nudge` act implementation
   that dispatches through either existing lane silently reverts to "resend with no re-arm" — the
   exact defect docs/35 §1 describes ordinary pauses hitting today.
4. **`nudge` requires the pause record's own reservation (rule 1) before touching any fence or
   watchdog state**, and its durable admission event (a `turn_started`-shaped record, the
   `followUp:true` payload shape at :6304-6309 is the template) carries the resolved pause
   record's id so replay can associate the new turn with the pause it re-armed from.
5. **Pre-pause scratch/board claims CAS'd on the OLD fence expire honestly, via the
   `_expireScratchClaims`/`_expireBoardClaims` mirror (coordinator.mjs:10200-10201), never via
   `claimScratch`/`requestBoardClaim` (the trap, §2.2(6) bullet 1, coordinator.mjs:9118,
   :9195).** `claimScratch` is a worker-authored CAS re-entry (`expectedFence` check at :9124)
   gated on `task.status` (:9122); it is not a policy-driven expiry surface and calling it from
   the invalidation step would need a worker-shaped fence argument the invalidation step does not
   have. The correct call is the version-CAS `expireScratchClaim(claim.id, claim.version, ...)` /
   `expireBoardClaim(claim.itemId, claim.version, ...)` pair (coordinator.mjs:7048-7051,
   :7061-7064) — the exact calls `_failProviderResult` already makes on provider-turn failure
   (:10200-10201) — invoked with `reason: 'turn_nudged'` (or equivalent), listing every claim
   whose fence predates the new `bumpTurn` stamp. This runs BEFORE the bundle in rule 3 commits
   the new fence, so no claim survives holding a fence value the new turn has already superseded.

## Part C — `wait`: the legal zero-cost park (§2.2(6) bullet 2)

6. **`wait` is a no-op with a receipt, not a no-op with no trace.** It does not touch the fence
   table, the watchdog, budget state, or any scratch/board claim — the task and worker stay
   exactly as the pause left them. Its only effect is resolving the pause record's reservation
   (rule 1) with a result that carries no admission and no trust-gate evaluation, so a later
   `nudge` or `claim` on the SAME pause record is still legal (the record is consumed, but its
   consumption cost nothing to the run). This is what makes `wait` "legal" per §2.2(6): the
   driver is explicitly allowed to look at a paused task and do nothing yet, without that
   inaction being mistaken for either abandonment or acceptance.

## Part D — `claim` (renamed from v1 `settle`): the trust gate against pause evidence (§2.2(6) bullet 3, R35-8)

7. **`claim` is the renamed act — v1 called it `settle`, which collides with the pre-existing
   `wave.settle` (wave.mjs:254, `async function settle({ timeoutMs } = {})`, the member-outcome
   settlement the wave facade already exposes).** Two different "settle" verbs at two different
   layers (a per-turn trust-gate act vs. a whole-wave outcome collector) would be a standing
   confusion at every call site and in every log; the rename is total, not partial — no internal
   variable, event kind, or test name should retain `settle` for this act.
8. **`claim` runs the trust gate (capture/verification/effects, docs/35 §3 "unchanged in
   content") against the PAUSE's diff evidence — the `changedPathsDigest` on `turn.paused`
   (31-a) — not against a fresh delivery ack.** This and the worker's own done-signal
   (an ordinary `'claim'`-carded turn completion) are named in docs/35 §2.2(6) as the ONLY two
   paths to required-effect/verification evaluation; `nudge` and `wait` are explicitly NOT
   evaluation paths. `claim`'s reservation (rule 1) commits only after the trust gate's
   evaluation durably lands, mirroring `_resolveRecord`'s reserve-before-adapter-ack /
   commit-after-affirm discipline (:8259-8267, :8424-8438) even though the operation on the other
   side of the reservation is a gate evaluation rather than an adapter call.
9. **`claim` never touches the fence table or the watchdog.** Unlike `nudge`, `claim` does not
   admit a fresh turn — there is no new turn to bump into or re-arm a watchdog for; the task is
   moving toward a terminal or re-parked outcome via the gate's verdict, not toward more work on
   the same paused turn. A `claim` implementation that calls `_fences.bumpTurn` or
   `_resetWatchdogTurn` has confused itself with `nudge`.

## Part E — Stall-watchdog interplay is parity by construction, not a special case (§2.2(7))

10. **The 120s stall watchdog keeps re-arming on `turn_completed` exactly as today** — nothing
    about `pausable` cards changes `_armWatchdog`/`_resetWatchdogTurn` (coordinator.mjs:7401-7429)
    or when they fire. **`paused` joins the existing inner guard
    `task.status !== 'working'` (:7408) by the same string comparison that already protects
    `blocked`/`input_required`/`stopping`/etc.** — this requires zero new code in the watchdog
    body; it requires only that 31-a's `paused` task status exist and that nothing sets a paused
    task's status back to `'working'` except an admitted `nudge`/`claim` outcome. The stall
    watchdog's fired-timer body reads `task.status` fresh at fire time (:7407), so a task that
    became `paused` after the timer was armed is still protected — there is no race window where
    a pause "misses" the guard because the guard re-checks status, not a snapshot from arm-time.
11. **This is exactly why docs/35 §2.2(7) names the guard "load-bearing in the contract" —
    it is a single boolean comparison an unrelated refactor could silently narrow** (e.g.
    replacing `!== 'working'` with an explicit allowlist that a future new task status forgets to
    join). A red test pins the current comparison form, not just its current behavior.

## Part F — `turn_checkpoint` attention classification and honest `paused` projections (§2.3)

12. **A `paused` task gets a new attention entry, classified `turn_checkpoint`, pushed exactly
    like the existing phase-driven (not story-driven) precedent** — the `interruption_uncertain`
    push in `_buildView` (application.mjs:6766-6772: `if (phase === 'interruption_uncertain') {
    allAttention.push({...}) }`). The new entry is `{ kind: 'turn_checkpoint', workerId, taskId,
    turnEpoch, changedPathsDigest }` (the pause record's own fields, application.mjs:6753-6772 is
    the site), pushed when the task backing this run's node is `paused`, alongside — never
    instead of — any genuinely pending `answer_question`/`answer_approval`/`answer_decision`
    entries the same worker might independently carry.
13. **`_semanticActions` (application.mjs:8697-8720) gains `turn_checkpoint` in its attention
    allowlist** (the `['answer_approval', 'answer_question', 'answer_decision']` filter at
    :8707) and three new semantic-action candidate kinds — `nudge_turn`, `wait_turn`, `claim_turn`
    (or equivalently-named, matching the acts) — with a `target` shape carrying `workerId`,
    `taskId`, `turnEpoch` (mirroring the existing `target` construction at :8709-8718 for
    interaction attention). These are the ONLY semantic-action entry points to the three acts;
    there is no separate "raw" nudge/wait/claim control surface parallel to how `send`/`steer`
    already exist as raw controls alongside semantic actions — docs/35 §2.3 rule 11's "no
    prompt-level prohibitions" concern is orthogonal (it is about driver-objective phrasing, not
    about there being two control surfaces).
14. **All three live phase ternaries get an explicit `paused` branch, checked before the
    terminal-state branches so a paused task is never misreported as `running`/`work_completed`/
    `failed`:**
    - `_historicalProfileView` (application.mjs:4979-4986): insert `: node?.state === 'paused' ?
      'paused'` (or however 31-a represents pause on the node projection) ahead of the
      `node?.taskId ? 'running'` fallback — a paused node currently falls through to `'running'`,
      which is exactly the "disguised as working" docs/35 §2.1 rule 3 forbids.
    - `_buildWorkflowView`'s concurrence ternary (application.mjs:6376-6382): the `anyDispatched
      ? 'running'` fallback (:6382) is where a paused attempt currently lands; it needs the same
      explicit branch, checked before `anyDispatched`.
    - `_buildView`'s single-task ternary (application.mjs:6669-6676): `else if (node.taskId)
      phase = 'running'` (:6675) is the fallback a paused task currently hits; the explicit
      `paused` branch goes immediately before it. This is the site that matters most in practice
      — it is what a wave member's `entry.run.status()` resolves through in the common
      (non-Workflow) case.
    All three sites already run their `runStop`-precedence checks (`stopped`/`stopping` override
    everything, :4987-4988, :6383-6384, :6678-6679) AFTER the base ternary — `paused` must stay
    subordinate to those, exactly like `running`/`work_completed`/etc. do today: a stopping run
    reports `stopping`, never `paused`, even if the task itself is mid-pause.
15. **`wave.mjs` and `story.mjs` need no new vocabulary of their own — they inherit honesty for
    free once rule 14 lands, with one caveat each:**
    - `wave.mjs`'s `progress()` (:159-179) and `attentionFrom` (:78-88) read `view.phase`/
      `view.attention` verbatim off the RunView `entry.run.status()` returns; once `view.phase`
      can be `'paused'` and `view.attention` can carry a `turn_checkpoint` entry, `progress()`'s
      per-member snapshot (`{role, phase, terminal, attention}`, :168-174) surfaces both with no
      wave.mjs code change. The one addition: `attentionFrom` (:78-88) gains
      `if (phase === 'paused') return 'turn_checkpoint';` alongside its existing
      `awaiting_plan_approval`/`selection_required`/`input_required` mappings (:84-86), so a
      `paused` member with an explicit `attention: null`/`'clear'` override still gets a sensible
      default classification the way the other blocked-shaped phases do.
    - `story.mjs`'s worker-status fold maps (`TRANSITIONS` :223-231, `NEVER_STALLED_STATUSES`
      :113, `STATUS_PHRASE`/`statusPhrase` :590-625, `ACTIVE_STATUSES` :662-663) track the
      **worker handle** status axis, which does not gain a new value here — a `pausable` turn end
      is still an ordinary `lifecycle.turn_completed` at the worker level
      (`[TURN_COMPLETED]: {from:['working'], to:'idle'}`, :224), so the worker goes `idle` exactly
      as today. `paused` lives on the **task**, in application.mjs's projections and (31-a's)
      coordination-store TRANSITIONS — not in story.mjs. The caveat: `statusPhrase` (:610-625)
      narrates a worker as plain `'idle'` with no verdict-based override for a paused-but-idle
      worker; a reviewer expecting story.mjs prose to say "paused" will not find it there — that
      honesty lives in the RunView phase (rule 14) and wave attention (this rule), which is where
      docs/35 §2.1 rule 3 places it ("story.mjs fold maps... get an honest paused rendering" reads
      correctly as "the maps that ARE task/attention-shaped," not the worker-status maps, once the
      two axes are told apart).
16. **MCP inherits both projections with zero new code, and zero new schema risk.**
    `mcp-northbound.mjs` has no independent phase or attention vocabulary of its own —
    `fleet_run_status`'s description is literally "Read the fresh bounded authoritative RunView
    for one Run" (mcp-northbound.mjs:286) with no enum constraining `phase` or `attention[].kind`
    in its output shape (verified: no `enum:` appears on any RunView-shaped output field in the
    file). Once rules 14/13 land, `fleet_run_status` returns `phase: 'paused'` and a
    `turn_checkpoint` attention entry, and `_semanticActions`'s new candidates surface through
    whatever tool already relays `nextActions`/semantic candidates — no MCP tool schema edit is
    required for this. The one thing to get right at implementation time, not schema time: do
    NOT wire the new `nudge` semantic action to `fleet_send`/`fleet_run_steer`'s existing
    `mode:'nudge'` (mcp-northbound.mjs:293, :392) — that string already means "bare prompt lane,
    tagged nudge" (`control.nudge`, coordinator.mjs:6090) and carries none of rule 3's bundle. The
    new act needs its own verb at the MCP layer (a new tool or a new enum member distinct from the
    existing `mode`/`delivery` `'nudge'` literal), or `fleet_send`'s existing `'nudge'` mode must
    be redefined out from under every current caller — the latter is a compatibility break this
    contract does not authorize.

## Part G — red tests first (a new `impl/test/turn-checkpoints-31b-red.test.mjs`)

- **Reservation (Part A):** a second `nudge`/`wait`/`claim` call against a pause record already
  `resolving` gets the same-shape wait-then-already-resolved outcome `_resolveRecord` gives a
  racing `respond()` (mirroring the :8248-8256 shape); a pause record's reservation is a field
  distinct from `this._pending`, proven by admitting an interaction record and a pause record
  with the same `requestId`-shaped id space and showing neither reservation touches the other's
  state.
- **`nudge` (Part B):** on a `paused` task, `nudge` bumps the fence, clears any pending budget-stop
  timer, and re-arms the watchdog (`watchdogGeneration` changes, `watchdogActions`/
  `recentFailedActions` reset) — asserted directly against handle state, not inferred from a log
  line; the bare `send(mode:'nudge')` lane is proven NOT to do any of this on the same fixture
  (today's behavior, unchanged); `_deliverFollowUp`'s `reusableFollowUp` gate is proven to refuse
  a paused (non-terminal) task's idle worker (`worker_not_active`, the :6000 path), showing why
  `nudge` cannot be that call; every scratch/board claim CAS'd on the pre-nudge fence is expired
  via the version-CAS path with `reason` distinguishing it from `provider_turn_failed`, and a
  claim CAS'd on the post-nudge fence survives.
- **`wait` (Part C):** `wait` leaves the fence, watchdog generation, budget-stop timer, and every
  scratch/board claim byte-identical to their pre-wait state; the pause record transitions to
  resolved with no admission/no gate-evaluation receipt; a `nudge` issued against a DIFFERENT
  later pause on the same task after a `wait` still succeeds (waiting once does not poison the
  worker).
- **`claim` (Part D):** `claim` runs the trust gate against the pause's `changedPathsDigest`
  evidence and produces the same verdict shape a worker's own done-signal produces on
  equivalent diffs; `claim` does not bump the fence or touch watchdog generation (asserted
  directly, distinguishing it from `nudge`); no code path or event kind named `settle` for this
  act survives a repo-wide grep (the rename is total); `wave.settle` (wave.mjs:254) is unaffected
  by the new act's presence — a wave using `claim` on a paused member still resolves through
  `wave.settle`'s existing outcome collection with no name collision at either layer.
- **Stall-guard parity (Part E):** a task stall-watchdog fired while `paused` performs no action
  (the :7408 guard fires exactly as it does for `blocked`/`input_required` today, verified by
  reusing the SAME parametrized fixture across all four statuses, not a paused-only fixture that
  could pass by accident); the guard's source is asserted to still read `task.status !== 'working'`
  verbatim (a source-string pin, catching a future narrowing refactor per rule 11).
- **Projections (Part F):** each of the three phase ternaries (application.mjs:4979-4986,
  :6376-6382, :6669-6676) reports `paused`, not `running`/`work_completed`/`failed`, for a task in
  that state, checked before AND after a `runStop` is admitted (proving the `stopped`/`stopping`
  precedence still wins over `paused`, rule 14's subordination clause); `_buildView`'s attention
  array carries a `turn_checkpoint` entry alongside — never instead of — a genuinely pending
  `answer_question` for the same worker; `_semanticActions` offers `nudge_turn`/`wait_turn`/
  `claim_turn` candidates with correct `target` shapes and refuses them once the pause resolves;
  `wave.mjs`'s `progress()` reports `phase:'paused', attention:'turn_checkpoint'` for a paused
  member with no wave.mjs source change beyond the one `attentionFrom` branch (rule 15); a live
  wave whose member pauses twice and completes via two `nudge`s and one `claim`, with zero
  driver-objective "never pause" phrasing present — the docs/35 §2.3 rule 11 acceptance criterion,
  restated here because it is the acceptance test for this contract's acts specifically, not just
  31-a's state machine.
- **MCP (Part F rule 16):** `fleet_run_status` on a paused run returns `phase:'paused'` and the
  `turn_checkpoint` attention entry with no schema change; `fleet_send`/`fleet_run_steer`'s
  existing `mode:'nudge'`/`delivery:'nudge'` on a NON-paused, ordinary active task is proven
  unchanged (still the bare lane, still `control.nudge`) — the collision named in this contract's
  grounding section is a wiring hazard flagged for implementation, not a behavior this contract
  changes, so the red suite pins today's `mode:'nudge'` behavior as a regression guard against
  someone "fixing" it by accident while wiring the new act.

Then the full suite `node impl/scripts/run-suite.mjs` green from the worktree root, and the
wave-driver reviewer contract stays green (see Part I).

## Part H — boundaries

- **No change to the trust gate's content.** `claim` and a worker's own done-signal are the only
  two evaluation paths (docs/35 §2.2(6) bullet 3); this contract does not alter what the gate
  checks, only what evidence it runs against on a `claim`.
- **No stall-watchdog redesign.** The silence-vs-progress classification named in docs/35 §2.2(9)
  as a separate, smaller follow-up is out of scope here; this contract's only watchdog change is
  the zero-new-code parity in Part E.
- **No new task-status transitions.** `TRANSITIONS` (coordination-store.mjs:121-125) is 31-a's
  surface; this contract assumes `paused` exists there and does not re-derive its edges.
- **No worker-status (story.mjs) redesign.** Rule 15's caveat stands: `paused` is a task-status
  and RunView/attention concept, not a new worker handle status. Nothing in story.mjs's
  `TRANSITIONS`/`STATUS_PHRASE`/`ACTIVE_STATUSES` gains a new value.
- **No MCP schema edits required, and no redefinition of the existing `mode:'nudge'`/
  `delivery:'nudge'` literal.** The naming collision in this contract's grounding section is
  named so implementation avoids it, not resolved by a compatibility-breaking rename of a
  literal three tools already depend on.
- **No prompt-level steering language.** Consistent with docs/35 §2.3 rule 11: the acceptance
  bar for this contract's red suite is a live wave completing via real `nudge`/`claim` acts with
  no "never pause" phrasing in any driver objective.
- **No change to `wave.settle`.** The rename in Part D removes a NAME collision at the act layer;
  it does not touch `wave.mjs`'s existing `settle({timeoutMs})` outcome-collection function
  (wave.mjs:254), which keeps its name and behavior exactly as today.

## Part I — validation

Focused red suite (`impl/test/turn-checkpoints-31b-red.test.mjs`, once authored) green; then the
full suite `node impl/scripts/run-suite.mjs` green from the worktree root; the wave-driver
reviewer contract, run and verified green in this tree before this contract was written:

```
node --test impl/test/wave-driver-red.test.mjs
```

(10/10 passing, 0 failed, exit 0 — verified directly, not assumed, as part of drafting this
contract.)
