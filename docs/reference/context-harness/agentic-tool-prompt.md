# Agentic-first tool & prompt design + harness engineering — baton context/harness engineering

*The presentation layer above the three planes. baton does not control any worker harness's internal context management (Codex, Claude, and GLM compact differently, carry different system prompts, expose different tool ergonomics). It controls exactly two injection points per worker — the **tool surface** it registers (via each harness's MCP-client config) and the **prompt surface** it injects (brief / system-prompt-append / goal-pin, re-injected on compaction). This doc specifies the **Projection Layer**: a compiler from one harness-neutral capability/brief/result IR to each harness's native tool-and-prompt idiom, so the fleet sees one conceptual surface while each worker gets a natively-shaped one.*

## Summary (5 bullets)

- **Semantics are invariant; syntax and register are projected.** baton declares each capability op, each brief, and the result envelope **once** in a harness-neutral IR (the capability card of `capability-plane.md` §5 + the `AciResult` envelope of §3 + the `brief` schema of `communication-channel.md` §3). A per-harness **Projection Layer** compiles that IR into the concrete tool definitions and prompt text each worker's harness actually ingests. This is the missing layer between the canonical capability plane and the wire-level `adapter-contract.md`.
- **The tool surface stays small and KV-cache-stable regardless of catalog size.** With dozens of capability ops across discovery/debug/validate/orient/compute/skills, loading them all poisons context — production data shows selection accuracy degrading past ~10–15 tools (RAG-MCP). baton registers a **thin, frozen meta-tool per plane** (`cap.*`) and does progressive, retrieval-gated disclosure of individual op cards *through* it — Anthropic's Tool Search Tool / code-execution-with-MCP pattern — so tool definitions never mutate mid-task (Manus's #1 rule) yet the catalog scales unboundedly.
- **The brief is dialect-translated, not one-size.** A Codex brief and a Claude brief for the *same* task differ in structure, voice, and placement (AGENTS.md + `thread/goal/set` vs `--append-system-prompt` + PreCompact re-injection). The `brief_template` field already anticipated this; the Projection Layer is its implementation, grounded in the divergence between OpenAI's Codex prompting guide and Anthropic's context-engineering guidance.
- **Errors and results teach, and they teach in-dialect.** Every `AciResult` with `status:error` carries an actionable `remedy` (Anthropic: error messages as guardrails that steer the agent to correct usage), kept in-context rather than swallowed (Manus: don't hide failures). The remedy's verbosity and the result's format are themselves projected — terse JSON under Codex `--output-schema`, richer structured text under Claude.
- **The uniform envelope + handle-pipe + cross-harness skill re-projection is what produces emergent capability.** Because every capability returns the same addressable envelope and pipes intermediate data by handle (never through context), capabilities compose into chains the fleet was never explicitly programmed for; and because a skill authored by a Claude worker is re-projected into Codex's idiom before a Codex worker adopts it (Voyager's compounding skill library, made cross-vendor), capability spreads stigmergically across the whole heterogeneous fleet.

## Frontier practice

| Source / technique | The insight | 2025–26 status | What baton adopts |
|---|---|---|---|
| [Anthropic — *Writing effective tools for agents*](https://www.anthropic.com/engineering/writing-tools-for-agents) | Build high-leverage *workflow* tools, not thin API wrappers; namespace them; return high-signal tokens (paginate/filter/truncate; Claude Code caps tool responses at 25K tokens); use human-readable fields over opaque IDs; make error messages *teach* correct usage; give the agent response-format control; **evaluate tools with agents**. | Current canon; the reference text for tool ergonomics. | The `AciResult` envelope's `summary`/`payload`/`refs`/`remedy` split; namespaced ops (`discovery.search.structural`); per-op `format`/`verbosity` args; projection profiles are **eval-gated per harness** before a card claims a dialect. |
| [SWE-agent — ACI](https://arxiv.org/abs/2405.15793) (Yang et al., NeurIPS 2024) | LM agents are *a new class of end user*; tools redesigned **for them** (simplicity, action consolidation, built-in guardrails/feedback) tripled SWE-bench pass@1 with no model change — "harness engineering." | Founding result; the "agent-shaped or it's a bug" law (doc 10 §5) is a restatement. | Capability ops are consolidated agent-verbs (one `search.structural`, not open+scroll+grep); guardrails and corrective feedback live *in the op's result*, not in a wrapper the agent must remember. |
| [Manus — *Context Engineering for AI Agents*](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus) (Ji, 2025) | KV-cache hit-rate is *the* production metric (10× cost delta cached vs uncached); **never mutate tool definitions mid-task** (invalidates cache + confuses the model); mask availability instead of removing tools; append-only context; keep failures visible. | Widely-cited production playbook. | Frozen per-worker tool surface computed once at spawn; catalog growth flows as *data through the meta-tool*, never as re-registration; availability changes are **masking/steering**, not redefinition; error envelopes stay in transcript. |
| [Anthropic — *Effective context engineering for AI agents*](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) (Sep 29 2025) | Context is a finite, degrading resource; prefer **just-in-time retrieval** (lightweight identifiers, load detail at runtime), compaction, structured note-taking, sub-agent isolation; "smallest set of high-signal tokens." | The current framing that superseded prompt engineering. | `refs` handles are the lightweight identifiers; full data lives in the artifact store, fetched on demand; the brief carries an `orientation_ref` handle, not inlined prose. |
| [Anthropic — *Code execution with MCP*](https://www.anthropic.com/engineering/code-execution-with-mcp) + [Advanced Tool Use / Tool Search Tool](https://www.anthropic.com/engineering/advanced-tool-use) (Nov 2025) | Present tools as **files/modules discovered on demand**; register the full catalog but don't load it up front; keep intermediate results in the execution env, not the model's context. Reported 150K→2K token workflows (~98.7% reduction). | Newest, most direct fix for tool-space bloat. | The `cap.*` meta-tool = baton's Tool-Search-Tool-equivalent; op cards are the on-demand modules; pipeline intermediates move by handle and never enter context. |
| [RAG-MCP](https://arxiv.org/html/2505.03275v1) / [ScaleMCP](https://arxiv.org/pdf/2505.06416) / [Semantic Tool Discovery](https://arxiv.org/pdf/2603.20313) / [Red Hat "Tool RAG"](https://next.redhat.com/2025/11/26/tool-rag-the-next-breakthrough-in-scalable-ai-agents/) | Accuracy degrades measurably past ~10–15 tools; retrieval-based selection >3×'d selection accuracy while halving prompt tokens; semantic discovery hit 99.6% token reduction at 97.1% hit-rate. | Active research + emerging production default. | `cap.search_catalog(query)` does semantic retrieval over the op index and returns only the matching op cards to load — tool-RAG as the scaling mechanism for the capability plane. |
| [OpenAI — GPT-5 / Codex prompting guides](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide) (2025–26) | Codex ≠ GPT-5-base ≠ Claude prompting: Codex is highly steerable and instruction-following, honors `AGENTS.md`, exposes `verbosity`/`reasoning_effort`, and *degrades on conflicting or redundant instructions* — terser is better. | Vendor-current; the `gpt-5-4-prompting` skill exists for exactly this translation. | The Codex projection profile: standing rules → `AGENTS.md`, DoD → `thread/goal/set`, terse imperative descriptions, result contract → `--output-schema`, no nagging reminders. |
| [Cognition — *Don't Build Multi-Agents*](https://cognition.ai/blog/dont-build-multi-agents) (Yan, 2025) | Reliability = context engineering; share context across decisions; single-writer; don't split decisions that can conflict. | The counterweight to naive multi-agent designs. | The orchestrator gets a **digest-only** projection (no raw ACI), and worker↔worker coordination is stigmergic (doc 10 T3), so projection never fans a decision across conflicting contexts. |
| [Voyager](https://arxiv.org/abs/2305.16291) (Wang et al., 2023) | A skill = a verified code snippet stored with an embedding; semantically retrieved and **composed** into new skills; capability compounds without fine-tuning. | The canonical emergent-capability result. | The skill registry (doc 11) is Voyager made cross-harness: skills are authored, embedded, retrieved through `cap.search_catalog`, and **re-projected** so a skill crosses vendors. |

## Design for baton

### Concrete mechanism — the Projection Layer as a compiler with harness backends

baton owns one **Capability IR** and compiles it to N harness surfaces. The IR is not new state — it is the union of artifacts the specs already define (capability card, `AciResult`, `brief`). The Projection Layer adds the *backend* that renders them.

```ts
// One harness-neutral declaration, authored once per op (source of truth).
interface OpIR {
  op: "discovery.search.structural";        // namespaced verb — Anthropic namespacing
  intent: "Find definitions/usages by AST shape, not text.";   // the ≤1-line "when to use"
  args:   JsonSchema;                        // canonical arg schema
  returns: "AciResult";                      // always the envelope (capability-plane §3)
  card:   CapabilityCard;                    // cost/latency/determinism/side-effects (§5)
  when_not: "For a plain string, use search.lexical (cheaper rung).";  // ladder hint
  examples: OpExample[];                     // few-shot, projected or dropped per dialect
}

// Each adapter publishes a projection profile alongside its HarnessCard.
interface ProjectionProfile {
  transport: "mcp" | "code-mode" | "prompt-described";  // how the op reaches the model
  naming:    (op: string) => string;         // "discovery.search.structural" → harness idiom
  toolDoc:   Register;                        // description voice: "terse-imperative" | "when-to-use-rich"
  resultForm:"schema-enforced-json" | "structured-text" | "prose-fallback";
  briefSink: BriefPlacement;                  // AGENTS.md+goal-pin | append-system-prompt+precompact | ...
  errorVerbosity: "minimal" | "guided";
  eagerToolBudget: number;                    // how many op cards may be loaded before RAG kicks in
  skillForm: "mcp-tool" | "skill-md" | "described";
}

// The compiler. Pure function of (IR, profile, probed harness version) → frozen surface.
function project(ir: OpIR[], brief: Brief, profile: ProjectionProfile, hv: HarnessVersion): HarnessSurface;
```

`project()` is **computed once at spawn and frozen** for the worker's lifetime (Manus's KV-cache rule) and **cached per `(capability_version, harness_version)`** and probed from the installed binary the same way harness/capability cards are probed (`adapter-contract.md` version-skew defense) — so a projection can't silently drift from the tool it describes.

**The two-tier tool surface (the scaling answer).** No matter how large the catalog, each worker's *frozen* MCP tool list holds only the plane meta-tools:

```jsonc
// The entire capability plane, as seen by a worker, is ~4 stable tools:
"cap.search_catalog"  // semantic retrieval over the op index → returns matching op cards (tool-RAG)
"cap.describe"        // load one op's full card+args+examples on demand (JIT disclosure)
"cap.invoke"          // { op, args } → AciResult envelope; threads the (worker,turn_epoch) fence
"cap.resume"          // { handle, cursor } → next page of a needs_resume op
```

Individual ops (`discovery.search.structural`, `validation.test`, …) are **never** registered as separate tools — they are *data* returned by `cap.describe`, so adding the 50th capability op changes zero bytes of any worker's tool definitions (no cache invalidation, no >15-tool degradation). This is Anthropic's code-execution-with-MCP "tools as files discovered on demand," realized over baton's own MCP surface. On a harness with native tool-search (Anthropic Advanced Tool Use), the profile can delegate to it instead of `cap.search_catalog`; on one without, baton emulates it — declared in the card, not inferred.

### Per-harness adaptation

Same op — `discovery.search.structural` — same brief; four different concrete surfaces:

- **Codex worker** — `transport: mcp`, `resultForm: schema-enforced-json`, `toolDoc: terse-imperative`, `briefSink: agents-md + thread/goal/set`, `errorVerbosity: minimal`, `skillForm: mcp-tool`. Codex is highly steerable and *penalized by redundant/conflicting instructions* (OpenAI Codex guide), so descriptions are one imperative line, standing constraints go to `AGENTS.md` (not repeated per turn), DoD is pinned in `thread/goal/set`, and the result contract is enforced by `codex exec --output-schema` so the envelope arrives as validated JSON with no parse-retry. `cap.invoke` is a real `mcpServer` tool call; the adapter stamps the current `turn_epoch` fence onto it.
- **Claude worker** — `transport: mcp`, `resultForm: structured-text`, `toolDoc: when-to-use-rich`, `briefSink: append-system-prompt + PreCompact re-inject`, `errorVerbosity: guided`, `skillForm: skill-md`. Claude benefits from explicit "when to use / when **not** to use" framing, so op cards carry the `when_not` ladder hint and a role frame. The capability catalog is additionally surfaced as **Skills** (SKILL.md progressive disclosure is a native structural match for capability cards). The brief rides `--append-system-prompt` and is re-injected by a `PreCompact` hook (Claude has no durable goal slot — `adapter-contract.md`). Hooks (`PreToolUse updatedInput`) can rewrite a malformed `cap.invoke` before it executes — a native guardrail Codex lacks.
- **GLM worker** — the Claude profile with a **GLM dialect delta**: more explicit tool-use scaffolding and more worked `examples` retained (Claude-tuned prompts driving GLM cost quality — doc 02), no reliance on Claude-private idioms, `payload` budgets tuned to GLM's 1M window, and — because the plan's `concurrency_ceiling ≈ 1` — a *smaller* `eagerToolBudget` and more aggressive JIT (a serialized worker can't afford a wasted pre-load). `usage_fidelity: ⚠️` from the card means cost fields in the projected envelope are marked estimated.
- **The orchestrator** — a **restricted projection** (capability-plane Q4 / doc 10 §6 Q4): it does *not* get raw `cap.invoke`; it gets `cap.search_catalog` + `cap.describe` at **digest fidelity** (to author briefs and pick ladder rungs) and the `fleet_*` control tools. Its real "tool surface" is composing briefs and steering, not grepping — keeping the single decision-maker's context clean (Cognition: don't fan decisions into conflict). ACP/PTY workers (tier 2/3) get `transport: prompt-described` — ops narrated in the system prompt because the harness can't hot-register MCP tools — with every unsupported affordance stamped `emulated`/`unsupported` in the card, never inferred.

### How it ties to the planes, the envelope, and the two channels

- **Capability plane** — the Projection Layer *is* the renderer of capability-plane §5 cards and §3 envelopes. The IR is the card + envelope; projection is their concrete presentation. `cap.invoke` threads `InvokeCtx` (caller identity, `(worker,turn_epoch)` fence, worktree, token budget) exactly as §1 requires — so a projected tool call is fenced like any control op.
- **ACI envelope** — the envelope's *fields* (`status/summary/payload/refs/cursor/cost/provenance`) are the invariant; only its *rendering* is projected (schema-enforced JSON vs structured text). `refs`/`cursor` are dialect-independent handles into the artifact store — the just-in-time-retrieval and pagination primitives, identical across harnesses.
- **Control plane** — tool-surface **mutation is a control-plane event**, not a data event. Because the worker surface is frozen for KV-cache stability, any real change ("this op is now unavailable," "hot-add a new MCP tool") is a **fenced steering op** (`supervisor-state-machine.md` I1) — masking/availability, never a silent redefinition (Manus). The adapter card declares whether the harness can hot-add tools without a restart; if not, it's `unsupported`, surfaced, not faked.
- **Communication channel** — the **brief** is a `brief`-kind message on the bidirectional data plane (`communication-channel.md` §3); its `brief_template` field is precisely the Projection Layer's brief backend. The **result contract** is the `AciResult`/`result` projected *upward* and re-verified by the hub (I7). So the Projection Layer compiles *both directions*: brief-down and result-up, per dialect.
- **Two channels, never fused** — the frozen tool surface + brief ride the **data/comms plane** (turn-respecting, injected at spawn). A mid-run "stop using `compute.*`" or "here's a new capability" rides the **steering/control plane** (preemptive, fenced, priority lane). Projection respects the channel split: presentation is delivered cooperatively at boundaries; availability changes are imposed out-of-band.

### A concrete example — what a worker actually receives

**One IR op (source of truth):**

```jsonc
{ "op": "discovery.search.structural",
  "intent": "Find defs/usages by AST shape, not text.",
  "args": { "pattern": "string(tree-sitter query)", "path_scope": "glob[]", "k": "int=20" },
  "when_not": "Plain string → discovery.search.lexical (cheaper rung).",
  "card": { "latency_class": "interactive", "deterministic": true, "reverifiable": true } }
```

**Codex worker sees** (frozen MCP tool + AGENTS.md + goal-pin; result JSON-schema-enforced):

```jsonc
// mcpServer tool (terse-imperative; the only capability tools registered)
{ "name": "cap.invoke",
  "description": "Run a capability op. Discover ops via cap.search_catalog. Returns an AciResult.",
  "input_schema": { "op": "string", "args": "object" } }
// AGENTS.md (standing, not repeated per turn):
//   Scope: src/auth/**. Done = `pytest tests/auth` exits 0. Prefer cheap search rung first.
// thread/goal/set: "Harden authorize(); DoD: pytest tests/auth == 0"
// A cap.invoke result, shape enforced by codex exec --output-schema:
{ "status":"ok","summary":"12 defs of authorize(; 3 in payments/ (likely), 9 in tests",
  "payload":[/*top-20 typed hits, bounded to budget*/],
  "refs":[{"handle":"art:sha256:…","kind":"full_results","bytes":48211}],
  "cost":{"tokens_out":380},"provenance":{"index_epoch":4412,"overlay_applied":true,"deterministic":true} }
```

**Claude worker sees** (same op, richer register; brief via system-prompt; Skill-form catalog):

```
[--append-system-prompt]
You are hardening src/auth/**. Definition of done: `pytest tests/auth` exits 0.
Tools: use cap.search_catalog to find a capability, cap.describe to read its card, cap.invoke to run it.
Prefer the cheapest search rung; escalate only on the critical path.  [re-injected on PreCompact]

[cap.describe("discovery.search.structural") → card the model reads on demand]
discovery.search.structural — Find defs/usages by AST shape, not text.
  When to use: structural queries (all impls of an interface, all callers of authorize().
  When NOT to use: a plain string literal → discovery.search.lexical (cheaper).
  Returns: AciResult{summary, payload(top-k, bounded), refs(full in artifact store), cost, provenance}.

[cap.invoke result — structured text, summary first]
ok — 12 defs of `authorize(`; 3 in payments/ (likely targets), 9 in tests.
  payload: [ …top-20 typed hits… ]   refs: art:sha256:… (48211B, full)   fresh: index_epoch 4412 +overlay
```

**A projected error (teaching, in two dialects):**

```jsonc
// Codex (minimal): 
{ "status":"error","summary":"pattern is not a valid tree-sitter query near col 14",
  "remedy":"Escape the capture name, or use discovery.search.lexical for a literal.","refs":[] }
// Claude (guided):
// error — your `pattern` isn't a valid tree-sitter query (col 14: unescaped capture).
//   Fix: quote the capture name `@fn`, OR if you meant a literal string, call
//   discovery.search.lexical instead (cheaper, no AST). Example: cap.invoke{op:"discovery.search.lexical", args:{q:"authorize("}}
```

Same defect, same `remedy` semantics, different verbosity — and in both cases the error **stays in the transcript** so the model learns from it (Manus), rather than being retried silently.

## The emergence / interoperability angle

The Projection Layer is what turns a pile of tools into a system that does things nobody wired:

- **Uniform envelope + handle-pipe → unplanned pipelines.** Because every op returns the same `AciResult` and passes intermediates by `refs` handle (never through context), an agent can chain `search → orient → debug → validate` in combinations no one enumerated — the artifact store is ACI's structured, addressable answer to Unix pipes (capability-plane §7). Composition is *closed under the envelope*: any op's output is any op's input, so the reachable behavior space is combinatorial in the op set, not linear.
- **Tool-RAG surfaces latent capability.** When a novel task's `cap.search_catalog(query)` semantically matches an op the briefer never mentioned, the fleet *discovers* it can do the task — capability appears by retrieval, not by instruction (RAG-MCP / semantic tool discovery). Adding one op to the index makes it instantly reachable by every worker and every future task.
- **Cross-harness skill compounding (Voyager, made multi-vendor).** A worker authors a skill (a verified composition of ops), embeds it, and registers it in the catalog. Another worker retrieves it semantically and adopts it — capability spreads through the shared medium, not through messaging (doc 10 T3 stigmergy). The Projection Layer is the load-bearing piece: a skill authored by a **Claude** worker is **re-projected into Codex's idiom** before a **Codex** worker runs it. Without projection, skills are vendor-locked; with it, the skill library compounds across the *whole heterogeneous fleet* — a Voyager-style ever-growing library whose reach is the union of all harnesses, not the intersection.
- **Interoperability by construction.** One conceptual surface means a capability built for workflow A is, the moment it lands in the IR, available to workflow B and to every harness's projection — no per-workflow, per-vendor integration. The scaffold is the interop.

## Anti-patterns & honest limits

- **Context rot is real; the projection must stay minimal.** More tokens ≠ better — long contexts degrade (Anthropic context-engineering). Over-rich op descriptions and bloated briefs are a *cost*, not a safety margin. The `eagerToolBudget` and the meta-tool indirection exist precisely to resist the temptation to "just expose everything."
- **The meta-tool hop is not free.** `cap.search_catalog → cap.describe → cap.invoke` adds a round-trip and a **failure mode native tools don't have: a wrong retrieval hides a needed op**. Tool-RAG's hit-rate is high but not 1.0; the honest cost of scaling past 15 tools is an occasional missed capability. Mitigation (small always-loaded "core ops" for the hot path) is a policy knob, not a free lunch.
- **KV-cache discipline constrains the design.** Freezing the surface for cache stability means baton *cannot* fluidly reshape a worker's tools mid-task — any change is a fenced control-plane event with a real cost (possibly a harness restart on harnesses that can't hot-add tools). This is a deliberate trade, not an oversight; violating it (re-projecting per turn) would thrash the cache and confuse the model (Manus).
- **Dialect translation is lossy and can silently drift — the "adapter lie" risk.** Maintaining N projections risks a projection that describes a tool the harness renders differently. The only defense is **evaluating each profile with agents** (Anthropic) and probing versions; an unverified GLM profile (Claude-tuned prompts on a non-Claude model) is the most likely to degrade quietly. A projection is not "done" until its harness eval passes — same bar as the adapter card.
- **baton cannot fix a harness that compacts away the brief mid-turn.** Re-injection (`PreCompact` on Claude, `thread/goal/set` on Codex) mitigates but does not eliminate this; ACP/PTY workers can't re-inject at all. Presentation engineering has a floor set by the harness's own context management, which baton does not own — the core constraint the whole design is scoped around.
- **Hype to avoid.** "MCP everything / infinite tools" — the research is unambiguous that raw tool count *hurts* past ~10–15 (RAG-MCP, semantic tool discovery); a mega-MCP-surface is an anti-pattern, not a feature. "One universal prompt/tool spec for all harnesses" — Codex ≠ Claude ≠ GLM prompting; a lowest-common-denominator surface underperforms every harness it targets and wastes Codex's `--output-schema` and Claude's hooks (doc 02). And "the Projection Layer is free" — each new harness backend is real engineering plus a real eval; the unified *conceptual* surface is the deliverable, but the *concrete* surfaces are earned per vendor.

## Sources

- Anthropic — [Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents) (token efficiency, namespacing, error-as-guardrail, response-format flexibility, evaluate-with-agents, 25K response cap)
- Anthropic — [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) (Sep 29 2025; just-in-time retrieval, compaction, structured note-taking, sub-agents, "smallest set of high-signal tokens")
- Anthropic — [Code execution with MCP: building more efficient AI agents](https://www.anthropic.com/engineering/code-execution-with-mcp) (Nov 2025; tools-as-files, progressive disclosure, intermediate results off-context) and [Advanced Tool Use / Tool Search Tool](https://www.anthropic.com/engineering/advanced-tool-use)
- Yang, Jimenez, Wettig, Lieret, Yao, Narasimhan, Press — [SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering](https://arxiv.org/abs/2405.15793) (NeurIPS 2024; ACI simplicity/efficiency/consolidation/guardrails)
- Yichao "Peak" Ji (Manus) — [Context Engineering for AI Agents: Lessons from Building Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus) (KV-cache, stable tool defs, logit-masking not tool-removal, append-only, keep failures visible)
- Walden Yan (Cognition) — [Don't Build Multi-Agents](https://cognition.ai/blog/dont-build-multi-agents) (context engineering, single-writer, avoid conflicting decisions)
- OpenAI — [Codex prompting guide](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide) and [GPT-5 prompting guide](https://developers.openai.com/cookbook/examples/gpt-5/gpt-5_prompting_guide) (steerability, verbosity/reasoning_effort, AGENTS.md adherence, avoid conflicting instructions; Codex ≠ base prompting)
- Wang et al. — [Voyager: An Open-Ended Embodied Agent with Large Language Models](https://arxiv.org/abs/2305.16291) (embedding-indexed, composable, compounding skill library)
- [RAG-MCP: Mitigating Prompt Bloat in LLM Tool Selection](https://arxiv.org/html/2505.03275v1); [ScaleMCP](https://arxiv.org/pdf/2505.06416); [Semantic Tool Discovery for LLMs](https://arxiv.org/pdf/2603.20313); Red Hat — [Tool RAG: The Next Breakthrough in Scalable AI Agents](https://next.redhat.com/2025/11/26/tool-rag-the-next-breakthrough-in-scalable-ai-agents/) (accuracy degrades past ~10–15 tools; retrieval-gated tool selection)
- baton internal: `spec/capability-plane.md` (ACI envelope, cards, reverify), `spec/communication-channel.md` (brief/result/digest), `spec/adapter-contract.md` (per-harness verb→API mapping, harness cards, version-skew probing), `docs/10-interaction-model.md` (three topologies, two channels), `docs/02-harness-control-surfaces.md` (verified Codex 0.144.0 / Claude 2.1.205 / GLM surfaces)

---

# Appendix: Sharpening critic pass

The specs are detailed and the design integrates them unusually tightly. Every load-bearing external citation checks out (RAG-MCP, Semantic Tool Discovery 2603.20313, code-execution-with-MCP, Tool Search Tool, Voyager, the Codex/Claude API divergences are verified against installed binaries in doc 02). So this is not a fabrication problem. It's an over-claim problem, concentrated in one section. Here is the sharpening.

---

## Sharpening for agentic-tool-prompt

**Verdict:** More grounded than the genre. The core is a real, buildable object — a compiler with one IR frontend (the union of `capability card` + `AciResult` + `brief`, so it invents no new state) and N harness backends, frozen per `(cap_version, harness_version)` for KV-cache stability. That much is honest engineering and every API divergence it leans on is verified in doc 02 / adapter-contract.md, not asserted. The problems are (a) one section where "emergence" is doing work no mechanism backs, (b) a per-harness story that silently mixes proven API facts with unvalidated prompt-folklore, (c) a total non-engagement with the strongest objection to the whole enterprise, and (d) three specific places the meta-tool surface floats *beside* the capability-plane spec rather than rendering it.

### 1. "Emergence" is the trend-word. Three mundane mechanisms wear its coat — name them and the design gets stronger.

The flagship section ("The uniform envelope + handle-pipe + cross-harness skill re-projection is what produces emergent capability") is the one place a buzzword substitutes for a buildable mechanism. Dissected, it is three ordinary, valuable things — none of them emergence in the strong sense (a capability the parts don't have):

- **"Composition is closed under the envelope → the reachable behavior space is combinatorial."** This is *type-uniformity enabling composition*, not emergence. A uniform result type means any op's output type-checks as any op's input. That removes an *impediment* to chaining; it does not *generate* behavior. And "reachable" ≠ "achievable": the combinatorial space is almost entirely garbage chains, and the model's ability to navigate to a *useful* one is a property of the **model**, not the envelope. This is the RAG-MCP problem one level up — more composable ops = more ways to pick a wrong chain. **Honest replacement:** "A uniform result type makes ad-hoc op-chaining *expressible*; whether a useful chain is *found* is a model capability the envelope neither provides nor measures." Then add a metric (see §5).

- **"Tool-RAG surfaces latent capability → the fleet discovers it can do the task."** This is *retrieval*, not emergence. Semantic match over an op index is a lookup. Valuable, but calling a successful `cap.search_catalog` hit "capability appearing by retrieval, not instruction" dresses a vector search as a phase transition.

- **"Cross-harness skill compounding — the load-bearing piece."** This is the one genuinely novel claim and it has a hole. A skill is defined as "a verified composition of ops." Then either: **(a)** the skill is expressed at the IR level (a sequence of `cap.invoke` calls) — in which case it is *already harness-neutral* and "re-projection into Codex's idiom" is nothing more than re-rendering a card, i.e. the **envelope** is the cross-harness mechanism and "re-projection" is not load-bearing at all; or **(b)** the skill embeds harness-specific prose / reasoning traces / tool-call syntax — in which case re-projecting it is a lossy NL-translation problem the design hand-waves ("re-projected into Codex's idiom" with no mechanism). The design wants both. **Honest replacement:** "Skills stored as pure IR-op-compositions are cross-vendor *for free* — that is the envelope's payoff, not a new mechanism. Skills that embed prose are not reliably translatable and must be stored as IR + re-authored, not 'projected.'" That kills the "made multi-vendor Voyager" flourish but leaves a claim you can actually ship.

Rename the section "Composition, discovery, and reuse." Every concrete benefit survives; the faith evaporates. This also satisfies your own CLAUDE.md instinct against magic — the smaller claim is the buildable one.

### 2. Per-harness adaptation mixes two things that deserve very different confidence.

The design treats `ProjectionProfile` as one object. It contains two populations with opposite epistemic status:

- **Mechanical projection — proven, load-bearing, model-durable.** `briefSink` (Codex `thread/goal/set` durable slot vs Claude has *no goal slot* → PreCompact re-inject), `resultForm` (Codex `--output-schema` native enforcement vs Claude parse), hook-level guardrails (Claude `PreToolUse.updatedInput` can rewrite a malformed `cap.invoke`; Codex cannot), `transport`, hot-add-tool support. These are **API facts** verified in doc 02, and the design even carries the Codex-review correction that `goal/set` is a durable slot, not auto-compaction-proof DoD. Build these. They survive stronger models (see §3).

- **Stylistic projection — folklore, unvalidated, decoration until eval-gated.** `toolDoc: "terse-imperative" | "when-to-use-rich"`, `errorVerbosity`, `examples` count, "voice," "register." The *only* evidence cited is the OpenAI Codex guide's "penalized by redundant instructions" — which supports *terser*, not a whole bespoke "voice." Whether projecting register moves the needle is asserted. The GLM profile is the tell: it is "Claude profile + more worked examples + more scaffolding" with *zero* evidence GLM benefits from that — the design itself flags GLM as "most likely to degrade quietly." So of four profiles, **two (Codex, Claude) are grounded, one (GLM) is a hypothesis, one (orchestrator) is a policy choice.**

**Sharpening:** split `ProjectionProfile` into `mechanical` (must-build, no eval needed — it compiles over API differences that demonstrably exist) and `stylistic` (an experiment with a kill criterion: if the per-harness agent-eval doesn't beat a shared neutral register by a preregistered margin, *cut it* and ship one register). Right now the design's own "adapter-lie risk" limit admits the stylistic layer is the drift-prone one — so gate it, don't build it on faith.

### 3. The design never engages its own existential objection: a stronger model obviates most of this.

This is the biggest omission. The anti-patterns section covers context-rot, meta-tool cost, KV-cache, adapter-lie, and harness-compaction — but not "a better base model makes the scaffold dead weight," which the literature now treats as the central tension (the bitter-lesson-vs-scaffolding debate; "the relative benefit of scaffolding decreases as base models improve," arxiv 2606.25514; MCP-Zero). Applied concretely to *this* design:

- **Tool-RAG has a model-dependent payoff the design frames as a fixed law.** The "~10–15 tools" figure is folklore (RAG-MCP's own data shows a cliff nearer ~20, and it is heavily model- and tool-similarity-dependent; Semantic Tool Discovery assumes 50–100+ catalogs). As effective context and distractor-robustness improve, the cliff moves *out*. Past some point the `search_catalog → describe → invoke` indirection is pure overhead plus the design's own honest-limit #2 (wrong retrieval hides a needed op) — a failure mode you *only pay for because you chose RAG*. A stronger model lets you just load more tools and delete the failure mode.
- **Stylistic projection is exactly what stronger, more steerable models erase first** — the entire thrust of instruction-following gains is that the model needs less bespoke coaxing.

**The reframe that makes the design robust to the objection:** baton's projection value is **durable exactly where it's mechanical** (it compiles over *irreducible* API divergences — goal-pin vs system-prompt, output-schema vs parse, hooks, hot-add support — which no model improvement removes) and **decays exactly where it's stylistic** (prompt-register tuning, which model improvement is designed to remove). Lead with the mechanical framing. As stated, the design leads with the stylistic ("dialect," "voice," "register") — which is the half with a shrinking half-life. Invert the emphasis and the whole thing ages well instead of badly.

### 4. Plane integration is real, but the meta-tool surface floats beside the capability-plane spec in three specific places.

Genuinely integrated (don't cut these): IR = union of existing artifacts; `cap.invoke` threads the `(worker,turn_epoch)` fence per capability-plane §1; tool-surface mutation mapped to a fenced control-plane steering event per supervisor I1; `brief_template` is a field that *already exists* in communication-channel §3. That is rendering the planes, not floating. But:

- **The op-catalog index is uncarded shared state.** capability-plane §1 defines a Capability as `card/invoke/resume/cancel/reverify`. The two-tier `cap.search_catalog` machinery is **net-new** — it is not "rendering" §5 cards, it is a new *retrieval capability* over an embedding index. §4 requires every fleet-shared mutable state to declare a consistency model; the design never says who builds the op-index embeddings, when, or with what consistency (snapshot? append-only?). The skill registry is named as shared state; the **op catalog `search_catalog` queries is not.** That's a spec gap, not a rendering. Own it: "the catalog index is a new shared-state capability with an `append-only` (or `snapshot`) card," per §4.
- **`cap.cancel` is missing and it matters.** The worker's projected surface is `search_catalog / describe / invoke / resume`. capability-plane §2 law 3 says long ops are "interruptible via the control plane." So op cancellation rides the **steering channel** (a `steer`/`interrupt` reaches the running op), not a `cap.cancel` data-plane tool. That's defensible — but the design never says it, and a reader notices `cancel()` (present in the §1 interface) vanished from the projection. State that long-op cancellation is a control-plane event, not a projected tool.
- **`resultForm: structured-text` quietly breaks I7 on the Claude/GLM leg.** The design claims the compiler works "both directions — brief-down and result-up." But the up-direction has an asymmetry it never confronts: Codex's `--output-schema` gives the hub a *machine-readable* envelope to re-verify (I7); Claude's "richer structured text" does **not** — the hub must now parse prose to extract the verification claim, reintroducing exactly the parse-and-retry fragility `--output-schema` was praised for eliminating. **Fix the invariant explicitly:** the envelope's machine-readable core (`status`, `verification`, `refs`, `cost`, `provenance`) MUST be schema-enforced on *every* harness; the "richer register" may only be additive prose *wrapping* a structured core, never *instead* of it. Otherwise the two-directions-compiler claim fails upward on non-schema harnesses and I7 gets more expensive precisely where usage fidelity is already ⚠️.

### 5. One concrete improvement: replace the hardcoded "~10–15" with a per-harness capability-cliff probe.

The single most buildable, most hype-reducing change. Ship a tiny eval that runs **once per `(harness_version)`** at profile-build time (you already probe binaries for cards — same hook): a RAG-MCP-style sweep measuring the harness's tool-selection accuracy vs catalog size, yielding *that harness's actual cliff*. One measured number then does three jobs:

1. Sets `eagerToolBudget` **empirically** instead of by folklore (and satisfies your own CLAUDE.md "No Arbitrary Numeric Limits" rule — the limit is now derived from a measured resource constraint: the harness's selection-accuracy curve, re-probed on version bump via the existing version-skew defense).
2. **Decides whether tool-RAG is even worth it for this harness** — a model with a high cliff skips the `search_catalog` hop entirely and loads its ops eagerly. That directly answers the §3 stronger-model objection by making the scaffold *self-retiring*: the meta-tool indirection engages only for harnesses that measurably need it.
3. Turns "emergence" (§1) into a falsifiable metric on the *same* eval rig: hold N ops in the IR, give the fleet M tasks requiring un-briefed chains, and report `chain-discovery-rate` and `wrong-chain-rate` as N scales. That is just Anthropic's "evaluate tools with agents" pointed at composition — and it replaces the faith claim with a curve you can watch.

This is small, it reuses machinery you already have, and it makes the design's two shakiest claims (the tool-count law and emergence) empirical.

### 6. Missed technique — and it contradicts a stated "honest limit."

- **Anthropic's memory tool + context-editing API (`context-management-2025-06-27`; `clear_tool_uses_20250919`) — the biggest miss.** The design's floor — *"baton cannot fix a harness that compacts away the brief mid-turn; presentation has a floor set by the harness's own context management, which baton does not own"* — is **partly false on the Claude/GLM leg as of now.** Context editing exposes exactly the knobs baton needs: `keep` N recent tool uses, `trigger` threshold, and crucially **`exclude_tools`** (pin specific tool results against automatic clearing) plus a persistent **memory tool** — Anthropic reports 84% token reduction on a 100-turn eval by *keeping the workflow alive across compaction*. That means baton can pin the brief/orientation against compaction far more robustly than a `PreCompact` re-injection hook, by configuring the harness's *own* context manager rather than racing it. The design's whole premise ("baton doesn't control the worker's internal context management") is now *半*-wrong for Claude/GLM: Anthropic has begun *exposing* that control as an API surface. Add it as a first-class `briefSink` on the Claude profile and soften the stated floor.

- **MCP-Zero: Active Tool Discovery (arxiv 2506.01056) — reframes the meta-tool.** The design frames `cap.search_catalog` purely as tool-RAG (retrieval-gated, static). MCP-Zero's point is that *static retrieval on the initial query can't anticipate tool needs that emerge mid-task*, and that a **model-initiated** tool request is more robust to the "wrong retrieval hides an op" failure the design flags as an honest limit — because the model can iterate its request. Your `cap.search_catalog` is *already* model-initiated, so you're closer to active discovery than to RAG-MCP — but you cite the retrieval framing and inherit its weakness in your own anti-patterns. Reframe the meta-tool as **active discovery** (the worker names a capability gap and iterates), not retrieval-gating, and the honest-limit #2 softens for free.

- **Minor citation nit, given the design prides itself on grounding:** the "~98.7% reduction" is the *code-execution-with-MCP* figure; the *Tool Search Tool* itself reports **85%**. The design attributes both to the Tool-Search pattern. Fix, since precision is the design's brand.

**Net:** cut the word "emergence," split the profile into mechanical (build) vs stylistic (eval-or-cut), add the cliff-probe so the scaling knobs are measured not asserted, card the catalog index, enforce a schema-locked envelope core on every harness so I7 survives the up-projection, and correct the "floor" claim against Anthropic's context-management API. What remains is a compiler over real, verified API divergences — which is a strong, shippable thing that does not need the magic words.

Sources verified: [RAG-MCP 2505.03275](https://arxiv.org/abs/2505.03275), [Semantic Tool Discovery 2603.20313](https://arxiv.org/abs/2603.20313), [MCP-Zero 2506.01056](https://arxiv.org/abs/2506.01056), [Anthropic code-execution-with-MCP](https://www.anthropic.com/engineering/code-execution-with-mcp) / [advanced-tool-use](https://www.anthropic.com/engineering/advanced-tool-use), [Anthropic context-management (memory tool + context editing)](https://www.anthropic.com/news/context-management), [adaptive-scaffolding / bitter-lesson 2606.25514](https://arxiv.org/pdf/2606.25514); baton internal specs read in full: capability-plane.md, communication-channel.md, adapter-contract.md, supervisor-state-machine.md, docs/10-interaction-model.md, docs/02-harness-control-surfaces.md.
