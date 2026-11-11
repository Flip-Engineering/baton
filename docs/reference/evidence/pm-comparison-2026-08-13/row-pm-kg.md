# ROW BRIEF — row-pm-kg: pm's knowledge graph vs baton's knowledge tiers

Read `foundry-brief.md` first (the shared laws bind you — cite both sides, verdict per
candidate, baton's vetoes, attempt-echo). Your lane: **knowledge representation and retrieval**.

Ground in the digest: `src_store_migrations.rs` (the real schema — node tables, the polymorphic
edge table, FTS5), `src_kg_mod.rs` + `src_kg_traversal.rs` (typed edges, traversal, clusters,
contradiction flagging, staleness), `src_analysis_confidence.rs` + `src_analysis_contradictions.rs`
(confidence scoring + belief revision), `src_mcp_dashboard.rs` (`build_knowledge_briefing`),
`v6-cognitive-augmentation-scope.md` (composite retrieval scoring; E#128-E#131 intent).

Baton's side (read the real code/issues): the scratchpad/knowledge tiers —
`run.scratchpad.read`/`elevate` surfaces, the task→workflow→project horizons with
orchestrator-gated elevation (the campaign's settled design), #70 (cross-deployment federation —
RED, no `primaryRoot` anywhere), the channel audit's knowledge findings
(`docs/reference/evidence/channel-audit-2026-08-13/knowledge.md` — what the tiers actually did
in practice), #87/#48 (context packs), #123 (atlas discovery verbs).

Candidates to evaluate (find your own too): typed edges between knowledge entries
(supports/contradicts/supersedes — baton's entries are untyped notes); contradiction DETECTION
+ explicit-resolution workflow; staleness (unreferenced entries fade); confidence/belief_status
fields; composite retrieval scoring (text+edges+recency); auto-linking on write; the knowledge
briefing (per-project digest on session init); temporal versioning. For each: ADOPT/ADAPT/
REJECT/ALREADY-HAVE with the baton landing zone named (issue/module) or OUT-OF-SCOPE.

Deliverable: `docs/reference/evidence/pm-comparison-2026-08-13/pm-kg.md`.
