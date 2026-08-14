# ROW-DOCS2 — the doc-truth remainder: artifact counts + served-set honesty (impl notes)

[attempt: 534910b2-4212-4114-8f85-71ca5797a2dc row-docs2]

Row: `row-docs2` — the doc-truth remainder (`impl/test/doc-truth-conformance-red.test.mjs` R11
plus R5's docs/artifact side).
ObjectiveRef: `docs/reference/evidence/honesty-package-2026-08-14/row-docs2-brief.md`.
File partition (binding): `impl/scripts/surface-inventory-artifact.json` +
`impl/scripts/surface-divergence-ledger.json` + `docs/reference/evidence/honesty-package-2026-08-14/**`.
`impl/MCP.md` → row-web2; `impl/CLI.md` → row-cli2; never cross.

## STATUS: BLOCKED on the code rows (row-cli2 / row-web2) — no fabricated counts

**Await-inputs discipline executed.** This row's R11 re-pin depends on row-cli2 (the CLI parser
dispatch gate — `application-cli.mjs`) and row-web2 (the web admission accessor —
`web-northbound.mjs`), per the brief. I polled for `notes-row-cli2.md` and `notes-row-web2.md`
in this directory at ~30s cadence (foreground batches + a background watcher) from dispatch
(~08:12) through the watcher's 30-minute deadline (~08:45). **Neither notes file appeared.** No
new commits and no working-tree changes from the concurrent rows arrived in this worktree over
that window. Per the brief — "if a row stalls, record it and DECISION_REQUEST rather than faking
the counts" — I did **not** hand-edit the artifact's counts. The committed artifact remains
byte-identical to the builder's output in this tree.

A second background watcher (60-minute window, started ~08:52) remains alive: if the code rows
land late, I will regenerate the artifact, verify the suite, and append the completion record to
this file (superseding the blocked status below).

## What is verified green in this tree (my partition + the doc-side legs already landed)

| Check | Result |
|---|---|
| `node impl/scripts/surface-conformance.mjs` | `surface-conformance: ok` (exit 0) — P-CS1-b green |
| P-CS4 (artifact regenerates deterministically + checks clean) | green — `buildSurfaceInventoryArtifact()` is byte-identical to the committed artifact |
| R2 (web.bus inventory = 31-name card, D1 accessor source) | green |
| R6 (CLI.md teaches no live `run steer`) | green |
| R7 (every whitelisted CLI name web-admitted or ledgered; ledger rows full shape) | green — the 9 ledger rows (8 facade ports + `waves.compile`) are valid, live, observed |
| R10 (MCP.md wave examples fenced json, repoId-first, schema-admitted) | green |
| `impl/test/control-surface-truth-red.test.mjs` (adjacent) | 7/7 green-unchanged |

`cli.ordinary` profile in the committed artifact (38 rows) exactly matches
`servedCliOrdinaryKeys()` (38) — the served set is honest and the profile is in sync.

## The block, precisely

R11 leg 2 (`parserLifecycleDispatchCount()` in the acceptance suite,
`doc-truth-conformance-red.test.mjs:184-202`) requires the parser to expose the shared dispatch
gate `if (!lifecycleActions.has(action)) return parseStart` after the
`const lifecycleActions = new Set(…)` literal. The current `application-cli.mjs:1673-1689`
carries the F8 typo-refusal structure instead:

```js
if (!lifecycleActions.has(action)) {
  const typoRefusal = cliRunVerbTypoRefusal(action, lifecycleActions);
  if (typoRefusal !== null) throw cliError(typoRefusal, 'cli_command_unavailable');
  return parseStart(args, action, idempotencyKey);
}
```

Because the gate string is absent, the suite's extraction throws `lifecycle dispatch gate present`
(R11 red) and the builder's `parserLifecycleDispatchCount()` fallback returns 0 (the committed
artifact's honest-to-this-tree value — no fabrication).

The conformance script's own `parserLifecycleDispatchCount()` (`surface-conformance.mjs:642-665`)
replicates the suite's extraction exactly (same markers, same patterns, latin1 read), and prefers
`applicationCli.cliParsedCommandNames()` when row-cli2 exports it. So once row-cli2 lands the gate
(and the `watch` lifecycle verb per R1/R4), regenerating via
`node impl/scripts/surface-conformance.mjs --write-inventory` will compute the honest dispatch
count and R11 leg 2 will go green. `counts.webBusCommands = 31` (R11 leg 1) already matches the
admission today.

## Per-seam split (unchanged expectations)

- **row-cli2** (`application-cli.mjs` + `CLI.md`): R1, R4, R5 — `run watch RUN_ID` → `run.watch`,
  bare `run watch` value-required refusal, the F8 silent-reinterpretation resolution (the gate
  string R11's extraction reads), and CLI.md taught forms matching served reality.
- **row-web2** (`application.mjs` append branch + `mcp-northbound.mjs` + `web-northbound.mjs` +
  `MCP.md`): R3, R8, R9 — decision-free `applicationAnswerSchema`, the answer-shape guard on
  `fleet_run_answer`, the initialize briefing honesty, and the `webBusAdmittedCommandNames()`
  accessor (31 dot names per contract D1/D2).
- **row-docs2 (this row)**: regenerate `surface-inventory-artifact.json` after those land;
  keep the ledger valid; verify the full suite green at every named stage.

## DECISION_REQUEST

{"question":"row-docs2 is blocked: row-cli2/row-web2 have not landed in this worktree (no notes-row-cli2.md / notes-row-web2.md after 30+ minutes of 30s-cadence polling), and R11 leg 2 cannot be made green without the parser dispatch gate they own — I must not fabricate the artifact counts. How should the wave proceed?","options":[{"id":"opt-complete-src-rows","label":"Re-drive/complete row-cli2 + row-web2 (the src rows) so the parser dispatch gate and the web admission accessor land; then row-docs2 regenerates the artifact and R11 goes green (the brief's intended sequencing)"},{"id":"opt-accept-blocked-interim","label":"Accept the blocked interim as documented red-by-design: artifact stays at the builder's honest current values (webBusCommands=31, parserLifecycleActions=0), R11 (and R1/R3/R4/R5/R8/R9) stay red-by-design until the src rows land; fold into the wave's documented red set"},{"id":"opt-scope-extend","label":"Extend row-docs2's partition to land the missing src legs myself (application-cli.mjs gate + web-northbound accessor) — crosses the row boundaries stated in row-docs2-brief.md and row-cli2/row-web2 briefs; requires explicit authorization"}],"allowFreeResponse":true,"deadlineMs":3600000}

**Recommendation: `opt-complete-src-rows`.** The brief's sequencing is explicit — this row
finalizes the artifact only after the code rows land; the src legs are another row's seam. If the
rows are merely slow (still working), a re-poll window is the cheapest resolution; if they
genuinely stalled, re-drive them rather than expanding this row's partition.

## Craft-law compliance

- No clocks; no `localeCompare`; no byte literals added outside `limits.mjs`.
- No suite edited (`impl/test/**` untouched); `impl/src/**` untouched; `impl/CLI.md` /
  `impl/MCP.md` untouched (other rows' partitions).
- The artifact and ledger were not hand-edited: `surface-inventory-artifact.json` remains the
  builder's byte-identical output in this tree; `surface-divergence-ledger.json` unchanged and
  passing `validateLedger`.
- Work confined to this worktree. No commit created.
