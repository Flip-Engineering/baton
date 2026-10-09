# Orchestra live view

Read-only browser view of live Orchestra structure and status
(issue #682). Plain HTML, CSS, and JavaScript. No build step,
no dependencies.

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
  block beside its players, so the knowledge band renders
  without a live endpoint, and `fixture-knowledge-empty` carries
  an empty block for the band's empty state.
  `fixtures/README.md` lists what each document covers.

## Scope

The page renders five areas:

- A running-and-attention band above the tree: one chip per actor that is
  running, awaiting input, failed or pending, ordered running first, then
  awaiting input, failed and pending, and by recorded pending count inside a
  group. A chip selects its actor.
- The actor tree: the parentage hierarchy, with a search field and status and
  ensemble filters; each row carries its ensemble and section membership.
- The selected actor: task, worktree, branch, recorded execution, observed
  process and provider, pending counts, and the actor's recorded findings.
- Recent transitions: the snapshot's committed records with their recorded
  times.
- The knowledge band: one stand per actor that holds a recorded finding, at
  that actor's recorded distance from the podium. A stand's height is its
  authored findings, the filled inner part of that height is the findings
  shared at least once, the tick below the baseline is the findings it
  received, and a line is a recorded promotion from its source seat to its
  destination seat. An actor that holds a finding but is absent from the
  snapshot sits in a final `recorded outside this view` rank. The promotion
  readout beside the surface lists the same records as text; its filter field
  narrows the rows by finding id, claim or author, `Include unshared` adds the
  findings that no seat has promoted, and `Live only` narrows the surface to
  running, waiting and pending seats.

All text renders through `textContent`. The page issues only GET
snapshot, event-stream and knowledge requests.
