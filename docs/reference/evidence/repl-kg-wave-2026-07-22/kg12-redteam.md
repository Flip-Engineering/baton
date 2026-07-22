# Red-team report: kg12-decisions.md (v1) — verdict: NEEDS REVISION

Every finding MUST be resolved in v2 or explicitly rebutted with file:line code evidence.
(Note: the contract's own line citations are accurate; the actual validator block is
coordination-store.mjs:12211-12292. Baseline mechanics verified: an `observed` Finding with
`{coordinationSeq}` evidence + boardItemRef/promotion extras passes
`_validateKnowledgeNodePayload` — :12258 gates only `verified`; causal_orphan is Decision-only
:12253-12256; extras accepted :12216/:121; Source-id scheme collides with nothing; replay
re-mints nothing.)

## P1-1 (must-fix) — union-fence under-covers its projection inputs (stale cache hits)

Task fence = (boardFence, bindingFence, interactionGeneration); workflow fence adds
decisionSettleCount. But projection inputs include queryKnowledge/queryKnowledgeEdges,
contextPackage(Attachments), and boardSnapshot's claims+reports (:12206-12207) — NONE of whose
writes advance any named fence: knowledge.node_added/promoted (incl. the existing
verified-outcome promotion coordinator.mjs:10252-10258 and ungated addKnowledgeNode :12561);
package.admitted/attached (:8814, :8830+); board.claim_requested/claim_expired/report_submitted
(explicitly non-bumping :7744, :7751-7755). An exact-tuple hit returns a STALE projection. The
KG-1 red tests only toggle named fence components — vacuous against this hole. FIX: add a
store-wide component to every horizon tuple (counts of knowledge.*/package.* events, or
_events.length), or contractually restrict projection inputs to fence-covered state; add a red
test that writes OUTSIDE the named fences and asserts a cache miss.

## P1-2 (must-fix) — Part D admitSeq undefined / self-referential

Parts B/C used the first batch entry's seq (a prior event). Part D is ONE event containing
nodes+edges; "evidence … plus { coordinationSeq: admitSeq }" reads as the event's own seq. If
the validator enforces per-node validation, that fails temporal_incoherence (:12235:
`ref.coordinationSeq >= eventSeq`); if it follows scratch_corrected's fold (payload digest
compare only, :7760-7763; nodes never re-validated :12510-12512), the self-reference sails
through and eventTime resolves the node's evidence to its own containing event — an invariant
violation. FIX: define the added ref as a strictly-prior seq (candidate's minting event or the
authorizing decision.settled seq), and state whether `_validateWorkflowAdmissionPayload` calls
`_validateKnowledgeNodePayload` per node.

## P2-3 — Part F actor boundary false for Parts B/C

B/C mint via `_appendBatch` entries carrying the caller's auth.actor; `_appendBatch` requires
only a non-empty string (:1069); addKnowledgeNode has no actor guard (:12561-12571); the
coordinator wrapper honors opts.actor override (:9142). FIX: reword the boundary text or
hardcode the batch entries' actor.

## P2-4 — prospective-seq trap

`_prepareKnowledgeNode` hardcodes `{ seq: this._events.length + 1 }` (:12577); reusing it with
validate=true for batch entry 2 makes `{ coordinationSeq: closeSeq }` fail :12235 at write
time. FIX: specify validate=false + manual validation at
`this._events.length + 1 + entryIndex` (apply-time validation at :7770 is the backstop).

## P2-5 — idempotency/replay edge cases

(a) Re-wrapping a cell whose Source was INVALIDATED: queryKnowledge filters validTo (:12809)
so check-before-write misses it, re-mint hits duplicate_node (:12251; live map retains
invalidated nodes) — unspecified. (b) "id never collides across two versions of the same item"
is half-vacuous: close is terminal (:12090). (c) Red test should assert a second close with a
DIFFERENT key refuses board_item_not_open, not just same-key replay.

## P2-6 — bindingFence doesn't exist yet

No repl.binding_set/bindingFence in the store (grep: zero). Rules 2-3 and the binding-rebind
red test depend on the REPL-2 contract landing first. FIX: state the sequencing explicitly.

## P2-7 — lease gate is consistency, not auth

promotionActor('orchestrator') passes for any caller; the lease triple is ledger-public. Fine
under single-writer (_assertWriterLease :1059), but rule 15 overstates it. FIX: reword;
specify admission ordering vs revokeRunOrchestratorLease (:1458) at run settle.

Verdict mechanics that ARE sound (keep): Parts B/C batch mechanics, idempotent minting,
replay duplication, eligibility/lease checks as specified.
