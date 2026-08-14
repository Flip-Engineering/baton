# Control-surface audit #147 — RERUN against current master (redrive 1)

[attempt: audit147-rerun-redrive1-20260814 row-audit-147]

Row: `row-audit-147` · Wave: `audit-147-rerun-2026-08-14` · Date: 2026-08-14
Baseline: `docs/reference/evidence/control-surface-audit-2026-08-13/control-surface-audit.md` (prior #147 synthesis) + the three prior row reports (`surface-audit-cli.md`, `surface-audit-mcp.md`, `surface-audit-web.md`).

Every claim below was re-verified THIS run with the command and output quoted, or a `file:line` anchor. Nothing is carried from the prior audit. GitHub (`gh`) was not relied upon — all evidence is grounded in the repo.

---

## 1. Delta — prior findings → status

Legend: **STILL BITES** = reproduces live this run · **CLOSED** = fixed/refused-and-testable · **PARTIAL** = edge fixed, residual remains · **MOVED** = capability relocated by design.

### 1.1 Prior CLI row findings (`surface-audit-cli.md`)

| Prior finding | Status | This-run evidence |
|---|---|---|
| **F-1** unknown run verb silently reinterpreted as a Run objective | **CLOSED** (residual in F-2) | `node scripts/baton.mjs run shwo` → `cli_command_unavailable: unknown run verb shwo; expected adopt, answer, approve, ...` (exit 2). Typo refusal is `cliRunVerbTypoRefusal()` at `src/application-cli.mjs:1119-1130`; distance-1 typo of a recognized first-token refuses, per #160 R6 comment at `application-cli.mjs:1683-1686`. |
| **F-2** `run.watch` advertised but dead | **STILL BITES** | Taught: `CLI.md:51` `\| run.watch \| ordinary \| baton run watch \| baton run watch RUN_ID \|`. Registry row exists: `src/application-semantics.mjs:751-769` (`run.watch` → `operation: 'run.follow'`, effect `run_stream`, inputSchema requires `runId`). But the CLI parser has NO `run watch` branch — `watch` is not in `lifecycleActions` (`application-cli.mjs:1673-1676`), so it falls through `parseStart(args, action, ...)` at `application-cli.mjs:1685`. Live: `baton run watch abc123` → `cli_invalid: unexpected argument abc123` (exit 2); `baton run watch` (bare) → `cli_config_invalid: user connection profile is unavailable` (exit 2) — i.e. parsed as a NEW run whose objective is the literal string `watch`. The only real `watch` verb is `run attention watch` (`application-cli.mjs:1554-1565`, taught at `CLI.md:26`). The #157 CLI wave-fidelity suite (`test/cli-wave-fidelity-red.test.mjs`) passes 16/16 but contains **zero** `watch` coverage (grep found none). |
| **F-3** `waves.send` / `waves.stop` ghost verbs | **CLOSED** | Parse branches exist: `application-cli.mjs:1441-1465` (`waves send RUN_ID --message ...`) and `:1468-...` (`waves stop RUN_ID --reason ...`); both return `command: 'waves.send'` / `'waves.stop'`. Admission list at `application-cli.mjs:27` includes `waves.send`, `waves.stop`. |
| **F-4** `runs list` accepts no cursor | **STILL BITES** | Live: `node scripts/baton.mjs runs list --cursor 5` → `cli_invalid: unexpected argument --cursor` (exit 2). |
| **F-5** `waves list` accepts no cursor | **STILL BITES** | Live: `node scripts/baton.mjs waves list --cursor 5` → `cli_invalid: unexpected argument --cursor` (exit 2). (Bare `waves list` parses fine and reaches the connection phase: `cli_config_invalid: user connection profile is unavailable`.) |
| **F-6** connection-refusal diagnostics | **PARTIAL** (code surface improved, live-server actionability not retested) | The pre-connect refusal is now a typed code with a human message: `waves list` → `cli_config_invalid: user connection profile is unavailable` (exit 2). This run has no live resident to re-probe mid-flight connection failures, so that half of F-6 is not re-verified. |
| **F-7** help topics for facade verbs | **PARTIAL** | Live: `node scripts/baton.mjs help waves` → `No local help is available for waves.` (exit **0**). So the hard failure is gone, but the topic still teaches nothing — an agent asking `help waves` learns only that there is no help. |
| **F-8** exit-code taxonomy collapses distinct failure classes | **STILL BITES** | `scripts/baton.mjs:133`: `cli_invalid`/`cli_config_invalid`/`cli_command_unavailable` → exit 2, everything else → exit 1. Live probes: `run shwo` (typo, user fault) = 2; `run watch abc123` (arg error) = 2; `runs list --cursor 5` (arg error) = 2; `help waves` (soft no-op) = **0**. Parse-level user errors and "unknown verb" share 2 while the validation class `cli_action_inputs_invalid` (e.g. `waves send` bad args, `application-cli.mjs:1450`) exits 1 — the taxonomy still does not let a caller distinguish user-input vs. validation vs. environment on exit code alone. |
| **F-9** `run scratchpad` bare leaks `undefined` | **STILL BITES** (residual) | Live: `node scripts/baton.mjs run scratchpad` → `cli_invalid: unexpected argument undefined`. The append capability itself MOVED (see §2, N-3): CLI absence is now documented policy (`CLI.md:11` — "the worker scratchpad is embedding/projection-only, never a CLI verb"), so the *missing verb* is closed by policy; but the bare-verb error message still exposes the internal `undefined` rather than a helpful "expected sub-verb read|elevate". |
| **F-10** `run steer` stale | **CLOSED** | `application-cli.mjs:1885-1889` — `steer` refuses loudly: `cliError('steer was deleted at the M5 alias sunset; use run send', 'cli_command_unavailable')`. |

### 1.2 Prior MCP row findings (`surface-audit-mcp.md`)

| Prior finding | Status | This-run evidence |
|---|---|---|
| **F1** default profile not a superset of the bus | **STILL BITES** | Live (this run, via `mcpApplicationToolNames()`/`mcpCombinedToolNames()` imports): application profile = **37** tools, combined = **88**. The 51 combined-only tools include every `fleet_run_*` observe/control tool: `fleet_run_status`, `fleet_run_wait`, `fleet_run_approve`, `fleet_run_answer`, `fleet_run_adopt`, `fleet_run_evidence`, `fleet_run_export`, `fleet_run_feedback`, `fleet_run_integrate`, `fleet_run_recover`, `fleet_run_review`, `fleet_run_start`, `fleet_run_stop`, `fleet_run_follow`, `fleet_run_episode`, `fleet_run_workstreams`/`_notify`/`_stop`, plus `fleet_board_*`, `fleet_goal_*`, `fleet_plan_*`, `fleet_kill`, `fleet_spawn`, `fleet_send`, `fleet_drain`, `fleet_wait`, `fleet_interrupt`, `fleet_provider_status`, `fleet_reuse_*`. A default-profile agent still cannot read or steer a fleet run. The in-repo `mcp-profile-parity-red` gate (red-by-design for the missing 13) tracks this — it is a **tracked** divergence, which is why it stays "still bites" rather than "closed". |
| **F2** resume/retry hard-missing | **STILL BITES** | Live: neither profile contains any tool name with `resume` or `retry` (checked across all 37 + 88 names). No `fleet_run_resume_work`, no `fleet_run_retry_verification`. |
| **F3** coaching (refusal guidance) lost at the edge | **CLOSED** | `mcp-northbound.mjs:333` — `stateFailureCode()` returns the coaching cause code when `COACHING_REFUSAL_CODES.has(cause?.code)`; `validateArguments` coaching pass-through at `mcp-northbound.mjs:1042-1044` (non-coaching collapses to `invalid_run_command` at `:1045`). #160 R2 lane-crafted decision at `mcp-northbound.mjs:214`. |
| **F4** `context.briefing` referenced but not a tool | **STILL BITES** | `mcp-northbound.mjs:1480-1482` — the briefing sentence tells an agent to "resolve via the orchestrator's embedded context.briefing command." No `baton_context_briefing` tool exists in either profile (absent from the 51-tool combined-minus-application list and from the application list). The reference remains non-navigable from the MCP surface. |
| **F5** `{decision}` advertised in `answer` schema but refused | **STILL BITES** | `mcp-northbound.mjs:415-421` — `applicationAnswerSchema` `oneOf` still includes `schema({ decision: { type: 'string', enum: ['allow','deny','cancel'] } }, ['decision'])`. The guard at `mcp-northbound.mjs:1114-1120` rejects any answer key other than `optionId`/`text` for `baton_decision_answer` → `invalid_arguments`. Same schema feeds `fleet_run_answer` (`:446`, `:644`). Advertise-vs-refuse persists. |
| **F6** stdio-only transport | **STILL BITES** | `serveMcpStdio(server, opts)` is the only serve entrypoint (`mcp-northbound.mjs:2303-2304`); no HTTP listener is exported from the module. |
| **F7** `repoId` missing from wave tool schemas/examples | **CLOSED** | `MCP.md` wave examples now carry `repoId`; wave tool schemas include the `repo` field (`...repo, ...idem, runId, ...` at `mcp-northbound.mjs:446`, `:644`). |
| **F8** cursor idioms diverge across tools | **STILL BITES** | No unified cursor grammar: `afterCursor` (integer) appears in `run.watch` inputSchema (`application-semantics.mjs:766`) and web-style cursors, while other tools use `cursor`, and MCP tools carry `pageCursor`/offset forms elsewhere. Three spellings remain; no single {canonical → transport} teaching. |
| **F9** wave validation errors code-only | **CLOSED** | Wave validation now returns structured refusals with the failing member index: `mcp-northbound.mjs:1211-1214` (member pointer in the structured error body). |

### 1.3 Prior Web row findings (`surface-audit-web.md`)

| Prior finding | Status | This-run evidence |
|---|---|---|
| **F1** dot-spelled card vs underscore wire | **STILL BITES** | Card advertises DOT names: `web-northbound.mjs:1684-1689`; wire uses UNDERSCORE. New direct ports compound it: `['waves_compile', 'waves.compile', ...]` at `:47` and `['run_scratchpad_append', 'run.scratchpad.append', ...]` at `:53`. No {canonical → transport} map is taught on the card — and there is **no web taught-doc at all** (`impl/` holds only `CLI.md`, `MCP.md`, `VALIDATION.md`), so the web surface's only teaching artifact is the code-level card itself. |
| **F2** unknown-field errors drop the field name | **CLOSED** | `unknown_top_level_field` / `unknown_argument_field` now carry the field: `web-northbound.mjs:524` and `:540`. |
| **F3** `args`-invalid collapses to one code | **PARTIAL** | Typed validator refusals pass through (`web-northbound.mjs:546-558`); untyped/invalid-JSON collapses to the bare invalid-args code remain. |
| **F4** `size_exceeded` → misleading 503 | **CLOSED** | `dispatchFailure` coaching arm now returns **413** with `{field, cap, actual, unit, gracefulPath}`: `web-northbound.mjs:261-272`. |
| **F5** SSE endpoints unadvertised | **STILL BITES** | SSE is fully implemented but unadvertised on the taught surface. Server side: `web-stream.mjs:515` sets `content-type: text/event-stream` for the `/v1/events` stream; the operator client consumes it (`web-operator.mjs:197` — `new EventSource('/v1/events?ticket=' + …)` for the "Advanced event trace"). The card (`web-northbound.mjs:1684-1689`) and the web.bus inventory expose only the POST/GET JSON command names — no SSE route, no ticket flow is taught. A fresh orchestrator must read `web-stream.mjs` to discover subscribe. |
| **F6** `run_wait` ceiling error carries no value | **STILL BITES** | `web-northbound.mjs:560` — the wait-ceiling refusal is still a bare code with no `{cap, actual, unit}` (unlike the coaching 413 family). |
| **F7** web card advertises verbs the web whitelist refuses | **PARTIAL** | Mechanism changed: the 8 facade ports are now formally ledgered web-refused "until #87 lands" in `scripts/surface-divergence-ledger.json` (entries with `refusal: "'unsupported command' (web-northbound.mjs:405) ..."`), and `waves.compile` is ledgered too. So the *tracking* gap is closed but the advertise-vs-refuse behavior still bites until the ledger retires. |
| **F8** `_authorize` collapses all preconditions into one 403 | **CLOSED** | `_authorize` names the specific precondition (`origin` / `csrf` / `repoId` / `capability`): `web-northbound.mjs:821-838`. |
| **F9** three spellings of the same operation (dot / underscore / argv) | **STILL BITES** | Subsumes F1: `waves.compile` (card) / `waves_compile` (wire) / `baton waves compile` (argv) all name the same operation; now three-verb divergence on THREE surfaces for `compile` and `scratchpad.append`. |

### 1.4 Prior coordinator synthesis `control-surface-audit.md` — §2 unified frictions

| §2 friction | Status |
|---|---|
| #1 Command-spelling divergence | STILL BITES (Web F1/F9) |
| #2 Typed refusals destroyed at every edge | **MOSTLY CLOSED** — web field-named 400s + coaching 413 family, MCP coaching allowlist + structured member refusals. Residual: non-coaching MCP validation collapses (`invalid_run_command`, `mcp-northbound.mjs:1045`); untyped web errors. |
| #3 Silent reinterpretation | **PARTIAL** — typo refusal landed (CLI F-1); non-typo unknown verbs still become objectives by design (`application-cli.mjs:1685`, #160 R6 "plain objective" carve-out) and the ADVERTISED `run.watch` is silently compiled to a `watch`-objective run (CLI F-2). |
| #4 MCP default profile not superset of bus | STILL BITES (MCP F1) |
| #5 CLI cannot steer / emergency-stop a wave | **CLOSED** (CLI F-3 — `waves send` / `waves stop` parse branches exist) |
| #6 Cursor/pagination gaps and silent ceilings | STILL BITES (CLI F-4/F-5, MCP F8, Web F6) |
| #7 Surfaces teach what they refuse | **PARTIAL** — divergence ledger introduced (N-7) but `run.watch` (CLI F-2), SSE (Web F5), and the conformance inventory undercount (N-2) remain. |
| #8 Discovery/help gaps | STILL BITES (CLI F-7) |
| #9 Exit-code taxonomy | STILL BITES (CLI F-8) |
| #10 Shared scratchpad has no write verb | **MOVED** — write verb now ships on MCP (`baton_run_scratchpad_append`) and web (`run_scratchpad_append`); CLI absence is documented policy (`CLI.md:11`) with a red-by-design pin. Residual: bare `run scratchpad` error message (CLI F-9). |
| #11 MCP stdio-only (#138) | STILL BITES (MCP F6) |

### 1.5 Prior §3 grammar verdict items

| Verdict item | Status |
|---|---|
| Teach a {canonical → transport} map | NOT DONE — Web F1/F9, MCP F8 unchanged. |
| Remove advertised-but-refused `{decision}` | NOT DONE — MCP F5. |
| Unify the answer grammar | NOT DONE — answer `oneOf` still advertises `{decision}` + `{text}` + `{optionId}`; guard accepts only 2 of 3. |
| Unify the cursor grammar | NOT DONE — MCP F8. |
| Keep web idempotency-key surface | DONE (unchanged — idempotency still honored) |

---

## 2. NEW findings since the prior audit

**N-1 — `waves.compile` (DSL package #170) is a new cross-surface capability with an admission gap.**
All three surfaces gained the verb: CLI `baton waves compile [specPath]` → `waves.compile` (`application-cli.mjs:1379`), MCP `baton_waves_compile` (application profile — confirmed present in the 37-tool set), web direct port `waves_compile` (`web-northbound.mjs:47`, ledgered in `surface-divergence-ledger.json` with an empty `refusal`). It compiles a workflow `specDsl` into a closed workflow spec. Fresh capability, correctly surfaced on CLI and MCP; the web card/conformance story lags (N-2).

**N-2 — the conformance inventory undercounts the web bus by two new direct ports; `surface-conformance: ok` is green anyway.**
The web card advertises **33** dot-spelled names: `commands: [...WEB_APPLICATION_ENTRIES, ...WAVE_WEB_ENTRIES].map(([, name]) => name)` at `web-northbound.mjs:1689` (the only `commands:` emission in the module). `WEB_APPLICATION_ENTRIES` is `Object.entries(APPLICATION_COMMAND_DEFINITIONS).filter(([, definition]) => definition.web)` (`:15-16`) — **25** of the 26 commands (the non-web one is `application.shutdown`, `web:false` in `src/application.mjs`, host-local) — and `WAVE_WEB_ENTRIES` is **8** entries (`:37-54`) including `['waves_compile', 'waves.compile', …]` (`:47`) and `['run_scratchpad_append', 'run.scratchpad.append', …]` (`:53`). So `25 + 8 = 33`. (The wire additionally admits `CANONICAL_WEB_ENTRIES` transports at `:24-27`/`:102-158` — canonical spellings that map to the same operations — but those are never listed on the card, which only shows the legacy dot names.) Live check of the committed conformance inventory:
```
web.bus count: 31
has waves.compile: false
has run.scratchpad.append: false
has waves.list: true
```
So `admitted(web card) = 33 ≠ inventory(web.bus) = 31`. The conformance derivation `webBusNames()` (`surface-conformance.mjs:407-416`) returns `WEB_APPLICATION_ENTRIES` + `WAVE_DIRECT_PORT_VERBS`, and `WAVE_DIRECT_PORT_VERBS` (`:55-57`) still holds only the six original wave verbs — it misses **both** `waves.compile` and `run.scratchpad.append`. Three compounding details make the gate blind:
1. The comment at `surface-conformance.mjs:400-406` claims the fallback "matches the R2 card exactly" — now stale by **2**, and it anticipated only the #170 `waves_compile` addition, not the #158 `run_scratchpad_append` addition.
2. `cliWebRefusedVerbs()` (`:418-424`) only flags names that are in `CLI_WEB_COMMANDS`. `waves.compile` IS in `CLI_WEB_COMMANDS` (`application-cli.mjs:26`), so it shows up as web-refused and is ledgered. `run.scratchpad.append` is **not** in `CLI_WEB_COMMANDS` at all (the CLI has no such verb by policy, `CLI.md:11`), so the gate is structurally blind to the second missing name — it is neither refused nor ledgered.
3. The D1 web leg (`:809-815`) and the artifact check (`:827-828`) both iterate the same undercounting `webBusNames()`, so `node scripts/surface-conformance.mjs` prints `surface-conformance: ok` (exit 0) over a 2-name divergence.
The intended fix — a `webBusAdmittedCommandNames()` accessor "exported by web-northbound.mjs at landing" (`:403-404`) — has not landed, and the divergence ledger tracks `waves.compile` (empty `refusal`) but not `run.scratchpad.append`. The prior audit's reconciliation note 1.4.1 flagged this class of drift (folded into §2 #7); it has grown by +2 since.

**N-3 — `run.scratchpad.append` lands on MCP + web; the CLI's absence is now documented policy, but the bare error is still ugly.**
MCP: `baton_run_scratchpad_append` is in the **application** profile (37-tool set confirmed). Web: direct port `run_scratchpad_append` (`web-northbound.mjs:53`). CLI: deliberately none — `CLI.md:11` states "the worker scratchpad is embedding/projection-only, never a CLI verb"; scratchpad-write red gate pins it red-by-design. Residual defect independent of policy: `baton run scratchpad` → `cli_invalid: unexpected argument undefined` (CLI F-9).

**N-4 — observe-path reliability work (#210 clone-free `eventsView`; WLS-1 single-pass steering index).**
`eventsView()` is clone-free at `coordination-store.mjs:8937`. WLS-1 single-pass steering index (per commit `85519556`) cut per-page log reads for `waves.list`/`waves.progress` roster projections. These raise the observe-surface reliability ceiling that the prior audit could not measure (it ran no live resident); the underlying *surface* contracts are unchanged. Not a regression — recorded as context so future auditors know the observe surfaces were deliberately hardened after the audit.

**N-5 — `glm-5.3` route and GLM ceiling 1→4 admitted, but `CLI.md` fleet-routes table is stale — a NEW doc-truth divergence.**
`application-deployment.mjs:863` — `allowedModels = new Set(['glm-5.2', 'glm-5.3'])`; `:872` comment "fossil — GLM runs wide like its cheap-seat siblings (4)" (ceiling 4). But `CLI.md`'s fleet-routes table lists only `glm-5.2` (`CLI.md:171`); `CLI.md:129` example uses `glm-5.2`. A user reading the taught routes cannot select `glm-5.3` despite it being admitted and defaulted in deployment.

**N-6 — MCP application profile grew 35 → 37 (two new tools: `baton_run_scratchpad_append`, `baton_waves_compile`); still not a bus superset.**
Confirmed live: application = 37, combined = 88, 51 combined-only. The profile keeps growing by accretion (DSL + scratchpad) while the 51-tool gap that motivated MCP F1 is untouched.

**N-7 — divergence-ledger mechanism introduced as the way to formally acknowledge doc-truth divergence.**
`scripts/surface-divergence-ledger.json` now tracks 9 entries: 8 facade ports (`run.attention.watch`, `run.board.post`, `run.scratchpad.elevate`, `run.scratchpad.read`, …) web-refused "until #87 lands" with `retiresIn: "M5"`, plus `waves.compile` with an empty `refusal` field. This is a process improvement (divergences are now explicitly enumerated and dated rather than silently drifting), but it also converts several prior §2-#7 "teaches-what-it-refuses" items into *formally accepted* behavior for the M5 horizon rather than fixed behavior.

---

## 3. Prioritized list (this run)

1. **`run.watch` silent-reinterpretation** (CLI F-2) — an ADVERTISED verb silently starts a new run with objective `"watch"`; `run watch RUN_ID` refuses with `unexpected argument RUN_ID`. Highest severity: it is the one live case of the exact defect the honesty package (#160 R6) was meant to eliminate, and the fidelity suite does not cover it (16/16 with zero `watch` cases). Fix is one parser branch or one documented retirement + `cli_command_unavailable` refusal.
2. **Web conformance undercount 31 vs 33** (N-2) — `surface-conformance: ok` is green while the inventory misses two admitted direct ports (`waves.compile`, `run.scratchpad.append`). The conformance gate should reconcile the inventory against the web card, not against a hand-maintained `WAVE_DIRECT_PORT_VERBS` list.
3. **MCP default-profile superset** (MCP F1 / §2 #4) — 51 tools absent from the default profile; a default agent cannot `fleet_run_status`/`wait`/`approve`/`answer`/`stop`. Tracked red-by-design, but the fresh-agent experience is unchanged since the audit.
4. **Advertised-but-refused `{decision}`** (MCP F5) — schema `oneOf` still lists a third member the guard always rejects; remove it from the schema or implement it.
5. **`CLI.md` fleet-routes stale (no `glm-5.3`)** (N-5) — taught surface disagrees with `application-deployment.mjs:863`. One-line doc fix.
6. **Cursor/ceiling gaps** (CLI F-4/F-5, MCP F8, Web F6) — `--cursor` still refused on `runs list`/`waves list`; the wait ceiling error still carries no value.
7. **Exit-code taxonomy** (CLI F-8) — three parse/validation classes collapse to 2/1 with no distinguishing semantics; `help waves` soft-exits 0 while teaching nothing.
8. **`context.briefing` non-navigable** (MCP F4) — referenced in error text, not a tool.
9. **`run scratchpad` bare message** (CLI F-9 residual) — replace `undefined` with a helpful "expected read|elevate" message.

---

## 4. Judgment calls recorded

- **F-7 (help) and F-6 (connection) marked PARTIAL, not STILL BITES / CLOSED**: `help waves` now soft-exits 0 with a polite message (strictly better than a hard failure) but still teaches nothing; connection failures show a typed `cli_config_invalid` code but mid-flight actionability was not re-probable without a live resident. These are my conservative classifications where the live evidence supports only the code surface, not the full prior claim.
- **MCP F1 kept as STILL BITES despite a red-by-design gate**: a tracked, dated divergence is not a fixed divergence for a fresh agent. The gate changes *accountability*, not the *experience*.
- **N-4 recorded as context, not a finding**: #210/WLS-1 are reliability fixes that touch the observe path the prior audit flagged operationally; they neither reopen nor close any prior finding, so they are logged so later auditors do not rediscover them.
- **No GitHub (gh) claims made** — the mid-turn warning said gh may be unauthenticated in this worktree; all "gate"/"pin"/"red-by-design" references are to in-repo artifacts (`test/cli-wave-fidelity-red.test.mjs`, `mcp-profile-parity-red`, `scratchpad-write-red`, `surface-divergence-ledger.json`), not to issue tracker state.

---

## 5. DECISION_REQUEST — authority-class ambiguity

Which binding document governs a "still bites" determination when the honesty package has *codified* the behavior as a deliberate, tested contract? Three concrete ambiguities:

**DR-1 — `run.watch` (CLI F-2): is the silent objective-compilation a defect or a tested contract?**
The prior audit asserted it as a defect (#157's honesty contract says "no advertised-but-dead verbs"). But #160 R6 deliberately preserves non-typo fallthrough to objective-first start (`application-cli.mjs:1683-1686`: "a plain objective like `run deploy` … keeps the objective-first start"), and `watch` is distance-1-from-zero (a plausible objective), so the fallthrough is *working as specified*. The registry row (`application-semantics.mjs:751-769`) still advertises `run.watch` and the CLI card (`CLI.md:51`) still teaches it — the advertisement is the stale part, not the parser.
- **Option A**: still-bites — an advertised verb must either ship (`run watch RUN_ID`) or refuse `cli_command_unavailable`; the current compile-to-objective violates honesty.
- **Option B**: closed-with-evidence — the parser behavior is now the tested R6 contract; the defect is a *doc-truth* one (retire `run.watch` from `CLI.md:51` and the registry, or add it to `lifecycleActions`), not a runtime one.
- **Recommendation**: A is more faithful to the honesty contract; the one-line fix (add a `watch` branch or an explicit refusal in the run dispatch) is cheaper than keeping the dead advertisement.

**DR-2 — the CLI scratchpad-append absence (prior §2 #10 / N-3): MOVED or still-bites?**
The write verb now ships on MCP + web; the CLI's absence is documented policy (`CLI.md:11`) with a red-by-design pin. The residual `run scratchpad` → `unexpected argument undefined` is a *message-quality* defect independent of the policy question.
- **Option A**: MOVED (as this report tables it) — the capability exists on two agent surfaces; policy covers the third.
- **Option B**: still-bites — a CLI-only operator still cannot append to a shared scratchpad, and the bare-verb error is unteachable.
- **Recommendation**: A for the capability, but the bare-verb message should be fixed regardless (already prioritized as #9).

**DR-3 — MCP default-profile non-superset (MCP F1): tracked-red-by-design vs still-bites.**
`mcp-profile-parity-red` gates the missing 13 as red-by-design, so the project has explicitly accepted the gap for the current milestone.
- **Option A**: still-bites (this report) — a fresh default-profile agent cannot observe or steer fleet runs; the acceptance changes accountability, not the experience.
- **Option B**: closed-with-evidence — a red-by-design gate IS the authority; the finding should be reclassified as tracked/accepted.
- **Recommendation**: A, but the re-run should note the gate as the authoritative *rationale* so the next audit does not re-litigate an accepted divergence.

**Binding scope**: this row report resolves each prior finding against the *current master tree* (docs + source + tests) only. Where a prior finding's resolution depends on which document class binds (doc-truth taught surface vs. in-repo contract vs. red-by-design test gate), the determination above is flagged rather than asserted — the coordinator's `verify-notes.md` should record the ruling so the wave's synthesis carries a single authority for each disputed item.
