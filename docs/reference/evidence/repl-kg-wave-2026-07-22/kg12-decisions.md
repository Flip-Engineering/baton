# KG-1 + KG-2 decisions contract — horizon projections and promotion paths (R34 resolved, v2 red-team-resolved)

Ground truth: docs/34 (v2, red-team-corrected) §3 KG-1 (rules 1-4) and KG-2 (rules 5-7),
issues #24/#25. Code: the Cairn knowledge admission surface in
`impl/src/coordination-store.mjs` (type/edge/grounding const tables :118-120; reserved-field
guard `_knowledgePayload` :12215-12219; evidence-ref validation `_validateKnowledgeEvidence`
:12231-12240, including the `coordinationSeq < eventSeq` temporal check :12235; node admission
`_validateKnowledgeNodePayload` :12247-12260, including the `verified Finding requires evidence`
rule :12258; edge admission `_validateKnowledgeEdgePayload` :12271-12292, including
`Supersedes`/`Contradicts` :12279-12291; public writers `addKnowledgeNode` :12561-12571,
`_prepareKnowledgeNode` :12573-12579 (its validate=true path re-derives a *prospective* seq as
`this._events.length + 1` at :12577 — accurate only when called with nothing pending append),
`promoteKnowledgeNode` :12581-12592, `addKnowledgeEdge` :12594-12613; the apply-time fold's own
re-validation of `knowledge.node_added`/`knowledge.promoted`, called with the event's real,
already-assigned `seq` and therefore always temporally correct (`_apply` :7769-7770); non-evented
reads `queryKnowledge` :12795-12813 (:12809 filters out any node with an expired `validTo` — a
node can still be *live in the map* while invisible to this filter, since invalidation only sets
`validTo`, never removes the entry — `_setKnowledgeNode` call sites at, e.g., :7244, :7785 clone-
and-mutate in place), `queryKnowledgeEdges` :12815-12826; the generic nodes/edges fold used by
`knowledge.promotion_batch`/`knowledge.scratch_corrected` :7756-7763 (payload-digest comparison
only — no per-node call to `_validateKnowledgeNodePayload` in this fold or in the node/edge
builders that feed it, :12510-12520); the promotion-authority guard `promotionActor` :245 (a
literal-string check — `'orchestrator'` or `operator:<id>`, not a cryptographic actor proof) and
its enforcement in `promoteKnowledgeBatch` :12372-12374; the run-orchestrator lease-binding
pattern in `_validateRunLineageAdmission` :1403-1427 (lease existence/status/digest/issuedEvent
match at :1415-1417) and `issueRunOrchestratorLease` :1429-1456, `revokeRunOrchestratorLease`
:1458+; atomic multi-event admission `_appendBatch` :1058-1116 (writer-lease check
`_assertWriterLease` :1059; each entry independently requires only a non-empty `auth.actor`
string, :1069 — no actor-identity check beyond that; events are pushed into `_events` and
`_apply`-ed in order, :1108-1113, so a later entry's evidence can reference an earlier entry's
real seq — but never its own), already used to co-append a knowledge edge with its contamination
record :12605-12611); the board family (`boardFence` :12057-12059, `postBoardItem` :12061-12082,
`_boardSuccessor` :12087-12111, including the terminal-state guard `board_item_not_open` :12090
— a board item can only ever complete ONE close/drop transition, `closeBoardItem` :12128-12132,
`boardSnapshot` non-evented read :12201-12209, whose `claims`/`reports` fields are fed by
`board.claim_requested` :12206/:7743-7745, `board.claim_expired` :7751-7753, and
`board.report_submitted` :12207/:7754-7755 — none of which advance `boardFence`, per the fold's
own comment at :7744); the context-package family (`_normalizeContextPackageValueRef` :8644-8668,
`_normalizeContextPackage` :8706-8756, `admitContextPackage` :8796-8821 appending
`package.admitted` at :8814, `attachContextPackage` :8830-8856 appending `package.attached` at
:8851, `contextPackage` :8569-8582, `contextPackageAttachments` :8584-8586). Coordinator:
wrapper-bound actor for board orchestrator-authority (`closeBoardItem` :9139-9143, honoring an
`opts.actor` override with `?? 'orchestrator'` as only the default) vs worker-owned traffic
(`requestBoardClaim`/`submitBoardReport` :9153-9171); the two existing hardcoded-actor
promotions, `actor: 'policy'` never `opts.actor` (:5560-5574, :10252-10258); the interaction
lifecycle (`question.asked`/`approval.requested`/`decision.requested` ask,
`question.answered`/`approval.resolved`/`decision.settled` resolve, :9779-9934). Companion
contract: reflex2-boards-decisions.md (board fence/claim rules this doc builds on unchanged).

Non-relitigated (v2, settled): `ReplManifest` as a second manifest shape with its own digest
basis; per-scope binding fences; `cell:` refs resolved at manifest admission; `recallPreview`
non-evented; `providerBrief` injection seam; Source-node citation bridging; union fences;
auto-link restricted to Supports/Refines/Cites. This contract is the KG-1/KG-2 implementation
layer only — KG-3/KG-4 mechanics are out of scope here.

## v2 revisions

Resolves docs/reference/evidence/repl-kg-wave-2026-07-22/kg12-redteam.md. All line citations in
this contract were re-verified against `impl/src/coordination-store.mjs` and
`impl/src/coordinator.mjs` at revision time; several v1 citations were incomplete (widened here)
but none pointed at the wrong code.

- **P1-1** (union-fence under-covers projection inputs) — fixed, then CORRECTED by the bloc
  acceptance review (2026-07-23, P1-1 there): the first fix used an enumerated kind allowlist
  that silently missed task.created / route.outcome_observed / artifact.* /
  knowledge.invalidated / contradiction_resolved / reuse_* mutations. The landed rule is now
  two-half: knowledge mutations are MECHANICALLY derived (the `_setKnowledgeNode`/
  `_setKnowledgeEdge` fold helpers mark every knowledge-mutating event — no enumeration, and a
  new node-writing kind cannot escape it), and the only non-knowledge horizon inputs are the
  five named kinds (`package.admitted/attached`, `board.claim_requested/claim_expired/
  report_submitted`), closed by design. `projectionInputFence()` advances once per qualifying
  event, replay-exact, appended as a fourth component to both the task fence (rule 2) and the
  workflow fence (rule 3). The regression test (KG-1f) now asserts the property directly —
  any `queryKnowledge({})`-visible mutation misses the cache — and the acceptance verdict
  downgraded to Conditional Accept until this correction landed.
- **P1-2** (Part D `admitSeq` self-referential) — fixed. The admitted Finding's evidence now
  references `candidate.observedSeq` (the candidate's own, necessarily-prior minting seq),
  never the admission event's own prospective seq (Part D rule 17). Also answers the report's
  open question: `_validateWorkflowAdmissionPayload` does **not** call
  `_validateKnowledgeNodePayload` per node — it follows the `knowledge.scratch_corrected`
  precedent of payload-digest-only comparison (Part D rule 14).
- **P2-3** (Part F actor boundary false for Parts B/C) — fixed. The knowledge-graph batch
  entries in Parts B and C (Finding/Source/DerivedFrom `knowledge.node_added`/`edge_added`
  entries) now carry a hardcoded `auth.actor: 'policy'`, independent of whatever actor the
  triggering `board.item_closed`/`package.admitted` entry carries (Part B rule 8, Part C
  rules 12-13). Part F's "no free-string actor reaches `addKnowledgeNode`" claim now holds
  universally, not just for Part D.
- **P2-4** (prospective-seq trap) — fixed. Parts B and C now call `_prepareKnowledgeNode(...,
  validate=false)` before the batch is built, relying on the apply-time fold's
  `_validateKnowledgeNodePayload` call (:7770, run with the real, already-assigned seq) as the
  actual gate (Part B rule 7, Part C rule 13).
- **P2-5** (idempotency/replay edge cases) — fixed/rebutted per sub-finding:
  (a) rebutted by new boundary: this contract never constructs a `Supersedes` edge with a
  `Source`-type target, so Part C's check-before-write is always accurate for cell-content
  Sources (Part F). (b) reworded: rule 9's "never collides" language now attributes this to the
  state-machine guard (`board_item_not_open`, :12090 — a board item completes at most one
  close/drop) rather than to the id scheme alone. (c) added: a red test for a second close with
  a *different* idempotency key asserting `board_item_not_open` (Part E).
- **P2-6** (bindingFence doesn't exist yet) — fixed. New explicit sequencing boundary: rules 2-3
  and the binding-rebind red test are blocked on the REPL-2 contract (docs/33 rule 5) landing
  `repl.binding_set`/`bindingFence` in the store first; this contract does not implement it
  (Part F).
- **P2-7** (lease gate is consistency, not auth) — fixed. Rule 16 (was rule 15) reworded to
  describe the lease check as an ordering/consistency device layered on the same single-writer
  trust model as the rest of the store, not a cryptographic authority proof; added explicit
  ordering vs. `revokeRunOrchestratorLease` at run settle (Part D rule 16).

## Part A — KG-1: three horizon projections, one union-fence cache rule

1. **No new store, no new query engine.** Task, workflow, and project horizons are three
   **read-only projections** over the same `_knowledgeNodes`/`_knowledgeEdges`/board/package/
   binding state already in the store — never a second graph. Task and workflow projections are
   built from `boardSnapshot` (:12203-12209), `contextPackage`/`contextPackageAttachments`
   (:8569-8586), REPL binding projections (docs/33 rule 5), and `queryKnowledge`/
   `queryKnowledgeEdges` (:12795-12826) filtered to the requesting scope. Project horizon is
   `queryKnowledge`/`queryKnowledgeEdges` unfiltered by run/task, `repoId`-scoped by the caller's
   policy exactly as existing promotion/recall paths already require (`promoteKnowledgeBatch`
   :12372-12374, `_prepareKnowledgeRecall` :12841).
2. **Task horizon fence** = `(boardFence(board), bindingFence(worker:<workerId>),
   interactionGeneration(taskId), projectionInputFence())`. The first two reuse `boardFence`
   (:12057-12059, replay-derived count of orchestrator-authority board events) and
   `bindingFence(scope)` (docs/33 rule 5, replay-derived count of `repl.binding_set`/`_dropped`
   for that scope) unchanged — see Part F for the sequencing dependency this creates.
   `interactionGeneration(taskId)` is **new but not a new event kind or store field**: a
   coordinator-level counter, `Map<taskId, number>`, incremented once per admitted interaction
   lifecycle event scoped to that task's worker — `question.asked`, `approval.requested`,
   `decision.requested` (ask), `question.answered`, `approval.resolved`, `decision.settled`
   (resolve), and the three admission-refusal kinds `control.duplicate_interaction_rejected`,
   `control.malformed_interaction_rejected`, `control.drain_interaction_discarded`
   (coordinator.mjs:9779-9934). It replays identically to `this._pending`/
   `this._activeInteractionIds`, which are already rebuilt from this exact event stream on
   replay — no new persistence, purely a re-count. `projectionInputFence()` is the fourth
   component — see rule 5.
3. **Workflow horizon fence** = the tuple of `boardFence` for every board attached to the run
   (via `contextPackageAttachments`/board-scope conventions) + `bindingFence('shared')` +
   `decisionSettleCount(runId)` + `projectionInputFence()`. `decisionSettleCount` is the
   coordinator-level, per-run replay-derived count of `decision.settled` events (a strict subset
   of rule 2's interaction kinds — approvals/questions don't feed wave-level learning per docs/34
   §4) whose owning task belongs to `runId`. Both `decisionSettleCount` and
   `interactionGeneration` are plain re-derivations from the coordinator's existing replay path
   (coordinator.mjs:9779-9934); this is the R34-9 union rule extended with rule 5's global
   backstop — no invented "run event count" beyond that one shared counter.
4. **Project horizon fence** = the store's own applied-event position (`this._events.length` at
   query time — the same boundary already tracked for checkpoints, coordination-store.mjs
   `_writeProjectionCheckpoint`/checkpoint interval :1050-1052). No new counter here — it was
   already a strict superset of every other fence component, including `projectionInputFence()`.
5. **Store-wide projection-input fence (P1-1 fix).** Rules 2-3's named components (`boardFence`,
   `bindingFence`, `interactionGeneration`, `decisionSettleCount`) do **not** cover every write
   that can change a task/workflow projection's *output*: `boardSnapshot`'s `claims`/`reports`
   fields (:12206-12207) are fed by `board.claim_requested`/`claim_expired`/`report_submitted`,
   which deliberately never bump `boardFence` (:7744); `contextPackage`/`contextPackageAttachments`
   are fed by `package.admitted`/`package.attached` (:8814/:8851), which no named component
   tracks at all; `queryKnowledge`/`queryKnowledgeEdges` are fed by every `knowledge.*` write
   (`node_added`, `promoted`, `edge_added`, `promotion_batch`, `scratch_corrected`, and Part D's
   new `workflow_admitted`), none of which bump `boardFence`/`bindingFence` either. An exact-tuple
   cache hit on the old 3- or 4-tuple could therefore return a stale projection. Fix:
   `projectionInputFence()` is a new **store-level**, global (not per-scope), replay-derived
   counter — the same mechanism as `boardFence`, generalized — incremented once per applied event
   of kind `knowledge.node_added`, `knowledge.promoted`, `knowledge.edge_added`,
   `knowledge.promotion_batch`, `knowledge.scratch_corrected`, `knowledge.workflow_admitted`,
   `package.admitted`, `package.attached`, `board.claim_requested`, `board.claim_expired`, or
   `board.report_submitted` — i.e., every event kind that mutates projection-input state without
   already being counted by `boardFence`'s five orchestrator-authority transitions. Because it is
   global rather than scope-filtered, it trades cache locality (any qualifying write anywhere
   invalidates every task/workflow cache entry) for a hard correctness guarantee: no stale hit is
   possible for any current or future projection input, without having to enumerate and re-verify
   every input surface by hand each time one is added.
6. **Cache shape.** Each horizon projection is cached as
   `{ scope, fenceTuple, computedAt, value }` keyed by `(scope-identity, fenceTuple)`; a cache hit
   requires exact tuple equality (all fence components unchanged), a miss recomputes from
   `queryKnowledge`/`queryKnowledgeEdges`/`boardSnapshot`/binding projections — never a partial
   invalidation. Task/workflow fence tuples now have four components (rules 2-3); the project
   fence tuple still has exactly one (rule 4). This is the same `(scope, fence)` cache discipline
   as `BoardProjection` (reflex2-boards-decisions.md rule 10) and the REPL binding projection
   (docs/33 rule 5), generalized to three horizons instead of one.
7. **Reads stay non-evented at task/workflow horizons (F10).** No new `knowledge.horizon_read`
   event kind; `queryKnowledge`/`queryKnowledgeEdges` (:12795-12826) already append nothing — they
   are plain filters over in-memory maps. Project-horizon reads keep the existing evented
   `knowledge.read` (`recallKnowledgeBounded` :12965, event kind handling :7798-7811) **only**
   where recall assessment consumes them (`_knowledgeReads` feeds contradiction/contamination
   scans :3138, :3177, :3413, :6906-6922, :12772-12786) — a horizon projection built from
   `queryKnowledge` never appends to `_knowledgeReads` and is therefore invisible to recall
   assessment by construction, exactly as KG-3's `recallPreview` will be (named, not built here).

## Part B — KG-2 rule 5: task → workflow, board-close Finding

8. **Atomic with the close, not a separate step.** `_boardSuccessor` already batches a second
   event when a benign edit migrates a claim (`board.claim_migrated`, :12105-12108, via a second
   `this._append` call today). For `kind === 'board.item_closed'` specifically, the same call
   site is extended to build a **`_appendBatch`** (:1058-1116, `batchKind: null` — the same
   unrestricted-batch-kind path already used to co-append a knowledge edge with its contamination
   record, :12605-12611) of exactly two entries: `board.item_closed` itself, then a
   `knowledge.node_added` payload for the candidate Finding. Both entries are pushed and `_apply`
   -ed in order (:1108-1113: push happens before `_apply`, so entry 2's evidence can reference
   entry 1's seq), so the Finding's evidence seq is knowable synchronously before the batch is
   built: `const closeSeq = this._events.length + 1;` (the same precomputation style as
   `invalidationEvent = this._events.length + 1` at :12607). The Finding payload is built via
   `_prepareKnowledgeNode(fields, promotion, validate=false)` (P2-4 fix): calling it with
   `validate=true` before the batch is appended would re-derive its own prospective seq as
   `this._events.length + 1` (:12577), which at that point in the call still equals `closeSeq`
   itself — the same value the Finding's evidence points at — tripping the `coordinationSeq <
   eventSeq` check (:12235) on a functionally valid payload. Skipping prepare-time validation is
   safe because the apply-time fold re-validates with the event's real, already-assigned seq
   (`_apply` :7769-7770), which is correct by construction once the batch has been pushed.
9. **Finding shape.** `id: \`finding:board-close:${itemId}:${itemVersion}\`` (deterministic per
   closed item-version — the deterministic id prevents collisions across two *different* items or
   two *different* item-versions by construction; a given item-version specifically can only ever
   complete one close, because `_boardSuccessor` refuses any non-`open` item with
   `board_item_not_open` (:12090) — so "never collides" is a state-machine guarantee, not solely
   an id-scheme one; mirrors the `outcome:${task.id}:${verifyEvent.seq}` naming precedent,
   coordinator.mjs:5561, :10253), `type: 'Finding'`, `grounding: 'observed'` (candidate-tier, the
   lowest grounding that still round-trips `_validateKnowledgeNodePayload` without requiring
   evidence — :12258 only gates `verified` Findings), `evidence: [{ coordinationSeq: closeSeq }]`,
   `promotion: { kind: 'Finding', trigger: 'board.item_closed' }`, plus a non-reserved
   `boardItemRef: { itemId, itemVersion, itemDigest }` field carrying the exact triple the closed
   item's own `board.item_closed` payload carries (:12100-12102) — `boardItemRef` is not in
   `KNOWLEDGE_PROJECTION_FIELDS` (:121) so `_knowledgePayload`'s reserved-field guard (:12216)
   accepts it untouched. Board items are never edge endpoints and never become nodes themselves
   (R34-7b) — the triple is data carried *on* the Finding, not a graph reference to the item. The
   Finding's `knowledge.node_added` batch entry carries a **hardcoded** `auth.actor: 'policy'`
   and its own idempotency key (`knowledge.node_added:${findingId}`), independent of whatever
   actor the `board.item_closed` entry carries (P2-3 fix — see Part F).
10. **No gate here.** Every board-item close mints its candidate Finding unconditionally — this is
    the "no evidence required at admission" language in docs/34 rule 5; the settle-time gate
    (Part D) is a separate, later, explicit step over these candidates, never bypassed by this
    one.

## Part C — KG-2 rule 6: package citation, Source-node bridge

11. **One Source node per unique wrapped-cell content digest, idempotent.** A context package
    branch with a `valueRef` (:8644-8668) carries `valueDigest` — the cell's own content digest.
    Source node id: `` `source:cell:${valueRef.valueDigest}` `` — pure content-address, so wrapping
    the same cell into a second package (or the same package twice, deduplicated by
    `valueDigest` before building the batch — two branches citing the same cell must never
    double-mint) resolves to the identical id. Idempotency is a **check-before-write**, not a
    store-level dedupe: before building the batch, the extension to `admitContextPackage`
    (:8796-8821) calls `this.queryKnowledge({ ids: [sourceId] })` (:12795-12813, a pure read, no
    event) for each unique `valueDigest`; only digests **absent** from that result get a
    `knowledge.node_added` entry. This is the same "check the map before minting" shape already
    used inline in `_apply` for representation Source nodes (`if
    (!this._knowledgeNodes.has(sourceNode.id)) this._setKnowledgeNode(...)`, :7239), done here at
    the wrapper layer instead, since `admitContextPackage` needs the result *before* deciding
    what to batch, not inside the fold. This check-before-write is only sound because
    content-addressed cell Sources can never be invalidated within this contract — see Part F's
    boundary on `Supersedes` targets (P2-5(a) fix): `queryKnowledge`'s absence result would
    otherwise be ambiguous between "never minted" and "minted, then invalidated" (`validTo`-
    filtered at :12809, while the live `_knowledgeNodes` map retains the entry and would still
    trip `duplicate_node` at :12251 on a re-mint attempt).
12. **Source node shape.** `type: 'Source'`, `grounding: 'observed'` (an unreviewed content
    citation — matches the `ProviderDelivery` Source grounding convention, :7279, not the
    `verified` tier reserved for oracle/official-attested sources, :7232/:7257),
    `evidence: [{ coordinationSeq: admitSeq }]`, `promotion: { kind: 'Source', trigger:
    'package.wrapped_cell' }`, `cellDigest: valueRef.valueDigest`, `runId: normalized.provenance
    .runId` (nullable — `ContextPackage.provenance` carries `{ runId, principalId }`, no `repoId`
    field at all, :8706-8756, so package-derived Source/Finding nodes are `runId`-scoped, not
    `repoId`-scoped; the settle-time gate in Part D is where `repoId` re-enters, resolved from the
    run record, not the package). Here `admitSeq` is the batch's own `package.admitted` entry
    seq, precomputed the same way as Part B's `closeSeq` (`const admitSeq = this._events.length +
    1;` before the batch is built) — always strictly prior to the Source/Finding/DerivedFrom
    entries that reference it, since `package.admitted` is entry 1 of the batch.
13. **Package Finding + DerivedFrom bridge.** One Finding per package admission,
    `id: \`finding:package:${packageDigest}\``, `grounding: 'observed'`,
    `evidence: [{ coordinationSeq: admitSeq }]`,
    `promotion: { kind: 'Finding', trigger: 'package.admitted' }`. For every unique wrapped-cell
    Source node (whether freshly minted this call or already present from a prior package), one
    `DerivedFrom` edge `{ id: \`knowledge-edge:derivedfrom:${findingId}:${sourceId}\`, from:
    findingId, to: sourceId, evidence: [{ coordinationSeq: admitSeq }] }` — edge endpoints must
    already exist (:12276-12277), which the check-before-write in rule 11 guarantees (the Source
    node entry, if new, precedes the edge entry in the same batch and is applied first,
    :1108-1113). Branches without a `valueRef` (a bare `source`/`artifact` ref) mint no Source
    node and get no edge — only wrapped cells are bridged (R34-7b's premise: cells, like board
    items, are not nodes; Source is the *only* bridge type for them). `admitContextPackage`
    becomes a single `_appendBatch` of `package.admitted` + 0..N new Source nodes + 1 Finding + N
    DerivedFrom edges, all-or-nothing. Every Source/Finding/DerivedFrom entry is built via
    `_prepareKnowledgeNode`/`_knowledgePayload` with **no prepare-time validation** (same P2-4
    fix as Part B rule 8 — the apply-time fold at :7769-7781 is the actual gate) and carries a
    **hardcoded** `auth.actor: 'policy'` on its batch entry, independent of the caller's actor on
    the `package.admitted` entry (same P2-3 fix as Part B rule 9).

## Part D — KG-2 rule 7: workflow → project, the settle-time orchestrator-admit gate

14. **New event kind, new dedicated derive/validate pair — not a reuse of
    `knowledge.promotion_batch`.** That event's validator (`_validateKnowledgePromotionPayload`,
    driven by `_deriveKnowledgePromotion` :12294-12299) re-derives its candidate set from the
    scratch/verified-outcome scan policy (`KNOWLEDGE_PROMOTION_POLICY_FIELDS`, :124) and would
    reject any payload not produced by that exact algorithm — stuffing board/package Findings
    into it would either fail integrity replay or require mutating that settled algorithm, which
    docs/34 §5 forbids ("no mutation of Cairn admission/validity rules"). Instead: a new event
    kind `knowledge.workflow_admitted`, structurally modeled on `knowledge.scratch_corrected`
    (:12468-12553) — its own `_deriveWorkflowAdmission(repoId, runId, candidateFindingId, policy,
    beforeEventSeq)` and `_validateWorkflowAdmissionPayload(payload, event, integrity)`, and a
    generic `_apply` fold branch identical in shape to the existing
    `knowledge.promotion_batch`/`knowledge.scratch_corrected` node/edge loop
    (`for (const node of p.nodes) this._setKnowledgeNode(...); for (const edge of p.edges)
    this._setKnowledgeEdge(...)`, :7756-7763) — the third instance of that pattern, not a new one.
    Answering the open question P1-2 raised: `_validateWorkflowAdmissionPayload` does **not**
    call `_validateKnowledgeNodePayload` per node. It follows the `knowledge.scratch_corrected`
    precedent exactly (:12534-12543): re-derive the expected nodes/edges via
    `_deriveWorkflowAdmission` and compare `canonicalDigest(payload.nodes/edges)` against the
    derived result — a payload-digest-only integrity check, never a per-node temporal
    re-validation. This means the fold **cannot** catch a self-referential evidence seq at
    apply time the way `knowledge.node_added`'s fold does (:7770) — correctness here depends
    entirely on `_deriveWorkflowAdmission` constructing a valid evidence ref in the first place,
    which is exactly what rule 17's fix addresses.
15. **Candidate eligibility, checked in `_deriveWorkflowAdmission`.** The candidate
    (`queryKnowledge({ ids: [candidateFindingId] })`, :12795-12813) must: exist; have `type:
    'Finding'`, `grounding: 'observed'`; have `promotion.trigger` in `{ 'board.item_closed',
    'package.admitted' }` (Part B/C's two candidate sources); and have **no existing** `DerivedFrom`
    edge whose `from` node has `promotion.trigger === 'workflow.admitted'` and `to ===
    candidateFindingId` (i.e., not already promoted — checked via `queryKnowledgeEdges({ types:
    ['DerivedFrom'] })`, :12815-12826, filtered in the wrapper). Any failure is a typed refusal
    (`workflow_admit_ineligible`), never a silent skip.
16. **Authority: two checks, both store-enforced, no free-string actor — one is a consistency
    device, not a proof (P2-7 fix, R34-10i).** (a) `promotionActor(auth?.actor)` (:245) — only
    `'orchestrator'` or `'operator:<id>'`, the same guard `promoteKnowledgeBatch` already
    enforces (:12373); a caller passing any other actor string is refused at the store. This is a
    literal-string check, not a cryptographic identity proof — it is exactly as strong as the
    rest of the store's single-writer trust model (`_assertWriterLease`, :1059), no stronger.
    (b) An active **run-orchestrator lease** bound into the request — `{ lease: { id, digest,
    issuedEvent } }` — validated against `this._runOrchestratorLeases` exactly as
    `_validateRunLineageAdmission` already does for child-run admission (:1415-1417: lease must
    exist, `status === 'active'`, digest and `issuedEvent` match). Because the lease record is
    ledger-public (any single-writer caller can read `this._runOrchestratorLeases`), this check
    is a **consistency/ordering** guard — it proves the request is *coherent with* an active
    lease the writer already issued — not an authorization proof that the caller is who it
    claims to be; treat it as stricter *sequencing*, not stronger *authority*, than the board
    wrapper-bound-actor pattern (`opts.actor ?? 'orchestrator'`, coordinator.mjs:9139-9143).
    Ordering requirement: `admitWorkflowFinding` calls for a run must complete (or be explicitly
    abandoned) before that run's lease is revoked — `revokeRunOrchestratorLease` (:1458+) must be
    called strictly after settle-time admission finishes, never concurrently with or before it,
    or a legitimate admission will be refused against an already-revoked lease. The coordinator-
    level entry point accepts no `opts.actor` parameter at all for this call — mirroring the
    hardcoded `actor: 'policy'` precedent at coordinator.mjs:5574/:10258, but hardcoded to
    `'orchestrator'` (or the deployment's `operator:<id>` where an operator, not the automated
    orchestrator, is settling the run).
17. **Admitted Finding + edge, one atomic event.** `_deriveWorkflowAdmission` builds: an admitted
    Finding (`id: \`finding:workflow-admitted:${candidateFindingId}\``, `type: 'Finding'`,
    `grounding: 'verified'` — an explicit orchestrator/operator attestation, matching the existing
    convention that oracle/reviewer confirmation raises grounding to `verified`,
    coordination-store.mjs:12511 — which requires non-empty evidence, :12258; evidence carries
    forward the candidate's own evidence plus `{ coordinationSeq: candidate.observedSeq }` — the
    candidate Finding's own minting event seq, already recorded on the queried node by the
    `knowledge.node_added` fold (`observedSeq: event.seq`, :7771) — **never** the admission
    event's own prospective seq (P1-2 fix: the candidate must already exist to pass rule 15's
    eligibility check, so `candidate.observedSeq` is strictly prior to the new admission event by
    construction; the old "`admitSeq`" language was ambiguous with the admission event's own seq
    and, read that way, was self-referential — an invariant violation neither validation path
    (temporal check or digest-only fold, see rule 14) would catch), `promotion: { kind: 'Finding',
    trigger: 'workflow.admitted' }`, `repoId` (resolved by the coordinator wrapper from the run
    record, since neither board items nor packages carry `repoId`, rule 12), `runId`) and one
    `DerivedFrom` edge from the admitted Finding to the candidate (never `Supersedes` — the
    candidate is not invalidated; it remains the replay-exact historical record of what the run
    observed, per rule 15's non-promotion check reading it forward). `requestDigest`/
    `projectionDigest`/`receiptDigest` and the idempotency-by-auth-key replay path follow
    `correctScratchKnowledge`'s shape exactly (:12545-12553): a retry with the same `auth.key` and
    an unchanged candidate replays the identical event; a retry after the candidate diverged is a
    `causal_correction`-style conflict refusal, renamed for this event
    (`workflow_admit_conflict`).
18. **No silent auto-promotion (docs/34 §5).** Rules 8-13 (Parts B/C) run unconditionally and
    automatically on board-close/package-admit — that is intentional and does not violate this
    non-goal, because those candidates land at `grounding: 'observed'`, the same low-trust tier
    scratch facts start at, and are inert until Part D's explicit, lease-gated step. The existing
    verified-outcome auto-promotion (`promoteKnowledgeNode` calls at :5560-5574, :10252-10258,
    `grounding: 'verified'` for accepted task outcomes) and the scratch→KG policy
    (`promoteKnowledgeBatch`/`minScratchReaders`) are untouched — they are a **different**,
    already-settled promotion path with its own authority and candidate derivation, not
    superseded or merged with the new `knowledge.workflow_admitted` kind.

## Part E — red tests first (`impl/test/kg12-decisions-red.test.mjs`)

KG-1: a task-horizon projection cache hits when `(boardFence, bindingFence, interactionGeneration,
projectionInputFence)` is unchanged and misses on any single component changing (board post,
binding rebind, or a new question/approval/decision ask/resolve/reject on that task,
independently); a task/workflow-horizon projection also misses after any write that touches
*only* `projectionInputFence` — a board claim request/expiry, a report submission, a package
admission/attachment, or a direct knowledge node/edge write on an unrelated scope — even when
`boardFence`/`bindingFence`/`interactionGeneration`/`decisionSettleCount` are all unchanged (this
is the regression test for P1-1); a workflow-horizon projection's fence is the union across every
board+binding scope attached to the run plus `decisionSettleCount`, and an approval/question
resolve does *not* bump it while a decision settle does; a project-horizon projection recomputes
exactly when `_events.length` advances and never otherwise; no horizon read of any kind appends an
event (`_knowledgeReads` length is unchanged across all three). KG-2/Part B: closing a board item
mints exactly one `Finding` with `grounding: 'observed'`, evidence pointing at the close event's
own seq, a `boardItemRef` triple matching the closed item's `(itemId, itemVersion, itemDigest)`,
and a hardcoded `'policy'` actor on the `knowledge.node_added` entry regardless of the actor
passed to `closeBoardItem`; closing twice with the *same* idempotency key (replay) mints no
duplicate; closing twice with a *different* idempotency key refuses `board_item_not_open` (P2-5(c)
fix — the state-machine guard, not id collision, is what prevents a second Finding); the Finding
id never collides across two different items or two versions of the same item. KG-2/Part C:
admitting a package with N branches wrapping M unique cells (M ≤ N) mints exactly M Source nodes
and exactly M `DerivedFrom` edges from one package Finding, all with the hardcoded `'policy'`
actor; re-wrapping an already-cited cell in a second package mints zero additional Source nodes
and reuses the existing one; a branch with no `valueRef` produces no Source node and no edge.
KG-2/Part D: `admitWorkflowFinding` refuses a non-`observed` or already-promoted candidate
(`workflow_admit_ineligible`); refuses any actor that is not `'orchestrator'`/`operator:<id>`
(`promotionActor`, R34-10i) even when passed explicitly; refuses an inactive, revoked, or
digest-mismatched run-orchestrator lease; on success mints one `verified` Finding whose evidence
includes `{ coordinationSeq: candidate.observedSeq }` — a direct regression test that this equals
the candidate's own minting seq and is strictly less than the admission event's seq, never equal
to it — plus one `DerivedFrom` edge to the untouched (not superseded, not invalidated) candidate,
atomically; a verified-outcome auto-promotion (:5560-5574/:10252-10258) proceeds unaffected by any
of the above and never requires a lease.

## Part F — boundaries

No new store, no SQLite/FTS, no second graph — three horizons are three filtered views over the
one Cairn KG plus board/package/binding state; `projectionInputFence()` is one new store-level
counter alongside the existing `boardFence`, not a new store. No new event kind for KG-1 (pure
re-derivation); exactly one new event kind for KG-2, `knowledge.workflow_admitted`, structurally
identical to the existing `knowledge.promotion_batch`/`knowledge.scratch_corrected` node/edge-batch
fold. No mutation of `_validateKnowledgeNodePayload`/`_validateKnowledgeEdgePayload`/
`_deriveKnowledgePromotion`/`_deriveScratchCorrection` — every rule here is additive. Board items
and cells never become KG nodes and never become edge endpoints (R34-7b) — Source nodes and
`boardItemRef`/`cellDigest` fields are the only bridges. No `Supersedes` at settle-time admission —
candidates are retained, not invalidated. This contract also never constructs a `Supersedes` edge
targeting a `Source`-type node anywhere in Parts B/C/D — cell-content Sources are pure content
address (`source:cell:<valueDigest>`), so there is no "stale version" of one to supersede; this is
what makes Part C rule 11's check-before-write (`queryKnowledge` absence) always accurate, since a
`Source` here can never reach the invalidated-but-still-in-the-live-map state that would otherwise
make `queryKnowledge`'s absence result ambiguous (P2-5(a)). No free-string actor reaches
`addKnowledgeNode`/`promoteKnowledgeNode`/`addKnowledgeEdge`/the new admission path for
orchestrator-authority writes — every one of them is either hardcoded (`'policy'`, existing at
coordinator.mjs:5574/:10258 and now also on every Part B/C knowledge-graph batch entry per the
P2-3 fix; `'orchestrator'`/`operator:<id>`, new in Part D) or `promotionActor`-gated at the store.
Rule 16's run-orchestrator lease check is a consistency/ordering device layered on the store's
existing single-writer trust model, not an independent cryptographic authority mechanism — do not
read it as stronger proof of caller identity than `promotionActor` itself provides. `bindingFence`
does not exist in the store as of this contract (`grep -r 'repl.binding_set\|bindingFence'
impl/src` returns nothing) — Part A rules 2-3's `bindingFence` components, and any red test that
exercises a binding rebind, are blocked on the REPL-2 contract (docs/33 rule 5) landing
`repl.binding_set`/`bindingFence` in the store first; this contract does not implement that event
kind or field. No git commits, no scratch/log writes anywhere (including /tmp). KG-3
(`recallPreview`, briefing injection, decision-time surfacing) and KG-4 (auto-link, MAD
confidence, staleness) are out of scope for this contract.

## Part G — validation

Focused suite green, then the full suite `node impl/scripts/run-suite.mjs` green from the worktree
root; the wave-driver reviewer contract (`node --test impl/test/wave-driver-red.test.mjs`, exit 0)
stays green.
