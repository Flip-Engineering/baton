# Orchestra server boundary

The server opens the canonical Orchestra database read-only and binds one reader
session at startup. A snapshot or event request can select that reader or one of
its direct children. The result contains the selected session and its subtree.
Every request uses the reader bound at startup; the subject must be that reader
or one of its direct children.

`native_changes` stores change IDs, recorded times, entity identifiers, session
scope, operations, kinds, and short summaries. SQLite triggers append rows in the
same transaction as visible session, role, execution, stop, message, receipt,
turn, ensemble, section, membership, and native request writes. Each message row
contains its sender, recipient, kind, receipt operation, and a short summary.
The projection schema has no message body column. The table retains the newest
10,000 rows.

A snapshot reads player state, ensemble state, transitions, and the high cursor in
one read transaction. SSE IDs use the durable change cursor. The shared native
owner subscription supplies commit wake hints and an owner generation. The server
re-reads committed rows after each hint. A generation change or cursor outside the
retained range emits `gap` so the browser fetches a fresh snapshot.

The server consumes this source through the `subscribeCommittedChanges` option.
The command-line event route returns
`native-owner-subscription-unavailable` until startup supplies the canonical
shared-owner client through this option. Snapshot requests remain available.

Recorded execution phase, configured model, and observed model remain separate
fields. Actual process state is `unknown` unless a native observation establishes
it. Receiver and reference values are null when the database has no recorded
value. Provider limits appear when authoritative provider data supplies them.
