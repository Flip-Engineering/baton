# dsh-digest — the DeepSeek Harness repo's ground-truth package (pulled 2026-08-13)

Source: `github.com/deepseek-ai/deepseek-harness` (shallow clone, developer preview — the repo
warns compatibility-breaking changes land constantly; this digest is a dated snapshot). dsh is
an agent harness where **everything is a plugin** on the vendored Cordis framework ("A
Programming Paradigm for Spatiotemporal Composability"). These docs are CURRENT (the repo's own
architecture documentation — unlike the pm digest, no staleness warning applies, but the
preview-churn warning does).

## Files

- `architecture.md` — the top-level map: Cordis contexts/services/inject, profiles/bundles/
  patches composition, the core packages table, the three event domains (session/agent/
  capability), the turn-flow diagram, the session log ("**model-visible means logged**" — a
  runtime invariant), capability seams (Definition/Provider/Consumer), the where-new-behavior-
  goes table.
- `cordis-primer.md` — the framework: plugins as Services, `ctx.<key>` services, `inject`
  dependency declaration, the four event dispatch modes (emit/waterfall/parallel/serial),
  waterfall middleware semantics, reversible effects (`ctx.effect()` disposers).
- `agent-lifecycle.md` — the turn/step lifecycle sequence.
- `capability-seams.md` — the seam catalog (471 lines — the full Definition/Provider/Consumer
  graph; fs/shell/subprocess/LSP/sandbox/subagent seams).
- `tool-execution-pipeline.md` — the guarded tool pipeline (`tools/pre-execute → execute →
  post-execute` waterfalls).
- `event-producer-consumer.md` — the event map (every event's producers and consumers).
- `development.md`, `testing.md`, `AGENTS.md` — the contributor/agent-facing operational docs.
- `subsystems/session.md` — the append-only SessionEvent log; `deriveMessages()` projection;
  fork/resume/transcripts all deriving from the stream.
- `subsystems/core.md` — the Agent interface, the default agent-loop driver, the agent handle
  (cancellation and error recovery).
- `subsystems/tools.md` — the scoped tool registry + guarded execution.
- `subsystems/subagent.md` — subagent providers behind one interface (a fresh child agent → a
  delegated turn in another product).
- `subsystems/scope.md` — the per-agent scoped-registration primitive (`agent.ctx`).
- `subsystems/llm-streaming.md` — the message/stream vocabulary + adapter seam.
