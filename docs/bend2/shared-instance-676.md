# Shared native instance (#676)

## Measured current structure

The installed `fca7af87` implementation handles an active session with a
delivery process per committed message (`Host.Control.launch` of
`baton2 --dispatch-message`, `bend2/src/coordinator/control.bend`), a
receive observer process per session (`Receive.run`,
`bend2/src/coordinator/receive.bend`), and one retained keeper process per
active attempt (`ProcessChild.retain`, `bend2/src/host/process-spawn.c`).
The keeper owns the provider harness child. The 2026-10-05 host reboot
makes earlier live process counts historical (#676). The retained keeper
loss measurements in `docs/bend2/owner-process-loss-2026-10-03.md` show the
original completion missing from coordinator storage after keeper loss
(#656), with later pending input completing under a new attempt.

## Design

One persistent owner process holds each canonical Orchestra database.
That process is the host custody effect (`Instance.owner`), which owns
provider children, lock evidence and the wake transport across
invocations. The coordinator `serve` invocation is the per-wake driver:
it claims the SQL row, runs owned session tasks, then releases the row
and exits. Serve never spins waiting for work and never parks; later
input re-invokes it through the owner-hosted commit notification once
that transport lands.

One `serve` invocation holds each canonical Orchestra database:

- `Instance.claim_sql` (`bend2/src/coordinator/instance.bend`) records the
  holder in the `instance_owner` row. The claim transaction first deletes
  rows whose heartbeat lapsed past `Instance.claim_lapse_seconds` (300).
  A second holder for the same database receives the `duplicate-owner`
  error naming the current holder; a refused claimant inserts nothing. A
  re-claim by the recorded holder refreshes its heartbeat and keeps its
  generation number. The insert reads the generation counter before the
  clear deletes lapsed rows, so each new holder epoch carries the next
  generation number across owner crashes. Each `serve` invocation passes
  an owner name unique to that invocation. Two simultaneous first claims
  refuse together; the custody election owns liveness past that point.
- Liveness is held by the host custody election in the stable per-user IPC
  directory keyed by the database physical identity. The SQL row records
  the live holder for status and crash recovery. The lapse bound
  garbage-collects stale rows; fencing carries safety. Every serve
  iteration verifies its own row; a holder that lost its row joins its
  forked tasks and reports the loss, and the per-session locks refuse a
  second claimant's tasks with `queued`.
- `Instance.serve_loop` writes its heartbeat, then reads
  `Instance.next_session_sql` cursors and forks one
  `Instance.serve_session` task per session that holds unacknowledged
  input. Tasks join with `Instance.combine`, which carries the first
  failure. Sessions with a terminal stop never enter the cursor. `serve`
  drains and exits; the owner-hosted commit notification re-invokes it on
  later input. A long-lived serve follows only when workload measurements
  require it.
- `Instance.serve_session` calls the public receive entry
  (`Receive.run`) with empty command, model, effort, workspace and message
  arguments, which selects the session's recorded values and full pending
  inbox. Prepared admission (`Stop.admit`), native conversation identity
  (`sessions.native` with the `executions` directory and recovery argv),
  pending-input recovery, stop handling and parent notification execute in
  that path unchanged.
- Provider processes run where the harness requires them. Host custody of
  provider children inside the owner process is implemented in
  `process-spawn.c` under its assigned owner (DS lane). No election state
  lives beside the database path; the election lock, token file and socket
  live in the stable per-user IPC directory keyed by physical identity.
- The shared owner hosts the canonical committed-change notification
  source for its database. The UI backend projection consumes that source;
  its `native_changes` rows carry `change_id`, `recorded_at`, `entity`,
  `entity_id`, `session_id`, `operation`, `kind` and `summary`, appended
  by SQLite triggers in the writer transaction and retained by
  `change_id`. The owner defines no separate event bus. Subscriber
  contract: a subscriber presents the owner generation from
  `owner-status` with its cursor; the owner admits the cursor when the
  generation is current and answers with a snapshot plus the high cursor
  when it is not. Socket frames for that handshake are implemented in
  `process-spawn.c` under its assigned owner.
- Ordinary CLI and MCP use keep their current admission and discovery. The
  owner adds the `serve` and `owner-status` verbs (`Instance.route`) and
  the `baton2_owner` MCP tool. Shared-file wiring for those verbs is listed
  below for root or lead composition.

## Failure boundary

- Client loss: `serve` and delivery hold no client file descriptors. A lost
  CLI or MCP caller leaves committed input and the owner claim in place;
  the owner task continues to completion and the completion report routes to
  the recorded parent.
- Owner loss: provider children and spooled output survive the owner. A new
  `serve` invocation claims the row, attaches each attempt directory
  (`ProcessChild.attach_owned` with the recorded recovery argv), reconciles
  the inbox cursor, and resumes under the recorded native identity. A
  recorded identity resumes the conversation; a refused identity restarts
  fresh with the workspace state note through the existing receive path.
  Two `serve` invocations for one database cannot both hold the claim, so
  the same native conversation never resumes twice.
- Join window: the owner writes its heartbeat on every discovery iteration
  but not while blocked joining forked session tasks. A second claimant
  during that window reads a lapsed row and forks tasks that the
  per-session locks refuse with `queued`, so no session executes twice.
  The flock-gated admission at composition closes the window; the SQL row
  stays a status and recovery record.
- Custody: provider children stay under the assigned host custody effect.
  When loss evidence requires a process outside the owner, that process
  count is fixed per Orchestra and recorded here before implementation.

## Measurement plan

The independent baseline from `shared_owner_review_luna` is pending. After
it lands, qualification records resident, private and physical memory, CPU
and startup before and after equivalent idle and active workloads with
concurrent Codex, OMP and Muse sessions, mid-task guidance, stop, and
client, coordinator and keeper loss. Virtual address reservations are
reported on their own lines, apart from resident and private figures.

Scoped short-lived invocation figures on atari-homelab (Bend 2.0.25,
clang-19, three reps, `/usr/bin/time` peak resident set): `pending`
0.00 s at about 5.9 MB; `owner-status` 0.00 s at about 5.3 MB;
`subscribe` 0.00 s at about 5.4 MB; `serve` over empty work 0.07 to
0.10 s at about 5.4 MB. The routing binary is 91 KB larger on disk than
the base (`text` plus 48 KB). No long-lived owner process exists before
the wake transport lands, so persistent resident figures follow at
composition with the concurrent workload.

## Contracts and shared hunks

- `native685-muse-conductor-20261006` (owns `receive.bend`, `wake.bend`,
  `control.bend`, `store.bend`, pending-input tests): owner and
  attempt-fenced admission contract. This lane guarantees the serve
  driver holds the `instance_owner` row (owner, generation, heartbeat)
  for every task it forks, verifies the row each iteration, and stops
  when deposed. The wake claim path needs the same fencing from its
  writer: record the holder identity (owner, generation, attempt
  directory) beside each session claim; release, clear and `claim_left`
  act only when the caller presents the recorded identity; the launch
  handoff carries that identity so a second driver cannot launch between
  claim and handoff. This lane makes no edits in those files.
- Ordinary routing is implemented in this lane: `serve`, `owner-status`
  and `subscribe` commands in `commands.bend`, entry arms in `main.bend`,
  and `baton2_owner` plus `baton2_subscribe` tools in
  `mcp-conductor.mjs`. The `subscribe` answer carries holder, highest
  committed change and readiness only; no row bodies cross it.
- Root Luna `native_observation_repair_luna` (owns `turn.bend`): the serve
  path uses `Turn` only through `Receive.run`. A serve-mode custody variant
  of the retained attempt needs its signature from that owner.
- Schema Muse (owns `codec-schema.bend`) and UI backend
  (owns projection schema additions): the `instance_owner` table in
  `Instance.owner_schema` enters the schema through the schema owner's
  composition. This lane does not edit `commands.schema()`.
- DS lane (owns `process-spawn.c` custody): hold liveness in the flock
  election in the stable per-user IPC directory keyed by physical
  identity, with per-session generation handles and in-process
  provider-child custody under the existing release and acknowledge
  semantics. This lane makes no edits in `process-spawn.c`.
- Gates 675 lead (owns heavy validation boundaries): proposed
  retained-request identity for deduped execution is the tuple of the
  database physical identity, the request content hash, and the claimant.
  A repeated identity re-attaches the retained execution and its
  completion; a conflicting reuse fails admission. Field names follow at
  composition. The actual retained result reference is the DS-owned
  `Instance.job(database, directory)` path at pin `5cf90d7a` on
  `codex/shared676-deepseek-impl-20261006`, which reports attempt,
  generation, spool bytes, checkpoint offset, status and observation
  ownership for any number of readers; a duplicate admission takes that
  reference, not a second child. Request-level attach ENOENT routes to
  orphan adoption at pin `cf3881f0` on the same branch, green on the
  reviewer fixture.
- CLI wiring is implemented: `Serve`, `OwnerStatus` and `Subscribe`
  commands with `sql` arms returning no statement, `parse` arms for
  `serve OWNER`, `owner-status` and `subscribe`, entry arms in `main.bend`
  and usage lines. `commands.schema()` is unchanged; the owner table is
  created inside the guarded claim transactions.
- MCP wiring is implemented: `baton2_owner` and `baton2_subscribe` tools
  in `mcp-conductor.mjs` calling `coord('owner-status')` and
  `coord('subscribe')` through the existing helper.

## Scope of this change

This change adds `bend2/src/coordinator/instance.bend`,
`bend2/src/coordinator/instance-laws.bend`, one import line in
`bend2/src/coordinator/laws.bend`, and this document. Remote gates cover
the full entry build with every operative law. Scoped controls on the
routing commit show 28 of 28 proof removals refused and 5 of 5 targeted
implementation mutations refused (lapse deletion, duplicate admission,
refusal prefix, serve verb, stop guard). These five mutations are
proposed for `bend2/scripts/laws-check.mjs` composition under the same
names with the `instance.bend` file and the laws named here. The
`instance-serve` CLI tests cover the serve heartbeat, the deposed stop
and the subscribe cursor on scratched databases. Custody
implementation, the owner-hosted wake transport and workload
measurements follow through the contracts above. This branch stays on
its base; root composes the merge onto the current primary.
