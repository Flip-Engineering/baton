# Fixed coordinator (#676)

## Scope

`bend2/src/coordinator/instance.bend` implements the fixed coordinator serve
loop that drives pending input under the elected database owner. One serve
process holds the physical coordinator role and one committed-change
subscription per database. Narrow `serve` and `owner-status` CLI routes,
their parse and dispatch laws, the snapshot and refusal laws in
`bend2/src/coordinator/instance-laws.bend`, the `baton2_owner` MCP tool, and
`bend2/test/fixed-coordinator.py` belong to the same scope. Host effects,
Turn, Store, receive, wake, control, and the UI projection belong to their
owners; this lane calls those paths and modifies none of them. The
`Sql.binding` / `Sql.role_guard` declarations used for the coordinator role
were composed by exact hunk from the native-context lineage `aa4ee4e6`
through `dc1f0aa7`; the C implementation lives with the host owner.

## Loop

Serve acquires the coordinator role through `DB.Sql.role_guard` with the
constant role key before subscribing. A second serve on the same database or
one of its hard-link aliases fails role acquisition and exits 2 with
`coordinator-held`. Owner-status and UI subscriptions take no role.

After subscribing, serve prints the owner readiness line, snapshots the full
pending set, and enters the drive loop. The loop blocks only on one shared
`Chan(Event)` carrying `TaskDone{session, ok}`, `Committed{}`, `Gap{}` and
`Closed{}`. Every native task carries a relay that joins only its own task
and sends one `TaskDone`; one independent owner-notice waiter sends one
notice event and the loop rearms it on consumption. Every event replays the
full pending snapshot.

The snapshot lists recipients with unacknowledged messages on live sessions
of a supported harness, excluding terminally stopped sessions. Each row
carries a route tag: Codex and OMP sessions with a recorded receiver
endpoint fork a `Receive.run` task through the session lock; every other
row is refused aloud with its route (`dispatch-turn` for Muse/Claude-Code,
receiver registration otherwise). Refusal checks the session lock first, so
a session with an active native stays quiet. An unparsable row refuses.

The loop tracks explicit in-flight session IDs. The snapshot strip removes
in-flight sessions from the fork set, so a Committed drive while a session
is held forks nothing further for it. `TaskDone` drops the completed
session from the in-flight set so later dispatches for it fork anew. The
refused set suppresses repeat refusals and clears on commit or gap.

## Entries

- `baton2 DATABASE serve` runs the loop until owner shutdown.
- `baton2 DATABASE owner-status` prints one readiness line
  (`generation`, `cursor`, `gap`) and closes its subscription.
- `baton2_owner` MCP tool returns the same readiness object.

## Verification

`bend2/test/fixed-coordinator.py` gates the contract through ordinary CLI
verbs (10 legs): concurrent Codex and OMP sessions with midtask guidance,
stopped session exclusion with input preserved, killed-serve adoption with
one retained attempt and one report, owner loss with surviving native and
preserved receipted input, killed-client atomic commit with full service,
owner-status with MCP parity, late commit served while the first task is
held, second serve on a hard-link alias refused short with one resident
serve and one owner, Muse session refused with its Turn route and input
preserved, and post-completion redispatch served for the same session.

Remote gate on the pushed tip (Bend 2.0.25, clang-19, Node 22.23.3,
SQLite 3.46.1): check clean, build exit 0, fixed-coordinator 10/10.

`bend --check-only` evaluates the `instance-laws.bend` laws, including the
in-flight strip and drop laws.

Mutation controls by actual function change on a check-tree copy: removing
the `TaskDone` in-flight drop leaves the suite green. The owner/Receive
drain consumes the rows first in every suite flow, so the drop is shadowed
at system level. Breaking `without_id` fails the check at
`without_id_drops_the_completed_session`, which is its discriminating
control.

## Measured boundaries

- Natives run as children of the owner process. The serve forks
  `Receive.run` tasks; the owner spawns the native processes. Greeting
  parent PIDs in the fixture all name the owner PID.
- A held turn released with queued guidance completes the guidance inside
  the same `Receive.run` call: the guidance report frame precedes the
  `TaskDone` for the first task. Post-quiescence dispatches (attempt phase
  `exited`, no natives) need a fresh initiator.
- Native report rows briefly match the dirty snapshot for recipient `root`
  while unreceipted and are refused each drive until receipted.
- An in-flight refusal reuses the no-receiver text even when the session
  has a receiver; the text names the wrong remedy for that case.
- Idle wakeups depend on Store publication of the committed high-water
  (#685). Until publication lands, an idle serve wakes on subscriber
  notices from publishing writers only.
- Full orphan re-adoption after owner death waits on owner recovery.
