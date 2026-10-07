# Phase 61 — graph-backed Representation production

Phase 61 turns three already-shipped, bounded Atlas outputs into first-class Cairn
`Representation` knowledge. It adds lineage and durable discovery; it does not widen the meaning,
precision, or authority of the underlying analysis. The producer runs only after Phase 60's native
recovery ordering is closed, so recursive representation work cannot inherit a pre-commit provider
effect seam.

## GR1 — one allowlisted producer and fixed rung mapping

Deployment may register one `AtlasRepresentationProducer`. Its source vocabulary is closed:

| Producer kind | Required capability and operation | Representation rung | Fixed representation type |
| --- | --- | --- | --- |
| `structural_delta` | `atlas-structural` / `diff.structural` | R1 | `ast_cst_structural_delta` |
| `symbol_snapshot` | `atlas-index` / `scip.export` | R2 | `scip_symbol_snapshot` |
| `cpg_semantic_delta` | `atlas-cpg-delta` / `cpg.delta` | R3 | `bounded_cpg_semantic_delta` |

The implementation owns this table. A caller selects only one producer kind and supplies the
logical arguments accepted by that mapped operation. It cannot name a different capability,
operation, rung, representation type, graph schema, producer version, or fallback. An unavailable
or differently carded source refuses typed before a source invocation.

## GR2 — trusted-context invoke and immediate reverify

The producer resolves the mapped capability through the deployment-owned ACI registry and invokes
it with the registry's trusted repository, artifact, budget, cancellation, and policy context. It
then immediately calls that same advertised operation's `reverify` over the exact returned claim.
The invoked card digest, operation, source arguments digest, complete result digest, artifact refs,
reverify snapshot, and reverify result digest must agree.

Only an `ok` result, or an honestly resumable result from a source which actually implements the
advertised resume contract, with a complete content-addressed source artifact can be produced.
Inline truncation is not artifact truncation, but `needs_resume` from a source such as the current
structural delta refuses until that source has an executable resume contract. Partial analysis,
any parse error, missing refs, multiple ambiguous primary refs, unsupported reverify, source drift,
cancellation, or any invoke/reverify disagreement refuses before knowledge mutation. Structural
and CPG select their unique mapped delta ref; SCIP selects the unique `scip_json` ref rather than
its wrapper-results ref. Source invoke and reverify must reload and schema/digest-check an existing
content-addressed file instead of trusting its filename, and reverify must return and bind that
exact primary-ref projection. A caller cannot inject trusted context, a prior claim, a reverify
result, artifact bytes, or capability-card metadata.

Nested source invoke and reverify use implementation-derived child idempotency keys distinct from
the outer producer call. The outer ACI identity cannot be reused for either child operation.

## GR3 — exact representation identity and bounded artifact projection

One representation identity is a canonical digest over:

```text
repoId, taskId, runId?, producer kind, fixed rung and type,
capability name/version/card digest, operation, source-arguments digest,
source artifact kind/digest/bytes, stable source-result projection digest,
reverify result digest, immutable environment/tree/overlay identity,
producer schema and policy digest
```

The stable source-result projection includes operation, status, complete payload, exact refs,
authority-bearing provenance, and deterministic source identity while excluding volatile measured
cost such as `wall_ms`. The full literal ACI envelope is not hashed as semantic identity merely
because two equivalent invocations took different time.

The producer writes one mode-0600, content-addressed representation receipt containing only this
closed metadata and fixed implementation-authored labels. It copies no source text, paths, prompts,
worker or provider prose, recalled text, credentials, environment values, arbitrary ACI payload, or
caller summary. Deployment supplies max argument, source-ref, evidence-ref, receipt, graph-batch,
and result byte/count ceilings. Every max+1 refuses the whole transaction; nothing is silently
truncated into a different representation identity.

## GR4 — one atomic Cairn lineage transaction

Successful production appends one replay-validated coordination event which atomically
materializes:

- one `Representation` node with fixed `grounding:'derived'`, rung, type, identity digest, source
  digest, environment identity, and fixed implementation-authored body;
- one `Artifact` node for the freshly reverified source analysis artifact, or exact-reuses its
  already-live content-addressed node;
- one `DerivedFrom` edge from the Representation to that source Artifact;
- one `ProducedBy` edge from that Artifact to the exact task which invoked production; and
- one `ObservedIn` edge from the Representation to that task.

The task must already exist and precede the transaction. An exactly reused Artifact must be live and
repository-identical; otherwise the transaction materializes it from the freshly reverified ACI
ref. Optional `runId` must exactly match the task's durable run membership. The transaction
registers source and receipt artifact manifests, reserved node/edge identities, evidence
coordinates, and temporal bounds together. Append loss exposes no node, edge, manifest, or positive
production result. Bytes left before a failed append are unowned authority and may be reconciled;
they are not a Representation.

## GR5 — grounding and authority are not caller fields

The producer always assigns `grounding:'derived'`. Immediate reverify proves the exact bounded
artifact and producer projection, not semantic truth, safety, verification acceptance, or proof;
therefore it never upgrades grounding to `observed` or `verified`. A caller cannot provide a body,
summary, prose, confidence, grounding, validity interval, evidence list, node or edge ID, or
promotion state.

The receipt and ACI result explicitly deny edit, worker-control, route, verification, merge,
approval, policy-authoring, integration, publication, deployment, and proof authority. R1 remains
structural syntax evidence, R2 remains a bounded SCIP-shaped symbol snapshot, and R3 remains the
shipped single-file lexical-binding-aware CPG delta and bounded impact reachability.

## GR6 — replay, reverify, and causal integrity

An exact retry returns the durable representation only when request, mapped card, environment,
task/run membership, source claim, reverify projection, policy, node/edge identities, and receipt
digest all match. Same-key or same-identity substitution conflicts. Concurrent equal production
coalesces at the append boundary; a changed source or environment creates a distinct identity and
cannot overwrite the prior valid-time record.

Producer `reverify` reloads the durable event and both artifact manifests, re-runs the mapped source
capability's reverify under current trusted context, reconstructs the fixed receipt and graph batch,
and compares every digest and causal endpoint. It does not upgrade grounding or mint new graph
state. Missing/tampered bytes, changed cards or policy, tree/overlay drift, causal-orphan endpoints,
future evidence, reserved-name squatting, or graph projection drift fails typed.

Environment identity is resolved by deployment authority, never from caller fields: structural and
CPG bind their before/after immutable tree and overlay identities; SCIP binds repository tree,
index epoch, and returned overlay digest. The producer must also reconcile a durable graph commit
after loss of the outer ACI completion write, so exact retry cannot remain permanently stuck behind
a stale pending registry record or repeat source/graph effects.

## GR7 — one direct/web/MCP authority path

`representation.produce` and its reverify action use the existing Coordinator-owned ACI registry.
Direct invocation, authenticated HTTPS `capability_invoke`, and MCP
`fleet_capability_invoke` receive the same card, schema, trusted context, task/repository scope,
idempotency, quota, cancellation, audit, and bounded result. Neither northbound receives a special
knowledge-write endpoint or may supply the authenticated actor.

Authorization is checked before source invocation. A cross-repository task, source artifact, run,
or idempotency record refuses without observable source work. Replay and terminal status are
identical across all three surfaces.

## GR8 — adversarial acceptance gate

Reds cover all three fixed mappings and reject unknown producer kinds, capability/op/card
substitution, caller-selected rung/type/grounding/prose/IDs, forged trusted context, unsupported or
non-reverifiable cards, source/result/ref substitution, partial or malformed output, artifact and
receipt tamper, environment drift, cancellation, and every max+1 ceiling. Transaction tests inject
failure before and during append, duplicate/concurrent production, reserved-name collision,
missing or cross-repository causal endpoints, future evidence, replay conflict, and reverify drift.

Source-contract reds land first: SCIP parse errors and primary-ref digest binding, existing-artifact
tamper for structural and SCIP, exact unique primary-ref selection, stable result projection, and
honest structural resumability. Producer tests may not hide those prerequisites behind mocks.

Parity tests invoke and reverify each producer directly, through authenticated web, and through
MCP. Recursive proof uses Baton to produce a representation of Baton's own committed source,
freshly reverifies it, and proves process, worktree, runtime, branch, writer, artifact, and capacity
cleanup without exposing credentials.

## GR9 — retained deeper representation scope

Phase 61 does not claim live LSP behavior, native SCIP protobuf interchange, whole-repository CPG,
SSA, full CFG/PDG, alias or heap analysis, path-condition solving, implicit flow, exceptions,
interprocedural returns, compiler IR, translation validation, behavioral equivalence, true semantic
diff/merge, or equality-saturation proof. R4–R7 and every deeper R1–R3 precision increment remain
behind their existing measured prototype, verification, false-clean, and Decision gates.

The Cairn graph is Baton's self-contained deployment-neutral authority. Its causal design may be
inspired by repository-local project-manager prior art, but this phase introduces no homelab,
project-manager runtime, credential, API, query, mutation, or integration dependency.
