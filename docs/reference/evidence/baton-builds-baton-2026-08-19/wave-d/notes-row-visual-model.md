# ROW NOTES — row-visual-model: the bounded `baton.visual_model` projection (#242)

[attempt: 6e2148ce-c9bd-4719-b918-cf3b85a69bcd row-visual-model]

Attempt line verbatim: `[attempt: 6e2148ce-c9bd-4719-b918-cf3b85a69bcd row-visual-model]`
Wave: baton-builds-baton-2026-08-19 wave-d · Row: #242 visual MODEL module
Authority: row-visual-model-brief.md + docs/38-flip-visual-surfaces.md (the contract).

## Deliverable

`impl/src/visual-model.mjs` — new module exporting `projectBatonVisualModel({ snapshot, watch })`,
a pure projection of the existing Run, story, event, attention, readiness, route, worker and
convergence authorities into the canonical `baton.visual_model` (P1: structure first; the model
is not an authority). 3/3 pins GREEN.

## The pin (RED → GREEN)

The spec (impl/test/visual-model.test.mjs, 83 lines, 3 tests) and docs/38 live ON MASTER; the
wave branch strips the wave-d scaffolding, so I restored the pinned test verbatim from master
(blob 066f864a, byte-identical) — no spec bug found, no test edits. RED at HEAD confirmed:
`ERR_MODULE_NOT_FOUND` for `../src/visual-model.mjs` (test import), `node --test` → 1 fail.

## Implementation notes

Composition seams (exactly the brief's list):

- **run** — `snapshot.run.value` projected to `{runId, phase, objective, narrative, progress}`.
- **story** — `snapshot.story` → `{source: 'story_compiler', narrative, signals}`; narrative
  falls back to `run.value.narrative` when the snapshot story is absent (the renderer row's
  fixture has no `snapshot.story` and its accessibleSummary pins the run narrative — verified).
- **fleet** — `snapshot.run.value.workstreams` → `members` capped 64 (`slice(0, 64)`), each
  `{workerId, role, state, task, route, warnings, budgetUsed, budget, pathScope}`; `counts.active`
  = members with `state === 'working'`.
- **attention** — `snapshot.run.value.attention` (fallback `watch.attention.value.reasons`),
  each `{id, requestId, kind, requiredAction, prompt, respondable}`; `respondable =
  Boolean(requestId)` — P5's "explicit answerable request identity" rule.
- **controls** — `approvals` = respondable attention items lowered through
  `allow.command: 'run.answer'` with `{requestId, runId, kind, prompt}`; `takeover.available =
  false` (no session-TUI handoff authority exists — P5).
- **topology** — derived, not a new store: `deployment → run` ('owns'), `run → worker`
  ('member'), `worker → route` ('uses') edges; the 'uses' edges come from `workstream.route`.
- **telemetry** — `snapshot.doctor.value.routes` (`{harness, model, effort, state, summary}`) +
  `snapshot.convergence.scheduler` lanes (`active` lane names, `queued` counts).
- **timeline** — `watch.follow.events`, capped at the latest 64 (`slice(-64)`); actor
  `'worker'` → `provenance: 'worker_prose'` with `summary` = the **ANSI-stripped message**,
  all other actors → `provenance: 'fact'` with `summary` (or message fallback).
- **provenance** — `{workerProse}` counts timeline items carrying `worker_prose`.
- **cursors** — `watch.nextAfterCursor` / `watch.nextAttentionCursor` (0 when watch absent).
- **fingerprint** — sha256 hex (64) of the canonical model: key-sorted serialization
  (`canonicalStringify`, undefined folded to null) of the model **excluding the fingerprint
  field** — deterministic for identical inputs.

Provenance law P2 / control bytes: `stripControlBytes` removes ANSI CSI sequences
(`\u001b[...m`, full CSI class), stray ESC, and all remaining C0 controls except
tab/newline/CR; a recursive sanitize pass applies it to **every string in the model**, so the
projected JSON is control-byte-free regardless of the source seam. The strip happens at
projection time, before fingerprinting — the fingerprint covers the sanitized model.

Bounding: `MAX_FLEET_MEMBERS = 64`, `MAX_TIMELINE_ITEMS = 64` — 100 workstreams → 64 members,
100 events → latest 64 timeline items. No wall-clock dependence: `now`/`width`/`view` are
presentation/query params, deliberately not part of the model (P1), so identical
snapshot+watch inputs always produce identical fingerprints.

## Verification (the ONLY definition of done)

- Deployment verification command: executable `"true"`, argv `[]`, cwd `.`, expected exit 0 —
  executed, **exit 0**.
- Pin: `node --test test/visual-model.test.mjs` → **3 pass / 0 fail** (all three: composition,
  P2 prose/ANSI, bounded+deterministic).

## Sibling integration verdicts

Sibling rows (row-visual-renderer, row-visual-tui-mcp) land in parallel; their modules
(`visual-renderer.mjs`, `baton-top.mjs`, `production-mcp-convergence.mjs` changes) were NOT
present in this worktree at completion, so their pins cannot run here yet. Verified at the
contract surface instead:

- **row-visual-renderer** — its pin imports `projectBatonVisualModel` from
  `../src/visual-model.mjs` (exact export name, matches). Smoke-tested my module against the
  renderer's own fixture verbatim from master: `story.narrative` falls back to the run
  narrative ('Flip is quietly…' — the accessibleSummary pin), timeline carries
  `provenance: 'worker_prose'` + stripped summary 'The layout is ready.' (the ‹…› pin), and
  `run.runId`/`fleet`/`telemetry.routes`/`topology.edges`/`controls.approvals` are present.
  Integration expectation: renderer pin should go green as-is once the sibling lands.
- **row-visual-tui-mcp** — `runBatonTop` reads `model.run` (carries `runId`); the MCP meta
  tool's pin asserts `structuredContent.model.run.runId` — present. No import-name coupling to
  this module beyond `projectBatonVisualModel` via the renderer.

Re-check verdict once the sibling rows land; no contract change expected.

## Files changed (scope: impl/src/visual-model.mjs, impl/test/visual-model.test.mjs, wave-d)

- impl/src/visual-model.mjs — NEW: the `baton.visual_model` projection (module + exports).
- impl/test/visual-model.test.mjs — restored verbatim from master (the pinned spec; no edits).
- docs/reference/evidence/baton-builds-baton-2026-08-19/wave-d/notes-row-visual-model.md — this
  file.
