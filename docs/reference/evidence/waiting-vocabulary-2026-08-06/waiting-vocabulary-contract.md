# Waiting-on vocabulary — implementation contract (issue #10 blocked-state half)

Date: 2026-08-06. Status: contract for implementation, **v1.1** — red-team folded, ring-2 form
(ground truths → decisions → refusal vocabulary → acceptance pins → open questions). Primary
input: the grounding memo in this directory (`grounding.md`), fully cited there; this contract
re-verified every anchor against the CURRENT tree at `0ad4d4a` + dirty receipt files
(post-#87/#88/#89 landings — `f4a64da`, `f33c24e`, and the #88 preflight). Drifted anchors are
corrected in §10's ledger; nothing the memo concluded changed substance.

**v1.1 fold note (2026-08-06).** The red-team report in this directory
(`contract-redteam.md`, verdict NOT FOLD-READY, 3 blockers) is folded in full; every anchor
re-verified against HEAD `523111f` (impl tree identical through `7821856`, the report commit):

1. **Blocker 1 (spawning windows) → D6 amended.** The projection now keys on the coordinator's
   own spawn-pending flag union (:2014-2015) — `worktreeCreationPending || nativeSpawnPending ||
   recoverySpawnPending` — covering the claim→worktree-ready slice, the native-ack window, and
   the recovery-respawn window. The set-at-claim alternative was evaluated and rejected (D6
   rationale). D11's refusal guard keys on the same union, so the lane and the projection can
   never disagree.
2. **Blocker 2 (silent dispatch exits) → D5 amended, fifth kind added.** The receipt-keyed rule
   left `_dispatchPass`'s drain-closed (:2882) and vendor-unresolved (:2889) exits projecting
   `running`/null. The exits are reachable (admission never validates vendor resolvability —
   reachability proof evaluated, FAILS), so the fallback projection is mandatory: D2 gains
   `dispatch_pending`, the pending-with-binding-no-receipt backstop (D5's two-arm rule).
3. **Blocker 3 (D9 flag semantics) → D9 amended.** The waiting shape's flags are pinned
   (`{blocked: false, waiting: true, gated: null, interactions: []}`), the suppression mechanics
   at wave-driver.mjs:556 are pinned (`!reduced.blocked && !reduced.waiting`), and the
   checkpoint⇒not-waiting invariant becomes a suite row (§6).
4. Thirteen citation drifts (all ±1–2, substance intact) corrected per the report's drift
   table — §10's v1.1 correction table.
5. OQ1 recorded as SOUND-with-condition: an all-waiting wave's stall clock still fires (§8).

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
ATOMICALLY in one `_appendBatch` at `impl/src/coordination-store.mjs:10927-10931`
(`_appendBatch([` opens :10927; `createPlanGatedTask` :10895) — BEFORE the coordinator's
ceiling check. So a ceiling-queued member projects `running`: the #49 sin, verbatim, live in
the current tree.

**G2 — The ceiling skip is silent.** `_dispatchPass` `impl/src/coordinator.mjs:2881-2894`: dep
gate :2886, ceiling skip :2891 (`if (this._inFlightCount(vendor) >= card.concurrencyCeiling)
continue;`). In-flight counts `working|stopping|blocked` (:3002-3009). No event, no log line, no
receipt at the skip. Re-drives: tick :1449, :3860, :9374, :13200. Ceilings are adapter-card data:
`impl/src/cli-adapters.mjs:233`; defaults codex 4 (:484), claude 4 (:546), glm-via-claude 1
(:613), pi 4 (:634).

**G3 — The spawn window has internal-only flags and no honest projection.** `task.claimed`
mints in `_dispatch` at `impl/src/coordinator.mjs:3473`; the fence registers :3482;
`worktreeCreationPending` sets :3550 (worktree creation gates the worker's disk access,
:3546-3549 comment) and clears in `.finally` :3659; the coordinator's optimistic
`lifecycle.spawned` (actor `orchestrator`) appends :3666-3684; `handle.nativeSpawnPending = true`
:3696; adapter `spawn()` invoked :3699-3715; ack consumed :3717-3722; flag cleared in `.finally`
:3724; refusal → `_onSpawnRefused` :3820-3855 minting `lifecycle.crashed` with
`phase: 'spawn'|'worktree'` (`const phase = worktreeFailure ? 'worktree' : 'spawn'` :3827,
append opens :3836, `kind:` :3840, `phase,` :3845). Optimistic `working` mints :3737-3743. The
TRUE session-ready marker is adapter-emitted: `lifecycle.spawned` carrying the wire session id
at `impl/src/claude-session.mjs:1101` (region :1097-1107), then `lifecycle.turn_started`
(:1109). The recovery-respawn paths set a THIRD flag: `recoverySpawnPending = true` :5338 and
:5748 (cleared :5360/:5778). `_publicHandle` (`impl/src/coordinator.mjs:6703`, status field
:6744) does NOT project any of the three flags today; the coordinator's own local-authority
check `_ownsLocalResources` (:2008) already unions all three at :2014-2015.

**G4 — The message lane's spawn-window failure is untyped.** `sendMessage`
`impl/src/coordinator.mjs:6793`; typed guards exist for unknown identities — `worker_not_active`
:6831, `run_not_active` :6836 — but the delivery derefs `this._adapters[handle.vendor].prompt`
UNGUARDED at :6868, and the adapter's own missing-session path returns a bare `{ok:false,
notSent:true}` (`impl/src/claude-session.mjs:1381`). #97's demand: the outcome must distinguish
mid-spawn (retryable) from never-existed (not).

**G5 — The interaction waits are already fully projected.** `question.asked` → handle `blocked`
:12567; `approval.requested` record + `deadlineAt` :12599-12608, `blocked` :12613-12616;
`decision.requested` :12716-12723 (one-pending-per-worker :12680-12696). Exits:
`question.answered`/`approval.resolved`/`decision.settled` :12726-12739 (task back to `working`
:12735-12737); deadline sweep :2903-2910. Run-view attention items `answer_question`/
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
:389-396; `projectProgressClass` :402-417; `projectRequiredAction` :437-470. Enum pins:
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
(`{class: decision|question|approval, blocked:true}`; the interactions input is
`answer_question`/`answer_approval`/`answer_decision` only, `BLOCKING_INTERACTION_KINDS`
:185-187) > `checkpoint+claim` > `checkpoint` > `working` (fallback :213). Call site :552;
blocked members are suppressed from nudge AND claim :556-558 (the paused-set admission :556 keys
on `!reduced.blocked`; the decision lane :560 keys on `reduced.blocked && reduced.gated.kind`);
the reducer's class is the rendered label :580-586 ("a decision-parked member never serializes
as bare `working` again"). Decision lane :588-631; corrective nudge on
`claim_premature_liveness` :394-396; wave-level marker :575-578; stall clock :708-740 (check
fires :708; :709 is the claim-on-stall branch). `reduceMember` has NO class for plan-approval,
ceiling-queue, spawn-window, or provider-stall — those members render bare `working` today (the
90-minute-loss mechanism).

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
`plan_approval_expired` refusal :10707. Handle `pending` mints at task :4489 / handle :4525
(`status: 'pending'` :4525; :4526 is `pendingApprovalId`). Story member states
`impl/src/story.mjs:24-33`; LEGAL_TRANSITIONS :242-258; `stalled` signal working-only :537-546.
Coordinator attention inbox: `member_terminal` :7060-7087 (`seq` :7063, `mintEpoch` :7066,
coalesce window :7075-7086, `ATTENTION_COALESCE_WINDOW_MS` :46), `candidacy_review` :7040-7051.

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

**D2 — v1 lands exactly five kinds: `capacity_ceiling`, `spawning`, `plan_approval`,
`provider_stalled`, `dispatch_pending`.** The first four carry the burning receipts (#49, #97,
the 90-minute approval loss, #50). The fifth is the red-team's blocker-2 fold: `_dispatchPass`
has silent pending exits that mint no receipt (drain closed :2882, vendor unresolved :2889 —
G2's region), and a task bound to an unconfigured/unavailable vendor sits `pending` forever
projecting `running`/null — the #49 lie in a narrower coat. `dispatch_pending` names every
pending-with-binding state the receipt doesn't (D5's two-arm rule), so no member of that shape
ever serializes bare `working` again. `decision_pending` is already fully projected (G5) and
stays out of the v1 enum — its attention items ARE the wait's name; folding it in is an alias,
not a fix. `lease` and `peer_wait` have no burning receipts (memo §2.7/§2.8) and stay out —
a dep-gated task matches `dispatch_pending` truthfully (its dispatch has genuinely not
committed), and the node-level `blocked` state remains the finer peer-dep truth. The enum is
closed and frozen in one place (ride the application-semantics.mjs pin pattern :49-54),
designed to admit `decision_pending` later without shape change.

**D3 — `since` is an EVENT EPOCH, never wall time.** `since.eventSeq` is the durable seq of the
kind's mint event IN THAT EVENT'S OWN STREAM (coordination-store seq for `task.claimed`/
`task.created`/`plan.version_proposed`/`task.dispatch_deferred`; worker-log seq for
`health.stall_suspected`); `since.turnEpoch` is the event's fence epoch, or `null` when no
fence/turn exists yet (`capacity_ceiling`, `dispatch_pending`, `plan_approval`, and `spawning`
in every window — the fence registers at :3482, after the claim). Consumers never compare seqs
across kinds or streams. Rationale: campaign law per #88 CP4 (claim-preflight-contract.md:220-228)
— a durable event identity is replay-stable and immune to timer flakes; the attention inbox's
epoch precedent (`seq` :7063, `mintEpoch` :7066). Wall clocks enter only through the
ALREADY-SHIPPED timing block (`_progressTiming` :7963+, `silenceMs`, `lastProgress.at`) — this
contract adds no clock.

**D4 — The honest-null law: a member with `waitingOn != null` NEVER serializes as `working` to
a driver.** Concretely, while `waitingOn` is set:
- `reduceMember` NEVER returns class `working` (D9) — that is the #49 sin's kill: the wave
  driver's rendered label (:580-586) can never again claim `working` for a member whose task
  sits `pending` at the ceiling (application.mjs:5702/:7429 keep their dispatch-truth phase;
  the driver's class tells the wait truth).
- Run phase: UNCHANGED per D1 (`running` for capacity_ceiling/dispatch_pending/spawning/
  provider_stalled; `awaiting_plan_approval` for plan_approval). The phase is not the driver
  surface.
- `progressClass`: derivation UNCHANGED (closed enum, G8). During a long ceiling wait it reads
  `silent` — factually true, and `waitingOn` beside it says WHY. No enum addition.
- Attention: no new attention items in v1. plan_approval already projects `blockedInteraction:
  {kind:'approve_plan'}` (:373), `requiredAction approve_plan` (:440-443), and
  `blocked_interaction:approve_plan` (return at :390) — those stay the actionability surface;
  `waitingOn.kind = 'plan_approval'` is the driver-visible fold of the same state.
- `waitingOn: null` means genuinely working (or a state with its own named projection:
  interaction-blocked, paused/checkpoint, terminal). The field is never sticky: it derives from
  LIVE state per §3's exit rules, never from a stored boolean.

**D5 — `capacity_ceiling` mints a durable deferral receipt at the skip; `dispatch_pending`
names every OTHER pending-with-binding wait (two-arm rule, v1.1).** At the
`concurrencyCeiling` continue (:2891), append ONE coordination event per task dispatch —
`task.dispatch_deferred` with payload `{taskId, vendor, ceiling, inFlight, taskCreatedSeq}`,
idempotency-keyed (`task.dispatch_deferred:<taskId>:<taskCreatedSeq>`) so re-skips never
re-mint. This is v1's only new event kind. Rationale: #49's first defect is that NO
refusal/capacity event exists anywhere in the log; a projection-only fix leaves the event log
silent. The dep-gate skip (:2886) mints NOTHING (peer_wait is cut, D2) — the mint site is
exactly the ceiling `continue`, after vendor resolution, so a dep-blocked task is never
mislabeled by the receipt. Projection rule (v1.1 — two arms; no pending-with-binding state goes
unnamed):
- **Arm 1 (receipt — the precise cause):** `waitingOn = capacity_ceiling` iff the node's
  `taskId` exists AND `task.status === 'pending'` AND the deferral receipt exists (`since` =
  the receipt's seq). `detail`: `{vendor, ceiling, inFlight}` from the receipt — `inFlight` is
  MINT-TIME data (the idempotent receipt freezes it): a historical record of the skip, never
  live queue depth; consumers must not read it as such.
- **Arm 2 (no receipt — the named backstop):** `waitingOn = dispatch_pending` iff the node's
  `taskId` exists AND `task.status === 'pending'` AND NO deferral receipt exists. `since`:
  `{eventSeq: task.created store seq, turnEpoch: null}` — the binding's birth; the wait existed,
  unnamed, from then. `detail`: `{vendorRequested, reason: 'pre-dispatch'}`.
Reachability (why Arm 2 is mandatory, not optional — the report's option (b) was evaluated and
FAILS): `_dispatchPass` has two silent exits that mint nothing — drain closed (:2882 early
return; transient, but the member is invisible for its duration) and vendor unresolved (:2889).
`_resolveVendor` (:2916-2950) resolves at DISPATCH time — an explicit route can return null
(:2917-2924) and the auto route can return null (:2950) — while admission stores
`vendorRequested` durable (:4395/:4468) with no adapter-configured validation. So a task bound
to an unconfigured/unavailable vendor (the grok/quota-style case) sits `pending` FOREVER: no
receipt, phase `running`, `waitingOn: null`, reduceMember `working`. Admission does not prove
`:2889` dead; the fallback projection is therefore mandatory. Arm 2 also covers the normal
`task.created`→first-pass slice and the dep-gated slice truthfully — in both, no dispatch pass
has committed an outcome.
Honesty rule for `dispatch_pending`: the kind asserts ONLY the observable — a dispatch binding
exists, the task is `pending`, and no dispatch pass has committed an outcome (claim or
receipt). It does NOT assert misconfiguration: the transient drain-closed and first-pass slices
project the same kind, and persistence is the signal (an unconfigured-vendor task never leaves
the kind without operator action). Name choice: `route_unavailable` was REJECTED — it collides
with existing closed error codes (`impl/src/route-liveness.mjs:182`,
`impl/src/application-deployment.mjs:1083`) and over-asserts a routing cause for the drain and
first-pass slices.
Exit (both arms): `task.claimed` on a later pass (:3473, re-driven :1449/:3860/:9374/:13200)
folds the task to `working` and the rule stops matching — no clearing event needed.
Cancellation likewise clears by task fold. Arm 2 also exits INTO Arm 1: the vendor becoming
resolvable on a later pass that then ceiling-skips mints the receipt and the kind flips
`dispatch_pending` → `capacity_ceiling` — an honest cause-chain progression.

**D6 — `spawning` projects the coordinator's own spawn-pending UNION; no new mint (v1.1).**
v1.0 keyed on `nativeSpawnPending` alone; the red team (blocker 1) showed the claim→flag slice
and the recovery-respawn window then project bare `working` while D11's refusal lane already
refuses `worker_spawning` there. v1.1 keys the projection on the exact union the coordinator's
own local-authority check (`_ownsLocalResources`, :2008) trusts at :2014-2015:
`waitingOn = spawning` iff `handle.worktreeCreationPending === true ||
handle.nativeSpawnPending === true || handle.recoverySpawnPending === true`.
`_publicHandle` (:6703) gains two additive derived fields — `spawnPending` (the union boolean)
and `spawnWindow` (`'worktree' | 'spawn' | 'recovery'`, precedence worktree > spawn > recovery
where they overlap; they are sequential in practice) — and the views fold them. The covered
windows, explicitly:
1. **claim→worktree-ready:** `worktreeCreationPending` sets :3550 (inside `_dispatch`, after
   the claim :3473 and the fence :3482) and clears in `.finally` :3659; the adapter's work is
   gated on `worktreeReady` (:3660) — real, slow work (checkout) during which the member reads
   `working` today. `spawnWindow: 'worktree'`.
2. **native spawn pending:** `nativeSpawnPending` sets :3696, adapter `spawn()` :3699-3715, ack
   consumed :3717-3722, flag cleared in `.finally` :3724 on ANY settlement.
   `spawnWindow: 'spawn'`.
3. **recovery respawn:** `recoverySpawnPending` sets :5338/:5748 (attach/recovery re-spawn of
   an already-claimed task) and clears :5360/:5778. `spawnWindow: 'recovery'`.
`since`: `{eventSeq: task.claimed store seq, turnEpoch: null}` in all three windows — the seq
identifies the BINDING (a recovery respawn mints no fresh claim; the original claim seq still
names the bound task); `turnEpoch: null` per D3 (the fence registers :3482, after the claim).
`detail`: `{workerId, taskId, vendor, window: <spawnWindow>}`.
Exits: (a) worktree-ready settlement clears the worktree flag (:3659) — the projection slides
to window `'spawn'` when the native flag sets, never through `null`; (b) spawn ack resolves →
native flag clears :3724 (the adapter-emitted `lifecycle.spawned` claude-session.mjs:1101 /
`turn_started` :1109 is the session-ready truth the ack tracks); (c) recovery ack settles →
recovery flag clears :5360/:5778; (d) refusal/failure → `_onSpawnRefused` mints
`lifecycle.crashed` with `phase: 'spawn'|'worktree'` (:3827, append :3836-3850) → terminal, and
terminal members carry no `waitingOn`.
Rationale — union over set-at-claim: moving the flag set to immediately after `claimTask`
(:3479) was evaluated and REJECTED: (i) it widens an internal flag's span for its other readers
— the `lifecycle.process_started` validity check at :12141 keys `nativeSpawnPending ||
recoveryPending`, and the `.finally` clear at :3724 assumes the flag brackets the adapter
attempt, so an early exit between :3482 and :3696 (e.g. the failed/exited return :3540-3542)
would strand the flag set on a dead handle; (ii) it still misses the recovery-respawn window —
`recoverySpawnPending` is a separate flag on separate paths (:5338/:5748), so the union is
needed regardless; (iii) the union is projection-only — zero coordinator state-semantics change
— and reuses the predicate the coordinator already trusts for ownership.
Honesty wording (corrects v1.0's "replay-honest" overclaim): the flags are volatile coordinator
memory — reconstruction sets all three false (:14052-14056). This is a LIVE-STATE projection
that reconstructs to null; post-restart the member reads `orphaned` via the `recoveryPending`
mask (:6744), so no bare-`working` lie survives a restart either. The window is already state
the coordinator reads for authority (:2014-2015, :12141); projecting it is additive.

**D7 — `plan_approval` is a derived fold of existing projections; no new mint.**
`waitingOn = plan_approval` iff the ladder phase is `awaiting_plan_approval` (:5694, :7106,
:7420). `since`: the `plan.version_proposed` store seq (wait start, memo §2.3), `turnEpoch:
null`. `detail` (specified v1.1 — §3's shape law requires the key; v1.0 left it
implementer-chosen): `{planVersion, proposalSeq}`. Exits: `plan.approval_decided`; TTL via the
existing `plan_approval_expired` refusal (:10707). Exit honesty (v1.1 names the stale edge):
the TTL exit is a dispatch-time REFUSAL, not a state transition — an approval that has gone
stale still EXISTS (disposition `approved`), so the ladder leaves `awaiting_plan_approval` →
phase `approved` → `waitingOn: null` while dispatch still refuses without re-approval. That is
a pre-existing gap, not created by this contract; the view truth is `approved`-not-waiting, and
re-proposal (a new `plan.version_proposed`) re-enters the wait. Rationale: the 90-minute loss
was a DRIVER-RENDERING gap (G9: reduceMember has no class for it), not a projection gap —
blockedInteraction/requiredAction/progressClass already name it (G8). The fix is the reducer
class (D9) plus the field; no coordinator change.

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

**D9 — `reduceMember` gains the five classes; one reducer, never two truths; flag semantics
PINNED (v1.1).** `reduceMember(interactions, checkpoint, waitingOn)` — the third input read
from the SAME status outline the driver already polls (the field rides the outline per D1).
Every return shape carries BOTH flags explicitly — `{class, blocked, waiting, gated,
interactions}` — so no consumer ever reads an undefined flag. Pinned precedence:
1. pending blocking interaction → `{class: decision|question|approval, blocked: true,
   waiting: false, gated, interactions}` (unchanged);
2. `waitingOn` non-null → `{class: 'capacity_ceiling'|'spawning'|'plan_approval'|
   'provider_stalled'|'dispatch_pending', blocked: false, waiting: true, gated: null,
   interactions: []}` — waiting OUTRANKS checkpoint (v1.0 ordered checkpoint second; the order
   is unreachable while the invariant below holds, but suppression is the safety property — a
   member in a named wait must never be claim/nudge-admitted, so if a future kind or an
   exit-rule bug ever produces the compound, suppression wins over claim-admission);
3. `checkpoint+claim` / `checkpoint` → `{class, blocked: false, waiting: false, gated: null,
   interactions: []}` (unchanged — a checkpoint-parked member has `waitingOn: null`;
   turn_checkpoint is NOT a waitingOn kind);
4. `working` → `{class: 'working', blocked: false, waiting: false, gated: null,
   interactions: []}` (fallback, narrowed exactly by the new classes).
Suppression mechanics (PINNED — v1.0's `{class, waiting: true}` shape never set `blocked`, so
the :556-558 suppression, which keys on `reduced.blocked`, did not fire for waiting members as
literally specified): the paused-set admission at wave-driver.mjs:556 becomes
`if (checkpoint && !reduced.blocked && !reduced.waiting)` — a waiting member is excluded from
the `paused` set that poll, and everything downstream (the claim cadence, the claim-on-stall
fan-out :709-716, the `claim_premature_liveness` corrective nudge :394-396) consumes ONLY that
set, so none can fire on a waiting member. The decision lane at :560
(`reduced.blocked && reduced.gated.kind === 'answer_decision'`) is UNTOUCHED: branch 1 is the
only `blocked: true` shape and always carries a non-null `gated` by construction; waiting
shapes have `blocked: false` and never enter the lane, so no undefined-`gated` deref exists.
Pinned invariant (suite row, §6): checkpoint ⇒ not-waiting — `task.status === 'paused'` ⇒
`worktreeCreationPending === false` ∧ `nativeSpawnPending === false` ∧
`recoverySpawnPending === false` ∧ `waitingOn === null`. Today's safety rests on this holding
emergently (capacity_ceiling/dispatch_pending ⇒ task `pending`; spawning ⇒ pre-turn;
plan_approval ⇒ pre-dispatch; provider_stalled ⇒ D8's no-pause clause); v1.1 pins it so a
violation fails a suite row instead of silently re-admitting a waiting member to claim/nudge.
Per-kind driver action (memo §4): `capacity_ceiling` → WAIT (never nudge — no session exists;
not counted against the unproductive-nudge budget; the queue position is the honest state,
never a stall symptom); `dispatch_pending` → WAIT (the transient slices self-resolve on the
next pass; persistence IS the operator signal — the unconfigured-vendor case needs an operator,
not a nudge); `spawning` → WAIT (bounded by the spawn ack; escalate only on `lifecycle.crashed
phase:'spawn'|'worktree'`); `plan_approval` → ESCALATE to the operator (the `approve_plan`
semantic action; the driver cannot resolve it — the 90-minute-loss fix); `provider_stalled` →
WAIT until the watchdog/stall clock acts, then ESCALATE on the existing stall basis (:735-738);
never nudge a dead pipe.

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
the marker. Pin mechanics (v1.1, red-team §5): the STRIP rows must drive the REAL wave-driver
marker — `stallMarker` (:168-174) is not exported today, so export it or drive
`createWaveDriver` end-to-end. issue55's suite uses a LOCAL marker helper
(issue55-stall-liveness-red.test.mjs:137-142) that strips only `cursor` — it is NOT the driver
law; a STRIP row copying that helper would see waitingOn transitions MOVE the marker and fail
against a correct implementation.

**D11 — #97's typed refusal is IN SCOPE as the `spawning` kind's error-lane twin.**
In `sendMessage` (:6793), the delivery at :6868 is guarded: target handle exists AND the SAME
union the projection keys on — `handle.worktreeCreationPending === true ||
handle.nativeSpawnPending === true || handle.recoverySpawnPending === true` — (or, for adapters
whose session lifecycle is pinned, the adapter session entry is absent while the handle is
non-terminal) → return `{ ok: false, result: 'worker_spawning', workerId, runId }` — a NEW
closed result string sitting beside `worker_not_active` (:6831, unknown worker — not
retryable) and `run_not_active` (:6836, unknown run — not retryable). `worker_spawning` carries
the mid-spawn truth #97 demands: retryable in seconds, distinct from never-existed. Never an
untyped TypeError across the facade; never a bare `{ok:false, notSent}` swallowed without the
typed result. The adapter's `:1381` bare refusal is the internal signal the coordinator maps
FROM; the facade result is the typed lane. v1.1: the guard keys on the flag union so the
refusal lane and the projection NEVER disagree (v1.0 keyed the projection on one flag while the
lane's session-absent disjunct already fired in the claim→worktree slice — claude-session
creates its session entry only at :827, inside spawn). The session-absent disjunct is
restricted to adapters with a pinned session lifecycle (claude-session: entry created :827,
never deleted — session-absent ∧ non-terminal ⇒ mid-spawn or dead); for adapters without that
pin the flag union alone governs — a retryable-labeled refusal for a torn-down session would be
a new lie.

**D12 — v1 projection surfaces: run view + outline + runs.list item.** Poll path only:
`run.status` outline (waitingOn beside progressClass :10884), `runs.list` (:11703+), full run
view. The `run.attention.watch` push variant (a `member_waiting` reason beside
`member_terminal` :7060-7087, coalesced per :7075-7086) is NOT v1 — see OQ3.
Historical inspection (v1.1, red-team §2.7): `_historicalProfileInspection` (:10570-10605)
replays cursor-pinned views — `capacity_ceiling`/`dispatch_pending`/`plan_approval`/
`provider_stalled` are event-derived and replayable; `spawning` is live-flag-derived and NOT
replayable (the flags reconstruct false, :14052-14056) — a historical inspection omits
`spawning` (live-only, documented, never fabricated).
Digest asymmetry (v1.1, red-team §2.2 — a deliberate pinned decision, not an accident):
`semanticViewDigest` (:259-264) strips only `cursor`/`progressClass`/`requiredAction`, so
waitingOn transitions MOVE `viewDigest`, hence `_semanticActionId` ids (:8212) and
follow-`changed` wakes (:10853-10857). That is correct-by-decision: waitingOn is event-derived
(no wall-time flap), and a wait transition IS a semantic change a follower should wake for. The
stallMarker strip (D10) is the liveness clock; the digest is a change notifier — the asymmetry
is the design.

**D13 — Suites whose rows move, and suites that must NOT move.** Move:
`impl/test/issue10-blocked-interaction-red.test.mjs` (the projectBlockedInteraction precedence
table gains the waitingOn axis; blocked_interaction details stay pinned per
application-semantics.mjs:51-53), `impl/test/issue10-p0-agent-experience.test.mjs` (AX
re-baseline for the field), `impl/test/wave-driver-red.test.mjs` +
`impl/test/bidirectional-v3-red.test.mjs` (reducer class set grows; `working` fallback
narrows), `impl/test/issue55-stall-liveness-red.test.mjs` (D10 strip pin added; :189 stays
green — and the new STRIP row drives the REAL driver marker per D10's pin mechanics, not the
suite's local helper), `impl/test/capacity-refusal-visibility-red.test.mjs` (the #35 shape
model extends: typed deferral receipt → visible cause chain). Must NOT move:
`impl/test/claim-preflight-red.test.mjs` (§5's proof) and
`impl/test/workflow-surface-red.test.mjs` (its :568/:574 `worker_not_active`/`run_not_active`
pins stage a never-spawned worker and an empty run — both paths untouched by D11's guard, which
fires only on an existing handle inside the spawn window). New suite home for §6's pins:
`impl/test/issue10-waiting-vocabulary-red.test.mjs`, which also carries the v1.1 rows: the
worktree-slice START staging (a deferred-WORKTREE adapter, not just a deferred-ack adapter),
the recovery-respawn window, the `dispatch_pending` five-pin set, the checkpoint⇒not-waiting
invariant row, the constructed compound-state suppression row, and the digest-asymmetry row.

---

## 3. THE v1 KIND CONTRACTS

Shape law: every row carries `detail` (specified per kind — never implementer-chosen).

| kind | mint / derivation (wait start) | since | projection surface | exit event(s) | honest-null rule |
|---|---|---|---|---|---|
| `capacity_ceiling` | NEW durable `task.dispatch_deferred` at the :2891 ceiling skip, once per task dispatch (D5 Arm 1) | `{eventSeq: deferral store seq, turnEpoch: null}` | run view + outline + runs.list `waitingOn`; node stays `dispatched`; phase stays `running` (D1/D4) | `task.claimed` on a later pass (:3473); task cancellation | reduceMember never `working` while set (D9); never nudged, never claimed; `detail.inFlight` is mint-time-frozen, never live queue depth |
| `dispatch_pending` | derived: node `taskId` bound ∧ `task.status === 'pending'` ∧ NO deferral receipt — the :2882/:2889 silent exits and the pre-first-pass slice (D5 Arm 2); no new mint | `{eventSeq: task.created store seq, turnEpoch: null}` | run view + outline + runs.list `waitingOn` (`detail: {vendorRequested, reason: 'pre-dispatch'}`); node stays `dispatched`; phase stays `running` | `task.claimed` on a later pass; a receipt mint flips the kind to `capacity_ceiling`; task cancellation | reduceMember never `working` while set; asserts ONLY "no dispatch outcome committed" — never a misconfiguration claim |
| `spawning` | derived: the spawn-pending UNION `worktreeCreationPending \|\| nativeSpawnPending \|\| recoverySpawnPending` (:2014-2015) through `_publicHandle`'s derived `spawnPending`/`spawnWindow` (:6703) (D6) | `{eventSeq: task.claimed store seq (:3473), turnEpoch: null}` | run view + outline + runs.list `waitingOn` (`detail.window`: `worktree`\|`spawn`\|`recovery`); `_publicHandle` derived fields | worktree-ready settlement (:3659) slides the window to `spawn`; ack resolution clears :3724; recovery ack settles :5360/:5778; `lifecycle.crashed` `phase:'spawn'\|'worktree'` (:3836-3850) → terminal | reduceMember class `spawning`, never `working`; sendMessage refuses typed `worker_spawning` on the same union (D11) |
| `plan_approval` | derived: phase `awaiting_plan_approval` (:5694/:7106/:7420); no new mint (D7) | `{eventSeq: plan.version_proposed store seq, turnEpoch: null}` | `waitingOn` (`detail: {planVersion, proposalSeq}`) + EXISTING blockedInteraction `approve_plan` (:373), requiredAction (:440-443), progressClass (:390); outline carries requiredAction already (:10885) | `plan.approval_decided`; `plan_approval_expired` (:10707) — TTL is a dispatch refusal, not a transition: an expired-but-approved run reads phase `approved`, `waitingOn: null` (D7) | reduceMember class `plan_approval` → ESCALATE; the member never renders bare `working` to the driver |
| `provider_stalled` | derived: epoch fold over the EXISTING `health.stall_suspected` mint (:8674-8678) — no new clock (D8) | `{eventSeq: suspicion worker-log seq, turnEpoch: suspicion's turnEpoch}` | run view + outline + runs.list `waitingOn` | first `actor==='worker'` event after the suspicion seq (:9078-9080 stream), or stallAction terminal | null while blocked/paused/terminal (those have their own projections); never `progressing`-as-`working` to the driver |

---

## 4. REFUSAL VOCABULARY (closed result strings this contract touches)

- `worker_spawning` — NEW. sendMessage to a claimed-but-spawning member (D11; guard keyed on
  the same :2014-2015 flag union the projection uses). Retryable; the orchestrator can tell
  mid-spawn from never-existed (#97's AX demand).
- `worker_not_active` / `run_not_active` — UNCHANGED (:6831/:6836). Unknown identities, never
  retryable-as-spawn.
- `claim_premature_liveness` — UNCHANGED (#88, :2570). Fires only on positive read-only
  liveness with no in-scope diff; never on a waiting member (§5).
- `plan_approval_expired` — UNCHANGED (:10707). The plan_approval TTL exit.
- `task.dispatch_deferred` is a durable RECEIPT (event kind), not a refusal — the ceiling queue
  is a wait, not a rejection. `dispatch_pending` is likewise a projection kind, not a refusal —
  it names a pre-dispatch wait, not a failure.

---

## 5. THE #88 INTERACTION — proof the preflight cannot misjudge a waiting worker

The preflight fires ONLY inside `claimTurn` (:2556-2558), which requires a PENDING PAUSE RECORD
(`_reservePauseRecord` :2543). Walk the five kinds:

1. `capacity_ceiling`: task `pending`, never dispatched — no turn, no pause record, no claim
   path exists. Preflight never fires. Vacuously safe.
2. `dispatch_pending`: same shape — task `pending`, no turn, no pause record. Vacuously safe.
3. `spawning`: turn not yet complete — no `turn.paused` minted — no pause record (true in all
   three spawn windows: worktree, native-ack, recovery-respawn). Preflight never fires. Safe.
4. `plan_approval`: pre-dispatch by construction (dispatch throws `plan_not_approved` /
   `plan_approval_expired`, :10706-10707) — no task, no worker, no pause record. Safe.
5. `provider_stalled`: the member is mid-turn, status `working`, no pending pause record (a
   paused member is turn_checkpoint-class and fails D8's no-pending-pause clause). Safe.
6. The intersection case (a pause record AND a pending interaction): pending interactions NEVER
   count in the CP3 set (:2634-2638), so a waiting member mints zero counted events →
   `counted === 0 → {ok:true}` (:2672) → the claim falls through to the full trust gate
   unchanged (CP10). **The preflight never refuses a waiting worker as premature.**
7. The reverse edge (memo §6): a member blocked-then-ANSWERED inside the same pause epoch mints
   counted resolutions (`question.answered`/`approval.resolved`/`decision.settled` count,
   :2666-2668) — if it then parks
   diffless, the claim refuses `claim_premature_liveness` (:2570-2572). That is the DESIGNED
   read. `waitingOn` must NOT re-label that member: its decision is settled, so no LIVE
   pending record exists, and D4's derivation rule — waitingOn derives from LIVE pending
   records and event folds, NEVER from the preflight's liveness counts — keeps the two
   vocabularies disjoint.
8. Driver coupling: the corrective nudge on `claim_premature_liveness` (:394-396) fires only
   when reduceMember did NOT suppress the member (:556). D9 routes every waitingOn-class
   member through the SAME suppression (the pinned `!reduced.waiting` clause). One reducer,
   never two truths.
9. The unreachable compound (v1.1, red-team §6): "checkpoint-pause THEN waitingOn sets" cannot
   occur — the spawn flags set only inside `_dispatch`/recovery paths, `_dispatchPass` admits
   only `status === 'pending'` (:2885), and TRANSITIONS permits `pending → working|cancelled`
   only (:134-142), so a paused task is never re-dispatched; checkpoint∧provider_stalled is
   excluded by D8's no-pause clause; checkpoint∧plan_approval is pre-dispatch. D9 pins this as
   the checkpoint⇒not-waiting invariant suite row rather than leaving it emergent.

---

## 6. ACCEPTANCE PINS

Per kind, five pins: START (wait start mints/exposes the field), SHOW (run view + outline +
runs.list expose it), EXIT (the exit event clears it), HONEST (no `working` to a driver while
set), STRIP (the transition does not move the stall marker — driven against the REAL driver
marker per D10's pin mechanics). Plus the #88 pin and the v1.1 invariant/compound rows. Home:
`impl/test/issue10-waiting-vocabulary-red.test.mjs` unless noted. Every fence-less kind
(`capacity_ceiling`, `dispatch_pending`, `plan_approval`, `spawning`) asserts
`since.turnEpoch === null` in its START row (D3).

- **capacity_ceiling**: START — a dispatch hitting the ceiling skip (:2891) mints exactly one
  `task.dispatch_deferred` receipt carrying `{taskId, vendor, ceiling, inFlight,
  taskCreatedSeq}`; the staging RE-DRIVES the pass ≥2 times and counts receipts (re-skips
  idempotent). SHOW — run view/outline/runs.list show `waitingOn.kind ===
  'capacity_ceiling'` with `since.eventSeq === <receipt seq>` while the task sits `pending`
  with a dispatch binding (the #49 staging: two members, ceiling 1). EXIT — a later pass's
  `task.claimed` clears the field. HONEST — reduceMember returns `capacity_ceiling`, never
  `working`; the member is excluded from nudge and claim; `detail.inFlight` read as
  mint-time-frozen. STRIP — minting/clearing the field does not move `stallMarker`
  (wave-driver-red + issue55 rows). #88 — N/A by construction
  (no pause record can exist); pin the vacuity: claimTurn on a ceiling-queued task has no
  pauseId to reserve.
- **dispatch_pending** (v1.1 set): START — a task admitted with an UNCONFIGURED vendor
  (e.g. `vendorRequested: 'grok'`, no grok adapter registered) sits `pending`; grep asserts
  ZERO `task.dispatch_deferred` events; the view shows `waitingOn.kind === 'dispatch_pending'`
  with `since.eventSeq === <task.created seq>` and `detail.reason === 'pre-dispatch'`. SHOW —
  all three surfaces. EXIT — (a) configure the vendor and re-drive: a pass that claims clears
  the field via the task fold; (b) a pass that ceiling-skips mints the receipt and the kind
  flips to `capacity_ceiling` with `since` = the receipt seq (the Arm-2→Arm-1 progression);
  (c) cancellation clears. HONEST — reduceMember returns `dispatch_pending`, never `working`;
  the member is excluded from nudge and claim while the binding sits unattempted. STRIP — the
  field's transitions (including the kind flip to `capacity_ceiling`) do not move the marker.
  #88 — vacuous (task `pending`, no pause record).
- **spawning**: START — stage each window and assert the projection in it: (i) a
  deferred-WORKTREE adapter holds the claim→worktree-ready slice open (`spawnWindow:
  'worktree'`); (ii) a deferred-ack adapter holds the native window open (`spawnWindow:
  'spawn'`); (iii) a recovery-respawn staging holds the third (`spawnWindow: 'recovery'`). In
  all three, `_publicHandle` exposes `spawnPending === true` and the view shows
  `waitingOn.kind === 'spawning'` with `since.eventSeq === <task.claimed seq>`. The
  claim→worktree slice MUST project `spawning` (never `working`, never `null`) — the
  regression row for blocker 1. SHOW — all three surfaces. EXIT — worktree-ready settlement
  slides the window `'worktree'`→`'spawn'` without passing through `null`; ack resolution
  clears the field; a refused/failed spawn (`lifecycle.crashed phase:'spawn'|'worktree'`)
  leaves the member terminal with `waitingOn: null`. HONEST — reduceMember returns `spawning`,
  never `working`, in every window. REFUSAL — `sendMessage` in ANY window returns `{ok:false,
  result:'worker_spawning'}` (typed, retryable), NEVER a TypeError, NEVER a bare `notSent`
  across the facade; unknown worker/run still return `worker_not_active`/`run_not_active`
  (capacity-refusal-visibility shape law: typed refusal → visible cause chain; the
  workflow-surface pins stay green per D13). STRIP — entering/exiting each window does not
  move the marker. #88 — vacuous (no pause record mid-spawn).
- **plan_approval**: START — an approved-pending run (no `plan.approval_decided`) projects
  `waitingOn.kind === 'plan_approval'` on all three surfaces with `detail {planVersion,
  proposalSeq}`; blockedInteraction/requiredAction
  rows in issue10-blocked-interaction-red stay green (details pinned). SHOW — the OUTLINE
  carries it (the 90-minute-loss surface: the driver polls outlines). EXIT —
  `plan.approval_decided` clears it; expiry refuses dispatch with `plan_approval_expired`
  while the view reads phase `approved`, `waitingOn: null` (the stale edge, D7 — pinned, not
  silently absent). HONEST — reduceMember returns `plan_approval` (wave-driver-red row: an
  approval-waiting member no longer renders bare `working`; the driver action is ESCALATE,
  never nudge/claim). STRIP — approval-wait entry does not move the marker. #88 — vacuous
  (pre-dispatch).
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
- **D9 flag-semantics rows (v1.1, blocker 3)**: (a) INVARIANT — for every staged checkpoint
  (`task.status === 'paused'`), assert `worktreeCreationPending === false` ∧
  `nativeSpawnPending === false` ∧ `recoverySpawnPending === false` ∧ `waitingOn === null` —
  the emergent invariant, now pinned; (b) COMPOUND — construct a checkpointed member with
  `waitingOn` forced non-null and assert reduceMember returns the waiting class with
  `{waiting: true, blocked: false}`, the member is EXCLUDED from the `paused` set at :556, and
  the decision lane :560 does not fire — suppression beats claim-admission; (c) SHAPE — every
  reduceMember return carries both flags explicitly (no undefined `blocked`/`waiting`).
- **Digest-asymmetry row (v1.1, red-team §2.2)**: a waitingOn transition MOVES
  `semanticViewDigest` (:259-264) and wakes follow-`changed` consumers (:10853-10857), while
  the SAME transition does not move the driver stall marker (D10) — the deliberate asymmetry,
  pinned in both directions.
- **#88 cross-pin** (claim-preflight-red.test.mjs — rows must NOT move): a claim on a pause
  whose worker has zero counted liveness still falls through to the full gate (CP10); a claim
  with positive read-only liveness and no diff still refuses `claim_premature_liveness`; a
  blocked-then-answered-diffless member still refuses (the DESIGNED read) and is never
  re-labeled by `waitingOn`.

---

## 7. CAMPAIGN-LAW CONSTRAINTS

- NO CLOCKS ANYWHERE IN THIS CHANGE. `provider_stalled` rides the existing
  `health.stall_suspected` mint (D8); `since` stamps are event epochs (D3); the only wall-time
  fields a consumer sees arrive through the pre-existing `_progressTiming` block (:7963+). A new
  `setTimeout`, `Date.now()` delta, or `*Ms` knob in the waitingOn path is a contract violation.
- Additive-only at every surface: no new run phase (D1), no progressClass enum change (D4), no
  attention-item kind (D4), no TRANSITIONS edge (coordination-store.mjs:134-142), no
  canonicalMemberStatus change (story.mjs:24-33). The complete vocabulary additions: one new
  event kind (`task.dispatch_deferred`), one new facade result (`worker_spawning`), and one new
  projection kind (`dispatch_pending` — derived, no mint).
- One reducer owns driver truth (D9); no parallel classification anywhere else.

---

## 8. OPEN QUESTIONS

- **OQ1 — Wave stall basis for an all-waiting wave.** Red-team verdict: SOUND-WITH-CONDITION;
  the condition is recorded here. D10 strips waitingOn from the marker, so a wave whose members
  are ALL in named waits goes byte-static and the wave stall clock FIRES at `stallTimeoutMs`
  (check :708): the claim-on-stall fan-out (:709-716) finds ZERO paused members (waiting
  members are excluded from the set at :556), recovered < total, and the driver EXITS with
  basis `stall` (:736/:738). So an all-capacity-queued wave earns a FALSE `stall` close while
  its members are honestly queued — the runs outlive the driver's exit. That failure is
  VISIBLE-not-silent (unlike #49): the members' `waitingOn` kinds survive the driver's exit on
  every poll. v1 keeps wave-clock semantics unchanged and pins only the strip + reducer
  classes; the deferral is defensible ONLY IF the named driver-policy row is mandatory in the
  implementation plan and stays PER-KIND: a blanket stall-basis exemption would be wrong for
  `plan_approval` (operator-idle ⇒ stall-close IS the correct escalation) and arguably right
  only for `capacity_ceiling`/`spawning`/`dispatch_pending`. Hold the line at implementation.
- **OQ2 — Other prompt lanes in the spawn window.** D11 pins `sendMessage` (:6793). The same
  unguarded deref shape exists at coordinator.mjs:2452, :7288, :7402, :7514, :11089
  (send/nudge/steer lanes). Do they get the `worker_spawning` guard in this landing or a
  follow-up? Recommendation: follow-up, one lane per row, same result string. v1.1 note: the
  deferral is now clean — D6's union covers the full claim→session-ready window, so the driver
  can no longer misread a mid-window member as `working` and nudge it into one of these lanes
  (the two deferrals no longer compound).
- **OQ3 — Push variant.** A `member_waiting` reason kind in the coordinator attention inbox
  (beside `member_terminal` :7060-7087, coalesced per :7075-7086, epoch-marked per `seq` :7063 /
  `mintEpoch` :7066) would let `run.attention.watch` push wait transitions instead of waiting
  for poll. v1 is poll-only (D12); the inbox reason is the designed next rung.
- **OQ4 — `decision_pending` alias.** The enum admits it later (D2) as the fold of the existing
  answer_* attention items; include only if an orchestrator receipt shows the attention items
  alone insufficient at outline depth (where they reduce to a count, :10879-10883).

---

## 9. VERIFICATION NOTE

Every line citation above was re-grepped/`sed -n`-read against the working tree at `0ad4d4a` +
dirty receipt files on 2026-08-06 (NUL-byte files — coordinator.mjs, application.mjs,
coordination-store.mjs, wave-driver.mjs, claude-session.mjs — read via grep -an + sed -n only).
Issue texts: `gh issue view 10|49|50|55|97` on the same date. The #88 contract doc's CP4 shape
law verified at claim-preflight-contract.md:220-228 against the live preflight (:2616-2680).
v1.1 fold: every new and corrected citation re-verified against HEAD `523111f` on 2026-08-06
(impl tree identical through `7821856`); the v1.0 citation list was spot-audited by the red
team (30+ anchors, substance intact everywhere; 13 drifts, §10).

## 10. CITATION DRIFT LEDGER (memo → current tree)

| Memo citation | Current | Note |
|---|---|---|
| coordination-store.mjs:10718-10745 createPlanGatedTask | :10895-10933; atomic batch mint :10927-10931 | drifted ~177 lines; substance identical |
| coordination-store.mjs:7708 task.claimed fold | :2279 | fold location re-pinned |
| coordination-store.mjs:11284-11293 node/task states | :11283-11291 (node default `blocked` :11284) | intact modulo one line |
| coordinator.mjs:6871 untyped deref | :6868 | one-line drift |
| coordinator.mjs:2617 preflight | :2616; `counted===0→ok:true` :2672 | one-line drift |
| coordinator.mjs:3818-3851 _onSpawnRefused | :3820-3855; crash append :3836-3850 | two-line drift |
| coordinator.mjs:4527 handle `pending` | :4525 | two-line drift (`:4526` is `pendingApprovalId`) |
| coordinator.mjs:2637-2639 pending-never-count comment | :2634-2638 | re-pinned |

### v1.1 correction table (red-team §1 drift table, applied; verified against HEAD `523111f`)

| v1.0 citation | Corrected | Applied at |
|---|---|---|
| G1 atomic batch `:10928-10931` | `_appendBatch([` opens `:10927` | G1, §10 |
| G2 dep gate `:2888` | `:2886` | G2, D5 |
| G3 fence registers `:3484` | `:3482` | G3, D3, D6 |
| G3 spawn-crash append `:3838-3850`, `phase:'spawn'` pin `:3829` | append opens `:3836` (`kind:` `:3840`, `phase,` `:3845`); `const phase = worktreeFailure ? 'worktree' : 'spawn'` `:3827` | G3, D6, §3 |
| G4 claude-session bare refusal `:1380` | `:1381` | G4, D11 |
| G5 task back to `working` `:12733-12736` | `:12735-12737` | G5 |
| G8 `progressBlockedDetail :387-396` | opens `:389` | G8 |
| G9 stall clock "fires at `:709`" | check fires `:708`; `:709` is the claim-on-stall branch | G9, OQ1 |
| G12 attention inbox seq+mintEpoch `:7063-7064` | `seq` `:7063`, `mintEpoch` `:7066` | G12, D3, OQ3 |
| G12 `member_terminal :7059-7087` | `:7060-7087` | G12, D12, OQ3 |
| G12/ledger handle `pending` `:4526` | `:4525` (`:4526` is `pendingApprovalId`) | G12, §10 |
| D4 `blocked_interaction:approve_plan (:388-389)` | return at `:390` | D4, §3 |
| D3 `_progressTiming :7962+` | `:7963+` | D3, §7 |

All other G1-G12 anchors verified exact at `523111f` (30+ spot-checked by the red team;
substance intact everywhere). The v1.0 final row ("All others … verified intact") was false in
detail — this table replaces it.
