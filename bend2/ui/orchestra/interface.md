# Orchestra live view interface

Frontend: `bend2/ui/orchestra/` (Muse frontend seat, issue #682).
Backend (snapshot and event stream): coordinated lead,
`codex/ui682-codex-luna-backend-20261006`.
This document states the boundary the browser consumes.
The browser implements exactly this boundary and nothing else.

## Endpoints

- `GET {apiBase}/orchestra/snapshot?subject=<id>&since=<cursor>`
  returns one snapshot JSON object.
- `GET {apiBase}/orchestra/events?since=<cursor>`
  returns a Server-Sent Events stream.

`apiBase` is supplied to the page with `?api=<base>` or the
`orchestra-api-base` meta tag. The page makes no other network calls.

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
status stay separate fields. Execution status alone describes
whether a process is live.

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
  Null execution renders as `no execution recorded`.
- `lastTurnId`, `latestReportId`: strings, empty means none.
- `pendingCount`, `unacknowledgedCount`: integers.
- `ownedEnsembles`, `memberEnsembles`: arrays of ensemble ids.
- `liveReceiver`, `endpointRegistered`, `reference`: booleans.
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
- `player`: one full player object, applied by id.
- `ensemble`: one full ensemble object, applied by id.
- `transition`: one transition object, prepended to the list.
- `pending`: `{"session": "<player id>",
  "pendingCount": n, "unacknowledgedCount": n}`.

## Reconnect rule

On stream close or error the page waits with quadratic backoff
(1s, 2s, 4s, up to 30s), re-reads the snapshot with
`since=<last cursor>`, then reopens the stream at the snapshot
cursor. A gap or version mismatch keeps the last rendered state
with an explicit notice.

## Status derivation

The page derives the displayed status from recorded fields only:

- `stopped`: `stop` present with status `stopped`.
- `running`: `execution.phase` is `running`.
- `waiting`: `execution.phase` is `starting`.
- `completed`: `execution.phase` is `exited`
  and `execution.status` is `exit 0`.
- `failed`: `execution.phase` is `exited` with any other status.
- `pending`: no execution recorded and `pendingCount` above zero.
- `unknown`: none of the above can be established.

Pending counts render as badges next to the status in every case.
