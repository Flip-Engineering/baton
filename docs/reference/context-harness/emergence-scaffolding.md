I have what I need. Writing the design doc now.

---

# Scaffolding for Emergent Capability — baton context/harness engineering

## Summary (5 bullets)

- **Emergence in baton is compositional, not mystical.** It comes from one mechanism: every capability, skill, and tool returns the *same* token-bounded ACI envelope (capability-plane §3), so any primitive pipes into any other (`refs`-as-Unix-pipes, §7). Capability the fleet "wasn't programmed for" = a composition path across verified primitives that no orchestrator brief specified. That's real mechanism (SWE-agent's ACI premise + Voyager's compositional skills), not hand-waving.
- **The reflexive loop is Voyager's three-part engine, re-grounded on baton's trust model.** Automatic curriculum (orchestrator briefs + cross-run scorecard, doc 08 §5) → skill authoring (a worker's reusable procedure) → **self-verification replaced by hub-run reverify (supervisor I7, capability-plane §6)** → registry admission → stigmergic adoption (doc 10 T3). Voyager gated skills with a GPT-4 critic; baton gates them with a *re-runnable proof-carrying artifact* — categorically stronger, and it's the guardrail that keeps emergence from becoming chaos.
- **A skill IS a capability module.** No new subsystem: a forged skill conforms to the capability card (§5), emits the envelope, is `reverify`-able, and is stored in the knowledge-plane skill registry (doc 10 T3). The "skill forge" is a capability that *produces capabilities*. This is how baton avoids the Cognition "multi-agent fragility" trap — skills spread through shared substrate (stigmergy), never through inter-agent chat.
- **Scaffold WHAT and VERIFICATION, never HOW.** The bitter-lesson / scaffolding-trap critique (Manus re-architected 5×; "every line of scaffolding is a bet you know better than the model") is aimed at *how*-scaffolding — hard-coded workflow paths. baton's scaffold is *what/interoperability/evidence/memory* scaffolding, which no single model call provides regardless of base-model strength. Skills are **data in a registry, not code in the harness** → the scaffold is meta-upgradeable (DGM-style archive) and rides the model wave instead of fighting it.
- **Emergence must be measured as a net win or it's just complexity.** A skill earns registry residence only if a reuse-vs-rederive counter (doc 08 §7 Q2) shows reuse beats re-derivation on cost *or* reliability; when a stronger base model makes reuse-value go negative, the skill is GC'd. The smallest honest demo (below): task 2 solved by *composing* a skill forged in task 1 — with the orchestrator never told the composition — and the scorecard proving the reuse was cheaper than re-authoring.

## Frontier practice

| Source / technique | The insight | 2025-26 status | What baton adopts |
|---|---|---|---|
| **Voyager** — Wang et al., NVIDIA/Caltech (arXiv 2305.16291, 2023) | Automatic curriculum + ever-growing **skill library of executable code** (retrieve-before-authoring) + **self-verification** → emergent skills; 3.3× items, 15.3× faster tech-tree; skills are temporally-extended, interpretable, compositional | Seminal; extended 2025-26 by **SAGE** (RL skill acquisition, Dec 2025) which refines skills by reward, not just admits-on-success | The three-part loop verbatim — but self-verification becomes **hub-run reverify** (I7), and skills conform to the capability card so they compose as ladders/pipelines (§7) |
| **SWE-agent / ACI** — Yang, Jimenez et al., Princeton (arXiv 2405.15793, NeurIPS 2024) | LM agents are a *new class of user*; build interfaces **for them**, not reused human tooling; ACI design dominates raw model strength | The founding citation of doc 10 T1; still the reference frame for agent-tool design | The entire capability-plane premise; "agent-shaped output or it's a bug" (§2 law 1) |
| **Anthropic — Writing tools for agents** (anthropic.com/engineering, Sep 2025) | Tools must be prompt-engineered like onboarding a new hire; **token-bounded** (Claude Code default 25k); namespaced; evaluated on real tasks | Current official guidance | The envelope's `summary`/`payload`/`refs` token-bounding *is* a "well-written tool"; the card is the tool spec, probed from the binary so it can't drift |
| **Anthropic — Effective context engineering** (Sep 2025) | Context is a *finite resource*; curate it; system prompt at the right **altitude**; just-in-time retrieval over pre-loading | Superseded prompt-engineering as the discipline (baton's stated frame) | Progressive disclosure of the registry; brief-at-altitude; the digest discipline (comms §6) |
| **Anthropic — Code execution with MCP + Tool Search** (Nov 2025; Simon Willison, Nov 4) | `defer_loading` tools + **progressive tool discovery via a filesystem**: 150k→2k tokens (98.7%); keep intermediate results out of context by writing code that orchestrates tools | Shipped Nov 2025 (Tool Search Tool, Programmatic Tool Calling, Tool Use Examples) | Skill registry **as a filesystem the worker explores on demand**; envelope `refs` = keep pipeline intermediates out of context; a fleet skill catalog costs ~0 tokens until touched |
| **Anthropic — Agent Skills / SKILL.md** (open standard, Dec 18 2025; ~40 adopters incl. Codex, Gemini CLI, Cursor) | Skill = a directory + `SKILL.md`; **progressive disclosure** (metadata → body → resources); composable, portable filesystem skills | Open standard; Codex/Claude/Gemini all speak it by mid-2026 | The SKILL.md format is baton's **cross-harness lingua franca** for the registry — one skill artifact readable natively by a Codex *or* Claude *or* Gemini worker |
| **Manus — Context engineering** (Ji, Jul 2025) | KV-cache stability (stable prefix, append-only); **filesystem-as-context**; keep failed actions in context (they update the model's beliefs); logit-mask over dynamic tool loading | Widely-cited production playbook | Stable brief prefix (goal-pin survives compaction); artifact store as external memory (refs not payloads); **failed skills stay in the archive as DGM stepping-stones** |
| **Darwin Gödel Machine** — Sakana AI (arXiv 2505.22954, May 2025; ICLR 2026) | Open-ended **archive of self-improving coding agents**; keep *suboptimal stepping stones*; empirical gate (kept only if it still compiles + can edit); SWE-bench 20→50% | Current frontier of self-improving agents | The registry as a **stepping-stone archive** (not just a best-of cache); the "still compiles + edits" gate = baton's reverify gate; the forge as self-rewriting scaffold |
| **Cognition — "Don't build multi-agents"** (Yan, Jun 2025) | Naive multi-agent is fragile because sub-agents lack each other's context; prefer single-thread + a compression LLM | The counter-position to Anthropic's multi-agent stance; ongoing debate | baton's rebuttal is *structural*: coordinate through **shared substrate (T3), not shared chat**; non-authoritative results; hub-owned context — the multi-agent design that survives the critique |
| **Scaffolding-trap / Bitter Lesson** (Sutton 2019; lowtouch.ai, shanedeconinck.be, Sengottuvelu, 2025) | Scaffolding that encodes *how* becomes dead weight as models improve (Manus 5×; Anthropic strips Claude Code's harness); **but** weaker models gain most from scaffolding, and strongest-backbone + scaffold = best *absolute* | Live tension in 2025-26 agent engineering | Scaffold *what/verification/memory*, not *how*; **adaptive scaffolding per-harness** (more for GLM, less for Claude); skills-as-data so the scaffold is meta-upgradeable; GC on negative reuse-value |
| **Survey of self-evolving agents** (arXiv 2507.21046, Jul 2025) | The capacity/relevance tension: storing everything is cheap to write, expensive to *retrieve*; finding the right skill from an ever-growing archive is the real bottleneck | Frames the 2025-26 self-improvement literature | Retrieval-by-card (metadata-first progressive disclosure) + a hard GC policy; the registry is indexed for *selection*, not just accumulation |

## Design for baton

### Concrete mechanism — the skill-forge reflexive loop

The forge closes Voyager's loop onto baton's existing planes with **no new trust primitive**:

```
                       ┌─────────── CURRICULUM (knowledge plane, epistemic tempo) ──────────┐
                       │  cross-run scorecard (doc 08 §5): what failed, what routed, what     │
                       │  reused. The orchestrator reads DIGESTS to seed the next brief's     │
                       │  candidate-skill set. This IS the "automatic curriculum."            │
                       └─────────────────────────────────────────────────────────────────────┘
                                 │ seeds (comms channel, downward, minimal)         ▲ promotes
                                 ▼                                                  │ (scorecard row)
   worker solves task ──► authors reusable procedure ──► FORGE(op="skill.propose") ─┤
        (T1: ACI)                                            │                       │
                                                             ▼                       │
                                        hub reverify (I7): re-run the skill's own    │
                                        verification in a fresh sandbox. Deterministic│
                                        → exact re-run; non-det → seed replay/tolerance│
                                                             │ pass                   │
                                                             ▼                        │
                                   ADMIT to skill registry (knowledge plane, T3):     │
                                   SKILL.md + capability card (cost/latency/det/reverify)
                                                             │                        │
                                                             ▼  stigmergic read (T3, NOT a message)
                                   another worker DISCOVERS it, COMPOSES it ──────────┘
                                   (pipeline: skillA.refs → skillB.args by handle, §7)
                                                = emergent capability
```

Five load-bearing rules, each inherited (not invented):

1. **A skill = a capability module.** `skill.card()` returns the same card as any capability (§5): `{deterministic, side_effects, reverifiable, latency_class, cost_model}`. So the orchestrator's ladder/pipeline machinery (§7) treats a forged skill identically to `discovery.search` — zero special-casing is what lets forged and built-in primitives compose.
2. **Admission is reverify-gated.** `forge.skill.propose` does not admit on the worker's say-so. The hub re-runs the skill's declared verification (I7) in a *fresh* sandbox (never on the hub, doc 09 §C2). A skill that can't be re-verified never enters the registry. This is the single guardrail that makes emergence bounded: **the registry is a lattice of re-checkable claims, not a pile of asserted procedures.**
3. **Adoption is stigmergic (T3), never messaged.** No worker is told "use skill X" over the comms channel (that's expensive AAI, doc 10 T2). Workers *read* the registry — the knowledge-plane medium — exactly as ants read pheromone. The brief may *seed* a candidate set (curriculum), but the composition is the worker's own read+choice.
4. **Storage is the DGM archive, not a best-of cache.** Suboptimal / superseded skills stay as **stepping stones** with `Supersedes` edges (doc 08's PM edge vocabulary). A worse skill can be the parent of a breakthrough composition. Failed forge attempts stay too (Manus: errors-in-context update beliefs).
5. **Residence is earned continuously.** Each skill carries a per-skill win/loss + reuse-vs-rederive counter (doc 08 §7 Q2) in the scorecard. When a base-model upgrade makes a skill's reuse-value go negative (re-deriving is cheaper/more reliable than discovering+adapting), it's GC'd. **This is the falsifiable defense against "the library is just complexity."**

Interfaces (conform to capability-plane §1):

```ts
// The forge is itself a Capability. It produces Capabilities.
interface SkillForge extends Capability {
  // op: "skill.propose" — worker submits a reusable procedure + its self-verification
  //   args: { name, body_ref: art, card: CapabilityCard, verification: {command, expect} }
  //   → hub reverify → AciResult{ status: "ok"|"error", refs:[skill_handle], summary:"admitted|rejected: <reason>" }
  // op: "skill.search" — metadata-first discovery (progressive disclosure), NOT bodies
  //   args: { query, budget }  → AciResult{ payload:[{name, card, when_to_use, reuse_stats}], refs:[...] }
  // op: "skill.load"  — fetch one skill body by handle, on demand (defer_loading semantics)
  // op: "skill.gc"    — policy op: retire skills whose reuse-value counter went negative
}
```

### Per-harness adaptation

The **conceptual surface is uniform** (one registry, one envelope, one card); the **presentation is per-harness**, and — critically — the *amount* of scaffolding is tuned to base-model strength, exactly as the bitter-lesson research prescribes (weaker model → more scaffold).

| | **Claude worker** | **Codex worker** | **GLM worker** | **Orchestrator** |
|---|---|---|---|---|
| Registry surface | Native **Agent Skills dir** — the registry mounts as `.claude/skills/`, `SKILL.md` progressive disclosure works out of the box (Claude Code is the reference impl) | **Code-execution-with-MCP filesystem** — registry exposed as `./skills/` the Codex agent lists+reads on demand (Tool Search / `defer_loading`); Codex adopted the Skills standard | **Pre-curated** — GLM is weaker at self-directed discovery, so baton injects a *small* candidate-skill set (2-4) resolved into the brief, more `payload`, less exploration | **Digests only** (§Q4) — skill *cards* + reuse stats, never bodies; avoids drowning while composing curricula |
| Compaction survival | `PreCompact` hook re-injects the **skill-frontier digest** (not bodies) + goal-pin | Re-inject a **registry pointer** on Codex's compaction; skills live on the filesystem, so context stays a pointer | Registry pointer + candidate set re-seeded on each brief turn | N/A (hub-owned context) |
| Scaffolding stance | *Autonomy* — seed candidates, let it discover/compose (strong base model → thin scaffold, per bitter lesson) | *Autonomy* — progressive discovery is Codex-native | *Guidance* — more candidates, explicit "compose A then B" hint in the brief (weak model → thick scaffold) | *Meta* — decides forge triggers + curriculum |
| Brief dialect | `brief_template: "claude-v2"` | `brief_template: "codex-v2"` (the `gpt-5-4-prompting` skill translates) | `brief_template: "glm-v1"` | authors all three |

The asymmetry is the point: **baton spends scaffolding where the model is weak and withdraws it where the model is strong.** As any worker's base model improves, its brief-template automatically shifts from "compose A then B" toward "here's the goal and the registry, go" — the scaffold self-thins, dodging the scaffolding trap without a rewrite.

### How it ties to the three planes + the ACI envelope + the two channels

This design *is* the three planes turned reflexive — it does not float beside them:

- **Capability plane (T1):** a skill is a capability module (same card §5, same envelope §3, same `reverify` §6). The forge produces capabilities. Emergence rides on §7 composition (ladders + `refs`-pipelines). **The ACI envelope's uniformity is the enabling primitive:** because every skill consumes and emits the identical `{summary, payload, refs, cursor, provenance}` shape, skill A's `refs` are skill B's input by handle — *without either's data entering an agent's context*. That is literally "Unix pipes for agents," and it is why compositions the orchestrator never wrote are *possible* rather than merely hoped-for.
- **Knowledge plane (T3, doc 08):** the registry is a knowledge-plane medium; adoption is stigmergic. Forged skills climb the three tempos: authored (operational ledger event `capability.op.completed`) → admitted (coordinative: a registry row + `Supersedes`/`Informed` edges) → curriculum (epistemic: the cross-run scorecard's reuse stats). The scorecard *is* Voyager's automatic curriculum, persisted across runs — cross-run stigmergy (doc 10 §6 Q2, "agent-time-agent").
- **Control plane:** admission is I7-gated (the forge cannot be forged). Skill ops are fenced by `(worker, turn_epoch)` and interruptible — a runaway self-authoring loop is a `task`-class op the steering channel can `cancel` (§1 law 3). The forge respects the same two-phase stop as any long op.
- **Two channels:** curriculum seeding is a **comms-channel** brief field (downward, minimal — the candidate-skill *handles*, not bodies). Adoption is a **knowledge-plane read**, not a message — keeping AAI minimized (doc 10 T2). The **steering channel** is the emergency brake on a forge loop. A worker never learns a skill by being messaged it; it learns by reading the medium. This is the doc 10 bet (stigmergy > messaging) applied to capability propagation.

### A concrete example of what an agent actually receives

**Run 2, worker w7 (Claude), task = "add auth to endpoint `/orders`."** Its full downward context (nothing else — no orchestrator transcript, doc 06 Q6):

```jsonc
// 1. The brief (comms channel, §3) — candidate skills SEEDED as handles, not inlined bodies
{ "goal": "Add authentication to POST /orders",
  "path_scope": ["src/api/**"],
  "definition_of_done": "unauthenticated request → 401; authed → passes; existing tests green",
  "verification": { "command": "pytest tests/api/test_orders.py", "expect_exit": 0 },
  "orientation_ref": "art:sha256:9c1…",              // repo-map by handle (capability-plane)
  "skill_candidates": ["skill:mw.apply@0.2"],        // ← curriculum seed: 1 handle, ~0 tokens
  "brief_template": "claude-v2" }
```

```jsonc
// 2. w7 does skill.search (progressive disclosure) — gets METADATA, not bodies (~120 tokens)
{ "op": "skill.search", "status": "ok",
  "summary": "2 skills match 'middleware/auth'; mw.apply forged run1 by w3, reused 4×",
  "payload": [
    { "name": "mw.apply", "when_to_use": "insert a middleware around an endpoint handler",
      "card": { "deterministic": true, "side_effects": "edits_worktree", "reverifiable": true },
      "reuse_stats": { "uses": 4, "reuse_beats_rederive": true, "median_saved": "3.1k tok" } },
    { "name": "auth.jwt_guard", "when_to_use": "…", "reuse_stats": { "uses": 1, … } } ],
  "refs": [ { "handle": "art:…", "kind": "full_registry_page" } ] }
```

w7 — never told "auth is a middleware problem" — composes `discovery.search("/orders handler")` → `mw.apply(handler, auth.jwt_guard)`. It pipes handles, not data (§7). The result envelope it emits upward:

```jsonc
{ "op": "skill.compose", "status": "ok",
  "summary": "wrapped /orders in jwt_guard via mw.apply; 401 on unauth, tests green",
  "refs": [ { "handle": "art:…", "kind": "diff" } ],
  "provenance": { "composed_of": ["skill:mw.apply@0.2","skill:auth.jwt_guard@0.1","discovery.search"],
                  "deterministic": true } }
```

**Same task, Codex worker** — identical *conceptual* surface, different presentation. No `skill_candidates` inlined; instead the brief points at a filesystem and Codex progressively discovers:

```
$ ls ./skills/                    # Tool Search / defer_loading — costs tokens only when explored
mw.apply/  auth.jwt_guard/  ...
$ cat ./skills/mw.apply/SKILL.md  # metadata → body on demand (code-execution-with-MCP)
---
name: mw.apply
description: Insert a middleware around an endpoint handler. Use for auth, rate-limit, logging.
reverifiable: true
---
```

**Same task, GLM worker** — thicker scaffold (weak base model → more help, per the bitter-lesson evidence). The brief pre-resolves the composition hint: `"skill_plan": ["discovery.search '/orders handler'", "mw.apply(handler, auth.jwt_guard)"]` and inlines the two skill bodies rather than making GLM discover them.

**What the orchestrator sees** (digest only, §Q4): `{ "w7": { "kind":"skill.compose", "reused":["mw.apply"], "authored":0, "budget":"41%" } }` — enough to update the curriculum (mw.apply's reuse counter ticks to 5), never the skill bodies.

## The emergence / interoperability angle

**What the fleet was explicitly built for:** solve individually-briefed tasks with re-run-verified results.

**What emerges without being programmed:**

1. **Cross-task capability transfer.** `mw.apply` was forged solving a *rate-limiting* task (run 1). It solved an *auth* task (run 2) by composition — the orchestrator never encoded "auth = middleware." The transfer path is a stigmergic read + a §7 pipeline, both generic primitives. This is Voyager's "compositional skills compound rapidly" at the *fleet* level, and it's the honest, smallest demonstrable unit of emergence: **one composition the orchestrator didn't specify, gated by verification, measured by the scorecard's reuse row.**

2. **A capability frontier that moves.** Define the frontier as {tasks the fleet solves by composition alone, no new authoring}. Voyager measured tech-tree milestones; baton measures the frontier's growth per run from the scorecard. A rising reuse-rate with flat authoring-rate *is* emergent capability, quantified — not a vibe.

3. **Self-improving scaffold (DGM-style).** Because skills are data, the forge lets the fleet extend its own capability surface. The archive keeps stepping stones, so a suboptimal skill can parent a breakthrough. The scaffold rewrites itself in the registry, not in baton's code — the property that lets it ride model improvements instead of being obsoleted by them.

4. **Why simple interoperable primitives suffice.** The *only* things baton hand-built are: the envelope (one output shape), the card (one negotiation shape), reverify (one trust gate), and the stigmergic media (ledger/registry/index). Everything emergent — ladders, pipelines, cross-task transfer, a moving frontier — falls out of composing those four uniform primitives. This is the stigmergy-as-emergence thesis (doc 10 T3): local read/write interactions against shared structure yield global fleet behavior no one authored. Ants → cathedrals; verified skills → capability transfer.

The interoperability claim is precise: **uniformity of interface is the substrate of emergence.** Heterogeneous tools (rg, an LSP, z3, a browser, a forged skill) that all speak the identical envelope are mutually composable by construction; a fleet of Codex + Claude + GLM workers that all read the same SKILL.md registry share capability without sharing a vendor. Emergence is not a feature baton adds — it's what a uniform, verified, stigmergic substrate *does* once you stop preventing it.

## Anti-patterns & honest limits

- **Over-scaffolding / the scaffolding trap (the central risk).** The strongest honest critique of this entire angle: a capable base model may re-derive `mw.apply` from scratch faster than discovering+adapting it, making the whole registry net-negative complexity — exactly what killed hand-coded harnesses (Manus's 5 rewrites; Anthropic stripping Claude Code's scaffold). **Mitigation is falsifiable, not rhetorical:** the per-skill reuse-vs-rederive counter (doc 08 §7 Q2). A skill lives only while measured reuse beats measured re-derivation on cost *or* reliability; on a base-model upgrade the counters are re-evaluated and losers GC'd. If, across a run corpus, *most* skills show negative reuse-value, the honest conclusion is that the registry is not earning its keep for that model tier — and baton should thin toward "goal + tools, no library." Design *for* that outcome being detectable.
- **Context rot from an unbounded registry** (the survey's capacity/relevance tension, arXiv 2507.21046). A 500-skill registry that's dumped into a worker's context reproduces the "150k-token tool catalog" problem Anthropic's Nov-2025 work exists to kill. Enforcement: metadata-first progressive disclosure (SKILL.md), `defer_loading`, retrieval-by-card, and the same 25k-token response ceiling. The registry must be *selected from*, never *loaded*.
- **Emergence-as-chaos (the ungated forge).** A skill library without the reverify gate is a pile of unverified, possibly-adversarial procedures — the red-team's `adversarial-worker` forging a "verified" skill. The gate (I7 re-run in a fresh sandbox) is non-negotiable: **a forge you can't reverify is a vulnerability, not a feature.** Emergence is only safe because it's bounded by a lattice of re-checkable claims.
- **Skill sprawl / duplication.** N workers forging near-identical skills (the concurrency problem, doc 08 §4). Admission must dedup by behavioral signature (does an existing skill pass the proposed skill's verification?) before minting a new card — a tuple-space `take` on the skill name (capability-plane §4).
- **Cross-run context re-poisoning** (doc 08 §7 Q3). Auto-injecting a past run's scorecard into a new orchestrator context poisons it. Curriculum seeding must be *pull* (`fleet_recall`) or a bounded candidate-set, never an ambient dump.
- **Hype to avoid.** (a) "Self-improving" ≠ the model gets smarter — only the *scaffold's capability surface* grows; the base model is frozen per run. Say so. (b) Voyager's emergence was dramatic partly *because* GPT-4 couldn't hold Minecraft's tech-tree in context; a strong coding model already "knows" much that would be a skill — so baton's emergence ceiling is *lower and must be earned*, not assumed. (c) A moving "capability frontier" is only meaningful if the frontier tasks are ones a *single briefed worker* fails and the *composed fleet* passes — otherwise it's re-labeling normal task completion as emergence. The demo must show the negative (single worker fails / re-derives expensively) to make the positive (composition wins) load-bearing.

## Sources

- Voyager: [arXiv 2305.16291](https://arxiv.org/abs/2305.16291), [voyager.minedojo.org](https://voyager.minedojo.org/), [GitHub MineDojo/Voyager](https://github.com/minedojo/voyager)
- SWE-agent / Agent-Computer Interface: [arXiv 2405.15793](https://arxiv.org/abs/2405.15793), [Princeton publication](https://collaborate.princeton.edu/en/publications/swe-agent-agent-computer-interfaces-enable-automated-software-eng/)
- Anthropic, Writing effective tools for AI agents: [anthropic.com/engineering/writing-tools-for-agents](https://www.anthropic.com/engineering/writing-tools-for-agents)
- Anthropic, Effective context engineering for AI agents: [anthropic.com/engineering/effective-context-engineering-for-ai-agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- Anthropic, Code execution with MCP: [anthropic.com/engineering/code-execution-with-mcp](https://www.anthropic.com/engineering/code-execution-with-mcp); [Simon Willison summary](https://simonwillison.net/2025/Nov/4/code-execution-with-mcp/); [MarkTechPost](https://www.marktechpost.com/2025/11/08/anthropic-turns-mcp-agents-into-code-first-systems-with-code-execution-with-mcp-approach/)
- Anthropic, Equipping agents with Agent Skills (SKILL.md, progressive disclosure): [anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills); [Claude Platform docs](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
- Manus, Context Engineering for AI Agents: [manus.im/blog](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus); [Peak Ji on Medium](https://medium.com/@peakji/context-engineering-for-ai-agents-lessons-from-building-manus-71883f0a67f2)
- Cognition, Don't Build Multi-Agents: [cognition.com/blog/dont-build-multi-agents](https://cognition.com/blog/dont-build-multi-agents)
- Darwin Gödel Machine: [arXiv 2505.22954](https://arxiv.org/abs/2505.22954); [Sakana AI](https://sakana.ai/dgm/); [GitHub jennyzzt/dgm](https://github.com/jennyzzt/dgm)
- Scaffolding trap / Bitter Lesson for agents: [shanedeconinck.be — the scaffolding trap](https://shanedeconinck.be/posts/ai-agent-scaffolding-trap/); [lowtouch.ai — rethinking agent scaffolding](https://www.lowtouch.ai/rethinking-ai-agent-scaffolding-embracing-the-bitter-lesson-for-scalable-automation/); [Sutton, The Bitter Lesson](https://ankitmaloo.com/bitter-lesson/)
- Self-evolving agents survey (capacity/relevance, skill evolution): [arXiv 2507.21046](https://arxiv.org/html/2507.21046v4); SAGE / RL skill library: [o-mega self-improving agents 2026 guide](https://o-mega.ai/articles/self-improving-ai-agents-the-2026-guide)
- baton internal: `spec/capability-plane.md` (ACI envelope §3, card §5, reverify §6, composition §7); `docs/10-interaction-model.md` (T1/T2/T3, two channels, stigmergy); `docs/08-shared-memory-and-pm.md` (three tempos, scorecard, reuse counters); `spec/communication-channel.md` (brief, digest, result contract)

---

# Appendix: Sharpening critic pass

I have everything I need: the three planes read in full, the sibling skill-forge module and its existing critic pass, and web verification of the load-bearing external claims. Here is the sharpening.

## Sharpening for emergence-scaffolding

**Verdict.** This is a well-read design — it cites real, current, correctly-attributed sources (I verified DGM 20→50% on SWE-bench, SAGE = arXiv 2512.17102 Dec 2025 and its "refine-by-reward vs admit-on-success" framing, and the SKILL.md open standard's Dec-18-2025 cross-vendor adoption all check out), and it bolts to baton's spec by section number rather than floating above it. Its honest core — "a skill earns residence only if a reuse-vs-rederive counter beats re-derivation, else it's GC'd" — is the strongest idea in the doc and the right answer to the whole debate. But that honest core is buried under an emergence-rhetoric layer the mechanism does not earn, one per-harness cell is a category error, and the single most load-bearing worked example violates the exact spec section (doc 08 §2) the design elsewhere cites. Sharpening below, most-load-bearing first.

---

### 1. The emergence mechanism, honestly: syntactic envelope-uniformity ≠ semantic composability. The base model does the composing.

The design's central claim is a single sentence repeated three ways: **"uniformity of interface is the substrate of emergence"** → **"Unix pipes for agents"** → **"Ants → cathedrals; verified skills → capability transfer"** → **"Emergence is not a feature baton adds — it's what a uniform, verified, stigmergic substrate *does* once you stop preventing it."** That last sentence is pure faith. Here is where it breaks:

A uniform envelope (`{summary, payload, refs, ...}`) is a uniform **container**. It does **not** make skill A's output semantically consumable by skill B. In the design's own worked example, `discovery.search("/orders handler").refs` → `mw.apply(handler, auth.jwt_guard)` composes only because *something* knows the search result is a handler that `mw.apply` can wrap. That "something" is **w7's model reasoning**, not envelope shape. Unix pipes compose because `grep | wc` share an implicit **semantic** schema (lines of text), not merely because both emit bytes. The design conflates the two. Strip it and the honest mechanism is:

> **The base model does the composition. The envelope's only job is to keep the intermediate (`refs`, not `payload`) out of the worker's context so the model can afford to reason over a chain of them.** That is real and valuable — it is memoization plumbing — but it is a much smaller claim than "uniformity is the substrate of emergence."

This directly settles the base-model question you asked me to engage. If composition is model reasoning (the example proves it is), then a **stronger** base model does **more** of the "emergence," not less — and simultaneously makes the registry **less** necessary because it can re-derive `mw.apply` from scratch. The design half-sees this (anti-pattern 1) but never follows it to the conclusion: **the "emergence" it credits to the substrate is mostly the model, and the model is exactly what obviates the scaffold.** The two claims are in tension. The GC-on-negative-reuse-value rule resolves the tension correctly — but only if you demote the emergence rhetoric to what it is.

The DGM analogy makes this worse, not better. DGM's archive is of **agents empirically better on a fixed benchmark** — it monotonically improves and its stepping-stones stay valid. Baton's registry is of **skills whose value is *relative to the current model* and GC'd when the model improves** — it *decays* as the base model strengthens. Those are nearly opposite dynamics. Calling both "DGM-style archive" flattens the one difference that matters for baton's actual risk. The design even admits this in a hype-bullet ("self-improving ≠ the model gets smarter") and then re-inflates it two sections later ("the forge as self-rewriting scaffold... rides the model wave"). Pick the honest one.

**Replacement framing (buildable, un-mystical):** baton's registry is a **fleet-level memoization cache of verified procedures**, read by a small number of strong agents, whose entries have a usefulness metric and a GC policy. Cross-task reuse without the orchestrator wiring it is a **real, measurable** property of that cache. That is the whole win. Drop "ants → cathedrals" (baton has few, very smart agents and no reinforcement/decay dynamic beyond a hand-designed counter — it is not many-simple-locals stigmergy) and drop "emergence is what the substrate does once you stop preventing it."

---

### 2. Per-harness adaptation: one cell is a category error, one is real, one is unsupported.

You asked whether Codex-vs-Claude differ *how*, or whether it's asserted. Verified findings:

- **Category error (Codex row).** The design gives the Codex worker "Code-execution-with-MCP filesystem... (Tool Search / `defer_loading`)." Both of those are **Anthropic API constructs** — I confirmed `defer_loading` / the Tool Search Tool ships behind the `advanced-tool-use-2025-11-20` beta header and works only with Claude Sonnet/Opus (no Haiku, and certainly not Codex); "code execution with MCP" is likewise Anthropic's Nov-2025 pattern. Assigning them to Codex isn't per-harness differentiation — it's **Claude's mechanisms relabeled as Codex's**, the opposite of the adaptation the design claims to do. Codex's *actual* progressive-discovery path is: the SKILL.md open standard it adopted + `AGENTS.md` project context + its own exec/filesystem sandbox. Name that.
- **Real (the format claim).** "SKILL.md as cross-harness lingua franca" is genuinely grounded: I confirmed Anthropic open-sourced Agent Skills at agentskills.io on Dec 18 2025, OpenAI/Microsoft shipped support within ~48h, and ~32 tools (Gemini CLI, Junie, Kiro, Goose, ...) read the same SKILL.md by March 2026. So "one registry all harnesses read" is well-founded **at the format layer**. But the design over-extends it: the **discovery/progressive-disclosure mechanism is not uniform** even where the format is (Claude adds context-forking; Codex adds `openai.yaml` metadata). "Progressive disclosure works out of the box" is true of the *file*, not the *injection*. baton owes a per-harness adapter shim, and should say so.
- **Unsupported (GLM row).** "GLM is weaker at self-directed discovery → thicker scaffold" is asserted with zero evidence and applies the bitter-lesson "weaker model → more scaffold" rule by fiat. Two prerequisites are unverified: (a) that GLM's harness even *reads* SKILL.md — GLM/Zhipu is **not** in the adopter list I found, so "the registry mounts for GLM" may be false; (b) any benchmark that GLM is worse at compositional discovery. Before this cell is buildable you must name GLM's harness and confirm Agent Skills support; otherwise the "spend scaffolding where the model is weak" thesis rests on an unmeasured per-harness weakness ranking.

Net: the *unified conceptual surface* is real (SKILL.md format). The *per-harness differentiation* is one-third wrong, one-third real, one-third unsubstantiated. Rewrite the table as "shared format + per-harness discovery **shim** (Claude: native skills dir; Codex: skills dir + AGENTS.md + its own sandbox; GLM: **verify support exists first**)" and delete the Anthropic-API primitives from the Codex column.

---

### 3. Where it floats from the planes (you asked: integrate or float).

Mostly integrated — but three wires are drawn and not connected, and the worst one is in the load-bearing example:

- **The worked example violates doc 08 §2 — the exact section the design cites.** In "what an agent actually receives," w7 issues `{"op":"skill.search", ...}` **mid-turn**. Doc 08 §2 explicitly rejects this: *"a worker mid-turn doesn't want a research briefing... push, addressed, minimal — not a query into a shared brain."* The sibling skill-forge critique already killed this same worker-pull verb for the same reason. The design inherited the anti-pattern and then made it the centerpiece demonstration. **Fix (and it's the same fix the sibling doc reached):** skills are **pushed at spawn** — the hub pre-selects candidate SKILL.md *descriptions* into the worker's skills dir; progressive disclosure then fires **natively** with the worker spending **zero** turns searching. `skill.search` becomes an orchestrator-plane verb, never a worker verb. This also un-doubles the worker-facing surface the design adds.
- **"Reverify = categorically stronger, verbatim I7" imports a trust flip the design never pays for.** capability-plane §6 gives I7 its teeth *because the verification spec comes from the brief (orchestrator-authored, trusted)*. In `forge.skill.propose`, the `verification:{command, expect}` is submitted **by the skill author — a possibly prompt-injected worker.** So "admitted" attests only *"the author's own test passed under hub-observed sandbox confinement,"* which is strictly weaker than "the skill does what it claims." A malicious/wrong skill ships a trivially-passing self-test and is admitted. Reverify is **stronger on the execution-observation axis** (hub runs it, egress-monitored) and **not stronger on the specification-trust axis** (author supplies the test). "Categorically stronger than Voyager's GPT-4 critic" and "the registry is a lattice of re-checkable claims" both overstate. The honest line: *a lattice of "author-declared checks that passed under confinement" claims* — split the admission record into **hub-attested facts** (egress=0, no writes outside manifest, resource envelope) vs **author-declared** (the self-test), rank/gate on the former.
- **`provenance.composed_of` is an envelope extension presented as native.** spec §3's `provenance` is `{tool, index_epoch, worktree, deterministic}` — there is no `composed_of`. The design's `composed_of: [skill:mw.apply, ...]` is a reasonable and even necessary addition (it's how you'd compute the frontier metric), but it extends the envelope schema. Say "extends §3 with a `composed_of` provenance edge," don't smuggle it.

---

### 4. The one concrete improvement: promote the reuse-vs-rederive counter from a defensive footnote to THE deliverable — as a shadow-rederive control arm.

The design's best idea (bullet 5 / anti-pattern 1) is currently a *mitigation* buried in the anti-patterns. Promote it to the spine and make it causal instead of correlational:

> **Wire a sampled "rederive baseline" control arm into reverify.** When a skill is about to be reused, with probability *p*, ALSO spawn a shadow worker that solves the same subtask **with the registry disabled** (must re-derive). Log which arm was cheaper/more reliable, **partitioned by base-model tier and by repo/worktree shape** (the sibling critique correctly noted the raw counter is confounded across worktrees — a shadow arm de-confounds it). GC and admission decisions read this counterfactual, not an observational win-rate.

Why this is the right single move:
- It is **buildable today** on machinery that already exists: the scorecard (doc 08 §5 / §7 Q2) plus the reverify sandbox. No new trust primitive.
- It **operationalizes the bitter-lesson tension into a measured knob** instead of an assertion: you don't *argue* whether a stronger base model obviates the scaffold — you *measure* it per tier and let GC act. When the shadow arm starts winning, the registry auto-thins toward "goal + tools, no library." That is the design's stated aspiration ("design *for* that outcome being detectable"), made into an actual instrument.
- It is the **honest MVP**. The sibling forge doc's MVP is "draft + verify." This design's MVP should be *the instrument that decides whether forging is worth it for model tier X at all* — because if the shadow arm shows re-derivation wins, the entire emergence-scaffolding thesis is empirically dead for that tier, and you want to learn that in week 2, not year 2.

Reframe the whole doc around this: not "here is how capability emerges" (faith) but "here is the counterfactual instrument that tells you whether the verified-procedure cache earns its keep for a given model" (buildable, falsifiable, self-thinning).

---

### 5. The real technique it missed — and it's a source the design already cites.

**Manus's anti-dynamic-tool-loading rule.** The design cites Manus for KV-cache stability (stable prefix, append-only) but **violates the directly adjacent Manus rule**: Manus explicitly warns *against* dynamically loading/unloading tools or skills mid-context, because it breaks the KV-cache and causes schema-violation errors when earlier turns reference a skill no longer present — Manus's prescription is **logit-masking over a stable tool space**, not RAG-swapping the tool set. The design's worker-pull `skill.search` → `skill.adopt` (materialize a skill into the dir *mid-turn*) is precisely the dynamic-loading pattern Manus says not to do. So the missed technique is: **provision at spawn (stable prefix), constrain by masking, never mutate the skill space mid-turn.** This is the same conclusion as §3's push-fix and §4's control arm — three independent lines converge on "kill the mid-turn pull." That convergence is the tell that the pull model is the design's core defect.

Secondary miss: **retrieval/selection at scale is the actual bottleneck, and embedding-similarity alone (Voyager's mechanism) is known-weak past a few hundred skills.** The design cites the self-evolving survey (2507.21046) for the capacity/relevance tension but then leaves selection as a similarity `skill.search`. The 2025-26 practice is **hard pre-filter (harness_compat × trust-tier × worktree-applicability) then rank** — which is again the hub-side, push-time matcher, not a worker-side embedding lookup. Fold retrieval into the spawn-time provisioner and the "context rot from an unbounded registry" anti-pattern the design lists gets solved by construction rather than by exhortation.

---

**One-line summary of the honest smaller design:** baton exposes one SKILL.md format across harnesses (real, verified); the hub **pushes** a pre-filtered candidate set into each worker at spawn (not a mid-turn pull); admission runs the author's self-test under hub-observed confinement and records hub-attested facts separately from author claims (not "verbatim I7"); a sampled shadow-rederive arm measures, per model tier, whether reuse beats re-derivation, and GC's the losers. That is a **fleet-level memoization cache with a falsifiable keep-rule** — no ants, no cathedrals, and it survives contact with a stronger base model because it's built to notice when it stops earning its keep.
