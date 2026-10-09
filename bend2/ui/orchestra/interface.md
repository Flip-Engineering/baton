# Orchestra live view interface

Frontend: `bend2/ui/orchestra/` (Muse frontend seat, issue #682).
Backend (snapshot and event stream): coordinated lead,
`codex/ui682-codex-luna-backend-20261006`.
This document states the boundary the browser consumes.
The browser implements exactly this boundary and nothing else.

## Endpoints

- `GET {apiBase}/orchestra/snapshot?subject=<id>&since=<cursor>`
  returns one snapshot JSON object.
- `GET {apiBase}/orchestra/events?subject=<id>&since=<cursor>&generation=<gen>`
  returns a Server-Sent Events stream over the same subject scope
  as the snapshot. The reader identity stays the immutable startup
  identity; subject only filters within it. `generation` binds the
  reconnect to the stored owner generation.
- `GET {apiBase}/orchestra/knowledge/overview` returns the
  orchestra-wide knowledge map: `findings` as `{id, author, claim}`,
  `promotions` as `{id, finding, author, source, destination,
  promotedBy}`, and per-actor `authored`/`received` counts. Evidence
  and limits stay out of the overview.
- `GET {apiBase}/orchestra/knowledge?actor=<id>` returns one actor's
  authored findings with full `claim`, `evidence`, and `limits`, the
  promotions it received joined to their finding's fields, and
  `counts` including `unshared` (authored, never promoted). The actor
  must be inside the bound reader's subject scope (403
  `reader-scope-denied`); a missing actor is a 400 `actor-required`.

Both knowledge routes are read-only and on demand: the snapshot never
carries claims. Absent or empty knowledge tables answer the same
shapes with empty arrays and `empty: true`. A failed database read
answers 503 `knowledge-unavailable`.

`apiBase` is supplied to the page with `?api=<base>` or the
`orchestra-api-base` meta tag. A server `/` redirect that carries
the loopback API base is the normal launch path. The page calls only
these endpoints, and calls the knowledge routes only on demand.

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
  generation, shows it in the header, and sends it back with the
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

The page renders five areas:

- A running-and-attention band above the tree: one chip per actor whose
  derived status is `running`, `failed` or `pending`, and per actor with a
  recorded execution that ended while its pending count is above zero
  (`awaiting input`). Running actors come first, then awaiting input, then
  failed, then pending; within a group the recorded pending count orders the
  chips. A chip selects its actor.
- The actor tree: the parentage hierarchy, with a tag line under each row that
  carries ensemble or section membership.
- The selected actor: the recorded fields of the Player object below, plus
  that actor's stored findings.
- Recent transitions: the snapshot's `transitions`, newest first.
- The knowledge band: one stand per actor that holds a recorded finding, at
  that actor's recorded distance from the podium; a stand's height is the
  actor's authored findings, the filled inner part of that height is the
  findings promoted at least once, the tick below the baseline is the
  promotions the actor received, and a line joins the source seat and the
  destination seat of a recorded promotion. An actor that holds a finding and
  is absent from the snapshot sits in a final `recorded outside this view`
  rank. The promotion readout beside the surface lists the same records as
  text, with a filter field that narrows rows by finding id, claim or author,
  an `Include unshared` control, and a `Live only` control that narrows the
  surface to running, waiting and pending seats.

## Fixture documents

`index.html?fixture=<name>` loads `fixtures/<name>.json` in place of the
snapshot route and turns live updates off. The document carries the snapshot
fields, a `fixture: true` marker, a `fixtureNote`, and may carry one more key:

- `knowledge`: an object shaped like `/orchestra/knowledge/overview`
  (`contractVersion`, `findings`, `promotions`, `actors`, and `empty` for a
  document with no records). A fixture that carries it renders the knowledge
  band from this object in place of an overview request. Its `findings` may
  carry the `evidence` and `limits` fields the actor route serves, so the
  selected-actor pane shows a complete record without a live endpoint. A
  fixture without the key renders the band's notice.
