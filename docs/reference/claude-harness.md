All evidence gathered. Composing the dossier now.

# Claude Code Harness Machinery Outside the SDK (v2.1.205): Hooks, Agent Teams, Background Agents, OTel, Checkpoints, Plugin Hooks

## Summary

- Verified against the installed native binary `/Users/wahargis/.local/share/claude/versions/2.1.205` (Mach-O arm64): the hook system has **30 event types** (far more than the ~14 publicly documented), including `PostToolBatch`, `StopFailure`, `UserPromptExpansion`, `Setup`, `ConfigChange`, `WorktreeCreate/Remove`, `InstructionsLoaded`, `CwdChanged`, `FileChanged`, `MessageDisplay`, and the team events `TeammateIdle`/`TaskCreated`/`TaskCompleted`.
- Agent teams (gated by `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) persist state in `~/.claude/teams/<team>/config.json` (runtime member registry), `~/.claude/teams/<team>/inboxes/<agent>.json` (mailbox), and `~/.claude/tasks/<team>/{N.json,.lock}` (task files with a PID-lockfile) — all schemas confirmed from live files on this machine.
- Background agents: `claude --bg` dispatches to a per-user supervisor daemon; live registry at `~/.claude/sessions/<pid>.json`; `claude agents --json` for scripting; hidden subcommands `attach`, `logs`, `stop`, `respawn`, `rm`, `daemon`; completion/input-needed fires the `Notification` hook with matcher types `agent_completed`/`agent_needs_input` (both present in binary matcher enum).
- Checkpoints are per-session content snapshots at `~/.claude/file-history/<sessionId>/<16hex>@v<N>` indexed by `file-history-snapshot` NDJSON records in the transcript; `--from-pr` resolves via `pr-link` NDJSON records in the same transcript.
- OTel export is env-driven (`CLAUDE_CODE_ENABLE_TELEMETRY=1` + standard `OTEL_*`); metric/span instrument names `claude_code.*` verified in the binary; traces are version/beta-gated (`CLAUDE_CODE_ENHANCED_TELEMETRY_BETA`, v2.1.193+).

---

## 1. Hooks in settings

### 1.1 Config shape and locations

Live stanza from `/Users/wahargis/.claude/settings.json` (this machine):

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [
        { "type": "command", "command": "/Users/wahargis/.claude/hooks/rtk-rewrite.sh" },
        { "type": "command", "command": "/Users/wahargis/.claude/hooks/pm-pre-tool-inject.sh", "timeout": 5 }
      ]}
    ],
    "PostToolUse": [
      { "matcher": "Bash", "hooks": [
        { "type": "command", "command": "/Users/wahargis/.claude/hooks/pm-post-tool-extract.sh", "timeout": 5 }
      ]}
    ]
  }
}
```

Locations (docs: https://code.claude.com/docs/en/hooks): `~/.claude/settings.json` (user), `.claude/settings.json` (project), `.claude/settings.local.json` (local), managed policy, plugin `hooks/hooks.json`, skill/agent frontmatter. Enterprise `allowManagedHooksOnly` disables all but managed. Note from `claude --help` (local, load-bearing for adapters): in `-p`/non-TTY mode "Settings files that fail validation are **silently ignored** (no error dialog is shown)".

### 1.2 Complete event enum (binary evidence — outranks docs)

Extracted verbatim from the hook-registry object literal in the 2.1.205 binary:

```
PreToolUse, PostToolUse, PostToolUseFailure, PostToolBatch, PermissionDenied,
Notification, UserPromptSubmit, UserPromptExpansion, SessionStart, SessionEnd,
Stop, StopFailure, SubagentStart, SubagentStop, PreCompact, PostCompact,
PermissionRequest, Setup, TeammateIdle, TaskCreated, TaskCompleted,
Elicitation, ElicitationResult, ConfigChange, WorktreeCreate, WorktreeRemove,
InstructionsLoaded, CwdChanged, FileChanged, MessageDisplay
```

(Source: `strings` over `/Users/wahargis/.local/share/claude/versions/2.1.205`; the literal appears as `{PreToolUse:{},PostToolUse:{},...,MessageDisplay:{}}`.)

### 1.3 Matcher syntax

- Plain string = exact tool name; `|` = alternation (`"Edit|Write"`); chars outside `[A-Za-z0-9_\- ,|]` switch it to an unanchored JS regex; `"*"`, `""`, or omitted = match all (docs: /en/hooks).
- Per-event matcher targets (binary-embedded per-event help, cross-checked with docs): tool events → `tool_name`; `Notification` → `notification_type` ∈ `permission_prompt, idle_prompt, auth_success, elicitation_dialog, elicitation_complete, elicitation_response, agent_needs_input, agent_completed` (binary enum); `SessionStart` → `source` ∈ `startup, resume, clear, compact`; `SessionEnd` → `reason` ∈ `clear, logout, prompt_input_exit, other`; `PreCompact`/`PostCompact` → `manual|auto`; `UserPromptExpansion` → `command_name`; `SubagentStart/Stop` → `agent_type`; `Setup` → `init|maintenance`; `ConfigChange` → `user_settings, project_settings, local_settings, policy_settings, skills`; `StopFailure` → error type ∈ `rate_limit, overloaded, authentication_failed, oauth_org_not_allowed, billing_error, invalid_request, model_not_found, server_error, max_output_tokens, unknown` (binary enum); `InstructionsLoaded` → `load_reason` ∈ `session_start, nested_traversal, path_glob_match, include, compact`; `FileChanged` → **literal filename list**, not regex (e.g. `".envrc|.env"`).
- Additional `if` field on tool-event hook definitions uses permission-rule syntax (`"if": "Bash(git *)"`, `"Edit(*.ts)"`); Bash matching strips leading env assignments, checks each `&&` subcommand and `$()` substitutions, and multi-word patterns fail open on `$()` (docs: /en/hooks).

### 1.4 Hook definition types (binary zod schema, verbatim field names)

`type: "command"` fields: `command` (string; shell form runs via bash on POSIX / PowerShell on Windows without Git Bash), `args` (string[]; exec form — spawned directly, **no shell**, `${CLAUDE_PLUGIN_ROOT}`-style placeholders substituted per-element), `shell`, `timeout` (seconds, per-hook), `statusMessage` (spinner text), `once` (run once then removed), `async` ("runs in background without blocking"), `asyncRewake` ("runs in background and wakes the model on exit code 2 (blocking error). Implies async."), `rewakeMessage` (@internal), `rewakeSummary` (@internal, defaults to "Stop hook feedback"). `type: "prompt"` fields: `prompt` (with `$ARGUMENTS` placeholder = hook input JSON), `if`, `timeout`, `model`. Also `type: "agent"`, `type: "http"` (`url`, `headers`, `allowedEnvVars`), `type: "mcp_tool"` (`server`, `tool`, `input`) per docs. Prompt/agent hooks are only valid for tool events (PreToolUse, PostToolUse, PermissionRequest) — binary-embedded doc.

Timeout defaults per current docs (/en/hooks): command/http/mcp_tool **600s**, prompt 30s, agent 60s; UserPromptSubmit capped at 30s, MessageDisplay 10s. (Older docs said 60s; the binary's embedded example shows `"timeout": 60` as an example value, not a default — treat 600s as the current default, unverified locally.) All matching hooks run **in parallel**; dedup is by `command`+`args` / `url` / `server`+`tool`+`input`. `SessionEnd` hooks have a separate overall budget: `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS` (env var present in binary).

### 1.5 Hook stdin payload

Common fields (docs /en/hooks + binary): `session_id`, `prompt_id` (v2.1.196+), `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`, `effort`, and in subagent context `agent_id`/`agent_type`. Per-event (binary-embedded help, verbatim):

| Event | Extra stdin fields |
|---|---|
| PreToolUse | `tool_name`, `tool_input`, `tool_use_id` |
| PostToolUse | `tool_name`, `tool_input`, `tool_response`, `tool_use_id` |
| PostToolUseFailure | `tool_name`, `tool_input`, `tool_use_id`, `error`, `error_type`, `is_interrupt`, `is_timeout` |
| PostToolBatch | `tool_calls` (array of `{tool_name, tool_input, tool_use_id, tool_response}`) |
| PermissionDenied | `tool_name`, `tool_input`, `tool_use_id`, `reason` |
| UserPromptSubmit | original `prompt` text |
| UserPromptExpansion | `expansion_type`, `command_name`, `command_args`, `command_source`, original prompt |
| SessionStart | `source`; SessionEnd: `reason` |
| Stop / SubagentStop | `stop_hook_active`, `last_assistant_message` (string in binary; consumed by the codex plugin's stop gate), SubagentStop adds `agent_id`, `agent_type`, `agent_transcript_path` |
| SubagentStart | `agent_id`, `agent_type` |
| TeammateIdle | `teammate_name`, `team_name` |
| TaskCreated / TaskCompleted | `task_id`, `task_subject`, `task_description`, `teammate_name`, `team_name` (`team_name` deprecated per /en/agent-teams) |
| Elicitation | `mcp_server_name`, `message`, `requested_schema`; ElicitationResult: `mcp_server_name`, `action`, `content`, `mode`, `elicitation_id` |
| ConfigChange | `source`, `file_path` |
| InstructionsLoaded | `file_path`, `memory_type` (User/Project/Local/Managed), `load_reason`, `globs`, `trigger_file_path`, `parent_file_path` |
| WorktreeCreate | `name` (suggested slug); WorktreeRemove: `worktree_path` |
| CwdChanged | `old_cwd`, `new_cwd` |
| FileChanged | `file_path`, `event` (`change`/`add`/`unlink`) |
| MessageDisplay | `turn_id`, `message_id`, `index`, `final`, `delta` |

### 1.6 Exit-code semantics (binary-embedded per-event help, verbatim phrases)

Exit 0 = success (stdout parsed for JSON; for UserPromptSubmit/SessionStart/Setup, plain stdout is shown to Claude; for PreCompact, "stdout appended as custom compact instructions"). Exit 2 = blocking error (stderr used, stdout ignored). Other codes = non-blocking, stderr to user only.

| Event | Exit 2 behavior (binary text) |
|---|---|
| PreToolUse | "show stderr to model and block tool call" |
| PostToolUse / PostToolUseFailure | "show stderr to model immediately" (cannot un-run tool) |
| PostToolBatch | "stop the agentic loop (stderr shown to user only)" |
| UserPromptSubmit | "block processing, erase original prompt, and show stderr to user only" |
| UserPromptExpansion | "block expansion and show stderr to user only" |
| Stop | "show stderr to model and continue conversation" |
| SubagentStop | "show stderr to subagent and continue having it run" |
| TeammateIdle | "show stderr to teammate and prevent idle (teammate continues working)" |
| TaskCreated | "show stderr to model and prevent task creation" |
| TaskCompleted | "show stderr to model and prevent task completion" |
| PreCompact | "block compaction" |
| Elicitation | "deny the elicitation"; ElicitationResult: "block the response (action becomes decline)" |
| ConfigChange | "block the change from being applied to the session" (policy_settings not blockable, per docs) |
| StopFailure | "Fire-and-forget — hook output and exit codes are ignored" |
| SessionStart/SessionEnd/SubagentStart/Notification/InstructionsLoaded/CwdChanged/FileChanged | stderr to user only; not blockable |
| WorktreeCreate | any non-zero = creation failed; stdout must be the absolute worktree path |

Stop-loop protection (binary): "A hook blocked the turn from ending ⟨N⟩ consecutive times — overriding and ending turn. For Stop/SubagentStop hooks, check `stop_hook_active` in the input and return success while it's true. Set `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` to raise this limit." (This user sets `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=1000000` in settings env; default cap value is interpolated at runtime and not recoverable from strings.)

### 1.7 JSON output on stdout

Universal: `continue` (false = halt entirely), `stopReason`, `suppressOutput`, `systemMessage`, `terminalSequence` (v2.1.141+, OSC 0/1/2/9/99/777 + BEL only). Decision control: top-level `{"decision":"block","reason":"..."}` for PostToolUse/Stop/SubagentStop/UserPromptSubmit/TaskCompleted (deprecated for PreToolUse). `hookSpecificOutput` must carry `hookEventName`. Key per-event fields (docs /en/hooks, corroborated by binary strings `updatedInput`, `updatedToolOutput`, `permissionDecision`, `additionalContext`, `watchPaths`):

- PreToolUse: `permissionDecision` (`"allow"|"deny"|"ask"|"defer"`), `permissionDecisionReason`, `updatedInput`, `additionalContext`.
- PostToolUse: `updatedToolOutput`, `additionalContext` (binary logs "PostToolUse hook returned updatedToolOutput that does not match …" — output-shape validation exists).
- PermissionRequest: `decision: {behavior: "allow"|"deny", updatedInput, rules:[{type:"never-ask-for-tool", tool_name}]}`.
- PermissionDenied: `retry: true`.
- SessionStart: `additionalContext`, `initialUserMessage`, `sessionTitle`, `watchPaths`, `reloadSkills`.
- CwdChanged/FileChanged: `watchPaths` (registers/updates FileChanged watch list — binary-embedded help); both get `CLAUDE_ENV_FILE` to export env to subsequent Bash commands.
- MessageDisplay: `displayContent` (display-only rewrite).

Verified working PreToolUse rewrite example (live hook `/Users/wahargis/.claude/hooks/rtk-rewrite.sh`, lines 76-98):

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "permissionDecisionReason": "RTK auto-rewrite",
    "updatedInput": { "command": "rtk git status" }
  }
}
```

Env available to hooks: `CLAUDE_PROJECT_DIR`, `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`, `CLAUDE_EFFORT`, `CLAUDE_ENV_FILE` (SessionStart/CwdChanged/FileChanged), `CLAUDE_CODE_REMOTE`, `CLAUDE_CODE_BRIDGE_SESSION_ID` (v2.1.199+). SessionStart env-file output is persisted per session at `~/.claude/session-env/<sessionId>/sessionstart-hook-<N>.sh` (live example on this machine: exports `CODEX_COMPANION_SESSION_ID`, `CODEX_COMPANION_TRANSCRIPT_PATH`, `CLAUDE_PLUGIN_DATA`).

**Baton-adapter note:** `claude --include-hook-events` emits all hook lifecycle events in the `--output-format=stream-json` stream (`claude --help`, local) — the cleanest way for an orchestrator to observe hook activity without owning the hook config.

---

## 2. Agent teams internals

Gate: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` (this machine sets it in `settings.json` `env`). The variable is re-exported into teammate processes (binary contains the literal spawn-env string `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` alongside `CLAUDECODE=1`). Docs: https://code.claude.com/docs/en/agent-teams — teams are **experimental**; `TeamCreate`/`TeamDelete` tools were removed in v2.1.178; `team_name` on the Agent tool is accepted but ignored.

### 2.1 Team config — `~/.claude/teams/<team>/config.json` (real file, this machine)

Team name is session-derived: `session-` + first 8 chars of the lead session ID (e.g. `session-c99705d9`; lead session `c99705d9-ff46-476c-98c0-3220990b9334`). Pre-2.1.178 teams had human names (`arch-refactor` etc. still on disk from Feb 2026). Verified schema from `/Users/wahargis/.claude/teams/session-c99705d9/config.json`:

```json
{
  "name": "session-c99705d9",
  "description": "…optional…",
  "createdAt": 1783017118705,
  "leadAgentId": "team-lead@session-c99705d9",
  "leadSessionId": "c99705d9-ff46-476c-98c0-3220990b9334",
  "members": [
    {
      "agentId": "team-lead@session-c99705d9",
      "name": "team-lead",
      "agentType": "team-lead",
      "joinedAt": 1783017118705,
      "tmuxPaneId": "leader",
      "cwd": "/Users/wahargis/Development",
      "subscriptions": [],
      "backendType": "in-process"
    },
    {
      "agentId": "codex-frontier@session-c99705d9",
      "name": "codex-frontier",
      "color": "blue",
      "agentType": "codex:codex-rescue",
      "model": "sonnet",
      "prompt": "…full spawn prompt stored verbatim…",
      "planModeRequired": false,
      "joinedAt": 1783028330878,
      "tmuxPaneId": "in-process",
      "cwd": "/Users/wahargis/Development",
      "subscriptions": [],
      "backendType": "in-process"
    }
  ]
}
```

Notes: `agentId` format is `name@team`; `agentType` may be a plugin-scoped subagent (`codex:codex-rescue`) or `general-purpose`; `tmuxPaneId` is `"leader"`, `"in-process"`, or a real tmux pane id in split-pane mode; the full spawn `prompt` is persisted (secrets in spawn prompts land on disk). Docs warn this file is runtime state — don't hand-edit or pre-author. Directory is deleted on clean session exit; `~/.claude/tasks/<team>/` persists.

### 2.2 Task store — `~/.claude/tasks/<listId>/` (real files)

`listId` is either the team name (`session-c99705d9`) or a full session UUID for solo sessions (this machine has `2aa9e79e-…` with 931 task files; `CLAUDE_CODE_TASK_LIST_ID` env var in binary allows pointing a session at a list). Layout: one file per task, `<intId>.json`, plus a `.lock` file. Locking is a **PID lockfile**, not flock: binary code writes the holder PID, checks staleness, logs "Acquired PID lock for … (PID …)" / "Cannot acquire lock for … - held by PID", and unlinks on exit/SIGINT/SIGTERM. Docs confirm "Task claiming uses file locking to prevent race conditions."

Real task file (`/Users/wahargis/.claude/tasks/2aa9e79e-…/729.json`, trimmed):

```json
{
  "id": "729",
  "subject": "WEB+CLIENT (user-ruled): YouTube embed parity …",
  "description": "…",
  "activeForm": "…present-continuous spinner label…",
  "owner": "agent-729-youtube-parity",
  "status": "completed",
  "blocks": [],
  "blockedBy": [],
  "metadata": { "shipped": "client PR #294 …" }
}
```

Field semantics (from the live TaskCreate/TaskUpdate/TaskGet/TaskList tool schemas in this 2.1.205 session): `status` ∈ `pending | in_progress | completed` (+ write-only `deleted` which permanently removes); `owner` = agent name (unset = claimable); `blocks`/`blockedBy` = string task-ID arrays maintained via `addBlocks`/`addBlockedBy`; `metadata` = arbitrary JSON object merged on update (null deletes a key); `activeForm` optional. A task with non-empty `blockedBy` cannot be claimed; completing a blocker auto-unblocks dependents.

### 2.3 Mailbox

Path (binary `TeammateMailbox` module): `~/.claude/teams/<team>/inboxes/<agent>.json` — a JSON array (live file observed: `[]`; messages are drained on delivery, so populated shape wasn't observable). Binary functions: `getInboxPath`, `readMailbox` (tolerates ENOENT/unparseable → empty), `clearMailbox`, `createIdleNotification`, `createShutdownRequestMessage/ApprovedMessage/RejectedMessage`, `createPermissionRequestMessage/ResponseMessage`, `createSandboxPermissionRequestMessage/ResponseMessage`, `createModeSetRequestMessage`. Delivery is push-style: "Messages from teammates are delivered automatically; you don't check an inbox" (live `SendMessage` tool description).

Live `SendMessage` tool schema (2.1.205): input `{to, summary?, message}` where `message` is plain text **or** a protocol object:

```json
{"to":"team-lead","message":{"type":"shutdown_response","request_id":"…","approve":true}}
{"to":"researcher","message":{"type":"plan_approval_response","request_id":"…","approve":false,"feedback":"add error handling"}}
{"to":"main","message":"…"}   // background subagents only
```

`shutdown_request` carries `{type, reason?}`. Plan approval: teammate in `planModeRequired` mode submits a plan; lead approves/rejects autonomously (docs /en/agent-teams). Teammate permission prompts bubble to the lead; approval claims relayed agent-to-agent are treated as untrusted. `TaskStop` accepts a teammate's `name@team` agent ID or bare name to terminate it.

### 2.4 Display modes and spawning

Settings key `teammateMode` / flag `--teammate-mode <mode>`, values `"tmux" | "iterm2" | "in-process" | "auto"` (binary flag help; default `"in-process"` since v2.1.179 per docs). iTerm2 native split panes need the `it2` CLI + Python API (v2.1.186+). Internal teammate spawn surface in the binary: flags `--color <color>` (Teammate UI color), `--plan-mode-required`, `--parent-session-id <id>`, `--agent-type`, plus env `CLAUDE_CODE_TEAMMATE_COMMAND` (override the binary used for spawned teammates; adjacent strings `claude-swarm`, `swarm-view`, `tmux`, `it2`). Quality gates: `TeammateIdle`/`TaskCreated`/`TaskCompleted` hooks with exit-2 feedback loops (Section 1.6).

---

## 3. Background agents

### 3.1 Dispatch and manage

`claude --bg, --background` — "Start the session as a background agent and return immediately (manage with `claude agents`)" (`claude --help`, local). `claude agents` opens the agent view; scriptable via `claude agents --json [--all] [--cwd <path>]`. Real output (this machine):

```json
[{"pid":4275,"cwd":"/Users/wahargis/Development/flip","kind":"interactive",
  "startedAt":1783570707479,"sessionId":"2aa9e79e-f854-41c0-9170-a113c8aa7e99",
  "name":"flip-bd","status":"busy"}]
```

Docs (https://code.claude.com/docs/en/agent-view.md) add fields `id`, `state` (`working|blocked|done|failed|stopped`), `waitingFor` — not present in this machine's output for interactive sessions; treat as background-session-only or doc drift. Live-session registry on disk: `~/.claude/sessions/<pid>.json`, one JSON object per running process:

```json
{"pid":4275,"sessionId":"2aa9e79e-…","cwd":"…","startedAt":1783570707479,
 "procStart":"Thu Jul  9 04:18:26 2026","version":"2.1.205","peerProtocol":1,
 "kind":"interactive","entrypoint":"cli","name":"flip-bd","nameSource":"derived",
 "status":"busy","updatedAt":…,"statusUpdatedAt":…,"bridgeSessionId":"session_01…"}
```

Hidden subcommands (verified via `claude attach --help`, `claude daemon --help`; not listed in main help): `claude attach <id>`, `claude logs <id>`, `claude stop <id>`, `claude respawn <id|--all>`, `claude rm <id>`, `claude daemon {run|status|logs|uninstall|stop [--any] [--keep-workers]}`. Local `claude daemon --help` states: "Service install is disabled in this version — the daemon runs on demand and exits when the last client disconnects" (local binary **overrides** any doc claim of a persistent service). Supervisor state paths per docs: `~/.claude/daemon.log`, `~/.claude/daemon/roster.json`, `~/.claude/jobs/<id>/state.json` — **not present on this machine** (no `--bg` use yet), so schemas are unverified.

### 3.2 Notifications, reattach, resume

- Completion/failure/needs-input notifications (v2.1.198+) go through `preferredNotifChannel` and fire the `Notification` hook with types `agent_needs_input` / `agent_completed` — both present in the binary's Notification matcher enum (Section 1.3). This is the hookable signal a baton adapter should subscribe to.
- Inside a parent session, a finished/running background task is injected as a `task_status` message; binary text: "Background agent \"<description>\" (<taskId>) is still running… You can read partial output at <outputFilePath> or send it a message with SendMessage." Reattach: `claude attach <id>` (← returns to agent view, Ctrl+Z drops to shell, session keeps running). Resume by name: `claude --resume <name>` (names persist across restarts v2.1.202+); `/bg` or `←` backgrounds a foreground session.
- File isolation: background sessions auto-move into git worktrees under `.claude/worktrees/`; opt out with settings `{"worktree": {"bgIsolation": "none"}}`. Autonomous draft-PR creation for isolated sessions v2.1.198+. Disable the whole surface: settings `"disableAgentView": true` or `CLAUDE_CODE_DISABLE_AGENT_VIEW=1` (env var present in binary).

### 3.3 Session naming and `--from-pr`

`-n, --name <name>` at launch; `/rename` in-session; Ctrl+R in pickers; unnamed sessions get a derived display name `⟨dirname⟩-⟨2char⟩` (v2.1.196+; confirmed live: `"nameSource":"derived"`, name `development-63`). Derived names are **not** resume handles (docs /en/sessions.md). `--from-pr [value]` — "Resume a session linked to a PR by PR number/URL, or open interactive picker with optional search term" (`claude --help`). The link is a transcript NDJSON record; real line from this machine's transcript:

```json
{"type":"pr-link","sessionId":"2aa9e79e-f854-41c0-9170-a113c8aa7e99","prNumber":31,
 "prUrl":"https://github.com/wahargis/flip-client/pull/31",
 "prRepository":"wahargis/flip-client","timestamp":"2026-05-25T19:50:37.656Z"}
```

Transcripts live at `~/.claude/projects/<project-slug>/<session-id>.jsonl` (slug = cwd with non-alphanumerics → `-`). Other structured record types in the binary alongside `pr-link`: `bridge-session`, `file-history-snapshot`, `attribution-snapshot`, `content-replacement`, `fork-context-ref`. Docs explicitly warn the JSONL entry format "is internal to Claude Code and changes between versions."

---

## 4. OpenTelemetry export

Enable: `CLAUDE_CODE_ENABLE_TELEMETRY=1`; exporters `OTEL_METRICS_EXPORTER` (`otlp|prometheus|console|none`), `OTEL_LOGS_EXPORTER`, `OTEL_TRACES_EXPORTER` (traces v2.1.193+ behind `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1`); endpoints/protocol/headers via standard `OTEL_EXPORTER_OTLP_*` (all confirmed present in the binary env-var table); intervals `OTEL_METRIC_EXPORT_INTERVAL` (default 60000 ms), `OTEL_LOGS_EXPORT_INTERVAL` (default 5000 ms). Dynamic auth: settings key `otelHeadersHelper` (script printing a JSON header map), refresh `CLAUDE_CODE_OTEL_HEADERS_HELPER_DEBOUNCE_MS` (default ~29 min). Cardinality: `OTEL_METRICS_INCLUDE_SESSION_ID` (default true), `_VERSION` (false), `_ACCOUNT_UUID` (true), `_ENTRYPOINT` (false), `_RESOURCE_ATTRIBUTES` (true). Content controls: `OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_ASSISTANT_RESPONSES` (v2.1.193+), `OTEL_LOG_TOOL_DETAILS`, `OTEL_LOG_TOOL_CONTENT` (60 KB truncation), `OTEL_LOG_RAW_API_BODIES[=file:/dir]`. All names above verified in the binary's `OTEL_*` string table; semantics from https://code.claude.com/docs/en/monitoring-usage.

Metrics (docs, names confirmed in binary): `claude_code.session.count`, `claude_code.lines_of_code.count`, `claude_code.pull_request.count`, `claude_code.commit.count`, `claude_code.cost.usage`, `claude_code.token.usage` (attr `type` ∈ input/output/cacheRead/cacheCreation), `claude_code.code_edit_tool.decision`, `claude_code.active_time.total`. Key attributes on cost/token: `model`, `query_source` (`main|subagent|auxiliary`), `effort`, `agent.name`, `skill.name`, `plugin.name`, `mcp_server.name`, `mcp_tool.name`.

Log events (docs; `user_prompt`, `tool_decision`, `api_request…` strings corroborated in binary): `claude_code.user_prompt`, `claude_code.assistant_response` (v2.1.193+), `claude_code.tool_result`, `claude_code.api_request`, `claude_code.api_error`, `claude_code.api_refusal`, `claude_code.tool_decision` (attrs `decision` ∈ accept/…, `source` ∈ config/hook/user_*), `claude_code.permission_mode_changed`, `claude_code.mcp_server_connection`, `claude_code.plugin_installed`, `claude_code.plugin_loaded`, `claude_code.compaction`. Common attrs: `session.id`, `prompt.id`, `user.account_uuid`, `organization.id`, `terminal.type`, `workflow.run_id`/`workflow.name` (v2.1.202+).

Trace spans (binary instrument names, matching docs): `claude_code.interaction` → `claude_code.llm_request`, `claude_code.tool` (→ `claude_code.tool.blocked_on_user`, `claude_code.tool.execution`), `claude_code.hook` (detailed beta: attrs `hook_event`, `hook_name`, `num_hooks`, `duration_ms`, `num_success`, `num_blocking`). Binary also contains `claude_code.mcp.rpc`, `claude_code.bash.subprocess`, `claude_code.subagent.spawn`, `claude_code.events`, `claude_code.tracing` — present in 2.1.205 but not in the public docs table (local evidence ahead of docs). Extra local knobs: `CLAUDE_CODE_OTEL_DIAG_STDERR`, `CLAUDE_CODE_OTEL_FLUSH_TIMEOUT_MS`, `CLAUDE_CODE_OTEL_SHUTDOWN_TIMEOUT_MS`, `CLAUDE_CODE_PROPAGATE_TRACEPARENT` (binary env table).

---

## 5. Checkpointing / rewind (present and active in 2.1.205)

Storage (verified live): `~/.claude/file-history/<sessionId>/<16-hex-file-key>@v<N>` — each file is a **full raw content snapshot** of one version of one tracked file (inspected: plain source text, no framing). The index lives in the session transcript as NDJSON; real record:

```json
{"type":"file-history-snapshot","messageId":"448b3b5b-…","snapshot":{
  "messageId":"c065646f-…",
  "trackedFileBackups":{".gitignore":{"backupFileName":"627c20343e6e997e@v1","version":1,
    "backupTime":"2026-05-19T23:32:34.011Z"}},
  "timestamp":"2026-05-19T23:31:13.370Z"},"isSnapshotUpdate":true}
```

(`/Users/wahargis/.claude/projects/-Users-wahargis-Development-flip/2aa9e79e-….jsonl`.) A snapshot is written per user prompt (`isSnapshotUpdate:false` for the initial empty one, `true` as backups accrue); keys in `trackedFileBackups` are cwd-relative paths.

UX: `/rewind` or double-`Esc` (empty prompt) opens the menu; actions: **Restore code and conversation / Restore conversation / Restore code / Summarize from here / Summarize up to here / Never mind**; post-`/clear` rewind entry `/resume <session-id> (previous session)` requires v2.1.191+ (docs: https://code.claude.com/docs/en/checkpointing.md). Retention follows `cleanupPeriodDays` (default 30). Controls found locally: settings key `fileCheckpointingEnabled` (binary settings-key table), env `CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING`, `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING` (binary env table; SDK checkpointing is opt-in). `claude project purge [path]` deletes "transcripts, tasks, file history, config entry" (`claude project --help`, local). Limitations (docs): bash-command file mutations (`rm`/`mv`/`cp`) and external/concurrent-session edits are NOT tracked — only Claude's file-editing tools.

---

## 6. Plugin hook surface (live example)

Plugins ship `hooks/hooks.json` in the plugin root; same event/config schema as settings hooks plus a top-level `description`. Live file, verbatim — `/Users/wahargis/.claude/plugins/cache/openai-codex/codex/1.0.6/hooks/hooks.json`:

```json
{
  "description": "Optional stop-time review gate for Codex Companion.",
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command",
      "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/session-lifecycle-hook.mjs\" SessionStart",
      "timeout": 5 }] }],
    "SessionEnd":   [{ "hooks": [{ "type": "command",
      "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/session-lifecycle-hook.mjs\" SessionEnd",
      "timeout": 5 }] }],
    "Stop":         [{ "hooks": [{ "type": "command",
      "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/stop-review-gate-hook.mjs\"",
      "timeout": 900 }] }]
  }
}
```

How the wiring works in practice (from the plugin scripts, same dir):
- **SessionStart** reads stdin JSON (`session_id`, `transcript_path`), then appends `export NAME='value'` lines to `$CLAUDE_ENV_FILE` so every later Bash tool call in the session inherits `CODEX_COMPANION_SESSION_ID` etc. (`scripts/session-lifecycle-hook.mjs` lines 22-45). **SessionEnd** tears down broker processes and per-session jobs.
- **Stop gate** (`scripts/stop-review-gate-hook.mjs`): runs a synchronous external review (15-min internal budget under the 900 s hook timeout); on failure prints `{"decision":"block","reason":"…"}` to stdout to keep the turn alive, otherwise exits 0 with advisory notes on stderr. It consumes `input.last_assistant_message` and `input.cwd`/`CLAUDE_PROJECT_DIR` — a production-grade template for any baton stop-gate.

Plugin cache layout: `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/` (versions 1.0.3/1.0.5/1.0.6 side-by-side locally); persistent data dir exposed as `CLAUDE_PLUGIN_DATA` → `~/.claude/plugins/data/<plugin>-<marketplace>/`. Enablement via settings `"enabledPlugins": {"codex@openai-codex": true}` and `"extraKnownMarketplaces": {"openai-codex": {"source": {"source": "github", "repo": "openai/codex-plugin-cc"}, "autoUpdate": true}}` (live settings.json). Session-scoped alternatives: `--plugin-dir <path>`, `--plugin-url <url>` (both repeatable, `claude --help`).

---

## Limitations

- **Agent teams are experimental** and gated; documented limitations (https://code.claude.com/docs/en/agent-teams): `/resume` and `/rewind` do **not** restore in-process teammates (lead will message ghosts); task status can lag (teammates forget to complete tasks, blocking dependents); shutdown waits for current tool call; exactly one team per session, session-scoped; no nested teams; no background subagents from in-process teammates (`run_in_background` errors); lead role is fixed; per-teammate permission modes cannot be set at spawn; split panes unsupported in VS Code terminal/Windows Terminal/Ghostty; `iterm2` mode requires the third-party `it2` CLI. Team `config.json` is runtime state — hand edits are overwritten; teammate `skills`/`mcpServers` frontmatter is ignored for teammates.
- **Team/task file formats are undocumented internals** — everything in Section 2 above is reverse-engineered from live files and the binary; the docs only promise the paths and the `members` array. The mailbox on-disk message schema was not observable (inboxes drain to `[]`).
- **Transcript JSONL is explicitly unstable**: "The entry format is internal to Claude Code and changes between versions, so scripts that parse these files directly can break on any release" (/en/sessions.md). `pr-link` and `file-history-snapshot` parsing is therefore version-fragile.
- **Hooks**: settings files that fail validation are *silently ignored* in `-p`/non-TTY mode (local `--help`); `--bare` skips hooks entirely; `--safe-mode` disables them; Stop/SubagentStop blocking is capped (default cap not extractable; override `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`); `StopFailure` ignores all hook output; `prompt`/`agent` hook types only work on tool events and consume model quota; default command-hook timeout is 600 s per current docs but was 60 s in older docs — pin explicitly.
- **Background agents**: local-only (die on machine shutdown); each session burns rate-limit quota independently; daemon *service* install is disabled in 2.1.205 (on-demand only, per local `claude daemon --help` — local evidence overrides older doc text); notifications require v2.1.198+; `~/.claude/daemon/roster.json` & `~/.claude/jobs/` schemas unverified here (never dispatched on this machine).
- **OTel**: traces are beta (`CLAUDE_CODE_ENHANCED_TELEMETRY_BETA`, v2.1.193+; detailed tracing allowlist-gated); several `claude_code.*` instrument names in the binary are undocumented; metric attribute sets are version-gated (v2.1.153/169/172/193/202 per /en/monitoring-usage).
- **Checkpoints**: bash-mutated and externally-edited files are not tracked — a rewind after `mv`/`rm` silently under-restores; 30-day cleanup (`cleanupPeriodDays`) applies.
- **This machine's hook chain rewrites Bash**: the RTK PreToolUse hook mutates commands via `updatedInput` — any adapter testing on this host must account for it (e.g. `grep` becomes `rtk grep`, observed live during this investigation).

## Open unknowns

- Default value of the Stop-hook consecutive-block cap (runtime-interpolated; only the env override is visible).
- On-disk JSON schema of a queued mailbox message in `inboxes/<agent>.json` (only drained `[]` observed; binary shows constructor names, not serialized shape).
- `~/.claude/daemon/roster.json` and `~/.claude/jobs/<id>/state.json` schemas (paths from docs; absent locally).
- Whether `claude agents --json` `state`/`waitingFor` fields (docs) appear only for supervisor-managed background sessions vs. the `status` field observed for interactive ones.
- `hookSpecificOutput` support (beyond exit-2 and top-level `decision`) for `TaskCreated`/`TaskCompleted`/`TeammateIdle`.
- Semantics of binary-only record types `content-replacement`, `fork-context-ref`, `attribution-snapshot`, `marble-origami-commit` in transcripts.
- `CLAUDE_CODE_EXPERIMENTAL_OBSERVER_AGENTS` (binary env table, no docs found).

## Sources

**Local (authoritative for 2.1.205):**
- Binary: `/Users/wahargis/.local/share/claude/versions/2.1.205` (event enum, exit-code help text, zod hook schemas, env-var tables, OTel names, TeammateMailbox/lock strings)
- `claude --help`, `claude agents --help`, `claude agents --json`, `claude attach --help`, `claude daemon --help`, `claude project --help` (live output)
- `/Users/wahargis/.claude/settings.json` (hooks + teams gate + `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`)
- `/Users/wahargis/.claude/teams/session-c99705d9/config.json`, `…/arch-refactor/config.json`, `…/session-c99705d9/inboxes/team-lead.json`
- `/Users/wahargis/.claude/tasks/session-c99705d9/{1.json,.lock}`, `/Users/wahargis/.claude/tasks/2aa9e79e-…/{729.json,904.json}`
- `/Users/wahargis/.claude/sessions/4275.json`, `/Users/wahargis/.claude/session-env/2aa9e79e-…/sessionstart-hook-0.sh`
- `/Users/wahargis/.claude/file-history/2aa9e79e-…/8d3d1d192523499a@v3`; transcript `/Users/wahargis/.claude/projects/-Users-wahargis-Development-flip/2aa9e79e-….jsonl` (`pr-link`, `file-history-snapshot` records)
- `/Users/wahargis/.claude/hooks/rtk-rewrite.sh`, `pm-pre-tool-inject.sh`
- `/Users/wahargis/.claude/plugins/cache/openai-codex/codex/1.0.6/hooks/hooks.json`, `scripts/session-lifecycle-hook.mjs`, `scripts/stop-review-gate-hook.mjs`
- Live 2.1.205 tool schemas: `SendMessage`, `TaskCreate`, `TaskUpdate`, `TaskList`, `TaskGet`, `TaskStop`

**Web:**
- https://code.claude.com/docs/en/hooks — hook reference
- https://code.claude.com/docs/en/agent-teams — teams guide + limitations
- https://code.claude.com/docs/en/agent-view.md — background sessions / agent view
- https://code.claude.com/docs/en/monitoring-usage — OTel reference
- https://code.claude.com/docs/en/checkpointing.md — checkpoints/rewind
- https://code.claude.com/docs/en/sessions.md — naming, resume, `--from-pr`, transcript storage
---

## Live-probe erratum — claude 2.1.206 stream-json session mode, 2026-07-10

Three live smokes of a persistent `--print --input-format stream-json --output-format
stream-json --verbose` session (session scratchpad `smoke-claude-real.mjs`,
`smoke-claude-approvals.mjs`, `smoke-claude-fixed.mjs`) established, against real turns:

1. **Mid-turn `user` frames STEER the running turn.** A frame written while a turn is executing
   is consumed at the next tool boundary by the SAME turn, which redirects and emits ONE
   `result` (observed: a counting turn abandoned its loop ~one tool-boundary after injection and
   answered the injected instruction). "Queued for the next turn boundary" is the wrong model;
   native steering/nudging needs no interrupt round-trip.
2. **A permission mode is load-bearing in print mode.** With neither `--permission-mode` nor
   `--permission-prompt-tool`, tool calls auto-deny (`Write` refused; no file created). With
   `--permission-mode acceptEdits`, worktree edits run unattended. With `--permission-prompt-tool
   stdio` + `--permission-mode default`, `Write` emits a `can_use_tool` control_request.
3. **`can_use_tool` allows are honored ONLY when the control_response's PermissionResult carries
   `updatedInput` and the request's `toolUseID`** (the Agent SDK reference client always sends
   `{...result, toolUseID: request.tool_use_id}`). A bare `{behavior:'allow'}` is silently
   re-asked with a fresh `request_id` — indefinitely (turn wedge). Deny with
   `{behavior:'deny', message, toolUseID}` completes the turn gracefully (model reports the
   block; no crash).
4. Confirmed unchanged: `control_request {subtype:'interrupt'}` confirms in <100ms mid-tool-call
   and the session survives for further turns; `system/init` carries the wire `session_id`;
   interrupted turns still emit a trailing `result` frame (must be discarded to keep
   one-terminal-per-turn); SIGTERM ends the process cleanly (~0.5s).
