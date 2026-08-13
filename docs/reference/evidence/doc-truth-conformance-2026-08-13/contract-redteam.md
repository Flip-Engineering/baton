# #159 RED-TEAM REPORT — adversarial attack on the doc-truth↔admission conformance contract v1

Red-team verdict on `doc-truth-conformance-contract.md` (v1, same dir). Every citation was
re-verified at the **current HEAD `4783706`** ("Baton private effective-tree snapshot"). The
impl tree is byte-identical to the contract's stated verification HEAD `88489eaa` (diff of
`impl/` between the two is empty), so the contract's anchors are checked against the same code it
claims to verify. Refusal behaviors were confirmed with live `node` probes of `parseBatonCli`,
`validateArguments`, `validateApplicationCommandArgs`, `mcpApplicationToolNames` (35) /
`mcpAdvancedToolNames` (19) / `mcpCombinedToolNames` (86), and the entry-set derivations.
NUL discipline observed: `application.mjs` + `coordination-store.mjs` are NUL-bearing (3 NUL
bytes each, od-verified); both were accessed by `grep -an` only. All other cited files are
NUL-clean. `gh` is unauthenticated in this worktree, matching the contract's note about the
unfetchable issue body.

**Verdict: NOT FOLD-READY.** The three-way invariant and the seven dispositions are the right
shape, but the contract carries two citation errors (one against its own "wrong citation is a
blocker" law), two specification holes in D1 that leave the closures unit-undefined, a materially
wrong acceptance pin (R5), and a D4 example-shape check that is under-specified and, taken
literally, is red on 19 of 35 CLI rows today — not one. Numbered blockers at the bottom.

---

## 1. Citation re-verification (brief item 1)

Re-verified with `sed -n`/`grep -an` at HEAD `4783706`. Verified-true anchors are listed once;
deviations are called out.

| Contract claim | Re-verified at HEAD | Status |
|---|---|---|
| G1 `CLI_WEB_COMMANDS` `application-cli.mjs:16-36`, closed set of 36, `run.follow` at `:21`, eight facade names at `:29-31`, gate at `:2013` | 36 names counted; `command()` gate `if (!CLI_WEB_COMMANDS.has(name)) throw cliError(...)` at `:2013`; `run.follow` at `:21`; the eight facade names span `:29-31` | ✅ |
| G2 `COMMAND_CAPABILITY` `:87-94`, `APPLICATION_COMMAND` `:149-151`, refusal `'unsupported command'` at `:405`, facade transports absent | All confirmed; `grep -n` of `run_message|run_board|run_attention|run_scratchpad|run_knowledge` in `web-northbound.mjs` returns nothing (exit 1) | ✅ |
| G2/G3/OQ3 "19 kernel literals at `web-northbound.mjs:88-89`" | The 19 literals span **`:88-90`** — line 90 carries `goal_define, plan_propose, plan_approve, goal_plan_status` (the four authoring literals). `:88-89` holds 15. Count (19) correct; **range wrong** | ⚠️ **citation error** |
| G3 `WAVE_WEB_ENTRIES` `:37-47`, `waves_run` at `:45-46`, `WEB_DIRECT_PORT_COMMANDS` `:62`, spreads at `:93`/`:150` | Array `:37-47`; the `waves_run` entry line is `:46` (the `:45` line is the tail of the #153 comment); `:62`, `:93`, `:150` exact | ⚠️ minor (`waves_run` entry is `:46`, not `:45-46`) |
| G4 lifecycle set `:1574-1577` has no `watch`; fallback `:1578`; waves refusal `:1380-1384`; steer refusal `:1775-1778`; follow refusal `:1422` | All confirmed. Live probes: `run watch` → `run.start` objective `'watch'` (with `resultIntent:'change'`); `run watch R` → `cli_invalid unexpected argument RUN_ID`; `run follow R` → `cli_command_unavailable follow is not shipped…`; `waves send|stop R` → `cli_command_unavailable expected waves list, progress, start, attach, or run`; `run steer R` → `cli_command_unavailable steer was deleted at the M5 alias sunset; use run send` (bare `run steer` dies earlier at `cli_invalid Run ID is invalid` because the steer branch sits after the runId shift) | ✅ |
| G5 `servedCliOrdinaryKeys()` `render-surface-docs.mjs:34-75`; alias `:1877`; registry row `:751-752`; example `:1263`; `CLI.md:51`; facade rows `CLI.md:26-46`; stale prose `CLI.md:191` | All confirmed. `run.watch` row is `CLI.md:51`; the eight facade rows fall in `:26-46`; the `run steer … remains an advanced compatibility surface` prose is at `:191`; alias `['run.watch','application.commands','run.follow']` at `:1877`; registry row `'run.watch': { operation: 'run.follow', cli: null }` at `:751-752` | ✅ |
| G6 conformance main `:682`; `checkSurfaceDocs()` `render-surface-docs.mjs:145-153`; parity loop `:735-743`; `checkProfileDocParity` `:495`; web.bus self-referential `:488-491`; cli.ordinary renderer-vs-renderer | All confirmed. `profileDocSection` for `cli.ordinary` returns `renderCliVerbInventory()` (the same builder), and for `web.bus` returns the inventory itself. Loop is `:735-745`; `checkSurfaceDocs()` closes at `:154` — minor range imprecision | ✅ (minor range) |
| G7 `webBusNames()` `:378-384` filters `APPLICATION_COMMAND_DEFINITIONS` on `.web`; live probe 25 incl. `waves_attach`; artifact `webBusCommands: 25` (`surface-inventory-artifact.json:12`); "correct admission is 31 dot names … exactly the card's own derivation at `web-northbound.mjs:1521`" | `webBusNames()` is `:378-383`; probe returns 25 incl. `waves_attach`, missing the six direct ports. **But the card's literal derivation at `:1521` is `[...WEB_APPLICATION_ENTRIES, ...WAVE_WEB_ENTRIES]` — it does NOT spread `CANONICAL_WEB_ENTRIES`.** The dot-name *set* is equal (CANONICAL entries map canonical transports onto the same legacy dot names; probed: 25+9+6=40 values dedupe to 31, card also 31, set-equal), so the 31-count conclusion holds, but "exactly the card's own derivation" is false about the code | ⚠️ **citation/derivation error** |
| G8 `applicationAnswerSchema` `:359-366` advertises `{decision}`; guard `:1021-1023`; comment `:1017-1020`; `fleet_run_answer` `:390`; `baton_decision_answer` `:574-577` | Confirmed. `{decision}` branch is `:362`; guard `if (answerKeys.length !== 1 || !['optionId','text'].includes(answerKeys[0])) return 'invalid_arguments'` at `:1021-1023`. **But the guard covers only `baton_decision_answer`; `fleet_run_answer` has no answer-shape guard, and `validateApplicationCommandArgs('run.answer', {answer:{decision:'allow'}})` ACCEPTS it (probe).** See D3 #5 | ⚠️ see D3 #5 |
| G9 initialize note `:1367`; `baton_context_eval` `:758`; no `context.briefing` tool in any profile | Confirmed. `resolve via the orchestrator's embedded context.briefing command` at `:1367`; probe: `baton_context_briefing` absent from application (35), advanced (19), combined (86); `baton_context_eval` is combined-only | ✅ |
| G10 six wave tools `:495-557` + `baton_decision_answer` `:574-577` require `repoId`; `MCP.md:105-116` omit it | Confirmed — each required array leads with `'repoId'`; examples show `{idempotencyKey, members: […]}`, `{waveId, cursor}`, `{runId, requestId, answer}` — none with `repoId` | ✅ |
| G11 waves.send/stop claim `cli,web` at `:1599-1601`/`:1614-1616`; waves.run claims no `web` at `:1638`; CLI refuses waves.send/stop at `:1384` | Confirmed exactly (surfaces lines `:1600`, `:1615`, `:1638`) | ✅ |
| Refusal vocabulary anchors (`application-cli.mjs:1320-1324, 1380-1384, 1775-1778, 50`; `web-northbound.mjs:405`; `mcp-northbound.mjs:1021-1023`) | All confirmed | ✅ |
| Facade parse branches `application-cli.mjs:1430/1456/1476/1513/1552` | All five branches present at those lines (message/attention/scratchpad/board/knowledge) | ✅ |
| Idiom suites `control-surface-truth-red.test.mjs` (CS-1a/b/c, CS-4) and `wave-grammar-red.test.mjs` | Both suites pass at HEAD (12/12); `node impl/scripts/surface-conformance.mjs` prints `surface-conformance: ok` (exit 0) | ✅ |

Net citation result: two **material** deviations (the `:88-89` kernel-literal range that omits line 90, and the "exactly the card's own derivation" claim about `:1521`), plus a handful of off-by-one range imprecisions that do not misanchor their targets. Per the campaign law, the two material deviations are blockers; each is fixable by a one-line correction and neither changes the substance of the claim it supports.

---

## 2. D1 — the three-way invariant (brief item 2)

### Verdict: HOLE — the invariant is the right design, but the closures are unit-undefined on two of three legs, and the "mechanical, no hand-maintained list" claim is not yet true.

**2.1 Mechanical purity — the "parsed" side is not a single table today, and one hand-maintained list survives the draft.**
The CLI parser's compile paths are heterogeneous: the `lifecycleActions` set (`application-cli.mjs:1574-1577`), the semantic-action dispatch (`run send/adopt/export/integrate` → `{kind:'semantic-action'|'adopt'|'export'|'integrate', …}`), the stream channels (`run progress/events/output` → `{kind:'stream', channel}`), the facade sub-verb branches, and the `waves` branch. "The parser must EXPORT that compile-set (a `cliParsedCommandNames()` accessor over the same tables the branches read)" requires either a table-driven refactor of every branch or a probe-based derivation; neither is specified, and the union of those branches is exactly the kind of list the contract says it is eliminating. Concretely: `buildSurfaceInventoryArtifact` already carries a **hand-maintained `lifecycleProbe` list** (`surface-conformance.mjs:598-605`, 28 entries) that omits `steer` from the parser's actual 29-entry `lifecycleActions` set — the artifact's `parserLifecycleActions: 28` is therefore a live instance of the drift the contract claims to kill, and R11's "artifact regenerates" does not fold this count into a mechanical derivation. The contract should require `parserLifecycleActions` to derive from the same exported compile-set the D1 CLI leg uses.

**2.2 Can the check be green while a documented verb still refuses? Yes — three paths found.**
1. **Verb-column drift is uncheckable under the draft.** The D1 CLI leg's *documented* side is `servedCliOrdinaryKeys()` — operation keys. The parser compiles examples to *canonical command names* (`run view` → `run.inspect`, `run do` → `run.act`, `run resume` → `run.resume_work`, `run member view` → `run.workstreams`, `run list` → `runs.list`, `run send` → semantic-action `send`). 12 of the 36 whitelist dispatch names (`runs.list`, `run.inspect`, `run.episode`, `run.workstreams`, `run.workstream.notify|stop`, `run.act`, `run.status`, `run.follow`, `run.wait`, `run.retry_verification`, `run.resume_work`) do not appear as served keys, and 11 served keys (`run.view`, `run.do`, `run.list`, `run.member.*`, `run.resume`, `run.retry`, `run.send`, `run.watch`, `run.debug`) are not whitelist names (probe-diffed). The D1 CLI closure "admitted ⊆ documented" is therefore **not a name-level comparison** — it requires the alias-map canonicalization the contract gestures at but never specifies. A naive implementer lands a perpetually-red check (and the standard remedy — thresholding or fixture special-casing — is precisely where drift re-enters).
2. **The taught verb column is not compiled at all.** `application.help`'s generated row (`CLI.md:22`) teaches `baton application help`; `parseBatonCli(['application','help'])` refuses (`cli_invalid expected credentials, …`), while its *example* `baton help` parses to `application.help`. A row can teach a refused spelling and stay green because D4 checks only the Example column.
3. **Value-level refusals are invisible to a keys-only example check** (see D4.2).

**2.3 Web leg — same spelling problem, plus a kernel-literal boundary that is not wired to the inventory.**
The draft's *admitted* side is literally "`Object.keys(COMMAND_CAPABILITY)` / `Object.keys(APPLICATION_COMMAND)`" — 59 / 40 **underscore transport** keys — while the *documented* side (D2's fixed `webBusNames()`) and the card are **31 dot names**. The closure "inventory ≡ card ≡ admission" cannot hold under those spellings; it only holds under the dot-name projection `Object.values(APPLICATION_COMMAND)` deduped → 31 (probed: 40 values dedupe to exactly the card's 31). The contract must specify the projection and the kernel-literal exclusion on the *admitted* side, not leave an implementer to invent it. Separately, the "asserted disjoint from the inventory … (the existing `checkWebNameDisjoint` machinery)" claim is imprecise: `checkWebNameDisjoint` (`surface-conformance.mjs:314-326`) asserts **registry canonical-operation web names** are disjoint from `KERNEL_AUTHORING_WEB_LITERALS`; it does not compare the web.bus inventory to anything. A new inventory-vs-literals disjoint check is required but unspecified.

**2.4 Coverage — all three surfaces plus the facade are addressed in design.**
CLI (served/compile-set/whitelist), web (inventory/card/admission + kernel-literal floor), MCP (tool table / `validateArguments` / arg-shape), and the eight facade ports (ledgered web refusals, D3 #3) are each given a home and a mechanical source. This is the contract's strength. The facade parse branches exist (`:1430/1456/1476/1513/1552`), so the CLI side of the facade is genuinely parsed; the web side is genuinely refused (`'unsupported command'` at `:405`, zero facade transports in `web-northbound.mjs`); the ledger is genuinely empty today (`surface-divergence-ledger.json` has `entries: []`). The *fix*: add the closures' unit/canonicalization definitions (2.2.1, 2.3), fold the `lifecycleProbe` list into the exported compile-set (2.1), and specify the new inventory-disjoint check (2.3).

---

## 3. D2 — the direct-port accounting (brief item 3)

### Verdict: SOUND in mechanism, with one dependency and one derivation claim to correct.

**3.1 Does the fix count the direct-port verbs? Yes.** `[...WEB_APPLICATION_ENTRIES, ...CANONICAL_WEB_ENTRIES, ...WAVE_WEB_ENTRIES]` → dedup → 31 dot names, exactly the card's set. The 25→31 delta is precisely the six `WAVE_WEB_ENTRIES` verbs; `waves_attach` was already counted (it is an `APPLICATION_COMMAND_DEFINITIONS` key at `application.mjs:200`, and the current 25-name list includes it). The six direct ports never touch `APPLICATION_COMMAND_DEFINITIONS` (the `web-northbound.mjs:34` comment and the `application.mjs` dispatch switch at `:12560-12569` confirm the direct-port admission), so the "WITHOUT touching APPLICATION_COMMAND_DEFINITIONS" invariant is preserved — the undercount was an inventory-derivation bug, not an admission bug. Correct.

**3.2 Regression posture — can a FUTURE direct port land unnoticed?**
The posture is good **only because of the D1 web leg**, not because of D2 alone. Once `webBusNames()` derives from the same three entry sets that spread into `APPLICATION_COMMAND` (`:150`), a future direct port added to `WAVE_WEB_ENTRIES` grows the inventory, the card (`:1521` spreads `WAVE_WEB_ENTRIES`), and the admission together — honest, self-consistent, green. A future direct port added to a **new** entry set spread into `COMMAND_CAPABILITY` but **not** into the card and **not** into the three-set derivation would trip the D1 web leg's "card ≡ inventory" comparison (inventory ≠ admission). So the check notices — but only if the D1 web leg (with the dot-name projection of §2.3) actually lands. **HOLE dependency:** D2 as written says "webBusNames() must stop deriving from `APPLICATION_COMMAND_DEFINITIONS` alone … and instead return … `[...WEB_APPLICATION_ENTRIES, ...CANONICAL_WEB_ENTRIES, ...WAVE_WEB_ENTRIES]`" — but `web-northbound.mjs` exports **none** of those three sets (verified: only the `WebNorthbound` class, the two server factories, and `validateWebCommandEnvelope` are exported). The derivation is not importable without a new export or the D1 `webBusAdmittedCommandNames()` accessor. The contract should state that D2 consumes the D1 accessor (single source) so the inventory and the admission cannot diverge by construction.
**3.3 Derivation claim to correct.** Drop "exactly the card's own derivation at `:1521`" — the card spreads `[...WEB_APPLICATION_ENTRIES, ...WAVE_WEB_ENTRIES]` (no `CANONICAL_WEB_ENTRIES`). The dot-name *set* is identical, so the count holds; phrase it as "the card's advertised set" and let both derive from the same accessor.

---

## 4. D3 — the seven measured mismatches (brief item 4)

Each disposition was checked against the code and its red-first pin.

1. **`run watch` advertised-but-dead → WIRE (D3 #1).** SOUND. Probes confirm `run watch RUN_ID` throws `cli_invalid` and bare `run watch` silently compiles to `run.start` objective `'watch'`. `lifecycleActions` (`:1574-1577`) lacks `watch`; the registry row `'run.watch': { operation: 'run.follow', cli: null }` (`:751-752`) and the alias rows (`:1878-1880`) are the honest completion. Note the registry row's `cli: null` — wiring the verb changes the registry's declared CLI surface, which the contract should say explicitly (it says "a `watch` alias is the honest completion"; the `cli: null` flip is the mechanism).
2. **Stale `run steer` prose → RETIRE (D3 #2).** SOUND. `CLI.md:191` is hand prose, not generated; `parseBatonCli(['run','steer','R'])` refuses with the corrective naming. Pin R6 holds.
3. **Eight facade ports web-refused → DOCUMENT the refusal (D3 #3).** SOUND. Zero facade transports in `web-northbound.mjs`; parse branches exist on CLI; the ledger is empty and ready for the eight rows. Pin R7 holds. One check: the contract's ledger rows name the refusal `'unsupported command'` at `:405` — correct, that is the `validateEnvelope` string.
4. **MCP initialize `context.briefing` → RETIRE the resolution promise (D3 #4).** SOUND. `:1367` sentence confirmed; no `baton_context_briefing` in any profile (probe 35/19/86); `baton_context_eval` is combined-only, so naming it requires the combined profile or an application sibling. Pin R8 holds.
5. **`{decision}` advertised-but-refused → RETIRE from schema (D3 #5).** **HOLE (residual enforcement).** Removing the `decision` branch from the shared `applicationAnswerSchema` is correct for `baton_decision_answer` (advertised at `:362`, guard-refused at `:1021-1023`). **But the guard covers only `baton_decision_answer`.** `fleet_run_answer` (`:390`) shares the schema but has no answer-shape guard, and `validateApplicationCommandArgs('run.answer', {answer:{decision:'allow'}})` accepts it (probe). After the schema edit, `fleet_run_answer` stops *advertising* `{decision}` yet still *accepts* it silently — the very approval-settlement hazard the comment at `:1017-1020` records remains reachable through the combined profile, and the D4 answer-shape closure ("advertised schema ⊆ what `validateArguments` accepts") holds vacuously because `fleet_run_answer` accepts everything. Fix: extend the shared accepted-answer-keys guard to `fleet_run_answer` (or have `run.answer`'s arg validation enforce it) so the schema and both consumers agree on the closed set.
6. **MCP.md wave examples omit `repoId` → WIRE (D3 #6).** SOUND. `MCP.md:105-116` confirmed; every wave tool leads its `required` array with `'repoId'`. Pin R10 holds.
7. **`webBusNames()` undercount → fixed by D2.** See §3.

Net: six dispositions SOUND, one (D3 #5) SOUND-with-residual-hole.

---

## 5. D4 — example fidelity (brief item 5)

### Verdict: HOLE — the check as specified is under-specified and its acceptance pin (R5) is materially wrong.

**5.1 The CLI example-shape leg, run literally today, is red on 19 of 35 rows — not one.** I tokenized every generated row's Example column (`CLI.md` block) and compiled it through `parseBatonCli`, comparing the result to the row's operation key (the contract's own "must compile … to the row's operation key"):

- **7 throw `cli_invalid` on placeholder VALUES:** `run.approve --plan DIGEST` ("Plan digest is invalid"), `run.message.receipt MESSAGE_ID`, `run.scratchpad.elevate --entries JSON`, `run.watch RUN_ID`, `waves.attach WAVE_ID`, `waves.progress WAVE_ID`, `waves.start --members JSON`.
- **12 parse to a different command/key than the row:** `run.view`→`run.inspect`, `run.do`→`run.act`, `run.resume`→`run.resume_work`, `run.retry`→`run.retry_verification`, `run.member.view`→`run.workstreams`, `run.member.send`→`run.workstream.notify`, `run.member.stop`→`run.workstream.stop`, `run.list`→`runs.list`, `run.send`→semantic-action `send`, `run.adopt`→`{kind:'adopt'}`, `run.export`→`{kind:'export'}`, `run.integrate`→`{kind:'integrate'}`.
- **16 green** (incl. `run.watch`'s siblings `application.help`, `run.start`, `run.stop`, `waves.list`, `waves.run`).

So R5's "Red today: `baton run watch RUN_ID` fails; **Green after D3 #1**" is wrong on both counts. The leg needs (a) a parse-result→operation normalization through the alias map (`run.do`→`run.act`, `run.member.view`→`run.workstreams`, kind/semantic-action mapping), and (b) placeholder-value tolerance (or substitution of validated fixture values) so shape checks do not fail on `DIGEST`/`JSON`/`WAVE_ID` values. Neither is specified, and "green after D3 #1" cannot be the pin.

**5.2 The MCP leg checks key-presence, not executability.** "The lint extracts the `{...}` object literal … and checks `required ⊆ keys`" proves shape only. A wave-start example with `repoId` plus a `members` item carrying an invalid `role`/`exact` would pass `required ⊆ keys` and be refused by `validateArguments`. The contract's promise ("examples are executable shapes — … a shape `validateArguments` accepts") is stronger than the prescribed check. Fix: run each extracted example arg-object through the exported per-tool validator (or a shared arg-acceptance probe), not key-presence alone.

**5.3 Extraction is under-specified for prose.** The wave examples (`MCP.md:105-116`) are prose, not a generated block, and the members example wraps across lines with nested `{}`; a regex "extract the `{...}` object literal" is fragile and can silently re-admit drift. The contract should pin the extraction to a named convention (e.g., a fenced `json` block per example) or test the extraction against known shapes.

**5.4 Verb-column drift is uncheckable.** See §2.2.2 — the Example column is checked, the taught Verb column is not (`application.help` teaches `baton application help`, which refuses).

**5.5 The checks are gate-executable.** Every leg is in-process (table imports, `parseBatonCli`, committed-file reads); no network, no host state, no live providers — the same offline envelope as the already-green `node impl/scripts/surface-conformance.mjs`. Good.

---

## 6. Refusal vocabulary (brief item 6)

**SOUND.** The four codes are verified (`cli_command_unavailable`, `cli_invalid` default at `:50`, `'unsupported command'` at `web-northbound.mjs:405`, `invalid_arguments` at `mcp-northbound.mjs:1021-1023`), and the model refusals (waves `:1384`, steer `:1778`) carry the corrective naming. The "silent-reinterpretation law" names the right single offender: I probed `context map/reduce/retry` (all now refuse `cli_invalid expected context eval`, not a silent `run.start`) and `run <unknown>` (silent `run.start` — the only path found), so `:1578` is the single silent-reinterpretation site in the current tree. The one refinement from §4.5: `invalid_arguments` as the "MCP answer" code is enforced on `baton_decision_answer` only; the refusal vocabulary should state that `fleet_run_answer` gets the same guard, or the closed-set naming is incomplete for the combined profile.

---

## 7. Acceptance pins (brief item 6)

| Pin | Red-today claim re-verified | Verdict |
|---|---|---|
| R1 | `run.watch` documented (`CLI.md:51`), `parseBatonCli(['run','watch','R'])` throws `cli_invalid` | ✅ true |
| R2 | `webBusNames()` 25 vs card 31 | ✅ true (note: 25 are underscore transports, 31 are dot names — the D1 projection of §2.3 must make the comparison well-defined) |
| R3 | `applicationAnswerSchema` has `{decision}`, guard accepts `optionId`/`text` only | ✅ true |
| R4 | `run watch R` throws `cli_invalid`; bare `run watch` silently → `run.start` | ✅ true |
| R5 | "Red today: `baton run watch RUN_ID` fails; green after D3 #1" | ❌ **wrong** — the leg is red on 19/35 rows today; D3 #1 alone cannot green it (see §5.1) |
| R6 | `CLI.md:191` live `run steer` claim | ✅ true |
| R7 | eight facade ports unledgered, ledger empty | ✅ true |
| R8 | `context.briefing` has no MCP tool (35/19/86 all absent) | ✅ true |
| R9 | `decision` branch present at `mcp-northbound.mjs:362` | ✅ true |
| R10 | `MCP.md:105-116` omit `repoId` | ✅ true |
| R11 | artifact records `webBusCommands: 25` | ✅ true |

---

## 8. Open questions (brief item 6)

1. **`run watch`: wire vs. channel-only** — coherent. The registry treats the channels as the same operation either way; wiring `watch` is the honest completion of the `CLI.md:51` row. SOUND.
2. **Eight facade ports: ledger vs. landing** — coherent; ledgering is the right interim while `#87` is the landing issue, and the ledger mechanism already exists (empty today). SOUND.
3. **Kernel/authoring literals boundary** — coherent, but inherits the `:88-89` citation error (should be `:88-90`) and the §2.3 note that the inventory-disjoint assertion is not yet wired. SOUND-with-corrections.
4. **Card vs. canonical transports** — the honest tension the D1 projection (§2.3) must resolve: `CANONICAL_WEB_ENTRIES` adds 9 underscore transports admitted but not carded; the dot-name projection hides them, which is correct for a dot-name inventory and leaves the canonical transports to the registry alias map as the contract proposes. SOUND.
5. **MCP initialize `context.briefing`** — coherent; the retire-the-promise disposition (D3 #4) is the low-risk path, and landing a real `baton_context_briefing` tool is a legitimate follow-up. SOUND.

---

## 9. Final verdict: NOT FOLD-READY

Numbered blockers (what + why + fix):

1. **Citation error — the "19 kernel literals" range (`doc-truth-conformance-contract.md` G2/G3-border + OQ3) cites `web-northbound.mjs:88-89`; the four authoring literals live on `:90`.** The count is right, the anchor is wrong, and the campaign law makes a wrong citation an automatic blocker. *Fix:* cite `web-northbound.mjs:88-90` in both places.
2. **Citation/derivation error — G7/D2 claim the 31-name admission is "exactly the card's own derivation at `web-northbound.mjs:1521`"; the card spreads `[...WEB_APPLICATION_ENTRIES, ...WAVE_WEB_ENTRIES]`, omitting `CANONICAL_WEB_ENTRIES`.** Set-equal today (probed), but the sentence is false about the code and an implementer who copies the formula will produce a structurally different card check. *Fix:* rephrase to "the card's advertised set" and make both the inventory and the card derive from the same exported accessor.
3. **D1 closures are unit-undefined on the CLI and web legs.** Documented side is dot/canonical keys; admitted side is underscore transports / whitelist dispatch names; parsed side is canonical command names + kind-shaped results. As written, the "inventory ≡ card ≡ admission" and "admitted ⊆ documented" closures are not name-comparable, so an implementer either builds a perpetually-red check or invents a transform unconstrained by the contract — the exact drift seam the invariant exists to close. *Fix:* specify the canonical projection per leg (web: `Object.values(APPLICATION_COMMAND)` deduped → 31 dot names, kernel literals excluded; CLI: alias-map canonicalization of `CLI_WEB_COMMANDS` → served keys, and a parse-result→operation normalization table for the D4 comparison).
4. **R5 is materially wrong.** The CLI example-shape leg is red on 19/35 rows today (7 value-placeholder `cli_invalid` throws + 12 parse-to-different-command mismatches, probed), not 1, and "green after D3 #1" is false. *Fix:* re-specify the leg with (a) placeholder-value tolerance or fixture substitution, (b) parse-result→operation normalization through the alias map and the kind/semantic-action result shapes, and (c) re-set the red/green claim on the full 35-row run; add the MCP value-level validation (§5.2) so "executable shape" means what it says.
5. **D4 leaves three drift paths open.** The verb column is not compiled (`application.help` teaches `baton application help`, which refuses — probed); the MCP leg checks `required ⊆ keys`, not `validateArguments` acceptance, so a keys-complete but value-invalid example stays green; and the "extract the `{...}` literal" mechanism is unconstrained for prose. *Fix:* compile the taught verb column too, run extracted examples through the exported validator, and pin a concrete example-literal convention.
6. **D3 #5 removes the `{decision}` advertisement but not the acceptance.** `fleet_run_answer` has no answer-shape guard and `validateApplicationCommandArgs('run.answer', {answer:{decision:'allow'}})` accepts the form (probed), so the approval-settlement hazard the `:1017-1020` comment records remains reachable after the schema edit. *Fix:* extend the shared accepted-answer-keys guard to `fleet_run_answer` (or enforce it in `run.answer` arg validation) so schema and both consumers agree.
7. **One hand-maintained list survives the "no hand-maintained lists" law.** `parserLifecycleActions: 28` in `surface-inventory-artifact.json` derives from the `lifecycleProbe` array (`surface-conformance.mjs:598-605`) that omits `steer` from the parser's real 29-entry `lifecycleActions` set. *Fix:* derive the count from the exported `cliParsedCommandNames()` compile-set the D1 CLI leg introduces, and note the 28→29 (or 28→30 after D3 #1) artifact change under R11.

Fold is NOT recommended until blockers 1–5 are amended; blockers 6–7 are contained (single-file contract changes) and can ride the same edit.
