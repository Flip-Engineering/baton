# 00 — Research Brief

*2026-07-09. Preliminary framing for the baton project.*

## User's initial ask (verbatim intent)

Research, explore, ideate, and quibble on a tool / plugin / skill / MCP server (or other software) enabling **orchestration tooling**: `(Claude→GPT+GLM)` and `(GPT→Claude+GLM)` — an orchestrator agent (Claude Code CLI or Codex CLI) directing **full-session / full-harness** subagents or workers (Codex CLI, Claude Code CLI, or a Z-code GLM 5.2 harness). Possibly via an Agent Communication Protocol implementation with:

- appropriate features and message handling
- telemetry / monitoring
- interruption / steering over the subordinated harnesses

The user explicitly asked for directions, considerations, critiques, and features **beyond** their list — this brief expands the agenda accordingly.

## Why "full-harness" matters (and why this isn't just an API call)

Delegating to Codex CLI instead of the OpenAI API (or Claude Code instead of the Anthropic API) buys things the raw model doesn't have:

1. **The harness IS the product.** Each vendor's CLI carries its own system prompts, tool implementations, sandboxing, context compaction, retry logic, and planning behaviors — tuned by the vendor to make their model perform. A GPT-5.x called via raw API inside a Claude-shaped harness underperforms GPT-5.x inside Codex.
2. **Subscription arbitrage.** Claude Max + ChatGPT Pro/Plus + Z.ai Coding Plan are flat-rate. Full-harness workers ride subscription auth (OAuth device flows), not per-token API billing. A three-vendor fleet on flat-rate plans is an economically different object than an API-billed swarm. (Caveat researched in 06: ToS/rate-limit implications of programmatic subscription use.)
3. **Session continuity.** Harnesses own durable sessions (resume, fork, compaction). A worker that can be re-prompted in its existing session next week is a fundamentally better unit of delegation than a stateless completion.
4. **Vendor-native safety.** Each harness brings its own approval model and sandbox. Orchestration should compose these, not replace them.

## Dimensions of the design space

### D1. Control surface per harness
For each of {Claude Code, Codex CLI, Z-code/GLM harness}: how do you programmatically **spawn** a session, **send** a turn, **stream** events, **interrupt** mid-turn, **steer** (inject guidance without killing the turn), handle **permission requests**, **resume** sessions, and read **usage/cost**? Deliverable: capability matrix (doc 02).

Known entry points to verify and detail:
- Claude Code: Agent SDK (TS/Py) `query()`/`interrupt()`/hooks/canUseTool; `claude -p --input-format stream-json --output-format stream-json`; `claude mcp serve`; the Zed `claude-code-acp` adapter; `--session-id/--resume/--fork-session`; native OTel.
- Codex: `codex app-server` (JSON-RPC: `thread/start`, `turn/start`, `turn/interrupt`, streaming notifications, approval requests — confirmed locally in OpenAI's own Claude Code plugin, which runs a Unix-socket broker in front of a persistent app-server); `codex exec --json`; `codex mcp-server`; `codex exec resume`.
- GLM: Z.ai's Anthropic-compatible endpoint means **Claude Code itself can be the GLM harness** (`ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic`) — one adapter serves two harnesses. Also verify: Z.ai's own CLI ("Z-code"?), GLM 5.2 status, opencode/other harness support.

### D2. Protocol
- **ACP (Agent Client Protocol, Zed)** — JSON-RPC client↔agent: sessions, streamed updates, permission requests, cancellation. Built for editor-as-client; can the *orchestrator* be the client? Adapter ecosystem already exists.
- **A2A (Agent2Agent, Linux Foundation)** — HTTP/JSON-RPC + SSE, AgentCards, task lifecycle states, push notifications. Built for opaque agent federation.
- **ACP (BeeAI/IBM)** — REST-based; verify current status (believed merged into A2A).
- **MCP** — every harness can *be* an MCP server and *call* MCP servers. Hub-as-MCP-server is the only option that plugs into all three harnesses **today** without forking them. Verify MCP tasks/long-running-operation proposals.
- **Bespoke NDJSON/broker** — what OpenAI's plugin actually shipped. When is bespoke right?

Key insight to develop: these aren't competitors — they operate at different layers (harness control vs task federation vs tool access). The design likely *composes* them.

### D3. The orchestrator's event loop (the crux)
A CLI agent's turn is synchronous; it cannot natively "get woken up" by a child's question. Patterns to evaluate:
- Hub-as-MCP-server with blocking calls, polling calls, and (where supported) server-initiated notifications
- Background tasks + harness-native task notifications (Claude Code has these; Codex?)
- Hooks as event injectors
- Running the orchestrator itself under an SDK wrapper that owns a real event loop (inversion: the "orchestrator harness" is itself supervised)
- Human-attachable seats (tmux-style attach to any worker)

### D4. Telemetry & monitoring
Normalized cross-vendor event schema (session/turn/tool-call/edit/tokens/cost/state-change); transcript capture and replay; live dashboard (TUI vs web); OTel export; cost governance and per-worker budgets.

### D5. Interruption & steering semantics
Granularities: kill session / cancel turn / pause-at-next-tool-boundary / inject-message-mid-turn / edit-pending-tool-call / permission-gate-as-steering-point. Which harnesses support which natively; what the hub must emulate; idempotency and race handling (steer arrives as turn completes).

### D6. Context & task engineering (what actually flows)
- Downward: task brief format, repo context, constraints, definition-of-done. Brief-writing is prompt engineering *for a peer harness with different conventions* (Codex prompting ≠ Claude prompting — OpenAI ships a `gpt-5-4-prompting` skill precisely for this).
- Upward: structured results vs transcript dumps; context dilution of the orchestrator; summarize-at-boundary; artifact-passing (diffs, files, commits) over chat-passing.
- Shared substrate: task ledger, worktree-per-worker isolation, merge strategy.

### D7. Safety, security, trust
- Nested permission chains: worker wants `rm -rf` — who approves? Escalation to orchestrator vs human; policy language.
- **Cross-agent prompt injection**: worker output is untrusted input to the orchestrator (and vice versa). A compromised/confused worker can steer the orchestrator.
- Sandbox composition; git identity/attribution per harness; audit trail.

### D8. Failure taxonomy & operations
Harness crash vs model refusal vs quota/rate-limit exhaustion vs sandbox denial vs infinite loop — each needs different retry/reroute policy. Version skew between CLIs; capability feature-detection ("harness card"). Deadlocks (orchestrator awaits child awaiting approval routed nowhere).

### D9. Evaluation
How do you know orchestration helps? Baselines: single-harness solo, harness+its-own-subagents, cross-harness fleet. Cost/time/quality on fixed task sets; ablations (does steering matter? does telemetry matter?).

## Prior art to survey (doc 01)
Zed ACP ecosystem & adapters; OpenAI codex Claude-Code plugin (local copy examined); Anthropic agent teams / subagent infrastructure; claude-squad, tmux-orchestrator, claude-flow, Conductor-style parallel-fleet apps; OpenHands; A2A reference implementations; MCP orchestration servers; anything driving heterogeneous vendor CLIs specifically.

## Non-goals (for now)
- Building a general multi-agent framework (LangGraph/AutoGen class) — those orchestrate *API calls*, not harnesses.
- Distributed/multi-machine operation (design shouldn't preclude it; MVP is one box).
- New model-side capabilities — this is pure harness/protocol engineering.
