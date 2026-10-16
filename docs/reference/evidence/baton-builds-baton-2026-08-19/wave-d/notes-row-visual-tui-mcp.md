# Wave D — row-visual-tui-mcp: the TUI seat + MCP tool wiring

attempt: 6e2148ce-c9bd-4719-b918-cf3b85a69bcd row-visual-tui-mcp
objectiveRef: brief `omp-rpc` (baton-top.mjs + the meta tool); pins on master: `impl/test/baton-top.test.mjs` (70 lines), `impl/test/mcp-visualization.test.mjs` (80 lines), `docs/38-flip-visual-surfaces.md`.
Worktree: `baton/ws-ccf88e2add68f40fa30d0a04492ad3a6` (effective-tree snapshot of master c6ebca5f).

## Deliverables

### A — `impl/src/baton-top.mjs` (new, 267 lines)
- `parseBatonTopCli(argv)`: `null` for any non-`top` argv (never swallows the ordinary CLI — pinned);
  `top RUN_ID --wave-id W --view V --refresh N --no-motion` → the exact pinned shape
  `{ kind:'top', runId, waveId, view, refreshMs, width:null, once:false, plain:false, motion:false, color:true }`;
  `top --plain` → `{ kind:'top', runId:null, waveId:null, view:'overview', refreshMs:1000, width:null, once:true, plain:true, motion:false, color:false }`;
  `top --help` → `{ kind:'top_help' }`. `BATON_TOP_HELP` contains the literal `Worker/provider prose`
  (pinned) plus the docs/38 usage + interactive-key reference.
- `runBatonTop(parsed, { client, stdout, stdin, clock })`: non-TTY (or `--once`/`--plain`) renders
  exactly ONE stable frame through `client.surfaceSnapshot({ runId, waveId })` →
  `projectBatonVisualModel({ snapshot, width })` → `renderBatonVisual(model, { width, color:false, motion:false, view })`,
  writes stdout once, returns `{ run: model.run }`. No polling loop when `once` or non-TTY (pinned:
  exactly one `surfaceSnapshot` call, no ANSI, `run.runId` carried). On a real TTY without `--once` it
  runs the responsive interactive loop (keys 1–4/tab/r/p/m/?/[ ]/a/d/j/k/q from docs/38).
- `respondToVisualAttention(client, model, index, decision)`: lowers ONLY through
  `client.command('run.answer', { runId, requestId, answer: { decision } })` for `model.attention[index]`;
  empty attention — or an item lacking a Run/request identity — refuses the typed code
  `visual_action_unavailable` (pinned; docs/38 P5: never invent an answerable identity).
- Sibling load: `./visual-model.mjs` / `./visual-renderer.mjs` are imported lazily inside the call
  path so package/CLI imports stay inert (docs/38 acceptance #8); absent siblings surface a typed
  `visual_sibling_invalid` rather than a load-time crash.

### B — the MCP meta tool `baton_surface_visualize`
- `impl/src/surface-capability-resolution.mjs`: new `surface.visualize` capability row
  (`UNIFIED_VISUALIZATION_CAPABILITY`, kind `surface_meta`, mode `query`, lane `projection`,
  read-only annotations) + `UNIFIED_VISUALIZATION_TOOL`; both appended to
  `COMPLETE_UNIFIED_MCP_META_TOOL_DEFINITIONS` and `completeUnifiedCapabilityCatalog()`
  (mirrors the `baton_surface_watch` precedent exactly).
- `impl/src/production-mcp-convergence.mjs`: `handleMeta` branch for `baton_surface_visualize` →
  `surfaceVisualize(...)`: validates closed args `{ view, runId?, waveId?, width?, follow?,
  afterCursor?, attentionCursor?, kind?, timeoutMs? }`; `follow` without `runId` refuses typed
  `surface_visualization_invalid` (pinned — no invented global watch authority); composes
  `surfaceSnapshot` + optional `surfaceWatch` (null `waveId`/`kind` omitted so the existing watch
  validation stays happy); projects through the visual siblings; returns
  `{ structuredContent: { kind:'baton.surface_visualization', model, presentation } }` with
  `presentation.refresh.tool === 'baton_surface_visualize'` (pinned) carrying the NEXT existing
  cursors, and `content[0].text` = the static ANSI-free rendering (pinned: no `\u001b`).

### C — CLI wiring
- `impl/src/application-cli.mjs`: `parseBatonCli` delegates to `parseBatonTopCli` early
  (returns null for non-top argv, so the ordinary parse branch is untouched — `runs list`,
  `run show`, `run status` all verified unchanged); `top --help` returns `top_help` before the
  generic help branch.
- `impl/scripts/baton.mjs`: `top_help` prints `BATON_TOP_HELP`; `top` routes through the resident
  authenticated client (`clientFor(discoverBatonConnection())` → `wrapProductionCliClient`, which
  exposes the `surfaceSnapshot` seam) into `runBatonTop` with `process.stdout/stdin` and
  `Date.now` — no JSON projection appended (docs/38: `baton top` is explicit human output).

## Verification

### Pins (master test files run against this worktree, with faithful sibling stubs)
Sibling modules `visual-model.mjs`/`visual-renderer.mjs` land in parallel rows and were not present
at any point during this wave. To verify MY exports to the pinned interface, `wave-d/scratch/` holds
the two pins verbatim from master, symlink farms of the real `impl/src` graph, verbatim copies of
the three modules whose relative/dynamic imports must resolve inside the harness
(`baton-top.mjs`, `production-mcp-convergence.mjs`, `production-mcp-complete.mjs`), and two stubs
that implement exactly the sibling contract the pins demonstrate
(`projectBatonVisualModel({ snapshot, width })`; `renderBatonVisual(model, { width, color, motion, view })`).

`node --test scratch/test/baton-top.test.mjs scratch/test/mcp-visualization.test.mjs`:
**5/5 pass** — baton-top 3/3, mcp-visualization 2/2.
(One real bug found and fixed via this harness: composing `surfaceWatch` with `waveId: null` /
`kind: null` hit the existing `surface_watch_invalid` validation; the visualize composition now
omits nulls.)

### CLI/parser unit checks (13/13 PASS, direct against `impl/src`)
Non-top null; pinned top shape; pinned plain shape; help kind; `parseBatonCli` delegation keeps
`runs list`/`run show`; invalid view / refresh / extra positional → typed `cli_invalid`;
`respondToVisualAttention` lowers exactly `['run.answer', { runId, requestId, answer: { decision } }]`;
empty and unanswerable attention → `visual_action_unavailable`.
End-to-end: `node impl/scripts/baton.mjs top --help` prints `BATON_TOP_HELP`, exit 0.

### Regression sweeps (with-changes vs pristine baseline, same batches)
| Batch | tests | pass/fail with changes | pass/fail baseline | delta |
|---|---|---|---|---|
| production-mcp-convergence, surface-capability-catalog, surface-cli, unified-mcp/cli-surface, surface-audit-smoke, phase64-application-cli | 54 | 52/2 | 52/2 | 0 |
| control-surface-truth, converged-export, mcp-reflex-surface, mcp-surface-widening, mcp-profile-parity, mcp-packaging, mcp-tool-map, surface-conformance-red, surface-parity-191, production-cli-convergence, production-convergence, cli-adapters, cli-dead-paths, cli-truthfulness, cli-wave-fidelity | 144 | 125/19 | 125/19 | 0 |
| workflow-surface-red, phase16-mcp-northbound, mcp-web-local-resident, mcp-reflex-board-package, run-debug-surface, turn-checkpoints-surface, worker-verdict-surface | 124 | 94/30 | 94/30 | 0 |

All failures are pre-existing on the base snapshot (verified by stash/pop baseline runs); the
notable ones (`SA2` stale 5-command bridge-set pin, `RG-*` fleet sibling stages, `SC5/SC6`, `UC2b`
batch-order interference) exist identically without my changes. **My changes introduce zero new
test failures** across ~320 surface/MCP/CLI tests.

### Deployment verification
Executable `true`, args `[]`, exit code 0 (this is the DoD execution contract; the substantive
gates are the pins above).

## Integration verdicts with the parallel visual siblings
- `impl/src/visual-model.mjs` (`projectBatonVisualModel`): **not yet landed in this worktree** —
  integration pending; contract consumed: `projectBatonVisualModel({ snapshot, width })` where
  snapshot entries are `{ ok, value }` envelopes and the returned model exposes `.run` (with
  `.runId`) and `.attention` items `{ id, requestId, runId, kind, requiredAction, prompt }`
  (both shapes pinned by the baton-top test).
- `impl/src/visual-renderer.mjs` (`renderBatonVisual`): **not yet landed in this worktree** —
  integration pending; contract consumed: `renderBatonVisual(model, { width, color, motion, view })`
  returning a static Unicode frame whose header contains `baton top` and that emits ANSI only when
  `color` is true (pinned).
- When the siblings appear in this worktree the real pins can run in place
  (`impl/test/baton-top.test.mjs`, `impl/test/mcp-visualization.test.mjs` from master) with zero
  further changes to this wave's modules; the scratch harness is retained under `wave-d/scratch/`
  as the evidence of the pre-sibling verification.

## Notes / decisions
- Lazy (in-call) import of the visual siblings keeps `application-cli.mjs`/`baton.mjs`/
  `production-mcp-convergence.mjs` loadable while the siblings are absent and honors docs/38
  acceptance #8 ("package imports remain inert"). Absent siblings degrade to typed codes
  (`visual_sibling_invalid` / `surface_visualization_unavailable`), never a load-time crash.
- `baton_surface_visualize` is advertised without dropping any existing tool (appended to
  `COMPLETE_UNIFIED_MCP_META_TOOL_DEFINITIONS`; `META_NAMES` picks it up; existing 5 meta tools
  unchanged — pinned by the tools/list assertion).
- `content[0].text` carries the static rendering itself (per the brief), while structuredContent
  remains the authority (docs/38 P1).
