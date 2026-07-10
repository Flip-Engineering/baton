# Codex CLI 0.144.0 — Runtime Surfaces Beyond app-server (baton adapter dossier)

## Summary

- `codex exec --json` emits a flat NDJSON stream of `thread.started` / `turn.started|completed|failed` / `item.started|updated|completed` / `error` events — live-verified on the installed 0.144.0 binary, including exact item field names (`aggregated_output`, `exit_code`, `status`).
- `codex mcp-server` exposes exactly two MCP tools, `codex` and `codex-reply`; sessions map to a `threadId` returned in `structuredContent` — full input/output schemas captured from a live `tools/list` against the installed binary.
- Session state is plain JSONL "rollout" files at `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl` (line types: `session_meta`, `turn_context`, `response_item`, `event_msg`, `compacted`), plus a `session_index.jsonl` mapping thread names → ids. `codex exec resume <id|name> [prompt]` and `--last` operate on these.
- The local binary disagrees with older web docs in several places: `--profile` now layers a *separate file* `$CODEX_HOME/<name>.config.toml` (not `[profiles.*]`), `wire_api = "chat"` is hard-rejected, `--full-auto` is gone from `codex exec`, and Linux sandboxing is bubblewrap-first (`use_legacy_landlock` is a deprecated flag). Local evidence wins.
- OpenAI's own Claude Code plugin (v1.0.6, installed) never uses `codex exec` — it drives a spawned/brokered `codex app-server` exclusively; `exec` is the simpler but strictly poll-free/one-shot leg for a baton adapter.

---

## 1. `codex exec` — headless one-shot runtime

Binary: `/opt/homebrew/lib/node_modules/@openai/codex/bin/codex-aarch64-apple-darwin` (npm shim `codex.js`; package also ships `codex-linux-sandbox-{x64,arm64}` helpers). Version: `codex-cli 0.144.0`.

### Invocation & stdin semantics

```
codex exec [OPTIONS] [PROMPT]
codex exec resume [OPTIONS] [SESSION_ID] [PROMPT]
codex exec review [OPTIONS] [PROMPT]
```

- Prompt as arg, or `-` / omitted → read from stdin. If stdin is a pipe **and** a prompt arg is given, stdin is appended as a `<stdin>` block; the binary prints `Reading additional input from stdin...` to stderr and reads to EOF (observed). **Adapter gotcha:** spawn with stdin closed (`</dev/null`) unless you intend to stream context, or exec will wait on the open pipe.
- Requires a git repo / trusted directory: outside one it exits 1 with stderr `Not inside a trusted directory and --skip-git-repo-check was not specified.` (observed). Override: `--skip-git-repo-check`, or persist trust via `[projects."/path"] trust_level = "trusted"` in config.toml (present in the local config: `/Users/wahargis/.codex/config.toml`).
- It auto-ingests `AGENTS.md` files in the workspace (observed: probe turn immediately ran `rg --files -g 'AGENTS.md'` and read `codex-acp/AGENTS.md`).

### Orchestration-relevant flags (from `codex exec --help`, local)

| Flag | Behavior |
|---|---|
| `--json` | NDJSON events to stdout (vocabulary below) |
| `--output-schema <FILE>` | JSON Schema the final assistant message must conform to; final message is then valid JSON of that shape (docs: also printed to stdout / written via `-o`) |
| `-o, --output-last-message <FILE>` | write last agent message to file |
| `--ephemeral` | do not persist a rollout file |
| `--ignore-user-config` | skip `$CODEX_HOME/config.toml` (auth still resolved from `CODEX_HOME`) |
| `--ignore-rules` | skip user/project execpolicy `.rules` files |
| `-c key=value` | TOML-parsed config override, dotted paths (`-c 'sandbox_permissions=["disk-full-read-access"]'`) |
| `--enable/--disable <FEATURE>` | sugar for `-c features.<name>=true/false` |
| `--strict-config` | error on unrecognized config keys — **without it, invalid values can be silently ignored** (observed: `-c 'sandbox_permissions=["bogus"]'` ran normally) |
| `-s, --sandbox <read-only\|workspace-write\|danger-full-access>` | exec default is read-only (observed `turn_context.sandbox_policy = {"type":"read-only"}`) |
| `--dangerously-bypass-approvals-and-sandbox` | no sandbox, no approvals |
| `--dangerously-bypass-hook-trust` | run hooks without persisted trust |
| `-C/--cd <DIR>`, `--add-dir <DIR>`, `-i/--image <FILE>`, `-m/--model`, `-p/--profile`, `--oss --local-provider <lmstudio\|ollama>` | as named |

Note: `--full-auto` does **not** exist in 0.144.0 exec help (older web docs list it as deprecated) — local binary outranks docs.

### `--json` event vocabulary

Live-captured (failure path, dead local provider — zero quota):

```json
{"type":"thread.started","thread_id":"019f48f9-ee3d-7020-af0f-98d73d027a56"}
{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Model metadata for `fake-model` not found. ..."}}
{"type":"turn.started"}
{"type":"error","message":"stream disconnected before completion: error sending request for url (http://127.0.0.1:9/v1/responses)"}
{"type":"turn.failed","error":{"message":"stream disconnected before completion: ..."}}
```

Live-captured (success path, real turn):

```json
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"I’m checking the workspace’s local instructions..."}}
{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc \"pwd && rg --files ...\"","aggregated_output":"","exit_code":null,"status":"in_progress"}}
{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"...","aggregated_output":"codex-acp/AGENTS.md\n","exit_code":0,"status":"completed"}}
```

Full vocabulary (source of truth: `codex-rs/exec/src/exec_events.rs` in openai/codex):

- Top-level `type`: `thread.started` (`thread_id`), `turn.started`, `turn.completed` (`usage`: `input_tokens`, `cached_input_tokens`, `output_tokens`, `reasoning_output_tokens`), `turn.failed` (`error.message`), `item.started`, `item.updated`, `item.completed`, `error` (`message`).
- `item.type` (snake_case): `agent_message` (`text`), `reasoning`, `command_execution` (`command`, `aggregated_output`, `exit_code`, `status` ∈ `in_progress|completed|failed|declined`), `file_change` (change kinds `add|delete|update`; statuses `in_progress|completed|failed`), `mcp_tool_call` (status `in_progress|completed|failed`), `collab_tool_call` (tools `spawn_agent|send_input|wait|close_agent`; agent statuses `pending_init|running|interrupted|completed|errored|shutdown|not_found`), `web_search`, `todo_list`, `error` (`message`).

Item ids are `item_0`, `item_1`, … per thread (observed). Docs example of a completed turn: `{"type":"turn.completed","usage":{"input_tokens":24763,"cached_input_tokens":24448,"output_tokens":122,"reasoning_output_tokens":0}}`.

### Exit codes (locally observed)

- `2` — CLI usage error (`codex exec --bogus-flag`).
- `1` — config load error (`Model provider 'bogus' not found`; `wire_api = "chat"` rejection), git-check failure, and `turn.failed`.
- `0` — success (standard; not exercised locally to avoid quota). Docs add: an MCP server configured `required = true` that fails init makes `codex exec` exit with an error rather than continue.

### `codex exec resume`

`codex exec resume [SESSION_ID] [PROMPT]` — `SESSION_ID` is a UUID **or thread name** (UUID parse wins); `--last` picks newest; by default filtered to sessions whose recorded `cwd` matches, `--all` disables cwd filtering. Accepts the same `--json`, `--output-schema`, `-o`, `--ephemeral` flags. Interactive `codex resume` additionally has `--include-non-interactive` — implying exec-created sessions are excluded from the interactive picker by default.

### `codex exec review`

Non-interactive reviewer with target selectors: `--uncommitted`, `--base <BRANCH>`, `--commit <SHA>`, `--title <TITLE>`, plus custom instructions prompt.

---

## 2. `codex mcp-server` — harness-as-MCP-tool

Stdio MCP server. Live-verified exchange (initialize → `tools/list`):

```json
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{"listChanged":true}},"serverInfo":{"name":"codex-mcp-server","title":"Codex","version":"0.144.0","user_agent":"codex_cli_rs/0.144.0 (Mac OS 15.5.0; arm64) ..."}}}
```

Exactly two tools:

**`codex`** — "Run a Codex session." `inputSchema` (`additionalProperties:false`, required: `["prompt"]`):

| Property | Type | Notes (verbatim enums) |
|---|---|---|
| `prompt` | string | initial user prompt |
| `model` | string | e.g. `'gpt-5.2'`, `'gpt-5.2-codex'` |
| `cwd` | string | resolved against the *server process* cwd if relative |
| `approval-policy` | enum `untrusted \| on-request \| never` | |
| `sandbox` | enum `read-only \| workspace-write \| danger-full-access` | |
| `config` | object (additionalProperties: true) | per-call overrides of `CODEX_HOME/config.toml` |
| `base-instructions` | string | replaces default instructions |
| `developer-instructions` | string | injected as developer-role message |
| `compact-prompt` | string | compaction prompt |

**`codex-reply`** — required: `["prompt"]`; `threadId` (string) continues the session; `conversationId` retained but marked "DEPRECATED: use threadId instead."

Both tools share `outputSchema`: `{"threadId": string, "content": string}` (required both). So session mapping is: call `codex` → read `structuredContent.threadId` from the `CallToolResult` → pass it to `codex-reply` for each subsequent turn. Content blocks are mirrored into `structuredContent` for clients that prefer it (per `codex-rs/docs/codex_mcp_interface.md`).

Per that interface doc, during a `tools/call` the server also emits `codex/event` notifications carrying serialized `EventMsg` payloads (optionally `_meta.requestId` for correlation), and issues **server→client requests** for approvals: `execCommandApproval` (`conversationId`, `callId`, `command`, `cwd`, `reason?`) and `applyPatchApproval` (`conversationId`, `callId`, `fileChanges`, `reason?`, `grantRoot?`), each expecting `{"decision":"allow"|"deny"}`. Caveats: the doc brands the whole surface "experimental and subject to change without notice", and the baton repo's own vendored notes (`/Users/wahargis/Development/Experiments/baton/codex-acp/AGENTS.md`) record that the `codex/event/*` surface is deprecated with removal planned — prefer `thread/*`/`turn/*`/`item/*` (app-server) where possible. Note the interface doc also describes v2 RPC methods (`thread/start`, `turn/start`, …) that belong to app-server, not to the two-tool MCP surface above.

Flags: `codex mcp-server` accepts only `-c`, `--strict-config`, `--enable/--disable`. Distinguish from `codex mcp` (client-side management of `[mcp_servers.*]`: `list|get|add|remove|login|logout`; `codex mcp list --json` exists; `add` supports `--url`, `--bearer-token-env-var`, `--env`, `--oauth-client-id`, `--oauth-resource`).

---

## 3. `config.toml` surface relevant to orchestration

Location `$CODEX_HOME/config.toml` (default `~/.codex/config.toml`); every subcommand takes `-c key=value` overrides (value parsed as TOML, raw-string fallback).

Verified live keys (from `/Users/wahargis/.codex/config.toml`): `model`, `model_reasoning_effort` (`minimal|low|medium|high|xhigh`), `approvals_reviewer = "user"` (present in `turn_context` too; sparsely documented), `[features]`, `[mcp_servers.NAME] command=...`, `[model_providers.NAME] {base_url, env_key, name}`, `[projects."/abs/path"] trust_level = "trusted"`, `[shell_environment_policy] inherit = "core"` + `[shell_environment_policy.set] KEY = "value"`, `[notice]`, `[marketplaces.*]`, `[plugins."name@marketplace"] enabled`.

Reference surface (learn.chatgpt.com config reference — the current home of the docs; developers.openai.com 308-redirects there):

- `approval_policy = "untrusted" | "on-request" | "never"`, or granular: `approval_policy = { granular = { sandbox_approval, rules, mcp_elicitations, request_permissions, skill_approval } }`.
- `sandbox_mode = "read-only" | "workspace-write" | "danger-full-access"`; legacy `[sandbox_workspace_write]` with `network_access`, `exclude_slash_tmp`, `exclude_tmpdir_env_var`, `writable_roots`.
- `sandbox_permissions = [...]` (CLI help's own example) with kebab-case values `disk-full-read-access`, `disk-write-cwd`, `disk-write-platform-user-temp-folder`, `disk-write-platform-global-temp-folder`.
- Newer named permission profiles: `default_permissions = ":read-only"|":workspace"|":danger-full-access"|"<name>"` plus `[permissions.<name>]` (`extends`, `[permissions.<name>.filesystem]` path→`read|write|deny`, `[permissions.<name>.network]` `enabled`, `mode = "limited"|"full"`, `[.network.domains]` allow/deny globs, `[.network.unix_sockets]`). `codex sandbox -P/--permission-profile <NAME>` consumes these; live `turn_context.permission_profile` shows the compiled shape: `{"type":"managed","file_system":{"type":"restricted","entries":[{"path":{"type":"special","value":{"kind":"root"}},"access":"read"}]},"network":"restricted"}`.
- **Profiles:** local 0.144.0 help says `-p, --profile <CONFIG_PROFILE_V2>` = "Layer `$CODEX_HOME/<name>.config.toml` on top of the base user config" — file-per-profile. The old `[profiles.NAME]` table is deprecated per docs. Local binary outranks any doc still teaching `[profiles]`.
- `[mcp_servers.NAME]`: `command`, `args`, `env`, `cwd`, `url`, `bearer_token_env_var`, `http_headers`, `env_http_headers`, `startup_timeout_sec` (also `startup_timeout_ms`), `tool_timeout_sec`, `required`, `enabled`, `enabled_tools`/`disabled_tools`, `default_tools_approval_mode = "auto"|"prompt"|"writes"|"approve"`, per-tool `[mcp_servers.NAME.tools.TOOL] approval_mode`.
- `[shell_environment_policy]`: `inherit = "all"|"core"|"none"`, `ignore_default_excludes`, `exclude = ["*SECRET*"]`, `include_only`, `set = {K="V"}`.
- `notify = ["/path/to/program", "arg"]` — spawned per event with one JSON arg; the documented event is `agent-turn-complete` with kebab-case keys: `{"type":"agent-turn-complete","turn-id":"...","input-messages":[...],"last-assistant-message":"..."}` (a `thread-id` key per current docs; `cwd` was a requested addition — openai/codex issue #4005 — treat as version-dependent). This is the cheapest push-notification hook for a poll-based adapter.
- **Hooks (stable feature):** live file `/Users/wahargis/.codex/hooks.json` uses Claude-Code-compatible shape: top-level `"hooks"` with events `PreToolUse`, `PostToolUse`, `SessionStart`, `UserPromptSubmit`, entries `{matcher, hooks:[{type:"command", command, timeout}]}`. Docs additionally list events `PermissionRequest`, `PreCompact`, `PostCompact`, `SubagentStart`, `SubagentStop`, `Stop`, and a `[hooks]` TOML form. Hooks require persisted trust (`--dangerously-bypass-hook-trust` to skip); admins can pin `allow_managed_hooks_only = true` in `requirements.toml` only.
- Custom providers: `[model_providers.X]` — **`wire_api = "chat"` is rejected at config load in 0.144.0**: `Error loading config.toml: 'wire_api = "chat"' is no longer supported. How to fix: set 'wire_api = "responses"' ... https://github.com/openai/codex/discussions/7782` (observed verbatim).

---

## 4. Session storage on disk

`~/.codex/sessions/` — dated tree `YYYY/MM/DD/rollout-<ISO-ts>-<uuidv7>.jsonl` (231 files locally; a few legacy flat `rollout-*.jsonl` at the root from ≤2026-03). The filename UUID is the thread id used by `resume`/`fork`.

Line format: `{"timestamp": "...Z", "type": <t>, "payload": {...}}`. Observed `type` values with payload sub-types (tallied across recent local sessions):

- `session_meta` — payload keys observed: `session_id`, `id`, `parent_thread_id`, `timestamp`, `cwd`, `originator` (`"codex-tui"`), `cli_version`, `source` (e.g. `{"subagent":{"thread_spawn":{...,"agent_nickname","agent_role"}}}`), `thread_source`, `model_provider`, `base_instructions` (full text inlined).
- `turn_context` — keys: `turn_id`, `cwd`, `workspace_roots`, `current_date`, `timezone`, `approval_policy`, `approvals_reviewer`, `sandbox_policy` (`{"type":"read-only"}`), `permission_profile`, `model`, `effort`, `summary`, `comp_hash`, `personality`, `collaboration_mode`, `multi_agent_version` (`"v2"`), `multi_agent_mode`, `realtime_active`.
- `response_item` — sub-types: `function_call`, `function_call_output`, `message`, `reasoning`, `web_search_call` (the model-wire transcript).
- `event_msg` — sub-types observed: `token_count`, `agent_message`, `user_message`, `task_started`, `task_complete`, `patch_apply_end`, `mcp_tool_call_end`, `context_compacted`, `web_search_end`, `turn_aborted`.
- `compacted` — compaction checkpoints.

Adjacent state (all under `~/.codex/`): `session_index.jsonl` (lines `{id, thread_name, updated_at}` — thread-name → UUID mapping that `resume <name>` uses), `history.jsonl` (lines `{session_id, text, ts}` — cross-session prompt history), `state_5.sqlite` / `logs_2.sqlite` / `goals_1.sqlite` / `memories_1.sqlite` (opaque, version-suffixed — expect schema churn), `models_cache.json`, `version.json` (`{latest_version, last_checked_at, dismissed_version}`), `external_agent_session_imports.json` (cross-harness import ledger), `shell_snapshots/`, `log/codex-login.log`. Lifecycle: `codex archive|delete|unarchive <id|name>`, `codex fork`.

---

## 5. Auth storage & modes

`~/.codex/auth.json` (values redacted; structure verified):

```json
{"auth_mode": "chatgpt", "OPENAI_API_KEY": null,
 "tokens": {"id_token": "...", "access_token": "...", "refresh_token": "...", "account_id": "<uuid>"},
 "last_refresh": "..."}
```

- `codex login status` → `Logged in using ChatGPT` (observed). `codex login --with-api-key` (key via stdin) sets the `OPENAI_API_KEY` field; `--with-access-token` and `--device-auth` also exist.
- `CODEX_API_KEY` env var: per current non-interactive docs it is honored **only by `codex exec`** (not interactive), for per-invocation auth; docs warn against setting it job-wide in CI that runs repo-controlled code. Not verifiable from binary strings locally (release binary's string table is stripped/packed — string absence is not evidence).
- `CODEX_ACCESS_TOKEN` is referenced by `codex login --with-access-token` and `codex exec-server --use-agent-identity-auth`.
- Feature `secret_auth_storage` (stage "stable", default **false** locally) moves secrets to OS keychain when enabled — adapters should not assume `auth.json` always holds tokens.
- `--ignore-user-config` explicitly keeps auth resolution on `CODEX_HOME`, so an adapter can run hermetic config with the user's login intact. Separate `CODEX_HOME` per worker = separate auth + sessions + config.

---

## 6. Sandboxing per-OS and `codex sandbox`

- **macOS: Seatbelt.** `codex sandbox [COMMAND]...` — help text says verbatim "Full command args to run under seatbelt". Live-verified: `codex sandbox /bin/echo hello` → exit 0; `codex sandbox /usr/bin/touch /Users/wahargis/forbidden_probe` → `Operation not permitted`, exit 1, no file created. `--log-denials` tails macOS `log stream` for sandbox denials and prints them after exit — the single best debugging flag for adapter sandbox tuning. Other flags: `-P/--permission-profile <NAME>`, `--sandbox-state-json <JSON>` (from `codex/sandbox-state-meta`), `--sandbox-state-readable-root`, `--sandbox-state-disable-network`, `--allow-unix-socket <PATH>`, `--include-managed-config`.
- **Linux: bubblewrap-first.** Current docs: Codex uses the first `bwrap` on `PATH`, falling back to a bundled helper needing unprivileged user namespaces; the npm package ships that helper at `/opt/homebrew/lib/node_modules/@openai/codex/bin/codex-linux-sandbox-{x64,arm64}`. Local `codex features list` corroborates the transition: `use_legacy_landlock  deprecated  false` (Landlock/seccomp is now the *legacy* opt-in) and `use_linux_sandbox_bwrap  removed  false` (the bwrap flag graduated/was removed as a toggle). Ubuntu 24.04 may need the AppArmor `bwrap-userns-restrict` profile enabled.
- **Windows:** native Windows sandbox under PowerShell; WSL2 uses the Linux path (docs; `elevated_windows_sandbox`/`experimental_windows_sandbox` feature flags are "removed" locally).
- Interactive default is `workspace-write` per docs; **exec default is read-only** (locally observed via `turn_context.sandbox_policy`). Escape hatch everywhere: `--dangerously-bypass-approvals-and-sandbox`.

---

## 7. `exec-server`, `cloud`, and neighbors

- `codex exec-server` [EXPERIMENTAL]: standalone exec service. `--listen <URL>` supports `ws://IP:PORT` (default), `stdio`, `stdio://`; remote registration via `--remote <URL>`, `--environment-id <ID>`, `--name <NAME>`, `--use-agent-identity-auth` (reads `CODEX_ACCESS_TOKEN`). Protocol undocumented; schema presumably in the repo's exec-server crate.
- `codex cloud` [EXPERIMENTAL]: `exec` (submit; `--env <ENV_ID>` required, `--attempts <N>` best-of-N, `--branch <BRANCH>`), `status`, `list`, `apply`, `diff`. Companion top-level `codex apply <TASK_ID>` applies the latest agent diff via `git apply`.
- Also relevant: `codex doctor` (install/config/auth/runtime diagnostics), `codex debug models|prompt-input` (JSON dumps of model catalog and prompt-input list), `codex remote-control` [experimental].

---

## 8. Feature flags (`codex features list`, local 0.144.0)

Columns: name, stage, effective value. Orchestration-relevant highlights (full list captured):

- Stable+on: `apps`, `auth_elicitation`, `browser_use`(+`_external`, `_full_cdp_access`), `code_mode_host`, `computer_use`, `fast_mode`, `goals`, `guardian_approval`, `hooks`, `image_generation`, `multi_agent`, `personality`, `plugins`, `plugin_sharing`, `remote_plugin`, `shell_snapshot`, `shell_tool`, `skill_mcp_dependency_install`, `tool_call_mcp_elicitation`, `tool_suggest`, `unified_exec`, `workspace_dependencies`, `mentions_v2`, `enable_request_compression`, `remote_compaction_v2`.
- Experimental: `memories` (on locally), `network_proxy` (off), `prevent_idle_sleep` (off).
- Under development (off): `multi_agent_v2`, `enable_fanout`, `item_ids`, `token_budget`, `rollout_budget`, `runtime_metrics`, `apply_patch_streaming_events`, `non_prefixed_mcp_tool_names`, `request_permissions_tool`, `deferred_executor`, `concurrent_reasoning_summaries`, `standalone_web_search`, `local_thread_store_compression`, `use_agent_identity`, others.
- Removed-but-listed (ignore as config keys): `steer`, `sqlite`, `tui_app_server`, `collaboration_modes`, `remote_models`, `search_tool`, `undo`, etc.

Toggle per-invocation with `--enable/--disable <FEATURE>` on any subcommand; persist with `codex features enable|disable <name>` (writes config.toml — mutating, not run here). `codex features list` is a cheap capability-negotiation probe for a baton "harness card".

---

## 9. How OpenAI's own Claude Code plugin drives Codex (local evidence)

Plugin cache: `/Users/wahargis/.claude/plugins/cache/openai-codex/codex/1.0.6/`.

- It spawns `codex app-server` directly — `spawn("codex", ["app-server"], {stdio:["pipe","pipe","pipe"]})` at `scripts/lib/app-server.mjs:190` — or attaches through a Unix-socket broker advertised via env var `CODEX_COMPANION_APP_SERVER_ENDPOINT` (`BROKER_BUSY_RPC_CODE = -32001`).
- Zero uses of `codex exec` anywhere in the plugin scripts (grep verified). OpenAI's own bridge treats app-server as the only production control surface; `exec` is for CI/one-shots.
- Its `initialize` capabilities opt out of the noisiest deltas: `optOutNotificationMethods: ["item/agentMessage/delta","item/reasoning/summaryTextDelta","item/reasoning/summaryPartAdded","item/reasoning/textDelta"]` (`scripts/lib/app-server.mjs`) — a ready-made noise-reduction list for any adapter.
- `CODEX_HOME` resolution mirrored at `scripts/lib/codex.mjs:654`: `process.env.CODEX_HOME || ~/.codex`.

---

## Limitations

- **`codex mcp-server` interface is officially experimental** — "subject to change without notice" (`codex-rs/docs/codex_mcp_interface.md`); `conversationId` already deprecated in favor of `threadId`, and the `codex/event` notification family is slated for removal per the baton repo's vendored notes (`/Users/wahargis/Development/Experiments/baton/codex-acp/AGENTS.md`). Pin CLI versions per adapter.
- **No strict validation by default:** invalid config values can be silently swallowed — observed `-c 'sandbox_permissions=["bogus"]'` running a normal turn with no warning. Always pass `--strict-config` in adapters; note it will then also reject *stale-but-harmless* keys after upgrades.
- **`exec-server` and `cloud` are flagged [EXPERIMENTAL] in `--help` itself**; `exec-server`'s wire protocol is undocumented outside the repo source.
- **Docs are mid-migration** (developers.openai.com/codex → 308 → learn.chatgpt.com) and lag the binary: `--full-auto` still documented but absent from 0.144.0; `[profiles.*]` tables deprecated in favor of `$CODEX_HOME/<name>.config.toml`; `wire_api="chat"` documented historically but hard-rejected now (openai/codex discussion #7782). Local `--help` is authoritative.
- **exec is fire-and-forget:** no steer/interrupt/approval channel; `approval_policy` effectively must be `never`-compatible, and mid-turn control requires app-server. `--json` events are stdout-only; diagnostics interleave on stderr (`ERROR codex_models_manager::manager: failed to refresh available models: ...` observed even during normal startup with unreachable providers).
- **SQLite state files are version-suffixed (`state_5`, `logs_2`, `goals_1`)** — schema churn is expected; do not build on them.
- **Binary strings are stripped/packed** — absence of a string in `strings` output proved nothing (e.g. `session_meta` not findable despite being emitted); don't use strings-diffing for feature detection, use `codex features list` + app-server schema.
- **notify payload fields are version-dependent** (`cwd`/`thread-id` additions tracked in openai/codex issue #4005); the only long-stable keys are `type`, `turn-id`, `input-messages`, `last-assistant-message`.
- **`codex exec` blocks on open stdin pipes** (reads to EOF when stdin is piped alongside a prompt arg) — spawn with stdin closed.
- Local user config quirk worth knowing before testing on this machine: `/Users/wahargis/.codex/config.toml` sets `model = "gpt-5.6-sol"`, `model_reasoning_effort = "xhigh"`, and contains a `[model_providers.deepseek]` entry whose `env_key` field holds a literal API key (misuse of the field — `env_key` should name an env var; value not reproduced here). Adapters should use `--ignore-user-config` for hermetic runs.

## Open unknowns

- Success-path exit code and `turn.completed` emission were not exercised locally (quota constraint) — `usage` field names are from repo source + docs, not local capture.
- Whether `codex mcp-server` in 0.144.0 uses MCP *elicitation* (feature `tool_call_mcp_elicitation` stable/on) vs the documented custom `execCommandApproval`/`applyPatchApproval` server-requests for approvals during a `codex` tool call — needs a live tool-call probe (costs quota).
- `codex exec-server` message schema (`ws://` framing, auth handshake for `--use-agent-identity-auth`).
- Where hook trust is persisted (implied by `--dangerously-bypass-hook-trust`; likely `state_5.sqlite`) and the exact hook stdin/stdout contract (Claude-compatible shape observed in `~/.codex/hooks.json`, but I/O protocol unverified).
- Full valid enum for the flat `sandbox_permissions` list in 0.144.0 (config parser silently accepted an invalid value, so error-message enumeration failed); the four documented kebab-case values are confirmed only from docs/search.
- Whether `--output-schema` retries/fails on non-conforming model output, and its exact exit code on schema violation.

## Sources

- Local binaries/files (authoritative): `codex --help` / `exec --help` / `exec resume --help` / `mcp-server --help` / `sandbox --help` / `cloud --help` / `exec-server --help` / `features list` / `mcp add --help` / `login status` (codex-cli 0.144.0); live probes in `/private/tmp/claude-501/-Users-wahargis-Development/73adbbf2-a514-4a17-8729-9cda68da5bac/scratchpad/exec_probe*.out`; `/Users/wahargis/.codex/{config.toml,auth.json,hooks.json,session_index.jsonl,history.jsonl,version.json,sessions/...}`; `/opt/homebrew/lib/node_modules/@openai/codex/bin/`; `/Users/wahargis/.claude/plugins/cache/openai-codex/codex/1.0.6/scripts/lib/{app-server.mjs,codex.mjs}` and `skills/codex-cli-runtime/SKILL.md`; `/Users/wahargis/Development/Experiments/baton/codex-acp/AGENTS.md`.
- Web: https://github.com/openai/codex/blob/main/codex-rs/docs/codex_mcp_interface.md · https://raw.githubusercontent.com/openai/codex/main/codex-rs/exec/src/exec_events.rs · https://developers.openai.com/codex/noninteractive (→ https://learn.chatgpt.com/docs/non-interactive-mode) · https://learn.chatgpt.com/docs/config-file/config-reference · https://learn.chatgpt.com/docs/sandboxing · https://developers.openai.com/codex/concepts/sandboxing · https://developers.openai.com/codex/permissions · https://github.com/openai/codex/issues/4005 · https://github.com/openai/codex/discussions/7782 · https://codex.danielvaughan.com/2026/03/30/codex-cli-as-mcp-server/ · https://codex.danielvaughan.com/2026/04/20/codex-cli-split-permissions-fine-grained-filesystem-network-policies/