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
7. Fix the lead claim lapse. `claim_sql` refuses whenever any other row
   exists; nothing deletes a dead owner's row, so a crashed `serve`
   blocks the database with no owner and no recovery. Delete lapsed
   heartbeat rows as part of the claim transaction and update the
   pinning law `owner_claim_inserts_or_refreshes_then_names_the_holder`
   and the design doc sentence that promises lapse behavior.
8. Wire the DS Bend test and sync the proposal. `bend2/test/instance.bend`
   is built and run by nothing (`check-native.sh` builds only the
   `process`, `git`, and `land` entries); its owner-level guarantees
   have no gate signal until wired. The proposal documents `BI_ATTACH`;
   the code handles `BI_ENSURE`. Open lead item: `serve_loop` drains and
   exits, and nothing re-invokes serve on later input until the
   committed-change-cursor wake or the CLI/MCP routing lands.

Verified good in the pins: owner-side token check with `ESTALE` on
mismatch, admission-time re-stat with prefix check, single-native-child
refusal per attempt, per-attempt error isolation in the owner loop,
session-guard passing with release-time close, and the UI boundary (change
notification stays in the UI backend postcommit path; attempt directory
name is the only shared identifier).

Fixture note: `bend2/test/shared-ownership.py` pins baseline topology
(one keeper per attempt). After the shared owner lands, custody has no
per-attempt keeper process, so this file must be updated in the landing
composition; it is left strict on baseline until then. DS's new
`bend2/test/shared-instance.py` (proposed, not yet written) and
`bend2/test/instance.bend` do not collide with it.

## Open coordination items

- Lead: apply the claim-lapse fix with its law update; decide the serve
  re-invocation route; compose the single election from the correction
  above. This lane's fixture path is `bend2/test/shared-ownership.py`;
  DS's `bend2/test/shared-instance.py` and `bend2/test/instance.bend`
  do not collide with it.
- DS: apply correction items 1-5 before implementation; sync the
  proposal's `BI_ATTACH` with the code's `BI_ENSURE`; wire
  `bend2/test/instance.bend` into an executed gate. Keep the attempt
  directory layout stable or propose the change precisely.
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
