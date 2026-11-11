# Phase 92.2 — physical workspace owner authority

Phase 92 made logical workstreams stable across Attempt generations, but the worker worktree layer
still used logical `taskId` as its branch, directory, and capacity-reservation identity. Two
independent deployments could therefore select the same valid logical task and collide on one Git
branch. A crash inside `git worktree add -b` could also leave a branch without the metadata needed
to decide whether it was Baton's dead residue or another controller's live authority.

Phase 92.2 separates logical task identity from one bounded opaque physical workspace owner. It is
a lifecycle correction beneath the existing objective-first API. Callers continue to supply no
physical ID, branch, worktree path, receipt coordinate, process generation, or cleanup selector.

## PO1 — separate logical and physical identities

`taskId` remains the stable logical task/WorkItem identity. Before any worker branch effect, Baton
internally allocates a collision-resistant `ws-<opaque>` physical owner. Only that physical owner
names the worker branch, worktree directory, and capacity reservation. Reusing one logical task ID
in independent controllers therefore creates disjoint branches and private writable worktrees.

The physical owner is qualified by a stable deployment identity and an exact controller
incarnation. Deployment identity derives from deployment-owned state authority; controller
identity derives from the current PID-start-fenced coordination writer lease. Neither identity is
accepted from a Run, Workflow, transport, adapter, worker, or ordinary caller.

## PO2 — pre-effect durable ownership receipt

Before branch creation Baton exclusively publishes one mode-0600 receipt under the shared common
Git directory. Its closed, digest-bound fields are:

- physical owner, branch, worktree, and exact base SHA;
- deployment and controller incarnation;
- Run, Attempt, logical task, and process generation; and
- allocation state and creation time.

The receipt is written before `git worktree add`. Successful registration advances it to `ready`,
and the operational log appends `worktree.owner_bound` with the same binding before
`worktree.ready`. Cleanup removes the transient common-Git receipt only after directory,
registration, branch, and capacity absence are proven; the operational event remains durable
evidence. Response loss cannot cause a second physical owner to be inferred from the logical ID.

## PO3 — exact adoption and use

Capture, session validation, progress preservation, process recovery, stop, and reap address the
physical owner recorded in the existing session context. Logical task attribution remains on the
task and Run. A restart may adopt an exact live process/worktree only through the existing process
generation and PID-start authority plus the matching physical-owner receipt. Branch or path
similarity grants no authority.

Direct, authenticated Web, CLI, MCP, and browser semantics remain unchanged: transport callers
never choose or replay a physical owner. Existing requested/resolved/observed route and exact
process recovery semantics are preserved.

## RC1 — branch/worktree crash reconciliation

Reconciliation scans receipts in the common Git directory as well as local worktree metadata and
Git registrations. A receipt plus its exact branch, with no directory or registration, is the
branch-only crash state. Baton removes it only when the bound controller is proven dead by one of:

1. a new exclusive controller incarnation for the same deployment; or
2. exact local PID-start observation proving a foreign controller absent or reused.

Removal is idempotent and postchecks branch and receipt absence. A receipt without a branch is an
equally bounded pre-branch allocation and may be released under the same proof.

## RC2 — foreign authority is fail-closed

A live foreign controller's branch, registration, checkout, metadata, and receipt are retained.
An unreadable, malformed, PID-observation-ambiguous, or otherwise unproven foreign owner is also
retained. Reconciliation returns a typed bounded diagnostic identifying the opaque owner,
authority class, and retention decision; it does not turn ambiguity into startup-wide speculative
cleanup. Bare `baton/*` branches without a valid matching receipt remain unowned and untouched.
Naming a foreign opaque owner in the expected-active set grants no cleanup authority. A locally
dead branch-only owner is likewise retained if the branch no longer resolves to the receipt's
bound base SHA.

A dead foreign registered checkout is still retained for its deployment's restart adoption; this
phase permits exact cleanup only for locally proven branch-only/pre-branch residue. It does not
authorize general foreign-deployment garbage collection.

## RC3 — acceptance

Deterministic tests cover:

- two concurrent controllers using the same logical task and Run identity with disjoint opaque
  branches, worktrees, capacity owners, and process-generation receipts;
- cross-controller reconciliation while both owners are live, proving no cross-reap;
- response loss after branch creation followed by same-deployment restart reconciliation;
- idempotent replay, malformed/ambiguous and live foreign retention diagnostics; and
- exact stop/reap with zero worker branches, registrations, worktrees, capacity reservations, or
  transient owner receipts.

Phase 92.2 does not add Program IR, arbitrary REPL execution, homelab integration, shared mutable
checkout access, caller-selected physical identifiers, or speculative foreign cleanup.
