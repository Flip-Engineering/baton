# ROW-DOCS — honesty-package docs-seam impl notes (#159, doc-truth conformance)

[attempt: c8a3f4fc-fe15-4311-953e-5fc21b03ec44 row-docs]

Row: `row-docs` — the docs seam of the honesty-package wave.
ObjectiveRef: `docs/reference/evidence/honesty-package-2026-08-14/impl-honesty-brief.md`.
Acceptance machinery: `impl/test/doc-truth-conformance-red.test.mjs`.

## Ownership executed (exactly the brief's seam)

- `impl/scripts/surface-conformance.mjs` — the conformance checker (edited).
- `impl/scripts/surface-divergence-ledger.json` — the divergence ledger (populated).
- `impl/scripts/surface-inventory-artifact.json` — the checked inventory artifact (regenerated via
  `--write-inventory`, never hand-edited).
- `impl/CLI.md` — regenerated prose + generated region (via `render-surface-docs.mjs`, never hand
  edited the generated region).
- `impl/MCP.md` — regenerated prose + generated region (via `render-surface-docs.mjs`).
- `impl/src/**` untouched; no suite touched; `impl/test/**` untouched.

## Acceptance verification (final, in this worktree)

| Command | Result |
|---|---|
| `node --test impl/test/doc-truth-conformance-red.test.mjs` | **7 pass / 6 fail** — all 7 of this row's capability rows green; the 6 failures are the src-owned rows (below), red-by-design until the src rows land |
| `node impl/scripts/surface-conformance.mjs` | **ok** (exit 0) — P-CS1-b green |
| `node impl/scripts/render-surface-docs.mjs --check` | **exit 0** — generated docs are byte-synced to the generators |
| `node --test impl/test/control-surface-truth-red.test.mjs` | **7/7** (adjacent, green-unchanged) |

### doc-truth-conformance per-row split

Green (this row's stage — all 7):
- **R2 (web-bus-inventory-undercount)** — `web.bus` inventory equals the 31-name card AND derives
  from the D1 admission accessor. `webBusNames()` (surface-conformance.mjs:399-408) returns the
  `webNorthbound.webBusAdmittedCommandNames()` compile-set when present, else the interim
  derivation (web-admitted `APPLICATION_COMMAND_DEFINITIONS` names ∪ the six wave direct ports)
  that matches `WEB_BUS_DOT_NAMES_31` exactly: 31 dot names.
- **R6 (cli-run-steer-prose-live)** — CLI.md teaches no `run steer` command (any spelling).
  Replaced the stale `steer` "remains an advanced compatibility surface" claim at CLI.md:191-193
  with the sunset statement (canonical `run send` + `run interrupt`; `steer` refuses with
  corrective naming).
- **R7 (facade-ports-unledgered)** — every `CLI_WEB_COMMANDS` name is web-admitted or ledgered, and
  every ledger row is full shape. See "The R7 ledger design" below.
- **R10 (mcp-wave-examples-omit-repoId)** — MCP.md Orchestrate-a-wave examples are fenced
  ` ```json ` blocks, `repoId` first, tool-specific fields, and pass the real wave tool schemas
  (verified against `baton_waves_start/progress/list/run/send/stop` and `baton_decision_answer`).
- **R11 (artifact-counts-stale)** — `counts.webBusCommands = 31`, `counts.parserLifecycleActions = 29`
  (the parser's real lifecycle dispatch count in this tree), and the artifact regenerates
  byte-stably (P-CS4 green).
- **P-CS1-b (conformance main)** — `node impl/scripts/surface-conformance.mjs` prints
  `surface-conformance: ok`, exits 0.
- **P-CS4 (checked inventory artifact)** — committed artifact regenerates deterministically and
  checks clean.

Red-by-design (src-owned — the D1/D3 src rows land them; NOT this row's stage):
- R1 (run-watch-documented-but-unparsed), R3 (answer-schema-advertises-decision), R4
  (run-watch-silent-reinterpretation), R5 (cli-example-shape-leg-red), R8
  (initialize-context-briefing-unmet), R9 (fleet-run-answer-accepts-decision).

## The R7 ledger design

R7 (doc-truth-conformance-red.test.mjs:433-471) forces every `CLI_WEB_COMMANDS` name that is not
web-admitted (absent from the pinned `WEB_BUS_DOT_NAMES_31` card, after
`applicationOperationAliasMap()` resolution) to be ledgered with full shape — surface/name/
dimension/retiresIn/canonical plus a non-empty divergence text. The contract-fold's D3 #3
(doc-truth-conformance-2026-08-13/contract-fold.md:265-273) names exactly this: the eight facade
ports get "a ledgered row in `surface-divergence-ledger.json`", and "the ledger is the
documentation of the web refusal".

Two mechanical tensions were resolved to land R7 green:

1. **Dot-name ledger keys + observability.** R7's forward check resolves each ledger name through
   `applicationOperationAliasMap()`, which has no entries for the facade ports — so ledger rows
   MUST be spelled in dot form (e.g. `run.message.send`). But `validateLedger`'s dead-row check
   flags any ledger key whose `surface\0name\0dimension` is not OBSERVED in the raw inventory —
   and the facade ports are not observed under ANY surface in the raw inventory. Resolution:
   `inventoryObservations()` now adds `cli` observations for `cliWebRefusedVerbs()` (surface-
   conformance.mjs:120) — the exact `CLI_WEB_COMMANDS` names the web bus refuses — so the ledger
   rows become observed and live. This is D3 #3's own design: the whitelist is the honest witness
   of the divergence.
2. **Stale-row guard.** R7's reverse direction asserts no ledger row for a web-admitted name; the
   9 rows all name web-refused names, so no stale rows.

## The `waves.compile` disposition

`CLI_WEB_COMMANDS` includes `waves.compile` (added by the #170 impl, commit d38671a) but the pinned
31-name card excludes it. R7's forward check therefore forces `waves.compile` to be ledgered too,
alongside the eight facade ports. The ledger entry (entry #9) carries a `note:` recording the
card-vs-admission drift: `waves.compile` IS web-admitted in the current tree (`WAVE_WEB_ENTRIES`)
but is absent from the contract-fold v1.1 `D2/G3` pinned card — ledgered pending wave
reconciliation of the card-vs-admission drift. `webBusNames()` deliberately returns exactly the 31
card names (R2 stays green) while the ledger holds the 9 non-card whitelist verbs (R7 stays green).
No stale ledger row results: `waves.compile` is not in the card, so R7's reverse direction passes.

## Adjacent verification (all green-unchanged, byte-identical counts to the brief)

| Adjacent suite | Brief's bar | Verified |
|---|---|---|
| workflow-dsl-red | 35/35 | 35 pass / 0 fail |
| workflow-dsl-package-red | 12/12 | 12 pass / 0 fail |
| workflow-as-data-red | 30/30 | 30 pass / 0 fail |
| wave-observability-red | 30/30 | 30 pass / 0 fail |
| control-surface-truth-red | 7/7 | 7 pass / 0 fail |
| mcp-profile-parity-red | 8 pass / 13 red-by-design | 8 pass / 13 fail |
| blind-waits-red | 23/11 by design | 23 pass / 11 fail |
| orchestrator-plan-object-red | 5/42 by design | 5 pass / 42 fail |

The other three honesty-package suites in this worktree fail only their src-owned / designated-red
rows: cli-wave-fidelity-red 8/16 (A7-1..A7-8 — waves.send/stop src rows; A7-5 is explicitly
"(RED — ghost rows absent at HEAD; N7 sequencing)" in the suite), scratchpad-write-red 5/18 (all
src-owned write-lane rows), error-actionability-red 6/16 (W/M/C rows are src error-body rows; C3/S2
are in the suite's own designated red list and were red at HEAD because the ledger was empty — this
row's 9 name-dimension entries do not touch the `cli_*` code-dimension rows they check).

## DECISION_REQUEST: grammar-m5 M5-1 vs. the #159 ledger mandate

One adjacent-adjacent break is a genuine contract collision that needs a wave decision. This row
cannot resolve it within its seam without editing a suite (forbidden).

**The conflict.** `impl/test/grammar-m5-red.test.mjs` M5-1 pins `ledger.entries === []` ("the
divergence ledger retires to empty at M5", grammar-m5-red.test.mjs:49-60). The ledger was empty at
HEAD. But #159's contract-fold D3 #3 MANDATES ledgering the eight facade ports (and R7 — this
suite's row — forces `waves.compile` as well), so the ledger now holds 9 entries. R7 green
requires the entries; M5-1 green requires none. The two are mutually exclusive, and both are
achievable only from outside this row's seam (web-admitting the facade ports needs a src + pinned-
card change; re-pinning M5-1 needs a suite edit).

**Why this is expected, not a regression.** grammar-m5-red is NOT in the brief's adjacents list
(impl-honesty-brief.md:42-46), so its green count is not a gated green-unchanged surface. The
M5-1 pin was written for the M5 milestone, which predates #159's D3 #3. The pin's intent — no
stale/dead divergence at M5 — is not violated: the 9 rows are LIVE, contracted divergences (facade
ports web-refused until #87 lands; waves.compile card-vs-admission drift), not retired cruft.
M5-2..M5-5 all still pass; only the empty-ledger assertion is stale.

DECISION_REQUEST: {"question":"grammar-m5 M5-1 pins the divergence ledger EMPTY, but #159 contract-fold D3 #3 (implemented by doc-truth R7) mandates 9 live facade/card-drift ledger rows — the two are mutually exclusive and I cannot edit the suite. Which disposition?","options":[{"id":"opt-update-m5-1","label":"Update M5-1 to expect the 9 post-#159 ledger rows (suite edit by wave coordinator/suite owner; pin's no-stale-divergence intent preserved)"},{"id":"opt-accept-collateral","label":"Accept the M5-1 break as documented collateral (grammar-m5 is outside the brief's adjacents list; fold into the wave's documented red-by-design set)"},{"id":"opt-reconsider-ledger","label":"Reconsider R7: web-admit the facade ports instead of ledgering (src + pinned-card change, contradicts D3 #3's explicit ledger mandate)"}],"allowFreeResponse":true,"deadlineMs":3600000}

**Recommendation: `opt-update-m5-1`.** D3 #3 is the newer contract authority and names the ledger as
the documentation mechanism; the M5-1 empty-ledger assumption is superseded. The pin should assert
the 9-row post-#159 ledger (and the M5 retirement of the old per-deployment MCP mutation row), not
emptiness.

## Per-issue mechanism summary (docs seam's contribution to #159)

- **R2/D2** — `webBusNames()` is now sourced from the D1 `webBusAdmittedCommandNames()` accessor at
  landing, with a fallback that is byte-identical to the pinned card today. The doc side and the
  admission side derive from the same tables.
- **R6/D3 #2** — CLI.md stop teaching `run steer` as live; the `steer` verb is recorded as sunset
  at the M5 alias migration (canonical `run send` + `run interrupt`).
- **R7/D3 #3** — the divergence ledger is the documentation of web refusal; 8 facade ports (contracted
  via #87+#48) + `waves.compile` (card-vs-admission drift) are ledgered, each full-shape and
  observed (via `cliWebRefusedVerbs()` CLI observations) so the dead-row check stays honest.
- **R10/D3 #6** — MCP.md Orchestrate-a-wave examples are real, fenced, schema-admitted JSON with
  `repoId` first.
- **R11/B7** — `parserLifecycleActions` derives from the parser's lifecycle DISPATCH set (29 in this
  tree), not a hand-maintained probe; `webBusCommands` derives from the D1 accessor.
- **B7 replacement** — `parserLifecycleDispatchCount()` (surface-conformance.mjs:634-657) uses
  `cliParsedCommandNames()` when the D1 CLI leg exports it, else replicates the extraction the
  acceptance suite's own R11 leg performs.
- **D1 disjoint guard** — `runSurfaceConformanceMain()` now reports a `web-name collision` finding if
  any web-bus name is also a kernel/authoring literal (surface-conformance.mjs:804).

## Craft-law compliance

- No clocks; no `localeCompare`; sorted-key literals in codepoint order; no byte literals added
  outside `limits.mjs`; NUL-bearing files (`application.mjs`, `coordination-store.mjs`) untouched.
- Generated docs (`CLI.md` generated region, `MCP.md` generated region,
  `surface-inventory-artifact.json`) were regenerated via the shipped generators, never hand-edited.
- Work confined to this worktree. No suite edited (`impl/test/**` untouched). `impl/src/**` untouched.
