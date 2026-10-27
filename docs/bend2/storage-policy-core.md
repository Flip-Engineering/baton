# Storage classes and safe cleanup

This document describes the storage-class and safe-cleanup core added under
`bend2/src/storage`. It covers issue
[#912](https://github.com/Flip-Engineering/baton/issues/912) and the current
operator scope in
[`current-work-scope-2026-10-19.md`](current-work-scope-2026-10-19.md).

The core classifies configured storage roots, derives preservation decisions
from current owner and source evidence, and applies a preview under an approved
root. Platform layout tables, service units and deployment changes belong to
the deployment work in #912. Log retention through the existing task and
receipt lifecycle remains the separate `logs-clean` command.

## Storage classes

A storage root declares one class:

| Marker | Class | Meaning |
| --- | --- | --- |
| `scratch` | Scratch | Per-attempt temporary files. |
| `build-output` | Build output | Build products and checkouts derived from source. |
| `export` | Export | Completed export trees and generated deliverables. |
| `checkout` | Checkout | A Git worktree or working checkout. |
| `shared-immutable` | Shared immutable | Reusable assets and caches. |
| `git-object` | Git objects | A loose-object prefix store. |
| `log-evidence` | Log evidence | Coordination logs, reports and continuation evidence. |
| `staging-source` | Ownership-ending staging source | Generated installer and staging clones whose owning lifecycle ended. |

An unrecognised marker becomes `unclassified`, and an unclassified candidate
stays in the preview.

## Configured roots

`BATON_STORAGE_ROOTS` holds one root per line:

```text
scratch=/mnt/large/scratch
build-output=/mnt/large/build
checkout=/mnt/large/worktrees
shared-immutable=/mnt/large/assets
git-object=/repo/.git/objects|/repo
log-evidence=/mnt/large/baton-logs
```

The marker before `=` selects the class. The optional `|source` names a Git
repository for a `git-object` root, and the authenticated repository for a
`staging-source` root. Empty configuration performs no scan and no deletion.
The process reads the configured roots; it does not adopt a homelab path or
relocate existing files.

storage-policy reports each configured root, its class and whether it appears
in BATON_STORAGE_EXCLUSIVE_ROOTS. That setting records an operator declaration;
it does not prove that writers coordinate with cleanup. A `log-evidence` root
is covered when the coordinator database records a registered log, a retained
generation (`log` or `base`), or an execution directory under it. A transient
`scratch`, `build-output`, `export` or `checkout` root is covered when a
session workspace or execution directory is recorded under it. An absolute root
with no such reference is arbitrary and is refused. A `staging-source` root
is admitted when the operator records the authenticated repository as its
source; its candidates carry no session record. A staging candidate is removed
only when it is a clean worktree whose origin is the authenticated repository
and every local ref object in every namespace is advertised by that remote
(`git ls-remote origin`), `git fsck --no-reflogs --unreachable` reports no objects
outside those refs, no process, runtime input, lease, live reference, database
path or pending attempt names it, and every other preservation fact is absent.
The object check includes commits retained only by reflogs and otherwise
unreachable objects. The candidate must also be owned by the cleaner's
effective uid: the process, lease and mount evidence scan covers that uid
only, so a candidate owned by another uid is preserved. A dirty worktree, an
untracked or ignored local file, a commit the authenticated repository does
not contain, an unreachable object, a cross-uid candidate, or any unknown fact
preserves it. The session/owner filter does not drop a staging candidate when
a session is supplied because its ownership ended by premise. The policy reports
`covered` per root, `apply:"lease-gated"` when every configured root is covered,
`apply:"refused"` when any root is not covered, and `apply:"ready"` when the
root list is empty. storage-apply SESSION acquires the per-root writer lease
described below. An empty root list returns an empty receipt. Preview and
policy commands remain available.

## Preservation evidence

Each candidate carries the measured byte count, the host identity
`kind:device:inode`, and these facts:

- active coordinator database path or an ancestor of one;
- owner match against the recorded session or execution;
- live lease;
- settled owner execution (transient classes only);
- live process reference;
- runtime input (open descriptor or mapped file);
- dirty worktree;
- unpublished commits;
- live Git ref;
- pending attempt input.

Apply evaluates the facts in that order. The first present or unknown fact
preserves the candidate. No input carries an age or timestamp. A path named
with an old date and no preservation evidence remains a removal candidate; a
path named today with a live owner does not.

The active database paths are the database passed on the command line and the
database recorded as element two of each session endpoint. A candidate that
equals one of those paths or is an ancestor of one is preserved, so the
directory holding a coordinator database survives cleanup even when the
database directory entry is unlinked. A non-empty endpoint without a text
database path makes the database evidence unknown and preserves every
candidate.

The durable state comes from the coordinator database: session workspaces,
execution directories, pending messages and registered log paths. Git supplies
dirty state and commit counts. The host supplies process references, path
identity and recursive byte counts. String fields use SQLite `hex()` with an
explicit empty-field sentinel, so tabs and newlines in a value cannot shift the
projection. A malformed row or a failed process scan makes the evidence
unknown, and unknown evidence preserves the candidate.

## Process references

`StorageHost.process_refs` and `StorageHost.runtime_refs` inspect cwd, executable,
descriptors and mapped files for every process of the current user. For a
directory candidate the scan compares each referenced path with the candidate
directory, so a process working inside a child directory or holding a file
there is found even though its inode differs from the parent. A descriptor
whose directory entry is unlinked still matches after the `" (deleted)"`
suffix is removed. The scan reports `unknown:` on an access error, a non-Linux
host or a truncated scan, and the policy preserves the candidate.

The scan covers active owner and keeper processes outside the cleanup process
tree. Processes of other users cannot be inspected on a host with restricted
`/proc` access; that answer is unknown and preserves the candidate.

## Preview and apply

```text
storage-policy                  # JSON: roots, classes, exclusivity, apply readiness
storage-preview SESSION         # JSON: roots and entries owned by SESSION
storage-apply SESSION           # JSON: receipts for SESSION's admitted entries
storage-collect SESSION         # JSON: receipts for a settled SESSION
```

Preview selects candidates whose recorded owner is exactly `SESSION`;
a candidate owned by another session or with missing owner evidence is outside
that session's plan.

storage-apply SESSION acquires the cleanup session lock, then one exclusive
lease per configured root, holds them across the scan and removal, and releases
them after. If any root lease is unavailable it releases the leases it already
holds and exits with status 3 naming that root. Overlapping configured roots
are refused before any lease is acquired. Discovery skips the lease file name,
so cleanup never proposes the lease file as a candidate.

`storage-collect SESSION` runs the apply plan for a session with no non-exited
execution and no pending input. Only scratch, build-output, export and
log-evidence roots participate. A checkout root is excluded because the
session row still records its workspace; removing the current workspace needs
an explicit `storage-preview` and `storage-apply` by an operator. The receive
and direct-turn completion paths and the landing wrapper call the settled
collector after custody retirement and after a successful landing; the
receiver endpoint replacement calls it after recording the new endpoint. A
triggered run that cannot acquire a lease or a covered root contributes no
receipt and does not change the event that asked for collection.

The explicit `storage-collect` command reports a typed `skipped` value naming
the unsettled execution or pending input, and a typed `refused` value naming
the lease or root failure with its exit code. An unknown session exits 2.

The same evidence preserves a selected runtime and its rollback copy. A tree
that no recorded session workspace or execution names has no owner, and an
unknown owner preserves the candidate. A running selected runtime is also a
process and runtime reference. Only a tree owned by a settled session with no
dirty worktree, no unpublished commits and no live evidence is admitted.

## Writer lease protocol

Each configured root contains one lease file, `.baton-writer-lease`. The
covered managed writer paths are the retained-output receive entry, the
recovery observer, the direct initial turn, and the direct handoff and retry
relaunches. Each holds one shared lease on every covered root containing its
output log or attempt directory. The lease is acquired before
`retained_prepare` writes the DSH patch files, before the native process is
spawned or an existing native is attached, and it is held through the final
checkpoint, ACK and observer release. Quiet gaps between frames remain inside
the same lease span. A path under no covered root contributes no lease.

A Baton-owned writer opens the lease file and takes `flock(LOCK_SH | LOCK_NB)`
for the duration of its writes. Cleanup opens the same file and takes
`flock(LOCK_EX | LOCK_NB)` for every configured root before it removes
anything. The protocol is cooperative: a process that writes the root without
opening the lease file is not blocked, and the process-reference,
runtime-input and other preservation facts still protect its files. An external
holder such as `flock -s ROOT/.baton-writer-lease -c 'sleep 30'` uses the same
file and blocks cleanup.

Any open, create or flock failure answers no handle, and cleanup refuses the
apply. Contention is never treated as permission. Closing the last descriptor
releases the lock, so the operating system releases it after a crash; the
protocol stores no timestamp, owner record or age. A configured root name and
an entry in BATON_STORAGE_EXCLUSIVE_ROOTS are operator declarations, not lease
proof. A registered retained log recorded in `log_generations` for a
non-exited execution also preserves that log and its `base` path, including
ancestor directories, when the lease is not observed. A `log_files` row whose
session has a non-exited execution is the second reference source, so a
database without the `log_generations` table still preserves its registered
active logs.

The internal removal primitive checks the approved root identity, opens the
root and candidate by descriptor, and opens intermediate directories with
`O_NOFOLLOW`. It revalidates `kind:device:inode` before unlinking.

BATON_STORAGE_EXCLUSIVE_ROOTS lists operator-declared roots, one path per
line. storage-policy reports that declaration. The storage-cleanup session
lock serializes cleanup runs; the per-root leases coordinate cleanup with
writers that use the lease file.

The root identity, descriptor-relative traversal and identity revalidation
cover path replacement during an individual removal. The held per-root leases
cover writer coordination for the whole scan-and-apply operation for writers
that use the lease file.

## Preserve-only classes

`git-object` candidates are preview-only. Raw recursive deletion of a loose
object store ignores shared alternates, reflogs and maintenance ownership. A
Git maintenance owner API must supply the reference proof before deletion is
added. `shared-immutable` candidates also stay preview-only until a configured
complete reference source exists.

## Tests

The focused native test builds its own database and fixture tree:

```sh
sh bend2/scripts/build-native.sh bend2/tests/storage.bend .scratch/bend2/storage-test
.scratch/bend2/storage-test
```

It covers owner, database-path, lease, process, dirty, unpublished,
runtime-input, ref, retained-generation and pending-attempt preservation; descendant cwd and
descriptor references under a directory candidate; an unlinked descriptor owner
outside the cleanup process tree; non-Linux unknown evidence; symlink removal
with an intact target; child and root replacement; unreadable paths; malformed
host records; malformed database rows and endpoints; overlapping roots refused
before lease acquisition; a lease-gated policy; an external shared writer that
refuses apply and preserves its file, followed by a successful apply after the
writer exits; shared and exclusive lease contention in process; an active
execution's registered retained log and distinct base path preserved under the
cleaner exclusion, including the `log_files` fallback when `log_generations` is
absent; lock
contention; idempotent replay; and interrupted tree removal. The Python
integration test drives the real receive and direct entrypoints: a paused
writer holds the lease across the quiet gap, apply refuses and retains bytes,
the terminal frame releases it, and a cleaner-first holder prevents the
writer from spawning.

The focused native overlay exposes the same commands through
`receive-focused.bend`:

```sh
BATON2_RECEIVE_FOCUSED=1 sh bend2/scripts/build-native.sh \
  bend2/src/coordinator/receive-focused.bend .scratch/bend2/focused-storage
BATON_STORAGE_ROOTS='scratch=/absolute/root' \
BATON_STORAGE_EXCLUSIVE_ROOTS='/absolute/root' \
  .scratch/bend2/focused-storage DATABASE storage-policy
BATON_STORAGE_ROOTS='scratch=/absolute/root' \
  .scratch/bend2/focused-storage DATABASE storage-preview SESSION
BATON_STORAGE_ROOTS='scratch=/absolute/root' \
BATON_STORAGE_EXCLUSIVE_ROOTS='/absolute/root' \
  .scratch/bend2/focused-storage DATABASE storage-apply SESSION
```
