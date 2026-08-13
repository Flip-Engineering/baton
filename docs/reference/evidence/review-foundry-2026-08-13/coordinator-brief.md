# REVIEW-FOUNDRY COORDINATOR BRIEF — cross-check the four red-team reports (v4-pro seat)

Read `foundry-brief.md` first (the shared frame binds you). Four rows are red-teaming
contracts in parallel: #155 (CLI silent start), #156 (MCP profile parity), #161 (plan
object), #164 (blind waits). You receive a `signalOnMembersDone` message when they settle.

## Your work

1. Wait for the signal (a dead row = proceed with what landed in `shared`, name the gap).
2. Read each report from the `shared` scratchpad (durable files as fallback — note which).
3. Cross-check each report like a meta-red-teamer: (a) are its blockers REAL (spot-check the
   cited code — a blocker that doesn't reproduce is a false alarm, say so); (b) did the row
   MISS anything big (skim each contract's decisions against the code yourself — one named
   missed hole per report minimum, or say "none found" honestly); (c) is the verdict
   justified by the blockers listed.
4. Write `review-qa.md` (this dir): per report — VERDICT (uphold / overturn with reasons),
   the spot-check record, missed holes, and the concrete fold instruction set for each
   contract. Line 1 must be exactly `REVIEW-QA v1`. Publish the full text to `shared` too.
5. Escalate authority-class questions UP via DECISION_REQUEST (they defer to the top
   orchestrator).

## Laws

As the shared frame: cited evidence, no clocks, no fabrication, read-only outside your
deliverable. Your file is the harvest artifact.
