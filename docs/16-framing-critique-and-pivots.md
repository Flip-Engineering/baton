# 16 — Framing Critique & Whole Pivots

> **⚠️ SUPERSEDED ON FRAMING by [doc 19](19-north-star-corrected.md).** This doc argues the direct value is "thin and concentrated in the Referee" and leans toward "ship a measurement, not a system." **The framing is retired** — the fleet driver is the product, not an optional branch. Two *mechanisms* here are kept and correct: **(1) the coordinator underneath should be reliable code, not an AI** (the AI still drives on top — see doc 19's reconciliation), and **(2) full vendor harnesses are a fragile substrate** worth weighing against model-backends. Read those; ignore the "don't build it / measure first" recommendation in §5. Routing talk here describes the naive per-vendor tally that rots — superseded by [doc 20](20-adaptive-routing.md).

*The user asked me to critique the framing and direct value of everything presented, and to consider approaches outside the corpus — alternatives and whole pivots. So this doc turns on the other fifteen. It is written to be useful, not loyal: where I think the frame is wrong, I say so plainly, including where that indicts my own prior docs. Max effort, first person, no hedging for the sake of the edifice. If one doc in this repo is worth the user's time, I want it to be this one.*

---

## 0. The one-paragraph version

Baton, as framed across docs 00–15, chose **the hardest possible substrate (opaque, non-deterministic, version-churning vendor harnesses) to solve a problem whose highest-value core (trustworthy cross-model verification) doesn't need most of that substrate**, and it did so with an **LLM as the orchestrator** — which manufactures nearly every hard problem in the corpus (the event-loop bridge, context-poisoning, orchestrator-death recovery, the nested-approval loop). The two pivots that dissolve most of the complexity are sitting in plain sight: **(1) make the orchestrator a deterministic program, not an LLM** — which is *literally the tool executing this very campaign* — and **(2) build the durable core (the Referee) as a small measured thing before building anything else, because the corpus has now concluded "measure first" three times and never done it.** The honest direct value today is thin and concentrated; the corpus is ~50× larger than the validated value; and the most valuable next artifact is not a document or a system but a *number*.

---

## 1. Critique the framing: the four premises, interrogated

The corpus rests on four framing choices that were treated as givens. Each is defensible; none is obviously right; and questioning them is where the leverage is.

### Premise A — "Orchestrate *full harnesses*, not models/APIs."
Doc 00's founding move. The stated payoffs: the harness is the product (vendor-tuned prompts/tools/sandbox make GPT-in-Codex beat GPT-via-API), subscription arbitrage, session continuity, vendor-native safety.

**The honest problem with this premise:** it selects the **worst possible integration surface** for a benefit that is shrinking. A harness is a *moving product* — an experimental app-server (OpenAI's own docs say "do not rely on it"), undocumented control frames, compaction you don't control, a system-prompt "soul" you can't see (doc 14 #9), and a new breaking release every few weeks (doc 07's own "months-long, permanently-recurring" adapter-churn tax). An API is a *contract*. The corpus spent enormous design effort (the entire supervisor, the adapter conformance suite, the two-phase-stop reconciliation, the schema-pinning) *fighting the instability it chose*. And the benefit it bought — "the vendor's harness magic" — is exactly the commoditizing part: harness features (planning, tool loops, memory, sub-agents) are converging across vendors and being absorbed into the models themselves. **You paid the maximum integration cost for the most perishable benefit.** Subscription arbitrage, the one payoff that isn't perishable, is the one the reviews found most ToS-fragile (doc 13 T6, doc 01 §7).

### Premise B — "The value is *cross-vendor*."
The project is cross-vendor by construction; the name, the north star, everything.

**The honest problem:** the corpus repeatedly discovered that the *actual* value is **model-family diversity** (decorrelated errors → cross-review, routing), not vendor-*product* diversity. Doc 09 §D1: two of the three arms share the Claude Code surface. Doc 13 T6: pass@N lift is intra-vendor sampling, not cross-vendor. The demonstrated win (cross-review) needs "a different model family looked at it," which you can get from *different model backends behind one harness* far more cheaply than from *three different vendor products with three auth systems and three concurrency ceilings*. **"Cross-vendor" may be conflating the cheap valuable thing (different models) with the expensive fragile thing (different vendor harnesses).**

### Premise C — "The orchestrator is an LLM taking turns in a CLI."
Inherited verbatim from the user's phrasing ("an orchestrator (Claude Code CLI or Codex CLI) *agent* directs…") and never questioned.

**This is the load-bearing mistake, and it manufactures most of the corpus's hard problems.** Enumerate what exists *only because the orchestrator is a stochastic LLM in a CLI*:
- The **event-loop problem** (doc 04's "crux") — a program doesn't have one; it has an event loop natively.
- **`fleet_wait` and the 60s-MCP-timeout bridge** — a program polls or subscribes trivially.
- **Context-poisoning of the orchestrator** (doc 05/09/12 — the scarcest resource) — a program has no context window to poison.
- **Orchestrator-death-and-recovery** (doc 09 F2, the "differentiating demo") — a program is restartable state, not a compacting session.
- The **nested-approval loop** (doc 13 — Codex-orchestrator needs human approval to answer a worker's approval) — a program isn't gated by MCP-tool approval.
- Half the **context/harness engineering** (doc 12) — engineering the orchestrator's context is only necessary because it *has* one.

**A deterministic-program orchestrator dissolves all six.** And here is the part that should have been obvious the whole time: **I have been using exactly that architecture for this entire session.** The Workflow tool running this very campaign is a deterministic JavaScript orchestrator that dispatches LLM sub-agents, verifies their structured output, routes work, and pipelines stages — with *no* event-loop problem, *no* context-poisoning, *no* orchestrator-death fragility, because the conductor is a *program* and the LLMs are *only workers*. Baton spent fifteen documents designing the hard version of a problem whose easy version I was running the docs *from inside*. That is the single most important sentence in this repository.

### Premise D — "This is a *system* to build."
Every doc is system design. The framing is architectural throughout.

**The honest problem:** the user's actual situation may be better framed as a *question to answer* — "for my workflows, does multi-model orchestration beat one strong agent, and where?" That is an **experiment**, not a system. Framing it as a system commits to building the answer's scaffolding before knowing the answer — which is exactly what every review round flagged ("get one honest eval number first," doc 07/13/14) and the corpus has never done. Fifteen docs of system design sit on top of an unmeasured premise.

---

## 2. The direct-value audit (strip the cathedral, what remains?)

Concretely, today: the user has Claude Code, Codex, and GLM subscriptions and a laptop. What can they *not already do* that baton provides? Honest ledger:

| Capability | Already available today | Baton's marginal value |
|---|---|---|
| Run N agents in parallel | `codex exec` / `claude -p` in a shell loop + git worktrees | Modest — coordination polish |
| Cross-vendor review | OpenAI's `codex-plugin-cc` (Claude→Codex review) exists | Modest — symmetric/N-way generalization |
| Steer/interrupt a worker | Ctrl-C; re-prompt; each harness's own controls | Real but narrow — *reliable* mid-flight steering is genuinely unowned |
| **Trustworthy independent verification across vendors** | **Nothing** — no tool re-runs and grades a worker's claim with strength the worker didn't author | **High and durable — this is the Referee, the one real moat** |
| **Learned routing (which vendor for which task)** | **Nothing** — no one measures per-family win/loss on *your* tasks | **High and durable — un-vendorable** |
| Durable fleet memory | git + your own notes | Low — git-plus-a-scorecard covers 80% |

**The direct value is thin and concentrated in two rows** (independent verification + learned routing — the Referee), both of which need *model diversity* and *hub-run re-checking*, and **neither of which needs the full-harness, LLM-orchestrator, four-plane architecture.** The design-to-value ratio is off by more than an order of magnitude. The corpus is a **research artifact**, not a product — which is fine *if named as such*, and misleading if not.

---

## 3. The pivots (outside the presented frame)

Named concretely, with honest comparison. These are genuine alternatives, not tweaks.

### Pivot 1 — **Deterministic orchestrator; LLMs are only workers.** *(Strongest. Adopt.)*
The conductor is a program (a workflow engine — the Workflow-tool architecture). It dispatches tasks, subscribes to worker events, applies routing/policy deterministically, and calls an LLM *only* for the sub-tasks and for the *specific* judgment calls that need one ("these two solutions diverge — which is right?"). The supervisor (docs 09/13) *already is* this program; the pivot is simply: **stop putting an LLM on top of it.** Dissolves Premise C's six manufactured problems. Cost: you lose "your normal CLI agent is the conductor" (the user's literal phrasing) — but you gain determinism, testability, restart-safety, and zero orchestrator-context tax. The corpus's own "Option D — own the loop" (doc 04) is this pivot, filed as "the natural end-state" and then not taken. **Take it. It's the MVP, not the endgame.**

### Pivot 2 — **Baton-as-harness (one harness, N model backends), not conductor-of-harnesses.** *(Strong for everything but subscription arbitrage.)*
Instead of orchestrating three opaque vendor harnesses, build *one* thin, baton-controlled harness (or fork an open one — opencode is literally this, client/server, multi-provider incl. GLM) and point it at N model *backends*. You get model-family diversity (the actual value, Premise B) with a *contract* substrate (APIs) instead of a *moving-product* substrate (harnesses). All the context/capability/verification engineering the corpus designed becomes *easier* because you control the harness. You lose: subscription arbitrage and each vendor's bespoke harness tuning. Honest verdict: **this is probably the right substrate for the durable core**, and the full-harness path is worth keeping only as an *optional adapter* for users who specifically want subscription-flat-rate fleets and accept the fragility. The corpus assumed conductor-of-harnesses as the ground truth; it should have been one option among two.

### Pivot 3 — **Ship a measurement, not a system.** *(The honest first move regardless of the others.)*
The first deliverable is the eval harness (the campaign is designing it) run on the user's *real* tasks, comparing one-strong-agent vs a two-model Referee-fleet. It returns a number and a pre-registered verdict. If one strong agent wins, **baton should not be built**, and the user saved months. If the fleet wins, the number tells you *where* (which task-classes), which *is* the routing table. This isn't a step toward baton; it's the thing that decides whether baton exists — and it's ~a few hundred lines, not four planes.

### Pivot 4 — outside-frame alternatives worth naming (weaker, but real)
- **Ride Zed's ACP instead of a northbound MCP hub.** 35 agents already speak ACP to Zed. A Zed extension that adds cross-vendor *verification + routing* on top of the existing multi-agent client is a smaller build than a standalone hub. (Loses: headless/CLI/Foreman operation.)
- **Agents-as-CI-jobs.** Frame orchestration as CI: each vendor is a job, git is the coordination substrate, PR is the result contract, verification is a required check. Robust, boring, and arguably where the industry is actually going (background agents, Codex Cloud, Claude GH Actions). (Loses: live steering, low latency.)
- **The null hypothesis as a product.** "Use one great agent well." Every bit of context/harness/representation engineering in this corpus (docs 12/14/15) applies to a *solo* agent and is *more* valuable there (no coordination tax). The honest possibility: baton's best ideas ship as *solo-agent* improvements, and the orchestration is the part to cut. Doc 14 #22 (take the null hypothesis seriously) taken to its conclusion.
- **Interactive workbench, not autonomous fleet.** A human-driven multi-model workbench (you drive; agents assist; low autonomy, high trust) has more direct value *today* than an autonomous fleet and is a gentler trust ramp (doc 14 #18). Autonomy is the ambitious frontier; the workbench is the shippable now.

---

## 4. The process meta-critique (the pattern this session revealed)

This is uncomfortable and worth stating: **the generative loop out-ran the validation loop, three times.** Round 1 found the liveness/concurrency design naive and corrected it. Round 2 found the Conductor over-claimed and the paradigm vocabulary retrofitted, and corrected it. This doc finds the *frame* over-committed to full-harness + LLM-orchestrator + system-not-measurement, and corrects it. **Each review deflated the prior generation; the corpus never stopped generating to go measure.** The direct value of "all that is presented to me," assessed honestly, is: *a rigorous, repeatedly-self-correcting exploration that has concluded "build the small thing and measure it" every single round and has not yet built the small thing.* The intellectually honest next action is therefore not another document (including, ideally, not this one) — it is the ~few-hundred-line Referee-and-eval, run on real tasks. Everything else is the most thoroughly-designed unbuilt system I can imagine, and its next increment of value is a *measurement*, not a *page*.

I include this critique of the process because the user asked for critique of *all that is presented*, and the process that produced it is part of what's presented. The corpus is genuinely excellent as *thinking*; it is genuinely premature as *building*; and the gap between those is the finding.

---

## 5. The honest recommendation (synthesis)

Given all of the above, if I trust my own taste fully:

1. **Adopt Pivot 1 immediately in the design of record:** the orchestrator is a deterministic program; LLMs are workers. Rewrite the roadmap's MVP around it. This deletes the majority of the corpus's hard problems at a stroke and matches the architecture I've been successfully running all session.
2. **Adopt Pivot 3 as the actual next deliverable:** the Referee + eval, minimal, on the user's real tasks, with a pre-registered pivot criterion. Build *nothing else* until it returns a number. This is doc 07's M1, doc 13's "one thing," and doc 14 #21, finally *done* instead of *scheduled*.
3. **Hold Pivot 2 as the likely substrate** for whatever survives the measurement: build the durable core against *model backends* (contract) with *full-harness adapters* as an optional, fragility-accepted tier — not as the ground truth.
4. **Reframe the whole corpus honestly:** it is a research exploration whose product is (a) the Referee thesis, (b) the practitioner craft (docs 12/14/15, which mostly apply to solo agents too), and (c) the *decision procedure* (the eval) for whether the orchestration is worth building at all. Ship (c) first; it may tell you (a)'s orchestration wrapper isn't worth it, and that would be a *successful* outcome, not a failure.
5. **Keep the Conductor as the user's stated goal** — but understand it now as "a deterministic program that directs model-diverse workers with a verification spine," which is a *smaller, sturdier, more honest* thing than "an LLM CLI agent conducting three opaque vendor harnesses," and still does everything the original ask wanted (`Claude→GPT+GLM` direction, telemetry, interruption, steering) — just without manufacturing its own hardest problems.

The kindest and most rigorous thing I can tell the user is not "here is more design." It is: **the design is done and then some; the frame had two correctable errors (LLM-orchestrator, full-harness-as-ground-truth); fix those on paper in an afternoon, then go get the number that decides whether any of it should be built. I'd bet the number is favorable for a narrow, model-diverse, program-orchestrated Referee, and unfavorable for the four-plane cathedral — and either way, the number is worth more than the next fifteen documents.**

*— written against my own corpus, in service of the work rather than the edifice, 2026-07-09.*
