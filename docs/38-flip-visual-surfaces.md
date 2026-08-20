# 38 — Flip-driven operator visualization surfaces

## Decision

Baton owns a **small, purposeful operator-presentation layer**, not a dashboard product. The layer
projects the system's existing Run, story, event, attention, readiness, route, worker, and
convergence authorities into two progressive surfaces:

1. `baton top`, a responsive terminal operator seat; and
2. `baton_surface_visualize`, a bounded MCP presentation tool carrying the same structured visual
   model plus a static text rendering and optional client-side motion hints.

No renderer becomes an authority. It may not invent worker state, collapse trusted facts and
worker prose, move cursors, answer an interaction silently, create a second event bus, or derive
fate from elapsed wall time. Every control gesture lowers through an existing Baton command.

## Audit of the existing and planned visual corpus

| Source | Existing idea or implementation | Decision in this vertical |
|---|---|---|
| `story.mjs` and docs 05/21 | Deterministic story compiler and derived signals | Preserve as the primary narrative source whenever available; fall back only to a clearly labeled deterministic visual projection. |
| docs 05/07 | `baton top` fleet view, provenance-typed digests, approve/deny, takeover | Ship the fleet view, responsive interaction, explicit fact/prose provenance, and allow/deny over existing `run.answer`. Keep takeover unavailable until a dedicated session-takeover authority exists. |
| docs 21 | Live fleet graph with provenance | Ship a bounded ownership/topology graph derived from Run/member/route/scope/attention projections. It is not a new graph store. |
| docs 05/21 | Human-readable telemetry and story monitor | Ship a pulse view over existing route readiness, scheduler lanes, member state, budget, and attention. External OpenTelemetry products remain external. |
| `web-operator.mjs` | Rich browser Run desk with progression, activity, workstreams, evidence, attention, and narrative | Do not duplicate or redesign it here. Share semantics and visual vocabulary; leave browser interaction to the existing Run desk. |
| `brand.mjs` and canonical SVGs | Flip smile/thinking poses in CLI/MCP | Preserve the two canonical poses. Add only subtle sparkle/thought-bubble animation frames; do not create a second mascot identity or edit the canonical SVGs. |
| convergence snapshot/watch | Unified control, telemetry, notification, Run, and Wave reads | Use these as the only remote data seams for the TUI and MCP visualization. |
| MCP initialization | Flip identity in server instructions | Extend the instructions with the visualization tool while retaining structured content as the authority. |
| planned semantic diff / structured postmortem | Visual review/debugging artifacts | Surface their summaries when they already appear in Run evidence; a dedicated semantic-diff viewer remains a separate representation-plane vertical. |

## Presentation laws

### P1. Structure first, presentation second

The shared `baton.visual_model` is a bounded, deterministic projection. Terminal boxes, animation,
color, and MCP text are renderings of that model. A renderer never parses its own text to recover
state.

### P2. Facts and prose never look identical

Hub facts are displayed directly. Worker/provider prose is marked `worker_prose` in the model and
rendered inside `‹angle delimiters›`. ANSI/control bytes are stripped before projection. This
implements the existing provenance rule rather than introducing a cosmetic trust badge.

### P3. Progressive enhancement

- non-TTY output: one stable frame, no ANSI, no animation;
- `NO_COLOR`, `TERM=dumb`, or `--no-color`: no color;
- `BATON_REDUCED_MOTION=1`, `--no-motion`, or `--plain`: no motion;
- narrow terminals: stacked compact panels;
- wide terminals: balanced two-column panels;
- MCP: static text is always present; motion frames are optional hints, never required to
  understand state.

### P4. Flip is punctuation, not noise

Flip appears in the header and lifecycle feedback. Motion is limited to four low-amplitude
sparkle/thought-bubble frames. The mascot does not occupy data rows, interrupt every event, or
replace severity/status glyphs.

### P5. Interaction lowers through existing authority

The TUI's allow/deny gestures call `run.answer` with the selected Run/request identity. The TUI
cannot approve an item that lacks an explicit answerable request identity. Takeover remains
reported unavailable because no current application/MCP contract safely grants session-TUI
handoff authority.

## `baton top`

```text
baton top [RUN_ID] [--wave-id WAVE]
          [--view overview|topology|timeline|telemetry]
          [--refresh MS] [--width N] [--once]
          [--plain] [--no-motion] [--no-color]
```

Interactive keys:

```text
1–4  switch views       tab  cycle view       r  refresh
p    pause reads         m    toggle motion    ?  help
[ ]  select attention   a/d  allow/deny       j/k scroll
q    quit
```

The four views are:

- **Overview:** existing story/Run narrative, Run spine, fleet roster, attention, and pulse.
- **Fleet graph:** deployment → Run → member → route/scope plus attention edges.
- **Timeline:** bounded event tail with explicit fact/prose provenance.
- **Telemetry:** route readiness, scheduler lanes, worker counts, budget pressure, and transport
  degradation.

`baton top` is explicitly human output. Ordinary Baton commands retain machine-clean JSON on
stdout.

## MCP visualization

`baton_surface_visualize` is a read-only meta tool:

```jsonc
{
  "view": "overview",
  "runId": "run:…",          // optional unless follow=true
  "waveId": "wave:…",        // optional
  "width": 96,                // 40..180
  "follow": true,
  "afterCursor": 0,
  "attentionCursor": 0,
  "kind": "approval",        // optional attention filter
  "timeoutMs": 1000
}
```

It composes the already-authorized `baton_surface_snapshot` and, when requested,
`baton_surface_watch`. The result contains:

- `model`: the canonical bounded visual model;
- `presentation.text`: a static Unicode rendering;
- `presentation.accessibleSummary`;
- optional four-frame Flip motion metadata;
- exact refresh arguments with the next existing cursors; and
- action suggestions that lower through `baton_surface_invoke`/`run.answer` rather than bypassing
  authority.

## Explicit non-goals

- No new event store, topology store, story generator, scheduler, attention queue, or Web command.
- No full-screen browser replacement for the existing Run desk.
- No bundled telemetry warehouse or dashboard empire; standard telemetry export remains the
  integration path.
- No provider-session takeover until the application publishes a dedicated authenticated,
  fenced, lifecycle-owned takeover contract.
- No ANSI in MCP text and no required animation in any accessibility mode.

## Acceptance contracts

1. The visual model is deterministic, bounded, control-byte-free, and preserves fact/prose
   provenance.
2. Rendered lines fit widths from 40 through 240 columns.
3. Overview, topology, timeline, and telemetry are semantically distinct views over one model.
4. MCP returns structured content and static accessible text; optional animation is additive.
5. `baton top` degrades to one stable frame outside a TTY.
6. TUI allow/deny uses only `run.answer` and refuses non-answerable attention.
7. MCP visualization is advertised without dropping any existing tool and composes the existing
   snapshot/watch authority.
8. Package imports remain inert; visualization adds no module-load monkey patch.
