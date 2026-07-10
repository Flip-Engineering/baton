# Frontier research: context-engineering

## PROPOSAL
# Context engineering — frontier features for the fleet driver

Baton already has a serious context-engineering design (`docs/12-context-harness-engineering.md`): the `summary + handle + provenance` grammar, four provenance classes, the compaction firewall (recite-from-outside), deferred tool surfaces, and orchestrator-context protection via fan-out. That doc is genuinely at or near frontier for *2025*. The gap is that the 2026 literature moved from **summarize-to-shrink** to **structurally evict dead reasoning**, and surfaced a new safety failure (compaction erasing constraints) that baton's design gestures at but doesn't yet weaponize. Baton has one asset nobody else has for this: **the append-only LOG plus git worktrees give it a ground-truth record of which of a worker's actions are already committed to the world** — which is exactly the signal the newest eviction methods need and have to approximate. That's the wedge below.

## State of the art now (2025-26)

| System / technique | What it does | Why it matters for baton | Cite |
|---|---|---|---|
| **Anthropic context engineering** (curate the smallest high-signal token set; just-in-time retrieval by lightweight identifier) | Formalized the discipline; "hold identifiers, load at runtime" | This IS baton's push-minimal/pull-by-handle grammar (doc 12 §1a). Already adopted. | [Anthropic, Sep 2025](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) |
| **Context editing + memory tool** (Claude API) | Auto-clears stale tool calls/results; external memory file the model reads/writes | +29% (editing), +39% (with memory); 84% fewer tokens on a 100-turn eval. Validates active clearing, not just summarizing. | [Anthropic, Sep 29 2025](https://www.anthropic.com/news/context-management) |
| **Compaction API** (`compact-2026-01-12`) | Production automatic compaction across Bedrock/Vertex/Foundry | The harness-native compaction baton must *complement, not duplicate* (its firewall is idempotent by content-hash). | Anthropic compaction API |
| **Beyond Compaction / Context Window Lifecycle (CWL)** | Types trajectory into **exploratory vs action episodes** with dependency links (a DAG); a **deterministic, LLM-free** policy evicts action episodes whose effects are *already persisted in the environment*, keeps user turns + active reasoning | The flagship 2026 idea, and a near-perfect fit: **git commit = "effect persisted."** No accuracy loss vs fresh sessions, 20-70% cheaper, zero hallucination-at-eviction. | [arXiv 2606.11213](https://arxiv.org/html/2606.11213) |
| **Governance Decay** | Shows compaction **silently deletes in-context safety constraints**, so an agent later does prohibited actions it earlier obeyed | Names the exact hole baton's firewall must plug: re-inject *constraints*, not just the goal. | [arXiv 2606.22528](https://arxiv.org/abs/2606.22528) |
| **Chroma "Context Rot"** | 18 frontier models all degrade with input length; non-uniform, lost-in-the-middle | Justifies capping effective context *below* the advertised max, per model. Already cited in doc 12. | [Chroma, Jul 2025](https://research.trychroma.com/context-rot) |
| **Agent Skills / progressive disclosure** (open standard Dec 18 2025) | Metadata-only at startup (50-100 tok/skill), full body on activation, references via filesystem | Baton's skill forge ships portable `SKILL.md`; the load pattern is the same "defer the surface" law. | [Anthropic Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) |
| **Code execution / tool search over MCP** | Compose tools on demand instead of dumping the catalog | 98% / 47% token cuts; the mechanism behind baton's deferred capability cards. | [Anthropic, Nov 2025](https://www.anthropic.com/engineering/code-execution-with-mcp) |
| **Mem0 / Letta (MemGPT) / A-MEM** | External memory layers: incremental fact store (Mem0), OS-style paging (Letta), Zettelkasten-linked evolving notes (A-MEM) | The slow-memory market baton *promotes into* rather than reinvents; A-MEM's linked notes ≈ baton's findings graph. | [Mem0/Letta compare](https://vectorize.io/articles/mem0-vs-letta); A-MEM |
| **Orchestrator + isolated subagents** (Anthropic Research +90%/15× tokens; Cognition "Don't build multi-agents") | Each subagent its own window, returns one distilled string; Cognition warns coordination is the failure mode | Baton is the Anthropic pattern — but the **worktree already IS the context-isolation boundary**, and the **trust gate answers Cognition's objection** (results are re-checked, not trusted). | [Anthropic multi-agent](https://www.anthropic.com/engineering/multi-agent-research-system); [Cognition](https://cognition.ai/blog/dont-build-multi-agents) |
| **Manus lessons** | KV-cache-stable prefix, filesystem-as-unbounded-context, recitation to keep goals alive | Baton *can't* trust a worker to recite → recites from outside. Already the firewall's basis. | [Manus, 2025](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus) |

## Beyond-frontier ideas (clearly labeled speculation)

- **Eviction driven by ground truth, not annotation.** CWL asks the *worker* to tag its own episodes with a delimiter tool. Baton doesn't need to — it can derive the episode DAG **from its own LOG**, and it knows definitively which action episodes are "persisted" because it sees the git commits land in the worktree. This turns a cooperative, self-reported scheme into an observed, adversary-safe one.
- **Phase-reshaping context.** The composer swaps context *templates* as a task moves through phases (orient → implement → verify → fix), detected from the event stream (first edit = implement began; first test run = verify began). Each phase pushes a different minimal set and evicts the previous phase's scaffolding. Context that reshapes itself across a task's life.
- **Counterfactual context tuning.** Because the LOG is the only truth, replay a finished run with a *leaner or differently-typed* brief and measure whether it still passes the trust gate with fewer tokens/loops — automated brief improvement, not hand-tuning.
- **Contradiction-gated memory.** A recalled memory ("the test command is `mise exec -- mix test`") enters context as a `trusted_fact` only if it survives a cheap re-check against current repo state; stale memories are down-typed to `untrusted_prose` or evicted, not injected as fact.

## Proposed features for baton (the actionable core)

### 1. Episode-typed LOG with deterministic, git-aware eviction (the flagship)
- **What**: The coordinator annotates each worker's event stream into typed episodes (exploratory reads/searches vs. action edits/commits) with dependency links, forming a DAG it can evict from cheaply and losslessly-by-construction.
- **How it plugs in**: **Coordinator feature + context/brief.** The episodes are computed from `BatonEvent`s that already flow into the LOG — no new worker cooperation needed. Eviction uses CWL's LLM-free priority policy, with baton's unique twist: **an action episode is "safe to shed" precisely when its edit is already a git commit in the worktree** (baton observes this directly; CWL has to trust a self-report). Every re-injection, resume digest, and orchestrator digest is composed from an *evicted view* of the LOG. Respects worktrees (git commit = the persistence signal) and the trust gate (eviction never touches the committed result the referee re-checks).
- **Frontier or beyond**: SOTA-adoption of CWL + **novel** grounding on git/LOG.
- **Moat / bet / rental**: **Moat.** It exploits baton's structural advantage (owning the LOG + worktrees). Better base models still degrade with length (context rot is architectural), so deterministic eviction keeps paying.
- **MVP or later**: **Later, but the highest-value later.** MVP ships the firewall; this is the first Phase-3/4 upgrade.

### 2. Governance-firewall: re-inject constraints, not just the goal
- **What**: On compaction, baton re-injects the brief's *safety constraints, path leases, and approval rules* — not only the goal — so a compacted worker can't quietly lose the rules it earlier obeyed.
- **How it plugs in**: **Context/brief (extends the compaction firewall, doc 12 §1c).** Same `session_compacted` hook, same content-hash idempotence, but the payload now carries the `system`-class constraints. The re-injection event lands in the LOG (so you can audit that constraints were live at every step); the OS sandbox + trust gate remain the actual wall — this keeps the worker *aligned* in-context so it stops fighting the wall.
- **Frontier or beyond**: **SOTA-adoption** — directly implements the Governance Decay fix.
- **Moat / bet / rental**: **Moat.** It's a safety property, not a capability a smarter model obviates; if anything, more-autonomous workers make it more necessary.
- **MVP or later**: **MVP-adjacent.** The firewall is already MVP-ish; adding constraints to its payload is small and high-safety-value.

### 3. `recall(handle)` — just-in-time context as a worker tool
- **What**: One worker tool that fetches bulky context (a prior diff, an orientation map, a peer's blackboard note, a recalled memory) *only when the worker reaches for it*, returning `summary + payload + provenance`.
- **How it plugs in**: **Worker tool.** It's the pull side of push-minimal made concrete, and it's a capability card like any other (deferred-loadable). Every recall is a LOG event tagged with provenance, so the contagion tracker (doc 09 §C) can trace who read a later-poisoned fact. Payloads come from the shared, indexed stores (code search, orientation, memory) — no per-worker re-fetch.
- **Frontier or beyond**: **SOTA-adoption** (Anthropic just-in-time; code-execution-over-MCP).
- **Moat / bet / rental**: **Rental-ish** — vendors are building native versions. Keep it thin and swappable; the value is the *provenance typing on the way in*, which is the durable part.
- **MVP or later**: **MVP-adjacent.** Small surface, big context savings.

### 4. Contradiction-gated memory recall
- **What**: A recalled fact or skill enters as a trusted `trusted_fact` only after a cheap check that it still holds against current repo state; otherwise it's down-typed or evicted.
- **How it plugs in**: **Coordinator feature, wired to the trust gate.** This makes memory recall a *typed injection* rather than a paste: the check reuses the same re-verification machinery (run the recalled command, confirm the file still exists, diff the assumption). Skills already require hub-run verification before adoption (doc 12 §4); this extends that discipline to *recall time*, not just *authoring time*. Result of the check is a LOG event.
- **Frontier or beyond**: **Novel** — A-MEM/Mem0 do linked/dedup'd recall but none gate injection on live re-verification; that's baton's trust model applied to memory.
- **Moat / bet / rental**: **Moat.** The trust gate is baton's center of gravity; putting it in front of memory is exactly where models *won't* help (a smarter worker still can't tell a stale fact from a fresh one without checking).
- **MVP or later**: **Later** (rides on the memory subsystem, which is itself Later).

### 5. Context-rot budget + a "context-bloat" warning signal
- **What**: The composer caps effective injected context *below* each model's empirical degradation cliff (from the harness card, not its advertised max), and raises a `context-bloat` warning when a worker's own window nears that cliff.
- **How it plugs in**: **Telemetry + context/brief.** `context-bloat` joins the existing warning signals (stalled/looping/over-budget/out-of-scope) in the story monitor; when it fires, the coordinator can recommend a **fresh-worktree handoff** (spawn a clean worker seeded with the evicted digest) rather than letting the current one rot. Budget derivation is per-harness/model, measured (doc 12 open-Q4), never a hardcoded constant — consistent with baton's "no arbitrary numeric limits" rule.
- **Frontier or beyond**: **SOTA-adoption** (Chroma; MatClaw's conservative 200k-of-1M capping).
- **Moat / bet / rental**: **Rental** on the cap itself (vendors will auto-manage), **moat** on the *handoff* (spawning a clean-context successor mid-task is a fleet-driver move, not a single-agent one).
- **MVP or later**: **MVP-adjacent** as a warning signal; the auto-handoff is Later.

### 6. Phase-reshaping briefs
- **What**: The context template swaps as a task moves through orient → implement → verify → fix, each phase pushing a different minimal set and evicting the last phase's scaffolding.
- **How it plugs in**: **Context/brief + coordinator feature.** Phase is inferred from LOG events (first edit, first test run); each transition is a LOG event and triggers a re-compose. It composes cleanly with feature #1 (phase transition is a natural eviction boundary — orientation reads become sheddable once implementation is committed).
- **Frontier or beyond**: **Novel** (beyond-frontier).
- **Moat / bet / rental**: **Bet.** Unproven that phase-tailored context beats a good static brief enough to justify the machinery; measure it (a skill earns residence only if it beats the baseline — same discipline as doc 12 §4).
- **MVP or later**: **Later**, and only if #1 shows the eviction plumbing pays off.

### 7. Counterfactual context tuning (replay-driven brief improvement)
- **What**: Replay a finished run with a leaner/differently-typed brief and check whether it still passes the trust gate with fewer tokens or loops — automated brief improvement.
- **How it plugs in**: **Coordinator feature, free from the LOG** (rule 5: replay any run). The tuned brief that wins feeds the routing scorecard; nothing touches a live worktree — replays run in throwaway worktrees, verdicts from the trust gate.
- **Frontier or beyond**: **Novel.**
- **Moat / bet / rental**: **Bet**, but cheap because replay is already free. Stays valuable as a *measurement* tool even as models improve.
- **MVP or later**: **Later** (needs replay + scorecard first).

## Add / subtract / modify

**ADD**
- **The episode-typed eviction layer (feature #1)** is the single most important addition this area suggests — it upgrades the compaction firewall from "re-inject the goal after the harness compacts" to "baton maintains its own clean, deterministically-evicted view of each worker's history and composes from *that*." It's the 2026 frontier and it fits baton's LOG+git better than it fits anyone else.
- **Constraint re-injection (feature #2)** and the **`context-bloat` signal (feature #5)** are small, safety-and-reliability wins that belong in or right after the MVP.

**MODIFY**
- **Doc 12's compaction firewall is scoped to "brief-identity + resume digest."** Widen its charter to (a) safety constraints (Governance Decay) and (b) an *evicted* resume digest rather than a summarized one — deterministic eviction beats LLM summarization on cost, structure, and the hallucination-at-worst-moment failure the CWL paper documents.
- **Doc 12 §3's "best-of-N across vendors is the ensemble asset" was already deflated by doc 13** (routing 1× + cross-review 1× is the real value, not best-of-N). Nothing here revives it; keep it deflated. This area *reinforces* that stance — context isolation per worker is for cleanliness and parallelism, not for cheap N-sampling.

**SUBTRACT / don't build**
- **Don't build a bespoke baton memory store** to rival Mem0/Letta/A-MEM. Doc 12 already says "promote into, don't reinvent" — hold that line. Baton's differentiated contribution is the **provenance typing on inject** and the **contradiction gate (feature #4)**, not the storage engine. Ship those as a thin layer over whatever memory system the user already runs.
- **Resist worker-cooperative episode tagging** (CWL's self-report delimiter tool). Baton should derive episodes from the LOG it observes, because a worker's self-report is `untrusted_prose` and an adversarial worker could mis-tag to keep doctored context alive. Observe, don't ask.

## Sources
- [Anthropic — Effective context engineering for AI agents (Sep 2025)](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Anthropic — Context management: editing + memory tool (Sep 29 2025)](https://www.anthropic.com/news/context-management)
- [Anthropic — Equipping agents for the real world with Agent Skills (Oct 2025 / open standard Dec 18 2025)](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- [Anthropic — Code execution with MCP (Nov 2025)](https://www.anthropic.com/engineering/code-execution-with-mcp)
- [Anthropic — Multi-agent research system (Apr 2025)](https://www.anthropic.com/engineering/multi-agent-research-system)
- [Beyond Compaction: Structured Context Eviction for Long-Horizon Agents / CWL (arXiv 2606.11213)](https://arxiv.org/html/2606.11213)
- [Governance Decay: How Context Compaction Silently Erases Safety Constraints (arXiv 2606.22528)](https://arxiv.org/abs/2606.22528)
- [Chroma — Context Rot (Jul 2025)](https://research.trychroma.com/context-rot)
- [Cognition — Don't Build Multi-Agents (Jun 2025)](https://cognition.ai/blog/dont-build-multi-agents)
- [Manus — Context Engineering for AI Agents: Lessons (2025)](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)
- [Mem0 vs Letta (MemGPT) comparison + LOCOMO/LongMemEval](https://vectorize.io/articles/mem0-vs-letta)
- A-MEM: Zettelkasten-style associative agent memory (arXiv 2502.12110)
- [Awesome-Agent-Memory (systems/benchmarks index)](https://github.com/TeleAI-UAGI/Awesome-Agent-Memory)

## FILTER
## Filter: context-engineering

I read `SYSTEM.md`, `GLOSSARY.md`, and `docs/12-context-harness-engineering.md`, and I checked the load-bearing citations myself. Verdict up front: this is one of the more honest proposals in the batch — the two flagship papers are real, the labeling is mostly straight, and the git-grounding wedge is genuinely baton's to take. But it overclaims "lossless," it mislabels one bet's cost, it misses two directly-relevant 2026 papers, and its "build first" pick is backwards from what the dependency structure actually demands.

**Citations verified as real (not fabricated future-dated arXiv):**
- CWL / "Beyond Compaction" — [arXiv 2606.11213](https://arxiv.org/abs/2606.11213), Semenov & Dorofeev. Real. And it confirms the proposal's key wedge: CWL **has the agent self-annotate** its episodes with a delimiter tool. Baton's "observe from the LOG, don't ask the worker" twist is a genuine, correct improvement, not a paraphrase.
- Governance Decay — [arXiv 2606.22528](https://arxiv.org/abs/2606.22528). Real. 0%→30% (up to 59%) violation post-compaction across 1,323 episodes, plus a **Compaction-Eviction Attack** (adversarial content biases the summarizer to drop a policy). Its own proposed fix is **Constraint Pinning** — which is essentially feature #2, so #2 is adoption, not invention (proposal labels it honestly).

---

### Per-feature verdicts

**#1 — Episode-typed LOG + git-aware eviction (the flagship): KEEP, with two honesty fixes.**
Real and the best idea here. It plugs in cleanly (coordinator feature over `BatonEvent`s already in the LOG; commit = persistence signal; eviction never touches the committed artifact the referee re-checks). The moat claim survives — context rot is architectural, so deterministic eviction keeps paying as models improve. Two things to fix:
- **"Losslessly-by-construction" is overclaimed.** A committed edit persists the *state*, not the *intent*. Shedding the reasoning that explains a committed change is not lossless if that change later needs revising — CWL itself keeps active reasoning for exactly this reason. Say "lossless for state re-derivation," not "lossless."
- **Scope the moat honestly.** Baton doesn't own the worker's live window; Codex/Claude compact it however they like. So this layer governs only what baton *injects* — re-injection payloads, resume digests, orchestrator digests — not the worker's in-flight context. Still valuable, but narrower than "baton maintains a clean view of each worker's history." State that boundary.

**#2 — Governance firewall (re-inject constraints, not just the goal): KEEP + MODIFY. This is the one to build first (see below).**
Directly implements a measured, exploitable hole. Fits the existing firewall exactly (same `session_compacted` hook, same content-hash idempotence, lands in LOG for audit). Modifications:
- **Do both pin *and* re-inject.** Governance Decay's fix is *pinning* (quarantine from compaction). Where baton controls the prefix (`system` class, KV-pinned), pin it — that's strictly better than restore-after-loss. Where baton only appends via hooks (it doesn't own the window), re-inject. The proposal only describes re-injection; add pinning for the surface baton controls.
- **Missed refinement — prioritize the "don'ts."** [arXiv 2604.20911](https://arxiv.org/pdf/2604.20911) ("Omission Constraints Decay While Commission Constraints Persist") shows *prohibitions* ("don't push," "don't touch payments/") decay under compaction while "do X" survives. Baton's **path leases and push-gating are omission constraints** — precisely the ones that vanish. Re-injection should put prohibitions and leases first. This is a concrete, free sharpening the proposal missed.
- **Honesty on moat:** it's a moat *for baton's position* (it drives windows it doesn't own, so must re-inject externally forever), but Constraint Pinning is a training-free harness fix vendors will ship natively. Call it that, not a general moat.

**#3 — `recall(handle)` worker tool: KEEP, thin. Honest rental.**
Correctly self-labeled "rental-ish." Vendors ship native just-in-time retrieval. The durable part is the provenance-typing on the way in (feeds the contagion tracker). Keep it a swappable thin wrapper; don't invest deep.

**#4 — Contradiction-gated memory recall: KEEP. Genuine moat.**
This is baton's trust thesis applied to memory: a recalled fact is `untrusted_prose` until re-checked against the live repo, then it earns `trusted_fact`. A smarter worker still can't tell stale from fresh without checking — so models won't obviate it. Fits the reverify machinery and the trust gate. One addition: give it a **check-cost ladder** mirroring the verify ladder (file-exists = cheap, re-run-the-command = expensive), or frequent recall gets pricey. Later, rides the memory subsystem.

**#5 — Context-rot budget + `context-bloat` signal: KEEP. The handoff is the valuable half.**
Honest split — rental on the cap (vendors auto-manage length), moat on the **fresh-worktree handoff** (spawning a clean-context successor seeded with the evicted digest is a fleet-driver move a single agent can't make). Correctly ties the cap to measured per-model degradation, not a hardcoded constant (respects the "no arbitrary numeric limits" rule). The signal is MVP-adjacent; the auto-handoff is the differentiated Later.

**#6 — Phase-reshaping briefs: MODIFY down to the mechanical half; be skeptical of the rest.**
Honestly labeled Bet. But it **partially violates baton's own law** (doc 12 §4: scaffold what+verify, not *how*). Templating context by phase (orient→implement→verify→fix) encodes a workflow a strong model routes around on its own — that's how-scaffolding a better model obsoletes. Keep only the *mechanical* use: phase transitions as natural **eviction boundaries** for #1 (orientation reads become sheddable once implementation commits). Drop, or heavily discount, the *content-reshaping* use until measured. Lowest priority.

**#7 — Counterfactual context tuning: KEEP, but correct the cost lie.**
"Free from the LOG / cheap because replay is already free" is **wrong**. Re-reading the log is free; testing a *different* brief requires **re-executing with a live worker** (the trajectory changes — you can't replay it from the log), which is non-deterministic and costs real tokens. The proposal even says "replays run in throwaway worktrees" — so it means re-execution, then mislabels it as free replay. Fix the framing: it's re-execution cost, worth it as an offline measurement tool, not a free lunch. Fits cleanly otherwise (throwaway worktrees, verdict from trust gate, feeds the scorecard). Later.

---

### SOTA it missed

1. **Slipstream — Trajectory-Grounded Compaction Validation ([arXiv 2605.08580](https://arxiv.org/abs/2605.08580)).** The big miss. Slipstream runs compaction *asynchronously in parallel* with continued execution on the original context, then a judge validates the summary against the agent's own continued reasoning as ground truth — checking the summary preserves "forward intent and the key facts and constraints it depends on." This is **the trust-gate pattern applied to compaction itself**, and it pairs directly with baton's firewall and #2: baton could *validate* that a compaction didn't drop a constraint before believing it, rather than only blindly re-injecting. It also independently motivates re-injecting constraints (it names them as the thing to preserve). The proposal should absorb this as the "verify the compaction, don't just patch it" layer.
2. **Omission-vs-commission constraint decay ([arXiv 2604.20911](https://arxiv.org/pdf/2604.20911)).** Covered under #2 — tells you *which* constraints to re-inject first (the prohibitions/leases).

---

### The one to build first: #2 (constraint re-injection + pinning) — and it's a prerequisite, not just a quick win

The proposal nominates #1 as the highest-value item and treats #2 as a small MVP-adjacent nicety. The dependency structure says otherwise: **#2 is an invariant that #1 must not violate.** If you build deterministic eviction (#1) *before* the governance firewall, your own eviction policy becomes a new way to silently drop a constraint — you'd be re-implementing the exact Governance Decay bug inside baton's coordinator, and the Compaction-Eviction Attack shows it's adversarially triggerable. So "constraints are pinned/re-injected across *any* context reduction" has to be true before baton is allowed to reduce context at all.

On its own merits #2 also wins on value-per-effort: it rides an already-planned firewall (small delta), closes a *measured, exploitable* hole (0%→up to 59% violations; a working attack), and targets exactly the constraints baton depends on for safety — path leases and push-gating, which are the omission constraints the literature shows decay worst. For a system whose whole pitch is driving autonomous cross-vendor workers you can trust, a compacted worker quietly forgetting "don't push" is a real incident, not a polish item.

Build order: **#2 first** (pin what you own, re-inject the prohibitions first, log that constraints were live at every step), then **#1** (the actual frontier move and the durable moat, now safe because eviction can't shed a constraint), with **Slipstream-style validation** as the bridge between them. #3/#5-signal are cheap MVP-adjacent adds; #4/#5-handoff/#7 are honest Laters; #6 is a bet to measure, kept only as an eviction-boundary heuristic.

Sources: [Beyond Compaction/CWL (2606.11213)](https://arxiv.org/abs/2606.11213), [Governance Decay (2606.22528)](https://arxiv.org/abs/2606.22528), [Slipstream (2605.08580)](https://arxiv.org/abs/2605.08580), [Omission vs Commission constraint decay (2604.20911)](https://arxiv.org/pdf/2604.20911).
