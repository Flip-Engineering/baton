SURFACE-AUDIT-ROW v1

# surface-audit-cli.md — CLI surface audit (row-cli, issue #147)

Auditor: row-cli. Surface: the `baton` thin client (`node impl/scripts/baton.mjs …`). Frame:
`audit-brief.md` (shared axes/laws), row brief `row-cli.md`. All `file:line` citations were
read this session. NUL files were read via `grep -an`/`sed -n` only. No clocks. Runtime probes
were parse-level only (no serve, no mutation); every quoted output below was captured live in
this worktree.

**Correction to the row brief's premise:** the brief names "`run_act` with inputs" as an
example of an operation impossible from the CLI. It is NOT impossible — `baton run do
RUN_ID ACTION_ID --inputs JSON` compiles to `run.act` with parsed `inputs`
(`application-cli.mjs:1690-1700`), and the semantic-action two-step (`run send` → inspect →
`run.act`) drives any advertised action by `actionId`. The brief's example is stale; the real
parity gaps are listed in §1.3.

---

## 1. Parity table

### 1.1 Legend and source

CLI column = served truth: a parser branch in `parseBatonCli` (`application-cli.mjs:1208`)
producing a `kind`/`command`, or a host-local dispatch (`run.debug`). "registry-cli" means the
canonical operation's `surfaces` array claims `cli` (`application-semantics.mjs`) but the parser
has no wire — a **ghost grammar** row. Web/MCP are marked only where verified this session
(`CLI_WEB_COMMANDS` at `application-cli.mjs:16-32`; `web-northbound.mjs:39-42`; MCP tool list at
`mcp-northbound.mjs`); `?` = not verified in this row's reading.

### 1.2 Capability × surface

| Lane | Capability | CLI | Web | MCP | Notes |
|---|---|---|---|---|---|
| Run start | Start objective | ✔ `baton run OBJECTIVE` / `run start` (start form; `application-cli.mjs:1091-1140`) | ✔ `run_start` | ✔ | `--exact`, `--model/--effort/--harness`, `--profile`, `--scope`, `--run-id`, `--idempotency-key` |
| Run start | Explore preset | ✔ `baton explore OBJECTIVE` (read-only intent) | ? | ? | `application-cli.mjs:1296-1299` |
| Run start | Review preset (2 exact routes) | ✔ `baton review OBJECTIVE --exact … --exact …` | ? | ? | `application-cli.mjs:1293-1295` |
| Observe | List runs | ✔ `baton runs list` — **no cursor arg** (`application-cli.mjs:1288-1292`) | ✔ | ? | #136; `semantics.mjs:263-266` schema is `{}`; `application.mjs:11982` throws `application_run_list_continuation_required` |
| Observe | Inspect run (progressive cascade) | ✔ `baton run view`/`show RUN_ID --depth outline|index|section|item|content|evidence` (`application-cli.mjs:1633-1688`) | ✔ | ✔ | canonical `run view` rewritten to legacy `run show` (`semantics.mjs:751-754`) |
| Observe | Wait until settled/terminal | ✔ `run view RUN_ID --until settled|terminal [--wait DURATION]` (`application-cli.mjs:1650-1662`) | ✔ | ? | folds `run.wait` |
| Observe | Episode / result / workstreams | ✔ `run episode`, `run result`, `run workstreams` (`application-cli.mjs:1587-1625`) | ? | ? | |
| Observe | Stream progress/events/output | ✔ `run progress|events|output RUN_ID [--follow]` (kind `stream`, `application-cli.mjs:1626-1632`) | ✔ `run_follow` | ? | **canonical `run watch` spelling is dead — §3 F-2** |
| Observe | Evidence manifest | ✔ `run evidence RUN_ID` (`application-cli.mjs:1784`) | ✔ | ? | |
| Steer | Send guidance to current recipient | ✔ `run send RUN_ID TEXT [--to R] [--nudge|--now|--turn]` (semantic-action; `application-cli.mjs:1730-1747`) | ✔ | ✔ | |
| Steer | Interrupt current turn | ✔ `run interrupt RUN_ID [--to R] [--reason]` (`application-cli.mjs:1755-1766`) | ✔ | ✔ | |
| Steer | Approve plan | ✔ `run approve RUN_ID --plan DIGEST` (`application-cli.mjs:1713-1715`) | ✔ | ✔ | |
| Steer | Answer a decision/question | ✔ `run answer RUN_ID REQ (--allow|--deny|--cancel|--text|--option)` (`application-cli.mjs:1718-1728`) | ? | ✔ | |
| Steer | Drive any advertised action | ✔ `run do RUN_ID ACTION_ID [--inputs JSON]` (`application-cli.mjs:1690-1700`) | ✔ | ✔ | `inputs` parse-validated; bad JSON → `cli_action_inputs_invalid` |
| Steer | Select / feedback / revise | ✔ `run select|feedback|revise` (`application-cli.mjs:1805-1827`) | ✔ | ✔ | |
| Steer | Retry / resume | ✔ `run retry RUN_ID --reason`, `run resume RUN_ID --reason` | ✔ | ✔ | |
| Lifecycle | Stop run | ✔ `run stop RUN_ID [--reason]` (`application-cli.mjs:1781`) | ✔ | ✔ | |
| Lifecycle | Stop member | ✔ `run stop-member RUN_ID ROLE` / canonical `run member stop` (`semantics.mjs:769-771`) | ✔ | ✔ | |
| Lifecycle | Adopt / integrate / export | ✔ `run adopt`, `run integrate --strategy`, `run export DIR` | ✔ | ✔ | |
| Member/message | Member view / send | ✔ canonical `run member view|send` → legacy `run workstreams|notify` (`semantics.mjs:755-762`) | ? | ? | |
| Member/message | Message send / receipt | ✔ `run message send`, `run message receipt` (`application-cli.mjs:1430-1451`) | ✔ | ? | |
| Member/message | Attention watch | ✔ `run attention watch RUN_ID --kind K --cursor C` (`application-cli.mjs:1456-1473`) | ✔ | ? | |
| Member/message | **Attention list** | ✘ **ghost** — registry `run.attention.list` claims default surfaces incl cli (`semantics.mjs:1333-1336`); parser has only `attention watch` (`application-cli.mjs:1457`) | ? | ? | `baton run attention list` → `expected attention watch` |
| Facade | Board post / read | ✔ `run board post`, `run board read` (`application-cli.mjs:1515-1546`) | ✔ | ✘ (no `baton_board_*`) | |
| Facade | Scratchpad read / elevate | ✔ `run scratchpad read --scope shared --cursor`, `run scratchpad elevate --task --entries` (`application-cli.mjs:1476-1510`) | ✔ | ✔ elevate + settle | |
| Facade | **Scratchpad write (append entry)** | ✘ **no verb exists** — only read/elevate (`application-cli.mjs:1476-1511`) | ? | ? | §5 S-2; blocks the wave's own shared-lane handoff |
| Facade | Knowledge seed | ✔ `run knowledge seed` (`application-cli.mjs:1558-1571`) | ? | ? | |
| Decisions | **Decision list** | ✘ **ghost** — `decision.list` surfaces `['embedded','mcp','cli']` (`semantics.mjs:1349-1353`); no parser branch; `baton run decision list` → `unexpected argument list` | ✘ not claimed | ✘ no `baton_decision_list` tool (`mcp-northbound.mjs:125-129`) | |
| Context | Context eval | ✘ refused host-local (`application-cli.mjs:1301-1310`) — deliberate | ? | ✔ `baton_context_eval` (`mcp-northbound.mjs:91`) | |
| Context | Context map/reduce/retry | ✘ **silent ghost** — registry default surfaces incl cli (`semantics.mjs:1356-1358`); no parser branch → becomes `run.start` objective (§3 F-1) | ? | ? | |
| Waves | List waves | ✔ `baton waves list` — **no cursor arg** (`application-cli.mjs:1336-1337`), server schema ACCEPTS cursor (`semantics.mjs:1625-1631`) | ✔ | ? | #136-family |
| Waves | Wave progress | ✔ `baton waves progress WAVE_ID [--cursor N]` (`application-cli.mjs:1345-1360`) | ✔ | ? | |
| Waves | Start / attach / run | ✔ `waves start --members JSON`, `waves attach WAVE_ID --members JSON`, `waves run spec.json` (`application-cli.mjs:1362-1415`) | ✔ | ✔ | |
| Waves | **Send into a wave member** | ✘ **ghost** — `waves.send` surfaces `['embedded','mcp','cli','web']` (`semantics.mjs:1599-1614`); parser refuses (`application-cli.mjs:1383-1384`) | ✔ `waves_send` (`web-northbound.mjs:40`) | ✔ `baton_waves_send` (`mcp-northbound.mjs:100`) | §3 F-3 |
| Waves | **Emergency-stop a wave** | ✘ **ghost** — `waves.stop` surfaces incl cli (`semantics.mjs:1614-1621`); parser refuses | ✔ `waves_stop` (`web-northbound.mjs:41`) | ✔ `baton_waves_stop` (`mcp-northbound.mjs:101`) | §3 F-3; CLI is the ONLY surface missing the emergency verb |
| Deployment | Serve / serve CONFIG | ✔ (`baton.mjs:99-117`) | — | — | host-local |
| Deployment | Setup / doctor / route | ✔ `setup --profile`, `doctor [--depth] [--check]`, `route EXACT` | — | — | host-local |
| Deployment | Credentials install kimi | ✔ `credentials install kimi` (`application-cli.mjs:1218-1227`) | — | — | |
| Debug | Run debug | ✔ `run debug RUN_ID` (host-local; `render-surface-docs.mjs:27`) | ✘ not in whitelist | ? | `application-cli.mjs:1785-1803` |
| Help | `baton help [topic]` | ✔ core topics only — facade/waves topics absent (§3 F-7) | — | — | `application-cli.mjs:865-908` |

### 1.3 CLI parity gaps (impossible from the CLI today)

Ranked by operator cost; each is expanded in §3.

1. **`waves.send` / `waves.stop`** — cannot steer or emergency-stop a wave from the CLI, though
   the registry claims the cli surface and both web and MCP carry the wire
   (`semantics.mjs:1599-1621`; `web-northbound.mjs:40-41`; `mcp-northbound.mjs:100-101`).
2. **Cursor passing on `runs list`** (#136) and **on `waves list`** — parse gap on both
   (`application-cli.mjs:1288-1292`, `application-cli.mjs:1336-1337`).
3. **`decision.list`** — impossible; not on web or MCP either (CLI is not uniquely behind here,
   but the registry cli-surface claim is false).
4. **`run.attention.list`** — parser has only `attention watch`.
5. **`context.map` / `context.reduce` / `context.retry`** — no parser branch at all; they
   silently compile to `run.start` objectives (worst class of gap, §3 F-1).
6. **Scratchpad WRITE** — no verb in any lane shape; read/elevate only.

---

## 2. Discoverability findings

D-1. **The generated inventory advertises verbs the parser does not serve.** CLI.md's generated
block lists `run.watch | ordinary | baton run watch | baton run watch RUN_ID`
(`CLI.md:51`) and the renderer considers it served because `run.watch` aliases to the
`run.follow` dispatch on the web whitelist (`application-semantics.mjs:1877`; `render-surface-docs.mjs:37-51`).
But `parseBatonCli` has no `watch` action (`application-cli.mjs:1574-1578`): live `baton run watch
abc123` → `cli_invalid: unexpected argument abc123`; live `baton run watch` (bare) parses as a
`run.start` with objective `"watch"`. `render-surface-docs.mjs --check` exits 0 (CLI.md matches
the renderer) — the conformance check never compares the renderer against the **parser**. The doc
is "generated from the executable inventory" (`CLI.md:8-9`) but the inventory is built from
whitelist+registry, not from the parse grammar. **Doc truth and parser truth diverge silently.**

D-2. **The registry's cli-surface claims are not enforced.** `waves.send`, `waves.stop`,
`run.attention.list`, `decision.list`, `context.map/reduce/retry`, and the bare `run.scratchpad`
row all carry `surfaces` arrays that include `cli` (`application-semantics.mjs:1333-1358,
1599-1621`), yet the parser has no branch for them. An agent that discovers surfaces from the
registry (or from `deriveSurfaceNames`, `semantics.mjs:1130`) will attempt verbs that refuse or,
worse, silently reinterpret (D-3).

D-3. **Unknown `run` verbs are not refused — they become objectives.** `if
(!lifecycleActions.has(action)) return parseStart(args, action, idempotencyKey)`
(`application-cli.mjs:1578`). Live: `baton run shwo`, `baton run member` (bare), and `baton run
watch` (bare) all compile to a `run.start` with the typo/verb as the objective and fail only at
connection discovery in this worktree (`cli_config_invalid: user connection profile is
unavailable`). In a connected shell these would **start real Runs** with typo objectives. The
surface never states the valid `run` verb set for this input position.

D-4. **The top-level expected list omits valid top-level verbs.** Live `baton hel` → `expected
credentials, setup, doctor, route, explore, review, context, waves, or run`
(`application-cli.mjs:1418`). Missing: `help`, `serve`, `runs`, `credentials install`. A typo of
`help` teaches nothing about `help` existing.

D-5. **Facade verb families have no help topics.** `helpTopics` has `application, connection,
explore, review, workflow, runs, run` (+ `run.start`/`run.inspect` aliases)
(`application-semantics.mjs:919-1080`). Live `baton help waves` → `No local help is available for
waves. Use baton help for the application overview.` (`application-cli.mjs:890`). There is no
topic for `board`, `member`, `message`, `attention`, `scratchpad`, `knowledge`, `decision`, or
`waves` — exactly the newest lanes.

D-6. **`baton run board post --help` shows the `run.start` help.** The `--help` branch resolves
the topic from `commandTopics[args[1]]` and falls back to `run.start` when the subcommand is not
a legacy `cli.commands` id (`application-cli.mjs:1236-1243`); the facade subcommands (`board`,
`member`, `message`, `attention`, `scratchpad`, `knowledge`, `decision`) have no `cli.commands`
entry (`semantics.mjs:855-914`). Live `baton run board post --help` prints the run-start topic.
The one help verb on the surface mis-teaches the operation it was asked about.

D-7. **What does work well.** The compact outline is aggressively self-describing: every
response carries `inspect: { command: 'baton run show RUN_ID' }`, `expand`/`collapse` commands,
and help pointers (`application-cli.mjs:981-1011, 1086`). The `run view --until` fold and the
singular/plural `wave`→`waves` corrective refusal (`application-cli.mjs:1314-1322`) are the
model for what the rest of the surface should do. The doctor state machine returns `next`
command hints (`application-cli.mjs:521-532, 554, 588, 621`).

---

## 3. Error-quality sweep (refusal sites, judged)

Every site is judged against the #41/#139 pattern: **does it name the field/class and the next
action?**

| # | Refusal site (`file:line`) | Live/parsed behavior | Names field/class | Names next action | Verdict |
|---|---|---|---|---|---|
| E-1 | Unknown `run` verb → `parseStart` (`application-cli.mjs:1578`) | `baton run shwo` → compiles to run.start objective (connection error here; would start a Run when connected) | ✘ | ✘ | **Worst site on the surface.** Silent reinterpretation, not refusal. |
| E-2 | `run watch RUN_ID` (`application-cli.mjs:1574-1578`; no branch) | `unexpected argument abc123` | ✘ (doesn't say `watch` is unknown) | ✘ | Dead advertised verb; see D-1. |
| E-3 | `baton runs list --cursor 5` (`application-cli.mjs:99` `noRemainder`) | `unexpected argument --cursor` | ✘ | ✘ | #136. Refusal with no next action. |
| E-4 | `baton waves list --cursor 0` (`application-cli.mjs:1336-1337`) | `unexpected argument --cursor` | ✘ | ✘ | #136-family; server schema accepts cursor (`semantics.mjs:1625-1631`). |
| E-5 | `baton waves send …` / `stop …` (`application-cli.mjs:1383-1384`) | `expected waves list, progress, start, attach, or run` | ✘ | ✘ | Refusal names the closed set but omits send/stop (which exist on web/MCP); does not say "use web/MCP/embedded". |
| E-6 | `baton context eval` (`application-cli.mjs:1307`) | `context eval is host-local: use embedded BatonRun.context().evaluate(...) or MCP baton_context_eval` | ✔ | ✔ | **Model refusal.** |
| E-7 | `baton wave list` (`application-cli.mjs:1314-1322`) | `wave list is not a verb; use the plural spelling: baton waves list` | ✔ | ✔ | **Model refusal.** |
| E-8 | Connection profile unavailable (`application-cli.mjs:257, 270`) | `user connection profile is unavailable` | ✔ (class) | ✘ | No next action; doctor knows the answer (`application-cli.mjs:525-530`). #136/#137. |
| E-9 | `--profile no-such-profile` (live) | `cli_config_invalid: user connection profile is unavailable` | ✘ (doesn't name the profile or that it's the profile field) | ✘ | Same as E-8. |
| E-10 | Invalid plan digest (`application-cli.mjs:1715`, digest validator `:100-112`) | `Plan digest is invalid` | ✔ (field) | ✘ (no format) | #139 — name the field, never the value: the format is never stated. |
| E-11 | `run scratchpad` bare (`application-cli.mjs:1511`) | `unexpected argument undefined` | ✘ (names nothing) | ✘ | `undefined` leaked as an argument value. |
| E-12 | `run do --inputs bad-json` (`application-cli.mjs:1697`) | `cli_action_inputs_invalid: action inputs must be JSON` | ✔ | ✘ | Good class; no "must be a JSON object" hint for arrays (`:1699` covers that separately). |
| E-13 | Unknown top-level (`application-cli.mjs:1418`) | `expected credentials, setup, … or run` | ✔ (closed set) | ✘ (omits valid verbs) | D-4. |
| E-14 | `baton run scratchpad` unknown subverb (`application-cli.mjs:1511`) | `unexpected argument <whatever>` | ✘ | ✘ | Should teach `read`/`elevate`. |
| E-15 | Transport failure when the resident is unresponsive (`scripts/baton.mjs:119-129` → `BatonWebClient`, `application-cli.mjs:2012`) | live this session: `baton doctor --check` → `cli_transport_failed: Baton Web connection failed` (exit 1) while the resident socket accepts TCP but never answers a POST (probe timed out at 6 s) | ✘ (class only) | ✘ | No next action — is `baton serve` running? is the socket stale? retry? The refusal names neither the socket path nor a recovery step. |

**Sweep verdict:** the two refusal sites that model the pattern well are E-6 and E-7 (both
`cli_command_host_local` / `cli_command_unavailable` with typed corrective naming). Everywhere
else the surface fails the #41/#139 test — and the single most dangerous site (E-1) does not
refuse at all.

---

## 4. Grammar findings

G-1. **Noun–verb spelling is inconsistent across lanes.** Lifecycle verbs are flat (`run show`,
`run do`, `run stop`), member/message/facade verbs are dotted-noun (`run member view`, `run
message send`, `run board post`, `run knowledge seed`, `run scratchpad read`), and `run
scratchpad elevate`/`run knowledge seed` mix noun+verb. The parser mirrors this
(`application-cli.mjs:1430-1571`) so it is internally consistent, but an agent can't predict
whether a capability is `run <verb>` or `run <noun> <verb>` from the surface; the registry
`deriveSurfaceNames` prints them the same way (`semantics.mjs:1130-1144`), so the registry doesn't
resolve the guess.

G-2. **Canonical vs legacy verbs are taught side by side, legacy first.** The `run` help topic
teaches `run show`, `run progress`, `run events`, `run output`, `run stop-member`, `run select`,
`run feedback`, `run revise` (`semantics.mjs:1002-1008` usage rows) — while the generated
inventory advertises the canonical `run view`, `run member stop` (`CLI.md:23,36-38,50`). Live
`baton help run` prints the legacy spellings. The alias layer makes both work
(`semantics.mjs:742-787`, `resolveCanonicalCliArgs` at `application-cli.mjs:1163-1173`), but the
help text never says "legacy spelling; `run view` is canonical." CLI.md:191 still claims the
**deleted** `run steer` "remains an advanced compatibility surface" — a stale doc row, since the
parser refuses `run steer` (`application-cli.mjs:1775-1779`).

G-3. **Cursor conventions differ per verb.** `waves progress` accepts `--cursor N`
(`application-cli.mjs:1345-1360`), `waves list` and `runs list` accept none, `run attention watch`
accepts `--cursor` but `run scratchpad read` uses `--cursor` with a different validation
message (`application-cli.mjs:1461-1470, 1481-1485`). No single pagination contract is stated
anywhere on the surface.

G-4. **Exit-code taxonomy is inconsistent** (see F-9): `cli_invalid`, `cli_config_invalid`,
`cli_command_unavailable` → 2; everything else — including `cli_command_host_local` and
`cli_action_inputs_invalid`, both refusal classes — → 1 (`baton.mjs:131-134`). Live `baton
context eval` exits 1; live `baton wave list` exits 2. A driver cannot distinguish "verb exists,
wrong surface" from "application failure" by exit code.

G-5. **Enumerations are closed and parse-enforced**, which is good: `--exact HARNESS/MODEL@EFFORT`
format, `--kind inform|query|steer` (`application-cli.mjs:1443`), `--strategy ff-only|structured`,
`--until settled|terminal`, `--scope shared|worker:ID`, `--members JSON array`. These are the
closed-vocabulary refusals in the #10 family — they do teach the closed set.

---

## 5. Steering-fitness gaps

S-1. **Observe is strong.** `runs list`, `run view` (full progressive cascade), `run progress
--follow`, `run events --follow`, `run evidence`, `run episode/result/workstreams`, and the
self-describing compact outline give an orchestrator a complete read path. Steer is strong at
the **Run** level: `send`, `interrupt`, `approve`, `answer`, `do`, `select`, `feedback`,
`revise`, `retry`, `resume`, `stop`, `recover`.

S-2. **Wave-level steerage is missing entirely.** A CLI-first orchestrator can observe waves
(`waves list/progress`) and start/attach them, but **cannot send a message into a wave member
(`waves.send`) or emergency-stop a wave (`waves.stop`)** — both refused at
`application-cli.mjs:1383-1384` while web and MCP carry them. For an emergency-stop capability
(`semantics.mjs:1616` marks `waves.stop` `destructive: true`), the operator surface being the
only one *without* it is a steering-fitness gap, not just parity.

S-3. **The CLI cannot perform the wave's own shared-layer handoff.** The shared scratchpad
partition (`run.scratchpad` scope `shared`) has **read** and **elevate** but no **write/append**
verb (`application-cli.mjs:1476-1511`; `CLI.md:11` says the worker scratchpad is
"embedding/projection-only, never a CLI verb"). This audit's own deliverable required posting to
`shared`; the CLI surface cannot do it. Elevate also requires a `--task TASK_ID`, which an
operator may not know. (Recorded decision R-2 / DECISION_REQUEST candidate.)

S-4. **Fleet/kernel operations are correctly absent from the ordinary CLI** — `fleet_*` live in
the registry `advanced`/`kernel` profiles (`semantics.mjs:1466-1521`), which is the right
isolation. The gaps above are all *ordinary-profile* operations whose cli surface is claimed but
not wired.

---

## 6. Ranked friction list (orchestrator cost → fix → issue)

Each friction: evidence, cost, concrete fix, cross-ref. Cost is hours lost / mistakes induced for
the orchestrator driving baton all day.

### F-1 — Unknown `run` verb silently becomes a new Run objective
- **Evidence:** `application-cli.mjs:1578` (`if (!lifecycleActions.has(action)) return
  parseStart(args, action, idempotencyKey)`); lifecycle set at `:1574-1577`. Live: `baton run
  shwo`, `baton run member` (bare), `baton run watch` (bare) all compile to `run.start`.
- **Cost:** A connected orchestrator typo (`run shwo`, `run steek`) launches a real Run with the
  typo as objective; the only symptom is a stray Run. This is the highest-mistake-induction site
  on the surface.
- **Fix:** Refuse unknown `run <verb>` with `cli_command_unavailable` listing the valid lifecycle
  verbs (mirror the waves branch's closed-set refusal at `application-cli.mjs:1383-1384`); keep
  the objective form `baton run OBJECTIVE` (bare positional) but require `run start` when the
  first token matches a known verb position. Optionally: a `run typos`-style hint when the token
  is within edit distance of a real verb.
- **Cross-ref:** #139 (#41-pattern: name the class, never silently reinterpret), #136 (refusal
  without next action). The silent-start variant is NEW.

### F-2 — `baton run watch` is advertised but dead (renderer ≠ parser)
- **Evidence:** `CLI.md:51` advertises it; registry row + surface aliases claim it is served
  (`semantics.mjs:1261-1266, 1877-1880`); `render-surface-docs.mjs:34-75` builds it from the
  `run.follow` dispatch alias; parser has no `watch` action (`application-cli.mjs:1574-1578`).
  Live `baton run watch RUN_ID` → `unexpected argument RUN_ID`. `--check` passes because CLI.md
  matches the renderer, which matches neither parser nor reality.
- **Cost:** An orchestrator following the generated doc gets a parse error (or, bare, starts a
  Run); the doc's central promise — "generated from the executable inventory"
  (`CLI.md:8-9`) — is false for this row.
- **Fix:** Two options — (a) give the parser a `watch` action compiling to the existing stream
  command (`run.follow`, requiring `--channel` or `--to`), making the doc true; or (b) drop
  `run.watch` from the registry cli claim and the inventory. Option (a) is lower-cost because the
  wire exists.
- **Cross-ref:** NEW (conformance gap between `render-surface-docs.mjs` and
  `parseBatonCli`); adjacency: #140/#146 doc-truth issues if either covers generated-doc drift.

### F-3 — `waves.send` / `waves.stop` unusable from the CLI (registry says cli)
- **Evidence:** `semantics.mjs:1599-1621` (surfaces incl `cli`); parser refuses
  (`application-cli.mjs:1383-1384`); web + MCP have the wire (`web-northbound.mjs:40-41`;
  `mcp-northbound.mjs:100-101`).
- **Cost:** Wave members cannot be steered or emergency-stopped from the operator surface; an
  orchestrator must drop to web/MCP/embedded. For `waves.stop` (destructive emergency), the
  absence is a real incident-risk gap.
- **Fix:** Add parse branches `baton waves send WAVE_ID|RUN_ID --message TEXT [--nudge|--now|--turn]`
  and `baton waves stop RUN_ID --reason REASON`, dispatching the existing `waves.send`/`waves.stop`
  operations (input schemas already exist). Update the waves closed-set refusal text to include
  send/stop.
- **Cross-ref:** NEW (surface claim vs wire); adjacency: #132 (wave-observability) — but the
  wave read/steer contract (#132 D4.1) deliberately deferred send/stop off-CLI, so this is a
  deliberate-simplicity judgment now flagging as a steering gap.

### F-4 — `runs list` accepts no cursor; continuation is unreachable-by-design (#136)
- **Evidence:** `application-cli.mjs:1288-1292` (`noRemainder`, schema `{}`); registry schema
  `{}` (`semantics.mjs:263-266`); server throws `application_run_list_continuation_required`
  (`application.mjs:11982`). Live `baton runs list --cursor 5` → `unexpected argument --cursor`.
- **Cost:** The catalog read is dead beyond the first page on the human surface; an orchestrator
  with >MAX runs cannot enumerate them.
- **Fix:** Parse `--cursor`; when continuation is required, the refusal should print the cursor
  to use next (`application.mjs:11982` is the site that knows it).
- **Cross-ref:** #136 (exact).

### F-5 — `waves list --cursor` parse gap (server schema accepts it)
- **Evidence:** `application-cli.mjs:1336-1337` rejects cursor; `semantics.mjs:1625-1631` schema
  accepts `cursor: { type: 'integer', minimum: 0 }`. Live `baton waves list --cursor 0` →
  `unexpected argument --cursor`.
- **Cost:** Same dead-pagination pattern as F-4 on the waves catalog.
- **Fix:** Mirror the `waves progress` cursor parse (`application-cli.mjs:1345-1360`).
- **Cross-ref:** #136.

### F-6 — Connection/profile refusals name no next action
- **Evidence:** `application-cli.mjs:257` (`user connection profile is unavailable`), `:270`;
  doctor already knows the next actions (`application-cli.mjs:525-530`, `:554`, `:588`). Live
  `--profile no-such-profile` → `cli_config_invalid: user connection profile is unavailable`.
- **Cost:** First-run misdirection; the refusal path and the doctor path disagree about what to
  tell the operator.
- **Fix:** On `cli_config_invalid` connection failure, append the doctor's next hint (`baton
  serve` ordinary-first, per `application-cli.mjs:527-530`); name the profile field that failed.
- **Cross-ref:** #137 (setup misdirection), #136 (refusal without next action).

### F-7 — Help topics missing for every facade lane; `--help` mis-resolves
- **Evidence:** `application-cli.mjs:890` (`No local help is available for waves`); helpTopics
  set (`semantics.mjs:919-1080`) lacks board/member/message/attention/scratchpad/knowledge/
  decision/waves; `--help` topic fallback to `run.start` (`application-cli.mjs:1236-1243`). Live
  `baton help waves` and `baton run board post --help` (both shown in §2).
- **Cost:** A fresh agent cannot learn the newest lanes from the surface; `--help` on a facade
  verb actively mis-teaches.
- **Fix:** Add one helpTopic per facade family (board, member, message, attention, scratchpad,
  knowledge, decision, waves); resolve `--help` from the canonical operation's helpTopic when the
  subcommand is not a legacy id.
- **Cross-ref:** NEW; adjacency #140/#146 if they cover help-surface coverage.

### F-8 — Exit-code taxonomy splits refusal classes across two buckets
- **Evidence:** `baton.mjs:131-134`; live `baton context eval` (host-local) → 1, `baton wave
  list` (unavailable) → 2, `baton run do --inputs bad-json` (invalid inputs) → 1.
- **Cost:** Drivers can't key on exit code to distinguish "refused, use another surface" from
  "application failed"; the campaign's own drivers scrape stderr text instead
  (`baton: ${code}: ${message}` prefix is the only stable hook).
- **Fix:** Document the exit-code contract in CLI.md; move all `cli_*` refusal classes (incl
  `cli_command_host_local`, `cli_action_inputs_invalid`) into the 2 bucket and reserve 1 for
  application/runtime failures.
- **Cross-ref:** NEW (scriptability contract).

### F-9 — `run scratchpad` bare leaks `undefined` and no write verb exists
- **Evidence:** `application-cli.mjs:1511` (`unexpected argument ${sub}` with `sub === undefined`);
  registry `run.scratchpad` claims cli (`semantics.mjs:1338-1346`). Live `baton run scratchpad` →
  `unexpected argument undefined`.
- **Cost:** The newest collaboration lane (shared scratchpad) is un-discoverable from the CLI and
  unwritable; the wave's own handoff depends on it (S-3).
- **Fix:** Refuse bare `run scratchpad` with `expected scratchpad read|elevate`; consider a
  scratchpad **write** verb (`run scratchpad append RUN_ID --scope shared --body TEXT`) since the
  shared lane is now a first-class wave handoff.
- **Cross-ref:** #139 (name the field); write-verb is NEW (see R-2/DECISION_REQUEST).

### F-10 — Stale `run steer` doc row
- **Evidence:** `CLI.md:191` ("The worker-targeted `run steer` command remains an advanced
  compatibility surface"); parser refuses `run steer` (`application-cli.mjs:1775-1779`).
- **Cost:** Small, but it is the exact drift the conformance suite claims to prevent
  (`CLI.md:16`).
- **Fix:** Delete the sentence (or re-point it at `run send`).
- **Cross-ref:** #140/#146-family doc-truth; NEW.

---

## 7. Recorded style decisions and escalation posture

- **R-1 (style, decided):** Parity-table granularity is by capability (not by registry row), and
  web/MCP cells are marked only where verified this session (`?` otherwise) — the coordinator owns
  the full cross-surface matrix. Ghost-grammar rows (registry claims cli, parser lacks wire) are
  listed as `✘ ghost` rather than omitted, since they are the audit's central discovery.
- **R-2 (authority-class — DECISION_REQUEST candidate, deferred to synthesis):** The shared-layer
  law requires posting this report in full to the `shared` scratchpad partition, but the CLI
  surface has **no scratchpad-write verb** (`application-cli.mjs:1476-1511`), and the bus-level
  surfaces confirm it: web/MCP expose only `scratchpad_read` / `scratchpad_elevate` /
  `scratchpad_settle` (`mcp-northbound.mjs:105-106,114-115`; `CLI_WEB_COMMANDS` at
  `application-cli.mjs:30`) — no external client note-create command. The shared partition is
  written only by in-run workers via the internal capability `note` arg
  (`web-northbound.mjs:125,509-511`), unreachable from a client. A live resident IS running
  (serve pid 73048, schema-v2 resident profile present at
  `/Users/wahargis/.config/baton/connections/`), but it is **non-responsive this session**: the
  socket accepts TCP yet a read-only POST (`runs_list`) timed out at 6 s and `baton doctor
  --check` failed `cli_transport_failed` (E-15); the coordinator's own in-flight
  `waves_run` curl has hung ~22 min. This is itself F-9/S-3. Options for the coordinator:
  1. Read `surface-audit-cli.md` directly as the durable artifact (it is in wave scope) and
     accept the shared-lane gap as a recorded finding; add a scratchpad-write CLI verb in a later
     wave.
  2. Grant this row access to an embedded/MCP lane to publish to `shared` via
     `baton_scratchpad_settle`/embedding — requires a live, responsive resident, which is not
     available this session.
  3. Treat the missing write verb as the intended test and fold the gap into the audit's
     top-5 fixes.
  Recommended: (1), with the finding already filed as F-9.
- **R-3 (style, decided):** No DECISION_REQUEST raised for the brief's stale `run_act` premise
  (§ header correction) — it does not change the audit's meaning; it is corrected in-band.

## 8. Shared-scratchpad publication note

The full text of this report was **not** published to the `shared` scratchpad partition from this
worktree. Two independent barriers, both verified this session:

1. **No scratchpad-write verb exists for an external client.** The ordinary CLI offers only
   `run.scratchpad read` / `run.scratchpad elevate` (`application-cli.mjs:1476-1511`); the web
   bus and MCP expose the same read/elevate/settle set (`mcp-northbound.mjs:105-106,114-115`) with
   no note-create command; shared-partition writes are an internal worker capability (`note` arg,
   `web-northbound.mjs:125,509-511`). This is audit finding F-9 / steering gap S-3.
2. **No responsive live connection is reachable from this worktree.** A resident serve IS running
   (pid 73048) and its schema-v2 profile resolves at `/Users/wahargis/.config/baton/connections/`
   (this shell's `HOME` is sandbox-redirected, which is why it was initially reported missing).
   But the resident is non-responsive: a read-only `runs_list` POST to the published socket timed
   out at 6 s (`[curl exit 000]`), `baton doctor --check` failed `cli_transport_failed` (E-15),
   and the coordinator's own in-flight `waves_run` curl has hung ~22 min. No client route to the
   shared lane exists while the resident does not answer.

The report file above is the durable artifact and sits inside the wave's deliverable scope; per
R-2 option 1 the coordinator should read it directly. The gap itself is recorded as friction F-9
/ steering gap S-3, and the resident non-responsiveness is a separate infrastructure signal the
attending coordinator should be aware of (it is not this row's surface to diagnose).
