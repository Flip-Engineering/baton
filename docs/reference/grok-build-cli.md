# Grok Build CLI (xAI) — Implementation Dossier (baton southbound adapter)

## Summary

- Grok Build CLI **0.1.216** (`grok`, build `b139744655`, Rust binary at `~/.grok/bin/grok`) is xAI's agentic coding harness, powered by the `grok-build` model — **500,000 context tokens**, agent-type `grok-build-plan` (verified live from the ACP initialize handshake).
- It is the first flagship vendor CLI whose primary programmatic surface is **native ACP** (Agent Client Protocol, JSON-RPC 2.0): `grok agent stdio` speaks standard `initialize` → `session/new` → `session/prompt` → `session/update`, plus a documented catalog of **72 `x.ai/*` extension methods** (fs, git, git/worktree, search, terminal, code-nav, session fork/rewind, auth, telemetry). No bridge repo needed — the vendor ships the server.
- Secondary surface: headless one-shot (`grok -p`) with `--output-format plain|json|streaming-json`; streaming-json emits only `text` / `thought` / `end` events — **no tool-call telemetry in one-shot mode**, which alone justifies the session-mode adapter.
- Multi-client is first-party: `grok agent serve` (WebSocket server + secret token), `grok agent headless` (connect out to a WS relay), and a **shared leader process** (`grok agent leader`, clients attach with `--leader`; `grok leader` manages instances) — the analog of codex's daemon+broker, shipped by the vendor.
- Live-verified on this machine: the ACP `initialize` handshake succeeds **unauthenticated** (full capability card returned); `session/new` is the auth gate — `{"code":-32000,"message":"Authentication required","data":"no auth method id provided"}`. Everything model-side (prompt/cancel/permission flows) is pending `grok login` / `XAI_API_KEY`.
- The CLI deliberately mirrors Claude Code's control vocabulary: help text annotates flags with their Claude equivalents (`--allow` "(Claude Code: --allowedTools)", `--system-prompt-override` "(Claude Code: --system-prompt)"), and `--permission-mode` uses Claude's exact enum (`default|acceptEdits|auto|dontAsk|bypassPermissions|plan`).

Evidence classes used below: **[live]** = probed against the real binary on this machine; **[help]** = `grok --help` / `grok agent --help` output (authoritative for 0.1.216); **[doc]** = the bundled user guide at `~/.grok/docs/user-guide/` (ships with the binary, but can drift — two drifts already found, see Limitations); **[acp-spec]** = the public ACP specification (agentclientprotocol.com), which Grok claims conformance with.

---

## 1. Provenance and evidence base

| Evidence | Location |
|---|---|
| Installed binary | `grok 0.1.216 (b139744655)` (`grok --version`; `~/.grok/bin/grok` on PATH) |
| Bundled user guide (21 files) | `~/.grok/docs/user-guide/` — esp. `02-authentication.md`, `05-configuration.md`, `14-headless-mode.md`, `15-agent-mode.md`, `17-sessions.md`, `18-sandbox.md` |
| Live ACP probes | `grok agent stdio` initialize + session/new, unauthenticated; raw frames + probe script committed at [`evidence/grok-0.1.216/`](evidence/grok-0.1.216/) (`grok-acp-probe2.jsonl`, `grok-acp-probe2.mjs`); an earlier initialize-only probe agreed |
| CLI help captures | [`evidence/grok-0.1.216/`](evidence/grok-0.1.216/) — `grok-help.txt`, `grok-agent-help.txt`, `grok-agent-stdio-help.txt` |
| Web | [agentclientprotocol.com](https://agentclientprotocol.com) (ACP spec), [console.x.ai](https://console.x.ai) (API keys) |

Rule applied throughout (house standard): live probe > help output > bundled docs > web; disagreements flagged inline. The `ACP_EXTENSION_METHODS.md` catalog the user guide references (`../../xai-grok-shell/ACP_EXTENSION_METHODS.md`) is **not shipped locally** — the 72-method count and category table are [doc]-grade only.

## 2. Surface map

| Surface | Invocation | Shape |
|---|---|---|
| Interactive TUI | `grok` | human terminal UI (out of scope) |
| Headless one-shot | `grok -p "…"` | one turn per process; plain/json/streaming-json on stdout |
| **ACP session server** | `grok agent stdio` | JSON-RPC 2.0 over stdio, persistent process, streamed updates — **the adapter target** |
| WebSocket server | `grok agent serve --bind 127.0.0.1:2419 --secret <tok>` | HTTP/WS, multi-client, token auth [doc] |
| WS relay (reverse) | `grok agent headless --grok-ws-url wss://…` | agent dials OUT to a relay [doc] |
| Shared leader | `grok agent leader` + client `--leader` (or config `[cli] use_leader`) | one backend, many clients; `grok leader` manages instances [help] |
| Utilities | `grok sessions`, `grok trace`, `grok worktree`, `grok models`, `grok inspect`, `grok import`, `grok mcp`, `grok memory`, `grok login/logout`, `grok update`, `grok setup` | [help] |

`grok agent` shared options [help]: `--reauth`, `-m/--model`, `--reasoning-effort`, `--always-approve`, `--agent-profile <PATH>`, `--leader`/`--no-leader`, `--grok-ws-origin`, `--grok-ws-url`, `--cli-chat-proxy-base-url`, `--xai-api-base-url`. Note `[cli] use_leader` is cited by the help text but absent from the configuration doc — help outranks.

## 3. ACP session surface (`grok agent stdio`) — the adapter target

### 3.1 Initialize handshake [live, verbatim]

Unauthenticated, against 0.1.216:

```
-> {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,
    "clientCapabilities":{"fs":{"readTextFile":true,"writeTextFile":true},"terminal":true}}}
<- {"jsonrpc":"2.0","id":1,"result":{
     "protocolVersion":1,
     "agentCapabilities":{
       "loadSession":true,
       "promptCapabilities":{"image":false,"audio":false,"embeddedContext":true},
       "mcpCapabilities":{"http":true,"sse":true},
       "_meta":{"x.ai/fs_notify":true}},
     "authMethods":[{"id":"grok.com","name":"Grok","description":"Sign in with Grok"}],
     "_meta":{
       "grokShell":true,
       "currentWorkingDirectory":"<probe cwd>",
       "agentVersion":"0.1.216",
       "agentId":"57b7628b-…","agentInstanceId":"bf5d63db-…",
       "hostname":"Williams-MacBook-Air.local",
       "modelState":{"currentModelId":"grok-build","availableModels":[
         {"modelId":"grok-build","name":"Grok Build","description":"Best for advanced coding tasks",
          "_meta":{"totalContextTokens":500000,"agentType":"grok-build-plan"}}]},
       "mcpServers":[],"mcpApps":false,"metadata":null,
       "availableCommands":[
         {"name":"compact","description":"Compress conversation history to save context window","input":{"hint":"optional context about what to preserve"}},
         {"name":"always-approve","description":"Toggle always-approve mode (skip all permission prompts)","input":{"hint":"on|off"}},
         {"name":"context","description":"Show context window usage and session stats","input":null},
         {"name":"session-info","description":"Show session details (model, turns, context usage)","input":null}],
       "cancelRewind":true}}}
```

Adapter-relevant observations:

- **`jsonrpc:"2.0"` is present on the wire** (unlike codex app-server, which omits it).
- `protocolVersion` is the **integer** `1` in both directions. The bundled agent-mode doc's example sends the string `"1"` — the live wire and the ACP spec use an integer; trust live.
- The handshake **is** the harness card: model id, context budget, plan/agent type, capabilities, MCP wiring, and slash-command inventory all arrive before auth. baton's `card()` can be populated from a real handshake rather than hardcoded.
- `availableCommands` exposes `compact` and `always-approve` as runtime commands — i.e. **context compaction and approval-mode toggling are drivable mid-session**.
- `cancelRewind: true` — undocumented flag, name suggests cancel-then-rewind support; semantics unknown (see Open unknowns).
- `promptCapabilities.image: false` — no image input via ACP at 0.1.216 (the TUI may differ).

### 3.2 Auth gate [live, verbatim]

```
-> {"jsonrpc":"2.0","id":2,"method":"session/new","params":{"cwd":"<abs>","mcpServers":[]}}
<- {"jsonrpc":"2.0","id":2,"error":{"code":-32000,"message":"Authentication required","data":"no auth method id provided"}}
```

`initialize` is free; `session/new` is the gate. The `data` string ("no auth method id provided") indicates the standard ACP `authenticate {methodId}` step (methodId `grok.com` per `authMethods`) unlocks it; alternatively `XAI_API_KEY` in the child env, or credentials already present in `~/.grok/auth.json` (see §6). The adapter must classify `-32000 "Authentication required"` as a **spawn-time auth failure**, not a protocol error.

### 3.3 Session lifecycle [doc + acp-spec; shapes cross-checked against 17-sessions.md]

- `session/new {cwd, mcpServers[]}` → `{sessionId}`.
- `session/load {sessionId, cwd, mcpServers[]}` — replay an existing session (capability-gated by `loadSession: true`, which 0.1.216 advertises [live]).
- `session/prompt {sessionId, prompt: [{type:"text",text:…}]}` — runs one turn; streamed `session/update` notifications during; the request's **response** terminates the turn (ACP: `{stopReason}`).
- `session/cancel` — ACP's one-way cancellation notification; per spec the agent stops work and answers the outstanding `session/prompt` with `stopReason: "cancelled"`. Grok's user guide lists ACP conformance but does not document cancel explicitly — **live-verify before declaring the interrupt verb native** (blocked on auth).
- `session/update` notification types [doc, table in 15-agent-mode.md]: `agent_message_chunk`, `agent_thought_chunk`, `tool_call` (name, arguments, status), `plan` (plan-mode entries).
- Permission flow [doc]: agent-initiated approval requests routed to the client ("approve or deny tool executions interactively"); in standard ACP this is the server→client request `session/request_permission` with `allow_once/allow_always/reject_once/reject_always` outcomes [acp-spec]. Grok's exact request/outcome shape is **unverified**; `--always-approve` (spawn flag) and the `always-approve` runtime command (on|off) bypass or restore it.
- Sessions persist to disk regardless of surface (TUI, headless, stdio share one store — §5), so an ACP session survives its process and is `session/load`-able later.

### 3.4 `x.ai/*` extension methods [doc — catalog file not shipped; counts doc-derived]

| Category | Prefix | Examples |
|---|---|---|
| Filesystem | `x.ai/fs/*` | `list`, `exists`, `read_file`, `write_file` |
| Git | `x.ai/git/*` | `status`, `stage`, `commit`, `diffs`, `discard` |
| Git worktree | `x.ai/git/worktree/*` | `create`, `remove`, `apply`, `list`, `gc` |
| Search | `x.ai/search/*` | `fuzzy/open`, `fuzzy/change`, `content` |
| Terminal | `x.ai/terminal/*` | `create`, `kill`, `output`, `wait_for_exit` |
| Code nav (feature-flagged) | `x.ai/code/*` | `goto-definition`, `find-references` |
| Session mgmt | `x.ai/session/*` | `fork`, `resolve_local_for_worktree_resume` |
| Conversation/history | `x.ai/*` | `prompt_history`, `rewind/*`, `compact_conversation`, `share_session` |
| Auth | `x.ai/auth/*` | `get_url`, `submit_code` |
| Feedback/telemetry | `x.ai/*` | `feedback`, `telemetry/*` |

Agent→client push notifications [doc]: `x.ai/search/fuzzy/status`, `x.ai/git/worktree/status`, `x.ai/fs_notify` (capability-advertised live), `x.ai/fs/index` + `/delta`, `x.ai/session_notification` (diff review, retry state, auto-compact), `x.ai/session/update`. Multi-client routing uses `_meta.targetClientId` in server mode.

Fleet-relevant standouts: **`x.ai/session/fork`** (branch a session), **`x.ai/rewind/*`** (the rollback surface codex deprecated, here first-class with on-disk file snapshots), **`x.ai/git/worktree/*`** (native worktree isolation — baton's trust-gate pattern, vendor-side), **`x.ai/auth/get_url` + `submit_code`** (a client can drive login programmatically — baton could complete device auth without a TTY).

## 4. Headless one-shot surface (`grok -p`)

Retained for completeness; the session adapter supersedes it for baton (no tool telemetry, no mid-turn control). Full flag reference [help, cross-checked with 14-headless-mode.md]:

- Prompt: `-p/--single <PROMPT>`, `--prompt-file <PATH>`, `--prompt-json <JSON>` (content blocks), `--verbatim`, stdin piping composes into the prompt.
- Session continuity: `-s/--session-id <ID>` (create-or-resume, headless-only), `-r/--resume [<ID>]` (errors if missing; **most recent if ID omitted** [help] — the bundled doc says ID required; help outranks), `-c/--continue` (most recent for cwd), `--restore-code` (check out the original session's commit on resume), `-w/--worktree [name]` (start in a fresh git worktree; combine `-w -r <id>` to resume into isolation).
- Output: `--output-format plain|json|streaming-json`. `json`: single object `{text, stopReason, sessionId, requestId}`. `streaming-json`: NDJSON events `{"type":"text","data":…}`, `{"type":"thought","data":…}`, `{"type":"end","stopReason":"EndTurn","sessionId":…,"requestId":…}` — **three event types only; tool calls are invisible** [doc]. Exit code 0 success / 1 error.
- Autonomy & safety: `--always-approve` [help] (docs also spell it `--yolo` — alias [doc]), `--permission-mode default|acceptEdits|auto|dontAsk|bypassPermissions|plan` (headless-only; TUI warns and ignores), `--allow <RULE>`/`--deny <RULE>` (repeatable, `ToolPrefix(glob)` syntax — `Bash(rm*)`, `Edit(src/**)`, `WebFetch(domain:x.ai)`; deny beats allow; works in both modes), `--tools <ids>` (allowlist; ids are internal — shell is `run_terminal_cmd`), `--disallowed-tools <ids>` (denylist; supports `Agent` / `Agent(explore, plan)` to gate subagent spawning), `--sandbox <profile>` (§7), `--max-turns <N>`, `--rules <TEXT>` (system-prompt suffix), `--system-prompt-override <PROMPT>`.
- Quality/effort: `--effort low|medium|high|xhigh|max` [help — the headless doc lists only low/medium/high; help outranks], `--reasoning-effort`, `--best-of-n <N>` (run the task N ways in parallel, pick the best — headless-only), `--check` (append a self-verification loop).
- Agents: `--agent <name|path>`, `--agents <JSON>` (inline subagent definitions), `--no-subagents`, `--no-plan`.
- Env: `XAI_API_KEY`, `GROK_HOME` (config-dir override — **per-worker isolation knob**), `GROK_SANDBOX`, `GROK_LOG_FILE`/`GROK_LOG_FILTER`, `RUST_LOG` (stderr, headless only), `GROK_MEMORY`, `GROK_SUBAGENTS`.

## 5. Session store & telemetry (disk surfaces)

`~/.grok/sessions/<url-encoded-cwd>/<session-id>/` [doc, 17-sessions.md]:

| File | Contents |
|---|---|
| `summary.json` | title, model, created/updated timestamps, message count, parent session id |
| `updates.jsonl` | **the ACP session-update stream** — authoritative conversation log (drives `/load`) |
| `chat_history.jsonl` | raw model-visible messages |
| `plan.json` | TODO/task state |
| `rewind_points.jsonl` | file snapshots backing `/rewind` |
| `signals.json` | **turn count, token usage** |
| `feedback.jsonl`, `compaction_checkpoints/`, `subagents/` | feedback, auto-compact state, child sessions |

Two consequences for baton: the on-disk log **is ACP** (one replayable format for both live wire and post-hoc audit — compare claude's transcript JSONL), and `signals.json` gives a usage read even though no live token-usage notification is documented on the wire (contrast codex `thread/tokenUsage/updated`). `grok trace` exports/uploads session trace data; `grok sessions` lists/searches/restores; `grok import` imports foreign sessions (cross-harness migration, mirroring codex `externalAgentConfig/import`).

Sandbox event log: `~/.grok/sandbox-events.jsonl` (profile applications + violations) [doc].

## 6. Auth

Precedence [doc, 02-authentication.md]: **`XAI_API_KEY`** (console.x.ai) > OIDC silent refresh > external auth provider > browser login (grok.com; tokens 7-day, stored `~/.grok/auth.json`, **hot-reloaded** — external writes picked up without restart). Headless boxes: `grok login --device-auth` (device-code flow) or the external-auth-provider contract (`sh -c` a binary; stdout = token (bare or `{access_token, refresh_token, expires_in}`), stderr = user-facing; `GROK_AUTH_EXPIRED=1` set on refresh calls; 60s timeout). ACP-side: `authMethods: [grok.com]` [live] + `x.ai/auth/get_url`/`submit_code` [doc] let a controlling client drive the whole flow.

State on this machine at probe time: **unauthenticated** (`grok models` → "You are not authenticated"; `session/new` → `-32000`). Every model-side claim in this dossier is therefore [doc]-grade until `grok login` or an `XAI_API_KEY` lands — flagged in Limitations.

## 7. Sandbox [doc, 18-sandbox.md]

Kernel-enforced (Seatbelt on macOS, Landlock ≥5.13 on Linux), applied to the **whole grok process at startup, irreversible** — not per-command wrapping. Profiles: `off` (default), `workspace` (read everywhere; write cwd + `/tmp` + `~/.grok/`), `read-only` (write `~/.grok/` only; child network blocked), `strict` (read cwd+system only; child network blocked). Child-process network blocking via seccomp is Linux-only; in-process tools (web_search, LLM API) always have network. `~/.ssh/`, `~/.aws/`, `~/.gnupg/`, `~/.grok/auth/` always write-protected. Custom profiles in `~/.grok/sandbox.toml` / `.grok/sandbox.toml` (`extends`, `read_only[]`, `read_write[]`, `deny[]`, `restrict_network`). Silently degrades to unenforced (with a warning) on unsupported kernels — a fleet health check should parse for that warning.

## 8. Config surface relevant to a fleet [doc, 05-configuration.md]

- Precedence: CLI flags > env > `~/.grok/config.toml` > remote settings (GrowthBook) > defaults. Project-scoped `.grok/config.toml` supports `[mcp_servers]` only; `AGENTS.md` is the project system-prompt vehicle.
- `[features] support_permission = false` appears in the doc's example block **as if a default** — if permission prompting is genuinely off by default, `session/request_permission` may never fire without opt-in. Needs a live check before the approve verb is trusted (see Open unknowns).
- `[session] auto_compact_threshold_percent = 85`, `load_envrc = true`.
- `[model.<id>]` custom models: any **OpenAI-compatible** `base_url` + key — the grok harness can front non-xAI endpoints (a potential second harness family for GLM-class models, subject to ToS).
- `[subagents]` enable/toggle/model-route per subagent type (`explore`, `plan`).
- `[ui.notifications.hooks]` — shell hooks on `turn_complete` / `approval_required` / `agent_error` etc. with `$GROK_EVENT/$GROK_MESSAGE/$GROK_SESSION_ID` — an out-of-band signal channel (ACP updates supersede it for baton, but it's a zero-code fallback).
- `[telemetry]` events/mixpanel/trace-upload knobs; `GROK_TELEMETRY_ENABLED` env.

## 9. Mapping to baton's D1 adapter contract

| D1 verb | Grok ACP mapping | Status |
|---|---|---|
| `card` | populate from live `initialize` `_meta` (model, context budget, commands) | **[live]** — handshake verified |
| `spawn` | spawn `grok agent stdio` (cwd via `session/new` params; flags `-m`, `--always-approve`, sandbox/env) → `initialize` → `session/new` (or `session/load` to resume) | initialize [live]; session/new gated on auth |
| `prompt` | `session/prompt {sessionId, prompt:[{type:"text",…}]}`; turn ends when the request resolves (`stopReason`) | [doc+acp-spec], live-gated |
| `interrupt` | `session/cancel` notification → outstanding prompt resolves `stopReason:"cancelled"` | [acp-spec], live-gated — **verify before declaring native** |
| `steer` | **no native steer in ACP baseline**, none listed in the `x.ai/*` catalog → emulate (interrupt → re-prompt) with `emulated:true` telemetry, or probe whether a second `session/prompt` mid-turn queues/splices | unknown, live-gated |
| `approve` | answer `session/request_permission` server→client requests (`allow_once/allow_always/reject_once/reject_always`) | [acp-spec], live-gated; interacts with `support_permission` config |
| `answer` | no generic ask-user primitive documented; nearest is the permission flow | gap — mark unsupported |
| `kill` | close stdin / SIGTERM process group; sessions persist on disk and are `session/load`-able afterwards | process-level, standard |
| `onEvent` | `session/update` (message/thought chunks, `tool_call`, `plan`) + `x.ai/*` notifications | [doc], live-gated |

The lesson from the phase-8 live re-eval applies with full force: every verb above marked live-gated **must be live-smoked before its card declares `native`** — the claude adapter's three live-breaking defects all sat exactly where behavior was reasoned from docs. Until `grok login` happens, the adapter is buildable against the fake but not certifiable.

## Limitations

1. **Auth-gated verification.** Only `initialize` and the `session/new` auth error are live-verified. Prompt/cancel/permission/update flows — the load-bearing 80% — are [doc]/[acp-spec]-grade. One `grok login` (or `XAI_API_KEY`) unlocks the live smoke; live runs then spend real quota.
2. **Bundled docs drift from the binary** (two instances found): the effort enum (`low|medium|high` in docs vs `…|xhigh|max` in help) and `-r/--resume` (docs: ID required; help: optional). Treat every [doc] claim as help-checkable first, live-checkable second.
3. **The `x.ai/*` catalog is unshipped.** The user guide references `ACP_EXTENSION_METHODS.md` (72 methods) that isn't in the local install; extension-method names beyond the doc's example table are unverifiable offline.
4. **One-shot telemetry poverty**: streaming-json has no tool-call events, no usage payload in `end` — the ACP surface or post-hoc `signals.json` are the only telemetry paths.
5. **No native steer** anywhere in the documented surface (baseline ACP has none; no `x.ai/steer`). Steer will be `emulated` unless a live probe finds mid-turn `session/prompt` splicing (claude turned out to have exactly that undocumented behavior — worth probing before settling).
6. **Approval-mode ambiguity**: `[features] support_permission = false` in the config doc vs the `always-approve` toggle command vs `--permission-mode` (headless-only). Which surface governs ACP-session approvals is untested.
7. **Version churn risk**: 0.1.x with a bundled-docs lag already visible; pin the version in the harness card and re-probe on update (`grok update` exists and `[cli] auto_update = true` is the documented default — **disable auto-update for fleet workers**).
8. **ToS/quota posture unknown** for programmatic subscription driving (the `grok-build-plan` agent type implies a plan-metered account); no published concurrency limits found in the bundled docs. Same fragility class as the Anthropic/Z.ai findings in doc 01 §7.
9. **`grok agent serve`/relay auth** is a shared-secret token [doc] — fine on loopback, not a substitute for real authn if ever bound wider.

## Open unknowns

- **Does `session/cancel` conform to spec** (prompt resolves `cancelled`, session survives)? And what does the live-advertised `cancelRewind: true` do — cancel-then-restore-files? Both first items on the post-auth probe list.
- **Mid-turn `session/prompt`**: rejected, queued, or spliced? Determines whether steer can be better than interrupt+reprompt emulation.
- **Exact `session/request_permission` payload** (tool name/args shape, outcome vocabulary) and whether it fires at all under default config (`support_permission`).
- **Wire shape of `tool_call` updates** (id/status lifecycle, output attachment) — needed for baton's KIND map.
- **Leader-process semantics**: does `--leader` multiplex multiple ACP clients onto one agent? Who receives permission requests? (Same open unknown as codex's daemon multi-subscriber question.)
- **Token usage on the wire**: any per-turn usage in `session/update` `_meta` or the prompt response? (`signals.json` is the fallback.)
- Whether `grok agent stdio` accepts the headless-only control flags (`--max-turns`, `--effort`, `--tools`) — help shows them on the root command; their effect on agent mode is undocumented.

## Sources

**Local (outranking)**
- Live probes (grok 0.1.216, unauthenticated): [`evidence/grok-0.1.216/grok-acp-probe2.jsonl`](evidence/grok-0.1.216/grok-acp-probe2.jsonl) raw frames + probe script (initialize handshake verbatim; `session/new` auth-error shape); earlier initialize-only probe concurred
- CLI help: `grok --help`, `grok agent --help`, `grok agent stdio --help` (captures committed in [`evidence/grok-0.1.216/`](evidence/grok-0.1.216/)), `grok --version`, `grok models` (auth state)
- Bundled user guide: `~/.grok/docs/user-guide/{01-getting-started,02-authentication,04-slash-commands,05-configuration,14-headless-mode,15-agent-mode,16-subagents,17-sessions,18-sandbox,20-background-tasks}.md`

**Web**
- [ACP specification](https://agentclientprotocol.com/protocol/schema) — session/prompt/cancel/permission semantics Grok claims conformance with
- [console.x.ai](https://console.x.ai) — API keys
- ACP SDKs referenced by the user guide: `@agentclientprotocol/sdk` (TS), `agent-client-protocol` (Rust)

---

## Post-auth live-smoke erratum — grok 0.1.216 authenticated, 2026-07-10

The user authenticated (`grok login`, browser flow) and the full spec/phase9 smoke checklist ran:
raw-wire probes #3/#4 plus a live E2E driving the real `GrokAcpCli` adapter end to end (all 8
verdicts PASS — spawn/approve/multi-turn/steer/interrupt/survival/kill). Evidence:
`evidence/grok-0.1.216/grok-acp-probe{3,4}.{mjs,jsonl}`, `grok-adapter-live-e2e.{mjs,jsonl}`.
Corrections and upgrades to the body above:

1. **The model story changes post-auth.** Authenticated `session/new` returns
   `models: {currentModelId:"grok-4.5", availableModels:[grok-4.5 (500K ctx, agentType
   grok-build-plan, supportsReasoningEffort, reasoningEffort:"high"), grok-composer-2.5-fast
   (200K, agentType "cursor")]}` — `grok-build` was the unauthenticated placeholder. The 500K
   context figure stands for the default model. `session/new`'s result is richer than
   `{sessionId}`: it carries `models` and `_meta{currentWorkingDirectory, codebaseIndexed,
   isGitRepo, gitRoot, showNonGitWarning, feedbackEnabled}`.
2. **Usage telemetry IS on the wire** (§9/GA20 correction): every `session/prompt` response
   carries `_meta{totalTokens, inputTokens, outputTokens, cachedReadTokens, reasoningTokens,
   modelId, requestId, promptId}` — per-turn accounting, better than expected. The `signals.json`
   fallback is unnecessary for live turns.
3. **`session/cancel` conforms** (checklist item 1, live-proven): the outstanding prompt resolves
   `{stopReason:"cancelled"}` (with usage `_meta`) and the session survives for further prompts.
   Cancel against an idle session is harmless.
4. **Mid-turn `session/prompt` QUEUES** (item 4): a second prompt during an active turn is
   neither rejected nor spliced — it waits, and the running turn does NOT see its content (a
   "STOP" prompt did not stop the tool loop). **`session/cancel` cancels the active turn AND the
   queued one(s)** — both resolved `cancelled` in one cancel. Two consequences: steer stays
   **emulated** (no native splice), and the emulation MUST be cancel-first-then-prompt (a
   queued-then-cancel ordering would eat the steer content) — the adapter's GA13 ordering, now
   live-validated. The adapter's one-turn-at-a-time guard is deliberately conservative vs. the
   wire's queueing (queued turns are silently cancellable — a footgun for a fleet).
5. **`session/request_permission` FIRES under default config** (item 3) — the
   `[features] support_permission = false` config-doc worry is dead. Live-verbatim options:
   `[{optionId:"always-allow", name:"Yes, allow all edits during this session",
   kind:"allow_always"}, {optionId:"allow-once", name:"Yes", kind:"allow_once"},
   {optionId:"reject-once", name:"No, and tell Grok what to do differently",
   kind:"reject_once"}]` (note `allow_always` FIRST; no reject_always). `toolCall` carries
   `{toolCallId, kind:"edit", title, rawInput:{variant:"Write", filePath, content}}`. Answering
   `selected:allow-once` ran the tool (`tool_call_update status:"completed"`, file on disk).
6. **Two tool update kinds** (item 5): the initial `tool_call {toolCallId, title:"write",
   rawInput}` is followed by `tool_call_update` frames carrying `kind:"edit"`, diff `content:
   [{type:"diff", path, oldText, newText}]`, and `status:"completed"` — the update kind is where
   the useful telemetry lives. `agent_message_chunk`/`agent_thought_chunk` shapes confirmed
   exactly as documented (`content:{type:"text",text}`, token-granular).
7. **`cancelRewind:true` does NOT auto-revert files** (item 2): files written before a cancel
   stayed on disk. It presumably advertises client-driven rewind of a cancelled turn
   (`x.ai/rewind/*`); harmless to the adapter.
8. **Live notification prefix is `_x.ai/*` (leading underscore)**, not the documented `x.ai/*`:
   `_x.ai/session_notification` (sessionUpdate: hook_execution, session_summary_generated),
   `_x.ai/models/update`, `_x.ai/announcements/update`, `_x.ai/mcp/init_progress`,
   `_x.ai/mcp_initialized`, `_x.ai/session/prompt_complete` (fires just before the prompt
   response resolves). Also observed: a standard-ACP `available_commands_update` session/update,
   and one stray id-bearing error response (`id:"skills-reload"`) the client never requested —
   validates the drop-stray-responses discipline.
9. **User-level config bleeds into ACP sessions**: the session connected the user's global MCP
   servers (despite `mcpServers:[]` in session/new) and ran the user's `settings.local` hooks
   (`user_prompt_submit`, `stop` — one hook failure surfaced as a notification, harmless to the
   protocol). Fleet workers should isolate with `GROK_HOME` pointing at a minimal config dir.
10. **`availableCommands` is much richer post-auth** — including **`goal`** ("Set, manage, or
    check an autonomous goal": `<objective> | status | pause | resume | clear`), `loop`, hooks-*,
    plugins, skills. Goal pinning upgrades from ❌ to a runtime-command surface (unprobed).

**Live-smoke gate: CLOSED for this adapter.** All card-native verbs (spawn/prompt/interrupt/
approve/kill) live-proven through the adapter itself; steer live-proven as declared-emulated;
`answer` remains unsupported-by-design. Corrections F1 (usage → `resource.tokens` +
`budgetUsed.tokens`) and F2 (`tool_call_update` → `content.tool_call`) are test-locked
(suite 372/372).
