# baton

**Cross-harness agent orchestration research.** Can an orchestrator agent running in one full coding harness (Claude Code CLI, Codex CLI) direct *other* full-session harnesses (Codex CLI, Claude Code CLI, Z.ai GLM harness) as subordinate workers — with real messaging, telemetry, and mid-flight interruption/steering — rather than the flat "spawn a process, wait for stdout" pattern?

The name: a conductor's baton directs an orchestra; a relay baton gets passed between runners. Both are the point.

## The core question

Every CLI coding agent today can *shell out* to another CLI coding agent. That's not orchestration — it's a blocking subprocess with a string result. Orchestration means:

- **Full-harness workers** — the subordinate keeps its own tools, sandbox, permissions, session state, and context management. You're delegating to *Codex-the-product*, not GPT-the-model.
- **Bidirectional messaging** — workers report progress and ask questions; the orchestrator answers without killing the run.
- **Telemetry** — normalized event stream (turns, tool calls, file edits, tokens, cost) across vendors, observable live.
- **Interruption & steering** — pause, redirect, or cancel a worker mid-turn from the orchestrator or from a human seat.
- **Symmetry** — the same machinery works Claude→(GPT+GLM) and GPT→(Claude+GLM). No privileged vendor.

## Status

Preliminary research. See `docs/`:

| Doc | Contents |
|-----|----------|
| [00-brief.md](docs/00-brief.md) | Problem statement, expanded research agenda, framing decisions |
| [01-landscape.md](docs/01-landscape.md) | Deep-research report: protocols, harness control surfaces, prior art (cited) |
| [02-harness-control-surfaces.md](docs/02-harness-control-surfaces.md) | Per-harness capability matrix: spawn/stream/interrupt/steer/resume |
| [03-protocol-analysis.md](docs/03-protocol-analysis.md) | ACP vs A2A vs MCP vs bespoke — what actually fits |
| [04-architecture-options.md](docs/04-architecture-options.md) | Candidate designs with tradeoffs and a recommendation |
| [05-telemetry-steering.md](docs/05-telemetry-steering.md) | Event schema, monitoring, interruption/steering semantics |
| [06-critiques-and-quibbles.md](docs/06-critiques-and-quibbles.md) | Failure modes, security, and the hard problems nobody lists in the pitch |
| [07-roadmap.md](docs/07-roadmap.md) | MVP path and build sequence |
