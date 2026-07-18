# Phase 76 — durable recovery-attempt authority

## Why this phase exists

Native-session recovery can start a real provider-side attach. In-memory promise coalescence and a
generic `recovery.requested` record cannot determine after a crash whether that effect never began,
attached successfully, was closed, or remains ambiguous. Automatic retry from that uncertainty can
double-dispatch one native session.

Phase 76 makes recovery a two-phase, replayed compare-and-set authority. The CoordinationStore
admits one exact attempt before any provider, operational-log, runtime, or adapter effect, then
completes that admission with one deliberately small transport outcome. The application remains the
normal surface: it supplies deployment-owned recovery policy, while the Coordinator derives attempt
identity and sequencing server-side.

## Contracts

### RA1 — one closed admission schema

`recovery.attempt_admitted` has exactly these fields:

- `schemaVersion`, `scope`, `repoId`, and nullable `runId`;
- `seriesId`, `attemptId`, `attempt`, `maxAttempts`, and nullable
  `expectedAttemptHeadEvent`;
- `priorTask: {id, version, terminalEvent}`;
- `recoveryTaskId`;
- `verifiedOwner: {workerId, evidence: {coordinationSeq}}`;
- `session: {idDigest, contextDigest, nextProcessGeneration}`;
- `route: {tupleKey, adapterCardDigest, modelPolicyDigest}`;
- nullable `workerPolicy`, otherwise
  `{requestDigest, resolutionDigest, adapterCardDigest}`;
- `authority: {gateDigest, profileDigest, recoveryPolicyDigest}`; and
- `requestDigest` plus `admissionDigest`.

`scope` is exactly `session_recovery`. The store independently proves that the prior task exists in
the named Run, is the current completed and non-revoked version, belongs to the named worker, and
terminates in the exact mapped hub-verification evidence. It also binds the prior task's route tuple,
validates the Phase 75 recovery topology prospectively, and refuses admission after Run stop.

The idempotency key is `recovery.attempt:<attemptId>`. An exact actor-and-payload retry replays the
existing event; reuse with changed meaning conflicts without appending.

### RA2 — deterministic physical identities

All hashes below are canonical SHA-256 digests. The series is:

`recovery-series:<digest({schemaVersion: 1, repoId, runId, priorTaskId, workerId,
sessionIdDigest, sessionContextDigest})>`.

The recovery task is:

`recovery:<digest({seriesId, attempt, priorTask, verifiedOwner, session, route, workerPolicy,
authority})>`.

The attempt is:

`recovery-attempt:<digest({seriesId, attempt, recoveryTaskId})>`.

`requestDigest` binds the normalized admission core including those derived identities;
`admissionDigest` additionally binds `requestDigest`. Forged series, task, attempt, request, or
admission identities fail closed. The recovery refinement must use the admitted `recoveryTaskId`;
recovery code may not mint a second task identity after the external effect begins.

### RA3 — durable head CAS and deployment ceiling

The first attempt in a series is attempt one with a null expected head. Every later attempt is the
next contiguous integer and names the previous completion event as `expectedAttemptHeadEvent`.
Only one pending attempt may exist for a prior task and verified owner, including across an attempted
series-coordinate fork.

`maxAttempts` is a positive bounded deployment value, immutable with the series authority, and an
effective exact ceiling. The application forwards the selected profile's `maxAttempts`, but never an
attempt number. Direct recovery uses the Coordinator's deployment `recoveryMaxAttempts`; supervised
startup receives the same ceiling from closed `sessionRecoveryPolicy`. Attempt number, head, IDs,
route/card bindings, and recovery task identity are derived below the application surface.

### RA4 — admission precedes every external effect

After pure eligibility, session-context, route/card, worker-policy, and topology checks, the
Coordinator durably admits the attempt before:

1. provider-turn admission;
2. `control.recovery_requested` or its coordination mapping;
3. private runtime creation; or
4. adapter resume/spawn.

A provider refusal therefore completes the attempt as `not_started` and reaches no recovery log,
runtime, or adapter effect. Once an adapter effect may have started, an unclassified exception can
no longer be represented as `not_started`.

### RA5 — one closed completion schema

`recovery.attempt_completed` has exactly `schemaVersion`, `attemptId`, `admissionDigest`, `state`,
`receipt`, and `receiptDigest`. The receipt is exactly
`{schemaVersion, effectStarted, transportDisposition}`; its digest is independently verified, its
transport disposition equals the completion state, and `effectStarted` is false only for
`not_started`. Completion uses the admitting actor and idempotency key
`recovery.attempt.complete:<attemptId>`.

The four outcomes are authoritative:

- `not_started`: no external recovery effect began; another exact same-series attempt may be
  admitted.
- `closed`: the effect began and cleanup was confirmed; another exact same-series attempt may be
  admitted.
- `attached`: the native session attached; automatic continuation is fenced.
- `unknown`: effect or cleanup disposition is ambiguous; automatic continuation is fenced.

Only `not_started` and `closed` are retryable. `pending`, `attached`, and `unknown` never authorize
automatic redelivery.

### RA6 — replay and startup use the same authority

Replay reconstructs the attempt-by-ID projection, one exact series head, pending attempts, actors,
receipts, and completion states from the two event kinds. Admission or completion tampering fails
coordination integrity rather than being normalized into a retryable state.

Startup recovery scans bounded durable attempt state. It excludes an orphaned native session when
the same prior task and worker has `pending`, `attached`, or `unknown` authority, and permits it past
this gate only after `not_started` or `closed`. The ordinary session, adapter-card, dispatch, context,
capacity, Run, topology, and verification gates still apply; retryability is not itself an attach
authorization.

### RA7 — integration and validation status

Focused Phase 76 authority and integration contracts are green across the store, Coordinator,
application, and startup selection. They cover closed schemas and digests, idempotency conflicts,
task/Run/owner/head CAS, ceiling enforcement, replay tamper rejection, deterministic identities,
effect ordering, provider refusal, confirmed and unconfirmed cleanup, application delegation, and
startup filtering. This statement does not claim a new full-suite result or recursive Run authority.

## Deliberate boundary and next authority slice

Phase 76 governs recovery inside one Run. It does not authorize a Baton worker to create or control
descendant Runs, attenuate orchestration capabilities, or make stop/reap transitive. The active
frontier is durable recursive Run lineage plus application-only orchestrator leases, followed by
subtree stop snapshots and exact descendant kill/reap.

Full-permission same-UID harness execution also remains an explicit security limit: private runtime
projection reduces accidental credential exposure but cannot provide adversarial credential secrecy
from another process with the same operating-system identity. That requires a distinct UID,
container/VM, or external credential broker and is not changed by recovery authority.
