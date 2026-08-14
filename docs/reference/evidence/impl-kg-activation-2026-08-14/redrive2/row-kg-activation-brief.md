# ROW BRIEF — row-kg-activation: make the knowledge plane READABLE (#24/#25/#26/#27 · #186)

The knowledge plane is WRITE-ONLY today: 184 auto-promotions, zero reads (store-cited,
#211 finding 3). A plane nobody reads is non-functional. Your contract:
`impl/test/kg-activation-red.test.mjs` (KG-A1..KG-A5, RED at HEAD) — read it in full first;
its header names the deeper contract (docs/reference/evidence/kg-activation-2026-07-31/
kg-activation-decisions.md v1 — read that too).

The five pins, in suite language: ambient knowledge SERVED INTO SPAWN BRIEFS (bounded,
provenance-wrapped, honest-empty, expired-never-serves, byte cap) · the first-class candidacy
queue projection (per source kind, admit-removes, capped+ordered, no cross-view duplicates) ·
ritual hooks (candidacy counts in wave receipts/terminal outlines — zero is `0`, never a
missing field) · horizon digests in wave member rows (cache-correct) · gate honesty (the
orchestrator-admit gate stays the ONLY promotion path — NO auto-admit call site).

**Hard bounds (from the suite header):** additive projections + brief serving ONLY. No new
commands, no registry entries, no MCP/CLI/web surfaces, no auto-promotion. NUL discipline on
coordination-store.mjs (`grep -an`/`sed -n` only, never disturb the NUL bytes).

**Your file partition:** `impl/src/coordinator.mjs` + `impl/src/coordination-store.mjs` +
`docs/reference/evidence/impl-kg-activation-2026-08-14/redrive1/**`. (The store file is shared with
the plan-object wave this window — keep your hunks additive and disjoint: new projection
reads, never edits to existing folds. Conflict at a shared region → DECISION_REQUEST, don't
improvise.) Never edit the acceptance suite.

**Acceptance:** KG-A1..KG-A5 green at their named stages; adjacents green-unchanged:
`cross-deployment-knowledge-red` and `orchestrator-plan-object-red` may be RED-by-design
(name them, don't absorb); `coordinator` suite green (paste counts). Notes:
`docs/reference/evidence/impl-kg-activation-2026-08-14/redrive1/notes-row-kg-activation.md` —
`[attempt: <salt> row-kg-activation]` verbatim in its first five lines.
