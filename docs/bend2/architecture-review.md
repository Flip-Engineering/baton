# Adversarial architecture review

## Scope and decision rule

This review examines Baton at commit `bc2e4fcd072e9edce21f94ee2ea8bb938c409f9b`.
The evidence set is `impl/src`, `impl/test`, the repository design documents, and
[`impl/scripts/seam-inventory.json`](../../impl/scripts/seam-inventory.json). Bend2 capability
claims use the repository pin in [`reference/README.md`](reference/README.md), which fixes
`bendlang/bend@a49524265bdfa5753a4bf38e25f0574a705dd868` and Bend 2.0.25. This document records deletion and merge findings with the operator dispositions below. [`target-architecture.md`](target-architecture.md) defines the resulting
BATON2 ownership model. This review does not change the running implementation.

A finding in this review has three required parts:

1. a source-backed reason that the current boundary exists;
2. a named deletion or merge; and
3. the behavior Baton would lose if that change were wrong.

The audited tree at `bc2e4fcd` has 193 `impl/src/*.mjs` modules and 163,391 source lines. The seam inventory
classifies 2,670 members in 22 files. Observation is the largest class at 1,026 members and 18,186
member lines. Admission has 657 members, surface has 561, recovery has 218, and effect has 208.
The earlier runtime review reached the same structural diagnosis from a smaller snapshot: the
three main classes mixed admission, observation, recovery, projection, and effects across roughly
47,000 lines ([`docs/40-runtime-review-2026-09-12.md`](../40-runtime-review-2026-09-12.md#L110)).

Two read-only review lanes supplied independent evidence. The coordination lane inspected the
coordinator, ledger, custody, admission, recovery, contribution, and verification paths. Its full
report is [`architecture-findings-coordination.md`](architecture-findings-coordination.md), from
`bend2-arch-coordination-lane` contribution
`contribution-f298f891ae027b52f25d81ba3264ece5`. The surface lane inspected adapters, provider
processes, CLI, MCP, Web, workflow, wave, Atlas, context, and result export. Its full report is
[`architecture-findings-surface.md`](architecture-findings-surface.md), from
`bend2-arch-surface-lane` contribution
`contribution-d31675f128fc5af02a973ee72f16014a`. Both lane contributions were independently
accepted. The findings below restate their evidence after a direct source check.

## Decision and evidence status

The operator approved the 16 operative revision 9.1 laws at
`1fab9a1da60db3d5d9c9d3cef89d3caabd68fe35` and authorized rewrite work on `bend2-rewrite`.
The final law review is `/tmp/baton-bend2-laws-review/codex-final-law-review-r9.1.md`, verdict
**APPROVED**. Architecture feasibility and migration readiness remain under separate review.
The external directory `/tmp/baton-bend2-laws-review/architecture` contains review inputs and
native probes; no final architecture verdict was present when this reconciliation was prepared.

Retained commit `c22cda5bf04c36616d9634464709648538d196d8`, contribution
`contribution-7ee11e562dbf8ed3c3dad1ab670592d4`, records the operator decisions recovered here:

- F2's durable-store merge is rejected. Preserve the Operational Log and Coordination Journal as
  separate storage systems; delete the prototype `holistic-runtime.EventJournal`.
- F4 permits one scheduler only with explicit knowledge promotion, separate information scopes,
  and preserved parent-child delegation.
- F16/F17 require typed effect/path declarations and an independent background structural scan.
  Gate selection consumes a validated result bound to both inputs and the exact source snapshot.
- F1, F3, F5 through F15, and F18 through F24 are approved design directions. Their implementation
  still requires the host and capability evidence identified below.

The retained contribution awaits independent disposition during this recovery. Its operator
record supplies design constraints; this document grants no additional approval. The actionable
closure conditions are ARCH-CLOSE-01 through ARCH-CLOSE-09 in
[`target-architecture.md`](target-architecture.md#native-prerequisites-and-closure-conditions).
Affected phases wait for their architecture verdict and prerequisite evidence. Earlier blanket
law-approval holds are superseded.

The source census, line references, and historical test observations below remain pinned to
`bc2e4fcd`; this reconciliation does not recertify them against the current implementation.
The two lane reports retain their original proposals as source evidence. The dispositions in
this document and the target architecture govern the rewrite.

## Why the current subsystems exist

The following boundaries are caused by JavaScript, Node, or the sequence in which Baton was built.
Each row is also a deletion or merge proposal.

| Current subsystem | Cause in the current implementation | Concrete deletion or merge | Loss if the change is wrong |
| --- | --- | --- | --- |
| `Coordinator` plus six `runtime-*` partials | Historical extraction kept every class method as a same-name delegate. The partial headers say that bodies moved verbatim and instance patches must continue to fire ([`runtime-admission.mjs`](../../impl/src/runtime-admission.mjs#L1), [`runtime-api.mjs`](../../impl/src/runtime-api.mjs#L1)). | Delete the forwarding methods and merge the partials into the target scheduler, worker gateway, journal projector, and reconciler by ownership. | Prototype patching, `Function.length`, and the existing public `Coordinator` method ABI would disappear. Tests that deliberately exercise bare receivers would fail until replaced by typed ports. |
| `CoordinationStore` plus five `coordination-*` partials | Historical extraction kept 604 class delegates while the moved functions remained organized by seam-map category ([`coordination-internals.mjs`](../../impl/src/coordination-internals.mjs#L1), [`coordination-ledger.mjs`](../../impl/src/coordination-ledger.mjs#L1)). | Delete the class delegate shell and merge durable writes, folds, queries, admission, and replay into the journal, projector, policy, and reconciler owners. | Existing callers that monkeypatch store methods, the class-shaped public API, and byte-compatible replay helpers could be lost. |
| `BatonApplication` plus `application-observation` | Slice 15 moved methods verbatim and retained same-name delegates so the dispatch table stayed unchanged ([`application-observation.mjs`](../../impl/src/application-observation.mjs#L1)). | Delete application observation delegates and merge each query into its materialized-view owner. | CLI, MCP, and Web commands that depend on current method names, arities, pagination, and authority filtering could change. |
| Repeated `canonical`, `clone`, `freeze`, `exact`, and digest helpers | JavaScript values do not carry closed record types, affine ownership, or a canonical serialized form. At least 23 modules define a local `canonical` function. | Delete internal copies and merge canonical encoding, fixed-point currency, identifiers, and closed construction into domain types. Keep versioned decoders at durable and network boundaries. | Ledger digests, Unicode order, nanodollar arithmetic, unknown-field policy, and replay identity could change. The locale and migration cases are pinned by [`phase63-canonical-order-authority.test.mjs`](../../impl/test/phase63-canonical-order-authority.test.mjs#L36). |
| `FenceTable`, shared-workspace custody scans, and northbound string capabilities | Mutable stamps and exported strings implement authority checks in JavaScript ([`northbound-capability-authority.mjs`](../../impl/src/northbound-capability-authority.mjs#L1)). | Consolidate issuance, scope, generation, and holder checks. Delete their implementation only after ARCH-CLOSE-02 proves the replacement against LANG-F-26/28. | Forged or stale authority could act; a shared checkout could be removed while another holder remains. |
| Provider poll, processing, and session-recovery supervisors | Node timers, `AbortController`, and mutable single-flight flags implement task lifetimes manually. | Merge all three into one structured supervisor over a typed action and policy; delete the three timer-loop class bodies. | Provider-specific maximum backoff, durable processing backoff, one-shot session recovery, and close status could be flattened into an incorrect common policy. |
| ACP, OMP, app-server, CLI, and session process wrappers | Providers arrived through different Node child-process protocols and were integrated at different times. | Merge child ownership, JSON-RPC framing, close/reap, stderr bounds, and cancellation into one worker gateway. Keep a provider codec for protocol-specific frames. | Ready handshakes, permission requests, session resume, provider event names, and oversize-frame behavior could be lost. |
| `holistic-runtime` and `production-*` convergence wrappers | A later convergence design was added beside the deployed runtime and exported as an opt-in package path ([`package.json`](../../impl/package.json#L15), [`index-converged.mjs`](../../impl/src/index-converged.mjs#L1)). | Delete the parallel runtime and wrapper succession; merge its command registry, notification, and recovery requirements into the single deployment factory. | The `baton/converged` API, raw-core escape hatch, hook-based migration path, and its recovery behavior would be removed. |
| `workflow-lane.mjs`, `native-modules.mjs`, and duplicate `resolveResultPin` | ESM import-graph tests produced re-export shims. A synchronous result-pin implementation was copied to avoid another import ([`workflow-interpreter.mjs`](../../impl/src/workflow-interpreter.mjs#L406)). | Delete both shims and the copied pin resolver; merge their contracts into the actual workflow and capability modules. | Import inertness, optional capability loading, cancellation, and the exact result attribution grace period could regress. |
| Seam inventory generator and committed JSON | Dynamic method ownership is reconstructed with AST text because JavaScript declarations do not encode the architectural seam. | Delete the committed JSON, landing-table copy, and source-shape tables after typed declarations and an independent structural scan establish equivalent coverage (ARCH-CLOSE-09). | Landing could select too few tests for a changed effect or authority path. This risk is material because the current hard-coded application member count is already stale. |

## Findings

### F1. Delete the facade compatibility architecture

**Deletion and merge.** Delete the forwarding surfaces on `Coordinator`, `CoordinationStore`, and
`BatonApplication`. Merge the extracted methods into owners named by the target architecture:
scheduler, journal, projector, worker gateway, workspace, verification, and reconciler.

**Evidence.** The source headers explicitly say that methods moved verbatim and the classes retained
same-name, same-arity delegates
([`runtime-briefing.mjs`](../../impl/src/runtime-briefing.mjs#L15),
[`coordination-admission.mjs`](../../impl/src/coordination-admission.mjs#L1),
[`coordination-replay.mjs`](../../impl/src/coordination-replay.mjs#L11)). The associated tests compare
hard-coded name, parameter, arity, delegate, export, and import tables as one bijection
([`runtime-admission.test.mjs`](../../impl/test/runtime-admission.test.mjs#L215),
[`coordination-admission.test.mjs`](../../impl/test/coordination-admission.test.mjs#L193),
[`coordination-ledger.test.mjs`](../../impl/test/coordination-ledger.test.mjs#L199),
[`application-observation.test.mjs`](../../impl/test/application-observation.test.mjs#L156)). Those
tests protect the migration scaffold. They do not establish that the scaffold is a useful domain
boundary.

**Loss if wrong.** Existing embeddings could depend on prototype replacement, exact arity, or a
class method that this review treats as internal. Removing the facade before a protocol adapter is
available would break those callers and some test doubles.

### F2. Keep the two durable event stores and delete the prototype

**Operator disposition: store merge rejected.** Preserve `Log` and `CoordinationStore` as the
Operational Log and Coordination Journal, each with its own writer, sequences, file formats,
archives, recovery, and fault boundary. Delete the prototype `holistic-runtime.EventJournal`
and its compatibility paths. Shared record types and cross-store references do not authorize
shared write transactions, quarantine, or compaction frontiers.

**Original proposal.** The source audit proposed a partitioned journal merging both stores.
The operator rejected that merge; the deletion above is the retained action. ARCH-CLOSE-04
requires independent-store durability and recovery evidence.

**Evidence.** `log.mjs` calls the per-worker JSONL log the only source of truth
([`log.mjs`](../../impl/src/log.mjs#L1)), while the deployment separately constructs a
`CoordinationStore` and lets it read the operational log
([`index.mjs`](../../impl/src/index.mjs#L1334), [`index.mjs`](../../impl/src/index.mjs#L1391)).
`holistic-runtime.mjs` introduces a third event-journal abstraction
([`holistic-runtime.mjs`](../../impl/src/holistic-runtime.mjs#L129)). `log.test.mjs` pins gap-free
per-worker sequence and archive behavior ([`log.test.mjs`](../../impl/test/log.test.mjs#L2)); the
coordination suites pin ledger replay, quarantine, and fold behavior.

**Loss if wrong.** A single physical write path could couple high-volume worker telemetry to control
state, weaken fault isolation, change per-worker gap-free sequence numbers, or make old coordination
segments unreadable.

### F3. Delete the parallel convergence runtime

**Deletion and merge.** Delete `holistic-runtime.mjs`, `index-converged.mjs`, and the production
convergence wrapper chain after their required behaviors enter the normal deployment. Merge the two
`wrapProductionDeployment` definitions and the two `wrapProductionMcpServer` definitions during the
transition.

**Evidence.** The package exports both the normal runtime and opt-in converged and holistic entry
points ([`package.json`](../../impl/package.json#L15)). `index-converged.mjs` opens the normal runtime,
installs global hooks, and wraps the result ([`index-converged.mjs`](../../impl/src/index-converged.mjs#L19)).
The deployment wrapper names are duplicated in
[`production-convergence.mjs`](../../impl/src/production-convergence.mjs#L321) and
[`production-deployment-convergence.mjs`](../../impl/src/production-deployment-convergence.mjs#L221).
The MCP wrapper name is duplicated in
[`production-mcp-convergence.mjs`](../../impl/src/production-mcp-convergence.mjs#L750) and
[`production-mcp-complete.mjs`](../../impl/src/production-mcp-complete.mjs#L11).
[`converged-export-surface.test.mjs`](../../impl/test/converged-export-surface.test.mjs#L6) pins the
parallel entry point.

**Loss if wrong.** Startup recovery differs between the two deployment wrappers. The MCP decorator
also repairs attention authorization. A mechanical deletion could select the weaker behavior and
remove a public package export without a migration path.

### F4. Merge plan, workflow, wave, and swarm scheduling

**Deletion and merge.** Merge `goal-plan`, `orchestrator-plan`, workflow definition and revision,
task topology, run lineage, wave, workflow interpreter, recipes, and swarm work assignment into one
versioned plan graph. Preserve the graph identity namespaces as distinct variants and keep dynamic
swarm actions as plan events. Delete independent scheduling mechanics after ARCH-CLOSE-08 passes.

**Operator condition.** Knowledge promotion remains an explicit operation carrying source and
destination scope. Separated agents retain reader-relative views. Parent-child relations preserve
delegated authority, visibility, and completion rules through replay. Native tests must carry
`kg-settlement-red.test.mjs`, `swarm-delegated-completion.test.mjs`, and the plan identity fixtures.
A unified graph must reject cross-scope reads and child authority elevation.

**Evidence.** `wave-driver.mjs` owns a polling supervisor while `workflow-interpreter.mjs` owns a
second member fan-out and join. The workflow lane tests pin a separate import shim
([`workflow-as-data-red.test.mjs`](../../impl/test/workflow-as-data-red.test.mjs#L1462)). Goal plans
and orchestrator plan objects deliberately use distinct IDs, and
[`orchestrator-plan-object-red.test.mjs`](../../impl/test/orchestrator-plan-object-red.test.mjs#L1607)
pins that separation. The current distinction reflects independent feature delivery; both describe
versioned work graphs, routes, dependencies, attempts, and outcomes.

**Loss if wrong.** Stable IDs, plan digests, reopen and focus behavior, wave receipts, workflow
revision ancestry, dynamic assignment, and replay of prior plan formats could be corrupted by a
single undifferentiated node type.

### F5. Merge wave supervision into an explicit supervised join

**Deletion and merge.** Delete the per-member poll timers, mutable progress maps, and ad hoc
`Promise.all` join. Merge them into one implemented and tested join over member tasks plus a supervision policy
value. LANG-CAP-09 and ARCH-CLOSE-03 gate the deletion: pure parallel calls and `IO.fork`
do not establish cancellation, parent-child cleanup, or task supervision.

**Evidence.** The wave driver tracks each member through repeated status reads, settlement windows,
stall clocks, claim recovery, and nudge budgets. The workflow interpreter separately fans out pending
roles. [`wave-driver-red.test.mjs`](../../impl/test/wave-driver-red.test.mjs#L135) pins member start,
settlement, cancellation, selective stop, and quiescence. The recruited surface review located the
two join forms at `wave-driver.mjs:613-893` and `workflow-interpreter.mjs:924-925`.

**Loss if wrong.** A plain join would lose the stall clock, one-nudge unproductive cycle, paused
claim resolution, refusal budget, settle window, and selective member stop. These belong in the
supervision policy carried by the join.

### F6. Merge adapters and process ownership into one worker gateway

**Deletion and merge.** Delete legacy one-shot adapter bases and provider-owned process supervisors.
Merge `AcpJsonRpcProcess`, `OmpRpcProcess`, CLI adapters, app-server adapters, persistent sessions,
process close/reap, and adapter-card validation into one worker gateway with protocol codecs.

**Evidence.** `adapter.mjs` has a D1 method-set check
([`adapter.mjs`](../../impl/src/adapter.mjs#L308)), while `adapter-contract.mjs` adds a second card-axis
check because the first admitted incomplete cards ([`adapter-contract.mjs`](../../impl/src/adapter-contract.mjs#L1)).
OMP states that its surface mirrors the ACP process, and both carry the same close latch and detached
child ownership. The relevant behavior is pinned by `adapter.test.mjs`,
`acp-json-rpc-process.test.mjs`, `omp-process-truth.test.mjs`, and `omp-rpc-red.test.mjs`.

**Loss if wrong.** Provider protocols differ in ready frames, permission requests, session resume,
event mapping, usage reporting, and size bounds. Flattening codecs would make one provider appear
healthy while its protocol state is incomplete.

### F7. Merge provider supervisors under a checked task lifecycle

**Deletion and merge.** Merge `ProviderPollSupervisor`, `ProviderProcessingSupervisor`, and
`SessionRecoverySupervisor` into one task nursery abstraction. Delete their repeated `start`,
`_schedule`, `_run`, `status`, `close`, timer, abort, and single-flight code after the replacement
passes LANG-CAP-09 and ARCH-CLOSE-03. Explicit cancel, join, close and reap outcomes must account
for every owned child; an affine value may be dropped without calling cleanup (LANG-F-26).

**Evidence.** The three classes are defined in
[`provider-poll-supervisor.mjs`](../../impl/src/provider-poll-supervisor.mjs#L6),
[`provider-processing-supervisor.mjs`](../../impl/src/provider-processing-supervisor.mjs#L8), and
[`session-recovery-supervisor.mjs`](../../impl/src/session-recovery-supervisor.mjs#L11). The first two
have nearly identical timer state machines. `phase43-provider-poll-lifecycle.test.mjs`,
`phase43-provider-reconciliation.test.mjs`, and `phase45-session-auto-rejoin.test.mjs` exercise the
different policies.

**Loss if wrong.** Poll timing is bounded by each provider card, processing backoff is durable in the
store, and session recovery is one-shot. A common supervisor that owns those policies would change
their failure and retry rules.

### F8. Consolidate authority checks and prove any capability replacement

**Deletion and merge.** Consolidate `FenceTable`, shared-workspace holder inference, and northbound
bearer-string admission into one authority contract. Retain issuance, resource identity, scope,
generation, holder, and replay checks at every consuming effect until ARCH-CLOSE-02 proves a
replacement. A checked capability encoding or an approved language extension is a prerequisite to
deleting checks whose safety relies on unforgeability.

**Language correction.** LANG-F-28 demonstrates that an importing module can construct an affine
lease directly and another function can produce the same custody type. LANG-F-26 demonstrates a
legal drop that calls no release. Affinity alone supplies neither issuance provenance nor cleanup.
[`lang-cap-probes.evidence.md`](examples/lang-cap-probes.evidence.md) carries the compiled positive
and negative controls. Base's closed opaque handle laws do not establish user-defined lease safety.

**Evidence.** [`fence.mjs`](../../impl/src/fence.mjs#L10) implements mutable version stamps.
`shared-workspace-custody.mjs` derives custody from several live handles. The northbound module uses
fixed strings because object identity fails when two package copies load
([`northbound-capability-authority.mjs`](../../impl/src/northbound-capability-authority.mjs#L1)).
`fence.test.mjs`, `shared-workspace-custody.test.mjs`,
`issue428-worktree-custody-on-stop.test.mjs`, and the stale-fence Web cases pin the required external
behavior.

**Loss if wrong.** A forged local record can authorize an effect if its consumer trusts only the
type name. Removing durable generations permits stale commands to act after restart. Removing the
holder set or treating a dropped value as a release permits deletion of a shared checkout still
owned by another participant.

### F9. Merge recovery into one journal reconciler

**Deletion and merge.** Merge coordination replay, runtime recovery, application recovery views,
swarm startup recovery, process recovery, and session recovery into one reconciler driven from the
journal. Delete recovery methods that only repair in-memory promises, timers, and reservation maps;
the replacement supervisor must account for those cases explicitly under ARCH-CLOSE-03/05.
Lost in-memory handles provide no proof that an external effect stopped or that retry is safe.

**Evidence.** The inventory assigns 218 members and 6,976 member lines to recovery.
`runtime-recovery.mjs` says 42 class members moved into its bucket
([`runtime-recovery.mjs`](../../impl/src/runtime-recovery.mjs#L1)); `coordination-replay.mjs` separately
owns restart fold and validation ([`coordination-replay.mjs`](../../impl/src/coordination-replay.mjs#L1)).
The verification recovery review requires explicit, inspectable recovery outcomes
([`docs/41-verification-recovery-review.md`](../41-verification-recovery-review.md#L69)).

**Loss if wrong.** Git process groups, provider sessions, worktree custody, verification execution,
and ledger quarantine have distinct evidence. A generic retry loop could repeat an external effect,
hide an unconfirmed process, overwrite corrupt bytes, or report recovered work without proof.

### F10. Merge observation into typed materialized views

**Deletion and merge.** Merge observation code from `application-observation`, `runtime-observation`,
`coordination-ledger`, `swarm-runtime.inspect`, and related class delegates into journal projectors
and typed query modules. Delete repeated full-state scans and host-class forwarding methods.

**Evidence.** Observation is 38% of inventoried members and 39% of inventoried member lines.
`coordination-ledger.mjs` alone contains 254 observation members; `runtime-observation.mjs` contains
128; `application-observation.mjs` contains 104. The runtime review records that repeated scans and
large projections can obstruct controls
([`docs/40-runtime-review-2026-09-12.md`](../40-runtime-review-2026-09-12.md#L110)).

**Loss if wrong.** Queries enforce authority filters, page ceilings, cursor stability, redaction,
and historical profile semantics. A projector that omits those inputs would expose data or return a
view that cannot be reproduced from its cursor.

### F11. Merge surface semantics into one protocol

**Deletion and merge.** Merge application semantics, command schemas, refusal codes, capability
catalog, surface resolution, and transport command tables into one typed protocol. Generate CLI,
MCP, Web, and embedded codecs from it. Delete per-transport aliases and validators once each public
compatibility window closes.

**Evidence.** The normal dependency graph contains a cycle through Web northbound, the native
bridge, access, client, application client, swarm runtime, and application. The package exports
separate surface catalog, resolution, and CLI modules
([`package.json`](../../impl/package.json#L22)). `application-semantics.mjs` already attempts to be a
registry, while each transport retains parsing, failure-code, and optional-method logic.

**Loss if wrong.** HTTP authentication and streaming, MCP JSON-RPC framing, CLI help and exit status,
host-local commands, backward-compatible aliases, and bounded paging are transport behavior. A
generated codec must still carry those transport parameters.

### F12. Merge context execution with the plan and artifact models

**Deletion and merge.** Merge context map, effect call, program, session, retry, and call lineage into
typed plan nodes. Merge context outputs and provider results into the artifact and evidence model.
Delete the two separate result-lineage validators after one parameterized validator owns both row
variants.

**Evidence.** `context-result-lineage.mjs` and `context-effect-result-lineage.mjs` repeat constants,
canonicalization, digest checks, build fields, validate fields, output fields, and artifact fields.
They differ mainly in the call normalizer and source-evidence row. `context-program.mjs` separately
defines a session runtime ([`context-program.mjs`](../../impl/src/context-program.mjs#L1195)), while
workflow and plan modules already model graph execution.

**Loss if wrong.** Pure context evaluation and effectful provider calls have different admission and
evidence. A unified row that erases the variant could accept an effect result as a pure map result,
lose selective-retry identity, or detach an output from its source proof.

### F13. Merge duplicated validation and presentation policies

**Deletion and merge.** Merge the duplicate credential redactors, byte cappers, and
`resultExportArchiveCeiling` functions. Delete the weaker application-local copies. Merge the union
of secret patterns and keep one named refusal vocabulary.

**Evidence.** `messages.mjs` and `application-observation.mjs` contain different redaction patterns
and replacement behavior. The latter omits the AKIA and JWT patterns present in the former.
`resultExportArchiveCeiling` is defined in both
[`result-export.mjs`](../../impl/src/result-export.mjs#L894) and
[`application-observation.mjs`](../../impl/src/application-observation.mjs#L275). The archive bound is
pinned by `issue413-export-archive-bound.test.mjs`; attention redaction and truncation are covered by
`frame-economics-red.test.mjs`, `phase64-integrated-run-application.test.mjs`, and
`issue451-integrate-dependency-link.test.mjs`.

**Loss if wrong.** Selecting either redactor unchanged loses behavior: one path would expose AWS key
IDs or JWTs, while the other would change whole-string replacement and truncation markers. Merging
the archive ceiling can also change `application_export_policy_stale` to `result_export_invalid`.

### F14. Delete ESM and source-shape shims

**Deletion and merge.** Delete `workflow-lane.mjs`, `native-modules.mjs`, and the synchronous copied
`resolveResultPin`; merge import-inertness and optional capability loading into real module
boundaries. Delete source-shape tests that require a re-export file to exist.

**Evidence.** `workflow-lane.mjs` is a re-export consumed only by an import-graph test
([`workflow-lane.mjs`](../../impl/src/workflow-lane.mjs#L1),
[`workflow-as-data-red.test.mjs`](../../impl/test/workflow-as-data-red.test.mjs#L1462)).
`native-modules.mjs` claims to isolate optional native dependencies, while `@ast-grep/napi` is a
normal dependency ([`package.json`](../../impl/package.json#L52)). The exported async result resolver
lives in [`wave.mjs`](../../impl/src/wave.mjs#L231); the workflow interpreter carries a synchronous
copy.

**Loss if wrong.** The actual import law matters: importing a workflow module must not start work.
Optional native capabilities also need a typed unavailable result. Replacing the synchronous copy
without preserving cancellation and timing could change result-pin attribution.

### F15. Move Atlas behind the capability boundary

**Deletion and merge.** Delete Atlas registration and native parser imports from the core deployment.
Merge the four native version reads and language tables into one Atlas substrate, then expose Atlas
as an optional capability service.

**Evidence.** `atlas-cpg.mjs`, `atlas-index.mjs`, `atlas-rewrite.mjs`, and
`atlas-structural.mjs` each load the same `@ast-grep/napi` package version and carry overlapping
language maps. `native-modules.mjs` does not defer those imports because `index.mjs` and Atlas modules
load them statically.

**Loss if wrong.** The capability cards expose parser version and supported languages as evidence.
An over-broad merged map could admit a language unsupported by one operation. Moving the service out
of process could also change latency, startup registration, and receipt reverification.

### F16. Merge verification, contribution, and landing authority

**Deletion and merge.** Merge contribution capture, independent verification, gate selection,
landing-table resolution, integration, and result adoption into one verification and landing
subsystem. Replace the committed AST seam inventory with typed effect/path declarations checked
against an independent background structural scan. Gate selection consumes the validated
`CheckedChangeImpact` for the exact source snapshot (ARCH-CLOSE-09).

**Evidence.** Gate ownership is split across `contribution-service.mjs`,
`contribution-verification.mjs`, `referee.mjs`, `landing-table.mjs`, result adoption in application
code, and surface presentation. The seam inventory is treated as landing input. The verification
recovery review requires proof that execution occurred and makes recovery visible
([`docs/41-verification-recovery-review.md`](../41-verification-recovery-review.md#L16)).

**Loss if wrong.** Verification must remain independent of the contributor, preserve exact command,
arguments, working directory, environment, and exit status, and prevent integration of a stale
commit. A merged subsystem with one mutable actor could erase that separation of authority.

### F17. Replace the committed seam inventory with checked change declarations

**Deletion and merge.** Delete `impl/scripts/seam-inventory.mjs`, its committed JSON, the
landing-table inventory reader, the surface gate consumer, and fixed member tables after
ARCH-CLOSE-09 establishes equivalent gate coverage. Keep a background structural scanner owned by
Verification and Landing. It checks declared effects, paths, transitive calls, and ownership edges
against the submitted source snapshot.

**Operator condition.** Both declaration and structural scan are mandatory. Their validated result
binds source snapshot, declaration digest, scanner version, and gate mapping. Missing, stale,
unresolved, or mismatched evidence prevents gate selection and integration. LANG-F-28's second
producer probe requires validating this provenance at the consumer; naming a return type
`CheckedChangeImpact` establishes no unique producer.

**Evidence.** The artifact has 26,008 JSON lines for 2,670 class members. The generator infers a
single primary category from names, ports, and verbs. The source-shape suites then compare those
results with hard-coded tables. At this revision, `node impl/scripts/seam-inventory.mjs` succeeds,
while `application-observation.test.mjs` fails its expected count of 174 with an observed count of
175 at line 156. The generated copy and the test copy already disagree.

**Loss if wrong.** The inventory is currently the only explicit input that maps several split
modules to landing gates. Deleting it before declaration checking and independent structural coverage are proven would
narrow verification silently when a seam module changes.

### F18. Merge host and worktree capacity leases

**Deletion and merge.** Merge `host-capacity.mjs` and `worktree-capacity.mjs` into one physical
resource lease substrate. Delete the duplicated atomic owner publication, PID liveness,
observe/publish/confirm/remove/reap, lock polling, and derived-floor implementations. Keep resource
kind and accounting policy as typed variants.

**Evidence.** `host-capacity.mjs` says it uses the published-owner protocol first proved by worktree
capacity ([`host-capacity.mjs`](../../impl/src/host-capacity.mjs#L20)), then reimplements the same
atomic-write and owner lifecycle. The matching code is in
[`host-capacity.mjs`](../../impl/src/host-capacity.mjs#L78) and
[`worktree-capacity.mjs`](../../impl/src/worktree-capacity.mjs#L260). The coupled floor arithmetic is
described in [`docs/43-host-capacity-and-derived-floors.md`](../43-host-capacity-and-derived-floors.md#L17).
`worktree-capacity-contention.test.mjs` pins real child contention, dead-holder reap, refusal to
steal, and settlement by owner identity.

**Loss if wrong.** Host verify leases and worktree reservations charge related CPU and memory
budgets. Dropping either side's floor can over-admit a verification suite into memory exhaustion or
leave admission waiting behind a reservation whose owner can no longer settle it. The current #541
law that worker admission never refuses for host load or waiting must also survive as an explicit
resource-kind policy.

### F19. Collapse the idempotency stack

**Deletion and merge.** Collapse client request keys, bridge-generated keys, `SwarmRuntime._once`,
per-row composed keys, and ledger `_byKey` deduplication into one typed at-most-once operation. Delete
the extra key grammars and in-flight state machine after the journal owns operation admission and
completion.

**Evidence.** The client and bridge can each mint a UUID
([`swarm-client.mjs`](../../impl/src/swarm-client.mjs#L51),
[`swarm-native-bridge.mjs`](../../impl/src/swarm-native-bridge.mjs#L908)). `SwarmRuntime._once` then
hashes command, swarm, principal, and key into request/completed/unavailable rows
([`swarm-runtime.mjs`](../../impl/src/swarm-runtime.mjs#L2367)). The ledger applies another flat-key
dedupe ([`coordination-ledger.mjs`](../../impl/src/coordination-ledger.mjs#L1191)).
`bridge-idempotency-344.test.mjs`, `briefing-pack-red.test.mjs`, and
`swarm-coordination.test.mjs` pin replay behavior.

**Loss if wrong.** A repeated capture could capture twice, a repeated recruit could create a second
participant, or a crash between effect and completion could leave an operation permanently unknown.
The merged journal transition must distinguish requested, committed, refused, and outcome-unavailable
states.

### F20. Merge ledger append, drift, and atomic-write machinery

**Deletion and merge.** Merge `_append` and `_appendBatch` into one append transaction. Merge the
three ledger drift checks into one verified frontier. Merge the seven temp-write, fsync, rename, and
directory-fsync recipes into one durable replacement primitive. Delete the in-memory writer flag
and duplicated per-append ownership checks only after ARCH-CLOSE-02/04 prove a single checked
writer admission and crash-durable transaction. Apply that primitive separately inside each store;
F2 forbids merging the two stores. LANG-CAP-01 supplies required sync and publication effects.

**Evidence.** The single and batch append paths duplicate record construction, append, group-commit
scheduling, hash update, indexing, and fold
([`coordination-ledger.mjs`](../../impl/src/coordination-ledger.mjs#L1183),
[`coordination-ledger.mjs`](../../impl/src/coordination-ledger.mjs#L1239)). Drift checks occur in the
ledger and again in checkpoint and compaction paths. Atomic replacement is repeated for quarantine,
receipts, checkpoints, segments, indexes, window rewrite, and lease claims in
[`coordination-ledger-writes.mjs`](../../impl/src/coordination-ledger-writes.mjs#L358).
The coordination module-move suites pin newline-complete, SHA-identical ledger bytes and restart
replay.

**Loss if wrong.** A merged write primitive with incorrect ordering can leave a torn ledger, advance
the projection past durable bytes, or poison writer authority. Current admission refuses all later
writes after detected drift; weakening that response would extend corruption.

### F21. Replace polling waits with task and journal waits

**Deletion and merge.** Delete host lease polling, drain polling, dispatch tick re-drive, and separate
wake long-poll loops. Merge them into structured task waits and the journal's existing append
subscription primitive. Merge the inline concurrency ceiling comparison with
`withinConcurrencyCeiling`.

**Evidence.** Host capacity sleeps between full observations; drain convergence sleeps on a second
cadence; deferred dispatch resumes on ticks or release edges. The coordination ledger already parks
waiters and resolves them on append
([`coordination-ledger-writes.mjs`](../../impl/src/coordination-ledger-writes.mjs#L761),
[`coordination-ledger.mjs`](../../impl/src/coordination-ledger.mjs#L1320)).
`concurrency-policy.mjs` exports the ceiling predicate
([`concurrency-policy.mjs`](../../impl/src/concurrency-policy.mjs#L25)), while runtime admission
repeats it inline. `concurrency-policy-admission.test.mjs` pins deferred dispatch and release-edge
admission.

**Loss if wrong.** A missed notification can park a task forever; an early notification can violate
FIFO owner order; a level-triggered capacity condition can be lost if it is modeled as an edge only.
The current host worker path has unbounded waiting under #541, so the merged wait must not invent a
timeout refusal.

### F22. Merge schema and refusal vocabularies

**Deletion and merge.** Merge declarative swarm event schemas, handwritten fold validation, swarm
command argument validation, MCP JSON schema, and the contribution contract validator into one typed
schema source with derived codecs. Merge the paired swarm refusal builders and HTTP status mapping
into one versioned refusal registry. Delete the same-rule pair table after old ledger codes have a
decoder migration.

**Evidence.** `swarm-event-schemas.mjs` explicitly says its DSL is descriptive and is not the domain
validator ([`swarm-event-schemas.mjs`](../../impl/src/swarm-event-schemas.mjs#L1)).
`swarm-state.mjs` enforces the event again, `swarm-contract.mjs` validates arguments and publishes a
JSON schema, and `contribution-contract.mjs` repeats primitive schema helpers. The refusal registry
records six current same-rule pairs in
[`swarm-refusals.mjs`](../../impl/src/swarm-refusals.mjs#L191). `swarm-state.test.mjs` pins live
admission and replay parity; `swarm-refusals.test.mjs` pins the closed refusal table.

**Loss if wrong.** A row accepted live and rejected on replay can wedge restart. Renaming an old
refusal without a ledger decoder can also change a request fault into a retryable server fault on
the Web surface.

### F23. Merge wake consumers into one journal subscription

**Deletion and merge.** Merge per-swarm watch, deployment `WakeStream`, and CLI wake summary into one
bounded journal subscription with typed filters and cursors. Delete the hand-written WebSocket
implementation from orchestration and use a transport library. Delete observation polling for facts
that already have durable journal rows.

**Evidence.** `wake-stream.mjs` states that the per-swarm and deployment streams consume the same
ledger and differ by scope ([`wake-stream.mjs`](../../impl/src/wake-stream.mjs#L26)). It also contains
SHA-1 handshake, frame encoding, and incremental frame parsing because Node has no built-in WebSocket
server. Its observation classes poll and compare `JSON.stringify` signatures without durable resume.
`wake-stream.test.mjs` and `swarm-wake.test.mjs` pin closed filters, all-swarm attachment, and resume
without gaps or duplicates.

**Loss if wrong.** Applying lossy observation polling to ledger-backed wake classes would create
reconnect gaps and duplicate actions. Transport backpressure and frame bounds must remain outside
the journal cursor implementation.

### F24. Delete Node-specific persistence workarounds

**Deletion and merge.** Delete the `/bin/ps -o lstart=` lease-staleness subprocess, V8
serialize/deserialize prototype repair, JSON-string key interning, and manual event-loop yield
choreography. Merge lease incarnation, durable encoding, typed keys, and cooperative fold scheduling
into the journal and Kernel abstractions. Replace the reserved `hubCores = 1` convention with an
explicit runtime service budget.

**Evidence.** Lease staleness shells out in
[`coordination-ledger-writes.mjs`](../../impl/src/coordination-ledger-writes.mjs#L104). The same module
repairs null prototypes lost by V8 serialization and later reapplies them. Several modules encode
compound keys as JSON strings. Coordination replay yields manually during long folds. The capacity
document reserves one core for the Node event loop
([`docs/43-host-capacity-and-derived-floors.md`](../43-host-capacity-and-derived-floors.md#L23)).

**Loss if wrong.** Process incarnation is necessary to distinguish a reused PID from the original
lease owner. Durable encoding must preserve map keys and record variants. Fold scheduling must leave
control work responsive. Removing the hub budget without an equivalent runtime service reservation
changes every derived capacity floor.

## Duplicate abstraction pairs

This table is an exhaustive list of duplicate pairs found in the reviewed slices. Each pair maps to
a finding above and carries its own loss statement.

| Pair | Delete or merge | Loss if wrong |
| --- | --- | --- |
| Coordinator methods / `runtime-*` functions | Delete delegates; merge by target owner (F1). | Public method ABI, arity, and patchable test seams. |
| CoordinationStore methods / `coordination-*` functions | Delete delegates; merge by journal, query, policy, and recovery owner (F1). | Store method ABI and byte-compatible replay helpers. |
| BatonApplication methods / `application-observation` functions | Delete delegates; merge into query owners (F1/F10). | Command dispatch names, authority filters, and paging. |
| `Log` / `CoordinationStore` | Preserve separate stores; delete only prototype `EventJournal` (F2). | Per-worker sequence, archive, and control-store fault isolation. |
| deployed runtime / holistic and converged runtime | Delete the parallel runtime; merge required behavior (F3). | Converged package API and divergent startup recovery. |
| `goal-plan` / `orchestrator-plan` | Merge as distinct plan-node variants (F4). | Existing ID namespaces, digests, focus, and reopen semantics. |
| wave driver poll loop / workflow interpreter fan-out | Merge as one supervised join (F5). | Stall, nudge, claim recovery, settle, and selective-stop policy. |
| `assertIsAdapter` / adapter card-axis check | Merge into one worker protocol contract (F6). | Early method validation or named missing-axis refusals. |
| `AcpJsonRpcProcess` / `OmpRpcProcess` | Merge process ownership and close latch; keep codecs (F6). | OMP ready frames and ACP session or permission events. |
| provider poll / provider processing supervisor | Merge timer machinery with separate policies (F7). | Per-card ceiling or durable store-owned backoff. |
| in-memory fence / custody flags / string capability | Consolidate checked authority; prove any removed check (F8). | Durable stale-command and shared-checkout protection. |
| runtime recovery / coordination replay | Merge under a journal reconciler (F9). | External-effect evidence and quarantine behavior. |
| application / runtime / coordination observation | Merge into materialized views (F10). | Authorization, bounded frames, and stable cursors. |
| application semantic registry / transport command tables | Merge into one typed protocol (F11). | Transport-specific auth, streaming, exit, and compatibility behavior. |
| context map lineage / effect result lineage | Merge a parameterized validator with distinct variants (F12). | Pure/effect separation and source evidence. |
| messages redactor / application redactor | Merge the union policy (F13). | Secret coverage, replacement vocabulary, and truncation markers. |
| result export ceiling / application export ceiling | Merge the implementation and preserve refusal mapping (F13). | Public refusal code and bounded archive derivation. |
| `wave.resolveResultPin` / workflow copy | Delete copy and use one abortable resolver (F14). | Attribution timing and cancellation. |
| four Atlas package-version and language maps | Merge into Atlas substrate (F15). | Per-operation language accuracy and card evidence. |
| production deployment wrappers / production MCP wrappers | Merge each name to one implementation (F3). | Recovery and attention authorization behavior. |
| AST seam classification / hard-coded test maps | Replace committed maps with typed declarations and an independent structural scan (F17). | Change-to-gate coverage. |
| host capacity lease / worktree capacity lease | Merge one physical resource lease substrate (F18). | Coupled floor accounting, owner identity, and dead-holder reap. |
| client key / bridge key / runtime `_once` / ledger `_byKey` | Collapse to one at-most-once operation transition (F19). | Duplicate effects and crash-unknown recovery. |
| `_append` / `_appendBatch` | Merge one append transaction (F20). | Byte order, group commit, fold, and durability. |
| three drift checks / seven atomic replacements | Merge verified-frontier and durable-replace primitives (F20). | Corruption detection, checkpoint correctness, and crash safety. |
| host wait / drain wait / dispatch re-drive / ledger wait | Merge task and journal waits (F21). | FIFO progress, level conditions, and #541 unbounded host wait. |
| event schema DSL / fold validator / command validator / MCP schema | Merge one typed schema and derived codecs (F22). | Live/replay parity and useful closed-set refusals. |
| fold refusals / runtime refusals / HTTP status map | Merge one versioned refusal registry (F22). | Old ledger decoding and request-versus-server status. |
| per-swarm watch / deployment WakeStream / CLI summary | Merge one bounded journal subscription (F23). | Cursor resume without gaps or duplicates. |

## Seam inventory disposition

The inventory assigns one primary seam to every member. The table below accounts for all 2,670
members by file. `A/E/O/R/S` mean admission, effect, observation, recovery, and surface. A row's
action names the proposed deletion or merge, subject to the capability and host closure conditions.
Typed task and lease names designate contracts still requiring implementation evidence. Durable storage, operating-system processes,
network inputs, and Git remain external boundaries.

| Inventory file | Members by seam | Collapse action | Loss if the collapse is wrong |
| --- | ---: | --- | --- |
| `coordinator.mjs` | 425: A89 E103 O144 R43 S46 | Delete delegates; merge task joins into Scheduler, effects into Worker Gateway/Workspace, reads into Projector, recovery into Reconciler. | Run admission, selective stop, process evidence, and control receipts could lose one owner. |
| `application.mjs` | 237: A36 E10 O80 R15 S96 | Delete the application god object; merge commands into protocol handlers and views into Projector. | Command authorization, idempotency, and public result shape could change. |
| `coordination-store.mjs` | 604: A175 E26 O243 R52 S108 | Delete class delegates; merge durable effects into Journal and folds/queries into Projector/Reconciler. | Ledger order, quarantine, replay, and store API compatibility could change. |
| `swarm-runtime.mjs` | 161: A34 E7 O54 R9 S57 | Merge work and assignment scheduling into Plan/Scheduler; merge inspection into Projector; delete dispatch shell. | Dynamic recruitment, claims, contribution review, and typed refusal behavior could change. |
| `coordination-internals.mjs` | 122: A2 E2 O6 S112 | Delete JavaScript helper bucket; merge domain constructors and codecs into Kernel. | Canonical digests, bounded text, and legacy field validation could change. |
| `coordination-replay.mjs` | 62: A1 E2 O4 R52 S3 | Merge into Reconciler; delete class-compatible replay delegates. | Corrupt-ledger quarantine and byte-compatible restore could be lost. |
| `runtime-briefing.mjs` | 1: O1 | Merge provider brief construction into Artifact/Evidence materialization. | Admitted brief digest stability and untrusted framing could change. |
| `application-briefing.mjs` | 2: O2 | Merge application briefing views into Artifact/Evidence materialization. | Brief byte bounds and cited evidence could be omitted. |
| `coordination-ledger.mjs` | 272: A6 E1 O254 S11 | Merge folds into Projector and file format into Journal; delete store delegates. | Projection identity, canonical-order migration, and page bounds could change. |
| `coordination-admission.mjs` | 180: A174 O2 S4 | Replace in-process guards with typed constructors and affine leases; merge policy checks into Kernel/Scheduler. | Malformed network or replayed durable values could bypass admission if boundary decoding is also removed. |
| `runtime-recovery.mjs` | 65: A4 O1 R45 S15 | Merge durable reconciliation into Reconciler; delete promise, timer, and reservation recovery covered by task scopes. | External process, Git, provider-session, and verification recovery could repeat effects. |
| `coordination-ledger-writes.mjs` | 31: E28 O2 S1 | Merge writer lease and append transaction into Journal; delete `AsyncLocalStorage` writer emulation. | Concurrent writers could violate append order or durability. |
| `runtime-effects.mjs` | 10: A1 E8 O1 | Merge admitted effects into Worker Gateway, Workspace, and Verification; consume affine effect values. | Stop, integration, delivery, and result resolution could run twice. |
| `runtime-observation.mjs` | 151: A15 O128 S8 | Merge into typed Projector queries; delete coordinator delegates and repeated scans. | Authority-filtered worker and process views could expose or omit state. |
| `runtime-admission.mjs` | 102: A95 S7 | Merge typed policy construction into Kernel/Scheduler; delete receiver and recorder plumbing. | Route, pause, contribution, and interaction refusals could lose exact codes or evidence. |
| `runtime-api.mjs` | 47: S47 | Delete the authority-free fallback bucket; merge helpers into owning domain modules. | Public handle shape, path scope, and terminal status presentation could change. |
| `runtime-event-handlers/dispatcher.mjs` | 1: E1 | Merge event dispatch into the structured WorkerSession receive loop. | Event order and terminal handling could race. |
| `runtime-event-handlers/process-lifecycle.mjs` | 4: E3 R1 | Merge into Worker Gateway process state; delete separate mutable context transitions. | Exact-close authority and unconfirmed reap evidence could be lost. |
| `runtime-event-handlers/turn-terminal.mjs` | 3: E3 | Merge terminal events into task completion values. | Usage, result, and terminal-cause recording could become non-atomic. |
| `runtime-event-handlers/interaction.mjs` | 6: A1 E5 | Merge interaction authority into an affine pending-interaction value. | A late or duplicate answer could satisfy the wrong turn. |
| `runtime-event-handlers/observation-events.mjs` | 9: E8 S1 | Merge observation event folding into Projector subscriptions. | Attention, progress, and diagnostic ordering could change. |
| `application-observation.mjs` | 175: A24 E1 O104 R1 S45 | Delete application delegates; merge queries into Projector and policy construction into Kernel. | Run, workflow, context, episode, and historical views could lose bounds or authorization. |

The local authority deletions require ARCH-CLOSE-02 even inside one process: exported affine
constructors can be forged and dropped (LANG-F-26/28). Durable generations and holder records remain
mandatory. Timer and promise deletions require ARCH-CLOSE-03 to establish parent-child lifetime and
cleanup behavior. The Reconciler retains responsibility for effects that may outlive the process.
Filesystem durability, HTTP/TLS, cancellation/supervision, and crypto are mandatory prerequisites
LANG-CAP-01/08/09/10, with process effects LANG-CAP-05. Their closure evidence and affected owners
are listed in the target architecture; no finding assumes Base already supplies them.

## Existing test truth

The full suite contract includes one baseline failure relevant to this review. At the reviewed
revision:

- `node impl/scripts/seam-inventory.mjs` exits 0 and reports `seam-inventory: ok`.
- `node --test impl/test/application-observation.test.mjs` fails AO5 because the test expects 174
  members and the current source has 175.
- The sibling coordination seam-map suites pass in targeted runs.

This mismatch supports F17. It is not caused by either document in this contribution. The final
deployment gate remains `npm test --prefix impl`; its result is recorded with the contribution.
