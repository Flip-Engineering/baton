# Codex App-Server Protocol — Implementation Dossier (baton southbound adapter)

## Summary

- Codex CLI **0.144.0** exposes an experimental JSON-RPC-over-NDJSON control plane via `codex app-server`; the runtime accepts **121 client methods** (verified by probing the live binary — 33 of them, all experimental, are absent from the generated JSON Schema bundle).
- Transports: stdio NDJSON child (default), unix control socket at `$CODEX_HOME/app-server-control/app-server-control.sock` (WebSocket frames, reachable via `codex app-server proxy`), experimental `ws://IP:PORT` with token auth, plus a managed daemon (`codex app-server daemon …`) and the `codex remote-control` pairing surface.
- Turn control is first-class: `turn/start` (per-turn `model`/`cwd`/`sandboxPolicy`/`approvalPolicy` overrides that **persist for subsequent turns**), `turn/steer` (requires `expectedTurnId` precondition, returns `{turnId}`), `turn/interrupt`; thread control includes `resume`, `fork` (`lastTurnId` truncation), deprecated `rollback`, `inject_items` (raw Responses-API items), and `thread/goal/set` with `tokenBudget`.
- Approvals arrive as **server→client JSON-RPC requests** (`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval`, plus legacy `execCommandApproval`/`applyPatchApproval`); v2 decision vocabulary is `accept | acceptForSession | acceptWithExecpolicyAmendment | applyNetworkPolicyAmendment | decline | cancel`.
- Two independent contention signals share code **-32001**: the official server's ingress-overload rejection, and the OpenAI Claude-plugin's own single-flight unix-socket broker (`BROKER_BUSY_RPC_CODE = -32001`, "Shared Codex broker is busy") — the plugin's production pattern (fall back to a private spawned child) is directly reusable by baton.

---

## 1. Provenance and evidence base

| Evidence | Location |
|---|---|
| Installed binary | `codex-cli 0.144.0` (`codex --version`; native binary at `/opt/homebrew/lib/node_modules/@openai/codex/bin/codex-aarch64-apple-darwin`) |
| Generated schema bundle (`codex app-server generate-json-schema`) | `/private/tmp/claude-501/-Users-user-Development/73adbbf2-a514-4a17-8729-9cda68da5bac/scratchpad/codex-appserver-schema/` — `ClientRequest.json`, `ServerRequest.json`, `ServerNotification.json`, `ClientNotification.json`, per-message files, plus `v1/` (Initialize) and `v2/` (230 files) subdirs |
| Production client (OpenAI's Codex plugin for Claude Code) | `$HOME/.claude/plugins/cache/openai-codex/codex/1.0.6/scripts/lib/app-server.mjs`, `broker-lifecycle.mjs`, `broker-endpoint.mjs`, `codex.mjs`, `app-server-protocol.d.ts`, `$HOME/.claude/plugins/cache/openai-codex/codex/1.0.6/scripts/app-server-broker.mjs` |
| Live probes | initialize handshake + error-shape probes run against the real binary (scripts at `/private/tmp/claude-501/-Users-user-Development/73adbbf2-a514-4a17-8729-9cda68da5bac/scratchpad/init-probe.mjs`, `err-probe.mjs`, `list-probe.mjs`) |
| Web | `https://developers.openai.com/codex/app-server.md` (redirects to `learn.chatgpt.com/docs/app-server.md`), `https://raw.githubusercontent.com/openai/codex/main/codex-rs/app-server/README.md`, `codex-rs/app-server-daemon/README.md` |

Rule applied throughout: local binary/schema outranks web docs; disagreements are flagged inline.

## 2. Transports

From `codex app-server --help` (local, authoritative) and the app-server README:

- `--listen <URL>` — `stdio://` (default), `unix://`, `unix://PATH`, `ws://IP:PORT`, `off`. `--stdio` is an alias for `--listen stdio://`.
- **stdio**: newline-delimited JSON (JSONL/NDJSON), one JSON-RPC message per line. `"jsonrpc":"2.0"` is **omitted on the wire** (confirmed by live probe output and the plugin client, which never sends it — `app-server.mjs:96` sends `{id, method, params}` only).
- **unix socket**: "websocket connections over `$CODEX_HOME/app-server-control/app-server-control.sock`" (app-server README). Note the frames on the unix socket are WebSocket, *not* raw NDJSON — `codex app-server proxy [--sock <SOCKET_PATH>]` exists precisely to adapt: it "opens exactly one raw stream connection" to the control socket and proxies bytes to stdio, so a stdio NDJSON client can talk to a shared daemon unchanged.
- **ws://**: one JSON-RPC message per text frame. Health endpoints `GET /readyz` and `GET /healthz` (403 with an `Origin` header). Auth for non-loopback listeners: `--ws-auth capability-token|signed-bearer-token`, with `--ws-token-file <PATH>`, `--ws-token-sha256 <HEX>`, `--ws-shared-secret-file <PATH>`, `--ws-issuer`, `--ws-audience`, `--ws-max-clock-skew-seconds`; clients send `Authorization: Bearer <token>` at handshake. Official status: "Websocket transport is currently experimental and unsupported. Do not rely on it for production workloads."
- **Overload**: "When request ingress is full, the server rejects new requests with JSON-RPC error code `-32001`" (developers.openai.com/codex/app-server.md).
- The interactive TUI can attach to a remote server: `codex --remote <ADDR>` accepting `ws://host:port`, `wss://host:port`, `unix://`, `unix://PATH` (from `codex --help`) — useful for manually inspecting a daemon baton also drives.

**Daemon vs child**: `codex app-server` as a child (stdio) dies with its parent and has exactly one client. The managed daemon (`codex app-server daemon start|restart|stop|bootstrap|enable-remote-control|disable-remote-control|version`) persists state under `$CODEX_HOME/app-server-daemon/` (`app-server.pid`, `app-server-updater.pid`, `settings.json`, `daemon.lock`); `start` is idempotent and "returns after app-server is ready to answer the normal JSON-RPC initialize handshake on the Unix control socket"; `bootstrap` "requires the standalone managed install" (`curl -fsSL https://chatgpt.com/codex/install.sh | sh`, then `$HOME/.codex/packages/standalone/current/codex app-server daemon bootstrap --remote-control`) and targets SSH-driven fleets (codex-rs/app-server-daemon/README.md).

## 3. Initialize handshake (verified live)

Exactly one `initialize` request per connection, then an `initialized` notification, before anything else. Verified exchange against codex 0.144.0:

```
>> {"id":0,"method":"initialize","params":{"clientInfo":{"name":"baton-recon","title":"Baton Recon","version":"0.0.1"}}}
<< {"id":0,"result":{"userAgent":"baton-recon/0.144.0 (Mac OS 15.5.0; arm64) ghostty/1.2.3 (baton-recon; 0.0.1)","codexHome":"$HOME/.codex","platformFamily":"unix","platformOs":"macos"}}
>> {"method":"initialized","params":{}}
```

- `userAgent` is composed as `<clientInfo.name>/<codex-version> (<OS>; <arch>) <terminal>/<ver> (<clientInfo.name>; <clientInfo.version>)`. `clientInfo.name` identifies you "for the OpenAI Compliance Logs Platform" (official docs) — baton should send a stable `name`.
- Immediately after initialize the server pushed an unsolicited notification (verified): `{"method":"remoteControl/status/changed","params":{"status":"disabled","serverName":"Williams-MacBook-Air.local","installationId":"…","environmentId":null}}` — adapters must tolerate notifications before the first thread exists.
- `InitializeParams.capabilities` (`v1/InitializeParams.json`): `experimentalApi` (bool, default false — "Opt into receiving experimental API methods and fields"), `optOutNotificationMethods` (array of exact method names to suppress, e.g. `"thread/started"`), `requestAttestation` (opt into `attestation/generate` server-requests), `mcpServerOpenaiFormElicitation`. Without `experimentalApi:true` the server rejects gated methods with `<descriptor> requires experimentalApi capability`.
- Requests before init get `"Not initialized"`; repeat init gets `"Already initialized"` (app-server README).
- `ClientNotification.json`: the **only** client-sendable notification is `initialized`.
- The plugin's production defaults: it opts out of all token-level deltas — `optOutNotificationMethods: ["item/agentMessage/delta","item/reasoning/summaryTextDelta","item/reasoning/summaryPartAdded","item/reasoning/textDelta"]` (`app-server.mjs:33-42`). Baton should do the same unless it renders live tokens; `item/completed` is authoritative anyway.

## 4. Thread lifecycle

Method names below are wire-exact from `ClientRequest.json` (`properties.method.enum`).

### `thread/start` — `ThreadStartParams`
All optional: `cwd`, `model`, `modelProvider`, `sandbox` (**`SandboxMode` enum: `"read-only" | "workspace-write" | "danger-full-access"`** — kebab-case; the web doc's example `"sandbox": "workspaceWrite"` contradicts the local schema and the plugin, which sends `"read-only"`; trust local), `approvalPolicy` (`AskForApproval`: `"untrusted" | "on-request" | "never"` or the `{granular:{mcp_elicitations, rules, sandbox_approval, request_permissions, skill_approval}}` object), `approvalsReviewer` (`"user" | "auto_review" | "guardian_subagent"(legacy)` — routes approval requests to a risk-assessing subagent instead of the client), `baseInstructions`, `developerInstructions`, `config` (free-form object — **per-thread config.toml overrides**), `ephemeral` (bool — don't materialize rollout on disk), `personality` (`"none"|"friendly"|"pragmatic"`), `serviceName`, `serviceTier`, `threadSource`, `sessionStartSource` (`"startup"|"clear"`).

Response (`v2/ThreadStartResponse.json`): `{thread, model, modelProvider, cwd, sandbox, approvalPolicy, approvalsReviewer, reasoningEffort?, serviceTier?, instructionSources[]}`. The `Thread` object: `{id (UUIDv7), sessionId, name?, cwd, cliVersion, createdAt, updatedAt (unix secs), ephemeral, source, status, turns[], gitInfo?, forkedFromId?, parentThreadId?, agentNickname?, agentRole?, preview, modelProvider}` — `turns` is only populated on `thread/resume`, `thread/rollback`, `thread/fork`, and `thread/read` (`includeTurns:true`) responses.

Production example (plugin, `codex.mjs:63-72`):
```json
{"method":"thread/start","id":10,"params":{"cwd":"/work/repo","model":null,"approvalPolicy":"never","sandbox":"read-only","serviceName":"claude_code_codex_plugin","ephemeral":true}}
```

### `thread/resume` — `ThreadResumeParams`
Requires `threadId`; same override fields as start (minus `ephemeral`). Documented resolution semantics (schema description, verbatim): three ways to resume — by `thread_id`, by `history`, by `path`; "For non-running threads, the precedence is: history > non-empty path > thread_id"; "If thread_id identifies a running thread, app-server **rejoins** that thread"; "Prefer using thread_id whenever possible." Rejoin is the reattach primitive for a baton daemon-per-fleet design.

### `thread/fork` — `ThreadForkParams`
`threadId` required; `lastTurnId` — "Optional last turn id to fork through, inclusive. When specified, turns after `last_turn_id` are omitted from the fork. The referenced turn cannot be in progress." Plus the standard override set and `ephemeral`.

### `thread/rollback` — DEPRECATED
Schema description: "DEPRECATED: `thread/rollback` will be removed soon." Params `{threadId, numTurns}` — drops N turns from the end of **history only**; "does not revert local file changes… Clients are responsible for reverting these changes." Response returns the updated `Thread` with `turns` populated. Baton should prefer `thread/fork` + `lastTurnId`.

### `thread/inject_items` — `ThreadInjectItemsParams`
`{threadId, items: [...]}` — "Raw Responses API items to append to the thread's model-visible history"; persisted to the rollout and included in subsequent model requests. Response is `{}`. This is baton's context-injection primitive; items are OpenAI Responses-API-shaped, not ThreadItems.

### Goals — `thread/goal/set|get|clear`
`ThreadGoalSetParams`: `{threadId, objective?, status?, tokenBudget? (int64)}`; `ThreadGoalStatus`: `"active"|"paused"|"blocked"|"usageLimited"|"budgetLimited"|"complete"`. Emits `thread/goal/updated` / `thread/goal/cleared`. The `token_budget` feature flag is still "under development" (`codex features list`), so budget enforcement may be inert — goal/objective persistence works via the stable `goals` feature (stable/true locally).

### Enumeration & housekeeping
`thread/list` (`ThreadListParams`: `cursor`, `limit`, `cwd` filter, `sourceKinds`, `archived`, `modelProviders`, `searchTerm` (title substring), `sortKey` (default `created_at`), `sortDirection`, `useStateDbOnly`), `thread/loaded/list`, `thread/read` (`{threadId, includeTurns}`), `thread/archive`, `thread/unarchive`, `thread/delete`, `thread/unsubscribe` (stop events; may emit `thread/closed` after a grace period), `thread/compact/start` (`{threadId}` → `{}` immediately; completion signaled by `thread/compacted` notification). The plugin lists task threads with `{"cwd":cwd,"limit":20,"sortKey":"updated_at","sourceKinds":["appServer"],"searchTerm":…}` (`codex.mjs:1161-1180`).

`ThreadStatus` (runtime status in `thread/status/changed`): tagged objects `{"type":"notLoaded"|"idle"|"systemError"|…}` plus an active variant carrying `activeFlags` (`v2/ThreadStartResponse.json` definitions).

## 5. Turn lifecycle

### `turn/start` — `TurnStartParams`
Required: `threadId`, `input: UserInput[]`. `UserInput` variants (wire-exact): `{"type":"text","text":…,"text_elements":[]}` (note **snake_case** `text_elements`, unlike everything else), `{"type":"image","url":…}`, `{"type":"localImage","path":…}`, `{"type":"skill","name":…,"path":…}`, `{"type":"mention","name":…,"path":…}`.

Per-turn overrides — schema descriptions all read "Override … **for this turn and subsequent turns**" (i.e., sticky, not one-shot): `model`, `effort` (`ReasoningEffort`, free string), `summary` (`ReasoningSummary`), `cwd`, `approvalPolicy`, `approvalsReviewer`, `personality`, `serviceTier`, `sandboxPolicy`, plus `outputSchema` ("Optional JSON Schema used to constrain the final assistant message for this turn" — one-shot) and `clientUserMessageId`.

`SandboxPolicy` (richer than thread-level `SandboxMode`) is a tagged union: `{"type":"dangerFullAccess"}`, `{"type":"readOnly","networkAccess":false}`, `{"type":"externalSandbox","networkAccess":"restricted"}`, `{"type":"workspaceWrite","writableRoots":["/abs/path"],"networkAccess":false,"excludeSlashTmp":false,"excludeTmpdirEnvVar":false}`.

Response: `{"turn":{"id":"…","status":"inProgress","items":[…],"itemsView":"full","startedAt":…}}`. `TurnStatus`: `"completed"|"interrupted"|"failed"|"inProgress"`. Turn ids are UUIDv7.

### `turn/steer` — `TurnSteerParams` (the primitive ACP lacks)
```json
{"method":"turn/steer","id":32,"params":{"threadId":"thr_123","expectedTurnId":"turn_456","input":[{"type":"text","text":"Focus on the failing tests."}],"clientUserMessageId":null}}
```
`expectedTurnId` is a **required precondition**: "The request fails when it does not match the currently active turn" (schema). Response: `{"turnId":"…"}` (the accepted turn). Docs add: fails if no active turn; emits **no** new `turn/started`; accepts **no** turn-level overrides; review turns and manual compaction turns reject it. The `steer` feature flag is "removed true" in `codex features list` — graduated, always on in 0.144.0.

### `turn/interrupt`
`{threadId, turnId}` → `{}`; the turn then finishes via `turn/completed` with `status:"interrupted"`.

### Completion signal
`turn/completed` carries the full final `Turn` `{id, status, items[], error?, startedAt?, completedAt?, durationMs?}` — `error` populated only when `status:"failed"` (`TurnError = {message, codexErrorInfo?, additionalDetails?}`).

## 6. Approval flow (server→client requests)

Complete `ServerRequest.json` vocabulary (server-initiated JSON-RPC requests the client **must answer**, same `{id, method, params}` envelope):

| Method | Params (required) | Response |
|---|---|---|
| `item/commandExecution/requestApproval` | `{threadId, turnId, itemId, startedAtMs, command?, commandActions?, cwd?, reason?, riskAssessment?, proposedExecpolicyAmendment?, networkApprovalContext?, approvalId?, environmentId?}` | `{decision: CommandExecutionApprovalDecision}` |
| `item/fileChange/requestApproval` | `{threadId, turnId, itemId, startedAtMs, reason?, grantRoot?}` | `{decision: FileChangeApprovalDecision}` |
| `item/permissions/requestApproval` | `{threadId, turnId, itemId, cwd, permissions: RequestPermissionProfile, startedAtMs, reason?, environmentId?}` | `{permissions: GrantedPermissionProfile, scope: "turn"(default)\|"session", strictAutoReview?}` |
| `item/tool/requestUserInput` | questions keyed by id (EXPERIMENTAL) | `{answers: {<qid>: {answers: [string]}}}` |
| `item/tool/call` (dynamic client-hosted tool) | `DynamicToolCallParams` | `DynamicToolCallResponse` |
| `mcpServer/elicitation/request` | `{threadId, turnId?, serverName, mode: "form"\|"openai/form"\|"url", message, requestedSchema?/url?}` | `{action: "accept"\|"decline"\|"cancel", content?, _meta?}` |
| `account/chatgptAuthTokens/refresh` | token refresh (experimental login type) | tokens |
| `attestation/generate` | only if `requestAttestation:true` | attestation |
| `execCommandApproval` (legacy) | `{conversationId, callId, command: [argv], cwd, parsedCmd: ParsedCommand[], reason?, approvalId?}` | `{decision: ReviewDecision}` |
| `applyPatchApproval` (legacy) | `{conversationId, callId, fileChanges: {path: FileChange}, reason?, grantRoot?}` | `{decision: ReviewDecision}` |

**v2 decision vocabulary** (`CommandExecutionApprovalDecision`, schema-verbatim semantics):
- `"accept"` — approve once.
- `"acceptForSession"` — approve; "future prompts in the same session-scoped approval cache should run without prompting."
- `{"acceptWithExecpolicyAmendment":{"execpolicy_amendment":[…]}}` — approve and persist an execpolicy rule so matching commands never prompt again.
- `{"applyNetworkPolicyAmendment":{"network_policy_amendment":{"host":…,"action":"allow"|"deny"}}}` — persist a per-host network rule.
- `"decline"` — deny; "The agent will continue the turn."
- `"cancel"` — deny **and** "The turn will also be immediately interrupted."

`FileChangeApprovalDecision` is the same minus the amendment variants. Legacy `ReviewDecision` (for `execCommandApproval`/`applyPatchApproval`): `"approved"`, `{"approved_execpolicy_amendment":…}`, `"approved_for_session"`, network-amendment object, `"denied"`, `"timed_out"`, `"abort"`.

**Sequence** (official docs): `item/started` (pending item) → server-request → client answers → `serverRequest/resolved` notification (`{requestId, threadId}` — lets a *second* observer UI clear its prompt) → `item/completed`.

**FileChange** (legacy applyPatch payload): `{"add":{content}} | {"delete":{content}} | {"update":{unified_diff, move_path?}}` per path.

Two ways to never see approvals: `approvalPolicy:"never"` + sandbox (the plugin's choice — its `handleServerRequest` rejects **any** server request with `-32601 "Unsupported server request: <method>"`, `app-server.mjs:156-161`), or `approvalsReviewer:"auto_review"` to delegate to Codex's guardian subagent. For baton the interesting path is answering them centrally per hub policy.

## 7. Notification vocabulary (complete, from `ServerNotification.json`)

- **Thread**: `thread/started`, `thread/status/changed`, `thread/archived`, `thread/deleted`, `thread/unarchived`, `thread/closed`, `thread/name/updated`, `thread/goal/updated`, `thread/goal/cleared`, `thread/settings/updated`, `thread/tokenUsage/updated`, `thread/compacted`
- **Turn**: `turn/started`, `turn/completed`, `turn/diff/updated` (aggregated unified diff), `turn/plan/updated`, `turn/moderationMetadata`
- **Item lifecycle**: `item/started`, `item/completed`, `item/autoApprovalReview/started|completed` (guardian reviews)
- **Item deltas**: `item/agentMessage/delta`, `item/plan/delta`, `item/reasoning/summaryTextDelta`, `item/reasoning/summaryPartAdded`, `item/reasoning/textDelta`, `item/commandExecution/outputDelta`, `item/commandExecution/terminalInteraction`, `item/fileChange/outputDelta` (deprecated), `item/fileChange/patchUpdated`, `item/mcpToolCall/progress`
- **Exec/process**: `command/exec/outputDelta`, `process/outputDelta`, `process/exited`
- **Account**: `account/updated`, `account/rateLimits/updated`, `account/login/completed`
- **Infra**: `error`, `warning`, `guardianWarning`, `configWarning`, `deprecationNotice`, `serverRequest/resolved`, `remoteControl/status/changed`, `mcpServer/oauthLogin/completed`, `mcpServer/startupStatus/updated`, `app/list/updated`, `skills/changed`, `fs/changed`, `model/rerouted`, `model/verification`, `model/safetyBuffering/updated`, `fuzzyFileSearch/sessionUpdated|sessionCompleted`, `externalAgentConfig/import/progress|completed`, `hook/started`, `hook/completed`, `windows/worldWritableWarning`, `windowsSandbox/setupCompleted`, `thread/realtime/*` (9 voice-mode notifications)

`ThreadItem.type` vocabulary (18 variants, `v2/ItemStartedNotification.json`): `userMessage, hookPrompt, agentMessage, plan, reasoning, commandExecution, fileChange, mcpToolCall, dynamicToolCall, collabAgentToolCall, subAgentActivity, webSearch, imageView, sleep, imageGeneration, enteredReviewMode, exitedReviewMode, contextCompaction`.

Multi-agent note: `collabAgentToolCall` items carry `receiverThreadIds`; sub-agent threads emit their own `turn/started`/`turn/completed` interleaved on the same connection. The plugin tracks a thread-set and per-thread turn-ids and only treats `turn/completed` for the root thread as done, using a 250 ms debounced "inferred completion" when `final_answer`-phase `agentMessage` arrives while subagent turns wind down (`codex.mjs:380-565`). Baton's event demux must key on `(threadId, turnId)`, not connection.

## 8. Token usage & rate limits

- `thread/tokenUsage/updated` → `{threadId, turnId, tokenUsage: {total, last, modelContextWindow?}}` where each breakdown is `{totalTokens, inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens}` (all int64) — per-turn cadence, ideal for baton's ledger.
- `account/rateLimits/read` (no params) → `{rateLimits: RateLimitSnapshot, rateLimitsByLimitId?: {<limit_id>: RateLimitSnapshot}, rateLimitResetCredits?}`. `RateLimitSnapshot`: `{primary?: {usedPercent, resetsAt?, windowDurationMins?}, secondary?: …, planType? ("free"|"go"|"plus"|"pro"|"prolite"|"team"|"business"|"enterprise"|…), limitId?, limitName?, credits?: {hasCredits, unlimited, balance?}, individualLimit?, rateLimitReachedType?}`.
- `account/rateLimits/updated` is a **sparse rolling update**: "Clients should merge available values into the most recent `account/rateLimits/read` response or refetch… does not clear a previously observed value" (schema description).
- `account/usage/read` → `{summary: AccountTokenUsageSummary, dailyUsageBuckets?}`; also `account/read`, `account/rateLimitResetCredit/consume`.

## 9. Error semantics & contention (live-verified)

- **Unknown/unsupported method** → **`-32600`**, *not* -32601, and critically the error response **has no `id`**:
  `{"error":{"code":-32600,"message":"Invalid request: unknown variant `bogus/method`, expected one of `initialize`, `thread/start`, …"}}` (verified live). Adapter hazard: you cannot correlate this to the pending request — the plugin client silently drops id-less errors and the request would hang forever (`app-server.mjs:136-153`). Baton must pair a per-request timeout with every RPC.
- The plugin *does* see `-32601` for method-gaps in older servers and keys version-fallbacks on it and on the `unknown variant`/`unknown method` message text (`codex.mjs:735-744, 1071-1077`).
- **`-32001` means two different things**: (a) official server ingress overload (docs); (b) the plugin's broker busy-rejection — `BROKER_BUSY_RPC_CODE = -32001`, message `"Shared Codex broker is busy."` (`app-server.mjs:23`, `app-server-broker.mjs:179`). Treat -32001 as "retry elsewhere/later" in either case.
- **Turn-level failures** arrive as the `error` notification `{threadId, turnId, error: TurnError, willRetry: bool}` — `willRetry:true` means Codex is auto-retrying; don't fail the job. `CodexErrorInfo` codes (camelCase): `contextWindowExceeded, sessionBudgetExceeded, usageLimitExceeded, serverOverloaded, cyberPolicy, internalServerError, unauthorized, badRequest, threadRollbackFailed, sandboxError, other`, plus structured variants `{httpConnectionFailed:{httpStatusCode?}}`, `{responseStreamConnectionFailed:…}`, `{responseStreamDisconnected:…}`, `{responseTooManyFailedAttempts:…}`. `usageLimitExceeded` + `account/rateLimits/read` is baton's quota-health signal.
- **Runtime method list ≠ schema.** Probing yielded 121 accepted methods; the schema bundle exports 88. Runtime-only (experimental-gated, mostly): `thread/turns/list`, `thread/items/list`, `thread/search`, `thread/settings/update`, `thread/memoryMode/set`, `memory/reset`, `thread/backgroundTerminals/clean|list|terminate`, `thread/increment_elicitation`, `thread/decrement_elicitation`, `thread/realtime/*` (6), `remoteControl/enable|disable|status/read|pairing/start|pairing/status|client/list|client/revoke`, `collaborationMode/list`, `environment/add|info`, `process/spawn|writeStdin|kill|resizePty`, `fuzzyFileSearch/sessionStart|sessionUpdate|sessionStop`, `mock/experimentalMethod`, and v1 leftovers `getConversationSummary`, `gitDiffToRemote`, `getAuthStatus`.

## 10. v1 vs v2

- The old v1 conversation API (`newConversation`, `sendUserMessage`, `addConversationListener`, …) is **gone from the 0.144.0 runtime** (absent from the exhaustive `unknown variant` list) except the three camelCase stragglers above. Everything current is the v2 `thread/*`–`turn/*`–`item/*` namespace.
- `generate-json-schema` emits two bundles: `codex_app_server_protocol.schemas.json` (title `CodexAppServerProtocol` — JSON-RPC envelope, initialize, and the *server-request* types incl. legacy `ExecCommandApprovalParams`/`ApplyPatchApprovalParams`) and `codex_app_server_protocol.v2.schemas.json` (title `CodexAppServerProtocolV2`, 516 definitions — the whole thread/turn surface). Both approval generations remain live in `ServerRequest.json`; which one you receive depends on server pathway, so **handle both**.
- v1's `conversationId`/`callId` correlate to the v2 `threadId`/`itemId` notions; decision vocabularies differ (`approved`/`approved_for_session`/`denied`/`abort` vs `accept`/`acceptForSession`/`decline`/`cancel`).
- `experimentalApi: true` at initialize is the gate for v2's experimental extensions (`thread/turns/list`, `process/spawn`, `dynamicTools` on `thread/start`, `permissions` field replacing `sandbox`, `historyMode:"paginated"`, `parentThreadId`/`ancestorThreadId` filters).

## 11. Remote-control daemon & pairing

- `codex remote-control start|stop|pair [--json]` — "[experimental] Manage the app-server daemon with remote control enabled". `pair` prints "a short-lived manual pairing code" (the ChatGPT-app pairing path).
- Programmatic equivalents (runtime-verified methods): `remoteControl/pairing/start` (pass `manualCode: true`; returns `pairingCode`, `manualPairingCode`, `environmentId`, `expiresAt` unix-secs), `remoteControl/pairing/status` (poll `claimed`; pass exactly one of the two code fields), `remoteControl/enable|disable|status/read`, `remoteControl/client/list|revoke` (app-server README + live method list).
- Status pushes: `remoteControl/status/changed` `{status: "disabled"|"connecting"|"connected"|"errored", serverName, installationId, environmentId?}` — verified emitted unsolicited right after initialize.
- `codex app-server daemon enable-remote-control` persists the setting and restarts a running managed daemon; the `remote_control` *feature flag* reports stage "removed" in `codex features list` (graduated — the subcommand is the interface now).
- For baton's "foreman" topology: daemon on the remote box, `ssh host codex app-server proxy` gives a clean NDJSON stdio pipe to the shared daemon — no WebSocket client needed.

## 12. Production client patterns worth copying (OpenAI's own plugin)

From `$HOME/.claude/plugins/cache/openai-codex/codex/1.0.6/scripts/`:

- **Connect strategy** (`app-server.mjs:335-354`): env `CODEX_COMPANION_APP_SERVER_ENDPOINT` → broker socket if set; else reuse/spawn a broker (unix socket `<tmpdir>/cxc-XXXX/broker.sock`, win32 `pipe:\\.\pipe\<name>`); else spawn `codex app-server` child directly. Broker readiness poll: connect-probe every 50 ms, 2000 ms budget (`broker-lifecycle.mjs:24-41`); state persisted as `broker.json` (`{endpoint, pidFile, logFile, sessionDir, pid}`).
- **Single-flight broker**: one shared app-server; concurrent clients get `-32001`; only `turn/interrupt` is allowed through while another client streams (`app-server-broker.mjs:170-195`). Streaming ownership follows `turn/start`/`review/start`/`thread/compact/start` and is released on the matching `turn/completed`.
- **Contention fallback** (`codex.mjs:614-641`): on `rpcCode === -32001` (or `ENOENT`/`ECONNREFUSED` to the broker), close and reconnect with `disableBroker: true` — i.e., degrade from shared daemon to private child. Direct-relevant to baton's slot management.
- **Shutdown**: end stdin, then SIGTERM after 50 ms if still alive (`app-server.mjs:244-263`). Long-op timeout example: 2-minute cap on `externalAgentConfig/import` waiting for the `externalAgentConfig/import/completed` notification (`codex.mjs:52, 700-729`).
- The plugin types only 9 methods (`app-server-protocol.d.ts:59-69`) — a reminder that a useful adapter needs a small verb set: `initialize, thread/start, thread/resume, thread/name/set, thread/list, review/start, turn/start, turn/interrupt` (+ baton adds `turn/steer`, `thread/fork`, `thread/inject_items`, approvals, usage reads).

## Limitations

1. **Whole surface is experimental.** `codex app-server` is flagged `[experimental]` in its own `--help`; the README states the API "is subject to breaking changes." Pin the codex version and regenerate schemas per release ("Each output is specific to the Codex version you ran" — official docs). `generate-ts`/`generate-json-schema` are themselves marked experimental.
2. **Id-less `-32600` errors on unknown methods** (verified live) break request correlation; every RPC needs a client-side timeout. This also means capability-probing by calling a method and catching the error works but leaves no correlatable response.
3. **WebSocket transport**: "experimental and unsupported. Do not rely on it for production workloads" (README). Unix-socket transport carries WebSocket frames, so raw NDJSON clients must go through `codex app-server proxy`.
4. **`thread/rollback` is deprecated** ("will be removed soon") and never reverts files; `item/fileChange/outputDelta` is a deprecated compatibility notification.
5. **`turn/steer` restrictions**: fails without an active turn, requires exact `expectedTurnId`, rejected by review/compaction turns, no overrides — a steer race with turn completion returns an error the adapter must convert into "queue as next `turn/start`".
6. **Experimental gating**: `thread/turns/list`, `thread/items/list`, `thread/search`, `process/*`, `thread/backgroundTerminals/*`, remote-control RPCs, `dynamicTools`, `chatgptAuthTokens` all require `capabilities.experimentalApi: true` and are absent from the exported schema — no generated types for them at 0.144.0.
7. **Contention**: server ingress overload and the plugin broker both answer `-32001`; a shared daemon serializes streaming per the broker pattern only if you deploy that broker — the raw daemon multiplexes connections but per-thread event fan-out to *multiple* subscribers is undocumented (see unknowns).
8. **Docs drift**: `developers.openai.com/codex/app-server` example uses `"sandbox": "workspaceWrite"` at `thread/start`, but the local 0.144.0 schema requires kebab-case `SandboxMode` (`"workspace-write"`); camelCase tags only exist inside `SandboxPolicy.type` at `turn/start`. Local schema wins. The GitHub-README WebFetch summary also returned invented flags (`--websocket`, `--host/--port`, `~/.codex/app-server.sock`) that contradict `codex app-server --help` — only the raw-file quotes above were used.
9. **`tokenBudget`/goal enforcement** rides the `token_budget` feature flag ("under development", default false at 0.144.0) — treat budgets as advisory until verified.
10. **`thread/goal` + `thread/metadata/update`, granular `AskForApproval`, `approvalsReviewer:"auto_review"`** are new and thinly documented; the granular object uses snake_case keys (`sandbox_approval`, `mcp_elicitations`) unlike the rest of the camelCase API.
11. **Known daemon bugs**: pairing can hang "Waiting for desktop" when the remote-control daemon can't reach its proxy ([openai/codex#22851](https://github.com/openai/codex/issues/22851)); half-created threads can make resume/fork fail with thread-store errors ([openai/codex#20944](https://github.com/openai/codex/issues/20944)).

## Open unknowns

- **Multi-subscriber semantics on one daemon**: whether two connections can both receive one thread's notifications after both call `thread/resume` (rejoin), and which connection receives approval server-requests (`approvalsReviewer` routing vs connection affinity). Needs a two-client experiment against `codex app-server daemon`.
- **`turn/steer` exact error code/message** when `expectedTurnId` mismatches or no turn is active (schema documents failure, not the code). Cheap to probe but requires starting a real turn (model quota) — deferred.
- **`thread/inject_items` validation**: which Responses-API item types are accepted/rejected, and whether injection is allowed mid-turn.
- **Unix-socket handshake details** for the control socket (WebSocket upgrade path/URL) — `codex app-server proxy` hides them; direct-socket clients would need codex-rs source (`codex-rs/app-server/src`) reading.
- **`thread/increment_elicitation`/`thread/decrement_elicitation`, `environment/add`, `collaborationMode/list`** — runtime-accepted, zero documentation found anywhere.
- Whether daemon `settings.json` under `$CODEX_HOME/app-server-daemon/` supports pinning `--listen`/auth flags for the managed daemon (README lists the file, not its schema).

## Sources

**Local (outranking)**
- Schema bundle: `/private/tmp/claude-501/-Users-user-Development/73adbbf2-a514-4a17-8729-9cda68da5bac/scratchpad/codex-appserver-schema/` (`ClientRequest.json`, `ServerRequest.json`, `ServerNotification.json`, `ClientNotification.json`, `v1/Initialize*.json`, `v2/*.json`, `ExecCommandApprovalResponse.json`, `CommandExecutionRequestApprovalResponse.json`, etc.)
- Live probes (codex 0.144.0): `/private/tmp/claude-501/-Users-user-Development/73adbbf2-a514-4a17-8729-9cda68da5bac/scratchpad/{init-probe.mjs,err-probe.mjs,list-probe.mjs}` outputs
- CLI help: `codex --help`, `codex app-server --help`, `codex app-server daemon --help`, `codex app-server proxy --help`, `codex remote-control --help`, `codex features list`
- Plugin client: `$HOME/.claude/plugins/cache/openai-codex/codex/1.0.6/scripts/lib/app-server.mjs` (lines 22-42, 96, 136-161, 183-276, 335-354), `broker-lifecycle.mjs` (11-57, 113-171), `broker-endpoint.mjs`, `codex.mjs` (43-90, 380-641, 700-760, 1026-1180), `app-server-protocol.d.ts`, `scripts/app-server-broker.mjs` (12, 146-221)
- Baton context: `$HOME/Development/Experiments/baton/docs/02-harness-control-surfaces.md`, `docs/04-architecture-options.md`

**Web**
- [Codex App Server — official docs](https://developers.openai.com/codex/app-server.md) (served from learn.chatgpt.com/docs/app-server.md)
- [codex-rs/app-server/README.md](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md) (quoted via raw.githubusercontent.com)
- [codex-rs/app-server-daemon/README.md](https://github.com/openai/codex/blob/main/codex-rs/app-server-daemon/README.md)
- [Remote connections — official docs](https://developers.openai.com/codex/remote-connections)
- [openai/codex#22851 — pairing stuck when daemon cannot use proxy](https://github.com/openai/codex/issues/22851)
- [openai/codex#20944 — half-created thread breaks resume/fork](https://github.com/openai/codex/issues/20944)
---

## Live-probe erratum — codex-cli 0.144.0, 2026-07-10

A raw-wire probe of `codex app-server` 0.144.0 (initialize → thread/start → turn/start →
turn/steer wrong/right → turn/interrupt → post-interrupt turn; raw frames preserved in the
session scratchpad `codex-probe-raw.jsonl`) corrects two claims above:

- **Unknown-method `-32600` errors carry the request `id` on 0.144.0** — the "no `id`"
  claim (§Unknown method, and takeaway #2) does not reproduce; the error is fully correlatable.
  Per-request timeouts remain mandatory anyway (a wedged/hung server sends nothing at all).
- **Stale `turn/steer` (wrong `expectedTurnId`) fails with an id-matched `-32600`**,
  message `expected active turn id \`X\` but found \`Y\`` — not a dedicated code.

Confirmed live on 0.144.0, unchanged from this dossier: no-`jsonrpc` framing; `thread/start`
params `{cwd, sandbox, approvalPolicy, ephemeral}` → `result.thread.id`; `turn/start` →
`result.turn.id` + `turn/started`/`item/*`/`thread/tokenUsage/updated`/
`account/rateLimits/updated` notifications; `turn/completed` `turn.status` ∈
`completed|interrupted|failed|inProgress`; mid-turn `turn/steer` (right id) → `{turnId}` and the
turn redirects; `turn/interrupt` → `{}` then `turn/completed{status:'interrupted'}` and the
THREAD SURVIVES for further `turn/start`s. The schema bundle additionally serves
`item/permissions/requestApproval` and `item/tool/call` server→client requests — baton's
adapter must answer (not ignore) any unmapped server request or the turn wedges.
