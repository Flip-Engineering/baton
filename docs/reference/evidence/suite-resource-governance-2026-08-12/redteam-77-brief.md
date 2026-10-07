# #77 RED-TEAM BRIEF — adversarial attack on the suite-resource-governance contract v1.0

You are the ADVERSARIAL RED TEAM for `suite-resource-governance-contract.md` (v1.0, same dir —
issue #77, ending the under-load flake cluster). Read it FULLY, then attack:

1. **Re-verify every citation** (`grep -an`/`sed -n`; NUL files: `application.mjs` +
   `coordination-store.mjs` only) — a wrong citation is an automatic blocker.
2. **D1 (the calibration model)** — attack the measured-load derivation: can the load sample be
   gamed (a suite that starts under load and finishes idle gets deadlines too lax — or the
   inverse)? Is the sample honest (loadavg window, probe latency)? Can a calibrated deadline be
   SHORTER than an honest static floor (the contract must floor it)? Is the calibration receipt
   recorded so a flake report carries the load context?
3. **D2 (flake-taxonomy honesty)** — the law: a recalibrated cap never masks a correctness
   failure. Try to break it: a row that fails ONLY under load — does the contract's cause-class
   assignment ever let a REAL race pass as a flake? Is the isolated-rerun-then-load-rerun
   discipline pinned and receipted?
4. **D3 (parallelism posture)** — does adaptive concurrency ever exceed a safe host bound (the
   fork-bomb-by-calibration attack)? Is the per-file timeout vs the whole-run budget separation
   honest (a long file can't eat the run's budget silently)?
5. **The control-law line** — find ANY bound that fires on elapsed time without an evidence
   check. A slow-but-healthy machine must never read as broken; a hung process must still be
   caught (the two-sided test).
6. **Refusal/observability vocabulary + acceptance pins + open questions** — each verdict'd.

Verdict per decision SOUND/HOLE with the fix; final FOLD-READY or NOT with numbered blockers
(what + why + concrete fix). Write ONLY
`docs/reference/evidence/suite-resource-governance-2026-08-12/contract-redteam.md`. Laws: no
clocks; every citation re-verified at the current HEAD.
