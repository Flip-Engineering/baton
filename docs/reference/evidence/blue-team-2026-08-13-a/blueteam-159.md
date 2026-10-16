# #159 BLUE-TEAM REPORT — doc-truth-conformance-red suite attack

[attempt: 08338cdd-d549-4375-98ee-af1a313938d5 row-bt159]

- **Row:** `row-bt159` · **Target:** `impl/test/doc-truth-conformance-red.test.mjs` (361 lines)
- **Authority:** `docs/reference/evidence/doc-truth-conformance-2026-08-13/contract-fold.md` (v1.1) + `contract-redteam.md` (the fold companions in the same dir). I attacked the SUITE against that intent.
- **Verdict scale:** SOUND / SHALLOW (named cheap wrong impl passes) / DECORATIVE (pin bites nothing) / BROKEN (red/green for wrong reason) · Final: ACCEPT / NEEDS-FOLD.
- **Scope honored:** read/ran anything, edited only this deliverable.

## Split — re-run twice, both match the declared notes

`node --test impl/test/doc-truth-conformance-red.test.mjs` from the repo root, four fresh runs
(`/tmp/bt159-run{1,2,3,4}-fresh.txt`):

| Run | tests | pass | fail | row set |
|---|---|---|---|---|
| 1 | 13 | 2 | 11 | R1–R11 red at their named stages · P-CS1-b, P-CS4 green |
| 2 | 13 | 2 | 11 | identical row set to run 1 (byte-identical ok/not-ok rows) |
| 3 | 13 | 2 | 11 | identical row set to runs 1–2 |
| 4 | 13 | 2 | 11 | identical row set to runs 1–3 |

Split stability confirmed across all four runs — no flakiness, both checkpoint pairs match the
declared notes.

Red rows, with the exact stage failures at HEAD `e371f70`:

- **R1** `run.watch is served AND its example compiles` → `baton run watch RUN_ID must compile, threw cli_invalid: unexpected argument run:r1`
- **R2** `web.bus inventory (25) must equal the 31-name card`
- **R3** `the schema must not advertise a decision form`
- **R4** `run watch RUN_ID must compile, threw cli_invalid: unexpected argument run:r1`
- **R5** `example-shape leg must be green — application.help: taught verb baton application help refuses: expected credentials, setup, doctor, route, explore, review, context, waves, or run | run.watch: example threw cli_invalid: unexpected argument run:r1`
- **R6** `CLI.md must not claim run steer remains live`
- **R7** `unledgered whitelisted-but-web-refused names — run.message.send, run.message.receipt, run.attention.watch, run.scratchpad.read, run.scratchpad.elevate, run.board.post, run.board.read, run.knowledge.seed`
- **R8** `context.briefing has no MCP tool — the sentence must not promise it`
- **R9** `applicationAnswerSchema must not carry a decision branch` (the guard-coverage leg is MASKED — see below)
- **R10** `the wave examples must be fenced json blocks`
- **R11** `webBusCommands must equal the 31-name admission` (the parserLifecycleActions leg is MASKED — see below)

Green substrate pins: **P-CS1-b** (conformance main prints `surface-conformance: ok`, exit 0) and
**P-CS4** (`checkSurfaceInventoryArtifact() == []`; committed artifact 25/28 matches a fresh build).

Both masked second legs are ALSO red, verified directly at HEAD:

- **R9 leg 2:** the guard region between `if (name === 'baton_decision_answer')` and
  `if (name === 'fleet_capability_invoke')` (mcp-northbound.mjs:1021–1025, 232 chars) does NOT
  contain `fleet_run_answer` — the shared answer-shape guard covers only `baton_decision_answer`.
- **R11 leg 2:** `artifact.counts.parserLifecycleActions` (28, the hardcoded `lifecycleProbe` in
  `buildSurfaceInventoryArtifact`) ≠ the parser compile-set literal `const lifecycleActions = new Set(`
  count (29, application-cli.mjs:78501).

## Law re-check (per the frame)

| Law | Finding |
|---|---|
| Named stage on every capability row | PASS — every R1–R11 failure message carries its stage prefix. |
| Hermetic (mkdtemp + after-cleanup, no network/provider) | PASS — no host fixtures; reads committed docs + source, probes `parseBatonCli` / `instantiateProfileInventory`, `execFileSync` of the local conformance main. |
| No clocks as controls | PASS — no `Date`/timers anywhere in the suite. |
| Namespace imports for invented surfaces | PASS — named imports only, no invented surfaces. |
| Sorted-key literals ACTUAL order | PASS — `WEB_BUS_DOT_NAMES_31` is codepoint order and the suite sorts the card before `deepEqual`, so the pinned literal is order-checked. `WAVE_WEB_VERBS` is a helper set (spread into the sorted card), not a sorted-key literal; benign. |
| watchdog.stallMs 60_000 + comment | OBSERVATION — the suite uses `execFileSync(..., { timeout: 60_000 })` (native child-process timeout, not the `watchdog.stallMs` idiom), and that 60_000 literal has no inline comment. Same intent, different mechanism; not a blocker, worth a comment if the suite is folded. |
| No absolute line-window anchors | PASS — `sourceRegion(text, startMarker, endMarker)` is marker-based; P-CS rows anchor on behavior, not lines. |
| Verbatim `[attempt: …]` suite header line | PASS — `// [attempt: de03bfa2-a0ea-49a4-941b-dcf2d6312512 row-suite-159]` at line 6. |
| Split stability | PASS — two fresh runs identical. |

## Per-row attacks

### R1 (run-watch-documented-but-unparsed) — **SHALLOW**

Cheapest wrong impl: a 3–4 line parser special-case on `['run','watch',<any>]` returning
`{kind:'command', name:'run.watch'}` — `canon('run.watch')` is `run.follow` (alias map), so
`canon(parsedKey) === canon('run.watch')` holds. No admission table, no `lifecycleActions`
compile-set entry, no web card change needed. The underlying class (documented verb not genuinely
wired) persists. Fold: assert the parsed name is a registered operation
(`APPLICATION_SEMANTIC_REGISTRY` contains the parsed name, not a synthetic special-case name) and
probe a second, non-fixture RUN_ID (e.g. `run:z9`) so an argv-literal special-case fails.

### R2 (web-bus-inventory-undercount) — **SHALLOW**

The card-projection first leg PASSES at HEAD (the 31-name card derives correctly from
`APPLICATION_COMMAND_DEFINITIONS` web entries ∪ `WAVE_WEB_VERBS`); only the inventory leg is red.
Cheapest wrong impl: hardcode `webBusNames()` to return the 31-name literal (or append the 6 wave
verbs to its output). `instantiateProfileInventory('web.bus')` then yields 31 and R2 goes green
while the single-source derivation (web derived from admission tables) stays broken — a FUTURE
direct port lands invisibly. Fold: a source-region pin that `webBusNames()`'s body references
`WAVE_WEB_VERBS` (or the same admission source the card uses), so a hand-written literal fails.

### R3 (answer-schema-advertises-decision) — **SHALLOW**

Cheapest wrong impl: rename `decision` → `resolution` in the `applicationAnswerSchema` region —
the `/\bdecision\b/u` region grep is dodged by one key rename while the advertise-but-refused form
survives (the schema still offers a branch the guard refuses). The `optionId`/`text` survival
assertion is unaffected. Fold: behavioral — invoke the guard (or the answer-shape validation) with
a `{resolution: …}` (or `{decision: …}`) answer and assert `invalid_arguments`, instead of grepping
the source region.

### R4 (run-watch-silent-reinterpretation) — **SHALLOW** (strongest single pin in the suite)

Cheapest wrong impl: special-case `['run','watch','run:r1']` → `run.watch` AND make bare
`['run','watch']` throw a value-required error (1 line). The second leg DOES bite the current HEAD
bug — verified: bare `run watch` today silently compiles to `run.start` with objective `'watch'`, so
a wrong impl that adds `run watch RUN_ID` without touching bare `run watch` is caught. But the
1-line "throw on bare" dodge is cheap, and the fixture is a single literal `run:r1`. Fold: same
two-fixture fold as R1 (a real second RUN_ID defeats the argv-literal), and assert the bare refusal
is the value-required shape (runId missing), not merely "not run.start".

### R5 (cli-example-shape-leg) — **SHALLOW**

Two red legs at HEAD: `application.help` taught verb `baton application help` refuses
(`expected credentials, setup, doctor, route, explore, review, context, waves, or run`), and
`run.watch`'s example throws. Cheapest wrong impls: (a) example leg via the same `run watch` fixture
special-case as R1/R4; (b) verb leg via either a `['application','help']` parse special-case OR a
served-keys filter — `servedCliOrdinaryKeys()` dropping rows whose taught verb refuses greens the
verb leg while the command stays admitted elsewhere. Note the alias-rewrite dodge (change the
`run.watch` example to `baton run events`) does NOT work: `run events run:r1` parses to
`{kind:'stream', …}` → `parseResultToKey` → null ≠ run.follow, so the example leg genuinely needs a
`run watch`-command parse. Fold: assert `servedCliOrdinaryKeys()` ⊆ (`CLI_WEB_COMMANDS` ∪ web card)
so dropping a served row without retiring admission fails; two-fixture fold for the example leg.

### R6 (cli-run-steer-prose-live) — **SHALLOW**

Cheapest wrong impl: re-spell `run steer` → `run.steer` in `impl/CLI.md` (the `/\brun steer\b/u`
regex is dodged by the dot-spelling) while the live "advanced compatibility surface" claim at
CLI.md:191 survives. Fold: extend the pattern to `run[ .]steer` and/or assert the whole run-steer
prose paragraph is gone via a marker region.

### R7 (facade-ports-unledgered) — **SHALLOW**

Cheapest wrong impl: add 8 name-only entries to `impl/scripts/surface-divergence-ledger.json`
(name-presence is the only check; the ledger currently has 0 entries, no schema, no content pin).
Thin/incorrect ledger entries pass. Fold: pin the ledger entry shape (non-empty `reason`,
disposition field, schemaVersion) and assert the ledger is authoritative in BOTH directions — no
ledger entry for a web-admitted name (stale-ledger direction), not just "every whitelisted name is
carded or ledgered".

### R8 (initialize-context-briefing-unmet) — **SHALLOW**

Cheapest wrong impl: rename the promised command in the briefing sentence to ANY other non-MCP
command (e.g. `contexts.briefing`, or another name not backed by an MCP tool) — the single-literal
`/context\.briefing/u` region grep is dodged while "initialize names a nonexistent tool" persists.
Fold: parse the backtick-named tools in the briefing sentence and assert each is a real MCP tool
name (behavioral subset check against the tool allowlist), not a single-literal grep.

### R9 (fleet-run-answer-accepts-decision) — **SHALLOW**

Leg 1 is the R3 rename dodge. Leg 2 is a substring grep on the guard region
(`if (name === 'baton_decision_answer')` → `if (name === 'fleet_capability_invoke')`): cheapest
wrong impl adds a comment `// fleet_run_answer also guarded` (or a dead branch) inside that region —
`/\bfleet_run_answer\b/u` matches a comment, so `fleet_run_answer` still reaches dispatch with a
`{decision}` answer accepted. Also: leg 2 is MASKED at HEAD by leg 1 throwing, so the suite reports
only the schema finding. Fold: make leg 2 behavioral (invoke the guard with a decision answer on
`fleet_run_answer` and assert `invalid_arguments`), and report both legs independently.

### R10 (mcp-wave-examples-omit-repoId) — **SHALLOW**

Cheapest wrong impl: add fenced ` ```json ` blocks with `repoId` first to the Orchestrate-a-wave
section (the check is shape-only: fenced, valid JSON, `repoId` present and first). The examples can
name a nonexistent wave tool or carry args the admission refuses and still pass — the D4 MCP leg
(examples are executable against the actual tool) is unpinned. Fold: for each fenced example, assert
the tool name exists in the MCP tool allowlist AND the args pass the tool's
`validateArguments`/admission.

### R11 (artifact-counts-stale) — **SHALLOW**

Both legs are red at HEAD; leg 2 is masked by leg 1 (verified directly: webBusCommands 25 ≠ 31 AND
parserLifecycleActions 28 ≠ 29 — the parser `lifecycleActions` literal has 29 entries). Cheapest
wrong impl: hardcode `webBusNames()` → 31, reconcile `lifecycleProbe` to the literal (or derive it),
and regenerate the artifact. The hand-edit-the-JSON dodge IS killed by P-CS4 (fresh-vs-committed
comparison), but the literal/hardcode derivation is unpinned, and the compile-set count only counts
the `const lifecycleActions = new Set(…)` literal — branch-added verbs or verbs moved out of the
literal are invisible. Fold: derive `parserLifecycleActions` from the parser dispatch rather than a
separate probe array; report both legs; tie `webBusCommands` to the R2 card derivation.

## Wrong-impl simulations — every named dodge re-run against the suite's actual assertions

Each cheap wrong impl below was simulated against the suite's exact assertion expressions
(replicated from the test file; probe `/tmp/bt159-sim.mjs`, `/tmp/bt159-sim2.mjs`). Every one turns
its row green at HEAD while leaving the underlying defect in place:

| Row | Wrong impl simulated | Result |
|---|---|---|
| R1 | parser special-case `['run','watch',<id>]` → `{kind:'command',name:'run.watch'}` | GREEN — `parsed run.watch, canon run.follow` (canon(parsedKey)===canon('run.watch')) |
| R4 | same special-case + bare `['run','watch']` throws `cli_invalid` (value-required) | GREEN — leg1 true, leg2 true (bare ≠ run.start) |
| R5 (example leg) | same special-case | GREEN — canon(parsedKey)===canon('run.watch') |
| R2 | hardcode `webBusNames()` → the 31 DOT-name literal | GREEN inventory leg (card leg already passes at HEAD) — and confirms the HEAD defect is TWO-fold: underscore spelling (`application_help`) AND missing wave verbs (25 vs 31) |
| R3 / R9 leg1 | rename `decision` → `resolution` in the schema region | GREEN — no `\bdecision\b`, optionId/text survive |
| R9 leg2 | plant `// fleet_run_answer also guarded` comment inside the guard region | GREEN — `\bfleet_run_answer\b` matches the comment; dispatch still accepts `{decision}` |
| R7 | add 8 name-only entries to the divergence ledger | GREEN — `unledgered == []` with zero content pins |
| R8 | rename `context.briefing` → `contexts.briefing` in the briefing sentence | GREEN — still promises a non-MCP command |

These are the cheapest wrong implementations named in the per-row attacks; the simulations prove the
SHALLOW verdicts are empirical, not asserted.

## PIN-row bite tests

### P-CS1-b (conformance main executable + green) — **SOUND**

Bites the plausible wrong impl where the conformance main crashes or exits non-zero after the
honest table edits — e.g. `webBusNames()` → 31 without regenerating the committed artifact makes
`checkSurfaceInventoryArtifact()` return findings → non-zero exit → red. The vacuous-main dodge
(unconditional `console.log('surface-conformance: ok')` + `exit 0`) is theoretically possible but
P-CS4 imports `checkSurfaceInventoryArtifact()` directly, so the two pins compose. Genuinely
discriminating substrate pin.

### P-CS4 (artifact byte-stable + checks clean) — **SOUND**

Verified at HEAD: `checkSurfaceInventoryArtifact() == []` and the committed artifact
(webBusCommands 25 / parserLifecycleActions 28) matches a fresh build exactly. Bite test (simulated,
`/tmp/bt159-pin.mjs`): hand-editing the committed JSON to `webBusCommands: 31` makes the
fresh-vs-committed comparison diverge → the check returns findings → red. Genuinely discriminating
structural pin. (It does NOT bite the hardcoded-`webBusNames()` derivation cheat, which is R2/R11's
fold.)

## Cross-cutting folds (suite-level)

1. **Two-fixture discipline.** R1/R4/R5 probe only the single `run:r1` fixture; add a second
   distinct RUN_ID so argv-literal special-cases fail. Same principle for the card counts.
2. **Behavioral beats grep.** R3/R8/R9 (schema, briefing, guard) assert refusal/absence behaviorally
   at runtime instead of grepping source regions — comment/dead-string/rename dodges then fail.
3. **Surface the masked second legs.** R9 and R11 each carry a second red assertion that `assert`
   order hides at HEAD; fold each to report both legs independently so a partial fix (schema only,
   artifact count only) cannot be read as green.

## Final verdict

**NEEDS-FOLD.** All 11 capability rows are SHALLOW — each is turned green by a named cheap wrong
implementation (fixture special-case, hardcoded literal, rename, comment-plant, ledger/example
content edits, served-keys filter). The two substrate pins (P-CS1-b, P-CS4) are SOUND and must stay,
but they cannot carry the suite: a wrong impl can green every R row while leaving the underlying
documented-but-refused / advertised-but-refused / undercounted-inventory defects in place. Fold
instruction set: the per-row folds above + the three cross-cutting folds.

## Shared-publish record (failed publish — evidence)

Per the frame ("Publish your report to the `shared` scratchpad as well as your file; a failed
publish is evidence — record the refusal"), the shared-scratchpad WRITE verb does not exist at HEAD.
Probed the agent-facing surface at HEAD `e371f70`:

- `baton run scratchpad append run:r1 --scope shared --kind note --body …` → `cli_invalid: unexpected argument append` (#158 A1 RED — no append branch at `application-cli.mjs:1476`; only `run.scratchpad.read`/`elevate`).
- `baton waves send --scope shared --body …` → `cli_command_unavailable: expected waves list, progress, start, attach, or run`.
- `baton waves start --scope shared` → `cli_invalid: unexpected argument --scope`.

No `waves` CLI or scratchpad-append surface is agent-callable from this worktree; the receipt-writing
wave infra is harness-owned, not an agent-facing verb. The publish to `shared` therefore FAILED;
this refusal is recorded as the evidence. (The write-lane receipt pattern in
`docs/reference/evidence/scratchpad-write-2026-08-13/*-receipt.json` is produced by the harness at
harvest, not by the row agent.)
