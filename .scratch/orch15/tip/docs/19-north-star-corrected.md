# 19 — North Star, Corrected: the Fleet Driver is the product

*A course-correction. Over the review rounds the framing drifted into treating independent verification (the "Referee") as baton's real identity and the fleet-driving (the "Conductor") as an optional branch — even flirting with "baton is a neutral trust institution." That inverts the actual goal. This doc re-centers on the goal you set and re-slots every technical gain as what it always was: **support for the fleet driver.** Nothing is dropped; the tree is turned right-side-up. Plain language, minimal jargon.*

## The goal (unchanged, and it is the trunk)

**A fleet driver: one orchestrator agent that directs full Claude Code / Codex / GLM worker agents across vendors — sending them work, watching them, and interrupting and steering them mid-run.** That is the product. `Claude → (Codex + GLM)` and `Codex → (Claude + GLM)`, with real messaging, telemetry, and control over the workers. Everything else in this repo exists to make *that* work well.

## The correction, stated plainly

The reviews were right that independent verification is durable and hard to copy — but "durable and hard to copy" is not the same as "the product." Verification is **how the driver earns the right to be trusted**, not a replacement for driving. Same for routing, memory, and the reliable coordination layer: they are the parts that make a fleet driver *good enough to actually use* instead of a toy. So:

- ❌ "Baton is a Referee; the Conductor is optional." — inverted, retired.
- ❌ "Baton is a neutral cross-vendor trust institution." — a distraction from the goal, retired.
- ✅ **"Baton is a fleet driver. Its supporting parts — verification, routing, a reliable coordination core, telemetry, worker tools — are what make the driving trustworthy, smart, and safe."**

## Every technical gain, re-slotted as support for the driver

Nothing here is lost; each item is now explicitly in service of the fleet driver.

| Technical gain (kept) | What it was over-billed as | What it actually is: **support for the driver** |
|---|---|---|
| Independent verification (re-run the worker's tests yourself) | "the real product / the Referee" | **how the driver knows a worker's "done" is true** — so it can safely move to the next task, merge, or reroute. A trust feature *of* the driver. |
| Learned routing (which vendor is good at what) | "the durable moat" | **how the driver picks the right worker for a task** — a dispatch feature *of* the driver. |
| The run corpus / memory | "a data flywheel / the true moat" | **how the driver gets better over time** and how you debug/replay what the fleet did — an operations feature *of* the driver. |
| Reliable coordination core (fencing, two-phase stop, durable event log) | "the supervisor is the real system" | **the plumbing that makes the driver's commands actually reliable** — so "interrupt worker 3" always works and two things never step on each other. Infrastructure *under* the driver. |
| The deterministic-coordinator idea (doc 16) | "the orchestrator shouldn't be an LLM" | **how to build the driver's control loop so it doesn't get confused** — the AI orchestrator still drives; a plain-code layer underneath makes its commands safe (see reconciliation below). |
| Capability tools (search, debug, semantic diff, verification ladder) | "the capability plane, seven modules" | **tools the driver hands its workers** so they do better work and the driver can check it cheaply. Features *of* the driver. |
| Context/harness engineering (docs 12/14) | its own paradigm | **how the driver presents work to each worker** in that worker's style, and keeps the orchestrator's view clean. Craft *inside* the driver. |
| Language choice (Elixir/OTP or Go, doc 17) | — | **how to build the driver's core** so it survives running for weeks. Implementation. |

## The one reconciliation you should sign off on

The only place my finding genuinely differs from your original words is the orchestrator. You said the orchestrator *is* a CLI agent (Claude Code or Codex). I found that a pure-AI coordinator creates avoidable problems (it forgets, gets confused, can't be reliably woken by events). The honest reconciliation keeps **both**, and it does not demote your form:

> **You still drive from your CLI agent.** Your Claude Code (or Codex) agent is the orchestrator — it decides what to do: "spawn a worker on this task," "interrupt worker 3," "is this really done?", "have a different vendor review it." Underneath, a small reliable program carries out those decisions exactly and does the mechanical bookkeeping (dispatch, the interrupt actually landing, re-checking a worker's claim, the event log). **The AI drives; the plumbing makes the driving safe.** You lose nothing from your original picture — the orchestrator is still your agent — and you gain a control layer that doesn't drop commands or get confused.

If you'd rather the coordinator be *fully* AI with no reliable layer underneath, that's your call — but the plumbing layer is cheap insurance and it's what makes "interrupt and steer" actually dependable, which was in your original ask.

## What this means for the earlier docs

- Docs 13, 16, 18's "Referee-not-Conductor" and "neutral institution" language is **corrected by this doc** — read those docs' *mechanisms* (they're sound) but ignore their *framing* where it demotes the fleet driver. The fleet driver is the product; verification is its trust feature.
- The "should we even build it / measure first" hedging is also stood down. You've decided: build the fleet driver. The cheap vendor-cross-check experiment is now just optional de-risking for *one supporting feature* (verification), not a go/no-go on the whole thing.
- The prototype (`prototype/`) already has the shape: an orchestrator that dispatches workers and verifies their results. It's the fleet driver's skeleton — it just needs the messaging, telemetry, and interrupt/steer surfaces built out on top, which is exactly your original ask.

## The plain next step

Build the fleet driver, for real, smallest-useful-version first:
1. **Drive two workers.** Your CLI agent spawns a Codex worker and a Claude/GLM worker on tasks, in isolated copies of the repo.
2. **Watch them.** A live event feed of what each worker is doing (telemetry/monitoring).
3. **Interrupt and steer.** Stop a worker mid-run; redirect it; answer its questions (messaging both ways).
4. **Trust the result.** When a worker says "done," the driver re-runs the check itself before believing it.
5. **Then grow it** — routing, more workers, the tools — as each earns its place.

That is your original goal, with the technical gains folded in as the features that make it dependable. No neutral institution, no inverted hierarchy — just a fleet driver that can be trusted to actually drive.
