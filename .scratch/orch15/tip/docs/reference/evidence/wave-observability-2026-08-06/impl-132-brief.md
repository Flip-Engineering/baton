# #132 IMPL BRIEF — implement the wave-observability lane (the orchestrator's wave lane)

Implement the #132 epic: make `impl/test/wave-observability-red.test.mjs` green with ZERO
weakening edits. Read fully, in order: (1) `wave-observability-contract.md` (**v1.2** — the
folded contract); (2) `impl/test/wave-observability-red.test.mjs` (30 tests: 4 green PINs, 26
red at named stages — every row is your target; the header carries the invented-surface
signatures); (3) `contract-fold.md` + `suite-fold-2.md` (the folded oracles: B1 the TOP-LEVEL
`wave.closed` fold beside `context.pack_minted` — #103 has LANDED its D9 record, so the close
side reads live records now; B2 the legacy roster gate; B3 v1.0 local-only liveness; the §4
pinned-test drift A3 owns DELIBERATELY).

## The shape (from the contract)

- **D1 web admission of the four wave verbs** — `waves_start`/`waves_progress`/`waves_send`/
  `waves_stop` admitted on the web envelope (the `WEB_DIRECT_PORT_COMMANDS` skip of
  `validateApplicationCommandArgs`; capability mapping start=[control,observe] /
  progress=[observe] / send=[control,observe] / stop=[emergency_stop,observe]; the byte-stable
  `APPLICATION_COMMAND_DEFINITIONS` key set UNCHANGED — the A1-7 PIN and grammar-m3 stay green);
  the card lists the dot spellings (F1); `waves_stop` admits the port normalizer's field set
  (F2).
- **D2 the registry projection** — `wave.started` payload extended `{deploymentId,
  idempotencyKey, roster: [{role, route, scope}], waveId}`; the fold reads `wave.started` in the
  `driver.recorded` branch AND `wave.closed` at the TOP LEVEL (B1 — the #103 D9 record exists at
  HEAD now); the legacy roster-shape gate (string roster → raw row, route/scope null) with
  `wave_registry_invalid` reserved for malformed NEW-shape records (B2); exactly-once on
  re-start/attach/re-drive.
- **`waves.list`** — a new observe verb answering the in-flight set for THIS deployment:
  per-wave {waveId, members, routes, startedAtEventSeq, per-member phase, attention counts},
  `liveness: 'local'` (v1.0 local-only; remote/stale honestly deferred per B3).
- **D4 CLI parity** — `baton waves list` / `baton waves progress WAVE_ID` parse; singular
  refuses with the corrective; bare `waves attach` lists attachable waves.
- **D5 (#129)** — typed admission refusal (`wave_member_invalid` naming the cap + actual size)
  on facade + web + MCP identically; a run-less wave is NEVER a success shape.
- **The §4 drift** — the four pinned tool enumerations gain `baton_waves_list` DELIBERATELY
  (mcp-reflex-surface-red.test.mjs, phase16-mcp-northbound.test.mjs,
  phase67-progressive-agent-experience.test.mjs, phase72-kimi-orchestrator-mcp.test.mjs — the
  count + position; the landing commit message owns the drift; the workflow-surface FP-14 count
  moves 34→35 and the combined-surface counts move accordingly). If the suite's A3 rows already
  pin the new enumerations, the test-file edits are the drift — if they don't, flag it in the
  blocker note, do NOT edit the red suite's rows yourself.

## Laws + verify

Campaign law: no clocks as controls; scanners shape-only; `localeCompare` banned; sorted-key
literals ACTUAL order; NUL discipline (`grep -an`/`sed -n` on the two NUL files). **#141
boundary-commit law: commit at natural subsystem boundaries.** If a row is
unsatisfiable-as-written, write the contradiction to
`docs/reference/evidence/wave-observability-2026-08-06/impl-blocker.md` (IN your scope).
Verify from the repo root, ALL green, record the splits:
`node --test impl/test/wave-observability-red.test.mjs` (30/30) ·
`node --test impl/test/workflow-surface-red.test.mjs` ·
`node --test impl/test/mcp-reflex-surface-red.test.mjs` ·
`node impl/scripts/surface-conformance.mjs` (ok; regenerate the inventory artifact + docs blocks
via `node impl/scripts/render-surface-docs.mjs` and
`node impl/scripts/surface-conformance.mjs --write-inventory` if the new tool makes them stale —
those generated files are IN your scope).

## Scope

`impl/src/**` · `impl/scripts/surface-inventory-artifact.json` · `impl/CLI.md` · `impl/MCP.md` ·
the four pinned tool-enumeration test files (ONLY the deliberate baton_waves_list additions) ·
`docs/reference/evidence/wave-observability-2026-08-06/impl-blocker.md`. Do NOT edit any other
test file.
