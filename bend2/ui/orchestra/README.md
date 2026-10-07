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
- Fixture: `index.html?fixture=fixture-small` (or
  `fixture-dense`) renders synthetic DOM behavior fixtures
  from `fixtures/`. The screen is labeled as a fixture and
  live updates stay off.

## Scope

The page renders hierarchy first (parentage tree), ensemble
and section cross-membership, search and status/ensemble
filters, a selected-actor detail panel (task, worktree, branch,
report pending counts, observed and configured provider), and
recent committed transitions with recorded times.
All text renders through `textContent`. The page issues only
GET snapshot and event-stream requests.
