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

Research, two full review rounds applied. **Honest bottom line after round 2 (see [docs/13](docs/13-revision-log-r2.md)):** baton's defensible, vendor-proof, bitter-lesson-proof core is the **Referee** — a cross-vendor, *independent, hub-run verification* + routing + cross-review layer (a vendor will never grade itself against a competitor; this consumes artifacts so it's ToS-clean; it *is* the "verify" half that compounds as models improve). The **Conductor** — driving and steering a live fleet — is a real but *optional branch*, gated on one eval number, not the headline. The richer paradigm framing in docs 10–12 (three topologies, stigmergy-as-the-bet, the emergence engine) is retained as exploration but was **deflated** by the review: the mechanisms are sound, the grand vocabulary is not load-bearing.

Recommended architecture: a **non-LLM supervisor hub** with MCP tools northbound (so any orchestrator harness reaches it) and per-harness adapters southbound (with **ACP as the default southbound tier**); the supervisor — not the model — enforces liveness, ordering, stopping, and *hub-run verification of every claim a decision trusts*. Grounded in primary-source inspection of the installed CLIs, an external cross-vendor red-team (Codex/GPT-5.x reviewing the design), two judge/red/blue/explore councils, and a focused steering/interruption red-team. **The single highest-priority next action: run the M1 eval (does a supervised cross-vendor fleet beat a single-vendor soloist?) before building anything above the control/verification plane.**

**Design docs** (`docs/`):

| Doc | Contents |
|-----|----------|
| [00-brief](docs/00-brief.md) | Problem statement, expanded research agenda, framing |
| [01-landscape](docs/01-landscape.md) | Cited deep-research report: protocols, control surfaces, prior art, ToS |
| [02-harness-control-surfaces](docs/02-harness-control-surfaces.md) | Per-harness capability matrix (verified against installed binaries) |
| [03-protocol-analysis](docs/03-protocol-analysis.md) | ACP vs A2A vs MCP vs bespoke — the layer model |
| [04-architecture-options](docs/04-architecture-options.md) | Candidate designs, tradeoffs, recommendation |
| [05-telemetry-steering](docs/05-telemetry-steering.md) | Event schema, monitoring, corrected interruption/steering semantics |
| [06-critiques-and-quibbles](docs/06-critiques-and-quibbles.md) | Failure modes, security, the hard problems |
| [07-roadmap](docs/07-roadmap.md) | Build sequence (revised: eval + differentiating demo front-loaded) |
| [08-shared-memory-and-pm](docs/08-shared-memory-and-pm.md) | Three-tempo memory model; project-manager as foil |
| [09-revision-log](docs/09-revision-log.md) | Round-1 review: every finding → disposition → the doc change it forced |
| [10-interaction-model](docs/10-interaction-model.md) | Two channels (comms/steering) + three topologies; *paradigm framing deflated in round 2* |
| [11-capability-plane](docs/11-capability-plane.md) | The seven agent-shaped capability modules (search/debug/evidence/REPL/skills/orient/BoK) |
| [12-context-harness-engineering](docs/12-context-harness-engineering.md) | Context composition, agentic-first tools, interop; *emergence/ensemble claims revised in round 2* |
| [13-revision-log-r2](docs/13-revision-log-r2.md) | Round-2 red/blue/explore: the Referee-not-Conductor reframe + all six REVISE verdicts |

Capability module designs: [docs/capabilities/](docs/capabilities/). Context/harness angle designs: [docs/reference/context-harness/](docs/reference/context-harness/).

**Specs** (`spec/`): [adapter-contract](spec/adapter-contract.md) (verb→real-API mapping per harness), [supervisor-state-machine](spec/supervisor-state-machine.md) (the durable control plane: fencing, cursors, two-phase stop, hub-run verification).

**Reviews** (`reviews/`): [codex-external-review](reviews/codex-external-review.md) (cross-vendor red-team), [steering-interruption-redteam](reviews/steering-interruption-redteam.md) (the subordination-reliability red-team).

**Reference** (`docs/reference/`): implementation-grade dossiers on each harness's real APIs, file formats, and limitations — see its [README](docs/reference/README.md).
