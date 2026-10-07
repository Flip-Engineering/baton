# ROW BRIEF — row-pm-agent: pm's agent-integration layer vs baton's surfaces

Read `foundry-brief.md` first (the shared laws bind you). Your lane: **the agent-facing
surface — ambient context, activation, session continuity, tool ergonomics**.

Ground in the digest: `src_mcp_tools.rs` (the 37-tool registry — its breadth vs baton's),
`src_mcp_dashboard.rs` (`session_init` + `build_knowledge_briefing` — recent findings +
constraints + untested hypotheses + contradictions, injected per session), the v6 doc's
Pillar 2 (ambient injection via UserPromptSubmit hooks — briefing WITHOUT being asked),
Pillar 3 (idle detection → dashboard nudge; delta-aware stop-nudge — only what CHANGED since
last nudge), auto-scaffold (phase completion → next-phase task items materialize), the
CLI-parity gap table (their own MCP-vs-CLI parity bugs — instructive failures).

Baton's side: the MCP northbound surface (`impl/src/mcp-northbound.mjs`), the resident +
`messageOnSpawn`/`elevateWhenNotes` lanes, #71 (orchestrator wake), #181 (member
wake-on-signal), #103 briefing-pack (the orchestrator L0 pack — landed), #81 (orientation
lane), the channel audit's environment report
(`docs/reference/evidence/channel-audit-2026-08-13/environment.md` — what members can actually
reach), #180 (per-wave verification profiles), #10 (attention vocabulary), #174 (member
blindness).

Candidates to evaluate (find your own too): ambient knowledge briefings at session/wave start
(baton's messageOnSpawn is a fixed string; pm's is a computed digest — the difference is the
point); delta-aware nudging (only-what-changed re-briefing — vs baton's nudgeOnCheckpoint
fixed string); idle-detection triggers (vs #163 quiescence — event-derived); auto-scaffold on
milestone completion (wave harvest → next wave's brief skeleton materializes); CLI↔MCP parity
testing (their `--all` double-execution bug is exactly baton's #147/#159 class — ALREADY-HAVE
or adopt their test shape?); session-handoff documents (cross-session continuity — baton's
resident is long-lived, but orchestrator session compaction is MY reality). For each:
ADOPT/ADAPT/REJECT/ALREADY-HAVE with the landing zone.

Deliverable: `docs/reference/evidence/pm-comparison-2026-08-13/pm-agent.md`.
