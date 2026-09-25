# Phase 50 Cairn Scratch correction and independent-oracle release — 2026-07-13

## Decision

Phase 49 deliberately quarantines `grounding:'derived'` Scratch facts and does not correct an
observed Scratch Finding after its source is withdrawn or replaced. That is the safe initial
ceiling, not the finished knowledge lifecycle. Phase 50 adds two connected but separately
authorized surfaces:

1. a task-plane `scratch_oracle` command that lets the orchestrator select an explicit agent
   harness, exact model, and model effort for a worker reviewing one immutable derived Scratch
   fact; and
2. the Cairn `causal.correct_scratch` operation, which audit-gates and atomically releases,
   supersedes, or retracts only the closed class of Scratch-derived Findings.

The oracle worker never mutates the graph. Its accepted, hub-reverified artifact is evidence that
an operator may select for a later deterministic correction. Re-running the original derivation,
using the same harness family, or trusting worker prose does not raise grounding. Baton remains
self-contained and repository-local. Project-manager remains architectural inspiration for typed
causal structure only; Phase 50 adds no homelab or external project-manager runtime integration.

## Numbered contract

### SC1 — exact deployment authority

`scratchOraclePolicy` is immutable driver configuration with exactly `repoId`, `maxTargetBytes`,
`maxConstraints`, and `maxConstraintBytes`. All numeric values are positive safe integers with
implementation maxima, and `repoId` MUST equal the driver repository.

`knowledgeScratchCorrectionPolicy` is immutable Cairn configuration with exactly `repoId`,
`minScratchReaders`, `maxScanEvents`, `maxAffectedReads`, `maxEvidenceRefs`, `maxBatchBytes`, and
`maxResultBytes`. It requires the Phase 47 audit and Phase 49 promotion policies; all three
repositories and both `minScratchReaders` values MUST agree. Cairn advertises
`causal.correct_scratch` only when this full authority is configured.

Only `orchestrator` or `operator:*` may start an oracle or own a correction receipt.
Authenticated web and MCP users with `control` authority map to their existing transport-bound
operator actors. Caller-supplied actor, repository, transport, policy, source projection, graph
row, body, grounding, or evidence fields are forbidden.

### SC2 — immutable, bounded fact-bound oracle target

`Coordinator.spawnScratchOracle(scratchFactId, harness, opts)` and the authenticated web/MCP
`scratch_oracle` surfaces accept an active same-repository `grounding:'derived'` Scratch fact only.
The fact MUST name its producer task, and that task MUST have a durable resolved route tuple.
Scratch fact IDs are hub-derived content identifiers; a caller-supplied Scratch `id` is refused.

Baton snapshots the full fact assertion into the private worker Brief so the reviewer can test the
actual claim, but the snapshot is detached, immutable, and bounded by `maxTargetBytes`. Durable
review metadata and every public command result retain only:

`scratchFactId`, full-fact digest, source event sequence/digest, repository ID, environment digest,
producer task ID, producer harness, and producer model family.

The review Brief pins the full original fact, its commitment, and an implementation-authored
instruction to test the assertion against the immutable repository/tree coordinate rather than
trusting its author. Caller constraints are count- and byte-bounded. The caller cannot replace the
fact snapshot or commitment. Durable review metadata and `task.created.worktreeBaseSha` pin the
exact `fact.envRef.treeSha`; worktree creation uses that commit even if the repository's branch or
HEAD advances before dispatch. The oracle may exercise the fact in its isolated worker worktree,
but its result is evidence-only and is never an integrable task result.

### SC3 — independent exact route

The oracle harness MUST be explicit and known; `auto` is refused. The reviewer harness and model
family from its registered card MUST both differ from the producer harness and producer model
family in the durable source route tuple. A same-harness alias, same-family model, missing route,
or malformed route tuple is not independent.

The orchestrator-selected `model`, `effort`, and `modelPolicy` pass unchanged through
`spawnScratchOracle` to the normal `spawn` admission and route resolver. Requested, resolved, and
provider-observed route attribution remains the existing source of truth. Unsupported model or
effort refuses before worker allocation; Baton never silently substitutes one.

### SC4 — crash-stable review binding

`task.created` durably records the closed review metadata for both ordinary review tasks and
Scratch oracle tasks. Coordinator restart rehydrates it. A successful Scratch oracle produces an
accepted `application/vnd.baton.review+json` artifact whose review metadata exactly equals the
task's durable metadata and whose accepted provenance maps to a hub `verify.reverified` event. The
accepted artifact provenance MUST bind the exact oracle worker, task route, harness version, model,
effort, fact-tree base SHA, capture SHA, paired commit SHA, accepted verification, and review
metadata. The accepted operational verification source must itself name the exact oracle task and
run; same-worker evidence from another task is not substitutable. The capture commit may descend
from the immutable base because the oracle can write an evidence-only report, but its captured
`baseSha` MUST equal the fact tree. Producer and reviewer route commitments each cover the exact
six-field tuple of harness, harness version, model, effort, model family, and task class.

The review task, current unsuperseded accepted review and paired commit artifacts, full-fact digest,
source event, producer route, reviewer route, immutable tree, and pinned verification contract form
one fact-bound evidence chain. A generic review of the producer task, an artifact from another task,
a changed target digest, superseded/withdrawn artifact, rejected artifact, failed or cancelled
oracle task, worker report, or unaccepted verification is ineligible.

### SC5 — three closed correction actions

`causal.correct_scratch` accepts exactly one of:

1. `release`: `scratchFactId`, `oracleTaskId`, and optional `observedSeq`;
2. `supersede`: `targetNodeId`, `expectedValidityVersion`, `replacementScratchFactId`, optional
   `oracleTaskId`, and optional `observedSeq`; or
3. `retract`: `targetNodeId`, `expectedValidityVersion`, one closed reason code in
   `source_expired | oracle_withdrawn | operator_correction`, and optional `observedSeq`.

`release` is only for an active derived fact with a fact-bound independent oracle. `supersede`
accepts either a Phase-49-qualified observed replacement or a derived replacement with a
fact-bound independent oracle. `retract` adds no replacement and does not claim a competing fact.
Free-text rationale is not copied into the graph or receipt. Release is an explicit Phase 50
correction exception path; it does not widen or reuse Phase 49's promotion taxonomy.

### SC6 — closed target and replacement qualification

A correction target MUST be a live `Finding` created by a valid Phase 49 promotion batch with
trigger `scratch.cited_observed` or by a valid earlier Phase 50 receipt with trigger
`scratch.oracle_verified` or `scratch.corrected`. Its expected validity version is an exact CAS.
An unresolved contradiction involving the target blocks correction so contradiction authority is
not bypassed.

An observed replacement MUST be active, same-repository, and meet the exact Phase 49 distinct
completed-reader plus live verified-task-outcome policy at the pinned boundary. A derived
replacement MUST be active, same-repository, and have the exact eligible oracle task/artifact from
SC4 at or before that boundary. Expired, cross-repository, asserted, under-cited, stale-grounding,
unbound, same-family, or post-boundary evidence is excluded.

### SC7 — safe deterministic causal projection

The caller cannot nominate graph rows. Baton derives content-addressed IDs and fixed bodies from
the pinned evidence:

- the replacement/released Finding is `observed` for a qualified observed fact and `verified` for
  an independently-oracled derived fact;
- every Finding has a `DerivedFrom` edge to a metadata-only `ScratchFact` source;
- observed Findings have `VerifiedBy` edges to each counted verified task outcome;
- oracle-verified Findings have `VerifiedBy` edges to both the completed oracle Task and accepted
  review Artifact; and
- a superseding Finding has one `Supersedes` edge to the exact target.

Safe projections retain only closed IDs, digests, grounding, source/event coordinates, route
family commitments, validity versions, and evidence references. They never copy the Scratch value,
task Brief, commands, prompts, paths, URLs, secrets, worker prose, free-text reason, or provider
payload. Rows and evidence sort and deduplicate byte-for-byte deterministically.

### SC8 — pinned audit, atomic lifecycle, and contamination

The observation boundary defaults to the coordination tail at invocation start. Cairn reruns the
Phase 47 critical bounded audit at exactly that prefix before derivation. Audit failure, overflow,
repository mismatch, cancellation, or stale evidence refuses without mutation.

A success appends exactly one `knowledge.scratch_corrected` event. `release` atomically creates its
safe nodes and edges. `supersede` atomically creates its rows, adds `Supersedes`, invalidates the
target, and records the exact earlier knowledge-read events affected by that invalidation.
`retract` atomically invalidates the target and records those affected reads. Projection and replay
must never expose a partial correction. The event contains schema version, action, repository,
pinned boundary/time, exact policy and digest, request/evidence/projection/receipt digests, target
CAS when present, complete safe rows, and the bounded contamination projection.

Affected reads are exactly all earlier `knowledge.read` events at or before the pinned boundary
whose `nodeIds` include the target; exceeding `maxAffectedReads` refuses rather than truncates. The
event append is a CAS against the pinned prefix. Between the supplied/default boundary and that
append, only the exact non-semantic admission/evidence events `evidence.mapped`,
`web.command_admitted`, and `mcp.call_admitted` may intervene. Any task, Scratch, knowledge-read,
graph, lifecycle, or other event conflicts. Cancellation is checked again at the actual write
boundary; once the atomic append linearizes, a later abort cannot rewrite success as refusal.

### SC9 — replay, idempotency, and bounded refusal

Replay recomputes the historical request, source facts, reader/oracle qualification, target state,
rows, contamination, digests, and receipt against the earlier prefix. Any substitution or missing
evidence fails restart. The ACI idempotency key is request authority: same request returns the
historical result; actor/repository/action/target/version/replacement/oracle/boundary changes refuse.
Releasing the same fact twice, superseding a stale target, or reusing an already-invalidated target
is a deterministic conflict.

Derivation uses max+1 tests for scanned events, affected reads, evidence references, canonical
batch bytes, and public result bytes. There is no truncation. Cairn checks cancellation before and
after audit, after derivation, and immediately before append. `causal.correct_scratch` opts into ACI
preflight output so the exact bounded public result is checked before the event becomes durable.

### SC10 — bounded public result and exact reverify

The public result is a closed projection exposing only `action`, `repoId`, `observedSeq`, `eventSeq`,
`requestDigest`, `policyDigest`, `projectionDigest`, `receiptDigest`, `targetNodeId`,
`targetValidityVersion`, `replacementNodeId`, `replacementGrounding`, `oracleTaskId`, and
`affectedReadCount`; optional fields are absent rather than filled with private detail. It contains
no audit packet/time, private fact snapshot, Scratch value, Brief, route credentials, path, prompt,
or prose.

`reverify(claim,'causal.correct_scratch',args,ctx)` is read-only. It locates the receipt, reruns the
historical derivation, and compares the complete compact claim and authority. Tampering, omitted
fields, a different transport actor, repository, action, boundary, target, version, replacement,
oracle, policy, or receipt returns `{ok:false}` or a typed refusal without mutation.

### SC11 — authenticated task-plane parity

Web `scratch_oracle` and MCP `fleet_scratch_oracle` use the same coordinator method and admission
rules as direct orchestration. Their closed schemas expose `scratchFactId`, `harness`, `model`,
`effort`, `modelPolicy`, pinned verification, bounded budget/constraints, optional task/run IDs, and
no actor or credential fields. Durable web/MCP idempotency and authenticated replay semantics are
unchanged. The returned worker handle proves requested route values; later normal fleet status and
result surfaces prove resolved/observed values and allow interrupt, kill, and full reap.

Direct, authenticated web, and authenticated MCP `causal.correct_scratch` invocation and reverify
continue through the ACI capability plane. Transport actor normalization occurs only from trusted
northbound context and cannot be forged by direct callers. Web/MCP receive token-bound capability
methods from the northbound authority; a direct caller-supplied `ctx.transport` is refused rather
than trusted.

### SC12 — proof and retained full-system scope

Red-to-green proof covers exact configuration; private-target bounds; route tuple corruption;
explicit harness/model/effort selection; same-harness and same-family refusal; restart review
binding; accepted/rejected/failed/unbound oracle evidence; observed release refusal; derived
release; observed and oracle supersession; retraction; target CAS/contradiction conflicts;
post-boundary exclusion; safe non-disclosure; deterministic rows; duplicate release; max+1
ceilings; append failure; cancellation; replay tampering; ACI preflight; and direct/web/MCP task and
capability routes. Canonical `npm test` MUST pass.

Recursive proof uses Baton itself against clean commits. It requests exact harness/model/effort
routes including project-key GLM and `gpt-5.6-sol`, attempts multiple Grok routes concurrently,
records current authentication truth rather than inferring success, and retains explicit native
PID, worker, worktree, branch, runtime-scope, writer, kill, and reap evidence. It also advances a
fixture repository after fact creation to prove the oracle still dispatches and verifies from the
fact's immutable tree.

Phase 50 does not claim Playbook/Skill promotion, recall feedback/utility learning, contradiction
operator UX, retention/compaction/deployment-neutral export, Bench, or the remaining control,
session, representation, and capability plan. AST/CST, SCIP/symbol graph, CPG, IR, semantic delta,
Vantage, Evidence Ladder, Scratch/Bench, Skill Forge, Cartographer/Quartermaster, semantic merge,
behavioral fingerprints, and the e-graph research bet remain explicitly retained. There is no
homelab integration target.

## Red tests

1. Direct, web, and MCP oracle commands bind the exact fact while preserving selected harness,
   model, and effort; same-harness/family and oversized targets refuse before allocation.
2. A completed accepted independent oracle releases one derived fact into the exact safe graph;
   generic, failed, rejected, mismatched, superseded, borrowed same-worker, post-boundary, or
   same-family reviews do not.
3. Qualified observed and independently-oracled replacements atomically supersede a target;
   retraction atomically invalidates it; both retain exact bounded contamination.
4. Seeded Scratch values, secrets, paths, prompts, Briefs, reasons, and provider payloads appear in
   neither correction events nor public results.
5. Restart rehydrates review metadata and recomputes exact correction projections; event, route,
   target, artifact, digest, contamination, and claim tampering fail closed.
6. One-over scan/read/evidence/batch/result ceilings, audit failure, cancellation at every
   checkpoint, stale CAS, duplicate release, contradiction conflict, and append failure leave the
   tail and graph unchanged.
7. Direct, authenticated web, and authenticated MCP correction claims match and exact read-only
   reverify succeeds; actor, transport, repository, action, args, boundary, and receipt changes fail.
8. Advancing repository HEAD after the fact is recorded cannot change the oracle worktree or
   verification base: both remain the exact immutable `fact.envRef.treeSha`.

## Acceptance gate

Phase 50 closes only when SC1–SC12 are implemented and wired, focused and canonical suites are
green, adversarial findings are dispositioned, recursive Baton evidence is retained, every owned
worker/resource is reaped, secrets are absent from Git/evidence, and the capability/status
catalogues retain every later feature named above.
