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

## → Read [SYSTEM.md](SYSTEM.md) first

**[SYSTEM.md](SYSTEM.md) is the single authoritative design** — the whole thing synthesized into one correct, plain, feature-complete picture: the fleet driver, its reliable coordinator core, the four core features (direct workers, two-way messaging, telemetry, interrupt/steer), and the supporting features (re-verification, adaptive routing, memory, worker tools, safety), with a build order and an honest feature index. Everything in `docs/` below is the exploration and the depth behind it; [GLOSSARY.md](GLOSSARY.md) decodes any leftover jargon.

## Status

**Full-system pursuit active.** Baton is a runnable dependency-free Node ESM reference
implementation, not a prototype skeleton. The canonical `npm test` in `impl/` is **882/882
green** and lifecycle-owns its temporary fixture root. Its public
`createDriver()` has driven real Claude Code, Codex app-server, and Grok ACP session workers
concurrently on this repository, with mid-turn steer, confirmed interrupt, approvals, isolated git
worktrees, and fresh-worktree trust gates. Live proofs include four concurrent real Grok sessions
that were interrupted/killed and fully reaped, plus exact concurrent `grok-4.5` and
`grok-composer-2.5-fast` routes with provider-observed identity, native session resume, live kill,
idempotent cleanup, and complete process/worktree/runtime/branch reap. Opt-in structured
integration now stages divergent accepted results off-main, wraps an injected Mergiraf-class
resolver, freshly verifies the merge commit, and only then advances main; true data-flow semantic
merge remains a separately measured research bet. The active complete scope,
including AST/CPG/IR/behavior/semantic-merge/e-graph rungs and the deployment-neutral causal
knowledge graph, is preserved in [docs/26](docs/26-full-system-goal.md).

Phase 29 now makes deployment-injected Atlas capabilities real fleet tools through one
Coordinator-owned registry. The same bounded invoke/resume/reverify path is available through the
authenticated web command surface and the twelve-tool MCP inventory; deployment-owned multi-root
contexts cannot override actor, budget, repository root, or cancellation, and capability output
cannot claim verification or merge authority. Phase 30 also live-proves the credentialed GLM leg:
exact `glm-4.7` at native `low` effort was provider-observed, freshly verified, normally killed,
and fully reaped without disclosing the ignored local key. Phase 31 adds Cairn's deterministic,
sealed, content-addressed run scorecard and its atomic Run/Artifact knowledge projection. Phase 32
adds Cartographer/Quartermaster's focused Atlas-epoch orientation and evidence-grounded internal-
reuse floor through the same ACI plane. Phase 33 adds exact-fence addressed orientation push over
the ordinary nudge lane and authenticated web/MCP action. Phase 34 makes immutable-Brief scope
drift trigger a deployment-pinned, exact-epoch, deduplicated and cooldown/turn-bounded addressed
orientation refresh while preserving kill as the default and stop/fence authority as final. Phase
35 makes checkout readiness a typed coordinator prerequisite: failure cannot become an undefined
adapter path, worker turn, provider effect, leaked Git diagnostic, or unreaped runtime/worktree.
Phase 36 adds Quartermaster's fail-closed exact-npm evidence floor over deployment-injected
deps.dev+OSV transport, private raw snapshots, TTL/cache/refresh semantics, conservative policy,
and Atlas import observation without false reachability. Phase 37 adds an exact npm package-lock
v3 CycloneDX SBOM, grounded only in actual installed lockfile state and explicitly separated from
future proposed registry graphs. Phase 38 adds the Coordinator-owned immutable `borrow|build`
decision: fresh dossier/SBOM/effective-tree reverify, content-addressed fleet artifacts, derived
Findings, an observed Decision, `Informed`, CAS `Supersedes`, contamination, exact retry, and real
authenticated web/MCP actor propagation—with no install or merge authority. Phase 39 adds the
Coordinator-owned TTL/advisory recheck: exact-expiry read safety, forced official refresh,
coordinate-wide adverse fencing, atomic Decision/Finding invalidation, causal risk `Affects`
projection, and affected-reader contamination.
Phase 40 adds an exact npm proposed-not-installed graph and actual-to-proposed delta. npm runs only
inside a disposable macOS Seatbelt root with writes confined there and direct network denied; one
supervisor-owned CONNECT proxy admits the configured registry. Exact executable/sandbox identities,
source/proposed digests, process-tree cleanup, and proxy cleanup are receipt-bound and offline-
reverified. The official live npm proof is 11/11. Phase 41 is now specified as exact transitive
advisory projection over separately grounded actual/proposed graphs plus conservative dependency-
path and supported-static-import attention evidence; it cannot claim vulnerable-function
reachability or waive an advisory. Its implementation, additional ecosystems, independent
provenance, and the complete Quartermaster ledger remain pending. The current canonical suite is
**882/882 green**.

**What baton is:** a **fleet driver** — one orchestrator agent that directs full Claude Code / Codex / GLM worker agents across vendors, sending them work, watching them (telemetry), and interrupting and steering them mid-run. That is the product. `Claude → (Codex + GLM)` and `Codex → (Claude + GLM)`.

**Everything else supports the driver, and none of it is dropped:** independent verification (re-running a worker's tests so "done" can be trusted), learned routing (which vendor is good at what), a reliable coordination core (so "interrupt worker 3" always lands), telemetry/replay, and worker tools (search, debug, semantic diff). Earlier docs over-billed the *verification* as the product and demoted the *driving* to optional — doc 19 turns that right-side-up.

**Architecture, plainly:** you drive from your CLI agent (Claude Code or Codex is the orchestrator — it decides); underneath, a small reliable program carries out those decisions and does the bookkeeping (dispatch, making interrupts land, re-checking worker claims, the event log). The AI drives; the plumbing makes the driving safe. Southbound, the product tier uses persistent Claude stream-json, Codex app-server, and Grok ACP sessions; one-shot subprocess adapters remain an explicitly limited fire-and-forget tier. Those basic depth gates, audited ACI invocation, Cairn Rung 0, and Cartographer/Quartermaster's local orientation/reuse plus addressed-push rungs now ship; current pursuit is the remaining capability backlog and contract/live-depth gaps. See [docs/28](docs/28-exhaustive-capability-audit.md).

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
| [14-practitioner-addenda](docs/14-practitioner-addenda.md) | 30 net-new directions/critiques/features in my own voice: agent experience, context/harness craft, operator DX, the subtractive thesis |
| [15-representation-and-computation](docs/15-representation-and-computation.md) | Re-anchor (Conductor is the ask; Referee is its trust spine) + the representation ladder (AST→CPG→IR→e-graph) and beyond-frontier self-ideated ideas (semantic diff/merge, behavioral fingerprint, attestation-overlay) |
| [28-exhaustive-capability-audit](docs/28-exhaustive-capability-audit.md) | Current shipped/partial/pending/retired map; supersedes the Phase-10 matrix for status without deleting any research row |
| [19-north-star-corrected](docs/19-north-star-corrected.md) | The fleet driver is the product; verification/routing/memory support it |
| [22-completeness-audit](docs/22-completeness-audit.md) | The built-not-wired audit that drove phases 8–10 |
| [24-goal-system-completion](docs/24-goal-system-completion.md) | Phase-10 whole-system goal and completion record |
| [25-capability-gap](docs/25-capability-gap.md) | Current researched-versus-shipped inventory and phase-11 boundary |

Capability module designs: [docs/capabilities/](docs/capabilities/). Context/harness angle designs: [docs/reference/context-harness/](docs/reference/context-harness/).

**Specs** (`spec/`): [adapter-contract](spec/adapter-contract.md) (verb→real-API mapping per harness), [supervisor-state-machine](spec/supervisor-state-machine.md) (the durable control plane), and [phase-10.1 reconciliation](spec/phase10.1/spawn-stop-reconciliation.md) (async spawn/stop ownership and the recursive-live safety gate).

**Reviews** (`reviews/`): [codex-external-review](reviews/codex-external-review.md) (cross-vendor red-team), [steering-interruption-redteam](reviews/steering-interruption-redteam.md) (the subordination-reliability red-team).

**Reference** (`docs/reference/`): implementation-grade dossiers plus committed live ledgers. The completed recursive fleet and four-Grok reap runs are under `docs/reference/evidence/`.
