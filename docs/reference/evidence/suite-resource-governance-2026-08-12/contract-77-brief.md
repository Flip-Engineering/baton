# #77 CONTRACT BRIEF — suite resource governance: end the under-load flake cluster

You are drafting the implementation contract for issue #77 (suite resource governance — the
~40%-under-load flake cluster). Read fully, in order: (1) the issue — `gh issue view 77`; (2)
the lived evidence: the canonical gate's flake cluster (#7 — drain deadlines, start-latency caps,
the phase56/phase62/phase8/kimi-acp classes that pass isolated and fail under load); the
campaign's own gate runs this week (the failure distributions are in the commit messages);
(3) the current machinery: the suite runner (`impl/scripts/run-suite.mjs`), the deadline/cap
vocabulary it uses, the documented recalibrations (D9's cap recalibration precedent — "waves.start
alone measures ~3.9s under load"), the #7 issue's receipts.

## The contract must decide (with the control law in front)

**THE CONTROL LAW (operator, campaign):** no clocks as workflow CONTROLS — but the suite's
deadlines are TEST INFRASTRUCTURE, a different surface. The law here: a test's deadline must
measure what it claims (a hung process), never declare a slow-but-healthy machine broken. Load-
aware calibration must be EVIDENCE-based (measured system load at run time), not a bigger global
constant.

- **The calibration model.** Load-aware deadlines: the suite measures host load at start (and/or
  per-file), and time-bounded assertions derive from a measured baseline × a pinned factor —
  OR the caps recalibrate to honest static values with the measurement receipt recorded. Pick
  the shape; pin how the measurement is taken (loadavg? a probe operation's latency?) and how
  it's recorded (the gate's output names the calibration, so a flake report carries the load
  context).
- **The flake-taxonomy honesty.** Some cluster members may be REAL bugs wearing flake clothes
  (a deadline that catches a genuine race). The contract must pin the review rule: a recalibrated
  cap never masks a correctness failure (the isolated-rerun-then-load-rerun discipline; a row
  that fails ONLY under load gets the load-context receipt and a human-readable cause class).
- **The parallelism posture.** Does the gate's concurrency adapt to the host (cores/load), and
  is the per-file timeout vs the whole-run budget separated honestly?
- **Refusal/observability vocabulary + acceptance pins (red-first)** per decision.

## Laws + deliverable

Ring-2 form. No clocks as workflow controls (above); every citation verified; sorted-key
literals ACTUAL order; `localeCompare` banned. Cross-reference (do not re-spec): #7, the #10-era
waitingOn honesty, #67's in-flight-turn gate (the same philosophy: evidence, not rigid bounds).
Deliverable: ONLY
`docs/reference/evidence/suite-resource-governance-2026-08-12/suite-resource-governance-contract.md`
(v1.0 DRAFT with the verification HEAD).
