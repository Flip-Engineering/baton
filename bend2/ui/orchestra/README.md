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

The page shows an attention strip, an agent roster, a selected record, knowledge
graphs, and a history ribbon. Quiet agents are folded initially; the quiet-agent
control reveals them. Ensemble labels group adjacent members in the roster.
The find field marks matching agents in place.

Selecting an agent opens its task, current input, request, report, and pending
message references. A message reference opens its complete stored body.
Selecting a finding opens its claim, evidence, limits, author, and sharing steps.

Each author's roster row carries a compact knowledge surface. The whole knowledge
graph opens from a disclosure and places agents and findings by parent depth.
Agents with missing parent metadata appear in an unknown-depth group. Directed
edges show authorship, sharing, delivery, and promotion.

The history ribbon shows committed changes by event kind. Its position selects a
change for reading; the record list opens from the ribbon.

The page reads snapshot, event-stream, knowledge, work, and message endpoints.
Text renders through `textContent`.
