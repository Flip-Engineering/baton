# #67 FOLD BRIEF — fold the red-team report into the stall-watchdog contract (v1.0 → v1.1)

You are folding an adversarial red-team report into the stall-watchdog contract. Read fully, in
order: (1) `contract-redteam.md` (NOT FOLD-READY — 9 numbered blockers in §7, each with its
concrete fix; the per-decision holes in §2-§6 carry the detail); (2) `stall-watchdog-contract.md`
(v1.0 — your edit target).

## The blockers, headlined (fold ALL 9 per the report's fixes)

1. G13 citation re-point (`_activityProjection` at `application.mjs:8041-8068`, re-verified at
   the fold HEAD). 2. D2's REARM_KINDS is inert as written — re-specify set + feed + actor policy
   TOGETHER (the actor gate filters orchestrator/policy actors; only some kinds ride the watchdog
   feed). 3. D3/SW-06 name a nonexistent surface — rewrite on `blockedInteraction` (the honest
   #10 state), or spec a real 6th waiting kind (pick one; the §5 no-new-kinds law must not
   contradict D3). 4. The claim-then-idle hole — narrow the stall-seam cycle to the D2 REARM
   kinds, spec the stall-flag removal seam, dedup per-stall LIFETIME (not per-cycle). 5. The
   control-law line is broken for slow-but-productive workers — fold the fix so NO bound fires
   on elapsed time without an evidence check (a 20-minute compile is not a stall). 6-9. Per the
   report's §7 items 6-9.

## Laws + deliverables

No clocks as controls (the line above is the whole point of this contract — hold it); every
citation verified (`grep -an`/`sed -n` on the two NUL files); sorted-key literals ACTUAL order;
`localeCompare` banned. Header to **v1.1** with the fold note. Edit ONLY:
`stall-watchdog-contract.md` (v1.1) + `contract-fold.md` (blocker → change map, all 9 + the
open-question verdicts, resolved or explicitly deferred with the reason) — this directory.
