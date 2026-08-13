# Issue #159 — doc-truth ⇄ admission conformance: red-first suite draft notes

- **Suite:** `impl/test/doc-truth-conformance-red.test.mjs`
- **Contract:** `contract-fold.md` v1.1 (source of truth — the D1 three-way invariant, D2–D4
  dispositions, the refusal vocabulary, and the red-first acceptance pins R1–R11),
  `contract-redteam.md` (the attack surface that folded into v1.1 as B1–B7).
- **Date:** 2026-08-13
- **Split (verified):** `node --test impl/test/doc-truth-conformance-red.test.mjs` from the repo
  root at HEAD `e371f70`, run twice:

  | run | tests | pass | fail | note |
  |-----|-------|------|------|------|
  | 1 | 13 | **2** | **11** | 11 capability rows R1–R11 fail at their named stages; 2 substrate pins green (P-CS1-b, P-CS4) |
  | 2 | 13 | **2** | **11** | identical — **STABLE** |

  Every red row fails at its NAMED stage (assert message names the stage); the two green rows are
  the substrate pins (P-CS1-b conformance main, P-CS4 checked inventory artifact) and MUST stay
  green. This is the row-suite-159 draft.
- **Attempt line:** `[attempt: de03bfa2-a0ea-49a4-941b-dcf2d6312512 row-suite-159]`
- **Done-when (from the dispatch):** "Baton preserves exact route, result, and cleanup truth."
  The green legs pin the conformance gate that keeps the three-way invariant (documented ⇄ parsed
  ⇄ admitted) mechanically derived from the runtime's own tables (P-CS1-b, P-CS4); the red rows
  are the eleven dispositions that must land for that invariant to be enforceable: the `run.watch`
  CLI closure (R1/R4/R5), the web admission = card (R2/R7/R11), the answer schema/guard
  agreement (R3/R9), the docs' truthfulness (R6/R10), and the initialize instruction's honesty
  (R8).

## Invented surfaces (all absent at HEAD; accessed absence-proof)

Every invented disposition is pinned through surfaces that EXIST at HEAD — the parser
(`parseBatonCli`, `application-cli.mjs`), the reference-profile inventory
(`instantiateProfileInventory('web.bus')`, `surface-conformance.mjs`), the registry
(`APPLICATION_SEMANTIC_REGISTRY`), and the committed docs (`CLI.md` / `MCP.md`). The post-contract
state is asserted BEHAVIORALLY (a missing parse branch is a red parse assertion) or via
SOURCE-REGION pins (a missing schema/guard/initialize edit is a red region assertion) — never a
load-time crash, and no absent export is imported statically (e.g. R11 pins the parser's
`lifecycleActions` literal directly rather than importing the not-yet-existing
`cliParsedCommandNames()`).

| Invented disposition | Exact mechanism | Where pinned |
|---|---|---|
| `run watch` compiles to `run.watch` (D3 #1) | a `watch` CLI lifecycle verb; `baton run watch RUN_ID` → `run.watch` (canonical `run.follow`), bare `baton run watch` refuses instead of silently compiling to `run.start` | R1 (example compiles), R4 (bare verb never reinterprets), R5 (example leg) |
| The web.bus inventory = the card (D2, G7) | `webBusNames()` derives the full web admission — web-admitted `APPLICATION_COMMAND_DEFINITIONS` names (25) ∪ wave direct ports (6) = 31 dot names, matching the card at `web-northbound.mjs:1521` | R2 (inventory deep-equals the pinned 31), R11 (committed artifact `webBusCommands` = 31) |
| The MCP answer schema admits no `decision` (D3 #5) | `applicationAnswerSchema` (`mcp-northbound.mjs:359-371`) loses the `decision` branch; the shared accepted-answer-keys guard (`optionId`/`text`) covers BOTH `baton_decision_answer` AND `fleet_run_answer` | R3 (schema region decision-free), R9 (schema region + guard region names `fleet_run_answer`) |
| The MCP initialize instruction names only MCP tools (D3 #4) | the `briefingSentence` (`mcp-northbound.mjs:1366-1369`) no longer promises `context.briefing` (no MCP tool exists) | R8 (initialize region free of `context.briefing`) |
| The MCP.md wave examples are fenced json with `repoId` first (D3 #6, D4 MCP leg) | `## Orchestrate a wave` examples become fenced `json` blocks whose shapes carry `repoId` first and pass `validateArguments` | R10 (section has fenced json; `repoId` first) |
| The eight facade ports are ledgered (D3 #3) | the web refusal of the whitelisted-but-web-refused names is recorded in `surface-divergence-ledger.json` (no unledgered whitelisted name) | R7 (every `CLI_WEB_COMMANDS` name web-admitted or ledgered) |
| `run steer` prose is retired (D3 #2) | `CLI.md:190-191` no longer claims "the worker-targeted `run steer` command remains an advanced compatibility surface" | R6 (CLI.md free of `run steer`) |
| The D4 example leg (fixture substitution + alias/kind normalization + verb-column compile) | every served row's Example AND taught Verb parse, through `PLACEHOLDER_FIXTURES` substitution and the application.commands alias map, to the row's canonical operation | R5 |

## Row map

### Red rows (must FAIL at HEAD at the named stage)

| Row | Stage | Green when |
|---|---|---|
| R1 | `run-watch-documented-but-unparsed` | `run.watch` is served (`servedCliOrdinaryKeys()`) AND `baton run watch RUN_ID` compiles through the parse to the `run.watch` command (canonical `run.follow`). At HEAD the row is served (`CLI.md:51`) but `parseBatonCli(['run','watch','run:r1'])` throws `cli_invalid: unexpected argument run:r1` → RED |
| R2 | `web-bus-inventory-undercount` | `instantiateProfileInventory('web.bus').names` deep-equals the pinned 31 dot names (the card's advertised set). At HEAD the inventory is 25 underscore transports (`surface-conformance.mjs:378-383`) vs the card's 31 (G7) → RED |
| R3 | `answer-schema-advertises-decision` | the `applicationAnswerSchema` source region (`mcp-northbound.mjs:359-371`) carries no `decision` branch, keeping the `optionId`/`text` forms. At HEAD the `decision` branch is present (`:362-363`) → RED |
| R4 | `run-watch-silent-reinterpretation` | `baton run watch RUN_ID` compiles to `run.watch`; bare `baton run watch` does NOT compile to `run.start` with objective `'watch'`. At HEAD the first throws `cli_invalid`, the second silently compiles to `run.start` (`parseStart` fallback, `:1578`, G4) → RED |
| R5 | `cli-example-shape-leg-red` | every served row's Example (fixture-substituted) and taught Verb column parse, through alias/kind normalization, to the row's canonical operation; no taught verb is a refusing spelling. At HEAD the verified split is two failures: `run.watch`'s example throws `cli_invalid: unexpected argument run:r1` (1 of 35 rows) and `application.help` teaches `baton application help` which refuses (`expected credentials, setup, doctor, route, explore, review, context, waves, or run`). The contract's raw 19/35 (7 value-placeholder `cli_invalid` + 12 parse-to-a-different-command) is the pre-D4 leg; this suite measures the D4-specified leg (fixture substitution + alias/kind normalization), which is the green condition. Green only when BOTH D3 #1 and D4 land → RED |
| R6 | `cli-run-steer-prose-live` | `CLI.md` carries no live `run steer` claim. At HEAD `CLI.md:191` claims it "remains an advanced compatibility surface" → RED |
| R7 | `facade-ports-unledgered` | every `CLI_WEB_COMMANDS` name is web-admitted (in the 31) or ledgered in `surface-divergence-ledger.json`. At HEAD the eight facade ports (`run.message.send`, `run.message.receipt`, `run.attention.watch`, `run.scratchpad.read`, `run.scratchpad.elevate`, `run.board.post`, `run.board.read`, `run.knowledge.seed`) are unledgered (the ledger is empty) → RED |
| R8 | `initialize-context-briefing-unmet` | the MCP initialize `briefingSentence` region (`mcp-northbound.mjs:1366-1369`) names no non-MCP command. At HEAD it resolves "via the orchestrator's embedded `context.briefing` command" (G9 — no such MCP tool exists) → RED |
| R9 | `fleet-run-answer-accepts-decision` | `applicationAnswerSchema` has no `decision` branch AND the answer-shape guard region (`mcp-northbound.mjs:1021-1024`) covers `fleet_run_answer` as well as `baton_decision_answer`. At HEAD the `decision` branch is present and the guard names only `baton_decision_answer` (`{decision}` reaches `run.answer` through the combined profile) → RED |
| R10 | `mcp-wave-examples-omit-repoId` | the `## Orchestrate a wave` section of `MCP.md` (95-123) contains fenced `json` example blocks whose shapes carry `repoId` first and pass `validateArguments`. At HEAD the wave examples are prose list items (105-116) that omit `repoId` (G10) → RED |
| R11 | `artifact-counts-stale` | the committed `surface-inventory-artifact.json` records `counts.webBusCommands` = 31 (the admission) and `counts.parserLifecycleActions` = the parser's `lifecycleActions` compile-set (29 at HEAD; 30 after D3 #1 wires `watch`). At HEAD the artifact records 25 and 28 (G7, B7) → RED |

### Green guards / pins (must stay green at HEAD)

| Row | Pin |
|---|---|
| P-CS1-b | `node impl/scripts/surface-conformance.mjs` has an executable main that is green (`/surface-conformance: ok/`) — the conformance gate stays live while the contract lands |
| P-CS4 | the checked inventory artifact regenerates deterministically (byte-stable across two builds) and `checkSurfaceInventoryArtifact()` returns clean — the checked artifact stays self-consistent |

## Design decisions made in the draft (beyond the contract's text)

1. **R5 measures the D4-specified leg, not the raw 19/35.** The contract's red count (19 of 35)
   is the RAW example column at HEAD (7 value-placeholder `cli_invalid` throws + 12
   parse-to-a-different-command mismatches). This suite's R5 applies the D4 re-specification —
   `PLACEHOLDER_FIXTURES` substitution, alias/kind normalization (`{kind:'command', name}` →
   name; `{kind:'semantic-action'}` → `run.<actionKind>`; kind-shaped `{kind:'adopt'|'export'|…}`
   → `run.<kind>`), and the alias-map canon — so the green condition is precisely what D4 demands.
   The verified red is therefore two failures (the only ones that survive the re-specification):
   `run.watch`'s example throws, and `application.help` teaches a refusing verb. R5 is green only
   when BOTH D3 #1 (wires `run watch`) AND the D4 leg land — matching the contract's "D3 #1 alone
   does not green it".

2. **The verb-column law is "no taught verb is a refusing spelling", not "every bare verb
   compiles".** Bare verbs without required arguments legitimately throw value-required errors
   ("Run ID is invalid", "--members is required", …); that is correct parsing, not a shape
   failure. The verb-column check flags only refusing spellings (`cli_command_unavailable` or the
   parseStart `expected X, …, or Y` refusal) — which at HEAD is exactly `application.help`
   teaching `baton application help`. The silent-reinterpretation half of the law is policed
   separately at R4, scoped to `run watch` per the contract; the pre-existing `baton waves attach`
   → `waves.list` bare-verb fallback is outside the contract's named scope (its documented
   example, `baton waves attach WAVE_ID`, compiles to `waves.attach` correctly) and is recorded
   here, not asserted.

3. **R11 pins the parser's `lifecycleActions` literal directly, not the not-yet-existing
   `cliParsedCommandNames()` export.** The contract says `parserLifecycleActions` derives from the
   exported compile-set (29 at HEAD, 30 after D3 #1). That export does not exist at HEAD, and
   importing an absent export would crash the suite (forbidden — invented behavior must be
   asserted absence-proof). `lifecycleActionsSourceCount()` counts the quoted strings in the
   parser's own `const lifecycleActions = new Set(...)` literal (`application-cli.mjs:1574-1577`,
   29 at HEAD), which IS the compile-set by construction; after D3 #1 it is 30 and the regenerated
   artifact records 30. The D1 export is the implementation's vehicle; the suite pins the number.

4. **R2/R7/R11 use the pinned 31-dot-name literal as the ground truth, and the test also verifies
   the literal equals the live card projection.** The card's advertised set is recomputed in-test
   from the web-admitted `APPLICATION_COMMAND_DEFINITIONS` names ∪ the six wave verbs
   (`web-northbound.mjs:37-47`) and asserted deep-equal to the pinned literal — so a registry edit
   that changes the card would be caught as a split between the pin and the live projection, not
   silently absorbed. The D2 green condition is that `webBusNames()` (and the regenerated
   artifact) land on that same 31.

5. **R3/R9 are source-region pins, not `validateApplicationCommandArgs` probes.** The embedded
   `run.answer` admission (`validateApplicationCommandArgs`) continues to accept `{decision}`
   after D3 #5 — the fix is in the MCP `validateArguments` answer-shape guard (the combined-profile
   hazard). Probing `validateApplicationCommandArgs('run.answer', {… decision …})` would stay
   `true` post-implementation and could never green, so R3 pins the schema region decision-free
   and R9 pins the guard region covering `fleet_run_answer`. The red-team's behavioral evidence
   (the guard covers only `baton_decision_answer` at HEAD; `{decision}` reaches `run.answer`
   through the combined profile) is documented here.

6. **The initialize `context.briefing` leg (G9) is pinned structurally.** Driving a real
   `initialize` exchange to observe the briefing sentence would require a full McpFleetServer
   fixture (the registry style). This contract's domain is the conformance gate + admission
   tables + docs, so the suite stays surface/conformance style and pins the `briefingSentence`
   source region (`mcp-northbound.mjs:1366-1369`) free of `context.briefing`. The open question
   (whether a real `baton_context_briefing` tool should land instead) is left to the contract.

7. **The eight facade ports are asserted at the CLI whitelist, not the web side.** R7 iterates
   `CLI_WEB_COMMANDS` (the CLI web-client whitelist) and requires each name to be web-admitted or
   ledgered. The ledger is matched flexibly by dot name, underscore transport, or canonical
   spelling — the D3 #3 ledger may record either spelling; the assertion is that no unledgered
   whitelisted-but-web-refused name survives.

## Hermeticity & hygiene

- No host fixtures, no network, no provider spawns: the suite drives the parser, the reference
  profiles, the artifact builder, and the committed docs directly. `P-CS1-b` runs the conformance
  main in-process via `execFileSync` (like `control-surface-truth-red` CS1-b).
- NUL-byte discipline: the NUL-carrying `application.mjs` / `coordination-store.mjs` are imported
  (fine) but never whole-file read; the only whole-file reads are NUL-clean (CLI.md, MCP.md,
  `application-cli.mjs`, `mcp-northbound.mjs`, the two JSON artifacts). `APPLICATION_COMMAND_DEFINITIONS`
  is imported from `application.mjs` without reading the file.
- No clocks as controls; no `localeCompare`; sorted-key/pinned literals appear in ACTUAL order
  (the 31-name web admission is pinned in sorted order).
- The suite is deterministic: both runs of the split produced identical 13/11/2 results.

## Deployment verification

The execution contract (direct executable `"true"`, empty argv, cwd `.`, expected exit 0) passes
trivially and is unchanged by this suite — this is the red-first acceptance for the fold's
implementation, not the deployment gate. A reviewer enforces the execution contract separately.
Run the suite with:

```sh
node --test impl/test/doc-truth-conformance-red.test.mjs
```

Expected at this draft at HEAD `e371f70`: **13 tests, 2 pass (P-CS1-b, P-CS4), 11 fail at their
named stages (R1 `run-watch-documented-but-unparsed`, R2 `web-bus-inventory-undercount`, R3
`answer-schema-advertises-decision`, R4 `run-watch-silent-reinterpretation`, R5
`cli-example-shape-leg-red`, R6 `cli-run-steer-prose-live`, R7 `facade-ports-unledgered`, R8
`initialize-context-briefing-unmet`, R9 `fleet-run-answer-accepts-decision`, R10
`mcp-wave-examples-omit-repoId`, R11 `artifact-counts-stale`)** — measured twice, stable (see the
header split). The named stages are the seam closures the #159 implementation must land (D3 #1
run.watch, D2 the web admission, D3 #2/#3/#4/#5/#6 the docs and guard edits, D4 the example leg,
D1 + regen the artifact counts).

## Publish posture

The two deliverable files — `impl/test/doc-truth-conformance-red.test.mjs` and this notes file —
each carry the `[attempt: de03bfa2-a0ea-49a4-941b-dcf2d6312512 row-suite-159]` line in their
headers; that line is the harvest's attribution check (#171) and the row's publish token. The
harvest pattern matches the sibling suite-74 row: the test file + `suite-draft-notes.md` are
collected, and the wave runner mints `suite-159-receipt.json` with `SUITE-159-OK`.

The campaign's publish-as-you-go ("post the notes to the `shared` scratchpad partition, scope
`shared`, kind `note`") is NOT reachable from this hermetic worktree — recorded judgment call.
There is no `baton` CLI executable in the worktree, no scratchpad MCP tool is advertised, and the
wave's coordination store (`.git/baton/application-v3/state/coordination/events.jsonl`) is the
LIVE event-sourced wave log under an active writer lease — writing to it directly would corrupt
the wave, not publish. The shared publish requires the application's `run.scratchpad.write` verb
against a live deployment connection, which does not exist here. The published artifact for this
row is therefore the two files above, exactly as the harvest expects them.
