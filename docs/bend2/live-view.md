# Orchestra live view

`baton2 DATABASE view SUBJECT [READER [PORT]]` starts an optional read-only browser
view of recorded Orchestra state. The command spawns the packaged UI server bound to
loopback, prints the URL, tries `open`/`xdg-open`, and serves until the command exits
(Ctrl-C stops the server; the server also exits when its stdin closes).

- `SUBJECT` selects the root of the visible hierarchy.
- `READER` defaults to `SUBJECT`. The server binds this identity once at startup; the
  subject only filters within the reader's admitted scope. A reader sees itself or an
  immediate child as subject, and that subject's reporting subtree. The server refuses
  other selections with `reader-scope-denied`.
- `PORT` defaults to 7682. The server exits with an error if the port is in use; pass
  another port.

The page shows the reporting hierarchy with Ensemble and Section memberships, configured
harness/model/effort, observed provider identity when recorded, worktree/branch/base,
recorded execution state, pending and unacknowledged input counts, stop records, and the
most recent committed transitions with their recorded times.

## State and event boundary

The server reads the same coordinator database as the CLI. It never writes to it.

- A SQLite trigger set (`native_changes`) appends one row per committed mutation of
  sessions, roles, executions, stops, messages (including receipts), turns, ensembles,
  memberships, sections, and native requests, inside the same transaction as the
  mutation. `recorded_at` is the trigger record time. The triggers are installed by
  `Sql.ensure_projection`, called from the native-request commit paths and, once the
  pending store hunk lands (native685 owns `store.bend`), from `Store.commit`, the
  funnel for every ordinary CLI write. A database that has not yet seen either path has
  no `native_changes` table and the snapshot endpoint answers `503 snapshot-unavailable`.
- A snapshot is one read transaction: the scoped state plus the `native_changes`
  high-water cursor, so the snapshot is exactly the state at that cursor.
- The projection reads every per-session value in a fixed number of passes: one pass
  per recorded relation (executions, turns, reports, unread messages, the pending
  sample, ensembles and memberships, stops, open native requests, the recorded times
  behind a current action) over the sessions the request covers. A snapshot of the
  whole scope and an event frame for one session read those relations once each.
- The event stream (Server-Sent Events) replays durable `native_changes` rows after the
  client's cursor and pushes player/ensemble/pending/transition frames. The browser
  holds an `EventSource`; it does not poll.
- Live push requires a committed-change notification from the shared per-DB native
  owner. An unavailable subscription answers `503 native-owner-subscription-unavailable`;
  the browser shows the error and continues checking for the subscription. Snapshot
  reads remain available.
- On reconnect the browser re-reads the snapshot and resumes the stream at the snapshot
  cursor. A stale or pruned cursor answers `gap`, which forces a fresh snapshot.
- The projection retains committed change rows. A cursor preceding the available
  history receives a `gap` event and reloads the snapshot.

## Honesty rules

The view separates recorded configuration, observed provider data, and recorded
execution state. A recorded assignment or a recorded execution phase does not prove that
a process is currently live or that a task succeeded; fields that cannot be established
from the database render as `unknown`. Ensemble and section member lists apply the same
orphan filter as the `orchestra` CLI reader: memberships whose session row no longer
exists are omitted.

## Packaging

`package-native.py` stages `bend2/ui/orchestra/` (`server.mjs`, `index.html`,
`styles.css`, `app.js`) into `libexec/baton2/ui/`. At runtime the `view` command resolves
`server.mjs` beside the executable first and in a source checkout second. The server
requires Node 22 for `node:sqlite`. The view is optional: dispatch, landing, validation,
and release acceptance do not depend on it.

## Known limits

- The view shows recorded state; it does not probe live processes.
- Message bodies never leave the database through this surface; transitions carry kind,
  sender, and recorded time only.
- One server per invocation. Stopping the command stops the server.
