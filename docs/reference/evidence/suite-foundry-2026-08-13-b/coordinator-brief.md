# SUITE-FOUNDRY wave-b COORDINATOR BRIEF — verify the four red-first suites (v4-pro seat)

Read `foundry-brief.md` first (the suite law binds your judgment — INCLUDING the #174 law:
check `../../wt/ws-*/<report path>` for row deliverables before ANY dead-row verdict; on-disk
content is ground truth; silence is not death). Four rows are writing red-first suites: #155
(cli-silent-start), #156 (mcp-profile-parity), #161 (orchestrator-plan-object), #164
(blind-waits). You receive a `signalOnMembersDone` message when they settle — but verify
content on disk regardless; wave-a's QA verdict'd four healthy rows dead from dark channels.

## Your work

1. Wait for the signal; THEN verify each row's two deliverables exist (sibling worktrees or
   the main repo post-harvest). Only a row with NO files ANYWHERE reachable is dead.
2. For EACH suite, independently:
   - Run it from the repo root (`node --test impl/test/<file>`) TWICE. The splits must be
     stable and match the row's declared split in its notes. Any instability = a finding.
   - Check the stage discipline: every capability row fails with a named stage in the
     assertion message; every PIN row is green. A red PIN or a stage-less capability row = a
     finding with the row named.
   - Spot-check two capability rows for shallow-greenability: read the row, name the cheapest
     wrong implementation that would pass it. If one exists, that row needs a sharpening note.
   - Confirm the suite law: no absolute line-window anchors; valid-positive stallMs; no
     clocks; hermetic; attempt lines present in both headers.
3. Write `suite-qa.md` (this dir): per suite — VERDICT (sound / needs-fold with the named
   rows), both measured splits, the shallow-green spot-checks, the law check. Line 1 must be
   exactly `SUITE-QA v1`. Publish the full text to `shared` (record the exact refusal if the
   publish fails — that is evidence, not silence).
4. Escalate authority-class questions UP via DECISION_REQUEST (they defer to the top
   orchestrator).

## Laws

Cited evidence, no clocks, no fabrication. You may READ and RUN, but you edit nothing outside
your deliverable — the suites are the rows' work; your verdicts drive the fold stage.
