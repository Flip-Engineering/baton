# Frontier research: harness-engineering

## PROPOSAL
# Agent harness engineering — frontier features for the fleet driver

Scope note: baton does **not** own the workers' internal loops (Codex/Claude/GLM are full vendor harnesses). So this maps SOTA onto the four things baton *does* control: the **brief** it writes, the **tools** it exposes, the **sub-agent shape it can request** of a worker, and the **loop the coordinator runs** (including baton's own orchestration). Everything below routes its output into the append-only LOG, runs re-verification in a *fresh* worktree, and treats worker prose as untrusted.

## State of the art now (2025-26)

| System / technique | What it does | Why it matters for baton | Cite |
|---|---|---|---|
| **Anthropic "Effective harnesses for long-running agents"** (2025) | Splits work into an **initializer** (builds a structured feature-list JSON with `passes` booleans, `init.sh`, `progress.txt`) and a **coder** that does one feature/session in an *initialize→work→verify→commit→clean* loop; "it is unacceptable to edit the tests." | This *is* baton's worker loop, minus the trust gate — baton can require these structured artifacts and enforce the "don't touch the pinned tests" rule from outside. | [anthropic.com](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) |
| **Claude Agent SDK** (Claude Code SDK renamed, late 2025) | Ships the agent loop as a library: **subagents with isolated context windows**, automatic **compaction**, **hooks**, per-tool **permissions**, MCP. | Baton's Claude/GLM adapters ride this; subagent isolation + compaction are patterns baton can *request* and must re-inject goals around. | [code.claude.com](https://code.claude.com/docs/en/agent-sdk/overview) |
| **Anthropic multi-agent research system** | Orchestrator (lead agent) decomposes and spawns parallel subagents; beat single-agent Opus by **90.2%** but used **~15× tokens**; token use = **80%** of performance variance. Key lesson: vague delegation → subagents duplicate work; each needs *objective, output format, tools/sources, boundaries*. The lead prompt is "the longest, most tuned part." | Baton's orchestrator *is* the lead agent and its brief *is* the delegation contract — this paper is the empirical case for investing there, and the warning that multi-agent only wins on genuinely parallel work. | [anthropic.com](https://www.anthropic.com/engineering/multi-agent-research-system) |
| **Code Mode / Code Execution with MCP** (Cloudflare + Anthropic, 2025) | Replace N tool definitions with one sandboxed `execute(code)` + `search()`; agent writes TypeScript against a typed SDK. Cut 2,500 endpoints from **1.17M → ~1k tokens (99.9%)**; intermediate results never re-enter context. "LLMs write code to call tools better than they call tools directly." | Directly realizes doc §5.4's goal ("a search costs a few hundred tokens, not forty thousand"): expose baton's fleet tools as *code*, not a wall of MCP schemas. | [blog.cloudflare.com](https://blog.cloudflare.com/code-mode-mcp/), [anthropic.com](https://www.anthropic.com/engineering/code-execution-with-mcp) |
| **Reflexion / Self-Refine / RetroAct; Anemoi** | Separate reflector/evaluator LLM critiques a trajectory and rewrites the plan; Anemoi's semi-centralized agent-to-agent critique added **+9pp pass@3**. | The evidence base for a **cross-vendor critique pass** before the trust gate — decorrelated review catches what the author missed. | [emergentmind](https://www.emergentmind.com/topics/planner-executor-agentic-framework), [arxiv 2503.01490](https://arxiv.org/pdf/2503.01490) |
| **GEPA: Reflective Prompt Evolution** (2507.19457, ICLR 2026 oral) | Optimizes prompts by *reflecting in natural language* on sampled trajectories, keeping a **Pareto front** of variants; beat GRPO by 6–20% with **35× fewer rollouts**, beat MIPROv2 by >10%. | A safe recipe for baton to *evolve its brief templates* from the LOG without RL — reflect on re-verified wins/losses, don't collapse to one "best" brief. | [arxiv 2507.19457](https://arxiv.org/abs/2507.19457) |
| **Darwin Gödel Machine / ADAS / PACE** (2025) | Agent that rewrites its own code, validating each change on benchmarks; SWE-bench **20→50%**. ADAS = meta-agent designs downstream agents. PACE adds anytime-valid acceptance tests for self-evolving agents. | The frontier of "harness that learns" — and the cautionary boundary: DGM improves by *empirical validation of each change*, exactly baton's trust gate. Self-modifying the trusted core is a bet baton should decline. | [arxiv 2505.22954](https://arxiv.org/abs/2505.22954), [arxiv 2606.08106](https://arxiv.org/pdf/2606.08106) |

## Beyond-frontier ideas (clearly labeled speculation)

- **The LOG as a training set for briefs, not just a debugger.** Replay (§5.3) is currently for humans. Beyond frontier: treat every re-verified pass/fail as a labeled example and let a GEPA-style reflector evolve per-task-type brief templates automatically. Speculative because "does a learned brief generalize past the tasks it was tuned on" is unproven — but the Pareto-front discipline makes it *safe to try*.
- **A "harness card" per worker run.** Vendors expose different internal shapes (plan-mode, subagents, thinking budgets). Speculative: baton learns *which internal shape* each vendor should be asked to use per task-type, and the routing stats track shape, not just vendor. Real knob, unproven payoff.
- **Bounded self-designed worker tools (ADAS-lite).** A meta-worker proposes a new *worker-facing* skill/tool; it's admitted only if it survives re-verification and keeps winning. Speculative and deliberately *walled off from the coordinator core* — baton evolves the periphery, never its own trust gate.

## Proposed features for baton (the actionable core)

### 1. Brief compiler with an explicit delegation contract
- **What**: Turn the free-text brief into a structured contract — objective, in/out-of-scope paths, tools to use, output format, and the *exact verification command that defines "done"* — then render it in each vendor's style.
- **How it plugs in**: context/brief + coordinator. The compiled contract is logged as the task's opening event; the "done = this command" field is the same spec the trust gate re-runs in a fresh worktree, so the worker can never redefine done. The scope-paths field feeds the existing path leases and the "out of scope" warning signal.
- **Frontier or beyond**: SOTA-adoption (Anthropic's multi-agent delegation lesson, made mechanical).
- **Moat / bet / rental**: **Moat.** The delegation contract is the orchestrator's accountability surface; it stays valuable as models improve because better models still need unambiguous boundaries to parallelize without colliding.
- **MVP or later**: **MVP.** SYSTEM.md already promises per-vendor briefs; this is the missing structure.

### 2. Plan-gate: checkpoint the plan before the worker spends budget
- **What**: Ask the worker to emit a short plan first; the orchestrator (or a cheap reviewer) approves or steers it *before* execution proceeds.
- **How it plugs in**: coordinator feature, reusing the existing question/answer + steer channel and version-stamps. The plan and its verdict are logged; a rejected plan costs a few hundred tokens instead of a whole misdirected run.
- **Frontier or beyond**: SOTA-adoption (planner/executor split + the "premature victory / one-shotting" anti-patterns).
- **Moat / bet / rental**: **Moat**, leaning rental — as models plan better the gate fires less, but catching a wrong direction early is always cheaper than re-verifying garbage.
- **MVP or later**: **MVP-adjacent.** Cheap, high-leverage, directly attacks wasted budget.

### 3. Structured task-ledger as the worker↔coordinator handoff
- **What**: Require each worker to maintain a committed, machine-readable ledger in its worktree (features/subtasks with pass/fail, a progress note), and a repo-startup recipe.
- **How it plugs in**: worker tool + telemetry. The coordinator parses the ledger for warning signals (stalled, looping) instead of guessing from prose, and it survives compaction/handoff because it lives in the worktree, not the worker's context. Because it's a *commit*, the trust gate reads it against the pinned spec — a worker flipping `passes=true` proves nothing until the coordinator's own run agrees.
- **Frontier or beyond**: SOTA-adoption (the long-running-harness structured-artifact pattern).
- **Moat / bet / rental**: **Moat.** Durable structured state is what makes long runs restartable regardless of model.
- **MVP or later**: **MVP-adjacent.**

### 4. Code-mode tool bridge (one `execute` surface, not N schemas)
- **What**: Expose baton's fleet tools (code search, semantic diff, orientation, debug) to workers as a single sandboxed code-execution surface against a typed SDK, instead of many MCP tool definitions.
- **How it plugs in**: worker tool. Intermediate results stay in the sandbox and never re-enter the worker's context (the §5.4 token goal, delivered by the frontier mechanism). The sandbox is the same OS boundary as the worktree, so tool code can't escape scope; each call is logged as a trusted coordinator-computed event.
- **Frontier or beyond**: SOTA-adoption (Cloudflare Code Mode / Anthropic code-execution-with-MCP).
- **Moat / bet / rental**: **Rental-leaning.** Vendors are adding this; baton should *use* it, not out-engineer it. Value is in exposing baton's *own* tools this way, cheaply.
- **MVP or later**: **Later** — earns its place once there are 2–3 fleet tools worth bundling.

### 5. Cross-vendor reflector pass before the trust gate
- **What**: Before (or alongside) expensive re-verification, have a *different vendor* review the worker's committed diff via semantic diff and file a structured critique.
- **How it plugs in**: coordinator feature. Runs in a fresh worktree at the worker's commit; the critique is a logged, provenance-tagged event feeding the accept/steer/reroute decision. This operationalizes the E2 decorrelation bet as a standing feature.
- **Frontier or beyond**: SOTA-adoption (Reflexion/RetroAct reflector + Anemoi cross-agent critique).
- **Moat / bet / rental**: **Moat** (with a de-risking bet inside it). Cross-vendor decorrelation is exactly the thing a single better base model *cannot* give you; it stays valuable as all vendors improve. Higher ROI for most tasks than the math-proof rung.
- **MVP or later**: **Later** (Phase 3), but run the cheap E2 side-experiment first to size the payoff.

### 6. Adaptive sub-agent shape request
- **What**: Let routing pick *how* a worker should run — "single-shot," "plan→execute with a checkpoint," or "fan out to your own subagents for these independent pieces" — and request it via the brief.
- **How it plugs in**: context/brief + coordinator. Baton can't see inside the worker, but every vendor supports plan-mode / subagents / prompt-level shaping, so this is a knob baton genuinely holds. Routing tracks *shape × vendor × task-type × model version*, learning only from re-verified wins (same discipline as §5.2). The chosen shape is logged.
- **Frontier or beyond**: SOTA-adoption, with a novel twist (routing over *shape*, not just vendor).
- **Moat / bet / rental**: **Moat**, honestly with a bet: that shape choice matters enough to learn. The multi-agent paper's "architecture follows task structure" says it does for parallel work.
- **MVP or later**: **Later** (Phase 2–3, once routing has history).

### 7. Brief evolution from the LOG (GEPA-style, verified-only)
- **What**: Offline, mine the LOG for re-verified pass/fail per task-type, reflect in natural language on what the brief got wrong, and evolve brief templates on a Pareto front.
- **How it plugs in**: memory/coordinator. Consumes only the LOG (§3.3 rule 5) and only re-verified outcomes; keyed by model version so a new release doesn't inherit stale brief tuning. Proposed template changes are themselves A/B-replayed before promotion — a governed learning loop, not a free-running one.
- **Frontier or beyond**: **Novel** for a cross-vendor driver (GEPA is single-system; applying it to *briefs across vendors* is new).
- **Moat / bet / rental**: **Bet, honestly** — but a cheap, safe one, because the worst case is "the current template stays." If it works it's a moat (the brief-quality flywheel is baton-specific).
- **MVP or later**: **Later.** Needs run history to have anything to learn from.

### 8. Bounded self-improving skills (ADAS-lite, with a governor)
- **What**: Reframe §5.4 reusable skills explicitly as a *bounded* self-improvement loop — a worker (or meta-worker) proposes a new worker-facing skill/recipe; baton keeps an archive, admits it only if it passes re-verification, and fades it if it stops winning.
- **How it plugs in**: memory/tools. Every promotion is gated by the trust gate and logged with provenance; a poisoned skill is traceable to every worker that read it (§5.6 contagion tracking). The governor is the point: baton evolves *tools it hands workers*, and **never** rewrites the coordinator, trust gate, or reliability rules.
- **Frontier or beyond**: SOTA-adoption of DGM/ADAS *with the frontier's own dangerous part removed*.
- **Moat / bet / rental**: **Moat** in its bounded form; the unbounded DGM version is a **bet baton should explicitly decline** on its trusted core.
- **MVP or later**: **Later**, earned by demand.

## Add / subtract / modify

- **ADD (to MVP): the delegation-contract brief (#1) and the plan-gate (#2).** SYSTEM.md treats briefs as "the same task phrased per vendor" but never specifies the *fields* the multi-agent research lesson proves matter (objective / output format / tools / boundaries / done-command). This is the cheapest, highest-leverage upgrade and it hardens the trust gate (done is a pinned command, not worker prose). The plan-gate is a few-hundred-token insurance policy against whole wasted runs.
- **MODIFY §5.4 (worker-tool delivery): make it code-mode.** The doc states the token goal ("a few hundred tokens, not forty thousand") but not the mechanism. Name it: one sandboxed `execute` surface over a typed SDK, per Cloudflare/Anthropic. Same OS sandbox boundary as the worktree, so no new safety surface.
- **MODIFY §5.4 (skills) + §10 table: reframe as bounded ADAS with a governor**, and add one explicit non-goal: **baton does not self-modify its coordinator or trust gate.** Right now "the fleet gets smarter on its own" is listed as measured-not-assumed; sharpen it to *the periphery learns, the trusted core does not*. That's the honest line between the DGM frontier and a system you can leave running.
- **RE-RANK, don't cut, §5.1's proof rung.** The harness literature (long-running agents, DGM's own gains) shows *empirical re-runs* and *cross-vendor critique* (#5) move the needle for the vast majority of tasks; math proof pays off only on tiny critical pieces. Keep it as a rarely-used top rung and invest the review budget in the cross-vendor reflector first. (This is a priority note, not a design change.)
- **Nothing to subtract structurally** — the coordinator core, worktree isolation, and trust gate are exactly what the frontier (DGM's per-change validation, the long-running-harness commit/verify loop) independently reinvented. The area *confirms* baton's spine; the additions are all in the brief, the tools, and the shape baton requests.

## Sources
- [Effective harnesses for long-running agents — Anthropic (2025)](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [How we built our multi-agent research system — Anthropic (2025)](https://www.anthropic.com/engineering/multi-agent-research-system)
- [Claude Agent SDK overview — Claude Code Docs](https://code.claude.com/docs/en/agent-sdk/overview)
- [Code Mode: give agents an entire API in 1,000 tokens — Cloudflare (2025)](https://blog.cloudflare.com/code-mode-mcp/)
- [Code execution with MCP: building more efficient AI agents — Anthropic (2025)](https://www.anthropic.com/engineering/code-execution-with-mcp)
- [GEPA: Reflective Prompt Evolution Can Outperform Reinforcement Learning — arXiv 2507.19457 (ICLR 2026 oral)](https://arxiv.org/abs/2507.19457)
- [Darwin Gödel Machine: Open-Ended Evolution of Self-Improving Agents — arXiv 2505.22954](https://arxiv.org/abs/2505.22954)
- [PACE: Anytime-Valid Acceptance Tests for Self-Evolving Agents — arXiv 2606.08106](https://arxiv.org/pdf/2606.08106)
- [Improving Retrospective Language Agents (RetroAct) — arXiv 2503.01490](https://arxiv.org/pdf/2503.01490)
- [Planner-Executor Agentic Framework — EmergentMind](https://www.emergentmind.com/topics/planner-executor-agentic-framework)
- [Inside the Scaffold: A Source-Code Taxonomy of Coding Agent Architectures — arXiv 2604.03515](https://arxiv.org/pdf/2604.03515)

## FILTER
## Filter: harness-engineering

I read SYSTEM.md, GLOSSARY.md, and doc 12 (the harness-engineering doc this proposal modifies). Verdict up front: **this is the strongest-integrated of the frontier proposals** — every feature actually plugs into a named part of baton (brief / coordinator / worker-tool / LOG / trust gate), and the author did the integration work instead of floating cool ideas. The core problem is **over-labeling**: three features share one mechanism and get counted as three moats, and two "moats" are really bets. Also one citation is wrong and three obvious SOTA systems are missing.

### Citation audit (verified against sources)
- **GEPA (2507.19457)** — REAL, numbers accurate: 6–20% over GRPO, 35× fewer rollouts, Pareto front, ICLR 2026 oral. Good.
- **Darwin Gödel Machine (2505.22954)** — REAL, 20→50% SWE-bench confirmed, sandbox+human-oversight caveat real. Good.
- **Anemoi — MISCITED.** The proposal claims "+9pp pass@3" and gives no correct arxiv ID (the 2503.01490 link is RetroAct, not Anemoi). Real paper is **2508.17068**, and the real result is **52.73% vs OWL 47.27% on GAIA = +5.46pp**, not pass@3, not +9pp. The claim is inflated and mislabeled. **Fix the number or drop it** — it's load-bearing for the #5 decorrelation argument, so a wrong stat there is a credibility hole.
- Anthropic multi-agent (90.2% / 15× tokens / 80% variance) and Cloudflare Code Mode / code-execution-with-MCP figures check out as real and match doc 12's own citations.

### Missed SOTA (matters)
1. **DSPy.** #1 (compile a structured contract with typed fields) and #7 (optimize prompts from labeled outcomes) are *exactly* DSPy signatures + optimizers — and GEPA ships **inside** DSPy. Not naming it is a real gap: the "brief compiler" isn't novel plumbing, it's DSPy discipline applied to cross-vendor briefs. Cite it, and the novelty claim narrows honestly to "cross-vendor."
2. **Cognition, "Don't Build Multi-Agents" (Walden Yan, 2025).** The proposal leans hard on Anthropic's multi-agent *win* and never engages the loudest, most credible *counter* — from the people who built Devin — that multi-agent systems are fragile because decisions disperse and context doesn't share. For a proposal that prides itself on honest bets, omitting the strongest opposing evidence on #5/#6 is a tell. 5 of 10 sources are Anthropic; for a cross-vendor driver, that's a worldview-bias risk worth naming.
3. **Voyager** — #8 is literally "Voyager's skill library re-grounded on the trust gate," which doc 12 §4 *already says by name*, yet #8 doesn't cite it. Uncited reinvention of your own doc's framing.

### Per-feature verdicts

**#1 Brief compiler / delegation contract — KEEP (build first), MODIFY the label.** This is the real MVP win. But it's not one clean "moat." Split it: the **"done = the exact command the trust gate re-runs" binding is the moat** (model-independent, it's the trust gate's interface, and it stops a worker redefining done — which SYSTEM.md calls the project's center of gravity). The **per-vendor dialect rendering is rental** — vendors are converging (AGENTS.md standard, doc 12 §2) and a better model needs less hand-holding. Calling the whole thing "moat" over-claims. Integration with path leases (§4.1) is correct and real.

**#2 Plan-gate — KEEP, MODIFY (honesty + vendor caveat).** "Moat leaning rental" is close, but lean it further toward rental: Claude already ships plan-mode, Codex plans natively, and models plan better every release — the gate fires less over time. The permanent core ("catching wrong direction early is cheaper than re-verifying garbage") is real, keep it. **Missing caveat:** pausing a worker *between plan and execution* is exactly the interrupt/steer reliability that SYSTEM.md §4.4 says is only fully dependable on Codex — Claude/GLM emulate it and lose in-flight work. So #2's cost differs by vendor and the proposal doesn't say so.

**#3 Structured task-ledger — KEEP, MODIFY the label.** Same correction as #1: the ledger *format* is SOTA-adoption (Anthropic's init.sh/progress.txt/feature-JSON pattern — you're copying, not inventing), so that part is rental-ish. The **moat is that the ledger is a *commit* the trust gate reads against a pinned spec** — a worker flipping `passes=true` proves nothing. Note #1, #2, #3 are **one mechanism, not three**: *structured artifacts bound to the trust gate.* Count them as one moat with three surfaces, or the moat inventory is inflated 3×.

**#4 Code-mode tool bridge — KEEP, honest, correctly deferred.** "Rental-leaning, use don't out-engineer, Later once 2–3 tools exist" is exactly right and matches doc 12 §2's deferred-tool discipline. No change. This is the most honest label in the set.

**#5 Cross-vendor reflector — KEEP, strongest moat claim, but fix its evidence.** This is the *one* genuinely model-proof idea: decorrelated review is precisely what a single better base model cannot hand you. It also aligns with baton's *own* revised position — doc 12 §3 / doc 13 T3 already deflated cross-vendor best-of-N and kept "routing + cross-review (1×)" as the surviving cross-vendor asset. So #5 is the half baton already blessed. **But** the empirical case rests on the miscited Anemoi stat; the honest sizing is baton's own **E2 experiment** (does a different vendor catch bugs the same vendor misses), which SYSTEM.md §8 already lists as a cheap side-experiment. Verdict: keep as the highest-ROI review feature, run E2 before committing the full extra-vendor run per task.

**#6 Adaptive sub-agent shape — MODIFY, demote to bet.** Labeled "moat with a bet"; it's mostly bet, and a data-hungry one. Two honest problems the proposal underplays: (a) baton doesn't own the worker loop, so routing tracks the **requested** shape, not the **realized** one — the learning signal is contaminated by "did the worker even adopt the shape." (b) shape×vendor×task-type×model-version is a 4-D table; the routing doc (doc 20) already worries about sparse per-model data, and slicing further by shape risks never filling a cell. Keep as a Phase 3 *experiment*, relabel bet, and state the realized-vs-requested caveat.

**#7 Brief evolution from LOG (GEPA) — KEEP as a clearly-labeled bet.** Honest already ("worst case, template stays"). Two dependencies to state: it needs #1 (structured briefs) and a labeled LOG first, and it's DSPy/GEPA territory — the novelty is cross-vendor, which *also* means the training signal splits across vendors (less data per cell, same sparsity risk as #6). Cheap, safe, governed by A/B replay before promotion. Fine as Later.

**#8 Bounded ADAS skills — KEEP the governor, MODIFY the label + cite Voyager.** The decision to **decline unbounded self-modification of the coordinator/trust gate** is the single best judgment call in the proposal — that's the DGM frontier with its dangerous part correctly removed, and it matches SYSTEM.md §9's "measured not assumed." But the bounded version is a **bet, not a moat**: it's the Voyager skill-library pattern (cite it), and whether forged skills beat re-derivation is an open *measured* question baton's own doc 12 §4 insists on ("measure emergence or delete it"). Call it "governed bet," keep the non-goal.

**Beyond-frontier section — no independent value.** The three speculative bullets (LOG-as-training-set, harness-card-per-run, bounded self-designed tools) are just previews of #7, #6, #8. Harmless, but they're not separate ideas — don't let them pad the count.

### The one to build first
**#1 — the delegation-contract brief, built specifically around the "done = the pinned verification command the trust gate re-runs" field.** Reasons, in order:
1. **It's already MVP.** SYSTEM.md §8.1 promises re-verify + per-vendor briefs for the MVP; this supplies the one missing structured field that turns "done" into a **coordinator-owned command instead of worker prose** — which is the whole point of the trust gate (GLOSSARY: "worker prose is never trusted as fact").
2. **It hardens the project's center of gravity.** Doc 12's own review names the Referee/trust gate as the honest center. #1 is the input side of that gate.
3. **It's the prerequisite.** #7 can't evolve briefs that aren't structured; #2 and #3 are cheap add-ons once the contract exists. Build order falls out of it.
4. **It's the most model-independent piece** (the done↔gate binding is a moat; better models don't remove the need for an unambiguous, machine-checkable "done").

Build #1's done-command binding first. Fold #2 (plan-gate) and #3 (ledger) into it as the same structured-artifact mechanism rather than three features. Run the **E2** side-experiment to size #5 before building it. Treat #6, #7, #8 as honestly-labeled Later bets, and fix the Anemoi citation before anyone quotes it.

Sources: [GEPA 2507.19457](https://arxiv.org/abs/2507.19457), [Darwin Gödel Machine 2505.22954](https://arxiv.org/abs/2505.22954), [Anemoi 2508.17068](https://arxiv.org/abs/2508.17068) (the correct ID/stat the proposal got wrong).
