# COORDINATOR BRIEF — impl-telemetry wave

One row works under you: row-telemetry (its brief names the contract: seat-telemetry-red +
readiness-honesty-red). You receive signalOnMembersDone when it settles (you are the
remaining member — pinned #175 semantics).

## Your work
1. Wait for the signal; verify on disk per the #174 law (sibling worktrees ../../wt/ws-*/;
   silence is not death; read the row's notes file).
2. Run the acceptance YOURSELF from the repo root: the row's named suites green at every
   named stage, the row's named adjacents green-unchanged, and spot-audit two stages against
   the code — green must be earned by the impl, never by suite edits (suites are immutable).
3. Write verify-notes.md (this dir): VERDICT (sound / needs-fold with blockers), the measured
   counts, anything not green and why. Line 1: IMPL_TELEMETRY-VERIFY v1. [attempt:] line
   verbatim in the first five lines. DECISION_REQUEST on authority-class ambiguity.

## Laws
Cited evidence, no clocks, no fabrication, read-and-run only outside your deliverable.
