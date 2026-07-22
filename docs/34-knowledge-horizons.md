# 34 — Knowledge Horizons: task, workflow, and project knowledge graphs

Status: design groundwork for issues KG-1..4. Companion to docs/32 (reflexive orchestration)
and docs/33 (REPL layer). Grounded in the 2026-07-22 inventory and in a critical read of the
`project-manager` v3/v6 knowledge system (atari-homelab:~/projects/project-manager —
DESIGN.md, docs/v6-cognitive-augmentation-scope.md, src/kg/, src/analysis/).

## 1. The surprising truth: baton already owns the KG

The Cairn knowledge system is **complete and durable**, not half-built
(spec/phase11/coordination-knowledge.md; coordination-store.mjs:115-123, :752, :11552-12560):

- 19 node types, 14 edge types, groundings `verified|observed|derived|asserted`;
  bi-temporal validity (`validFrom/validTo/validityVersion` + full history maps);
  hub-derived identity `knowledge:${type}:${digest}` with content binding and causal-orphan,
  temporal-coherence, and supersession rules (:11654-11717).
- Bounded graph query **with replayable receipts** (`recallKnowledgeBounded` :12398),
  contradiction resolution (:12155, :12210), recall assessment (:12420-12522), evented reads
  (`knowledge.read` :12540) that feed those assessments.
- **A promotion path already exists**: scratch facts promote into the KG under a bounded
  policy (`minScratchReaders`), and verified task outcomes auto-promote Findings/Questions/
  Counterexamples (coordinator.mjs:5558-5572, :10171-10177).
- All of it replays from `events.jsonl` through `_apply` (:7158) with projection checkpoints —
  the house event-sourcing pattern; no SQL anywhere.

So KG-1..4 is **not** "build a knowledge graph." It is: layer three *horizon projections* over
the existing stores, build the *promotion paths* between them, and close the *activation* gap —
the same gap project-manager's v6 postmortem names with unusual honesty: "the briefings exist
as functions but are not yet wired… the briefings exist but are never seen"
(v6-cognitive-augmentation-scope.md:9-16, :254-256). Baton must not build a knowledge system
nobody sees.

## 2. What project-manager teaches (borrowed with judgment)

**Borrow:**
1. **Ambient activation beats query tooling.** PM's three pillars that mattered were not
   traversal APIs but `pm_session_init` briefings, decision-time related-node surfacing
   (`pm_decision` auto-surfaces 5 related KG nodes, v6 :126-128), and finding-time auto-linking
   (`pm_log_finding` composite-scored auto-edge, v6 :34). Knowledge delivered *at the moment of
   work* beats knowledge available on request. → KG-3.
2. **Composite retrieval scoring without embeddings.** PM scores text_match 1.0 + edges +
   evidence 0.2 + recency 0.3 and explicitly rejects embedding retrieval at KG scale
   (v6 :81-87, :250-252: "FTS5 + KG connectivity already out-performs naive embedding cosine").
   Baton's recall already walks terms + graph; adding evidence/recency/composite ranking is a
   scoring-layer change, not an infrastructure one. **No embeddings, ever** — also baton's
   no-new-dependency stance. → KG-3.
3. **Contradictions rank first, with WARNING.** PM's decision support re-ranks any node linked
   by `Contradicts` to the top with an explicit marker (v6 :137-139); its analysis layer
   (`src/analysis/contradictions.rs`) treats contradiction as a first-class retrieval concern.
   Baton has the edge type and the resolution machinery; it does not surface contradictions
   *into* briefings. → KG-3/KG-4.
4. **Auto-linking on admission.** PM's highest-compounding feature: every new finding gets
   composite-scored candidate edges at write time (v6 :34). Baton admits KG nodes with zero
   candidate-edge proposal — the graph grows nodes faster than edges. → KG-4.
5. **MAD confidence over metric-bearing findings** (`src/analysis/confidence.rs`): extract
   numeric metrics from finding text, confidence = |best Δ| / MAD, thresholds HIGH/MODERATE/
   LOW. Directly applicable to baton's experiment-flavored Findings and to the DIAG epics. → KG-4.

**Do not borrow:**
- **SQLite + FTS5.** Baton's house pattern is in-memory projections rebuilt from the ledger
  with checkpoints; a second store is a second truth. Term matching stays the bounded recall
  term layer (PM's FTS is only needed because its store is SQL; baton's candidate set is
  smaller and already indexed in Maps).
- **Hook-script distribution** (stderr injection via UserPromptSubmit). Baton owns its brief /
  board / package / decision channels — activation rides those, not shell hooks.
- **PM's flat project model.** PM is single-agent-centric; baton's horizons must respect
  multi-worker authority (orchestrator admits shared knowledge; workers propose).

## 3. The three horizons

### KG-1 — Horizon projections (three read models, one truth)

1. **Task horizon (ephemeral):** board items (REFLEX-2), scratch facts/claims, pending
   interactions, and the worker's own REPL bindings (docs/33 §3.2) for one task. Dies with the
   task; anything worth keeping must promote before close.
2. **Workflow horizon (run-scoped):** all boards, packages, cells, REPL bindings, reports, and
   decision settlements for one run. Logically run-keyed (persists in the log, but scoped by
   `runId`). This is the orchestrator's working memory for a wave.
3. **Project horizon (persistent):** the Cairn KG, repoId-scoped, durable across runs — already
   exists. Reuse decisions, route learning, representations live here too.
4. Each horizon is a **cached projection keyed to its own replay-derivable fence** (board
   fence, run event count, KG last-seq respectively) with non-evented reads — the REFLEX-2 F10
   rule everywhere. Exception: project-horizon reads keep the existing evented
   `knowledge.read`, because recall assessment depends on it (:12420-12522) — audit outranks
   polling cost at this horizon; the polling surfaces (boards) stay non-evented.

### KG-2 — Promotion paths (how knowledge climbs horizons)

5. **Task → workflow:** a board item close emits a candidate workflow finding (hub-derived,
   grounded `observed`, citing the exact `(itemId, itemVersion, itemDigest)`); a package
   admission cites its branches as `DerivedFrom` the cells/sources they wrap.
6. **Workflow → project:** at run settle, the orchestrator reviews workflow findings (surfaced
   as a settle-time checklist projection) and admits chosen ones into the project KG —
   extending the existing verified-outcome auto-promotion (coordinator.mjs:5558-5572) with an
   explicit orchestrator-admit gate. No silent auto-promotion of run-scoped claims into
   persistent truth.
7. **Task → project (shortcut):** the existing scratch→KG promotion (`minScratchReaders`)
   stays as-is; board claims/facts do not bypass the workflow horizon.

### KG-3 — Activation (knowledge at the moment of work)

8. **Brief-time briefing:** dispatch renders a bounded `knowledgeBriefing` section into the
   worker brief: top-K relevant project-KG nodes for the brief's objective + scope, via
   `recallKnowledgeBounded` with the new composite ranking (term + edge-degree + evidence
   count + recency; weights deployment-owned in the existing policy block
   coordination-store.mjs:119-123). Sanitized + provenance-marked (the F14 discipline),
   bounded bytes with explicit truncation.
9. **Decision-time surfacing:** a worker's decision request (REFLEX-1) triggers an
   orchestrator-side related-nodes projection (question text + options as recall terms),
   attached to the attention item the operator/driver sees — PM's `pm_decision` pattern, with
   contradictions ranked first and marked (rule 10).
10. **Contradiction-first ranking:** any briefing/related-nodes projection re-ranks nodes
    joined by `Contradicts` to the involved claim to the top with an explicit marker. Silent
    contradiction is the worst KG failure mode (PM v6 :137-139).
11. **Board-read sidebar:** `baton_board_read`-style projections carry a small related-KG
    sidebar for the board's items (bounded, cache-keyed with the board fence).

### KG-4 — Graph growth and quality

12. **Auto-link on admission:** every KG node admission (any promotion path) proposes up to K
    candidate edges via composite scoring against existing nodes; proposals above a
    deployment-owned threshold become `asserted`-grounding edges (never `verified` — grounding
    honesty), below it are dropped with a replayable receipt. PM's evidence: this is the
    feature that made its graph useful over time (v6 :34).
13. **MAD confidence for metric-bearing Findings:** port PM's `confidence.rs` discipline —
    metric extraction over Finding content, `confidence = |best Δ| / MAD`, HIGH/MODERATE/LOW —
    computed at read/projection time (never stored as mutable node state; recompute from
    content, the house content-addressing rule).
14. **Staleness honesty:** unreferenced, superseded, or contradicted-unresolved nodes surface
    in orchestrator briefings with their age — PM's staleness detection (DESIGN.md:30) adapted
    to bi-temporal validity baton already has.

## 4. What this unlocks (the user's workflows)

- A worker starting a task receives its objective **plus** the three most relevant project
  findings, any active constraints, and a WARNING-marked contradiction if one exists — without
  asking (the ambient win PM never shipped).
- A worker's mid-flight decision request reaches the orchestrator with related KG context
  attached, so answering "option A or B?" takes seconds, grounded in what prior runs learned.
- Wave-level learning: run 2 of a campaign starts from run 1's promoted findings — the
  long-horizon, multi-task memory the current substrate persists but never *serves*.
- The orchestrator's own briefings (docs/32 §3.5 attention) gain the same related-KG layer,
  closing the loop upward as well as downward.

## 5. Non-goals

No new store (no SQLite/FTS). No embeddings. No mutation of Cairn admission/validity rules
(this epic layers projections, promotions, and scoring *over* them). No auto-promotion into the
project horizon without the orchestrator-admit gate. No per-worker private KGs (workers read
slices; they do not own graph state). No MCP/CLI surfaces in this epic (the reflex MCP wave
consumes these projections once they exist).

## 6. Issue breakdown

- **KG-1**: horizon projections — three cached read models with per-horizon fences and the
  evented/non-evented split of rule 4.
- **KG-2**: promotion paths — board-close → workflow finding; package → DerivedFrom citations;
  settle-time orchestrator-admit gate into the project KG.
- **KG-3**: activation — brief-time `knowledgeBriefing`, decision-time related-nodes,
  contradiction-first ranking, board-read sidebar, composite scoring policy.
- **KG-4**: growth/quality — auto-link on admission with asserted-grounding honesty, MAD
  confidence projection, staleness surfacing.

Each ships red-first (`impl/test/kgN-*-red.test.mjs`) with a decisions contract in the REFLEX
style, an adversarial red-team pass, and a full-suite gate before any implementation wave.
