All evidence gathered. Composing the dossier now.

# Claude Agent SDK — Baton Southbound Adapter Dossier (TypeScript primary, Python deltas)

*Verified 2026-07-09 against locally installed Claude Code CLI **2.1.205** (`/Users/wahargis/.local/share/claude/versions/2.1.205`, Mach-O arm64), locally installed SDK **0.2.44** (`/Users/wahargis/.npm/_npx/7b8cde7936c78aff/node_modules/@anthropic-ai/claude-agent-sdk/`), and npm-latest SDK **0.3.205** (tarball extracted to `/private/tmp/claude-501/-Users-wahargis-Development/73adbbf2-a514-4a17-8729-9cda68da5bac/scratchpad/sdk0325/package/`; `sdk.d.ts` there is 6,879 lines and is the authoritative type source cited below as **[d.ts:N]**). Local binary evidence outranks web docs; disagreements are flagged inline.*

## Summary

- The SDK is a supervisor around a spawned CLI subprocess speaking **NDJSON over stdio** with two planes: content frames (`user`/`assistant`/`system`/`result`/`stream_event`…) and a control plane (`control_request` / `control_response` / `control_cancel_request` / `control_request_progress`) — all four frame types confirmed in the 2.1.205 binary strings.
- **Version lockstep matters**: npm `@anthropic-ai/claude-agent-sdk@0.3.205` ↔ CLI 2.1.205; the 0.2.44 install on this machine bundles CLI 2.1.44 and **lacks** `still_queued`, `applyFlagSettings`, `task_progress`, `auto` permission mode, and ~20 control subtypes that 2.1.205 supports. Feature-detect via `system/init.capabilities` (e.g. `'interrupt_receipt_v1'`), never version-sniff [d.ts:4276].
- `interrupt()` now returns a receipt: `SDKControlInterruptResponse.still_queued: string[]` — uuids of queued async user messages that **will still run** unless individually cancelled via the `cancel_async_message` control subtype [d.ts:3401-3406].
- `canUseTool` is the approval channel (`can_use_tool` control_request; SDK auto-injects `--permission-prompt-tool stdio`); `PermissionResult` allow can rewrite `updatedInput` and grant `updatedPermissions`; deny can set `interrupt: true`. It is **never invoked** under `bypassPermissions` and is mutually exclusive with `permissionPromptToolName` (both verified in sdk.mjs 0.3.205 error strings).
- Sessions persist as JSONL under `~/.claude/projects/<sanitized-cwd>/<session-uuid>.jsonl` with a sibling `<session-uuid>/` directory holding `subagents/`, `tool-results/`, `workflows/` — resumable (`resume`), forkable (`forkSession`), rewindable (`rewindFiles` + `enableFileCheckpointing`), and mirrorable (`sessionStore`, alpha).

---

## 1. Packaging, spawn mechanics, env vars

**npm layout (0.3.205)**: no bundled `cli.js` anymore. Ships `sdk.mjs`, `sdk.d.ts`, `sdk-tools.d.ts` (per-tool input/output schemas), `bridge.mjs`, `browser-sdk.js`, and `extractFromBunfs.js`; the CLI binary comes from platform-split `optionalDependencies` (`@anthropic-ai/claude-agent-sdk-darwin-arm64@0.3.205` etc.). peerDeps: `@anthropic-ai/sdk >=0.93.0`, `@modelcontextprotocol/sdk ^1.29.0`, `zod ^4.0.0`. (Extracted `package.json`.) The old 0.2.44 layout bundled `cli.js` (11 MB) directly.

**Flags the SDK passes to the CLI** (grep of 0.3.205 `sdk.mjs`): `--add-dir --agent --allow-dangerously-skip-permissions --betas --channels --continue --debug --debug-file --debug-to-stderr --effort --fallback-model --fork-session --hard-fail --include-hook-events --include-partial-messages --input-format --json-schema --managed-settings --max-budget-usd --max-thinking-tokens --max-turns --mcp-config --model --no-session-persistence --output-format --permission-mode --permission-prompt-tool --plugin-dir --plugin-dir-no-mcp --porcelain --resume --resume-session-at --session-id --session-mirror --strict-mcp-config --task-budget --thinking --thinking-display --tools --verbose`, plus `--setting-sources=<a,b,c>` (equals-joined) and `--settings`. It sets `CLAUDE_CODE_ENTRYPOINT="sdk-ts"` on the child.

**Env vars with SDK-documented meaning**: `CLAUDE_AGENT_SDK_CLIENT_APP` (User-Agent identifier), `CLAUDE_CODE_STREAM_CLOSE_TIMEOUT` (raise for SDK-MCP calls >60s, [0.2.44 sdk.d.ts:240]), `CLAUDE_CONFIG_DIR` (relocate `~/.claude`; "set it to /tmp for ephemeral local copy" with `sessionStore`), `CLAUDE_CODE_TMPDIR` (extract dir for bunfs), `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false`, `CLAUDE_CODE_SYNC_PLUGIN_INSTALL` (drives `plugin_install` events), `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING`, `CLAUDE_CODE_DEBUG_LOGS_DIR`, `CLAUDE_EFFORT` (exposed *to* hooks/Bash). All greppable in local `sdk.mjs`/`sdk.d.ts`.

**⚠ 0.2.44→0.3.x behavior change**: `Options.env` in 0.3.205 "**REPLACES the subprocess environment entirely — it is not merged with `process.env`**. Spread `process.env` yourself" [d.ts:1396-1401]. The 0.2.44 doc said "Defaults to process.env" with no replace warning. An adapter that sets `env: {ANTHROPIC_BASE_URL: ...}` for the GLM leg will lose `PATH`/`HOME` on 0.3.x unless it spreads.

---

## 2. `query()` Options — full orchestration-relevant inventory (0.3.205)

```ts
export declare function query(_params: {
    prompt: string | AsyncIterable<SDKUserMessage>;
    options?: Options;
}): Query;   // [d.ts:2527]
```

Every field below is quoted from [d.ts:1282-2014]; fields marked **NEW** are absent from the locally installed 0.2.44.

| Field | Type / values | Adapter notes |
|---|---|---|
| `abortController` | `AbortController` | Hard-kill; prefer `Query.close()` or `interrupt()` |
| `additionalDirectories` | `string[]` (absolute) | maps `--add-dir` |
| `agent` | `string` | main-thread agent = `--agent` |
| `agents` | `Record<string, AgentDefinition>` | `AgentDefinition = {description, tools?, disallowedTools?, prompt, model?: 'sonnet'\|'opus'\|'haiku'\|'inherit', mcpServers?, criticalSystemReminder_EXPERIMENTAL?, skills?, maxTurns?}` [0.2.44 d.ts:33-67] |
| `allowedTools` / `disallowedTools` | `string[]` | allow = auto-approve, not availability; `'Skill'` in allowedTools deprecated → use `skills` |
| `tools` | `string[] \| {type:'preset', preset:'claude_code'}` | `[]` disables all built-ins; native builds may omit Grep/Glob unless listed [d.ts:1382-1394] |
| `toolAliases` **NEW** | `Record<string,string>` | redirect model-emitted tool names, e.g. `{ Bash: 'mcp__workspace__bash' }`; single-hop [d.ts:1356-1381] |
| `canUseTool` | `CanUseTool` | §5 |
| `continue` | `boolean` | most-recent session in cwd; exclusive with `resume` |
| `cwd` | `string` | defaults `process.cwd()` |
| `env`, `executable` (`'bun'\|'deno'\|'node'`), `executableArgs`, `extraArgs` | | `extraArgs: Record<string, string\|null>` = raw CLI flag escape hatch (`null` = boolean flag) |
| `fallbackModel` | `string` (comma-list in 0.3.x) | primary re-tried each user turn |
| `enableFileCheckpointing` | `boolean` | required for `rewindFiles()` |
| `forkSession` | `boolean` | with `resume`: new session ID branch |
| `resume` | `string` (session UUID) | |
| `resumeSessionAt` **NEW-ish** | `string` (message UUID) | resume truncated at a specific message |
| `sessionId` | `string` (UUID) | pre-pick the ID; with `continue`/`resume` only if `forkSession` |
| `persistSession` | `boolean` (default true) | maps `--no-session-persistence` (CLI: "only works with --print") |
| `sessionStore` / `sessionStoreFlush` / `loadTimeoutMs` **NEW, @alpha** | `SessionStore` adapter | dual-write transcript mirroring; incompatible with `persistSession:false`; failures surface as `mirror_error` events |
| `hooks` | `Partial<Record<HookEvent, HookCallbackMatcher[]>>` | §6 |
| `includeHookEvents` **NEW** | `boolean` | emit `hook_started/hook_progress/hook_response` for all hook types (= `--include-hook-events`) |
| `includePartialMessages` | `boolean` | emit `stream_event` frames (= `--include-partial-messages`) |
| `forwardSubagentText` **NEW** | `boolean` | forward subagent text/thinking with `parent_tool_use_id` set — nested transcripts |
| `thinking` | `{type:'adaptive', display?} \| {type:'enabled', budgetTokens?, display?} \| {type:'disabled'}` | supersedes deprecated `maxThinkingTokens` |
| `effort` | `'low'\|'medium'\|'high'\|'xhigh'\|'max'` | CLI `--effort` has the same five choices (local `--help`) |
| `maxTurns` | `number` | → `error_max_turns` result |
| `maxBudgetUsd` | `number` | → `error_max_budget_usd` result (CLI: `--max-budget-usd`, "only works with --print") |
| `taskBudget` **NEW @alpha** | `{total: number}` | API-side token budget, beta `task-budgets-2026-03-13` |
| `mcpServers` | `Record<string, McpServerConfig>` | `McpStdioServerConfig {type?:'stdio', command, args?, env?}` \| `McpSSEServerConfig {type:'sse', url, headers?}` \| `McpHttpServerConfig {type:'http', url, headers?}` \| `McpSdkServerConfigWithInstance {type:'sdk', name, instance}` (in-process, via `createSdkMcpServer()`/`tool()`) |
| `model` | `string` | e.g. `'claude-sonnet-5'`, `'claude-opus-4-8'`, `'claude-fable-5'` [d.ts:1671] |
| `outputFormat` | `{type:'json_schema', schema: {...}}` | structured output → `result.structured_output`; retry failure = `error_max_structured_output_retries` |
| `permissionMode` | `'default'\|'acceptEdits'\|'bypassPermissions'\|'plan'\|'dontAsk'\|'auto'` [d.ts:2043] | **Divergences:** CLI 2.1.205 `--permission-mode` choices are `acceptEdits, auto, bypassPermissions, manual, dontAsk, plan` (no `default`; `manual` is the CLI spelling — claude-agent-acp maps `"manual"→"default"`). 0.2.44 documented a `'delegate'` mode which 0.3.205 dropped. `'auto'` = model-classifier approval. |
| `allowDangerouslySkipPermissions` | `boolean` | required gate for `bypassPermissions` |
| `permissionPromptToolName` | `string` | MCP tool as permission prompter; **cannot combine with `canUseTool`** (sdk.mjs throws) |
| `planModeInstructions` **NEW** | `string` | replaces plan-mode workflow body |
| `plugins` | `SdkPluginConfig[]` = `{type:'local', path, skipMcpDiscovery?}` | |
| `promptSuggestions` **NEW** | `boolean` | emits `prompt_suggestion` **after** `result` — keep iterating [d.ts:1736-1749] |
| `agentProgressSummaries` **NEW** | `boolean` | ~30s AI summaries on `task_progress.summary` |
| `sandbox` | `SandboxSettings` (`enabled`, `autoAllowBashIfSandboxed`, `allowUnsandboxedCommands`, `network.{allowedDomains,allowUnixSockets,allowLocalBinding,httpProxyPort,socksProxyPort,…}`, `excludedCommands`, …) | 0.3.x: `enabled:true` defaults `failIfUnavailable:true` — query errors out rather than silently running unsandboxed [d.ts:1790-1794] |
| `settings` **NEW** | `string \| Settings` | inline/flag-settings layer (= `--settings`) |
| `managedSettings` **NEW** | `Settings` | parent-supplied policy tier, restrictive-only filtered [d.ts:1836-1859] |
| `settingSources` | `('user'\|'project'\|'local')[]` | **0.3.205: omitted = load all (CLI parity); `[]` = isolation.** 0.2.44 doc said omitted = load none. Must include `'project'` for CLAUDE.md. [d.ts:1860-1870] |
| `skills` **NEW** | `string[] \| 'all'` | context filter, not sandbox [d.ts:1871-1893] |
| `systemPrompt` | `string \| string[] \| {type:'preset', preset:'claude_code', append?, excludeDynamicSections?}` | `string[]` may include `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` cache marker; `excludeDynamicSections` moves per-machine sections into first user message (= CLI `--exclude-dynamic-system-prompt-sections`) |
| `title` **NEW** | `string` | initial session title |
| `betas` | `('context-1m-2025-08-07')[]` | API-key users only (CLI `--betas` help) |
| `stderr` | `(data:string)=>void` | debug capture |
| `strictMcpConfig` | `boolean` | only `mcpServers` option + explicit agent MCP |
| `spawnClaudeCodeProcess` | `(options: SpawnOptions) => SpawnedProcess` | run CLI in VM/container; `SpawnOptions {command, args, cwd?, env, signal}`; signal aborts only after stdin-EOF + ~2s grace [d.ts:1994-2013] |
| `onElicitation` / `onUserDialog` + `supportedDialogKinds` **NEW** | callbacks | MCP elicitation; `request_user_dialog` blocking dialogs — CLI fails closed unless the kind is declared in `supportedDialogKinds` [d.ts:1503-1538] |
| `pathToClaudeCodeExecutable`, `debug`, `debugFile` | | |

---

## 3. The `Query` object (control methods) [d.ts:2230-2525]

All control methods are "only supported when streaming input/output is used" (i.e. `prompt` is an `AsyncIterable`). Each maps 1:1 to a `control_request` subtype (§7).

- `interrupt(): Promise<SDKControlInterruptResponse | undefined>` — resolves `undefined` on older CLIs; on CLIs advertising `'interrupt_receipt_v1'` in `system/init.capabilities`, resolves `{ still_queued: string[] }`. Semantics quoted from [d.ts:3403]: uuids still in queue are individually cancellable via `cancel_async_message`; once a batch is dequeued/coalesced, cancelling a non-representative uuid is a no-op while cancelling the batch-representative uuid drops the whole batch (cancel response reports `cancelled:false` either way); only uuid-stamped, main-thread messages are listed (`[]` ≠ "nothing will run"); may contain internally-enqueued uuids (cron, auto-continuation) — ignore unknowns; on a clean interrupt the receipt precedes the interrupted turn's result, but a crash-path error result may precede the receipt. The same text exists verbatim in the 2.1.205 binary strings (local confirmation).
- `setPermissionMode(mode: PermissionMode): Promise<void>`
- `setMcpPermissionModeOverride(serverName, mode: 'default'|'auto'|null): Promise<{warning?: string}>` **NEW** — tighten-only per-MCP-server override.
- `setModel(model?: string): Promise<void>`
- `setMaxThinkingTokens(n: number|null, thinkingDisplay?: 'summarized'|'omitted'|null)` (deprecated → `thinking` option)
- `applyFlagSettings(settings: {[K in keyof Settings]?: Settings[K] | null}): Promise<void>` **NEW** — mid-session merge into the flag-settings layer (above user/project/local, below managed policy). Shallow-merges top-level keys; second call with `{permissions:{...}}` **replaces** the whole `permissions` object; `null` clears a key. Wire: `{subtype:'apply_flag_settings', settings: Record<string,unknown>}` [d.ts:2902-2905]; present in 2.1.205 binary, absent in 0.2.44 SDK.
- `initializationResult(): Promise<SDKControlInitializeResponse>` — `{commands: SlashCommand[], agents: AgentInfo[], output_style, available_output_styles, models: ModelInfo[], account: AccountInfo, fast_mode_state?}` [d.ts:3369-3388]. `SlashCommand = {name, description, argumentHint}`; `ModelInfo = {value, displayName, description}`; `AccountInfo = {email?, organization?, subscriptionType?, tokenSource?, apiKeySource?}`.
- `reinitialize(): Promise<SDKControlInitializeResponse>` **NEW** — re-send `initialize` after a transport gap; response carries `pending_permission_requests` / `pending_user_dialog_requests` (in-flight `can_use_tool` / `request_user_dialog` frames) and redelivers them — callbacks must be idempotent per `request_id` [d.ts:2330-2346, 267-293]. **This is the daemon-reattach primitive baton doc 02 said Claude lacked.**
- `supportedCommands()`, `supportedModels()`, `supportedAgents()` **NEW**, `mcpServerStatus()`, `accountInfo()`
- `getContextUsage(): Promise<SDKControlGetContextUsageResponse>` **NEW** — per-category token breakdown, `totalTokens`, `maxTokens`, `autoCompactThreshold`, `messageBreakdown.{toolCallTokens,toolResultTokens,…}`, `apiUsage` [d.ts:2984-3074].
- `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(): Promise<SDKControlGetUsageResponse>` — structured `/usage`: `session.{total_cost_usd, total_api_duration_ms, total_duration_ms, total_lines_added, total_lines_removed, model_usage}`, `subscription_type`, `rate_limits_available`, `rate_limits.{five_hour, seven_day, seven_day_opus, seven_day_sonnet, seven_day_oauth_apps}` each `{utilization: number|null /*0-100*/, resets_at: string|null /*ISO*/}` [d.ts:3107-3183]. The name literally screams experimental.
- `readFile(path, {maxBytes?, encoding?: 'utf-8'|'base64'})` **NEW** — Read-permission-gated file fetch; `null` on denial.
- `rewindFiles(userMessageId, {dryRun?}) → {canRewind, error?, filesChanged?, insertions?, deletions?}`
- `seedReadState(path, mtime)` **NEW** — pre-seed Edit's read-before-write validation.
- `reconnectMcpServer(name)`, `toggleMcpServer(name, enabled)`, `setMcpServers(servers) → {added, removed, errors}` (dynamic servers only)
- `reloadPlugins()`, `reloadSkills()` **NEW**
- `streamInput(stream: AsyncIterable<SDKUserMessage>)`
- `stopTask(taskId)` — emits `task_notification` with `status:'stopped'`
- `backgroundTasks(toolUseId?): Promise<boolean>` **NEW** — Ctrl+B semantics: background one/all in-flight foreground Bash/subagent tasks; blocked tool call returns a "running in the background" tool_result and the turn continues [d.ts:2503-2515].
- `close(): void` — force-terminate subprocess.

Also exported module-level (0.3.205): `listSessions({dir?, limit?, offset?})`, `getSessionInfo(sessionId, {dir?})`, `getSessionMessages`, `renameSession(sessionId, title, {dir?})`, `tagSession`, `deleteSession`, `forkSession`, `importSessionToStore` (@alpha), `resolveSettings()` (@alpha — settings-cascade dry-run with per-key provenance), and the `unstable_v2_createSession` / `unstable_v2_prompt` / `unstable_v2_resumeSession` alpha session API.

---

## 4. SDKMessage vocabulary (0.3.205 union, [d.ts:3870])

`type` discriminants on the stream: `assistant`, `user` (+`isReplay:true` variant), `result`, `system` (many subtypes), `stream_event`, `tool_progress`, `tool_use_summary`, `auth_status`, `rate_limit_event`, `prompt_suggestion`, `conversation_reset`, plus internal-only `keep_alive`, `active_goal` (in `StdoutMessage` but not `SDKMessage` [d.ts:6523]).

**`system` subtypes** (all carry `uuid`, `session_id`):

| subtype | key fields |
|---|---|
| `init` | `agents?`, `apiKeySource ('user'\|'project'\|'org'\|'temporary'\|'oauth')`, `betas?`, `claude_code_version`, `cwd`, `tools: string[]`, `mcp_servers: {name,status}[]`, `model`, `permissionMode`, `slash_commands: string[]`, `output_style`, `skills: string[]`, `plugins: {name,path}[]`, **`capabilities?: string[]`** [d.ts:4246-4284] |
| `status` | `status: 'compacting'\|'requesting'\|null`, `permissionMode?`, `compact_result?: 'success'\|'failed'`, `compact_error?` |
| `compact_boundary` | `compact_metadata: {trigger:'manual'\|'auto', pre_tokens, post_tokens?, duration_ms?, preserved_segment?, preserved_messages?}` |
| `api_retry` | `attempt, max_retries, retry_delay_ms, error_status: number\|null, error: SDKAssistantMessageError` |
| `control_request_progress` | `request_id, status:'started'\|'api_retry', attempt?, …` (progress for long client-originated control_requests) |
| `task_started` | `task_id, tool_use_id?, description, subagent_type?, task_type?, workflow_name?, prompt?, skip_transcript?` |
| `task_progress` | `task_id, tool_use_id?, description, subagent_type?, usage:{total_tokens, tool_uses, duration_ms}, last_tool_name?, summary?` [d.ts:4304-4324] — **this is `SDKTaskProgressMessage`; absent from 0.2.44 which only has `task_notification`** |
| `task_notification` | `task_id, tool_use_id?, status:'completed'\|'failed'\|'stopped', output_file, summary, usage?, skip_transcript?` |
| `task_updated` | `task_id, patch:{status?: 'pending'\|'running'\|'completed'\|'failed'\|'killed'\|'paused', description?, end_time?, total_paused_ms?, error?, is_backgrounded?}` |
| `background_tasks_changed` | `tasks: {task_id, task_type, description}[]` — REPLACE-semantics level signal [d.ts:2836] |
| `hook_started` / `hook_progress` / `hook_response` | `hook_id, hook_name, hook_event, stdout, stderr, output`, response adds `exit_code?, outcome:'success'\|'error'\|'cancelled'` |
| `session_state_changed` | `state: 'idle'\|'running'\|'requires_action'` — "'idle' … authoritative turn-over signal" [d.ts:4205] |
| `permission_denied` | `tool_name, tool_use_id, agent_id?, decision_reason_type?, decision_reason?, message` — the deny short-circuit that never reaches `canUseTool` [d.ts:4007] |
| `model_refusal_fallback` / `model_refusal_no_fallback` | refusal retry/terminal metadata incl. `retracted_message_uuids`, `refused_user_message_uuid` |
| `notification`, `informational` (`level:'info'\|'notice'\|'suggestion'\|'warning'`, `prevent_continuation?`), `local_command_output`, `commands_changed`, `memory_recall`, `elicitation_complete`, `files_persisted`, `plugin_install`, `mirror_error`, `worker_shutting_down` (`reason` e.g. `'host_exit'`), `thinking_tokens` (`estimated_tokens`, `estimated_tokens_delta`) | |

**`assistant`** [d.ts:2786]: `{type:'assistant', message: BetaMessage, parent_tool_use_id, error?: SDKAssistantMessageError, uuid, session_id, request_id?, supersedes?: UUID[], subagent_type?, task_description?}`. `SDKAssistantMessageError = 'authentication_failed'|'oauth_org_not_allowed'|'billing_error'|'rate_limit'|'overloaded'|'invalid_request'|'model_not_found'|'server_error'|'unknown'|'max_output_tokens'` (0.2.44 lacks `oauth_org_not_allowed`, `overloaded`, `model_not_found`).

**`user`** input shape (`SDKUserMessage`, [d.ts:4401]): `{type:'user', message: MessageParam, parent_tool_use_id: string|null, isSynthetic?, tool_use_result?, priority?: 'now'|'next'|'later', origin?, shouldQuery?: boolean /* false = append without triggering a turn */, timestamp?, uuid?, session_id?}`. Replays add `isReplay: true` (enable with CLI `--replay-user-messages` for uuid acks).

**`result`** [d.ts:4107-4156]: success = `{type:'result', subtype:'success', duration_ms, duration_api_ms, ttft_ms?, ttft_stream_ms?, time_to_request_ms?, is_error, api_error_status?, num_turns, result: string, stop_reason: string|null, total_cost_usd, usage: NonNullableUsage, modelUsage: Record<string, ModelUsage>, permission_denials: SDKPermissionDenial[], structured_output?, deferred_tool_use?, terminal_reason?, fast_mode_state?, origin?, uuid, session_id}`. Error subtypes: `'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd' | 'error_max_structured_output_retries'` (+ `errors: string[]`). `ModelUsage = {inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens, webSearchRequests, costUSD, contextWindow, maxOutputTokens}` [d.ts:1233]. `TerminalReason = 'blocking_limit'|'rapid_refill_breaker'|'prompt_too_long'|'image_error'|'model_error'|'aborted_streaming'|'aborted_tools'|'stop_hook_prevented'|'hook_stopped'|'tool_deferred'|'max_turns'|'background_requested'|'completed'` [d.ts:6670].

**`stream_event`** (`SDKPartialAssistantMessage`): `{type:'stream_event', event: BetaRawMessageStreamEvent, parent_tool_use_id, uuid, session_id, ttft_ms?}` — raw Anthropic API deltas; gate with `includePartialMessages`.

**`tool_progress`**: `{type:'tool_progress', tool_use_id, tool_name, parent_tool_use_id, elapsed_time_seconds, task_id?, uuid, session_id}` [d.ts:4381]. **`tool_use_summary`**: `{type:'tool_use_summary', summary, preceding_tool_use_ids}`. **`rate_limit_event`**: `rate_limit_info: {status:'allowed'|'allowed_warning'|'rejected', resetsAt?, rateLimitType?: 'five_hour'|'seven_day'|'seven_day_opus'|…, utilization?, overageStatus?, …}` [d.ts:4076-4105].

---

## 5. `canUseTool` and `PermissionResult`

Exact signature [d.ts:206-254]:

```ts
type CanUseTool = (toolName: string, input: Record<string, unknown>, options: {
  signal: AbortSignal;
  suggestions?: PermissionUpdate[];
  blockedPath?: string;
  decisionReason?: string;
  title?: string;          // full prompt sentence, NEW
  displayName?: string;    // short noun phrase, NEW
  description?: string;    // NEW
  toolUseID: string;
  agentID?: string;
  requestId: string;       // control_request envelope id, NEW — for out-of-band responses
}) => Promise<PermissionResult | null>;
```

Returning `null` is only legal when the consumer already answered out-of-band echoing `requestId`; "an accidental null means … the tool stays blocked indefinitely — permission prompts have no park deadline" [d.ts:200-204].

```ts
type PermissionResult =
  | { behavior: 'allow';  updatedInput?: Record<string, unknown>;
      updatedPermissions?: PermissionUpdate[]; toolUseID?: string;
      decisionClassification?: 'user_temporary'|'user_permanent'|'user_reject' }
  | { behavior: 'deny';   message: string; interrupt?: boolean; toolUseID?: string;
      decisionClassification?: ... };   // [d.ts:2065-2077]
```

`PermissionUpdate` variants: `addRules | replaceRules | removeRules` (`{rules: {toolName, ruleContent?}[], behavior: 'allow'|'deny'|'ask', destination}`), `setMode {mode}`, `addDirectories | removeDirectories {directories}`; `destination: 'userSettings'|'projectSettings'|'localSettings'|'session'|'cliArg'` [d.ts:2084-2113].

Hard constraints (verbatim error strings in local 0.3.205 `sdk.mjs`): "`canUseTool callback cannot be used with permissionPromptToolName`"; when `canUseTool` is set the SDK pushes `--permission-prompt-tool stdio`; "`canUseTool will not be invoked: permissionMode 'bypassPermissions' auto-approves every tool call (except explicit deny rules)`". Auto-denies (deny rules, `dontAsk`, `auto` classifier) also skip it — watch `system/permission_denied` instead. Escalation metadata for policy engines rides the wire frame, not the callback: `decision_reason_type: 'rule'|'mode'|'subcommandResults'|'permissionPromptTool'|'hook'|'asyncAgent'|'sandboxOverride'|'workingDir'|'safetyCheck'|'classifier'|'other'`, `classifier_approvable?`, `requires_user_interaction?` (no one-tap approve when true) [d.ts:3471-3495].

---

## 6. In-SDK hooks

`Options.hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>>`; `HookCallbackMatcher = {matcher?: string, hooks: HookCallback[], timeout?: number /* seconds */}`; `HookCallback = (input: HookInput, toolUseID: string|undefined, {signal}) => Promise<HookJSONOutput>`.

**HookEvent (0.3.205, 30 events)** [d.ts:784]: `PreToolUse, PostToolUse, PostToolUseFailure, PostToolBatch, Notification, UserPromptSubmit, UserPromptExpansion, SessionStart, SessionEnd, Stop, StopFailure, SubagentStart, SubagentStop, PreCompact, PostCompact, PermissionRequest, PermissionDenied, Setup, TeammateIdle, TaskCreated, TaskCompleted, Elicitation, ElicitationResult, ConfigChange, WorktreeCreate, WorktreeRemove, InstructionsLoaded, CwdChanged, FileChanged, MessageDisplay`. (0.2.44 has only 15 — no PostToolBatch/PostCompact/StopFailure/PermissionDenied/Elicitation/ConfigChange/etc.)

All hook inputs extend `BaseHookInput = {session_id, transcript_path, cwd, permission_mode?, effort?: {level}}`. Notables:
- `PreToolUseHookInput {tool_name, tool_input, tool_use_id}` → output `hookSpecificOutput: {hookEventName:'PreToolUse', permissionDecision?: 'allow'|'deny'|'ask'|'defer', permissionDecisionReason?, updatedInput?, additionalContext?}` — **input rewriting** [d.ts:2206-2212]. `'defer'` is new in 0.3.x.
- `PostToolUseHookInput {tool_name, tool_input, tool_response, tool_use_id, duration_ms?}` → `{updatedToolOutput?: unknown /* replaces output sent to model — all tools */, updatedMCPToolOutput? /* legacy MCP-only */, additionalContext?}` — **output rewriting** [d.ts:2180-2191].
- `PostToolBatchHookInput {tool_calls: {tool_name, tool_input, tool_use_id, tool_response?}[]}` — fires once per parallel batch.
- `PermissionRequestHookInput {tool_name, tool_input, permission_suggestions?}` → `decision: {behavior:'allow', updatedInput?, updatedPermissions?} | {behavior:'deny', message?, interrupt?}` — a hook-level approver that pre-empts `canUseTool`.
- `PermissionDeniedHookInput {..., reason}` → `{retry?: boolean}` — auto-retry a denied tool.
- `StopHookInput {stop_hook_active}`; `SubagentStopHookInput {agent_id, agent_transcript_path, agent_type}`; `SessionStartHookInput {source:'startup'|'resume'|'clear'|'compact', session_title?}` → `{additionalContext?, initialUserMessage?, sessionTitle?, watchPaths?, reloadSkills?}`.
- Generic sync output: `{continue?, suppressOutput?, stopReason?, decision?: 'approve'|'block', systemMessage?, reason?, hookSpecificOutput?}`; async: `{async: true, asyncTimeout?}` [0.2.44 d.ts:1846-1854].

Wire mechanism: hooks are registered at `initialize` as `{matcher?, hookCallbackIds: string[], timeout?}`; the CLI calls back with `control_request {subtype:'hook_callback', callback_id, input, tool_use_id?}` and the SDK answers via `control_response` [d.ts:3736-3750].

---

## 7. The stream-json wire protocol (what a non-SDK adapter must speak)

**CLI invocation** (from local `--help` and sdk.mjs): `claude --print --input-format stream-json --output-format stream-json --verbose [--include-partial-messages] [--include-hook-events] [--replay-user-messages] [--permission-prompt-tool stdio] ...`. Binary-string constraints: "`stream-json requires --verbose`", "`--input-format=stream-json requires output-format=stream-json`", "`stream-json requires --print`", "`stream-json input requires a readable stdin for the lifetime of the session`".

**Input frame** (one JSON per line on stdin):

```json
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Fix the failing test"}]},"parent_tool_use_id":null,"session_id":"<uuid>"}
```

(Shape = `SDKUserMessage`; image blocks per Anthropic `MessageParam`. Optional `priority`, `shouldQuery:false` for inject-without-turn — this is baton's "inject" primitive.)

**Control frames** — four envelope types (all confirmed as strings in the 2.1.205 binary):

```json
{"type":"control_request","request_id":"req_1","request":{"subtype":"interrupt"}}
{"type":"control_response","response":{"subtype":"success","request_id":"req_1","response":{"still_queued":["<uuid-a>","<uuid-b>"]}}}
{"type":"control_cancel_request","request_id":"req_2"}
{"type":"system","subtype":"control_request_progress","request_id":"req_3","status":"started","uuid":"...","session_id":"..."}
```

Error responses: `{"subtype":"error","request_id":"...","error":"...","pending_permission_requests":[...],"pending_user_dialog_requests":[...]}` (pending arrays appear on `initialize` responses) [d.ts:267-293].

**Client→CLI control subtypes** (`SDKControlRequestInner`, [d.ts:3584] — every one also present as `subtype:"…"` strings in the 2.1.205 binary): `initialize` (registers `hooks` matchers, `sdkMcpServers`, `jsonSchema`, `systemPrompt`, `appendSystemPrompt`, `planModeInstructions`, `toolAliases`, `excludeDynamicSections`, `agents`, `title`, `skills`, `promptSuggestions`, `agentProgressSummaries`, `forwardSubagentText`, `supportedDialogKinds`), `interrupt`, `set_permission_mode {mode}`, `set_model {model?}`, `set_max_thinking_tokens {max_thinking_tokens, thinking_display?}`, `apply_flag_settings {settings}`, `rename_session {title}`, `set_color {color}`, `mcp_status`, `mcp_message {server_name, message: JSONRPCMessage}` (raw JSON-RPC pass-through to a named MCP server), `mcp_call {tool:"mcp__server__tool", arguments?}` (**direct MCP invocation, no model turn, no permission check** [d.ts:3416-3425]), `mcp_set_servers {servers}`, `mcp_reconnect {serverName}`, `mcp_toggle {serverName, enabled}`, `list_models`, `get_context_usage`, `get_session_cost`, `get_usage`, `get_settings`, `get_binary_version`, `get_workspace_diff`, `get_plan`, `read_file {path, max_bytes?, encoding?}`, `file_suggestions {query}`, `rewind_files {user_message_id, dry_run?}`, `cancel_async_message {message_uuid}`, `seed_read_state {path, mtime}`, `register_repo_root {directory, reload_claude_md?, reload_plugins?, reload_skills?}`, `reload_plugins`, `reload_skills`, `stop_task {task_id}`, `background_tasks {tool_use_id?}`.

**CLI→client control subtypes** (CLI initiates, adapter must answer): `can_use_tool` (fields in §5 — reply `control_response.response = PermissionResult` with `behavior`/`updatedInput`/`updatedPermissions`/`interrupt`), `hook_callback {callback_id, input, tool_use_id?}`, `elicitation {mcp_server_name, message, mode?: 'form'|'url', url?, elicitation_id?, requested_schema?, title?, display_name?}`, `request_user_dialog {dialog_kind, payload, tool_use_id?}` (answer `{behavior:'cancelled'}` for unknown kinds).

Example approval exchange:

```json
← {"type":"control_request","request_id":"req_9","request":{"subtype":"can_use_tool","tool_name":"Bash","input":{"command":"rm -rf build"},"tool_use_id":"toolu_x","decision_reason_type":"safetyCheck","permission_suggestions":[{"type":"addRules","rules":[{"toolName":"Bash","ruleContent":"rm -rf build"}],"behavior":"allow","destination":"session"}]}}
→ {"type":"control_response","response":{"subtype":"success","request_id":"req_9","response":{"behavior":"allow","updatedInput":{"command":"rm -rf build/tmp"}}}}
```

The 2.1.205 binary additionally contains subtypes **not in the public SDK union** (remote-control/bridge channel): `away_summary, bridge_state, bridge_status, channel_enable, claude_authenticate, claude_oauth_callback, elicitation_complete, generate_session_title, host_auth_token_refresh, mcp_authenticate, mcp_clear_auth, mcp_oauth_callback_url, memory_saved, message_rated, model_consent_fallback, model_fallback, oauth_token_refresh, permission_retry, post_turn_summary, remote_control, scheduled_task_fire, set_cwd, set_mcp_permission_mode_override, side_question, stop_hook_summary, submit_feedback, task_summary, turn_duration, turn_starting, ultrareview_launch` (strings dump of `/Users/wahargis/.local/share/claude/versions/2.1.205`). Treat these as undocumented/unstable.

**De-facto reference implementations**: the SDK's own `sdk.mjs` (readable, minified-light) and github.com/agentclientprotocol/claude-agent-acp (v0.58.1, Apache-2.0) — note the latter now sits **on top of the SDK**, not raw stream-json; it demonstrates `canUseTool`→ACP `requestPermission` mapping, `interrupt()` with a force-cancel `AbortController` backstop timer, fork via `{resume: sessionId, forkSession: true}`, and turn settlement keyed on `system/session_state_changed: 'idle'`.

---

## 8. Session persistence on disk (local ground truth)

Layout under `~/.claude/projects/<sanitized-cwd>/` (cwd with `/` and `.` → `-`; verified `/Users/wahargis/.claude/projects/-Users-wahargis-Development/`):

- `<session-uuid>.jsonl` — main transcript
- `<session-uuid>/subagents/agent-<id>.jsonl` (and `subagents/workflows/wf_<id>/agent-<id>.jsonl`) — subagent transcripts
- `<session-uuid>/tool-results/<id>.txt` — large tool outputs spilled out of the JSONL
- `<session-uuid>/workflows/wf_<id>.json`

Entry `type`s observed in a real 2.1.205 transcript (`/Users/wahargis/.claude/projects/-Users-wahargis-Development/73adbbf2-a514-4a17-8729-9cda68da5bac.jsonl`, 458 lines; keys only, content redacted):

| type | keys |
|---|---|
| `mode` | `type,mode,sessionId` |
| `permission-mode` | `type,permissionMode,sessionId` |
| `system` | `parentUuid,isSidechain,type,subtype,content,level,timestamp,uuid,isMeta,userType,entrypoint,cwd,sessionId,version,gitBranch` |
| `user` | `parentUuid,isSidechain,promptId,type,message,uuid,timestamp,permissionMode,origin,promptSource,userType,entrypoint,cwd,sessionId,version,gitBranch` |
| `assistant` | `parentUuid,isSidechain,message,requestId,type,uuid,timestamp,session_id,userType,entrypoint,cwd,sessionId,version,gitBranch` |
| `attachment` | `parentUuid,isSidechain,attachment,type,uuid,timestamp,…` |
| `file-history-snapshot` | `type,messageId,snapshot,isSnapshotUpdate` |
| `bridge-session` | `type,sessionId,bridgeSessionId,lastSequenceNum` |
| `ai-title` / `last-prompt` / `queue-operation` | `aiTitle` / `lastPrompt,leafUuid` / `operation,timestamp,content` |

Entries form a **parent-linked chain** (`parentUuid`), which is what `resumeSessionAt` and compaction `preserved_messages.anchor_uuid` splice against. `assistant.message` keys: `model,id,type,role,content,stop_reason,stop_sequence,stop_details,usage,diagnostics`; `usage` keys: `input_tokens,cache_creation_input_tokens,cache_read_input_tokens,output_tokens,server_tool_use,service_tier,cache_creation,inference_geo,iterations,speed`. Programmatic access: prefer `listSessions()`/`getSessionMessages()` over parsing (schema is unversioned and has grown fields like `promptSource`, `inference_geo` without notice).

---

## 9. Python SDK deltas (`claude-agent-sdk` on PyPI, 0.2.114 as of 2026-07-08)

- Entry points: `query()` (one-shot) and `ClaudeSDKClient` (streaming; supports `async with`). Client methods: `query(prompt, session_id="default")`, `receive_messages()`, `receive_response()` (yields until a `ResultMessage`), `interrupt()`, `set_permission_mode()`, `set_model()`, `get_mcp_status()`, `reconnect_mcp_server()`, `toggle_mcp_server()`. No documented `apply_flag_settings`/`still_queued` receipt yet (docs show `interrupt() -> None`) — Python trails TS on the newest control surface.
- Options object is `ClaudeAgentOptions` with **snake_case** fields (`permission_mode`, `allowed_tools`, `setting_sources`, `max_turns`, `continue_conversation` for TS `continue`) — **but nested `AgentDefinition` keeps camelCase wire names** (`disallowedTools`, `permissionMode`, `maxTurns`).
- Messages are dataclasses (`AssistantMessage`, `ResultMessage`, `TextBlock`…) with attribute access; config shapes are `TypedDict`s (plain dicts, key access) — e.g. `ThinkingConfigEnabled(type="enabled", budget_tokens=...)` uses `budget_tokens` not `budgetTokens`.
- Tools: `@tool("name", "desc", {"param": str})` decorator + `create_sdk_mcp_server(name=..., version=..., tools=[...])`; hooks use `HookMatcher`; permission callback is `can_use_tool(tool_name, input_data, context) -> PermissionResultAllow | PermissionResultDeny` (`PermissionResultAllow(updated_input=...)`).
- Session helpers (`list_sessions`, `get_session_messages`, `get_session_info`, `rename_session`, `tag_session`) are **synchronous**.
- Failure-mode asymmetry (docs, streaming page): a TS generator exception surfaces as misleading `"Claude Code process aborted by user"`; a Python generator exception is logged at debug level and **the session stalls without raising**. Avoid `break` when iterating (asyncio cleanup issues).
- CLI is bundled with the pip package (no separate install).

---

## Limitations

1. **Streaming-input gating**: every `Query` control method ("Control Requests … only supported when streaming input/output is used" [d.ts:2232-2234]). Single-message mode additionally lacks image attachments, message queueing, real-time interruption, natural multi-turn (docs: streaming-vs-single-mode "Limitations" warning), and a one-shot `query()` **raises after yielding an error result** (`error_max_turns` etc.) — wrap the loop.
2. **Version skew is the #1 field hazard.** SDK 0.2.44 (installed here) vs 0.3.205: missing `still_queued`, `applyFlagSettings`, `reinitialize`, `task_progress`/`task_started`/`task_updated`, `auto` mode, `PostToolBatch` + 14 other hook events, `toolAliases`, `settings`/`managedSettings`, `skills`, `sessionStore`. Also **semantic flips between minor versions**: `settingSources` omitted = *none* (0.2.44) vs *all* (0.3.205); `env` merged vs *replaced*. Pin SDK+CLI pairs; feature-detect via `system/init.capabilities` ("Open set — ignore unknown values" [d.ts:4276]).
3. **CLI/SDK vocabulary mismatch**: CLI `--permission-mode` accepts `manual`/`auto` but not `default`; SDK type has `default`/`auto` but not `manual`; 0.2.44 documented `delegate` (dropped in 0.3.205, still present in 2.1.205 binary strings). An adapter normalizing modes must map `manual↔default` (claude-agent-acp does exactly this).
4. **Explicitly experimental/alpha** (in-type annotations): `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()`; `unstable_v2_*` session API (`@alpha`); `sessionStore`/`sessionStoreFlush`/`loadTimeoutMs`/`importSessionToStore`/`resolveSettings` (`@alpha`); `taskBudget` (`@alpha`); `criticalSystemReminder_EXPERIMENTAL`; `request_user_dialog.dialog_kind` is an open string union.
5. **Known sharp edges** (from type-level warnings, all quotable at the cited lines): permission prompts have **no park deadline** — a lost `control_response` blocks the tool forever [d.ts:203]; `prompt_suggestion` arrives *after* `result` — consumers that stop at `result` never see it [d.ts:1741]; `background_tasks_changed` is per-process with no startup snapshot — reset on CLI restart [d.ts:2834]; `enableFileCheckpointing` incompatible with `sessionStore` ("rewindFiles() fails after a store-backed resume", sdk.mjs error string); `sessionStore` requires `persistSession: true`; interrupt-receipt ordering races documented in [d.ts:3403]; settings files that fail validation are **silently ignored** in `--print` mode (CLI `--help`, `-p` entry; surfaced as `SDKSettingsParseError` type [d.ts:4218]).
6. **Approval-channel blind spots**: `canUseTool` sees only the "ask" path. Deny rules / `dontAsk` / `auto`-classifier denials surface as `system/permission_denied` events; PreToolUse-hook denials bypass both [d.ts:4005]. Under `bypassPermissions` it is never called (sdk.mjs). One of `canUseTool` / `permissionPromptToolName`, never both.
7. **Rate limits**: plan-limit telemetry (`rate_limit_event`, `get_usage.rate_limits`) exists **only** for claude.ai-subscription auth; `rate_limits_available: false` for API key/Bedrock/Vertex [d.ts:2380-2384]. `--betas` is API-key-only (CLI help).
8. **No schema introspection**: unlike Codex's `generate-json-schema`, the stream-json protocol has no machine-readable contract; the shipped `sdk.d.ts` is the de-facto schema (this dossier's [d.ts] cites). The extra binary-only control subtypes (§7 end) are undocumented and may change without notice.
9. **`--verbose` requirement**: `-p --output-format stream-json` still errors without `--verbose` (binary string "stream-json requires --verbose"); the SDK always passes it — hand-rolled adapters must too.

## Open unknowns

- Whether CLI 2.1.205 accepts `--setting-sources` with the *space* form vs only `=`-joined (SDK emits `--setting-sources=a,b`); untested here (no quota-consuming runs performed).
- The concrete `Settings` schema accepted by `applyFlagSettings`/`--settings` (the `Settings` type in sdk.d.ts is large and partially `z.core.$loose`); which keys are honored mid-session vs spawn-only is not documented.
- `request_user_dialog` dialog-kind catalog beyond `'refusal_fallback_prompt'`; payload shapes are transported opaquely [d.ts:3611-3617].
- Whether the Python SDK 0.2.114 wire-supports `apply_flag_settings`, `background_tasks`, `mcp_call` (docs don't list them; the CLI side supports them, so raw control frames may work — unverified).
- Exact semver mapping rule between SDK 0.3.N and CLI 2.1.N (holds for 205; not confirmed as a stated policy).
- `--replay-user-messages` uuid-ack behavior interaction with `still_queued` uuids (both reference "the message's own uuid as delivered on the replay ack" [d.ts:3950]) — needs a live test.

## Sources

**Local (primary, outranks web):**
- `/private/tmp/claude-501/-Users-wahargis-Development/73adbbf2-a514-4a17-8729-9cda68da5bac/scratchpad/sdk0325/package/sdk.d.ts` (SDK 0.3.205, 6,879 lines — all `[d.ts:N]` citations) and `.../package/sdk.mjs` (runtime; flag list, error strings)
- `/Users/wahargis/.npm/_npx/7b8cde7936c78aff/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` (+ `sdk.mjs`, `package.json`, bundled `cli.js` @2.1.44) — SDK 0.2.44 baseline
- `/Users/wahargis/.local/share/claude/versions/2.1.205` — `--help` output; `strings` dumps (control subtypes, `still_queued`, `apply_flag_settings`, stream-json constraints)
- `/Users/wahargis/.claude/projects/-Users-wahargis-Development/73adbbf2-a514-4a17-8729-9cda68da5bac.jsonl` + sibling directory — transcript schema (structure only)
- `/Users/wahargis/Development/Experiments/baton/docs/02-harness-control-surfaces.md`, `04-architecture-options.md` — capability vocabulary context

**Web:**
- https://code.claude.com/docs/en/agent-sdk/python — Python deltas, dataclass/TypedDict split, camelCase `AgentDefinition` note, ≤0.1.59 `setting_sources=[]` bug
- https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode — single-message limitations, generator-failure notes
- https://github.com/agentclientprotocol/claude-agent-acp (v0.58.1) + `src/acp-agent.ts` — SDK-consumer reference patterns
- https://pypi.org/project/claude-agent-sdk/ and https://github.com/anthropics/claude-agent-sdk-python — Python SDK 0.2.114 (2026-07-08)
- npm registry: `@anthropic-ai/claude-agent-sdk` dist-tags `{latest: 0.3.205, next: 0.3.206}` (`npm view`, 2026-07-09)