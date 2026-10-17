# Phase 77 — durable recursive Run authority

## Why this phase exists

Baton workers can use Baton's compact Run application to improve Baton recursively, but a worker
must not inherit the operator's fleet kernel, manufacture ancestry, or turn one authenticated
session into ambient control over unrelated Runs. Phase 75 bounds tasks inside one Run and Phase 76
bounds recovery attempts inside that Run; neither contract authorizes child Runs or makes stop/reap
transitive.

Phase 77 adds an opt-in, replayed application authority for that boundary. The store derives one
fixed-capability orchestrator lease from a live parent task and authenticated session, admits each
child's causal lineage before its first Run effect, and snapshots the complete descendant subtree
when it is stopped. Ordinary agents still send semantic `run.start`, `run.status`, and `run.stop`
requests. Repository, parent, task, worker, lease, ancestry, depth, ceilings, and stop targets are
server-derived coordinates, not public input plumbing.

## Contracts

### RR1 — closed opt-in deployment policy

Recursive Run authority exists only when a deployment installs one closed `runLineagePolicy` with
`schemaVersion`, `maxDepth`, `maxChildrenPerRun`, `maxDescendantsPerRoot`, and `leaseTtlMs`.
Normalization rejects missing, extra, non-positive, or deployment-excessive values, and the store
publishes the normalized policy and its digest for advanced inspection.

The policy is opt-in. A deployment that does not configure it retains the earlier non-recursive Run
and stop schemas; replay may not silently reinterpret a historical ledger as recursive authority.
Custom store and Coordinator assembly must agree on the same policy.

The store also binds recursive authority to one deployment-owned repository identity. A lease or
subtree-stop request cannot relabel that identity with a caller-supplied repository coordinate;
repository mismatch refuses before append or any worker effect.

### RR2 — one fixed-capability application lease

`run.orchestrator_lease_issued` binds exactly one repository, authenticated principal and session,
session-authority digest and expiry, live parent Run, parent task identity and version, and current
worker owner. The parent task must be working under that owner and must carry the explicit
`baton_orchestrator` capability. The lease grants exactly:

- `run.start`;
- `run.status`; and
- `run.stop`.

It grants no Goal/Plan approval, answer, steer, review, adoption, integration, export, credential,
worker, fleet-kernel, publication, or deployment-shutdown authority. Its expiry is the earlier of
the authenticated session expiry and the deployment lease lifetime. Lease identity, request,
policy, and payload are independently digested, and no bearer credential is persisted in the
coordination ledger.

### RR3 — exact parent and session authority remain live fences

Every use rechecks repository, principal, session, session-authority digest, lease identity and
digest, expiry, revocation, parent task version, parent Run, current worker ownership, parent
working state, and parent Run stop state. Changed session or ownership facts cannot be normalized
into a fresh lease. An expired lease or an inactive parent refuses before child Goal, Plan,
worktree, runtime, provider, or adapter effects.

Revocation is a durable, idempotent `run.orchestrator_lease_revoked` event bound to the exact lease
digest and one closed reason. Revoked leases never authorize a later child admission or command.

### RR4 — lineage is admitted before every child Run effect

`run.lineage_admitted` accepts only a globally fresh child Run ID plus an intent digest. Baton
derives the root and parent Runs, parent task/version/worker, lease identity, depth, ordered
ancestors, and parent-lineage event. A caller cannot supply or override parent, root, depth,
ancestors, lease, capability, or ceiling coordinates.

The lineage append precedes the child's first Goal, Plan, task, or other Run effect. A Run ID that
already has lineage or any Run effect cannot be backfilled into a different ancestry. Direct
children and descendants are stable, deterministic projections of durable admitted lineage.

### RR5 — independent recursion ceilings

Admission prospectively enforces three independent policy limits:

- child depth from the root;
- direct children of the selected parent Run; and
- total descendants of the root Run.

The exact boundary succeeds and the first row beyond any limit refuses without a lineage, Goal,
Plan, worktree, runtime, provider, or adapter effect. These Run ceilings complement, rather than
replace, Phase 75's task depth, relation fanout, and tasks-per-Run ceilings.

### RR6 — application attenuation is subtree-scoped

A valid lease can start a new child and can inspect or stop only Runs admitted beneath that lease's
parent. Baton's authority check normalizes the recursive command to the fixed `run.start`,
`run.status`, or `run.stop` capability before execution. The lease cannot target its own parent,
an ancestor, an unrelated Run, or a sibling subtree, and it cannot reach another application
command by changing a command alias or replay path.

Application replay rechecks the same lease, authenticated session, normalized command, target Run,
and subtree scope. Successful historical execution is not authority to replay after expiry,
revocation, ownership change, or stop.

### RR7 — Web and MCP inject private authority

Authenticated Web and MCP servers look up one unambiguous active lease from their already-trusted
repository, principal, session, session expiry, and session-authority state. They inject an exact
private command context containing transport, request identity, idempotency identity, and the
derived session authority. Public application arguments, Web request schemas, and MCP tool schemas
contain no lease ID, authority digest, credential, expiry override, ancestry, depth, or ceiling
field.

The private context is server-created on first execution and re-derived and re-attested on replay.
Missing lookup means an ordinary non-recursive session. Once the same authenticated session has a
durable lease history, inactive, expired, revoked, stopped, or ambiguous lookup is an exact refusal;
it may never degrade into ordinary authority and replay a command through a weaker path. Web and
MCP preserve those recursive refusal codes rather than collapsing them into generic transport
failure. They therefore use the same application and CoordinationStore authority rather than
maintaining a second recursive state machine.

`run.inspect` and `run.follow` re-attest recursive and ordinary application authorization after
every long-poll wake and immediately before returning a projection. Authority invalidated during a
wait cannot observe a newer event or receive a stale pre-wait result.

### RR8 — stop admission snapshots one immutable subtree

With recursive authority enabled, `run.stop` is admitted with scope `run_subtree`. At one exact
`throughSeq`, the store derives and sorts the selected Run plus all then-admitted descendants, every
task belonging to those Runs, and every owned worker belonging to those tasks. The immutable
`targetRunIds`, `targetTaskIds`, and `targetWorkerIds` union plus `throughSeq` forms one
`targetDigest` that survives replay.

Every snapped descendant resolves to the same stop authority. An ancestor or unrelated sibling is
not included. Stop admission immediately fences new descendant lineage and later effects inside
the snapped subtree, so no future child can escape after the immutable snapshot.

### RR9 — physical subtree stop closes only on exact reap

The application sends the immutable target-worker union to the ordinary lifecycle stop path exactly
once and records a `run_subtree` receipt only after that path returns:

- `remainingCount === 0`; and
- `processesObserved === processesClosed`.

One unclosed or unconfirmed snapped process keeps the stop incomplete; Baton may not publish a
durable `stopped` receipt or infer cleanup from a kill request. Export and retry activity for every
target Run is aborted before completion, while unrelated sibling Runs remain open.

### RR10 — replay is recursive authority

Startup reconstructs leases, revocations, lineage, child/descendant projections, policy digests,
subtree-stop aliases, immutable target sets, and stop receipts from the durable ledger. Exact
request retries replay their original event. Changed actor, authenticated session, payload,
meaning, or idempotency use conflicts before append. Timestamp, digest, ancestry, ceiling,
capability, through-sequence, target-set, or receipt tampering fails coordination integrity rather
than being repaired into a permissive state.

### RR11 — recursive truth is one sanitized application cascade

When recursive authority is configured, the ordinary `run.inspect` outline and its discoverable
`orchestration` section project the selected Run's role and depth, direct-child and descendant
counts, effective recipient-lease state and counts, and admitted subtree-stop state and target
counts. The projection contains no repository path, task or worker identity, session coordinate,
lease identity, or request/authority/lease digest. A deployment without recursive policy shows no
recursive outline claim and an empty orchestration section.

`run.follow` classifies lease and lineage changes as `orchestration` and stop changes as `cleanup`.
The authenticated SSE snapshot exposes only a conditional deployment-level policy/count outline;
event replay retains useful event kinds while removing nested session and recursive authority
proofs.

## Validation status

The focused Phase 77 CoordinationStore, Coordinator/application, authenticated Web, and MCP
matrices are green. They cover policy closure, fixed capability and scope attenuation, exact
parent/session binding, expiry, revocation, idempotency and ledger tamper, global child freshness,
all three Run ceilings, pre-effect lineage ordering, private transport injection and replay, exact
subtree snapshots, prospective descendant fencing, unrelated sibling isolation, and physical
kill/reap receipt invariants. Adversarial follow-up coverage also proves deployment-bound repository
identity, no historical-lease downgrade through Web or MCP, exact refusal transport, long-poll
reauthorization before projection, sanitized SSE replay, and the unified application orchestration
cascade.

A native Kimi Code K3/max Baton-on-Baton run additionally proved that the ordinary objective-first
surface can reach a real recursive worker and preserve a useful checkpoint at its wall boundary.
That run exposed an ACP-close race which could misclassify Baton's own wall-time kill as a generic
provider-protocol failure. The timeout now wins that race, emits one typed terminal failure before
exact close/kill confirmation, releases session ownership, and is regression-covered. The
checkpoint's deployment-factory idea remains useful, but its copied route table and one-adapter
assembly were stale; it is an adaptation input, not a change to cherry-pick.

This validation statement does not claim complete multi-harness recursive dogfood.

## Security and product boundary

Phase 77 is application authorization and causal/lifecycle ownership. It is not an operating-system
sandbox, secret-isolation boundary, capability-secure same-UID process, container, VM, network
policy, or external credential broker. A full-permission worker running as the same OS user may be
able to inspect another same-UID process's files or environment despite Baton's private runtime
projection. Hard adversarial isolation remains a separate system gate.

The Run-lineage ledger and causal projections are Baton-owned and deployment-neutral. This phase
adds no homelab integration and no dependency on an external project-manager runtime.
