# Baton2 target architecture

## Design constraints

BATON2 is written entirely in Bend2 and runs on HVM. Its final deployment contains no JavaScript,
Node runtime, or JavaScript host for processes, sockets, files, Git, or transports. A missing Bend2
host effect is a rewrite prerequisite or a go/no-go reason; it does not create a permanent host
layer.

BATON2 keeps Baton's durable laws and removes boundaries created by class extraction, dynamic
JavaScript checks, Node process plumbing, and successive compatibility layers. The language and
runtime assumptions are limited to the pinned Bend2 reference in
[`reference/README.md`](reference/README.md) and compiled evidence recorded by
[`language-review.md`](language-review.md). A capability that is not proven there remains an
implementation risk for the rewrite plan.

The architecture has eight subsystems. Every mutable fact has one owner. Cross-subsystem values are
immutable records, affine leases, event-store references, or typed command/result channels. A
subsystem may cache a value owned elsewhere only as a projector with a recorded source cursor.

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

The operator approved `F1`, `F3`, `F5` through `F15`, and `F18` through `F24`. The target applies
three specific decisions to the remaining findings:

- `F2` is rejected. The operational `Log` and `CoordinationStore` remain separate storage systems.
  BATON2 deletes only the unused `holistic-runtime.EventJournal` prototype and the compatibility
  code attached to it.
- `F4` is conditional. One Scheduler may own the plan graph only while knowledge promotion remains
  an explicit operation, deliberately separated agents retain separate information views, and
  parent-child agent relations remain represented and enforced.
- `F16` and `F17` use a checked declaration. Every change declares its affected effects and paths in
  a typed field. A background structural scan compares that declaration with the code shape and
  records a typed mismatch. Gate selection consumes only the checked result.

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
| `FenceTable`, custody booleans, opaque startup tokens, drain tokens, and northbound bearer strings | Delete the in-process emulation. Domain Kernel defines affine leases and capabilities; durable generations remain journal facts. |
| `host-capacity` and `worktree-capacity` publication protocols | Delete both implementations. Workspace and Artifacts owns one resource lease substrate with resource-specific floor policy. |
| `holistic-runtime`, `index-converged`, and `production-*` wrapper succession | Delete the parallel runtimes and decorators. The eight runtime subsystems below form the only deployment. |
| Seam inventory generator, committed inventory, delegate bijection tests, and landing-table inventory branch | Delete the committed textual inventory and hard-coded member tables. Verification and Landing owns a typed change declaration plus a background structural scanner; a mismatch refuses gate selection. |
| ESM re-export shims, Node timer loops, hand-written WebSocket server, `v8.serialize` repair, `/bin/ps` lease probe, and event-loop yield choreography | Delete the Node-specific machinery. Bend2 host effects and structured parallel tasks supply the required operations. |
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
- affine value definitions such as `TurnLease`, `WorkerSession`, `WorkspaceLease`,
  `PendingInteraction`, and `Capability`;
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
interpreter, goal plan, orchestrator plan, task topology, and run lineage. First-class parallel tasks
carry the supervision policy now implemented by the wave poll loop. The policy must preserve stall,
nudge, claim recovery, settle, and selective-stop behavior pinned in
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
- affine workspace custody and its durable generation receipts;
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
result export, context result lineage, and shared-workspace custody. An affine lease controls live
use; a serialized generation and holder set protect restart and multi-process cases. The retained
behavior is pinned by `shared-workspace-custody.test.mjs`,
`issue428-worktree-custody-on-stop.test.mjs`, `workspace-preservation.test.mjs`, and
`phase66-result-export-adversarial.test.mjs`.

### 6. Verification and Landing

**Owns**

- immutable verification requests containing executable, arguments, working directory, environment,
  expected result, source commit, and requester identity;
- verifier isolation and execution evidence;
- the typed affected-effect and path declaration supplied by each change;
- a background structural scanner that derives the effects and ownership edges present in the
  changed code;
- comparison of the declaration with the scan, including a typed mismatch that names the undeclared
  or unsupported effect;
- gate selection from `CheckedChangeImpact`, which exists only after the declaration and structural
  scan agree;
- contribution contracts, independent review verdicts, dependency checks, integration, result
  adoption, and landing receipts;
- recovery of interrupted verification and integration from Coordination Journal evidence.

**Forbidden from owning**

- the contributor's worker session, scheduler policy, provider routing, public surface rendering, or
  workspace custody outside a scoped verifier lease;
- accepting a contributor's reported test result as execution evidence;
- selecting gates from an unchecked declaration or from scanner output that has no author
  declaration;
- allowing a declaration-versus-scan mismatch to proceed to review or integration;
- reviewing or approving a contribution under the same authority that authored it;
- integrating a commit that differs from the verified commit.

This subsystem merges contribution service, contribution verification, referee, landing table,
verification selection, diagnostics, result adoption, and integration effects. The committed AST
inventory and hard-coded member tables disappear. A Bend2 structural scanner runs in the background
against the submitted source snapshot and checks the change's typed declaration. A mismatch is a
typed refusal with the declaration, observed shape, affected field, and remedy. Both inputs are
mandatory, and the gate selector accepts their resulting `CheckedChangeImpact`. The recovery result
distinguishes executed failure, infrastructure failure, interrupted execution, and absence of
execution as required by
[`docs/41-verification-recovery-review.md`](../41-verification-recovery-review.md#L69).
The current declaration anchor is the plan node's `effects` field in
[`coordinator-plan-effects-red.test.mjs`](../../impl/test/coordinator-plan-effects-red.test.mjs#L166).
The current structural and gate-selection anchors are
[`seam-inventory.test.mjs`](../../impl/test/seam-inventory.test.mjs#L145) and
[`issue463-integrate-gate-paths.test.mjs`](../../impl/test/issue463-integrate-gate-paths.test.mjs#L249).

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
| Event Stores and Projectors / Scheduler | Store-specific `AppendTransaction<OperationalEvent | CoordinationEvent>` in one direction; store-specific `SubscriptionCursor<ViewDelta>` in the other. Scheduler waits for the owning store's commit acknowledgement before publishing success. |
| Event Stores and Projectors / Worker Gateway | `OperationalEventBatch<WorkerEvent>` and an Operational Log sequence acknowledgement. The gateway cannot append control events or query scheduler state through this seam. |
| Event Stores and Projectors / Workspace and Artifacts | Coordination Journal `ArtifactRecorded` and `CustodyReceipt` events carry immutable references. Append paths receive references and never read artifact bytes. |
| Event Stores and Projectors / Verification and Landing | Coordination Journal `VerificationEvent`, `ContributionEvent`, `IntegrationEvent`, and subscription cursors for recovery. Operational Log evidence remains a typed reference. |
| Event Stores and Projectors / Northbound Gateway | `QueryRequest<View, Cursor>` and bounded `QueryPage<View>`. Each cursor names its source store; commands route through Scheduler. |
| Event Stores and Projectors / Capability Services | Store-specific `CapabilityEvent` and `EvidenceRef`; health projection reads committed events through their source cursors. |
| Scheduler / Worker Gateway | Affine `WorkerSession` plus typed command/event channels. Cancelling or consuming the session closes its child task scope. |
| Scheduler / Workspace and Artifacts | Affine `ResourceLease` and `WorkspaceLease`, immutable `SnapshotRef`, `ArtifactRef`, and `CustodyReceipt`. Resource-kind policy carries the host worker admission law. |
| Scheduler / Verification and Landing | Immutable `VerificationRequest`, `ContributionRef`, and `EffectDeclaration`; Verification returns `CheckedChangeImpact`, `VerificationOutcome`, or `LandingOutcome`. |
| Scheduler / Northbound Gateway | `CommandEnvelope -> CommandReceipt` and `ControlStream`. Gateway authentication produces a principal value consumed by command admission. |
| Scheduler / Capability Services | Affine `Capability` plus `CapabilityCall -> CapabilityResult`; scheduler owns retry and continuation policy. |
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

Affine values remove repeated in-process checks only inside one typed execution. Four boundaries still
need durable authority:

1. a command arriving over CLI, MCP, Web, or another process carries a generation and idempotency key;
2. each event store uses its own writer generation and atomic compare-and-swap for append;
3. a workspace lease has a durable holder record and generation;
4. an external process or provider session produces start, ready, close, and reap evidence.

The Reconciler operates on durable intent and evidence. It may mint a new affine value after proving
the prior value is expired, consumed, or unreachable. It records the proof before repeating an
external effect. Ledger corruption enters quarantine; recovery never rewrites the refused source
bytes.

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
checks typed change declarations and emits per-change `CheckedChangeImpact`. Its durable output is a
check result bound to one source snapshot, declaration digest, scanner version, and gate set.

Deleting an item before its owner and synchronization seam exist would remove the behavior named in
[`architecture-review.md`](architecture-review.md). The rewrite plan must therefore sequence each
deletion after its target subsystem passes the cited behavior tests and replay fixtures.
