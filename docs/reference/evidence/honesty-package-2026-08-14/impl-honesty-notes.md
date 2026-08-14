[attempt: c8a3f4fc-fe15-4311-953e-5fc21b03ec44 row-cli]

# impl-honesty notes — honesty package ② (#157 + #158 + #159 + #160, one landing)

Wave-level running notes. Each row appends its seam's status under its own `[attempt:]` header.
Harvest gate: this file must reference **#157** (row-cli's issue).

## Row-cli status (2026-08-13, committed `e218238`)

**Seam:** CLI wave fidelity (#157) + the CLI-admission half of #158. Owned files:
`impl/src/application-cli.mjs`, `impl/src/application.mjs`, `impl/CLI.md` (regenerated),
`impl/scripts/surface-inventory-artifact.json` (regenerated). Detailed decisions, evidence, and
the A10-1 DECISION_REQUEST live in `notes-row-cli.md` (same dir).

**Landed:**
- `waves.send` / `waves.stop` served — `CLI_WEB_COMMANDS` admission + `parseBatonCli` branches
  (id-validated runId, at-most-one delivery, `--claim-grant` JSON, CLI-required `--reason`);
  closed-set refusal text updated.
- `waves.compile` bare minimal invocation admitted (D3.3/N6 closed-set pin); app seam refuses a
  missing spec.
- `run.scratchpad.append` — `CLI_WEB_COMMANDS` admission + parser branch with the closed per-kind
  body (`scratchpadAppendBody`: note/plan/doubt/link) + D4 teaching (`read|elevate|append`).
- D2 hydration — `waveList` string-member branch inspects steering-registered runs for
  phase/progressClass/attentionCount and refuses typed `wave_not_found` for a vanished registered
  run (D5.2); no-run render pinned. NUL bytes intact (3, matching HEAD).
- Generated surfaces regenerated via shipped generators: CLI.md (+waves.send/waves.stop rows),
  surface-inventory-artifact.json (`cliWebCommands` 37 → 40).

**Green (my acceptance):**
- `cli-wave-fidelity-red` **16/16**.
- `scratchpad-write-red` CLI rows: **A1-1, A1-2, A9-1, A9-2, P-A1** green; A10-1 leg (a) green,
  leg (b) **DECISION_REQUEST** — the suite's `/run\\.scratchpad\\.append/u` (double-backslash)
  regex cannot match a correct `CLI_WEB_COMMANDS` admission (plain dots); P-A1's single-backslash
  style for read/elevate proves the typo. Suite not edited (craft law). Options in notes-row-cli.md.

**Adjacents verified undisturbed:** workflow-dsl 35/35 · workflow-dsl-package 12/12 ·
workflow-as-data 30/30 · wave-observability 30/30 · control-surface-truth 7/7 ·
mcp-profile-parity 8/13 (designed) · blind-waits 23/11 (designed) · orchestrator-plan-object 5/42
(designed) · doc-truth + error-actionability 8/27 byte-identical to HEAD baseline · deployment
verification exit 0.

## Cross-seam coordination intelligence (for the other rows)

Mapped during the continue-verification pass — all touch `application-cli.mjs` (row-cli's file)
but belong to `row-sf159` / `row-sf160`:

- **`run.watch` (doc-truth R1/R4 — row-sf159):** `run watch RUN_ID` throws today; bare `run watch`
  silently reinterprets to run.start. Fix = recognize `watch`, serve `run.watch`, bare refuses
  value-required. ⚠️ Inflates cli-silent-start (#155) detection set 39→40, breaking green PT-7 —
  coordinate.
- **Unknown-`run`-verb refusal (error-actionability C2 — row-sf160):** `run shwo` → run.start
  today (F8). Naive refuse-all breaks #155 green PT-3 (never-a-guess). Correct rule = Damerau-1
  against the recognized set (shared surface with #155 PT-2a).
- **Divergence ledger (R7 + C3/S2):** `surface-divergence-ledger.json` is empty; needs full-shape
  entries + the 20 CLI-local tooling codes. File is `impl/scripts/` (not row-cli's).

## Remaining (other rows)

- scratchpad-write red rows (A2-1..A8-1, A10-1 legs c/d/e) — kernel/web/MCP/registry/deployment
  seams.
- doc-truth R1-R11 + error-actionability C/W/M/S rows — row-sf159 / row-sf160 seams.
