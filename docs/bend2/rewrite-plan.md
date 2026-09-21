# Bend2 rewrite plan

## Status and inputs

This plan is a migration design. It does not authorize changes to `impl/src` or a production
cutover. The operator makes that decision after the three review work items and
[`go-no-go.md`](go-no-go.md) are complete.

The plan uses these current sources:

- [`MANDATE.md`](MANDATE.md) defines the scope and the required decision.
- [`../../impl/CLI.md`](../../impl/CLI.md) and [`../../impl/MCP.md`](../../impl/MCP.md) define the
  public operation surfaces that must remain compatible during migration.
- [`../../impl/scripts/seam-inventory.json`](../../impl/scripts/seam-inventory.json) classifies
  2,670 members in 22 modules across the admission, effect, observation, recovery, and surface
  seams. The inventory supplies migration coverage. The architecture review decides which of
  those seams should remain in the target.
- [`../../impl/src/contribution-contract.mjs`](../../impl/src/contribution-contract.mjs),
  [`../../impl/src/landing-table.mjs`](../../impl/src/landing-table.mjs),
  [`../../impl/src/swarm-runtime.mjs`](../../impl/src/swarm-runtime.mjs), and
  [`../../impl/src/worktree.mjs`](../../impl/src/worktree.mjs) implement the current contribution
  landing path.
- [`../../impl/test/issue296-swarm-integrate.test.mjs`](../../impl/test/issue296-swarm-integrate.test.mjs)
  proves the landing path's merge-base rule, isolated squash, derived gates, dry run, typed
  refusals, durable receipt, replay, and single-landing behavior.
- [`reference/README.md`](reference/README.md) pins `bendlang/bend` at
  `a49524265bdfa5753a4bf38e25f0574a705dd868` and the Bend 2.0.25 toolchain.

The following inputs are pending. This plan does not fill their findings in advance:

- **LANGUAGE-FINDINGS-PENDING:** [`language-review.md`](language-review.md) and its compiled
  `examples/lang-*` evidence.
- **ARCHITECTURE-FINDINGS-PENDING:** [`architecture-review.md`](architecture-review.md) and
  [`target-architecture.md`](target-architecture.md).
- **LAW-FINDINGS-PENDING:** [`laws.bend`](laws.bend), [`laws-trace.md`](laws-trace.md), and their
  compiled evidence.

Phase 0 incorporates those inputs before rewrite implementation starts. The plan targets
**baton2**, the simplified architecture produced by the architecture review. It does not port the
current subsystem list one for one. The review may change the provisional subsystem grouping or
stop the plan after Phase 1. The target remains a Baton written entirely in Bend2. The boundary and
proof requirements remain applicable to the revised phases.

## Migration rules

Every phase follows these rules:

1. One implementation owns each decision and each effect at a time. Shadow evaluation may compute
   a second result, but only the selected authority can append events or request effects.
2. JavaScript and Bend2 exchange closed, versioned values through the temporary boundary described
   below. They do not share mutable in-memory state. Each boundary operation names the phase that
   deletes it.
3. The durable ledger remains the recovery source. Both implementations must decode every event
   present at the phase boundary before authority changes.
4. Host effects use a request and receipt pair. The decision core records the request identity
   before execution and records the receipt after observation.
5. A phase advances only after its named proving test passes and `npm test --prefix impl` exits 0.
6. A rollback changes authority at a phase boundary and replays the durable ledger. It does not
   rewrite or discard accepted ledger rows. The last phase deletes the rollback bridge and Node
   runtime after its declared rollback window closes.
7. Public CLI and MCP operation names, request shapes, refusal codes, cursor behavior, and result
   shapes stay compatible until an operator approves a separately versioned public API.
8. Each phase includes failure injection for process exit, truncated messages, duplicate requests,
   stale cursors, effect timeout, and restart during an unsettled operation.

## Coexistence boundary

The migration uses a local protocol named `baton.bridge.v1`. Phase 0 freezes its fixtures and
schema. The transport choice is filled from **LANGUAGE-FINDINGS-PENDING**. The logical contract is
independent of that transport. This protocol is a migration mechanism. Phase 7 deletes it, its
transport, every JavaScript adapter, and the Node runtime.

### Value rules

- Messages are closed records. Each record contains `protocol`, `kind`, and the fields declared for
  that `kind`. An unknown field, missing field, or invalid closed-set value produces a typed
  boundary refusal.
- Strings are UTF-8. Digests and commit identities use lowercase hexadecimal strings. Quantities
  that can exceed JavaScript's safe integer range use decimal strings. Other integer fields remain
  within the JSON safe-integer range.
- Object keys have one canonical order for digest input. Arrays retain their declared order.
- Every request carries `requestId`, `operation`, `principal`, `arguments`, `basisCursor`,
  `inputDigest`, and the explicit observations used by the decision. Time, random values, host
  capacity, configuration, and repository state enter as observations.
- Every answer echoes `requestId`, `basisCursor`, and `inputDigest`. It contains one of
  `accepted`, `refused`, or `effects_required`.
- A refusal contains `code`, `message`, and a closed `detail` record. Public refusal codes continue
  to use the current surface vocabulary.

### Decision exchange

`DecisionRequest` asks the selected core to validate and decide one operation. Its answer is:

- `accepted`: an ordered `EventProposal` batch plus the projected result;
- `refused`: a typed refusal and no event proposal; or
- `effects_required`: an ordered effect plan whose successful receipts allow the core to resume
  the same request.

JavaScript appends an accepted event batch with an expected-cursor check. `AppendReceipt` returns
the assigned sequence values, timestamps, event digests, and final cursor. A cursor mismatch returns
a typed stale-basis result and causes the original decision to run again from the new cursor.

### Effect exchange

`EffectRequest` contains `effectId`, `requestId`, `effectKind`, closed arguments, preconditions,
and the event cursor that authorized it. `EffectReceipt` contains the same identities, a closed
outcome, bounded observations, and artifact digests. Repeated delivery of an effect identity must
return the recorded receipt or a typed `unconfirmed` result. It must not start an independent copy
of the effect.

Effect kinds are introduced per phase. The JavaScript host owns only the kinds enabled for that
phase. Bend2 cannot name an undeclared host function through this boundary. Phase 6 moves every
effect kind to a Bend2 Base effect or a declared C import and then deletes that kind from the
bridge. A required effect without a proved Bend2 owner blocks Phase 6 and is recorded as a no-go or
a named prerequisite in [`go-no-go.md`](go-no-go.md).

### Landing as the reference design

The live contribution landing path supplies the model for this boundary:

1. The contribution and review rows establish an accepted request.
2. The landing authority prepares a scratch checkout at the target head.
3. The change and its derived gate set run in that isolated checkout.
4. `git update-ref` applies the target change with an expected-head check.
5. The runtime records an integration receipt or a typed failure row.
6. Ledger replay reconstructs the same projected integration result.

The rewrite applies this sequence to every external effect: durable identity, isolated preparation,
verification, conditional commit, durable receipt, and replay. An effect whose outcome cannot be
proven after restart remains unsettled and blocks dependent work.

### Boundary retirement

| Temporary boundary member | Introduced | Deleted |
|---|---:|---:|
| `DecisionRequest`, `DecisionResult`, `EventProposal`, and `AppendReceipt` | Phases 1-2 | Phase 7 |
| Process, socket, filesystem, git, terminal, credential, clock, entropy, and provider effect requests | Phases 3-4 | Individually in Phase 6 after Bend2 takes authority |
| Canonical `OperationRequest` and `OperationResult` bridge forwarding | Phase 5 | Phase 7 |
| Bridge transport, compatibility negotiation, and Node bootstrap | Phase 0 | Phase 7 |

Fixtures and schemas needed for historical replay may remain as Bend2 test data. No live bridge
handler or JavaScript runtime remains after Phase 7.

## Phase summary

| Phase | Subsystems that move | Boundary contract added | Proving test |
|---|---|---|---|
| 0. Contract and corpus | No production subsystem | `baton.bridge.v1` schemas, fixtures, and event compatibility manifest | `phase0-boundary-contract.test.mjs` |
| 1. Shadow decision core | Shadow copies of validation, authorization, event folding, projections, and wake classification | `DecisionRequest` and read-only `DecisionResult` | `phase1-shadow-parity.test.mjs` |
| 2. Coordination authority | Closed-shape validation, authorization, swarm/coordination state transitions, replay projections, and wake classification | `EventProposal`, `AppendReceipt`, and cursor retry | `phase2-coordination-cutover.test.mjs` |
| 3. Runtime planning | Admission, capacity and custody decisions, run/swarm/workflow planning, recovery decisions, and effect ordering | `EffectRequest` and `EffectReceipt` for process, provider, filesystem, clock, and host observations | `phase3-runtime-effects.test.mjs` |
| 4. Contribution and landing decisions | Contribution lifecycle, review state, verification selection, landing plan, and integration receipt projection | `LandingPlan` and host git/gate receipts | `phase4-landing-parity.test.mjs` |
| 5. Application semantics | Operation registry, command schemas, dispatch, capability resolution, and result projection | One operation envelope used by CLI, MCP, and web adapters | `phase5-surface-conformance.test.mjs` |
| 6. Host-effect migration | Process, socket, filesystem, JSON, git, interprocess transport, terminal, clock, entropy, credential, and provider adapters | Per-effect compatibility receipts; each bridge effect kind is deleted after cutover | `phase6-host-effects-cutover.test.mjs` |
| 7. Remove the migration boundary | `baton.bridge.v1`, every JavaScript adapter, JavaScript packaging, and the Node runtime | No coexistence boundary remains; public protocols terminate in Bend2 | `phase7-bend2-only-deployment.test.mjs` |

The test filenames are required rewrite deliverables. They do not exist in the current design-only
branch.

## Phase 0: freeze the contract and corpus

### Subsystems that move

No production subsystem moves. The phase creates the compatibility assets used by later phases:

- the `baton.bridge.v1` schemas;
- a manifest of current event kinds, command names, permission names, refusal codes, wake classes,
  projections, contribution fields, and public CLI/MCP operations;
- fixture requests and answers taken from current tests;
- replay corpora containing valid rows, refused operations, partial effects, and recovery cases;
- an ownership map that assigns every inventoried seam member to a planned phase or an explicit
  temporary JavaScript host boundary and the phase that deletes it.

The ownership map is revised with **ARCHITECTURE-FINDINGS-PENDING**. The law corpus is revised with
**LAW-FINDINGS-PENDING**. The transport and executable packaging are revised with
**LANGUAGE-FINDINGS-PENDING**.

### BATON2 deletions and merges

**BATON2-PHASE-0-DELETIONS-MERGES-PENDING:** cite the architecture-review findings that remove or
merge compatibility assets from the inventory before implementation begins. This phase must mark
every current subsystem as retained in baton2, merged into a named baton2 owner, deleted, or kept
only for a named migration phase.

### Boundary contract

Both halves must agree on the complete `baton.bridge.v1` value rules, canonical fixture bytes, and
schema digests. The JavaScript adapter is the reference encoder for existing values. The Bend2
executable must decode and re-encode each fixture with the same meaning and canonical bytes.

### Proving test

`phase0-boundary-contract.test.mjs` must:

- extract the live closed sets and generated CLI/MCP inventories;
- validate every fixture against both decoders;
- reject every fixture with one added unknown field;
- prove canonical encode/decode parity and digest parity;
- replay the corpus through the current JavaScript implementation with no projection change; and
- run the compiled Bend2 boundary executable produced at the pinned toolchain.

Phase 1 starts only after that test and the full JavaScript suite pass on the same commit.

### Rollback

Delete the unused adapter and fixture build output. No production routing or durable data changes in
this phase.

## Phase 1: run a shadow decision core

### Subsystems that move

Implement read-only Bend2 versions of these pure decisions:

- closed-shape and closed-set validation;
- principal and permission authorization;
- event admission and state folding;
- read projections and bounded cursor handling; and
- wake-class derivation.

JavaScript remains the production authority. Bend2 receives copies of requests and ledger prefixes
and produces shadow results. Shadow results have no append or effect capability.

The exact module list is filled from **ARCHITECTURE-FINDINGS-PENDING**. The exact invariant list is
filled from **LAW-FINDINGS-PENDING**.

### BATON2 deletions and merges

**BATON2-PHASE-1-DELETIONS-MERGES-PENDING:** cite the architecture-review findings that collapse
the current validators, authorization paths, folders, projections, and wake classifiers into the
baton2 decision owners evaluated by this shadow core. No current module survives by default.

### Boundary contract

The phase enables `DecisionRequest` and a read-only `DecisionResult`. Both implementations must
agree on acceptance or refusal, refusal code and detail, proposed event payloads before sequence and
timestamp assignment, projection values, and wake class. The comparison report contains fixture
identity and field-level differences. It does not contain credentials or unbounded payloads.

### Proving test

`phase1-shadow-parity.test.mjs` must run every Phase 0 fixture and generated mutations through both
implementations. Required results are zero unexplained differences, deterministic Bend2 results
across repeated runs, bounded execution for bounded reads, and identical replay projections at
every fixture cursor. Any difference receives a regression fixture before correction.

The test also runs each extracted law named by **LAW-FINDINGS-PENDING** through its declared proof
method. A law marked as type-enforced uses the compile-pass or compile-refusal evidence declared by
the laws lane.

### Rollback

Disable shadow dispatch and stop the Bend2 process. JavaScript authority and ledger contents remain
unchanged. Shadow comparison rows may remain as diagnostic evidence because production projections
do not consume them.

## Phase 2: move coordination authority

### Subsystems that move

Bend2 becomes authoritative for:

- command validation and permission checks;
- swarm and coordination state transitions;
- event admission and ordered event proposals;
- ledger-derived projections; and
- wake classification.

JavaScript continues to own authenticated CLI, MCP, and web connections, durable event append,
bounded event reads, and delivery of wake frames. The current JavaScript decision path stays
available as the rollback implementation for one compatibility window.

### BATON2 deletions and merges

**BATON2-PHASE-2-DELETIONS-MERGES-PENDING:** cite the architecture-review findings that delete or
merge the current coordination stores, ledger projections, permission paths, and wake machinery
when baton2 takes coordination authority.

### Boundary contract

`DecisionRequest` now permits `EventProposal`. JavaScript must append the proposed batch with the
exact expected cursor and return `AppendReceipt`. Bend2 applies only rows named by that receipt to
its live state. Restart reconstructs Bend2 state from durable rows through the same decoder used by
JavaScript.

Both halves must agree on event kind, payload shape, actor attribution, idempotency identity,
operation completion state, cursor, projection, wake class, and typed refusal. Principal fields
come from the authenticated JavaScript connection and are covered by `inputDigest`.

### Proving test

`phase2-coordination-cutover.test.mjs` must run the current swarm and coordination suites twice:
once with JavaScript authority and once with Bend2 authority. It must compare the complete durable
event rows after normalizing assigned timestamps, the final projections, all wake frames, and every
refusal. It must also kill the Bend2 process before append, after append, and before receipt
delivery, then prove replay and idempotent retry produce one accepted batch.

Phase 3 requires a deployment canary that serves real read traffic from the Bend2 projection while
mutation traffic remains within the compatibility corpus.

### Rollback

Stop new command admission, settle or mark all boundary requests, stop Bend2, replay the ledger into
JavaScript, compare the final cursor and projection digest, and switch command routing to
JavaScript. Rollback stops if either implementation cannot decode a durable row.

## Phase 3: move runtime planning

### Subsystems that move

Bend2 becomes authoritative for the decisions that coordinate work:

- worker and verification admission;
- host-capacity allocation decisions;
- workspace custody and path-scope decisions;
- run, swarm, wave, and workflow planning selected by the target architecture;
- dependency and terminal-state transitions;
- recovery classification and retry decisions; and
- ordering of provider and process effects.

JavaScript executes declared host effects: process spawn, signal, and reap; provider and harness
protocols; filesystem and worktree operations; clocks and random identities; host observation; and
credential access. This ownership is temporary. Phase 6 moves every listed effect to Bend2 through
a pinned Base effect or a declared C import. **LANGUAGE-FINDINGS-PENDING** must identify and prove
that Bend2 owner for every effect before Phase 6 starts.

### BATON2 deletions and merges

**BATON2-PHASE-3-DELETIONS-MERGES-PENDING:** cite the architecture-review findings that delete or
merge current admission, capacity, custody, run, swarm, wave, workflow, provider, and recovery
abstractions into the baton2 runtime owners. The cited findings decide which names remain.

### Boundary contract

The phase enables closed `EffectRequest` and `EffectReceipt` kinds. Each effect request cites the
authorizing event cursor and its preconditions. The JavaScript executor validates the effect kind,
checks the preconditions it can observe, performs the effect, bounds captured output, and returns a
receipt. Bend2 decides the next state only from ledger rows and receipts.

Capacity and custody values include their authority identity and lease identity. A release cites the
grant it settles. A process receipt identifies the logical call, physical process when available,
exit or signal outcome, and bounded diagnostics. A provider receipt identifies the route and
logical call without carrying credentials.

### Proving test

`phase3-runtime-effects.test.mjs` must run the current admission, custody, process-lifecycle,
provider, workflow, recovery, and drain suites through the boundary. A fault matrix kills each side
at every request/receipt transition. The test proves one durable decision per idempotency identity,
one terminal settlement per granted resource, no unowned workspace operation, bounded diagnostics,
and the same replayed terminal state as the JavaScript baseline.

Load and memory results are recorded, but advancement uses operator-set service thresholds. The
operator records those thresholds before the canary so the result is not selected after measurement.

### Rollback

Close admission, allow receipt-bearing effects to settle, and classify each remaining effect as
completed, absent, or unconfirmed. JavaScript replays the ledger and resumes only operations whose
effect identity has a recorded result or a safe retry rule. Unconfirmed effects remain blocked for
operator review. Existing workers may finish through the JavaScript executor during the drain.

## Phase 4: move contribution and landing decisions

### Subsystems that move

Bend2 becomes authoritative for:

- contribution contract state and review settlement;
- eligibility to capture, check, and integrate;
- affected-test and landing-gate planning selected by the target architecture;
- landing request construction; and
- projection of started, failed, dry-run, and integrated receipts.

JavaScript retains git, scratch-checkout, regenerator, test-runner, and local-ref authority. These
are temporary host effects with repository-specific safety checks. Phase 6 moves their execution
to Bend2 and preserves these checks in the Bend2 effect implementation.

### BATON2 deletions and merges

**BATON2-PHASE-4-DELETIONS-MERGES-PENDING:** cite the architecture-review findings that delete or
merge contribution, review, verification-planning, landing-table, capture, check, and integration
abstractions into the baton2 contribution and landing owners.

### Boundary contract

`LandingPlan` contains the accepted contribution identity, immutable commit, target ref and expected
head, merge-base, excluded prefixes, changed paths, regeneration plan, derived gates, author,
committer, dry-run flag, and plan digest. JavaScript returns staged receipts for scratch creation,
merge, regeneration, gate execution, compare-and-swap, and cleanup. Bend2 emits the public
integration result only after it receives enough receipts to prove the target state.

The receipt fields preserve the live landing contract: `base`, `target`, `targetHeadBefore`,
`targetHeadAfter`, `squashSha`, `changedPaths`, `gates`, `regenerated`, `conflicts`, `issue`, and
`dryRun`.

### Proving test

`phase4-landing-parity.test.mjs` must run the full
`issue296-swarm-integrate.test.mjs` matrix through both planners and one JavaScript git executor. It
must add restart points before scratch creation, after the squash, during gates, immediately before
the ref compare-and-swap, and immediately after it. The test proves target immutability for every
pre-commit failure, exact reconstruction after a successful compare-and-swap, one durable outcome,
scratch cleanup, and replay parity.

### Rollback

Block new landings and settle the active landing identities. A landing with no successful ref
receipt cleans its scratch checkout and returns to JavaScript planning. A landing with a successful
ref receipt is reconciled forward into its durable integration outcome; rollback does not move the
target ref backward. After reconciliation, JavaScript replays the contribution rows and resumes
authority.

## Phase 5: move application semantics

### Subsystems that move

Bend2 becomes authoritative for:

- the operation and capability registry;
- command argument schemas and closed values;
- dispatch from canonical operation name to decision;
- application result projections; and
- help and inventory data used by generated surface documentation.

JavaScript CLI, MCP, and web modules remain temporary transport adapters. They authenticate
connections, decode their transport, call one canonical operation envelope, and encode the result.
Phase 6 replaces these adapters with Bend2 transport implementations. Phase 7 deletes their
JavaScript code and the bridge they use.

The architecture review supplies the exact file deletion and merge list. This plan records that
list under **ARCHITECTURE-FINDINGS-PENDING** until publication.

### BATON2 deletions and merges

**BATON2-PHASE-5-DELETIONS-MERGES-PENDING:** cite the architecture-review findings that delete or
merge duplicate registries, command schemas, dispatch paths, capability resolution, and result
projection while preserving the approved public surface.

### Boundary contract

All transports use the same `OperationRequest` and `OperationResult`. A generated manifest binds
each public CLI verb and MCP tool to one canonical operation, permission, argument schema, result
schema, read or mutation class, and help text. Both halves verify the manifest digest at startup.

Transport-specific errors remain in their adapters. Application refusals retain the canonical code
and detail across CLI, MCP, and web renderings.

### Proving test

`phase5-surface-conformance.test.mjs` must regenerate `impl/CLI.md` and `impl/MCP.md` from the
canonical manifest in a scratch checkout and produce no diff. It must run every operation through
each admitted transport, compare canonical results, verify permission parity, and prove every
documented operation has a dispatch target. The current surface gate and full suite must remain
green.

### Rollback

Keep the manifest version supported by both cores. Route canonical operation envelopes to the
JavaScript core and regenerate the same surface documents. Public clients keep their transport
connections and operation names.

## Phase 6: migrate every host effect

### Entry condition

This phase starts only when **LANGUAGE-FINDINGS-PENDING** supplies compiled and run evidence for
every host capability Baton needs. Each capability must have a Bend2 owner at the pinned toolchain,
implemented by a Base effect or a declared C import. A missing owner is a no-go or a named
prerequisite that must close before this phase. Phase 5 is not a production end state.

### Subsystems that move

All remaining transport and host-effect subsystems move to Bend2 in independently reversible
tranches:

- process spawn, signal, wait, exit observation, and reap;
- TCP listen, accept, connect, read, write, and close;
- UDP bind, send, receive, and close where current discovery or transport requires UDP;
- filesystem metadata, bounded reads and writes, atomic publication, rename, links, directory
  traversal, permission checks, and cleanup;
- JSON decode, closed-shape validation, canonical encode, and bounded framing;
- git invocation, scratch-checkout management, gate execution, and compare-and-swap ref updates;
- transport between Baton processes, including request framing, backpressure, disconnect, and
  restart behavior;
- terminal input, output, signals, hidden input, and exit status;
- clocks, monotonic duration observations, entropy, and random identity generation;
- credential-file access and private runtime projection; and
- provider and harness protocol clients built over the process or socket effects above.

The target owner for every row remains **LANGUAGE-FINDINGS-PENDING: BASE-EFFECT-OR-C-IMPORT**. The
architecture grouping and concrete deletion list remain **ARCHITECTURE-FINDINGS-PENDING**. The
evidence revision replaces each marker with a finding ID and compiled example path.

### BATON2 deletions and merges

**BATON2-PHASE-6-DELETIONS-MERGES-PENDING:** cite the architecture-review findings that consolidate
host effects under baton2 owners and delete each JavaScript executor when its Bend2 Base-effect or
C-import implementation takes authority. The final list must cover every effect in this phase.

Each tranche moves the Bend2 adapter, runs its proving cases, switches authority, and removes that
effect kind from the JavaScript side of `baton.bridge.v1`. The final tranche leaves JavaScript with
only bridge forwarding and rollback startup authority; Phase 7 deletes both.

### Boundary contract

Each moved adapter must preserve the Phase 5 operation manifest and the Phase 3 and Phase 4 effect
receipt shapes. During a tranche, the Bend2 adapter and the temporary JavaScript adapter accept the
same recorded transport frames and host fixtures. One selected implementation owns each live
effect identity. A successful tranche records a cursor and receipt-digest barrier, switches that
effect kind to Bend2, and deletes the corresponding JavaScript handler. Phase 7 deletes the shared
envelope, bridge transport, and remaining forwarding process.

### Proving test

`phase6-host-effects-cutover.test.mjs` must first run the compiled example named by every language
finding. It then runs effect-specific parity and fault cases for every capability listed above,
including process death, socket disconnect, UDP truncation, partial filesystem publication,
malformed and oversized JSON, git ref races, interprocess backpressure, terminal interruption,
clock discontinuity, entropy failure, credential refusal, and provider protocol failure.

The test must run the full suite, recorded CLI/MCP/web sessions, restart recovery, and contribution
landing with all live effect ownership in Bend2. It proves that the JavaScript bridge has no
registered effect kind and that every active effect identity is settled or safely classified.
The packaged deployment then runs an operator-defined canary with error, latency, memory, recovery,
and ledger-growth thresholds fixed before the canary starts.

### Rollback

For the active tranche, stop admission, drain or classify its effects, replay the ledger into the
last proved owner, compare cursor and projection digests, and restore only that effect handler.
Retain the complete Phase 5 JavaScript host image for the Phase 6 rollback window. A rollback never
creates a permanent JavaScript target; it returns the deployment to a named migration checkpoint.

## Phase 7: remove the migration boundary and Node runtime

### Subsystems that move

No decision or host-effect subsystem remains to move. This phase removes the migration machinery:

- `baton.bridge.v1` schemas, dispatch, transport, fixtures used only for live coexistence, and
  compatibility negotiation;
- every remaining JavaScript forwarding, bootstrap, surface, and effect-adapter module;
- Node package metadata, Node startup commands, and Node runtime requirements; and
- rollback startup authority embedded in the deployed service.

The public CLI, MCP, web, local-resident, and interprocess protocols terminate in Bend2. Bend2 owns
all durable decisions, projections, transport handling, and host effects.

### BATON2 deletions and merges

Phase 7 unconditionally deletes `baton.bridge.v1`, every JavaScript adapter and effect host, Node
packaging, and the Node runtime. **BATON2-PHASE-7-DELETIONS-MERGES-PENDING:** cite any additional
architecture-review deletions or final merges required to leave only the baton2 subsystem set.

### Boundary contract

There is no JavaScript/Bend2 boundary after this phase. Before deletion, the two halves agree on one
final ledger cursor, projection digest, operation-manifest digest, and set of settled effect
identities. The Bend2 deployment records that cutover receipt. New rows after the receipt are
written, decoded, projected, and served only by Bend2.

### Proving test

`phase7-bend2-only-deployment.test.mjs` must build and install the deployment in an environment with
no `node` executable and no JavaScript source or package files. It runs the full compatibility
corpus, public CLI/MCP/web sessions, process and socket fault matrix, filesystem and git landing
matrix, restart replay, and an operator canary. Static checks must find no runtime reference to
`baton.bridge.v1`, JavaScript, Node, or a JavaScript effect host. The final cursor and projection
digest must match the Phase 6 cutover receipt before new traffic is admitted.

### Rollback

During a time-bounded release rollback window, stop Bend2 admission, classify active Bend2 effects,
restore the last Phase 6 artifact, and replay from the shared cutover cursor. The rollback artifact
is external to the Bend2-only deployment. When the operator closes the window, retire that artifact
and record that rollback now requires a new migration decision and ledger-compatibility proof.

## Cross-phase verification records

Each phase publishes one machine-readable verification record containing:

- source commits for the temporary JavaScript core when present, Bend2 core, pinned Bend toolchain,
  and contract manifest;
- the phase test command and exit status;
- full-suite command and exit status;
- fixture count, event count, operation count, and difference count;
- fault-injection cases and their final classifications;
- performance thresholds and observations when applicable;
- ledger start and end cursors plus projection digests;
- all active effect identities at start and their settled states at end; and
- the rollback rehearsal command and result.

A phase cannot use a later phase's code to satisfy its proof. This keeps each rollback target
independently buildable and testable.

## Revision checklist after the reviews publish

1. Replace **LANGUAGE-FINDINGS-PENDING** with cited finding IDs and example evidence paths. Update
   the boundary transport, packaging, Phase 3 host list, and the Base-effect-or-C-import owner for
   every Phase 6 host effect.
2. Replace **ARCHITECTURE-FINDINGS-PENDING** and every
   **BATON2-PHASE-N-DELETIONS-MERGES-PENDING** marker with cited deletion, merge, subsystem,
   ownership, and forbidden-ownership findings. Update every phase's module list and proving test
   to cover the deletions and merges that phase performs.
3. Replace **LAW-FINDINGS-PENDING** with the extracted and proposed law IDs. Assign each law to the
   first phase that must prove it and name its source test.
4. Update [`go-no-go.md`](go-no-go.md) with the findings that support a production rewrite and the
   findings that limit work to the Phase 1 prototype.
5. Ask an independent reviewer to check the revised plan against all three source documents and
   the pinned examples before the orchestrator publishes the final recommendation.
