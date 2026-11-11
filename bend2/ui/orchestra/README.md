# Orchestra live view

Read-only browser view of Orchestra activity, agents, messages, and knowledge.
The server serves the HTML, CSS, and JavaScript directly.

## Open

Serve this directory over HTTP and open `index.html`:

    python3 -m http.server 8137 --directory bend2/ui/orchestra

then open `http://localhost:8137/index.html`.

## Modes

- Live: `index.html?api=<base>` reads
  `{base}/orchestra/snapshot` once, then follows
  `{base}/orchestra/events`. See `interface.md` for the exact
  boundary. Without `?api=` the page states that no live
  endpoint is configured.
- Fixture: `index.html?fixture=<name>` renders a synthetic DOM
  behavior document from `fixtures/` (for example
  `fixture-small`) and turns live updates off; the screen is
  labeled as a fixture. `fixture-knowledge` carries a knowledge
  block beside its players, so the knowledge graph renders
  without a live endpoint, and `fixture-knowledge-empty` carries
  an empty block for the graph's empty state.
  `fixtures/README.md` lists what each document covers.

## Interface

The page combines the active orchestra with recorded activity. Running actors,
actors with owed input, and actors with open assignments appear initially.
Their recorded ancestors provide reporting context. Show history includes all
recorded actors. The find field filters actors by name, role or work.

Selecting an agent opens its task, current input, request, report, and pending
message references. A message reference opens its complete stored body.
Selecting a finding opens its claim, evidence, limits, author, and sharing steps.

The knowledge graph draws knowledge records and cited resources joined by named, directed
relations. Selecting a record or relation opens its content, evidence, scope,
reasoning and limits. Provenance and sharing appear in record details.
Selection preserves the page position, graph camera and complete graph context.
The detail panel scrolls within its own area.

The knowledge tier controls select Orchestra, Ensemble or Individual holdings.
Orchestra holdings belong to the selected Principal Conductor. Ensemble holdings
contain records explicitly promoted into the selected ensemble. Individual
holdings contain the selected actor's authored and received records. All tiers
reads every holding. The selected tier and holder appear above the graph and in
the page address. Selecting an actor follows its holdings when Individual is
selected. References to records outside the selected holdings remain labeled in
the graph.

The agent hierarchy places equal reporting depths on one horizontal row and
groups peers by their recorded ensembles. Fit hierarchy shows the complete
structure; Read labels provides full-size cards with horizontal scrolling.

The legend precedes the orchestra and activity view. Each actor shows its recorded
events on the shared time range. The history ribbon shows committed changes by
event kind. Selecting an event opens its recorded details. An event list opens
from the ribbon on request.

The page reads snapshot, event-stream, knowledge, work, and message endpoints.
Text renders through `textContent`.
