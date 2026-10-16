# #67 FOLD — red-team blockers → contract v1.1 changes

**Fold target:** `stall-watchdog-contract.md` v1.0 → **v1.1** (same dir)
**Fold input:** `contract-redteam.md` §7 (9 numbered blockers) + §6 open-question verdicts
**Fold HEAD:** `88198e56febffba8374e04b25af9d2b712869b35` (current worktree HEAD)
**Verdict:** **FOLD-READY** — all 9 blockers folded; OQ-1/OQ-3/OQ-4 resolved, OQ-2 explicitly deferred.

Every anchor the fold touches was re-verified at the fold HEAD by `grep -an`/`sed -n` on the tree;
the two NUL-bearing files (`application.mjs`, `coordination-store.mjs`) by grep/sed only
(`coordinator.mjs` has 0 NUL bytes and was read whole).

---

## Blocker map (what → why → fix → where it landed)

### Blocker 1 — G13 citation is wrong at HEAD
- **What:** v1.0 cited `application.mjs:7934-7960` as the #55 activity projection.
- **Why:** `7934-7960` is `_followCategory`; the projection is `_activityProjection` at
  `application.mjs:8041-8068` (returns `deepFreeze({providerCalls, tokens, contentEvents, lastActivityAt})`,
  called at `:7870`). A wrong citation is an automatic blocker under the campaign law.
- **Fix:** re-point the G13 anchor to `application.mjs:8041-8068`, re-verified at the fold HEAD.
- **Landed:** G13 row, §1; the §7 verification section's corrected NUL-file list is folded too
  (v1.0 named `coordinator.mjs` as NUL-bearing; it has **0** NUL bytes — §5 law, corrected).

### Blocker 2 — D2's REARM_KINDS is largely inert (actor gate + single feed)
- **What:** v1.0's seven-kind set couldn't re-arm: the retained `event.actor !== 'worker'` gate
  filtered `control.steer` (actor `'orchestrator'`, `:7404`), `verify.reverified` (actor `'policy'`,
  `:6463`/`:13011`), `worktree.progress_checkpointed` (actor `'policy'`, `:8448`), and none of them
  rode the single feed (`:12824`).
- **Why:** the set changed without the feed/actor policy; most kinds were dead on arrival.
- **Fix:** re-specify D2 as set + feed + actor policy **together**. Chosen design: the closed set
  shrinks to the genuinely worker-observable kinds — `lifecycle.turn_started` and the three
  resolution kinds — re-armed **only** when they ride the worker observation stream (`:12824`);
  `control.steer`, `control.nudge`, `verify.reverified`, `worktree.progress_checkpointed` are
  removed from the set and never re-arm. The blanket actor gate is removed (the closed set is the
  gate). `worktree.progress_checkpointed` is additionally self-contradictory (minted by the reap
  pre-check itself, G12) — dropped. The coordinator `respond` API (`:9540`, orchestrator actor)
  mints resolutions that do **not** ride the feed, so an orchestrator answering out-of-band does not
  re-arm — the create-and-answer self-dealing loop is closed.
- **Landed:** D2, §2 (set + feed + actor policy + removed-kind reasons); SW-04, §4.

### Blocker 3 — D3/SW-06 name a nonexistent surface
- **What:** v1.0 asserted `waitingOn: {kind: 'blocked'}`.
- **Why:** `'blocked'` is not in `WAITING_ON_KINDS`; `projectWaitingOn` returns **null** when blocked
  (`application.mjs:408`); the honest state is the separate `blockedInteraction` surface
  (`projectBlockedInteraction`, `application.mjs:372-388`). SW-06 (marked GREEN) was RED as written,
  and §5's no-new-kinds law contradicted D3's invented 6th kind.
- **Fix:** rewrite D3/SW-06 on `blockedInteraction` (the honest #10 state); do **not** invent a 6th
  waiting kind, so §5's law holds.
- **Landed:** D3 first bullet (honest state on `blockedInteraction`), G9 row, SW-06 (§4, re-specified
  GREEN), §5 "no new waiting kinds" law.

### Blocker 4 — claim-then-idle: the rung-2 cycle answers on TG2 evidence, never reaps
- **What:** D4 reused `_armSteeringCycle`, whose answer set (`_steeringEvidenceQualifies`,
  `:2208-2238`) is TG2 evidence (`scratchpad`/`capability_op` distinct digests, deduped **per
  cycle**) — a worker answered every nudge with one saved note and the ladder never reached reap.
- **Why:** the wrong answer set + no stall-flag removal seam + per-cycle dedup made the ladder
  escapable.
- **Fix:** (a) narrow the stall-seam cycle's answer set to the **D2 REARM_KINDS**; (b) spec the
  stall-flag removal seam `_clearStall(handle)` — called ONLY on a qualifying D2 re-arm inside the
  window; (c) dedup **per-stall LIFETIME** (`handle.stallSeamDigestSet`), not per-cycle.
- **Landed:** D4 rung 2, §2 (record shape, `working`-compatible expiry, answer set, lifetime dedup,
  `_clearStall` seam); SW-10, §4.

### Blocker 5 — the control-law line is broken for slow-but-productive workers
- **What:** 20-min D1 window + D2 excluding in-flight `tool_call`/`tokens`/`provider_call` + 300-s
  nudge window + a mid-turn worker that cannot answer = a 25-minute compile declared stalled,
  nudged, and reaped; `_preserveProgressBeforeReap` preserves the output but not the worker.
- **Why:** a bound fired on elapsed time with zero evidence check — exactly what the control law
  forbids.
- **Fix:** fold an in-flight-turn liveness gate (not the any-event re-arm): `handle.turnInFlight`
  (set on `lifecycle.turn_started`, cleared at the turn-terminal seam `:12307-12323`/`:12844`) gates
  the D1 timer (an in-flight turn re-arms the window without declaring) and gates rung-3 reap
  (no in-flight turn required). The wall budget (`timeoutMs`) is the operator-pinned hung-turn
  backstop. No bound fires on elapsed time without an evidence check.
- **Landed:** D2 "in-flight-turn liveness gate", D4 rung 3, §5 "no clocks as controls" law, SW-10.

### Blocker 6 — D1 has no admission-time `stall < wall` check; disclosure is comment-only
- **What:** the only guard is `stallMs > 0` (`:8733`); a `watchdog: {stallMs: 500 * 60_000}`
  override sails through and can never fire before the wall ends. The facade has zero
  `stallMs`/`watchdog` references, so the "honestly disclosed" claim is source-comment-only.
- **Fix:** admission validation at the deployment seam (`stallMs` positive integer strictly less
  than the node wall `timeoutMs`; typed refusal `watchdog_stall_exceeds_wall`) + a runtime
  status-surface disclosure of the resolved watchdog config (`{stallMs, basis, rearmKinds}`
  byte-stable, ACTUAL-sorted).
- **Landed:** D1 bullets, §2; §3 vocabulary row; SW-11 / SW-12 (§4).

### Blocker 7 — D3's null-deadline default can fire during legitimate operator work
- **What:** a 20-min time-only bound with zero orchestrator-side evidence check closed a blocking
  question under an operator's active review (the #105 escalation lane), rejecting a late answer as
  `already_resolved` (`:9952`).
- **Fix:** (a) operator ack/claim extension (OQ-1) on the attention reason — an acknowledged
  interaction extends its effective deadline and is skipped by the sweep; (b) non-destructive
  escalation — `disposition: 'escalated'` but the record stays `pending`/answerable (late answers
  land; never closed like `_expireDecision`).
- **Landed:** D3 bullets, §2; SW-08, §4.

### Blocker 8 — D2's replacement code disables the loop-tracking branches it claims to keep
- **What:** the `!REARM_KINDS.includes` return preceded the `provider_call`/`tool_call` branches,
  making `_observeLogicalToolCall` and the `loopThreshold` detector (`:9166-9174`) unreachable.
- **Fix:** order the code so observation/loop-tracking runs **before** the REARM_KINDS
  silence-return (the replacement in D2 has the branches first, silence last).
- **Landed:** D2 replacement code, §2; SW-03, §4.

### Blocker 9 — D4's claim seam is new wiring with no specification; REARM_KINDS vs D4 disagree on `control.nudge`
- **What:** the existing cycle arms only at pause admission (`:2134`) and expires only on `paused`
  tasks (`:2290`) — a `working` stall-seam worker no-ops both. D4 armed on both `control.steer` and
  `control.nudge` while v1.0's REARM_KINDS contained steer but not nudge.
- **Fix:** spec the stall-seam seam explicitly — `_armStallCycle(handle, task, {nudgeId, controlId})`
  armed on `control.steer` **or** `control.nudge`, `working`-compatible expiry on
  `_progressNudgeWindowMs ?? 300_000`, `{kind: 'stall_seam', ...}` record shape, lifetime-keyed.
  Reconcile the kinds: neither steer nor nudge is a REARM kind (blk-2); both arm the stall-seam cycle.
- **Landed:** D4 rung 2, §2; SW-10, §4.

---

## Open-question verdicts (§6)

| OQ | Red-team verdict | Fold disposition | Reason |
|----|------------------|------------------|--------|
| OQ-1 | FOLD-BLOCKING | **RESOLVED** | A claim/ack on `stall_declared`/`interaction_expired` extends the effective deadline (the `claim_turn` shape, `coordinator.mjs:2541`/`wave-driver.mjs:397`); folded into D3 as the orchestrator-side evidence check (blk-7). |
| OQ-2 | DEFERRED | **DEFERRED** | "Stays escalated, never auto-reaps" is the honest terminal under the control law; the claimed path (where the ladder was escapable) is fixed by blk-4. A supervisor-armed reap already exists and is receipted. No auto-reap clock. |
| OQ-3 | FOLD-BLOCKING | **RESOLVED** | 20 min kept provisionally; the pin is gated on the OQ-1 ack-extension mechanism. Value becomes tunable after one lived observation. |
| OQ-4 | FOLD-BLOCKING | **RESOLVED** | `verify.reverified` is removed from REARM_KINDS entirely (blk-2) — the accept-true/false question is moot. `loopThreshold` (`coordinator.mjs:1057`) is the loop bound. |

---

## Campaign-law compliance (self-applied)

- **No clocks as controls:** no new bound fires on elapsed time without an evidence check — the D1
  window is a silence bound gated on the in-flight turn (blk-5); the wall budget is a pre-existing
  node bound, not a workflow gate.
- **Citations re-verified at the fold HEAD** (`grep -an`/`sed -n`; the two NUL files by grep/sed
  only); the G13 anchor and the NUL-file list are corrected (blk-1).
- **Sorted-key literals ACTUAL order:** `REARM_KINDS` (four kinds) written ACTUAL-sorted
  (verified: the literal IS its own `[...set].sort()` result); `WAITING_ON_KINDS` byte-unchanged.
  `localeCompare` banned.
- **Deliverables:** ONLY `stall-watchdog-contract.md` (v1.1) + `contract-fold.md` (this file) were
  edited in this directory.
- **Deployment verification command** (Baton): executable `true`, arguments `[]`, expected exit 0.
