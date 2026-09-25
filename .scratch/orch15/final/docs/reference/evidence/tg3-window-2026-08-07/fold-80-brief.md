# #80 FOLD BRIEF — fold the red-team report into the TG3-window contract (v1.0 → v1.1)

You are folding an adversarial red-team report into the TG3-window contract. Read fully, in
order: (1) `contract-redteam.md` (NOT FOLD-READY — the blockers, each with its concrete fix);
(2) `tg3-window-contract.md` (v1.0 — your edit target).

## Headlines (fold EVERY numbered blocker + apply the open-question verdicts)

- **The subsumption-honesty blocker:** the "watchdog half closed" claim is true only against #67
  CONTRACT TEXT (its own G7 admits `turnInFlight` doesn't exist at HEAD). Fold the
  depending-on-#67 posture explicitly (the #114-B3/#97 precedent: target-state rows named as
  such), so no claim reads as shipped behavior.
- **The deferral-bound blocker:** D2's bound rides a #67 contract value — same depending-on
  posture, or re-derive a #80-local value; the contract must say which.
- **The dispatch/start evidence findings** (the report's verified `turn/start` response vs
  `turn/started` notification chain): fold the exact evidence classes the report verified, with
  the zombie-answer discrimination (a started-but-dead turn must not answer forever).
- Every remaining numbered blocker per the report, resolved or explicitly deferred with the reason.

## Laws + deliverables

No clocks as controls (evidence gates only); every citation verified (`grep -an`/`sed -n` on the
two NUL files); sorted-key literals ACTUAL order; `localeCompare` banned. Header to **v1.1** with
the fold note. Edit ONLY: `tg3-window-contract.md` (v1.1) + `contract-fold.md` (blocker → change
map) — this directory.
