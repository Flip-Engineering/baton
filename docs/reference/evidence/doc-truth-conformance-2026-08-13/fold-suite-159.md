# doc-truth-conformance-red — fold suite 159

[attempt: c8f618f9-2f2a-4a1d-a367-eda8fd71da5c row-sf159]

Authority: `blueteam-159.md` (SHALLOW rows R1–R11 + three suite-level cross-cutting folds) via
`contract-fold.md` v1.1.
Suite: `impl/test/doc-truth-conformance-red.test.mjs` — folded **in place**, staying **13 tests
(2 PIN / 11 RED)**. The fold adds no rows; it hardens R1–R11 against the blue-team's named dodges,
satisfies the three cross-cutting folds (two-fixture discipline; behavioral beats grep; masked
second legs surfaced), and re-records the split. Contract: `contract-fold.md` v1.1 (unchanged).

### Incremental note (fold continuation)

The fold was continued one pass after the initial write: **R8 switched from a source-region pin to
a behavioral initialize probe** (cross-cutting fold #2 names R8). The row now asserts the actual
`instructions` string the server sends to a client in the initialize response, driven out by a
second fixture (`briefingServer`) whose coordination models an orchestrator-briefing family head —
a source-region pin could be dodged by a dead source string or by a briefing built but never sent.
The split was re-measured twice after the switch and is unchanged (13/2/11).

## Before / after

```
BEFORE (review HEAD e371f70):  tests 13 · pass 2 (P-CS1-b, P-CS4) · fail 11 (R1..R11)
AFTER  (fold HEAD e371f70):    tests 13 · pass 2 (P-CS1-b, P-CS4) · fail 11 (R1..R11 red at named stages)
```

Measured at the fold HEAD from the worktree root, two consecutive runs, both stable:

```
Run 1: 13 tests — 2 pass (P-CS1-b, P-CS4) / 11 fail (R1..R11)
Run 2: 13 tests — 2 pass (P-CS1-b, P-CS4) / 11 fail (R1..R11). STABLE.
```

## The eleven findings → resolution

| Finding | Severity | Folded seam | Row(s) | RED at HEAD | What the fold pins |
|---|---|---|---|---|---|
| **R1** `run.watch` is documented + served (`servedCliOrdinaryKeys`), but its example compiles to nothing — `run watch RUN_ID` throws `cli_invalid: unexpected argument RUN_ID` | SHALLOW | two-fixture parse + registry-registration check | **R1** | `run watch run:r1 must compile, threw cli_invalid: unexpected argument run:r1` | `run watch RUN_ID` compiles to the `run.watch` canonical operation on TWO fixtures (`run:r1`, `run:z9` — defeats an argv-literal special-case), AND the parsed name is a REGISTERED `canonicalOperations` row (defeats a synthetic parser special-case name never wired through the registry). |
| **R2** `web.bus` inventory (25) undercounts the card's advertised 31-name admission (underscore spellings + missing wave direct verbs) | SHALLOW | inventory-equality + D2 single-source source pin | **R2** | `web.bus inventory (25) must equal the 31-name card` | `instantiateProfileInventory('web.bus')` names === the pinned 31 (card projection = web-admitted `APPLICATION_COMMAND_DEFINITIONS` ∪ the 6 wave verbs — the D2 model, wave verbs as direct northbound ports), AND the `webBusNames()` body must textually reference the `webBusAdmittedCommandNames()` accessor — a hardcoded 31-literal or an append of wave verbs fails the source pin. |
| **R3** the answer pipeline advertises a `{decision}` form the guard refuses on `baton_decision_answer` — a renamed form (`{resolution}`) would be refused by that consumer and slip through | SHALLOW | behavioral guard probe on the SECOND consumer | **R3** | `a refused answer form must be refused by the answer-shape guard (invalid_arguments), got invalid_run_command` | `fleet_run_answer` with a `{resolution: {id, outcome}}` answer must refuse with the guard's `invalid_arguments` (at HEAD the second consumer refuses with the wrong, non-guard `invalid_run_command`). The probe is behavioral so a comment plant or dead branch changes nothing. Judgment call JC-2: the blue-team's probe target is the guard on `baton_decision_answer`, which is GREEN at HEAD — the fold moves the behavioral leg to the second consumer where it is honest. |
| **R4** `run watch RUN_ID` is a parse-time dead end AND bare `run watch` silently reinterprets to `run.start` (objective `'watch'`) | SHALLOW | two-fixture compile + value-required refusal shape | **R4** | `run watch run:r1 must compile, threw cli_invalid: unexpected argument run:r1` | `run watch RUN_ID` compiles on two fixtures; bare `run watch` must refuse with the value-required SHAPE — `cli_invalid` whose message matches `/run id|runId|required/i` — not merely "not run.start" (the 1-line throw-on-bare dodge fails: it must be the runId-missing refusal). |
| **R5** `application.help`'s taught verb refuses (`expected credentials, …`) and `run.watch`'s example throws; a served-keys filter could drop both rows to green the legs | SHALLOW | example/verb legs + anti-drop presence + ⊆ law | **R5** | `application.help: taught verb … refuses … \| run.watch: example threw …` | every served row's Example compiles (fixture-substituted, two fixtures for `run.watch`) AND its taught Verb is not a refusing spelling (value-required throws are correct bare-verb behavior); `application.help` and `run.watch` stay SERVED (anti-drop — defeats the served-keys filter); and `servedCliOrdinaryKeys()` ⊆ (`CLI_WEB_COMMANDS` ∪ web card) so dropping a served row without retiring admission fails. `run.debug`/`run.send` are excluded from the ⊆ law as host-local / semantic-action CLI verbs — JC-5. |
| **R6** `impl/CLI.md:191` claims `run steer` "remains an advanced compatibility surface" — a live claim for a retired command | SHALLOW | dot/space-spelling + phrase pin | **R6** | `CLI.md must not claim run steer remains live` | no `run[ .]steer` spelling survives (`/\brun[\s.]*steer\b/gu` — defeats the `run.steer` re-spelling dodge) AND the "remains an advanced" phrase is gone (defeats leaving the live claim behind while changing the command spelling). |
| **R7** the divergence ledger is `{schemaVersion: 1, entries: []}` — 8 whitelisted-but-web-refused facade ports unledgered; name-only entries would pass | SHALLOW | full-shape ledger law, both directions | **R7** | `unledgered whitelisted-but-web-refused names — run.message.send, …, run.knowledge.seed` | every `CLI_WEB_COMMANDS` name is web-admitted (via the alias map) OR ledgered (forward direction); a ledger row is full shape — `surface`/`name`/`dimension`/`retiresIn`/`canonical` present (the `validateLedger` schema) AND a non-empty divergence note (`reason|refusal|note`) — JC-3; and no ledger row names a web-admitted command (stale-ledger direction). |
| **R8** the initialize briefing names `context.briefing`, which is not an MCP tool — a promise to the client of a command the MCP surface does not expose | SHALLOW | behavioral initialize probe | **R8** | `the initialize briefing names non-MCP tools — context.briefing` | the ACTUAL string sent to the client in the initialize `instructions` field (behavioral — cross-cutting fold #2) names only `mcpCombinedToolNames()` members. The `briefingServer` fixture models an orchestrator-briefing family head so the composed sentence (not the honest-empty line) is what the probe reads. A rename to any non-MCP dotted spelling fails; naming nothing (or naming a real MCP tool) passes; a comment plant or dead source string changes nothing. |
| **R9** the answer schema advertises a `{decision}` branch (three forms: text/decision/optionId) AND `fleet_run_answer` accepts a decision answer | SHALLOW | structural leg + behavioral guard leg | **R9** | `schema advertises [text, decision, optionId], expected exactly [optionId, text] \| fleet_run_answer accepted a decision answer (guard refusal invalid_run_command…)` | leg 1 — the advertised answer branches (source-order extraction from `applicationAnswerSchema`) are exactly `[optionId, text]` — a rename (`decision`→`resolution`) is still an extra advertised branch (structural, defeats the rename dodge); leg 2 — a `{decision}` answer on `fleet_run_answer` is refused with the guard's `invalid_arguments` (at HEAD: `invalid_run_command`). Both legs collected into one `failures` array — the row reports all missing legs, not the first only. |
| **R10** the MCP.md "Orchestrate a wave" examples are prose, not fenced json — a wrong impl can fix the northbound without teaching the docs | SHALLOW | fenced-json + tool-name + executable-shape admission | **R10** | `the wave examples must be fenced json blocks` | the wave section contains ≥1 fenced ```json block; every backtick-named wave tool is a real `mcpCombinedToolNames()` member; each fenced shape carries `repoId` FIRST and a tool-specific field beyond repoId/idempotencyKey; and each shape is admitted by ≥1 wave tool via the tool's ACTUAL `inputSchema` (`required` ⊆ keys ⊆ `properties`). Admission is inputSchema-based, not behavioral — behavioral `handle()` is polluted by downstream dispatch refusals even for valid shapes (JC-6). |
| **R11** the committed artifact records `webBusCommands: 25` and `parserLifecycleActions: 28`, stale against the 31-name admission and the parser's 29-verb dispatch | SHALLOW | both legs tied to derivation, not hand-counts | **R11** | `webBusCommands 25 ≠ card admission 31 \| parserLifecycleActions 28 ≠ parser dispatch 29` | leg 1 — `artifact.counts.webBusCommands === card.size` (the R2 card derivation, 31); leg 2 — `artifact.counts.parserLifecycleActions === parserLifecycleDispatchCount()` — the parser's `const lifecycleActions = new Set(…)` literal PLUS pre-gate branch-added verbs (JC-1). A hand-maintained probe array that omits `steer` can't green the row. |

## Per-finding seam notes

- **JC-1 — R11 leg 2 derives from the parser dispatch, not the literal alone.** The artifact's 28
  undercounts the parser literal's 29 (the literal is 29 entries including branch-added verbs). The
  fold's `parserLifecycleDispatchCount()` reads the literal region from
  `const lifecycleActions = new Set(` to the shared gate `if (!lifecycleActions.has(action))` and
  adds pre-gate `action === '…'` / `[…].includes(action)` special-cases. A probe array that mirrors
  the artifact's hand-count would let a stale count self-confirm; tying the pin to the dispatch
  makes the row fail exactly when the count and the parser disagree.
- **JC-2 — R3's behavioral leg lives on `fleet_run_answer`, not `baton_decision_answer`.** The
  blue-team's prescribed probe — `{resolution}` on the `baton_decision_answer` guard — is GREEN at
  HEAD (that guard already refuses resolution), so a behavioral row on it would be dishonestly
  green. The fold keeps the schema structural pin on the shared schema (R9 leg 1 covers the rename
  dodge for BOTH consumers, since both read `applicationAnswerSchema`) and puts the behavioral
  refusal on the second consumer, where at HEAD the answer is refused by the wrong path
  (`invalid_run_command`) — an honest RED.
- **JC-3 — R7 ledger shape follows the live `validateLedger` schema, not the blue-team's disposition
  field.** The blue-team prescribed "non-empty reason, disposition field, schemaVersion". The
  existing `validateLedger` (`surface-conformance.mjs:275`) requires `surface`/`name`/`dimension`/
  `retiresIn`/`canonical` — a ledger that carries those but no `reason` would be structurally
  rejected by the conformance main. The fold pins the `validateLedger`-compatible shape AND a
  non-empty divergence note (`reason | refusal | note`) so name-presence stays a RED. The
  blue-team's "disposition field" is expressed as the non-empty divergence note; recorded so the
  contract's intent is preserved.
- **JC-4 — R8 reads the SENT string, and name shapes are single-word backticks + lowercase-dotted.**
  The probe takes the initialize response's `instructions` field (the composed sentence — the
  briefing is built per-initialize from the family head, so a family-head fixture drives the real
  sentence out; a fixture without one degrades to the honest-empty line, which is why R8 gets its
  own server). Extraction accepts only single-word backtick tokens (`` `baton_context_eval` ``) and
  lowercase-dotted spellings (`context.briefing`) — the sentence's own template-literal backticks
  never match a single-word token, so no phantom-from-the-wrapping-backticks false positive. A
  comment plant, a dead source string, or a sentence built but never sent cannot dodge the pin:
  the assertion is on what the client actually receives.
- **JC-5 — R5's ⊆ law excludes `run.debug`/`run.send`.** Both ARE served at HEAD (35 rows) but are
  not in `CLI_WEB_COMMANDS` (run.debug is host-local; run.send is a semantic-action CLI verb). The
  blue-team's direction-2 containment (`CLI_WEB_COMMANDS ⊆ served`) is FALSE at HEAD, so the fold
  uses direction 1 (`served ⊆ whitelist ∪ card`) with those two host-local/semantic rows excluded —
  a containment that holds at HEAD and cannot be dodged by dropping a served row.
- **JC-6 — R10 admission is inputSchema-based, not behavioral.** A behavioral `tools/call` probe of
  a valid wave shape is polluted: `waves_start` full → `invalid_wave_start`, `waves_progress` full →
  `invalid_wave_progress`, `decision_answer` full → `invalid_call` — downstream coordinator
  refusals, indistinguishable from an admission refusal without the real harness. The fold instead
  checks each fenced shape against the tool's advertised `inputSchema` (`required` ⊆ keys ⊆
  `properties`) — the shape-half of `validateArguments` — plus a repoId-first and a tool-specific
  field guard. Value-level acceptance (e.g. `members[].role` enum) remains the conformance gate's
  exported-validator leg (post-contract), outside this suite's fixture reach.
- **P-CS1-b / P-CS4 stay green.** The two substrate pins are untouched by the fold except P-CS1-b's
  `60_000` timeout literal now carries the inline `watchdog.stallMs` comment (suite law: no clock as
  a control, stall ceiling documented).

## Finding disposition — every blue-team finding FOLDED / STRUCK / ESCALATED

| Blue-team item | Kind | Disposition | Where |
|---|---|---|---|
| **R1** run-watch-documented-but-unparsed | per-row SHALLOW | **FOLDED** — two-fixture parse + registry-registration | R1 row |
| **R2** web-bus-inventory-undercount | per-row SHALLOW | **FOLDED** — inventory equality + D2 single-source pin | R2 row |
| **R3** answer-schema-advertises-decision | per-row SHALLOW | **FOLDED** — behavioral guard probe on the second consumer | R3 row (JC-2) |
| **R4** run-watch-silent-reinterpretation | per-row SHALLOW | **FOLDED** — two-fixture compile + value-required refusal shape | R4 row |
| **R5** cli-example-shape-leg | per-row SHALLOW | **FOLDED** — example/verb legs + anti-drop + ⊆ law | R5 row (JC-5) |
| **R6** cli-run-steer-prose-live | per-row SHALLOW | **FOLDED** — `run[ .]steer` + phrase pin | R6 row |
| **R7** facade-ports-unledgered | per-row SHALLOW | **FOLDED** — full-shape ledger law, both directions | R7 row (JC-3) |
| **R8** initialize-context-briefing-unmet | per-row SHALLOW | **FOLDED** — behavioral initialize probe on the sent `instructions` | R8 row (JC-4) |
| **R9** fleet-run-answer-accepts-decision | per-row SHALLOW | **FOLDED** — structural branch leg + behavioral guard leg, both reported | R9 row |
| **R10** mcp-wave-examples-omit-repoId | per-row SHALLOW | **FOLDED** — fenced json + tool-name + inputSchema admission | R10 row (JC-6) |
| **R11** artifact-counts-stale | per-row SHALLOW | **FOLDED** — both legs tied to derivation, not hand-counts | R11 row (JC-1) |
| Cross-cutting **#1** two-fixture discipline | suite-level | **FOLDED** — `run:r1` + `run:z9` in R1/R4/R5; card counts from live derivation in R2/R11 | R1/R4/R5/R2/R11 rows |
| Cross-cutting **#2** behavioral beats grep | suite-level | **FOLDED** — R3 (guard probe), R8 (sent-instructions probe), R9 leg 2 (guard probe) are behavioral; leg 1 is structural by design (a rename is a schema-visible branch, and R9 leg 2 carries the behavior) | R3/R8/R9 rows |
| Cross-cutting **#3** surface the masked second legs | suite-level | **FOLDED** — R9 and R11 collect BOTH legs into a `failures` array and `assert.deepEqual(failures, [])`, so a partial fix (schema only / artifact count only) reports the missing leg | R9/R11 rows |
| **P-CS1-b** conformance main executable + green | PIN bite test | **KEPT** (blue-team verdict SOUND) — the pin stays; fold only added the inline `watchdog.stallMs` comment on the `60_000` timeout | P-CS1-b row |
| **P-CS4** artifact byte-stable + checks clean | PIN bite test | **KEPT** (blue-team verdict SOUND) — the pin stays untouched | P-CS4 row |
| Shared-publish record (failed publish — evidence) | publish-evidence record | **ESCALATED** — the waves CLI / scratchpad-append surface is not agent-callable at HEAD; the report itself records the refusal as evidence (and names #158 A1). No fold applies to the suite; tracked at the harness/authority level, not this acceptance suite. | — |

Every per-row SHALLOW finding and every suite-level cross-cutting fold is **FOLDED**; the two
SOUND substrate pins are **KEPT**; the publish-evidence record is **ESCALATED** (no suite seam
exists for an absent surface). Nothing is dropped unaccounted.

## Scope discipline

Writes were confined to `impl/test/doc-truth-conformance-red.test.mjs` and this file, under the
`ws-acd21e87d3a52f8c731abfd41443cdba` worktree (pwd verified before every write). The sacred
`[attempt: de03bfa2-a0ea-49a4-941b-dcf2d6312512 row-suite-159]` header line in the suite is
untouched. No pushes, no destructive commands.
