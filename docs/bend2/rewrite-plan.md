# Bend2 rewrite plan

## Status and inputs

The operator authorized rewrite development on `bend2-rewrite` under the 16 operative revision
9.1 laws approved at `1fab9a1da60db3d5d9c9d3cef89d3caabd68fe35`. The
[authorization record](authorization.md) and [final Codex law review](reviews/codex/codex-final-law-review-r9.1.md)
supersede the earlier design-only scope and law-approval hold. Work from this assignment never
lands on `master`.

The separate architecture review remains open. A phase that depends on a proposed deletion or
merge waits for that finding's verdict, required architecture decision, and proving evidence.
Authorized prerequisite work and shadow evaluation can proceed while those decisions are open.
The production target is a native Bend2 deployment using Base effects and declared C imports, built by
the pinned 2.0.25 toolchain and running the runtime that toolchain implements: generated C over the
flat state machine described in `paper/BendRT.pdf`. [`MANDATE.md`](MANDATE.md) names the HVM runtime;
that name appears nowhere in the pinned guide or toolchain, so a mandate-conformance claim resting on
HVM by name needs its own operator decision. Phase 7 removes the temporary JavaScript boundary and
Node runtime.

The plan uses these sources:

- [`MANDATE.md`](MANDATE.md), read with [`authorization.md`](authorization.md), defines the target.
- [`../../impl/CLI.md`](../../impl/CLI.md) and [`../../impl/MCP.md`](../../impl/MCP.md) define the
  generated public operation surfaces and transport behavior to preserve during migration.
- [`../../impl/scripts/seam-inventory.json`](../../impl/scripts/seam-inventory.json) classifies
  admission, effect, observation, recovery, and surface members.
- [`../../impl/src/contribution-contract.mjs`](../../impl/src/contribution-contract.mjs),
  [`../../impl/src/landing-table.mjs`](../../impl/src/landing-table.mjs),
  [`../../impl/src/swarm-runtime.mjs`](../../impl/src/swarm-runtime.mjs), and
  [`../../impl/src/worktree.mjs`](../../impl/src/worktree.mjs) define contribution admission,
  gate selection, local integration, and durable integration receipts.
- [`../../impl/test/issue296-swarm-integrate.test.mjs`](../../impl/test/issue296-swarm-integrate.test.mjs)
  supplies local landing fixtures. Shared-destination publication needs the additional Phase 4
  evidence specified below, including the deployment publication path associated with #558.
- [`reference/README.md`](reference/README.md) pins `bendlang/bend` at
  `a49524265bdfa5753a4bf38e25f0574a705dd868` and Bend 2.0.25.
- [`language-review.md`](language-review.md) publishes `LANG-F-01..31` and `LANG-CAP-01..10`.
  [`examples/index.md`](examples/index.md) names the compiled evidence for each capability.
- [`architecture-review.md`](architecture-review.md) publishes `F1..F24`;
  [`target-architecture.md`](target-architecture.md) proposes eight owners. Its revised findings
  and the separate external Codex verdict determine which phase deletions may proceed.
- [`laws-proposed.md`](laws-proposed.md) records the operative statements. The approved contract
  is M-1, M-2, M-3a, M-3b, M-3c, M-4, M-5, M-7, M-8, M-10, M-11, M-12, M-13, M-14,
  M-17, and M-18. M-6 and M-9 are absorbed into M-8; M-15 is deferred; M-16 remains the
  repository writing instruction. Historical inventory identifiers in
  [`laws-design-notes.md`](laws-design-notes.md) locate compatibility fixtures and source traces.

The retained `224a59ca` plan supplies the phase, ownership, and rollback structure carried forward
here. [`go-no-go.md`](go-no-go.md) records published findings and named pending evidence. Law
approval is complete; checked application laws and host conformance remain implementation work.

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
5. A phase advances only after its entry gates, named proving test, and rollback rehearsal pass.
   The root runs `npm test --prefix impl` once on the assembled migration revision; lanes run
   targeted checks. The final Bend2-only package has its native conformance command as described
   in Phase 7. A claimed full-suite result names the exact tested commit and observed exit.
6. A rollback changes authority at a phase boundary and replays the durable ledger. It does not
   rewrite or discard accepted ledger rows. The last phase deletes the rollback bridge and Node
   runtime after its declared rollback window closes.
7. Public CLI and MCP operation names, request shapes, refusal codes, cursor behavior, and result
   shapes stay compatible until an operator approves a separately versioned public API.
8. Each phase includes failure injection for process exit, truncated messages, duplicate requests,
   stale cursors, lost effect acknowledgments, and restart during an unsettled operation.
9. M-10 applies to frames, reads, queues, and tests: a numeric bound names its physical derivation
   and continuation behavior. Pagination, streaming, and backpressure preserve owed data. Canary
   thresholds report evidence for a cutover decision; they do not terminate accepted agent work.
10. M-17 requires a continuation owner for every accepted unsettled operation. Supervisor transfer,
    cancellation, release, and restart are explicit transitions with durable evidence. Affine use
    alone establishes neither cleanup nor unforgeable authority (`LANG-F-26`, `LANG-F-28`).

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
outcome, observations with continuation references, and artifact digests. Repeated delivery of an effect identity must
return the recorded receipt or a typed `unconfirmed` result. It must not start an independent copy
of the effect.

Effect kinds are introduced per phase. The JavaScript host owns only the kinds enabled for that
phase. Bend2 cannot name an undeclared host function through this boundary. Phase 6 moves every
effect kind to a Bend2 Base effect or a declared C import and then deletes that kind from the
bridge. A required effect without a proved Bend2 owner blocks Phase 6 and is recorded as a no-go or
a named prerequisite in [`go-no-go.md`](go-no-go.md). Earlier phases close any part of that
prerequisite needed by their own executable or authority change.

### Landing as the reference design

The source path and deployment publication path have distinct evidence obligations:

1. Contribution and independent review rows establish the artifact, authority, and gate inputs.
2. `landContribution` prepares an isolated squash from `merge-base(target, tip)..tip`, regenerates
   artifacts, and runs the union of landing-table and runner-derived gates on that checkout.
3. A successful local `git update-ref` compare-and-swap records local integration. The current
   runtime writes `swarm.contribution_integrated` from that result.
4. The #558 deployment publication path publishes to the shared repository and ref designated by
   admitted repository authority. The adapter must establish that destination identity before
   dispatch and bind the actual dispatch to it, as M-18 requires.
5. An independent observation of that designated destination establishes delivery of the verified
   commit. The publication receipt binds the operation, destination, target, commit, and observation.
6. Recovery reconstructs local integration and publication separately. Missing delivery evidence
   leaves publication unresolved under M-2, with a continuation owner under M-17.

The inspected `worktree.mjs` and `swarm-runtime.mjs` establish steps 1–3. The deployment hook and
remote observation must be captured as separate versioned evidence. A local integration receipt
alone proves only local integration. A remote name such as `origin` must resolve to the admitted
shared destination, and a push acknowledgment must be followed by destination observation.
Phase 4 tests this complete path before its publication authority moves.

### Boundary retirement

| Temporary boundary member | Introduced | Deleted |
|---|---:|---:|
| `DecisionRequest`, `DecisionResult`, `EventProposal`, and `AppendReceipt` | Phases 1-2 | Phase 7 |
| Process, socket, filesystem, git, terminal, credential, clock, entropy, and provider effect requests | Phases 3-4 | Individually in Phase 6 after Bend2 takes authority |
| Canonical `OperationRequest` and `OperationResult` bridge forwarding | Phase 5 | Phase 7 |
| Bridge transport, compatibility negotiation, and Node bootstrap | Phase 0 | Phase 7 |

Fixtures and schemas needed for historical replay may remain as Bend2 test data. No live bridge
handler or JavaScript runtime remains after Phase 7.

## Host and proof prerequisites

These work items can be implemented now on `bend2-rewrite`. Each publishes the exact toolchain,
commands, outputs, native artifact, failure cases, and remaining external assumptions. The owner
column uses the proposed architecture for planning; a held ownership deletion stays in place.

| Work item | Findings and required implementation | Planned owner and first dependent gate |
|---|---|---|
| `B2-JSON` | `LANG-CAP-06`: canonical JSON codec, exact-field boundary decoding, integer/digest rules, and UTF-8 byte-buffer representation. Include fragmented and large streamed inputs with continuation. | Domain Kernel / Northbound Gateway; Phase 0 executable boundary. |
| `B2-FS-DURABILITY` | `LANG-CAP-01`, `LANG-F-29`: metadata, permissions, safe temporary files, links, atomic publication, file and directory sync, traversal, partial-write handling, crash recovery, and the supported-platform durability contract: supported platforms and filesystems, interprocess serialization, and stale-writer exclusion. Segment and chunk large logical journals so a fixed-width file quantity never becomes an unexplained maximum on retained history. Bind durable acknowledgment to the actual write path. | Workspace and Artifacts / Journal; any native acceptance or append, with full storage cutover in Phase 6. |
| `B2-PROCESS` | `LANG-CAP-05/07`: nonblocking spawn, separate streamed stdout/stderr, wait status, signal/kill, reap, and Git invocation. The current blocking `popen` probe establishes only the foreign-effect route. | Worker Gateway / Workspace and Artifacts; native bridge supervisor as needed in Phase 1, process cutover in Phase 6. |
| `B2-SUPERVISION` | `LANG-CAP-09`, `LANG-F-26/31`: explicit task ownership, join, cancellation and settlement, fail-stop restart, and recovery of accepted work. Each dropped, failed, or disconnected task retains a continuation owner or a justified terminal result. | Scheduler / Worker Gateway; before Phase 3 lifecycle changes and before any child-owner deletion. |
| `B2-AUTHORITY` | `LANG-F-09/28`: proof-indexed issuance or validated authority over ordinary identifiers; bind exact resource, generation, scope, and time of effect. User-defined affine records are forgeable data. | Domain Kernel / Workspace and Artifacts; before Phase 2 authority changes or F8 deletion. |
| `B2-HTTP-TLS` | `LANG-CAP-08`: HTTP framing, HTTPS/TLS, peer authentication, streaming, disconnect handling, and Unix sockets where required. Base TCP/UDP examples establish transport bytes. | Northbound Gateway / Worker Gateway; native public/provider transports in Phase 6. |
| `B2-CRYPTO` | `LANG-CAP-10`: audited hashing, HMAC, secure entropy, constant-time comparison, and signatures where used. Keep secrets out of diagnostics and receipts. | Shared typed host boundary, consumed by the relevant owners; Phase 0 digest parity and each later authenticated/durable boundary. |
| `B2-DESTINATION` | M-18 and `LANG-CAP-07/08/10`: validate repository/target identity before dispatch, bind publication to it, observe the designated shared destination, and reconcile uncertain delivery. | Verification and Landing / Workspace and Artifacts; Phase 4 publication planning and Phase 6 Git execution. |
| `B2-HOST-CONFORMANCE` | `LANG-F-08/17/31`: native C implementations, ABI pin/rebuild manifest, cross-implementation protocol vectors, crash and cancellation tests, terminal behavior, and credential isolation. | Each effect owner; before that effect moves, complete in Phase 6. |
| `B2-DIAGNOSTIC-BASIS` | `ARCH-CLOSE-11`: one recorded schema and policy basis for startup, doctor and recovery, with a cause classification on every refusal (a missing or unreconstructible basis, an unsupported decoder version, a projection defect, or corrupt source bytes). Drive the same valid ledger through all three entry points and require equivalent logical projections, and include a missing-policy negative case. | Event Stores and the recovery owner; before Phase 2 moves coordination authority, since a refusal of a recorded row is that phase's readiness signal. |
| `B2-COVERAGE` | `ARCH-CLOSE-09`: typed change declarations, an independent structural scan, and consumer validation of the checked result for the exact source snapshot, demonstrated on a pure decision helper, a schema change, a shared library change, and an altered C effect. Keep the committed inventory until the replacement selects the same gates or stronger ones. | Verification and Landing; before the `F17` deletion in Phase 4. |
| `B2-KNOWLEDGE-SCOPE` | `ARCH-CLOSE-08`: explicit knowledge promotion with source and destination attribution, reader-relative isolated views, and parent-child delegation across a restart. A unified scheduler must reject cross-scope reads and child authority elevation. | Scheduler; before the `F4` unification in Phase 3. |

`LANG-CAP-02/03/04` prove TCP, UDP, environment, argv, clock, sleep, and basic randomness
primitives. `LANG-CAP-01` proves basic file IO. These examples establish the operations they run.
Secure randomness, durable storage, monotonic-clock behavior, and full application protocols need
their own conformance evidence. `LANG-F-27` shows that a typed fold can discard history;
`LANG-F-29` shows that a receipt constructor can acknowledge no write. `LANG-F-30/31` require
proof assumptions, unsafe/foreign boundaries, and fail-stop recovery to remain explicit.

### Closure conditions to work items

[`target-architecture.md`](target-architecture.md) states that this plan cites its closure IDs for each
affected deletion and records the evidence that closes them. The prerequisite table above carries the
work items; this table carries the closure conditions, with what closes each and the corpora that
already measure the closed parts.

| Closure condition | Closed by | State |
|---|---|---|
| `ARCH-CLOSE-01` | the approval and recovery records: [`reviews/codex/codex-final-law-review-r9.1.md`](reviews/codex/codex-final-law-review-r9.1.md), [`authorization.md`](authorization.md), [`recovery-2026-09-22.md`](recovery-2026-09-22.md) | recorded |
| `ARCH-CLOSE-02` | `B2-AUTHORITY` | open; `examples/lang-cap-probes.evidence.md` carries the forged-record and dropped-lease controls |
| `ARCH-CLOSE-03` | `B2-SUPERVISION` | open; `examples/lang-cap-dropped-child.evidence.md` is a failing control |
| `ARCH-CLOSE-04` | `B2-FS-DURABILITY` | open; `examples/lang-cap-durability.evidence.md` shows the write path and its missing receipt |
| `ARCH-CLOSE-05` | `B2-PROCESS` | open; `bend base Process`, `bend base exec` and `bend base IO.cancel` each exit 1 |
| `ARCH-CLOSE-06` | `B2-HTTP-TLS`, with `B2-JSON` for framing | open |
| `ARCH-CLOSE-07` | `B2-CRYPTO` | open |
| `ARCH-CLOSE-08` | `B2-KNOWLEDGE-SCOPE` | open |
| `ARCH-CLOSE-09` | `B2-COVERAGE` | open |
| `ARCH-CLOSE-10` | `B2-FS-DURABILITY`, at its supported-platform contract and segmentation clauses | open |
| `ARCH-CLOSE-11` | `B2-DIAGNOSTIC-BASIS` | open; `examples/arch-replay-stop.evidence.md` and `examples/arch-replay-basis.evidence.md` measure the classification gap on three verbs |
| `ARCH-CLOSE-12` | `B2-DESTINATION`, and the deployment's own publication path | open for the deployment; `examples/arch-publish-target.evidence.md`, `arch-publish-content.evidence.md`, `arch-publish-bind.evidence.md` and `arch-publish-contention.evidence.md` measure the local halves at the pin |

`B2-HOST-CONFORMANCE` names the evidence umbrella rather than a closure condition of its own: it
supplies the ABI, pin and fault-case evidence for each host closure row above, so those rows are its
dependent gates.

### Immediate work and phase entry

1. Collect the existing protocol, refusal, replay, and landing fixtures. This work can run while
   architecture review is open.
2. Implement `B2-JSON` and the digest subset of `B2-CRYPTO`, then run canonical boundary vectors.
   Build the approved law encodings with the laws lead; publish actual-transition proof status.
3. Run Phase 1 pure shadow comparisons after the executable boundary passes. Keep every proposed
   architecture merge reversible and retain current production authority.
4. Develop the remaining host prerequisites independently with compiled examples. A proof of one
   C import closes only that effect's stated claim.
5. Resolve the external architecture verdict and each affected F finding before its deletion or
   production authority change. Phases 2–7 additionally require the preceding phase's evidence,
   relevant host proofs, and a successful rollback rehearsal.

### Approved law coverage

| Approved entries | First required proof and later extension |
|---|---|
| M-1, M-5, M-12 | Phase 1 models recoverable intent, history/order preservation, and prompt acceptance; Phase 2 proves actual append/acknowledgment ordering; Phase 6 proves native storage. |
| M-2, M-3b, M-3c | Phase 1 models unresolved outcomes, effect identity, and truthful replay; Phases 3–4 inject lost receipts around real effects. |
| M-3a, M-11, M-18 | Phase 1 validates evidence authority; Phase 4 binds review and verification to the actual artifact/target and proves shared-destination publication. |
| M-4, M-7, M-8 | Phase 1 checks attribution and authority; Phases 2–3 prove issuance, exact-instance custody, release, and preservation; Phase 6 exercises native host paths. |
| M-10, M-13, M-14, M-17 | Phase 1 checks limits, wake/refusal meaning, and continuation ownership; Phases 2–3 and 5 prove delivery, backpressure, supervision, and public behavior. |

Each entry needs a proposition over the actual implementation, a checked proof, passing and
violating implementations, exact reproduction commands, and explicit host assumptions as specified
by the laws work item. Compile-pass/type-refusal probes establish only their stated mechanism.
The laws lead's trace and check reports record which application obligations remain open.

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

The test filenames are planned rewrite deliverables, not reported passing tests. This plan revision
runs document checks only. A phase evidence record must identify the implemented command and result.
Phase 7 replaces the migration harness with a native conformance runner in its final artifact.

## Phase 0: freeze the contract and corpus

### Subsystems that move

No production subsystem moves. The phase creates the compatibility assets used by later phases:

- the `baton.bridge.v1` schemas;
- fixture requests and answers taken from current tests;
- replay corpora containing valid rows, refused operations, partial effects, and recovery cases;
- an ownership map that assigns every inventoried seam member to a planned phase or an explicit
  temporary JavaScript host boundary and the phase that deletes it;
- an architecture decision ledger for every proposed deletion in `F1..F24`, with open decisions
  named and assigned to the phase they block; and
- the approved 16-entry contract encoded by the laws work item, with a trace and check report that
  separates proved application transitions from modeled statements and host assumptions.

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
machinery (`F24`). Each deletion receives its architecture verdict and required decision before it executes.

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
- prove every phase deletion has one proposed owner and an explicit open or settled decision.

Open architecture decisions block their affected deletions. They do not block collecting fixtures,
implementing codecs, or testing shadow decisions.

Phase 1 executable comparisons start after that test and the root-owned full suite pass on the
same commit. Pure model and fixture development can proceed before that gate.

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

The proof corpus covers the 16 approved laws using the coverage table above. It carries
representative source traces with their expected logical behaviour, and it includes a policy-bearing
stop replay, a missing-policy negative case that refuses to diagnose corruption, a changed
authorization basis, rejected mutations, preserved history, and owed wake cursors. Historical
`CS-*`, `AB-*`, `PM-*`, `WAKE-*`, and `LEDG-*` traces in the design notes locate current behavior
fixtures; each is classified as required compatibility, an expected correction, or an
internal-structure test of the current code shape. Current behavior that violates an approved law
receives an explicit expected correction and a regression case; baseline parity alone cannot certify
that behavior. The startup, doctor, and recovery entry points replay one valid ledger with
equivalent logical projections (ARCH-CLOSE-11).

### BATON2 deletions and merges

This phase merges the candidate implementations named by `F10`, `F13`, `F19`, and `F22` into
read-only Domain Kernel constructors and Journal projectors. It deletes nothing from production;
the shadow must first prove that these proposed merges retain canonical digests, authorization,
closed-set refusals, bounded views, idempotency classification, and wake derivation. The architecture verdict determines which merges can become production changes.

### Boundary contract

The phase enables `DecisionRequest` and a read-only `DecisionResult`. Both implementations must
agree on acceptance or refusal, refusal code and detail, proposed event payloads before sequence and
timestamp assignment, projection values, and wake class. The comparison report contains fixture
identity and field-level differences. It does not contain credentials or unbounded payloads.

### Proving test

`phase1-shadow-parity.test.mjs` must run every Phase 0 fixture and generated mutations through both
implementations. Required results are deterministic Bend2 results across repeated runs, bounded
execution for bounded reads, and identical replay projections at every fixture cursor.

The test runs each approved law through its published proposition, actual-transition proof, and
source regression case. A type-level claim includes a compile-pass and compile-refusal case;
host claims include failure injection. Affine drops, forged records, discarded history, and
receipt-without-write counterexamples from `LANG-F-26..29` belong in the negative corpus.

### Rollback

Disable shadow dispatch and stop the Bend2 process. JavaScript authority and ledger contents remain
unchanged. Shadow comparison rows may remain as diagnostic evidence because production projections
do not consume them.

## Phase 2: move coordination authority

### Subsystems that move

Entry requires the architecture verdict for F2/F8/F19/F20/F21/F23, an actual authority proof
for `B2-AUTHORITY`, and the Phase 1 result. JavaScript still owns physical append in this phase;
Bend2's durable acknowledgment must depend on the observed append receipt. A future native writer
requires `B2-FS-DURABILITY` before it acknowledges work.

Bend2 becomes authoritative for:

- command validation and permission checks;
- swarm and coordination state transitions;
- event admission and ordered event proposals;
- ledger-derived projections; and
- wake classification.

The target owners are Domain Kernel for typed admission, Journal and Projectors for durable append,
fold, query, and wake cursors, and Scheduler for command admission. The phase covers the proposed
journal merge (`F2`), checked authority boundary (`F8`), reconciler (`F9`), view merge (`F10`),
idempotency collapse (`F19`), append transaction (`F20`), task and journal waits (`F21`), schema and
refusal merge (`F22`), and wake subscription merge (`F23`).

JavaScript continues to own authenticated CLI, MCP, and web connections, durable event append,
bounded event reads, and delivery of wake frames. The current JavaScript decision path stays
available as the rollback implementation for one compatibility window.

### BATON2 deletions and merges

After the cutover proof, delete the `CoordinationStore` decision shell and its same-name forwarding
methods covered by `F1`. Merge the current coordination append and projection paths into the target
owners listed above under the operator-approved parts of `F2`, `F8` through `F10`, and `F19` through
`F23`. Keep versioned decoders and the JavaScript append/transport adapter until Phase 7. The proof corpus covers M-1, M-2, M-3b, M-3c, M-5, M-7, M-8, and M-10 through M-14,
with M-17 ownership across retry and recovery. Historical inventory rows remain source fixtures.

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
the checked authority and durable proof required by `F8` passes. Merge recovery under `F9`, context
lineage under `F12`, capacity leases under `F18`, and polling waits under `F21`. M-2, M-4, M-7, M-8, M-10, M-12, M-13, M-14, and M-17 govern this phase. The
historical custody/capacity/wake traces supply regression fixtures. F5/F7/F8/F18/F21 changes
remain gated on `B2-SUPERVISION` and `B2-AUTHORITY` evidence appropriate to each deletion.
A consumed or dropped lease does not prove that an external process, descriptor, or holder settled.

### Boundary contract

The phase enables closed `EffectRequest` and `EffectReceipt` kinds. Each effect request cites the
authorizing event cursor and its preconditions. The JavaScript executor validates the effect kind,
checks observable preconditions, performs the effect, preserves output through streaming or
artifact references, and returns a receipt. Bend2 decides the next state only from ledger rows and receipts.

Capacity and custody values include their authority identity and lease identity. A release cites the
grant it settles. A process receipt identifies the logical call, physical process when available,
exit or signal outcome, and bounded diagnostics. A provider receipt identifies the route and
logical call without carrying credentials.

### Proving test

`phase3-runtime-effects.test.mjs` must run the current admission, custody, process-lifecycle,
provider, workflow, recovery, and drain suites through the boundary. A fault matrix kills each side
at every request/receipt transition. The test proves one durable decision per idempotency identity,
one justified settlement or continuing owner per resource, no unowned workspace operation,
lossless diagnostic continuation, and the approved replayed state. Explicitly drop a child handle,
kill a parent, lose a signal receipt, and restart before release. Recovery must preserve accepted
work and custody. A join or affine field cannot supply these proofs by itself.

Load and memory results are recorded, but advancement uses operator-set service thresholds. The
operator records those thresholds before the canary so the result is not selected after measurement.

### Rollback

Close admission, allow receipt-bearing effects to settle, and classify each remaining effect as
completed, absent, or unconfirmed. JavaScript replays the ledger and resumes only operations whose
effect identity has a recorded result or a safe retry rule. Unconfirmed effects remain blocked for
operator review. Existing workers may finish through the JavaScript executor during the drain.

## Phase 4: move contribution and landing decisions

### Subsystems that move

Verification and Landing owns the publication operation end to end: contribution and review state,
capture and check eligibility, required-gate selection, landing plans, local integration, shared
publication, and the projection of each distinct outcome. Workspace and Artifacts executes scoped Git
operations; Journal and Projectors records their distinct outcomes. JavaScript retains Git, scratch
checkout, regeneration, runner, local-ref, and publication execution until Phase 6. Entry requires
the F16/F17/F20 architecture decisions, `B2-DESTINATION` planning and adapter
evidence, Phase 3 recovery, and the applicable approved law proofs.

### BATON2 deletions and merges

Merge capture, independent review, verification, gate planning, result adoption, and integration
under F16. Retain the seam inventory until typed declarations select the same or stronger gates,
then perform the approved F17 deletion. F20 merges append/replacement machinery only after its
write-order and recovery proof. M-3a, M-3b, M-3c, M-7, M-8, M-11, and M-18 govern publication;
M-2/M-17 govern interrupted delivery and continued ownership. Historical CL fixtures supply local
landing cases, including the empty range and target race.

### Boundary contract

`LandingPlan` binds contribution, immutable commit, merge-base, changed paths, regeneration,
required gates, reviewer/author authority, target ref, expected head, dry-run flag, and plan digest.
It also binds the canonical shared repository and target designated by admitted authority, the
expected shared target state, endpoint identity evidence, and configuration revision. Revalidate
those coordinates at publication dispatch. An unresolved destination identity produces no
publication effect.

The executor returns separate receipts for scratch creation, squash, regeneration, gates, local
compare-and-swap, publication dispatch, designated-destination observation, and cleanup. Preserve
`base`, `target`, `targetHeadBefore`, `targetHeadAfter`, `squashSha`, `changedPaths`, `gates`,
`regenerated`, `conflicts`, `issue`, and `dryRun` for local compatibility. Add a versioned
publication record with operation identity, destination identity, target, intended commit, observed
commit, and observation evidence. A local `targetHeadAfter` establishes local integration only.

Completion requires an independent observation that the intended commit reached the designated
shared target. If concurrent valid publication advances it, ancestry/content evidence must still
establish this operation's delivery under its publication policy. An alias pointing at a local
checkout does not establish shared-destination identity. The actual dispatch effect and its adapter
must conform to this binding. Dry runs produce verification receipts and perform no publication.

### Proving test

`phase4-landing-parity.test.mjs` runs the existing `issue296-swarm-integrate.test.mjs` cases through
both planners and one executor, then adds the deployment #558 publication path. Required cases:

- correct shared destination; wrong repository/ref; `origin` resolving to a local intermediary;
  push URL rewrite or destination configuration change after planning;
- local ref success followed by failed publication, lost publication acknowledgment, or unavailable
  destination observation; none establishes shared completion without delivery evidence;
- crash before and after squash, gates, local compare-and-swap, publication dispatch, destination
  observation, and durable completion;
- target movement, stale review/gate evidence, duplicate retry, empty range, and dry run;
- remote observation followed by replay, proving one logical publication and truthful receipt
  identity; cleanup refusal while custody or preservation obligations remain.

Bind the test to the publication adapter revision and an independently identified shared test
repository. Record destination and ref identities with the observed commit; redact credentials.
The test proves every pre-effect refusal preserves its target and every uncertain post-dispatch
outcome remains recoverable with a continuation owner.

### Rollback

Stop new landing admission and classify every active identity. With no observed local mutation,
clean only scratch state that custody and preservation permit. With observed local integration,
retain that commit and reconcile publication forward. With uncertain shared delivery, keep M-2
state and an M-17 owner until observation justifies settlement or retry. Restore JavaScript planning
from the same ledger; rollback performs no ref rewind or duplicate publication.

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

The prerequisite table records the open work: `B2-FS-DURABILITY`, `B2-PROCESS`, `B2-JSON`,
`B2-SUPERVISION`, `B2-AUTHORITY`, `B2-HTTP-TLS`, `B2-CRYPTO`, `B2-DESTINATION`, and
`B2-HOST-CONFORMANCE`. Each host tranche may be developed and tested independently now. Its
production cutover requires all prerequisites it consumes; Phase 6 completion requires the full set.

`LANG-F-08`, `LANG-F-16`, and `LANG-F-17` establish the C-effect route and a native artifact.
They do not prove the behavior of a new foreign implementation. Explicit release, process reap,
durable generation checks, and crash supervision remain until their replacements pass tests.

### Subsystems that move

All remaining transport and host-effect subsystems move to Bend2 in independently reversible
tranches:

- process spawn, signal, wait, exit observation, reap, and explicit task supervision;
- TCP listen, accept, connect, read, write, and close;
- UDP bind, send, receive, and close where current discovery or transport requires UDP;
- filesystem metadata, bounded reads and writes, atomic publication, file and directory sync, rename, links, directory
  traversal, permission checks, safe temporary files, and custody-aware cleanup;
- JSON decode, closed-shape validation, canonical encode, and bounded framing;
- git invocation, scratch-checkout management, gate execution, compare-and-swap ref updates, publication, and shared-destination observation;
- transport between Baton processes, including request framing, backpressure, disconnect, and
  restart behavior;
- terminal input, output, signals, hidden input, and exit status;
- HTTP/HTTPS/TLS, authenticated peer identity, and required Unix-domain socket transport;
- clocks, monotonic duration observations, secure entropy, hashes, HMAC, constant-time comparisons,
  signatures where used, and random identity generation;
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
malformed and large streamed JSON, Git/ref/destination races, interprocess backpressure, terminal interruption,
clock discontinuity, entropy failure, TLS/peer authentication failure, credential refusal, and
provider protocol failure. Kill the native host between write, sync, rename, directory sync, and
acknowledgment; drop task and lease values; prove explicit recovery and settlement. Record the
C runtime ABI and foreign-source digest with every result.

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

After all Phase 7 entry proofs, Phase 7 deletes `baton.bridge.v1`, every JavaScript adapter and effect host, Node
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

The migration harness `phase7-bend2-only-deployment.test.mjs` builds and installs the artifact in
an isolated environment containing no `node` executable or JavaScript source/package files. The
installed artifact runs a native conformance command whose executable, argv, and expected exit
are frozen in Phase 0 and implemented by this phase. The harness observes that command from
outside the artifact; the final package's test and startup paths require no Node runtime. It runs the full compatibility
corpus, public CLI/MCP/web sessions, process and socket fault matrix, filesystem and git landing
matrix, restart replay, and an operator canary. Static checks must find no runtime reference to
`baton.bridge.v1`, JavaScript, Node, or a JavaScript effect host. The final cursor and projection
digest must match the Phase 6 cutover receipt before new traffic is admitted.

### Rollback

During an operator-controlled release rollback window, stop Bend2 admission, classify active Bend2 effects,
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

- **ARCHITECTURE-VERDICT-PENDING:** the external Codex architecture verdict and its evidence must
  be incorporated into the revised F findings. Each affected production phase waits for its
  disposition and required architecture decision.
- **LAW-IMPLEMENTATION-EVIDENCE-PENDING:** the approved laws' contract needs checked application
  transitions, failing counterexamples, and host conformance.
- **PHASE-1-EVIDENCE-PENDING:** no completed differential run is claimed here.
- The host work items above require effect-specific native evidence before their dependent cutovers.
- The root owns assembled verification with `npm test --prefix impl` and the reviewed landing on
  `bend2-rewrite`. Local document checks do not establish a full-suite or destination result.

None of these evidence gates reopens the completed law approval.
