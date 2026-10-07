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
685 retains pending-input tests. Remote gate status is recorded in the
turn report; the file passes the exact-source gate before any merge
claim.

## Open coordination items

- Lead: confirm this fixture path and the attempt-directory protocol
  stability assumption; publish the `instance.bend` admission contract
  when ready.
- DS: keep `process-spawn.c` keeper-protocol changes compatible with the
  pinned attempt layout, or propose the layout change precisely for
  root/lead composition.
- UI backend: one native subscription boundary on the committed-change
  cursor; no second event bus.
- Root reviewer: baseline resident/private/physical memory, CPU, and
  startup measurements before equivalent workloads, with virtual
  reservation distinguished.
