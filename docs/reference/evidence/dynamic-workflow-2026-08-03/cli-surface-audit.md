# CLI surface audit — the `baton` dialect for an orchestrating AGENT

- **Workflow**: `dw20260805234404` (cli-surveyor lane)
- **Survey date**: 2026-08-05
- **Scope**: `impl/CLI.md`, `impl/scripts/baton.mjs`, `impl/src/application-cli.mjs`, `impl/src/application-semantics.mjs`, `impl/src/brand.mjs`, `impl/scripts/render-surface-docs.mjs`
- **Method**: static read of the four files plus empirical parse probes (`node --input-type=module -e "import { parseBatonCli } from './impl/src/application-cli.mjs'; …"`) for every documented verb spelling. Remote/server-refusal paths (`cli_connection_incompatible`, `application_*`) are cited from code, not exercised live — no `baton serve` instance was running in this worktree.

## Board assignment received (verbatim)

The board `CONTEXT_READ` for `board-dw20260805234404-cli` returned:

```json
{"itemId":"board-item:079cc8b292711e20e037560666956997331e04c2ab8ea1b232595e4df63a791d","title":"workstream: cli-surface audit","detail":"Survey the cli control-surface dialect and write cli-surface-audit.md. Audit the CLI dialect for an orchestrating AGENT (not a human): read impl/CLI.md, impl/scripts/baton.mjs (small), and im..."}
```

## Acceptance canary received (verbatim)

The knowledge `CONTEXT_READ` for `"acceptance canary"` returned:

> **COPPER-FOXNIFE-44013**

Seeded by the orchestrator to prove the read lane serves run-horizon knowledge to the cli-surveyor.

---

## The dialect

### Invocation and channel discipline

`baton` is a single Node executable (`impl/scripts/baton.mjs`). All argv parsing funnels through one `parseBatonCli(process.argv.slice(2))` (impl/src/application-cli.mjs:1205), which rewrites legacy spellings via `resolveCanonicalCliArgs` (impl/src/application-cli.mjs:1160) before dispatch.

- **stdout is JSON-only for machine results.** Every non-help, non-credential command writes `JSON.stringify(projectBatonCliResult(parsed, result), null, 2)` (impl/scripts/baton.mjs:126); `setup` (baton.mjs:78), `doctor` (baton.mjs:82, 93), and follow-pages (baton.mjs:121–126) are JSON too. Follow/stream commands emit one JSON object per page.
- **stdout is human text only for `help` and credentials help** — `batonCliHelp(...)` goes to stdout as plain text (baton.mjs:70, `batonCliHelp` at application-cli.mjs:863).
- **stderr is the brand/human channel.** The new Flip faces — `✦(◕‿◕)✦` (smile) and `✦(◕﹏◕)◦` (thinking) — are emitted exclusively to stderr via `flipLine` (impl/src/brand.mjs:16–25, 37–39). ANSI gold/pink/teal only when the stream is a TTY; plain unicode otherwise. Help header (baton.mjs:69), `baton serve` lifecycle lines (baton.mjs:54, 61, 109, 111), and all errors (baton.mjs:129) are Flip-faced.
- **Exit codes**: `0` success; `1` runtime/command/transport failure; `2` for `cli_invalid`, `cli_config_invalid`, or `cli_command_unavailable` (baton.mjs:130). `baton doctor --check` exits `1` when not configured/ready (baton.mjs:83, 94).

### Verb grammar

Top-level dispatch (application-cli.mjs:1211–1354):

| Surface | Accepted spelling | Command name | Where |
|---|---|---|---|
| help | `baton help [topic]`, `baton --help`, `baton run help` | `application.help` | application-cli.mjs:1251–1257 |
| credentials | `baton credentials install kimi` / `--help` | `credential-install` / `credential-help` | application-cli.mjs:1211–1231 |
| doctor | `baton doctor [--depth outline\|connection\|profile\|evidence] [--check]` | `doctor` | application-cli.mjs:1258–1265 |
| setup | `baton setup [--profile P]` | `setup` | application-cli.mjs:1266–1271 |
| serve | `baton serve [CONFIG_MODULE]` | `serve` | application-cli.mjs:1272–1278 |
| route | `baton route HARNESS/MODEL@EFFORT` | `route` | application-cli.mjs:1279–1284 |
| list | `baton runs list` **and** `baton run list` (alias) | `runs.list` | application-cli.mjs:1285–1289 |
| review | `baton review OBJECTIVE --exact X --exact Y` (exactly two routes) | `run.start` (composition) | application-cli.mjs:1290–1293, 1127–1158 |
| explore | `baton explore OBJECTIVE [--exact X]` | `run.start` (read_only_evidence) | application-cli.mjs:1294–1297 |
| context | `baton context eval …` → refused `cli_command_host_local` | — | application-cli.mjs:1298–1306 |
| waves | `baton waves attach WAVE_ID --members JSON` only | `waves.attach` | application-cli.mjs:1315–1350 |

`baton run <sub-verb>` dispatch: the noun branches `message/attention/scratchpad/board/knowledge` come first (application-cli.mjs:1365–1508), then a hard-coded `lifecycleActions` set (application-cli.mjs:1509–1512) gates the remaining verbs, then **any token outside the set silently becomes a run-start objective** (`return parseStart(args, action, idempotencyKey)` at application-cli.mjs:1513). The lifecycle set: `show do recover status approve answer steer send interrupt progress events output episode workstreams notify result stop evidence adopt select feedback revise stop-member retry resume review integrate export debug`. Notable mappings: `show`→`run.inspect`, `do`→`run.act`, `status`→`run.status`/`run.wait`/`follow`, `send`→semantic-action `send`, `interrupt`→semantic-action `interrupt`, `stop-member`→`run.workstream.stop`, `retry`→`run.retry_verification`, `resume`→`run.resume_work`. `steer` is a deliberate refusal (`cli_command_unavailable` — "deleted at the M5 alias sunset; use run send", application-cli.mjs:1710–1714).

The web-client whitelist that gates what may actually dispatch is `CLI_WEB_COMMANDS` (application-cli.mjs:16–30); host-local verbs (`run.debug`, `context eval`) are parse-only.

### Result shapes (what an agent consumes)

`projectBatonCliResult` (application-cli.mjs:1019–1085) compresses routine mutations/status into a stable outline: `{ schemaVersion: 1, runId, objective, resultIntent, phase, progress{current,summary}, route{requested,resolved,observed}, attention{count,required,items?}, blockedInteraction, requiredAction, nextActions[], lastAction?, result?, terminalCause?, resources{ownedWorkers,…} }`. Internal budgets, fences, task/worker IDs, and policy attestations are deliberately hidden. Progressive `run show` follows outline → index → section → item (+`--content`, `--evidence`) with compact projections that embed actionable continuation commands (e.g. `inspect: 'baton run show RUN --depth item --section …'`, `collapse: 'baton run show RUN --depth index'`, application-cli.mjs:1005–1009).

Every parsed command receives an idempotency key — `--idempotency-key` or a fresh UUID (application-cli.mjs:1210); composite operations derive per-step sub-keys (`${key}:evidence`, `${key}:adopt`, …) (application-cli.mjs:2248–2255, 2237).

### Error shapes

`cliError(message, code='cli_invalid')` attaches a typed `code` (application-cli.mjs:48). Server refusals re-throw the server's typed `error.code` when it matches `^[a-z][a-z0-9_]{0,63}$` (else `cli_command_failed`) with message `Baton Web request was refused (METHOD /path, HTTP status)` (application-cli.mjs:1882–1889). The stderr line is `✦(◕﹏◕)◦ baton: CODE: message` (baton.mjs:129). A few refusals carry corrective naming — `wave` (singular) → "use the plural spelling: `baton waves attach …`" (application-cli.mjs:1309–1313), `steer` → "use `run send`" (application-cli.mjs:1713), `context eval` → "use embedded `BatonRun.context().evaluate(...)` or MCP `baton_context_eval`" (application-cli.mjs:1303–1306).

### What an agent must learn before its first successful call

1. **Bootstrap a connection first.** `baton doctor` is safe with no state and returns a self-describing ladder in `next: [{action, command}]` (application-cli.mjs:487–640: `enter_repository` → `serve`/`setup` → `doctor --check`). The ordinary path is `baton serve` (creates the resident deployment + connection, then stays up) or `baton setup` for explicit network; readiness is `baton doctor --check` (exit 1 until ready).
2. **Authority handshake.** A resident client validates schema, repoId, registry digest, and limits digest, and fails with `cli_connection_incompatible` on mismatch (application-cli.mjs:2115–2135) — an agent hitting a stale server must expect this code.
3. **Channel contract.** Parse stdout as JSON (2-space), read stderr for the Flip-faced brand/errors, and branch on the exit-code pair (0/1/2).
4. **Route tuples.** `--exact HARNESS/MODEL@EFFORT`, `baton route` for the deployment-allowed rows, `baton doctor` for readiness. Model selectors (`--model/--effort/--harness`) require `--model` and `--effort` together (application-cli.mjs:1102–1106).
5. **Idempotency.** Supply `--idempotency-key` for retryable external callers.

---

## Frictions found

### F1 — Three inventory rows advertise verbs the parser cannot invoke ("ghost verbs")

The CLI.md inventory block is **generated** from the executable inventory (`impl/scripts/render-surface-docs.mjs`, `servedCliOrdinaryKeys` + `renderCliVerbInventory`, lines 34–89) and the conformance check passes byte-identical (`node impl/scripts/render-surface-docs.mjs --check` → exit 0). Yet three rows show spellings `parseBatonCli` rejects — verified by direct probes:

| CLI.md row | Advertised spelling | Actual parse result |
|---|---|---|
| `application.help` (impl/CLI.md:22) | `baton application help` | `cli_invalid`: "expected credentials, setup, doctor, route, explore, review, context, waves, or run" (application-cli.mjs:1353). Accepted: `baton help` (application-cli.mjs:1251–1257). |
| `run.watch` (impl/CLI.md:51) | `baton run watch RUN_ID` | `baton run watch RUN_ID` → `cli_invalid` "unexpected argument RUN_ID"; bare `baton run watch` → **silently parsed as a run-start objective** (see F2). The operation is served but only via `baton run progress|events|output --follow` (alias rows application-semantics.mjs:1844–1853). |
| `waves.start` (impl/CLI.md:53) | `baton waves start --members JSON` | `cli_command_unavailable`: "expected waves attach" (application-cli.mjs:1315–1320). `waves.start` is in `CLI_WEB_COMMANDS` (application-cli.mjs:25) and in the canonical model with `surfaces: ['embedded','mcp','cli']` (application-semantics.mjs:1566–1582), but no parse branch or alias reaches it. |

**Root cause**: the inventory's "CLI verb" column is `deriveSurfaceNames(key).cli` = a mechanical `baton ${key.parts.join(' ')}` (application-semantics.mjs:1123–1144; render-surface-docs.mjs:81–82), *not* the spellings the parser accepts. The table claims "served truth" but served ≠ parseable.

### F2 — The objective fallback silently shadows unhandled verbs (dispatch hazard)

Any `baton run <token>` not in `lifecycleActions` becomes `run.start` with objective `<token>` (application-cli.mjs:1513). Consequences, all empirically confirmed:

- `baton run watch` → **starts a run** with objective `"watch"`; `baton run watch RUN_ID` → error "unexpected argument RUN_ID" (the token `RUN_ID` is a leftover positional on the objective path).
- `baton run wait`, `baton run member` (un-aliased), and any typo such as `baton run adpot` or `baton run appprove` also become run-start objectives.
- This contradicts the in-file claim that "an unknown sub-verb stays a loud cli_invalid parse error, never a silent run-start objective" (application-cli.mjs:1362–1364) — that guard only covers verbs that enter a noun branch first (`message`, `attention`, `scratchpad`, `board`, `knowledge`); the fallback exists for everything else.

For an orchestrating agent, a misspelled or copied-from-docs verb is a **live dispatch**, not a refusal. `baton run watch RUN_ID` copied straight from impl/CLI.md:51 is the worst instance.

### F3 — Legacy-key rows show derived spellings that differ from the accepted ones

The inventory keys are legacy semantic operations; their accepted CLI spellings come from alias rows, and an agent cannot tell which derived spellings parse:

- `run.member.send` → accepted `baton run notify` (alias application-semantics.mjs:1766), *and* the derived `baton run member send …` also parses (rewritten by `resolveCanonicalCliArgs`).
- `run.member.stop` → `baton run stop-member` / `baton run member stop …` both parse.
- `run.member.view` → `baton run workstreams` / `baton run member view …` both parse.
- `run.list` → `baton runs list` / `baton run list` both parse.
- `run.watch` → **no** `run watch` path; only `progress|events|output` (F1/F2).

So some derived spellings are double-covered and one (`run watch`) is a trap; the documentation gives no signal about which.

### F4 — Served-but-undeclared verbs are discoverable only in prose

`baton run status`, `run wait`, `run show`, `run progress`, `run events`, `run output`, `run interrupt`, plus `baton runs list`, `baton review`, `baton explore`, `baton route` are all parseable and documented only in the prose "command bus" examples (impl/CLI.md:103–132), not in the generated inventory table. Worse, `baton help run.watch` renders the canonical row's usage `baton run watch RUN_ID` (batonCliHelp at application-cli.mjs:879–887) — pointing an agent at a verb that cannot be invoked. `baton help run` covers `run.show/do/stop/export` topic text (application-semantics.mjs:914) but the stream verbs and `status` only surface via `baton help run.show`-style topics.

### F5 — Uneven parse-error ergonomics

Three refusal classes show the good pattern (typed code + corrective next step): `wave`→plural (application-cli.mjs:1309–1313), `steer`→`run send` (application-cli.mjs:1713), `context eval`→embedded/MCP path (application-cli.mjs:1303–1306). Most other parse failures are bare `cli_invalid` with terse text that omits the expected format:

- `baton run approve R1 --plan D` → "Plan digest is invalid" (application-cli.mjs:1650, `digest`/`id` pattern at application-cli.mjs:98–103) — never states "64 lowercase hex".
- `baton run watch R1` → "unexpected argument R1" — actively misleading about why (it is the objective fallback, not a stray positional on a real verb).
- `--members must be JSON` / `--entries must be JSON` (application-cli.mjs:1331, 1438) state the expectation but not the schema shape (`[{role,objective}]`).
- The generic unknown-verb message "expected credentials, setup, doctor, route, explore, review, context, waves, or run" (application-cli.mjs:1353) does not list the `run` sub-verbs, so a mispositioned first token is hard to diagnose.

### F6 — Bootstrapping is protocol-heavy (well-laddered, but not wire-discoverable)

An agent must know to run `baton serve` (a long-running process) or `baton setup`, then `baton doctor --check`, then verbs; nothing on the wire surface states "serve first". The `doctor` `next` ladder (application-cli.mjs:487–640) is excellent once found, but the agent has to call `baton doctor` (with no connection) to discover it. The authority handshake (digest equality, `cli_connection_incompatible`, application-cli.mjs:2115–2135) adds a failure class an agent must learn to interpret.

---

## Recommendations

1. **Make the inventory emit parser-accepted spellings, not derivations.** In `renderCliVerbInventory` (render-surface-docs.mjs:77–89), resolve the "CLI verb" column from the registry's cli alias rows and the parse branches (or add an explicit per-operation `cliSpelling` to the canonical model). At minimum: mark `application.help`, `run.watch`, and `waves.start` as not-CLI-invocable (or drop them), and fix their `Example` cells so they never recommend `baton run watch RUN_ID` / `baton waves start --members JSON`.
2. **Close the silent dispatch shadow for known-but-unshipped verbs.** Give `run.watch`, `run.wait`, and any other cli-surface canonical verb with no parse branch a "known, not shipped" refusal with corrective spelling (same shape as `steer`, application-cli.mjs:1713). Keep the objective fallback (it is the documented `baton run OBJECTIVE` form) but make it reject tokens that are canonical operation keys, so a typo or a copied ghost verb is never a live run start.
3. **Either ship `baton run watch RUN_ID` or retire it.** The `run.watch` operation is served via the streams (`progress|events|output`, alias rows application-semantics.mjs:1844–1853); implement `watch` as the follow stream alias, or delete the canonical row from the cli inventory so only the true spellings are advertised.
4. **Uniform error ergonomics for parse failures.** Extend the corrective-naming pattern (F5's good class) to all format refusals: state the expected pattern (`--plan` = 64 lowercase hex; `--members` = `[{role, objective}]`; `--entries` = JSON array of entry ids), and for the unknown-token case say "use `baton run start` for an objective, or one of <verb list>".
5. **Add a machine-readable dialect summary.** Since stdout is already JSON, add `baton help --json` (or a `baton surface` verb) that emits the exact accepted verb grammar (verb, required/optional flags, argument shapes, idempotency, result schema) so an agent can introspect discoverability without parsing prose or probing the parser.
6. **Surface the bootstrapping ladder where agents look.** Put "run `baton serve` first (or `baton setup`), then `baton doctor --check`" as the first prose paragraph of impl/CLI.md, and consider emitting the doctor `next` ladder (application-cli.mjs:487–640) on any `cli_config_invalid` connection failure so a fresh agent is always handed its next command.
