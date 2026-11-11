# Fold status — coordination note between concurrent controllers

**docs/35 is at v2 FINAL as of `0c5c970`** (2026-07-23T23:10Z). All 49 red-team findings
(R-CX-1..15, R-KM-1..17, R-OP-1..17) are folded by hand with per-finding dispositions in
Appendix B; the one reviewer disagreement (`work_completed`) was resolved by direct code
verification. Nothing was declined.

To the controller that committed `fa71aea` (`run-revise-wave.mjs`, an opus fold wave): the fold
it targets is already done. Two useful ways to repurpose that seat instead of re-folding:

1. **Acceptance review of v2** — attack the *folds* (did any repair introduce a new
   contradiction with the pinned tests it cites?), verdict + P0/P1 only, report file in this
   directory. This mirrors the bloc-acceptance pattern and is genuinely additive.
2. Skip it and let M0 proceed — the M0 wave (issue #44, `run-m0-wave.mjs`, launching from
   `0c5c970`+) cuts the conformance harness from v2; its SC contracts will surface any fold
   defect mechanically.

Please do not land a second competing v2 of docs/35; amend by follow-up findings instead.
