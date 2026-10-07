# pm-digest — the project-manager repo's ground-truth package (pulled 2026-08-13)

Source: `atari-homelab:~/projects/project-manager` (HEAD `353e5f9` — "feat(v6): CLI mirrors +
project-scoped search"). **The prose docs are stale-risk** (the operator's warning: READMEs lie
about age); **the `.rs` files are the truth**. Where a doc and a source file disagree, the source
file governs. The v6 scope doc (2026-04-28) is a *self-aware* inventory — its "LANDED/gap" table
was accurate as of its date and its remaining-build list (E#123–E#131) is the best map of intent.

## Files

- `DESIGN.md` — v3 architecture overview (6 layers: SQLite store, DAG engine, KG, MCP agent
  runtime, cross-session continuity, multi-project orchestration). Directionally accurate;
  details have drifted (the real edge-type count is 13, not 8).
- `v6-cognitive-augmentation-scope.md` — the cognitive-augmentation layer: 37 MCP tools,
  composite-scored retrieval (FTS5 text + edges + evidence + recency), auto-linking findings,
  ambient-briefing design (hooks), belief revision via Contradicts edges, temporal versioning
  (planned), access-weighted retrieval (planned). The most current design doc.
- `TASKS.md` — the v3 TDD task decomposition (store → DAG → KG → CLI → MCP). Shows the build
  order and the test-first discipline.
- `src_store_migrations.rs` — **the actual data model** (SQLite schema + FTS5 tables + the
  polymorphic edge table). Read this for what a "knowledge object" actually is in pm.
- `src_kg_mod.rs` + `src_kg_traversal.rs` — the knowledge graph: typed edges, traversal with
  depth control, cluster detection, contradiction flagging, staleness detection.
- `src_dag_mod.rs` — the DAG engine: topological order, impact propagation, auto-transitions,
  stagnation detection, review gates.
- `src_analysis_confidence.rs` + `src_analysis_contradictions.rs` — the belief layer:
  confidence scoring, contradiction detection/resolution workflow.
- `src_mcp_tools.rs` — the 37-tool MCP registry (the agent-facing surface).
- `src_mcp_dashboard.rs` — session_init + `build_knowledge_briefing` (the ambient-context
  machinery: recent findings + constraints + untested hypotheses + contradictions).
- `src_lib.rs`, `WEB_DESIGN.md` — module map / the web UI sketch.
