# #132 CONTRACT BRIEF — wave observability + admission (the orchestrator's wave lane)

You are drafting the **implementation contract** for issue #132 (wave observability gap). Read
fully, in order: (1) the issue — `gh issue view 132` AND its first comment (the sharpened finding:
the wave verbs dispatch on the application bus at `application.mjs:12219-12222` but are NOT
web-admitted — their definitions lack `web: true`, so `COMMAND_CAPABILITY` never admits them and
`/v1/commands` returns `invalid_command / unsupported command`; verified live); (2) the web
admission machinery: `impl/src/web-northbound.mjs:15-31` (WEB_APPLICATION_ENTRIES /
CANONICAL_WEB_ENTRIES, the `definition.web` filter, the transport spelling `waves.start` →
`waves_start`), `:53-58` (COMMAND_CAPABILITY), the envelope validator at `:345-365`; (3) the wave
command implementations at `application.mjs:12219-12222` (grep -an — NUL file) and their
definitions in the same file; (4) the resident/host layer `impl/src/application-deployment.mjs:1456+`
(`host()`, the ordinary owner-local host) and `impl/src/resident-authority.mjs:248-300`
(publication); (5) the CLI grammar gap: `impl/src/application-cli.mjs:1315-1342` (only
`waves attach` parses); (6) the MCP reflex table for contrast `impl/src/mcp-northbound.mjs:44-100`.

## The contract must decide (ground truths → decisions → refusal vocabulary → acceptance pins → open questions)

- **D: web admission of the wave lane.** `waves.start` / `waves.progress` / `waves.send` /
  `waves.stop` gain `web: true` — OR an explicit reason a verb stays MCP-only (e.g. does
  `waves.start` need a capability beyond `control`? the session the resident issues already
  carries `control`). Pin the capability mapping per verb (mirror the MCP REFLEX table:
  start=[control,observe], progress=[observe], send=[control,observe], stop=[emergency_stop,observe])
  and the `stateFailureCode` allowlist consequences (which wave refusal codes must survive the
  MCP/web surfaces — coordinate with #114's B3 five `workflow_*` codes; do not collide).
- **D: `waves list`.** A new observe verb answering the in-flight wave set for THIS deployment —
  per-wave: waveId, member roles, routes, startedAtEventSeq, per-member phase, attention counts.
  Source: a **wave registry projection** in the coordination store — `wave.started` /
  `wave.closed` durable events (closed canonical-JSON, replay-derived, exactly-once, non-gating,
  no clocks — the SAME discipline as #103's D9 `wave.closed`; coordinate: does #132 own
  `wave.started` while #103 owns `wave.closed`, or does one issue own both? SAY SO).
- **D: cross-deployment read.** The registry row carries `deploymentId`; a resident asked about a
  wave owned by another (live) process answers with `liveness: local | remote | stale` — remote
  liveness bounded by the writer lease incarnation (owner-readable lease file), never guessed.
  Git-ref artifacts are content-addressed and shared; liveness is NOT. Pin the honesty rule.
- **D: CLI parity.** `baton waves list` + `baton waves progress WAVE_ID` parse on the CLI (the
  plural family; singular refuses with the corrective, per the established pattern at
  `application-cli.mjs:1309-1314`). `waves attach` with no WAVE_ID lists attachable waves from the
  registry instead of refusing bare.
- **D: interaction with #129 (silent oversize).** `waves.start` admission failures surface typed
  on every admitted surface (a run-less wave is never a success shape) — name the code.
- **Refusal vocabulary.** Every new/changed refusal: typed, named, surface-constant.
- **Acceptance pins.** Red-first rows per decision: web admission round-trip per verb (envelope
  validator + capability), registry projection build (started/closed, exactly-once, replay),
  `waves list` shape, cross-deployment liveness honesty (a fake remote deploymentId reads
  `remote`/`stale`, never `local`), CLI parse rows, the #129 typed refusal through web+MCP+CLI.

## Laws

No clocks; controls eval-able/constructive/conversational, never turn-limits; scanners shape-only;
sorted-key literals in ACTUAL sorted order; `localeCompare` banned. Every `file:line` citation
verified with `grep -an`/`sed -n` (NUL files: `application.mjs` + `coordination-store.mjs` only).
Header: v1.0 DRAFT with the verification HEAD. Cross-reference (do not re-spec): #103 D9, #114
B3, #129, #91, #10.

## Deliverables

`docs/reference/evidence/wave-observability-2026-08-06/wave-observability-contract.md` ONLY.
