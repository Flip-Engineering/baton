# 10 — The Interaction Model (beyond HCI)

> **Review round 2 caveat (doc 13 T2/T5).** The red/blue/explore pass ruled that this doc's grand vocabulary — "beyond HCI," "three topologies," "stigmergy as the bet," the O(N) leverage claim — is *retrofitted framing over sound mechanisms*, and should be **CUT as load-bearing pitch**. What survives as engineering law: **two channels never fused** (§1 → no `fleet_chat`) and **type every token by provenance** (see doc 12). The T3 "stigmergy" mechanisms are real but are honestly a **small-N hub-mediated coordination service** (etcd/Bazel/Consul lineage), not leaderless stigmergy; the true, narrow win is *keeping untrusted worker prose out of the orchestrator's scarce context* + *"the medium is the record" auditability*, not O(N) scaling (the fleet is capped at handfuls per vendor by concurrency ceilings, so O(N²) never bites). Read the two channels below as the load-bearing content; read the topology framing as exploration the review deflated. The project's honest center of gravity is the **Referee** (doc 13 T5), not this doc's Conductor paradigm.

*The architectural centerpiece: what kinds of interaction baton actually mediates, and why the orchestration-direction layer is built from two channels with opposite properties plus a coordination substrate that replaces most direct messaging. This doc reframes docs 04/05 and sets the frame every capability module (doc 11+) plugs into.*

## 0. The thesis in one paragraph

The interfaces of software were designed for **human-computer interaction** — GUIs, pixels, prose, human-paced approval clicks, modules sized to fit a person's head. Baton coordinates *agents*, so it is built from three interaction topologies that HCI doesn't have names for: **agent-computer interaction** (an agent wielding tools — the capability plane), **agent-agent interaction** (orchestrator directing worker — the control plane), and **agent-infrastructure-agent interaction** (agents coordinating *through shared substrate they modify*, not by talking — the knowledge plane). The design bets that the third — **stigmergic** coordination through structured shared media — is where the leverage is, and that direct agent-agent messaging should be *rare, narrow, and expensive-by-default*. Within the messaging that remains, baton separates two channels that are usually (disastrously) fused: **communication** (bidirectional, negotiated, content-bearing, rides the data plane) and **steering** (unidirectional, imposed, control-bearing, rides the control plane). Getting those two channels' properties right is what makes "steer and interrupt a subordinate harness" reliable (docs 05/09, the red-team).

## 1. Two channels, opposite properties

The single most important distinction in the orchestration-direction layer, and the one the user's framing ("bi-directional communication / unidirectional interruptive interactivity and steering") names exactly:

| | **Communication channel** | **Steering channel** |
|---|---|---|
| Directionality | **bidirectional** — worker↔orchestrator, either may initiate | **unidirectional** — orchestrator→worker only (and human→anyone); a worker cannot steer *up* |
| Nature | negotiated, cooperative, content-bearing | imposed, preemptive, control-bearing |
| Timing | respects turn boundaries; delivered when the recipient is ready | preempts; does not wait for a turn boundary |
| Plane it rides | **data plane** — outbox, ledger, turn boundaries | **control plane** — supervisor, fencing, priority lane |
| Consistency model | ordered, durable, replayable, eventually-consistent | immediate-ish, fenced, at-least-once, never queued behind data |
| Examples | brief, `ask`/question, answer, result, digest, nudge(`at=next_turn`) | interrupt, steer, pause/freeze, kill, nudge(`at=tool_boundary`), approval-deny-and-interrupt |
| Failure if starved | staleness (recipient acts on old info) | **loss of control** (worker unstoppable) — categorically worse |

This is the **in-band / out-of-band** split from telephony and networking, applied to agents. Voice rides the bearer channel; SS7 signaling rides its own out-of-band channel so a hung-up call can always be torn down even if the audio path is jammed. Unix does the same: data flows through pipes, but `SIGINT` is a separate, preemptive channel so you can always `Ctrl-C` a process drowning in its own output. **Baton's steering channel is SIGINT for agents**, and the red-team confirmed why it must be its own channel: an interrupt stuck behind a flood of the worker's output deltas (data plane) is the "false stall / unstoppable worker" failure. The supervisor's priority lane (spec §4) *is* the out-of-band channel; conflating steering into the comms stream re-creates every liveness bug.

### 1a. The asymmetry of interruption is deliberate authority

Communication is bidirectional, but **interruption only flows down a preemption hierarchy: `human > orchestrator > worker`.** A worker that needs its orchestrator cannot *interrupt* it — it raises its hand on the communication channel (`ask` → a `question` wait-item) and the orchestrator processes it at *its* boundary. This is not a limitation to fix; it's the authority gradient that keeps the system legible. If workers could preempt their orchestrator, "who is in charge" would be a race. The fence (spec I1) encodes this: a higher-authority actor's op carries a higher fence and wins; interruption authority and fence precedence are the same mechanism. The human sits above the orchestrator precisely so a human can always seize a worker the orchestrator has lost control of — the takeover seat (doc 05 §7) is the top of the preemption hierarchy.

### 1b. Why fusing them is the original sin

A single `fleet_chat(worker, msg)` verb that can also "urgently redirect" is the seductive mistake. It forces one channel to serve both a durable, ordered, turn-respecting purpose *and* a preemptive, jump-the-queue purpose — and it can satisfy neither. Every real system that got this right (telephony, TCP urgent data, OS signals, even air-traffic control's separate emergency frequency) keeps them physically separate. Baton has **no `fleet_chat`**; it has `fleet_send(mode=nudge|steer)` on the appropriately-planed channel and `fleet_respond`/`ask` for negotiated content, and the mode determines which channel and thus which guarantees apply.

## 2. Three interaction topologies (the paradigm reframe)

Moving "beyond human-computer interaction and modular architectures" means naming the interactions that replace them.

### T1. Agent-Computer Interaction (ACI) — the capability plane
The agent wields the computer: reads files, searches code, runs a debugger, invokes a proof checker, drives a browser. HCI optimizes these interfaces for *human perception* (pixels, spatial layout, prose, click-to-approve). ACI must optimize for *agent cognition*: **structured token-bounded outputs, addressable and resumable operations, no pixels when structure will do, and results that are themselves data the fleet can store and reason over.** (This is a real, named idea — the "Agent-Computer Interface" from the SWE-agent line of work: agents perform dramatically better when tools are redesigned *for them* rather than reused from human tooling.) The entire capability plane (doc 11: discovery/search, debugging, validation/proof, orientation, computer-use, skills) is ACI design: for each human tool, the question is not "expose it" but "what is its agent-shaped form." A debugger's agent-form is not a REPL transcript; it is a structured causal observation. A file finder's agent-form is not a scrolling list; it is a ranked, token-budgeted, semantically-typed result set. This reframing is why the capability modules are *modules baton designs*, not tools baton installs.

### T2. Agent-Agent Interaction (AAI) — the control plane + narrow comms
Orchestrator↔worker (and, discouraged, worker↔worker). This is §1's two channels. The design stance: **AAI is expensive and should be minimized.** Every token a worker sends the orchestrator is a token in the orchestrator's scarce context (doc 05 principle; doc 09 §D4 — a worker's prose is untrusted input compressed by the cheapest model). So direct AAI is reserved for what genuinely needs a point-to-point, addressed exchange: the brief down, the `ask`/answer, the result contract up, and the steering channel. Everything else — "what did worker B change," "is the index stale," "who's touching payments/" — should NOT be a message. It should be T3.

### T3. Agent-Infrastructure-Agent Interaction (AIAI) — the coordination substrate (the bet)
Agents coordinating **through shared structured media they read and modify, without messaging each other.** This is *stigmergy* — the mechanism ants use: no ant messages another ant; each modifies the shared environment (pheromone trails) and others read it. Termites build cathedrals this way. Baton's stigmergic media:

- **The event ledger** — a worker "tells" the fleet what it did by emitting events, not by messaging peers; anyone reads the tail.
- **Git / the artifact registry** — workers coordinate through commits, diffs, and worktree state (claude-squad's whole model is stigmergic; git is a coordination medium, not just storage).
- **The coordination REPL / operational blackboard** (doc 11) — the fast lane for live shared facts ("test flaky, seed=42 repros"; "I hold a lease on payments/").
- **The shared code index** (doc 11) — one fleet-wide index every worker reads instead of each re-walking the tree; a worker's edit invalidates a cell others observe.
- **The knowledge graph / body-of-knowledge** (doc 08, doc 11) — cross-run stigmergy: a past fleet's findings shape a future fleet's plan without anyone messaging anyone.
- **The skill registry** (doc 11) — a worker authors a skill; others discover and adopt it; capability spreads through the shared medium, not through instruction.

**Why AIAI is the bet:** direct AAI is O(N²) chatter that poisons context and doesn't scale; stigmergic AIAI is O(N) reads/writes against shared structure, is naturally durable and auditable (the medium *is* the record), and degrades gracefully (a crashed agent leaves its marks; a new agent reads them). The design maxim: **prefer modifying shared structure over sending a message; reserve messages for direction (steering) and for the irreducible point-to-point exchanges (brief, ask, result).** Most of what naive multi-agent designs implement as inter-agent chat, baton implements as reads and writes against orchestration-aware infrastructure. This is also why the knowledge and capability planes are *coordination infrastructure*, not mere storage — their read/write semantics ARE the coordination protocol.

## 3. "Beyond modular architectures" — the unit of decomposition changes

Human software architecture is modular around *human comprehension boundaries*: files, modules, teams, service ownership — sized to fit in a person's head and a team's Conway's-law seams. Agent fleets don't share those constraints, so two things shift:

1. **Work decomposes by task and capability, not by module.** A worker is briefed on a *task* with a path-scope and a definition-of-done (doc 06 Q6), spun up in an isolated worktree, and judged by re-run verification (spec I7) — it does not "own the auth module." The decomposition unit is the task-DAG node (doc 08 §3a), and its boundaries are drawn for parallelizability and verifiability, not for human ownership. Modules still exist in the *codebase*; they stop being the *coordination* unit.
2. **But baton's OWN architecture stays ruthlessly modular** — for a different reason. The adapter boundary, the plane separation, the vendor isolation (doc 09 S: zero-vendor-import hub core) exist to survive *vendor churn* and *capability negotiation*, not human comprehension. So "beyond modular architectures" is precise: the *fleet's work* is organized post-modularly (by task + stigmergic substrate), while the *orchestration system* is organized modularly (by plane + adapter) to contain the one thing that never stops moving — the vendors. Don't confuse the two; a critique that "you said beyond modularity but your hub is modular" conflates the coordinated work with the coordinating system.

## 4. How the planes realize the topologies

```
                         ┌─────────────── HUMAN (top of preemption hierarchy) ───────────────┐
                         │ steering (down) ▼            communication (both) ↕                │
   ┌─────────────────────┴───────────────────────────────────────────────────────────────────┐
   │  ORCHESTRATOR agent                                                                        │
   │      │ AAI: steering channel (unidirectional ▼, control plane, priority lane, fenced)      │
   │      │ AAI: comms channel (bidirectional ↕, data plane: brief↓ ask↑ answer↓ result↑)       │
   │      ▼                                                                                      │
   │  ┌───────── CONTROL PLANE (supervisor) ─────────┐   ← T2 mediation: fences, two-phase stop  │
   │  └──────────────────────────────────────────────┘                                          │
   │  WORKERS ──ACI──► CAPABILITY PLANE (search, debug, prove, orient, compute, skills)  ← T1     │
   │     ▲   ▲                                                                                    │
   │     │   └──AIAI (stigmergy): read/write shared substrate, NOT messages ─────────┐           │
   │     └────────────────────────────────────────────────────────────────────────┐ │           │
   │  ┌───────── KNOWLEDGE PLANE ──────────────────────────────────────────────────▼─▼──┐        │
   │  │ operational ledger · coordination REPL/blackboard · artifact registry · code     │  ← T3  │
   │  │ index · skill registry · epistemic causal graph / body-of-knowledge              │        │
   │  └──────────────────────────────────────────────────────────────────────────────────┘       │
   └─────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **T1 (ACI)** = workers ↔ capability plane. Every capability module (doc 11) is an ACI surface, agent-shaped, its operations steerable/interruptible by the control plane and observable in the ledger.
- **T2 (AAI)** = orchestrator ↔ workers, through the control plane (steering) and the two comms channels. Minimized, addressed, expensive-by-default.
- **T3 (AIAI)** = everyone ↔ the knowledge-plane substrate, stigmergically. The default coordination mechanism.

## 5. Design laws that fall out (stated as law, doc 04's idiom)

1. **Two channels, never fused.** Communication and steering are physically separate, on the data and control planes respectively; there is no verb that does both.
2. **Interruption flows down only; communication flows both ways.** The preemption hierarchy (`human > orchestrator > worker`) is the fence order; a worker raises its hand, it does not seize.
3. **Prefer stigmergy to messaging.** Coordinate by modifying shared structure; reserve messages for direction and the irreducible point-to-point exchanges. A `worker↔worker` message is a decomposition smell (doc 06 Q6).
4. **Every interface is agent-shaped or it's a bug.** A capability that returns a human artifact (transcript, pixel screenshot, unbounded list) where a structured, token-bounded, addressable result would serve is mis-designed for its actual user.
5. **The medium is the record.** Because coordination happens through durable shared substrate (ledger, git, graph, registry), the coordination is automatically auditable and replayable — "no invisible hand" (doc 09 S) is a free consequence of choosing stigmergy over ephemeral chat.

## 6. Open questions

1. Worker→worker stigmergy vs the "decomposition smell" rule: the blackboard/REPL (doc 11) *is* worker↔worker coordination through infrastructure — is that blessed (stigmergic, fine) while direct worker↔worker *messages* are banned? (Leaning yes — the medium's structure is the safeguard; a message has no structure.)
2. Does the orchestrator itself coordinate stigmergically with *past orchestrators* via the BoK, and if so is that a fourth topology (agent-time-agent)? Probably just T3 across time; note it.
3. Where exactly is the line between a `nudge(at=tool_boundary)` (data plane, but urgent) and a `steer` (control plane)? Both are "get info to the worker mid-flight." Provisional: a nudge is content the worker *may* act on at the next boundary (cooperative); a steer *changes the turn's trajectory* preemptively (imposed). The mode picks the channel and thus the guarantee.
4. Can the capability plane's ACI surfaces be exposed to the *orchestrator* too (not just workers) — e.g. the orchestrator runs a quick shared search to seed a brief — without the orchestrator drowning in ACI output? (Yes but rate-limited; ACI-for-orchestrator returns only digests.)
