# 02 — Harness Control Surfaces

*What each harness actually exposes for programmatic control. Primary-source evidence from locally installed binaries unless marked otherwise. Verified 2026-07-10 against: Codex CLI **0.144.0**, Claude Code **2.1.206**, and Grok Build CLI **0.1.216**.*

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

`codex app-server` is a JSON-RPC protocol (NDJSON over stdio; experimental WebSocket `--listen ws://…` and Unix-socket transports; officially documented at developers.openai.com/codex/app-server and the interface behind OpenAI's own rich clients). `codex app-server generate-json-schema --out <dir>` emits the full typed schema — an underrated gift: **machine-readable protocol introspection**, so an adapter can feature-detect by schema diff instead of version sniffing. Method inventory extracted from the v2 schema bundle:

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
- **`codex exec --output-schema <FILE>`** — the harness itself enforces a JSON-Schema shape on the final response. Result contracts (doc 06 Q6) get native enforcement on the Codex leg instead of parse-and-retry.
- **`codex features list`** — runtime feature-flag inspection (`--enable/--disable <FEATURE>` per invocation): a second feature-detection channel alongside schema introspection.
- `thread/realtime/*` — voice/realtime channel per thread (out of scope, but shows where this is going).

**Evidence from OpenAI's own Claude Code plugin (installed locally, v1.0.6):** their bridge runs a persistent `app-server` behind a Unix-socket broker (`app-server-broker.mjs`), single-flights requests, and — the telling detail — carves out an exception so `turn/interrupt` is allowed from a *different* client socket while a stream is active. Interruption is treated as a cross-client control-plane right. Orchestrator-side, the companion (`codex-companion.mjs`) is a file-backed job ledger: `task [--background]`, `status --wait` (2s poll), `result`, `cancel`, jobs keyed to the calling Claude session ID. That's their answer to the event-loop problem: **poll, don't push** (see doc 04).

## Claude Code 2.1.206 (locally verified flags; SDK semantics from docs)

No public JSON-RPC schema dump, but three overlapping surfaces:

1. **Headless stream-json**: `claude -p --input-format stream-json --output-format stream-json` — NDJSON turns in, NDJSON events out; `--include-partial-messages` (token-level deltas), `--include-hook-events` (hook lifecycle in the stream — telemetry hook-point), `--replay-user-messages` (echo confirmation). Sessions: `--session-id <uuid>`, `--resume`, `--continue`, `--fork-session`, `--no-session-persistence`, `--name`. Behavior config: `--agents <json>` (inline subagent definitions), `--append-system-prompt`, `--permission-mode {acceptEdits,auto,bypassPermissions,manual,dontAsk,plan}`, `--effort`, `--model`, `--betas`.
2. **Agent SDK (TS/Py)**: wraps the stream-json control protocol — `query()`, `interrupt()` (streaming-input mode only; on CLI ≥2.1.205 returns an interrupt receipt with `still_queued` message UUIDs), `canUseTool` callback (programmatic approval = the approve primitive), and **mid-run reconfiguration**: `setModel()`, `setPermissionMode()`, `applyFlagSettings()` (model, effortLevel, permissions, hooks, skillOverrides, agent — applied next turn). Hooks are a steering surface in their own right: **PreToolUse can allow/deny/ask/defer, rewrite tool inputs (`updatedInput`), and replace tool outputs (`updatedToolOutput`)** — per-tool-call interception stronger than message injection; Notification hooks fire on `permission_prompt`/`idle_prompt`; SubagentStart/Stop expose transcript paths; TS-only events include `TeammateIdle`, `TaskCompleted`, `WorktreeCreate/Remove`. The control protocol rides the same NDJSON channel as `control_request`/`control_response` frames. (Web-verified via doc 01 §4; the `claude-agent-acp` adapter source doubles as the de-facto frame documentation.)
3. **`claude mcp serve`** — Claude Code as an MCP server (harness-as-tool), verified present.
4. **`--bg` / `--background`** — "start the session as a background agent," plus `--from-pr` (sessions linked to PRs). Anthropic is also building the durable-worker substrate natively.

Mapping to the vocabulary:

| Primitive | Claude Code |
|---|---|
| spawn | `claude -p` w/ `--session-id`, cwd = process cwd, `--mcp-config`, `--agents` |
| prompt | NDJSON user message on stdin (stream-json input keeps stdin open — multiple turns per process) |
| stream | stream-json events; `--include-partial-messages` for deltas |
| interrupt | SDK `interrupt()` / control_request frame; SIGINT fallback |
| steer | **native** (corrected by the phase-8 live re-eval, docs/23): a mid-turn user frame on the stream-json channel is absorbed by the running turn at its next tool boundary — no interrupt round-trip needed |
| inject | additional user/system messages between turns; `--append-system-prompt` at spawn; hooks can inject context per-event |
| approve | `canUseTool` callback (SDK); `--permission-mode`; hooks (PreToolUse allow/deny) |
| resume/fork | `--resume/--continue/--fork-session`; transcripts are JSONL on disk (`~/.claude/projects/...`) — replayable |
| usage | result events carry usage; OTel export (`CLAUDE_CODE_ENABLE_TELEMETRY`) with cost/token/tool metrics |
| health | process exit code, `error` events, hook timeouts |

**Key asymmetry vs Codex:** Claude Code's richest control mode (SDK/stream-json) is *per-process* — the controller owns the process's stdio. Codex's app-server is a *daemon* — many clients can attach, pair, and share threads. For fleet supervision the daemon shape is structurally better; Claude Code gets partway there with `--bg` and session resumability. A baton adapter for Claude Code should itself be a small daemon owning N child processes and re-exposing them (which is exactly what OpenAI's broker does for the single-Codex case, and what `opencode` does natively — see below).

## GLM / Z.ai (current model mapping — resolved, doc 01 §5)

There is **no first-party "Z-code" CLI**. Z.ai's GLM Coding Plan officially supports *third-party* harnesses — **Claude Code, Cline, and OpenCode** — configured by `npx @z_ai/coding-helper`. The Anthropic-compatible endpoint is confirmed from official docs: `ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic` + `ANTHROPIC_AUTH_TOKEN`. The current normal Opus/Sonnet aliases map to `glm-4.7`, Haiku maps to `glm-4.5-air`, and `glm-5.1` is an explicit higher-cost route. Baton therefore sends an exact model through the native `--model` flag plus `ANTHROPIC_DEFAULT_*_MODEL`; the adapter version never masquerades as the model identity.

So **Claude Code as the GLM harness is not a hack, it's the vendor's blessed configuration** — the glm-adapter is the claude-adapter with env overrides, exactly as hoped. Two caveats survive:
- Harness/model mismatch can still cost quality (Claude-tuned prompts and tool descriptions driving GLM). OpenCode is the officially-supported alternative harness if the mismatch proves expensive.
- The plan is **contractually locked to supported harnesses** and enforces tier/model-dependent concurrency and quota limits. Baton therefore consumes deployment-configured ceilings rather than encoding mutable plan marketing — see doc 01 §7 and doc 06 Q7.

## Grok Build CLI 0.1.216 — native ACP, shipped by the vendor (added 2026-07-10)

xAI's `grok` is the first flagship vendor CLI whose primary programmatic surface is **ACP itself**: `grok agent stdio` is a standard Agent Client Protocol server (JSON-RPC 2.0, `initialize` → `session/new` → `session/prompt` → streamed `session/update`), extended by a documented catalog of 72 `x.ai/*` methods (fs, git, **git/worktree**, terminal, search, **session/fork**, **rewind/** with on-disk file snapshots, auth, telemetry). No bridge repo, no protocol org adapter — the vendor ships the server. **Live-verified through the full authenticated smoke (2026-07-10)**: cancel conforms (prompt resolves `stopReason:"cancelled"`, session survives), permission requests fire under default config and the allow/deny option flow works, every prompt response carries full **usage `_meta`** (tokens incl. cached/reasoning splits, per turn), mid-turn prompts **queue** (never splice — and cancel kills active+queued together, so steer remains an emulation with mandatory cancel-first ordering), and post-auth the model card is **grok-4.5** (500K ctx) + grok-composer-2.5-fast. The baton adapter (`impl/src/grok-acp.mjs`) passed an 8/8-verdict live E2E driving spawn/approve/steer/interrupt/kill against the real binary. Full dossier with verbatim frames: [reference/grok-build-cli.md](reference/grok-build-cli.md) (post-auth erratum at the tail).

| Primitive | Grok Build |
|---|---|
| spawn | `session/new {cwd, mcpServers}`; resume = `session/load` (capability-advertised live) |
| prompt | `session/prompt` — turn ends when the request resolves (`stopReason`) |
| stream | `session/update`: `agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `plan` + `x.ai/*` push notifications |
| interrupt | `session/cancel` — **live-proven**: prompt resolves `stopReason:"cancelled"` (with usage `_meta`), session survives; `cancelRewind:true` does NOT auto-restore files (client-driven rewind only) |
| steer | **no native steer, live-settled**: a mid-turn `session/prompt` QUEUES (the running turn never sees it) and cancel kills active+queued together — emulation must cancel FIRST, then re-prompt (the adapter's ordering) |
| inject | between turns only (prompt content); `AGENTS.md` / `--rules` at spawn |
| approve | `session/request_permission` **fires under default config (live)** — options verbatim: `always-allow`(allow_always, listed first), `allow-once`, `reject-once`; allow ran the tool; `--always-approve` / runtime `always-approve on\|off` bypasses |
| resume/fork/rollback | `session/load` / `x.ai/session/fork` / **`x.ai/rewind/*` restores actual file snapshots** — the only harness in the fleet with true file-level rollback |
| usage | **live: full usage `_meta` on every prompt response** (`totalTokens/inputTokens/outputTokens/cachedReadTokens/reasoningTokens/modelId`) — richer than expected; `signals.json` + `grok trace` remain the post-hoc sources |
| health | process exit, JSON-RPC errors (`-32000` auth), sandbox-degradation warnings, `agent_error` notification hook |

Notable extras: first-party **shared leader process** (`grok agent leader`, clients attach `--leader` — codex's daemon+broker shape, vendor-shipped), `grok agent serve` (WebSocket multi-client), kernel sandbox profiles (Seatbelt/Landlock, irreversible at startup), `--best-of-n` (parallel N-way attempts, pick best), `--check` (appended self-verification loop), `--prompt-json` content blocks, session store whose `updates.jsonl` **is the ACP stream** (one format for wire and audit), `grok import` (foreign-session migration), and `[model.<id>]` custom **OpenAI-compatible endpoints** (the harness can front non-xAI models). The help text annotates flags with Claude Code equivalents (`--allow` "(Claude Code: --allowedTools)") and reuses Claude's `--permission-mode` enum verbatim — deliberate control-surface mirroring, which lowers adapter cost. Caveats: bundled docs already drift from the binary twice (effort enum, `-r` arg optionality), one-shot `streaming-json` has **no tool-call events**, and ToS/quota posture for programmatic driving is unpublished.

## Also installed here (widens the fleet, sharpens the design)

`opencode`, `crush`, `droid` (Factory), `gemini` (Gemini CLI — speaks ACP natively), `qwen`. Two observations:

- **opencode is client/server by design** and demonstrates nearly every primitive this project wants, natively (verified from `--help`): `opencode serve` (headless server), `attach <url>` (multi-client attach), `acp` (**ships an ACP server mode**), `run` (headless one-shot), `export/import <session>` (session portability as JSON!), `stats` (usage/cost telemetry) — plus multi-provider support (incl. Z.ai/GLM). It's living prior art for "harness as attachable server" and possibly the cheapest *third* harness family to adapt.
- The fleet on one developer laptop is already 7+ harnesses across 5+ vendors. Any design that hardcodes three vendors is dead on arrival; the adapter boundary is the product.

## Capability matrix (summary)

| Primitive | Codex (app-server) | Claude Code (SDK/stream-json) | GLM via Claude Code | Gemini CLI (ACP) | Grok Build (ACP) |
|---|---|---|---|---|---|
| spawn | ✅ native | ✅ native | ✅ (env override) | ✅ session/new | ✅ session/new |
| stream | ✅ rich (deltas, diffs, plans) | ✅ rich | ✅ | ✅ session/update | ✅ session/update + `x.ai/*` notifs |
| interrupt | ✅ `turn/interrupt` | ✅ SDK interrupt | ✅ | ✅ session/cancel | ✅ session/cancel (**live-proven**) |
| steer mid-turn | ✅ **`turn/steer`** | ✅ **native mid-turn user frame** (phase-8 live re-eval; absorbed at next tool boundary) | ✅ same | ❌ (ACP has no steer) | ❌ → emulate (cancel first, then re-prompt; live-proven) |
| inject context | ✅ `thread/inject_items` | ⚠️ between turns | ⚠️ | ❌ | ⚠️ between turns |
| approvals → client | ✅ JSON-RPC requests | ✅ canUseTool | ✅ | ✅ session/request_permission | ✅ session/request_permission (fires under default config; live-proven) |
| resume/fork/rollback | ✅ / ✅ / ✅ | ✅ / ✅ / ❌ | ✅ | ✅ resume (capability-gated) / adapter-dependent / ❌ | ✅ load / ✅ `x.ai/session/fork` / ✅ **`x.ai/rewind/*` w/ file snapshots** |
| goal pinning | ✅ `thread/goal/*` | ❌ (emulate via system prompt) | ❌ | ❌ | ⚠️ `goal` runtime command (live-listed post-auth; unprobed) |
| usage/rate-limit telemetry | ✅ push notifications | ✅ OTel + result events | ⚠️ (Z.ai side unknown) | ❌ (not in ACP) | ✅ **usage `_meta` on every prompt response (live)** |
| daemon / multi-client | ✅ daemon + pairing | ⚠️ per-process (`--bg` emerging) | ⚠️ | ❌ (stdio per client) | ✅ **leader process** + `agent serve` |
| schema introspection | ✅ generate-json-schema | ❌ | ❌ | ✅ (ACP versioned spec) | ⚠️ ACP spec; `x.ai/*` catalog unshipped |

Legend: ✅ native · ⚠️ emulable with adapter work · ❌ absent. (Gemini column reflects the verified ACP spec — doc 01 §1. Grok column **live-verified 2026-07-10 post-auth** — authenticated smoke + adapter E2E, 8/8 verdicts; steer stays emulated because mid-turn prompts QUEUE rather than splice, and cancel kills active+queued together — reference/grok-build-cli.md post-auth erratum. Claude steer upgraded to native per docs/23 phase-8 live re-eval.)

**Design consequence:** the common denominator is poor but the union is rich. A lowest-common-denominator protocol wastes Codex's steering and Claude's hooks; the hub should expose a **capability-negotiated** surface (each adapter publishes a "harness card" of supported primitives, and the orchestrator's tools degrade gracefully — e.g. `steer` falls back to interrupt+reprompt with an explicit `emulated: true` flag in telemetry).

## Baton implementation status (through Phase 51, live)

The matrix above is no longer only adapter research. `ClaudeSessionCli`, `CodexAppServerCli`, and
`GrokAcpCli` are exported through `impl/src/index.mjs` and driven by `createDriver()` in the shipped
reference path. The 2026-07-10 recursive capstone ran all three concurrently on isolated Baton
worktrees, landed native Claude steer, native Codex interrupt, and real Claude/Grok approvals, and
fresh-worktree trust-gated all three completions. Evidence:
`reference/evidence/phase10.1-capstone-2026-07-10/`.

A second live stress ran one Grok adapter at its four-session ceiling. Four distinct PIDs reached
active turns; two interrupts and four kills confirmed; all processes, worktrees, and stress
branches were reaped. Evidence: `reference/evidence/grok-multi-reap-2026-07-10/`.

Phase 11 subsequently wired exact model selection, resume/fork/recovery, token/USD governance,
red→green/coverage/mutation acceptance, independent oracle provenance, fast-forward integration,
and approval-gated publication. Remaining depth is tracked in `25-capability-gap.md`.

Phase 51 now gives every shipped real-child adapter the same closed process vocabulary without
flattening their provider handshakes: coordinator-selected generation and exact PID/group
`lifecycle.process_started`, provider-specific `lifecycle.spawned` readiness, then exact
`lifecycle.process_closed`. Kill confirmation waits for close, group death, and cleanup; forced and
poisoned emergency disposition can be retried; replay and recovery preserve exact correlation
without treating historical PIDs as live. The orchestrator independently selects harness, exact
model, and effort—currently including Codex `gpt-5.6-sol`/low, GLM `glm-4.7`/low, Grok
`grok-4.5`/low, and Grok Build/low—and public web/MCP status exposes only the bounded process
reference. Current recursive evidence honestly records the installed Grok CLI as unauthenticated
before provider readiness while still proving concurrent process start, exact close, and full reap.
