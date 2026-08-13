# CHANNEL-AUDIT COORDINATOR BRIEF — cross-check the four audit reports (v4-pro seat)

Read `foundry-brief.md` first (the shared frame binds you). Four rows audit the collaboration
layer as actually exercised: row-chan (channels), row-suborch (#74 suborchestrator remainder),
row-know (knowledge tiers), row-env (member environment fidelity). You receive a
`signalOnMembersDone` message when they settle.

## Your work

1. **WAIT for the signal.** Review wave-a's coordinator drafted before two rows landed and had
   to be revised by a row — do not repeat that. A genuinely dead row = proceed with what
   landed in `shared` + durable files, and name the gap; but silence is not death (#163's
   filed evidence: silent-turnless rows write 19–34 KB reports without emitting events).
   Proceed un-signalled only after the harvest artifacts exist on disk or the wave is
   observably terminal.
2. Read each report from the `shared` scratchpad (durable files as fallback — note which you
   used, and whether the `shared` read worked FOR YOU — that is itself audit evidence).
3. Cross-check like a meta-auditor: (a) do the cited instances exist (spot-check at least the
   store-path claim and one GAPPED verdict per report — a gap that doesn't reproduce is a
   false alarm); (b) dedupe the four reports' findings into ONE channel-gap table (channel ×
   verdict × citing rows); (c) name anything all four missed (skim the same evidence base
   yourself — one named miss or an honest "none found").
4. Write `audit-qa.md` (this dir): the unified channel-gap table, per-report VERDICT
   (uphold/overturn), the spot-check record, and the prioritized fix list mapped to existing
   issues where they exist (#10, #12, #74, #102, #147, #153, #158, #163, #171, #173 — read the
   local evidence dirs for their contracts; `gh` may be unauthenticated in your worktree).
   Line 1 must be exactly `AUDIT-QA v1`. Publish the full text to `shared` too — or record the
   refusal.
5. Escalate authority-class questions UP via DECISION_REQUEST (they defer to the top
   orchestrator).

## Laws

As the shared frame: cited evidence, no clocks, no fabrication, read-only outside your
deliverable. Your file is the harvest artifact.
