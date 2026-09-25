# Phase 53 — Cairn authenticated contradiction workspace

Phase 47 made contradiction creation and resolution mechanically sound inside the coordination
store, but it left the only resolution call on that internal object. Phase 48 could surface a
contradiction only as a side effect of lexical recall. A human or orchestrator therefore had no
bounded, repository-authorized way to enumerate the open decision set and resolve one through
Baton's public capability plane.

Phase 53 closes that operator seam with two Cairn operations:
`cairn/causal.contradictions` and `cairn/causal.resolve_contradiction`. It does not add an external
project-manager, homelab, graph service, or parallel web state machine.

## CX1 — deployment-pinned operations and policy

Both operations exist only when Cairn has the Phase 47 audit policy plus one exact contradiction
policy for the same `repoId`. The contradiction policy independently caps coordination events
scanned, graph edges scanned, page items, UTF-8 snippet bytes, evidence references, affected prior
reads, resolution-reason bytes, durable batch bytes, and public result bytes. Configuration is
closed and bounded.

`causal.contradictions` is deterministic and read-only.
`causal.resolve_contradiction` is deterministic, reverifiable, and explicitly opts into ACI output
preflight before its coordination effect. Neither operation receives worker, edit, verification,
merge, approval, publication, routing-mutation, proof, note, or policy-authoring authority.

## CX2 — bounded stable unresolved workspace

The list request has exactly `{observedSeq, afterEdgeId, limit}`. `afterEdgeId` is either `null` for
the first page or the exact ID of an unresolved edge in the same pinned view. `limit` cannot exceed
the deployment page ceiling. The operation reruns the critical graph audit at `observedSeq`; a
well-formed unresolved contradiction remains reportable rather than becoming a critical failure.

The store selects current unresolved `Contradicts` edges and both live endpoints at that
observation/valid-time boundary, sorted by canonical edge ID. The page reports total unresolved,
stable continuation, policy/projection digests, and a fixed safe item shape:

- edge ID, validity version, observation/event-time identity, and digested evidence;
- both endpoints in canonical ID order with ID, type, grounding, content digest, validity version,
  observation/event-time identity, bounded UTF-8 snippet, and digested evidence; and
- status `unresolved` plus an explicit untrusted-evidence frame.

It never emits full arbitrary node bodies, prompts, commands, provider payloads, credential values,
artifact paths, or prior-reader identities. Missing endpoints, malformed pair identity, partial
bundles, invalid continuation, or any independent ceiling fails closed rather than silently
omitting the other side.

## CX3 — explicit prefix-CAS resolution

The effectful request has exactly `{observedSeq, edgeId, winnerId, loserId,
expectedEdgeValidityVersion, expectedWinnerValidityVersion, expectedLoserValidityVersion, reason}`.
The caller—not a worker or policy—names both sides and supplies the exact versions exposed by the
workspace. The reason is non-empty valid Unicode, NUL-free, and byte-bounded.

Resolution requires the selected edge and endpoints to be the same current unresolved pair at the
pinned prefix and at append time. Only the existing transport admission/evidence bookkeeping rows
may follow the prefix; any intervening knowledge or other coordination mutation makes the request
stale. Reversed, mismatched, stale, dead, double, or same-node resolution refuses.

One schema-versioned `knowledge.contradiction_resolved` event binds repository, audited prefix,
policy, authenticated actor/idempotency identity, exact request, edge/node versions, reason,
affected-read set, projection, and receipt digests. Applying that one event closes the edge,
invalidates only the loser, and records every prior knowledge/recall reader of the loser at or
before the prefix. The winner remains live. Append failure or cancellation leaves edge, nodes,
contamination, and idempotency state unchanged when observed before the append commit point. Once
the append succeeds, commit wins: a signal raised at the write boundary cannot turn the committed
resolution into an ambiguous cancelled response, and Baton returns the durable receipt.

## CX4 — historical truth and contamination

Current list/recall/trace no longer returns the closed edge or invalid loser. A query pinned before
resolution still shows the unresolved pair, and reverifying its old list claim stays byte-exact.
The resolution cannot rewrite earlier node/edge versions or recall receipts. Audit contamination
counts the exact affected read events, including bounded recall receipts, without exposing reader
identity in the public resolution result.

The resolution result reports only safe winner/loser IDs and resulting validity versions, edge
version, affected-read count, prefix/event identity, and exact digests. It does not echo arbitrary
reason prose or affected reader IDs through the public capability response.

## CX5 — authenticated direct, HTTPS, and MCP authority

Direct calls accept only `orchestrator` or non-transport-forged `operator:*` actors. Authenticated
HTTPS and MCP derive the operator actor from the trusted transport principal; caller-supplied
`operator:web:*`, `operator:mcp:*`, mismatched transport tags, workers, and policy actors are
refused. Repository scope, idempotency key, budget, origin/session identity, and ACI result binding
remain those of the existing authenticated northbound rather than a new auth system.

Both operations invoke and reverify through direct ACI, authenticated HTTPS
`capability_invoke`, and authenticated MCP `fleet_capability_invoke`. The web/MCP transports see
only the same bounded result and never receive the internal store object.

## CX6 — exact idempotency, replay, and reverify

Same actor/key/request returns the original resolution. Same key with any changed repository,
prefix, policy, edge, winner/loser, version, or reason conflicts. Concurrent distinct keys may race,
but exactly one can resolve and the other sees stale/resolved state. Restart replay reconstructs
the edge, loser, history, contamination, and idempotency result byte-identically.

List reverify rebuilds the exact pinned page and compares the complete claim. Resolution reverify
locates the exact receipt event, rebuilds and validates its prefix-derived projection, binds the
authenticated actor plus original event idempotency identity, and compares the complete public
claim. Substitution of operation, status, summary, payload, refs, cost, provenance, policy,
versions, page cursor, snippets, counts, or digests fails.

## CX7 — audit, race, and publication gates

Both operations fail before output/effect when the Phase 47 critical audit fails. Resolution checks
cancellation after audit, before derivation, before publication, and at the append seam. After the
durable append, it returns the receipt even if cancellation becomes observable at that boundary.
Result/batch and ACI envelope/payload ceilings are computed before append; a max+1 refusal creates
no resolution or contamination. A preflight callback that changes coordination state is an
integrity failure, not authority to rebase silently.

## CX8 — executable adversarial matrix

Zero-provider tests cover configuration/card gating; empty, one-page, and multi-page listing;
stable ordering and continuation; safe UTF-8 snippets; unresolved bundles; historical list after
resolution; exact winner/loser/version CAS; worker/policy/forged-transport refusal; direct/web/MCP
invoke and reverify; same-key replay/conflict; concurrent race; restart/tamper; affected recall and
ordinary reads; append failure; cancellation at derivation and append seams; post-append commit-wins
receipt delivery; audit failure; and each independent max/max+1 policy and ACI output ceiling.

The focused Phase 47–53 Cairn gates and canonical `npm test` must pass before recursive dogfood.
Recursive Baton then requests exact Codex `gpt-5.6-sol`/low, project-key GLM `glm-4.7`/low, Grok
4.5/low, and Grok Build/low concurrently where provider authentication permits. Every attempt must
retain honest requested/resolved/observed route facts, fresh verification only for completed
reports, exact process close, explicit kill/reap evidence, and complete worktree/runtime/branch/
writer cleanup. Authentication or budget refusal remains red evidence rather than a fabricated
provider verdict.

## CX9 — retained scope

Phase 53 does not add automatic contradiction resolution, confidence mutation, worker voting,
learned recall weighting, Playbook/Skill promotion, Scratch Board/Bench, Goal/Plan authority,
retention/checkpoints, or deployment-neutral export. Those Cairn/Scratch rungs and the full
authenticated web runtime, persistent-session depth, trust/evaluation ladder, and
AST/CST/SCIP/CPG/IR/behavior/semantic-representation catalog remain in the goal. The shared graph
continues to be project-local architecture inspired by project-manager, never a homelab runtime
integration.
