# Phase 11.4 — durable coordination and knowledge substrate

This specification implements goal catalog A/G and the Scratch/Cairn portions of H without a
homelab or `project-manager` runtime dependency. `project-manager` is prior-art inspiration for
typed causal structure and audits only. Baton owns a deployment-neutral, single-host-first event
store and deterministic projections.

The first implementation vertical is deliberately one substrate, not four unrelated databases:
task, artifact, Scratch, and knowledge mutations are typed coordination events. The append-only
event file is truth; every query result is a replayable projection.

## CK1 — one durable coordination stream

`CoordinationStore(root)` owns an append-only `events.jsonl` with gap-free global `seq`, hub-stamped
ISO time, schema version, `kind`, authenticated/audited `actor`, idempotency key, and JSON payload.
Only the hub writes. An append is durable before its projection mutates. Duplicate idempotency keys
return the original event without a second mutation. Torn/malformed tails fail startup visibly;
they are never silently reset or skipped. Replay produces byte-equivalent public projections.

The store path is explicitly supplied by the assembly and never derived from a worker cwd. It has
no network, PM, or homelab dependency.

## CK2 — typed durable task DAG and claims

A task record contains:

```text
id, brief, status, deps[], assignee, version, refines, taskType,
createdEvent, claimedEvent, terminalEvent, artifactIds[]
```

Status is `pending | working | input_required | completed | failed | cancelled`. Terminal states
are immutable. Allowed nonterminal transitions are explicit. Creation rejects missing deps and
cycles. A task is ready iff it is pending, unassigned, and every dependency is completed.
`claimTask(id, worker, expectedVersion, key)` is compare-and-swap: exactly one concurrent caller
wins; stale, blocked, already-assigned, and terminal claims are typed refusals and do not append.
Refinement creates a new task with `refines`; it never reopens a terminal task.

Coordinator `spawn()` durably creates the task before returning a handle, including when the task
will remain queued. Dispatch durably claims it. Input waits, recovery, cancellation, verification
accept/reject, and integration/publication outcomes are reflected by typed events. Restart rebuilds
queued tasks, dependency readiness, assignments, terminal state, and automatic identifiers before
dispatching anything.

## CK3 — immutable artifact manifest

Artifacts are manifests, never copied bytes:

```text
id, taskId, kind, refs, mediaType, digest, size?, provenance[], createdEvent
```

Kinds include `commit | diff | verification | coverage | mutation | review | report |
counterexample | representation | skill | bench-result`. `refs` are Git SHAs/refs or explicit
content-addressed paths owned by Baton. Registration validates the task, snapshots caller-owned
data, and is idempotent by manifest identity. Manifests are immutable; correction creates a new
artifact linked by knowledge edges. Accepted capture, verdict, independent review, integration,
and publication register/link their artifacts through the public driver.

## CK4 — Scratch is an event-derived operational projection

Scratch supports the smallest worker-useful primitives:

- append-only facts with namespace/key, `envRef`, `observed | derived` grounding, evidence refs,
  and optional explicit expiry event;
- advisory claims with resource glob, owner worker/task, intent, `envRef`, supervisor fence,
  version, and lease deadline;
- point checks that return clear/held plus a mandatory cross-environment warning when the fact or
  claim was observed on another tree; and
- explicit `scratch.claim_expired` / `scratch.fact_expired` events.

There is no reader-clock expiry, heartbeat verb, free-text fleet chat, mutable world-state blob, or
general CAS document in the first vertical. Claim expiry is a hub-emitted event slaved to worker
lease/terminal state, so replay at different wall times is identical. Path-resource conflicts use
conservative glob intersection; uncertain overlap conflicts rather than false-negatives. Exclusive
OS resources remain the sandbox/allocator's job, not an advisory Scratch claim.

Worker-facing participation is eventually ambient through mediated tool results; until that tool
path ships, the public store exposes deterministic point checks rather than a polling/watch loop.

## CK5 — self-contained typed bitemporal causal knowledge graph

The graph is a materialized view over coordination events. It supports typed nodes:

```text
Run, Task, Artifact, Phase, Experiment, Finding, Decision, Hypothesis, Principle,
Constraint, Literature, Research, RouteStat, Skill, Counterexample, Representation,
ScratchFact
```

and typed directional edges:

```text
Supports, Contradicts, Supersedes, Informed, ProducedBy, Contains, DependsOn,
Refines, ReadBy, VerifiedBy, DerivedFrom, Affects, Cites, ObservedIn
```

Every node and edge stores observation time (coordination seq/time), event time (referenced source
seq/time), and valid time (`validFrom`, nullable `validTo`). Invalidated beliefs are never deleted.
`Supersedes` and contradiction resolution append invalidation events with compare-and-swap on the
current validity version.

A Decision is rejected unless it has at least one `Informed` evidence reference. A verified
Finding is rejected unless it has `ProducedBy`/`VerifiedBy` evidence. Temporal coherence rejects
evidence whose source sequence/time is later than the node or edge event time. Worker/recalled text
is always marked untrusted prose; grounding is hub-derived (`verified | observed | derived |
asserted`) and never taken from a model confidence float.

`queryKnowledge({asOf, observedAt, types, grounding})` applies both temporal dimensions.
`traceKnowledge(id)` returns causal paths to immutable events/artifacts. Recall is pull-only,
token-bounded at the caller, contradiction-aware, provenance-framed, and logged with `ReadBy`;
nothing is automatically injected into a worker context.

## CK6 — selective promotion and health

Promotion is deterministic candidate generation, not an LLM in the control path:

- terminal task + verification/artifact → Finding;
- consequential human/orchestrator spawn, reroute, accept, integrate, publish, abort → Decision;
- run boundary → Run scorecard;
- repeated verified outcome → RouteStat/Playbook candidate;
- cited observed Scratch fact → Finding candidate;
- derived/formal Scratch fact remains quarantined until an independent oracle links it.

The first vertical implements explicit node/edge writes plus task/artifact auto-promotion hooks.
Later scorecard/recall promotion uses the same schema. `auditKnowledge()` reports causal
completeness, temporal coherence, orphan nodes, contradiction resolution, invalid references,
recall utility, and read-contamination blast radius separately—never one unexplained green bit.

## CK7 — contamination and read provenance

Every knowledge or Scratch read that crosses into an orchestrator/worker context records reader,
run/task, returned IDs, query/as-of boundary, and source validity versions. If a node is later
invalidated, `affectedReaders(id)` identifies every downstream task/run that consumed it. A
cross-tree Scratch read is labeled “observed on X — not your tree.” This is required before shared
knowledge can influence routing or acceptance.

## CK8 — authority and public assembly

The store is constructed by `createDriver()` and exposed as `coordination`; coordinator task and
artifact events flow into it automatically. Direct mutation methods require an actor and
idempotency key; future MCP/web surfaces map authenticated identity into that same actor field and
do not bypass coordinator fences or approvals. Knowledge export/import is ordinary data I/O behind
future approval gates, not a special PM/homelab integration.

## CK9 — zero-quota safety gate

Temp-directory and temp-Git tests must prove before provider dogfooding:

1. duplicate append keys and duplicate task creates are idempotent;
2. queued/unassigned tasks and dependency readiness survive restart;
3. claim CAS has exactly one winner and terminal states cannot reopen;
4. cycles, stale versions, invalid transitions, and missing deps refuse without events;
5. artifact manifests are immutable and linked to accepted tasks;
6. Scratch conflicts, explicit lease expiry, replay determinism, and cross-tree warnings;
7. causal/temporal graph rejections, bitemporal as-of query, contradiction/supersession history,
   and affected-reader tracing;
8. public-driver task creation, terminal verdict, captured commit, review, and integration appear
   in the durable substrate; and
9. a full restart has identical task/artifact/Scratch/KG projections before any new dispatch.

After CK9 is green and committed, Baton may recursively run a real provider review against this
spec and implementation. The recursive task must use isolated runtime credentials/budgets, exact
model selection, a pinned verification command, independent trust-gate verification, and confirmed
kill/process/worktree/branch cleanup.

## Explicitly later, never deleted

- durable pending question/approval reconstruction and automatic live-session rejoin;
- a SQLite/other query index (projection only), multi-process writer locking, and multi-machine
  replication;
- ambient Scratch injection in tool mediation, Bench action-cache execution, notify subscriptions,
  and task promotion from contention;
- automatic scorecards, bounded lexical/graph recall ranking, RouteStat feedback, Playbook/Skill
  promotion, and import/export tooling;
- authenticated MCP/HTTPS/WebSocket access (uses this substrate but ships in its own phase); and
- graph-backed Atlas/CPG/representation nodes (schema is reserved here; producers ship later).
