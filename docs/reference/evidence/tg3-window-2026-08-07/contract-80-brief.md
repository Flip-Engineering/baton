# #80 CONTRACT BRIEF — TG3 steering window vs provider turn-start latency (the control-law fold)

You are drafting the implementation contract for issue #80 (the one-shot 5-minute TG3 steering
window can expire during a legitimately slow next-turn start). Read fully, in order: (1) the
issue — `gh issue view 80` (the refinement candidates (a) per-route latency scaling, (b) a
started-but-silent provider turn as the cycle's answer); (2) **the #67 stall-watchdog contract
v1.1** (`docs/reference/evidence/stall-watchdog-2026-08-07/stall-watchdog-contract.md` — JUST
folded: D2's in-flight-turn liveness gate re-arms on a live turn WITHOUT declaring, and the wall
budget is the hung-turn backstop — #80's case may be LARGELY SUBSUMED; your contract's first job
is to say precisely how much, honestly); (3) the TG3 machinery: `progressNudgeWindowMs`, the
_admitPauseRecord seam, the one-shot cycle (`coordinator.mjs` — anchors drifted; re-verify);
(4) the TG6 retirement ruling (skeleton-first/write-to-survive coaching is banned — the current
escape pressure the issue names is exactly that class).

## The contract must decide

- **Subsumption analysis (first, honest):** which parts of #80's failure mode does #67 v1.1's
  in-flight-turn gate already close? What residual remains (the case where the next turn has not
  STARTED — queued behind provider latency — so no in-flight evidence exists yet)?
- **The residual fix:** candidate (b) — a started-but-silent provider turn (turn_started /
  resource.provider_call for the seat) counts as the cycle's answer — extended to the queued
  case: what durable evidence marks "the next turn is legitimately starting" (a dispatch receipt?
  a provider queue ack?) vs "the turn never started" (the honest stall)? Every answer class must
  be EVIDENCE, never a bigger window (the control law: no clocks as workflow controls — the
  5-minute window's expiry semantics must become evidence-gated, not merely longer).
- **The expiry disposition:** when the window genuinely expires with no evidence, what happens —
  the full final evaluation with `steered:{nudgeId, answered:false}` (today) vs a constructive
  re-arm — and how the expiry is receipted so the #55-class incident is debuggable after.
- **Refusal/observability vocabulary + acceptance pins (red-first)** per the decisions.

## Laws + deliverable

Ring-2 form. No clocks as controls (evidence gates only; the backstop is operator-pinned); every
citation re-verified at the CURRENT HEAD; sorted-key literals ACTUAL order; `localeCompare`
banned. Cross-reference (do not re-spec): #67 (v1.1), #64 (TG3), #55, #10, TG6. Deliverable:
ONLY `docs/reference/evidence/tg3-window-2026-08-07/tg3-window-contract.md` (v1.0 DRAFT with the
verification HEAD).
