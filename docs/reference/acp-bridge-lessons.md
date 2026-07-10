All evidence gathered. Composing the dossier now.

# The ACP Bridges as Adapter Engineering References: claude-agent-acp & codex-acp

*Evidence base: shallow clones of both repos at `main` as of 2026-07-09 (local paths under `/private/tmp/claude-501/-Users-wahargis-Development/73adbbf2-a514-4a17-8729-9cda68da5bac/scratchpad/`, hereafter `$SCRATCH`), GitHub issue/PR archaeology via `gh api`. Local clone evidence outranks READMEs where they disagree; disagreements are flagged inline.*

## Summary

- **Two production bridges, two opposite southbound shapes.** `claude-agent-acp` (v0.58.1, TypeScript, Zed Industries) embeds the Claude Agent SDK in-process — one SDK `query()` subprocess per ACP session. `codex-acp` (v1.1.2, TypeScript) spawns one shared `codex app-server` JSON-RPC daemon and multiplexes ACP sessions onto threads. Both are exactly baton's adapter problem, solved twice.
- **The hardest engineered code in both repos is cancellation-vs-completion race handling**: claude-agent-acp has a 30s "force-cancel grace period" + orphan-result ledger + owed-idle debt counter (all traceable to numbered incident issues #680/#773/#825/#844); codex-acp has stale-turn marking, pending-turn-start promises so cancel can await a turnId that doesn't exist yet, and auto-`cancel` answers to approvals from stale turns.
- **Neither bridge restarts a wedged harness.** Both mark the session dead and force the client to start a new session — "wedge recovery" means *settling promises*, not *reviving processes*. Baton's adapters must decide to do better (respawn + resume) because baton owns the fleet, not an editor UI.
- **Capability loss is enumerable and large**: claude-agent-acp silently swallows hooks/task/background-task/notification message classes and never wires rewind/fork-by-message; codex-acp explicitly no-ops 30+ app-server notification types including `turn/diff/updated`, `process/*`, `remoteControl/*`, and `thread/realtime/*`. Both smuggle lossless raw payloads through `_meta` namespaces (`_meta.claudeCode.*`, `_meta.codex.*`) — the escape-hatch pattern baton should formalize.
- **Permission mapping is where the most product-shaped decisions live**: canUseTool → 3 fixed ACP options with `updatedPermissions` rules on the Claude side; three distinct typed approval RPCs (`item/commandExecution|fileChange|permissions/requestApproval`) flattened onto `session/request_permission` with decisions round-tripped via `_meta.codex.decision` on the Codex side.

---

## 1. Identity, lineage, and the app-server rewrite

| | claude-agent-acp | codex-acp |
|---|---|---|
| npm | `@agentclientprotocol/claude-agent-acp` 0.58.1 | `@agentclientprotocol/codex-acp` 1.1.2 |
| bin | `claude-agent-acp` (`dist/index.js`) | `codex-acp` (`dist/index.js`, also bun-compiled standalone binaries per-platform) |
| Key deps | `@agentclientprotocol/sdk` 1.2.1, `@anthropic-ai/claude-agent-sdk` 0.3.205, Node ≥22 | `@agentclientprotocol/sdk` ^1.2.1, `@openai/codex` ^0.144.0 (bundled harness!), `vscode-jsonrpc` ^9 |
| Lineage | transferred from `zed-industries/claude-code-acp` (created 2025-08-27; wire agent name is still `"claude-code-acp"` — `$SCRATCH/claude-agent-acp/src/acp-agent.ts:5500`) | **rewrite** of Rust `zed-industries/codex-acp`; new TS repo created 2025-12-03 |

**Rewrite rationale & status (verified):** the old Rust adapter's README now carries: *"Development is moving to agentclientprotocol/codex-acp. The new adapter is built on the new Codex App Server, and we are pooling implementation and maintenance work across teams there."* (https://github.com/zed-industries/codex-acp README; repo still `language: Rust`, last push 2026-06-22, `homepage` pointing at the successor). The TS repo's `AGENTS.md` codifies the protocol posture: *"prefer `thread/*`, `turn/*`, and `item/*` event surfaces; avoid the deprecated `codex/event/*` API (planned removal)"* and types are **generated from the harness itself**: `npm run generate-types` → `./node_modules/.bin/codex app-server generate-ts --out src/app-server` (`$SCRATCH/codex-acp/package.json`, `$SCRATCH/codex-acp/AGENTS.md`). Version skew is managed by a scheduled `codex-update.yml` GitHub workflow that bumps `@openai/codex` and regenerates types (`$SCRATCH/codex-acp/.github/workflows/codex-update.yml`) — the harness is a *pinned, bundled dependency*, not an ambient binary.

---

## 2. claude-agent-acp

### 2.1 Process & lifecycle model

- Entry (`$SCRATCH/claude-agent-acp/src/index.ts`): stdout is reserved for ACP NDJSON; **all console methods are rebound to stderr** (`console.log = console.error;` etc.). A `--cli` flag turns the adapter binary into a passthrough spawner of the native `claude` CLI (used for terminal-auth flows, below). Managed-policy env vars are applied pre-SDK via `resolveSettings({ settingSources: [] })`. The process exits when `connection.closed` resolves (stdin EOF) — explicitly to avoid "orphan process accumulation in oneshot mode."
- Per ACP session: one Claude Agent SDK `query({ prompt: input, options })` where `input` is a `Pushable<SDKUserMessage>` (streaming-input mode; multiple turns per subprocess). Executable resolution: `pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_EXECUTABLE ?? (await claudeCliPath())`, where `claudeCliPath()` resolves the platform binary out of `@anthropic-ai/claude-agent-sdk-<platform>-<arch>[-musl]/claude` npm packages (`acp-agent.ts:435-470`).
- Session-spawn options worth copying verbatim (`acp-agent.ts:3661-3781`): `systemPrompt: { type: "preset", preset: "claude_code" }` (client may append via `_meta.systemPrompt` but type/preset are **locked**), `settingSources: ["user","project","local"]`, `includePartialMessages: true`, `env: { ..., CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: "1" }` (opt-in to idle/state events), `extraArgs: { "replay-user-messages": "" }` (echo confirmation — the turn-attribution backbone), `canUseTool: this.canUseTool(sessionId)`, `allowDangerouslySkipPermissions: ALLOW_BYPASS` where `ALLOW_BYPASS = !IS_ROOT || !!process.env.IS_SANDBOX` (`acp-agent.ts:493-494`), plus injected `hooks.PostToolUse` (plan-mode detection → `current_mode_update`) and `hooks.TaskCreated/TaskCompleted` (→ ACP `plan` updates).
- **No restart-on-wedge.** When the SDK stream ends or dies, `closeQueryStream()` marks `queryClosed`, disposes watchers, ends input, closes the query; the Session object stays in the map as a "lightweight husk" so `prompt()` can answer with `"The Claude Agent session has ended. Please start a new session."` instead of hanging (`acp-agent.ts:2540-2568`). Recovery is the client's job (new session), enabled by on-disk session persistence.

### 2.2 The wedge-recovery grace period (quote-level)

`const DEFAULT_FORCE_CANCEL_GRACE_MS = 30_000;` with this design doc attached (`acp-agent.ts:168-177`):

> *"Floor after `session/cancel` before the adapter forces the active prompt loop to return 'cancelled'. `query.interrupt()` normally makes the SDK yield a trailing idle within milliseconds … so this timer is armed and cleared, never fired, on healthy cancels. It only trips when the SDK is genuinely wedged (e.g. a `TaskOutput { block: true }` poll against a hung background task — issue #680) … The value is deliberately loose: it's an 'obviously stuck' ceiling, not a guess at interrupt latency, so it can't pre-empt a slow-but-healthy interrupt."*

Mechanics: the per-session consumer races `query.next()` against a dedicated `cancelController` AbortSignal (NOT the SDK's abort — it "only wakes the consumer; it does NOT touch the SDK query/subprocess", `acp-agent.ts:271-277`). `cancel()` arms the timer **at most once per turn** ("a client that re-sends cancel … can't keep pushing the deadline out", `acp-agent.ts:2497-2513`). Critically, the in-flight `next()` promise is **kept across abort wake-ups** so a late-recovering SDK's message is never dropped: *"racing a SECOND next() while one is pending would make the abandoned one swallow a message"* (`acp-agent.ts:1308-1315`). A force-cancelled turn is pre-counted as an orphan so its late `result` (if the SDK un-wedges) is skipped rather than attributed to the next prompt (`acp-agent.ts:1333-1346`).

### 2.3 ACP method → SDK call mapping

| ACP method | SDK/CLI call (verified) |
|---|---|
| `initialize` | capability/authMethod assembly only (below) |
| `session/new` | `query({...})` + `q.initializationResult()`; sessionId = fresh uuid stamped via `options.sessionId` |
| `session/load` | `query({resume: sessionId})` + `getSessionMessages(sessionId)` replayed through `toAcpNotifications` |
| `session/resume` | `query({resume: sessionId})` (no replay) |
| `session/fork` | `unstable_forkSession` → `createSession({resume: parentId, forkSession: true})`, **new uuid** |
| `session/list` | SDK `listSessions({dir: cwd})` → `{sessionId, cwd, title: sanitizeTitle(summary), updatedAt}` |
| `session/delete` | teardown + SDK `deleteSession(sessionId)` |
| `session/close` | `teardownSession` (interrupt → wake consumer → close query → `abortController.abort()`) |
| `session/prompt` | `promptToClaude(params)` → push `SDKUserMessage` (uuid-stamped) onto streaming input; deferred settled by the consumer |
| `session/cancel` | `query.interrupt()` (+ `still_queued` receipt reconciliation on CLIs advertising `interrupt_receipt_v1`, `acp-agent.ts:2515-2537`) |
| `session/set_mode` | `query.setPermissionMode(modeId)`; modes: `default, acceptEdits, auto, plan, bypassPermissions, dontAsk` |
| `session/set_config_option` | ids `mode`, `model` (→ `query.setModel`), `effort`, `agent`, `fast`; model aliases resolved via `resolveModelPreference` ("opus" → full id) |
| `logout` | subprocess `claude auth logout` — the adapter cannot clear the CLI's keychain itself (`acp-agent.ts:1034-1056`) |

The ACP `$/cancel_request` on an in-flight `prompt` is translated to `session/cancel` semantics by `runPromptWithCancellation` (signal abort → `agent.cancel()`, `acp-agent.ts:~5460`).

### 2.4 SDK event → ACP `session/update` mapping (the consumer switch, `acp-agent.ts:1408-2250`)

| SDK message | ACP update |
|---|---|
| `stream_event` deltas | `agent_message_chunk` / `agent_thought_chunk` / tool-call notifications via `streamEventToAcpNotifications`; streamed-block diffing dedupes against the consolidated `assistant` message (handles non-streaming gateways and mid-block cuts) |
| `assistant`/`user` consolidated | chunks + `tool_call`/`tool_call_update` (via `toAcpNotifications`); user echoes drive turn activation and are then dropped |
| `result` | `usage_update { used, size, cost: { amount: total_cost_usd, currency: "USD" } }` + turn settle with `stopReason` ∈ `end_turn, max_tokens, max_turn_requests, refusal, cancelled` |
| `system/status` compacting / `compact_result` | `agent_message_chunk` "Compacting..." / "Compacting completed." |
| `system/compact_boundary` | `usage_update` refreshed from the `getContextUsage` control request (post-compaction truth) |
| `system/session_state_changed: idle` | turn-settlement bookkeeping + session-title poll → `session_info_update { title, updatedAt }` (the SDK has **no push event for its auto-generated title**; adapter polls session file at idle, `acp-agent.ts:992-1024`) |
| `system/commands_changed` | `available_commands_update` (client must REPLACE its cache) |
| `system/permission_denied` | `tool_call_update { status: "failed" }` with decision reason in `_meta.claudeCode` |
| `system/memory_recall` | synthetic completed `tool_call { kind: "read", title: "Recalled N memories" }` |
| `system/informational` | `agent_message_chunk` with level folded into markdown (**ACP has no severity field**) |
| `system/model_refusal_fallback` | banner chunk + model config-state resync |
| Tool-name → ACP `kind` (`tools.ts:134-483`) | `Task→think, Bash→execute, Read→read, Write/Edit→edit, Glob/Grep→search, WebFetch/WebSearch→fetch, TodoWrite→think(plan), ExitPlanMode→switch_mode, AskUserQuestion/other→other`; Bash renders `content: [{type:"terminal", terminalId: toolUse.id}]` when the client advertises `_meta["terminal_output"]` |

Raw escape hatch: `_meta.claudeCode.emitRawSDKMessages: boolean | {type,subtype,origin}[]` on `session/new` → every SDK message re-emitted as ext-notification `"_claude/sdkMessage"` (`acp-agent.ts:1398-1406`). This is the bridge's own admission that the mapping is lossy.

**Dropped on the floor (explicit no-op cases):** `hook_started, hook_progress, hook_response, files_persisted, task_started, task_notification, task_progress, task_updated, plugin_install, notification, api_retry, thinking_tokens, control_request_progress, background_tasks_changed, worker_shutting_down` (`acp-agent.ts:1687-1791`); `mirror_error` (history-persistence failure = potential data loss) is only logged. Additionally: no steer, no `rewindFiles`/`resumeSessionAt` (the `messageIdToUuid` table is built and documented **"NOT READ YET"**, `acp-agent.ts:312-329`), TodoWrite and `Task*` tools are suppressed from tool_call emission (`shouldEmitToolCall`, `acp-agent.ts:5016`), and scheduling tools fall through a generic arm (issues #655, #838). These are precisely the capabilities a baton-native claude adapter must keep.

### 2.5 Permission mapping (`canUseTool`, `acp-agent.ts:2899-3072`)

Standard tools → `session/request_permission` with exactly three options:

```json
{ "options": [
    { "kind": "allow_always", "optionId": "allow_always", "name": "<describeAlwaysAllow(suggestions)>" },
    { "kind": "allow_once",   "optionId": "allow",        "name": "Allow" },
    { "kind": "reject_once",  "optionId": "reject",       "name": "Reject" } ] }
```

- `allow_always` → `{behavior:"allow", updatedInput, updatedPermissions: suggestions ?? [{type:"addRules", rules:[{toolName}], behavior:"allow", destination:"session"}]}` — i.e. the SDK's structured permission-*suggestions* (rule updates) survive; without suggestions granularity collapses to whole-tool session rules.
- `ExitPlanMode` is special-cased into a 4–5-option mode-picker (`auto` / `acceptEdits` / `default` / `plan`, plus `bypassPermissions` if `ALLOW_BYPASS`), filtered against `availableModes`, and answered with `updatedPermissions: [{type:"setMode", mode, destination:"session"}]`.
- `AskUserQuestion` is rerouted to ACP **form elicitation** (`unstable_createElicitation`) and answers returned as the tool's `updatedInput`; if the client lacks form elicitation the tool is put in `disallowedTools` at spawn (`acp-agent.ts:3644`).
- `bypassPermissions` mode auto-allows without asking. Cancellation propagates via the tool call's `signal` → client request cancelled → `throw new Error("Tool use aborted")`.
- **Granularity lost vs native**: PreToolUse hooks' ask/deny/defer + `updatedInput`/`updatedToolOutput` rewriting are not offered to the ACP client (the client can only pick an option); hook events never cross the wire.

**Issue #94 (deny-rules gap) — full arc, worth internalizing:** the adapter originally replaced Read/Write with ACP-fs-backed tools reading Zed's buffers, so `.claude/settings.json` `{"permissions":{"deny":["Read(./.env)"]}}` was not enforced and `.env` files were sent upstream (https://github.com/agentclientprotocol/claude-agent-acp/issues/94). Fix #1: PR #197 enforced settings adapter-side (fragile: interacted with an upstream `permissionDecision:"deny"` hook bug, anthropics/claude-code#4669). Fix #2: PR #316 switched to the SDK's built-in tool preset (`tools: {type:"preset", preset:"claude_code"}` in current source, `acp-agent.ts:3650-3652`) because *"the goal is mostly to restore the capabilities of subagents that don't work at all without access to the default tools … given claude code also isn't open-source, mimicking tools is also quite challenging"* (maintainer benbrandt in #94). Residue: `SettingsManager` (`src/settings.ts`) still watches `~/.claude/settings.json`, `<cwd>/.claude/settings.json`, `<cwd>/.claude/settings.local.json`, and platform managed-settings paths (e.g. `/Library/Application Support/ClaudeCode/managed-settings.json`) through the SDK's `resolveSettings` + `filterEscalatingDefaultMode` (both marked `@alpha`).

### 2.6 Session persistence mapping

ACP `sessionId` **is** the SDK session id. `loadSession`/`resumeSession` compute a `sessionFingerprint = JSON.stringify({cwd, mcpServers(sorted)})`; a changed fingerprint tears down and recreates the Query with `resume` (`acp-agent.ts:332-342, 3471-3512`). Resume failure modes are translated: `"No conversation found with session ID"` → `RequestError.resourceNotFound(sessionId)` (`acp-agent.ts:3812-3822`). History replay reads the SDK's JSONL transcript via `getSessionMessages` and re-runs the same `toAcpNotifications` mapper with `registerHooks: false`.

### 2.7 Cancellation/race inventory (each traceable to a shipped incident)

- **#680**: `session/cancel` doesn't abort in-flight blocking `TaskOutput`; prompt never resolves → the force-cancel grace mechanism (§2.2).
- **#773**: composer locked ~2min after answer → settle turn at terminal `result`, not at the (laggy) trailing `idle`; the idle becomes a *debt* (`owedTrailingIdles`) absorbed later.
- **#825**: idle w/o result (model stream dropped mid-turn) → an *unowed* idle while the active turn is unsettled fails the turn immediately with structured `errorKindData("no_result")`.
- **#844**: cancelled turns must still report token usage (their dropped result already fed the accumulator).
- **Orphan results**: a cancelled *queued* turn's message was already pushed; the SDK still runs it FIFO and emits an unmatchable result — counted in `pendingOrphanResults` and skipped; reconciled against the interrupt receipt's `still_queued` uuid list; self-healed on next activation (`acp-agent.ts:226-237, 2464-2537`).
- **#497**: CLIs without `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS` never emit idle — over-counting idles is deliberately benign ("detection degrades to the status quo rather than misfiring", `acp-agent.ts:1173-1179`).

### 2.8 Auth

`initialize` advertises, conditionally (`acp-agent.ts:768-917`): terminal-type methods `claude-ai-login` (`--cli auth login --claudeai`), `console-login` (`--cli auth login --console`), or in remote environments (`NO_BROWSER`/`SSH_CONNECTION`/`SSH_CLIENT`/`SSH_TTY`/`CLAUDE_CODE_REMOTE`) a single `claude-login` (`--cli`, i.e. the interactive TUI `/login`); plus `gateway` and `gateway-bedrock` methods **only when** the client advertises `clientCapabilities.auth._meta.gateway === true` — gateway credentials live in adapter memory only and translate to env vars for the subprocess (`createEnvForGateway`). Mid-turn auth failure detection is a string match: `message.result.includes("Please run /login")` → `RequestError.authRequired()` (`acp-agent.ts:1913`). `shouldHideClaudeAuth()` + `initializationResult.account.subscriptionType` gate: some embedders must reject claude.ai subscriptions ("This integration does not support using claude.ai subscriptions.") — see issues #782/#658 for the subscription-policy churn this encodes.

---

## 3. codex-acp

### 3.1 Process & lifecycle model

- One `codex app-server` child per adapter process, spawned from the **bundled** `@openai/codex/bin/codex.js` unless `CODEX_PATH` overrides (`$SCRATCH/codex-acp/src/CodexJsonRpcConnection.ts`). Transport is `vscode-jsonrpc` `MessageConnection` over **custom NDJSON framing** — not LSP Content-Length. Gotcha worth quoting: the app-server omits/rejects the `jsonrpc` field, so the writer deletes `msg.jsonrpc` outbound and the reader re-injects `jsonrpc: "2.0"` inbound (`$SCRATCH/codex-acp/src/StdUtils.ts`, both marked `//TODO ask to include proper jsonrpc field and remove`).
- Shutdown: ACP stdin close → end app-server stdin → 2s grace → `process.kill()` (`src/index.ts:77-87`). Health: every RPC is wrapped in `runWithProcessCheck`; on failure the adapter throws `RequestError(1001, "Codex process has exited with code ${exitCode}:\n${stderrTail}")`, with a 2KiB rolling stderr tail, and a special case `exitCode == 3221225781` → "VC++ redistributable should be installed" (`CodexAcpServer.ts:1655-1666`). **No respawn** — process death is terminal for the adapter.
- Diagnostics: `APP_SERVER_LOGS=<dir>` logs every `[IN]`/`[OUT]`/`[ERR]` app-server frame (`CodexJsonRpcConnection.ts attachLogs`).
- Env knobs (README, verified against `src/index.ts`): `CODEX_PATH`, `CODEX_CONFIG` (JSON merged into session config), `MODEL_PROVIDER`, `DEFAULT_AUTH_REQUEST` (ACP auth request JSON auto-applied when Codex demands auth — the headless-operation key), `INITIAL_AGENT_MODE` (`read-only|agent|agent-full-access`), `NO_BROWSER`, `CODEX_API_KEY`/`OPENAI_API_KEY`.

### 3.2 ACP method → app-server call mapping (`CodexAcpClient.ts`, `CodexAppServerClient.ts`)

| ACP | app-server JSON-RPC |
|---|---|
| `session/new` | `thread/start { config, modelProvider, cwd }` → `sessionId := thread.id`; then `model/list` |
| `session/resume` | `thread/resume { config, cwd, modelProvider, threadId }` |
| `session/load` | `thread/resume` + `thread/read { threadId, includeTurns: true }` → history replay |
| `session/list` | `thread/list` |
| `session/close` | `thread/unsubscribe { threadId }` + local handler clear |
| `session/delete` | `thread/archive { threadId }` — **archive, not delete** |
| `session/prompt` | `turn/start { threadId, input, approvalPolicy, sandboxPolicy, summary, effort, model, serviceTier }` then await `turn/completed` notification (`runTurn`, `CodexAppServerClient.ts:240-264`) |
| `session/cancel` | `turn/interrupt { threadId, turnId }` |
| `/review`, `/review-branch`, `/review-commit` | `review/start { threadId, target, delivery: "inline" }` |
| `/compact` | `thread/compact/start` |
| `/goal …` | `thread/goal/set` / `thread/goal/clear` (with a 1s `GOAL_RUNTIME_EFFECTS_GRACE_MS` window to attribute the goal-triggered turn) |
| auth | `account/read`, `account/login/start`, `account/logout` |
| ext `authentication/status` / `authentication/logout` / legacy `session/set_model` | registered as raw ACP extension methods (`src/index.ts`, `AcpExtensions.ts`) |

Slash commands surfaced as ACP `availableCommands`: `mcp, skills, status, review, review-branch, review-commit, compact, goal, logout` plus discovered skills (`CodexCommands.ts:98-138`; README omits `/goal` — local source outranks it).

Sandbox/approval preset mapping (`AgentMode.ts` — the whole file is a mapping table):

```
read-only         → approvalPolicy "on-request", sandboxPolicy {type:"readOnly", networkAccess:false}
agent (default)   → approvalPolicy "on-request", sandboxPolicy {type:"workspaceWrite", writableRoots:[], networkAccess:false, ...}
agent-full-access → approvalPolicy "never",      sandboxPolicy {type:"dangerFullAccess"}
```

ACP `additionalDirectories` are merged into `sandboxPolicy.writableRoots` (`addAdditionalDirectoriesToSandboxPolicy`, `CodexAcpClient.ts:910`). Codex's finer approval policies (`untrusted`, `on-failure`) are **not reachable** through the three ACP modes — a real loss (tracked as compat friction in issue #264, Goose's `auto/smart-approve/approve/chat` mode ids).

### 3.3 app-server event → ACP `session/update` mapping (`CodexEventHandler.ts:105-222`)

Handled: `item/agentMessage/delta`→`agent_message_chunk` (with message *phases* in `_meta`, PR #267); `item/started`/`item/completed`→`tool_call`/`tool_call_update` via `CodexToolCallMapper` (item types: `fileChange→edit`, `commandExecution→execute` (+ terminal-output `_meta` when client advertises it), `mcpToolCall`, `dynamicToolCall`, `webSearch`, `imageView`, `imageGeneration`, `collabAgentToolCall`, `plan`→`plan`); `turn/plan/updated`→`plan`; `error`→ stored `RequestError` thrown after turn completion; `thread/tokenUsage/updated`→`usage_update`; `thread/name/updated`→`session_info_update{title}`; `thread/status/changed`|`archived`|`unarchived`|`closed`→`session_info_update` with `_meta.codex.{threadStatus,archived,closed}`; `item/commandExecution/outputDelta`; `item/mcpToolCall/progress`; `account/rateLimits/updated`→ stored, surfaced in `PromptResponse._meta.quota`; `configWarning`/`warning`; `item/autoApprovalReview/*` (guardian review); `thread/compacted`; `item/reasoning/{textDelta,summaryTextDelta,summaryPartAdded}`→`agent_thought_chunk`(+section breaks); `model/rerouted`; `fuzzyFileSearch/*`; `thread/goal/{updated,cleared}`→ structured goal state (PR #263 — was previously "flattened to agent message text", issue #260); `item/commandExecution/terminalInteraction`.

**Explicitly ignored (`return null`) — the definitive dropped-capability list** (`CodexEventHandler.ts:183-221`): `thread/deleted, command/exec/outputDelta, hook/started, hook/completed, turn/diff/updated, turn/moderationMetadata, item/fileChange/outputDelta, item/fileChange/patchUpdated, account/updated, fs/changed, mcpServer/startupStatus/updated, serverRequest/resolved, model/verification, model/safetyBuffering/updated, windows/worldWritableWarning, thread/realtime/* (8 events), windowsSandbox/setupCompleted, account/login/completed, skills/changed, deprecationNotice, mcpServer/oauthLogin/completed, externalAgentConfig/import/{completed,progress}, rawResponseItem/completed, thread/started, item/plan/delta, remoteControl/status/changed, app/list/updated, thread/settings/updated, process/outputDelta, process/exited`, plus `guardianWarning`. Notably absent from ACP entirely: `turn/steer`, `thread/inject_items`, `thread/fork`, `thread/rollback`, `command/exec` PTY control, rate-limit *reads*, feature flags. A baton codex adapter speaking app-server natively keeps all of this; an ACP-tier adapter loses it.

Usage mapping (`TokenCount.ts`): Codex's `TokenUsageBreakdown` → ACP `Usage` with the subtlety documented in code: *"Codex includes cached input tokens in the input token count, so they are subtracted here"*; reasoning tokens land in ACP `thoughtTokens`; per-model breakdown rides `PromptResponse._meta.quota` (`QuotaMeta.ts`).

### 3.4 Permission mapping (`CodexApprovalHandler.ts` — the whole file is the table)

Three typed server→client app-server requests (registered as `vscode-jsonrpc` `RequestType`s, `CodexAppServerClient.ts:89-111`): `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval`, plus `mcpServer/elicitation/request`. Each becomes an ACP `session/request_permission` whose options carry the *native decision* in `_meta.codex` so nothing is lost round-tripping. Verified fixture (`$SCRATCH/codex-acp/src/__tests__/CodexACPAgent/data/approval-command-allow-once.json`):

```json
{ "sessionId": "test-session-id",
  "toolCall": { "toolCallId": "item-snapshot", "kind": "execute", "status": "pending", "rawInput": null },
  "options": [
    { "optionId": "allow_once",   "name": "Allow Once",        "kind": "allow_once",   "_meta": { "codex": { "decision": "accept" } } },
    { "optionId": "allow_always", "name": "Allow for Session", "kind": "allow_always", "_meta": { "codex": { "decision": "acceptForSession" } } },
    { "optionId": "reject_once",  "name": "Reject",            "kind": "reject_once",  "_meta": { "codex": { "decision": "decline" } } } ],
  "_meta": { "codex": { "params": { "threadId": "…", "turnId": "turn-1", "itemId": "item-snapshot", "reason": "Running npm install", "proposedExecpolicyAmendment": null } } } }
```

Dynamic option growth: `proposedExecpolicyAmendment` adds `accept_execpolicy_amendment` ("Allow Commands Starting With \`npm run\`"); `proposedNetworkPolicyAmendments[i]` adds `apply_network_policy_amendment:<i>` ("Allow/Block <host> in the Future"); file changes add `grantRoot` variants; `item/permissions/requestApproval` maps to `allow_permissions_session` / `allow_permissions_turn` / `reject_permissions` returning `{permissions, scope: "session"|"turn", strictAutoReview}`. Any error/cancel/unknown option answers the harness's **safe default** (`{decision:"cancel"}` or `{permissions:{}, scope:"turn", strictAutoReview:true}`). Approvals are **ordered behind the event queue** — `waitForSessionNotifications(sessionId)` runs before every approval handler so the client has seen the tool_call before being asked about it (`CodexAcpClient.ts:509-538`; claude-agent-acp solves the same ordering with `ensureToolCallEmitted` + an `emittedToolCalls` dedupe set).

### 3.5 Cancellation & the stale-turn machine

- `cancel` → `interruptSessionTurn` → `turn/interrupt {threadId, turnId}`; the comment states the contract: *"After turnInterrupt(), Codex will send turn/completed, which naturally completes awaitTurnCompleted()"* (`CodexAcpServer.ts:1676-1677`). `turn/completed` with `turn.status === "interrupted"` → `stopReason: "cancelled"` + a courtesy `agent_message_chunk` `"*Conversation interrupted*"`.
- **Cancel-before-turn-start race**: `prompt()` registers a `PendingTurnStart` promise *before* `turn/start` resolves; a cancel arriving in that window awaits the promise to learn the turnId (or `null`) instead of failing (`CodexAcpServer.ts:1399-1423`). If a turn starts *after* the prompt was already superseded/closed (`promptShouldStop`), it is immediately interrupted (`interruptLateStartedTurn`).
- **Stale turns**: on close-driven interrupts, `markTurnStale(threadId, turnId)` suppresses all further notifications for that turn and auto-answers its approvals/elicitations with cancel decisions; the stale mark is cleared when its `turn/completed` finally arrives (`CodexAppServerClient.ts:723-755`). Plus per-session `closingSessions` fences and `sessionGenerations`/`sessionOpenGenerations` counters to kill open/close interleavings (`CodexAcpServer.ts:152-347`).
- `runTurn` also captures **early completions** — a `turn/completed` that lands before the `turn/start` response returns (`CodexAppServerClient.ts:244-252`). That such a race exists on a JSON-RPC daemon is itself a lesson.

### 3.6 Session persistence & history

`sessionId == threadId`. `session/load` = `thread/resume` + `thread/read {includeTurns:true}` streamed as history updates. For threads whose items predate the current schema, `ResponseItemHistoryFallback.ts` **reads the thread's on-disk rollout file directly** (`thread.path`, JSONL) and merges parsed legacy response-items with `thread/read` output via keyed dedupe (`mergeHistoryUpdates`, `CodexAcpServer.ts:1681-1734`) — a concrete admission that harness-native persistence formats leak into adapters and need a fallback parser.

### 3.7 Auth

`initialize` advertises (`CodexAuthMethod.ts`): `api-key` (env `CODEX_API_KEY` then `OPENAI_API_KEY`, or client-supplied via `_meta["api-key"].apiKey`), `chat-gpt` (browser OAuth via `account/login/start`; hidden when `NO_BROWSER` is set), `gateway` (only when `clientCapabilities.auth._meta.gateway === true`; `_meta.gateway: {baseUrl, headers, providerName?}`, protocol `"openai"`). `DEFAULT_AUTH_REQUEST` enables unattended re-auth: when Codex reports auth required, the adapter self-authenticates instead of throwing `RequestError.authRequired()` (`CodexAcpServer.ts:250-265`). `codex-acp login` and `codex-acp cli …` subcommands wrap the underlying binary.

---

## Limitations

**Protocol-level (both bridges):**
- ACP has no steer, no context-injection, no goal API, no PTY control, no usage/rate-limit *query* — confirmed by both bridges' dropped lists (§2.4, §3.3). Elicitation is **unstable**: `unstable_createElicitation` / `unstable_completeElicitation` (claude side), capability-gated on `clientCapabilities.elicitation.{form,url}`; boolean config options and terminal-output rendering are `_meta`-gated experiments (`clientCapabilities._meta["terminal_output"]`, `_meta["terminal-auth"]`).
- Both are single-client stdio processes; no multi-attach, no daemon mode. Session state (turn queues, stale-turn sets, approval handlers) is in-memory and dies with the process.

**claude-agent-acp:**
- No wedge *recovery*: after the 30s force-cancel, "the underlying query may still be wedged — a new session may be required" (`acp-agent.ts:2509`). The subprocess may still be burning tokens until teardown.
- Turn-attribution depends on version-gated CLI features: `--replay-user-messages`, `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS`, `interrupt_receipt_v1` — older CLIs silently degrade (#497; receipt guard at `acp-agent.ts:2527-2530`).
- Deny-rule enforcement went through a broken era (issue #94 / PRs #197, #316); current posture trades ACP-client fs control for SDK built-in tools, and the maintainer concedes it isn't "a perfect solution."
- Open pain points: #851 background `Agent` subagent deadlocks session via permission-request ID desync; #838/#655 scheduled wakeups/crons never fire under ACP (nobody is home while idle — baton's event-loop problem, verbatim); #642/#643 builtin slash-commands emit no/unstructured output; #781 command-list leakage into chunks; `bypassPermissions` unavailable as root without `IS_SANDBOX`; `resolveSettings`/`filterEscalatingDefaultMode` are `@alpha` SDK APIs.
- Release cadence is aggressive (0.58.1 on 2026-07-09, SDK bumped twice that week — `CHANGELOG.md`): pin versions.

**codex-acp:**
- `session/delete` archives rather than deletes (`thread/archive`, `CodexAcpClient.ts:318-320`).
- Drops file-change patch streams (`item/fileChange/patchUpdated`), `turn/diff/updated`, unified exec output, and everything in §3.3's ignore list; issue #266 (open): agent message text lost when deltas are missing from `item/completed`.
- Only three sandbox/approval presets; Codex `untrusted`/`on-failure` policies unreachable; #264 (open) mode-id compatibility; #248 (open) no device-code auth for headless ChatGPT login; #252 (open) no session rename.
- NDJSON framing with the `jsonrpc`-field hack (§3.1) is an undocumented app-server quirk that may change under them.
- Tight version coupling to `@openai/codex` (generated types, weekly bump workflow): running against a mismatched `CODEX_PATH` binary is unvalidated territory.

---

## Open unknowns

- Whether claude-agent-acp will re-expose ACP-client-controlled fs (the #94/#316 tension is explicitly unresolved: "if there is a chance we can move back, great").
- The fate of the unused `messageIdToUuid` rewind/fork plumbing — fork ships (`session/fork` → `unstable_forkSession`) but per-message rewind does not.
- codex-acp's handling of app-server restarts mid-session (none found; presumed fatal) and whether the ACP org plans a supervising layer.
- How gateway auth (`_meta.gateway`) interacts with Codex `serviceTier`/fast-mode on non-OpenAI providers (issue #272 "configurable LLM providers" is open on both repos — #853 on claude-agent-acp).
- Whether the app-server will accept standard `jsonrpc: "2.0"` framing, removing the StdUtils shim (both TODOs say "ask").

---

## Design lessons for baton

1. **Settle promises before you touch processes.** Both bridges religiously resolve the client-facing turn (cancelled/failed) *first* and clean up resources second (`acp-agent.ts:1365-1394`). Baton's `fleet_*` verbs should never leave an RPC hanging because a subprocess is wedged.
2. **Ship a force-cancel floor, sized as an "obviously stuck" ceiling, armed once per turn, cleared on healthy paths.** Copy claude-agent-acp's 30s design and its rationale comment nearly verbatim; also copy the *pre-counted orphan* trick so a late-recovering harness's output isn't misattributed to the next task.
3. **Turn identity must be pinned by the harness echoing your uuid, not by ordering.** claude-agent-acp stamps a uuid on each pushed user message and uses `--replay-user-messages` to promote turns; everything without an echo (local commands, compaction) needs an explicit fallback path plus an orphan ledger. Baton's claude adapter should adopt the identical scheme; the codex adapter gets turnIds for free but must handle *cancel-before-turnId-exists* with a pending-turn-start promise (§3.5).
4. **Never race a second `next()` on an async-generator stream.** Keep the pending read across abort wake-ups (`acp-agent.ts:1308-1315`) or you will silently swallow harness messages.
5. **Idle/turn-over signals lie: keep a debt counter.** The owed-trailing-idles pattern (results owe idles; unowed idle + unsettled turn = dead turn) is the only found-in-production way to distinguish "SDK is slow" from "SDK abandoned the turn" (#773 vs #825). Design baton's event-ledger turn-state machine with the same explicit debt bookkeeping.
6. **Treat "capability loss" as a first-class artifact.** Both bridges have an enumerable ignore list (§2.4, §3.3). Baton's harness cards should be generated *from* the adapter's event switch (every `case` is handled/dropped/emulated), so the loss list can't drift from the code — codex-acp's AGENTS.md even bans `default:` fallbacks in event switches to force explicit no-op cases.
7. **Namespace a lossless `_meta` side-channel from day one.** `_meta.claudeCode.*` / `_meta.codex.*` carry raw tool names, native decisions, origins, and full approval params both directions; `_claude/sdkMessage` re-emits raw SDK frames on request. Baton events should carry `raw` payloads under a per-harness key so downstream consumers can recover anything the normalized schema dropped.
8. **Answer approvals with the harness's safe default on any failure path** — stale turn, missing handler, client error, abort — never leave a harness-side approval pending (`{decision:"cancel"}` everywhere in `CodexAppServerClient.ts:177-222`). And **order approvals behind the event stream** (`waitForSessionNotifications` / `ensureToolCallEmitted`) so the supervisor has seen the tool call before ruling on it.
9. **Permission responses should return *policy*, not just verdicts.** The Claude side returns `updatedPermissions` rules (`addRules`/`setMode`, destination `session`); the Codex side returns scoped grants and execpolicy/network amendments. Baton's `fleet_approve` should support "allow + remember as rule" as a structured outcome, or it will be strictly weaker than both bridges.
10. **Fingerprint session-defining parameters and recreate on mismatch** (`computeSessionFingerprint`: cwd + sorted MCP servers). Cheap, explicit, prevents a resumed worker silently running in a stale worktree.
11. **Respect the security lesson of issue #94: never reimplement a harness's tools in the adapter.** Re-hosting Read/Write outside the harness bypassed its permission engine and exfiltrated `.env` files. Baton adapters should let harnesses execute their own tools and intercept at the approval layer, not the tool layer.
12. **Bundle-and-pin the harness; regenerate types from it mechanically.** codex-acp ships `@openai/codex` as a dependency, regenerates its protocol types via `codex app-server generate-ts`, and auto-bumps weekly in CI. For Codex, baton should do the same (schema-diff feature detection instead of version sniffing); for Claude, pin the SDK and gate features on advertised receipts (`interrupt_receipt_v1`) with graceful degradation.
13. **Version-gate every clever behavior with a benign fallback.** The best examples: interrupt-receipt reconciliation guards the *field* not the object ("a bare `{}` success from a gateway can't read as 'everything was dropped'", `acp-agent.ts:2527-2530`), and idle over-counting is deliberately harmless. Assume gateways and old binaries will violate your protocol assumptions in the direction of *missing* data.
14. **Plan for auth as a lifecycle event, not a setup step.** Both bridges detect auth loss mid-session (string-match "Please run /login"; `authRequired()` checks per session-open) and codex-acp's `DEFAULT_AUTH_REQUEST` shows the headless answer baton needs: a pre-provisioned auth payload the adapter can self-apply without a human in the loop.
15. **The bridges prove ACP is a fine *tier-2 southbound*, and prove why it can't be baton's core** (doc 04 Option B): the losses in §2.4/§3.3 — steer, inject, diffs, PTY, goals, rate limits, hooks, background tasks — are exactly the capabilities baton's native codex (app-server) and claude (SDK/stream-json) adapters exist to preserve.

---

## Sources

**Local (clones at `main`, 2026-07-09):**
- `$SCRATCH = /private/tmp/claude-501/-Users-wahargis-Development/73adbbf2-a514-4a17-8729-9cda68da5bac/scratchpad`
- `$SCRATCH/claude-agent-acp/src/acp-agent.ts` (5618 lines; grace period 168–177, Session/Turn types 196–330, initialize 768–917, prompt/consumer 1058–2250, cancel 2451–2538, teardown 2540–2620, canUseTool 2899–3072, createSession 3543–3900, runAcp 5485+), `src/index.ts`, `src/settings.ts`, `src/tools.ts`, `src/elicitation.ts`, `package.json`, `CHANGELOG.md`, `docs/model-configuration.md`
- `$SCRATCH/codex-acp/src/index.ts`, `src/CodexJsonRpcConnection.ts`, `src/StdUtils.ts`, `src/CodexAcpServer.ts` (initialize 191–231, prompt 1425–1605, interrupt machinery 1306–1423, cancel 1669–1678, history merge 1681–1734), `src/CodexAcpClient.ts`, `src/CodexAppServerClient.ts` (approval RequestTypes 89–111, runTurn 240–264, stale turns 723–755), `src/CodexApprovalHandler.ts`, `src/CodexEventHandler.ts` (event switch 105–222), `src/AgentMode.ts`, `src/ApprovalOptionId.ts`, `src/McpApprovalOptionId.ts`, `src/CodexAuthMethod.ts`, `src/AcpExtensions.ts`, `src/TokenCount.ts`, `src/QuotaMeta.ts`, `src/ResponseItemHistoryFallback.ts`, `src/CodexCommands.ts`, `src/CodexCli.ts`, `AGENTS.md`, `package.json`, `README.md`, `__tests__/CodexACPAgent/data/approval-command-allow-once.json`
- Baton context: `/Users/wahargis/Development/Experiments/baton/docs/02-harness-control-surfaces.md`, `04-architecture-options.md`

**Web/GitHub:**
- https://github.com/agentclientprotocol/claude-agent-acp — issues #94 (+comments; PRs #197, #316), #497, #642, #643, #655, #658, #680, #712, #719, #749, #773, #781, #782, #825, #838, #844, #851, #853
- https://github.com/agentclientprotocol/codex-acp — issues/PRs #248, #252, #260, #263, #264, #266, #267, #272, #274, #276
- https://github.com/zed-industries/codex-acp (Rust predecessor; README migration notice: "built on the new Codex App Server … pooling implementation and maintenance work across teams")
- https://github.com/anthropics/claude-code/issues/4669 (upstream PreToolUse deny bug referenced in #94)
- Repo metadata via `gh api repos/...` (default branches, creation dates 2025-08-27 / 2025-12-03, transfer redirect `zed-industries/claude-code-acp` → `agentclientprotocol/claude-agent-acp`)