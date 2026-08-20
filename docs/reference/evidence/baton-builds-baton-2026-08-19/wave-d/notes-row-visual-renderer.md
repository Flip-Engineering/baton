[attempt: 6e2148ce-c9bd-4719-b918-cf3b85a69bcd row-visual-renderer]

# ROW NOTES — row-visual-renderer: #242 renderer + MCP presentation

Row: #242 visual renderer (wave-d) · Pin: `impl/test/visual-renderer.test.mjs` (3 tests,
55 lines, from master) · Spec: `docs/38-flip-visual-surfaces.md` (master) — P1–P5.

## Deliverable

`impl/src/visual-renderer.mjs` — the visual RENDERER + MCP presentation layer. It consumes
the shared `baton.visual_model` projected by the sibling row (`projectBatonVisualModel` from
`../src/visual-model.mjs`) and exports exactly the pin's three functions:

1. **`batonVisualWidth(input)`** — terminal display width: ANSI/CSI sequences occupy 0
   columns (stripped before measuring), combining marks/ZWJ are 0, East Asian Wide/Fullwidth
   and astral emoji code points count 2, everything else 1. Used by both the pin and the
   renderer's own fitting.
2. **`renderBatonVisual(model, { width, color, motion, view })`** — one static text frame,
   every line fitted to ≤ `width` display columns. Views:
   - **overview** (default): header `baton top · overview · runId` (P4 Flip present; `✦`
     when motion), `What is happening` narrative section (story compiler narrative, else the
     clearly-labeled deterministic run-narrative projection — P1), Run spine, Fleet roster
     (stacked under 120 columns, balanced two-column panels at ≥ 120 — P3), Attention with
     explicit `respondable`/`not-answerable` markers (P5: nothing invented), Pulse (lanes,
     queued, route readiness).
   - **topology**: `Fleet graph` heading, a labeled `coordinates (x, y)` grid of the node
     inventory (deployment → run → members → routes → attention) and `edges` lines
     (model's own topology edges, else the bounded worker→route `uses` derivation — P1).
   - **timeline**: provenance legend `prose ‹worker words› · fact` (P2) and one line per
     event — worker prose rendered inside `‹angle delimiters›`, facts plain; the sequence
     prefix is dropped first on overflow so the prose message survives narrow widths.
   - **telemetry**: `Route readiness` per-route rows (harness/model/effort/state), worker
     counts, scheduler lanes.
   Color and motion are progressive enhancements (P3): default `color:false` → the frame
   contains no escape bytes at all; `motion:false` → no animation hints.
3. **`createBatonMcpPresentation(model, { width })`** — the `baton.visual_presentation`
   envelope: `kind`, static ANSI-free `text`, `accessibleSummary` from the run narrative,
   `animation.frames` = 4 low-amplitude Flip sparkle frames (P4), and `refresh` →
   `baton_surface_visualize` with exact arguments `{ runId, follow: true, afterCursor,
   attentionCursor }` (P5 — lowers through the existing authority, never bypasses it).
   `actionSuggestions` mirror only the model's explicit answerable approvals
   (`run.answer`).

## Verification

Pin not runnable at HEAD: `visual-model.mjs` (sibling row) is not yet in this worktree, so
`node --test impl/test/visual-renderer.test.mjs` is RED via `MODULE_NOT_FOUND` — the
expected pre-sibling state.

Self-check against the documented model contract (renderer fixture from the pin, model
shape per `row-visual-model-brief.md`): 27/27 assertions pass —

- **Pin 1** widths 40/58/84/118/160: every rendered line `batonVisualWidth(line) ≤ width`,
  output contains `baton top` and `What is happening`, and no ANSI bytes.
- **Pin 2** at width 100: topology contains `Fleet graph` and `coordinates`; timeline
  contains `prose` and `‹The layout is ready.›`; telemetry contains `Route readiness`.
- **Pin 3** `createBatonMcpPresentation(model, { width: 96 })`: `kind ===
  'baton.visual_presentation'`, `animation.frames.length === 4`, `refresh.tool ===
  'baton_surface_visualize'`, `refresh.arguments = { runId: 'run:render', follow: true, … }`,
  `text` free of `\u001b`, `accessibleSummary` matches the run narrative
  (`/Flip is quietly/u`).
- Robustness: CJK counts 2, combining 0, ANSI 0, emoji 2; degenerate/empty models render
  bounded frames; empty timeline still labels provenance `prose`; narrow timeline drops the
  seq prefix instead of the prose message; all four views at every pin width plus 240 stay
  within the width bound.

## Integration verdict (row-visual-model)

Verified via fidelity sandbox (sibling had not landed in this worktree after ~40 minutes of
polling): the REAL pin `impl/test/visual-renderer.test.mjs` was run unchanged against a
temporary `projectBatonVisualModel` implementation built strictly from the sibling's
documented contract (`row-visual-model-brief.md` + `visual-model.test.mjs` on master) —
that stub itself passes the sibling's pin 3/3, confirming fidelity. Result: **3/3 GREEN**
(`responsive renderer never exceeds…`, `distinct topology/timeline/telemetry views…`, `MCP
presentation…`) — 6/6 together with the model pin. The stub lived only in `/tmp` (outside
the worktree) and was removed after the run.

Every model field the renderer consumes is pinned by the sibling's own test
(`run.runId`/`narrative`, `story.source`, `fleet.members`/`counts`, `attention[].respondable`,
`controls.approvals[].allow.command`, `topology.edges` `uses`, `telemetry.routes`,
`timeline[].provenance`/`summary` ANSI-stripped, `cursors.after`), so when the real sibling
lands, `node --test impl/test/visual-renderer.test.mjs` is expected 3/3 with no renderer
change. Re-run the pin at that point to confirm; defensive accessors cover the unpinned
display fields (member role/state/route, route harness/model/effort/state, edge field-name
variants).

## Scope

- `impl/src/visual-renderer.mjs` — new module (in scope).
- `impl/test/visual-renderer.test.mjs` — pin brought into the worktree verbatim from master
  (55 lines, unmodified; in scope).
