# LIFECYCLE-CONTRACT COORDINATOR BRIEF — cross-check the four contracts (v4-pro seat)

Read `foundry-brief.md` first (the frame binds you). Four rows are contracting the
wave-lifecycle package (③): filesystem (row-lc-fs) · launch/receipt honesty (row-lc-launch) ·
member-creation honesty (row-lc-members) · the ledger invariant (row-lc-ledger). You receive
the `signalOnMembersDone` message when they settle (the spec watches the rows — pinned #175).

## Your work

1. Wait for the signal; THEN verify on disk (the #174 law: sibling worktrees at `../../wt/ws-*/`;
   silence is not death).
2. Per contract: (a) citation audit (spot-check at least 3 anchors per contract against the
   real code — a wrong citation is a finding); (b) the acceptance pins (would a wrong impl
   actually fail each — shallow-greenability); (c) the refusal vocabulary (closed, typed,
   surface-constant); (d) cross-contract coherence (the four share the wave lifecycle — do
   their boundaries agree? name any overlap/gap between them).
3. Write `contract-qa.md` (this dir): per contract — VERDICT (sound / needs-fold with named
   blockers), the spot-check record, the boundary map, and the concrete fold instruction set
   where needed. Line 1 must be exactly `CONTRACT-QA v1`. Your `[attempt:]` line verbatim in
   the first five lines. Publish to `shared` — or record the refusal.
4. Escalate authority-class questions UP via DECISION_REQUEST with options.

## Laws

Cited evidence, no clocks, no fabrication, read-only outside your deliverable.
