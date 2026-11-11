# #67 IMPL BRIEF — implement the stall watchdog (liveness evidence, never a wall clock)

Implement the #67 epic: make `impl/test/stall-watchdog-red.test.mjs` green with ZERO weakening
edits — 27 rows: **7 PINs must stay green, 20 RED rows go green at their named stages**. Read
fully, in order: (1) `stall-watchdog-contract.md` (**v1.1** — the folded contract; it was NOT
changed by the suite fold); (2) `impl/test/stall-watchdog-red.test.mjs` (the header carries the
row inventory + invented-surface signatures); (3) `suite-fold-2.md` (the folded oracles F1–F7 —
each row's exact drive and stage; §Deferred F8/F9/F10 are OUT of scope).

## The shape (from the contract + fold oracles)

- **D2 any-event re-arm replacement** — the watchdog re-arms on LIVENESS EVIDENCE, not any raw
  event. B3's 5-way rotation is the discriminator: `resource.provider_call`, `content.message`,
  `resource.tokens`, `content.tool_call`, `content.file_edit` each hit their OWN branch and
  return without `_touchWatchdog` (stage `any-event-rearm-killed`). Get the branch shapes from
  the suite payloads exactly (the tool_call payload keeps the loop detector quiet; the
  file_edit payload carries no `content` field and stays in scope).
- **The in-flight-turn gate (C4)** — `turnInFlight` SET on `lifecycle.turn_started`, CLEARED on
  BOTH terminal paths: `lifecycle.turn_completed` AND `lifecycle.crashed` (stage
  `in-flight-turn-clear-missing`). A mid-turn worker is never reaped (the turn_started REARM
  answers the claimed window by construction).
- **The stall-seam cycle + rung-3 reap (E6)** — `_armStallCycle` exists; a `control.steer`
  claim arms it; an unanswered expired claimed window with `turnInFlight === false` reaps, and
  the receipts land PRESERVE-FIRST: `worktree.progress_unchanged`/`progress_checkpointed` at a
  ledger index BEFORE `kill.requested`/`control.interrupt_requested`, then the adapter kill
  (stages `stall-seam-cycle-missing` → `stall-reap-receipt-missing`). The suite's worktree
  override drives the `progress_checkpointed` path.
- **The positive clear (E7)** — `_clearStall` exists and fires ONLY on a qualifying D2 re-arm
  inside the claimed window (`question.answered`): flag clears, digest set empties, NO kill
  (stage `stall-clear-missing`).
- **Stall-lifetime dedup (E5)** — `stallSeamDigestSet` is a real Set, EMPTY at a fresh stall
  declaration; `_clearStall` is the only clearer (stage `stall-lifetime-dedup-missing`).
- **PINs that must not move** — B4/C3 must-not-stall rows (10× margins, event-ordering based),
  D3/D4/D5, E8 (`waitingOn: {kind:'provider_stalled'}` projection + clear — already green at
  `application.mjs:458`; do not sever event→projection), and A3's typed refusal
  `watchdog_stall_exceeds_wall` fires ONLY at the `createDriver` deployment seam — the
  `_armWatchdog` defense-in-depth stays a silent no-op (the G3 guard).

## Laws + verify

Campaign law: no clocks as controls (evidence/liveness only — the entire point of this epic);
scanners shape-only; `localeCompare` banned; sorted-key literals ACTUAL order; NUL discipline
(`grep -an`/`sed -n` on `application.mjs` + `coordination-store.mjs`); byte literals ONLY in
`limits.mjs`. **#141 boundary-commit law: commit at natural subsystem boundaries.** Error
payloads ride ONLY lane-crafted codes. Verify: `node --test impl/test/stall-watchdog-red.test.mjs`
from the repo root until 27/27, then the adjacents (`phase56-drain-and-close`,
`phase51-process-lifecycle`, `phase62-goal-plan-authority` — the drain/lifecycle neighbors this
touches). Deliverables: the impl/src edits + your boundary commits; note your split in the
wave report.
