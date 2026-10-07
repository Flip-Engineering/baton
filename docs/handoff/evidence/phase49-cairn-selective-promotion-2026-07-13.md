# Phase 49 Cairn audit-gated selective promotion — 2026-07-13

## Shipped checkpoint

Phase 49 gives Baton a bounded, self-contained bridge from durable coordination history into the
typed causal graph without putting the knowledge plane on a control or safety path.
`cairn/causal.promote` pins one coordination prefix, reruns the Phase 47 critical audit, and derives
candidates without accepting caller-nominated sources, nodes, edges, bodies, or grounding.

The closed source taxonomy promotes:

- operator/orchestrator task creation and selected stop, follow-up, and publication decisions as
  observed `Decision` nodes with `Informed` Task edges;
- policy-authored integration, publication, and recovery failure observations as
  `Counterexample` nodes with `ObservedIn` Task edges; and
- active same-repository observed Scratch only after the configured number of distinct completed
  tasks read it and each task has a live verified-grounding `verified_task_outcome` Finding with a
  live `VerifiedBy` Task edge. The result is an observed `Finding` with metadata-only
  `ScratchFact` lineage and exact `VerifiedBy` outcome edges.

Derived, expired, cross-repository, under-cited, stale-grounding, worker-forged failure, arbitrary
driver, and already-promoted sources remain quarantined. Policy-authored events cannot become
positive Decisions. Fixed implementation-authored bodies and closed identifiers/digests omit task
briefs, Scratch values, prompts, reasons, commands, paths, URLs, credentials, and provider payloads.

One non-empty invocation appends exactly one replay-validated `knowledge.promotion_batch` and
materializes every node and edge atomically. Scan, candidate, candidate-byte, evidence, batch, and
result ceilings fail all-or-nothing. Zero candidates are read-only. Request identity binds actor,
repository, boundary, policy, and idempotency key; restart replay, conflict, no-op reverify, and
receipt reverify are exact. ACI envelope/payload preflight and cancellation run before any batch
effect. Direct, authenticated web, and authenticated MCP routes share the operation, while
transport-shaped actors normalize only when the trusted ACI transport matches.

## Red-to-green verification

- Phase 49 passes **8/8** grouped SP tests.
- The combined Phase 47–49 Cairn slice passes **33/33** tests.
- The canonical zero-quota suite passes **1024/1024** through `cd impl && npm test` after the final
  actor-binding hardening in `29a8bc2`.
- Mixed-prefix proof checks exact deterministic order, six materialized nodes and seven causal
  edges, safe durable/public projections, one-event atomicity, restart identity, duplicate
  suppression, no-op behavior, and exact reverify.
- Exclusion proof now explicitly invalidates one previously verified task outcome before promotion;
  both the dead Finding and its `VerifiedBy` edge are absent from the pinned live views, so the
  otherwise two-reader Scratch fact remains quarantined.
- Direct calls cannot smuggle `web:*` actors, and a web-shaped actor under trusted MCP transport is
  refused. Effectful authenticated web and MCP calls still produce durable
  `operator:web:alice:web` and `operator:mcp:bob:mcp` receipt owners and reverify successfully.
- Every configured ceiling, audit failure, cancellation checkpoint, append failure, ACI budget
  refusal, idempotency conflict, and receipt tamper leaves no partial promotion residue.
- `git diff --check` is clean. The user's unrelated `.gitignore` modification remains untouched.

## Recursive Baton evidence

The first concurrent exact-route attempt in
`docs/reference/evidence/phase49-spec-review-2026-07-13/attempt1-summary.json` correctly refused
both Codex and GLM before native PIDs because the user's main checkout was dirty. Both allocations
were already dead and every worktree, runtime, branch, process, and writer resource reaped. That
friction remains evidence rather than being hidden.

The clean-host retry in
`docs/reference/evidence/phase49-spec-review-2026-07-13/summary.json` routed exact Codex
`gpt-5.6-sol`/low to PID `12194` and project-key GLM `glm-4.7`/low to PID `12200`. Codex consumed
204,526 accounted tokens against its 180,000-token budget, so Baton cancelled it and accepted no
report. GLM consumed 81,251 tokens / $1.034766, completed, fresh-verified its report, received
confirmed kill, and fully reaped. Every allocation and ownership resource from both routes reaped.
The summary remains honestly red because only one report completed and the terminal windows did not
establish the intended overlap metric.

The first implementation review in
`docs/reference/evidence/phase49-postfix-glm-review-2026-07-13/summary.json` routed exact project-key
GLM `glm-4.7`/low to provider-observed PID `66402`, used 100,615 tokens / $0.917284, fresh-verified
the scoped report, received confirmed kill, and passed every process/worktree/runtime/branch/writer
reap check. The Baton run passed even though the report's independent verdict was `REVISE`; those
are deliberately separate facts.

The final adjudication retry is retained under
`docs/reference/evidence/phase49-final-glm-review-2026-07-13/`. Its first bootstrap attempt records
another useful refusal: projecting dependencies as a top-level `node_modules` symlink did not match
the repository's directory-only ignore rule, so Baton's dirty-worktree gate refused before a
provider PID and still fully reaped. The clean retry used an ignored real directory containing
projected dependency entries, reviewed committed hardening `7127b6b`, and routed exact
`glm-4.7`/low to provider-observed PID `46906`. It consumed 117,137 tokens / $1.1172,
fresh-verified the scoped report, received confirmed kill, and passed every process/worktree/
runtime/branch/writer-release check. The report headline says `PASS`, but its purported P0/P1s were
still adjudicated independently rather than accepted by label.

## Review dispositions and retained scope

The implementation report's P0 is false. `_deriveKnowledgePromotion()` obtains
`nodesAtBoundary` and `edgesAtBoundary` from `queryKnowledge({observedSeq})` and
`queryKnowledgeEdges({observedSeq})`; both functions filter `validTo` against the pinned effective
time before returning rows. An invalidated verified outcome or edge therefore cannot enter the
map. The explicit stale-grounding regression now locks that behavior.

The actor-prefix finding also overstates the store boundary: SP1/SP3 intentionally authorize the
closed `operator:*` class, and `recordDriver()` is a coordinator-owned internal append surface.
However, the related transport-smuggling possibility was useful defense in depth. Commit
`29a8bc2` now requires trusted `ctx.transport === 'web'|'mcp'` to match the actor prefix before
normalizing it.

`sourceDigest` is a one-way closed commitment explicitly allowed by SP4, not serialized source
content. The cancellation path has no async yield between its final context check, synchronous
preflight/validation, and append. No-op writes already run explicit ACI sizing, while all read-only
reverify results remain subject to the registry's generic result validation. The requested
cross-repository, derived-Scratch, ceiling, tamper, and transport cases were already covered; the
stale-outcome and transport-binding cases became new regressions.

The final report's transport-forgery sequence cannot cross the authenticated web boundary:
`capability_invoke` rejects a top-level `actor`, an `actor` nested in operation arguments is never
used as context and is rejected by the closed causal-argument schema, and `WebNorthbound` constructs
`capabilityCtx.actor` from the authenticated principal instead of the request. Commit `593d1f8`
nevertheless rejects any internal ACI context whose trusted `web`/`mcp`
transport is paired with `orchestrator`, `operator:*`, or the wrong transport prefix. Its boundary
race also does not reproduce: `_deriveKnowledgePromotion()` always scans
`this._events.slice(0, observedSeq)`, while `beforeEventSeq` is used only for validation and occupied
namespace checks. An injected post-audit append now proves the promotion contains only sources at
or below the pinned boundary. Finally, `_preflightPromotionResult()` explicitly sizes both the ACI
envelope and payload before `promoteKnowledgeBatch()` appends; the report quoted that check and then
claimed it was absent. Budget refusal already proves the pre-effect path, and Phase 48 independently
proves the same closed ACI envelope gate. No final P0/P1 remains.

Phase 49 does not complete Cairn or the full goal. Correction/supersession of promoted Scratch,
independent-oracle release for derived Scratch, Playbook/Skill promotion, recall feedback and
utility learning, authenticated contradiction/operator UX, retention/compaction, deployment-
neutral export, and Scratch REPL/Bench remain active. Provider-backed session recovery and deeper
fork/rewind/checkpoint semantics; quota/seat governance; Vantage, Evidence Ladder, Skill Forge/
computer use; deeper live LSP/SSA/PDG/path/alias/heap/implicit-flow/interprocedural analysis;
semantic merge/fingerprints; and conditional e-graph research remain catalogued. Baton stays
self-contained: project-manager is local causal-graph inspiration only, and homelab integration is
explicitly excluded.
