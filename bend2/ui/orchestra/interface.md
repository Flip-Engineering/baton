# Orchestra live view interface

Frontend: `bend2/ui/orchestra/` (Muse frontend seat, issue #682).
Backend (snapshot and event stream): coordinated lead,
`codex/ui682-codex-luna-backend-20261006`.
This document states the boundary the browser consumes.
The browser implements exactly this boundary and nothing else.

## Endpoints

- `GET {apiBase}/orchestra/snapshot?subject=<id>&since=<cursor>`
  returns one snapshot JSON object.
- `GET {apiBase}/orchestra/events?subject=<id>&since=<cursor>`
  returns a Server-Sent Events stream over the same subject scope
  as the snapshot. The reader identity stays the immutable startup
  identity; subject only filters within it.

`apiBase` is supplied to the page with `?api=<base>` or the
`orchestra-api-base` meta tag. A server `/` redirect that carries
the loopback API base is the normal launch path. The page makes no
other network calls.

## Snapshot object

- `contractVersion`: integer. The page requires `1`.
  On mismatch the page keeps the snapshot on screen and shows
  a version-mismatch notice.
- `cursor`: opaque string. Server event position the snapshot is
  current through. Empty string means from the start.
- `capturedAt`: string. Server time the snapshot was taken,
  shown exactly as recorded.
- `subject`: string or null. Selected Orchestra or Conductor id.
- `selection`: object describing snapshot scope,
  for example `{"mode": "all", "rule": "parent-owner-member-routes-v1"}`.
  `selection.gap: true` means the server could not honor the
  requested cursor; the page renders the snapshot as authoritative
  current state and holds the gap notice.
- `players`: array of player objects (next section).
- `ensembles`: array of ensemble objects (section below).
- `transitions`: array of committed transition objects,
  newest first: `{"seq": 41, "at": "<server time>",
  "session": "<player id>", "kind": "<transition kind>",
  "summary": "<short recorded note>"}`.
  Times are shown exactly as recorded. When absent or empty the page
  states that no committed transitions are in the snapshot.
- `tasks`: optional map from player id to task metadata:
  `{"<player>": {"id": "...", "title": "...",
  "status": "...", "updatedAt": "<server time>"}}`.
  A player with no entry shows task `unavailable`.
- `providers`: optional map from player id to provider state:
  `{"<player>": {"name": "...",
  "status": "known|unknown|unavailable"}}`.
  A player with no entry shows provider `unknown`.
  Unknown renders as the word `unknown`.

## Player object

Recorded configuration, observed provider data, and execution
status stay separate fields. Recorded execution state describes
the last committed coordinator record. Process liveness comes
only from the `actualProcess` observation and defaults to
`unknown`.

- `id`, `kind`, `role` (`player`, `principal-conductor`,
  `associate-conductor`, `operator`), `parent`
  (empty string means no parent).
- Configured: `harness`, `model`, `effort`.
- Observed: `observedHarness`, `observedModel`, `observedEffort`.
  Empty string means unobserved and renders as `unknown`.
- `workspace`, `branch`, `base`: worktree location, branch, base
  commit. Empty string renders as `unavailable`.
- `execution`: null or `{"attempt": "...", "mode": "...",
  "phase": "running|starting|exited", "status": "..."}`.
  This is recorded coordinator execution state (provenance).
  Null execution renders as `no execution recorded`.
- `actualProcess`: string. Independently observed process state.
  The server emits `"unknown"` unless a native liveness
  observation exists. The page renders the value, defaulting to
  `unknown` when the field is absent. Recorded execution state
  never stands in for process liveness.
- `lastTurnId`, `latestReportId`: strings, empty means none.
- `pendingCount`, `unacknowledgedCount`: integers.
- `ownedEnsembles`, `memberEnsembles`: arrays of ensemble ids.
- `liveReceiver`, `endpointRegistered`, `reference`: boolean or
  null. Null means no authoritative fact exists and renders as
  `unknown`. `false` renders as `none recorded` / `not a reference`.
- `inputRead`: array of strings describing the recorded input
  position, shown exactly as recorded.
- `stop`: null or `{"id": "...", "status": "...",
  "attempt": "...", "reportId": "..."}`.

## Ensemble object

`{"id": "...", "owner": "<player id>",
"coupling": "loose|tight", "members": ["<player id>"],
"sections": [{"ensemble": "<id>", "id": "<section id>",
"capability": "...", "members": ["<player id>"]}]}`.

## Event stream

Each SSE message carries `id: <cursor>` so the page resumes
from the next event after a reconnect. Event types:

- `hello`: `{"contractVersion": 1, "cursor": "..."}`.
- `gap`: `{"reason": "cursor-gap" | "reader-scope-changed" |
  "event-read-failed"}`. The server sends it when the durable
  cursor can no longer be honored (retention prune, invalid
  cursor, reader scope or owner-generation change) and then closes
  the stream. The page shows a gap notice, re-reads the snapshot
  immediately with `since=<last cursor>`, renders it as
  authoritative current state, and reopens the stream at the
  snapshot cursor.
- `player`: one full player object, applied by id.
- `ensemble`: one full ensemble object, applied by id.
- `transition`: one transition object, prepended to the list.
  Transitions carry no message bodies.
- `pending`: `{"session": "<player id>",
  "pendingCount": n, "unacknowledgedCount": n}` with optional
  `lastTurnId`, `latestReportId`, and `inputRead`. The backend
  emits `pending` for message inserts, receipt updates, and
  turn/stop/execution/role changes, applied to any session.

## Reconnect rule

On a `gap` event or stream loss the page re-reads the snapshot
immediately with `since=<last cursor>`, renders it as authoritative
current state, and reopens the stream at the snapshot cursor.
Quadratic backoff (1s, 2s, 4s, up to 30s) applies only when the
snapshot request itself fails (endpoint unreachable). The gap or
lost-stream notice stays visible until the next committed
`player`, `ensemble`, or `transition` event arrives. A version
mismatch keeps the last rendered state with an explicit notice.

## Recorded status derivation

The page derives the displayed status from recorded coordinator
fields only. It is recorded state, not process liveness:

- `stopped`: `stop` present with status `stopped`.
- `running`: `execution.phase` is `running`.
- `waiting`: `execution.phase` is `starting`.
- `completed`: `execution.phase` is `exited`
  and `execution.status` is `exit 0`.
- `failed`: `execution.phase` is `exited` with any other status.
- `pending`: no execution recorded and `pendingCount` above zero.
- `unknown`: none of the above can be established.

Pending counts render as badges next to the status in every case.
