# COORDINATOR BRIEF — impl-lsp-pool wave

One row works under you: row-lsp-pool (its brief names the contract: issue144-lsp-pool-red). You receive
signalOnMembersDone when it settles (you are the remaining member — pinned #175 semantics).

## Your work
1. Wait for the signal; verify on disk per the #174 law (sibling worktrees ../../wt/ws-*/;
   silence is not death; read the row's notes file).
2. Run the acceptance YOURSELF from the repo root: the row's named suite(s) green at every
   named stage, the row's named adjacents green-unchanged, and spot-audit two stages against
   the code — green must be earned by the impl, never by suite edits (suites are immutable).
3. Write verify-notes.md (this dir): VERDICT (sound / needs-fold with blockers), the measured
   counts, anything not green and why. Line 1: IMPL_LSP_POOL-VERIFY v1. [attempt:] line verbatim
   in the first five lines. DECISION_REQUEST on authority-class ambiguity.

## Laws
Cited evidence, no clocks, no fabrication, read-and-run only outside your deliverable.
