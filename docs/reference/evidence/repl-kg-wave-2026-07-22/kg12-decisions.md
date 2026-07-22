# KG-1 + KG-2 decisions contract — horizon projections and promotion paths (R34 resolved)

Ground truth: docs/34 (v2, red-team-corrected) §3 KG-1 (rules 1-4) and KG-2 (rules 5-7),
issues #24/#25. Code: the Cairn knowledge admission surface in
`impl/src/coordination-store.mjs` (type/edge/grounding const tables :118-120; reserved-field
guard `_knowledgePayload` :12215-12219; evidence-ref validation `_validateKnowledgeEvidence`
:12231-12240; node admission `_validateKnowledgeNodePayload` :12247-12260, including the
`verified Finding requires evidence` rule :12258; edge admission `_validateKnowledgeEdgePayload`
:12271-12292, including `Supersedes`/`Contradicts` :12279-12291; public writers `addKnowledgeNode`
:12561-12571, `_prepareKnowledgeNode` :12573-12579, `promoteKnowledgeNode` :12581-12592,
`addKnowledgeEdge` :12594-12611; non-evented reads `queryKnowledge` :12795-12813,
`queryKnowledgeEdges` :12815-12826; the generic nodes/edges fold used by
`knowledge.promotion_batch`/`knowledge.scratch_corrected` :7756-7763; the promotion-authority
guard `promotionActor` :245 and its enforcement in `promoteKnowledgeBatch` :12373; the
run-orchestrator lease-binding pattern in `_validateRunLineageAdmission` :1415-1417 and
`issueRunOrchestratorLease` :1429-1456; atomic multi-event admission `_appendBatch` :1058-1116,
already used to co-append a knowledge edge with its contamination record :12605-12611); the
board family (`boardFence` :12057-12059, `postBoardItem` :12061-12082, `_boardSuccessor`
:12087-12111, `closeBoardItem` :12128-12132, `boardSnapshot` non-evented read :12201-12209); the
context-package family (`_normalizeContextPackageValueRef` :8644-8668, `_normalizeContextPackage`
:8706-8756, `admitContextPackage` :8796-8821, `contextPackage` :8569-8582). Coordinator:
wrapper-bound actor for board orchestrator-authority (`closeBoardItem` :9139-9143) vs
worker-owned traffic (`requestBoardClaim`/`submitBoardReport` :9153-9171); the two existing
hardcoded-actor promotions, `actor: 'policy'` never `opts.actor` (:5560-5574, :10252-10258); the
interaction lifecycle (`question.asked`/`approval.requested`/`decision.requested` ask,
`question.answered`/`approval.resolved`/`decision.settled` resolve, :9779-9934). Companion
contract: reflex2-boards-decisions.md (board fence/claim rules this doc builds on unchanged).

Non-relitigated (v2, settled): `ReplManifest` as a second manifest shape with its own digest
basis; per-scope binding fences; `cell:` refs resolved at manifest admission; `recallPreview`
non-evented; `providerBrief` injection seam; Source-node citation bridging; union fences;
auto-link restricted to Supports/Refines/Cites. This contract is the KG-1/KG-2 implementation
layer only — KG-3/KG-4 mechanics are out of scope here.

## Part A — KG-1: three horizon projections, one union-fence cache rule

1. **No new store, no new query engine.** Task, workflow, and project horizons are three
   **read-only projections** over the same `_knowledgeNodes`/`_knowledgeEdges`/board/package/
   binding state already in the store — never a second graph. Task and workflow projections are
   built from `boardSnapshot` (:12203-12209), `contextPackage`/`contextPackageAttachments`
   (:8569-8586), REPL binding projections (docs/33 rule 5), and `queryKnowledge`/
   `queryKnowledgeEdges` (:12795-12826) filtered to the requesting scope. Project horizon is
   `queryKnowledge`/`queryKnowledgeEdges` unfiltered by run/task, `repoId`-scoped by the caller's
   policy exactly as existing promotion/recall paths already require (`promoteKnowledgeBatch`
   :12374, `_prepareKnowledgeRecall` :12841).
2. **Task horizon fence** = `(boardFence(board), bindingFence(worker:<workerId>),
   interactionGeneration(taskId))`. The first two reuse `boardFence` (:12057-12059, replay-derived
   count of orchestrator-authority board events) and `bindingFence(scope)` (docs/33 rule 5,
   replay-derived count of `repl.binding_set`/`_dropped` for that scope) unchanged.
   `interactionGeneration(taskId)` is **new but not a new event kind or store field**: a
   coordinator-level counter, `Map<taskId, number>`, incremented once per admitted interaction
   lifecycle event scoped to that task's worker — `question.asked`, `approval.requested`,
   `decision.requested` (ask), `question.answered`, `approval.resolved`, `decision.settled`
   (resolve), and the three admission-refusal kinds `control.duplicate_interaction_rejected`,
   `control.malformed_interaction_rejected`, `control.drain_interaction_discarded`
   (coordinator.mjs:9779-9934). It replays identically to `this._pending`/
   `this._activeInteractionIds`, which are already rebuilt from this exact event stream on
   replay — no new persistence, purely a re-count.
3. **Workflow horizon fence** = the tuple of `boardFence` for every board attached to the run
   (via `contextPackageAttachments`/board-scope conventions) + `bindingFence('shared')` +
   `decisionSettleCount(runId)`. `decisionSettleCount` is the coordinator-level, per-run
   replay-derived count of `decision.settled` events (a strict subset of rule 2's interaction
   kinds — approvals/questions don't feed wave-level learning per docs/34 §4) whose owning task
   belongs to `runId`. Both new counters are plain re-derivations from the coordinator's existing
   replay path (coordinator.mjs:9779-9934); this is the R34-9 union rule — no invented "run event
   count," only a union of counters that are each independently replay-exact.
4. **Project horizon fence** = the store's own applied-event position (`this._events.length` at
   query time — the same boundary already tracked for checkpoints, coordination-store.mjs
   `_writeProjectionCheckpoint`/checkpoint interval :1050-1052). No new counter here at all.
5. **Cache shape.** Each horizon projection is cached as
   `{ scope, fenceTuple, computedAt, value }` keyed by `(scope-identity, fenceTuple)`; a cache hit
   requires exact tuple equality (all fence components unchanged), a miss recomputes from
   `queryKnowledge`/`queryKnowledgeEdges`/`boardSnapshot`/binding projections — never a partial
   invalidation. This is the same `(scope, fence)` cache discipline as `BoardProjection`
   (reflex2-boards-decisions.md rule 10) and the REPL binding projection (docs/33 rule 5),
   generalized to three horizons instead of one.
6. **Reads stay non-evented at task/workflow horizons (F10).** No new `knowledge.horizon_read`
   event kind; `queryKnowledge`/`queryKnowledgeEdges` (:12795-12826) already append nothing — they
   are plain filters over in-memory maps. Project-horizon reads keep the existing evented
   `knowledge.read` (`recallKnowledgeBounded` :12965, event kind handling :7798-7811) **only**
   where recall assessment consumes them (`_knowledgeReads` feeds contradiction/contamination
   scans :3138, :3177, :3413, :6906-6922, :12772-12786) — a horizon projection built from
   `queryKnowledge` never appends to `_knowledgeReads` and is therefore invisible to recall
   assessment by construction, exactly as KG-3's `recallPreview` will be (named, not built here).

## Part B — KG-2 rule 5: task → workflow, board-close Finding

7. **Atomic with the close, not a separate step.** `_boardSuccessor` already batches a second
   event when a benign edit migrates a claim (`board.claim_migrated`, :12105-12108, via a second
   `this._append` call today). For `kind === 'board.item_closed'` specifically, the same call
   site is extended to build a **`_appendBatch`** (:1058-1116, `batchKind: null` — the same
   unrestricted-batch-kind path already used to co-append a knowledge edge with its contamination
   record, :12605-12611) of exactly two entries: `board.item_closed` itself, then a
   `knowledge.node_added` payload for the candidate Finding. Both entries are pushed and `_apply`n
   -ed in order (:1108-1113: push happens before `_apply`, so entry 2's evidence can reference
   entry 1's seq), so the Finding's evidence seq is knowable synchronously before the batch is
   built: `const closeSeq = this._events.length + 1;` (the same precomputation style as
   `invalidationEvent = this._events.length + 1` at :12607).
8. **Finding shape.** `id: \`finding:board-close:${itemId}:${itemVersion}\`` (deterministic per
   closed item-version — a board item version closes exactly once, so this can never collide;
   mirrors the `outcome:${task.id}:${verifyEvent.seq}` naming precedent, coordinator.mjs:5561,
   :10253), `type: 'Finding'`, `grounding: 'observed'` (candidate-tier, the lowest grounding that
   still round-trips `_validateKnowledgeNodePayload` without requiring evidence — :12258 only
   gates `verified` Findings), `evidence: [{ coordinationSeq: closeSeq }]`,
   `promotion: { kind: 'Finding', trigger: 'board.item_closed' }`, plus a non-reserved
   `boardItemRef: { itemId, itemVersion, itemDigest }` field carrying the exact triple the closed
   item's own `board.item_closed` payload carries (:12100-12102) — `boardItemRef` is not in
   `KNOWLEDGE_PROJECTION_FIELDS` (:121) so `_knowledgePayload`'s reserved-field guard (:12216)
   accepts it untouched. Board items are never edge endpoints and never become nodes themselves
   (R34-7b) — the triple is data carried *on* the Finding, not a graph reference to the item.
9. **No gate here.** Every board-item close mints its candidate Finding unconditionally — this is
   the "no evidence required at admission" language in docs/34 rule 5; the settle-time gate
   (Part D) is a separate, later, explicit step over these candidates, never bypassed by this one.

## Part C — KG-2 rule 6: package citation, Source-node bridge

10. **One Source node per unique wrapped-cell content digest, idempotent.** A context package
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
    (!this._knowledgeNodes.has(sourceNode.id)) this._setKnowledgeNode(...)`, :7518) — done here
    at the wrapper layer instead, since `admitContextPackage` needs the result *before* deciding
    what to batch, not inside the fold.
11. **Source node shape.** `type: 'Source'`, `grounding: 'observed'` (an unreviewed content
    citation — matches the `ProviderDelivery` Source grounding convention, :7279, not the
    `verified` tier reserved for oracle/official-attested sources, :7232/:7257),
    `evidence: [{ coordinationSeq: admitSeq }]`, `promotion: { kind: 'Source', trigger:
    'package.wrapped_cell' }`, `cellDigest: valueRef.valueDigest`, `runId: normalized.provenance
    .runId` (nullable — `ContextPackage.provenance` carries `{ runId, principalId }`, no `repoId`
    field at all, :8706-8756, so package-derived Source/Finding nodes are `runId`-scoped, not
    `repoId`-scoped; the settle-time gate in Part D is where `repoId` re-enters, resolved from the
    run record, not the package).
12. **Package Finding + DerivedFrom bridge.** One Finding per package admission,
    `id: \`finding:package:${packageDigest}\``, `grounding: 'observed'`,
    `evidence: [{ coordinationSeq: admitSeq }]`,
    `promotion: { kind: 'Finding', trigger: 'package.admitted' }`. For every unique wrapped-cell
    Source node (whether freshly minted this call or already present from a prior package), one
    `DerivedFrom` edge `{ id: \`knowledge-edge:derivedfrom:${findingId}:${sourceId}\`, from:
    findingId, to: sourceId, evidence: [{ coordinationSeq: admitSeq }] }` — edge endpoints must
    already exist (:12276-12277), which the check-before-write in rule 10 guarantees (the Source
    node entry, if new, precedes the edge entry in the same batch and is applied first,
    :1108-1113). Branches without a `valueRef` (a bare `source`/`artifact` ref) mint no Source
    node and get no edge — only wrapped cells are bridged (R34-7b's premise: cells, like board
    items, are not nodes; Source is the *only* bridge type for them). `admitContextPackage`
    becomes a single `_appendBatch` of `package.admitted` + 0..N new Source nodes + 1 Finding + N
    DerivedFrom edges, all-or-nothing.

## Part D — KG-2 rule 7: workflow → project, the settle-time orchestrator-admit gate

13. **New event kind, new dedicated derive/validate pair — not a reuse of
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
14. **Candidate eligibility, checked in `_deriveWorkflowAdmission`.** The candidate
    (`queryKnowledge({ ids: [candidateFindingId] })`, :12795-12813) must: exist; have `type:
    'Finding'`, `grounding: 'observed'`; have `promotion.trigger` in `{ 'board.item_closed',
    'package.admitted' }` (Part B/C's two candidate sources); and have **no existing** `DerivedFrom`
    edge whose `from` node has `promotion.trigger === 'workflow.admitted'` and `to ===
    candidateFindingId` (i.e., not already promoted — checked via `queryKnowledgeEdges({ types:
    ['DerivedFrom'] })`, :12815-12826, filtered in the wrapper). Any failure is a typed refusal
    (`workflow_admit_ineligible`), never a silent skip.
15. **Authority: two independent checks, both store-enforced, no free-string actor (R34-10i).**
    (a) `promotionActor(auth?.actor)` (:245) — only `'orchestrator'` or `'operator:<id>'`, the same
    guard `promoteKnowledgeBatch` already enforces (:12373); a caller passing any other actor
    string is refused at the store, not merely discouraged at a wrapper. (b) An active
    **run-orchestrator lease** bound into the request — `{ lease: { id, digest, issuedEvent } }` —
    validated against `this._runOrchestratorLeases` exactly as `_validateRunLineageAdmission`
    already does for child-run admission (:1415-1417: lease must exist, `status === 'active'`,
    digest and `issuedEvent` match). This is stricter than the board wrapper-bound-actor pattern
    (`opts.actor ?? 'orchestrator'`, coordinator.mjs:9139-9143) — board authority trusts the
    Coordinator wrapper's default; KG promotion to the *persistent* horizon requires the same
    lease record run-lineage admission requires, because unlike a board (ephemeral, one run) a
    promoted Finding outlives the run. The coordinator-level entry point accepts no `opts.actor`
    parameter at all for this call — mirroring the hardcoded `actor: 'policy'` precedent at
    coordinator.mjs:5574/:10258, but hardcoded to `'orchestrator'` (or the deployment's
    `operator:<id>` where an operator, not the automated orchestrator, is settling the run).
16. **Admitted Finding + edge, one atomic event.** `_deriveWorkflowAdmission` builds: an admitted
    Finding (`id: \`finding:workflow-admitted:${candidateFindingId}\``, `type: 'Finding'`,
    `grounding: 'verified'` — an explicit orchestrator/operator attestation, matching the existing
    convention that oracle/reviewer confirmation raises grounding to `verified`,
    coordination-store.mjs:12511 — which requires non-empty evidence, :12258; evidence carries
    forward the candidate's own evidence plus `{ coordinationSeq: admitSeq }`,
    `promotion: { kind: 'Finding', trigger: 'workflow.admitted' }`, `repoId` (resolved by the
    coordinator wrapper from the run record, since neither board items nor packages carry
    `repoId`, rule 11), `runId`) and one `DerivedFrom` edge from the admitted Finding to the
    candidate (never `Supersedes` — the candidate is not invalidated; it remains the replay-exact
    historical record of what the run observed, per rule 14's non-promotion check reading it
    forward). `requestDigest`/`projectionDigest`/`receiptDigest` and the idempotency-by-auth-key
    replay path follow `correctScratchKnowledge`'s shape exactly (:12545-12553): a retry with the
    same `auth.key` and an unchanged candidate replays the identical event; a retry after the
    candidate diverged is a `causal_correction`-style conflict refusal, renamed for this event
    (`workflow_admit_conflict`).
17. **No silent auto-promotion (docs/34 §5).** Rules 7-12 (Parts B/C) run unconditionally and
    automatically on board-close/package-admit — that is intentional and does not violate this
    non-goal, because those candidates land at `grounding: 'observed'`, the same low-trust tier
    scratch facts start at, and are inert until Part D's explicit, lease-gated step. The existing
    verified-outcome auto-promotion (`promoteKnowledgeNode` calls at :5560-5574, :10252-10258,
    `grounding: 'verified'` for accepted task outcomes) and the scratch→KG policy
    (`promoteKnowledgeBatch`/`minScratchReaders`) are untouched — they are a **different**,
    already-settled promotion path with its own authority and candidate derivation, not
    superseded or merged with the new `knowledge.workflow_admitted` kind.

## Part E — red tests first (`impl/test/kg12-decisions-red.test.mjs`)

KG-1: a task-horizon projection cache hits when `(boardFence, bindingFence, interactionGeneration)`
is unchanged and misses on any single component changing (board post, binding rebind, or a new
question/approval/decision ask/resolve/reject on that task, independently); a workflow-horizon
projection's fence is the union across every board+binding scope attached to the run plus
`decisionSettleCount`, and an approval/question resolve does *not* bump it while a decision settle
does; a project-horizon projection recomputes exactly when `_events.length` advances and never
otherwise; no horizon read of any kind appends an event (`_knowledgeReads` length is unchanged
across all three). KG-2/Part B: closing a board item mints exactly one `Finding` with
`grounding: 'observed'`, evidence pointing at the close event's own seq, and a `boardItemRef`
triple matching the closed item's `(itemId, itemVersion, itemDigest)`; closing twice (idempotency
replay) mints no duplicate; the Finding id never collides across two different items or two
versions of the same item. KG-2/Part C: admitting a package with N branches wrapping M unique
cells (M ≤ N) mints exactly M Source nodes and exactly M `DerivedFrom` edges from one package
Finding; re-wrapping an already-cited cell in a second package mints zero additional Source nodes
and reuses the existing one; a branch with no `valueRef` produces no Source node and no edge.
KG-2/Part D: `admitWorkflowFinding` refuses a non-`observed` or already-promoted candidate
(`workflow_admit_ineligible`); refuses any actor that is not `'orchestrator'`/`operator:<id>`
(`promotionActor`, R34-10i) even when passed explicitly; refuses an inactive, revoked, or
digest-mismatched run-orchestrator lease; on success mints one `verified` Finding plus one
`DerivedFrom` edge to the untouched (not superseded, not invalidated) candidate, atomically; a
verified-outcome auto-promotion (:5560-5574/:10252-10258) proceeds unaffected by any of the above
and never requires a lease.

## Part F — boundaries

No new store, no SQLite/FTS, no second graph — three horizons are three filtered views over the
one Cairn KG plus board/package/binding state. No new event kind for KG-1 (pure re-derivation);
exactly one new event kind for KG-2, `knowledge.workflow_admitted`, structurally identical to the
existing `knowledge.promotion_batch`/`knowledge.scratch_corrected` node/edge-batch fold. No
mutation of `_validateKnowledgeNodePayload`/`_validateKnowledgeEdgePayload`/
`_deriveKnowledgePromotion`/`_deriveScratchCorrection` — every rule here is additive. Board items
and cells never become KG nodes and never become edge endpoints (R34-7b) — Source nodes and
`boardItemRef`/`cellDigest` fields are the only bridges. No `Supersedes` at settle-time admission —
candidates are retained, not invalidated. No free-string actor reaches `addKnowledgeNode`/
`promoteKnowledgeNode`/`addKnowledgeEdge`/the new admission path for orchestrator-authority
writes — every one of them is either hardcoded (`'policy'`, existing; `'orchestrator'`/
`operator:<id>`, new) or `promotionActor`-gated at the store. No git commits, no scratch/log
writes anywhere (including /tmp). KG-3 (`recallPreview`, briefing injection, decision-time
surfacing) and KG-4 (auto-link, MAD confidence, staleness) are out of scope for this contract.

## Part G — validation

Focused suite green, then the full suite `node impl/scripts/run-suite.mjs` green from the worktree
root; the wave-driver reviewer contract (`node --test impl/test/wave-driver-red.test.mjs`, exit 0)
stays green.
