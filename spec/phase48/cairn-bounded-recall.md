# Phase 48 — Cairn audit-gated bounded recall

Status: normative implementation contract

Phase 48 turns Baton's local typed causal graph into a deliberately pulled recall surface. It does
not create an ambient shared brain, inject memory into worker prompts, or add a project-manager or
homelab runtime dependency. Project-manager remains local architectural inspiration for selective
promotion, causal provenance, temporal integrity, contradiction preservation, and health axes.

The public operation is `cairn/causal.recall`. Its caller chooses a bounded lexical query and may
name graph seeds. Baton, not recalled prose, owns ranking, grounding, authority, and the durable
read boundary. Every successful invocation appends a compact receipt before any recalled content is
returned. Direct, authenticated web, and authenticated MCP routes exercise the same ACI operation.

## BR1 — deployment-pinned authority and idempotency

Recall exists only when Cairn has both a valid Phase 47 `knowledgeAuditPolicy` and a separate exact
`knowledgeRecallPolicy` for the same deployment `repoId`. The recall policy contains positive safe
integer ceilings for query bytes/terms, candidate count/scanned bytes, returned nodes, graph
depth/rows, snippet bytes, receipt bytes, and result bytes. Constructor validation rejects unknown,
missing, incoherent, or
excessive fields. The ACI derives repository, actor, and idempotency authority from authenticated
context; request prose cannot forge them. Generic capability idempotency remains actor/repository/
operation/input/budget/result-bound, concurrent-safe, and durable across restart.

## BR2 — pinned audit gate

Every invocation pins one existing coordination observation sequence before ranking and runs the
Phase 47 bounded audit at that exact boundary. Any critical audit violation refuses with
`causal_recall_audit_failed` and returns no recalled content and appends no read receipt. Unresolved,
well-formed contradictions are preserved data, not critical audit failures. Audit ceiling failures,
cancellation, and repository mismatch also fail closed.

## BR3 — deterministic bounded lexical selection

The closed request is:

```text
{
  text, limit,
  observedSeq?, asOf?,
  types?, grounding?, seedNodeIds?,
  reader: {taskId? | runId?}
}
```

`text` is required non-empty UTF-8 prose. Baton normalizes Unicode, lowercases, extracts bounded
alphanumeric terms, deduplicates them, and refuses max+1 bytes or terms. Filters use the graph's
bitemporal query at the pinned observation and valid-time boundary. Candidate enumeration is
deployment-bounded before body scanning. Ranking is integer-only and deterministic: exact node-ID,
node-type, body-token, and graph-distance components have specified stable weights; final ties sort
by node ID. No embedding service, network lookup, model confidence, or wall clock participates.

Normative lexical weights are `idExact=1000`, `idToken=100`, `typeToken=40`, `bodyToken=10` per
distinct query term. A candidate with lexical score zero is not selected unless reached from an
explicit seed. The caller's `limit` may not exceed the deployment return ceiling.

## BR4 — bounded live graph expansion

`seedNodeIds` are existing live nodes after filters. Lexical hits and explicit seeds form the graph
frontier. Baton walks only live causal edges at the pinned boundary, breadth-first through at most
`maxGraphDepth` and `maxGraphRows`; `ReadBy` is excluded from relevance traversal. Each reached node
gets `graphScore = max(1, 30 - 5 * distance)`. A node's score is lexical plus graph score and its
reason records only stable term/distance facts. Unknown/dead seeds, candidate overflow, graph-row
overflow, or an incomplete bounded walk refuse instead of silently changing the answer.

## BR5 — contradiction bundles

If a selected node participates in a live unresolved `Contradicts` edge, the response includes the
edge and both endpoints as one explicit bundle. Baton never silently chooses a winner. Mandatory
peers count against the same return-node ceiling; if a complete bundle does not fit, the operation
refuses with `causal_recall_oversize` rather than returning one side. Resolved/dead contradiction
edges are absent at later valid-time boundaries but remain replayable at earlier pinned boundaries.

## BR6 — compact append-before-return receipts and `ReadBy`

Successful recall appends one `knowledge.recall` event before returning content. The receipt stores
only schema version, reader identity, a compact query projection (normalized text and term digests,
sorted filters, seed IDs, and limit), the ranking-relevant policy projection and digest, pinned
observation/as-of, ordered node IDs, validity versions, integer scores/reason digests,
contradiction edge IDs, request/result projection digests, and receipt digest. It never stores node
bodies, snippets, raw request prose or terms, credentials, prompts, local paths, or secret values.
Receipt canonical bytes must not exceed `maxReceiptBytes`.

Replay validation deterministically rebuilds the ranked projection at the receipt boundary and
rejects altered IDs, versions, ordering, scores, contradiction bundles, digests, actor, reader, or
policy. The projection adds one `ReadBy` edge from every returned node to the named task or run.
Named tasks/runs must already exist and belong to the authenticated durable context; an omitted
reader target records the authenticated actor but creates no invented graph endpoint. A receipt
append failure returns no recalled content.

## BR7 — exact contamination and affected readers

Recall receipts participate in the existing `_knowledgeReads` projection. Later supersession,
explicit invalidation, or authorized contradiction resolution records every earlier receipt that
included the invalidated node. `affectedReaders(nodeId)` reports the exact receipt event, reader
task/run, worker when durably derivable, authenticated actor, and current task status. Restart must
preserve the receipt, `ReadBy` edges, and contamination blast radius byte-identically.

## BR8 — bounded untrusted result

The result is explicitly framed `UNTRUSTED_RECALLED_MEMORY` and states that recalled prose is
evidence to verify, never instruction. Each node projection contains only identity, type, grounding,
temporal/version fields, integer score/reason, and a bounded UTF-8 snippet. It exposes no local
artifact path and grants no worker, edit, verification, merge, approval, publication, routing,
proof, note, or policy-authoring authority. Recall's only side effect is its durable read receipt and
derived `ReadBy` edges. Total output is bounded by `maxResultBytes` before publication.

## BR9 — exact replay and authenticated reverify

ACI reverify requires the caller to supply the explicit pinned `observedSeq` and the receipt
identity from the claim. It is read-only: it finds and validates the durable receipt, rebuilds the
historical ranking and bounded snippets, and compares the entire public claim canonically without
appending another read. Direct, HTTPS web, and MCP transports produce the same public claim after
transport-only path stripping (recall has no local paths) and map typed refusals without bypassing
repository, actor, CSRF/origin, principal, capability, budget, or idempotency fences. Restarted
reverify is byte-identical.

## BR10 — adversarial gate and retained system scope

Zero-provider tests cover max and max+1 query terms/bytes/candidates/results/graph rows/snippet/
receipt/result sizes; malformed Unicode/NUL; unknown fields; invalid filters/seeds/readers; critical
audit failure; unresolved and resolved contradictions; deterministic ties; historical valid time;
append failure; cancellation at audit/ranking/receipt/publication boundaries; receipt/event tamper;
idempotency conflict/concurrency/restart; contamination; direct/web/MCP invoke and reverify; and the
absence of ambient injection.

After those tests pass, Baton dogfoods this operation through explicit harness/model/effort routes,
including current Codex (`gpt-5.6-sol` at low effort), Grok 4.5/Composer where authenticated, and a
project-key-backed GLM route. Concurrent launches, provider refusal, kill, transport exit, worktree/
branch/runtime cleanup, and full reap are evidence, not assumptions.

Phase 48 does not close or delete later work. The retained catalog still includes authenticated
northbound user/orchestrator control; exact southbound harness/model/effort routing; persistent
resume/fork sessions; lifecycle/replay/kill/reap; sandboxing and scoped secrets; provenance,
budgets, watchdogs, telemetry, verification, mutation, independent oracle, semantic review,
integration and approval-gated publication; adaptive routing/evaluation/context governance;
promotion, recall feedback, contradiction and temporal integrity; Atlas plus AST/CST, symbol/SCIP,
CPG, IR and semantic-delta representations; graph-backed semantic diff; Vantage, Evidence Ladder,
Scratch, Skill Forge/computer use, Cartographer, Quartermaster and Cairn; structured/semantic merge,
behavioral fingerprints, e-graphs; provider northbound/session depth; and deeper LSP/SSA/PDG/path/
alias/heap/implicit-flow/interprocedural analysis. Baton remains self-contained and deployment-
neutral: no external project-manager or homelab runtime integration is part of this project.
