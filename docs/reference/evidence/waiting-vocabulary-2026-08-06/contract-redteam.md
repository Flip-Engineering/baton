# Red team — waiting-vocabulary implementation contract (issue #10 blocked-state half)

Date: 2026-08-06. Target: `waiting-vocabulary-contract.md` (this directory, v1.0, commit `10da97f`).
Method: every attack executed against HEAD `10da97f` (tree identical to the contract's verification
base for `impl/src` — the only later commit is the contract doc itself). NUL-byte files
(`coordinator.mjs`, `application.mjs`, `coordination-store.mjs`) read via `grep -an` + `sed -n`
only. 30+ anchors spot-checked (12 required); all nine attack surfaces walked.

**Verdict: NOT FOLD-READY — 3 blockers.** The architecture (additive field, event-epoch `since`,
strip-from-marker, one reducer) is sound and the citation work is substantively accurate; the holes
are (1) the `spawning` projection window is narrower than the contract's own refusal lane, leaving a
bare-`working` slice at exactly the point #97 burned; (2) the `capacity_ceiling` receipt-keyed rule
leaves two silent-pending paths projecting the #49 lie; (3) D9's suppression mechanics are
flag-ambiguous and safe today only by an emergent, un-pinned invariant.

---

## 1. CITATION AUDIT (attack surface 1)

30+ anchors verified against HEAD. Substance: intact everywhere — every mechanism the contract
describes exists where and as described. Line numbers: the contract's §10 ledger final row
("All others (G1-G12 anchors) | as cited | verified intact") is **false in detail**. Drift found
(all ±1–2 lines, none substantive):

| Contract citation | Actual at HEAD | Delta |
|---|---|---|
| G2 dep gate `coordinator.mjs:2888` | `:2886` | −2 |
| G3 fence registers `:3484` | `:3482` | −2 |
| G3/D6 spawn crash append `:3838-3850` | append opens `:3836`, `kind: 'lifecycle.crashed'` `:3840`, `phase,` `:3845` | −2 |
| G3 `phase:'spawn'` pin `:3829` | `const phase = worktreeFailure ? 'worktree' : 'spawn'` at `:3827` | −2 |
| G8 `progressBlockedDetail :387-396` | function opens `:389` | +2 |
| D4 `blocked_interaction:approve_plan (:388-389)` | return at `:390` | +1 |
| G5 task back to `working` `:12733-12736` | `:12735-12737` | +2 |
| G12 attention inbox seq+mintEpoch `:7063-7064` | `seq` `:7063`, `mintEpoch` `:7066` (memo had it right) | +2 |
| G12/ledger handle `pending` `:4526` | `status: 'pending'` at `:4525` (`:4526` is `pendingApprovalId`) | −1 |
| G9 stall clock "fires at `:709`" | check fires `:708` (`:709` is the claim-on-stall branch) | −1 |
| G4 claude-session bare refusal `:1380` | `:1381` | +1 |
| G1 atomic batch `:10928-10931` | `_appendBatch([` opens `:10927` | −1 |
| D3 `_progressTiming :7962+` | `:7963` | +1 |

Anchors verified **exact** (sample of the 12+): `:5694`/`:5702`/`:7420`/`:7429` phase ladders; `:7106`
workflow ladder; `createPlanGatedTask :10895`; ceiling skip `:2891`; in-flight set `:3002-3009`;
re-drives `:1449/:3860/:9374/:13200`; `task.claimed` key `:3473`; `nativeSpawnPending` set/clear
`:3696`/`:3724`; spawn call `:3699`; ack consumed `:3717-3722`; optimistic `working` `:3737-3743`;
optimistic `lifecycle.spawned` `:3666-3684`; `_onSpawnRefused :3820`; `_publicHandle :6703`, status
`:6744` (no `nativeSpawnPending` today — G3 confirmed); `sendMessage :6793`, `worker_not_active
:6831`, `run_not_active :6836`, unguarded deref `:6868`; `_armWatchdog :8665`, working-only guard
`:8667`, suspicion mint `:8674-8678` (kind `:8676`, one-shot `:8673`), `_observeWatchdogEvent`
worker-actor-only `:9078-9080`; preflight `:2616`, pending-never-count comment `:2634-2638`,
`counted===0→ok :2672`; `turn.paused :2097`, pauseId `:2100`; question/approval/decision blocked
flips `:12567`/`:12613-12616`/`:12721`; attention reductions `:10879-10885`; runs.list `:11703-11721`;
`_activityProjection :7934`, run level `:7763`; TRANSITIONS `:134-142`; task fold `:2277-2280`;
node states `:11283-11291` (default `blocked :11284`); `plan_approval_expired :10707`;
`ATTENTION_COALESCE_WINDOW_MS :46`; `member_terminal :7060-7087`; adapter ceilings `:484/:546/:613/
:634`; stallMarker `:168-174`; reduceMember `:200-214`; issue55 pin `:186-190`.

Also verified negative-space claims: no `waitingOn`/`task.dispatch_deferred`/`worker_spawning`
anywhere in `src/` or `test/` today; no event-kind registry and no unknown-kind throw in any fold
(a new coordination event kind is a no-op through every existing reducer — D5 is fold-safe).

**Ledger verdict: HOLE (cosmetic).** A drift ledger that missed its own drift. Fix: correct the 12
rows above; keep the memo's `:7066` mintEpoch pin. No design impact.

## 2. ADDITIVE-FIELD LAW (attack surface 2) — SOUND, with two documentation gaps

Consumers of the run view / outline / runs.list enumerated and checked for closed shapes:

1. **Wave driver `stallMarker`** — hashes the full member status view (`status?.view ?? status`,
   wave-driver.mjs:533-537). Without D10's strip, waitingOn transitions would flap the hash. The
   contract names this; strip is necessary AND sufficient (§5 below).
2. **`semanticViewDigest` (application.mjs:259-264)** — strips only `cursor`/`progressClass`/
   `requiredAction`. waitingOn WILL move `viewDigest`, hence `_semanticActionId` ids (:8212) and
   follow-`changed` wakes (:10855). Safe because waitingOn is event-derived (no wall-time flap),
   and wait transitions waking followers is arguably correct — but the asymmetry (stripped in
   stallMarker, kept in semanticViewDigest) should be a deliberate pinned decision, not an accident.
3. **MCP northbound** — input schemas are closed (`additionalProperties: false`,
   mcp-northbound.mjs:268) but outputs are passthrough `structuredContent` (:192-193);
   `fleet_run_status` (:367) returns the view verbatim. Additive-safe.
4. **CLI** — phase64's deepEquals pin outline SUB-objects (`outline.progress`, `outline.resources`,
   :108-131), never the whole outline. Safe.
5. **`runGroupSummary` (application-client.mjs:240-270)** — named-field picks only. Safe.
6. **Outline / runs.list builders are explicit allowlists** (:10870-10898, :11703-11721) — the
   field must be added deliberately at all three surfaces; a view-only implementation silently
   drops outline/runs.list. The SHOW pins cover all three surfaces, so this is caught.
7. **Historical profile outline (`_historicalProfileInspection`, :10570-10605)** — the contract is
   silent. `spawning` (live flag) and the live-flag edge of `provider_stalled` are NOT replayable;
   `capacity_ceiling`/`plan_approval` are event-derived and replayable. The contract should say
   what a cursor-pinned historical inspection shows (omit the field, or document live-only).
   Minor gap, not a blocker.
8. **story.mjs** — member states fold from events, not view fields. Untouched, as required by §7.

No closed-shape consumer breaks. Verdict: SOUND (gaps 2 and 7 deserve one line each in the
contract).

## 3. PER-KIND MINT/EXIT HONESTY (attack surface 3)

### capacity_ceiling — HOLE (blocker 2)

Exit honesty is fine: TRANSITIONS permits `pending → working|cancelled` only (:134-142), so claim
and cancellation both un-match the rule (task.status leaves `pending`); a never-clearing ceiling
keeps the field set and that is the HONEST state (escalation is the wave clock, OQ1). Idempotency:
`task.dispatch_deferred:<taskId>:<taskCreatedSeq>` mints once; `task.created` is once-per-task and
revisions mint new tasks, so no duplicate and no cross-revision collision.

The hole: **the rule keys on the receipt, and the receipt mints only at the `:2891` ceiling
`continue`.** `_dispatchPass` has two other silent-pending exits that mint nothing:

- drain closed (`:2882` early return) — transient, but the member is invisible for its duration;
- vendor unresolved (`:2889` `if (!vendor || !this._adapters[vendor]) continue;`) — a task bound to
  an unconfigured vendor sits `pending` **forever**, no receipt, phase `running`, `waitingOn:
  null`, reduceMember `working`. The #49 lie verbatim, wearing a narrower coat.

D5's rationale ("the mint site is exactly the ceiling continue … so a dep-blocked task is never
mislabeled") is correct for what it covers and silent about what it doesn't. Fix (either):
(a) make the projection rule `node.taskId bound ∧ task.status==='pending' ∧ (receipt ⇒
capacity_ceiling with since=receipt) ∨ (no receipt ⇒ capacity_ceiling with detail.reason
'pre-dispatch', since=task.created seq)` — the receipt stays the precise cause when it exists, and
no pending-with-binding state goes unnamed; or (b) keep the rule and prove the gap unreachable —
pin that admission validates vendor resolvability (so `:2889` is dead code for admitted tasks) and
bound the drain-closed window — plus an OQ entry. Option (a) is one rule change and no new event;
(b) is a reachability proof the contract currently does not contain.

Secondary note: `detail.inFlight` is mint-time data (idempotent receipt ⇒ frozen count). Fine as a
historical record; the contract should say consumers must not read it as live queue depth.

### spawning — HOLE (blocker 1)

Flag lifecycle is honest: set `:3696`, cleared in `.finally :3724` on ANY settlement; refusal →
`_onSpawnRefused :3820` → terminal ⇒ no waitingOn. A hung spawn (no `timeoutMs`) sticks the flag —
honest (the spawn IS in flight); escalation rides the wave clock. The claim→session-ready truth
(adapter `lifecycle.spawned` claude-session.mjs:1101) is correctly identified.

The hole: **D6's projection rule (`nativeSpawnPending === true`) does not cover the
claim→flag slice, and the contract's own D11 refusal lane does.** Between `task.claimed` (:3473)
and `:3696` the coordinator does real, slow work — worktree creation (`worktreeCreationPending =
true` at `:3550`, cleared `:3659`) and the optimistic mints. During that slice:

- `_publicHandle` projects `working` with no flag → run view `waitingOn: null` → reduceMember
  returns bare `working` — the exact sin this contract exists to kill;
- D11's guard (flag `OR` adapter-session-absent-while-non-terminal) DOES refuse `worker_spawning`
  there (claude-session creates its session entry only at `:827`, inside spawn) — so the refusal
  lane and the projection DISAGREE in the same window;
- the wave driver, reading `working`, may nudge/claim into the OQ2-deferred unguarded lanes
  (`:2452/:7288/:7402/:7514/:11089` — all five verified as the same unguarded deref shape). The
  two deferrals compound precisely in this window.

There is also a THIRD pending-spawn signal the coordinator itself treats as spawn-waiting at
`:2014` — `recoverySpawnPending` (set `:5338/:5748`). D6 projects one of the three flags the
coordinator's own authority check unions.

Fix: the `spawning` rule keys on the union the coordinator already trusts —
`handle.nativeSpawnPending === true || handle.worktreeCreationPending === true ||
handle.recoverySpawnPending === true` — or move the flag set to immediately after `claimTask`
(:3479) so one flag covers the whole window; `since.eventSeq` stays the `task.claimed` seq in
either reading. Add a START pin that stages the worktree slice (a deferred-worktree adapter), not
just a deferred-ack adapter.

Also: D6's "replay-honest" overclaims. The flag is volatile coordinator memory; reconstruction
sets `nativeSpawnPending: false` (:14052-14053). Post-restart the member reads `orphaned` via the
recoveryPending mask (:6744) — no bare-working lie, but say "live-state projection, reconstructs
to null", not "replay-honest".

### plan_approval — SOUND with one stale-exit note

Pure fold of `:5694/:7106/:7420`; exit on `plan.approval_decided` is exact. The TTL exit
(`plan_approval_expired :10707`) is a dispatch-time REFUSAL, not a state transition: an approval
that has gone stale still EXISTS (disposition `approved`), so the ladder leaves
`awaiting_plan_approval` → phase `approved` → `waitingOn: null` — and the run can never dispatch
without re-approval. Pre-existing gap, not created by this contract, but the contract's exit
column overstates: expiry is invisible at view level. One line in D7 should name the
expired-but-approved view state (`approved`, not waiting — and the re-proposal path, or its
absence). `detail` for plan_approval is unspecified in §3's table while the shape law requires the
key — specify it (e.g., `{planVersion, proposalSeq}`) or the field arrives implementer-chosen.

### provider_stalled — SOUND

Working-only mint (:8667), one-shot per turn (:8673), epoch-stamped (:8675 `_safeTurnEpoch`) —
D8's fold (status `working` ∧ suspicion in current epoch ∧ no later `actor==='worker'` event ∧ no
pause record / pending interaction) is implementable exactly as written over the worker log.
Revival = the same stream the watchdog touch reads (:9078-9079). Stuck-set cases are honest: a
failed stallAction interrupt leaves the member stalled AND projected stalled (the wave clock is
the escalation, OQ1); a terminal stallAction flips status off `working` and clears the field.
Blocked/paused exclusions are pinned by D8's clauses and by §5's proof. No new clock — the
grep-able pin is enforceable.

## 4. THE HONEST-NULL LAW (attack surface 4) — HOLE (blocker 3)

What reduceMember returns while waiting: per D9, `{class: <kind>, waiting: true}` — NOT a
progressClass (progressClass derivation is unchanged; during a ceiling wait it reads `silent`,
which is factually true; no enum addition, so no registration is needed — the class is a
driver-internal label rendered via `classByRole` :553 and the `classes` array :583).

The hole is mechanical: **the suppression at :556-558 keys on `reduced.blocked`, and D9's shape
`{class, waiting: true}` does not set `blocked`.** D9's prose says waiting members feed "the same
suppression blocked: true feeds at :556-558", but as literally specified they do not. Today this
is vacuously safe ONLY because of an emergent invariant — no waitingOn kind can co-occur with a
checkpoint (capacity_ceiling ⇒ `pending`; spawning ⇒ pre-turn; plan_approval ⇒ pre-dispatch;
provider_stalled ⇒ D8's no-pause clause) — so a waiting member never enters the `paused` set
anyway. Emergent is not pinned: a future kind (or a bug in the exit rules) that violates the
invariant silently re-admits a waiting member to claim/nudge, and the decision lane's
`reduced.gated.kind` (:560) would deref `gated` under `blocked` semantics that were never defined
for the waiting shape.

Fix: pin the flag contract — either the waiting return carries `blocked: true` (with
`gated: null, interactions: []` and the decision lane's access guarded), or :556/:560 become
`reduced.blocked || reduced.waiting`. Plus one constructed compound-state row (a checkpointed
member with `waitingOn` forced non-null) proving suppression.

Downstream re-checks otherwise clean: the claim cadence and the D9 claim-on-stall fan-out
(:709-716) consume only the `paused` set; the `claim_premature_liveness` corrective nudge
(:394-396) fires only inside the claim path; the recovered-count loop (:721-733) reads phase/
terminal, additive-safe.

## 5. THE STALL-MARKER STRIP (attack surface 5) — SOUND

The oscillation attack fails by construction: with `delete view.waitingOn` beside :170-172, the
marker is blind to the field in BOTH directions — waitingOn↔clear churn moves nothing, so no #55
chatty-idler farm is possible through this field. Real liveness still moves the marker through
`activity.*` (verified present in the driver-hashed view — issue55's :186-190 asserts
`outline.activity.providerCalls` on the same `run.status()` response and the marker move at
:188-190), and `activity` is NOT stripped — a genuinely-active member cannot hide behind the
strip, and a genuinely-waiting member is byte-static by design. `detail` for all four kinds is
static-per-wait (idempotent receipt / per-suspicion snapshot), so even WITHOUT the strip the
field would flap only on real transitions — the strip is defense-in-depth, correctly taken.

Pin-mechanics note (not a blocker): the driver's `stallMarker` is not exported, and issue55's
suite uses a LOCAL marker helper that strips only `cursor` (issue55-stall-liveness-red.test.mjs
:137-142). A new STRIP row that copies that helper will see waitingOn transitions MOVE the marker
and fail against a correct implementation. The STRIP pin must drive the real wave-driver marker
(export the helper or go through `createWaveDriver`), and the D13 note for issue55 should say the
local helper is not the driver law.

## 6. THE #88 INTERACTION (attack surface 6) — SOUND

The contract's vacuity proof checks out clause by clause, and the constructed edge is
**unreachable**: "checkpoint-pause THEN waitingOn sets" requires a paused task to re-enter a wait
kind, but (a) `nativeSpawnPending` is set only inside `_dispatch` (:3696), (b) `_dispatchPass`
admits only `status === 'pending'` (:2885), and (c) TRANSITIONS permits `pending →
working|cancelled` only (:134-142) — a paused task can never be re-dispatched, so
checkpoint∧spawning (and checkpoint∧capacity_ceiling, which needs `pending`) cannot co-occur;
checkpoint∧provider_stalled is excluded by D8's own no-pause clause; checkpoint∧plan_approval is
pre-dispatch. What wins is moot — the state does not exist — but because this safety rests on the
same emergent invariant as blocker 3, pin it: `task.status==='paused' ⇒ nativeSpawnPending ===
false` and `waitingOn === null`.

Reverse edge verified as designed: the counted set (:2654-2666) includes `question.answered`/
`approval.resolved`/`decision.settled` while the comment at :2634-2638 bars PENDING interactions —
so a blocked-then-answered-diffless member still refuses `claim_premature_liveness` (:2569-2572)
and is never re-labeled by waitingOn (D4's live-records-only derivation). The two vocabularies
are disjoint as claimed. claim-preflight-red rows genuinely need not move.

## 7. THE #97 TYPED REFUSAL (attack surface 7) — SOUND (contingent on blocker 1)

- FP-03's verbatim pins (workflow-surface-red.test.mjs:568 `worker_not_active`, :574
  `run_not_active`) stage a never-spawned worker and an empty run — both paths are untouched by
  D11's guard (existing handle ∧ mid-window). The pins stay green; the suite does not need to
  move (D13's silence about it is correct).
- No caller keys on the exact code: `worker_not_active` appears only in coordinator.mjs across
  src; the facade passes outcomes verbatim (`deepFreeze({schemaVersion: 1, ...outcome})`,
  application.mjs:12621). The "never padded with fabricated fields" doctrine (:568 comment) is
  not violated by `{workerId, runId}` riding the coordinator's own return.
- Unknown ≡ foreign holds: authorization precedes the lane (:12608), and unresolvable workers
  authorize against the null scope — `worker_spawning` can only reach an already-authorized
  principal for a run they may observe. No existence leak.
- D11's session-absent disjunct is adapter-exact for claude-session (session entry created :827,
  never deleted) but asserted against ALL adapters. Folded into blocker 1's fix: the
  flag-union rule makes the disjunct unnecessary for the projection, and the refusal lane should
  pin per-adapter session-lifecycle behavior or restrict the disjunct to adapters whose teardown
  is verified (a retryable-labeled refusal for a torn-down session would be a new lie).

## 8. ACCEPTANCE-PIN AUDIT (attack surface 8) — adequate matrix, four soft spots

The five-per-kind matrix (START/SHOW/EXIT/HONEST/STRIP) blocks the obvious shallow greens: a
field that sets-but-never-clears dies on EXIT; an un-keyed mint dies on START's "exactly one
receipt (re-skips idempotent)" — PROVIDED that test actually re-drives the pass ≥2 times and
counts receipts; say so explicitly. Soft spots: (1) no START row stages the claim→flag slice
(blocker 1); (2) no row stages vendor-unresolved/drain-closed pending (blocker 2); (3) no row
pins the checkpoint⇒not-waiting invariant (blocker 3); (4) no row pins the semanticViewDigest
asymmetry (§2.2). The provider_stalled "no new timer" grep-able law is good; add the
`since.turnEpoch === null` assertion per D3 for the fence-less kinds.

## 9. THE FOUR OQs (attack surface 9)

- **OQ1 — SOUND-with-condition.** The feared shape (a wave sitting `stalled` forever with every
  member legally waiting) cannot occur AT THE DRIVER LEVEL: stripped waitingOn ⇒ all-waiting wave
  is byte-static ⇒ the wave clock fires at `stallTimeoutMs` (:708) ⇒ the driver EXITS with basis
  `stall` (claim-on-stall fan-out finds zero paused members, recovered < total ⇒ `stall`). The
  actual defect is the opposite: an all-capacity-queued wave earns a FALSE `stall` close while its
  members are honestly queued (the runs outlive the driver's exit). That is visible-not-silent —
  unlike #49 — so v1 deferral is defensible ONLY IF the named driver-policy row is mandatory in
  the implementation plan and stays per-kind: a blanket stall-basis exemption would be wrong for
  `plan_approval` (operator-idle ⇒ stall-close IS the correct escalation) and arguably right only
  for `capacity_ceiling`/`spawning`. The contract's OQ1 text already frames it per-kind; hold the
  line at implementation.
- **OQ2 — SOUND, contingent on blocker 1.** All five deferred lanes verified as the same
  unguarded deref (`:2452`, `:7288`, `:7402`, `:7514`, `:11089`). Deferral is clean only once the
  projection covers the full claim→session-ready window; until then the driver can nudge a
  member it misreads as `working` into an unguarded lane. One-lane-per-row follow-up stands.
- **OQ3 — SOUND.** Poll-only v1; the inbox machinery (epoch marks :7063/:7066, coalesce
  :7076-7086) is ready to ride when the push variant lands.
- **OQ4 — SOUND.** `decision_pending` is fully projected through the interactions lane at driver
  depth and the attention count at outline depth; an alias adds nothing without a receipt.

## 10. PER-DECISION VERDICTS

| Decision | Verdict |
|---|---|
| D1 additive field, never a phase | SOUND (consumers enumerated, §2) |
| D2 four v1 kinds | SOUND in scope; HOLE in the completeness claim (blocker 2's unnamed paths) |
| D3 event-epoch since | SOUND |
| D4 honest-null law | SOUND in substance; HOLE in D9's mechanics (blocker 3) |
| D5 durable deferral receipt | HOLE — receipt-only rule leaves :2882/:2889 silent (blocker 2) |
| D6 spawning projection | HOLE — flag-only rule misses claim→flag + recovery windows (blocker 1) |
| D7 plan_approval fold | SOUND (specify `detail`; name the expired-but-approved state) |
| D8 provider_stalled fold | SOUND |
| D9 reduceMember classes | HOLE — `blocked` vs `waiting` flag semantics un-pinned (blocker 3) |
| D10 stall-marker strip | SOUND (pin-mechanics note §5) |
| D11 worker_spawning refusal | SOUND, contingent on blocker 1's window fix |
| D12 v1 surfaces | SOUND (historical-outline silence noted, §2.7) |
| D13 suite impact | SOUND (add: STRIP-pin mechanics note; workflow-surface stays green) |

## 11. BLOCKERS

1. **`spawning` window mismatch (D6 vs D11).** Projection keys on `nativeSpawnPending` only;
   the claim→flag slice (worktree creation, `:3473-:3696`) and the recovery-respawn window
   (`recoverySpawnPending`, `:5338/:5748`) project bare `working` while D11's own refusal lane
   already treats the slice as spawning. Fix: union rule (`nativeSpawnPending ||
   worktreeCreationPending || recoverySpawnPending`, the same union as `:2014`) or set the flag
   at claim time; add a worktree-slice START pin.
2. **Unnamed silent-pending paths (D5).** Drain-closed (:2882) and vendor-unresolved (:2889)
   skips mint nothing, leaving task `pending` + phase `running` + `waitingOn: null` +
   reduceMember `working` — the #49 lie survives. Fix: extend the projection rule to cover
   pending-with-binding sans receipt (`detail.reason: 'pre-dispatch'`, since = task.created seq),
   or pin a reachability proof and scope the gap explicitly.
3. **D9 suppression flag ambiguity.** `{class, waiting: true}` does not feed the
   `reduced.blocked`-keyed suppression at :556-558 as written; safety rests on an emergent,
   un-pinned checkpoint⇒not-waiting invariant. Fix: pin `blocked: true` on the waiting shape (or
   `blocked || waiting` at :556/:560), guard the `:560` gated access, and pin the invariant
   (`paused ⇒ nativeSpawnPending === false`, compound-state suppression row).

Everything else is foldable as written. Re-verify after the three fixes land; the corrected drift
rows in §1 should ride the same revision.
