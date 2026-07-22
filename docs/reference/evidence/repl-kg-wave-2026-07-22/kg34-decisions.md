# KG-3 + KG-4 decisions contract — activation & graph quality (issues #26, #27)

Ground truth: docs/34-knowledge-horizons.md v2 §3 KG-3 (rules 8–11) and KG-4 (rules 12–14), already
red-team-corrected (R34-6, R34-7a/b, R34-8, R34-9). Binding decisions from the design docs are
**settled and NOT re-litigated here**: `recallPreview` is non-evented; the briefing injects at the
`_providerBrief`/spawn seam without touching `briefDigest`; auto-link is restricted to
Supports/Refines/Cites; project-horizon fence = the KG's last applied event seq. This file is the
*implementation* contract — exact shapes, admission/validation order, error codes, bounds, the
fold surface, and the red-test list. It is v2: revised against the binding red-team report
`kg34-redteam.md`; every finding's resolution is logged under **v2 revisions** below and every
citation touched here was re-verified line-for-line against `impl/src/`.

Code this contract mirrors (verified line-for-line):
- **Recall machinery to mirror read-only** — `recallKnowledgeBounded` (coordination-store.mjs:12965),
  `_buildKnowledgeRecall` (:12859-12917): the exact **9-key** internal query shape
  (`schemaVersion, normalizedTextDigest, termDigests, types, grounding, seedNodeIds, limit,
  observedSeq, asOf`) enforced by the sorted-keys equality at :12860; term normalization/tokenization
  (`normalizedRecallText` :163, `recallTerms` :164, `recallBody` :173, `utf8Snippet` :174), lexical
  scoring (:12879-12884), incident-edge index + BFS graph walk (:12885-12900), `rank()` composite
  (:12901-12905), Contradicts-bundle expansion (:12906-12908), and every refusal ceiling
  (`maxCandidates` :12870, `maxCandidateBytes` :12872, `maxGraphRows` :12892/:12895,
  `maxGraphDepth` :12897, `maxResults` :12908). Its seed-eligibility gate throws
  `causal_recall_invalid` at :12876 for a seed that is unknown/dead/filtered. The evented tail this
  contract must **not** touch: `knowledge.recall` append (:12983), reader-worker binding (:12854),
  and recall-assessment consumption (`_buildKnowledgeRecallAssessment` scan of `knowledge.recall`
  receipts :13025-13035, skip at :13030).
- **Edge endpoint/type rules** — `_validateKnowledgeEdgePayload` (:12271-12292): endpoints must be
  existing nodes (:12276-12277); `Supersedes` needs `expectedValidityVersion`, liveness, no open
  contradiction, no cycle, no backdate (:12279-12284); `Contradicts` needs **non-empty evidence**
  and a canonical pair id (:12286-12291); the admission entry point `addKnowledgeEdge` (:12594-12612,
  event kind `knowledge.edge_added` :12599). **Edges carry no `grounding` field** — grounding is
  validated only on nodes (`_validateKnowledgeNodePayload` :12250). Node types :118, edge types :119,
  groundings :120.
- **Sanitization** — `boundedAttentionText` (application.mjs:221-228) + `SECRET_SHAPED_TEXT`
  (:214-219) + `MAX_ATTENTION_TEXT_BYTES` (:48): NFKC-normalize, redact credential-shaped prose, cap
  at the byte ceiling. These are module-**private** in application.mjs (no export) and this contract
  **relocates them to messages.mjs** (v2-P1-5) so the coordinator can import them without an app-layer
  cycle.
- **Injection seam** — `_providerBrief(brief)` (coordinator.mjs:2860-2868); called at initial spawn
  (:2620 → `adapter.spawn(workerId, providerBrief, {…})` :2814) and recovery prompt (:4512 →
  `adapter.promptBrief(workerId, providerBrief)` / `adapter.prompt(workerId, providerBrief, 'turn')`
  :4553-4555). The digest it must not perturb is `briefDigest = canonicalDigest(activeTask.brief)`
  (:4506), matched **store-side** by `_validateRecoveryContinuationPayload` at
  `canonicalDigest(task.brief) !== p.briefDigest` (:2599); coordinator :4622 merely echoes it into a
  refusal payload. The `attachOnly:true` reconnect spawn passing raw `task.brief` is :4784 and is
  **not** a briefing seam.
- **PM patterns borrowed** — `confidence.rs` (MAD oracle), **vendored inline** in Part F (v2-P1-6);
  v6-cognitive-augmentation-scope.md:81-143 (ambient injection, dry-run-before-accept decision
  support, Contradicts-first `WARNING:` re-rank).

---

## v2 revisions

Each red-team finding and its resolution. Rebuttals carry file:line evidence; none of the report's
findings were rejected — all were adopted (the report was right on every point, including several
v1 citations that were simply wrong).

- **P0-1 (injection seam does not exist as written).** v1 attached the briefing "at the
  `_providerBrief` return" and carried it into the `:4784` attach-only spawn — but `:4784` passes raw
  `task.brief` with `attachOnly:true` and reaches no provider on the prompt path, and `_providerBrief`
  returns the admitted frozen brief itself for non-contextCall tasks (:2861), so "attach" meant
  mutating the admitted object. **Resolved (rules 6, 6a):** the seam is a wrapper `{ brief, briefing }`
  returned by `_providerBrief` and passed as the provider-facing argument at both real provider paths —
  `spawn(workerId, providerBrief, …)` :2814 and `promptBrief/prompt(workerId, providerBrief, …)`
  :4553-4555 — explicitly **not** :4784. `briefDigest` hashes only the inner `activeTask.brief` (:4506,
  matched at :2599), never the wrapper.
- **P1-2 (preview query fails the exact-keys check).** v1's query omitted `schemaVersion`,
  `observedSeq`, `asOf`, so `_buildKnowledgeRecall`'s sorted-keys equality (:12860) would throw
  `causal_recall_invalid` on every preview. **Resolved (rule 1a):** the internal query is the exact
  9-key object with `observedSeq: projectFence`, `asOf: observationTime(projectFence)`; the public echo
  is a subset.
- **P1-3 (extended policy fails `validKnowledgeRecallPolicy`).** Weights + byte caps + thresholds + K
  in one block fail the exact-11-field check (`KNOWLEDGE_RECALL_POLICY_FIELDS` is at **:122**, not the
  v1's ":127"; validator :180-186). **Resolved (rules 8a, 20):** the preview policy is **split** — an
  inner `recall` sub-object that is byte-exactly the 11 recall fields (passed unchanged to
  `_buildKnowledgeRecall`), plus preview extras under a new `validKnowledgePreviewPolicy`.
- **P1-4 (fail-open taxonomy omits data-dependent `causal_recall_invalid` :12876).** A decision seed
  that is superseded/filtered before the preview makes the body throw `causal_recall_invalid` at
  :12876, wedging surfacing on ordinary KG churn. **Resolved (rules 4, 10a):** seeds are **pre-filtered
  against current eligibility** before the query is built; ineligible seeds are dropped and counted in a
  `seedsDropped` marker, so :12876 never fires on churn and `causal_recall_invalid` stays reserved for
  genuine programming faults.
- **P1-5 (sanitizer is private and in the wrong layer).** `boundedAttentionText`/`SECRET_SHAPED_TEXT`/
  `MAX_ATTENTION_TEXT_BYTES` have no export in application.mjs (:48/:214/:221); the coordinator imports
  only from messages.mjs (:11-13). **Resolved (rule 7, code-mirror):** relocate the helper to
  **messages.mjs** (imports only `node:crypto`; already imported by coordinator :12 and application.mjs
  :2 → cycle-free); application.mjs re-imports it from there.
- **P1-6 (MAD oracle not vendored; extraction unspecified).** `confidence.rs` lived outside the repo
  (`/tmp/pm-kg-reference/`), and grammar/units/numeric-guards were unspecified. **Resolved (rule 15,
  15a):** the oracle is **vendored inline** — linear-time metric grammar, a fixed unit-normalization
  table, finite-value guards, and the median/MAD/confidence formulas + thresholds, all reproduced from
  the source.
- **P2-7 (fence stampede + unbounded cache).** v1's `projectFence = this._events.length` advances on
  ANY event (`lastSeq` at :10341 is the **global** event count, not a KG counter), so dispatch bursts
  bust the cache every time. **Resolved (rules 3, 20):** `projectFence` is the KG's last-applied
  **graph** event seq (`max` observedSeq over knowledge node+edge history — derived, no new checkpoint
  field), matching the binding decision; both the cache key and the query's `observedSeq`/`asOf` pin to
  it, and a `maxPreviewCacheEntries` LRU bound is added.
- **P2-8 (contradiction flood suppresses the warning).** A bundle over `maxResults` throws at :12908 →
  degrade → a heavily-contradicted node yields NO contradiction surfacing, inverting rule 11.
  **Resolved (rule 11a):** on the :12908 breach the preview **peels the ranked tail** (retries with a
  smaller `limit`, preserving the top node + its live-Contradicts peers) and only degrades if a
  single-node bundle still overflows — and that degrade carries `contradictionFlood:true`, so
  contradiction presence is never silent.
- **P2-9 ("at grounding asserted" is a category error).** Edges have no grounding field (:12271-12292;
  grounding is node-only :12250). **Resolved (rule 13):** the phrase is dropped; auto-link edges admit
  via endpoints-exist + generic content/evidence, no grounding.
- **P2-10 (auto-link idempotency overstated; rule 13/19 inconsistency).** `addKnowledgeEdge`
  idempotency is keyed by `auth.key` (:12597-12600); a re-proposed identical edge under a fresh key
  throws `duplicate_edge` (:12275). **Resolved (rules 13a, 18):** the auto-linker mints a
  **deterministic `auth.key`** (and the id is already content-derived, :12596), so re-proposal hits the
  idempotent branch; the rule-13 red test is clarified to exercise the **store** admission path, not
  the auto-linker.
- **P2-11 (staleness "unreferenced" ignores preview traffic).** `_knowledgeReads` records only evented
  reads (:98/:782, pushed :7800/:7821); previews never append, so the most-previewed nodes look
  unreferenced. **Resolved (rule 16):** the marker is scoped to **evented** reads and the gap is
  documented as the same explicit follow-up as rule 5 — no preview-read tracking is added.
- **P2-12 (misc citation/semantics fixes).** `:4622` is the refusal-payload echo, not the digest
  comparison (real match store-side :2599); the assessment builder is `_buildKnowledgeRecallAssessment`
  (:13025), not `_deriveRecallAssessment`; the recency formula is now defined (rule 8); the preview
  weight validator **allows 0** (the recall validator forbids ≤0 at :182, but a 0 weight must disable a
  term). All applied inline.
- **P2-13 (vacuous / missing red tests).** **Resolved (Part J):** added red tests for the stale-seed
  drop (P1-4), the contradiction flood (P2-8), and the non-contextCall briefing branch (P0-1); the
  cache test now includes an unrelated non-KG event that must **not** bust the cache (proving the
  KG-only fence).

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
   seedsDropped[], contradictionPeeled, projectionDigest, briefingUnavailable:false }`. The public
   `query` echo is the **subset** of the internal 9-key query (rule 1a) minus the fence-derived
   `schemaVersion/observedSeq/asOf`, which ride at top level. Each `nodes[]` row is exactly the safe
   recall row (`id, type, grounding, observedSeq, eventTimeSeq, validFrom, validTo, validityVersion,
   score, reason, reasonDigest, snippet`, the projection at :12909-12912) **plus** KG-4 read-time
   overlays `confidence` (Part F) and `staleness` (Part G). It carries **no** `receiptDigest`, no
   `readerWorker`, no `requestDigest` — those belong only to the evented recall receipt (:12855,
   :12921) and their absence is the structural proof this projection is unevented.
1a. **Internal query is the exact 9-key shape (v2-P1-2).** Before calling `_buildKnowledgeRecall`,
   `recallPreview` builds
   `query = freeze{ schemaVersion:1, normalizedTextDigest: canonicalDigest(normalizedRecallText(text)),
   termDigests: recallTerms(text).map(canonicalDigest).sort(), types:[…].sort(), grounding:[…].sort(),
   seedNodeIds:[…eligible].sort(), limit, observedSeq: projectFence, asOf: observationTime(projectFence) }`
   — byte-for-byte the key set the sorted-keys equality at :12860 requires, mirroring how
   `_prepareKnowledgeRecall` mints it at :12848-12852. `observedSeq = projectFence` is a valid global
   seq (`≤ this._events.length`, the :12862 bound) and `asOf = observationTime(projectFence)` is the
   ISO instant of that event (:12863). The preview does **not** route through `_prepareKnowledgeRecall`
   (which builds the evented reader/`requestDigest`); it constructs `query` itself and calls the
   read-only body directly.
2. **Non-evented, enforced by construction.** `recallPreview` calls `queryKnowledge`/
   `queryKnowledgeEdges` (the same read helpers `_buildKnowledgeRecall` uses at :12869/:12885) and
   **never** calls `_append`, never pushes to `_knowledgeReads` (:98, :782, :7800/:7821). No new event
   kind is registered; `_apply` (:7195) gains no case. A red test asserts the event count is
   byte-identical before and after a preview.
3. **Cached to the project-horizon fence — the KG's last-applied graph seq (v2-P2-7).** The cache key
   is `(repoId, projectFence, canonicalDigest(query))` where **`projectFence` = the KG's last applied
   graph event seq** — the binding decision's fence, computed as the `max` `observedSeq` over the
   knowledge node history and edge history (`_knowledgeNodeHistory`/`_knowledgeEdgeHistory`, folded at
   :7769/:7780), or `0` when the KG is empty. This is **not** `this._events.length` (the global
   `lastSeq` at :10341, which v1 conflated): a non-KG event (task dispatch, lifecycle) does **not**
   advance it, so a preview is served from cache through dispatch bursts and recomputed only when a
   node/edge actually folds. Because both the cache key **and** the internal query's
   `observedSeq`/`asOf` (rule 1a) pin to `projectFence`, the projection is a pure function of it and is
   byte-identical across intervening non-KG events. It is derived from folded state, so replay
   reconstructs the identical fence and projection with no serialized cache (Part H). The cache is
   process-local, LRU-evicted at a deployment-owned `maxPreviewCacheEntries` (rule 20).
4. **Fail-open with an explicit `briefingUnavailable` marker.** Every ceiling `_buildKnowledgeRecall`
   *throws* on (`causal_recall_oversize` at :12870/:12872/:12892/:12895/:12897/:12908) is caught by
   `recallPreview` and **degraded**, not propagated: it returns
   `exact{ schemaVersion:1, repoId, projectFence, briefingUnavailable:true, reason:<causal_recall_*
   code>, contradictionFlood?:<bool>, nodes:[], contradictions:[] }` and **dispatch proceeds**. A
   briefing is best-effort context, never a dispatch blocker. The contradiction-bundle ceiling (:12908)
   is handled first by contradiction-peel (rule 11a) and only degrades as a last resort. The **only**
   hard refusal is a caller-shape fault (`causal_recall_invalid`), thrown by `recallPreview`'s own
   input guard mirroring `_prepareKnowledgeRecall`'s request checks (empty/`\0` text or no searchable
   terms :12832/:12837, non-positive or over-`maxResults` limit :12833, malformed types/grounding/seeds
   :12843-12845) — those are programming errors in the orchestrator, surfaced loudly. The body's own
   `causal_recall_invalid` throws (shape :12868, seed-eligibility :12876) are made **unreachable** by
   rules 1a and 10a; if one ever fires it is a genuine internal bug and propagates loudly, never
   degrades.
5. **Never feeds recall assessment (named, accepted).** `recallPreview` does not append
   `knowledge.recall`, so `_buildKnowledgeRecallAssessment`'s scan (:13025-13035, which only enumerates
   `receipt.kind === 'knowledge.recall'` :13030) can never see preview traffic. Assessment keeps
   consuming only evented reads/recalls this epic; making preview assessable is an explicit follow-up
   (docs/34 rule 8). A red test asserts an assessment batch derived after N previews references zero
   preview-originated `recallEventSeq`.

## Part B — the `_providerBrief` / spawn injection seam (KG-3 rule 9, R34-7a)

6. **A wrapper `{ brief, briefing }`, never a field of `task.brief` (v2-P0-1).** `_providerBrief`
   (coordinator.mjs:2860-2868) returns a wrapper `{ brief, briefing }`: `brief` is the inner
   provider-facing brief exactly as today (the admitted `task.brief` for a non-contextCall task at
   :2861, or `createBrief(this._contextBriefMaterializer(brief))` :2867 for a contextCall), and
   `briefing` is the sanitized KG section (rule 7). This wrapper is the value passed to the two real
   provider seams: `adapter.spawn(workerId, providerBrief, {…})` at initial dispatch (:2814) and
   `adapter.promptBrief(workerId, providerBrief)` / `adapter.prompt(workerId, providerBrief, 'turn')` on
   recovery (:4553-4555). Adapters unwrap `.brief` for the prompt payload and render `.briefing` as a
   separate provider-visible block. Because the prompt verbs take **no options bag**, the wrapper — not
   a spawn-option section — is the only channel that reaches the provider on recovery.
6a. **`briefDigest` is bit-stable across the briefing.** `briefDigest = canonicalDigest(activeTask.brief)`
   (coordinator.mjs:4506) hashes the **inner** brief and nothing else; continuation matching compares it
   **store-side** in `_validateRecoveryContinuationPayload` at `canonicalDigest(task.brief) !== p.briefDigest`
   (coordination-store.mjs:2599, echoed into the accepted-intent check :2669). Coordinator :4622 only
   copies `continuation.briefDigest` into a `control.recovery_dispatch_refused` payload — it is not a
   comparison. Since the briefing rides the wrapper and never enters `task.brief`, a briefing that
   changes between spawn and recovery cannot move the digest. The seam is applied in **both**
   `_providerBrief` branches, so a non-contextCall task (rule 6, :2861) still carries a briefing. A red
   test spawns, mutates the surfaced briefing, recovers, and asserts `briefDigest` is unchanged and the
   continuation still matches — with one case on the non-contextCall branch.
7. **Derived, bounded, provenance-marked; sanitizer relocated to messages.mjs (v2-P1-5).** Every
   rendered field (node snippets, WARNING lines, staleness notes) routes through `boundedAttentionText`:
   NFKC-normalized, credential-shaped content redacted via `SECRET_SHAPED_TEXT`, truncated at
   `MAX_ATTENTION_TEXT_BYTES`. These helpers are module-**private** in application.mjs (:48/:214/:221,
   no `export`) and the coordinator imports only from messages.mjs (:11-13) — so this contract
   **relocates `boundedAttentionText`/`SECRET_SHAPED_TEXT`/`MAX_ATTENTION_TEXT_BYTES` into messages.mjs**
   (which imports only `node:crypto` and is already imported by both coordinator :12 and application.mjs
   :2, so no import cycle is created); application.mjs re-imports them from messages.mjs, preserving its
   existing call sites (:239/:294/:340…). The whole section is capped at a deployment-owned
   `MAX_BRIEFING_BYTES` and marked untrusted-derived provenance via `wrapProse` (messages.mjs:375, F14)
   — it is derived from KG state, never free-string worker prose, so it can never diverge from what the
   projection contains. On `briefingUnavailable` (rule 4) the section renders a single honest "briefing
   unavailable (<reason>)" line (or "contradictions present, surfacing ceiling exceeded" when
   `contradictionFlood`), never silence.

## Part C — composite scoring policy (KG-3 rule 8 ranking)

8. **The composite extends the existing `rank()`, weights externalized.** Today `rank()` (:12901-12905)
   scores `lexical.score` (id-exact 1000 / id-match ×100 / type-match ×40 / body-match ×10, the
   literals at :12882) plus `graphScore = max(1, 30 − 5·graphDistance)` (:12902). KG-3's composite is
   `term + edge-degree + evidence-count + recency`, all computed from projection-time state already in
   hand: **term** = the lexical score (:12882); **edge-degree** = `incident.get(node.id)?.length ?? 0`
   (the incident index at :12886); **evidence-count** = `node.evidence?.length ?? 0`; **recency** = the
   normalized freshness of the node against the fence, defined as
   `recency = clamp01((node.eventTimeSeq ?? node.observedSeq) / projectFence)` when `projectFence > 0`
   else `0` — a value in `[0,1]` that is 1 for a node whose event is the fence and decays toward 0 for
   the oldest nodes (deterministic, replay-exact, no wall clock). Each term's weight is
   **deployment-owned**, not a code literal: a new `KNOWLEDGE_PREVIEW_POLICY_FIELDS` block (rule 8a)
   carries `weightTerm, weightEdgeDegree, weightEvidence, weightRecency`. The literals at :12882/:12902
   stay the `knowledge.recall` defaults; the preview policy supplies preview weights so the two rankers
   never couple. Ranking is deterministic — ties broken by `compareCanonicalStrings(a.id, b.id)`
   exactly as :12905 — so the same fence + same policy yields the same order every time.
8a. **Policy split so the recall sub-object still passes `validKnowledgeRecallPolicy` (v2-P1-3).** The
   preview policy is a two-level object `{ recall: {…11 fields…}, preview: {…extras…} }`. `policy.recall`
   is byte-exactly `KNOWLEDGE_RECALL_POLICY_FIELDS` (the 11-field list at **:122** — `repoId,
   maxQueryBytes, maxQueryTerms, maxCandidates, maxCandidateBytes, maxResults, maxGraphDepth,
   maxGraphRows, maxSnippetBytes, maxReceiptBytes, maxResultBytes`) and is passed **unchanged** to
   `_buildKnowledgeRecall`, so `validKnowledgeRecallPolicy` (:180-186, an exact sorted-keys equality)
   accepts it verbatim. `policy.preview` carries the composite weights, `MAX_BRIEFING_BYTES`,
   `MAX_SIDEBAR_BYTES`, the per-type auto-link thresholds, `K`, and `maxPreviewCacheEntries`, validated
   by a **new** `validKnowledgePreviewPolicy`. Unlike the recall numeric guard (`policy[name] <= 0`
   ⇒ invalid, :182), the weight validator admits **0** (a disabled term is legal): each weight must be a
   finite number `≥ 0`. A red test proves the extended policy is accepted and that a weight of 0
   disables its term.
9. **Contradiction-bundle expansion is preserved.** The preview keeps the recall rule that any node
   joined by a live `Contradicts` edge to a selected node is pulled into the result even if unranked
   (:12906-12908), bounded by `maxResults`. This is what makes contradiction-first ranking (Part D)
   possible without a second graph pass.

## Part D — decision-time related nodes, contradiction-first, board sidebar (KG-3 rules 10–11)

10. **Decision-time surfacing = an orchestrator-side preview over question+options.** A worker's
    REFLEX-1 decision request triggers `recallPreview` with `text = question + options` seeded (via
    `seedNodeIds`) on any nodes the options already cite, and the result attaches to the attention item
    — the PM `pm_decision` dry-run-before-accept pattern (v6:120-138): the preview **writes nothing**
    (rule 2), it only informs, exactly as v6's `dry_run` returns the related-nodes brief without
    creating the decision.
10a. **Seeds are pre-filtered against eligibility (v2-P1-4).** Before building the internal query,
    `recallPreview` computes the eligible node set at the fence — `queryKnowledge({observedSeq:
    projectFence, asOf})` filtered by the requested `types`/`grounding`, the same eligibility
    `_buildKnowledgeRecall` derives at :12874 — and intersects `seedNodeIds` with it. Seeds that are
    unknown, dead (`validTo` set), or filtered out are **dropped** and recorded in the `seedsDropped[]`
    marker (never silently), so the body's seed gate at :12876 (`throw causal_recall_invalid`) can never
    fire on ordinary KG churn (a decision option citing a node that was superseded between citation and
    preview). The pre-filter also honors the `seedNodeIds.length ≤ limit` invariant the body enforces at
    :12866. `causal_recall_invalid` therefore never degrades and never wedges surfacing; it stays a loud
    caller-shape/programming signal.
11. **Contradiction-first ranking with an explicit WARNING marker.** Any node joined by a live
    `Contradicts` edge (surfaced by the bundle expansion, rule 9) to a candidate ranks **first**,
    ahead of raw composite order, and is rendered with a `WARNING:` prefix (v6:135-137) — silent
    contradiction is the worst KG failure mode. "Live" means `!edge.validTo` (the same liveness test
    the store uses at :12280/:12290); a resolved contradiction does not warn. The marker is a
    projection field (`reason.contradictionPeer`, already computed at :12910) promoted to a top-level
    `warning:true`, never a mutation of node state.
11a. **Contradiction-peel before degrade (v2-P2-8).** When the Contradicts bundle overflows `maxResults`
    the body throws `causal_recall_oversize` at :12908 — v1 let that degrade the whole preview, which
    would guarantee a heavily-contradicted node surfaces **no** contradiction, inverting rule 11. Instead
    the preview **peels the ranked tail**: on the :12908 breach it re-runs with a monotonically smaller
    effective `limit` (dropping the lowest-ranked *selected* node each step, which shrinks the seed set
    the bundle expands from), preserving the highest-ranked node and its live-Contradicts peers, until
    `finalIds.size ≤ maxResults`. The number of tail nodes dropped rides the top-level
    `contradictionPeeled` count (never silent). Only if even a **single-node** selection's bundle still
    exceeds `maxResults` (one node with more live-Contradicts peers than the ceiling) does the preview
    degrade to `briefingUnavailable` — and that degrade sets `contradictionFlood:true` so the briefing
    still says contradictions are present (rule 7), preserving rule 11's never-silent invariant. The
    peel loop is deterministic and bounded (`limit` decreases by ≥1 each step, ≤ `maxResults` steps). A
    red test asserts a node with a bundle over `maxResults` still surfaces the top contradiction with
    `warning:true` and a non-zero `contradictionPeeled`, and dispatch proceeds.
12. **Board-read sidebar.** Board projections (REFLEX-2) carry a small per-item related-KG sidebar
    produced by a bounded `recallPreview` over the item title/detail, cache-keyed with the **board
    fence** (REFLEX-2 rule 10) unioned with `projectFence` — so the sidebar recomputes when either the
    board or the KG advances, and is served from cache otherwise. Sidebar bytes honor a deployment-owned
    `MAX_SIDEBAR_BYTES` with an explicit `sidebarTruncated` marker, never silent truncation.

## Part E — KG-4 auto-link on admission, restricted (rule 12, R34-8)

13. **Only Supports / Refines / Cites may auto-admit (v2-P2-9: no grounding on edges).** On every KG
    node admission (`addKnowledgeNode` :12561-12571) the wave proposes up to a deployment-owned `K`
    candidate edges via composite scoring (Part C), then admits only those whose type ∈ {`Supports`,
    `Refines`, `Cites`} and whose score clears that type's **own** deployment-owned threshold. Edges
    carry **no `grounding` field** — `_validateKnowledgeEdgePayload` (:12271-12292) validates type
    (:12273), id/duplicate (:12275), endpoints-exist (:12276-12277), evidence/times (:12278), and the
    `Supersedes`/`Contradicts` constraints (:12279-12291); grounding is a node-only concept (:12250).
    The restriction is forced by the store, not chosen for taste: `Contradicts` admission *requires*
    non-empty evidence (:12289) and a canonical pair id, which composite scoring cannot manufacture, and
    `Supersedes` requires `expectedValidityVersion` + liveness + no-cycle (:12279-12284) — both
    impossible to satisfy from a similarity score. The three allowed types validate only against
    endpoints-exist + generic content/evidence (:12278; empty evidence is permitted for
    non-Contradicts/non-verified edges), so an auto-edge admits cleanly. A red test proves an
    auto-proposed `Contradicts` is refused (`invalid_contradiction` :12289) and a `Supersedes` is refused
    (`invalid_supersession` / `stale_version` :12281-12282) while a `Supports` above threshold admits.
13a. **Deterministic auto-link key so re-proposal is idempotent (v2-P2-10).** `addKnowledgeEdge`
    idempotency is keyed by `auth.key` (`this._byKey.get(auth?.key)` :12597), and a re-proposed identical
    edge under a **fresh** key falls through to `_validateKnowledgeEdgePayload` and throws `duplicate_edge`
    at :12275 (`this._knowledgeEdges.has(fields.id)`). To make re-proposal a clean no-op the auto-linker
    mints a **deterministic** `auth.key = knowledge.autolink:{from}:{to}:{type}` (and the edge id is
    already content-derived, `knowledge-edge:${digest(fields)}` :12596), so an identical re-proposal hits
    the idempotent branch (:12598-12600) returning `result:'idempotent'`, not a `knowledge_edge_conflict`
    or `duplicate_edge`. The rule-13 refusal test therefore exercises the **store** admission path
    directly (feeding a `Contradicts`/`Supersedes` to `addKnowledgeEdge`) to prove *why* the auto-linker
    restricts its types — the auto-linker itself, by construction (rule 14), never emits those types.
14. **Contradiction candidates surface, they never auto-link.** A high-scoring Contradicts candidate is
    routed into the briefing (Part B) / decision surface (Part D) for a human or orchestrator to assert
    **with evidence** through the normal `addKnowledgeEdge` path (:12594) — feeding rule 11, never
    auto-admitted. Below-threshold Supports/Refines/Cites candidates are dropped and counted in a
    logged `autoLinkDropped` tally, never silently discarded (No-Arbitrary-Limits honesty).

## Part F — MAD confidence projection (rule 13), vendored oracle (v2-P1-6)

15. **Read-time confidence, never stored node state.** For metric-bearing `Finding` nodes, the preview
    ports the `confidence.rs` MAD oracle **inline** (rule 15a): extract metric values from `node.body`
    (`recallBody` :173), group by **normalized unit**, and where a unit-group has ≥3 values compute
    `confidence = |best Δ| / MAD` (the group with the most values wins; ties broken by higher
    confidence), mapped HIGH (≥2.0) / MODERATE (1.0–2.0) / LOW (<1.0) / HIGH-INF (MAD==0). The value is
    computed **at projection time** from content and attached as the `nodes[].confidence` overlay
    (rule 1) — it is derived, so it is replay-exact by recomputation and adds **zero** mutable node
    fields (the ScratchFact precedent: projections re-derive, never store, :12909-12912). Findings with
    <3 metric-bearing values in every unit-group carry `confidence:null`, exactly as the oracle's
    `compute_experiment_confidence` returns `None`.
15a. **The vendored oracle (grammar, units, guards, formulas).** Reproduced from
    `pm-kg-reference/confidence.rs` so the contract is self-contained and reproducible:
    - **Extraction grammar (linear-time, no ReDoS).** A single global scan of `recallBody(node.body)`
      with the fixed pattern
      `/(?<sign>[+-])?(?<number>\d+(?:\.\d+)?)\s*(?<unit>tok\/s|tokens?\/s|ms|us|ns|sec|seconds?|min|minutes?|GB|MB|KB|TFLOPS|GFLOPS|tokens?|%|x)/gu`.
      Every quantifier is non-overlapping and the units are a literal alternation, so matching is O(n)
      with no catastrophic backtracking. Input is the already byte-bounded node body (recall candidate
      bytes are capped at `maxCandidateBytes` :12872), and the number of extracted metrics per node is
      additionally capped at `maxCandidates` for a hard linear bound.
    - **Value guards.** `value = (sign === '-' ? -1 : 1) * Number(number)`. Because `number` is a bare
      decimal literal (`\d+(?:\.\d+)?`, no exponent, no `Infinity`/`NaN` token), the parse is always
      finite; adversarial `Finding` text cannot inject `NaN`/`±Infinity`. A defensive
      `Number.isFinite(value)` filter drops anything non-finite before grouping.
    - **Unit normalization.** The captured unit is canonicalized by a fixed table so trivially-equal
      units share a group: `tok/s, tokens/s → tok/s`; `token, tokens → token`; `sec, second, seconds → s`;
      `min, minute, minutes → min`; `ms, us, ns, GB, MB, KB, TFLOPS, GFLOPS, %, x → themselves`
      (lowercased where the pattern is case-insensitive). This is part of the vendored grammar —
      deployment-independent, deterministic, replay-exact — and is the intentional refinement over the
      oracle's raw-string grouping that the red-team asked for.
    - **Statistics.** Sort each unit-group ascending; `median` = middle value (mean of the two middle
      values for even n); `MAD` = median of `|vᵢ − median|`; `best Δ` = `max |vᵢ − median|`;
      `confidence = MAD === 0 ? Infinity : bestΔ / MAD`. Interpretation exactly as the oracle:
      `Infinity`/`≥2.0` ⇒ HIGH, `≥1.0` ⇒ MODERATE, else LOW.
    - **Per-node vs per-experiment.** The oracle's `compute_experiment_confidence` gates on ≥3 *findings*
      and groups metrics **across** them; this projection scores **one** Finding's own body, so it drops
      the cross-finding count gate and keeps only the ≥3-values-in-a-unit-group gate and the identical
      group-selection/statistics. This adaptation is stated explicitly so it is not a hidden divergence.
    A red test asserts a Finding with ≥3 unit-matched metrics yields HIGH/MODERATE/LOW/INF matching the
    oracle on the same inputs, and a Finding with <3 yields `confidence:null`; another asserts confidence
    is never a stored node field.

## Part G — staleness surfacing (rule 14)

16. **Unreferenced / superseded / contradicted-unresolved nodes carry an age marker (evented-read
    scoped, v2-P2-11).** A `nodes[].staleness` overlay (computed at projection time from the bi-temporal
    validity baton already stores) marks a node as stale when it is superseded (`validTo` set, or a live
    `Supersedes` edge points at it), party to a live `Contradicts` (`!edge.validTo`, :12290), or
    **unreferenced by any evented `knowledge.read`/`knowledge.recall`** since some deployment-owned age.
    "Unreferenced" is deliberately scoped to **evented** reads: `_knowledgeReads` (:98/:782) records only
    receipts folded at :7800/:7821, and `recallPreview` is non-evented by construction (Part A), so
    preview traffic — however heavy — does **not** count as a reference. That is intentional and matches
    rule 5: making preview traffic assessable/referable is the *same* explicit follow-up, and this
    contract does not add preview-read tracking (which would re-introduce the evented preview writes
    Part A severs). The marker carries the node's age (from `validFrom` / `eventTimeSeq` :12911) and
    reason, and rides into the orchestrator briefing (Part B). Like confidence it is a read-time overlay —
    never a stored flag, never a mutation — so staleness cannot drift from truth.

## Part H — fold surface: `_apply` / snapshot / checkpoint / replay

17. **KG-3 adds nothing to the fold.** `recallPreview`, the composite ranking, MAD confidence, and
    staleness are all pure read projections: no new event kind, no `_apply` case (:7195), no snapshot
    field (:10341), no `_knowledgeReads` push (:7800/:7821). Replay is trivially exact because there is
    nothing to replay — a preview is a function of `(projectFence, policy, query)` and `projectFence`
    itself is derived from folded node/edge history (rule 3), so it recomputes identically. Cache entries
    are process-local and fence-keyed; they are never serialized into the checkpoint.
18. **KG-4 auto-link rides the existing edge fold.** Auto-admitted Supports/Refines/Cites edges go
    through the *unchanged* `addKnowledgeEdge` → `knowledge.edge_added` path (:12594-12612), folded by
    `_apply` at :7780, captured in `snapshot().knowledge.edges` (:10341), and revalidated on replay by
    `_validateKnowledgeEdgePayload` (:12271-12292). No new event kind, no new checkpoint field — the
    only durable KG-4 write is an ordinary knowledge edge, so checkpoint/replay semantics are inherited
    verbatim. On **replay**, each auto-link event re-applies with its own recorded `auth.key`, so the
    fold is a no-op-safe re-apply; on **re-proposal** the deterministic key (rule 13a) makes a second
    admission attempt idempotent (`result:'idempotent'`, :12600) rather than a `duplicate_edge`.

## Part I — error codes and bounds

19. **Error codes.** `recallPreview` throws only on caller-shape faults, reusing the recall code
    `causal_recall_invalid` (its own input guard mirroring `_prepareKnowledgeRecall` :12832-12845; the
    body's :12868/:12876 throws are unreachable by rules 1a/10a). All ceiling breaches degrade to
    `briefingUnavailable` with `reason ∈ {causal_recall_oversize}` (never thrown; the contradiction case
    is peeled first per rule 11a). Auto-link edge admission surfaces exactly the store's edge codes and
    no new ones: `missing_endpoint` (:12277), `duplicate_edge` (:12275), `invalid_edge_type` (:12273),
    `knowledge_edge_conflict` (:12599); by construction (rule 13) it can never hit
    `invalid_contradiction`/`invalid_supersession`/`stale_version`, and by the deterministic key
    (rule 13a) a re-proposal returns `result:'idempotent'` rather than `duplicate_edge`.
20. **Bounds, all deployment-owned, none arbitrary.** The preview policy is split (rule 8a):
    `policy.recall` is the exact 11-field `KNOWLEDGE_RECALL_POLICY_FIELDS` block (`maxCandidates`,
    `maxCandidateBytes`, `maxGraphRows`, `maxGraphDepth`, `maxResults`, `maxSnippetBytes`, … the :122
    shape) passed unchanged to the body; `policy.preview` carries the composite weights (rule 8, each
    `≥ 0`), `MAX_BRIEFING_BYTES`, `MAX_SIDEBAR_BYTES`, the per-type auto-link thresholds, `K` (max
    auto-edges per admission), and `maxPreviewCacheEntries` (the LRU cache bound, v2-P2-7). Every
    truncation or drop emits an explicit marker (`briefingUnavailable`, `contradictionFlood`,
    `contradictionPeeled`, `seedsDropped`, `sidebarTruncated`, `autoLinkDropped`); nothing is silently
    dropped.

## Part J — red tests first (`impl/test/kg3-activation-red.test.mjs`, `impl/test/kg4-quality-red.test.mjs`)

KG-3: a `recallPreview` appends **no** ledger event (event count byte-identical before/after) and pushes
nothing to `_knowledgeReads`; the same `(projectFence, query, policy)` returns a byte-identical projection
from cache and recomputes on fence advance — and an **unrelated non-KG event** (a task dispatch) that
advances `this._events.length` but not the KG fence **does not** bust the cache (proving the KG-only
fence, v2-P2-7); a ceiling breach returns `briefingUnavailable:true` with a `causal_recall_*` reason and
dispatch proceeds; a caller-shape fault throws `causal_recall_invalid`; **a decision seed superseded
between citation and preview is dropped into `seedsDropped[]`** and the preview still returns (never
`causal_recall_invalid`, v2-P1-4); an assessment batch derived after N previews references zero preview
`recallEventSeq`. Seam: a briefing surfaced between spawn and recovery leaves `briefDigest` (:4506)
unchanged and the continuation matches store-side (:2599) — **including one case on the non-contextCall
branch** (v2-P0-1); briefing bytes are `boundedAttentionText`-redacted and provenance-marked; over-budget
briefings truncate with a marker. Ranking: composite honors deployment weights and is tie-stable, and a
**weight of 0 disables its term**; the extended split policy is accepted while `policy.recall` still
passes `validKnowledgeRecallPolicy`; a node joined by a live `Contradicts` ranks first with `warning:true`;
a resolved contradiction does not warn; **a Contradicts bundle over `maxResults` peels the ranked tail,
still surfaces the top contradiction with `warning:true` + non-zero `contradictionPeeled`, and dispatch
proceeds** (v2-P2-8). Decision/board: a decision preview writes nothing and attaches to the attention item;
a board sidebar is served from cache until board-fence ∪ project-fence advances.

KG-4: an auto-proposed `Contradicts` is refused (`invalid_contradiction`), a `Supersedes` is refused
(`invalid_supersession`/`stale_version`) — the refusal test drives the **store** admission path directly
(v2-P2-10) — and only above-threshold `Supports`/`Refines`/`Cites` admit (no grounding on the edge,
v2-P2-9); a below-threshold candidate is dropped and counted, never admitted; the auto-edge folds through
`knowledge.edge_added` and replays identically, and a **re-proposal under the deterministic auto-link key
returns `result:'idempotent'`**, never `duplicate_edge` (v2-P2-10). MAD: a Finding with ≥3 unit-matched
metrics carries HIGH/MODERATE/LOW/INF matching the vendored oracle on the same inputs (including the unit
normalization and finite-value guard); a Finding with <3 carries `confidence:null`; confidence is never a
stored node field. Staleness: a superseded / live-contradicted / **evented-unreferenced** node carries a
`staleness` marker with age; a node referenced only by previews still counts as unreferenced (v2-P2-11); a
live node does not; the marker is read-time only.

## Part K — boundaries

`recallPreview` is a read projection: non-evented, cached (LRU-bounded, KG-fence-keyed), fail-open — it
never appends, never feeds recall assessment, never blocks dispatch. The briefing is a separate
provider-visible section carried by the `{ brief, briefing }` wrapper (Part B) that never mutates
`task.brief` or `briefDigest`. The sanitizer lives in messages.mjs (Part B rule 7), never imported
app→coordinator. No new store, no embeddings, no FTS, no SQLite (docs/34 §5). No mutation of Cairn
admission or validity rules — auto-link goes through the unchanged `addKnowledgeEdge`, restricted to the
three evidence-free-admissible edge types and keyed deterministically; Contradicts/Supersedes are never
auto-minted; edges carry no grounding. Confidence and staleness are read-time overlays, never stored node
state, never mutations. No auto-promotion into the project horizon (that is KG-2's orchestrator-admit
gate). No MCP/CLI surface in this epic. No new event kind, no new `_apply` case, no new checkpoint field
beyond the ordinary knowledge edge (`projectFence` is derived from folded history, not stored). No
credentials in any projection; no git commits; no scratch/log writes anywhere (including /tmp).

## Part L — validation

Focused suites green (`impl/test/kg3-activation-red.test.mjs`, `impl/test/kg4-quality-red.test.mjs`), then
the full suite `node impl/scripts/run-suite.mjs` green from the worktree root; the wave-driver reviewer
contract (`node --test impl/test/wave-driver-red.test.mjs`, working directory `.`, exit 0) stays green.
