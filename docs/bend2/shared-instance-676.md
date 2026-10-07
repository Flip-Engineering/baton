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

One `serve` invocation holds each canonical Orchestra database:

- `Instance.claim_sql` (`bend2/src/coordinator/instance.bend`) records the
  holder in the `instance_owner` row. A second holder for the same database
  receives the `duplicate-owner` error naming the current holder. A
  re-claim by the recorded holder refreshes its heartbeat.
- `Instance.serve_loop` reads `Instance.next_session_sql` cursors and forks
  one `Instance.serve_session` task per session that holds unacknowledged
  input. Tasks join with `Instance.combine`, which carries the first
  failure. Sessions with a terminal stop never enter the cursor.
- `Instance.serve_session` calls the public receive entry
  (`Receive.run`) with empty command, model, effort, workspace and message
  arguments, which selects the session's recorded values and full pending
  inbox. Prepared admission (`Stop.admit`), native conversation identity
  (`sessions.native` with the `executions` directory and recovery argv),
  pending-input recovery, stop handling and parent notification execute in
  that path unchanged.
- Provider processes run where the harness requires them. Host custody of
  provider children inside the owner process is implemented in
  `process-spawn.c` under its assigned owner (DS lane). The `owner_path`
  function names the guard file beside the canonical database for that
  effect.
- The owner subscribes to the UI backend's committed-change cursor for wake
 ups. That cursor is the projection owned by `ui682-codex-luna-backend-20261006`
  with its schema additions and `sqlite.c` postcommit notification. The
  owner reads that source; it defines no separate event bus.
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

## Contracts and shared hunks

- `native685-muse-conductor-20261006` (owns `receive.bend`, `wake.bend`,
  `control.bend`, `store.bend`, pending-input tests): confirm the serve
  seam. `Instance.serve_session` calls public `Receive.run`. If the shared
  design needs a variant that assumes the owner claim is held, or a `store`
  routing change for owner-committed input, send the exact function
  signature and SQL. This lane makes no edits in those files.
- Root Luna `native_observation_repair_luna` (owns `turn.bend`): the serve
  path uses `Turn` only through `Receive.run`. A serve-mode custody variant
  of the retained attempt needs its signature from that owner.
- Schema Muse (owns `codec-schema.bend`) and UI backend
  (owns projection schema additions): the `instance_owner` table in
  `Instance.owner_schema` enters the schema through the schema owner's
  composition. This lane does not edit `commands.schema()`.
- DS lane (owns `process-spawn.c` custody): implement the owner-guard file
  lock at `Instance.owner_path`, per-session generation handles, and
  in-process provider-child custody with the existing release and
  acknowledge semantics. This lane makes no edits in `process-spawn.c`.
- Proposed CLI wiring for composition (unapplied in this lane):
  `main.bend` delegates the `serve` and `owner-status` verbs to
  `Instance.route`; `commands.bend` keeps its current `Command` type
  unchanged for this step.
- Proposed MCP wiring for composition: one `baton2_owner` tool calling
  `owner-status` through the existing `coord` helper, listed by
  `tools/list` beside the current tools.

## Scope of this change

This change adds `bend2/src/coordinator/instance.bend`,
`bend2/src/coordinator/instance-laws.bend`, one import line in
`bend2/src/coordinator/laws.bend`, and this document. Remote gates cover
the full entry build with every operative law, proof-removal controls, and
implementation mutation controls for the new laws. CLI verb wiring, MCP
tool wiring, custody implementation, and workload measurements follow
through the contracts above.
