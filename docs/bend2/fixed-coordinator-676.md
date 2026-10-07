# Fixed coordinator (#676)

## Scope

`bend2/src/coordinator/instance.bend` implements the serve loop that drives
pending input under the elected database owner. One serve process holds one
committed-change subscription per database. Narrow `serve` and `owner-status`
CLI routes, their parse and dispatch laws, the snapshot law, the
`baton2_owner` MCP tool, and `bend2/test/fixed-coordinator.py` belong to the
same scope. Host effects, Turn, Store, receive, wake, control, and the UI
projection belong to their owners; this lane calls those paths and modifies
none of them.

## Loop

Serve subscribes with cursor `0` and generation `0`, prints the owner
readiness line, then snapshots the full pending set. The snapshot lists
recipients with unacknowledged messages on live Codex or OMP sessions that
have a registered receiver endpoint, excluding terminally stopped sessions.
Each pass forks one `Receive.run` task per dirty session with the recorded
harness executable and log resolved from the receiver endpoint array. Tasks
join one at a time; after every joined task the loop re-snapshots and forks
newly dirty sessions before joining the next task. With no dirty sessions the
serve blocks on the owner notice; every notice replays the full snapshot. A
failed notice closes the subscription and exits carrying the swept status: 0
when drained, 1 when a swept task failed.

A task that fails on a session which stopped after the snapshot records a
swept failure; the stop retained its input and the next serve excludes that
stopped session. Duplicate tasks for one session are refused by the session
lock with queued.

## Entries

- `baton2 DATABASE serve` runs the loop until owner shutdown.
- `baton2 DATABASE owner-status` prints one readiness line
  (`generation`, `cursor`, `gap`) and closes its subscription.
- `baton2_owner` MCP tool returns the same readiness object.

## Verification

`bend2/test/fixed-coordinator.py` gates the contract through ordinary CLI
verbs: concurrent Codex and OMP sessions with midtask guidance, stopped
session exclusion with input preserved, killed-serve adoption with one
resumed native and one report, owner loss with surviving native and preserved
receipted input, killed-client atomic commit with full service, and
owner-status with MCP parity.

## Measured boundaries

- Keepers run inside the owner process on the owner admission path. No
  `--host-process-keeper` process exists for owner-admitted turns, so the
  serve-death drill asserts native survival rather than keeper survival.
- `Receive.run` with empty cmd and log does not resolve the recorded
  receiver endpoint; the serve passes the resolved values explicitly.
- A serve joined on tasks whose keeper died with the owner returns when
  those joins return. Turn read failure on a dead keeper handle belongs to
  the Turn and host owners; a supervisor restarts the generation.
- Idle wakeups depend on Store publication of the committed high-water
  (#685). Until publication lands, an idle serve wakes on subscriber
  notices from publishing writers only.
- Full orphan re-adoption after owner death waits on owner recovery.
