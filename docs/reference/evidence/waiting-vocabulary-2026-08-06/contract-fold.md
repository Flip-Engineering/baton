# Fold summary — waiting-vocabulary contract v1.0 → v1.1

Date: 2026-08-06. Source: `contract-redteam.md` (this directory; verdict NOT FOLD-READY, 3
blockers). Target: `waiting-vocabulary-contract.md` (this directory), now **v1.1**. Every new
and corrected citation re-verified against HEAD `523111f` (impl tree identical through
`7821856`; NUL-byte files — coordinator.mjs, application.mjs, coordination-store.mjs,
wave-driver.mjs, claude-session.mjs — read via `grep -an` + `sed -n` only). Only the contract
and this summary were edited.

## Blocker → change map

### Blocker 1 — spawning windows uncovered → D6 amended (union rule chosen)

- **Decision:** projection keys on the coordinator's own spawn-pending union —
  `worktreeCreationPending || nativeSpawnPending || recoverySpawnPending` (:2014-2015, the
  predicate `_ownsLocalResources` (:2008) already trusts for local authority). `_publicHandle`
  (:6703) projects two derived additive fields: `spawnPending` (boolean) + `spawnWindow`
  (`'worktree'|'spawn'|'recovery'`).
- **Rejected alternative (set the flag at claim, :3479):** (i) widens `nativeSpawnPending`'s
  span for its other readers — the `lifecycle.process_started` validity check at :12141 and the
  `.finally` clear at :3724 assume the flag brackets the adapter attempt; an early exit between
  :3482 and :3696 (e.g. :3540-3542) would strand it set on a dead handle; (ii) still misses the
  recovery-respawn window (`recoverySpawnPending` is a separate flag, :5338/:5748) — the union
  is needed regardless; (iii) the union is projection-only, zero coordinator state change.
- **Covered windows named explicitly in D6 (verified):** claim→worktree-ready (set :3550,
  cleared :3659, `worktreeReady` gate :3660); native spawn pending (set :3696, spawn :3699,
  cleared :3724); recovery respawn (set :5338/:5748, cleared :5360/:5778). `since.eventSeq` =
  the member's `task.claimed` store seq in all three windows; `turnEpoch: null`.
- **D11 contingency resolved:** the `worker_spawning` refusal guard keys on the same union, so
  lane and projection cannot disagree; the session-absent disjunct is restricted to adapters
  with a pinned session lifecycle (claude-session: entry created :827, never deleted).
- **Row shapes:** §6's spawning START pin now stages all three windows — a deferred-WORKTREE
  adapter (the claim→flag slice), a deferred-ack adapter (native window), and a
  recovery-respawn staging — each asserting kind `spawning`, the right `detail.window`, and
  `since` = the claim seq; the claim→worktree slice projecting `spawning` (never `working`,
  never `null`) is the blocker-1 regression row.
- **Honesty wording fixed:** "replay-honest" → live-state projection, reconstructs to null
  (flags reconstruct false :14052-14056; post-restart the `recoveryPending` mask :6744 reads
  `orphaned` — no bare-`working` lie).

### Blocker 2 — silent dispatch exits → D5 amended (fallback projection; fifth kind)

- **Reachability proof (the report's option b) evaluated: FAILS.** `_resolveVendor`
  (:2916-2950) resolves at dispatch time — explicit route can return null (:2917-2924), auto
  route can return null (:2950) — and admission stores `vendorRequested` durable (:4395/:4468)
  with no adapter-configured validation. So the vendor-unresolved skip (:2889) is live code for
  admitted tasks (the grok/quota-style case: the task sits `pending` forever) and the
  drain-closed return (:2882) is reachable transiently. The fallback projection is mandatory.
- **Decision:** D5 becomes a two-arm rule. Arm 1 unchanged (receipt ⇒ `capacity_ceiling`,
  `since` = receipt seq). Arm 2 (NEW): binding ∧ `task.status === 'pending'` ∧ no receipt ⇒
  **`dispatch_pending`**, `since` = `task.created` store seq, `detail {vendorRequested,
  reason: 'pre-dispatch'}`.
- **Name decision:** `route_unavailable` REJECTED — it collides with existing closed error
  codes (route-liveness.mjs:182, application-deployment.mjs:1083) and over-asserts a routing
  cause for the drain-closed and pre-first-pass slices. `dispatch_pending` asserts only the
  observable: no dispatch pass has committed an outcome (claim or receipt). Honesty rule
  pinned in D5: persistence is the signal; the kind never claims misconfiguration.
- **Enum impact:** D2 four kinds → five; D9 gains the fifth class; §3 table gains the row; §7's
  vocabulary-additions line gains "one new projection kind (derived, no mint)". Arm-2→Arm-1
  kind flip (`dispatch_pending` → `capacity_ceiling` on a later ceiling-skip) is the honest
  cause-chain progression, pinned as an EXIT row.
- **Row shapes:** §6 gains the full `dispatch_pending` five-pin set (START stages an
  unconfigured-vendor admission and greps ZERO `task.dispatch_deferred` events; SHOW three
  surfaces; EXIT (a) claim, (b) kind flip, (c) cancellation; HONEST reducer class; STRIP).
- **Secondary note folded:** `detail.inFlight` is mint-time-frozen receipt data, never live
  queue depth (D5 Arm 1, §3 row).

### Blocker 3 — D9 blocked-flag semantics → D9 amended (flags + invariant pinned)

- **Decision:** distinct flags, not `blocked: true` on the waiting shape. Every reduceMember
  return carries BOTH flags explicitly: waiting shape = `{class, blocked: false, waiting: true,
  gated: null, interactions: []}`. Suppression mechanics pinned: wave-driver.mjs:556 becomes
  `if (checkpoint && !reduced.blocked && !reduced.waiting)`. The decision lane :560
  (`reduced.blocked && reduced.gated.kind`) is UNTOUCHED — branch 1 is the only `blocked: true`
  shape and always carries non-null `gated`; waiting shapes never enter the lane.
- **Rejected alternative (waiting shape carries `blocked: true`):** conflates the interaction
  vocabulary with the wait vocabulary for every `blocked` consumer, and forces a guard on the
  :560 `gated` deref that distinct-flags leaves unnecessary.
- **Precedence pinned:** interaction (blocked) > waitingOn (waiting) > checkpoint > working.
  Waiting outranks checkpoint: suppression is the safety property; if the compound ever occurs
  (future kind or exit-rule bug), suppression beats claim-admission. Unreachable while the
  invariant holds — which is now pinned, not emergent.
- **Invariant as suite row (§6):** (a) INVARIANT — `task.status === 'paused'` ⇒ all three
  spawn flags false ∧ `waitingOn === null`; (b) COMPOUND — checkpointed member with forced
  non-null `waitingOn` ⇒ waiting class returned, excluded from the `paused` set at :556,
  decision lane silent; (c) SHAPE — both flags explicit on every return.

## Non-blocker folds (report §2/§3/§5/§8 — the "foldable as written" remainder)

- **D7:** `detail {planVersion, proposalSeq}` specified; the expired-but-approved view state
  named (TTL is a dispatch refusal, not a transition — phase `approved`, `waitingOn: null`).
- **D10:** STRIP pins must drive the REAL driver marker (:168-174 — export or go through
  `createWaveDriver`); issue55's local helper (issue55-stall-liveness-red.test.mjs:137-142,
  strips only `cursor`) is not the driver law.
- **D12:** historical-inspection line (`_historicalProfileInspection` :10570-10605 — `spawning`
  is live-only, omitted from replays) and the semanticViewDigest asymmetry line (:259-264 —
  waitingOn moves the digest by deliberate decision; pinned as a §6 row in both directions).
- **D13:** workflow-surface-red.test.mjs named MUST-NOT-MOVE (its :568/:574 pins stage paths
  untouched by the D11 guard); capacity_ceiling START now explicitly re-drives the pass ≥2×
  and counts receipts; fence-less kinds assert `since.turnEpoch === null`.
- **§5:** proof re-walked for five kinds; the unreachable-compound clause (red-team §6) added.
- **G9:** `BLOCKING_INTERACTION_KINDS` (:185-187 — answer_* only; `approve_plan` never enters
  the reducer's interactions input) recorded.

## OQ verdicts applied (report §9)

- **OQ1 — SOUND-WITH-CONDITION, condition recorded (§8):** the all-waiting wave's stall clock
  STILL FIRES (:708): stripped waitingOn ⇒ byte-static ⇒ claim-on-stall fan-out (:709-716)
  finds zero paused members ⇒ driver exits basis `stall` (:736/:738). An all-capacity-queued
  wave earns a FALSE stall close while honestly queued — visible-not-silent (unlike #49). v1
  keeps wave-clock semantics; the deferral holds ONLY IF the driver-policy row stays mandatory
  and PER-KIND (blanket exemption wrong for `plan_approval`; arguably right only for
  `capacity_ceiling`/`spawning`/`dispatch_pending`).
- **OQ2 — SOUND; contingency discharged:** D6's union covers the full claim→session-ready
  window, so the driver can no longer misread a mid-window member as `working` and nudge it
  into the unguarded lanes (:2452/:7288/:7402/:7514/:11089). One-lane-per-row follow-up stands.
- **OQ3 — SOUND:** poll-only v1; inbox machinery anchors corrected (:7063/:7066).
- **OQ4 — SOUND:** no alias without a receipt.

## Drift ledger (report §1)

All 12 reported drift rows applied, plus the `member_terminal :7059-7087 → :7060-7087` fix the
report's exact-list implied but its table omitted — 13 corrections, now §10's v1.1 correction
table. The v1.0 ledger's final row ("All others … verified intact") was false in detail and is
replaced. The memo's `:7066` mintEpoch pin kept.

## Deferred / rejected

- **Deferred:** OQ1 stall-basis policy row (to the implementation plan, per-kind, mandatory);
  OQ2's five unguarded lanes (follow-up, one lane per row, same `worker_spawning` string);
  OQ3 push variant (`member_waiting` inbox reason); OQ4 `decision_pending` alias.
- **Rejected:** set-the-flag-at-claim (blocker 1); reachability proof / `route_unavailable`
  naming (blocker 2); `blocked: true` on the waiting shape (blocker 3).

## Citation accounting

- 13 drift corrections (§10 v1.1 table).
- 30 new anchors introduced by the amendments (verified against `523111f`): :2008, :2014-2015,
  :3479, :3540-3542, :3546-3549, :3550, :3659, :3660, :5338, :5360, :5748, :5778,
  :14052-14056, :2882, :2885, :2916-2950 (:2917-2924, :2950), :4395, :4468,
  route-liveness.mjs:182, application-deployment.mjs:1083, :827, :185-187, :556, :560,
  :709-716, :736/:738, :259-264, :8212, :10853-10857, :10570-10605,
  issue55-stall-liveness-red.test.mjs:137-142, workflow-surface-red.test.mjs:568/:574.
- **Total new/changed citations in v1.1: 43** (13 corrections + 30 new). Two v1.0 anchors
  reused with refined meaning (:6744 status-field → recovery mask; :12141 reader →
  set-at-claim rejection evidence).
