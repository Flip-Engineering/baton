# #676 shared instance: contributor review (baseline 70e53a21)

Scope: independent critique of the #676 shared-instance design against the
actual native source at baseline `70e53a21` and the issue acceptance list.
Lead (`instance.bend`, `instance-laws.bend`, routing) and DS
(`process-spawn.c`, host shared-instance modules) have no source pins yet;
both worktrees are at baseline. Nothing here claims integration or
qualification complete. Baseline memory/CPU/startup measurements are owed
by the root reviewer and are not in this document.

## Current resident topology per active session

Each active retained session keeps two resident Baton2 runtimes plus the
model harness process:

- The endpoint/receive process. `receiver_args` in
  `bend2/src/coordinator/control.bend` builds the recipient endpoint as the
  coordinator executable itself (`[executable, db, "receive", ...]`), and
  `bend2/src/coordinator/delivery.bend` spawns it per delivery. The process
  stays resident through the recipient's execution.
- The keeper. `br_retain` in `bend2/src/host/process-spawn.c` re-executes
  the same binary (`--host-process-keeper`) per attempt directory. The
  keeper owns the harness child, its stdin/stdout spool, and the session
  lock descriptor.
- Detached delivery processes from `Host.Control.launch` in
  `bend2/src/host/control.c`, one per committed message with a live
  endpoint.

The shared design must collapse the per-session Baton2 residents to one
fixed owner per canonical database while keeping the harness processes the
harness requires. The owned fixture in `bend2/test/shared-ownership.py`
records the per-session keeper and attempt counts as evidence for the
before/after comparison; it pins singularity invariants, not exact counts.

## Ownership and admission primitives the design must preserve

- One lock file per session (`<db>.lock-<hex>`, `bend2/src/host/session-lock.c`).
  Only non-blocking acquisition is exposed. A lost race reports `queued`
  (`bend2/src/coordinator/receive.bend`) or refuses a direct turn
  (`bend2/src/coordinator/turn.bend`); no blocking wait exists.
- One `executions` row per session (primary key on session) carrying
  mode, attempt directory, phase, and status. `Stop.admit`, `Stop.started`,
  and `Stop.reconcile` in `bend2/src/coordinator/stop.bend` use one
  transaction order.
- One recorded native conversation per session (`sessions.native`),
  cleared only through the recovery path in `receive.bend`.
- Commit before launch. `Store.commit` in
  `bend2/src/coordinator/store.bend` writes the message transaction first;
  `Delivery.after` starts endpoint delivery only after the commit. A
  queued loser never loses its input: the message stays at receipt NULL.

## Findings by acceptance dimension

- Native conversation ownership: present. The `native` column, the
  per-session attempt directory, and the keeper manifest bind one
  conversation to one session. Re-attach to a live keeper is refused with
  busy (`br_control_command` in `process-spawn.c`); dead-keeper attach
  follows the orphan path with the recorded birth check.
- Admitted authority: present. Turn identity admission
  (`id_owner_sql`, `turn_present_sql` in `turn.bend`), `native_requests`
  keyed on `(attempt, native_id)`, and per-message route admission in
  `bend2/src/coordinator/commands.bend` all check the store before acting.
- Concurrent session isolation: present for prompts and conversations.
  Each receive builds its prompt from its own recipient inbox only, and
  each attempt directory is per session. The fixture pins prompt
  separation and distinct native identities for concurrent sessions.
- Pending input, wake, and closure races: the wake chain is complete on
  the reviewed paths. A holder's finish runs `continue_pending` then the
  next attempt (`receive.bend`), and a direct turn runs `wake_pending`
  after release (`turn.bend`). The second receiver for an active session
  starts no new keeper; the fixture pins one attempt directory and one
  executions row in that race. No `policy` park actor or claim/wake
  mechanism exists in `bend2/src` (searched); no agent parking was found.
- Client, coordinator, and keeper loss: per-session keepers already
  survive observer loss through the spool file and orphan attach, with
  `unknown after keeper loss` recorded only when the status file is
  absent. Existing `receive.py` keeper-loss tests cover this. The open
  design question is the shared owner's own failure domain: one owner for
  N sessions must provide the same survival guarantee, or the loss
  evidence must justify a separate fixed custody process. No separate
  process is justified on current evidence.
- Retained output and parent reports: failure and recovery reports are
  committed while the owner still holds the session (`Turn.prepare`,
  `Turn.finish`); the stop report is committed before custody release
  (`Stop.exited`). The fixture pins stop-report delivery to the parent of
  only the stopped session.
- Duplicate resume: no path found. Resume requires the recorded identity;
  a refused identity restarts fresh with the workspace state named in the
  new prompt, and the recovery message preserves the pending input.
- Unowned native tasks: the fixture pins no live keeper after acknowledge
  (`acknowledged` file present, keeper process gone).
- UI event authority: the subscription boundary is owned by the UI backend
  (sqlite postcommit notification plus projection). The shared owner must
  consume the same committed-change cursor, not a separate event bus.
  That contract has no pin yet; it is an open coordination item below.
- CLI and MCP integration: the CLI surface is the stored-command entry in
  `bend2/src/coordinator/main.bend`. The MCP adapter invokes per-command
  coordinator processes. The shared routing must keep that invocation
  shape working against one owner through admission, not one runtime per
  session. No MCP-side change is proposed here.

## Constraints for the shared implementation

1. Keep commit-before-launch ordering and the stopped-session guards in
   any routing change; they are what make queued input and retained stops
   safe.
2. Compose the per-database owner with per-session `try_acquire`, do not
   bypass it. The lock file stays the duplicate-owner rejection point
   until the lead's `instance.bend` contract replaces it explicitly.
3. Keep the keeper manifest, birth check, spool file, and
   release/acknowledge file protocol stable across `process-spawn.c`
   changes; the fixture and the 685 pending-input tests depend on the
   attempt directory layout.
4. Keep fixture stdout clean. The landing gate treats any non-identity
   stdout line as an unjudged run (`bend2/src/git/land.bend`). Evidence
   output belongs on stderr or in retained files.

## Owned fixture

`bend2/test/shared-ownership.py` (new file, this worktree only) reuses the
`receive.py` controlled-harness base and covers: separate keepers and
prompts for concurrent sessions; no new keeper on a duplicate receive;
stop isolation across concurrent sessions; no live keeper after
acknowledge; topology evidence as sessions increase. It overlaps the
`queued` status behavior owned by 685 only to assert keeper singularity;
685 retains pending-input tests.

Remote gate, completed on atari-homelab for exact commit `e7c5ac1b`
(tree clean): Bend 2.0.25 (`d9c0dad1...`), clang 19.1.1, Node v22.23.3.
`check-unittest.sh bend2/test/shared-ownership.py` exited 0 with empty
stdout (no failures, no unjudged lines): 5/5 passed. Full logs are kept
in the remote job directory `baton-shared676-critic-e7c5ac1b`.
Measured baseline topology: two concurrent sessions hold 4 Baton2
processes and 2 keepers; three hold 6 and 3 (two Baton2 runtimes per
active session: endpoint/receive plus keeper). After completion and
acknowledge, keepers and Baton2 processes return to 0. A stop during a
two-session run ended only its own session (`signal 15`) while the
sibling exited 0.

## Source pins reviewed (lead dc46904a, DS e79babdc)

Lead adds `bend2/src/coordinator/instance.bend` (SQL `instance_owner`
claim with heartbeat, `serve` loop forking `Receive.run` per session with
unacknowledged input), `instance-laws.bend`, and
`docs/bend2/shared-instance-676.md`. DS adds `bend2/src/host/instance.bend`
effect surface, reworks `process-spawn.c` around a `BrOwner` custody
process (`--instance-owner`, flock election, token, dev/ino socket,
attempt generations), and adds `bend2/test/instance.bend`. Neither pin is
wired into `main.bend`, `commands.bend`, or any executed gate yet.

Correction to the DS physical-binding proposal (root-assigned, before
implementation). The pin implements the proposed steps at
`br_owner_bind`, `br_owner_socket_path`, `br_instance_connect`, and
`br_instance_token`:

1. Delete the `st_nlink != 1` refusal. Hard-link aliases of the same
   physical database share `(st_dev, st_ino)` and must elect one owner,
   not receive a user-facing refusal.
2. Move election state out of `<database>.owner-lock`,
   `<database>.owner-token`, and per-client `$TMPDIR`. Aliases compute
   different lock/token paths and different clients compute different
   socket paths, so elections split. Elect in one stable per-user IPC
   directory keyed by physical identity, holding the lock file, the
   token file, and the socket: aliases and clients then resolve the same
   owner. Keep the dev/ino socket naming and the re-stat identity check.
3. Read the expected owner token from that IPC directory, not from a
   pathname beside the caller's database path. On `ESTALE`, re-resolve
   and retry the handshake once before failing; retained input makes a
   second failure safe for the next receive.
4. Refuse before effects on admit: `br_instance_admit` creates the
   attempt directory and manifest before `BI_ADMIT`. On admission
   failure, remove the provisional directory and manifest when this
   call created them and no keeper started (no `launch`, `released`,
   `acknowledged`, or `stdout` markers).
5. Bind the database file descriptor to the admitted file: open, fstat,
   and compare `(st_dev, st_ino)` at bind and per admission, so a
   replaced path refuses before effects. The Bend/SQLite open path needs
   the same check where admission depends on it.
6. Reconcile the two elections. The SQL `instance_owner` claim and the
   flock/token/socket election decide independently and use different
   lock files (`owner_path` names `<canonical>.owner`; DS locks
   `<db>.owner-lock`). One election must own liveness. Proposed shape:
   the custody owner holds liveness; the SQL row records the live owner
   for status and crash recovery only.
7. WITHDRAWN by root ruling: heartbeat age (including the 300s lapse)
   is not proof of owner death. Never delete or preempt a live claim on
   elapsed time; a live owner blocked in a job or paused by the OS can
   hold an old heartbeat. OS lock, socket, and native-epoch custody are
   authoritative; the SQL row is provenance only and must not authorize
   dispatch, delete a claim, or park work. The real gap stands: a
   crashed `serve` needs recovery by actual custody-loss proof and the
   admission lock, not a lease timer. Generation must bind to a host
   epoch, owner incarnation, or persistent monotonic counter, never to
   claim-table max-after-deletion (which resets to 1).
8. DS `bend2/test/instance.bend` is now build-wired into
   `check-native.sh` (the `*.py` loop also picks up
   `bend2/test/shared-instance.py`). The proposal still documents
   `BI_ATTACH` while the code handles `BI_ENSURE`; sync them. Open
   lead items at `2049be95`: the 300s claim, one-pass serve, and
   generation reset remain, and no ordinary CLI/MCP owner routing
   exists yet.

Verified good in the pins: owner-side token check with `ESTALE` on
mismatch, admission-time re-stat with prefix check, single-native-child
refusal per attempt, per-attempt error isolation in the owner loop,
session-guard passing with release-time close, and the UI boundary (change
notification stays in the UI backend postcommit path; attempt directory
name is the only shared identifier).

## Owner-death findings at DS tip 5cf90d7a

`br_keeper_start` always spawns a new native child and writes
`native.pid`/`native.birth` exclusive; it never adopts a surviving
child. After a true owner death, a new owner's admit for the same
attempt directory fails closed on the exclusive files, and the
client-side orphan path follows the spool without restoring the old
attempt identity or generation. A test named as an owner restart that
only patches the checkpoint incarnation without killing the owner
process is not an owner restart. The committed-offset resume has no
consumer yet: attach replays from the spool start, and lead has no
CLI/MCP routing into the owner. Duplicate admission fails
client-side at exclusive directory preparation, so the owner-side
same-identity reuse path is unreachable through the current CLI.

## Fixture inventory

- `bend2/test/shared-ownership.py` pins baseline topology (one keeper
  per attempt; gated 5/5 on `e7c5ac1b`). After the shared owner lands,
  custody has no per-attempt keeper process, so this file must be
  updated in the landing composition; it is left strict on baseline
  until then.
- `bend2/test/shared-owner.py` (new, this lane) drives the owner entry
  blackbox with real SIGKILL re-election: native-child and spool
  survival with birth preservation, re-admission with no second
  native, conflicting-manifest refusal, exact payload bytes, and
  full-stream delivery after a torn checkpoint. The readoption test is
  a WIP red control for D1: probed on DS tip `5cf90d7a`, killing the
  owner leaves the native child alive with spool and birth intact and
  elects exactly one new owner on reattach, but `BI_ATTACH` answers
  ENOENT for the orphaned attempt so no observation resumes. The file
  is not gate selectable until D1 is fixed. It does not duplicate
  DS's `bend2/test/shared-instance.py` (custody-level scenarios
  without owner death) or 685's pending-input tests.
- Prepared file input (`control-write` pathname) carries filesystem
  authority only; the fixture keeps payload files inside its temp
  directory. Prompt bytes are asserted byte-exact end to end.
- Not covered here for lack of source: multi-client CLI/MCP routing,
  the `baton2_owner` tool, UI subscriber hints, and the observer
  checkpoint/reattach work owned by root observer joint DS. No claim
  is made about them.

## Open coordination items

- Lead: decide the serve re-invocation route and the CLI/MCP owner
  routing; compose the single election with custody-loss proof instead
  of the withdrawn lease. New fixture path from this lane is
  `bend2/test/shared-owner.py` (owner-death blackbox); the baseline
  `bend2/test/shared-ownership.py` stays until landing composition.
- DS: correction items 1-6 stand; item 7 is withdrawn above. Fix D1
  orphan identity restore, D2 torn/oversize replay classification, and
  D3 duplicate-admit handle reuse; note a restart test must kill the
  owner process. Keep the attempt directory layout stable or propose
  the change precisely.
- 685: the 685 handoff in the DS proposal swaps `retain` for
  `Instance.admit` plus `retire` after acknowledge; confirm the serve
  seam and send the exact signature/SQL if a variant is needed. This
  lane makes no edits in 685-owned files.
- UI backend: the DS UI boundary section already keeps notification in
  the postcommit path with the attempt directory name as the only
  shared identifier; confirm, and state any owner-side readiness signal
  needed as a typed effect.
- Baselines: Luna's live measurement (five turn processes plus one
  receive, six Baton runtimes on one database) stands beside the fixture
  measurement (two Baton2 runtimes per active fixture session); the
  root reviewer's resident/private/physical memory, CPU, and startup
  figures are still owed.
