# Baton visual surfaces

Baton's visual layer is an operator projection over existing Run, story, event, attention,
readiness, worker, route and convergence data. It does not own orchestration state.

## Terminal

```bash
baton top
baton top run:example
baton top run:example --view topology
baton top run:example --view timeline --no-motion
baton top --once --width 100
```

Interactive TTY keys: `1`–`4`, tab, `r`, `p`, `m`, `?`, `[`, `]`, `a`, `d`, `j`, `k`, `q`.

`a` and `d` are available only when the selected attention item carries an explicit Run and
request identity. They call the existing `run.answer` command. Session takeover is intentionally
not simulated through presentation code.

## MCP

Call `baton_surface_visualize` with a view (`overview`, `topology`, `timeline`, or `telemetry`).
Set `follow:true` with `runId` to compose the existing notification watch before rendering.

The response's `structuredContent.model` is authoritative. `presentation.text` and the optional
Flip animation frames are presentation hints. MCP text never contains ANSI escapes.

## Accessibility and automation

- non-TTY output is static;
- `NO_COLOR=1` or `--no-color` disables ANSI;
- `BATON_REDUCED_MOTION=1` or `--no-motion` disables motion;
- `--plain` emits one stable no-color frame;
- worker/provider prose is rendered inside `‹angle delimiters›`.
