# 02 — Harness Control Surfaces

*What each harness actually exposes for programmatic control. Primary-source evidence from locally installed binaries unless marked otherwise. Verified 2026-07-09 against: Codex CLI **0.144.0**, Claude Code **2.1.205**.*

## The capability vocabulary

To orchestrate a full harness you need, at minimum:

| Primitive | Meaning |
|---|---|
| **spawn** | Create a fresh session/thread with cwd, model, sandbox, config |
| **prompt** | Start a turn with content |
| **stream** | Receive incremental events (messages, tool calls, diffs, reasoning) |
| **interrupt** | Cancel the in-flight turn, keep the session |
| **steer** | Redirect the in-flight turn *without* cancelling it |
| **inject** | Add context items to the session between/during turns |
| **approve** | Receive and answer the worker's permission requests |
| **resume/fork** | Reattach to or branch a durable session |
| **usage** | Read token/cost/rate-limit telemetry |
| **health** | Detect crash / hang / quota states |

## Codex CLI 0.144.0 — the richest surface (locally verified)

`codex app-server` is a JSON-RPC (stdio or daemon socket) protocol; `codex app-server generate-json-schema --out <dir>` emits the full typed schema — an underrated gift: **machine-readable protocol introspection**, so an adapter can feature-detect by schema diff instead of version sniffing. Method inventory extracted from the v2 schema bundle:

| Primitive | Codex method(s) |
|---|---|
| spawn | `thread/start` (cwd, config overrides via `-c`) |
| prompt | `turn/start` |
| stream | notifications: `item/started`, `item/completed`, `item/agentMessage/delta`, `item/reasoning/*Delta`, `item/commandExecution/outputDelta`, `item/fileChange/patchUpdated`, `item/plan/delta`, `turn/plan/updated`, `turn/diff/updated`, `turn/started`, `turn/completed` |
| interrupt | `turn/interrupt` |
| **steer** | **`turn/steer`** — native mid-turn steering exists |
| inject | `thread/inject_items` |
| approve | server→client requests: `execCommandApproval`, `applyPatchApproval`, `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval`, `item/tool/requestUserInput`, `mcpServer/elicitation/request` — **the JSON-RPC client is the approver of record** |
| resume/fork | `thread/resume`, `thread/fork`, `thread/rollback`, `thread/list`, `thread/archive` |
| usage | `thread/tokenUsage/updated` (notif), `account/usage/read`, `account/rateLimits/read` + `account/rateLimits/updated` |
| health | `error`, `warning`, `process/exited`, `model/rerouted`, `thread/status/changed`, `guardianWarning` |

Beyond the minimum vocabulary, notable extras:

- **`thread/goal/set` / `goal/get` / `goal/clear`** — first-class goal state on a thread. An orchestrator can pin the definition-of-done outside the chat transcript.
- **`command/exec` + `write` / `resize` / `terminate`** — full remote PTY control inside the worker's sandbox.
- **`codex remote-control start|stop|pair`** — daemon with short-lived pairing codes; `codex app-server daemon bootstrap` explicitly targets "durable local app-server management for SSH-driven use". OpenAI is building the remote-supervision substrate themselves.
- **`externalAgentConfig/detect` / `import` (+ `readHistories`)** — Codex imports config *and session histories* from other agents' installations. Cross-harness session migration is already on their roadmap in some form.
- **`codex exec --json`** and **`codex exec-server`** — headless one-shot and a standalone exec service; `codex mcp-server` — Codex as an MCP server (harness-as-tool).
- `thread/realtime/*` — voice/realtime channel per thread (out of scope, but shows where this is going).

**Evidence from OpenAI's own Claude Code plugin (installed locally, v1.0.6):** their bridge runs a persistent `app-server` behind a Unix-socket broker (`app-server-broker.mjs`), single-flights requests, and — the telling detail — carves out an exception so `turn/interrupt` is allowed from a *different* client socket while a stream is active. Interruption is treated as a cross-client control-plane right. Orchestrator-side, the companion (`codex-companion.mjs`) is a file-backed job ledger: `task [--background]`, `status --wait` (2s poll), `result`, `cancel`, jobs keyed to the calling Claude session ID. That's their answer to the event-loop problem: **poll, don't push** (see doc 04).

## Claude Code 2.1.205 (locally verified flags; SDK semantics from docs)

No public JSON-RPC schema dump, but three overlapping surfaces:

1. **Headless stream-json**: `claude -p --input-format stream-json --output-format stream-json` — NDJSON turns in, NDJSON events out; `--include-partial-messages` (token-level deltas), `--include-hook-events` (hook lifecycle in the stream — telemetry hook-point), `--replay-user-messages` (echo confirmation). Sessions: `--session-id <uuid>`, `--resume`, `--continue`, `--fork-session`, `--no-session-persistence`, `--name`. Behavior config: `--agents <json>` (inline subagent definitions), `--append-system-prompt`, `--permission-mode {acceptEdits,auto,bypassPermissions,manual,dontAsk,plan}`, `--effort`, `--model`, `--betas`.
2. **Agent SDK (TS/Py)**: wraps the stream-json control protocol — `query()`, `interrupt()`, `canUseTool` callback (programmatic approval = the approve primitive), hooks, `setPermissionMode`/`setModel` at runtime. The control protocol rides the same NDJSON channel as `control_request`/`control_response` frames. *(Semantics known pre-cutoff; exact current frame set to be confirmed in doc 01 landscape.)*
3. **`claude mcp serve`** — Claude Code as an MCP server (harness-as-tool), verified present.
4. **`--bg` / `--background`** — "start the session as a background agent," plus `--from-pr` (sessions linked to PRs). Anthropic is also building the durable-worker substrate natively.

Mapping to the vocabulary:

| Primitive | Claude Code |
|---|---|
| spawn | `claude -p` w/ `--session-id`, cwd = process cwd, `--mcp-config`, `--agents` |
| prompt | NDJSON user message on stdin (stream-json input keeps stdin open — multiple turns per process) |
| stream | stream-json events; `--include-partial-messages` for deltas |
| interrupt | SDK `interrupt()` / control_request frame; SIGINT fallback |
| steer | **no native `turn/steer` equivalent** — emulate: interrupt → inject steering message → continue; or queue message for next tool-boundary via hook |
| inject | additional user/system messages between turns; `--append-system-prompt` at spawn; hooks can inject context per-event |
| approve | `canUseTool` callback (SDK); `--permission-mode`; hooks (PreToolUse allow/deny) |
| resume/fork | `--resume/--continue/--fork-session`; transcripts are JSONL on disk (`~/.claude/projects/...`) — replayable |
| usage | result events carry usage; OTel export (`CLAUDE_CODE_ENABLE_TELEMETRY`) with cost/token/tool metrics |
| health | process exit code, `error` events, hook timeouts |

**Key asymmetry vs Codex:** Claude Code's richest control mode (SDK/stream-json) is *per-process* — the controller owns the process's stdio. Codex's app-server is a *daemon* — many clients can attach, pair, and share threads. For fleet supervision the daemon shape is structurally better; Claude Code gets partway there with `--bg` and session resumability. A baton adapter for Claude Code should itself be a small daemon owning N child processes and re-exposing them (which is exactly what OpenAI's broker does for the single-Codex case, and what `opencode` does natively — see below).

## GLM / Z.ai ("Z-code", GLM 5.x)

No native Z.ai CLI found on this machine; status of "Z-code" and GLM 5.2 pending web verification (doc 01). What is already load-bearing:

- Z.ai ships an **Anthropic-compatible API endpoint** for its coding plan (`ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic` pattern, pre-cutoff knowledge). Consequence: **Claude Code itself is a perfectly good GLM harness** — `ANTHROPIC_BASE_URL=… ANTHROPIC_AUTH_TOKEN=… claude -p …` gives the GLM leg the *entire* Claude Code control surface above, one adapter for two legs.
- Caveat to research: harness/model mismatch — Claude Code's prompts and tool descriptions are tuned for Claude; GLM-in-Claude-harness is *not* GLM at its best (the same "harness IS the product" argument from the brief cuts against this shortcut). If a first-party Z.ai harness with a programmatic surface exists, it's preferable; the Claude-Code-as-GLM-harness path is the pragmatic MVP fallback.

## Also installed here (widens the fleet, sharpens the design)

`opencode`, `crush`, `droid` (Factory), `gemini` (Gemini CLI — speaks ACP natively), `qwen`. Two observations:

- **opencode is client/server by design** with an HTTP API and multi-provider support (incl. Z.ai/GLM) — it's prior art for "harness as attachable server" and possibly the cheapest *third* harness family to adapt.
- The fleet on one developer laptop is already 7+ harnesses across 5+ vendors. Any design that hardcodes three vendors is dead on arrival; the adapter boundary is the product.

## Capability matrix (summary)

| Primitive | Codex (app-server) | Claude Code (SDK/stream-json) | GLM via Claude Code | Gemini CLI (ACP) |
|---|---|---|---|---|
| spawn | ✅ native | ✅ native | ✅ (env override) | ✅ session/new |
| stream | ✅ rich (deltas, diffs, plans) | ✅ rich | ✅ | ✅ session/update |
| interrupt | ✅ `turn/interrupt` | ✅ SDK interrupt | ✅ | ✅ session/cancel |
| steer mid-turn | ✅ **`turn/steer`** | ⚠️ emulate | ⚠️ emulate | ❓ verify |
| inject context | ✅ `thread/inject_items` | ⚠️ between turns | ⚠️ | ❓ |
| approvals → client | ✅ JSON-RPC requests | ✅ canUseTool | ✅ | ✅ permission requests |
| resume/fork/rollback | ✅ / ✅ / ✅ | ✅ / ✅ / ❌ | ✅ | ❓ |
| goal pinning | ✅ `thread/goal/*` | ❌ (emulate via system prompt) | ❌ | ❌ |
| usage/rate-limit telemetry | ✅ push notifications | ✅ OTel + result events | ⚠️ (Z.ai side unknown) | ❓ |
| daemon / multi-client | ✅ daemon + pairing | ⚠️ per-process (`--bg` emerging) | ⚠️ | ❌ (stdio per client) |
| schema introspection | ✅ generate-json-schema | ❌ | ❌ | ✅ (ACP versioned spec) |

Legend: ✅ native · ⚠️ emulable with adapter work · ❌ absent · ❓ pending doc-01 verification.

**Design consequence:** the common denominator is poor but the union is rich. A lowest-common-denominator protocol wastes Codex's steering and Claude's hooks; the hub should expose a **capability-negotiated** surface (each adapter publishes a "harness card" of supported primitives, and the orchestrator's tools degrade gracefully — e.g. `steer` falls back to interrupt+reprompt with an explicit `emulated: true` flag in telemetry).
