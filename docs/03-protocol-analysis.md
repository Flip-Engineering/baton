# 03 — Protocol Analysis: ACP vs A2A vs MCP vs Bespoke

*Spec-state claims verified 2026-07-09 against primary sources — see doc 01 for citations and vote counts. The punchline is structural: these protocols occupy different layers, and baton composes them rather than choosing one.*

## The layer model

| Layer | Question it answers | Protocols there |
|---|---|---|
| **L1 — Harness control** | "How does a *program* drive one agent session?" | Zed ACP; Codex app-server protocol; Claude Code stream-json control frames / Agent SDK |
| **L2 — Tool access** | "How does an *agent* call a capability?" | MCP |
| **L3 — Task federation** | "How do opaque agent *services* exchange tasks?" | A2A (IBM/BeeAI ACP merged into it 2025-08-29 and is discontinued — verified) |

The user's phrase "Agent Communication Protocol implementation" gestures at all three. The design resolution from doc 04: **northbound is L2** (the orchestrator is an *agent*, and the one thing every harness's agent can do is call MCP tools), **southbound is L1** (the hub is a *program*, and L1 protocols are how programs drive sessions), and **L3 is deferred** until multiple hubs federate.

## Zed's Agent Client Protocol (L1)

JSON-RPC over stdio between a *client* (historically an editor) and an *agent*. Core flow (all verified against the live spec, doc 01 §1): `initialize` (capability negotiation, versioned) → `session/new` (creates context, connects MCP servers) / `session/load` (history replay) / capability-gated `session/resume` (no replay; stabilized 2026-04-22) → `session/prompt` (whole turn, returns `stopReason`) → streamed `session/update` notifications (messageId-grouped chunks, tool-call lifecycle, plans that evolve mid-run) → `session/request_permission` (server→client, exactly `allow_once/allow_always/reject_once/reject_always`) → `session/cancel` (one-way; agent SHOULD abort tools and MUST answer the prompt with `StopReason::Cancelled`). Adapter ecosystem: 35 registered agents including Zed-org-maintained `claude-agent-acp` (built on the official Claude Agent SDK — cancel→`interrupt()`, `canUseTool`→request_permission) and `codex-acp` (being rewritten on the Codex App Server under the vendor-neutral `agentclientprotocol` org); Gemini CLI speaks it natively (`gemini --acp`).

**Fit assessment:** the *shape* is exactly right — sessions, streaming, approvals-as-requests, cancellation, capability negotiation, and even fork/list/resume (the claude-agent-acp initialize advertises session fork/list/resume). What it still lacks for orchestration, confirmed by the verified schema: mid-turn steering, context injection, usage/rate-limit telemetry, goal pinning, multi-session attach by a shared daemon — and the v2 schema is churning (renamed update variants). i.e., ACP models *one client embedding one agent*, not *one supervisor running five*. Verdict from doc 04 stands: **southbound adapter tier** — one ACP adapter unlocks every ACP-speaking harness at lowest-common-denominator capability, and gaps we hit are candidate upstream contributions (an ACP `steer`/usage extension would benefit the whole ecosystem). One more verified nuance: nobody has yet shipped an orchestrator using ACP as its control plane (doc 01 open question 3) — baton would be first.

## A2A (L3)

HTTP + JSON-RPC + SSE between agent services; v1.0.0 released 2026-03-10 under the Linux Foundation. AgentCards for discovery/capability advertisement; first-class **task lifecycle** — two *interrupted* states (`input-required`, `auth-required`) and four *immutable terminal* states (`completed/failed/canceled/rejected`; terminal tasks cannot restart, refinements are new tasks in the same `contextId`); a clean **message vs artifact** distinction; Subscribe-to-Task stream re-attach; best-effort Cancel; mid-run steering of a `working` task is protocol-permitted but agent-discretionary (MAY) — the guaranteed steering path is `input-required`. BeeAI's ACP merged in (2025-08-29) and is discontinued.

**Fit assessment:** built for cross-org, cross-network trust boundaries a local fleet doesn't have — discovery, auth federation, and opacity are its hard problems, none of which are ours in v1. But steal its *vocabulary* shamelessly: the task state machine is better than anything ad hoc we'd invent (note `input-required` — precisely the "worker blocked on approval/question" state doc 05 sweats over), and message-vs-artifact matches doc 06's artifacts-over-chat position. If hubs ever federate (doc 04 "mesh"), A2A between hubs is the obvious wire; the AgentCard is also the natural serialization of doc 02's "harness card".

## MCP (L2)

Tools, resources, prompts; progress notifications and cancellation on long calls; `sampling` (server borrows the client's model) and `elicitation` (server asks the client's user). Long-running **Tasks** are now an official-but-experimental extension (`io.modelcontextprotocol/tasks`, ext-tasks repo; shipped experimental in core 2025-11-25, moving out in the 2026-07-28 RC): five statuses (`working`, `input_required`, `completed/failed/cancelled` terminal), `tasks/get` polling plus opt-in `notifications/tasks` push, and results identical to what the synchronous call would have returned. **Host support varies by client** — so `fleet_wait` long-polling remains the load-bearing bridge, but `fleet_spawn`/`fleet_send` should be shaped as task-augmentable calls so they become native MCP tasks the day the orchestrator harnesses' clients adopt the extension. The five-status lifecycle maps 1:1 onto the A2A vocabulary above; adopt those names in the internal schema and both futures are cheap. Remaining unknown: timeout/reconnect behavior of each harness's MCP client under a minutes-long blocked tool call — M0's first experiment.

**Fit assessment as northbound:** chosen not because MCP is a great orchestration protocol (it isn't — it's request/response with trimmings) but because it's the **universal socket**: Claude Code, Codex, and Claude-as-GLM all ship MCP clients today, so the hub plugs into every orchestrator without forking any vendor. Three affordances matter more than they look:
- **Progress notifications during a long call** can stream fleet digests *while* `fleet_wait` blocks — push-shaped UX inside a pull-shaped protocol, if (⏳) client rendering cooperates.
- **Elicitation** gives the hub a standards-track path to poke the *human* seat through the orchestrator's own UI.
- **Tool-list change notifications** let the hub grow verbs per capability negotiation without client restarts.

Risks: client-imposed call timeouts (mitigation: resumable wait cursors — `fleet_wait` returns a cursor on timeout, next call resumes; the ledger makes this cheap); MCP client behavior divergence across vendors (conformance-test it, doc 06 Q8).

## Bespoke L1s (the vendors' own control planes)

Codex app-server: typed, versioned, schema-introspectable, daemon-capable, and the richest primitive set observed (doc 02) — the strongest L1 in the field and clearly where OpenAI's own products sit. Claude Code stream-json control frames: per-process but complete where it counts (interrupt, approvals callback, hooks). These aren't protocol competitors to standardize away; they're the *native* southbound targets whose full capability we refuse to squander on a lowest-common-denominator layer (doc 04 principle 1).

## Verdict

```
orchestrator agent (any harness, stock)
        │  MCP  (L2 northbound — universal socket)
   ┌────▼─────────────────────────────┐
   │            baton hub             │  ledger · policy · budgets · digests
   └─┬──────────┬──────────┬─────────┬┘
     │app-server│stream-json│ env-    │ ACP (L1 southbound tiers)
     │ (native) │ /SDK      │ override│  → gemini-cli, others
     ▼          ▼           ▼         ▼
   Codex     Claude Code  Claude-as-GLM  ACP agents        [PTY escape hatch]
```

No new wire protocol (doc 06 Q5). Internal event schema stays private (doc 05). Vocabulary borrowed: A2A task states + artifacts; ACP capability negotiation; app-server's steer/inject/goal primitives as the bar every adapter emulates toward.
