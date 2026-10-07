# Issue #159 — doc-truth ⇄ admission conformance (the class-killer) — FOLD v1.1

The implementation contract for issue #159: the generated surface docs teach verbs the parsers
and admission refuse, and the conformance gate compares the renderer's output to the committed
docs but NEVER compares the inventory to parser branches or admission maps. The defect inventory
is measured at seven named instances. This contract owns the **three-way invariant** that closes
the class — documented ⇄ parsed ⇄ admitted, per surface, derived mechanically from the SAME
tables the runtime consults (no hand-maintained lists — that is the current bug) — and gives each
measured mismatch a disposition: wire it, retire it, or document the refusal, with a red-first
pin that keeps it fixed. It specifies behavior and the check location; it does not amend
implementation in this artifact. It is a Ring-2 contract (ground truths → decisions → refusal
vocabulary → red-first acceptance → open questions). It cross-references — it does not re-specify
— #87 (the facade-projection epic that contracts the eight workflow-surface lanes this contract
ledgers as web-refused), #132 (the wave surface), #140/#146 (adjacent doc-truth fixes the audit
names), and the #153 admission pattern (the wave that caught one: "admitted means parser AND
admission AND docs" — the shipped-path driver bug whose lesson this contract generalizes).

This document is **v1.1 — the fold**: it is `doc-truth-conformance-contract.md` (v1.0) amended
by the adversarial red-team report (`contract-redteam.md`, same dir). Every numbered blocker in
that report is folded below with its concrete fix; every non-blocking minor is folded; every
finding the red team verdict'd SOUND is kept byte-stable in substance. Where the red team offered
a choice, this fold makes the choice and says why. Citations were re-verified at the current
HEAD.

- **Status:** FOLD v1.1 — implementation contract (v1.0 folded through the red-team; red-first;
  no code landed for this rung)
- **Verification HEAD:** `049e91e` ("Baton private effective-tree snapshot"), the tree this fold
  was verified against. The fold's verified HEAD differs from the red-team's verification HEAD
  `4783706` only by the #154 harvest-success fix (`impl/src/workflow-interpreter.mjs`, its test,
  and the packed tgz), which touches none of the anchors cited in this contract; the impl tree at
  `4783706` is byte-identical to v1.0's stated verification HEAD `88489eaa`. Every `file:line`
  citation below was re-verified with `grep -an`/`sed -n` at `049e91e`, and the refusal behaviors
  were confirmed with live `node` probes of `parseBatonCli`, `validateArguments`, the tool-name
  projections (`mcpApplicationToolNames` 35 / `mcpAdvancedToolNames` 19 / `mcpCombinedToolNames`
  86), and the entry-set derivations. `impl/src/application.mjs` and
  `impl/src/coordination-store.mjs` are NUL-bearing (3 NUL bytes each, od-verified); their
  anchors are grep/sed-verified, never whole-file reads. All other cited files are NUL-clean
  (od-verified).
- **Brief:** `contract-fold-brief.md` (same dir) — read fully, in order: `contract-redteam.md`
  (NOT FOLD-READY — numbered blockers with concrete fixes), then `doc-truth-conformance-contract.md`
  (v1.0 — the edit source). The issue body (`gh issue view 159`) could not be fetched (`gh` is not
  authenticated in this worktree — the same constraint the #74, #70, #105, #69 contracts record);
  the requirements are carried by the brief and the audit (`control-surface-audit.md`).
- **Read-order executed.** (1) the fold brief and the red-team report; (2) the v1.0 contract; (3)
  the audit — `control-surface-audit.md` §2 #7 (the seven-instance list this contract
  dispositions), §1.4.1 (the reconciliation note that caught the `webBusNames()` undercount), §3
  (the grammar verdict that already ordered the `{decision}` removal); (4) the conformance
  machinery — `surface-conformance.mjs` (`webBusNames()`, `checkWebNameDisjoint`,
  `REFERENCE_PROFILES`, `runSurfaceConformanceMain`), `render-surface-docs.mjs`
  (`servedCliOrdinaryKeys()`, `checkSurfaceDocs()`), `surface-inventory-artifact.json`;
  (5) the three admission sources of truth — `web-northbound.mjs` (`WAVE_WEB_ENTRIES`,
  `COMMAND_CAPABILITY`, `APPLICATION_COMMAND`, the card), `application-cli.mjs`
  (`CLI_WEB_COMMANDS`, the parser branches), `mcp-northbound.mjs` (the tool tables,
  `applicationAnswerSchema`, the answer-shape guard, the initialize note); (6) the registry
  (`application-semantics.mjs` surfaceAliases + waves specs); (7) the #153 instance — the
  shipped-path `PRODUCTION_WORKFLOW_DRIVER` follow-on (commit `5529c16`) is the wave that caught
  one and is the precedent for "the gate must compare against parser+admission"; (8) the idioms —
  `control-surface-truth-red.test.mjs` (CS-1a/b/c/d, CS-4) and `wave-grammar-red.test.mjs`.

Scope of the rung, in one sentence: **the conformance gate stops trusting renderer-vs-renderer
parity and gains three mechanical legs — CLI, web, MCP — each of which proves documented ⇄ parsed
⇄ admitted against the runtime's own tables; the seven measured mismatches get their
dispositions (wire `run watch`, retire the `run steer` prose, ledger the eight web-refused
facade ports, fix the `context.briefing` instruction, retire `{decision}` from the answer
schema, add the missing `repoId` to the MCP wave examples, and fix `webBusNames()`'s
derivation); and example fidelity becomes a conformance-checked property.**

---

## Fold-map (finding → resolution → where in v1.1)

| # | Red-team finding (verdict) | Resolution folded into v1.1 | Where in v1.1 |
|---|---|---|---|
| B1 | **Citation error:** the 19 kernel literals are cited as `web-northbound.mjs:88-89`, omitting the four authoring literals on `:90` (count right, anchor wrong — automatic blocker). | Range corrected to `web-northbound.mjs:88-90` everywhere (15 literals on `:88-89`; `goal_define, plan_propose, plan_approve, goal_plan_status` on `:90`). | G2, D1 (kernel boundary), OQ3 |
| B2 | **Citation/derivation error:** G7/D2 claim the 31-name admission is "exactly the card's own derivation at `:1521`"; the card literally spreads `[...WEB_APPLICATION_ENTRIES, ...WAVE_WEB_ENTRIES]` — it does NOT spread `CANONICAL_WEB_ENTRIES`. Set-equal at the current HEAD, but the sentence is false about the code. | Rephrased to "the card's advertised set"; both the inventory and the card are required to derive from ONE exported accessor (`webBusAdmittedCommandNames()`), so a copied formula cannot diverge. | G7, D1, D2 |
| B3 | **D1 closures unit-undefined** on the CLI and web legs — documented side is dot/canonical keys, admitted side is underscore transports / whitelist dispatch names, parsed side is canonical names + kind-shaped results; as written the closures are not name-comparable. | Canonical projection specified per leg: web — `Object.values(APPLICATION_COMMAND)` deduped → 31 dot names, kernel literals excluded; CLI — alias-map canonicalization of `CLI_WEB_COMMANDS` → served keys, plus a parse-result→operation normalization table for the D4 comparison. The web leg's admitted side is the exported `webBusAdmittedCommandNames()` accessor; a new inventory-vs-kernel-literals disjoint check is specified. | D1 (new "Unit definitions" + "Kernel boundary" + "Admission-side export" text), D2 |
| B4 | **R5 is materially wrong** — the CLI example-shape leg is red on **19 of 35 rows** at the current HEAD (7 value-placeholder `cli_invalid` throws + 12 parse-to-a-different-command mismatches, probed), not 1, and "green after D3 #1" alone is false. | R5 re-set to the full 35-row run; the leg is re-specified with (a) pinned fixture substitution for placeholder tokens (chosen over pure tolerance — see D4), (b) parse-result→operation normalization through the alias map and the kind/semantic-action table, (c) the taught Verb column compiled too. | D4 (CLI leg), R5 |
| B5 | **D4 leaves three drift paths open** — the taught Verb column is never compiled (`application.help` teaches `baton application help`, which refuses); the MCP leg checks `required ⊆ keys`, not `validateArguments` acceptance, so a keys-complete but value-invalid example stays green; the "extract the `{...}` literal" mechanism is unconstrained for prose. | (a) Verb column compiled to the same canonical operation; (b) each extracted MCP example arg-object is run through the exported per-tool validator (a shared arg-acceptance probe), not key-presence alone; (c) extraction pinned to a named convention — a fenced `json` block per example (the prose wave examples get fenced blocks). | D4 (CLI leg, MCP leg, extraction convention) |
| B6 | **D3 #5 residual hole:** removing the `{decision}` branch from the shared schema stops `fleet_run_answer` *advertising* it, but `fleet_run_answer` has no answer-shape guard and `validateApplicationCommandArgs('run.answer', {answer:{decision:'allow'}})` still ACCEPTS it — the approval-settlement hazard survives. | The shared accepted-answer-keys guard (`['optionId','text']`) is extended to `fleet_run_answer` (chosen over enforcing in `run.answer` arg validation — see D3 #5). Schema, `baton_decision_answer`, and `fleet_run_answer` all agree on the closed set. | D3 #5, D4 (answer-shape closure), Refusal vocabulary |
| B7 | **One hand-maintained list survives** the "no hand-maintained lists" law — `parserLifecycleActions: 28` derives from the `lifecycleProbe` array (`surface-conformance.mjs:598-605`) that omits `steer` from the parser's real 29-entry `lifecycleActions` set. | `parserLifecycleActions` must derive from the exported `cliParsedCommandNames()` compile-set the D1 CLI leg introduces (the same tables the branches read); the 28→29 (→30 after D3 #1) artifact change is noted under R11. | D1 (CLI leg), R11 |
| M1 | G3 `waves_run` entry cited `:45-46`; the entry is `:46` (`:45` is the tail of the #153 comment). | Range corrected to `:46`. | G3 |
| M2 | G6 parity loop cited `:735-743`; the loop is `:735-745`; `checkSurfaceDocs()` closes at `:153`. | Ranges corrected. | G6 |
| M3 | G7 `webBusNames()` cited `:378-384`; the function spans `:378-383`. | Range corrected. | G7 |
| M4 | Refusal vocabulary: `invalid_arguments` is enforced on `baton_decision_answer` only; the closed-set naming is incomplete for the combined profile until `fleet_run_answer` gets the same guard. | Stated explicitly that `fleet_run_answer` carries the same guard (folded with B6). | Refusal vocabulary, D3 #5 |
| M5 | D2 derivation is not importable — `web-northbound.mjs` exports none of `WEB_APPLICATION_ENTRIES` / `CANONICAL_WEB_ENTRIES` / `WAVE_WEB_ENTRIES` (only `WebNorthbound`, the two server factories, `validateWebCommandEnvelope`). | D2 consumes the D1 `webBusAdmittedCommandNames()` accessor (single source), so the inventory and the admission cannot diverge by construction. | D2 |

SOUND verdicts kept byte-stable in substance: G1, G4, G5, G6, G8, G9, G10, G11; D3 #1-#4 and #6;
the refusal vocabulary's four codes and corrective naming; pins R1-R4 and R6-R11 (R5 amended); all
five open questions (OQ3 amended). The D4 gate-executability finding (every leg in-process, no
network/host state) is carried into D4 verbatim.

---

## Ground truths (code-verified)

| # | Claim | Anchor |
|---|---|---|
| G1 | **The CLI web-client whitelist is a closed set of 36 dispatch names.** `CLI_WEB_COMMANDS` (`application-cli.mjs:16-36`) gates the thin client's web dispatch at `command()` (`application-cli.mjs:2013`: `if (!CLI_WEB_COMMANDS.has(name)) throw cliError('unsupported Run command ' + name, 'cli_command_unavailable')`). It includes the eight facade-projection names (`run.message.send/receipt`, `run.attention.watch`, `run.scratchpad.read/elevate`, `run.board.post/read`, `run.knowledge.seed`) at `application-cli.mjs:29-31`, and `run.follow` at `:21`. | `application-cli.mjs` |
| G2 | **The web admission map is `COMMAND_CAPABILITY`; the application-command admission is `APPLICATION_COMMAND`.** `COMMAND_CAPABILITY` (`web-northbound.mjs:87-94`) is built from the 19 kernel/authoring literals (`:88-90` — 15 on `:88-89`, plus the four authoring literals `goal_define, plan_propose, plan_approve, goal_plan_status` on `:90`) plus `WEB_APPLICATION_ENTRIES` + `CANONICAL_WEB_ENTRIES` + `WAVE_WEB_ENTRIES`. `APPLICATION_COMMAND` (`:149-151`) is the application-command subset — the same three entry sets mapped `[transport, dot-name]`. `validateEnvelope` consults `COMMAND_CAPABILITY` and refuses with the bare string `'unsupported command'` at `:405`. The eight facade transports have ZERO occurrences in `web-northbound.mjs` (grep-verified), so a facade envelope reaches `:405` and refuses. | `web-northbound.mjs` |
| G3 | **The six wave verbs are direct-port admissions that never touch `APPLICATION_COMMAND_DEFINITIONS`.** `WAVE_WEB_ENTRIES` (`web-northbound.mjs:37-47`) lists `waves_start/progress/send/stop/list/run` with the `waves_run` entry at `:46` (the #153 follow-on that added it; `:45` is the tail of the #153 comment). `WEB_DIRECT_PORT_COMMANDS` (`:62`) is the closed transport set; their argument authority is the port's own normalizer, and `COMMAND_CAPABILITY`/`APPLICATION_COMMAND` spread them in (`:93`, `:150`). `waves_attach` is NOT here — it is an `APPLICATION_COMMAND_DEFINITIONS` key (`application.mjs:200`) and therefore the only wave verb `webBusNames()` already counts. | `web-northbound.mjs`, `application.mjs` |
| G4 | **The CLI parser silently reinterprets unknown `run` verbs into `run.start`.** The lifecycle verb set (`application-cli.mjs:1574-1577`, 29 entries incl. `steer`) has no `watch`; the fallback `if (!lifecycleActions.has(action)) return parseStart(args, action, idempotencyKey)` (`:1578`) compiles any unknown action into a new Run objective. Live probe: `baton run watch` → `{command:'run.start', args:{intent:{objective:'watch'}}}` (silent reinterpretation, audit §2 #3); `baton run watch RUN_ID` → `cli_invalid: unexpected argument RUN_ID`; `baton run follow R` → `cli_command_unavailable: follow is not shipped by the Run application` (`:1422`). The `waves` branch is the model refusal: `baton waves send R` → `cli_command_unavailable: expected waves list, progress, start, attach, or run` (`:1380-1384`). `run steer` refuses with corrective naming at `:1775-1778` (`cli_command_unavailable`, "steer was deleted at the M5 alias sunset; use run send"). | `application-cli.mjs` |
| G5 | **The CLI.md generated verb inventory advertises `run.watch` and the eight facade verbs.** The block is rendered by `servedCliOrdinaryKeys()` (`render-surface-docs.mjs:34-75`) from `CLI_WEB_COMMANDS` resolved through the registry's `surfaceAliases`; `run.watch` enters via `run.follow` (`application-cli.mjs:21`) → alias `['run.watch','application.commands','run.follow']` (`application-semantics.mjs:1877`) → canonical `run.watch` (registry row `application-semantics.mjs:751-752`, example `'baton run watch RUN_ID'` at `:1263`). The generated row is `CLI.md:51` (`\| run.watch \| ordinary \| baton run watch \| baton run watch RUN_ID \|`). The eight facade rows are generated too (`CLI.md:26-46`). The stale `run steer` claim is hand prose at `CLI.md:191`. | `render-surface-docs.mjs`, `CLI.md`, `application-semantics.mjs` |
| G6 | **The conformance main compares renderer to renderer and inventory to itself — never to parser or admission.** `runSurfaceConformanceMain` (`surface-conformance.mjs:682`) runs the stale-docs check (`checkSurfaceDocs()`, `render-surface-docs.mjs:145-153`, a byte-equal committed-block check), prose lint, the artifact check, and the profile-parity loop (`surface-conformance.mjs:735-745`). `checkProfileDocParity` (`:495`) compares each profile's inventory against `profileDocSection`; for `cli.ordinary` the section IS `renderCliVerbInventory()` (the same function that built the inventory — renderer-vs-renderer), and for `web.bus` the section IS the inventory itself (self-referential, `:488-491`). Neither leg consults a parser branch or an admission map — that is the gap the audit names (`control-surface-audit.md` §2 #7). | `surface-conformance.mjs`, `render-surface-docs.mjs` |
| G7 | **`webBusNames()` undercounts the web bus by derivation, not by admission.** `webBusNames()` (`surface-conformance.mjs:378-383`) filters `APPLICATION_COMMAND_DEFINITIONS` on `.web` and maps dot → underscore. Live probe: 25 names, including `waves_attach`, missing the six `WAVE_WEB_ENTRIES` direct ports. The committed artifact records `webBusCommands: 25` (`surface-inventory-artifact.json`). The audit caught the consequence: `row-mcp` marked the wave verbs absent from web because the inventory under-reported (`control-surface-audit.md:96-110`, §1.4.1, "the undercount instance that skewed a row's conclusion"). The correct application-command admission is 31 dot names — the dot-name projection of the three entry sets (`[...WEB_APPLICATION_ENTRIES, ...CANONICAL_WEB_ENTRIES, ...WAVE_WEB_ENTRIES]` mapped to dot names, deduped → 31) — the card's **advertised set** (the card at `web-northbound.mjs:1521` spreads `[...WEB_APPLICATION_ENTRIES, ...WAVE_WEB_ENTRIES]` — it does NOT spread `CANONICAL_WEB_ENTRIES`; set-equal to the projection at the current HEAD, but the card's literal formula is not the projection's formula, so the contract does not cite it as such). | `surface-conformance.mjs`, `web-northbound.mjs`, `control-surface-audit.md` |
| G8 | **The MCP answer schema advertises `{decision}`; the validator refuses it.** `applicationAnswerSchema` (`mcp-northbound.mjs:359-366`) is `oneOf: [text, decision{allow,deny,cancel}, optionId]`. Both consumers — `baton_decision_answer` (`:574-577`) and `fleet_run_answer` (`:390`) — advertise it. The hand-rolled validator guard (`:1021-1023`) accepts ONLY `optionId`/`text` (`if (answerKeys.length !== 1 || !['optionId','text'].includes(answerKeys[0])) return 'invalid_arguments'`) and covers **`baton_decision_answer` only**; `fleet_run_answer` has no answer-shape guard, and `validateApplicationCommandArgs('run.answer', {answer:{decision:'allow'}})` ACCEPTS the form (probe). The comment at `:1017-1020` records why `{decision}` must not reach the hub (it would settle an APPROVAL through the decision-only tool). The grammar verdict already ordered the removal (`control-surface-audit.md` §3: "remove the advertised-but-refused `{decision}`"). | `mcp-northbound.mjs`, `control-surface-audit.md` |
| G9 | **The MCP initialize note points an MCP client at a non-MCP command.** The initialize response composes a bounded trailing sentence (`mcp-northbound.mjs:1367`) instructing the client to "resolve via the orchestrator's embedded `context.briefing` command." No `baton_context_briefing` tool exists in ANY profile — live probe of `mcpApplicationToolNames()` (35), `mcpAdvancedToolNames()` (19), `mcpCombinedToolNames()` (86): absent. `baton_context_eval` (`:758`, `LEGACY_REFLEX_TOOL_DEFINITIONS`) is the closest MCP tool but takes a `program`, not a briefing-pack read, and is combined-profile-only. | `mcp-northbound.mjs` |
| G10 | **Every MCP wave tool requires `repoId`; the MCP.md wave examples omit it.** All six wave tools spread `...repo` and lead their `required` arrays with `'repoId'`: `baton_waves_start` (required `['repoId','idempotencyKey','members']`, `mcp-northbound.mjs:495-511`), `baton_waves_progress` (`['repoId','waveId']`, `:512-519`), `baton_waves_send` (`['repoId','runId','message']`, `:521-526`), `baton_waves_stop` (`['repoId','runId','reason']`, `:529-535`), `baton_waves_list` (`['repoId']`, `:541-550`), `baton_waves_run` (`['repoId','spec']`, `:552-557`); `baton_decision_answer` (`['repoId','idempotencyKey','runId','requestId','answer']`, `:574-577`). The MCP.md examples (`MCP.md:105-116`) show `{idempotencyKey, members: [...]}`, `{waveId, cursor}`, `{runId, requestId, answer}` — none carries `repoId`, so each example is a shape `validateArguments` refuses. | `mcp-northbound.mjs`, `MCP.md` |
| G11 | **The registry and the parser disagree on wave surfaces — ghost rows.** `waves.send`/`waves.stop` registry rows claim `surfaces: ['embedded','mcp','cli','web']` (`application-semantics.mjs:1599-1601`, `:1614-1616`) but the CLI parser refuses `baton waves send|stop` (`application-cli.mjs:1384`, live probe), and neither is in `CLI_WEB_COMMANDS` nor the generated CLI block — so they are registry ghosts on CLI. Conversely `waves.run` claims `surfaces: ['embedded','mcp','cli']` (`application-semantics.mjs:1638`) — NO `web` — yet the web bus admits `waves_run` (G3) and the card lists `waves.run` (`web-northbound.mjs:1521`): admitted-but-under-documented, the reverse ghost. | `application-semantics.mjs`, `application-cli.mjs`, `web-northbound.mjs` |

---

## Decisions

### D1 — the three-way invariant: documented ⇄ parsed ⇄ admitted, per surface, derived mechanically

The conformance gate's central promise is "generated from the executable inventory" — at the
current HEAD it is false for the measured rows (G6). The invariant this contract installs: for each of the three
agent-facing surfaces, the **documented** set, the **parsed** set, and the **admitted** set are
mechanically derived from the runtime's own tables, and the gate enforces three closures:

1. **documented ⊆ parsed** — every documented verb compiles through the parser to a real command;
   a silent fallback (`application-cli.mjs:1578`) or a refusal where a live verb is claimed is a
   finding.
2. **admitted ⊆ documented** — every verb the admission authority accepts appears in the surface's
   documented inventory; a whitelist name the admission refuses is a finding unless ledgered.
3. **every parser branch admits or refuses with the closed-set naming** — no branch falls through
   to a different command; the refusal carries the closed code plus the corrective naming (the
   `waves` branch's model, G4).

**Where the check lives.** The conformance main — `runSurfaceConformanceMain`
(`surface-conformance.mjs:682`) — is the home, not a new suite: it already runs in CI
(CS-1-b pins `node impl/scripts/surface-conformance.mjs` green), owns the doc-staleness, prose-
lint, artifact, and profile-parity legs, and prints typed findings to stderr. The three legs below
are added as legs of that main; the suite (`control-surface-truth-red.test.mjs`) pins the main's
behavior with red-first assertions, it does not re-derive the sets.

**Unit definitions — the three-way closures are name-comparable (folded from red-team B3).**
The closures hold on **canonical operation keys** (dot names), not on raw spellings. Each surface
leg defines its three sides on one projection, so "inventory ≡ card ≡ admission" and
"admitted ⊆ documented" are set comparisons over the same name space:

- **Web leg.** *Documented*: the web.bus profile inventory — `webBusNames()` fixed by D2 to the 31
  dot names. *Admitted*: the **dot-name projection** of the application-command admission —
  `Object.values(APPLICATION_COMMAND)` (`web-northbound.mjs:149-151`), deduped → 31 dot names,
  **kernel literals excluded** (the 19 kernel/authoring literals live only in `COMMAND_CAPABILITY`,
  never in `APPLICATION_COMMAND`, so the projection excludes them by construction; the contract
  states the exclusion explicitly so an implementer does not re-admit them). *Card*: the
  advertised set at `web-northbound.mjs:1521`. The closure — inventory equals the
  application-command subset of the admission, and the card equals the inventory — is checked on
  the dot-name projection; the underscore-transport keys of `Object.keys(COMMAND_CAPABILITY)` (59)
  and `Object.keys(APPLICATION_COMMAND)` (40) are NOT the comparison keys (they are transport
  spellings, not dot names). A dishonest impl cannot special-case the card because all three sides
  derive from one table family.
- **CLI leg.** *Documented*: `servedCliOrdinaryKeys()` (`render-surface-docs.mjs:34-75`) —
  operation keys, already the renderer's source (35 at the current HEAD). *Admitted*: `CLI_WEB_COMMANDS`
  (exported, G1) for the web-client dispatch, plus the parse branches for host-local execution.
  *Parsed*: the parser's compile-set — the closed verb tables the parser already owns
  (`lifecycleActions` at `application-cli.mjs:1574-1577`, the `waves` branch, the alias verbs, the
  semantic-action branches, the facade branches). Because the documented side and the admitted side
  spell the same verbs differently (`run.view` vs `run.inspect`, `run.member.send` vs
  `run.workstream.notify`, ...), both sides are **canonicalized through the registry alias map**
  (`applicationOperationAliasMap()`, `application-semantics.mjs` — the same map
  `servedCliOrdinaryKeys()` resolves through) before the closure comparison: the closure is
  `canon(admitted) ⊆ canon(documented)`, where `canon` resolves each name recursively to its
  terminal non-aliased key. A whitelist name whose canonical operation is not documented is a
  finding unless ledgered.
- **MCP leg.** *Documented*: `mcpApplicationToolNames()` (`mcp-northbound.mjs:2222`) — already
  derived from `ORDINARY_APPLICATION_TOOL_DEFINITIONS` (`:690`). *Parsed/admitted*:
  `validateArguments` — the per-tool acceptance. The arg-shape closure (D4) requires the tool
  schemas' advertised forms to be a subset of what `validateArguments` accepts, and the answer
  schema to share one source with the guard (D3 #5).

**The parser must EXPORT its compile-set (folded from red-team B3/B7).** This contract requires
the parser to export `cliParsedCommandNames()` — an accessor over the SAME tables the branches
read (`lifecycleActions` at `application-cli.mjs:1574-1577`, the `waves` branch, the alias verbs,
the semantic-action and facade branches), returning canonical operation keys — so the conformance
compares without a second hand-maintained list. The artifact's `counts.parserLifecycleActions`
(`surface-inventory-artifact.json`) MUST derive from this compile-set, NOT from the `lifecycleProbe`
array (`surface-conformance.mjs:598-605`) that currently omits `steer` (28 entries vs the parser's
real 29; see R11 for the 28→29 / →30 delta). A hand-maintained probe list that can drift from the
parser's tables is exactly the bug this contract kills.

**How each side is derived mechanically (no hand-maintained lists).** Each leg above derives its
sides from the runtime's own exported tables; the only list-valued constants allowed are the
parser's own compile tables and the registry's own surface/alias tables. No leg may invent a
second literal list of verbs.

**The kernel/authoring literals boundary.** `COMMAND_CAPABILITY`'s 19 kernel literals
(`web-northbound.mjs:88-90`) are a separate admission class: they are not application commands,
not on the card (`:1521`), and out of scope for the web.bus inventory (application commands only,
31). The D1 web leg checks the application-command subset against the card; the full
`COMMAND_CAPABILITY` set is the admission floor and is asserted **disjoint from the web.bus
inventory** — a NEW check the red team found unspecified. The existing `checkWebNameDisjoint`
machinery (`surface-conformance.mjs:314-326`) does NOT provide this: it asserts the registry's
canonical-operation web names are disjoint from `KERNEL_AUTHORING_WEB_LITERALS`
(`surface-conformance.mjs:310-313`), it does not compare the web.bus inventory to anything. The
new check compares the inventory (31 dot names) against `KERNEL_AUTHORING_WEB_LITERALS` and flags
any collision; its comparator must be a codepoint comparison (`<`/`>` or a byte-aware
comparator), never `localeCompare`. Open Question 3 tracks whether the kernel literals should one
day be documented.

**Admission-side export (folded from red-team B3/M5).** `web-northbound.mjs` currently exports
only `WebNorthbound`, `createAuthenticatedWebServer`, `createLocalAuthenticatedWebServer`, and
`validateWebCommandEnvelope` — none of `WEB_APPLICATION_ENTRIES` / `CANONICAL_WEB_ENTRIES` /
`WAVE_WEB_ENTRIES`. This contract requires `web-northbound.mjs` to EXPORT
`webBusAdmittedCommandNames()` — an accessor over the same tables `validateEnvelope` consults at
`:405` — returning the deduped dot-name projection (31). D2 consumes this accessor (single
source), and the D1 web leg's admitted side reads it, so the inventory, the card, and the
admission cannot diverge by construction.

### D2 — the direct-port accounting: fix `webBusNames()`'s derivation (single source)

**Choice: fix `webBusNames()`'s derivation — do NOT add a second source.** `webBusNames()`
(`surface-conformance.mjs:378-383`) must stop deriving from `APPLICATION_COMMAND_DEFINITIONS`
alone (G7) and instead return the application-command admission set from the tables the runtime
consults — via the D1 `webBusAdmittedCommandNames()` accessor (folded from red-team B3/M5: the
three entry sets are not importable from `web-northbound.mjs` at the current HEAD, so the accessor IS the
single source; D2 consumes the D1 accessor rather than a literal re-spread of the three sets) —
deduped, sorted in **actual codepoint order**, in canonical DOT names: the same 31 names the card
advertises at `web-northbound.mjs:1521`. The six direct-port wave verbs are
`waves.list, waves.progress, waves.run, waves.send, waves.start, waves.stop` (transports
`waves_list, waves_progress, waves_run, waves_send, waves_start, waves_stop`); `waves.attach` was
already counted (G3). Why **single-source** and not a second parallel list: a second list
recreates exactly the drift the audit caught (§1.4.1, G7) — the fix is to make the inventory
derive from the same tables that admit, so `validateEnvelope` and the inventory cannot diverge by
construction. The `web.bus` profile then stops being self-referential (G6): its inventory IS the
admission.

Consequences the contract owns: the `counts.webBusCommands` in `surface-inventory-artifact.json`
regenerates 25 → 31; the CS-4 byte-stability check and the artifact regen flow keep it committed;
and the D1 web leg (inventory ≡ card ≡ admission) becomes checkable. The six wave verbs are direct
ports (G3), so no `APPLICATION_COMMAND_DEFINITIONS` row changes and the direct-port admission
("WITHOUT touching APPLICATION_COMMAND_DEFINITIONS") is preserved — the undercount was an
inventory-derivation bug, not an admission bug.

**Regression posture (folded).** Once `webBusNames()` derives from the same accessor that spreads
into `APPLICATION_COMMAND` (`:150`), a future direct port added to `WAVE_WEB_ENTRIES` grows the
inventory, the card, and the admission together — honest, self-consistent, green. A future direct
port added to a NEW entry set spread into `COMMAND_CAPABILITY` but NOT into the card and NOT into
the accessor would trip the D1 web leg's "card ≡ inventory" comparison (inventory ≠ admission) —
so the check notices, but only because the D1 web leg (with the dot-name projection) actually
lands. D2 alone does not carry the regression posture; the D1 web leg is the load-bearing half.

### D3 — the measured mismatches become the fix list

Each of the seven named instances gets its disposition — **wire it**, **retire it**, or
**document the refusal** — with the red-first pin that keeps it fixed (all pins are RED in this
tree).

1. **`run watch` advertised-but-dead → WIRE it.** Add `watch` to the CLI lifecycle verbs
   (`application-cli.mjs:1574-1577`) so `baton run watch RUN_ID [--channel C]` compiles to the
   `run.watch` command (canonical `run.watch`, op `run.follow`, schema
   `application-semantics.mjs:1261-1269`) instead of the silent `parseStart` fallback (`:1578`).
   The operation is real and already served on web (`run_follow`) and embedded
   (`BatonRun.events`), and the CLI already teaches its channel verbs (`progress`/`events`/
   `output`, `:1574-1577`, alias-rows `application-semantics.mjs:1878-1880`); a `watch` alias is
   the honest completion of the documented row (`CLI.md:51`). The registry row's `cli: null`
   (`application-semantics.mjs:752`) flips when the verb is wired — the wiring changes the
   registry's declared CLI surface, which this contract owns explicitly (the `cli: null` flip IS
   the mechanism, not an incidental). Pin R5.
2. **Stale `run steer` doc row → RETIRE the prose.** `CLI.md:191` ("remains an advanced
   compatibility surface") is false — the verb was deleted at the M5 alias sunset and the parser
   already refuses with corrective naming (`application-cli.mjs:1775-1778`). Delete/rewrite the
   hand prose (it is not generated — the generated CLI block already omits `run.steer`). Pin R6.
3. **Eight facade ports whitelisted but web refuses → DOCUMENT the refusal (ledger).** The D1
   web leg flags every `CLI_WEB_COMMANDS` name whose transport is absent from the web admission
   (G2) unless the divergence is ledgered. The eight facade names (`application-cli.mjs:29-31`)
   are contracted (#87+#48) but not landed on the web bus (zero occurrences in
   `web-northbound.mjs`, G2); each gets a ledgered row in `surface-divergence-ledger.json`
   naming the refusal (`'unsupported command'`, `web-northbound.mjs:405`) and cross-referencing
   #87. The CLI verbs stay documented and parsed (their parse branches exist —
   `application-cli.mjs:1430/1456/1476/1513/1552`); the ledger is the documentation of the web
   refusal, so the whitelist becomes honest without regressing the facade surface and without
   force-landing the eight web ports (a separate issue). Pin R7.
4. **MCP initialize → non-MCP `context.briefing` → RETIRE the resolution promise.** The trailing
   initialize sentence (`mcp-northbound.mjs:1367`) must not point an MCP client at a command with
   no MCP tool (G9). Drop the "resolve via …" suffix; the note states the briefing pack is an
   embedded-only data note (the D6a bounded-sentence design), or names a real MCP tool
   (`baton_context_eval`, `:758`). Pin R8.
5. **`{decision}` advertised-but-refused → RETIRE it from the schema, AND close the acceptance
   hole on the second consumer (folded from red-team B6).** Remove the `decision` branch from
   `applicationAnswerSchema` (`mcp-northbound.mjs:359-366`), matching the validator guard
   (`:1021-1023`) and the audit's grammar verdict (`control-surface-audit.md` §3). The guard
   covers `baton_decision_answer` (`:574-577`); **`fleet_run_answer` (`:390`) shares the schema
   but has no answer-shape guard, and `validateApplicationCommandArgs('run.answer',
   {answer:{decision:'allow'}})` accepts it (probe) — so without a second change,
   `fleet_run_answer` would stop ADVERTISING `{decision}` yet still ACCEPT it silently, and the
   approval-settlement hazard the comment at `:1017-1020` records would remain reachable through
   the combined profile.** The closed set must be enforced on BOTH consumers: extend the shared
   accepted-answer-keys guard to `fleet_run_answer` (this fold's choice — one guard, one shared
   `['optionId','text']` constant read by the schema and both consumers, so the schema and the
   guards cannot disagree; the alternative — enforcing in `run.answer`'s arg validation — splits
   the check across two layers and re-opens the drift seam this contract closes). After the edit,
   the schema and both consumers agree on the closed set. Pin R9.
6. **MCP.md wave examples omit `repoId` → WIRE the examples (D4).** Add the required `repoId` key
   to the example shapes at `MCP.md:105-116` (every wave tool leads its `required` array with
   `'repoId'`, G10), and fence each example as a `json` block per the D4 extraction convention.
   Pin R10.
7. **`webBusNames()` undercount → fixed by D2.** The six direct-port wave verbs join the web.bus
   inventory (25 → 31) and the artifact count regenerates. Pin R11.

### D4 — MCP.md/CLI.md example fidelity: examples are executable shapes, proven by the conformance

The renderer/conformance must prove that every example a documented row teaches is an executable
shape — a shape the parser compiles to the named command (CLI) and a shape `validateArguments`
accepts (MCP). This contract adds an **example-shape leg** to the conformance main, beside
`checkSurfaceDocs` (`render-surface-docs.mjs:145`) and `lintProseInventories`:

- **CLI leg (folded from red-team B4/B5).** Every generated row's Example column (the registry's
  `operation.example`, e.g. `application-semantics.mjs:1263`) must compile through `parseBatonCli`
  to the row's operation key, and the taught Verb column must compile to the same canonical
  operation. Because the parse result and the row key use different spellings, the comparison is
  on **canonical operation keys**:
  1. **Fixture substitution.** Each Example column is tokenized; recognized placeholder tokens
     (`ACTION_ID`, `BOARD`, `DIGEST`, `DIR`, `EFFORT`, `EXACT`, `JSON`, `MESSAGE_ID`, `MODEL`,
     `REASON`, `ROLE`, `RUN_ID`, `SCOPE`, `STRATEGY`, `TASK_ID`, `TEXT`, `TYPE`, `WAVE_ID`,
     ...) are replaced with pinned valid fixture values from a committed `PLACEHOLDER_FIXTURES`
     map, then the row is compiled. **This fold chooses fixture substitution over pure
     placeholder-value tolerance** (the red team's alternative) because tolerance — skipping or
     ignoring rows whose values throw `cli_invalid` — would let a row teach a malformed shape and
     stay green; substituting pinned valid fixtures proves the shape compiles end-to-end, which is
     the contract's promise. The fixture map is a committed constant, not a per-run invention.
  2. **Parse-result→operation normalization.** The compiled result is normalized to an operation
     key: `{kind:'command', name}` → `name`; alias-map canonicalization through
     `applicationOperationAliasMap()` (`run.view`→`run.inspect`, `run.do`→`run.act`,
     `run.resume`→`run.resume_work`, `run.retry`→`run.retry_verification`,
     `run.member.view`→`run.workstreams`, `run.member.send`→`run.workstream.notify`,
     `run.member.stop`→`run.workstream.stop`, `run.list`→`runs.list`); and the kind-shaped
     semantic-action results map to their operation keys —
     `{kind:'semantic-action', actionKind:'send'}`→`run.send`, `{kind:'adopt'}`→`run.adopt`,
     `{kind:'export'}`→`run.export`, `{kind:'integrate'}`→`run.integrate`. The row's operation
     key is canonicalized the same way. The assertion is
     `canon(parse(fixture(example))) == canon(row.operation)`.
  3. **Verb column compiled.** The taught Verb column (`application.help` teaches `baton
     application help`, `CLI.md:22`) is compiled through `parseBatonCli` and normalized the same
     way — a row that teaches a refusing spelling is a finding even when its Example column parses
     (at the current HEAD `baton help` parses to `application.help` while the taught `baton application help`
     refuses — a drift path the v1 check missed).
  4. **Value-level refusals are findings.** A row whose example throws `cli_invalid` on a
     placeholder VALUE (`run.approve --plan DIGEST`, `run.message.receipt MESSAGE_ID`,
     `run.scratchpad.elevate --entries JSON`, `run.watch RUN_ID`, `waves.attach WAVE_ID`,
     `waves.progress WAVE_ID`, `waves.start --members JSON` — all red at the current HEAD) or whose example
     parses to a DIFFERENT command than the row (`run.view`→`run.inspect`, `run.do`→`run.act`,
     `run.resume`→`run.resume_work`, `run.retry`→`run.retry_verification`,
     `run.member.view`→`run.workstreams`, `run.member.send`→`run.workstream.notify`,
     `run.member.stop`→`run.workstream.stop`, `run.list`→`runs.list`, `run.send`→semantic-action
     `send`, `run.adopt`→`{kind:'adopt'}`, `run.export`→`{kind:'export'}`,
     `run.integrate`→`{kind:'integrate'}`) is a finding under this leg.
- **MCP leg (folded from red-team B5).** Every tool-example arg-shape in `MCP.md` must include the
  tool's required keys from the tool's own `required` array in
  `ORDINARY_APPLICATION_TOOL_DEFINITIONS` (`mcp-northbound.mjs:690`), `repoId` first for the wave
  tools, **and** must be accepted by the exported per-tool validator — a shared arg-acceptance
  probe over `validateArguments` — not key-presence alone. Key-presence proves shape only; a
  keys-complete but value-invalid example (a `members` item with an invalid `role`/`exact`) would
  pass `required ⊆ keys` and be refused by `validateArguments`. "Executable shape" means the shape
  the validator accepts. Red at the current HEAD: the wave examples (`MCP.md:105-116`) omit `repoId` (G10).
  Green after D3 #6.
- **Example-literal extraction convention (folded from red-team B5).** The v1 "extract the `{...}`
  object literal" mechanism is unconstrained for prose and fragile against wrapped lines and nested
  `{}`. The wave examples at `MCP.md:105-116` are prose numbered items with nested object
  literals. The contract pins the extraction to a named convention: **each MCP tool example is a
  fenced `json` block** (a ` ```json ` fenced literal per example), and the lint extracts from the
  fenced blocks only. This makes the extraction mechanical and gives the D4 MCP leg a stable input
  surface; D3 #6 (add `repoId`) lands on the fenced blocks.
- **Answer-shape closure.** The advertised answer schema (`applicationAnswerSchema`) must be a
  subset of what `validateArguments` accepts. To make it mechanical, the accepted-answer-keys set
  (`['optionId','text']`, `mcp-northbound.mjs:1023`) becomes a shared exported constant that both
  the schema and the guard read — one source, so the schema cannot advertise a form the guard
  refuses, and (folded from red-team B6) **both consumers** — `baton_decision_answer` and
  `fleet_run_answer` — read the guard, so neither can accept a retired form (this is the MCP leg
  of D1's closure 3).
- **The checks are gate-executable.** Every leg is in-process (table imports, `parseBatonCli`,
  the exported validators, committed-file reads); no network, no host state, no live providers —
  the same offline envelope as the already-green `node impl/scripts/surface-conformance.mjs`.

---

## Refusal vocabulary

The contract mandates a closed refusal naming for the class; every parser branch either admits or
refuses with a code in this set, never a silent fallback.

| Code | Surface | Meaning | Model / corrective naming |
|---|---|---|---|
| `cli_command_unavailable` | CLI | A documented-but-unserved or unknown verb. The `waves` branch is the model: `expected waves list, progress, start, attach, or run` (`application-cli.mjs:1384`) and `steer was deleted at the M5 alias sunset; use run send` (`:1778`) — closed naming + the RIGHT verb. **Replaces** the silent `parseStart` fallback (`:1578`). | `application-cli.mjs:1320-1324, 1380-1384, 1775-1778` |
| `cli_invalid` | CLI | A malformed argv for a real verb (e.g. `baton run watch RUN_ID` at the current HEAD — but after D3 #1 `watch` is real, so `cli_invalid` remains only for genuinely malformed shapes). The default code of `cliError` (`application-cli.mjs:50`). | `application-cli.mjs:50` |
| `unsupported command` | web | A command absent from the admission map (`web-northbound.mjs:405`). Kept as the closed web naming; the D1 web leg makes every CLI-dispatchable name either admitted or ledgered (D3 #3). | `web-northbound.mjs:405` |
| `invalid_arguments` | MCP | An answer/arg shape the validator refuses — the accepted answer keys are exactly `optionId`/`text` (`mcp-northbound.mjs:1023`), shared with the schema (D4). The guard applies to **both** answer consumers — `baton_decision_answer` AND `fleet_run_answer` (folded from red-team B6) — so the closed-set naming is complete for the combined profile, not just the decision tool. | `mcp-northbound.mjs:1021-1023` |

**The silent-reinterpretation law.** No parser branch may compile an unknown verb into a DIFFERENT
command (`application-cli.mjs:1578` is the single offender; audit §2 #3). The fallback for an
unknown verb is always the closed refusal with the corrective naming.

---

## Red-first acceptance pins

All pins are RED in this tree (`049e91e`) and GREEN after the implementation; each pins one
disposition from D3/D4. The red state was re-verified at the current HEAD with live probes.

| Pin | Assertion | Red at the current HEAD (verified) | Green after |
|---|---|---|---|
| R1 | The conformance main flags `run.watch` as documented-but-not-parsed (D1 CLI closure 1). | Yes — `servedCliOrdinaryKeys()` renders it (`CLI.md:51`), `parseBatonCli(['run','watch','R'])` throws `cli_invalid`. | D3 #1 wires the verb. |
| R2 | The web.bus inventory equals the card's advertised set (the dot-name projection at `web-northbound.mjs:1521`). | Yes — `webBusNames()` is 25, the card lists 31 (G7). | D2 aligns the derivation. |
| R3 | The MCP answer schema advertises exactly what the validator accepts, on BOTH answer consumers. | Yes — `applicationAnswerSchema` has `{decision}`, the guard accepts `optionId`/`text` only, and `fleet_run_answer` accepts `{decision}` with no guard (G8). | D3 #5 removes `{decision}` and extends the guard to `fleet_run_answer`; D4 shares the keys constant. |
| R4 | `baton run watch RUN_ID` compiles to the `run.watch` command; `baton run watch` does NOT compile to `run.start`. | Yes — the first throws `cli_invalid`, the second silently compiles to `run.start` objective `'watch'` (G4). | D3 #1 adds the `watch` branch. |
| R5 | The conformance main's CLI example-shape leg is green: every generated row's Example **and taught Verb** columns parse, through fixture substitution and alias/kind normalization, to the row's canonical operation (D4). | Yes — the leg is red on **19 of the 35 served rows** at the current HEAD (7 value-placeholder `cli_invalid` throws + 12 parse-to-a-different-command mismatches, probed; `baton run watch RUN_ID` at `CLI.md:51` is one of the 7), and `application.help` teaches `baton application help` which refuses. | D3 #1 wires `run watch`, AND the D4 leg re-specification (fixture substitution + alias/kind normalization + verb-column compile) — R5 is green only when BOTH land; D3 #1 alone does not green it. |
| R6 | `CLI.md` contains no live `run steer` claim. | Yes — `CLI.md:191` claims it "remains an advanced compatibility surface". | D3 #2 retires the prose. |
| R7 | Every `CLI_WEB_COMMANDS` name is web-admitted or ledgered; no unledgered whitelisted-but-web-refused name. | Yes — the eight facade ports (G2) are unledgered. | D3 #3 ledgers them. |
| R8 | The MCP initialize instruction names only existing MCP tools. | Yes — `context.briefing` has no MCP tool (G9). | D3 #4 fixes the sentence. |
| R9 | `applicationAnswerSchema` has no `decision` branch, and neither answer consumer accepts one. | Yes — the branch is present (`mcp-northbound.mjs:362`), and `fleet_run_answer` accepts `{decision}` with no guard. | D3 #5. |
| R10 | The MCP.md wave example shapes include every required key, `repoId` first, and pass `validateArguments`; each is a fenced `json` block. | Yes — `MCP.md:105-116` omit `repoId` (G10) and are prose. | D3 #6, D4 MCP leg + extraction convention. |
| R11 | `counts.webBusCommands` in the committed artifact is 31 (the admission), `counts.parserLifecycleActions` derives from the exported `cliParsedCommandNames()` compile-set (29 at the current HEAD; 30 after D3 #1 wires `watch`), and the artifact regenerates byte-stably. | Yes — the artifact records 25 and 28 respectively (G7, B7). | D2 + D1 CLI leg + regen. |

---

## Open questions

1. **`run watch`: wire vs. channel-only.** This contract wires `baton run watch` as a CLI verb
   (D3 #1). The CLI already teaches its channel verbs (`progress`/`events`/`output`, all
   `run.watch` aliases — `application-semantics.mjs:1878-1880`). Is the `watch` alias the right
   completion, or should the CLI doc teach only the channels and retire the `run.watch` row? The
   registry treats them as one operation either way.
2. **The eight facade ports: ledger vs. landing.** This contract documents the web refusal in the
   divergence ledger and leaves the web ports to #87. Should the facade web ports be pulled
   forward (wiring them ends the ledger rows), or is the ledgered refusal the permanent posture
   until #87 lands?
3. **The kernel/authoring literals boundary.** `COMMAND_CAPABILITY` admits 19 kernel literals
   (`web-northbound.mjs:88-90`) beyond the 31 application commands. The web.bus inventory counts
   application commands only; should the full admission (50) be the documented web surface, or is
   the kernel authoring lane a separate class the inventory should keep out? The D1 web leg
   enforces the application-command closure either way, and the new inventory-vs-literals disjoint
   check (D1) keeps the boundary mechanical.
4. **The card vs. canonical transports.** The card (`web-northbound.mjs:1521`) lists
   `WEB_APPLICATION_ENTRIES + WAVE_WEB_ENTRIES` dot names; `CANONICAL_WEB_ENTRIES` (the M4b
   canonical underscore transports) are admitted but not on the card. Does the D1 web leg require
   the card to list the canonical transports too, or is the registry's alias map the documented
   map for them? The dot-name projection (D1) resolves the comparison by construction either way.
5. **MCP initialize's `context.briefing`.** This contract retires the resolution promise (D3 #4).
   Should a real `baton_context_briefing` MCP tool be landed instead (the embedded pack read has no
   MCP projection at the current HEAD, so a client with no embedded surface cannot read the pack)?
