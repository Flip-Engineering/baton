# KG-3 + KG-4 decisions contract — activation & graph quality (issues #26, #27)

Ground truth: docs/34-knowledge-horizons.md v2 §3 KG-3 (rules 8–11) and KG-4 (rules 12–14), already
red-team-corrected (R34-6, R34-7a/b, R34-8, R34-9). Binding decisions from the design docs are
**settled and NOT re-litigated here**: `recallPreview` is non-evented; the briefing injects at the
`_providerBrief`/spawn seam without touching `briefDigest`; auto-link is restricted to
Supports/Refines/Cites; project-horizon fence = the KG's last applied event seq. This file is the
*implementation* contract — exact shapes, admission/validation order, error codes, bounds, the
fold surface, and the red-test list.

Code this contract mirrors (verified line-for-line):
- **Recall machinery to mirror read-only** — `recallKnowledgeBounded` (coordination-store.mjs:12965),
  `_buildKnowledgeRecall` (:12859-12917): term normalization/tokenization (`normalizedRecallText`
  :163, `recallTerms` :164, `recallBody` :173, `utf8Snippet` :174), lexical scoring
  (:12879-12884), incident-edge index + BFS graph walk (:12885-12900), `rank()` composite
  (:12901-12905), Contradicts-bundle expansion (:12906-12908), and every refusal ceiling
  (`maxCandidates` :12870, `maxCandidateBytes` :12872, `maxGraphRows` :12892/:12895,
  `maxGraphDepth` :12897, `maxResults` :12908). The evented tail this contract must **not** touch:
  `knowledge.recall` append (:12983), reader-worker binding (:12854), and recall-assessment
  consumption (`_deriveRecallAssessment` scan of `knowledge.recall` receipts :13026-13035).
- **Edge endpoint/type rules** — `_validateKnowledgeEdgePayload` (:12271-12292): endpoints must be
  existing nodes (:12276-12277); `Supersedes` needs `expectedValidityVersion`, liveness, no open
  contradiction, no cycle, no backdate (:12279-12284); `Contradicts` needs **non-empty evidence**
  and a canonical pair id (:12286-12291); the admission entry point `addKnowledgeEdge` (:12594-12606,
  event kind `knowledge.edge_added` :12599). Node types :120, edge types :121, groundings :123.
- **Sanitization** — `SECRET_SHAPED_TEXT` (application.mjs:214-219) + `boundedAttentionText`
  (:221-228): NFKC-normalize, redact credential-shaped prose, cap at `MAX_ATTENTION_TEXT_BYTES`.
- **Injection seam** — `_providerBrief(brief)` (coordinator.mjs:2860-2868) returns the provider-facing
  brief (`createBrief(...)` :2867); called at initial spawn (:2620) and recovery (:4512); the digest
  it must not perturb is `briefDigest = canonicalDigest(activeTask.brief)` (:4506) and continuation
  matching on it (:4622); the raw `adapter.spawn(workerId, task.brief, …)` seam is :4784.
- **PM patterns borrowed** — `confidence.rs` (MAD: `|best Δ| / MAD`, ≥2.0 HIGH / 1.0–2.0 MODERATE /
  <1.0 LOW, INF when MAD==0, requires ≥3 findings and a unit-group of ≥3 values, read-time only);
  v6-cognitive-augmentation-scope.md:81-143 (ambient injection, dry-run-before-accept decision
  support, Contradicts-first `WARNING:` re-rank).

---

## Part A — `recallPreview`: non-evented, cached, fail-open (KG-3 rule 8, R34-6)

**Decision: a pure read projection that reuses the recall candidate machinery and appends nothing.**
The deleted v1 `recallKnowledgeBounded`-at-dispatch appended `knowledge.recall` (:12983) — a
replay-critical ledger write per dispatch — and its reader binding discards pre-claim readers
(:12854, :12994). `recallPreview` reuses the *same* candidate/graph/ranking body (:12869-12908) with
**every append path severed**.

1. **Shape.** `recallPreview(repoId, {text, types[], grounding[], seedNodeIds[], limit}, policy)`
   returns
   `RecallPreview = exact{ schemaVersion:1, repoId, projectFence, asOf, query:{ normalizedTextDigest,
   termDigests[], types[], grounding[], seedNodeIds[], limit }, nodes:[…], contradictions:[…],
   projectionDigest, briefingUnavailable:false }`. Each `nodes[]` row is exactly the safe recall row
   (`id, type, grounding, observedSeq, eventTimeSeq, validFrom, validTo, validityVersion, score,
   reason, reasonDigest, snippet`, the projection at :12909-12912) **plus** KG-4 read-time overlays
   `confidence` (Part F) and `staleness` (Part G). It carries **no** `receiptDigest`, no `readerWorker`,
   no `requestDigest` — those belong only to the evented recall receipt (:12855, :12915) and their
   absence is the structural proof this projection is unevented.
2. **Non-evented, enforced by construction.** `recallPreview` calls `queryKnowledge`/
   `queryKnowledgeEdges` (the same read helpers `_buildKnowledgeRecall` uses at :12869/:12885) and
   **never** calls `_append`, never pushes to `_knowledgeReads` (:98, :782, :7800). No new event kind
   is registered; `_apply` (:7195) gains no case. A red test asserts the event count is byte-identical
   before and after a preview.
3. **Cached to the project-horizon fence.** The cache key is
   `(repoId, projectFence, canonicalDigest(query))` where `projectFence = this._events.length` at
   projection time (the KG's last applied `_apply` position, rule 4 — the counter already tracked for
   checkpoints, :10341 `lastSeq`). A preview is served from cache while `projectFence` is unchanged and
   recomputed only when it advances. No wall-clock TTL: the fence is the only invalidator, so replay
   reconstructs the identical projection by re-deriving at the same fence (Part H).
4. **Fail-open with an explicit `briefingUnavailable` marker.** Every ceiling `_buildKnowledgeRecall`
   *throws* on (`causal_recall_oversize` at :12870/:12872/:12892/:12897/:12908) is caught by
   `recallPreview` and **degraded**, not propagated: it returns
   `exact{ schemaVersion:1, repoId, projectFence, briefingUnavailable:true, reason:<causal_recall_*
   code>, nodes:[], contradictions:[] }` and **dispatch proceeds**. A briefing is best-effort context,
   never a dispatch blocker. The only hard refusals are caller-shape errors (`causal_recall_invalid`:
   empty query terms :12837, malformed reader/limit :12839-12845) — those are programming errors in
   the orchestrator, surfaced loudly, not degraded.
5. **Never feeds recall assessment (named, accepted).** `recallPreview` does not append
   `knowledge.recall`, so `_deriveRecallAssessment`'s scan (:13026-13035, which only enumerates
   `receipt.kind === 'knowledge.recall'` :13030) can never see preview traffic. Assessment keeps
   consuming only evented reads/recalls this epic; making preview assessable is an explicit follow-up
   (docs/34 rule 8). A red test asserts an assessment batch derived after N previews references zero
   preview-originated `recallEventSeq`.

## Part B — the `_providerBrief` / spawn injection seam (KG-3 rule 9, R34-7a)

6. **A separate sanitized section, never merged into `task.brief`.** The briefing renders as its own
   provider-visible block attached at the `_providerBrief` return (coordinator.mjs:2867, the
   `createBrief(...)` boundary) and carried into `adapter.spawn(workerId, task.brief, {…})` (:4784) as
   a spawn-option section — **not** as a field of the admitted `task.brief` object. Because
   `briefDigest = canonicalDigest(activeTask.brief)` (:4506) hashes `task.brief` and nothing else,
   continuation matching (:4622 compares `continuation.briefDigest`) stays bit-stable across a
   briefing that changes between spawn and recovery. A red test spawns, mutates the surfaced briefing,
   recovers, and asserts `briefDigest` is unchanged and the continuation still matches.
7. **Derived, bounded, provenance-marked.** Every rendered field (node snippets, WARNING lines,
   staleness notes) routes through `boundedAttentionText` (application.mjs:221-228): NFKC-normalized,
   credential-shaped content redacted via `SECRET_SHAPED_TEXT` (:214-219), truncated at
   `MAX_ATTENTION_TEXT_BYTES`. The whole section is capped at a deployment-owned `MAX_BRIEFING_BYTES`
   and marked untrusted-derived provenance (F14) — it is derived from KG state, never free-string
   worker prose, so it can never diverge from what the projection contains. On `briefingUnavailable`
   (rule 4) the section renders a single honest "briefing unavailable (<reason>)" line, never silence.

## Part C — composite scoring policy (KG-3 rule 8 ranking)

8. **The composite extends the existing `rank()`, weights externalized.** Today `rank()` (:12901-12905)
   scores `lexical.score` (id-exact 1000 / id-match ×100 / type-match ×40 / body-match ×10, the
   literals at :12882) plus `graphScore = max(1, 30 − 5·graphDistance)` (:12902). KG-3's composite is
   `term + edge-degree + evidence-count + recency`, all computed from projection-time state already in
   hand: **term** = the lexical score (:12882); **edge-degree** = `incident.get(node.id)?.length ?? 0`
   (the incident index at :12886); **evidence-count** = `node.evidence?.length ?? 0`; **recency** =
   normalized `node.eventTimeSeq` / `node.observedSeq` (:12911) against `projectFence`. Each term's
   weight is **deployment-owned**, not a code literal: a new `KNOWLEDGE_PREVIEW_POLICY_FIELDS` block
   modeled on `KNOWLEDGE_RECALL_POLICY_FIELDS` (:127) carries `weightTerm, weightEdgeDegree,
   weightEvidence, weightRecency` alongside the recall ceilings. The literals at :12882/:12902 stay the
   `knowledge.recall` defaults; the preview policy supplies preview weights so the two rankers never
   couple. Ranking is deterministic — ties broken by `compareCanonicalStrings(a.id, b.id)` exactly as
   :12905 — so the same fence + same policy yields the same order every time.
9. **Contradiction-bundle expansion is preserved.** The preview keeps the recall rule that any node
   joined by a live `Contradicts` edge to a selected node is pulled into the result even if unranked
   (:12906-12908), bounded by `maxResults`. This is what makes contradiction-first ranking (Part D)
   possible without a second graph pass.

## Part D — decision-time related nodes, contradiction-first, board sidebar (KG-3 rules 10–11)

10. **Decision-time surfacing = an orchestrator-side preview over question+options.** A worker's
    REFLEX-1 decision request triggers `recallPreview` with `text = question + options` seeded (via
    `seedNodeIds`) on any nodes the options already cite, and the result attaches to the attention item
    — the PM `pm_decision` dry-run-before-accept pattern (v6:120-138): the preview **writes nothing**
    (Part A2), it only informs, exactly as v6's `dry_run` returns the related-nodes brief without
    creating the decision.
11. **Contradiction-first ranking with an explicit WARNING marker.** Any node joined by a live
    `Contradicts` edge (surfaced by the bundle expansion, rule 9) to a candidate ranks **first**,
    ahead of raw composite order, and is rendered with a `WARNING:` prefix (v6:135-137) — silent
    contradiction is the worst KG failure mode. "Live" means `!edge.validTo` (the same liveness test
    the store uses at :12280/:12290); a resolved contradiction does not warn. The marker is a
    projection field (`reason.contradictionPeer`, already computed at :12910) promoted to a top-level
    `warning:true`, never a mutation of node state.
12. **Board-read sidebar.** Board projections (REFLEX-2) carry a small per-item related-KG sidebar
    produced by a bounded `recallPreview` over the item title/detail, cache-keyed with the **board
    fence** (REFLEX-2 rule 10) unioned with `projectFence` — so the sidebar recomputes when either the
    board or the KG advances, and is served from cache otherwise. Sidebar bytes honor a deployment-owned
    `MAX_SIDEBAR_BYTES` with an explicit `sidebarTruncated` marker, never silent truncation.

## Part E — KG-4 auto-link on admission, restricted (rule 12, R34-8)

13. **Only Supports / Refines / Cites may auto-admit, each at grounding `asserted`.** On every KG node
    admission (`addKnowledgeNode` :12561-12569) the wave proposes up to a deployment-owned `K` candidate
    edges via composite scoring (Part C), then admits only those whose type ∈ {`Supports`, `Refines`,
    `Cites`} and whose score clears that type's **own** deployment-owned threshold. The restriction is
    forced by the store, not chosen for taste: `Contradicts` admission *requires* non-empty evidence
    (:12286-12289) which composite scoring cannot manufacture, and `Supersedes` requires
    `expectedValidityVersion` + liveness + no-cycle (:12279-12284) — both impossible to satisfy from a
    similarity score. The three allowed types validate only against endpoints-exist (:12276-12277) +
    generic content/evidence (:12278, empty evidence permitted for non-Contradicts/non-verified edges),
    so an `asserted`-grounding auto-edge admits cleanly. A red test proves an auto-proposed `Contradicts`
    is refused (`invalid_contradiction` :12289) and a `Supersedes` is refused (`invalid_supersession` /
    `stale_version` :12281-12282) while a `Supports` above threshold admits.
14. **Contradiction candidates surface, they never auto-link.** A high-scoring Contradicts candidate is
    routed into the briefing (Part B) / decision surface (Part D) for a human or orchestrator to assert
    **with evidence** through the normal `addKnowledgeEdge` path (:12594) — feeding rule 11, never
    auto-admitted. Below-threshold Supports/Refines/Cites candidates are dropped and counted in a
    logged `autoLinkDropped` tally, never silently discarded (No-Arbitrary-Limits honesty).

## Part F — MAD confidence projection (rule 13)

15. **Read-time confidence, never stored node state.** For metric-bearing `Finding` nodes, port
    `confidence.rs`: extract metrics from `node.body` (`recallBody` :173), group by unit, and where a
    unit-group has ≥3 values compute `confidence = |best Δ| / MAD`, mapped HIGH (≥2.0) / MODERATE
    (1.0–2.0) / LOW (<1.0) / HIGH-INF (MAD==0). The value is computed **at projection time** from
    content and attached as the `nodes[].confidence` overlay (Part A1) — it is derived, so it is
    replay-exact by recomputation and adds **zero** mutable node fields (the ScratchFact precedent:
    projections re-derive, never store, :12909-12912). Findings with <3 metric-bearing values in any
    unit-group carry `confidence:null`, exactly as `compute_experiment_confidence` returns `None`.

## Part G — staleness surfacing (rule 14)

16. **Unreferenced / superseded / contradicted-unresolved nodes carry an age marker.** A `nodes[].staleness`
    overlay (computed at projection time from the bi-temporal validity baton already stores) marks a node
    as stale when it is superseded (`validTo` set, or a live `Supersedes` edge points at it), party to a
    live `Contradicts` (`!edge.validTo`, :12290), or unreferenced by any `knowledge.read` (`_knowledgeReads`
    :98) since some deployment-owned age. The marker carries the node's age (from `validFrom` / `eventTimeSeq`
    :12911) and reason, and rides into the orchestrator briefing (Part B). Like confidence it is a
    read-time overlay — never a stored flag, never a mutation — so staleness cannot drift from truth.

## Part H — fold surface: `_apply` / snapshot / checkpoint / replay

17. **KG-3 adds nothing to the fold.** `recallPreview`, the composite ranking, MAD confidence, and
    staleness are all pure read projections: no new event kind, no `_apply` case (:7195), no snapshot
    field (:10341), no `_knowledgeReads` push (:7800/:7821). Replay is trivially exact because there is
    nothing to replay — a preview is a function of `(fence, policy, query)` and recomputes identically.
    Cache entries are process-local and fence-keyed; they are never serialized into the checkpoint.
18. **KG-4 auto-link rides the existing edge fold.** Auto-admitted Supports/Refines/Cites edges go
    through the *unchanged* `addKnowledgeEdge` → `knowledge.edge_added` path (:12594-12606), folded by
    `_apply` at :7780, captured in `snapshot().knowledge.edges` (:10341), and revalidated on replay by
    `_validateKnowledgeEdgePayload` (:12271-12292). No new event kind, no new checkpoint field — the
    only durable KG-4 write is an ordinary knowledge edge, so checkpoint/replay semantics are inherited
    verbatim. Idempotency is the existing edge idempotency (`knowledge_edge_conflict` :12599): a replayed
    auto-link with the same digest is a no-op, not a duplicate.

## Part I — error codes and bounds

19. **Error codes.** `recallPreview` throws only on caller-shape faults, reusing the recall codes:
    `causal_recall_invalid` (empty terms :12837, bad reader/limit :12839-12845). All ceiling breaches
    degrade to `briefingUnavailable` with `reason ∈ {causal_recall_oversize}` (never thrown). Auto-link
    edge admission surfaces exactly the store's edge codes and no new ones: `missing_endpoint` (:12277),
    `duplicate_edge` (:12275), `invalid_edge_type` (:12273), `knowledge_edge_conflict` (:12599); by
    construction (rule 13) it can never hit `invalid_contradiction`/`invalid_supersession`/`stale_version`.
20. **Bounds, all deployment-owned, none arbitrary.** `KNOWLEDGE_PREVIEW_POLICY_FIELDS` carries the recall
    ceilings (`maxCandidates`, `maxCandidateBytes`, `maxGraphRows`, `maxGraphDepth`, `maxResults`,
    `maxSnippetBytes`, :127 shape) **plus** the composite weights (rule 8), plus `MAX_BRIEFING_BYTES`,
    `MAX_SIDEBAR_BYTES`, the per-type auto-link thresholds, and `K` (max auto-edges per admission). Every
    truncation emits an explicit marker (`briefingUnavailable`, `sidebarTruncated`, `autoLinkDropped`);
    nothing is silently dropped.

## Part J — red tests first (`impl/test/kg3-activation-red.test.mjs`, `impl/test/kg4-quality-red.test.mjs`)

KG-3: a `recallPreview` appends **no** ledger event (event count byte-identical before/after) and pushes
nothing to `_knowledgeReads`; the same `(fence, query, policy)` returns a byte-identical projection from
cache and recomputes on fence advance; a ceiling breach returns `briefingUnavailable:true` with a
`causal_recall_*` reason and dispatch proceeds; a caller-shape fault throws `causal_recall_invalid`; an
assessment batch derived after N previews references zero preview `recallEventSeq`. Seam: a briefing
surfaced between spawn and recovery leaves `briefDigest` (:4506) unchanged and the continuation matches
(:4622); briefing bytes are `boundedAttentionText`-redacted and provenance-marked; over-budget briefings
truncate with a marker. Ranking: composite honors deployment weights and is tie-stable; a node joined by a
live `Contradicts` ranks first with `warning:true`; a resolved contradiction does not warn. Decision/board:
a decision preview writes nothing and attaches to the attention item; a board sidebar is served from cache
until board-fence ∪ project-fence advances.

KG-4: an auto-proposed `Contradicts` is refused (`invalid_contradiction`), a `Supersedes` is refused
(`invalid_supersession`/`stale_version`), and only above-threshold `Supports`/`Refines`/`Cites` admit at
grounding `asserted`; a below-threshold candidate is dropped and counted, never admitted; the auto-edge
folds through `knowledge.edge_added` and replays identically (idempotent on re-apply). MAD: a Finding with
≥3 unit-matched metrics carries HIGH/MODERATE/LOW/INF matching `confidence.rs`; a Finding with <3 carries
`confidence:null`; confidence is never a stored node field. Staleness: a superseded / live-contradicted /
unreferenced node carries a `staleness` marker with age; a live node does not; the marker is read-time only.

## Part K — boundaries

`recallPreview` is a read projection: non-evented, cached, fail-open — it never appends, never feeds recall
assessment, never blocks dispatch. The briefing is a separate provider-visible section that never mutates
`task.brief` or `briefDigest`. No new store, no embeddings, no FTS, no SQLite (docs/34 §5). No mutation of
Cairn admission or validity rules — auto-link goes through the unchanged `addKnowledgeEdge` and is restricted
to the three evidence-free-admissible edge types; Contradicts/Supersedes are never auto-minted. Confidence
and staleness are read-time overlays, never stored node state, never mutations. No auto-promotion into the
project horizon (that is KG-2's orchestrator-admit gate). No MCP/CLI surface in this epic. No new event
kind, no new `_apply` case, no new checkpoint field beyond the ordinary knowledge edge. No credentials in
any projection; no git commits; no scratch/log writes anywhere (including /tmp).

## Part L — validation

Focused suites green (`impl/test/kg3-activation-red.test.mjs`, `impl/test/kg4-quality-red.test.mjs`), then
the full suite `node impl/scripts/run-suite.mjs` green from the worktree root; the wave-driver reviewer
contract (`node --test impl/test/wave-driver-red.test.mjs`, working directory `.`, exit 0) stays green.
