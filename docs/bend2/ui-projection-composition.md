# Orchestra UI projection composition

Source for the projection FFI and subscription adapter is on
`codex/ui682-projection-ac55-20261007` at `c3039aec540bde75653b4e10ea5de9ac364703bc`.
The branch starts at `ac55c2ef0514612869367bc246b4a7f5cab4831f`. The owner API
dependency is the shared composition source at `83b7d4fb85740b4c123db40a2424d154bec021e6`.

## Store integration

`DB.Sql.ensure_projection(path, schema)` executes the supplied coordinator schema,
`native_changes`, retention, and the UI triggers in one `BEGIN IMMEDIATE` transaction.
On an installation error it rolls back the transaction. The function is implemented
in `bend2/src/host/sqlite.bend` and `bend2/src/host/sqlite.c`.

The first effect in `Store.commit` must install the schema before the write transaction:

```bend
def commit(db: String, command: C.Command) -> IO(Result<&1, &1, U32 & String, String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    installed : Result<&1,&1,U32 & String,String> <- DB.Sql.ensure_projection(db,C.schema())
    match installed:
      case Fail{error}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{error})
      case Done{+ignored}: DB.Sql.query(db,"BEGIN IMMEDIATE;" ++ C.schema() ++ C.sql(command) ++ "COMMIT;")
```

After a successful commit, `Store.commit` reads `UIProjection.committed_high_water(db)`
and calls `Instance.publish_commit(db, Tx.trim_nl(high_water))`. The notification contains
no rows; the view reselects changes and state in a SQLite read transaction. A failed write
does not publish. Publication is a post-commit result and must not be reported as a rolled
back store write.

The operative `m5_a_report_and_its_delivery_are_one_transaction` law in
`bend2/src/coordinator/laws.bend` must include the `ensure_projection` effect before the
existing write transaction. The naming law
`named_commands_execute_the_committed_query_and_classify_its_answer` in
`bend2/src/coordinator/naming-laws.bend` must compare against `Store.commit` and
`Store.committed`, so the preflight is part of the law's execution path.

## Native subscription adapter

`bend2/src/coordinator/ui-subscription.bend` implements the `ui-subscribe` command body.
It calls `Instance.subscribe(database, afterCursor, expectedGeneration)`, writes the returned
readiness JSON as its first stdout line, then writes each `Instance.notice(handle)` JSON line.
Closing the CLI process closes its owner subscription handle.

`bend2/ui/orchestra/native-owner-subscription.mjs` starts that CLI command for an SSE
connection and adapts readiness and notices to the server's `subscribeCommittedChanges`
callback. The Node server continues to read change rows itself under the startup-bound reader
scope. EventSource requests supply only a cursor and generation. Owner frames are cursor-only
hints, and the adapter passes no row data across the owner channel.

Root-owned CLI composition adds `C.UiSubscribe{after,generation}`, dispatches that case to
`UISubscription.run(db,after,generation)`, and exposes `ui-subscribe AFTER GENERATION` in usage.
The UI view command passes its resolved Baton2 executable path to the Node server. The server
passes that path to `createNativeOwnerSubscriber`. The native package must include
`native-owner-subscription.mjs` beside `server.mjs`.

The required shared owner source at `83b7d4fb` defines `Instance.subscribe`,
`Instance.notice`, `Instance.unsubscribe`, and `Instance.publish_commit`.

## Fixture pending inputs

An earlier native fixture expected one pending input and observed three. The current fixture
query selects every unreceipted `task`, `guidance`, or `recovery` message addressed to the
worker while no stop record exists. Preserve all rows admitted by that query and derive the
snapshot `pendingCount` from the same predicate. The fixture compares that count with the
recorded rows; it does not discard rows to force a count of one.

## Qualification state

The projection FFI and subscription adapter commits are WIP source. No compiler, build, native
fixture, server test, or browser gate was run on this branch. Kimi's active gate remains the
owner for its current composed source; this branch does not start a duplicate gate.
