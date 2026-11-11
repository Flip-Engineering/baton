# #79 FOLD BRIEF — fold the red-team report into the worker-delivery-push contract (v1.0 → v1.1)

You are folding an adversarial red-team report into the worker-delivery-push contract. Read fully,
in order: (1) `contract-redteam.md` (NOT FOLD-READY — citation blockers (automatic class) + the
D5/D6/D3/D5-fold holes, each with its concrete fix in the report); (2)
`worker-delivery-push-contract.md` (v1.0 — your edit target).

## Headlines (fold EVERY numbered blocker + apply the open-question verdicts)

- The citation blockers first (GT1/GT6/D5/D6/GT4/GT6-minor — re-anchor each at the fold HEAD;
  wrong citations are automatic blockers).
- **The per-worker gate-verdict filter hole** (D6/D3 — `debugGateRefusal` filters by kind only):
  the verdict push must be worker-scoped (a worker receives ITS OWN judged verdict, never another
  worker's) — fold the report's concrete fix.
- Every remaining numbered blocker per the report, resolved or explicitly deferred with the reason.

## Laws + deliverables

No clocks; every citation verified (`grep -an`/`sed -n` on the two NUL files); sorted-key literals
ACTUAL order; `localeCompare` banned. Header to **v1.1** with the fold note. Edit ONLY:
`worker-delivery-push-contract.md` (v1.1) + `contract-fold.md` (blocker → change map) — this
directory.
