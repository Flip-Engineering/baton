# Waiting-on vocabulary — grounding memo (issue #10 blocked-state half)

Date: 2026-08-06. Scope: the blocked-state half of #10 — the system cannot distinguish
blocked/waiting/stalled from working. Receipts under ground: (a) #49 ceiling invisibility
(confirmed live at wave level; demo retry-2's 90s of silent deferrals), (b) #97 untyped
TypeError from message.send in the claim→session-ready window, (c) #50 glm 20-minute stream
death, (d) #55 stall-marker blindness to mid-turn provider activity (FIXED — see §1.4),
(e) awaiting_plan_approval invisible unless you call `actions()` (the worker AX feedback's
90-minute loss). Friction-ledger rows:
docs/reference/evidence/frontier-sweep-2026-08-03/orchestrator-friction-ledger.md:33
(#97), :35 (#49 + #10), :50 (the diagnostic-level row naming all four receipts).

Files with NUL bytes (coordinator.mjs, application.mjs, coordination-store.mjs) were read
via grep -an + sed -n only. Every citation below is verified against the working tree at
cfa4f3b + dirty receipt files.

---

## 1. THE STATE MODEL TODAY

Four partially-overlapping vocabularies exist. None has a name for "alive but not
progressing because of X".

### 1.1 Worker handle status (coordinator-internal)

Closed set: `pending | working | blocked | idle | stopping | interrupted | orphaned |
exited | dead`.

- `pending` minted at handle creation, impl/src/coordinator.mjs:4527 (task at :4489).
- `working` minted at dispatch (optimistic, before the adapter spawn resolves):
  impl/src/coordinator.mjs:3738-3739; also :2482, :5668, :7557, :7629.
- `blocked` minted ONLY by blocking worker interactions: question.asked
  impl/src/coordinator.mjs:12567, approval.requested :12613 (record deadlineAt
  :12600), decision.requested :12720-12723.
- `idle` :9320 (turn settled); `stopping` :5691/:7780/:7968; `interrupted` :5827;
  `orphaned` :5841; `exited` :3454/:3517/:3541; `dead` :1761/:1822/:1855/:7873.
- Public projection: `_publicHandle` impl/src/coordinator.mjs:6703, status field :6744
  (recoveryPending masked to `orphaned`).

There is NO `spawning` status and NO `queued`/`capacity` status. `pending` covers both
"never routed" and "routed, waiting on the harness ceiling" — and nothing projects either.

### 1.2 Task / plan-node states (coordination-store)

Task fold in goalPlanStatus: `pending` (task.created) → `working` (task.claimed) →
`input_required` / `paused` / terminal — impl/src/coordination-store.mjs:11284-11288.
Plan-node state vocabulary: **`blocked`** (default: undispatched, deps incomplete),
**`stale`**, **`ready`** (deps complete, undispatched), **`dispatched`** (ANY non-terminal
dispatched task — including a task sitting `pending` at the ceiling), **`paused`**,
**`accepted`**, **`failed`**, **`cancelled`** — impl/src/coordination-store.mjs:11290-11293.

Note the collision: node-level `blocked` already means "waiting on peer deps" (a peer_wait
projection that exists ONLY at node granularity) while handle-level `blocked` means
"waiting on a blocking interaction". Neither reaches the run phase.

### 1.3 Run phase (application views)

- Single-attempt ladder: impl/src/application.mjs:5694-5711 — `planning`,
  `awaiting_plan_approval`, `denied`, `work_completed`, `failed`, `cancelled`, `paused`,
  `running`, `approved`, then overridden by `stopped`/`stopping`/`interrupted`/
  `interruption_uncertain`.
- Workflow ladder: impl/src/application.mjs:7106-7124 — same set plus `completed`,
  `candidate_selected`, `selection_required`.
- Terminal set: impl/src/application.mjs:143-145 (`completed, failed, cancelled, denied,
  stopped`).
- Canonical alias map (§7.1): impl/src/application-semantics.mjs:57-67 —
  `awaiting_plan_approval→awaiting_approval`, `approved→queued`, `running→working`,
  `work_completed→result_ready`, `selection_required→awaiting_selection`, etc.

The decisive dishonesty: phase `running` mints the moment `node.taskId` exists
(impl/src/application.mjs:5703 single, :7429 workflow). `plan.node_dispatched` +
`task.created` mint ATOMICALLY at task admission (impl/src/coordination-store.mjs
createPlanGatedTask, :10718-10745 fold at :7708), BEFORE the coordinator's ceiling check.
So a ceiling-queued member projects `running` — the #49 sin verbatim.

### 1.4 Attention + progress projections

Run-view attention item kinds (impl/src/application.mjs): `answer_question` / 
`answer_approval` (:7156-7167, :7510-7519), `answer_decision` (projectDecisionAttention
:476-500), `candidate_selection` (:7169), `workflow_revision` (:7177), `workflow_recovery`
(:7181), `session_preservation` (:7185, :7564), `turn_checkpoint` (:7529-7543),
`scratchpad_write_failed` (:7555-7562).

Coordinator attention inbox (BD3-D, run.attention.watch): only TWO kinds mint —
`member_terminal` (impl/src/coordinator.mjs:7057-7087) and `candidacy_review` (:7042).
Every reason carries `seq` + `mintEpoch` (:7044, :7066) — the epoch-marked precedent.

Semantic progress: `projectProgressClass` impl/src/application.mjs:402-417 — closed
classes `terminal:<cause>` / `blocked_interaction:<approve_plan|select_candidate|
answer_required|turn_checkpoint>` / `silent` / `progressing` (enum pinned at
impl/src/application-semantics.mjs:49-54). `blockedInteraction` :372-382; `requiredAction`
:437-470. `runs.list` item shape: impl/src/application.mjs:11702-11720 (phase, timing,
progressClass, requiredAction, attention: 'required'|'clear', blockedInteraction). The
outline reduces attention to a COUNT + state (:10880-10884) — individual kinds are
invisible at outline depth.

Story compiler member states: impl/src/story.mjs:24-33 (canonicalMemberStatus:
`input_required→blocked`, `orphaned→stopped`, `exited→outcome`); WorkerStatus typedef
:54; LEGAL_TRANSITIONS :242-258; the narrative even renders
"blocked — waiting on: <question>" for input_required (:659-662) — but only for
questions.

#55 FIX (the one receipt already grounded): `_activityProjection`
impl/src/application.mjs:7934-7960 projects `{providerCalls, tokens, contentEvents,
lastActivityAt}` into the run view (:7058 member rows, :7763 run level), so mid-turn
provider activity moves the wave driver's stall marker; pinned by
impl/test/issue55-stall-liveness-red.test.mjs:189.

### 1.5 Receipt → projection mapping

| Receipt | Existing projection? |
|---|---|
| (a) #49 ceiling queue | NONE. `_dispatchPass` skips silently (impl/src/coordinator.mjs:2891); task `pending`, node `dispatched`, run phase `running`. |
| (b) #97 claim→session-ready | NONE honest. Phase `running` from task.claimed (:3473); the adapter session isn't live until the adapter-emitted lifecycle.spawned (impl/src/claude-session.mjs:1101) / turn_started (:894, :1109). message.send hits `this._adapters[handle.vendor].prompt` with vendor unresolved → untyped TypeError (impl/src/coordinator.mjs:6871), or a bare `{ok:false, notSent}` (impl/src/claude-session.mjs:1380). |
| (c) #50 glm stream death | PARTIAL, clock-only. No adapter error ever mints (the stream just stops); the member reads `working`/`progressing` until the stall watchdog (impl/src/coordinator.mjs:8665-8682) or the wave stall clock (impl/src/wave-driver.mjs:708-740) fires. `activity.lastActivityAt` goes stale but nothing names the state. |
| (d) #55 stall blindness | FIXED — §1.4 activity projection. |
| (e) awaiting_plan_approval | EXISTS but phase-only: the phase itself (impl/src/application.mjs:5694/:7106), `blockedInteraction: approve_plan` (:373), `requiredAction` (:440-443), progressClass `blocked_interaction:approve_plan` (:389-390). INVISIBLE to the wave driver: `reduceMember` (impl/src/wave-driver.mjs:200-214) has no class for it, so a plan-approval-waiting member renders as bare `working`; and the outline attention count (:10880) excludes it (it is phase-derived, never an attention item). |

---

## 2. THE WAIT POINTS

Every place a member/run is not-progressing-but-alive, with the mint (if any) at the
wait's start and the projection (if any) that exposes it.

### 2.1 Harness ceiling queue (spawn admission)

- Enforced at `_dispatchPass` impl/src/coordinator.mjs:2881-2894:
  `if (this._inFlightCount(vendor) >= card.concurrencyCeiling) continue;` (:2891) — the
  task simply stays `pending`. In-flight counts `working|stopping|blocked` (:3002-3007).
  The ceiling itself is adapter-card data: `concurrencyCeiling` impl/src/cli-adapters.mjs:233;
  defaults codex 4 (:484), claude 4 (:546), **glm-via-claude 1** (:613, "Z.ai Pro ≈ 1
  in-flight"), pi 4 (:634).
- Re-driven only by tick () and terminal transitions: :1440-1449, :3860, :9374, :13200.
- Wait-start event: NONE. No log line, no coordination event, no deferral receipt.
- Projection: NONE — worse than none, the run phase actively claims `running` (§1.3).

### 2.2 Spawn window (task-claim → session-ready) — #97

- `task.claimed` mints inside `_dispatch` impl/src/coordinator.mjs:3473-3481. The
  coordinator's own optimistic `lifecycle.spawned` (actor 'orchestrator') appends at
  :3666-3684 BEFORE the adapter spawn is even invoked (:3699-3715); the native spawn ack
  resolves asynchronously (:3717-3729, refusal → `_onSpawnRefused` :3818-3851, terminal
  phase:'spawn'); handle/task flip to `working` at :3737-3743.
- The TRUE session-ready marker is adapter-emitted: `lifecycle.spawned` carrying the wire
  session id (impl/src/claude-session.mjs:1097-1109) then `lifecycle.turn_started` (:894,
  :1109). Story folds SPAWNED→idle, TURN_STARTED→working (impl/src/story.mjs:243-244).
- Wait-start event: `task.claimed` exists but marks dispatch, not a wait.
- Projection: none distinguishing "spawn in flight" from "turn live" — both read
  `working`. `handle.nativeSpawnPending` (:3696) is internal-only.

### 2.3 Plan-approval wait

- Derived, not evented: `!projection?.approval → 'awaiting_plan_approval'`
  (impl/src/application.mjs:5694, :7106, :7420; store approval map
  impl/src/coordination-store.mjs:4766, :5293).
- Wait start: `plan.version_proposed` (implicit); exit: `plan.approval_decided`;
  TTL: approvalTtlMs → `plan_approval_expired` (impl/src/coordination-store.mjs:10707).
- Projection: phase + blockedInteraction + requiredAction (§1.5e) — present but
  phase-only; absent from the wave-driver reducer and the outline attention count.

### 2.4 Decision/answer waits (question / approval / decision)

- Wait start mints: `question.asked` (handle→blocked impl/src/coordinator.mjs:12567, task
  →input_required :12560-12569), `approval.requested` (:12600-12617), `decision.requested`
  (:12716-12723, one-pending-per-worker rule :12680-12696). Each carries
  `turnEpochAtAsk` and `deadlineAt`.
- Exit: `question.answered` / `approval.resolved` / `decision.settled` (:12726-12739, task
  back to `working`); deadline sweep auto-deny/expire (:2904-2909).
- Projection: FULL — the answer_* attention items; the one wait class already named.

### 2.5 Turn-checkpoint wait (pause / stall-clock pending)

- Mint: `turn.paused` impl/src/coordinator.mjs:2094-2099; pauseId `pause:<taskId>:<seq>`
  :2100; record carries `turnEpoch` + `mintedEvent` (:2102-2112); task →`paused` :2115.
  For an un-driven final, ONE bounded steering cycle arms (:2121-2134 `_armSteeringCycle`;
  expiry mints steering_expiry :2190).
- Projection: phase `paused` (impl/src/application.mjs:5702, :7117), `turn_checkpoint`
  attention (:7529-7543), `blocked_interaction:turn_checkpoint` (:396).
- Exit: nudge (turn_started), claim (claimTurn :2541; turn.settled :2580-2586), or
  steering expiry.

### 2.6 Provider-stream silence — #50

- Wait start: BY DEFINITION no event — the stream dies silently (glm/Z-Code is
  ClaudeSessionCli with a different endpoint, impl/src/cli-adapters.mjs:609-623; a dead
  socket yields no error frame, so no lifecycle.crashed, no turn_completed).
- Detectors, all clock-based, all downstream: the coordinator stall watchdog
  (`_armWatchdog` impl/src/coordinator.mjs:8665-8682 — fires `health.stall_suspected`
  :8674-8678 then stallAction interrupt/kill; WORKING-ONLY: :8667 refuses to arm unless
  status==='working', and `_touchWatchdog` only counts events with actor==='worker'
  :9078-9080); story's `stalled` signal (impl/src/story.mjs:537-546, working-only,
  NEVER_STALLED_STATUSES :133); the wave driver's stall clock
  (impl/src/wave-driver.mjs:570-573, :708-740); `activity.lastActivityAt`
  (impl/src/application.mjs:7934-7960) as the honest-zero read.
- Projection: none names the state; the member reads `working`/`progressing` until a
  clock kills it.

### 2.7 Lease waits (board / orchestrator / writer)

- Writer lease: process-local exclusivity (impl/src/coordination-store.mjs:1257-1372);
  contention REFUSES (`coordination_writer_busy`), never queues — not a member wait.
- Run-orchestrator (board) lease: minted `run.orchestrator_lease_issued`
  (impl/src/coordination-store.mjs:1897-1925), TTL-bounded (:1715-1718), revoked/expired
  states folded into `runOrchestrationView` (:11487-11510, recipientAuthority
  active/expired/revoked/inactive). Acquisition is synchronous
  (impl/src/coordinator.mjs:11114-11131) — a child run never pends on a lease; the
  wait-shaped risk is a lease EXPIRING mid-run (authority reads `inactive` afterwards).
- Projection: `runOrchestrationView` on the outline (impl/src/application.mjs:10866,
  :10898) — lease COUNTS, not a member-level waiting state. Candidate for `lease`
  waitingOn only if a run genuinely blocks on recipientAuthority.

### 2.8 Peer wait (plan-DAG deps)

- Exists ONLY at node level: `blocked`/`ready` (impl/src/coordination-store.mjs:11290-11293);
  the dep gate is `_dispatchPass` impl/src/coordinator.mjs:2888
  (`task.deps.some((d) => status !== 'completed') → continue`) — silent like the ceiling.
- Projection: node states in the workflow view; nothing at run phase.

---

## 3. THE VOCABULARY GAP — proposed closed `waitingOn` enum

Shape law (from #88 CP4, docs/reference/evidence/claim-preflight-2026-08-03/
claim-preflight-contract.md:219-228): the since-stamp is an EVENT EPOCH
(`{eventSeq, turnEpoch}` — durable event identity, replay-stable), never wall time.
Honest-null rule (the #49 sin): a member with `waitingOn != null` must NEVER serialize as
`working`/`progressing` to a driver; `waitingOn: null` means genuinely working. v1
projection surface: an additive `waitingOn: {kind, since:{eventSeq,turnEpoch}, detail}`
field on the run view + outline item + runs.list item — NOT a new run phase (a new phase
string moves every canonicalRunPhase/LEGACY_RUN_PHASE_MAP consumer; an additive field
moves none).

| kind | mint site (wait start) | projection surface | exit event | honest-null note |
|---|---|---|---|---|
| `spawning` | task.claimed, impl/src/coordinator.mjs:3473 (window closes at adapter lifecycle.spawned/turn_started, impl/src/claude-session.mjs:1101/:1109); live flag already exists: handle.nativeSpawnPending impl/src/coordinator.mjs:3696 | run-view waitingOn; member `working` → suppressed while set | adapter lifecycle.spawned, or lifecycle.crashed phase:'spawn' (impl/src/coordinator.mjs:3827-3851) | #97 fix pairs with this: sendMessage must refuse typed (`worker_spawning`) instead of TypeError at impl/src/coordinator.mjs:6871 |
| `capacity_ceiling` | the _dispatchPass skip, impl/src/coordinator.mjs:2891 — mint a durable deferral (taskId, vendor, ceiling, inFlight, task.created seq) | run-view waitingOn + node stays `dispatched`; runs.list item | task.claimed on a later pass (:2892, re-driven :3860/:9374/:13200) | kills #49: phase may stay `running` (dispatch truth) but waitingOn names the queue |
| `plan_approval` | already derived (impl/src/application.mjs:5694/:7106) — fold into waitingOn rather than a new mint | waitingOn + EXISTING blockedInteraction/requiredAction; ADD the class to reduceMember (impl/src/wave-driver.mjs:200-214) | plan.approval_decided; plan_approval_expired (impl/src/coordination-store.mjs:10707) | the 90-min loss was a driver-rendering gap, not a projection gap |
| `decision_pending` | already evented: decision.requested impl/src/coordinator.mjs:12716 (question/approval ride the same record family :12567/:12613) | existing answer_* attention items ARE this; waitingOn is the fold of the existing entries | decision.settled/question.answered/approval.resolved (:12726-12739); deadline sweep (:2904-2909) | v1 alias of existing attention; no new mint |
| `provider_stalled` | health.stall_suspected, impl/src/coordinator.mjs:8674 — the FIRST detector that fires; since = activity.lastActivityAt's backing event seq (impl/src/application.mjs:7934-7960) | waitingOn only while status==='working' AND last-activity stale; honest-null when blocked/paused (those have their own kinds) | any actor==='worker' event (the touch, :9078-9080), or stallAction terminal | #50: names the silence BEFORE the kill; the wave driver reads it instead of hashing for absence |
| `lease` | no member-level wait exists today (§2.7) — v2: recipientAuthority inactive mid-run (impl/src/coordination-store.mjs:11500-11505) | outline orchestration block already carries counts | lease re-issue / revocation event | cut from v1: no receipt burns here |
| `peer_wait` | node `blocked`/`ready` already folded (impl/src/coordination-store.mjs:11290-11293); the dep-gate skip impl/src/coordinator.mjs:2888 | node-level today; waitingOn only if single-attempt runs ever queue on deps | dep task.transitioned completed | cut from v1: no receipt burns here (wave members are independent runs) |

---

## 4. THE DIAGNOSTIC READ

Orchestrator poll consumption:

- Shape: `waitingOn: {kind, since: {eventSeq, turnEpoch}, detail}` — since-as-EPOCH per
  the campaign law (CP4: "the bound is a durable event identity, replay-stable, and immune
  to timer flakes"; the attention inbox's mintEpoch precedent
  impl/src/coordinator.mjs:7044). Wall clocks enter only through the ALREADY-SHIPPED
  timing block (`silenceMs`, `lastProgress.at` — impl/src/application.mjs:7955-7981).
- Poll path: `run.status` outline (waitingOn rides beside progressClass :10883), 
  `runs.list` item (:11702), `run.attention.watch` for the push variant (a new
  attention-inbox reason kind `member_waiting` beside member_terminal :7064 — coalesced
  per storm window exactly as :7075-7086).
- Wave-driver actions per kind (reduceMember extension, impl/src/wave-driver.mjs:200-214):
  - `capacity_ceiling` → WAIT. Never nudge (nothing to nudge — no session exists). Do not
    count against unproductiveNudgeBudget; do count toward the wave-level stall clock
    EXEMPTION (a ceiling-queued member is not stalled — its queue position is the honest
    state).
  - `spawning` → WAIT. Bounded by the spawn ack; escalate only on lifecycle.crashed
    phase:'spawn' (typed terminal, :3827-3851).
  - `plan_approval` → ESCALATE to the operator (approve_plan semantic action); the driver
    itself cannot resolve it.
  - `decision_pending` → STEER: the existing onDecision lane (impl/src/wave-driver.mjs:
    588-631) — unchanged.
  - `provider_stalled` → WAIT until the watchdog/stall clock, then ESCALATE (the existing
    stall basis :735-738); never nudge a member whose provider stream is dead (the nudge
    lands in a dead pipe and consumes the requestId dedup, :646).
  - `turn_checkpoint` (existing) → nudge/claim per L4/L6 — unchanged.

## 5. VERDICT — the minimal rung

**v1 lands four kinds: `capacity_ceiling`, `spawning`, `plan_approval`, `provider_stalled`
— the four that burned hours this week (#49, #97, the 90-min approval loss, #50).**
`decision_pending` is already projected (alias only, free to include); `lease` and
`peer_wait` have no burning receipts and stay out.

Insertion points:

1. `capacity_ceiling`: mint a durable deferral event at the skip
   (impl/src/coordinator.mjs:2891) + read `task.status==='pending' && dispatch exists` in
   the phase ladders (impl/src/application.mjs:5694-5711, :7106-7124, :7420-7433) →
   waitingOn. One store event kind, one view field.
2. `spawning`: project `handle.nativeSpawnPending === true` (impl/src/coordinator.mjs:3696)
   through _publicHandle (:6703) into the view; exit at adapter lifecycle.spawned. Pair
   with the #97 typed refusal in sendMessage (:6863-6872).
3. `plan_approval`: no new mint — add the class to reduceMember
   (impl/src/wave-driver.mjs:200-214) and the outline attention state
   (impl/src/application.mjs:10880-10884).
4. `provider_stalled`: surface health.stall_suspected (impl/src/coordinator.mjs:8674) into
   the run view with its event seq as since.

Suites whose rows must move:

- impl/test/issue10-blocked-interaction-red.test.mjs — the projectBlockedInteraction
  precedence table gains the waitingOn axis (blocked_interaction details stay pinned,
  impl/src/application-semantics.mjs:52-54).
- impl/test/issue10-p0-agent-experience.test.mjs — AX rows re-baseline for the new field.
- impl/test/wave-driver-red.test.mjs (and bidirectional-v3-red.test.mjs) — reduceMember
  class set grows; the 'working' fallback narrows.
- impl/test/issue55-stall-liveness-red.test.mjs — provider_stalled must not re-freeze the
  stall marker (the marker strips progressClass/requiredAction,
  impl/src/wave-driver.mjs:168-174; waitingOn must be STRIPPED the same way or every
  waiting member reads byte-static — the exact #55 trap re-opened).
- impl/test/capacity-refusal-visibility-red.test.mjs — the #35 precedent suite is the
  shape model (typed refusal → visible cause chain); its rows extend, not weaken.
- claim-preflight rows must NOT move (see below).

## 6. CROSS-REFERENCE: #88 claim-preflight liveness ledger (landed)

The preflight (impl/src/coordinator.mjs:2617-2680) counts a CLOSED set inside the pause
epoch (`turnEpoch === record.turnEpoch && seq <= record.mintedEvent`, :2645-2652):
scratchpad.write_result ok, context.read_result ok, content.tool_call, content.message,
resource.provider_call, question.answered, approval.resolved, decision.settled
(:2654-2665). Interaction with the wait states:

- A member WAITING on a pending interaction mints no counted events — pending interactions
  explicitly never count (:2637-2639 comment) — so `counted === 0 → {ok:true}` and the
  claim falls through to the full gate (CP10: the silent worker's path is untouched).
  **The preflight never misjudges a WAITING worker as premature.** Safe.
- The reverse edge: a member blocked-then-ANSWERED inside the same pause epoch mints
  counted resolutions (question.answered etc.) — if it then parks diffless, the claim
  refuses `claim_premature_liveness` (:2570-2572). That is the DESIGNED read; the
  waitingOn vocabulary must not re-label that member `decision_pending` (its decision is
  settled) — waitingOn derives from LIVE pending records, never from the liveness counts.
- Wave-driver coupling: the corrective nudge on claim_premature_liveness
  (impl/src/wave-driver.mjs:394-396) fires only when reduceMember did NOT suppress the
  member as blocked (:201-209). A waitingOn-class member must feed the SAME suppression —
  waitingOn non-null ⇒ excluded from nudge AND claim eligibility for all kinds except
  turn_checkpoint. One reducer, never two truths.
