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
| `checkout` | Checkout | A Git worktree or working checkout. |
| `shared-immutable` | Shared immutable | Reusable assets and caches. |
| `git-object` | Git objects | A loose-object prefix store. |
| `log-evidence` | Log evidence | Coordination logs, reports and continuation evidence. |

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
repository for a `git-object` root. Empty configuration performs no scan and
no deletion. The process reads the configured roots; it does not adopt a
homelab path or relocate existing files.

storage-policy reports each configured root and whether it appears in
BATON_STORAGE_EXCLUSIVE_ROOTS. That setting records an operator declaration.
The current implementation has no cooperative root-writer lease, so
storage-apply SESSION exits with status 3 whenever at least one root is
configured. An empty root list returns an empty receipt. Preview and policy
commands remain available.

## Preservation evidence

Each candidate carries the measured byte count, the host identity
`kind:device:inode`, and these facts:

- active coordinator database path or an ancestor of one;
- owner match against the recorded session or execution;
- live lease;
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
```

Preview and apply select candidates whose recorded owner is exactly `SESSION`;
a candidate owned by another session or with missing owner evidence is outside
that session's plan. Apply acquires the session lock, then the `storage-cleanup`
lock, and re-reads the durable evidence under both.

The preview records the approved root identity. Apply observes the root again
and refuses every entry when the identity changed or the scan was invalid.
The host removal opens the approved root, verifies its `dev` and `ino`, resolves
the candidate relative to that descriptor, and opens every intermediate
directory with `O_NOFOLLOW`. It revalidates `kind:device:inode` before unlinking.
A path reached through a symlinked parent is refused. A symlink entry is
unlinked; its target is never followed.

Apply reruns the preservation decision from current durable evidence for every
admitted entry. A path that now has a live owner, lease, process, runtime input,
dirty state, unpublished commit, ref or pending attempt becomes `changed` and
is not removed. A missing path becomes `already-absent`, so replaying a plan is
idempotent. An interrupted tree removal reports `refused` with its partial byte
count and the plan can be replayed.

A receipt names the exact candidate path, measured bytes, class, owner proof,
decision reason and outcome. The `reclaimedBytes` field counts host-reported
removed bytes, not the preview estimate.

BATON_STORAGE_EXCLUSIVE_ROOTS lists operator-declared roots, one path per
line. storage-policy reports that declaration. The storage-cleanup lock
serializes cleanup runs. It does not coordinate with processes that write the
root. Apply remains disabled until writers and cleanup acquire the same
per-root lease and tests show that a concurrent writer preserves its files.

The root identity, descriptor-relative traversal and identity revalidation
cover path replacement during an individual removal. Those checks do not
establish writer ownership for an entire scan-and-apply operation.

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
runtime-input, ref and pending-attempt preservation; descendant cwd and
descriptor references under a directory candidate; an unlinked descriptor owner
outside the cleanup process tree; non-Linux unknown evidence; symlink removal
with an intact target; child and root replacement; unreadable paths; malformed
host records; malformed database rows and endpoints; overlapping roots;
exclusive-root authorization; lock contention; idempotent replay; and
interrupted tree removal.

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
