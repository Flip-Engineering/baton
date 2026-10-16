# 04 — Architecture Options

*Candidate shapes for the orchestration layer, with a recommendation. Reads on top of the capability matrix in doc 02.*

## The two boundaries

Every design has a **northbound** boundary (how the *orchestrator agent* — stock Claude Code or Codex running in a terminal — reaches the orchestration layer) and a **southbound** boundary (how the layer reaches worker harnesses). Most of the design tension lives northbound, because of:

## The event-loop problem (the crux)

A CLI agent's turn is synchronous. While the orchestrator model is mid-turn, nothing can push a child's question into its context; between turns, nobody is home unless the harness supports background-task notifications. Workers, meanwhile, emit events continuously and *block on approvals*. Whatever we build must bridge push-shaped workers to a pull-shaped orchestrator. Four honest answers exist:

1. **Poll** (OpenAI's companion choice): background jobs + `status --wait` long-poll + `result`. Simple, portable, works today. Costs orchestrator context per poll and adds latency.
2. **Long-poll-as-push**: a blocking `wait(workers, timeout)` tool call that parks the orchestrator's tool execution until *any* worker event needs attention (question, approval, completion, budget alarm), returning a digest. Push semantics inside pull mechanics. This is the sweet spot — one tool call spans minutes of fleet activity without burning context.
3. **Harness-native notifications**: Claude Code background tasks re-invoke the agent on completion; hooks can inject context at boundaries. Powerful but vendor-specific — an optimization tier, not the foundation.
4. **Own the loop** (inversion): run the orchestrator itself under the Agent SDK inside a wrapper that owns a real event loop and injects child events as messages. Maximum power; but the orchestrator is no longer "the CLI you already run", it's a new app (see Option D).

## Option A — Hub daemon, MCP northbound ("baton hub")

A single local daemon owns the fleet: spawns/attaches worker adapters, ingests all worker events into a ledger, answers/routes approvals, enforces budgets. Northbound it is an **MCP server**, because MCP is the one client capability all three orchestrator harnesses already have (Claude Code, Codex `mcp` config, and Claude-Code-as-GLM). Nothing needs forking.

Sketch of the northbound tool surface (deliberately small):

```
fleet_spawn(harness, cwd|worktree, brief, policy, budget) -> worker_id
fleet_send(worker_id, message, mode=turn|nudge|steer)      -> ack
fleet_wait(worker_ids|any, timeout_s)                      -> [digest events needing attention]
fleet_events(worker_id, cursor, level=digest|full)         -> events page
fleet_approve(request_id, allow|deny|edit, note)
fleet_interrupt(worker_id, then?=message)
fleet_result(worker_id)                                    -> structured result + artifacts
fleet_kill(worker_id) / fleet_list()
```

Southbound: **adapters** (doc 02's matrix made concrete):
- `codex-adapter` → persistent `codex app-server` (or `remote-control` daemon) via JSON-RPC; native steer/inject/fork; approvals surface as server-requests the hub answers per policy.
- `claude-adapter` → child `claude -p --input-format stream-json --output-format stream-json` per worker (SDK-equivalent control frames); the adapter is the tiny daemon Claude Code lacks; `canUseTool`-style approval callbacks route to the hub.
- `glm-adapter` → the claude-adapter with `ANTHROPIC_BASE_URL`/auth env pointed at Z.ai (upgrade path: native Z-code harness adapter if/when it has a surface).
- `acp-adapter` (tier 2) → any ACP-speaking agent (Gemini CLI, claude-code-acp, others) — one adapter, many harnesses, lowest-common-denominator capabilities.
- `pty-adapter` (tier 3, escape hatch) → tmux/PTY scraping for harnesses with no surface. Brittle by construction; exists so the fleet view is total, not so it's good.

State: append-only JSONL event log per worker + SQLite index (doc 05 schema). The hub is also where the **human seat** attaches (TUI/web tailing the same ledger, same control verbs).

**Why this wins:** works in both directions today (Claude→GPT+GLM and GPT→Claude+GLM are the *same hub* with a different MCP client attached); one place for policy/budget/telemetry; adapters isolate vendor churn; the ledger makes everything replayable.

**Costs/risks:** MCP long-running-call semantics need care (timeouts, reconnects, resumability of `fleet_wait`); orchestrator context still pays for digests (mitigated by digest levels); a daemon is a new stateful thing to operate.

## Option B — ACP everywhere

Use Zed's Agent Client Protocol as *the* interface: hub speaks ACP-client to every worker via existing adapters.

Attractive because the adapter ecosystem already exists and the protocol already models sessions, streamed updates, permission requests, and cancellation. But two mismatches: (1) northbound, an orchestrator *agent* cannot be an ACP client from inside its own loop — ACP assumes the client is the embedding program (an editor), so we'd still need Option A's MCP northbound anyway; (2) southbound, ACP is lowest-common-denominator — no `turn/steer`, no `thread/inject_items`, no goal pinning, no usage telemetry — so first-class adapters for Codex/Claude would be *downgrades*. Verdict: **ACP is an adapter tier, not the architecture** (as reflected in Option A).

## Option C — PTY/tmux supervision (claude-squad lineage)

Drive stock interactive TUIs with send-keys; scrape panes for state. Universal, zero vendor cooperation needed, and the human seat is trivially the same tmux session. But: no structured events, no reliable approval interception, steering is "typing at a terminal", state detection is regex archaeology, and every TUI redesign breaks it. Reject as core; retain as the tier-3 escape hatch inside Option A.

## Option D — Own the loop (conductor app)

The orchestrator runs under the Agent SDK inside a wrapper owning a real event loop; worker events are injected as messages; approvals become `canUseTool` recursion. This is the *strongest* runtime — true push, mid-turn wakeups, no polling — and the natural end-state. Two reasons it's not the MVP: it abandons "your normal CLI is the orchestrator" (adoption cost, and the user experience becomes ours to build), and it only solves the Claude-orchestrator direction (a Codex orchestrator would need the same inversion built on app-server). Design Option A so the hub can later *grow* a conductor mode: same ledger, same adapters, different northbound.

## Recommendation

**Option A now, with ACP as a southbound tier (B⊂A), PTY as the escape hatch (C⊂A), and D as the planned second northbound.** Concretely: hub daemon + ledger + policy engine; `fleet_*` MCP tools northbound; codex/claude/glm adapters southbound; `fleet_wait` long-poll as the event-loop bridge; digest-first telemetry.

Two design principles worth stating as law:

1. **Capability negotiation over lowest common denominator.** Each adapter publishes a harness card (supported primitives, doc 02 vocabulary + versions). Control verbs degrade explicitly (`steer` → `interrupt+reprompt` with `emulated: true` in the ack) rather than silently.
2. **Artifacts over chat.** Worker↔orchestrator communication defaults to structured results, commits, diffs, and files in a shared worktree layout — not transcript dumps. The ledger carries *events*; the repo carries *work*. (Doc 05 and 06 develop this.)

## Deployment shapes (same hub, three postures)

- **Sidecar** (MVP): hub on the dev's machine, workers in per-task git worktrees.
- **Foreman**: hub on a box like atari-homelab; orchestrator attaches over SSH/Tailscale; `codex app-server daemon bootstrap` explicitly anticipates SSH-driven use.
- **Mesh** (later, if ever): multiple hubs federating — this is where A2A-style task lifecycle semantics would actually earn their keep (doc 03).
