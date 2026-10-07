<!-- Slice report of the 2026-09-14 deep codebase audit. Author: Claude Opus 5 reading agent (audit-surfaces), dispatched read-only by the root orchestrator (Claude Fable 5.1) at master f2ea904c. The root's synthesis, verification status of each item and the fixes taken are in root.md; this file is the slice report as delivered, unedited. -->

# Baton control-surface audit: application, CLI, MCP, web

Slice: `impl/src/application.mjs`, `application-deployment.mjs`, `application-cli.mjs`, `application-client.mjs`,
`application-semantics.mjs`, `control-surface-unification.mjs`, `mcp-northbound.mjs`, `mcp-web-bridge.mjs`,
`web-northbound.mjs`, `resident-authority.mjs`, `local-web-transport.mjs`, `impl/scripts/baton.mjs`,
`mcp-stdio.mjs`, `mcp-web.mjs`, `surface-gate.mjs`, `impl/CLI.md`, `impl/MCP.md`.

Method: read the surface files; probed the live registry, the web envelope validator, the CLI parser and the
MCP tool tables read-only via `node`; drove the documented MCP stdio entry point as a real subprocess against a
scratchpad descriptor. No repo file was modified and no tests were run. `git status` clean for this agent.

64 items: 20 ERRORS, 10 GAPS, 15 FRICTIONS, 12 IMPROVEMENTS, 7 NOVEL INSIGHTS, plus the five to fix first.

---

## ERRORS

### E1. The documented MCP entry point cannot authenticate a single tool call. Confidence: HIGH
`impl/src/mcp-descriptor.mjs:186-188` builds the principal as
`{ userId, sessionId: 'descriptor:<user>', capabilities, repoIds: [descriptor.repo] }` — **no `expiresAt`, no
`revoked`**. `impl/src/mcp-northbound.mjs:1611-1613`:

```js
const expiresAt = Date.parse(p.expiresAt);
if (!nonempty(p.userId) || !nonempty(p.sessionId) || p.revoked === true
  || !Number.isFinite(expiresAt) || expiresAt <= this.now()) return 'unauthenticated';
```

`Date.parse(undefined)` is `NaN`, so `_authority` refuses unconditionally and permanently. Proven live by
running `node impl/scripts/mcp-stdio.mjs <descriptor.json>` (the exact command at `impl/MCP.md:10`) and calling
three different tools:

```
id 3 baton_deployment_doctor {"repoId":"repo-a"}          => {"ok":false,"error":{"code":"unauthenticated"}}
id 4 baton_deployment_doctor {"repoId":"<real repo path>"} => {"ok":false,"error":{"code":"unauthenticated"}}
id 5 baton_run_start         {...valid intent...}          => {"ok":false,"error":{"code":"unauthenticated"}}
```

Every descriptor-driven server — the documented distribution story at `impl/MCP.md:3-13`, `:51-53`, `:59-81` —
is dead on arrival. `createMcpServerFromDescriptorPath` (`mcp-descriptor.mjs:204-208`) has no other branch.

### E2. A `surface: "application"` descriptor advertises 72 tools, 17 of which cannot be called. Confidence: HIGH
`impl/scripts/mcp-stdio.mjs:32` wraps every server with `wrapProductionMcpServer(rawServer, { expandNative: true })`.
`impl/src/production-mcp-convergence.mjs:656-668`:

```js
const shadow = async () => {
  if (!expandNative || server.surface === 'advanced' || server.surface === 'combined') return null;
  shadowPromise ??= createAdvancedShadow(server);
  return shadowPromise;
};
const listedTools = async () => [ ...(server.toolDefinitions ?? []),
  ...(advanced?.toolDefinitions ?? []), ...COMPLETE_UNIFIED_MCP_META_TOOL_DEFINITIONS ];
```

so an **ordinary** surface gets the *advanced shadow's* tools merged into `tools/list`
(`production-mcp-convergence.mjs:692-694`). Live `tools/list` on the ordinary descriptor returned **72 tools**,
including the whole `fleet_*` kernel family and six undocumented `baton_surface_*` tools. But the dispatch guard
at `mcp-northbound.mjs:1676` gates on `this.toolNames`, and the proxy's `toolNames` getter
(`production-mcp-convergence.mjs:683-685`) extends it **only with META names**, not the shadow. Live calls:

```
fleet_list         => {"jsonrpc":"2.0","id":9,"error":{"code":-32602,"message":"Invalid params"}}
fleet_capabilities => {"jsonrpc":"2.0","id":12,"error":{"code":-32602,"message":"Invalid params"}}
fleet_spawn        => {"jsonrpc":"2.0","id":10,"error":{"code":-32602,"message":"Invalid params"}}
```

17 advertised-and-uncallable tools. `impl/MCP.md:46` promises the opposite: "`advanced`/`combined` are explicit
kernel-control deployments." The `initialize` instructions string (augmented at `production-mcp-convergence.mjs`,
observed live) also advertises `baton_surface_catalog` / `baton_surface_watch`, which appear in neither MCP.md
nor the unified registry.

### E3. `run.scratchpad.append` is declared TWICE with conflicting contracts. Confidence: HIGH
`impl/src/application-semantics.mjs:1741-1752` and `:1762-1773` both key `'run.scratchpad.append'`:

| | first row (`:1741`) | second row (`:1762`) |
|---|---|---|
| capabilities | `['observe']` | `['control','observe']` |
| surfaces | `embedded, mcp, cli` | `embedded, mcp, cli, web` |
| required | `['runId','scope','body']` | `['runId','scope']` |
| body | `{type:'string'}` | `oneOf string/object/array` |
| effect | `control` | `control` |

`canonicalOperations` is built with `.map()` at `application-semantics.mjs:2076`, so **both rows survive**.
Probe output:

```
DUPLICATE CANONICAL KEYS: [ [ 'run.scratchpad.append', 2 ] ]
resolve() picks: caps ["control","observe"], required ["runId","scope"]   <- byKey Map: LAST wins
cli   count=66  dup transport names= [ 'baton run scratchpad append' ]
mcp   count=75  dup transport names= [ 'baton_run_scratchpad_append' ]
embedded count=85 dup transport names= [ 'run.scratchpad.append()' ]
```

`indexSurface` (`control-surface-unification.mjs:113-143`) early-returns at `:121` when `prior.key === key`, so
the duplicate raises **no conflict and no shadow**: the surface index keeps the FIRST row while `byKey`
(`:162`) keeps the LAST. Advertised schema and validated schema can therefore disagree. Note the first row
declares an `observe`-only capability for an effectful write.

Secondary consequence: the first row says `body` is **required**; the winning row says it is optional
(`required: ['runId','scope']`) while `_normalizeScratchpadAppend` (`application.mjs:13403`) refuses when
`body` is absent. An agent following the advertised schema is refused.

### E4. Three web commands crash the envelope validator; the crash escapes as an unhandled rejection. Confidence: HIGH
`impl/src/web-northbound.mjs:118-120` builds `DEPLOYMENT_ARG_FIELDS` and **never spreads it** into `ARG_FIELDS`
(`:183-219`). `:105-107` builds `WAVE_DOT_ARG_FIELDS` as
`WAVE_WEB_ENTRIES.map(([transport, name]) => [name, WAVE_ARG_FIELDS[transport]])`, and
`WAVE_ARG_FIELDS['run_scratchpad_append']` does not exist (`:88-98`), so the dot key maps to `undefined` and
overwrites nothing at `:213`. Then `:604-605`:

```js
const allowed = ACCEPTED_ARG_FIELDS[envelope.command] ?? ARG_FIELDS[envelope.command];
const unknownArg = Object.keys(envelope.args).find((key) => !allowed.has(key));
```

Verified by importing the module's own exported validator with a fully-formed envelope:

```
deployment_doctor      {}                                   => null   (empty args never reach .has)
deployment_doctor      {"check":true}                        => THROWS TypeError: Cannot read properties of undefined (reading 'has')
deployment.doctor      {"check":true}                        => THROWS TypeError
run.scratchpad.append  {"runId":..,"scope":..,"body":..}     => THROWS TypeError
run_scratchpad_append  {same}                                => null  (underscore spelling is fine)
```

Escape path: `execute()` calls `validateEnvelope` **outside any try** at `web-northbound.mjs:990`; `handle()`
awaits `execute` with no try at `:1697`; the server callbacks discard the promise
(`(req, res) => northbound.handle(req, res)` at `:2102` and `:2108`, and `:2128` for the local socket server).
No `unhandledRejection` / `uncaughtException` handler exists anywhere under `impl/src` or `impl/scripts`
(checked by scan). Node v25 terminates the process on an unhandled rejection. So an authenticated agent calling
a command the application card advertises hangs its own request and **kills `baton serve` for everyone**.

### E5. The pre-filled `action.do` envelope is invalid for 7 of the 8 action kinds that carry one. Confidence: HIGH
`impl/src/application.mjs:10192-10202` mints the ready-to-send block:

```js
let doInputs = {};
if (kind === 'approve_plan') doInputs = { planDigest: target.planDigest };
else if (['answer_approval','answer_question','answer_decision'].includes(kind))
  doInputs = { requestId: target.requestId, response: clone(inputSchema) };
else if (['nudge_turn','wait_turn','claim_turn'].includes(kind))
  doInputs = { requestId: target.pauseId, response };
```

`act()` at `application.mjs:12658-12670` computes `allowed = Object.keys(action.inputSchema.properties)` and
refuses any supplied key not in it (and any missing required key). Registry probe of the live action schemas:

| kind | schema properties | required | do.inputs keys | verdict |
|---|---|---|---|---|
| approve_plan | (none) | (none) | planDigest | OK — `:12664` pushes `planDigest` into `allowed` |
| answer_approval | decision | decision | requestId, response | REFUSED |
| answer_question | text | text | requestId, response | REFUSED |
| answer_decision | optionId, text | (none) | requestId, response | REFUSED |
| nudge_turn | message | (none) | requestId, response | REFUSED |
| wait_turn | (none) | (none) | requestId, response | REFUSED |
| claim_turn | (none) | (none) | requestId, response | REFUSED |

`requestId` is `serverDerived`, not a schema property. The refusal is a flat
`application_action_input_invalid` at `:12669`. An agent doing the obvious thing — take `action.do` and send it —
is refused on everything except plan approval.

Related: `answer_decision` declares `required: []` but `application.mjs:12756-12762` refuses both-or-neither
(`hasOptionId === hasText`) with the same undifferentiated code. An agent reading the schema concludes nothing
is required and is refused for supplying nothing.

### E6. `baton_run_scratchpad_append` is advertised over the resident bridge and cannot dispatch. Confidence: HIGH
`impl/src/mcp-web-bridge.mjs:35` lists `run.scratchpad.append` in `ORDINARY_COMMANDS`, so `_admits` (`:127-130`)
returns true and the tool survives the `admitsCommand` filter at `mcp-northbound.mjs:1553-1554`.
`CLI_WEB_COMMANDS` at `impl/src/application-cli.mjs:30-49` lists its seven siblings
(`run.scratchpad.read`, `run.scratchpad.elevate`, `run.message.send`, `run.message.receipt`,
`run.attention.watch`, `run.board.post`, `run.board.read`) and **omits append**, so
`BatonWebClient.command` refuses at `:2311`:

```js
if (!CLI_WEB_COMMANDS.has(name)) throw cliError(`unsupported Run command ${name}`, 'cli_command_unavailable');
```

`cliError` (`:66`) sets only `{ code }`, never `wireSafe`, so `laneCraftedToolError`
(`mcp-northbound.mjs:286-291`) flattens it to `{"ok":false,"error":{"code":"command_outcome_unknown"}}` for a
tool that is in the agent's own tool list. Probe confirmation:

```
MCP ordinary commands NOT in CLI_WEB_COMMANDS:
  knowledge.promote, knowledge.settlement_lease, run.scratchpad.append, scratchpad.elevate, scratchpad.settle
```

Note the transport name is derived mechanically at `:2313` (`name.replaceAll('.', '_')`), and
`run_scratchpad_append` IS web-admitted. The **only** thing blocking it is the hand-list.

### E7. The server advertises an episode continuation its own validator refuses. Confidence: HIGH
`impl/src/application.mjs:11348-11356` emits, for episode output content:

```js
const continuation = hasMore || !base.terminal ? {
  operation: 'run.inspect',
  arguments: { runId, depth: 'content', section: 'episode', item: request.item, pageCursor: content.cursor, ... },
} : null;
```

`validateApplicationCommandArgs` at `application.mjs:1904-1905` refuses it:

```js
|| (args.pageCursor !== undefined && !(args.section === 'execution'
  && ['execution:events', 'execution:output'].includes(args.item)))
```

Following the advertised continuation verbatim throws `application_inspect_invalid` (`:1907`). The paging that
actually works is `run.episode` (`:1928`), which the continuation never names.

### E8. An unrecognized `baton run` verb silently starts a provider Run. Confidence: HIGH
`impl/src/application-cli.mjs:1851-1864`: `lifecycleActions` holds 29 legacy verbs; `cliRunVerbTypoRefusal`
(`:1147-1154`) refuses **only** a single-token distance-1 typo of *exactly one* recognized verb; everything else
falls through to `return parseStart(args, action, idempotencyKey, 'change')` at `:1864`. Probed against the real
parser:

```
baton run cancel  => command run.start {"intent":{"objective":"cancel","resultIntent":"change"}}
baton run abort   => command run.start {"intent":{"objective":"abort","resultIntent":"change"}}
baton run delete  => command run.start {"intent":{"objective":"delete","resultIntent":"change"}}
baton run kill    => command run.start {"intent":{"objective":"kill","resultIntent":"change"}}
baton run attach  => command run.start {"intent":{"objective":"attach","resultIntent":"change"}}
baton run wait    => command run.start {"intent":{"objective":"wait","resultIntent":"change"}}
baton run xyzzy   => command run.start {"intent":{"objective":"xyzzy","resultIntent":"change"}}
```

An agent trying to stop or inspect a run **spends provider tokens starting a new one**. With a run ID appended
the refusal blames the wrong token:

```
baton run inspect run:1 => REFUSED cli_invalid: unexpected argument run:1
baton run cancel  run:1 => REFUSED cli_invalid: unexpected argument run:1
baton run pause   run:1 => REFUSED cli_invalid: unexpected argument run:1
baton run logs    run:1 => REFUSED cli_invalid: unexpected argument run:1
```

This is the only finding in the report that costs money and creates durable state when an agent guesses wrong.

### E9. Every `repoId` example in MCP.md is wrong. Confidence: HIGH
`impl/src/mcp-descriptor.mjs:140` — `const repoId = descriptor.repo;` — and `:195` — `repoIds: [descriptor.repo]`.
The accepted value is the **absolute repository path** from the descriptor, e.g.
`/absolute/path/to/your/repository`. `impl/MCP.md` uses `"repoId": "repo-a"` at lines 112, 121, 128, 132, 141,
150 and 154. A literal copy of any documented example is refused at `mcp-northbound.mjs:1616`
(`!this.repoIds.has(args.repoId)`) with a bare `forbidden` that never names the expected value. Confirmed live
(id 3 above used `"repo-a"`).

### E10. `runs.list` becomes permanently unusable past 64 runs. Confidence: HIGH
`impl/src/application.mjs:12484-12486`:

```js
if (authorized.length > MAX_RUN_LIST_ITEMS) {
  throw applicationError('Run list requires bounded continuation support', 'application_run_list_continuation_required');
}
```

`MAX_RUN_LIST_ITEMS = 64` at `:60`; the result pins `continuation: null` at `:12527`; the command declares
`args: []` at `:179`, so there is **no cursor, filter or limit** a caller can pass. A deployment that accumulates
65 runs loses run listing forever. Sibling hardcoded ceilings with the same character:
`MAX_RUN_VIEW_WORKERS = 1_024` at `:59` (thrown from `runWorkerOwnership` at `:2419-2422`, reached from every
read path, so a 1025-worker run becomes unreadable by `run.status`, `run.inspect`, `run.follow`, `runs.list` and
`run.act` simultaneously), `MAX_ATTENTION = 64` at `:61`, and `MAX_CONTINUATION_PAGES = 64` at
`application-cli.mjs:2321`. All four are control-mechanism numbers with no physical-resource derivation, which
the project's own CLAUDE.md "No Arbitrary Numeric Limits" rule forbids.

### E11. `_authority` returns `forbidden` for both a capability shortfall and a repo mismatch. Confidence: HIGH
`impl/src/mcp-northbound.mjs:1614-1616`:

```js
if (!Array.isArray(p.capabilities) || !requiredCapabilities.every((c) => p.capabilities.includes(c))) return 'forbidden';
if (!this.repoIds.has(args.repoId) || !Array.isArray(p.repoIds) || !p.repoIds.includes(args.repoId)) return 'forbidden';
```

An agent cannot tell "you lack `approve`" from "you named the wrong repository" — and per E9 the second is the
common case. The same file already knows how to do better: `:1765-1768` composes
`this principal lacks the ${missing.join(', ')} capability the action requires` with
`{ required, held, missing }`.

### E12. `close()` asserts the lease BEFORE withdrawing the publication. Confidence: HIGH
`impl/src/resident-authority.mjs:422-430`:

```js
this.lease.assertHeld();
this.publicationLease.assertHeld();
... if (this._publication) { removeIfExact(selector); removeIfExact(profile); removeIfExact(token); }
```

Either `assertHeld` throws `application_host_lease_lost` before any removal and before the `unlinkSync`
at `:439`, leaving selector + profile + token + socket file all intact and pointing at an exiting process.
Every later client then reads `state: 'configured'` and fails at connect with the misleading network message
(F10). This is the state that produces the most common resident failure.

### E13. A failed publication orphans a live token file. Confidence: HIGH
`impl/src/resident-authority.mjs:393-394` writes token and profile atomically; `:396-400` may then throw
`application_host_reconciliation_required`; `this._publication` is only assigned at `:403`; `close()` gates all
three removals on `if (this._publication)` at `:426-430`. The startup catch at
`impl/src/application-deployment.mjs:1784-1789` revokes the session but cannot clean the files, so
`~/.config/baton/connections/resident-*.token` accumulates.

### E14. Any `mkdirSync` errno on the lease directory is reported as a busy resident. Confidence: HIGH
`impl/src/resident-authority.mjs:151-153`:

```js
if (error?.code !== 'EEXIST' || reclaimed) { throw residentError('resident host is already active', 'application_host_busy'); }
```

`EACCES`, `EROFS`, `ENOSPC`, `ENOTDIR` on an unwritable deployment root all tell the agent to go find a resident
that does not exist. The true cause is unrecoverable from the message.

### E15. `/v1/action-authority` reports envelope validation failures as `403 forbidden`. Confidence: HIGH
`impl/src/web-northbound.mjs:1629-1632`:

```js
if (validateEnvelope(envelope) || !principal.capabilities.includes('observe')) return error(403, 'forbidden');
```

Malformed `args` and a missing capability collapse into one code, discarding the typed code and `field` the same
validator hands `/v1/commands` at `:1000-1002`. An agent chases a permissions problem it does not have.

### E16. A `200` with `ok: true` can wrap a failed command. Confidence: MEDIUM-HIGH
`impl/src/web-northbound.mjs:1806-1811` returns `result(200, { ok: true, command: { ..., outcome: json(command.outcome) } })`
where `outcome` may be `{ httpStatus: 409, body: { ok: false, error: {...} } }`. The top-level `ok` means "the
record was found", not "the command succeeded". An agent keying on `ok` reads a failure as a success.
Adjacent: `:1080` returns `error(409, 'invalid_command')` — a 400-class code under a conflict status.

### E17. The MCP bridge pins the session digest at construction. Confidence: MEDIUM-HIGH
`impl/src/mcp-web-bridge.mjs:108` captures `this._sessionDigest` once; `_attestSession` (`:137-146`) re-fetches
`/v1/session` on **every** command and compares against that frozen value. Any refresh that moves `expiresAt`
makes every later tool call throw `application_unauthorized`, mapped to `forbidden`, until the MCP server is
restarted. It also costs one extra HTTP round trip per tool call, and `authorizeReplay` (`:217`) adds two more.

### E18. `baton_deployment_doctor` over the bridge returns a fabricated ready answer. Confidence: MEDIUM-HIGH
`impl/src/mcp-northbound.mjs:2111-2112` calls `_freshDoctorReadiness()`, which probes `this.doctorReadiness`,
`this.application.doctor` and `this.application.doctorReadiness`. `BatonWebApplicationFacade`
(`mcp-web-bridge.mjs:119-264`) implements none of them — it exposes only `card`, `principal`, `actionAuthority`,
`authorizeReplay`, `command` — so the hardcoded stub at `mcp-northbound.mjs:2436-2447` answers with
`{ schemaVersion: 1, routes: [], workspace: { state: 'ready' } }`. The tool `impl/MCP.md:84` and `:91-93` call
"the quota-free route-picking prerequisite" silently reports zero routes and always-ready.

### E19. `exactKeys` runs before the schema-version check. Confidence: HIGH
`impl/src/application-cli.mjs:248-253` computes `resident = repository.schemaVersion === 2`, calls `exactKeys`
with the v1 key list for anything else, and only then checks `![1, 2].includes(repository.schemaVersion)`.
A future schema-3 selector fails with `repository connection configuration has unknown or missing fields`
(`:71`) instead of an unsupported-schema refusal. Duplicated at `:554-558`.

### E20. Duplicate object key in the authority digest projection. Confidence: HIGH that it is a defect, LOW that it changes behaviour
`impl/src/application-semantics.mjs:2120` and `:2123` both assign `transportHidden: entry.transportHidden` inside
the same object literal of `authorityProjection.canonicalOperations`. Same value today, but this literal is what
`authorityDigest` (`:2138`) — the value MCP sessions pin against — is computed from.

---

## GAPS

### G1. The ordinary MCP surface has no tool for most of the Run lifecycle
Measured from `mcpApplicationToolNames()` + `commandForTool()` (`impl/src/mcp-northbound.mjs:1050-1052`):
**47 tools covering 39 distinct commands**. Absent from the ordinary surface:

```
run.approve  run.adopt  run.review  run.integrate  run.export  run.evidence
run.select   run.feedback  run.revise  run.recover  run.resume  run.retry
run.send     run.interrupt  run.wait  run.follow  run.status
run.board.post  run.board.read
```

The advanced tools for all of these exist at `mcp-northbound.mjs:509-527` (`fleet_run_approve`, `fleet_run_adopt`,
`fleet_run_review`, `fleet_run_integrate`, `fleet_run_export`, `fleet_run_evidence`, `fleet_run_wait`,
`fleet_run_follow`, `fleet_run_answer`, `fleet_run_feedback`, `fleet_run_recover`, `fleet_run_status`) but only
on surfaces `impl/MCP.md:46` calls "explicit kernel-control deployments". So on the **documented default**
surface, `baton_run_start` returns "a readable Plan awaiting approval" (`mcp-northbound.mjs:509`) that the agent
has no tool to approve. 17 web-admitted commands have no ordinary MCP tool at all.

### G2. The only escape hatch for G1 is an untyped object
`impl/src/mcp-northbound.mjs:589`:

```js
inputSchema: schema({ ...repo, ...idem, runId, actionId: runId, inputs: { type: 'object' } },
  ['repoId', 'idempotencyKey', 'runId', 'actionId', 'inputs'])
```

`inputs` is REQUIRED and completely untyped on the wire. The narrowed per-action schema **does** exist
(`application.mjs:10209`, plus `choices`, `serverDerived`, `requiredCapabilities`, `freshness`) but only on the
`outline` projection, so the agent must make a second round trip to learn the shape — and per E5 the pre-filled
envelope it finds there is invalid.

### G3. Four MCP-dispatched commands are not web-admitted, so they are dead over the resident bridge
`knowledge.promote`, `knowledge.settlement_lease`, `scratchpad.elevate`, `scratchpad.settle`
(`mcp-northbound.mjs:1038-1049` EXPLICIT_TOOL_COMMANDS) are absent from `webAdmittedCommandNames()`
(`web-northbound.mjs:2140-2142`). `impl/MCP.md:160-176` documents all four as the settlement lane. Naming hazard:
`scratchpad.elevate` is a **different operation** from the web's `run.scratchpad.elevate`, and `board.post` from
`run.board.post`.

### G4. `run.attention.list` is declared on the CLI surface and the parser refuses it
`impl/src/application-semantics.mjs:1363-1368` declares `surfaces` defaulting to all four with example
`baton run attention list RUN_ID`. Probe: `baton run attention list run:1` => `REFUSED cli_invalid: expected attention watch`.

### G5. The registry's taught example for `run.scratchpad.append` does not parse
`impl/src/application-semantics.mjs:1766` teaches
`baton run scratchpad append RUN_ID --scope shared --kind note --body TEXT`. Probe:
`baton run scratchpad append run:1 --scope shared --body x` => `REFUSED cli_invalid: unexpected argument append`.
The sibling verbs parse fine (`run scratchpad read`, `run scratchpad elevate`).

### G6. `card().commands` hides roughly 25 commands the bus accepts
`impl/src/application.mjs:12925` publishes `Object.keys(APPLICATION_COMMAND_DEFINITIONS)` (36 keys) plus ten
canonical aliases, while `_commandDispatch` services the workflow eight at `:13003-13011`, `run.debug` at
`:13033`, the settlement four at `:13048`, the seven wave ports at `:13066-13079`, `deployment.doctor` at
`:13080` and `context.briefing` at `:13084`. An agent that trusts the card cannot discover any of them.

### G7. CLI.md's prose documents verbs its own generated table omits
`impl/CLI.md:166-194` teaches `baton doctor`, `baton doctor --check`, `baton explore`, `baton review`,
`baton run status`, `baton run interrupt`, `baton run show --depth`, `baton run progress`, `baton run events`,
`baton run output`, `baton route`, `baton credentials install kimi`, `baton setup`, `baton serve`. **None**
appears in the generated inventory at `impl/CLI.md:22-69`, which is the table the doc calls
"never a hand list" and "the conformance suite fails if they drift from served truth" (`:16`).

### G8. No `nextCursor` on the web stream, and three continuation spellings coexist
Stream cursor is the SSE `id:` line plus `frame.cursor` (`impl/src/web-stream.mjs:414-420`, `:549-552`); the
terminal page calls `disconnect('stream_terminal'); endSocket()` with no end event (`:826-830`); the initial
snapshot and the shutdown frame are written with `id === null` (`:725`, `:813`), so a disconnect right after the
snapshot leaves no resumable cursor. List commands use `continuationCursor` (`application-cli.mjs:2461-2487`).
MCP wave progress uses `{cursor, nextCursor}` (`impl/MCP.md:115-116`). Tickets are single-use
(`web-stream.mjs:359`) and `_openRun` requires byte-equality with the cursor baked into the ticket
(`:654-663`), so an `EventSource` `last-event-id` auto-reconnect always 409s.

### G9. Semantic actions vanish below `outline` depth
`impl/src/application.mjs:11289` populates `outline.actions`; the `index`, `section`, `item`, `content` and
`evidence` branches at `:11298-11400` return no `actions` key, and `_historicalProfileInspection` hardcodes
`actions: []` at `:10999`. An agent that drilled into `section: 'execution'` to understand a block must re-fetch
`depth: 'outline'` to act, and nothing in the response says so.

### G10. `baton_deployment_doctor` requires `repoId`, and there is no MCP-reachable way to learn it
`impl/src/mcp-northbound.mjs:1178` — `if (!nonempty(args.repoId)) return 'invalid_repo';` — applies to **every**
tool. `bindApplicationContext` (which server-derives `repoId`, `:1692-1706`) is set only by
`mcp-web-bridge.mjs:330`, never by the descriptor path. The `initialize` instructions (`:1658`) do not carry the
repoId, and `tools/list` does not either. The documented route-picking prerequisite (`impl/MCP.md:84`, `:91-93`)
is gated behind the exact value it would be used to discover.

---

## FRICTIONS

### F1. Validator refusals never name the offending field
`impl/src/mcp-northbound.mjs:1707-1714` renders a bare string return as `toolError(invalid)` with no message,
no field, no detail. `validateArguments` (`:1166-1180`) returns bare strings for `invalid_arguments`,
`unknown_argument_field`, `missing_argument`, `invalid_repo`, `invalid_idempotency_key`,
`expected_fence_required`, `invalid_run_command`. Observed live on the real server:

```
baton_runs     {"repoId":"<path>","bogus":1} => {"ok":false,"error":{"code":"unknown_argument_field"}}
baton_run_view {"repoId":"<path>"}           => {"ok":false,"error":{"code":"missing_argument"}}
```

The offending key is in hand at `:1174`; the missing key is in hand at `:1177`. The web surface already does
this right: `web-northbound.mjs:608-611` returns `{ code: 'unknown_argument_field', field, message }`.

### F2. Every refusal outside four lanes is stripped to a bare code
`impl/src/mcp-northbound.mjs:286-291`:

```js
if (!LANE_CRAFTED) {
  return cause?.wireSafe === true
    ? toolError(stateCode, cause.message, cause.detail ?? null, cause.field)
    : toolError(stateCode);
}
```

`LANE_CRAFTED` is only the coaching size family, `wave_member_invalid`, `wave_not_found` and `workflow_*`
(`:283-284`). `cliError` (`application-cli.mjs:66`) sets only `{ code }` and never `wireSafe`, so **every**
refusal arriving from the resident — the web surface's carefully composed message and the full parsed wire error
attached as `error.detail` at `application-cli.mjs:2247-2253` — is discarded.

### F3. `command_outcome_unknown` is the fallthrough for anything unclassified
`impl/src/mcp-northbound.mjs:402`, after a ~200-entry code ladder (`:320-401`). The web equivalent is worse:
`web-northbound.mjs:397` maps every unrecognized throw to `503 temporarily_unavailable / "command dispatch failed"`,
telling an agent to back off and retry something that can never succeed. Same inversion at `:858-860`, `:1406-1409`,
`:1841`, `:1877`, `:1921-1924`, where a permanent transport misconfiguration is reported as transient.

### F4. An unknown tool name returns `-32602 Invalid params`
`impl/src/mcp-northbound.mjs:1676`. Observed live for `baton_run_approve`. No indication that the *name* was the
problem, no list of what exists, no nearest-match hint — and per G1 the tools an agent most naturally reaches for
are exactly the missing ones.

### F5. Wrong `section` / `item` refusals enumerate nothing
`impl/src/application.mjs:11017`:

```js
if (!definition) throw applicationError('Run inspection section is unavailable', 'application_inspect_section_invalid');
```

and `:11033` for items; duplicated in the historical lane at `:11315` and `:11332`.
`APPLICATION_SEMANTIC_REGISTRY.sections` and the computed `items` array are both in scope one line above.
A model guessing `section: 'events'` instead of `'execution'` gets no correction.

### F6. Oversize refusals name no cap and no narrower depth
`impl/src/application.mjs:5996`, `:8166` (`application_run_view_oversize`), `:10246-10247`
(`application_inspect_oversize`), `:12531` (`application_run_list_oversize`) — even though `bounds.maxBytes` is
the adjacent argument at `:10245` and `coachingApplicationError` (`:257-262`) exists precisely to carry
`{cap, actual, unit, gracefulPath}`. It is used 3 times against 498 `applicationError` call sites. There is no
graceful path out of an oversize view.

### F7. Six MCP tool pairs are aliases with no disambiguation
`impl/MCP.md:184-230` lists `baton_application_help` beside `baton_help`; `baton_run_act` beside `baton_run_do`;
`baton_run_episode` and `baton_run_inspect` beside `baton_run_view`; `baton_run_member_send` beside
`baton_workstream_notify`; `baton_run_member_stop` beside `baton_workstream_stop`; `baton_run_member_view`
beside `baton_run_workstreams`. Built at `mcp-northbound.mjs:37-45` and `:879-886`; the clone at `:884` copies
the base description verbatim, so **nothing in the tool description marks the preferred spelling**. An agent
sees six pairs of identically-described tools.

### F8. Two error envelope shapes coexist on one MCP wire
Core tools return `{ok:false, error:{code, message?, detail?, field?}}` (`mcp-northbound.mjs:235-237`).
The undocumented surface family returns a richer shape, observed live:

```json
{"error":{"code":"temporarily_unavailable","message":"MCP surface audit authority is unavailable",
 "detail":null,"field":null,"retryable":true,"action":null}}
```

Note it has no `ok` key at all, plus `retryable` and `action`. The shape the operator's stance asks for already
exists on this wire — and only the undocumented family uses it. The web stream is a third shape:
`web-stream.mjs:8` emits `{status, body:{ok:false, error:{code}}}` with no `message`, and puts the paging hint at
the **body top level** rather than inside `error` (`:406`).

### F9. `baton doctor` swallows the one refusal that carries a remedy
`residentAuthorityRefusal` at `impl/src/application-cli.mjs:2705-2715` names both registry digests and a `next`
("use the CLI of the commit the resident runs, or restart the resident from this checkout"). In
`inspectBatonConnection` it is thrown inside a `try` whose handler is a bare `} catch {` at `:566`, returning
generic `needs_setup` + `{ action: 'repair_setup', command: 'baton setup' }` at `:570`. Protocol drift — the
expected case after any `git pull` — is reported as "run baton setup", which cannot fix it.

### F10. A dead resident is reported as a network problem
`impl/src/application-cli.mjs:2212-2215`:

```js
catch { throw cliError('Baton Web connection failed; check your network and retry', 'cli_transport_failed'); }
```

catches `local_transport_unavailable` (socket file gone), raw `ECONNREFUSED` (resident SIGKILLed, socket file
left behind — the E12 state), and the `AbortController` timeout alike. On a Unix-socket transport there is no
network, and the real remedy, `baton serve`, is never named. Compounding: `discoverBatonConnection` validates
`socketPath` only as a string (`:280-281`) and never `lstat`s it; `inspectBatonConnection` lstats it (`:611`)
but never calls `processState(profile.ownerPid, profile.ownerPidStart)`, so `baton doctor` reports
`state: 'configured'` (`:641-642`) for a resident that was `kill -9`'d.

### F11. `cli_connection_incompatible` conflates ten causes
`impl/src/application-cli.mjs:2526-2543` folds `doctor.ready !== true`, wrong `repoId`, missing required
commands, `agentExperience.registryDigest` drift, `limitsRegistryDigest` drift, session `repoIds` mismatch, and
resident `deploymentId` / `incarnation` mismatch into one
`throw cliError('Baton resident authority is incompatible or not ready', 'cli_connection_incompatible')`.
The registry-digest case is exactly what `residentAuthorityRefusal` knows how to explain with both digests, and
here it is discarded.

### F12. `user connection profile is invalid` covers twelve field violations with no field name
`impl/src/application-cli.mjs:277-286` ORs schemaVersion mismatch, empty `url`/`origin`/`tokenFile`, owner-field
validity, `transport !== 'local'`, non-absolute or oversized `socketPath`, and four selector-versus-profile
equality checks (`deploymentId`, `incarnation`, `registryDigest`, `startedAt`) into one `cli_config_invalid`.
An agent cannot tell "the resident restarted and the incarnation moved", which is recoverable by re-reading,
from "your profile file is corrupt". `cli_config_invalid` covers roughly twenty causes across `:142-292`; the
server-side mirror is `residentError`'s default `application_host_authority_invalid`
(`resident-authority.mjs:10`), emitted for eleven distinct causes at `:36`, `:69`, `:72`, `:107`, `:128`,
`:188`, `:227`, `:232`, `:265`, `:284`, `:336`.

### F13. Authentication refusals on the web surface are information-free
`impl/src/web-northbound.mjs:851-853` returns `error(401, 'unauthenticated')` for absent, malformed, expired,
revoked, wrong-`authMethod`, and cookie-plus-bearer alike. `error(status, code, message = code)` at `:271`
means the body is `{"ok":false,"error":{"code":"unauthenticated","message":"unauthenticated"}}` — no
`WWW-Authenticate`, no expiry, no pointer to a refresh route. An agent cannot tell "refresh your token" from
"you were revoked".

### F14. Idempotency conflicts do not name the axis that moved
`impl/src/application.mjs:3103-3109` compares recipient, delivery, message, reason digest and three principal
fields in one disjunct and refuses `application_control_conflict` with a single message; `:3178-3179` compares
whole request digests. A retrying agent cannot tell a changed message from a changed session.

### F15. The CLI typo detector structurally cannot see the canonical verbs
`resolveCanonicalCliArgs` (`impl/src/application-cli.mjs:1228-1238`) rewrites `run view` to `run show`
**before** recognition, and `lifecycleActions` (`:1851-1854`) holds only the legacy spellings. So the canonical
verbs `view`, `list`, `watch`, `member` are never in the `recognized` set at `:1149`. Probe:
`baton run vew run:1` => `REFUSED cli_invalid: unexpected argument run:1` — the typo detector never fired, and
`run inspect`, the most natural guess for an agent, is likewise uncatchable.

---

## IMPROVEMENTS

Narrow and well-engineered; no new numeric limits.

### I1. Give `validateArguments` its structured return everywhere
The plumbing already exists: `mcp-northbound.mjs:1712-1714` renders `{code, message, field}` when the validator
returns an object, and one arm at `:1211-1213` already uses it. Change the seven bare-string returns at
`:1167-1180` to carry the offending or missing key. No schema change, no wire change, strictly additive detail.

### I2. Reuse the capability-naming refusal shape for the authority gate
`mcp-northbound.mjs:1765-1768` already composes `{ required, held, missing }` with a sentence. Split `_authority`
(`:1614-1616`) into a capability refusal using that exact shape and a distinct `repo_not_served` refusal naming
the served repoId. That one change also resolves the E9 bootstrap, because the refusal would print the value the
agent needs.

### I3. Make the duplicate-key case impossible at construction
`application-semantics.mjs:2076` does `CANONICAL_OPERATION_SPECS.map(buildCanonicalOperation)`. Build a `Map`
from the spec array first and throw on a repeated key. That converts E3 from a silent four-inventory divergence
into a load-time failure, and costs one line.

### I4. Derive `ARG_FIELDS` from one merge with a completeness assertion
`web-northbound.mjs:183-219` omits `DEPLOYMENT_ARG_FIELDS` and mis-keys `WAVE_DOT_ARG_FIELDS`. Assert at module
load that every key of `COMMAND_CAPABILITY` has a defined field set. E4 becomes a startup refusal naming the
missing command instead of a runtime crash.

### I5. Wrap the northbound entry in one failure boundary
`web-northbound.mjs:1697` awaits `execute` bare. One `try` returning `error(500, 'command_dispatch_failed')`
stops any future validator defect from killing the resident, independent of I4.

### I6. Project the action input schema onto the action row an agent can already reach
`application.mjs:10209` already computes the narrowed per-action `inputSchema`. It is emitted on `outline` only.
Emitting it alongside `requiredAction` in `status()` (`:8447-8449`) and in `runs.list` items (`:12496`) removes
G2's extra round trip without changing any tool schema.

### I7. Make `do.inputs` schema-valid, or omit it
For the answer family and turn verbs, either emit only keys `act()` accepts, or drop `do.inputs` entirely for
kinds where no valid pre-fill exists (`application.mjs:10192-10202`). Shipping an envelope that the same file
refuses 2400 lines later is worse than shipping none.

### I8. Enumerate on selector refusals
`application.mjs:11017` and `:11033` both have the valid set in scope. Attach it as `detail`. This removes the
single most common navigation dead end in the progressive cascade and costs no new API.

### I9. Replace the run-list ceiling with the cursor the response already declares
`application.mjs:12527` pins `continuation: null`. Fill it and accept a cursor argument in the `run.list`
definition (`:179`). The page boundary then derives from the byte ceiling already enforced at `:12531`, so
`MAX_RUN_LIST_ITEMS` (`:60`) disappears rather than being replaced by another number.

### I10. Reorder `close()` in the resident
Move the two `assertHeld` calls (`resident-authority.mjs:422-423`) **after** the three `removeIfExact` calls at
`:427-429`. A disturbed lease then still withdraws the publication, which is the single highest-leverage change
for resident reliability.

### I11. Read the owner fields that are already published
`residentProfileOwnerValid` (`application-cli.mjs:80-85`) checks only well-formedness of `ownerPid` /
`ownerPidStart`. `processState()` already exists and is used at `resident-authority.mjs:383-385`. Calling it in
`inspectBatonConnection` turns F10 into an actionable "the resident that published this is gone; run
`baton serve`". The evidence is already on disk and simply unread.

### I12. Set `wireSafe` on client refusals
One flag on `cliError` (`application-cli.mjs:66`) lets every resident refusal keep its message, detail and field
across the bridge, because `laneCraftedToolError` already honours it at `mcp-northbound.mjs:287-289`. This is the
cheapest possible fix for F2.

---

## NOVEL INSIGHTS

### N1. The parity assertion compares the registry to itself, never to what is served
`assertCliMcpControlParity` (`impl/src/control-surface-unification.mjs:287-333`) is called at the top of every
entry point (`baton.mjs:96`, `mcp-stdio.mjs:18`, `mcp-web.mjs:19`). Live output:

```
sharedCommands 58  cliCommands 65  mcpCommands 74
aliasConflicts: []   shadowedAliases: []
```

The MCP surface **actually serves 39 commands across 47 ordinary tools**. Both sides of every comparison in the
function are read from `unifiedSurfaceInventory`, which is a projection of the same registry
(`:299-300`). `assertNoCapabilityDrop` (`:272-285`) compares the registry's own filter against the registry's own
projection. Nothing in the file ever consults a tool table, a CLI parser or a web command map. The gate that
exists to prove "one registry drives both surfaces" is structurally incapable of observing the 35-command
shortfall, and it reports `run.approve`, `run.adopt` and `run.integrate` among the 58 "shared" commands.

### N2. The doc generator hides declared-but-undispatchable rows instead of failing on them
`impl/scripts/render-surface-docs.mjs:56`:

```js
if (!command.operation || !CLI_WEB_COMMANDS.has(command.operation)) continue;
```

and `:73` keeps only keys that survived. That is exactly why `run.scratchpad.append` (E3, E6, G5) and
`run.attention.list` (G4) are **missing from CLI.md** rather than showing up as a conformance failure. The
generated table is the *intersection* of the registry and a hand-list, so it can never disagree with either.
`surface-conformance.mjs:408-409` then derives `cliOrdinaryKeys()` from the same `servedCliOrdinaryKeys()`, and
`checkProfileDocParity` (`:546-584`) compares docs against that. The loop is closed: docs derive from served,
served derives from hand-lists, and the registry's `surfaces` claim is never checked against either.

### N3. The surface gate probes a server that is never shipped
`impl/scripts/surface-gate.mjs:97-116` constructs a **raw** `McpFleetServer` and calls `tools/list` on it. Both
shipping entry points wrap first — `mcp-stdio.mjs:32` and `mcp-web.mjs:28` both call
`wrapProductionMcpServer(rawServer, { expandNative: true })`. The 72-tool production surface, the 17 uncallable
`fleet_*` rows and the undocumented `baton_surface_*` family (E2) are therefore invisible to the gate by
construction. The gate's own comment at `:10-12` claims it proves "every advertised tool on the ordinary and
combined surfaces resolves at tools/call — an advertised name that cannot dispatch is a surface lie". It proves
that for a server nobody runs.

### N4. The gate's resident bridge facade is strictly more permissive than the real client
`impl/scripts/surface-gate.mjs:34`:

```js
const commands = [...new Set([...webAdmittedCommandNames(), ...Object.keys(SWARM_COMMAND_DEFINITIONS)])];
```

so the gate's `bridge._admits('run.scratchpad.append')` is **true** (132 web-admitted names). The real path gates
on `CLI_WEB_COMMANDS` (`application-cli.mjs:30`, 49 names). The check designed to catch advertise-but-refuse
(#270) is calibrated against a looser admission set than production uses. That is precisely how E6 survives a
green gate, and it generalizes: any command in `webAdmittedCommandNames() \ CLI_WEB_COMMANDS` is a latent E6.

### N5. Five hand-maintained lists claim to be one registry
1. `APPLICATION_COMMAND_DEFINITIONS` — `application.mjs:176-218`, 36 keys, carries only arg **names**, no types.
2. `CANONICAL_OPERATION_SPECS` — `application-semantics.mjs:1254-1806`, 75 rows, carries `inputSchema`.
3. `CLI_WEB_COMMANDS` — `application-cli.mjs:30-49`, 49 names.
4. `COMMAND_CAPABILITY` behind `webAdmittedCommandNames()` — `web-northbound.mjs:2140-2142`, 132 names.
5. The MCP tool tables — `mcp-northbound.mjs:71-105`, `:509-527`, `:529-886`, `:1027-1049`.

Nothing mechanically ties `definition.args` to the canonical `inputSchema.properties`. Every shape rule lives in
a separate 200-line if-chain at `application.mjs:1853-2060`. This single fact is the shared root cause of E3,
E6, E7, G1, G4, G5 and G6. The `control-surface-unification.mjs` module is a **sixth** projection layered over
list 2 only, with a header comment (`:18-21`) describing itself as "a correction ledger over the existing
registry, not a replacement registry" — which is an accurate description of why it cannot close the gap.

### N6. The refusal quality the operator wants already exists in four places and is never generalized
- `mcp-northbound.mjs:1765-1768` — names required, held and missing capabilities in a sentence.
- `mcp-northbound.mjs:1678-1683` — names the bound field and the rule: "`repoId` and `idempotencyKey` are bound
  by the server on this surface and must not be supplied", with `{boundFields}` and a `field`.
- `application-cli.mjs:1147-1154` — names the closed live verb set on a typo.
- `web-northbound.mjs:608-611` — names the offending arg key as `field`.

Each is a one-off guarded by a narrow condition. The default path, four to twenty lines away in the same
function, throws all of it out. This is not a missing capability; it is an unpropagated one.

### N7. `baton_surface_*` is a parallel, undocumented control surface with a better envelope
The `initialize` instructions advertise `baton_surface_catalog` and `baton_surface_watch` to **every** connecting
agent (observed live, appended by `production-mcp-convergence.mjs` `augmentInstructions`). Six tools ship:
`baton_surface_catalog`, `_describe`, `_invoke`, `_snapshot`, `_watch`, `_visualize`. None appears in
`impl/MCP.md`, the unified registry, `surface-conformance.mjs`'s inventory, or the CLI/MCP parity matrix. They
carry `retryable` and `action` in their refusals (F8) — the richest envelope on the wire. There is also a
matching CLI half (`parseUnifiedSurfaceCli` / `executeUnifiedSurfaceCli`, `impl/scripts/baton.mjs:100-116`,
`surface-cli.mjs`) that runs **before** `parseBatonCli` and is documented nowhere in CLI.md. Whatever this
family is meant to be, an agent currently meets it first, in the greeting, with no documentation.

---

## The five I would fix first

### 1. E1 — the missing `expiresAt` on the descriptor principal
Every other MCP finding is downstream of a surface that currently cannot serve one call. `mcp-descriptor.mjs:186-188`
needs an `expiresAt` and a `revoked: false`. It is the difference between a documented quickstart that works and
one that is dead on arrival, and it is the reason no one has hit E2, E9 or G10 in practice: nobody can get far
enough to.

### 2. E4 — the validator crash that kills `baton serve`
Reachable by any authenticated caller using a command the application card advertises. It takes down the resident
for every other agent in the session, leaves the socket file behind, and the resulting state then produces E12's
aftermath and F10's misleading refusal. Fix the missing `DEPLOYMENT_ARG_FIELDS` spread and the `WAVE_DOT_ARG_FIELDS`
mis-key (I4) together with the failure boundary at `web-northbound.mjs:1697` (I5) — two edits, one crash class
closed permanently.

### 3. F1 + F2 — refusals that name nothing
This is the operator's stated stance verbatim: "refusals must name the field, the rule and the remedy." It is
also the single largest drag on agentic use, because a bare `unknown_argument_field` costs an agent a full
guess-and-retry loop with no information gain. The structured return already exists
(`mcp-northbound.mjs:1712-1714`) and the `wireSafe` passthrough already exists (`:287-289`). The work is wiring
seven bare returns and setting one flag on `cliError`. Per N6, this is propagation, not invention.

### 4. E8 — the silent run start on an unknown CLI verb
The only finding here that **costs money and creates durable state** when an agent guesses wrong. `baton run kill`
starting a provider Run named "kill" is the worst possible failure mode for a model-driven caller. The fix is
contained to `application-cli.mjs:1855-1864`: refuse any unrecognized first token that is followed by a
run-shaped identifier, and name the verb set. Fold in F15 by seeding `recognized` from the canonical spellings
too, so `run inspect` and `run vew` are both caught.

### 5. N1 + N3 — the gate that cannot see the shipped surface
Everything else on this list was invisible to a green conformance run, which is the real finding. Two changes:
have `surface-gate.mjs` probe the **production-wrapped** server rather than the raw one (`:97-116`), and add one
assertion that every registry row claiming a surface resolves to a name that surface actually serves. That single
assertion would have caught E2, E3, E6, G1, G4 and G5 at authoring time. Without it, fixing items 1 through 4
leaves the mechanism that produced them fully intact.
