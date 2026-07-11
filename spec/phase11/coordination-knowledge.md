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

### CK1a — relation to per-worker operational logs

Existing `<worker>.jsonl` streams remain lossless high-volume operational telemetry with local
per-worker sequence numbers. They are not a second task/KG truth. Every state-changing driver path
first appends its typed coordination mutation; only then may the in-memory task/artifact/Scratch/KG
projection change. Operational evidence is referenced as `{worker, seq, digest}` and becomes
cross-worker comparable only through an `evidence.mapped` coordination event whose global sequence
is the observation order. Knowledge temporal checks use the global coordination sequence, never a
bare per-worker sequence.

The two files cannot be transactionally committed together. Reconciliation therefore scans
operational evidence references at startup: an operational event with no coordination mutation is
telemetry only and cannot affect task/KG truth; a coordination event pointing to missing or
digest-mismatched operational evidence fails integrity validation. Coordination append failure is
fatal to the requested state mutation and leaves its projection unchanged. It may not use the
legacy warning-and-drop behavior of the telemetry sink.

Construction validates the complete coordination stream immediately: JSON parse, schema version,
gap-free sequence, unique idempotency key, and final newline. A truncated/torn tail is an
actionable startup error and is never auto-truncated. Schema migration is explicit versioned event
translation into a new store, not in-place reinterpretation.

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
will remain queued. It may preallocate a public pending worker handle as a local reservation, but
the durable task `assignee` remains null until dispatch wins `claimTask`; reservation is not claim.
Dispatch durably claims it. Input waits, recovery, cancellation, verification
accept/reject, and integration/publication outcomes are reflected by typed events. Restart rebuilds
queued tasks, dependency readiness, assignments, terminal state, and automatic identifiers before
dispatching anything.

Every adapter- or outside-world-reaching action has a durable intent before the effect: stop,
persistent follow-up, recovery attach, review-task creation, local integration, publication
request, and publication authorization. If intent append fails, no adapter, worktree/Git merge, or
publisher is called. If an adapter has already confirmed stop/attach/turn advancement when a later
terminal/refinement append fails, the coordinator is poisoned, resolves any public waiter with a
typed coordination-unavailable result, kills or quarantines the ambiguous transport, and restart
closes the still-nonterminal durable task. Asynchronous adapter callbacks may not turn an already
recorded fatal coordination fault into an uncaught process exception.

A refinement that cannot be materialized after native advancement records an explicit aborted
attempt, preserves its terminal predecessor without pretending the attempted turn succeeded, and
replays the native session as orphaned. An input delivery accepted before an authoritative append
failure commits and releases its single-consumer reservation so racing responders cannot hang or
redeliver.

Publication is a post-effect special case: authorization is durable before the publisher, while
the knowledge decision and driver completion become authoritative in one coordination append
batch after the effect. Replay accepts `publication.completed` telemetry only when that atomic
authority record exists: the mapped operational digest, decision event, adjacent paired driver
record, shared batch-key lineage, task identity, evidence reference, and publication payload must
all agree. Otherwise the already integrated task remains completed, publication is reported
unknown/not completed, and the poisoned live coordinator fails closed.

Local integration uses the same post-effect authority rule. `integration.requested` precedes Git;
after a successful local merge, its decision, driver completion, and accepted integration artifact
commit in one coordination batch. Replay requires the mapped operational digest, complete paired
batch, task/evidence identity, SHA payload, and accepted provenance. A merge followed by authority
storage loss poisons the live coordinator and replays integration as unknown rather than claiming
or repeating the merge.

`task.created` persists `brief`, `deps`, `refines`, `taskType`, requested vendor/model/session
policy, and the reserved public handle ID. `task.claimed` persists assignee, resolved vendor/model,
and expected/new versions. Refusal codes are `stale_version | already_assigned |
deps_unsatisfied | terminal | cycle`; refusals append no event. Recovery terminalization refines or
terminates the durable record and may never reopen a terminal predecessor.

## CK3 — immutable artifact manifest

Artifacts are manifests, never copied bytes:

```text
id, taskId, kind, refs, mediaType, digest, size?, provenance[], createdEvent
```

Kinds include `commit | diff | verification | coverage | mutation | review | report |
counterexample | representation | skill | bench-result`. `refs` are Git SHAs/refs or explicit
content-addressed paths owned by Baton. Registration validates the task, snapshots caller-owned
data, and is idempotent by manifest identity. `artifact.registered` names the immutable manifest;
`artifact.superseded` links a correction without mutation. Failed/cancelled tasks may register
counterexamples, logs, and reports, but an artifact marked `accepted` must cite the accepting
verification/review event. Accepted capture, verdict, independent review, integration, and
publication payloads carry manifest IDs through the public driver rather than leaving provenance
split across `capturedSha` and worker prose.

## CK4 — Scratch is an event-derived operational projection

Scratch supports the smallest worker-useful primitives:

- append-only facts with namespace/key, immutable `envRef:{repoId,treeSha}`, `observed | derived`
  grounding, evidence refs,
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
Live worktree paths are invalid environment references; callers snapshot `git write-tree` (or an
equivalent content digest) before posting. A different `treeSha` always produces the exact warning
frame `observed on <treeSha> — not your tree`.

Normative path-claim overlap is conservative: normalize repository-relative POSIX paths; exact
paths overlap on equality; a glob overlaps an exact path if the path matches; two globs overlap if
either literal prefix before its first wildcard is a prefix of the other or an implementation can
exhibit a matching witness. If disjointness cannot be proven, they conflict. This may false-positive
but may not false-negative a known overlap.

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

The durable read record is `knowledge.read{readerActor, readerWorker, runId, taskId, nodeIds[],
query, asOf, observedAt, validityVersions}`. Its append must succeed before recalled content is
returned. The graph projection creates `ReadBy` edges from every returned node to the reader task/
run. An unlogged read is a failed operation, never a degraded success.

## CK6 — selective promotion and health

Promotion is deterministic candidate generation, not an LLM in the control path:

- accepted terminal task + verification/artifact → `knowledge.promoted{kind:'Finding'}`;
- consequential human/orchestrator spawn, reroute, accept, integrate, publish, abort → Decision;
- run boundary → Run scorecard;
- repeated verified outcome → RouteStat/Playbook candidate;
- cited observed Scratch fact → `knowledge.promotion_candidate{kind:'Finding'}`;
- derived/formal Scratch fact remains quarantined until an independent oracle links it.

The first vertical implements explicit node/edge writes plus named task/artifact auto-promotion
hooks. Failed/unaccepted tasks never auto-promote a positive Finding; they may promote a
Counterexample or failure Finding with explicit grounding.
Later scorecard/recall promotion uses the same schema. `auditKnowledge()` reports causal
completeness, temporal coherence, orphan nodes, contradiction resolution, invalid references,
recall utility, and read-contamination blast radius separately—never one unexplained green bit.

## CK7 — contamination and read provenance

Every knowledge or Scratch read that crosses into an orchestrator/worker context records reader,
run/task, returned IDs, query/as-of boundary, and source validity versions through
`knowledge.read`. If a node is later invalidated,
`knowledge.contamination_record{nodeId, invalidationEvent, affectedReadEvents[]}` is appended and
`affectedReaders(id)` projects every downstream task/run that consumed it, including current task
status. A
cross-tree Scratch read is labeled “observed on X — not your tree.” This is required before shared
knowledge can influence routing or acceptance.

## CK8 — authority and public assembly

The store is mandatory in `createDriver()` and returned as `{coordinator, story, router, log,
coordination}`. The coordinator receives it in its constructor and invokes one non-optional
state-changing integration point for spawn/create, dispatch/claim, input wait/resume, terminal,
capture/verification, review, integration, and publication. A driver state mutation with no
coordination event is a contract failure, not an optional sink failure. Direct mutation methods
require an actor and
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
10. an unsatisfied-dependency task crashes before dispatch and replays pending, unassigned, with
    its exact `deps[]`, brief, requested vendor/model/session, and reserved handle identity;
11. a multi-task DAG replays with the same ready set and cannot dispatch a dependent early;
12. a truncated tail, sequence gap, duplicate key, missing operational evidence, and injected
    append failure all fail visibly without projection mutation;
13. every public spawn/claim/input/terminal/capture/review/integration/publication state change has
    a coordination event, and the test fails if coordinator state is nonempty while the substrate
    stream is empty;
14. operational evidence mapping gives two worker-local events a comparable global observation
    order without treating their local sequences as globally ordered; and
15. after a logged knowledge read, invalidating the node yields a nonempty contamination record
    and `affectedReaders()` result; a forced read-log append failure returns no recalled content.
16. injected append failures cover create, claim, input wait/resume, stop intent, cancel terminal,
    persistent follow-up/recovery refinement, review creation, terminal artifact batch,
    integration intent, publication authorization, and knowledge/Scratch reads. Pre-effect
    failures call no adapter/Git/publisher; post-effect failures are bounded, poison authority,
    preserve the earlier intent, never redeliver a single-consumer effect, and replay the affected
    task/attempt/session/publication as failed, aborted, orphaned, or outcome-unknown rather than
    fabricating success. A terminal predecessor is not rewritten merely because a later refinement
    attempt failed.

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
