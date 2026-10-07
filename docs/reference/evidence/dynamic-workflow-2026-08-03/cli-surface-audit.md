# CLI surface audit — the `baton` dialect for an orchestrating AGENT

- **Workflow**: `dw20260806003549` (cli-surveyor lane)
- **Survey date**: 2026-08-06
- **Scope**: `impl/CLI.md`, `impl/scripts/baton.mjs`, `impl/src/application-cli.mjs`, plus `impl/src/brand.mjs`, `impl/src/application-semantics.mjs`, `impl/scripts/render-surface-docs.mjs`
- **Method**: static read of the files above **plus empirical parse probes** — `node --input-type=module -e "import { parseBatonCli, batonCliHelp } from './impl/src/application-cli.mjs'; …"` run against the live parser for every disputed spelling (results quoted inline). `node impl/scripts/render-surface-docs.mjs --check` exits 0, so the CLI.md inventory block is generated and byte-stable against served truth. Remote/server-refusal paths (`cli_connection_incompatible`, `application_*`) are cited from code, not exercised live — no `baton serve` resident was running in this worktree.
- **Supersedes**: the 2026-08-05 23:44 run's `cli-surface-audit.md` (workflow `dw20260805234404`); the findings below were re-verified against this tree at commit `293bc42`.

## Board assignment received (verbatim)

The board `CONTEXT_READ` for `board-dw20260806003549-cli` returned exactly (the `detail` field arrived truncated with `…` — quoted as received):

```json
{"itemId":"board-item:5eb3407f69ee8bd7e691341c5f1191c6a22095b3622fd0f7f3c8ee82b95c312c","title":"workstream: cli-surface audit","detail":"Survey the cli control-surface dialect and write cli-surface-audit.md. Audit the CLI dialect for an orchestrating AGENT (not a human): read impl/CLI.md, impl/scripts/baton.mjs (small), and im..."}
```

The full detail sentence beyond the truncation did not arrive on the wire; no part of it was invented.

## Acceptance canary received (verbatim)

The knowledge `CONTEXT_READ` for `"acceptance canary"` returned a single Finding whose snippet stated the phrase — quoted exactly:

> **COPPER-FOXNIFE-89007**

Form `WORD-WORD-NUMBER` confirmed. (This run's canary differs from the prior run's `COPPER-FOXNIFE-44013`; the prior value is not used here.)

---

## The dialect

### Invocation and channel discipline

`baton` is one Node executable (`impl/scripts/baton.mjs`). All argv funnels through `parseBatonCli(process.argv.slice(2))` (impl/src/application-cli.mjs:1205), which first rewrites legacy spellings via `resolveCanonicalCliArgs` (application-cli.mjs:1160–1170) reading `OPERATION_ALIASES` (application-semantics.mjs:735–759).

- **stdout is JSON for every machine result.** Command results go out as `JSON.stringify(projectBatonCliResult(parsed, result), null, 2)` (baton.mjs:126); `setup` (baton.mjs:78), `doctor` local (baton.mjs:82) and remote (baton.mjs:93), and each follow/stream page (baton.mjs:121–126, one JSON object per page) are JSON too.
- **stdout is human prose for exactly two families: `help` and `credentials`.** `batonCliHelp(...)` is written to stdout as plain text (baton.mjs:70, function at application-cli.mjs:863–906), and `KIMI_CREDENTIAL_HELP` likewise (baton.mjs:72). There is no `--json` switch for either. So "stdout is machine-clean JSON" is **true for commands, false for the discoverability channel** — see F6.
- **stderr is the brand channel.** The Flip faces — `✦(◕‿◕)✦` (smile) and `✦(◕﹏◕)◦` (thinking) — are emitted exclusively to stderr through `flipLine` (impl/src/brand.mjs:16–25, 37–39), ANSI gold/pink/teal only when the stream is a TTY (baton.mjs:17), plain unicode otherwise. The two brand moments: smile for the help header (baton.mjs:69) and serve-closed (baton.mjs:61); thinking for serve-started (baton.mjs:54) and for **every error** (`✦(◕﹏◕)◦ baton: CODE: message`, baton.mjs:129).
- **Exit codes**: `0` success; `1` runtime/remote/transport failure; `2` for `cli_invalid`, `cli_config_invalid`, or `cli_command_unavailable` (baton.mjs:130). `baton doctor --check` additionally exits `1` while not configured/ready (baton.mjs:83, 94). The `2` class is a genuinely useful "caller misuse" signal for an agent.

### Verb grammar

Top-level dispatch (application-cli.mjs:1211–1354):

| Surface | Accepted spelling | Command name | Where |
|---|---|---|---|
| help | `baton help [topic]`, `baton --help`/`-h`, `baton run --help` | `application.help` | application-cli.mjs:1207–1209, 1233–1257 |
| credentials | `baton credentials install kimi` / `baton credentials --help` | `credential-install` / `credential-help` | application-cli.mjs:1211–1231 |
| doctor | `baton doctor [--depth outline\|connection\|profile\|evidence] [--check]` | `doctor` | application-cli.mjs:1258–1265 |
| setup | `baton setup [--profile P]` | `setup` | application-cli.mjs:1266–1271 |
| serve | `baton serve [CONFIG_MODULE]` | `serve` | application-cli.mjs:1272–1278 |
| route | `baton route HARNESS/MODEL@EFFORT` | `route` | application-cli.mjs:1279–1284 |
| list | `baton runs list` **and** `baton run list` (alias) | `runs.list` | application-cli.mjs:1285–1289; alias application-semantics.mjs:736–739 |
| review | `baton review OBJECTIVE --exact A --exact B` (exactly two) | `run.start` (composition) | application-cli.mjs:1290–1293, 1127–1158 |
| explore | `baton explore OBJECTIVE [--exact X]` | `run.start` (read_only_evidence) | application-cli.mjs:1294–1297 |
| context | `baton context eval …` → refused `cli_command_host_local` | — | application-cli.mjs:1298–1306 |
| waves | `baton waves attach WAVE_ID --members JSON` only | `waves.attach` | application-cli.mjs:1315–1350 |

`baton run <sub>` dispatch is a two-tier gate (application-cli.mjs:1352–1513): the noun branches `message`/`attention`/`scratchpad`/`board`/`knowledge` (1365–1508) are handled first, then a hard-coded `lifecycleActions` set (1509–1512) admits the classic verbs (`show do recover status approve answer steer send interrupt progress events output episode workstreams notify result stop evidence adopt select feedback revise stop-member retry resume review integrate export debug`), and **anything else falls through to `parseStart(args, action, …)` — the run-start objective form** (1513). Key mappings verified by probe: `run list`/`runs list` → `runs.list`; `run status RUN --wait 5s` → `run.wait`; `run show` → `run.inspect` (outline/index/section/item cascade, 1568–1623); `run do` → `run.act` (1625–1634); `run steer` is a deliberate `cli_command_unavailable` refusal ("deleted at the M5 alias sunset; use run send", 1710–1714). The dispatchable web-client whitelist is `CLI_WEB_COMMANDS` (16–30); host-local verbs (`run.debug`, `context eval`) are parse-only.

### Result shapes (what an agent consumes)

`projectBatonCliResult` (application-cli.mjs:1019–1085) compresses routine mutations/status into a stable outline: `{ schemaVersion: 1, runId, objective, resultIntent, objectiveResultPolicy, phase, progress{current,summary}, route{requested,resolved,observed}, attention{count,required,items?}, blockedInteraction, requiredAction, nextActions[], lastAction?, result?, terminalCause?, resources{ownedWorkers,reaped} }`. Internal budgets, fences, task/worker IDs, and policy attestations are deliberately hidden (comment 1013–1018). Progressive `run show` follows outline → index → section → item with compact projections that embed the caller's next command as data (e.g. `inspect: 'baton run show RUN --depth section --section …'`, `collapse: …`, application-cli.mjs:985–1009) — an agent can walk the cascade without re-deriving syntax.

Every parsed command carries an idempotency key — `--idempotency-key` or a fresh UUID (application-cli.mjs:1210); composite operations derive per-step sub-keys (`${key}:evidence`, `${key}:adopt`, `${key}:status`, …; application-cli.mjs:2221–2255).

### Error shapes

`cliError(message, code = 'cli_invalid')` (application-cli.mjs:48) is the one error factory; codes are typed (`cli_config_invalid`, `cli_command_unavailable`, `cli_command_host_local`, `application_route_unavailable`, `cli_command_pending`, …). Server refusals re-throw the server's typed `error.code` when it matches `^[a-z][a-z0-9_]{0,63}$`, else `cli_command_failed`, with the request facts surfaced: `Baton Web request was refused (METHOD /path, HTTP status)` (application-cli.mjs:1882–1889). The stderr line is always `✦(◕﹏◕)◦ baton: CODE: message` (baton.mjs:129). Three refusals carry corrective naming: `wave` (singular) → "use the plural spelling: `baton waves attach …`" (1309–1314); `steer` → "use `run send`" (1713); `context eval` → "use embedded `BatonRun.context().evaluate(...)` or MCP `baton_context_eval`" (1303–1306).

### What an agent must learn before its first successful call

1. **Bootstrap a connection first — off the wire.** `baton doctor` is safe with no state and returns a self-describing `next` ladder (application-cli.mjs:487–528: `enter_repository` → `serve`/`setup` → `baton doctor --check`). The ordinary path is `baton serve` (resident deployment + connection, long-running) or `baton setup` (explicit network); readiness is `baton doctor --check` (exit 1 until ready). Nothing on the verb surface says "serve first" — the agent must know to call `doctor` to discover it (F7).
2. **Authority handshake.** A resident client validates schema, repoId, semantic-registry digest, and (additively) limits-registry digest, and fails `cli_connection_incompatible` on any mismatch (application-cli.mjs:2115–2135) — a stale server is a first-call failure class an agent must learn to interpret.
3. **Channel contract.** Parse stdout as JSON (2-space; one object for a command, one per page for `--follow`), read stderr for the Flip brand and typed errors, and branch on the exit-code pair (0/1/2 = ok / runtime-or-remote / caller-misuse).
4. **Route tuples.** `--exact HARNESS/MODEL@EFFORT`, or `--model`+`--effort` together (manual pair is enforced, application-cli.mjs:1102–1106); `baton route`/`baton doctor` list the deployment-allowed rows.
5. **Idempotency.** Supply `--idempotency-key` for retryable external callers; the default random UUID means retries of the same logical command are **not** deduplicated unless the key is caller-supplied.
6. **The objective fallback is a live dispatch.** Any `run <token>` outside the admit set starts a Run whose objective is that token (1513) — an agent must never guess a verb (F2).

---

## Frictions found

### F1 — Three inventory rows advertise verbs the parser cannot invoke ("ghost verbs")

The CLI.md inventory block is **generated** from the executable inventory (`renderCliVerbInventory`, impl/scripts/render-surface-docs.mjs:77–89; conformance `--check` exits 0), yet three rows spell verbs `parseBatonCli` rejects — all verified by direct probe against the live parser:

| CLI.md row | Advertised spelling | Actual parse result |
|---|---|---|
| `application.help` (impl/CLI.md:22) | `baton application help` | `cli_invalid`: "expected credentials, setup, doctor, route, explore, review, context, waves, or run" (application-cli.mjs:1353). Accepted: `baton help` (1251–1257). |
| `run.watch` (impl/CLI.md:51) | `baton run watch RUN_ID` | `cli_invalid` "unexpected argument RUN_ID"; bare `baton run watch` **silently parses as a run-start objective** (see F2). The operation is only reachable as the streams — `baton help run.watch` itself prints "Replaces: baton run events, baton run output, baton run progress." |
| `waves.start` (impl/CLI.md:53) | `baton waves start --members JSON` | `cli_command_unavailable` "expected waves attach" (application-cli.mjs:1315–1320). `waves.start` is in `CLI_WEB_COMMANDS` (25) and its canonical row declares `surfaces: ['embedded','mcp','cli']` (application-semantics.mjs:1566–1582), but no parse branch or cli alias reaches it. |

**Root cause**: the inventory's "CLI verb" column is `deriveSurfaceNames(key).cli = 'baton ' + key.parts.join(' ')` (application-semantics.mjs:1139; render-surface-docs.mjs:81–82), a mechanical derivation — **not** the spellings the parser accepts. The table header claims "served truth" (CLI.md:16), but served ≠ parseable.

### F2 — The objective fallback silently shadows unhandled verbs (dispatch hazard)

`parseStart(args, action, …)` at application-cli.mjs:1513 turns any non-admitted `run` token into a Run start. Probe-verified consequences:

- `baton run watch` → `run.start` with `{intent: {objective: "watch", resultIntent: "change"}}` — a **live dispatch**, not a refusal.
- `baton run adpot`, `baton run wait`, `baton run member` → likewise `run.start` with objectives `"adpot"`, `"wait"`, `"member"`.
- With a stray positional, the fallback errors confusingly instead: `baton run watch RUN_ID` and `baton run adpot RUN_ID` → `cli_invalid` "unexpected argument RUN_ID" (the leftover positional trips `noRemainder`).
- This contradicts the in-file claim that "an unknown sub-verb stays a loud cli_invalid parse error, never a silent run-start objective" (application-cli.mjs:1362–1364). That guard only covers the noun branches (`message`, `attention`, `scratchpad`, `board`, `knowledge`); the fallback exists for everything else.

For an orchestrating agent, a misspelled or copied-from-docs verb is a **run start**, and `baton run watch RUN_ID` copied straight from impl/CLI.md:51 is the worst instance.

### F3 — Inventory rows use derived spellings that differ from the accepted ones (and one is a trap)

The inventory keys are legacy semantic operations; their accepted CLI spellings come from alias rows, and the docs give no signal about which derived spellings parse (aliases at application-semantics.mjs:736–759):

- `run.member.send` (CLI.md:36) → accepted `baton run notify` (alias 752–755); `baton run member send …` also parses via the canonical rewrite.
- `run.member.stop` (CLI.md:37) → `baton run stop-member` / `baton run member stop …` both parse (756–759).
- `run.member.view` (CLI.md:38) → `baton run workstreams` / `baton run member view …` both parse (748–751).
- `run.list` (CLI.md:35) → `baton runs list` / `baton run list` both parse (736–739).
- `run.watch` (CLI.md:51) → **no** parseable `run watch` path at all — only the streams (F1/F2). Its alias row is `cli: null` (application-semantics.mjs:744–747), so the canonical rewrite cannot rescue it.

So some derived spellings are double-covered and one (`run watch`) is a trap; an agent reading the table cannot tell which.

### F4 — Served-but-undeclared verbs exist only in prose, and `help` points at a ghost

`baton run status`, `run show`, `run progress`, `run events`, `run output`, `run interrupt`, `baton runs list`, `baton review`, `baton explore`, `baton route` are all parseable but appear only in the prose "command bus" block (impl/CLI.md:103–132), never in the generated inventory. Worse, `baton help run.watch` (application-cli.mjs:879–887 renders the canonical row) prints:

```
usage:
  baton run watch
  baton run watch RUN_ID

Replaces: baton run events, baton run output, baton run progress.
```

— i.e. the help system advertises a non-parseable spelling while the served capability lives under the "Replaces:" verbs. `baton help run` covers `run.show/do/stop/export`-style topics but not the stream verbs or `status`.

### F5 — Uneven parse-error ergonomics

Three refusal classes show the good pattern (typed code + corrective next step): `wave`→plural (1309–1314), `steer`→`run send` (1713), `context eval`→embedded/MCP path (1303–1306). Most other parse failures are bare `cli_invalid` with terse text that omits the expected shape:

- `baton run approve R1 --plan zz` → "Plan digest is invalid" (application-cli.mjs:1650, via `digest`/`id` at 98–103) — never states "64 lowercase hex".
- `baton run watch R1` → "unexpected argument R1" — actively misleading about why (it is the objective fallback's leftover-positional error, not a stray token on a real verb).
- `--members must be JSON` / `--entries must be JSON` (1331, 1438) state the expectation but not the schema (`[{role, objective}]` / array of entry ids).
- The generic unknown-first-token message "expected credentials, setup, doctor, route, explore, review, context, waves, or run" (application-cli.mjs:1353) is itself incomplete — it omits `help`, `serve`, `runs`, and `application` — and lists no `run` sub-verbs, so a mispositioned verb is hard to diagnose.

### F6 — stdout is not strictly JSON-only: the discoverability channel is prose

Judging "JSON-only stdout discipline" strictly: **command results are JSON; `baton help` and `baton credentials` are human prose on stdout** (baton.mjs:70, 72), with no `--json` form. An agent that parses stdout as JSON for every invocation will choke on the very call it makes first (`help`). The rest of the surface is disciplined — stderr carries all brand/error text, so a JSON parser on stdout is safe for every non-help command — but the one channel an agent reaches for first is the one that is not machine-readable (see R5).

### F7 — Bootstrapping is protocol-heavy, and the handshake adds a hidden failure class

An agent must know to run `baton serve` (long-running) or `baton setup`, then `baton doctor --check`, then verbs; nothing on the wire surface states "serve first". The `doctor` `next` ladder (application-cli.mjs:505–528) is excellent once found, but discovery requires the agent to already know `doctor`. The authority handshake (digest equality → `cli_connection_incompatible`, application-cli.mjs:2115–2135) adds a first-call failure class whose remediation ("start a newer `baton serve`") is not in the error text.

---

## Recommendations

1. **Make the inventory emit parser-accepted spellings, not derivations.** In `renderCliVerbInventory` (render-surface-docs.mjs:77–89), resolve the "CLI verb" column from the registry's cli alias rows and the parse branches (or add an explicit per-operation `cliSpelling` to the canonical model, fed by the same source `parseBatonCli` uses). At minimum: mark `application.help`, `run.watch`, and `waves.start` as not-CLI-invocable (or drop them), and fix their `Example` cells so the docs never recommend `baton run watch RUN_ID` / `baton waves start --members JSON`.
2. **Close the silent dispatch shadow for known-but-unshipped verbs.** Give `run.watch`, `run.wait`-style canonical cli-surface operations with no parse branch a "known, not shipped" refusal with corrective spelling (same shape as `steer`, application-cli.mjs:1713). Keep the objective fallback (it is the documented `baton run OBJECTIVE` form) but make it reject tokens that are canonical operation keys, so a typo or a copied ghost verb is never a live run start (F2).
3. **Either ship `baton run watch RUN_ID` or retire the canonical row.** The `run.watch` operation is served via the streams (`progress|events|output`, alias rows application-semantics.mjs:744–747 and `batonCliHelp` output above); implement `watch` as the follow-stream alias, or delete it from the cli inventory so only true spellings are advertised (F1/F3/F4).
4. **Uniform error ergonomics for parse failures.** Extend the corrective-naming pattern (F5's good class) to all format refusals: state the expected pattern (`--plan` = 64 lowercase hex; `--members` = `[{role, objective}]`; `--entries` = JSON array of entry ids), and for the unknown-token case say "use `baton run start` for an objective, or one of <verb list>" — and make the top-level verb list exhaustive (application-cli.mjs:1353).
5. **Add a machine-readable dialect summary.** Since command stdout is already JSON, add `baton help --json` (or a `baton surface` verb) that emits the exact accepted grammar — verb, sub-verbs, required/optional flags, argument shapes, idempotency, result schema — so an agent can introspect discoverability without parsing prose or probing the parser (F6).
6. **Surface the bootstrapping ladder where agents look.** Put "run `baton serve` first (or `baton setup`), then `baton doctor --check`" as the first prose paragraph of impl/CLI.md, and emit the `doctor` `next` ladder (application-cli.mjs:505–528) on any `cli_config_invalid` connection failure so a fresh agent is always handed its next command (F7).
7. **Document the idempotency contract in the surface docs.** The default per-invocation UUID (application-cli.mjs:1210) means retries do not deduplicate unless the caller supplies `--idempotency-key`; say this explicitly for the mutation verbs (`run start`, `run approve`, `run adopt`, `run integrate`, `run message send`, `run board post`, `run knowledge seed`) so an agent learns to set stable keys before its first retry loop.
