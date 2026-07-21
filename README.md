<div align="center">

<img src=".github/assets/banner.svg" alt="Baton — cross-harness agent orchestration" width="100%"/>

</div>

# baton

**Cross-harness agent orchestration.** Can an orchestrator agent running in one full coding harness (Claude Code CLI, Codex CLI, Kimi Code) direct *other* full-session harnesses (Codex CLI, Claude Code CLI, Z.ai GLM harness, Grok Build) as subordinate workers — with real messaging, telemetry, and mid-flight interruption/steering — rather than the flat "spawn a process, wait for stdout" pattern?

The name: a conductor's baton directs an orchestra; a relay baton gets passed between runners. Both are the point.

## The core question

Every CLI coding agent today can *shell out* to another CLI coding agent. That's not orchestration — it's a blocking subprocess with a string result. Orchestration means:

- **Full-harness workers** — the subordinate keeps its own tools, sandbox, permissions, session state, and context management. You're delegating to *Codex-the-product*, not GPT-the-model.
- **Bidirectional messaging** — workers report progress and ask questions; the orchestrator answers without killing the run.
- **Telemetry** — normalized event stream (turns, tool calls, file edits, tokens, cost) across vendors, observable live.
- **Interruption & steering** — pause, redirect, or cancel a worker mid-turn from the orchestrator or from a human seat.
- **Symmetry** — the same machinery works Claude→(GPT+GLM) and GPT→(Claude+GLM). No privileged vendor.

## What baton is

A run-centric **fleet application** — one orchestrator agent directs full Claude Code / Codex /
Kimi Code / GLM 5.2 / Grok workers across vendors while Baton compiles the objective into approved
work, routes it, watches it, handles attention, verifies it, and closes its resources. The
Coordinator is the safety kernel beneath that application, not the interface every agent should
have to assemble manually. `Claude → (Codex + GLM)` and `Codex → (Claude + GLM)` remain core uses.

**Everything else supports the driver, and none of it is dropped:** independent verification (re-running a worker's tests so "done" can be trusted), learned routing (which vendor is good at what), a reliable coordination core (so "interrupt worker 3" always lands), telemetry/replay, and worker tools (search, debug, semantic diff). Earlier docs over-billed the *verification* as the product and demoted the *driving* to optional — doc 19 turns that right-side-up.

## Status

Baton is a runnable dependency-light Node ESM reference implementation, not a prototype skeleton.
The canonical suite is **2478/2478 green**. The frontier is the closed Baton Program IR (issue
#9): Phases 93a.1–93a.3a (canonical value kernel, control-grammar normalizer, Context
result-schema derivation) are merged; the AX/lifecycle spine (Phases 90–92.x) and the fleet
driver (Phases 1–65) are shipped underneath. Progress ledger: **[docs/PROGRESS.md](docs/PROGRESS.md)**.
Open work: **[issues #2–#12](https://github.com/wahargis/baton/issues)**.

## Architecture, plainly

The ordinary surface is one Run application: concise intent and
deployment profile, visible Plan approval, exact route, one bounded RunView, attention, evidence,
and cleanup. Direct embedding, authenticated Web, the `baton` CLI, MCP, and the browser Run desk
share that command bus. The CLI is a thin authenticated Web client rather than another fleet
controller. `baton serve` now starts the ordinary owner-local resident without a configuration
module: authenticated HTTP runs over an owner-only Unix socket, discovery is published only after
an authenticated card/session/readiness challenge, and signal close revokes and CAS-removes only
the current incarnation. `baton serve CONFIG_MODULE` remains an advanced explicit-network seam. Underneath,
the reliable Coordinator kernel makes dispatch, fencing, verification, replay, and reap exact.
Phase 64 now ships the initial Run bus through direct embedding, authenticated Web, MCP stdio, and
the authenticated browser desk: start, status, distinct approval, bounded wait, answer, and
server-fenced steering all return one RunView. Phase 90 adds Pythonic and CLI
`run.send` / `run.interrupt` through the same semantic `run.act` authority: the caller names
`work` or a Workflow role while Baton derives the exact worker, task, fence, and role generation.
Each control moves durably through admitted, effect-started, provider-acknowledged, and settled
states, so restart either executes a still-safe admission, settles an acknowledgement without
redelivery, or exposes an explicit unknown outcome. Routine CLI results are compact outlines;
`run show` expands explicitly through index, section, item, Context content, and evidence instead
of printing budgets, ceilings, coordinates, and every lifecycle chapter after each action.
The execution chapter also exposes stable progress, normalized event, and opt-in provider-output
content. `run.progress()`, `run.events()`, `run.output()` and `baton run
progress|events|output` consume opaque resume, page, and wait policy internally. Events contain
safe Run-scoped facts; output is explicitly labeled untrusted; neither default projection exposes
worker/task/fence/process coordinates or deployment ceilings.
Durable `run.stop` fences further Run effects,
reaps that Run's exact workers, survives restart, and leaves other Runs and the Baton host live.
Accepted verification now pins its exact commit before disposable branch cleanup. `run.evidence`
returns a bounded stable manifest, while policy-gated `run.adopt` durably selects that result
without merging, changing the checkout, or publishing; both are first-class in Web, MCP, and the
browser Run desk. Adoption deliberately leaves semantic state unverified and cannot relabel the
Run complete. RunView and the desk also expose one progress board spanning Plan, dispatch,
provider identity, verification, semantic state, result selection, and cleanup, so ordinary
operation no longer requires correlating receipts or process tables.
Phase 65 adds the missing trust-to-effect continuation to that same surface. `run.review` launches
one deployment-pinned exact independent reviewer, validates a closed JSON report against immutable
Git source ranges and accepted artifact/Representation evidence, preserves disagreement and
uncertainty, and reaps the reviewer. `run.integrate` separately requires a fresh displayed evidence
digest, policy-required result adoption and semantic approval, then delegates one local `ff-only`
or structured transaction to the Coordinator. Web, MCP, CLI, and the browser Run desk expose the
same commands; none push, publish, or deploy. Restart reconstruction, report forgery/scope
smuggling, review/stop races, stale evidence, dirty checkout, and non-fast-forward refusal are
covered by executable contracts. Historical dogfood evidence used older GLM routes, but those are
not current routing recommendations. Baton now restricts GLM work to `glm-5.2`, with effort chosen
explicitly by the orchestrator instead of inherited from a blanket low-effort default.
MCP EOF/signals separately invoke the host-only exact deployment shutdown path. The `baton` CLI
ships `doctor`, start, status/wait, approve, answer, semantic send/interrupt, advanced steer,
progressive show, Run progress/events/output, stop, evidence, and evidence-bound
adopt, semantic review, evidence-bound integration, typed feedback, Candidate selection,
approval-gated revision, and role-addressed member stop through repository discovery. The
`BATON_URL`, `BATON_ORIGIN`, `BATON_REPO_ID`, and `BATON_TOKEN` tuple remains a compatibility
override; credentials are never command arguments. See [impl/CLI.md](impl/CLI.md).
The first issue-10 P0 product vertical adds `review(objective, {routes})` and `baton review` as a
two-exact-route reviewer/challenger preset over the existing Workflow authority. Connected clients
also expose sanitized deployment doctor and exact-route readiness, while authenticated outline
and list projections omit actions outside the principal's capabilities before display or drive.
Cursor follow, materialized result export, exact recovery, and the bounded parallel Workflow plus
one-round revision vertical now ship; deeper multi-round/strategy composition remains active. Southbound, the product tier
uses persistent Claude stream-json, Codex app-server, and Grok ACP sessions; one-shot subprocess
adapters remain an explicitly limited fire-and-forget tier. All retained Goal/Plan, causal graph,
Vantage, Evidence Ladder, Scratch, Skill Forge, Atlas AST/CST/SCIP/CPG/IR, semantic merge,
behavioral fingerprint, evaluation, and later capability scope remains in [docs/28](docs/28-exhaustive-capability-audit.md).
Homelab integration is excluded.

## Run it

Requires Node ≥ 20. The only runtime dependency is `@ast-grep/napi`.

```bash
cd impl && npm ci        # install
npm test                 # canonical suite (currently 2478/2478 green)
node scripts/baton.mjs serve                              # start the owner-local resident
node scripts/baton.mjs doctor --check                     # connection + exact-route readiness
node scripts/baton.mjs review "attack the settlement-domain rule" \
  --exact glm/glm-5.2@xhigh --exact kimi-code/kimi-code/k3@high
```

The resident publishes discovery to `.git/baton/connection.json`; the CLI and MCP clients find it
through repository discovery. `openBaton({ repo, advanced })` from `impl/src/index.mjs` is the
direct-embedding path used by the evidence drivers under `docs/reference/evidence/`.

## → Read [SYSTEM.md](SYSTEM.md) first

**[SYSTEM.md](SYSTEM.md) is the concise architecture overview.**
[docs/PROGRESS.md](docs/PROGRESS.md) is the per-phase progress ledger;
[docs/26](docs/26-full-system-goal.md) is the retained full-system goal and scope ledger;
[docs/28](docs/28-exhaustive-capability-audit.md) is the shipped/partial/pending status audit.
[GLOSSARY.md](GLOSSARY.md) decodes any leftover jargon.

## Design docs (`docs/`)

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
| [PROGRESS](docs/PROGRESS.md) | Per-phase progress ledger (the status narrative, kept current) |
| [31-wave-driver-ax](docs/31-wave-driver-ax.md) | The Wave surface: first-class orchestration drivers (failure-mode-baked semantics) |
| [32-reflexive-orchestration](docs/32-reflexive-orchestration.md) | Reflexive layer: typed decision channels, task boards, knowledge hand-off objects, REPL objects |
| [28-exhaustive-capability-audit](docs/28-exhaustive-capability-audit.md) | Current shipped/partial/pending/retired map; supersedes the Phase-10 matrix for status without deleting any research row |
| [19-north-star-corrected](docs/19-north-star-corrected.md) | The fleet driver is the product; verification/routing/memory support it |
| [22-completeness-audit](docs/22-completeness-audit.md) | The built-not-wired audit that drove phases 8–10 |
| [24-goal-system-completion](docs/24-goal-system-completion.md) | Phase-10 whole-system goal and completion record |
| [25-capability-gap](docs/25-capability-gap.md) | Current researched-versus-shipped inventory and phase-11 boundary |
| [30-objective-review-and-route-readiness](docs/30-objective-review-and-route-readiness.md) | Issue-10 P0 objective review preset, capability-aware actions, connected doctor, and exact-route readiness |

Capability module designs: [docs/capabilities/](docs/capabilities/). Context/harness angle designs: [docs/reference/context-harness/](docs/reference/context-harness/).

**Specs** (`spec/`): [adapter-contract](spec/adapter-contract.md) (verb→real-API mapping per harness), [supervisor-state-machine](spec/supervisor-state-machine.md) (the durable control plane), [phase-93 closed Program IR](spec/phase93-closed-program-ir.md) (the Program v1 contract, built in slices), and [phase-10.1 reconciliation](spec/phase10.1/spawn-stop-reconciliation.md) (async spawn/stop ownership and the recursive-live safety gate).

**Reviews** (`reviews/`): [codex-external-review](reviews/codex-external-review.md) (cross-vendor red-team), [steering-interruption-redteam](reviews/steering-interruption-redteam.md) (the subordination-reliability red-team).

**Reference** (`docs/reference/`): implementation-grade dossiers plus committed live ledgers. The completed recursive fleet and four-Grok reap runs are under `docs/reference/evidence/`.
