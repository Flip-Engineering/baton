# 03 — Protocol Analysis: ACP vs A2A vs MCP vs Bespoke

*Draft pending doc-01 verification of current spec states; claims marked ⏳ are being verified against live sources. The punchline is structural and unlikely to move: these protocols occupy different layers, and baton composes them rather than choosing one.*

## The layer model

| Layer | Question it answers | Protocols there |
|---|---|---|
| **L1 — Harness control** | "How does a *program* drive one agent session?" | Zed ACP; Codex app-server protocol; Claude Code stream-json control frames / Agent SDK |
| **L2 — Tool access** | "How does an *agent* call a capability?" | MCP |
| **L3 — Task federation** | "How do opaque agent *services* exchange tasks?" | A2A (with IBM/BeeAI ACP folded in ⏳) |

The user's phrase "Agent Communication Protocol implementation" gestures at all three. The design resolution from doc 04: **northbound is L2** (the orchestrator is an *agent*, and the one thing every harness's agent can do is call MCP tools), **southbound is L1** (the hub is a *program*, and L1 protocols are how programs drive sessions), and **L3 is deferred** until multiple hubs federate.

## Zed's Agent Client Protocol (L1)

JSON-RPC over stdio between a *client* (historically an editor) and an *agent*. Core flow: `initialize` (capability negotiation, versioned) → `session/new` → `session/prompt` → streamed `session/update` notifications (message chunks, tool-call lifecycle, plan updates) → `session/request_permission` (server→client approval request) → `session/cancel`. ⏳ Current adapter set (claude-code-acp, Gemini CLI native, Codex-ACP status, marketplace of others) and any spec growth (modes, terminal embedding, session persistence semantics).

**Fit assessment:** the *shape* is exactly right — sessions, streaming, approvals-as-requests, cancellation, capability negotiation. What it lacked for orchestration (⏳ re-verify): mid-turn steering, context injection, usage/rate-limit telemetry, goal pinning, fork/rollback, multi-session attach by a shared daemon. i.e., ACP models *one client embedding one agent*, not *one supervisor running five*. Verdict from doc 04 stands: **southbound adapter tier** — one ACP adapter unlocks every ACP-speaking harness at lowest-common-denominator capability, and gaps we hit are candidate upstream contributions (an ACP `steer`/usage extension would benefit the whole ecosystem).

## A2A (L3)

HTTP + JSON-RPC + SSE between agent services. AgentCards for discovery/capability advertisement; first-class **task lifecycle** (`submitted → working → input-required → completed | failed | canceled`); a clean **message vs artifact** distinction; webhook push notifications. ⏳ Governance state under Linux Foundation and the BeeAI-ACP merge.

**Fit assessment:** built for cross-org, cross-network trust boundaries a local fleet doesn't have — discovery, auth federation, and opacity are its hard problems, none of which are ours in v1. But steal its *vocabulary* shamelessly: the task state machine is better than anything ad hoc we'd invent (note `input-required` — precisely the "worker blocked on approval/question" state doc 05 sweats over), and message-vs-artifact matches doc 06's artifacts-over-chat position. If hubs ever federate (doc 04 "mesh"), A2A between hubs is the obvious wire; the AgentCard is also the natural serialization of doc 02's "harness card".

## MCP (L2)

Tools, resources, prompts; progress notifications and cancellation on long calls; `sampling` (server borrows the client's model) and `elicitation` (server asks the client's user). ⏳ Status of long-running "tasks" work in the spec (SEP-scale changes), current timeout/reconnect semantics across the three harnesses' MCP clients — this is the load-bearing unknown for `fleet_wait`.

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
