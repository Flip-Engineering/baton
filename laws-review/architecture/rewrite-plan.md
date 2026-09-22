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

The three review work items have published:

- [`language-review.md`](language-review.md) provides `LANG-F-01` through `LANG-F-25` and the
  per-capability verdicts `LANG-CAP-01` through `LANG-CAP-08`, backed by the compiled examples in
  [`examples/index.md`](examples/index.md).
- [`architecture-review.md`](architecture-review.md) provides deletion and merge findings `F1`
  through `F24`. [`target-architecture.md`](target-architecture.md) proposes eight BATON2
  subsystems with exclusive ownership and forbidden-ownership rules.
- [`laws-proposed.md`](laws-proposed.md) presents 138 candidate laws with source and test traces:
  `CUST-*`, `CAP-*`, `WAKE-*`, `LEDG-*`, `CS-*`, `AB-*`, `PM-*`, `CL-*`, `PROP-*`, `PR-*`, and
  `DEV-*`.

The operator has not approved the BATON2 deletions or the candidate laws. They remain proposals.
Phase 0 records the operator's decision on each architecture deletion and law candidate before a
later phase treats it as a target requirement. Only approved law rows enter `laws.bend`.

The plan targets **BATON2**, the simplified architecture proposed by the architecture review. It
does not port the current subsystem list one for one. The target remains a Baton written entirely
in Bend2. The boundary and proof requirements apply to every operator-approved phase.

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
schema. `LANG-CAP-02` proves Base TCP transport. `LANG-CAP-06` leaves JSON framing as an incomplete
Bend2 module or C-import prerequisite. The logical contract is independent of that transport.
This protocol is a migration mechanism. Phase 7 deletes it, its transport, every JavaScript
adapter, and the Node runtime.

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
  temporary JavaScript host boundary and the phase that deletes it;
- an operator decision ledger for every deletion in `F1` through `F24` and every candidate in
  [`laws-proposed.md`](laws-proposed.md); and
- an approved `laws.bend` containing only the candidate rows the operator accepted.

The ownership map uses the eight proposed owners in [`target-architecture.md`](target-architecture.md):
Domain Kernel, Journal and Projectors, Scheduler, Worker Gateway, Workspace and Artifacts,
Verification and Landing, Northbound Gateway, and Capability Services. `LANG-CAP-02` supplies the
temporary TCP transport. `LANG-CAP-06` makes JSON framing a prerequisite that must close before the
bridge executable exists.

### BATON2 deletions and merges

Phase 0 performs no production deletion. It classifies every current subsystem as retained during
migration, merged into one proposed BATON2 owner, deleted by a named later phase, or absent from the
target. This is the inventory required by `F1` through `F24`, with special coverage for the facade
shells (`F1`), parallel runtime (`F3`), seam inventory (`F17`), and Node-specific persistence
machinery (`F24`). The operator approves, edits, or rejects each proposed deletion before it enters
the executable phase plan.

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
- run the compiled Bend2 boundary executable produced at the pinned toolchain;
- prove every phase deletion has an operator decision and one target owner; and
- prove `laws.bend` contains only operator-approved rows from `laws-proposed.md`, with the decision
  recorded beside each row.

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

These decisions form the first slices of the proposed Domain Kernel and Journal and Projectors.
They cover the schema and refusal consolidation in `F22`, canonical domain construction in `F13`,
materialized views in `F10`, and the pure half of the at-most-once operation in `F19`.

JavaScript remains the production authority. Bend2 receives copies of requests and ledger prefixes
and produces shadow results. Shadow results have no append or effect capability.

The proof corpus includes the operator-approved closed-shape, authorization, permission, wake, and
ledger candidates from `CS-01..20`, `AB-01..14`, `PM-01..11`, `WAKE-01..13`, and `LEDG-01..19` in
[`laws-proposed.md`](laws-proposed.md). A rejected candidate remains a compatibility fixture when
the current implementation enforces it, but it does not become a BATON2 law.

### BATON2 deletions and merges

This phase merges the candidate implementations named by `F10`, `F13`, `F19`, and `F22` into
read-only Domain Kernel constructors and Journal projectors. It deletes nothing from production;
the shadow must first prove that these proposed merges retain canonical digests, authorization,
closed-set refusals, bounded views, idempotency classification, and wake derivation. The operator's
Phase 0 decisions determine which of these merges proceeds.

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

The test also runs each approved law through the proof method and source test named in
[`laws-proposed.md`](laws-proposed.md). A law marked as type-enforced uses a compile-pass and a
compile-refusal fixture. Rows marked unpinned require a new pinning test before they can pass this
gate.

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

The target owners are Domain Kernel for typed admission, Journal and Projectors for durable append,
fold, query, and wake cursors, and Scheduler for command admission. The phase covers the proposed
journal merge (`F2`), affine authority boundary (`F8`), reconciler (`F9`), view merge (`F10`),
idempotency collapse (`F19`), append transaction (`F20`), task and journal waits (`F21`), schema and
refusal merge (`F22`), and wake subscription merge (`F23`).

JavaScript continues to own authenticated CLI, MCP, and web connections, durable event append,
bounded event reads, and delivery of wake frames. The current JavaScript decision path stays
available as the rollback implementation for one compatibility window.

### BATON2 deletions and merges

After the cutover proof, delete the `CoordinationStore` decision shell and its same-name forwarding
methods covered by `F1`. Merge the current coordination append and projection paths into the target
owners listed above under the operator-approved parts of `F2`, `F8` through `F10`, and `F19` through
`F23`. Keep versioned decoders and the JavaScript append/transport adapter until Phase 7. The proof
corpus is the approved subset of `CS-*`, `AB-*`, `PM-*`, `WAKE-*`, and `LEDG-*`.

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

These decisions move into the proposed Scheduler. It uses Workspace and Artifacts for resource and
workspace leases and Worker Gateway for provider-session effect plans. The phase implements the
operator-approved scheduling and recovery proposals in `F4`, `F5`, `F7` through `F9`, `F12`,
`F18`, and `F21`.

JavaScript executes declared host effects: process spawn, signal, and reap; provider and harness
protocols; filesystem and worktree operations; clocks and random identities; host observation; and
credential access. This ownership is temporary. Phase 6 moves every listed effect to Bend2 through
a pinned Base effect or a declared C import. `LANG-CAP-01` and `LANG-CAP-04` prove filesystem,
environment, clock, sleep, and randomness primitives. `LANG-CAP-05` leaves the required process
lifecycle C-effect family incomplete. Phase 6 cannot start until the full effect list has compiled
and run evidence.

### BATON2 deletions and merges

After the cutover proof, delete the independent goal-plan, orchestrator-plan, workflow, wave, and
swarm schedulers under `F4`; replace the duplicated wave and workflow joins under `F5`; merge the
three provider supervisors under `F7`; and delete in-process fence and custody emulation only where
the affine and durable authority proof required by `F8` passes. Merge recovery under `F9`, context
lineage under `F12`, capacity leases under `F18`, and polling waits under `F21`. The approved
`CUST-01..12`, `CAP-01..17`, `WAKE-*`, and applicable `DEV-*` rows are the law corpus for this
phase.

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

The target owner is Verification and Landing, with scoped leases and artifacts from Workspace and
Artifacts and durable outcomes in Journal and Projectors. This phase implements `F16`; typed gate
selection prepares the later removal in `F17`, and the shared append and durable replacement
primitives come from `F20`.

JavaScript retains git, scratch-checkout, regenerator, test-runner, and local-ref authority. These
are temporary host effects with repository-specific safety checks. Phase 6 moves their execution
to Bend2 and preserves these checks in the Bend2 effect implementation.

### BATON2 deletions and merges

After the proving test, merge contribution, independent review, verification, result adoption, gate
planning, and integration authority under `F16`. Retain the generated seam inventory until typed
effect declarations select the same or stronger gate set; then delete it under `F17`. Merge landing
append and atomic replacement paths under `F20`. The phase proves the approved `CL-01..17` laws,
including the unpinned `CL-10` empty-range arm and `CL-13` compare-and-swap race after adding their
tests. `DEV-5` governs review and gated integration if the operator approves it.

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

The target owners are Domain Kernel for the typed protocol, Northbound Gateway for transport
codecs, Journal and Projectors for queries, and Capability Services for optional tools. This phase
implements the operator-approved parts of `F1`, `F3`, `F10` through `F15`, and `F22` through `F23`.

JavaScript CLI, MCP, and web modules remain temporary transport adapters. They authenticate
connections, decode their transport, call one canonical operation envelope, and encode the result.
Phase 6 replaces these adapters with Bend2 transport implementations. Phase 7 deletes their
JavaScript code and the bridge they use.

### BATON2 deletions and merges

After the proving test, delete the application and coordinator facade delegates approved under `F1`;
delete the parallel convergence runtime under `F3`; merge observation under `F10`; merge command
semantics under `F11`; merge context and artifact lineage under `F12`; merge validation,
redaction, export, and presentation policy under `F13`; delete ESM and source-shape shims under
`F14`; and move Atlas behind Capability Services under `F15`. The typed schema and refusal source
from `F22` and journal subscription from `F23` replace transport-local copies. Compatibility aliases
remain versioned in Northbound Gateway until Phase 7.

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

This phase starts only when every host capability Baton needs has compiled and run evidence. Each
capability must have a Bend2 owner at the pinned toolchain, implemented by a Base effect or a
declared C import. Phase 5 is not a production end state.

The published review leaves this entry condition **open**:

- `LANG-CAP-01` through `LANG-CAP-04` prove Base filesystem, TCP, UDP, environment, argv, clock,
  sleep, and randomness primitives.
- `LANG-CAP-05` proves that Base has no operating-system process surface. Its example is a blocking
  `popen` call with whole stdout and exit status; it has no process handle, streaming stdout and
  stderr, signal, kill, cancellation, or nonblocking wait. The prerequisite is a compiled C-effect
  family that supplies all of those operations without stalling the event loop.
- `LANG-CAP-06` proves that Base has no JSON module. The prerequisite is a compiled Bend2 JSON
  module with laws or a declared C-library import with the same closed and canonical behavior.
- `LANG-CAP-07` makes git invocation depend on the process and JSON prerequisites.
- `LANG-CAP-08` proves TCP bytes for interprocess transport and makes framing depend on the JSON
  prerequisite.

Terminal signal and hidden-input behavior, credential access, git races, and provider protocol
clients also need effect-specific compiled examples before this phase. The generic foreign-effect
contract in `LANG-F-08`, `LANG-F-16`, and `LANG-F-17` proves a C-import route; it does not prove
those production implementations.

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

Worker Gateway owns processes and provider protocols. Workspace and Artifacts owns filesystem,
Git, credentials, and durable publication. Northbound Gateway owns terminal and public transports.
Journal and Projectors owns durable framing and replay. Capability Services owns optional external
clients. Each owner uses only a Base effect or declared C import proved for that effect.

### BATON2 deletions and merges

Merge adapter and process ownership into Worker Gateway under `F6`; provider supervisors under
`F7`; workspace and artifact effects under `F12`, `F13`, and `F18`; verification effects under
`F16`; waits under `F21`; wake transport under `F23`; and Node-specific effect workarounds under
`F24`. Delete each JavaScript executor only after its Bend2 Base-effect or C-import implementation
takes authority and passes the effect-specific fault test. The operator-approved target disposition
in [`target-architecture.md`](target-architecture.md) supplies the final deletion list.

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
packaging, and the Node runtime. It completes the approved facade and compatibility deletion in
`F1`, parallel-runtime deletion in `F3`, shim deletion in `F14`, seam-inventory deletion in `F17`,
and Node-workaround deletion in `F24`. Static verification permits only the eight BATON2 subsystems
and their versioned durable decoders; it rejects every current subsystem that
[`target-architecture.md`](target-architecture.md) marks for deletion.

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

## Decisions and prerequisites still open

1. The operator must approve, edit, or reject each deletion and merge in
   [`architecture-review.md`](architecture-review.md) before the phase that performs it becomes
   executable.
2. The operator must decide every row in [`laws-proposed.md`](laws-proposed.md). Only approved rows
   enter `laws.bend`; unpinned approved rows first receive the missing test named by the candidate.
3. The `LANG-CAP-05` process family and `LANG-CAP-06` JSON implementation must be built and backed
   by compiled evidence. Git, terminal, credential, provider, and interprocess framing effects need
   their own compiled examples.
4. Phase 1 must produce the zero-difference proof specified above. No current evidence substitutes
   for that prototype result.
5. An independent reviewer checks each completed decision and prerequisite against the three
   review documents and the pinned examples before the operator authorizes Phase 2.
