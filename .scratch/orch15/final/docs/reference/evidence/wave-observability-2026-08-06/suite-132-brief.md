# #132 SUITE BRIEF — red-first suite for the folded wave-observability contract v1.1

You are drafting the **red-first acceptance suite** for the folded wave-observability contract.
Read fully, in order: (1) `wave-observability-contract.md` (**v1.1** — source of truth);
(2) `contract-fold.md` (what v1.1 changed — B1 top-level `wave.closed` fold, B2 legacy gate,
B3 local-only scope, F1-F8, the §4 pinned-test drift A3 owns); (3) `contract-redteam.md` (the
attack surface the suite must hold); (4) suite idioms: `impl/test/workflow-surface-red.test.mjs`
(facade staging), `impl/test/mcp-reflex-surface-red.test.mjs` (MCP surface pins — its tool-list
enumeration is one of the four your A3-equivalent rows must update DELIBERATELY, not
incidentally).

## Coverage (derive the row inventory from the v1.1 acceptance pins)

- **Web admission (D1)** — each of the four wave verbs round-trips the web envelope
  (`waves_start`/`waves_progress`/`waves_send`/`waves_stop` admitted; capability mapping per
  verb; `WEB_DIRECT_PORT_COMMANDS` skip of `validateApplicationCommandArgs`; the byte-stable
  `APPLICATION_COMMAND_DEFINITIONS` key set UNCHANGED — the grammar-m3 guard stays green);
  the card lists the dot spellings (F1).
- **Registry (D2)** — `waves.list` from the projection; `wave.started` extended payload;
  `wave.closed` folded TOP-LEVEL (B1); legacy roster-shape replay passes through the legacy gate
  while a malformed NEW-shape record refuses `wave_registry_invalid` (B2); exactly-once on
  re-start/attach/re-drive.
- **Liveness (D3)** — v1.0 local-only: `liveness: 'local'` rows; `remote`/`stale` are absent or
  explicitly marked deferred per the folded contract (never fabricated).
- **CLI parity (D4)** — `baton waves list` / `baton waves progress WAVE_ID` parse; singular
  refuses with the corrective; bare `waves attach` lists attachable waves.
- **#129 (D5)** — typed admission refusal (`wave_member_invalid` naming cap + size) on facade,
  web, and MCP identically (the pinned {code,message} payload discipline).
- **Refusal vocabulary** — every code the contract names, on every admitted surface, incl.
  `wave_not_found` allowlisted (F8).

## Suite law

Red-first (every capability row fails at a NAMED stage at HEAD — the lane is unimplemented);
namespace imports for invented surfaces; hermetic (mock adapters, mkdtemp, test.after, no
network); run from the repo root TWICE, record the stable split; header carries the row
inventory + stages + invented-surface signatures + verified split; sorted-key literals in ACTUAL
sorted order; `localeCompare` banned; no clocks; NUL discipline (`grep -an`/`sed -n` on the two
NUL files). The §4 drift is OWNED: the four pinned tool enumerations
(`mcp-reflex-surface-red.test.mjs:201-212`, `phase16-mcp-northbound.test.mjs:92-105`,
`phase67-progressive-agent-experience.test.mjs:648-656`,
`phase72-kimi-orchestrator-mcp.test.mjs:298-306`) get deliberate +1 rows for `baton_waves_list`
— those four edits are part of this suite's landing, flagged in the notes.

## Deliverables (edit ONLY these)

`impl/test/wave-observability-red.test.mjs` ·
`docs/reference/evidence/wave-observability-2026-08-06/suite-draft-notes.md` (split + row map +
invented surfaces + the four pinned-enumeration edits flagged).
