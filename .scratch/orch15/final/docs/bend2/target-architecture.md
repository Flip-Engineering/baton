# Baton2 target architecture

## Design constraints

BATON2 targets a Bend2 application with native execution under the pinned toolchain. The final
deployment excludes JavaScript and Node. Native host effects for processes, sockets, files, Git,
and transports require the implementation and conformance evidence listed below. Imported C
effects sit outside the Bend proof guarantee (LANG-F-08); their contracts and implementation remain
explicit prerequisites of the native target.

The runtime premise for this pin is the one the pinned toolchain implements. Bend 2.0.25 compiles a
definition to a segment of a flat state machine and emits C that clang compiles for the CPU, and
[`paper/BendRT.pdf`](reference/upstream/paper/BendRT.pdf) carries that runtime design. This document
targets that compiler and that runtime. [`MANDATE.md`](MANDATE.md) names the HVM runtime; the pinned
guide and toolchain do not use that name. A mandate-conformance claim that requires the deployment
to be HVM by name needs its own operator resolution, so the HVM wording stays a recorded divergence
until one exists.

BATON2 keeps Baton's durable laws and removes boundaries created by class extraction, dynamic
JavaScript checks, Node process plumbing, and successive compatibility layers. The language and
runtime assumptions are limited to the pinned Bend2 reference in
[`reference/README.md`](reference/README.md) and compiled evidence recorded by
[`language-review.md`](language-review.md). An unproven capability blocks the deletions that depend
on it. The closure table below identifies the affected findings and evidence required.

The architecture has eight subsystems. Every mutable fact has one owner. Cross-subsystem values are
immutable records, checked authority values, event-store references, or typed command/result channels. A
subsystem may cache a value owned elsewhere only as a projector with a recorded source cursor.

`TurnLease`, `WorkerSession`, `WorkspaceLease`, and `Capability` name required contracts. At the pin,
user-declared affine records have exported constructors and can be dropped (LANG-F-26 and
LANG-F-28). Each consuming effect must validate issuance, resource identity, scope, and current
generation. Deleting those checks requires a proven capability encoding or a separately approved
language extension. Cleanup requires an explicit release, cancel, join, or reap operation and its
observed result. Consuming or dropping a value proves no resource release. The compiled evidence is
[`lang-cap-probes.evidence.md`](examples/lang-cap-probes.evidence.md).

Bounds in this document mean physical resource derivations or transport pages and chunks carrying
continuation state. They must preserve accepted work and input under the approved laws. A command
records durable intent and returns its receipt; execution and completion are recorded separately.

| Stable ID | Subsystem |
| --- | --- |
| `BATON2-S1` | Domain Kernel |
| `BATON2-S2` | Event Stores and Projectors |
| `BATON2-S3` | Scheduler |
| `BATON2-S4` | Worker Gateway |
| `BATON2-S5` | Workspace and Artifacts |
| `BATON2-S6` | Verification and Landing |
| `BATON2-S7` | Northbound Gateway |
| `BATON2-S8` | Capability Services |

```mermaid
flowchart LR
  N[Northbound Gateway] -->|Command / Reply| S[Scheduler]
  S -->|append / subscribe| J[Event Stores and Projectors]
  S -->|WorkerSession| W[Worker Gateway]
  S -->|WorkspaceLease| A[Workspace and Artifacts]
  S -->|VerificationRequest| V[Verification and Landing]
  S -->|CapabilityCall| C[Capability Services]
  W -->|ArtifactRef / ProcessEvidence| A
  V -->|SnapshotRef / LandingReceipt| A
  C -->|EvidenceRef| A
  W -->|OperationalEventBatch| J
  V -->|CoordinationEvent| J
  C -->|Store-specific event| J
  K[Domain Kernel] -. pure types and laws .-> N
  K -. pure types and laws .-> S
  K -. pure types and laws .-> J
  K -. pure types and laws .-> W
  K -. pure types and laws .-> A
  K -. pure types and laws .-> V
  K -. pure types and laws .-> C
```

The dotted Kernel edges are compile-time dependencies. They do not synchronize at runtime.

## Operator decisions applied

Revision 9.1's 16 operative laws are approved at
`1fab9a1da60db3d5d9c9d3cef89d3caabd68fe35`. The law review reports **APPROVED** in
`/tmp/baton-bend2-laws-review/codex-final-law-review-r9.1.md`. The operator authorized rewrite work on
`bend2-rewrite`. The external architecture review is separate and remains open in the evidence
examined for this reconciliation. Its verdict must be reconciled before affected migration phases
proceed; the law approval imposes no blanket development hold.

The following architecture decisions are recovered from retained commit
`c22cda5bf04c36616d9634464709648538d196d8`, published as
`contribution-7ee11e562dbf8ed3c3dad1ab670592d4`. That contribution's independent review was still
open when recovery began. This recovery preserves its decision text and corrects its capability
assumptions; it asserts no new architecture approval.

The operator approved `F1`, `F3`, `F5` through `F15`, and `F18` through `F24`. The target applies
three specific decisions to the remaining findings:

- `F2` is rejected. The operational `Log` and `CoordinationStore` remain separate storage systems.
  BATON2 deletes only the unused `holistic-runtime.EventJournal` prototype and the compatibility
  code attached to it.
- `F4` is conditional. One Scheduler may own the plan graph only while knowledge promotion remains
  an explicit operation, deliberately separated agents retain separate information views, and
  parent-child agent relations remain represented and enforced.
- `F16` and `F17` use a background structural scan. The scan reads the change source snapshot and
  reports the effects, ownership edges, transitive imports, and calls the change reaches. Gate
  selection consumes its result directly.

These decisions are constraints on the subsystem contracts below. A later phase may not reinterpret
the rejected store merge or weaken the two conditional designs.

## Current subsystem disposition

The target subsystems below are new ownership boundaries. The current subsystem names in this table
disappear from the final tree.

| Current subsystem or layer | BATON2 disposition |
| --- | --- |
| `Coordinator` and the six `runtime-*` partials | Delete the class, delegates, recorder port, and partial buckets. Pure transitions enter Domain Kernel; scheduling enters Scheduler; process effects enter Worker Gateway; recovery enters the journal reconciler. |
| `CoordinationStore` and the five `coordination-*` partials | Delete the class shell and seam buckets. Event Stores and Projectors retains the coordination journal's append, replay, subscription, and projection behavior; Scheduler owns admission. |
| Per-worker `Log`, coordination JSONL, and the prototype `EventJournal` | Keep the operational log and coordination journal as separate storage systems with separate writers, sequences, formats, archives, recovery, and fault boundaries. Delete only the prototype `EventJournal`. |
| `BatonApplication`, `application-observation`, and application clients | Delete the application facade and scan-based observation methods. Northbound Gateway serves the protocol; Projectors serve views. |
| `SwarmRuntime`, swarm fold facade, and native bridge command layer | Delete these classes. Scheduler owns swarm work and authority transitions; the Coordination Journal owns the fold; Northbound Gateway owns transport. |
| Goal plan, orchestrator plan, workflow, wave, recipes, task topology, and run-lineage schedulers | Delete their independent graph and scheduling engines. Scheduler owns one versioned plan graph with typed node variants. |
| Adapter hierarchy, provider supervisors, and provider-specific process owners | Delete the common class layers and repeated lifecycle machines. Worker Gateway owns one session lifecycle with typed protocol codecs. |
| `FenceTable`, custody booleans, opaque startup tokens, drain tokens, and northbound bearer strings | Consolidate authority admission and retain issuance, scope, generation, and holder checks until ARCH-CLOSE-02 proves their replacement. Domain Kernel defines authority records; the owning effect validates them. |
| `host-capacity` and `worktree-capacity` publication protocols | Delete both implementations. Workspace and Artifacts owns one resource lease substrate with resource-specific floor policy. |
| `holistic-runtime`, `index-converged`, and `production-*` wrapper succession | Delete the parallel runtimes and decorators. The eight runtime subsystems below form the only deployment. |
| Seam inventory generator, committed inventory, delegate bijection tests, and landing-table inventory branch | Delete the committed textual inventory and hard-coded member tables. Verification and Landing owns a background structural scanner, and the scan result selects the gates. |
| ESM re-export shims, Node timer loops, hand-written WebSocket server, `v8.serialize` repair, `/bin/ps` lease probe, and event-loop yield choreography | Delete each implementation after its native replacement passes ARCH-CLOSE-03 through ARCH-CLOSE-07. Process lifetime, incarnation, transport security, and persistence remain required behavior. |
| Atlas modules, context engines, browser tools, advisory feeds, LSP, and representation producers | Delete their core-runtime wiring. Capability Services retains each capability behind one typed call and evidence protocol. |

These dispositions apply the operator decisions to the proposals in
[`architecture-review.md`](architecture-review.md), with detailed lane evidence in
[`architecture-findings-coordination.md`](architecture-findings-coordination.md) and
[`architecture-findings-surface.md`](architecture-findings-surface.md).

## Subsystem ownership

### 1. Domain Kernel

**Owns**

- identifiers, bounded scalar types, fixed-point USD, canonical encoding, and digest versions;
- the versioned command, event, refusal, receipt, plan-node, artifact, and evidence variants;
- one schema source for those variants and derived journal, CLI, MCP, and Web codecs;
- the at-most-once operation state and versioned decoder for earlier idempotency keys;
- pure transition functions and policy decisions;
- authority record definitions such as `TurnLease`, `WorkerSession`, `WorkspaceLease`,
  `PendingInteraction`, and `Capability`, with issuance and consumption preconditions;
- versioned boundary decoders and migrations for journal and network values.

**Forbidden from owning**

- files, sockets, processes, Git repositories, timers, provider clients, or mutable caches;
- transport authentication and presentation;
- event-store append, retry, scheduling, or recovery loops;
- deployment-global registries initialized by import.

This subsystem replaces local `canonical`, `exact`, `clone`, `freeze`, identifier, currency, and
digest helpers. Canonical order remains versioned because the current implementation makes it part
of durable replay ([`canonical-order.mjs`](../../impl/src/canonical-order.mjs),
[`phase63-canonical-order-authority.test.mjs`](../../impl/test/phase63-canonical-order-authority.test.mjs#L89)).

### 2. Event Stores and Projectors

**Owns**

- an Operational Log with per-worker sequence, archive, retention, and worker-event framing;
- a separate Coordination Journal with control-event admission, writer generation, replay,
  quarantine, checkpoints, compaction, and migration;
- store-specific atomic append, checksums, recovery, and fault handling;
- the recorded schema and policy basis each replay uses, and the cause classification of every row
  it refuses;
- source-specific replay folds, projection checkpoints, subscription cursors, and materialized views;
- bounded queries for runs, workers, plans, workflows, swarms, attention, knowledge, contributions,
  verification, and recovery;
- the wake stream as a cursor over committed Coordination Journal rows.

**Forbidden from owning**

- command admission, scheduling, provider sessions, Git mutation, verification execution, or
  transport presentation;
- an effect that cannot be represented as an append transaction in its owning store;
- a projection whose source cursor is unknown;
- policy decisions based on wall-clock polling;
- diagnosing corrupt history, or recommending a repair, from a validation basis it cannot
  reconstruct.
- a shared writer, sequence, segment, compaction frontier, quarantine state, or recovery transaction
  across the Operational Log and Coordination Journal.

The Operational Log and Coordination Journal are separate storage systems inside one ownership
boundary. They share Domain Kernel record types and digest versions, while each retains its own
writer, durability protocol, sequence, file format, archive, recovery, and fault boundary. A
projector may correlate typed references and cursors from both stores; it cannot copy rows between
them or create a cross-store atomic transaction. Operational worker streams retain gap-free
per-worker sequence and their archive policy
([`log.test.mjs`](../../impl/test/log.test.mjs#L43)). Control partitions retain ledger replay,
quarantine, canonical-order migration, and prospective fold admission
([`coordination-ledger.test.mjs`](../../impl/test/coordination-ledger.test.mjs#L383),
[`coordination-admission.test.mjs`](../../impl/test/coordination-admission.test.mjs#L362)). A
projector can be rebuilt from a checkpoint plus a verified suffix.

### 3. Scheduler

**Owns**

- the versioned plan graph for goals, tasks, workflow roles, waves, swarm work, dependencies, and
  attempts;
- typed parent-child agent relations, per-agent information scopes, and explicit knowledge-promotion
  edges;
- admission of commands against current plan state and policy values;
- structured task scopes, joins, cancellation, supervision policy, and per-member settlement;
- route selection requests, worker assignment, pause and resume state, pending interaction state,
  and contribution workflow state;
- physical resource lease requests and waiting policy, including the #541 rule that worker admission
  never refuses for host load or waiting;
- one Reconciler task that compares durable intent with observed external evidence at startup and
  after disconnects.

**Forbidden from owning**

- child processes, provider protocol framing, worktree mutation, durable files, verification
  execution, or transport-specific payloads;
- mutable state that has no corresponding owning-store event or live affine handle;
- direct calls to CLI, MCP, Web, or optional capability implementations;
- recovery based only on elapsed time when durable evidence can decide the outcome;
- automatic knowledge promotion, reading across deliberately separated agent scopes, or flattening
  parent-child authority into an undifferentiated participant set.

The scheduler replaces the control portions of `Coordinator`, `SwarmRuntime`, wave driver, workflow
interpreter, goal plan, orchestrator plan, task topology, and run lineage. The supervised task API
must be implemented and tested under LANG-CAP-09 before these runtime deletions. The migration must
disposition stall, nudge, claim recovery, settle, and selective-stop behavior under the approved laws,
using the behavior pinned in
[`wave-driver-red.test.mjs`](../../impl/test/wave-driver-red.test.mjs#L135).

The unified graph shares scheduling mechanics. It retains information and authority boundaries as
typed graph edges. Knowledge moves from one agent scope to another only through an admitted
promotion operation that records its source and destination. A parent-child relation remains a
distinct relation with its own delegation and visibility rules. The current anchors are the
reader-relative exposure and ancestry walk in
[`swarm-runtime.mjs`](../../impl/src/swarm-runtime.mjs#L3279), the subtree projection assertion in
[`swarm-delegated-completion.test.mjs`](../../impl/test/swarm-delegated-completion.test.mjs#L174),
and the explicit-promotion assertion in
[`kg-settlement-red.test.mjs`](../../impl/test/kg-settlement-red.test.mjs#L368).

### 4. Worker Gateway

**Owns**

- provider and harness capability cards;
- child process and remote session lifetime, stdout and stderr framing, size limits, close/reap, and
  process evidence;
- JSON-RPC, ACP, OMP, app-server, CLI, and provider-specific codecs;
- permission and interaction frames, session resume tokens, usage normalization, and provider fault
  classification;
- provider polling and processing tasks under scheduler-provided supervision policy.

**Forbidden from owning**

- plan state, contribution state, worktree custody, route policy, verification decisions, or public
  command schemas;
- its own durable event store;
- provider-independent admission rules;
- a process or session after its affine `WorkerSession` has been consumed or cancelled.

This subsystem merges the Adapter surface, adapter card contract, CLI adapters, persistent sessions,
ACP/OMP processes, process lifecycle, and provider supervisors. Protocol differences remain typed
codec variants. The shared process owner carries the exact-close latch behavior tested by
`acp-json-rpc-process.test.mjs`, `omp-process-truth.test.mjs`, and `omp-rpc-red.test.mjs`.

### 5. Workspace and Artifacts

**Owns**

- repository identity, Git worktrees, sparse checkout, runtime homes, checkout cleanup, and disk
  capacity accounting;
- the shared physical resource lease substrate for host verification budgets, worktree reservations,
  owner publication, incarnation checks, dead-holder reap, and derived floors;
- checked workspace custody and its durable generation receipts;
- immutable snapshots, context packs, source references, result exports, provenance, and artifact
  retention;
- secret screening, content bounds, canonical artifact identity, and materialization into a scoped
  workspace;
- evidence links from an artifact to its owning-store event, command, source snapshot, and producer.

**Forbidden from owning**

- plan scheduling, provider route selection, contribution approval, verification verdicts, public
  transport commands, or event-store policy;
- deletion of a workspace while any live or durable holder remains;
- an artifact without a content digest and provenance reference;
- execution of provider or verifier commands.

This subsystem absorbs worktree, runtime isolation, workspace snapshot, context materialization,
result export, context result lineage, and shared-workspace custody. Every effect checks its lease
against issuance, scope, generation, and the holder set. Explicit release and observed cleanup
settle custody. The retained
behavior is pinned by `shared-workspace-custody.test.mjs`,
`issue428-worktree-custody-on-stop.test.mjs`, `workspace-preservation.test.mjs`, and
`phase66-result-export-adversarial.test.mjs`.

### 6. Verification and Landing

**Owns**

- immutable verification requests containing executable, arguments, working directory, environment,
  expected result, source commit, and requester identity;
- verifier isolation and execution evidence;
- a background structural scanner that reads the change source snapshot and derives the effects,
  ownership edges, transitive imports, and calls the change reaches;
- gate selection from the scan result, bound to the source snapshot and the scanner version;
- contribution contracts, independent review verdicts, dependency checks, integration, result
  adoption, and landing receipts;
- one publication operation with one owner, from local preparation through shared delivery: it binds
  the admitted repository authority, the designated shared endpoint and target ref, the expected
  shared target state, and the verified commit, and it records completion only from an independent
  observation of that endpoint;
- recovery of interrupted verification, integration, and publication from Coordination Journal
  evidence.

**Forbidden from owning**

- the contributor's worker session, scheduler policy, provider routing, public surface rendering, or
  workspace custody outside a scoped verifier lease;
- accepting a contributor's reported test result as execution evidence;
- selecting gates from anything other than the scan result bound to the submitted source snapshot;
- reviewing or approving a contribution under the same authority that authored it;
- integrating a commit that differs from the verified commit.
- reporting shared-destination completion from a local compare-and-swap, a local integration
  receipt, or an unrevalidated destination identity.

This subsystem merges contribution service, contribution verification, referee, landing table,
verification selection, diagnostics, result adoption, and integration effects. The committed AST
inventory and hard-coded member tables disappear. A Bend2 structural scanner runs in the background
against the submitted source snapshot and derives the effects, ownership edges, transitive imports,
and calls that snapshot reaches. The gate selector consumes that scan result, and the selected
tests under the target comparison decide the landing. The recovery result distinguishes executed
failure, infrastructure failure, interrupted execution, and absence of
execution as required by
[`docs/41-verification-recovery-review.md`](../41-verification-recovery-review.md#L69).
The current structural and gate-selection anchors are
[`seam-inventory.test.mjs`](../../impl/test/seam-inventory.test.mjs#L145) and
[`issue463-integrate-gate-paths.test.mjs`](../../impl/test/issue463-integrate-gate-paths.test.mjs#L249).

`ChangeScanResult` is the evidence-bearing result of one scan over one source snapshot. LANG-F-28's
second-producer probe shows that a shared return type establishes no unique producer. The consumer
must validate the source snapshot, scanner version, coverage result, and gate mapping. A stale or
incomplete scan cannot authorize gate selection or integration.
The background job may run asynchronously while review waits for its result. The scanner must
follow transitive imports and calls to affected effects; unknown reachability produces a typed
unresolved result that widens the gate set. Tests must show that changing the snapshot
invalidates the earlier result (ARCH-CLOSE-09).

### 7. Northbound Gateway

**Owns**

- the single versioned command and query protocol presented through CLI, MCP, Web, and embedded
  clients;
- transport authentication, session binding, request decoding, response encoding, streaming,
  pagination presentation, help, and exit status;
- compatibility aliases with an explicit version and removal point;
- the mapping from domain refusal variants to each transport's wire form.

**Forbidden from owning**

- scheduling, event-store mutation other than submitting a command, process ownership, Git mutation,
  verification execution, capability implementation, or business policy;
- optional duck-typed fallback calls into coordinator methods;
- transport-specific copies of command semantics or refusal classification;
- globally installed convergence hooks.

This subsystem replaces `BatonApplication`, `application-client`, application semantics copies,
CLI, MCP, Web, native bridge, surface catalogs, and production surface wrappers. The protocol is one
typed definition with transport codecs. HTTP authentication, MCP framing, CLI behavior, and Web
streaming remain codec-owned parameters.

### 8. Capability Services

**Owns**

- optional capabilities such as Atlas indexing and rewriting, browser use, advisory feeds, LSP,
  representation production, supply-chain queries, and future tools;
- capability-specific dependencies, versions, language support, cost evidence, continuation tokens,
  and reverification;
- a bounded `CapabilityCall -> CapabilityResult` protocol;
- capability health and availability evidence.

**Forbidden from owning**

- scheduler state, event-store format, worktree custody, provider worker sessions, verification authority,
  or northbound command semantics;
- core deployment initialization through static imports;
- a bearer string that any in-process caller can mint;
- unbounded results or receipts without an underlying version.

The Atlas modules first merge their native version and language maps into one substrate. They then
run behind the capability protocol. This keeps per-operation support precise and removes native
parser loading from the core deployment.

## Synchronization seams

There are eight subsystems, yielding 28 unordered pairs. Every pair is listed here. `None` means the
architecture permits no direct runtime synchronization for that pair; the named intermediary owns
the exchange.

| Pair | Synchronization seam |
| --- | --- |
| Domain Kernel / Event Stores and Projectors | None. The subsystem imports pure event, codec, digest, and fold types from Kernel. |
| Domain Kernel / Scheduler | None. Scheduler imports pure plan transitions, policies, and affine handle definitions. |
| Domain Kernel / Worker Gateway | None. Worker Gateway imports protocol variants, bounds, and evidence types. |
| Domain Kernel / Workspace and Artifacts | None. Workspace imports identifiers, provenance, lease, and artifact types. |
| Domain Kernel / Verification and Landing | None. Verification imports request, verdict, contribution, and receipt types. |
| Domain Kernel / Northbound Gateway | None. Northbound imports the versioned command and refusal protocol. |
| Domain Kernel / Capability Services | None. Capability services import call, result, receipt, and availability variants. |
| Event Stores and Projectors / Scheduler | Store-specific `AppendTransaction<OperationalEvent \| CoordinationEvent>` in one direction; store-specific `SubscriptionCursor<ViewDelta>` in the other. Scheduler waits for the owning store's commit acknowledgement before publishing success. |
| Event Stores and Projectors / Worker Gateway | `OperationalEventBatch<WorkerEvent>` and an Operational Log sequence acknowledgement. The gateway cannot append control events or query scheduler state through this seam. |
| Event Stores and Projectors / Workspace and Artifacts | Coordination Journal `ArtifactRecorded` and `CustodyReceipt` events carry immutable references. Append paths receive references and never read artifact bytes. |
| Event Stores and Projectors / Verification and Landing | Coordination Journal `VerificationEvent`, `ContributionEvent`, `IntegrationEvent`, and subscription cursors for recovery. Operational Log evidence remains a typed reference. |
| Event Stores and Projectors / Northbound Gateway | `QueryRequest<View, Cursor>` and bounded `QueryPage<View>`. Each cursor names its source store; commands route through Scheduler. |
| Event Stores and Projectors / Capability Services | Store-specific `CapabilityEvent` and `EvidenceRef`; health projection reads committed events through their source cursors. |
| Scheduler / Worker Gateway | Checked `WorkerSession` plus typed command/event channels. A cancel request records intent; close and reap outcomes acknowledge the actual child state. Consuming or dropping a session does not acknowledge cleanup. |
| Scheduler / Workspace and Artifacts | Checked `ResourceLease` and `WorkspaceLease`, immutable `SnapshotRef`, `ArtifactRef`, and `CustodyReceipt`. The effect checks issuance, generation, and holders; resource-kind policy carries the host worker admission law. |
| Scheduler / Verification and Landing | Immutable `VerificationRequest` and `ContributionRef`; Verification returns `ChangeScanResult`, `VerificationOutcome`, or `LandingOutcome`. |
| Scheduler / Northbound Gateway | `CommandEnvelope -> CommandReceipt` and `ControlStream`. Gateway authentication produces a principal value consumed by command admission. |
| Scheduler / Capability Services | Checked `Capability` plus `CapabilityCall -> CapabilityResult`; the service validates issuance and scope, and scheduler owns retry and continuation policy. |
| Worker Gateway / Workspace and Artifacts | Scoped runtime descriptor, input `ArtifactRef`, output `ArtifactRef`, and `ProcessEvidence`. A workspace lease is passed through Scheduler. |
| Worker Gateway / Verification and Landing | None. Verification executes through its own isolated executor. Scheduler correlates worker results with verification requests. |
| Worker Gateway / Northbound Gateway | None. Live provider interaction is represented as scheduler commands and event-store projections. |
| Worker Gateway / Capability Services | None. A capability can call a provider only through a scheduler-owned worker session. |
| Workspace and Artifacts / Verification and Landing | Scoped verifier `WorkspaceLease`, source `SnapshotRef` for the structural scan, `EvidenceRef`, `ResultRef`, and `LandingReceipt`. |
| Workspace and Artifacts / Northbound Gateway | `ArtifactReadRequest -> BoundedArtifactChunk` for authorized downloads. Scheduler supplies the authority reference. |
| Workspace and Artifacts / Capability Services | Scoped read lease, `ArtifactRef`, and returned `EvidenceRef`. Capability services never receive unscoped repository paths. |
| Verification and Landing / Northbound Gateway | None. Gateway reads verification projections and submits commands through Scheduler. |
| Verification and Landing / Capability Services | `ReverifyEvidenceRequest -> ReverifyEvidenceResult` for capability receipts cited by a contribution. |
| Northbound Gateway / Capability Services | None. Capability calls route through Scheduler so policy, authority, and evidence share one path. |

## Authority and recovery rules

Affinity bounds use of one value. Issuance and consumption checks apply inside the process as well
as across these four durable boundaries until ARCH-CLOSE-02 proves a replacement:

1. a command arriving over CLI, MCP, Web, or another process carries a generation and idempotency key;
2. each event store uses its own writer generation and atomic compare-and-swap for append;
3. a workspace lease has a durable holder record and generation;
4. an external process or provider session produces start, ready, close, and reap evidence.

The Reconciler operates on durable intent and evidence, and keeps four facts distinct for every
outstanding effect:

1. **operation identity** — the logical operation a caller asked for, unchanged across retries and
   restarts, and the identity duplicate detection keys on;
2. **attempt identity** — one dispatch of that operation, recorded before dispatch, so two attempts
   are distinguishable in the evidence;
3. **local ownership** — the language value, generation, or lease the current process holds;
4. **observed external outcome** — what effect-specific evidence shows happened, such as a
   destination observation, process evidence, or a provider response.

An unreachable, consumed, or expired local value changes only the third fact. It establishes nothing
about the operation, the attempt, or the outcome, so it never justifies repeating an external
effect. Settlement or retry requires evidence about the effect itself and either a justified retry
or a newly authorized action; no generic retry rule replaces an effect-specific protocol.
Generation and exclusivity checks apply at the protected effect, with the atomicity or interprocess
serialization that the effect's substrate provides. Reissuing authority additionally requires an
owning-store generation transition, revocation of the previous grant, and reconciliation of the
outstanding effects. Outcome-unavailable stays unresolved until that evidence permits settlement or
retry, and it keeps a continuation owner under M-17.

A replay refusal is not by itself a corruption finding. Startup, doctor, and recovery validate
against one recorded schema and policy basis, and every refusal names the basis it used and
classifies the cause: a missing or unreconstructible policy basis, an unsupported decoder version, a
projection defect, or corrupt source bytes. Only corrupt source bytes enter quarantine, and
quarantine preserves the refused bytes.

## Native prerequisites and closure conditions

Every row below is **open** in this reconciliation. The subsystem owner supplies an immutable
implementation snapshot, commands and observed outputs, positive cases, failing controls, and
independent review for the stated obligation. Existing JavaScript tests specify behavior to carry;
passing them alone does not establish the native replacement. The rewrite plan must cite these
IDs for each affected deletion and record the evidence that closes them.

| ID | Affected findings and owner | Required closure evidence |
| --- | --- | --- |
| ARCH-CLOSE-01 | All affected migration phases; architecture reviewer and plan lead | Record the external Codex architecture verdict, reviewed commit and artifact hashes; map every finding to a correction, prerequisite, or unresolved decision. Obtain an explicit disposition for each affected phase. The law verdict at `1fab9a1d` is already approved. |
| ARCH-CLOSE-02 | F8, F18, F20 and all authority-bearing interfaces; Domain Kernel with Workspace and each consuming owner | Address LANG-F-26/28 with a demonstrated proof-indexed capability or language extension before deleting authority checks. Positive issuance/use/release must pass; forged constructors, duplicate issuance for one resource, second producers, cross-scope use, stale generations, and replay after revocation must fail at the documented boundary. Retain runtime admission for every obligation the type proof does not cover. |
| ARCH-CLOSE-03 | F5, F7, F9, F21 and task-scope deletions; Scheduler and Worker Gateway | Implement LANG-CAP-09 cancellation and supervision with explicit cancel intent, join outcome, child accounting, and observed close/reap. Run native cases for a dropped join channel, normal completion, error, selective stop, parent failure, late child output, and restart. Every accepted child remains owned until a terminal or recoverable unresolved outcome is recorded; dropping a handle cannot claim cleanup. |
| ARCH-CLOSE-04 | F2's retained stores, F18, F20, F24; Event Stores and Workspace | Supply LANG-CAP-01 durability and metadata operations: safe creation, directory enumeration, metadata/permissions, atomic publication and rename, file and directory sync, and required link operations. Fault-inject before and after append, sync, rename, and acknowledgement; verify recovery, original corrupt-byte preservation, writer exclusion, and holder safety. Operational Log and Coordination Journal must retain independent sequences, writers, recovery and fault handling. |
| ARCH-CLOSE-05 | F6, F9, F14, F18, F24; Worker Gateway, Workspace and Verification | Complete LANG-CAP-05 process effects: nonblocking spawn, concurrent stdout/stderr, exit and signal status, cancellation, wait/reap, process incarnation and restart recovery. Verify readiness failures, cancellation during IO, PID reuse, and child exit before acknowledgement. Preserve exact executable, argv, working directory, route, result, and cleanup evidence for provider, Git and verifier invocations. |
| ARCH-CLOSE-06 | F6, F11, F23; Northbound and Worker Gateways | Complete LANG-CAP-08 HTTP, HTTPS/TLS, WebSocket and bridge framing with native dependencies recorded. Test real client/server exchange, certificate/hostname rejection, authentication, partial and malformed frames, reconnect cursors, backpressure with continuation, and provider stream cancellation. Base TCP and JSON evidence supplies only the byte/framing primitives. |
| ARCH-CLOSE-07 | F8, F11, F16, F20, F22 and tokens, digests, receipts; Domain Kernel plus native effect owners | Complete LANG-CAP-10 hashing, HMAC, secure randomness, constant-time comparison and required signature operations through audited native effects. Record dependency versions, known-answer vectors, rejected invalid inputs, entropy failure handling, and review of comparison and secret handling. Bind digest versions to historical replay and receipt identity; `IO.random_u32` alone does not satisfy this contract. |
| ARCH-CLOSE-08 | F4; Scheduler | Test explicit knowledge promotion with source/destination attribution, reader-relative isolated views, and parent-child delegation before and after restart. Preserve distinct ID variants and historical graph decoding. A unified scheduler must reject cross-scope reads and child authority elevation. Cite the plan, knowledge and delegated-completion fixtures with native equivalents. |
| ARCH-CLOSE-09 | F16/F17; Verification and Landing | Implement the independent structural scan and consumer validation of its result for the exact source snapshot. Demonstrate transitive effect coverage, including a changed call that reaches a further effect, unsupported syntax, a missing scan, a stale snapshot, and altered gate mappings. Cover a pure decision helper change, a schema change, a shared library change, and an altered C effect; each selects the contracts and tests its change reaches, and unknown reachability widens the gate set with a typed unresolved result. Delete the committed inventory only after coverage is demonstrated against the existing gate-selection fixtures. |
| ARCH-CLOSE-10 | F2's retained stores, F18, F20; Event Stores and Workspace | Inventory the native journal and replacement operations and define the supported-platform durability contract: supported platforms and filesystems, append and partial-write behavior, file synchronization, atomic replacement, directory persistence, interprocess serialization, and stale-writer exclusion. Fault-inject crash and concurrent writers at each step. The `File` surface's fixed-width quantities require a segmentation and chunking design for large logical journals, so a segment size never becomes an unexplained maximum on retained history. |
| ARCH-CLOSE-11 | F9, F13, F22 and the diagnostic paths; Event Stores and recovery owner | Give startup, doctor, and recovery one recorded schema and policy basis and a cause classification. Drive the same valid ledger through all three entry points and require equivalent logical projections. A missing or unreconstructible basis refuses to diagnose corruption and refuses to recommend destructive repair; it reports the basis it could not reconstruct. |
| ARCH-CLOSE-12 | F16 and the landing path; Verification and Landing with Workspace and Artifacts | Own the whole publication operation against the admitted destination: validate the destination's identity before dispatch, claim completion only from evidence about that destination's content at the target rather than from a ref read or a push acknowledgement, and record which of holds-the-ref, superseded-but-preserved, or absent the receipt asserts. Cover destination substitution, a lost response reconciled without a second effect, target contention on both the local compare-and-swap and the destination update, and an absent destination. The corpora in `examples/arch-publish-*.evidence.md` measure these at the pin; the deployment's own publication path must reproduce them before Phase 4 moves publication authority. |

LANG-CAP-01, LANG-CAP-08, LANG-CAP-09, and LANG-CAP-10 are mandatory host prerequisites.
LANG-CAP-05 supplies the related process prerequisite. Their current capability evidence is in
[`language-review.md`](language-review.md),
[`lang-host-interop.evidence.md`](examples/lang-host-interop.evidence.md),
[`lang-host-concurrency.evidence.md`](examples/lang-host-concurrency.evidence.md), and
[`c-only-spawn.evidence.md`](examples/c-only-spawn.evidence.md). The native spawn example establishes
a limited blocking command; streaming, cancellation, process ownership, and reap remain open.

The external review directory `/tmp/baton-bend2-laws-review/architecture` currently contains input
documents and probes. `codex-native-surface-checks.json` records missing Base `File.fsync`,
`File.rename`, and `IO.cancel` names. `codex-probes/dropped-child-results.json` records a native
program printing `parent returned without joining` followed by `child continued` after its
`IO.fork` channel is dropped. These observations support ARCH-CLOSE-03/04. They are review evidence
awaiting the final verdict and repository evidence records; they close no prerequisite.

## Migration deletions

The rewrite reaches this architecture only when the following artifacts are absent from the new
core:

- class delegate tables and tests that assert source names, arities, or one-line forwarding bodies;
- `holistic-runtime`, `index-converged`, and production convergence decorators;
- the unused `holistic-runtime.EventJournal` prototype and every compatibility path that selects it;
- `FenceTable`, exported northbound capability strings, and in-memory custody inference;
- per-provider timer supervisors and repeated child-process close latches;
- independent goal-plan, orchestrator-plan, workflow, wave, and swarm schedulers;
- application, coordinator, store, and swarm observation scans outside projectors;
- local canonical, exact, clone, freeze, fixed-point currency, and lineage validator copies;
- the committed generated seam inventory, hard-coded member counts, and delegate-bijection tests;
- static imports of optional capability dependencies from the core deployment.

BATON2 retains the background structural scanner owned by Verification and Landing. The scanner
reads the change source snapshot and emits a per-change `ChangeScanResult`. Its durable output is a
check result bound to one source snapshot, scanner version, and gate set.

Deleting an item before its owner and synchronization seam exist would remove the behavior named in
[`architecture-review.md`](architecture-review.md). The rewrite plan must therefore sequence each
deletion after its target subsystem passes the cited behavior tests and replay fixtures.
