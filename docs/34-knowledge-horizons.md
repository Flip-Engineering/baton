# 34 — Knowledge Horizons: task, workflow, and project knowledge graphs

Status: design groundwork for issues KG-1..4, **v2 revised per red-team findings R34-1..10**
(2026-07-22). v1's activation core was dishonest about cost (`recallKnowledgeBounded` is an
evented O(graph) write — unusable on the dispatch hot path), broke brief identity (briefDigest
feeds continuation matching, coordinator.mjs:4506, :4622), cited non-node objects as edge
endpoints, and fenced the run horizon on a counter that does not exist. The v2 sections below
re-ground all four. Companion to docs/32 and docs/33.

## 1. The surprising truth: baton already owns the KG

The Cairn knowledge system is **complete and durable** (spec/phase11/coordination-knowledge.md;
coordination-store.mjs:115-123, :752, :11552-12560): 19 node types, 14 edge types, groundings
`verified|observed|derived|asserted`; bi-temporal validity with full history; hub-derived
content-bound identity; bounded graph query with replayable receipts
(`recallKnowledgeBounded` :12398); contradiction resolution; recall assessment; evented reads
(`knowledge.read` :12540); a scratch→KG promotion policy (`minScratchReaders`); verified-outcome
auto-promotion (coordinator.mjs:5558-5572, :10171-10177). All of it replays from
`events.jsonl` through `_apply` (:7158) with checkpoints. No SQL anywhere.

So KG-1..4 is **not** "build a knowledge graph." It is: layer three *horizon projections* over
the existing stores, build *promotion paths* between them, and close the *activation* gap — the
gap project-manager's v6 postmortem names honestly: "the briefings exist as functions but are
not yet wired… the briefings exist but are never seen" (v6-cognitive-augmentation-scope.md:9-16,
:254-256). Baton must not build a knowledge system nobody sees.

## 2. What project-manager teaches (borrowed with judgment)

**Borrow:** (1) **Ambient activation beats query tooling** — PM's compounding features were
session-init briefings, decision-time related-node surfacing (`pm_decision` shows 5 related
nodes, v6 :126-128), and finding-time auto-linking (v6 :34), not traversal APIs. (2) **Composite
retrieval scoring without embeddings** — text 1.0 + edges + evidence 0.2 + recency 0.3; PM
explicitly rejects embeddings at KG scale (v6 :81-87, :250-252). (3) **Contradictions rank
first, marked** (v6 :137-139; src/analysis/contradictions.rs). (4) **Auto-link on admission**
(v6 :34). (5) **MAD confidence over metric-bearing findings** (src/analysis/confidence.rs:
confidence = |best Δ|/MAD, HIGH/MODERATE/LOW) — applicable to baton's Findings and the DIAG
epics.

**Do not borrow:** SQLite+FTS5 (baton's house pattern is in-memory projections over the ledger;
a second store is a second truth); hook-script/stderr distribution (baton owns brief/board/
package/decision channels); PM's flat single-agent authority model (baton is multi-worker:
orchestrator admits shared knowledge, workers propose).

## 3. The three horizons

### KG-1 — Horizon projections (three read models, one truth)

1. **Task horizon (ephemeral):** board items, scratch facts/claims, pending interactions, and
   the worker's own REPL bindings (docs/33 §3.2) for one task. Dies with the task; anything
   worth keeping must promote before close.
2. **Workflow horizon (run-scoped):** all boards, packages, cells, REPL bindings, reports, and
   decision settlements for one run — the orchestrator's working memory for a wave.
3. **Project horizon (persistent):** the Cairn KG, repoId-scoped, durable across runs — already
   exists.
4. **Fences (R34-9: the "run event count" fence does not exist — union rule chosen).** Each
   horizon projection is cached keyed to the **union of its constituent replay-derivable
   fences**: task horizon = `(boardFence(board), bindingFence(worker scope), interaction
   generation)`; workflow horizon = the tuple of its boards' fences + binding fences + the
   run's decision-settle count (all replay-derivable counters that already exist or ship with
   docs/33); project horizon = the KG's last applied event seq (`_apply` position, already
   tracked for checkpoints). No new counter is invented for fencing. Reads are non-evented at
   the task/workflow horizons (F10 rule); project-horizon reads keep the existing evented
   `knowledge.read` ONLY where recall assessment consumes them (:12420-12522) — and KG-3's
   briefing path is explicitly NOT one of those (rule 8).

### KG-2 — Promotion paths (how knowledge climbs horizons)

5. **Task → workflow:** a board item close emits a candidate workflow Finding, hub-derived,
   grounding `observed` (no evidence required at admission, coordination-store.mjs:12258),
   evidence ref = the `board.item_closed` event's `coordinationSeq` (:12231-12239), and the
   exact `(itemId, itemVersion, itemDigest)` triple carried in the Finding body/extras — board
   items are not KG nodes and are never edge endpoints (R34-7b).
6. **Package citation:** at package promotion, each wrapped cell mints (idempotently, by
   content digest) a **`Source` KG node** — cells are not nodes either, so typed citation needs
   this bridge (R34-7b; edge endpoints must be existing nodes, :12276-12277) — and the
   package's Finding links `DerivedFrom` those Source nodes.
7. **Workflow → project:** at run settle, the orchestrator reviews workflow findings (a
   settle-time checklist projection) and admits chosen ones into the project KG through an
   explicit **orchestrator-admit gate**: the coordinator wrapper binds `actor: 'orchestrator'`
   under the run-orchestrator lease (the board orchestrator-authority seam,
   coordinator.mjs:9141, :9153-9171) — never a free-string actor at the store (R34-10i). No
   silent auto-promotion of run-scoped claims into persistent truth; the existing
   verified-outcome auto-promotion (:5558-5572) and scratch→KG policy stay as-is.

### KG-3 — Activation (knowledge at the moment of work)

(R34-6: v1 specified `recallKnowledgeBounded` at dispatch — it **appends** `knowledge.recall`
(:12983) after a full live-node+edge rebuild with refusal ceilings (:12869-12908), and its
reader binding discards pre-claim readers (:12930-12933, :12994). Deleted. Replacement:)

8. **`recallPreview`: a non-evented, cached briefing projection.** Same bounded candidate
   machinery as recall (term matching + graph walk + the KG-3 composite ranking: term +
   edge-degree + evidence count + recency; weights deployment-owned in the existing policy
   block :119-123) but **appends nothing** and is cached keyed to the project-horizon fence
   (rule 4). It never feeds recall assessment (named, accepted: assessment keeps consuming
   only evented reads/recalls; making preview traffic assessable is a follow-up). On any
   refusal ceiling the projection **degrades to an explicit `briefingUnavailable` marker and
   dispatch proceeds** — briefings are best-effort, never a dispatch blocker (fail-open,
   honestly marked).
9. **Brief-time injection seam (R34-7a):** the briefing renders as a SEPARATE sanitized
   section at the `_providerBrief`/spawn seam (coordinator.mjs:4512, :4784) — never into the
   admitted brief object, so `briefDigest` and continuation matching (:4506, :4622) are
   untouched and provider-visible content stays derived, not divergent. Bounded bytes,
   SECRET_SHAPED_TEXT discipline, provenance-marked (F14).
10. **Decision-time surfacing:** a worker's decision request (REFLEX-1) triggers an
    orchestrator-side `recallPreview` over question+options, attached to the attention item —
    PM's `pm_decision` pattern. **Contradiction-first ranking:** any node joined by
    `Contradicts` to a surfaced claim ranks first with an explicit WARNING marker (PM v6
    :137-139) — silent contradiction is the worst KG failure mode.
11. **Board-read sidebar:** board projections carry a small related-KG sidebar per item,
    cache-keyed with the board fence.

### KG-4 — Graph growth and quality

(R34-8: auto-Contradicts cannot satisfy admission — it requires non-empty evidence
(:12286-12291) which composite scoring cannot produce; Supersedes requires expectedValidity-
Version/liveness/no-cycle (:12279-12285). Scope cut:)

12. **Auto-link on admission, restricted:** every KG node admission proposes up to K candidate
    edges via composite scoring; only `Supports`, `Refines`, and `Cites` candidates may
    auto-admit, each with its own deployment-owned threshold (per-edge-type thresholds), at
    grounding `asserted` — never `verified`. Contradiction candidates surface in briefings for
    a human/orchestrator to assert with evidence instead (feeds rule 10).
13. **MAD confidence for metric-bearing Findings:** port PM's `confidence.rs` discipline —
    metric extraction over Finding content, `confidence = |best Δ| / MAD`, HIGH/MODERATE/LOW —
    computed at read/projection time from content, never stored as mutable node state.
14. **Staleness honesty:** unreferenced, superseded, or contradicted-unresolved nodes surface
    in orchestrator briefings with their age, riding bi-temporal validity baton already has.

## 4. What this unlocks

- A worker starting a task receives its objective **plus** the top-K relevant project findings,
  active constraints, and a WARNING-marked contradiction if one exists — without asking (the
  ambient win PM never shipped).
- A worker's mid-flight decision request reaches the orchestrator with related KG context
  attached; "option A or B?" gets answered in seconds, grounded in what prior runs learned.
- Wave-level learning: run 2 of a campaign starts from run 1's promoted findings.
- The orchestrator's own attention surface gains the same related-KG layer — reflexive in both
  directions.

## 5. Non-goals

No new store (no SQLite/FTS). No embeddings. No mutation of Cairn admission/validity rules.
No auto-promotion into the project horizon without the orchestrator-admit gate. No per-worker
private KGs. No MCP/CLI surfaces in this epic (the reflex MCP wave consumes these projections).
No recall-assessment changes (preview traffic stays unassessed this epic).

## 6. Issue breakdown

- **KG-1**: horizon projections — three cached read models on the union-fence rule (rule 4),
  non-evented task/workflow reads.
- **KG-2**: promotion paths — board-close Finding (coordinationSeq evidence + extras triple),
  Source-node bridging for package citations, settle-time orchestrator-admit gate.
- **KG-3**: activation — `recallPreview` (non-evented, cached, fail-open), providerBrief
  injection seam, decision-time related-nodes, contradiction-first ranking, board sidebar,
  composite scoring policy.
- **KG-4**: growth/quality — auto-link restricted to Supports/Refines/Cites with per-type
  thresholds, MAD confidence projection, staleness surfacing.

Each ships red-first (`impl/test/kgN-*-red.test.mjs`) with a decisions contract in the REFLEX
style, an adversarial red-team pass, and a full-suite gate before any implementation wave.
