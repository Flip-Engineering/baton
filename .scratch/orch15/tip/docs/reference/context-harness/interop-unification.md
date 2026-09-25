# Interoperability & Unification — baton context/harness engineering

*The layer above the three planes: how one capability suite, one knowledge plane, and one control model are **presented** to a heterogeneous worker fleet (Codex, Claude, GLM, ACP) uniformly — turning N harnesses × M capabilities into N + M, not N × M. This is the make-or-break for "interoperability is a core intent."*

## Summary (5 bullets)

- **Baton already has the unification primitives; this layer makes them a presentation contract.** Three artifacts recur across all three planes — the **card** (harness card / capability card / knowledge card: schema + capability negotiation), the **ACI result envelope** (`summary/payload/refs/cursor/cost/provenance`), and the **ledger** (stigmergic substrate). Interop = *one card schema, one envelope, one substrate*, rendered per-harness. Everything else is adaptation.
- **The unification lives at the abstraction + observability layer, never the capability layer.** Doc 04's law — *capability negotiation over lowest-common-denominator* — resolves the tension the task names: baton unifies the **verb vocabulary, envelope, and card schema**, realizes each verb at each harness's *maximum* native capability (Codex `turn/steer`, Claude's finer PreToolUse-hook steer, ACP's emulated), and **declares the delta** in the card and stamps it (`emulated:true`/`unsupported`) on the envelope. Unify the surface, negotiate the substance, surface the difference. Never flatten to ACP (Option B is a downgrade), never explode into a flat MCP tool per op (55–67K tokens before work starts — Anthropic's own numbers).
- **The northbound socket must be deferred/code-mode, or the hub poisons its own orchestrator.** Baton aggregates the whole control + capability + knowledge surface. Exposed naively as flat MCP tools it is the exact pathology Anthropic's *Code execution with MCP* and *Tool Search Tool* were built to kill. Baton hands the orchestrator a **`fleet_search` meta-tool + a code-mode `baton.*` typed SDK + deferred tool schemas** — the pattern **this very session runs** (≈150 deferred MCP tools + `ToolSearch "select:…"`).
- **Skill/tool portability is now a real standard, not aspiration.** Agent Skills / `SKILL.md` became an **open standard (Dec 2025, agentskills.io)** adopted by Codex CLI, Gemini CLI, Copilot, Cursor, ~40 clients. One skill file works across vendors — which is what lets the knowledge plane's skill registry (T3) spread capability across the *vendor* boundary, not just within one harness.
- **Interop is what makes heterogeneity an asset.** Because the envelope + `reverify` make results comparable and re-checkable across vendors, "different harnesses fail differently" becomes an *ensemble* (best-of-N across Codex/Claude/GLM, hub picks the re-verified winner) and a *learned routing table* — emergent capability the fleet was never explicitly programmed with.

## Frontier practice (real, cited)

| Source / technique | The insight | 2025–26 status | What baton adopts |
|---|---|---|---|
| **Anthropic, *Effective context engineering for AI agents*** (Sep 29 2025) | Context engineering supersedes prompt engineering: curate the *smallest set of high-signal tokens*; sub-agents return 1–2K-token condensed summaries, not traces | Published w/ Sonnet 4.5 | The `brief` is push-minimal-addressed (comms-channel §3), digests over transcripts (comms §6); the whole "agent-shaped" law |
| **Anthropic, *Writing effective tools for agents*** | Namespacing (`asana_search`, `asana_projects_search`); search-focused not list-all; token-efficient responses; evals-driven; **agents co-author their own tools** | Published 2025 | Capability card + envelope; `baton.<plane>.<module>.<op>` namespace authority; agent-authored skills into the registry |
| **Anthropic, *Code execution with MCP*** (Nov 4 2025) | Present MCP servers as **code APIs**; load tools on demand; filter data in the exec env; **150K→2K tokens (98.7%)**; 58 tools = ~55K, 7 servers = 67K (33.7% of window) *before you type* | Official pattern | Baton's whole surface is a code-mode `baton.*` SDK, not one MCP tool per op — the N×M-token defense |
| **Anthropic, *Advanced tool use* — Tool Search Tool + Programmatic Tool Calling** (Nov 2025) | `defer_loading:true` excludes tools from context, `fleet_search` expands on demand (**85% ↓; Opus 4.5 79.5→88.1%**); `allowed_callers` lets code orchestrate tools so **results never enter context** (37% ↓) | Shipped on Claude Developer Platform | Northbound `fleet_search` + deferred `fleet_*`; capability **pipelines via artifact `refs`** = PTC's "intermediate results don't touch context" |
| **This session's ToolSearch + deferred MCP tools** | Orchestrator receives ~150 tool **names** + a `ToolSearch` meta-tool; loads schemas on demand (`select:CronCreate,Monitor,…`) | Live in Claude Code (this transcript) | The exact northbound contract baton implements: names + `fleet_search`, not 150 schemas |
| **Cloudflare, *Code Mode*** (2026) | Entire API in **~1,000 tokens**: export `search()`+`execute()`, typed **TS SDK in a V8 isolate**; agents handle *more* tools as a TS API than as tool schemas (TS saturates the training set); **99.9% ↓** | Shipped; Agents SDK open-sourced | Baton's code-mode rendering = one typed SDK over all three planes; the isolate *is* the capability sandbox |
| **Anthropic Agent Skills / `SKILL.md` open standard** (Oct–Dec 2025) | 3-level progressive disclosure (name+desc ~30–50 tok → body → bundled files); portable folder format | **Open standard Dec 18 2025 (agentskills.io)**; adopted by Codex CLI, Gemini CLI, Copilot, Cursor, Goose, ~40 clients | Skill registry (T3) ships portable `SKILL.md` — **one skill runs on Codex *and* Claude *and* Gemini workers**. Cross-vendor portability made real |
| **Manus, *Context Engineering* (Peak Ji, Jul 2025)** | KV-cache is *the* metric (10× cost, 100:1 in:out); **"mask, don't remove" tools** (logit-mask availability, stable `browser_`/`shell_` prefixes, never mutate the tool set); filesystem as restorable context; recite goals (`todo.md`); keep errors in | Most-cited practitioner writeup | **Stable per-task worker tool set + masking**, not dynamic add/remove (protects worker KV-cache); brief re-injection = recitation; ledger keeps errors (I3) |
| **Cognition, *Don't Build Multi-Agents*** (2025) | Parallel subagents on partial views make **conflicting implicit decisions**; share full context/traces; single-thread is safer | Influential counter-position (vs Anthropic's multi-agent research) | Why baton minimizes AAI (T2) and bets on stigmergy (T3): the shared ledger/git/index **is** the shared context Cognition demands, without O(N²) chatter; path-scope + hub `reverify` contain the conflict |
| **SWE-agent ACI** (arXiv 2405.15793, NeurIPS 2024) | Tools *redesigned for agents* (linter-on-edit, bounded file viewer) beat reused human tools: **3.8→12.5% SWE-bench** | Foundational | The capability plane's premise (T1) and the "agent-shaped or it's a bug" law (capability-plane §2) |
| **Voyager** (arXiv 2305.16291, 2023) | Ever-growing library of executable skills, retrieved + composed; lifelong learning **without fine-tuning** | Foundational | Skill registry as compounding capability; skills as code artifacts in shared media, *discovered not instructed* |
| **Agent-interop landscape — AAIF / Linux Foundation** | AAIF (Dec 2025; OpenAI/Anthropic/Google/MS/AWS/Block) now homes MCP + A2A; **MCP+A2A two-layer** is the reference model; BeeAI ACP merged into A2A (Aug 2025) | Governance consolidated; convergence **12–18 mo out**, *not* done | Baton composes per layer (doc 03: MCP L2 north, native L1 south, A2A L3 deferred) — **no bet on a universal wire** |

## Design for baton

### Concrete mechanism — the interoperability substrate (three unifications + one rendering layer)

Baton's interop layer is **not a new protocol**. It is three shared schemas plus a per-harness *renderer*, sitting between the hub and every harness's own tool system/MCP client/context model.

**(1) The unified card.** Baton's three card types are one pattern with plane-specific fields. Unify them under a common envelope so schema/capability negotiation is identical whether you register a *harness*, a *capability*, or a *knowledge store*:

```jsonc
// baton card (superset; each plane fills its slots)
{ "kind": "harness|capability|knowledge", "name": "codex|discovery|blackboard", "version": "...",
  "ops": { "<verb>": { "support": "native|emulated|unsupported",   // ← the negotiation atom
                       "latency_class": "interactive|task", "deterministic": true,
                       "side_effects": "none|writes_shared|...", "reverifiable": true|"by_seed" } },
  "limits": { "concurrency_ceiling": 1, "max_context": 200000, "usage_fidelity": "full|degraded" },
  "consistency": "snapshot+overlay|tuple-space|append-only",       // knowledge/capability shared state
  "probed_from": "codex features list@0.144.0" }                   // anti-drift: generated, not asserted
```

`support ∈ {native, emulated, unsupported}` is the single atom of capability negotiation across the whole system (adapter-contract §"harness card"; capability-plane §5). **Cards are probed from installed binaries** (`codex generate-json-schema` + `features list`, `claude --help` + SDK version, tool `--version`) so they cannot lie about the harness (doc 09 §G). New harness/capability/skill = one new card, auto-probed.

**(2) The unified envelope.** The capability-plane ACI envelope is *also* the wire format for worker `result`s and knowledge queries — one consumption grammar the orchestrator and every worker learn once:

```jsonc
{ "status":"ok|partial|error|needs_resume", "summary":"≤1 line, always present",
  "payload":[…token-BOUNDED to ctx.budget…], "refs":[{"handle":"art:sha256:…","bytes":48211}],
  "cursor":"c:op_7f3:page2", "cost":{"tokens_out":380,"usd":0}, "provenance":{"deterministic":true,"emulated":false} }
```

`summary` enters context by default; `refs` hold the full data in the artifact store, fetched by handle only on demand. This is what makes cross-capability **pipelines** (search→orient→debug→validate) and cross-harness **result comparison** work: everything speaks the same shape, `refs` are the pipe, and no intermediate data touches any agent's context (capability-plane §7; = Anthropic PTC's "results stay in the exec env").

**(3) The unified substrate.** The knowledge plane (ledger, blackboard, code index, skill registry) is *inherently* harness-agnostic — it's git, JSONL, and `SKILL.md` files. A worker coordinates by reading/writing shared structure (T3), which requires zero per-vendor integration. This is the cheapest interop win and the reason stigmergy is the bet.

**(4) The rendering layer** (this workflow's actual deliverable). The same three schemas are *presented* into each harness's native surface:

```
                         ┌─ orchestrator (any harness) ── MCP northbound ─┐
   baton hub  ── renders │  = fleet_search + baton.* code-mode SDK + deferred fleet_* schemas
   (cards +   ── renders ┤  Codex worker  = capability tools via `codex mcp-server` cfg + thread/inject_items + SKILL.md
    envelope + ── renders │  Claude worker = mcpServers option + Tool Search Tool + SKILL.md + PreToolUse-hook steer
    ledger)    ── renders └  ACP worker    = session/new MCP connection; steer/inject/goal → unsupported (stamped)
```

The renderer is where "context engineering as a discipline" happens: it decides the token budget of the envelope per harness (§ per-harness), the brief dialect, whether tools are deferred or masked, and how a uniform verb degrades. **This is the +1 that makes integration additive: N adapters + M capability modules + one renderer = N + M, versus N × M bespoke tool wirings.**

### Per-harness adaptation (same surface, different realization)

| Concern | **Codex worker** | **Claude worker** | **GLM worker** | **ACP worker** | **Orchestrator (any)** |
|---|---|---|---|---|---|
| Capability tools reach it via | `codex app-server` + MCP config (`codex mcp-server`) | `query()` `mcpServers` option | same as Claude | `session/new` connects MCP servers (ACP does this natively) | `fleet_search` + code-mode `baton.*`; deferred schemas |
| Brief pinning | **`thread/goal/set`** durable slot + `thread/inject_items`; re-pin on `PreCompact` | `--append-system-prompt` + **`SessionStart`/`PreCompact` hook** re-inject (no durable slot) | as Claude | emulate via prompt; **goal-pin `unsupported`** (stamped) | n/a — orchestrator owns its own context |
| Steering (uniform verb `fleet_send mode=steer`) | **native `turn/steer`** (behavioral semantics M0-verified before card says `native`) | **emulated but *finer***: PreToolUse hook `updatedInput` rewrites the pending tool call | as Claude | `session/cancel` + reprompt; **`steer: emulated`** | issues the verb; sees `emulated:true` in the Ack |
| Skills | portable `SKILL.md` (open standard) | native `SKILL.md` | native `SKILL.md` | depends on agent; else prompt-inject the skill body | discovers skills via knowledge-plane query |
| Envelope token budget | large (big context) | large | **shrunk** (tighter effective window; treat as serial) | LCD | digests only (no raw ACI — capability-plane Q4) |
| Concurrency / cost | app-server pushes `rateLimits` → scheduler learns ceilings | OTel usage | **`concurrency_ceiling≈1` (Pro), `usage_fidelity: degraded`** — don't trust OTel cost; serialize | LCD; `usage-telemetry unsupported` | — |
| Tool-set stability | keep per-task set **stable + masked** (Manus), don't add/remove mid-run | Tool Search Tool available, but for *workers* prefer stable+masked | stable+masked | stable | **deferred-load is fine here** (orchestrator re-plans anyway) |

The card drives every cell: the renderer reads `support`, `limits.concurrency_ceiling`, `usage_fidelity`, `max_context` and adapts automatically. A GLM worker isn't special-cased in code — its *card* says `concurrency=1, usage=degraded`, and the scheduler/renderer respond.

### How it ties to the three planes + the ACI envelope + the two channels

- **Control plane (T2/AAI).** The unified card *is* the harness card; capability negotiation (native/emulated/unsupported) is enforced by the supervisor's fence (I1) and surfaced in the `Ack`. The uniform verb `fleet_send(mode=steer)` rides the **steering channel** (control plane, priority lane, fenced) on *every* harness; per-harness realization differs, the guarantee and the observability do not. `fleet_*` northbound tools are the control plane's rendering.
- **Capability plane (T1/ACI).** The envelope is the capability plane's native output *and* the interop wire. `reverify` (I7) is what makes cross-harness results **trustable**: a Codex worker's "tests pass" is re-run by the hub in a sandbox before any Claude worker depends on it. This is the evidence layer the whole interop story stands on — you can only ensemble across vendors because you can re-check across vendors.
- **Knowledge plane (T3/AIAI).** Rendered as MCP **resources** (`ListMcpResources`/`ReadMcpResource`) and code-mode reads: `baton.kg.query()`, `baton.blackboard.take("payments/")`, `baton.skills.find(task)`. Harness-agnostic by construction (git/ledger/`SKILL.md`), so it needs *zero* per-vendor rendering beyond exposing the read/write ops — the cheapest interop.
- **The two channels.** Interop's job is to keep the channel split intact across harnesses: **communication** (`brief`/`ask`/`answer`/`result`/`digest`) rides the data plane and is delivered at turn boundaries the way each harness supports; **steering** rides the control plane's out-of-band lane. The uniform northbound verb picks the channel (`mode` → channel → guarantee); the renderer maps it to native mechanism. Fusing them would re-break liveness on every harness at once (doc 10 §1b).

### What an agent actually receives (composed surfaces)

**A. The orchestrator's northbound tool-surface at session start (~1.2K tokens, not ~55K):**

```jsonc
tools = [
  { "name":"fleet_search", "type":"tool_search_tool_regex", "desc":"regex/semantic over baton's control+capability+knowledge catalog" },
  { "name":"fleet_wait",   "desc":"bounded poll loop (I4); ALWAYS loaded — liveness-critical" },
  { "name":"baton", "type":"code_execution", "desc":"typed SDK: baton.fleet.*, baton.cap.*, baton.kg.* — orchestrate many ops in one code block; only final envelope returns" }
]
// deferred (defer_loading:true; fleet_search expands on demand):
//   fleet_spawn · fleet_send · fleet_approve · fleet_interrupt · fleet_result · fleet_kill · fleet_list
//   cap.search.structural · cap.validate.test · cap.orient.repo_map · kg.query · blackboard.take …
```

The orchestrator writes `await baton.fleet.spawn({harness:"codex", brief, budget})` and orchestrates 20 worker ops in one code block — 19 fewer inference passes, worker results filtered before they hit its context (Anthropic PTC pattern). It is running the *same* deferred-tool pattern this session runs on me right now.

**B. The SAME task, briefed to a Codex worker vs a Claude worker** — one brief, two renderings the card produces:

```jsonc
// Codex rendering                                   // Claude rendering
thread/goal/set: {                                    --append-system-prompt: "<brief>…</brief>"  (re-injected by PreCompact hook)
  goal:"add rate-limit to POST /login",              canUseTool → routes approvals to hub
  dod:"pytest tests/auth exits 0",                   mcpServers: { baton: {cap.*, kg.*} }
  path_scope:["src/auth/**"] }                        steer: PreToolUse hook (updatedInput)  // finer than Codex
thread/inject_items: orientation_ref → art:…          orientation_ref → art:…  (fetched via cap.orient)
mcp cfg: cap.search.structural, cap.validate.test     SKILL.md: rate-limit-middleware  (SAME file a Codex worker would use)
steer: turn/steer (native)
```

Both get the *same* `path_scope`, `definition_of_done`, `orientation_ref` (an artifact handle, never inlined prose), and the *same* portable `SKILL.md`. Only the *pinning mechanism*, *steer realization*, and *tool-registration path* differ — and each difference is a card field, not code.

**C. One envelope, crossing a harness boundary** (a Codex worker's capability result the hub re-verifies, then a Claude worker consumes by handle):

```jsonc
{ "op":"validate.test", "status":"ok",
  "summary":"pytest tests/auth: 41 passed",
  "refs":[{"handle":"art:sha256:9f…","kind":"junit_xml","bytes":22140}],
  "cost":{"wall_ms":8300}, "provenance":{"tool":"pytest@8","deterministic":true,"emulated":false,"worktree":"wt/w3"} }
// hub reverify(): re-runs in a fresh sandbox → observed exit 0 → claim trusted.
// Claude worker w7 later: `await baton.cap.get("art:sha256:9f…")` — reads the JUnit, never re-runs, never sees w3's transcript.
```

## The emergence / interoperability angle

Uniform surface + re-runnability + portable skills scaffold capability the fleet was **never explicitly programmed with**:

- **Cross-vendor lifelong learning (Voyager × Agent Skills, made real).** A Claude worker authors a `SKILL.md` that solves a gnarly migration; it lands in the shared skill registry (T3). Weeks later a *Codex* worker on an unrelated task discovers and executes it — because `SKILL.md` is now a cross-vendor open standard. Capability spreads stigmergically across the **vendor** boundary, no messaging, no re-instruction. This is Voyager's compounding skill library, but the library is portable across harnesses — an interop property, not a model property.
- **Heterogeneous ensembling as a free consequence.** Because the envelope makes results comparable and `reverify` makes them re-checkable, the hub can dispatch the *same* task to Codex + Claude + GLM and pick the winner it independently verified. Diverse vendor failure modes become a strength (three different biases, one re-verified answer) — a best-of-N capability that emerges purely from uniformity + re-runnability, written nowhere as a feature.
- **Learned cross-harness routing.** The run scorecard's per-harness win/loss counter (doc 08 §5, Q2) accumulates in the knowledge plane. "Codex loses on auth refactors; Claude wins" becomes a routing table the orchestrator reads — a capability that emerges from ledger data, not a hardcoded policy. Interop is the precondition: you can only *learn* the comparison because the results were comparable.
- **Capability pipelines no one wrote.** `refs`-chaining lets `search → orient → debug → validate` compose into a workflow that exists as no single tool. New capability modules slot into existing pipelines the day they register a card — the composition is emergent from the envelope, not authored.
- **The additive-integration flywheel.** Every new adapter inherits the *entire* existing capability suite + knowledge plane + skill registry for free; every new capability/skill is instantly available to *every* harness. The N+M economics mean each addition multiplies reach — the fleet's total capability grows super-linearly in integrations while the integration cost stays linear.

## Anti-patterns & honest limits

- **The N×M tool explosion (the load-bearing one).** If baton exposes every control + capability + knowledge op as a flat MCP tool, it recreates Anthropic's 55–67K-tokens-before-you-start pathology and poisons its own orchestrator. Deferred loading + code-mode is not an optimization here — it is a correctness requirement for the northbound surface.
- **The lowest-common-denominator trap (Option B).** Flattening to ACP-and-everyone loses Codex's `turn/steer` and Claude's hook-level steer. Unify the *surface*, negotiate the *substance*. Silent emulation is the specific betrayal the adapter contract bans: **capability loss is data** — declared in the card, stamped on the event — or the whole interop value (honest comparison, honest routing) collapses.
- **KV-cache invalidation vs deferred loading (a real tension).** Manus: mutating the tool set mid-session invalidates the worker's KV-cache (10× cost). Deferred loading *adds* tools mid-session. Resolution: **defer-load at the orchestrator** (it re-plans between turns anyway); for **workers keep the per-task capability set stable and *mask*** (Manus "mask, don't remove"). Don't run the orchestrator's economics on the worker.
- **No cross-vendor KV-cache.** The unified surface is *conceptual*; you cannot share a KV-cache across Codex and Claude. Ensembling pays real tokens per vendor. Honest.
- **Over-scaffolding re-poisons context (Cognition context rot).** A brief that fans out capability cards and orientation prose is the research-briefing anti-pattern (doc 08 §2, doc 10 T2). The brief is push-minimal-addressed; bulky context goes by artifact handle. More scaffolding is not more capability past a point — it's rot.
- **Portability isn't automatic.** A `SKILL.md` that shells out to a Codex-specific tool isn't portable. Skills must target the **abstract capability surface** (`baton.cap.*`), not native harness tools, or "cross-vendor" is a lie. Same for schema negotiation: probing cards from binaries catches *version* skew, but **behavioral** semantics (does Codex `turn/steer` queue or context-splice?) still need empirical M0 tests before a card may claim `native` (adapter-contract §steer).
- **Namespacing collisions are inevitable at hub scale.** Baton aggregates from many sources across vendors; a worker harness may *also* expose a `search`. Baton needs a namespace authority (`baton.<plane>.<module>.<op>`) and a documented collision-reconciliation rule — the failure mode is concrete and lived (this session's `mcp__project-manager__pm_*` prefixing; the user's own `rtk gain` vs a different `rtk` collision in RTK.md). Anthropic's guidance (service+resource prefixes) is the baseline; a *fleet* aggregator needs more.
- **Hype to avoid: "one protocol to rule them all."** The 2026 landscape is *not* converged — AAIF consolidated governance, MCP+A2A is the reference two-layer, ACP folded into A2A, but real convergence is 12–18 months out. Baton's correct stance is doc 03's: **compose protocols per layer** (MCP L2 north, native L1 south, A2A L3 deferred), and treat any claim of a finished universal agent wire as marketing.

## Sources

- Anthropic, *Effective context engineering for AI agents* (Sep 2025) — https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Anthropic, *Writing effective tools for AI agents* — https://www.anthropic.com/engineering/writing-tools-for-agents
- Anthropic, *Code execution with MCP: building more efficient AI agents* (Nov 4 2025) — https://www.anthropic.com/engineering/code-execution-with-mcp
- Anthropic, *Introducing advanced tool use* (Tool Search Tool / Programmatic Tool Calling / Tool Use Examples) — https://www.anthropic.com/engineering/advanced-tool-use
- Anthropic, *Equipping agents for the real world with Agent Skills*; Agent Skills docs — https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills · https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview · open standard: https://agentskills.io
- Anthropic, *Introducing the Model Context Protocol* — https://www.anthropic.com/news/model-context-protocol
- Yichao "Peak" Ji (Manus), *Context Engineering for AI Agents: Lessons from Building Manus* (Jul 2025) — https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus
- Cognition, *Don't Build Multi-Agents* — https://cognition.com/blog/dont-build-multi-agents
- Yang et al., *SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering* (arXiv 2405.15793, NeurIPS 2024); ACI docs — https://arxiv.org/abs/2405.15793 · https://swe-agent.com/1.0/background/aci/
- Wang et al., *Voyager: An Open-Ended Embodied Agent with LLMs* (arXiv 2305.16291) — https://arxiv.org/abs/2305.16291 · https://voyager.minedojo.org/
- Cloudflare, *Code Mode: the better way to use MCP* / *give agents an entire API in 1,000 tokens* (2026) — https://blog.cloudflare.com/code-mode/ · https://blog.cloudflare.com/code-mode-mcp/
- MCP tool-search / progressive-disclosure ecosystem — https://mcp.directory/blog/mcp-context-bloat-fix-2026-tool-search-code-mode-progressive-disclosure · https://www.speakeasy.com/blog/100x-token-reduction-dynamic-toolsets
- Agent-interoperability landscape (AAIF / Linux Foundation; MCP+A2A two-layer; ACP→A2A merge) — https://zylos.ai/research/2026-03-26-agent-interoperability-protocols-mcp-a2a-acp-convergence/ · survey: https://arxiv.org/html/2505.02279v1
- Live instance of the deferred-tool / tool-search pattern: this session's `ToolSearch "select:…"` over ~150 deferred MCP tools (`mcp__project-manager__*`, `mcp__claude-in-chrome__*`, …).
- baton internal: `docs/03-protocol-analysis.md`, `docs/04-architecture-options.md` (capability-negotiation-over-LCD law), `docs/08-shared-memory-and-pm.md`, `docs/10-interaction-model.md`, `spec/capability-plane.md`, `spec/adapter-contract.md`, `spec/communication-channel.md`, `spec/supervisor-state-machine.md`.

---

# Appendix: Sharpening critic pass

I have what I need. The external citations check out (SKILL.md open standard Dec 18 2025 / agentskills.io, Tool Search 79.5→88.1% on Opus 4.5, PTC 43,588→27,297=37%, Cloudflare Code Mode 99.9%/1,000 tokens/V8 isolate all verified accurate), and I've read the six baton docs the design leans on hardest. Here is the sharpening.

## Sharpening for interop-unification

**Verdict up front (so the skepticism lands where it's earned):** the *citations* are unusually honest — I verified the load-bearing ones against primary sources and they are real and accurately represented (SKILL.md open standard, Dec 18 2025, agentskills.io, adopted by Codex/Copilot within 48h, ~32 tools by March; Tool Search 79.5→88.1% on Opus 4.5; PTC 37%; Cloudflare Code Mode 99.9%/1k tokens). This is not a trend-word collage at the reference layer. The hand-waving is entirely in the **connective tissue** — the claims about what these real primitives *compose into*. That's where I sharpen.

### 1. The N×M → N+M claim is the biggest over-count; the renderer hides an N×C matrix

"N adapters + M capability modules + one renderer = N + M" is the design's headline economic promise, and it's arithmetic sleight-of-hand. The renderer is not free and is not O(1). Your own per-harness table is **7 concerns × 5 harnesses = 35 hand-authored cells**, each a real API mapping (`thread/goal/set` vs `PreCompact` hook; `turn/steer` vs `updatedInput`; app-server `rateLimits` vs OTel). So the true cost is **N adapters + M modules + (N × C) renderer logic**, where C is the number of rendering concerns. The honest decomposition:
- The **envelope+card indirection** is what actually buys +M-not-×N *on the capability axis* — capability modules never see a harness, they emit one envelope shape, so a new capability is +1 for all harnesses. That win is real and it comes from the **indirection**, not the renderer.
- The **renderer is the N×C residue** on the control/presentation axis, and it does not shrink. `support`/`concurrency_ceiling`/`usage_fidelity` are *data* the renderer reads, but the code that turns "steer" into `turn/steer` vs a PreToolUse hook is per-(verb × harness-mechanism) and must be written once per pair. "The card drives every cell" is true for *dispatch* and false for *implementation*.

Replace "N+M not N×M" with the defensible claim: **the uniform envelope makes the M capabilities harness-agnostic (linear in M, not M×N); the control-surface renderer stays N×C and is the real per-harness cost.** That's still a strong result. Overstating it to N+M invites exactly the "you said additive, your renderer is a matrix" rebuttal.

### 2. "Super-linear capability growth" and the "flywheel" are unearned — it's reach multiplication, not emergence

"The fleet's total capability grows super-linearly in integrations." No. **Distinct capability grows +M** (each module is one new verb). **Reach** — verb×harness usability — grows N×M, but a capability usable on 5 harnesses is not 5 capabilities. Calling reach-multiplication "super-linear capability" is the precise species of emergence-hype you're asked to strip. Say: *reach grows N×M, distinct capability grows +M, integration cost grows +1.* No super-linearity anywhere.

### 3. The five "emergence" claims are all engineered compositions in disguise — name the built parts

None of the five is emergent in the strong sense (a fleet-level capability no component implements). Each is buildable engineering dressed as spontaneity, and the dressing hides the components you still have to build:

- **Cross-vendor lifelong learning (Voyager × Skills).** The SKILL.md *format* is portable (verified). But "a Codex worker *discovers* a Claude-authored skill" smuggles in three built components the open standard does **not** give you: (a) skill **discovery/retrieval** (`baton.skills.find(task)` — an embedding index you build; retrieval was a *component* in Voyager, not emergence), (b) **rendering the registry into each harness's native skill-load path** (Claude reads `.claude/skills`, Codex reads its own dir — baton must place the file), and (c) a **portability admission check**, because a skill authored by a real worker will reference the tools that worker actually used, which may be harness-native. You *acknowledge* (c) in limits ("skills must target `baton.cap.*`") but provide **no enforcement mechanism** — so portability is a property you must actively lint for, not a free consequence. Honest version: *portability of the format is free; discovery, cross-harness placement, and portability-enforcement are three components baton builds.*

- **Heterogeneous ensembling as a "free consequence."** `reverify` gives a **pass/fail gate**, not a **ranking**. Best-of-N-with-verification only selects when exactly one candidate passes; when two of three pass reverify you have no way to "pick the winner" — you need a **tie-break scorer** (diff size? cost? a judge?) that baton must define and that reverify does not provide. And "three different biases, one answer" assumes **failure-mode independence across vendors**, which for frontier models trained on overlapping corpora is an empirical bet, not a given — on genuinely novel problems the biases correlate and best-of-3 buys little. Honest version: *a buildable best-of-N gated by verification; value is conditional on (a) the task being reverifiable, (b) a tie-break scorer you build, (c) vendor independence you must measure, and it costs N× tokens (you admit this).*

- **Learned cross-harness routing.** This is a per-`(harness, task-class)` win counter feeding argmax — a `GROUP BY` query, not emergence. It's real and cheap, but the load-bearing missing piece is the **task-class taxonomy**: "Codex loses on auth refactors" needs a stable label to group on, and *nothing in the design classifies a task as an "auth refactor."* Without the classifier the counter has no key. Note also your own source (doc 08 §5, §7 Q2) is **ambivalent** about whether this even belongs in baton vs PM — you're presenting as settled emergence something the source doc flags as an open question leaning the other way.

- **Pipelines "no one wrote."** Someone writes every pipeline — the orchestrator's code-mode block that calls `cap.search` and hands the ref to `cap.orient`. The envelope makes composition **cheap to author** (uniform ref type = Unix-pipe plumbing); it does not make composition **spontaneous**. Say "compositional plumbing," not "emergent workflow."

The honest meta-claim for this whole section: **uniformity lowers the cost of composing capability across a heterogeneous fleet; the compositions are engineered, not emergent. Interop is a cost-reducer, not a capability-generator.** That's true, defensible, and still the reason to build it.

### 4. The stronger-base-model challenge splits your scaffolding in two — and you never make the cut

You're asked to engage whether a stronger model obviates the scaffolding. The verified data says the trend is real and directional: Opus 4.5 already hits 80.9% on SWE-bench Verified *before* Tool Search, and beats Sonnet 4.5 with 76% fewer output tokens — stronger models need **less** scaffolding and handle **more** raw tools. But that erosion is **selective**, and the design's fatal move is lumping two kinds of scaffolding under one "context engineering" banner:

- **Eroding (a stronger model shrinks the need — treat as cost/latency optimizations, not capability-enablers):** per-harness brief dialects (`gpt-5-4-prompting`), aggressive envelope token-budgeting, orientation prose against context-rot, skills-as-crutch. A strong model reads a plain brief, rots less, re-derives the migration. These survive on **economics** (tokens cost money), not on capability.
- **Durable (orthogonal to model IQ — this is the moat):** the supervisor's fencing/leases/two-phase-stop/durable-cursors (a smarter model does *not* make `fleet_wait` survive a host timeout or stop two workers double-claiming a lease); **`reverify`/I7** (a *more* capable worker writes *more* plausibly-wrong code — verification need correlates *positively* with model strength); **capability negotiation/the card** (Claude Code has no durable goal slot — that's a fact about a binary, no model upgrade grants it); and the deferred-loading token arithmetic (55K of tool defs is 55K regardless of IQ).

The design should **state this cut explicitly and bet on the durable layer.** Design so that a stronger worker **degrades gracefully toward "plain brief + raw tools"** — i.e., the scaffolding should be *sheddable*, not load-bearing-forever. Right now nothing marks which scaffolding is which, so the whole edifice reads as "context-magic that a GPT-6 makes moot." The correct posture: *the context-engineering layer is an optimization we shed as models improve; the control-plane + verification + negotiation layer is the invariant we keep.*

### 5. Where it floats beside the planes rather than integrating (two concrete seams)

The southbound integration is genuinely good — envelope, card, reverify, two-channel split, fencing, stigmergy are all used faithfully. But **northbound it floats on Claude-specific platform features**, which is ironic given the whole thesis is per-harness rendering:

- **The northbound is drawn in Anthropic-only primitives.** Your tool sketch uses `"type":"tool_search_tool_regex"` and `"type":"code_execution"` and `defer_loading:true` — these are **Claude Developer Platform** features. A **Codex orchestrator** reaching baton over MCP (doc 03: "orchestrator is any harness, MCP is the universal socket") has **none of them** — no Anthropic Tool Search Tool, no `code_execution` type, no `defer_loading`. So to keep the "orchestrator (any harness)" promise, baton must **re-implement all three as plain MCP tools in its own sandbox** (Cloudflare-style: a regular `baton.run(code)` MCP tool running a TS SDK in baton's V8 isolate; a regular `fleet_search` MCP tool doing embedding retrieval baton owns). The design applies its rendering discipline *southbound to workers* but *assumes Claude's platform northbound* — the exact per-harness blindness it was built to fix. This is your single most important buildable correction: **`fleet_search` and the code-mode SDK must be harness-agnostic MCP tools baton implements, not Anthropic tool-types baton passes through.** (Missed source that would have caught this: the **tool-RAG / RAG-MCP** line — tool-retrieval-by-embedding is a general pattern, not an Anthropic feature; naming it forces the harness-agnostic implementation.)

- **Code-mode collides with the supervisor's bounded-poll invariant (I4).** The supervisor's entire liveness argument is that `fleet_wait` is a **bounded poll** under `HOST_SAFE_MS < host MCP timeout` (I4), *because* a 300s long-poll dies at the ~60s host timeout. But "orchestrate 20 worker ops in one code block, only the final envelope returns" wraps those ops — potentially including a `fleet_wait` — inside **one long-running code-execution call**, which has its *own* timeout surface that the supervisor's I4 reasoning was never derived against. Does a `fleet_wait` inside a code-mode block re-introduce the exact long-poll-dies problem I4 exists to kill? The design must state that **`fleet_wait` is never called inside a code-mode block** (the block does bursty stateless capability ops; waiting stays a top-level bounded poll) — or re-derive I4 for the code-execution timeout. Unaddressed seam between this design and the plane it claims to render.

- **The "mask, don't remove" import assumes a control surface baton lacks.** You adopt Manus's "keep the worker tool set stable + **mask**." But masking is a **logit/tool-availability operation at inference time** — Manus could do it because *Manus is the harness*. Baton is explicitly **not** the worker harness ("baton doesn't control the workers' internal context management" — the task's own core tension). Baton can do the "**don't remove**" half (keep the MCP tool set stable across the task) but **cannot mask**, because masking lives inside Claude Code / Codex's inference loop, which baton doesn't touch and which may not expose the knob. This is the central tension of the whole workflow biting a specific prescription the design imported without checking baton has the surface to honor it. Say: *baton keeps the worker tool set stable; masking is the harness's to do and baton cannot guarantee it.*

- **Minor over-unification:** the "unified card" has **three kinds** (harness/capability/**knowledge**), but the source docs define only **two** cards (harness in adapter-contract; capability in capability-plane §5). The knowledge plane (doc 08) has **no card** — it declares consistency *per shared-state capability* (capability-plane §4). And your own text says the substrate "needs zero per-vendor rendering." So a `kind:"knowledge"` card is both unsourced and self-contradictory (why card a thing that needs no rendering?). Drop it to two kinds; reaching for three-planes→three-cards symmetry is exactly the over-unification a critic flags.

### 6. The one concrete improvement that makes it buildable and less hype: a cross-harness conformance harness

Everything the design promises — identical envelope consumption across harnesses, honest degradation of a uniform verb, portable skills, comparable-therefore-ensemblable results — is currently **asserted, tested nowhere.** The single highest-leverage build is a **conformance suite** that turns the hopeful claims into CI red/green, generalizing the adapter-contract's *existing* "M0 must behaviorally verify `turn/steer` before the card may say `native`" discipline to the whole surface:
1. **Envelope conformance:** run one golden capability op through every adapter; assert byte-shape-identical `AciResult` (status/summary/refs/cursor/cost/provenance).
2. **Card-honesty conformance (the generalized M0):** for every verb the card claims `native`/`emulated`, a behavioral probe that *proves* the claim (does `turn/steer` context-splice or queue? does the Claude PreToolUse hook actually fire mid-reasoning or only at a tool boundary?). A card field that observation contradicts fails the build.
3. **Skill-portability linter:** reject a `SKILL.md` referencing any harness-native tool name; admit only those targeting `baton.cap.*`.
4. **Comparability gate:** the routing/ensembling story is *only licensed for a task-class once the conformance suite proves the two harnesses' results are same-shaped and reverify-equivalent.*

This is buildable, it's the natural extension of machinery the adapter-contract already demands, and it **underwrites four separate claims at once** — replacing "interop makes results comparable" (faith) with "the conformance suite proves comparability for these verbs on these harnesses" (a job that passed).

### 7. Missed sources worth adding

- **Anthropic's own multi-agent research writeup** ("How we built our multi-agent research system," 2025). You cite Cognition's *anti*-multi-agent position to justify minimizing AAI, but never engage Anthropic's *pro* position (orchestrator-subagent, ~90% improvement, and its specific finding that subagents need **detailed** briefs). Your "push-minimal brief" law is in direct tension with Anthropic's "delegate with rich detail" finding — you take one side of a live disagreement and present it as settled. Engage both.
- **The context-rot empirical base.** You use Cognition's "context rot" term but cite no data. Chroma's *Context Rot* (2025) and Liu et al. *Lost in the Middle* (2023) are the actual evidence for why minimal/positioned context matters — load-bearing for a context-engineering design, currently asserted.
- **OpenAI's own agent/prompting guidance.** For a design whose per-harness axis is half OpenAI (Codex), citing *only* Anthropic on what tools/briefs should look like is a real gap — the Codex brief-dialect claim would be grounded by OpenAI's GPT-5/function-calling guidance (the repo's `gpt-5-4-prompting` skill exists precisely because Codex≠Claude; cite its basis).
- **Tool-RAG / RAG-MCP.** As above (§5): naming tool-retrieval-as-a-pattern rather than as Anthropic's Tool Search Tool is what forces `fleet_search` to be harness-agnostic and catches the Codex-orchestrator-has-no-Tool-Search hole.

**Net:** the design is well-sourced and its southbound plane-integration is genuine — better than most. Its failure mode is uniform: **it narrates buildable engineering (retrieval indices, verification gates, win-counters, sandboxed code tools, conformance tests) in the language of emergence and additive magic**, and in one place (northbound) it quietly assumes Claude-only platform features while claiming harness-neutrality. Strip the emergence varnish, name the components each "emergent" property actually requires, make the cut between sheddable context-scaffolding and durable systems-scaffolding, and ship the conformance harness that proves comparability — and the same design becomes a buildable spec instead of a manifesto.
