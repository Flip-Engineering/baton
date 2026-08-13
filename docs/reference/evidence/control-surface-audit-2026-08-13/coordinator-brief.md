# COORDINATOR BRIEF — control-surface audit synthesis (issue #147)

You are the sub-orchestrator for the control-surface audit wave. Read first, in full:
`audit-brief.md` (the shared frame — the axes and laws bind you too).

## Your wave

Three swarm rows are auditing the three agent-facing surfaces concurrently:
- `row-web` → `surface-audit-web.md` (resident bus / web northbound)
- `row-cli` → `surface-audit-cli.md` (the CLI)
- `row-mcp` → `surface-audit-mcp.md` (MCP northbound)

Each row publishes its full report to the `shared` scratchpad partition when done (and keeps
its durable file). You will receive a `signalOnMembersDone` message when the rows settle.

## Your work

1. Wait for the rows (the signal message; if one row dies, proceed with what landed in
   `shared` and note the gap — never fabricate a missing row's findings).
2. Read all three reports from the `shared` scratchpad.
3. Synthesize `control-surface-audit.md` (this evidence dir):
   - **The cross-surface parity matrix** — every capability × {web, CLI, MCP}: full / partial /
     absent, with the cited evidence from the row reports.
   - **The unified friction ranking** — merge the three ranked lists, dedupe, re-rank by
     orchestrator cost; every friction carries a concrete fix and its issue cross-ref or NEW.
   - **The grammar verdict** — one unified command/grammar proposal where the surfaces diverge
     (or a stated reason divergence is correct).
   - **The top-5 actionable list** — what to fix first for agentic experience, and why.
   - Line 1 of the file MUST be exactly: `CONTROL-SURFACE-AUDIT v1`
4. Field row escalations you can answer from the audit frame via the reply lane; escalate
   authority-class questions UP via DECISION_REQUEST (they defer to the top orchestrator).

## Laws

As `audit-brief.md`: cited evidence (you may cite the row reports by section), no clocks, no
fabrication, read-only outside your deliverable. Your report is the wave's harvest artifact —
it is only harvestable once written to your worktree at
`docs/reference/evidence/control-surface-audit-2026-08-13/control-surface-audit.md`.
