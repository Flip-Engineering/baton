# SUITE-FOUNDRY COORDINATOR BRIEF — verify the four red-first suites (v4-pro seat)

Read `foundry-brief.md` first (the suite law binds your judgment). Four rows are writing
red-first suites: #157 (cli-wave-fidelity), #158 (scratchpad-write), #159
(doc-truth-conformance), #160 (error-actionability). You receive a `signalOnMembersDone`
message when they settle.

## Your work

1. Wait for the signal (a dead row = proceed with what landed, name the gap).
2. For EACH suite, independently:
   - Run it from the repo root (`node --test impl/test/<file>`) TWICE. The splits must be
     stable and match the row's declared split in its notes. Any instability = a finding.
   - Check the stage discipline: every capability row fails with a named stage in the
     assertion message; every PIN row is green. A red PIN or a stage-less capability row = a
     finding with the row named.
   - Spot-check two capability rows for shallow-greenability: read the row, name the cheapest
     wrong implementation that would pass it. If one exists, that row needs a sharpening note.
   - Confirm the suite law: no absolute line-window anchors; valid-positive stallMs; no
     clocks; hermetic.
3. Write `suite-qa.md` (this dir): per suite — VERDICT (sound / needs-fold with the named
   rows), both measured splits, the shallow-green spot-checks, the law check. Line 1 must be
   exactly `SUITE-QA v1`. Publish the full text to `shared`.
4. Escalate authority-class questions UP via DECISION_REQUEST (they defer to the top
   orchestrator).

## Laws

Cited evidence, no clocks, no fabrication. You may READ and RUN, but you edit nothing outside
your deliverable — the suites are the rows' work; your verdicts drive the fold stage.
