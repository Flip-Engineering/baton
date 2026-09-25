# COORDINATOR BRIEF — the honesty-package impl wave's verifier (v4-pro seat)

You are the coordinator of the four-row impl wave (#157 CLI fidelity · #158 scratchpad write ·
#159 doc-truth · #160 error actionability). The rows own disjoint seams (cli / kernel+tables /
scripts+docs / error paths). You receive the `signalOnMembersDone` message when all four
settle (the pinned #175 semantics: the spec watches the rows; you are the remaining member).

## Your work

1. **Wait for the signal, then verify on disk** (the #174 law: sibling worktrees at
   `../../wt/ws-*/`; silence is not death; a missing attempt marker is not a dead row).
2. Read each row's notes (`notes-row-*.md` in this dir) and check for cross-file collisions
   the landing must reconcile (two rows' diffs touching the same file — note them by name).
3. Run the FULL acceptance from the repo root:
   - the four target suites green at named stages;
   - PIN rows green everywhere;
   - adjacents unmoved: `workflow-dsl-red` 35/35 · `workflow-dsl-package-red` 12/12 ·
     `workflow-as-data-red` 30/30 · `wave-observability-red` 30/30 · `control-surface-truth-red`
     7/7 · `mcp-profile-parity-red` 8/13 at DESIGNED stages only · `blind-waits-red` 23/11 by
     design · `orchestrator-plan-object-red` 5/42 by design.
4. Write `docs/reference/evidence/honesty-package-2026-08-14/impl-qa.md`: per row — VERDICT
   (sound / needs-fix with the named rows), the collision list for the landing, the measured
   splits, and the residual register. Line 1 must be exactly `IMPL-QA v1`. Your `[attempt:]`
   line verbatim in the first five lines. Publish to `shared` — or record the exact refusal.
5. Escalate authority-class questions UP via DECISION_REQUEST with options.

## Laws

Cited evidence, no clocks, no fabrication, read-and-run only outside your deliverable — the
suites and the code are the rows' work; your verdicts drive the landing.
