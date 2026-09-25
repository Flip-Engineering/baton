[attempt: 43ea3f5f-c961-47f2-92d6-2d565dab76b4 row-pm-kg]

# ROW-PM-KG — pm's knowledge graph vs baton's knowledge tiers

Row: `row-pm-kg` · Wave: `pm-comparison-2026-08-13` · Frame: `pm-comparison-2026-08-13/foundry-brief.md` (shared laws)
Lane: **knowledge representation and retrieval** · Deliverable: `pm-kg.md` (this file) + the `shared` publish (attempted below).
Ground truth: `pm-digest/` (README orients; **the `.rs` files are authoritative, prose docs are stale-risk**).
Verdict scale: ADOPT / ADAPT / REJECT / ALREADY-HAVE (landed equivalent named) / OUT-OF-SCOPE.

---

## 0. Bottom line up front

1. **The comparison inverts the naive direction — twice.** First, baton's Cairn KG already owns a
   *superset* of pm's knowledge vocabulary: 19 node kinds and 14 edge kinds registered
   (`coordination-store.mjs:148-149`), including every edge type pm's 13-edge model names
   (Supports, Contradicts, Supersedes, …), plus bi-temporal validity and a contradiction
   *resolution* protocol pm does not have. Second — the honest gap — baton's *scratchpad tiers*
   are untyped notes by settled design: typing arrives at promotion into the project KG
   (docs/34-knowledge-horizons.md KG-2), never at the write surface. So pm's knowledge
   *representation* is almost entirely **already-have**; pm's knowledge *retrieval/activation*
   shapes are the ADAPT material — and most of those are **already encoded in baton's settled
   KG-1..4 design**, unshipped.

2. **The real finding is activation, not representation.** pm's own postmortem names it: "the
   briefings exist as functions but are not yet wired… the briefings exist but are never seen"
   (v6-cognitive-augmentation-scope.md:9-16, :254-256). Baton's channel audit reproduces the
   same disease on the other side: the campaign wrote 13 scratchpad entries, all worker-scoped,
   zero ever reached `shared`, zero `scratch.fact_posted`, zero `knowledge.promote` command
   invocations, and the four elevations that happened were automatic (`settlementLease`), not
   orchestrator-reviewed (channel-audit-2026-08-13/knowledge.md K1-K8). Both systems' knowledge
   machinery is **write-only in practice**. The highest-value verdicts below (briefing,
   contradiction-first surfacing, auto-link) land in the KG-3/KG-4 epics whose *whole point* is
   closing that gap — not in importing new structure from pm.

3. **Every time-based pm mechanism is auto-ADAPT-or-REJECT** (foundry law, standing veto):
   pm's `is_stale(ts, days)` (`src_mcp_dashboard.rs:14`), "unreferenced findings older than N
   experiments" (DESIGN.md Layer 3), and its planned `modified_at`/`node_versions` temporal
   machinery all use wall clocks or counts as controls. Baton's evidence-derived alternatives
   (event-seq recency, bi-temporal validity, contradiction-resolved state) already exist.

---

## 1. Sourcing truth (the law: cite both sides; read-only outside the deliverable)

### 1.1 pm side — the digest (`.rs` files govern over prose)

| File | What it attests |
|---|---|
| `src_store_migrations.rs` | The real schema: per-node-kind tables (projects, phases, experiments, findings, decisions, hypotheses, research, literature, principles, constraints_tbl, feedback, sessions); polymorphic `edges(source_type, source_id, target_type, target_id, relation)` with a unique index (v7); TMS `confidence`/`belief_status` columns (v11); `modified_at` on all node tables + sessions table (v10); per-project `project_seq` (v9); `parent_id` subprojects (v8). |
| `src_kg_mod.rs` + `src_kg_traversal.rs` | Typed-edge traversal: single-hop (`traverse`), multi-hop BFS (`traverse_bfs` with depth, edge filter, bidirectionality), `phase_subgraph` (edge-filtered to Contains/ProducedBy/Informed/Supports/Contradicts/DependsOn/DerivedFrom), `find_contradictions`, proximity/distance metadata. |
| `src_analysis_confidence.rs` | MAD statistical confidence: `confidence = \|best Δ\| / MAD`, thresholds HIGH (≥2.0) / MODERATE (1.0–2.0) / LOW (<1.0), metric extraction via regex over finding text. |
| `src_analysis_contradictions.rs` | Two-layer contradiction cascade: Layer 1 deterministic signal detectors (negation parity, antonym pairs, numeric divergence with shared-context gating, explicit markers) → high-recall candidates; Layer 2 Claude-subagent typed-CoT NLI classification (DIRECT_NEGATION / NUMERIC_CONFLICT / TEMPORAL_SUPERSESSION / CAUSAL_CONFLICT / RECOMMENDATION_CONFLICT / NONE) with explicit "NOT contradictions" guidance. |
| `src_mcp_dashboard.rs` | `build_knowledge_briefing` (:22): active phase, top-5 recent findings, active constraints, untested hypotheses, contradictions in the phase neighborhood; wired into `tool_session_init` (:349) per active project and `tool_session_context` (:744). |
| `src_mcp_tools.rs` | The full 37-tool MCP registry — the agent-facing surface. Cited for `pm_kg_audit` (:229), `pm_orphan_repair` (:156), `pm_since` (:233), `pm_context` (:161), `pm_kg_traverse` (:44), `pm_research_step` (:91), `pm_session_set_experiment` (:204), `pm_set_belief`/`pm_set_confidence` (:218/:223). |
| `v6-cognitive-augmentation-scope.md` | Self-aware inventory: composite scoring weights (text_match 1.0 / evidence 0.2 / recency 0.3; §7), FTS5 + explicit no-embeddings stance (§9), auto-linking on finding/decision writes (§1.1, Pillar 3), the remaining-build map E#123–E#131 (access-weighted retrieval E#128, belief revision E#129, temporal versioning E#130, event-driven feedback E#131). |
| `DESIGN.md` | v3 architecture overview — **stale-risk per README**; cited only for direction (Layer 3 staleness is a *design intent*, not landed). |

### 1.2 baton side — verified this session in this worktree

| Target | What it is |
|---|---|
| `docs/34-knowledge-horizons.md` | The **settled** three-horizon design (task → workflow → project) + KG-1..4 breakdown (#24-#27), orchestrator-admit gate, `recallPreview`, contradiction-first ranking, restricted auto-link, MAD-confidence projection, staleness honesty. |
| `impl/src/coordination-store.mjs:148-149` | `KNOWLEDGE_NODE_TYPES` (19 kinds) / `KNOWLEDGE_EDGE_TYPES` (14 kinds incl. Supports, Contradicts, Supersedes) / `KNOWLEDGE_GROUNDINGS` / projection fields (validityVersion, invalidatedBy, resolvedBy, winnerId, loserId…). |
| `impl/src/coordination-store.mjs:8561-8568, :16393-16416, :16444-16461` | Contradiction **resolution** protocol: `knowledge.contradiction_resolved` apply, winner/loser validation, prefix-CAS idempotency, loser-only invalidation, prior-reader contamination. |
| `impl/src/cairn-run-scorecard.mjs:128-129, :427, :440` | `causal.contradictions` / `causal.resolve_contradiction` ops (deterministic, reverifiable). |
| `impl/src/coordination-store.mjs:16207` + `impl/src/coordinator.mjs:11647-11680` | `admitWorkflowFinding` — the orchestrator-admit gate (the only promotion path). |
| `impl/src/coordination-store.mjs:14103, :14065, :14173` | Scratchpad worker-scope hardcode; `writeScratchpad`; `elevateTaskScratchpad`. |
| `impl/src/application.mjs:827` + `impl/src/coordinator.mjs:403` | `candidateState: 'candidate'` hardcoded on every scratchpad/horizon read — no elevation-review queue exists. |
| `impl/src/coordination-store.mjs:13255, :494-496, :8815` | Context-pack lane (BD3-B): `mintContextPack`, 8KiB body bound, `context.read` event. |
| `docs/reference/evidence/cross-deployment-knowledge-2026-08-07/` (#70) | Cross-deployment knowledge contract — `primaryRoot` is **RED** (grep of `impl/src` for `primaryRoot` returns nothing). The *target* is one-primary-per-project, not federation. |
| `docs/reference/evidence/channel-audit-2026-08-13/knowledge.md` | What the tiers actually did this campaign: 13 entries, all worker-scoped; 4 automatic elevations; zero workflow→project; zero `knowledge.promote` invocations; no review-queue surface. |
| `docs/11-capability-plane.md` / `docs/capabilities/discovery-search.md` (#123) | Atlas code-discovery verbs (fleet-shared retrieval) — the sibling retrieval lane, not the knowledge plane. |
| `impl/src/limits.mjs:71` | `scratchpad.entry.body` 8KiB cap (`scratchpad_entry_exceeded`). |

---

## 2. The two systems, side by side (knowledge plane only)

| Dimension | pm (digest) | baton (cited) |
|---|---|---|
| **Store** | SQLite + FTS5 (v6 §1.3; migrations) | In-memory projections over the `events.jsonl` ledger (`docs/34 §1`; `coordination-store.mjs` `_apply`) |
| **Node kinds** | ~11 typed tables (findings, experiments, decisions, hypotheses, principles, constraints, literature, research, feedback, phases, projects) | 19 kinds registered, incl. every pm kind (`coordination-store.mjs:148`) |
| **Edge kinds** | 13 (v6 §1.3): Informed, Supports, Contradicts, DependsOn, ProducedBy, Supersedes, RelatedTo, CitedIn, Contains, DerivedFrom, TestedBy, ViolatedBy, ConvergesInto | 14 (`coordination-store.mjs:149`): adds ReadBy, ObservedIn; superset |
| **Edge lifecycle** | none visible — unique-indexed relation pairs (v7) | first-class validity + resolution: Contradicts carries winnerId/loserId/resolvedBy; Supersedes requires validity-version/liveness/no-cycle (`:151`, `:16317`, `:16402`) |
| **Belief** | stored `confidence` (0.3–0.9 defaults) + `belief_status` text (v11); `pm_set_belief` auto-suspends dependents | bi-temporal validity (believed-until-invalidated) + contradiction resolution that invalidates the loser and contaminates prior readers (`:8561-8568`) |
| **Confidence scoring** | MAD statistical, computed from metric-bearing finding text (`src_analysis_confidence.rs`) | not stored; ported as read-time projection (KG-4 rule 13) |
| **Contradiction detection** | two-layer cascade: deterministic signal detectors + LLM NLI subagent (`src_analysis_contradictions.rs`) | declaration + deterministic resolution only; no auto-detection (R34-8 bars auto-admission) |
| **Retrieval** | `pm_search` composite: FTS5 text 1.0 + evidence 0.2 + recency 0.3, no embeddings (v6 §7/§9) | `recallPreview`: term + edge-degree + evidence count + recency, weights deployment-owned (`docs/34` KG-3 rule 8) |
| **Activation** | `build_knowledge_briefing` exists, **never ambient** (v6 TL;DR) | KG-3 briefing designed, **never served** in the campaign (channel-audit K1; kg-activation-decisions §"ground truth" 1) |
| **Temporal** | `modified_at` wall-clock columns + sessions (v10); `node_versions` planned, not landed (E#130) | event-sourced full history replay; bi-temporal validity (`docs/34 §1`) |

**Net.** pm is a *structured notebook*; baton's Cairn is a *trust engine* (closed projection,
byte-exact replay, deterministic contradiction closure). The borrowings that matter are the
retrieval/activation shapes, and every one of them is already named in baton's own settled
design — the honest work is shipping KG-1..4, not learning from pm.

---

## 3. Candidate evaluation (verdict per candidate, both sides cited)

### C1 — Typed edges between knowledge entries (supports/contradicts/supersedes)
- **pm:** polymorphic `edges` table + 13 edge types (v6 §1.3; `src_store_migrations.rs` v7);
  typed-edge traversal (`src_kg_traversal.rs`). Entries are typed and linkable at write.
- **baton:** project horizon already has the full typed set (`coordination-store.mjs:149`) with
  lifecycle (Supersedes/Contradicts validity). The **scratchpad tiers** are untyped notes by
  settled design: board items are not KG nodes and never edge endpoints (docs/34 R34-7b, KG-2);
  typing binds at promotion via the Source-node bridge and minted edges (`coordination-store.mjs:16207`).
- **Verdict: ALREADY-HAVE** (project horizon). The "baton's entries are untyped notes" reading is
  true of the ephemeral tiers but is the *settled* design, not an omission — promotion is where
  typing binds. Landing zone: Cairn KG + docs/34 KG-2.

### C2 — Contradiction DETECTION + explicit-resolution workflow
- **pm:** two-layer cascade (`src_analysis_contradictions.rs`): deterministic Layer-1 signal
  detectors (negation parity 0.4, antonym pairs 0.3, numeric divergence with shared-context
  gating 0.5, markers 0.6) → high-recall candidates; Layer-2 LLM subagent typed-CoT NLI.
  `src_kg_mod.rs:123` `find_contradictions`.
- **baton:** declaration + deterministic resolution are landed and richer (winner/loser calculus,
  `coordination-store.mjs:8561-8568, :16444-16461`; `causal.contradictions` /
  `causal.resolve_contradiction`, `cairn-run-scorecard.mjs:128-129`). **Detection is absent**,
  and R34-8 (docs/34 KG-4 rule 12) bars auto-*admission* of Contradicts because it requires
  non-empty evidence composite scoring cannot produce — but rule 12 explicitly *reserves*
  "Contradiction candidates surface in briefings for a human/orchestrator to assert."
- **Verdict: ADAPT.** Adopt the deterministic Layer-1 signal pass as a **candidate-surfacing**
  pass into the briefing contradiction block (feeds KG-4 rule 12 / KG-3 rule 10's
  contradiction-first WARNING; landing #26/#27) — never auto-asserting a Contradicts edge
  (R34-8 respected). **REJECT the Layer-2 LLM NLI subagent**: non-deterministic classification
  written into a byte-exact-replay store violates the closed-projection law and honesty veto;
  baton's resolution is deterministic by design. The signal weights (0.4/0.3/0.5/0.6) are magic
  constants — if the pass ships, weights must be deployment-owned policy, not adopted as-is
  (house no-arbitrary-limits).

### C3 — Staleness (unreferenced entries fade)
- **pm:** DESIGN.md Layer 3 "unreferenced findings older than N experiments"; `src_mcp_dashboard.rs:14`
  `is_stale(ts, days)` — wall-clock/count fade.
- **baton:** KG-4 rule 14 "staleness honesty": unreferenced, superseded, or contradicted-unresolved
  nodes surface in orchestrator briefings **with their age**, riding bi-temporal validity — never
  silently deleted.
- **Verdict: ADAPT.** The surface-with-age shape is already baton's design (KG-4 rule 14, #27).
  pm's "fade after N experiments / T days" is **REJECT** — a wall-clock/count control (standing
  veto) and silent deletion is a surface that can lie (honesty veto).

### C4 — Confidence / belief_status fields
- **pm:** stored `confidence` + `belief_status` columns with defaults (v11: findings 0.5,
  hypotheses 0.3, principles 0.8, constraints 0.9); `pm_set_belief` "TMS auto-suspends
  dependents"; MAD confidence computed from content (`src_analysis_confidence.rs`).
- **baton:** belief is **bi-temporal validity** — a node is believed until invalidated/resolved
  (validityVersion/invalidatedBy/resolvedBy/winnerId/loserId, `coordination-store.mjs:151`).
  Contradiction resolution invalidates the loser and contaminates every prior reader
  (`:8561-8568`) — the "auto-suspend dependents" behavior, event-derived. KG-4 rule 13 ports
  MAD confidence "at read/projection time from content, **never stored as mutable node state**."
- **Verdict: ADAPT** for MAD confidence as a read-time projection (KG-4 rule 13, #27; formula
  from `src_analysis_confidence.rs`, thresholds deployment-owned). **REJECT stored
  confidence/belief_status columns** — a mutable stored belief scalar is a surface that can lie
  (honesty veto); baton's belief is validity + event history. The TMS auto-suspend-on-contradict
  is **ALREADY-HAVE** (loser invalidation + reader contamination).

### C5 — Composite retrieval scoring (text + edges + recency)
- **pm:** `pm_search` composite: text 1.0 + evidence 0.2 + recency 0.3, explicitly no embeddings
  (v6 §7, §9).
- **baton:** docs/34 §2 *borrows this verbatim* and KG-3 rule 8 makes `recallPreview` rank by
  "term + edge-degree + evidence count + recency; weights deployment-owned in the existing policy
  block" (`coordination-store.mjs:119-123`).
- **Verdict: ALREADY-HAVE** (settled design, docs/34 KG-3 rule 8, landing #26). The deployment-owned
  weights already satisfy the no-arbitrary-limits rule; the gap is shipping `recallPreview`, not
  learning the scoring.

### C6 — Auto-linking on write
- **pm:** `pm_log_finding` auto-links via composite scoring (v6 §1.1); `pm_decision` auto-surfaces
  5 related nodes after write.
- **baton:** KG-4 rule 12 "auto-link on admission, restricted… only Supports, Refines, Cites
  candidates may auto-admit, each with its own deployment-owned threshold, at grounding
  `asserted` — never `verified`."
- **Verdict: ALREADY-HAVE** (docs/34 KG-4 rule 12, #27). pm's version is unrestricted; baton's
  restriction to Supports/Refines/Cites at asserted grounding is the disciplined shape — adopt
  nothing.

### C7 — The knowledge briefing (per-project digest on session init)
- **pm:** `build_knowledge_briefing` (`src_mcp_dashboard.rs:22`): active phase, top-5 recent
  findings, active constraints, untested hypotheses, contradictions in the neighborhood; wired
  into `tool_session_init` per active project (`:349`). **Never ambient** — the v6 postmortem's
  explicit gap.
- **baton:** KG-3 `recallPreview` (non-evented, cached, fail-open `briefingUnavailable`), brief-time
  injection as a separate sanitized section at the `_providerBrief`/spawn seam
  (`coordinator.mjs:4512, :4784`), decision-time surfacing, contradiction-first WARNING
  (docs/34 KG-3 rules 8-10; kg-activation-decisions rule 1). Channel audit: nothing served in
  practice (K1).
- **Verdict: ADAPT.** The per-project digest shape is right and already settled — the landing zone
  is KG-3 (#26), and pm's activation-gap lesson is precisely what the epic exists to close. Do
  **not** borrow pm's hook-script/stderr distribution (docs/34 §2: "Do not borrow:
  hook-script/stderr distribution"); baton's own brief/board/package/decision channels carry it.

### C8 — Temporal versioning
- **pm:** `modified_at` wall-clock columns + sessions table (v10, backfilled with
  `datetime('now')`); `node_versions` table planned, not landed (v6 E#130, P3).
- **baton:** event-sourced full-history replay + bi-temporal validity (docs/34 §1;
  `coordination-store.mjs:151`). Every node state is versioned by event seq with checkpoints.
- **Verdict: ALREADY-HAVE** (event-sourced history). **REJECT** pm's `modified_at` wall-clock
  column and separate `node_versions` table — a wall-clock control (standing veto) and a
  redundant second-version-truth when the ledger already replays history.

### C9 (own) — Polymorphic edge table with uniqueness
- **pm:** `edges` + unique index (v7) — simple, no edge lifecycle.
- **baton:** canonical-digest-keyed edges with lifecycle (`canonicalContradictionId`,
  `coordination-store.mjs:16317`; Supersedes liveness/no-cycle at `:16402`).
- **Verdict: ALREADY-HAVE**; baton's edges are strictly richer.

### C10 (own) — FTS5 full-text search
- **pm:** FTS5 virtual tables on 7 node kinds (v6 §1.3).
- **baton:** docs/34 §2 explicit veto: "Do not borrow: SQLite+FTS5… a second store is a second
  truth."
- **Verdict: REJECT** (named veto, docs/34 §2). Retrieval is a projection over the ledger, not a
  second store.

### C11 (own) — Decision-time related-node surfacing, contradiction-first
- **pm:** v6 Pillar 3: surface contradictions first with WARNING prefix; `pm_decision` shows 5
  related nodes.
- **baton:** KG-3 rule 10: decision-time `recallPreview`, contradiction-first ranking, explicit
  WARNING (docs/34).
- **Verdict: ALREADY-HAVE** (settled, #26).

### C12 (own) — Active-constraints + untested-hypotheses surfacing
- **pm:** `build_knowledge_briefing` (b)/(c) — active constraints with severity, untested
  hypotheses.
- **baton:** docs/34 §4 names the briefing content: "top-K relevant project findings, active
  constraints, and a WARNING-marked contradiction"; Constraint/Principle/Question/Hypothesis are
  registered kinds (`coordination-store.mjs:148`).
- **Verdict: ALREADY-HAVE** (design intent, lands with KG-3). The untested-hypotheses block is a
  nice concrete content item for the briefing contract — worth carrying into the KG-3 brief.

### C13 (own) — Cross-project search / multi-project dashboard
- **pm:** subprojects (`parent_id`, v8), cross-project search, portfolio `dashboard`.
- **baton:** single-repoId/project-key scope (docs/34 §2); #70 is *cross-deployment* single-primary
  (RED), deliberately **not** federation — "no `primaryRoot` anywhere."
- **Verdict: OUT-OF-SCOPE.** Portfolio operator is not baton's deployment shape; #70's target is
  one-primary-per-project, which is the opposite of pm's multi-project federation.

### C14 (own) — KG health audit score (pm_kg_audit)
- **pm:** `src_mcp_tools.rs:229` `pm_kg_audit` — "Validates causal backbone compliance, hypothesis
  coverage, literature utilization, edge density, temporal coherence, cross-project references.
  Returns health score 0-100."
- **baton:** `causal.audit` (`cairn-run-scorecard.mjs:120`) is a deterministic, bounded structural
  audit at a pinned `observedSeq` (phase-47 discipline), reverifiable, artifact-written. It checks
  causal/integrity violations; it never emits a heuristic aggregate score.
- **Verdict: REJECT the 0-100 score** — a single heuristic number that hides its reasons is a
  surface that can lie (honesty veto) and an arbitrary numeric control (no-arbitrary-limits). The
  deterministic component checks are **ALREADY-HAVE** (`causal.audit`). The "hypothesis coverage"
  and "literature utilization" components are **OUT-OF-SCOPE** — they presuppose populated
  Hypothesis/Literature kinds, which baton registers but never mints (dormant vocabulary,
  `coordination-store.mjs:148`; cf. the 2026-08-12 kg-cross-check §3.1).

### C15 (own) — Orphaned-node detection + repair actions (pm_orphan_repair)
- **pm:** `src_mcp_tools.rs:156` `pm_orphan_repair` — "Finds orphaned nodes, decisions without
  causal upstream, cross-project bleed, missing phase assignments. Returns specific repair actions."
- **baton:** no KG orphan detection exists — grep for `orphan` in `impl/src` hits worker *session
  handles* only (`coordinator.mjs:1418, :1431, :5233`, etc.), never KG nodes. But KG-4 rule 14
  already surfaces **unreferenced** nodes with age (docs/34), and the phase-47 audit covers
  "decisions without causal upstream" (`causal.audit`).
- **Verdict: ADAPT** — orphaned/unreferenced-node detection as a read-only advisory projection
  feeding the KG-4 staleness surfacing (landing #27; rides `causal.audit`'s deterministic scan +
  bi-temporal validity). **REJECT any auto-repair** — pm returns repair *actions* for a human;
  baton's closed-projection law forbids auto-mutation of the KG (every mutation is admission-gated).
  "Cross-project bleed" is OUT-OF-SCOPE (single-repoId; #70's one-primary target).

### C16 (own) — Since/delta query (pm_since)
- **pm:** `src_mcp_tools.rs:233` `pm_since` — "Show all nodes created or modified since a date or
  session. Delta query for catching up on changes." (ISO-date or session boundary.)
- **baton:** the event-sourced ledger makes a delta trivially derivable from an event boundary
  (seq > N). No such read surface exists; the closest signals are the horizon-digest change flag
  (`kg-activation-decisions.md` rule 4 — `wave.progress()` `knowledgeDigest`) and `context.read`
  audit events. **And the channel audit names the exact gap this could close:** *no command lists
  "entries awaiting elevation review"* (channel-audit K5; `candidateState` hardcoded at
  `application.mjs:827`, `coordinator.mjs:403`).
- **Verdict: ADAPT** — an event-boundary delta read ("what elevated/promoted/changed since the last
  review point") as the elevation-review queue, closing channel-audit K5 with a cited instance.
  pm's ISO-date input is a wall-clock control (standing veto) → the baton shape takes an event seq
  or session-start boundary, never a date. Landing: the #158 shared-write follow-up / KG-2
  activation surfaces (#25/#26). This is the most *actionable* borrowing in this continuation.

### C17 (own) — Topic-centric grouped context brief (pm_context)
- **pm:** `src_mcp_tools.rs:161` `pm_context` — "Searches topic across all node types, groups by
  type, expands 1-hop neighbors, adds cross-references."
- **baton:** `recallPreview` ranks flat by term + edge-degree + evidence + recency (docs/34 KG-3
  rule 8); the briefing block (docs/34 §4) lists findings / constraints / WARNING-contradiction —
  implicitly grouped.
- **Verdict: ADAPT (minor)** — grouped-by-kind presentation is a briefing rendering refinement to
  carry into the KG-3 briefing contract (#26), not a new retrieval mechanism (the retrieval itself
  is ALREADY-HAVE).

### C18 (own) — Finding auto-routing to the active experiment (pm_research_step / pm_session_set_experiment)
- **pm:** `src_mcp_tools.rs:91` `pm_research_step` "Log a finding with auto-routing. Finds the best
  active experiment"; `:204` `pm_session_set_experiment`.
- **baton:** the task→workflow horizon routes run-scoped scratch facts to a run/task — the run is
  baton's "experiment" object (docs/34 KG-2); promotion at settle is the routing.
- **Verdict: OUT-OF-SCOPE** for this row — the auto-routing surface is worker-facing agent
  integration (row-pm-agent's lane); the KG-side fact is already covered by run-scoped routing +
  settle-time promotion.

### C19 (own) — Single-node directed traversal (pm_kg_traverse)
- **pm:** `src_mcp_tools.rs:44` — "Traverse KG from a node. Shows connected edges and nodes with
  direction."
- **baton:** `causal.trace` (`cairn-run-scorecard.mjs:120`) + the recallPreview graph walk (docs/34
  KG-3 rule 8).
- **Verdict: ALREADY-HAVE** — `causal.trace` covers directed provenance; the neighborhood walk is
  recallPreview's second term.

### Reading-honesty note (recorded)
The digest README lists "cluster detection" among `src_kg_traversal.rs` capabilities, and DESIGN.md
Layer 3 repeats it. **The authoritative `.rs` files do not implement it** — `src_kg_traversal.rs`
has `traverse_bfs` / `neighborhood` / `find_nearby` / `phase_subgraph` but no connected-component
or cluster function, and no `cluster` symbol appears in the digest `.rs` files. Per the README law
(.rs governs), I do not treat cluster detection as a pm mechanism and it gets no verdict. The same
README law is why the `FTS5` tables (v6 §1.3, cited to `store/migrations.rs`) are treated as
attested intent even though the digest's `src_store_migrations.rs` excerpt does not show their DDL.

---

## 4. The veto filter (applied explicitly)

Per the foundry's standing vetoes, every candidate was checked against:

- **No wall-clock controls.** pm's time-based machinery (C3 `is_stale` days, C8 `modified_at`,
  DESIGN.md's N-experiments fade, review gates after "T hours") is ADAPT-or-REJECT by law — all
  four landed as ADAPT-to-evidence-derived or REJECT.
- **Honesty over comfort.** Silent auto-fade (C3), stored mutable belief scalars (C4), and
  non-deterministic NLI into a byte-exact store (C2 Layer-2) are all surfaces that can lie — all
  REJECT. Fail-open-with-marker briefing (C7) survives because it degrades honestly.
- **Machine channels stay sterile.** The briefing lands as a derived sanitized section at the
  providerBrief seam (C7), never ambient stderr injection (pm's hook model REJECT, docs/34 §2).
- **Additive-only on closed vocabularies.** No new node/edge kinds proposed — every ADAPT rides
  registered-but-dormant kinds or existing edges.
- **No per-worker heaviness.** All borrowings are hub-managed projections (recallPreview,
  staleness surfacing, contradiction candidate pass) — no per-worker index or store. (The atlas
  fleet-shared index, #123, is the sibling retrieval lane and stays there.)
- **Methodology chain governs impl.** Nothing here ships on enthusiasm; each ADAPT names a
  contract-owning epic (#26/#27) and feeds the coordinator's `pm-qa.md` merge.

---

## 5. Open questions and judgment calls (recorded)

- **J1 — "ALREADY-HAVE" vs "ADAPT" honesty.** docs/34's KG-1..4 are *settled but largely
  unshipped* (channel-audit K1/K7 prove the activation gap). I judge several verdicts as
  "ALREADY-HAVE-as-settled-design, RED-to-ship" rather than "ALREADY-HAVE-landed" — I say so
  plainly in the table rather than laundering unshipped design as capability. The coordinator
  should count the real adoption list as *ship KG-1..4*, not *import from pm*.
- **J2 — C2's Layer-1 ADAPT is a judgment call.** R34-8 could be read to forbid *any*
  auto-Contradicts activity; I read it as barring auto-*admission* (it says "cannot satisfy
  admission"), which is exactly why rule 12 reserves *candidate surfacing*. A deterministic
  candidate pass that only feeds the human/orchestrator-asserted briefing block stays inside the
  law. If the red-team disagrees, the pass degrades to a REJECT — the cost is a retrieval
  nicety, not a loss.
- **J3 — C14's score REJECT vs component ADAPT.** A 0-100 health score (pm) is a heuristic
  aggregate that cannot be audited to byte-exactness; baton's `causal.audit` is deterministic and
  reverifiable. I judge the *score* incompatible with the honesty veto and the *component checks*
  already covered — so REJECT-on-top-of-ALREADY-HAVE is the honest verdict, not a middle "ADAPT the
  score." The score idea should not survive into the coordinator's merge.
- **J4 — C16 rides a named gap.** The delta/review-queue ADAPT is the continuation's strongest
  because it closes channel-audit K5 (no "awaiting elevation" surface) with a cited instance, not
  just a shape affinity. I rank it above C7's briefing in actionability precisely because K5 is a
  *proven* failure this campaign and the delta read is cheap and event-derived.
- **OQ1 — Signal weights.** pm's Layer-1 weights (0.4/0.3/0.5/0.6) and MAD thresholds
  (2.0/1.0) are magic constants. Baton's no-arbitrary-limits rule demands derivation or
  deployment-owned policy. Whether the contradiction candidate pass ships with derived weights
  is a contract-time question (recorded for the coordinator).
- **OQ2 — #87/#48 attribution.** The row brief maps #87/#48 to context packs; `docs/PROGRESS.md:494`
  records "#87+#48 the workflow surface." The context-pack lane (BD3-B, `coordination-store.mjs:13255`)
  and briefing-pack epic (#103) are the landed context machinery. The exact issue-number-to-lane
  mapping is ambiguous; I cite the lane by module, not by issue number, to avoid over-claiming.
- **OQ3 — Staleness horizon.** Baton's staleness honesty surfaces age but defines no horizon. Per
  house rule it must derive from an evidence boundary (the pinned `observedSeq` audit boundary,
  docs/34 §"fences"), never a magic "N runs = stalled" constant. The KG-4 contract owns that derivation.

---

## 6. The shared publish (attempt + exact refusal — #158 evidence)

Per the foundry frame, this row publishes its full report to the `shared` scratchpad partition
(kind `note`, title "row-pm-kg"). The attempt and its outcome are themselves findings:

1. **No write verb exists on any surface.** The CLI scratchpad family is read+elevate only
   (`application-cli.mjs:1488, :1506`). Live probe this session against this worktree's
   `parseBatonCli` (`impl/src/application-cli.mjs`):
   `['run','scratchpad','write','run:1','--scope','shared','--body','x']` →
   **THROW `unexpected argument write`**; `['run','scratchpad','append',…]` →
   **THROW `unexpected argument append`**; `['run','scratchpad','read','run:1','--scope','shared']`
   → parses (read-only). Wrapper: `cliError(msg, 'cli_invalid')` (`application-cli.mjs:50`).
2. **The kernel write hardcodes worker scope.** `writeScratchpad` (`coordination-store.mjs:14065`)
   sets `const scope = \`worker:${fields.workerId}\`` at `coordination-store.mjs:14103`. A
   directly-invoked write cannot target `shared`.
3. **Body cap.** This report exceeds the `scratchpad.entry.body` 8KiB cap
   (`limits.mjs:71`, refusal `scratchpad_entry_exceeded`) — even a condensed note would need to
   be clipped.

**Outcome: a `shared` publish is structurally impossible from a member — the #158 gap, reproduced
live from the CLI surface this session.** The durable artifact — this file — is the report.
This row's up-channel `SCRATCHPAD_WRITE:` emission is the only member-facing publish path and lands
worker-scoped by the `coordination-store.mjs:14103` hardcode, matching the channel audit's K8.

---

## 7. Verification

- Edited file: only `docs/reference/evidence/pm-comparison-2026-08-13/pm-kg.md` (this file). No
  writes outside the deliverable path; all external reads (pm-digest, baton `impl/src`, docs,
  channel-audit) were read-only.
- pm-side citations come from the digest `.rs` files (authoritative) and the v6 scope doc
  (self-aware inventory); DESIGN.md is flagged stale-risk and used only for design intent.
  `src_mcp_tools.rs` was read in full for the continuation (C14-C19).
- baton-side citations were live-verified this session in this worktree (grep/read of
  `impl/src/application.mjs`, `impl/src/application-cli.mjs`, `impl/src/coordination-store.mjs`,
  `impl/src/cairn-run-scorecard.mjs`, `impl/src/coordinator.mjs`, `impl/src/limits.mjs`,
  `docs/34-knowledge-horizons.md`, `docs/PROGRESS.md`, the #70 and channel-audit evidence dirs).
- Continuation additions verified: no `orphan` KG semantics in `impl/src` (only worker session
  handles); no `cluster` symbol in the digest `.rs` files (recorded as reading-honesty note);
  `causal.audit`/`causal.trace` op registrations re-read at `cairn-run-scorecard.mjs:120`.
- Deployment verification command per the execution contract: `true` → expected exit `0`.
