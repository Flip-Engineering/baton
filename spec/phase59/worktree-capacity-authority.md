# Phase 59 — worktree capacity authority

Sparse materialization reduced recursive checkout size, but it is neither a quota nor a security
boundary. Phase 59 adds a deployment-owned pre-effect reservation around every worker and verifier
checkout so concurrent Baton work cannot knowingly consume the same free-space allowance.

## WC1 — closed deployment policy

`createDriver({worktreeCapacity})` accepts exactly six non-negative safe-integer fields:
`maxReservedBytes`, `maxReservedInodes`, `minFreeBytes`, `minFreeInodes`,
`runtimeReserveBytes`, and `runtimeReserveInodes`. Maximum reservations are positive and runtime
reserves fit within them. Optional observation and estimation dependencies are functions outside
the serialized policy. Malformed policy or dependencies refuse before log, writer, Git, runtime,
provider, or capacity-state effects.

## WC2 — commit- and environment-bound estimate

The default estimator reads the exact pinned Git tree and counts only paths covered by the
normalized sparse identity (or the full tree), plus unique parent directories. It then adds the
immutable toolchain projection's attested bytes/files/total directories and the deployment runtime
reserves. Total projection directories include unique strict target parents; target parents already
materialized by the selected sparse tree are unioned rather than double-counted. The reservation
binds base SHA, sparse digest, toolchain projection digest, bytes, and
inodes. Observation or estimation failure refuses as `worktree_capacity_unavailable`; a valid
max-plus-one or free-floor refusal is `worktree_capacity_exceeded`.

## WC3 — atomic fleet reservation

One repo-scoped, mode-0600 generation lock inside a mode-0700 authority directory serializes a
versioned, mode-0600 HMAC-sealed reservation ledger. The repo-scoped mode-0600 integrity key is
created with exclusive publication and is stable across deployment log-directory changes. Admission
checks aggregate existing reservations and the latest free byte/inode observation in the same
critical section that appends the new reservation. Duplicate IDs refuse. A worker reservation is
durable before `git worktree add`; verifier reservations are durable before detached checkout.
Capacity admission grants no path, process, provider, verification, or integration authority.

## WC4 — exact release and recovery

Creation failure releases its reservation after rollback. Successful worker reservations live
until exact reap; verifier reservations live until exact detached-worktree removal. Reap failure
retains the reservation. Reconciliation releases this driver's inactive reservations and dead
process owners while retaining live foreign ownership. Resume requires the durable session
reservation to match the repo ledger. Legacy `close` and `closeAsync` refuse while this driver
owns reservations. `drainAndClose` checks the sealed ledger before releasing the coordination
writer, refuses completion if any reservation owned by that driver remains, and records the
zero-owned result plus ledger-state digest in its receipt.

## WC5 — honest boundary

The estimate is a preflight and concurrency budget, not a hard filesystem quota: a shell-capable
worker can still create new bytes after admission, Git objects remain accessible, and unrelated
host writes can consume free space. The HMAC detects accidental or key-withheld ledger corruption;
it is not a hostile-worker boundary against arbitrary same-UID filesystem access to the repo-local
key. OS sandboxing or a separate-UID authority remains necessary for that boundary. A deployment
filesystem quota or isolated volume remains the hard-ceiling follow-up. ENOSPC at any later
Git/metadata/projection/capture/reap stage must still take the ordinary typed rollback and
exact-cleanup path without being mislabeled as quota proof.

## WC6 — recursive acceptance

Tests cover policy bounds, exact/max-plus-one estimates, concurrent reservations, observation and
estimation failure, worker/verifier create rollback, capture lifecycle, resume/reconcile, and
drain release. Baton-on-Baton then reruns exact Codex `gpt-5.6-sol`/low, Claude Opus/low,
project-key GLM `glm-4.7`/low, Grok 4.5/low, and Grok Build/low with sparse identities, capacity
reservations, truthful provider governance, concurrent Grok observation, and exact drain/reap.
