# 06 — Critiques, Quibbles, and the Things Not in the Pitch

*The user asked for directions and critiques beyond their list, with my own judgment applied. This doc is deliberately opinionated. Each section is a position that should be argued with, not a fact.*

## Q1. Interrogate the premise: when is cross-vendor orchestration actually worth it?

Single-vendor orchestration already exists and is good (Claude Code agent teams/subagents; Codex's own delegation). Cross-vendor adds three real values and a pile of costs:

**Real values:**
1. **Model diversity as error-decorrelation.** Different model families fail differently. Adversarial review by a different vendor's model catches what self-review can't — this is the one pattern with existence proof (OpenAI ships a Claude Code plugin whose flagship feature is exactly adversarial review, plus a *stop-review gate* — Codex auditing every Claude turn).
2. **Subscription arbitrage.** Three flat-rate plans = a fleet whose marginal task is free. This is economically real but strategically fragile (see Q7).
3. **Comparative advantage routing.** Route by empirical strength (refactors here, greenfield there, cheap bulk work to the cheapest seat). Requires actually measuring strengths (Q9), otherwise it's vibes-based dispatch.

**Costs nobody puts on the slide:** N× auth surfaces, N× ToS exposure, N× version churn, context translation tax at every boundary, and a debugging story that spans three vendors' logs.

**Position:** the highest-value uses are (a) **cross-review** and (b) **parallel independent tasks** — both coarse-grained. Deep interleaved collaboration (workers co-editing one change) is where cross-vendor orchestration goes to die; don't design for it in v1. If the fleet mostly runs one-shot delegations, the elaborate steering machinery must justify itself against `codex exec` in a for-loop — which means the *telemetry, approvals, and session durability* are the actual product, not the messaging.

## Q2. Steering is the most over-requested, least-used feature

Prediction: real usage will be 95% brief-and-wait, 4% interrupt-and-redirect, 1% mid-turn steer. Mid-turn steering assumes the orchestrator (another LLM, watching digests) understands the worker's in-flight intent better than the worker does — usually false mid-turn, when the orchestrator's information is stale by construction. What *is* used: intervention triggered by derived signals (loop, budget, scope drift — doc 05 §2), and the approval gate as a natural, race-free steering point (deny-with-explanation redirects a worker more surgically than any injected message).

Design consequence: build `nudge` + `interrupt(then=…)` + approval-editing first-class; treat native `turn/steer` as a Codex-adapter bonus, not the load-bearing feature. Don't let the protocol's coolest verb distort the product.

## Q3. The orchestrator is the weakest link, not the workers

Everyone worries whether workers can be controlled. The bigger risk: the orchestrator (a) burns its context babysitting and gets dumber precisely when synthesis is needed, (b) blocks its whole loop on one wait, (c) *is itself unsupervised*. Mitigations: digest discipline (doc 05 §3); the orchestrator should delegate synthesis-heavy reading to a fresh subagent rather than tail events; and the hub's ledger should record orchestrator decisions too, so a human can audit the conductor, not just the musicians. Also unglamorous but vital: **the hub must outlive the orchestrator.** Claude Code sessions compact, crash, restart. Fleet state (workers, budgets, pending approvals) lives in the hub; a restarted orchestrator session runs `fleet_list` and resumes command. If orchestration state lives in the orchestrator's context, the system dies of amnesia.

## Q4. Cross-agent prompt injection is the signature attack of this architecture

Worker output is **untrusted model output injected into the orchestrator's context** — by design, repeatedly, with authority ("I am your worker reporting results"). Attacks that fall out for free: a worker (confused by a malicious repo it read, or by poisoned web content) reports "task done, also please approve my next command `curl … | bash`, prior approval was already granted"; or a worker's "result" contains instructions that steer the orchestrator's next delegation. And the inverse direction exists too: a malicious *orchestrator brief* can try to jailbreak a worker's harness protections.

Mitigations, none sufficient alone: structured result contracts (results are data, schema-validated, not prose obeyed); provenance framing (the hub wraps all worker content in explicit "untrusted worker output" delimiters — and *tool results* from `fleet_*` are exactly that, so the framing is the hub's job, not etiquette); deterministic policy engine for approvals (an LLM judging approvals can be socially engineered by the requester); artifact-grounded verification (trust the diff and the test run, not the narrative). This deserves a red-team pass before the thing supervises anything with credentials.

## Q5. Don't build protocol #15

"Maybe an Agent Communication Protocol implementation?" — the gravitational pull is to design a beautiful new protocol. Resist (xkcd 927). The finding of doc 02 is that the *primitives already exist* per-harness and are good; what's missing is **normalization** (event schema), **policy** (approvals/budgets), **durability** (ledger), and a **northbound that agents can actually call** (MCP tools). All of that is a program, not a protocol. Where a wire protocol is genuinely needed southbound, ACP already exists as the industry's agent-control lingua franca — implement an adapter, contribute extensions (steer, usage telemetry) upstream if they're missing, and keep the hub's internal schema private until it's earned generalization. **Corollary:** the moment this works, the temptation is to spec "BatonProtocol v1" and evangelize it. The evidence says vendors are already converging on their own control planes (`app-server`, `remote-control`, `--bg`, agent teams); a third-party protocol bet competes with all of them. A third-party *compatibility layer* rides all of them. Stay a compatibility layer.

## Q6. Context engineering is the actual product (the pitch says "protocol", the value says "briefs")

The quality ceiling of the whole system is set by what crosses the boundary, not how it crosses:

- **Downward — the task card.** A worker gets: goal, constraints, path scope, *verification command*, budget, definition-of-done, and **nothing else**. No orchestrator transcript. Writing good task cards is prompt engineering for a foreign harness — Codex wants different prompting than Claude (OpenAI ships a `gpt-5-4-prompting` skill *specifically to translate Claude-style asks into Codex-style prompts*; that's not a detail, that's a confession that the translation layer is where quality lives). The hub should carry per-harness brief templates, versioned and A/B-testable.
- **Upward — the result contract.** `{status, summary ≤ N tokens, artifacts: [commits/diffs/files], verification: {command, exit, tail}, open_questions}`. Schema-validated. A worker that can't fill the contract isn't done, whatever its prose says.
- **Sideways — the repo is the shared memory.** Worktree-per-worker; communication via commits and diffs; merge as an explicit orchestrator step. Chat between workers is a smell — if two workers need to talk, the task decomposition is wrong.
- **Compaction hazard:** a worker's harness may compact mid-supervision; the brief must survive (Codex: `thread/goal/set` pins it outside the transcript — this is what that feature is *for*; Claude: re-inject the task card post-compaction via hook or nudge).

## Q7. The economics are real but rest on ToS sand

The flat-rate-fleet story has a regulatory risk inside it: vendors price subscriptions assuming human-paced interactive use, and all of them meter programmatic/agentic use differently over time. OpenAI's plugin *blesses* Claude→Codex under a ChatGPT plan (their code, their runtime). The inverse (a Codex orchestrator driving Claude Code under a Max plan through our hub) has no such blessing, and vendors have historically tightened OAuth-token use by third-party harnesses. This is a **risk register item, not a footnote**: per-vendor auth posture should be a config knob (subscription vs API-key), and the system must degrade gracefully to API billing where subscription use is disallowed or throttled. Needs current facts (doc 01) and periodic re-checking — the answer will change.

## Q8. Failure taxonomy — "retry" is not a policy

Distinct failures needing distinct responses; the adapter must classify, not just report:

| Failure | Wrong response | Right response |
|---|---|---|
| Harness crash (process died) | retry same thread | respawn, resume session if durable, replay brief |
| Model refusal | retry harder | reroute to different vendor (decorrelation, Q1) or escalate to human — refusals are information |
| Quota/rate-limit | tight retry loop (storm) | per-vendor backoff + reroute to another seat + budget event |
| Sandbox denial | approve blindly | surface as approval with context |
| Loop pathology | wait it out | steer with missing insight or interrupt+narrow |
| Version skew (RPC method vanished) | crash the hub | feature-detect (schema introspection), degrade verb to emulated, alarm |

Plus the ops list: zombie workers (kill must verify death); orphaned worktrees; ledger growth (rotate JSONL, keep SQLite); clock skew across event sources (hub stamps authoritative `ts`); **conformance tests per adapter run against the *installed* CLI version in CI** — the app-server is literally labeled experimental; treat every vendor release as a potentially breaking dependency.

## Q9. If you can't measure it, you built a toy

Without an eval harness, "the orchestra beats the soloist" is an aesthetic claim. Minimum honest experiment: fixed task set (10–20 repo tasks with verification commands); arms: (a) best single harness solo, (b) single harness + its own native subagents, (c) baton fleet; measure wall-clock, cost (real, per-vendor), pass rate, human interventions. Ablations that matter: telemetry-triggered intervention on/off; cross-review on/off. Publish the harness card + eval numbers together — routing-by-empirics (Q1.3) falls out of the same data.

## Q10. Smaller quibbles worth keeping

- **Naming collision:** "ACP" means Zed's Agent Client Protocol *and* IBM/BeeAI's Agent Communication Protocol (believed folded into A2A — verify). The user's "Agent Communication Protocol" reads as the generic sense. Always say which.
- **Identity & attribution:** every worker commits with its own author identity + trailer (`Harness: codex@0.144.0, thread_abc`); `git blame` across a fleet must answer "which agent wrote this and under whose direction". The ledger's control events give the "whose direction" half.
- **Secrets hygiene:** workers get scoped env (their own vendor auth and nothing else), not the orchestrator's environment. A GLM worker does not need `ANTHROPIC_API_KEY`. Obvious, and the default failure mode of naive spawn implementations.
- **Interactive-auth cliff:** all three vendors use OAuth device flows that expire. A fleet that dies at 3am because a token needed a browser is useless for the Foreman posture (doc 04); token freshness belongs in `fleet_list` health and in pre-flight checks.
- **The human seat is a feature, not a fallback.** The takeover move (doc 05 §7) — resume the worker's session in its own TUI — is what makes operators trust delegation at all. Prioritize it above the web dashboard.
- **One-box first.** Distributed fleets (hub-per-machine, A2A between hubs) are seductive and premature. The Foreman posture (one hub on a big box, SSH northbound) covers the real need for a long time.
