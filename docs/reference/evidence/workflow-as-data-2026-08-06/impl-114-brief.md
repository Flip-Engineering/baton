# #114 IMPL BRIEF — implement the workflow-as-data lane (the driver-killer)

Implement the #114 epic: make `impl/test/workflow-as-data-red.test.mjs` green with ZERO weakening
edits. Read fully, in order: (1) `workflow-as-data-contract.md` (**v1.2** — the folded contract:
the closed spec schema D1, the interpreter lane D2, steering policies D3 with the folded bounds,
harvest D4 rebuilt on the authoritative-sha accessor with waveId + attempt-marker binding,
objectives-by-reference D5, the receipt D6); (2) `impl/test/workflow-as-data-red.test.mjs` (29
tests: 4 green guards, 25 red at named stages — every row is your target; the header carries the
invented-surface signatures); (3) `suite-fold-2.md` + `suite-draft-notes.md` (the folded oracles:
the throwing MessageDeafAdapter, the walkImportGraph transitive import-law, the LANE_DRIVER
fast-poll config threaded via `driveLane`, the exact seven-key receipt).

## The shape (from the contract)

- The invented surface is `baton.recipes.runWorkflow(spec | specPath)` (namespace-imported by the
  suite — a missing export must not kill the file at load; your job is to MAKE it exist).
- JSON.parse-only loading → recursive closed validation (every nesting level — B6) → deepFreeze →
  run. `schemaVersion` enum. Member scope rejects `..`/absolute/backslash/NUL at ADMISSION
  (wave.mjs's member laws PLUS path-scope's class, the v1.2 union). Steering enums closed against
  the producer vocabularies.
- Steering bounds (D3): messageOnSpawn ≤3 keyed to a delivered messageId (DELIVERED only on
  `delivered > 0 && typeof messageId === 'string'`, v1.2) then a named
  `steering_message_undelivered` evidence line; elevateWhenNotes exactly once per member per wave
  keyed durably `(runId, role)`; answerDecisions exact/anchored match, first-match-wins, optionId
  validated against the live decision's options, dedup `(runId, requestId)`, non-match defers.
- Harvest (D4): per-path recovery from the run's authoritative result sha (#99 accessor where it
  exists — the suite's facade staging defines the seam), waveId-bound, attempt-marker verified; a
  missing/mismatched path receipts a NAMED `harvest_miss`; `mustContain` is a post-materialization
  integrity check only; every harvest path containment-checked.
- The lane's driver policy MUST be configurable (the suite threads `LANE_DRIVER =
  { pollIntervalMs: 15, stallTimeoutMs: 400, hardCapMs: 3000 }` via `driveLane` — your lane must
  accept it; a hardcoded 20s default fails the rows).
- W5: importing your lane module starts nothing — no top-level `await openBaton(` /
  `waves.start(` anywhere in its transitive static import graph.
- W6: refusal constancy — the five `workflow_*` codes ride the MCP `stateFailureCode` allowlist
  (quoted literals OR a prefix branch per the fold); identical `{code,message}` payloads on
  facade throw / CLI `body.error` / MCP `structuredContent.error`. The verb is `waves run` /
  `baton_waves_run` (plural family).

## Laws + verify

Campaign law: controls eval-able/constructive/conversational, NEVER clocks or turn-limits;
scanners shape-only; `localeCompare` banned; sorted-key literals in ACTUAL sorted order; NUL
discipline (`grep -an`/`sed -n` on `application.mjs` + `coordination-store.mjs` only).
Verify from the repo root, ALL green, record the splits in your completion summary:
`node --test impl/test/workflow-as-data-red.test.mjs` (29/29) ·
`node --test impl/test/workflow-surface-red.test.mjs` ·
`node --test impl/test/wave-driver-red.test.mjs` ·
`node --test impl/test/mcp-reflex-surface-red.test.mjs`.

## Scope

Edit `impl/src/**` (new lane module(s) + the recipes container + the MCP allowlist + the CLI/MCP
verb registrations per the contract). Do NOT edit any test file. If a row appears
unsatisfiable-as-written, STOP and write the specific contradiction to
`docs/reference/evidence/workflow-as-data-2026-08-06/impl-blocker.md` instead of weakening anything.
