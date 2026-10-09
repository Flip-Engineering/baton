# Orchestra live view interface

The browser in `bend2/ui/orchestra/` reads the snapshot, event stream, knowledge,
work, and message endpoints served by `server.mjs`.

## Endpoints

- `GET {apiBase}/orchestra/snapshot?subject=<id>&since=<cursor>`
  returns one snapshot JSON object.
- `GET {apiBase}/orchestra/events?subject=<id>&since=<cursor>&generation=<gen>`
  returns a Server-Sent Events stream over the same subject scope
  as the snapshot. The reader identity stays the immutable startup
  identity; subject only filters within it. `generation` binds the
  reconnect to the stored owner generation.
- `GET {apiBase}/orchestra/knowledge/overview` returns the
  orchestra-wide knowledge map: `findings` as `{id, author, claim, evidence, limits}`,
  `promotions` as `{id, finding, author, source, destination,
  promotedBy}`, per-actor `authored`/`received` counts, and `actors` metadata
  with each actor's `role` and `parent`. Ancestor metadata supports depth placement.
- `GET {apiBase}/orchestra/knowledge?actor=<id>` returns one actor's
  authored findings with full `claim`, `evidence`, and `limits`, the
  promotions it received joined to their finding's fields, and
  `counts` including `unshared` (authored, never promoted). The actor
  must be inside the bound reader's subject scope (403
  `reader-scope-denied`); a missing actor is a 400 `actor-required`.
- `GET {apiBase}/orchestra/work?subject=<id>` returns the selected actor's
  task, current input, open request, and latest report. A missing actor parameter
  answers 400 `actor-required`; an actor outside the reader scope answers 403
  `reader-scope-denied`; a failed read answers 503 `work-unavailable`.
- `GET {apiBase}/orchestra/message?id=<id>` returns
  `{contractVersion, message: {id, sender, recipient, kind, body}}` for one
  complete stored message. A missing row returns `message: null`. A missing
  parameter answers 400 `message-required`; a message outside the reader scope
  answers 403 `reader-scope-denied`; a failed read answers 503
  `message-unavailable` with its cause.

The page reads the knowledge overview after loading its snapshot. Selected actor,
work, and message reads run on demand. Absent or empty knowledge tables answer the same
shapes with empty arrays and `empty: true`. A failed database read
answers 503 `knowledge-unavailable`.

`apiBase` is supplied to the page with `?api=<base>` or the
`orchestra-api-base` meta tag. A server `/` redirect that carries
the loopback API base is the normal launch path.

## Snapshot object

- `contractVersion`: integer. The page requires `1`.
  On mismatch the page keeps the snapshot on screen and shows
  a version-mismatch notice.
- `cursor`: opaque string. Server event position the snapshot is
  current through. Empty string means from the start.
- `capturedAt`: string. Server time the snapshot was taken,
  shown exactly as recorded.
- `subject`: string or null. Selected Orchestra or Conductor id.
- `selection`: object describing snapshot scope:
  `{"mode": "all|subtree", "rule": "parent-owner-member-routes-v1",
  "reader": "<bound reader>", "scope": ["<visible ids>"], "gap": false}`.
  `selection.gap: true` means the server could not honor the
  requested cursor; the page renders the snapshot as authoritative
  current state and holds the gap notice.
- `subject`: echoed selected subject. The snapshot carries no owner
  generation; generation arrives on `hello` and `gap` frames.
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

- `hello`: `{"contractVersion": 1, "cursor": "...",
  "generation": "<owner generation>"}`. The page stores the
  generation and sends it back with the
  cursor on every explicit reconnect. A `hello` generation that
  differs from the stored one closes the stream, clears the
  cursor, re-reads a full snapshot immediately, and resubscribes
  under the new generation.
- `cursor`: named keepalive frame with empty data. The durable
  cursor travels in the frame id. The page advances its stored
  cursor from each frame id (or from `data.cursor` when present).
- `gap`: `{"reason": ..., "generation": "<owner generation>"}` with
  reason `cursor-gap`, `reader-scope-changed`, `ensemble-removed`,
  `entity-removed`, `owner-generation-changed`,
  `owner-notification-lost`, or `event-read-failed`. The server sends
  it when the durable cursor can no longer be honored and then closes
  the stream.
  The page stores the generation, shows the matching notice,
  re-reads the snapshot immediately with `since=<last cursor>`,
  renders it as authoritative current state, and reopens the
  stream at the snapshot cursor.
- `player`: one full player object, applied by id.
- `ensemble`: one full ensemble object, applied by id.
- `transition`: one transition object, prepended to the list.
  Transitions carry no message bodies.
- `pending`: `{"session": "<player id>",
  "pendingCount": n, "unacknowledgedCount": n,
  "lastTurnId": "...", "latestReportId": "..."}`. The backend
  emits `pending` for message inserts, receipt updates, and
  turn/stop/execution/role changes, applied to any session.

## Reconnect rule

The events endpoint takes `subject`, `since`, and `generation`
(expected owner generation; a mismatch ends the stream with an
`owner-generation-changed` gap before `hello`). Absent or empty
`since` reads from zero; a non-numeric `since` is a 400
`invalid-cursor`. A subject outside the bound reader scope is a
403 `reader-scope-denied`. A missing owner subscription is a 503
`native-owner-subscription-unavailable`, as is a failed snapshot
read (`snapshot-unavailable`).

An endpoint refusal before the first `hello` retries only the
events request with the current cursor and generation every second. Each retry fetches the events URL and reads
its response headers. Only a 503 response
reads its finite JSON body; the exact
`native-owner-subscription-unavailable` error updates the notice and continues
checking for the owner subscription. Any other
response, including an open 200 event stream, cancels the probe
body and resumes `connectEvents()` with no snapshot. An
unreachable endpoint keeps the existing retry path. The events notice clears on the
first `hello`. After a `hello`, a `gap` event or stream loss
re-reads the snapshot immediately with `since=<last cursor>`,
renders it as authoritative current state, and reopens the
stream at the snapshot cursor bound to the stored generation.
A failed snapshot request retries every second. The gap or lost-stream notice stays visible until the
next committed `player`, `ensemble`, or `transition` event
arrives. A version mismatch keeps the last rendered state with
an explicit notice.

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

## Rendered areas

The page contains an attention strip, an agent roster, a selected record,
knowledge surfaces, and a history ribbon. Quiet actors are folded initially.
The find field marks matching actors in place. Adjacent ensemble members carry
their ensemble label.

The selected record reads the actor's work and complete pending message bodies
on demand. A selected finding shows its claim, evidence, limits, author, and
recorded promotion steps.

Compact knowledge surfaces attach findings to their authors' rows. The full graph
opens from a disclosure and places actors by parent depth, including an
unknown-depth group. Its directed edges represent authorship, sharing, delivery,
and promotion.

The history ribbon colors committed changes by kind. Selecting a position reads
that event; a control opens the event list.

## Fixture documents

`index.html?fixture=<name>` loads `fixtures/<name>.json` in place of the
snapshot route and turns live updates off. The document carries the snapshot
fields, a `fixture: true` marker, a `fixtureNote`, and may carry one more key:

- `knowledge`: an object shaped like `/orchestra/knowledge/overview`
  (`contractVersion`, `findings`, `promotions`, `actors`, and `empty` for a
  document with no records). A fixture that carries it renders the knowledge
  graph from this object in place of an overview request. Its `findings` may
  carry the `evidence` and `limits` fields the actor route serves, so the
  selected-actor pane shows a complete record without a live endpoint. A
  fixture without the key renders the notice in the knowledge readout.
