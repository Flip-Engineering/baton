# Waiting-on vocabulary — implementation contract (issue #10 blocked-state half)

Date: 2026-08-06. Status: contract for implementation, ring-2 form (ground truths → decisions →
refusal vocabulary → acceptance pins → open questions). Primary input: the grounding memo in this
directory (`grounding.md`), fully cited there; this contract re-verified every anchor against the
CURRENT tree at `0ad4d4a` + dirty receipt files (post-#87/#88/#89 landings — `f4a64da`, `f33c24e`,
and the #88 preflight). Drifted anchors are corrected in §10's ledger; nothing the memo concluded
changed substance.

Receipts under contract: #49 (ceiling invisibility — dispatched task sat `pending` 30+ min while
the wave reported `working`), #97 (untyped TypeError from `run.message.send` in the
claim→session-ready window), #50 (glm stream death, silent until a clock fired), the worker-AX
90-minute plan-approval loss (memo §1.5e), #55 (FIXED — the stall-marker/activity-projection
machinery this contract must not re-break). Issue #10's AX spine carries the
`blocked_interaction` classification this vocabulary extends.

---

## 1. GROUND TRUTHS (re-verified against the current tree)

**G1 — The run phase ladders mint `running` the moment a task binding exists, before any spawn.**
Single-attempt ladder: `impl/src/application.mjs:5693-5702` — `!projection?.approval ?
'awaiting_plan_approval'` (:5694) … `: node?.taskId ? 'running' : 'approved'` (:5702). Workflow
member ladder: `impl/src/application.mjs:7420-7430` — `if (!projection.approval) phase =
'awaiting_plan_approval'` (:7420), `else if (node.taskId) phase = 'running'` (:7429). Workflow
run ladder: `impl/src/application.mjs:7106-7116`. `plan.node_dispatched` + `task.created` mint
ATOMICALLY in one `_appendBatch` at `impl/src/coordination-store.mjs:10928-10931`
(`createPlanGatedTask` :10895) — BEFORE the coordinator's ceiling check. So a ceiling-queued
member projects `running`: the #49 sin, verbatim, live in the current tree.

**G2 — The ceiling skip is silent.** `_dispatchPass` `impl/src/coordinator.mjs:2881-2894`: dep
gate :2888, ceiling skip :2891 (`if (this._inFlightCount(vendor) >= card.concurrencyCeiling)
continue;`). In-flight counts `working|stopping|blocked` (:3002-3009). No event, no log line, no
receipt at the skip. Re-drives: tick :1449, :3860, :9374, :13200. Ceilings are adapter-card data:
`impl/src/cli-adapters.mjs:233`; defaults codex 4 (:484), claude 4 (:546), glm-via-claude 1
(:613), pi 4 (:634).

**G3 — The spawn window has an internal-only flag and no honest projection.** `task.claimed`
mints in `_dispatch` at `impl/src/coordinator.mjs:3473`; the fence registers :3484; the
coordinator's optimistic `lifecycle.spawned` (actor `orchestrator`) appends :3666-3684;
`handle.nativeSpawnPending = true` :3696; adapter `spawn()` invoked :3699-3715; ack consumed
:3717-3722; flag cleared in `.finally` :3724; refusal → `_onSpawnRefused` :3820-3855 minting
`lifecycle.crashed` with `phase:'spawn'` (:3829, append :3838-3850). Optimistic `working` mints
:3737-3743. The TRUE session-ready marker is adapter-emitted: `lifecycle.spawned` carrying the
wire session id at `impl/src/claude-session.mjs:1101` (region :1097-1107), then
`lifecycle.turn_started` (:1109). `_publicHandle` (`impl/src/coordinator.mjs:6703`, status field
:6744) does NOT project `nativeSpawnPending` today.

**G4 — The message lane's spawn-window failure is untyped.** `sendMessage`
`impl/src/coordinator.mjs:6793`; typed guards exist for unknown identities — `worker_not_active`
:6831, `run_not_active` :6836 — but the delivery derefs `this._adapters[handle.vendor].prompt`
UNGUARDED at :6868, and the adapter's own missing-session path returns a bare `{ok:false,
notSent:true}` (`impl/src/claude-session.mjs:1380`). #97's demand: the outcome must distinguish
mid-spawn (retryable) from never-existed (not).

**G5 — The interaction waits are already fully projected.** `question.asked` → handle `blocked`
:12567; `approval.requested` record + `deadlineAt` :12599-12608, `blocked` :12613-12616;
`decision.requested` :12716-12723 (one-pending-per-worker :12680-12696). Exits:
`question.answered`/`approval.resolved`/`decision.settled` :12726-12739 (task back to `working`
:12733-12736); deadline sweep :2903-2910. Run-view attention items `answer_question`/
`answer_approval`/`answer_decision` at `impl/src/application.mjs:7156-7167` (single) and
:7510-7521 (workflow); `turn_checkpoint` :7528-7543; `scratchpad_write_failed` :7546-7563;
`session_preservation` :7564-7569.

**G6 — The pause/checkpoint wait is evented and epoch-stamped.** `turn.paused`
`impl/src/coordinator.mjs:2094-2098`; pauseId `pause:<taskId>:<seq>` :2100; record carries
`turnEpoch` + `mintedEvent` :2101-2113; task → `paused` :2118 (handle deliberately stays
`working`, :2116-2117 comment); one bounded steering cycle arms :2133.

**G7 — The provider-silence detector mints `health.stall_suspected`, working-only.**
`_armWatchdog` `impl/src/coordinator.mjs:8665-8683`: refuses unless `handle.status ===
'working'` :8667; fires `health.stall_suspected` :8674-8678 (kind at :8676, one-shot per turn via
`watchdogActions` :8673) then applies the configured stallAction :8679. `_observeWatchdogEvent`
counts only `actor === 'worker'` events (:9078-9080). The glm stream death (#50) mints NO
adapter error — the first durable signal of that class is exactly this mint.

**G8 — The progress/attention projections are closed enums with pinned derivations.**
`projectBlockedInteraction` `impl/src/application.mjs:372-382`; `progressBlockedDetail`
:387-396; `projectProgressClass` :402-417; `projectRequiredAction` :437-470. Enum pins:
`PROGRESS_CLASS_PREFIXES`/`_LEAVES`/`PROGRESS_BLOCKED_INTERACTION_DETAILS`/
`PROGRESS_SILENCE_THRESHOLD_MS` at `impl/src/application-semantics.mjs:49-54`;
`LEGACY_RUN_PHASE_MAP` :57-67 (`awaiting_plan_approval→awaiting_approval`, `approved→queued`,
`running→working`). `runs.list` item shape: `impl/src/application.mjs:11703-11721` (phase,
timing spread, progressClass, requiredAction, attention `'required'|'clear'`,
blockedInteraction, route, resources, actions). Outline: attention reduced to
`{count, state, summary}` :10879-10883; progressClass :10884; requiredAction already rides the
outline :10885; orchestration block :10866/:10898.

**G9 — The wave driver renders and steers from ONE reducer over the status view.**
`stallMarker` `impl/src/wave-driver.mjs:168-174` — strips `cursor`, `progressClass`,
`requiredAction` (:170-172) because derived liveness fields must not feed the liveness hash
(comment :161-167). `reduceMember` :200-214 — precedence: pending blocking interaction
(`{class: decision|question|approval, blocked:true}`) > `checkpoint+claim` > `checkpoint` >
`working` (fallback :213). Call site :552; blocked members are suppressed from nudge AND claim
:556-558; the reducer's class is the rendered label :580-586 ("a decision-parked member never
serializes as bare `working` again"). Decision lane :588-631; corrective nudge on
`claim_premature_liveness` :394-396; wave-level marker :575-578; stall clock :708-740 (fires at
:709). `reduceMember` has NO class for plan-approval, ceiling-queue, spawn-window, or
provider-stall — those members render bare `working` today (the 90-minute-loss mechanism).

**G10 — #55 is fixed by the activity projection; the fix's pin is live.**
`_activityProjection` `impl/src/application.mjs:7934-7960` projects `{providerCalls, tokens,
contentEvents, lastActivityAt}` into member rows (:7058-7062) and run level (:7763), and the
outline carries it (`outline.activity.providerCalls` — asserted at
`impl/test/issue55-stall-liveness-red.test.mjs:186-190`, the marker-moves pin at :189).

**G11 — The #88 claim-preflight is pause-epoch-scoped and untouched by waits.**
`claimTurn` `impl/src/coordinator.mjs:2541`; preflight call :2556-2558; refusal
`claim_premature_liveness` :2563-2572; `_claimLivenessPreflight` :2616-2680. CP4 window:
`turnEpoch === record.turnEpoch && seq <= record.mintedEvent` (:2649-2652, with the wire→fence
`epochOffset` alignment :2644-2653). CP3 counted set :2654-2666 (scratchpad.write_result ok,
context.read_result ok, content.tool_call, content.message, resource.provider_call,
question.answered, approval.resolved, decision.settled). Pending interactions NEVER count
(comment :2634-2638). `counted === 0 → {ok:true}` :2672 — the claim falls through to the full
trust gate (CP10: the silent worker's path is untouched). Contract doc:
`docs/reference/evidence/claim-preflight-2026-08-03/claim-preflight-contract.md`, CP4 shape law
at :220-228 ("the bound is a durable event identity, replay-stable, and immune to timer flakes").

**G12 — The store's task fold and node states are as the memo mapped.** Task fold:
`task.created` → `pending`, `task.claimed` → `working` at
`impl/src/coordination-store.mjs:2277-2280`; TRANSITIONS :134-142. `goalPlanStatus` node states
:11283-11291 (`blocked` default :11284, `stale`, `ready`, `dispatched` — including a task
sitting `pending` at the ceiling — `paused`, `accepted`, `failed`, `cancelled`).
`plan_approval_expired` refusal :10707. Handle `pending` mints at task :4489 / handle :4526.
Story member states `impl/src/story.mjs:24-33`; LEGAL_TRANSITIONS :242-258; `stalled` signal
working-only :537-546. Coordinator attention inbox: `member_terminal` :7059-7087 (seq+mintEpoch
:7063-7064, coalesce window :7075-7086, `ATTENTION_COALESCE_WINDOW_MS` :46),
`candidacy_review` :7040-7051.

---

## 2. DECISIONS

**D1 — `waitingOn` is an additive field, NEVER a new run phase.**
Shape: `waitingOn: { kind, since: { eventSeq, turnEpoch }, detail } | null` on (a) the run view
(single-attempt :5693+ and workflow :7106+/:7420+), (b) the outline (beside progressClass
:10884), (c) the `runs.list` item (beside progressClass/blockedInteraction :11709-11713).
Rationale: a new phase string moves every `canonicalRunPhase`/`LEGACY_RUN_PHASE_MAP`
(application-semantics.mjs:57-67) consumer, the terminal set (:143-145), and every persisted
phase comparison; an additive field moves none. The phase keeps telling dispatch truth
(`running` = a task binding exists); `waitingOn` tells wait truth. The two compose: consumers
read `waitingOn` first when non-null.

**D2 — v1 lands exactly four kinds: `capacity_ceiling`, `spawning`, `plan_approval`,
`provider_stalled`.** The four with burning receipts (#49, #97, the 90-minute approval loss,
#50). `decision_pending` is already fully projected (G5) and stays out of the v1 enum — its
attention items ARE the wait's name; folding it in is an alias, not a fix. `lease` and
`peer_wait` have no burning receipts (memo §2.7/§2.8) and stay out. The enum is closed and
frozen in one place (ride the application-semantics.mjs pin pattern :49-54), designed to admit
`decision_pending` later without shape change.

**D3 — `since` is an EVENT EPOCH, never wall time.** `since.eventSeq` is the durable seq of the
kind's mint event IN THAT EVENT'S OWN STREAM (coordination-store seq for `task.claimed`/
`plan.version_proposed`/`task.dispatch_deferred`; worker-log seq for `health.stall_suspected`);
`since.turnEpoch` is the event's fence epoch, or `null` when no fence/turn exists yet
(`capacity_ceiling`, `plan_approval`, and the pre-fence start of `spawning` — the fence
registers at :3484, after the claim). Consumers never compare seqs across kinds or streams.
Rationale: campaign law per #88 CP4 (claim-preflight-contract.md:220-228) — a durable event
identity is replay-stable and immune to timer flakes; the attention inbox's `mintEpoch`
precedent (:7063-7064). Wall clocks enter only through the ALREADY-SHIPPED timing block
(`_progressTiming` :7962+, `silenceMs`, `lastProgress.at`) — this contract adds no clock.

**D4 — The honest-null law: a member with `waitingOn != null` NEVER serializes as `working` to
a driver.** Concretely, while `waitingOn` is set:
- `reduceMember` NEVER returns class `working` (D9) — that is the #49 sin's kill: the wave
  driver's rendered label (:580-586) can never again claim `working` for a member whose task
  sits `pending` at the ceiling (application.mjs:5702/:7429 keep their dispatch-truth phase;
  the driver's class tells the wait truth).
- Run phase: UNCHANGED per D1 (`running` for capacity_ceiling/spawning/provider_stalled;
  `awaiting_plan_approval` for plan_approval). The phase is not the driver surface.
- `progressClass`: derivation UNCHANGED (closed enum, G8). During a long ceiling wait it reads
  `silent` — factually true, and `waitingOn` beside it says WHY. No enum addition.
- Attention: no new attention items in v1. plan_approval already projects `blockedInteraction:
  {kind:'approve_plan'}` (:373), `requiredAction approve_plan` (:440-443), and
  `blocked_interaction:approve_plan` (:388-389) — those stay the actionability surface;
  `waitingOn.kind = 'plan_approval'` is the driver-visible fold of the same state.
- `waitingOn: null` means genuinely working (or a state with its own named projection:
  interaction-blocked, paused/checkpoint, terminal). The field is never sticky: it derives from
  LIVE state per §3's exit rules, never from a stored boolean.

**D5 — `capacity_ceiling` mints a durable deferral receipt at the skip.** At the
`concurrencyCeiling` continue (:2891), append ONE coordination event per task dispatch —
`task.dispatch_deferred` with payload `{taskId, vendor, ceiling, inFlight, taskCreatedSeq}`,
idempotency-keyed (`task.dispatch_deferred:<taskId>:<taskCreatedSeq>`) so re-skips never
re-mint. This is v1's only new event kind. Rationale: #49's first defect is that NO
refusal/capacity event exists anywhere in the log; a projection-only fix leaves the event log
silent. The dep-gate skip (:2888) mints NOTHING (peer_wait is cut, D2) — the mint site is
exactly the ceiling `continue`, after vendor resolution, so a dep-blocked task is never
mislabeled. Projection rule: `waitingOn = capacity_ceiling` iff the node's `taskId` exists AND
`task.status === 'pending'` AND the deferral receipt exists (since = the receipt's seq).
`detail`: `{vendor, ceiling, inFlight}` from the receipt. Exit: `task.claimed` on a later pass
(:3473, re-driven :1449/:3860/:9374/:13200) folds the task to `working` and the rule stops
matching — no clearing event needed. Cancellation likewise clears by task fold.

**D6 — `spawning` projects the existing `nativeSpawnPending` flag; no new mint.**
`_publicHandle` (:6703) gains the flag (additive field beside status :6744); the views fold it.
Rule: `waitingOn = spawning` iff `handle.nativeSpawnPending === true` (set :3696, cleared
:3724). `since`: the `task.claimed` store seq, `turnEpoch: null` (pre-fence, D3). `detail`:
`{workerId, taskId, vendor}`. Exits: (a) spawn ack resolves → flag clears (the adapter-emitted
`lifecycle.spawned` claude-session.mjs:1101 / `turn_started` :1109 is the session-ready truth
the ack tracks); (b) refusal → `_onSpawnRefused` mints `lifecycle.crashed phase:'spawn'`
(:3838-3850) → terminal, and terminal members carry no `waitingOn`. Rationale: the window is
already state in the coordinator (:2014, :12141 read it); projecting it is additive and
replay-honest.

**D7 — `plan_approval` is a derived fold of existing projections; no new mint.**
`waitingOn = plan_approval` iff the ladder phase is `awaiting_plan_approval` (:5694, :7106,
:7420). `since`: the `plan.version_proposed` store seq (wait start, memo §2.3), `turnEpoch:
null`. Exits: `plan.approval_decided`; TTL via the existing `plan_approval_expired` refusal
(:10707). Rationale: the 90-minute loss was a DRIVER-RENDERING gap (G9: reduceMember has no
class for it), not a projection gap — blockedInteraction/requiredAction/progressClass already
name it (G8). The fix is the reducer class (D9) plus the field; no coordinator change.

**D8 — `provider_stalled` rides the EXISTING `health.stall_suspected` mint; NO new wall-time
timeout is added anywhere.** Rule: `waitingOn = provider_stalled` iff `handle.status ===
'working'` AND a `health.stall_suspected` event exists in the worker's current turn epoch AND
no `actor === 'worker'` event has seq greater than that suspicion's seq AND no pause record or
blocking interaction is pending (those project their own states — G5/G6; honest-null per D4:
a blocked/paused member is never `provider_stalled`). `since`: `{eventSeq: <health.stall_suspected
worker-log seq>, turnEpoch: <that event's turnEpoch>}` (:8674-8678). `detail`: `{workerId,
taskId, action}` from the event payload. Exit: the first `actor === 'worker'` event after the
suspicion (the same stream the watchdog touch reads, :9078-9080 — stream revival), or the
stallAction's terminal transition. Rationale: #50 names the silence BEFORE the kill; the
suspicion mint is already the campaign's one clock (working-only, one-shot per turn, G7) — the
projection is a pure epoch fold over the worker log, replay-stable, and adds no second timer.

**D9 — `reduceMember` gains the four classes; one reducer, never two truths.**
`reduceMember(interactions, checkpoint, waitingOn)` — the third input read from the SAME status
outline the driver already polls (the field rides the outline per D1). Pinned precedence:
1. pending blocking interaction → `{class: decision|question|approval, blocked: true}` (unchanged);
2. `checkpoint+claim` / `checkpoint` (unchanged — a checkpoint-parked member has `waitingOn:
   null`; turn_checkpoint is NOT a waitingOn kind);
3. `waitingOn` non-null → `{class: 'capacity_ceiling'|'spawning'|'plan_approval'|'provider_stalled',
   waiting: true}`;
4. `working` (fallback, narrowed exactly by the new classes).
Suppression: a `waiting`-class member is excluded from nudge AND claim eligibility that poll —
the same suppression `blocked: true` feeds at :556-558 — so the `claim_premature_liveness`
corrective nudge (:394-396) can never fire on a waiting member. Per-kind driver action
(memo §4): `capacity_ceiling` → WAIT (never nudge — no session exists; not counted against the
unproductive-nudge budget; the queue position is the honest state, never a stall symptom);
`spawning` → WAIT (bounded by the spawn ack; escalate only on `lifecycle.crashed
phase:'spawn'`); `plan_approval` → ESCALATE to the operator (the `approve_plan` semantic
action; the driver cannot resolve it — the 90-minute-loss fix); `provider_stalled` → WAIT until
the watchdog/stall clock acts, then ESCALATE on the existing stall basis (:735-738); never
nudge a dead pipe.

**D10 — `waitingOn` is STRIPPED from the stall hash, exactly like progressClass/requiredAction.**
`stallMarker` gains `delete view.waitingOn` beside :170-172. Rationale (both directions of the
#55 trap): (a) waitingOn transitions and detail churn are DERIVED wait fields — in the hash
they would reset the wave stall clock on state changes that are not liveness (the mirror of
silenceMs flapping it every poll); (b) a legitimately waiting member whose field is stable is
byte-static BY DESIGN — the wait kind, not the stall basis, is its honest state, and the driver
must never stall-kill a member FOR waiting (D9's per-kind actions own escalation). The #55 fix
(G10) keeps real mid-turn activity moving the marker through `activity.*`, which is NOT
stripped; a waiting member simply has no activity — correct, since nothing is running. Pin:
issue55's :189 row must stay green, plus a new row proving a waitingOn transition does NOT move
the marker.

**D11 — #97's typed refusal is IN SCOPE as the `spawning` kind's error-lane twin.**
In `sendMessage` (:6793), the delivery at :6868 is guarded: target handle exists AND
`handle.nativeSpawnPending === true` (or the adapter session entry is absent while the handle
is non-terminal) → return `{ ok: false, result: 'worker_spawning', workerId, runId }` — a NEW
closed result string sitting beside `worker_not_active` (:6831, unknown worker — not
retryable) and `run_not_active` (:6836, unknown run — not retryable). `worker_spawning` carries
the mid-spawn truth #97 demands: retryable in seconds, distinct from never-existed. Never an
untyped TypeError across the facade; never a bare `{ok:false, notSent}` swallowed without the
typed result. The adapter's `:1380` bare refusal is the internal signal the coordinator maps
FROM; the facade result is the typed lane.

**D12 — v1 projection surfaces: run view + outline + runs.list item.** Poll path only:
`run.status` outline (waitingOn beside progressClass :10884), `runs.list` (:11703+), full run
view. The `run.attention.watch` push variant (a `member_waiting` reason beside
`member_terminal` :7059-7087, coalesced per :7075-7086) is NOT v1 — see OQ3.

**D13 — Suites whose rows move, and suites that must NOT move.** Move:
`impl/test/issue10-blocked-interaction-red.test.mjs` (the projectBlockedInteraction precedence
table gains the waitingOn axis; blocked_interaction details stay pinned per
application-semantics.mjs:51-53), `impl/test/issue10-p0-agent-experience.test.mjs` (AX
re-baseline for the field), `impl/test/wave-driver-red.test.mjs` +
`impl/test/bidirectional-v3-red.test.mjs` (reducer class set grows; `working` fallback
narrows), `impl/test/issue55-stall-liveness-red.test.mjs` (D10 strip pin added; :189 stays
green), `impl/test/capacity-refusal-visibility-red.test.mjs` (the #35 shape model extends:
typed deferral receipt → visible cause chain). Must NOT move:
`impl/test/claim-preflight-red.test.mjs` (§5's proof). New suite home for §6's pins:
`impl/test/issue10-waiting-vocabulary-red.test.mjs`.

---

## 3. THE v1 KIND CONTRACTS

| kind | mint / derivation (wait start) | since | projection surface | exit event(s) | honest-null rule |
|---|---|---|---|---|---|
| `capacity_ceiling` | NEW durable `task.dispatch_deferred` at the :2891 ceiling skip, once per task dispatch (D5) | `{eventSeq: deferral store seq, turnEpoch: null}` | run view + outline + runs.list `waitingOn`; node stays `dispatched`; phase stays `running` (D1/D4) | `task.claimed` on a later pass (:3473); task cancellation | reduceMember never `working` while set (D9); never nudged, never claimed |
| `spawning` | derived: `handle.nativeSpawnPending === true` (:3696) through `_publicHandle` (:6703) (D6) | `{eventSeq: task.claimed store seq (:3473), turnEpoch: null}` | run view + outline + runs.list `waitingOn`; `_publicHandle` flag | adapter `lifecycle.spawned` (:1101) / ack resolution clears :3724; `lifecycle.crashed phase:'spawn'` (:3838-3850) → terminal | reduceMember class `spawning`; sendMessage refuses typed `worker_spawning` (D11) |
| `plan_approval` | derived: phase `awaiting_plan_approval` (:5694/:7106/:7420); no new mint (D7) | `{eventSeq: plan.version_proposed store seq, turnEpoch: null}` | `waitingOn` + EXISTING blockedInteraction `approve_plan` (:373), requiredAction (:440-443), progressClass (:388-389); outline carries requiredAction already (:10885) | `plan.approval_decided`; `plan_approval_expired` (:10707) | reduceMember class `plan_approval` → ESCALATE; the member never renders bare `working` to the driver |
| `provider_stalled` | derived: epoch fold over the EXISTING `health.stall_suspected` mint (:8674-8678) — no new clock (D8) | `{eventSeq: suspicion worker-log seq, turnEpoch: suspicion's turnEpoch}` | run view + outline + runs.list `waitingOn` | first `actor==='worker'` event after the suspicion seq (:9078-9080 stream), or stallAction terminal | null while blocked/paused/terminal (those have their own projections); never `progressing`-as-`working` to the driver |

---

## 4. REFUSAL VOCABULARY (closed result strings this contract touches)

- `worker_spawning` — NEW. sendMessage to a claimed-but-spawning member (D11). Retryable; the
  orchestrator can tell mid-spawn from never-existed (#97's AX demand).
- `worker_not_active` / `run_not_active` — UNCHANGED (:6831/:6836). Unknown identities, never
  retryable-as-spawn.
- `claim_premature_liveness` — UNCHANGED (#88, :2570). Fires only on positive read-only
  liveness with no in-scope diff; never on a waiting member (§5).
- `plan_approval_expired` — UNCHANGED (:10707). The plan_approval TTL exit.
- `task.dispatch_deferred` is a durable RECEIPT (event kind), not a refusal — the ceiling queue
  is a wait, not a rejection.

---

## 5. THE #88 INTERACTION — proof the preflight cannot misjudge a waiting worker

The preflight fires ONLY inside `claimTurn` (:2556-2558), which requires a PENDING PAUSE RECORD
(`_reservePauseRecord` :2543). Walk the four kinds:

1. `capacity_ceiling`: task `pending`, never dispatched — no turn, no pause record, no claim
   path exists. Preflight never fires. Vacuously safe.
2. `spawning`: turn not yet complete — no `turn.paused` minted — no pause record. Preflight
   never fires. Safe.
3. `plan_approval`: pre-dispatch by construction (dispatch throws `plan_not_approved` /
   `plan_approval_expired`, :10706-10707) — no task, no worker, no pause record. Safe.
4. `provider_stalled`: the member is mid-turn, status `working`, no pending pause record (a
   paused member is turn_checkpoint-class and fails D8's no-pending-pause clause). Safe.
5. The intersection case (a pause record AND a pending interaction): pending interactions NEVER
   count in the CP3 set (:2634-2638), so a waiting member mints zero counted events →
   `counted === 0 → {ok:true}` (:2672) → the claim falls through to the full trust gate
   unchanged (CP10). **The preflight never refuses a waiting worker as premature.**
6. The reverse edge (memo §6): a member blocked-then-ANSWERED inside the same pause epoch mints
   counted resolutions (`question.answered`/`approval.resolved`/`decision.settled` count,
   :2666-2668) — if it then parks
   diffless, the claim refuses `claim_premature_liveness` (:2570-2572). That is the DESIGNED
   read. `waitingOn` must NOT re-label that member: its decision is settled, so no LIVE
   pending record exists, and D4's derivation rule — waitingOn derives from LIVE pending
   records and event folds, NEVER from the preflight's liveness counts — keeps the two
   vocabularies disjoint.
7. Driver coupling: the corrective nudge on `claim_premature_liveness` (:394-396) fires only
   when reduceMember did NOT suppress the member (:556-558). D9 routes every waitingOn-class
   member through the SAME suppression. One reducer, never two truths.

---

## 6. ACCEPTANCE PINS

Per kind, five pins: START (wait start mints/exposes the field), SHOW (run view + outline +
runs.list expose it), EXIT (the exit event clears it), HONEST (no `working` to a driver while
set), STRIP (the transition does not move the stall marker). Plus the #88 pin. Home:
`impl/test/issue10-waiting-vocabulary-red.test.mjs` unless noted.

- **capacity_ceiling**: START — a dispatch hitting the ceiling skip (:2891) mints exactly one
  `task.dispatch_deferred` receipt (re-skips idempotent) carrying `{taskId, vendor, ceiling,
  inFlight, taskCreatedSeq}`. SHOW — run view/outline/runs.list show `waitingOn.kind ===
  'capacity_ceiling'` with `since.eventSeq === <receipt seq>` while the task sits `pending`
  with a dispatch binding (the #49 staging: two members, ceiling 1). EXIT — a later pass's
  `task.claimed` clears the field. HONEST — reduceMember returns `capacity_ceiling`, never
  `working`; the member is excluded from nudge and claim. STRIP — minting/clearing the field
  does not move `stallMarker` (wave-driver-red + issue55 rows). #88 — N/A by construction
  (no pause record can exist); pin the vacuity: claimTurn on a ceiling-queued task has no
  pauseId to reserve.
- **spawning**: START — `nativeSpawnPending === true` projects through `_publicHandle` into
  `waitingOn.kind === 'spawning'` with `since.eventSeq === <task.claimed seq>` (staging: a
  deferred-ack adapter holding the window open). SHOW — all three surfaces. EXIT — ack
  resolution clears the field; a refused spawn (`lifecycle.crashed phase:'spawn'`) leaves the
  member terminal with `waitingOn: null`. HONEST — reduceMember returns `spawning`, never
  `working`. REFUSAL — `sendMessage` mid-window returns `{ok:false, result:'worker_spawning'}`
  (typed, retryable), NEVER a TypeError, NEVER a bare `notSent` across the facade; unknown
  worker/run still return `worker_not_active`/`run_not_active` (capacity-refusal-visibility
  shape law: typed refusal → visible cause chain). STRIP — entering/exiting the window does
  not move the marker. #88 — vacuous (no pause record mid-spawn).
- **plan_approval**: START — an approved-pending run (no `plan.approval_decided`) projects
  `waitingOn.kind === 'plan_approval'` on all three surfaces; blockedInteraction/requiredAction
  rows in issue10-blocked-interaction-red stay green (details pinned). SHOW — the OUTLINE
  carries it (the 90-minute-loss surface: the driver polls outlines). EXIT —
  `plan.approval_decided` clears it; expiry refuses dispatch with `plan_approval_expired`.
  HONEST — reduceMember returns `plan_approval` (wave-driver-red row: an approval-waiting
  member no longer renders bare `working`; the driver action is ESCALATE, never nudge/claim).
  STRIP — approval-wait entry does not move the marker. #88 — vacuous (pre-dispatch).
- **provider_stalled**: START — a `health.stall_suspected` mint on a `working` member projects
  `waitingOn.kind === 'provider_stalled'` with `since.eventSeq === <suspicion seq>`; NO new
  timer exists anywhere in the diff (grep-able: no `setTimeout`/`stallMs` addition). SHOW —
  all three surfaces. EXIT — a subsequent `actor==='worker'` event clears the field; the
  stallAction's terminal transition clears it (terminal ⇒ null). HONEST — a `blocked` or
  `paused` member NEVER shows `provider_stalled` (their own projections own them); reduceMember
  returns `provider_stalled`, never `working`, and the member is never nudged into a dead
  pipe. STRIP — the suspicion's field transition does not move the marker; issue55's :189 row
  (mid-turn activity moves the marker) stays green — the fix and the vocabulary coexist.
  #88 — vacuous (no pending pause while mid-turn); and the counted set still excludes pending
  interactions (:2634-2638 row stays pinned).
- **#88 cross-pin** (claim-preflight-red.test.mjs — rows must NOT move): a claim on a pause
  whose worker has zero counted liveness still falls through to the full gate (CP10); a claim
  with positive read-only liveness and no diff still refuses `claim_premature_liveness`; a
  blocked-then-answered-diffless member still refuses (the DESIGNED read) and is never
  re-labeled by `waitingOn`.

---

## 7. CAMPAIGN-LAW CONSTRAINTS

- NO CLOCKS ANYWHERE IN THIS CHANGE. `provider_stalled` rides the existing
  `health.stall_suspected` mint (D8); `since` stamps are event epochs (D3); the only wall-time
  fields a consumer sees arrive through the pre-existing `_progressTiming` block. A new
  `setTimeout`, `Date.now()` delta, or `*Ms` knob in the waitingOn path is a contract violation.
- Additive-only at every surface: no new run phase (D1), no progressClass enum change (D4), no
  attention-item kind (D4), no TRANSITIONS edge (coordination-store.mjs:134-142), no
  canonicalMemberStatus change (story.mjs:24-33). The one new event kind
  (`task.dispatch_deferred`) and one new facade result (`worker_spawning`) are the complete
  vocabulary additions.
- One reducer owns driver truth (D9); no parallel classification anywhere else.

---

## 8. OPEN QUESTIONS

- **OQ1 — Wave stall basis for an all-waiting wave.** D10 strips waitingOn from the marker, so
  a wave whose members are ALL in named waits goes byte-static and trips the wave stall clock
  at `stallTimeoutMs` (:709). For `plan_approval` that is arguably correct (operator idle →
  escalate/end); for `capacity_ceiling` the memo's "stall clock EXEMPTION" phrasing (memo §4)
  suggests a queued-only wave should not end `stall`. v1 keeps wave-clock semantics unchanged
  and pins only the strip + reducer classes; whether waitingOn-class members are excluded from
  the stall BASIS is deferred to the implementation plan with a driver-policy row.
- **OQ2 — Other prompt lanes in the spawn window.** D11 pins `sendMessage` (:6793). The same
  unguarded deref shape exists at coordinator.mjs:2452, :7288, :7402, :7514, :11089
  (send/nudge/steer lanes). Do they get the `worker_spawning` guard in this landing or a
  follow-up? Recommendation: follow-up, one lane per row, same result string.
- **OQ3 — Push variant.** A `member_waiting` reason kind in the coordinator attention inbox
  (beside `member_terminal` :7059-7087, coalesced per :7075-7086, epoch-marked per :7063-7064)
  would let `run.attention.watch` push wait transitions instead of waiting for poll. v1 is
  poll-only (D12); the inbox reason is the designed next rung.
- **OQ4 — `decision_pending` alias.** The enum admits it later (D2) as the fold of the existing
  answer_* attention items; include only if an orchestrator receipt shows the attention items
  alone insufficient at outline depth (where they reduce to a count, :10879-10883).

---

## 9. VERIFICATION NOTE

Every line citation above was re-grepped/`sed -n`-read against the working tree at `0ad4d4a` +
dirty receipt files on 2026-08-06 (NUL-byte files — coordinator.mjs, application.mjs,
coordination-store.mjs — read via grep -an + sed -n only). Issue texts: `gh issue view
10|49|50|55|97` on the same date. The #88 contract doc's CP4 shape law verified at
claim-preflight-contract.md:220-228 against the live preflight (:2616-2680).

## 10. CITATION DRIFT LEDGER (memo → current tree)

| Memo citation | Current | Note |
|---|---|---|
| coordination-store.mjs:10718-10745 createPlanGatedTask | :10895-10933; atomic batch mint :10928-10931 | drifted ~177 lines; substance identical |
| coordination-store.mjs:7708 task.claimed fold | :2279 | fold location re-pinned |
| coordination-store.mjs:11284-11293 node/task states | :11283-11291 (node default `blocked` :11284) | intact modulo one line |
| coordinator.mjs:6871 untyped deref | :6868 | one-line drift |
| coordinator.mjs:2617 preflight | :2616; `counted===0→ok:true` :2672 | one-line drift |
| coordinator.mjs:3818-3851 _onSpawnRefused | :3820-3855; crash append :3838-3850 | two-line drift |
| coordinator.mjs:4527 handle `pending` | :4526 | one-line drift |
| coordinator.mjs:2637-2639 pending-never-count comment | :2634-2638 | re-pinned |
| All others (G1-G12 anchors) | as cited | verified intact |
