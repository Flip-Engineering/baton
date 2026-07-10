I have enough real, current material. Writing the design doc now.

# Context composition & engineering — what enters each agent's window, when, how — baton context/harness engineering

## Summary (5 bullets)

- **Baton's core context problem is that it engineers context for windows it does not own.** Codex, Claude, and GLM each compact, re-order, and prompt differently; baton controls only what it *injects* and the *tools it exposes*, never the worker's full window. So baton's job is a hub-side **Context Composition Layer** that renders the three planes' data into each agent's window as *the smallest set of high-signal tokens* (Anthropic's stated goal), pushes that minimum, and leaves everything bulky as pullable-on-demand handles.
- **One consumption grammar for the whole fleet: `summary + handle + provenance`.** The capability plane's ACI result envelope already splits a tool's output into a ≤1-line `summary` (enters context), a bounded `payload`, and `refs` (handles fetched only on demand). The composition layer applies *the exact same split at the context level* — brief pushed, orientation/BoK/peer-state pulled by handle. A worker learns *one* way to consume both tool output and injected context. This is what makes heterogeneous plane data interoperate.
- **Context is provenance-typed into four classes** — `system` (baton-authored brief/constraints, trusted+imperative), `trusted_fact` (hub-computed ledger digests, diffstats, exit codes, capability `facts`, blackboard tuples), `untrusted_prose` (model-authored summaries/notes, data-fenced, opt-in), `reference_index` (handles: names not payloads). This extends doc 09 §D4's `facts`-vs-`prose` split into the full typing the composer needs to protect trust and defend against a digest-bomb / prompt-injection worker.
- **Per-harness compaction is handled by a "compaction firewall," not by hoping the worker recites.** Manus keeps goals alive by having the agent rewrite `todo.md`; baton *cannot trust a worker it doesn't control to recite*, so on `lifecycle.session_compacted` the composer re-injects the brief-identity + a resume digest from the knowledge plane (Codex `thread/inject_items` + `thread/goal/set`; Claude/GLM `PreCompact`/`SessionStart` hook), idempotent by content-hash so it doesn't double with the harness's own summary.
- **The orchestrator's context is the scarcest resource and is protected structurally.** Fan-out to workers (each with its own window returning a 1–2k-token distilled result — Anthropic's multi-agent pattern) *is* the lead-context-preservation mechanism; baton's `fleet_wait` return is the composed digest (attention-first, facts-default, prose opt-in, count-coalesced), and ACI-for-orchestrator returns digests only. The budget is derived from the harness card's physical `max_context`, not an arbitrary number.

## Frontier practice

| Source / technique | The insight | 2025-26 status | What baton adopts |
|---|---|---|---|
| **Anthropic, "Effective context engineering for AI agents"** (Sep 2025) | Curate the *smallest set of high-signal tokens*; prefer **just-in-time** (agent holds lightweight identifiers, loads data at runtime) over upfront dump; LLMs have a finite **attention budget** that every token depletes; long-horizon tactics = compaction, structured note-taking, sub-agent isolation; system prompts at the right **"altitude."** | Canonical Anthropic guidance, shipped with Sonnet 4.5. | The whole push-minimal / pull-by-handle frontier *is* the composition layer's governing law; "altitude" governs how the brief is written per-harness. |
| **Anthropic, "Writing effective tools for agents"** (Sep 2025) | Token-efficient tools: pagination/filtering/truncation with sane defaults, `response_format` enums to control verbosity, natural-language identifiers over cryptic IDs, namespacing, responses under ~25k tokens, minimal tool overlap. | Canonical; paired with the context-engineering post. | The ACI envelope already encodes this at the tool level; the composer applies the *same* bounding discipline at the window level; harness-card namespacing scopes each worker's tool surface. |
| **Anthropic, "Code execution with MCP" + Tool Search Tool** (Nov 2025) | **Progressive disclosure**: stop loading tool schemas until needed. `defer_loading: true` makes tools discoverable on-demand; 150k→2k tokens (98.7%) via code-execution, ~85% via tool-search; Opus 4.5 MCP-eval 79.5%→88.1%. | Shipping on the Claude Developer Platform (advanced tool use). | Capability **cards are deferred**: a worker's tool surface is composed per-task, not dumped; the orchestrator sees capability *digests*, not raw ACI (doc 10 Q4). |
| **Anthropic memory tool + context editing** (`memory_20250818`, Oct 2025) | File-based memory outside the window + **tool-result clearing**; +39% on internal agentic search, up to 84% token reduction on long tasks. | Public beta on the platform; native in the Agent SDK. | Baton's external memory is the **knowledge plane** (ledger/artifact/BoK) pulled by handle; re-injection is baton-side note-taking the worker *cannot forget*; baton **complements, never duplicates**, a worker's native memory/compaction. |
| **Manus, "Context Engineering for AI Agents"** (Jul 2025) | Keep the **KV-cache prefix stable** (don't mutate early context); **file system as unbounded external context** with *restorable* compression; **recitation** (rewrite `todo.md`) to fight goal drift; **keep errors in context**; **mask logits**, don't hot-swap tools. | Widely-cited production writeup. | Stable-prefix brief pinning; restorable compression = `summary`+`handle` (never lossy); **recitation done *from outside*** because the worker is untrusted to self-recite; logit-masking analog = per-task capability-card scoping (not dynamic tool churn). |
| **Cognition, "Don't Build Multi-Agents"** (Jun 2025) | Failures come from **un-shared context**; share full traces, prefer single-threaded linear context; naive fan-out disperses decisions. | Influential counter-position to fan-out. | The tension baton resolves with **stigmergy**: the shared substrate (ledger/blackboard/git) *is* the shared trace, so workers coordinate through it without dumping each other's transcripts — self-contained briefs (Anthropic) + shared medium (Cognition), not agent-to-agent prose. |
| **Chroma Research, "Context Rot"** (Jul 2025) | 18 frontier models all show **monotonically declining** performance as input grows; degradation is **non-uniform** (accuracy cliff), plus lost-in-the-middle. | Landmark empirical study. | Budget derived from `max_context` *with headroom*; **attention-first ordering** places load-bearing items at the recency edge; the honest limit that baton controls *injected*, not *accumulated*, context. |
| **SWE-agent, Agent-Computer Interface** (NeurIPS 2024) | Four ACI laws: actions **simple**, **compact/efficient**, feedback **informative but concise**, **guardrails** to stop error propagation. | Foundational; named the ACI concept doc 10 T1 builds on. | The ACI envelope + composition layer are the direct realization; `summary` = "informative but concise"; provenance-typing + scope-drift = guardrails. |
| **Voyager** (NVIDIA/Caltech, 2023) | An **ever-growing skill library of executable code**, compositional, retrieved and reused; generalizes to new worlds without gradient updates. | The reference design for lifelong skill accrual. | BoK / skill-registry recall pulled **by handle**; a past fleet's skill enters a present worker's context as an adopted capability, not re-taught prose — cross-run stigmergy (doc 10 T3). |
| **Anthropic, multi-agent research system** (Jun 2025) | Orchestrator-worker; each subagent has its **own window**, returns a **1–2k-token distilled summary**; isolation *is* a context-management strategy; +90.2% over single-agent. | Production Research architecture. | `fleet_wait` return = the distilled digest; fan-out *is* lead-context preservation; baton hardens the "self-contained task description" into the provenance-typed brief. |

## Design for baton

### Concrete mechanism — the Context Composition Layer

A single hub-owned component sits *above* the three planes and *below* every adapter's injection point. It is a near-pure function of plane state + the recipient's harness card:

```ts
// Hub-owned. Composes per (recipient, occasion). No LLM in this path — deterministic, testable.
interface ContextComposer {
  compose(recipient: Recipient, occasion: Occasion, budget: TokenBudget): ComposedContext;
  reinject(worker: WorkerId, trigger: 'session_compacted' | 'spawn' | 'takeover_return'): InjectionPlan;
}
type Occasion = 'spawn' | 'post_compaction' | 'turn_boundary' | 'wait_return' | 'ask_answer' | 'steer';

interface ComposedContext {
  segments: Segment[];      // provenance-typed, priority-ordered, PUSHED into the window
  handles:  Handle[];       // pullable-on-demand (artifact | capability-card | BoK hit); NOT in-window
  render:   HarnessDialect; // how segments serialize + where they pin, for THIS harness
  budget_used: number;      // ≤ budget; budget = card.max_context − harness_reserve
}
interface Segment {
  provenance: 'system' | 'trusted_fact' | 'untrusted_prose' | 'reference_index';
  priority:   0 | 1 | 2 | 3;          // attention(0) > identity/brief(1) > facts(2) > prose(3)
  text:       string;
  wrap:       'none' | 'data_fence';   // untrusted_prose is ALWAYS data_fence'd
}
```

Three rules make it work:

1. **Push the minimum, index the rest.** The composer pushes only priority-0/1 segments plus a `reference_index` (a list of handle *names*, not payloads). Everything bulky — the orientation repo-map, a full diff, a peer's blackboard note, a BoK recall — is a `Handle` the worker pulls **on demand via a capability op** (`context.fetch(handle, budget)` returns an ACI envelope: bounded, resumable). Pulling context *is* a capability invocation, so it's ledgered, budgeted, and re-runnable like any other op. This is Anthropic's just-in-time model, implemented as: the brief carries `orientation_ref` (already in the `brief` schema), never inlined prose.

2. **Budget from physics, truncate by priority.** `budget = card.max_context − harness_reserve` — grounded in a real resource (the model's window), honoring the "no arbitrary numeric limits" rule; it is not a magic cap. When plane data exceeds budget, the composer *demotes lowest-priority segments to handles* (nothing is lost — it becomes pullable), never silently truncates. Attention items (priority 0) are placed at the **recency edge** of the window to dodge lost-in-the-middle (Chroma).

3. **Provenance is load-bearing, not cosmetic.** `untrusted_prose` is always `data_fence`-wrapped so the recipient model treats it as data, not instructions — the composer's structural defense against a worker crafting a digest-bomb or an injection in its summary (doc 09 §D4). Default composition is `system` + `trusted_fact` + `reference_index`; `untrusted_prose` is opt-in.

### Per-harness adaptation

The *conceptual* surface is uniform (`ComposedContext`); the `HarnessDialect` renderer differs per adapter, driven by the harness card:

- **Codex worker.** Brief pinned in the durable `thread/goal/set` slot (persisted goal state — *not* a compaction-proof DoD, per the adapter-contract correction); segments injected as items via `thread/inject_items` (first-class); post-compaction re-injection is native and cheap. Brief written in the `codex-v2` dialect (terse, tool-forward — the `gpt-5-4-prompting` register). Steering context rides `turn/steer`.
- **Claude worker.** No durable goal slot (card: `goal_pin: unsupported-native`), so brief identity is carried on `--append-system-prompt` at spawn and **re-injected via a `PreCompact`/`SessionStart` hook**; the composer can *rewrite a pending tool call's input via a PreToolUse hook* — a finer injection point than Codex's message-level items (use it to inject a scope-constraint at the exact tool boundary). Brief in the `claude-v2` dialect (more prose-tolerant, "altitude"-tuned).
- **GLM worker (Claude surface + Z.ai model).** Same injection mechanics as Claude, but two composer adaptations: (a) `usage_fidelity: ⚠️` means baton **can't predict compaction from token counts** — it must *watch for the `session_compacted` event*, not time it; (b) `concurrency_ceiling ≈ 1` means JIT round-trips are serialized and expensive, so the composer **front-loads more** (Anthropic's hybrid: retrieve some up front) — a GLM worker gets a slightly fatter pushed context and fewer handles than a Codex worker doing the same task.
- **The orchestrator (Codex *or* Claude surface).** Receives *only* composed digests: the `fleet_wait` return is a `ComposedContext` with attention-first ordering, `facts` by default, `prose` opt-in, and **count-coalescing** ("60 turns, last 3 summarized," not 60 lines). ACI-for-orchestrator returns digests only (doc 10 Q4). Its budget is the tightest and most protected — fan-out to workers *is* how it stays under budget while supervising N.

### How it ties to the three planes, the ACI envelope, and the two channels

- **It is the presentation layer *above* the three planes** — the workflow's stated remit. The composer is the single choke point that *sources* from all three (control plane → brief/steer/constraints; capability plane → ACI `facts` + deferred cards; knowledge plane → ledger digest, blackboard tuples, artifact refs, BoK recall) and *renders* them into one window per recipient. The planes stay orthogonal; the composer is where they become *one thing an agent reads*.
- **It reuses the ACI envelope as its atom.** The `summary/payload/refs` split *is* the push/pull frontier, and the composer applies it one level up: `Segment.text` is the window-level `summary`; `Handle` is the window-level `ref`. There is exactly **one grammar** — the reason a search result, a peer's note, and a brief interoperate is that they all arrive shaped the same way. Pulling a handle re-enters the capability plane (`context.fetch` returns an ACI envelope), so context retrieval is itself observable, budgeted, and re-runnable (`reverify`).
- **It governs what rides each of the two channels.** The **communication channel** carries composed *content* — the `brief` down, the `digest` up, the `answer` to an `ask` — all `ComposedContext` in the appropriate dialect; re-injection is a communication-channel `brief` redelivery, *not* steering. The **steering channel** carries a *minimal* composed context — a `steer` is a tiny `ComposedContext` (`provenance: system`, a constraint + reason, fenced with `(worker, turn_epoch)`). The composer is why a steer is small and a brief is complete: same layer, different budget and channel.

### A concrete example of what an agent actually receives

**(A) A Codex worker at spawn** — pushed ≈ 520 tokens; the repo, the peer state, and the recipe stay as handles:

```jsonc
// rendered in codex-v2 dialect; pinned via thread/goal/set + thread/inject_items
{ "segments": [
  { "provenance":"system", "priority":1, "wrap":"none", "text":
    "GOAL: make authorize() reject expired sessions. SCOPE: src/auth/**. \
     DoD: pytest tests/auth passes; no edits outside scope. BUDGET: 200k tok / $5 / 30m. \
     VERIFICATION (hub re-runs): pytest tests/auth -q  (expect exit 0)." },
  { "provenance":"trusted_fact", "priority":2, "wrap":"none", "text":
    "code_index epoch 4412 (base) + your overlay live; blackboard: w7 holds lease on payments/ (do not touch)." }
 ],
  "handles": [
    { "kind":"orientation.repo_map",   "handle":"art:sha256:9c1…", "bytes":41200 },
    { "kind":"bok.skill",              "handle":"skill:auth-expiry-recipe@3", "note":"prior fleet solved this shape" },
    { "kind":"capability.card",        "handle":"cap:discovery",  "defer_loading":true }
  ],
  "render":{ "harness":"codex", "pin":"thread/goal/set", "inject":"thread/inject_items" },
  "budget_used": 517 }
```

Note what is **absent**: no orchestrator transcript, no peer's prose, no inlined repo map. The worker pulls `art:sha256:9c1…` only if it needs orientation; it adopts `skill:auth-expiry-recipe@3` only if relevant (Voyager-style reuse); it loads `cap:discovery`'s full schema only when it decides to search (progressive disclosure).

**(B) The orchestrator's `fleet_wait` return** — the composed digest it actually reads to supervise 5 workers:

```jsonc
{ "segments": [
  { "provenance":"trusted_fact", "priority":0, "wrap":"none", "text":     // ATTENTION, recency edge
    "w3 BLOCKED (question): 'which JWT lib — pyjwt or authlib?'  •  w5 budget 82%  •  w7 loop-suspected: pytest tests/test_pay.py ×5 near-identical failures" },
  { "provenance":"trusted_fact", "priority":2, "wrap":"none", "text":
    "w3 +40−3, pytest exit 0 (CLAIM — hub re-run pending)  •  w2 idle, task done  •  w7 42 turns, last 3 summarized" }
 ],
  "handles": [
    { "kind":"diff",         "handle":"art:sha256:aa2…", "worker":"w3" },
    { "kind":"failing_tail", "handle":"art:sha256:be7…", "worker":"w7" }
  ],
  "prose": [],                              // opt-in; empty by default (digest-bomb defense)
  "render": { "harness":"claude", "inject":"stream-json user message" } }
```

The orchestrator decides on ~150 tokens whether to answer w3's question, nudge w5 to wrap up, or interrupt w7 — pulling `art:sha256:be7…` (w7's failing tail) only if it needs the detail to steer.

**(C) Post-compaction re-injection (Claude/GLM worker).** The composer observes `lifecycle.session_compacted`, fires the `SessionStart` hook, and re-pushes the priority-1 `system` brief-identity + a **resume digest** (`{last_verified_checkpoint, open_handles, DoD}`), content-hashed and deduped against the harness's own compaction summary so the window isn't double-loaded. The worker's own compaction may have discarded the brief; baton's firewall guarantees it comes back.

## The emergence / interoperability angle

- **One grammar makes un-wired capabilities compose.** Because a brief, a search result, a peer's blackboard tuple, and a BoK skill all arrive as `summary + handle + provenance`, a worker reasons *across* them without any bespoke integration baton had to write. A worker that was briefed on auth can pull a *payments* peer's lease-note and a *prior-fleet's* migration skill in the same shape — capability the fleet was never explicitly programmed to connect, emergent from uniform shaping.
- **Skills become capabilities without re-teaching.** A worker authors a skill; the composer surfaces it to a *future, different-harness* worker as a `bok.skill` handle it adopts (Voyager reuse over stigmergic media, doc 10 T3). Capability spreads through the shared medium, not through instruction — cross-run, cross-vendor emergence.
- **The topology can deepen without context blowup.** Handle-passing + sub-agent isolation means a worker can spawn its own sub-workers, each with a fresh composed window returning a distilled handle — the composition layer scales the hierarchy the way Anthropic's fan-out scales research, because no level inherits another's raw window.
- **Trust operations fall out of the grammar for free.** Provenance-typed + addressable context means "re-verify a claim by fetching its handle and re-running it" is a *composition primitive*, not a feature — the same `Handle`/`reverify` machinery that pulls context also lets the hub re-check a worker's evidence (capability-plane §6). The evidence layer and the context layer are the same layer.

## Anti-patterns & honest limits

- **Context rot is real, non-linear, and only partly baton's to fight.** Chroma shows every model degrades as input grows, with unpredictable cliffs. Baton engineers the *injected* context; it does **not** control the worker's *accumulated* history — a Codex worker 200 turns deep is rotting inside a window baton can only re-inject into, not prune. Honest scope: baton minimizes and re-anchors; it cannot un-rot a window it doesn't own.
- **Over-scaffolding taxes the worker.** Pure just-in-time turns work into a fetch-loop; each handle-pull is a round-trip, worst on GLM (`concurrency_ceiling ≈ 1`, serialized). The mitigation is Anthropic's *hybrid* (front-load some, defer the rest) tuned per-card — not maximal indirection. Too many handles is as bad as too much inlining.
- **Re-injection can fight the harness's own compaction.** Blindly re-pushing a brief after every `session_compacted` risks double-loading and cache-thrash (Manus: mutating the prefix kills the KV-cache). Re-injection must be **idempotent by content-hash** and *complement* the harness's native memory/compaction, never duplicate it — baton does not run a second memory system next to Claude's memory tool.
- **Provenance fences are a mitigation, not a guarantee.** Data-fencing `untrusted_prose` reduces but doesn't eliminate prompt-injection risk; a determined payload in worker prose can still influence a model. That's *why* prose is opt-in and `facts` are default — defense in depth, not a solved problem.
- **The Manus "keep errors in context" tension is unresolved, honestly.** Baton's instinct is to compress failures into a `loop-suspected` fact — but *erasing the failure trace* can make a worker repeat the mistake (Manus's finding). Baton's stance: keep the failure *signal* (last-3-failures, loop-suspected, distance-to-DoD trend) as `trusted_fact`, not the raw transcript — but this is a judgment call, not a law, and mis-tuning it either bloats or blinds the worker.
- **Hype to refuse.** "Files = unlimited context" (Manus/memory-tool framing) still bottoms out on *retrieval quality* — a handle you never pull or pull wrongly is worthless. "Memory solves long-horizon" is false; note-taking + compaction reduce, not remove, the horizon problem. And the 84%/98.7% token-reduction headlines are *workload-specific* — baton should measure its own composition savings on its own tasks (an M1-gate metric), not assume the vendor numbers transfer.

## Sources

- Anthropic — [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) (Sep 2025): smallest high-signal token set, just-in-time vs upfront, attention budget / context rot, compaction, structured note-taking, sub-agent isolation, system-prompt altitude.
- Anthropic — [Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents) (Sep 2025): token-efficient tools, response-format enums, pagination/filter/truncation, natural-language identifiers, namespacing, <25k-token responses.
- Anthropic — [Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp) + [Advanced tool use / Tool Search Tool](https://www.anthropic.com/engineering/advanced-tool-use) (Nov 2025): progressive disclosure, `defer_loading`, 150k→2k tokens, ~85% reduction, MCP-eval gains.
- Anthropic — [Memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool) + [Context engineering: memory, compaction, and tool clearing (cookbook)](https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools) (`memory_20250818`, Oct 2025): external file memory, tool-result clearing, +39% agentic search, up to 84% token reduction.
- Anthropic — [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) (Jun 2025): orchestrator-worker, per-subagent context windows, 1–2k-token distilled returns, +90.2%, isolation as context management.
- Manus — [Context Engineering for AI Agents: Lessons from Building Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus) (Jul 2025): KV-cache stability, file system as external context, restorable compression, recitation/`todo.md`, keep errors in context, logit-masking over tool-swapping.
- Cognition — [Don't Build Multi-Agents](https://cognition.com/blog/dont-build-multi-agents) (Jun 2025): share full context/traces, single-threaded preference, un-shared context as the dominant failure mode.
- Chroma Research — [Context Rot: How Increasing Input Tokens Impacts LLM Performance](https://research.trychroma.com/context-rot) (Jul 2025): 18 models, monotonic degradation, non-uniform accuracy cliff, lost-in-the-middle.
- Yang et al. — [SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering](https://arxiv.org/abs/2405.15793) (NeurIPS 2024): the four ACI design principles.
- Wang et al. — [Voyager: An Open-Ended Embodied Agent with Large Language Models](https://arxiv.org/abs/2305.16291) (2023): skill library of executable code, compositional reuse, cross-world generalization.

Internal baton specs grounding the design (absolute paths): `/Users/wahargis/Development/Experiments/baton/spec/capability-plane.md` (ACI envelope §3, cards §5, reverify §6), `/Users/wahargis/Development/Experiments/baton/docs/10-interaction-model.md` (three topologies, two channels), `/Users/wahargis/Development/Experiments/baton/spec/communication-channel.md` (brief §3, digest §6, ask §4), `/Users/wahargis/Development/Experiments/baton/docs/09-revision-log.md` (§D4 provenance-typed digests, C1/C5 trust), `/Users/wahargis/Development/Experiments/baton/docs/05-telemetry-steering.md` (digest levels §3, orchestrator-context-scarcity principle), `/Users/wahargis/Development/Experiments/baton/docs/08-shared-memory-and-pm.md` (three memory tempos, BoK), `/Users/wahargis/Development/Experiments/baton/spec/adapter-contract.md` (per-harness goal-pin / inject / compaction mechanics).

---

# Appendix: Sharpening critic pass

I have what I need. The design is tightly bound to the real specs (I verified the ACI envelope, brief schema, digest facts/prose/attention typing, D4 digest-bomb, the fencing, and every per-harness mechanic against `capability-plane.md`, `communication-channel.md`, `adapter-contract.md`, `05-telemetry-steering.md`, and `09-revision-log.md` §D4/C1). That grounding is genuine — so my fire goes to the seams, the emergence claims, and one internal contradiction the "we don't own the window" thesis creates.

## Sharpening for context-composition

**Calibration first (so the criticism lands where it should).** This design is *not* floating hype relative to baton's own specs — it is unusually well-bound to them. `Segment.text/Handle` is a faithful one-level-up reuse of the ACI envelope's `summary/payload/refs` (`spec/capability-plane.md` §3); the four provenance classes correctly extend `docs/09` §D4's `facts`-vs-`prose` and name the digest-bomb threat it exists to stop; the `brief` fields (`orientation_ref`, `brief_template`) match `spec/communication-channel.md` §3 verbatim; and — the tell that the author actually read the spec — it *incorporates the adapter-contract's own correction* that Codex `thread/goal/set` is persisted goal state, **not** a compaction-proof DoD. Making the composer a deterministic, non-LLM, near-pure function is also correct and consistent with baton's "no LLM in the control path" stance. So the sourcing is real and the plane-integration is real. The problems are in the emergence rhetoric, one physics-of-cost error, one self-contradiction, and a total dodge of the "stronger model" question. Those below.

### 1. Where a buzzword still stands in for a mechanism

- **"Emergent capability from uniform shaping" is the biggest over-claim, and it's plumbing, not emergence.** A shared `summary+handle+provenance` shape does exactly one thing: it drops baton's *integration* cost for exposing plane-N data to a worker from O(datatypes × harnesses) to O(1). It does **not** make a model reason across a payments-lease note and an auth task — that cross-domain connection is a property of the model's judgment, entirely unchanged by the wrapper's shape. Replace *"capability the fleet was never explicitly programmed to connect, emergent from uniform shaping"* with the honest smaller claim: **"uniform shaping makes heterogeneous plane data *cheap to present* (one consumption grammar, no per-type adapter); whether a worker usefully composes a payments note into an auth task is untested, probably rare, and a model property — the envelope only guarantees no integration code blocked it."** That is a genuinely valuable mechanism (compositional *surface area* at fixed integration cost). Calling it emergence inflates a plumbing win into a magic one.

- **The `defer_loading` / "logit-masking analog" claim gets two cited sources backwards — and they actually *conflict*.** Manus's logit-masking is a *decode-time* constraint that keeps **all** tool definitions in a **stable KV-cache prefix** and only masks which are selectable this step — its entire point is *not* mutating context so the cache survives. Anthropic's Tool Search / `defer_loading` does the opposite: it *changes what is in context* (loads schemas on demand), which is precisely the mid-context tool-set mutation Manus explicitly warns breaks the cache. The design papers over a real strategy conflict by calling one an "analog" of the other. Honest version: **these are competing context strategies. For a worker on an aggressively-caching harness (Claude prompt caching), composing a *different* tool surface per task is a cache-miss cost, not a free progressive-disclosure win.** Baton must pick per harness-card: stable-superset-prefix + mask (Manus, cache-friendly) *vs* per-task deferred load (Anthropic, prefix-cheap but cache-breaking). Pretending they agree hides the actual engineering decision.

- **"Trust operations fall out of the grammar for free" conflates *addressable* with *re-runnable*.** `reverify` reuse is real and good — but only for the subset of handles that are capability-op outputs with declared determinism/seed (`spec/capability-plane.md` §6). An `orientation.repo_map` artifact, a `bok.skill` note, and a blackboard tuple are addressable handles that are **not** reverifiable claims. "The evidence layer and the context layer are the same layer" holds for `pytest`-shaped handles and is false for prose/orientation handles. Sharpen to: *all reverifiable things are handles; not all handles are reverifiable — trust-by-refetch is a primitive only over the capability-op subset.*

### 2. Per-harness adaptation: mostly real, one wrong cost-mechanism

The Codex/Claude/GLM mechanics are grounded in `adapter-contract.md` (Codex `thread/goal/set`+`inject_items`; Claude `goal_pin: unsupported-native` + `PreCompact`/`SessionStart` + PreToolUse `updatedInput`; GLM `usage_fidelity:⚠️`, `concurrency_ceiling≈1`). That part is real, not asserted. **But the derivation "GLM gets fatter pushed context because `concurrency_ceiling≈1` makes JIT round-trips expensive" uses the wrong physics.** `concurrency_ceiling` is a *model-inference* in-flight limit (Z.ai Pro tier). A `context.fetch(handle)` is a hub-local artifact/ripgrep read — it does **not** consume a GLM inference slot, so the ceiling doesn't make the *fetch* expensive. What actually makes JIT costly on GLM is that each pull spends an extra **worker inference turn** (emit fetch tool-call → receive → continue), and on a rate-limited/low-throughput worker every extra turn is disproportionately costly in wall-clock and quota. The conclusion (front-load more for GLM) may survive, but drive it off `usage.rate_limit` / tokens-per-minute / turn-latency, **not** `concurrency_ceiling`. Fix the stated mechanism or the knob is tuned on the wrong signal.

### 3. The self-contradiction the design's own thesis creates (this is the sharpest one)

The compaction firewall claims re-injection is *"idempotent by content-hash so it doesn't double with the harness's own summary"* and *"content-hashed and deduped against the harness's own compaction summary."* **Baton cannot do this.** The design's opening premise is that baton does *not* own or read the worker's window — that is the whole reason the firewall exists. If baton can't read the window, it cannot see, let alone content-hash-dedup against, Claude's internal compaction summary. The only dedup baton can actually implement is against **its own injection log** ("have I already re-pushed brief-hash X this session?"). Honest mechanism: **baton dedups against its own prior injections and *accepts* possible redundancy with the harness's private summary as unavoidable** — it cannot cross-check a summary it can't see. State that, or the design claims a check that contradicts its foundational premise.

### 4. The "stronger base model obviates scaffolding" question is dodged entirely — and the design owns the ammunition to answer it

The doc never engages the objection, and it's the load-bearing one. The fix is to **split the scaffolding by what a stronger model erodes vs. what it can't**:

- **Capacity-contingent (a bigger/less-forgetful model erodes these):** the re-injection firewall, JIT-pull-vs-upfront, note-taking. If a future model has a 10M-token window with robust native memory, the firewall is dead weight. Treat these as a *degrade-gracefully-as-models-improve* layer, gated on harness-card capabilities, not permanent law.
- **Capacity-invariant (no model obviates these — they're multi-agent trust/control properties, not single-agent memory):** provenance-typing + data-fencing (a huge window does **not** make untrusted worker prose safe — injection is a security property, not a capacity one), `reverify`, `(worker,turn_epoch)` fencing, the two-channel split, orchestrator-context scarcity. **Chroma "Context Rot" — which the design already cites — is the proof these survive: all 18 frontier models, large windows included, degrade monotonically, so "just use a bigger window" is empirically refuted by the design's own source.** The design has this ammunition and never fires it. Lead the value proposition on the capacity-invariant layer; it's the part that's true regardless of GPT-6.

### 5. One concrete improvement that makes it buildable and less hype

**Make the composer a measured control loop, not an asserted policy: emit `context.composed` as a first-class ledger event and instrument `handle pull-through rate` per (harness, handle-kind).** Every `compose()` already produces a segment/handle manifest + `budget_used` — ledger it (it conforms to `capability.op.*`, `spec/capability-plane.md` §2 law 2). Then measure, per harness: what fraction of pushed handles ever get `context.fetch`'d, and how soon after spawn. This turns three hand-waves into instruments:
- The front-load-vs-defer knob (the GLM "fatter context" claim) becomes **data-driven**: if a handle-kind is fetched >80% of the time within the first N turns on harness H, promote it from `handle` to a pushed `segment` for H. No asserted heuristic.
- The "over-scaffolding taxes the worker" anti-pattern gets a threshold: low pull-through = you indexed too much; demote.
- The M1 "measure our own savings" hand-wave becomes a specific number (pushed-token budget vs. counterfactual full-inline), measured on baton's tasks, not borrowed from vendor headlines.

This is buildable *today* — it's logging plus one ratio — and it converts per-harness adaptation from assertion into a tuned loop.

### 6. Real techniques/sources it missed

- **MemGPT (Packer et al., 2023, "Towards LLMs as Operating Systems" / virtual context management).** This is the *foundational* prior art for the entire push-minimal / page-by-handle mechanism — context as OS memory paging (main context vs. external store, with paging in/out). The design derives handles from Anthropic's memory tool but misses the paper that framed exactly this as virtual context management. Citing it grounds "handle" in named prior art instead of presenting paging as novel.
- **Prompt-caching *cost* as a composer input.** The design treats budget as pure capacity (`max_context − reserve`) and mentions cache-thrash only once, as an anti-pattern. But every push/pin/re-inject decision has a direct **dollar** consequence via cache-hit vs. cache-miss (Anthropic `cache_control` breakpoints; OpenAI automatic prefix caching). Re-injecting content that breaks the cached prefix isn't just "thrash" — it's a ~10× token-cost event. The composer should carry a *cache-stability cost term*, not just a token count. This also sharpens the Manus-vs-Tool-Search conflict in §1: the choice is economic, not just ergonomic.
- **Retrieval/ranking quality on the `reference_index` — the design admits the gap and supplies no mechanism.** "Push minimal, pull by handle" bets the worker pulls the *right* handle; the anti-patterns section concedes "a handle you never pull or pull wrongly is worthless," then offers nothing. The missing mechanism: handle surfacing is a **retrieval problem with recall/ranking**, and baton already owns the ranker — the discovery capability ranks search hits. Apply the same ranking discipline to which handles surface and in what order, and tune it with the pull-through metric from §5. Without this, `reference_index` is a bag of names and a prayer.
- **Apply the cited tool-result-clearing to the one window baton most controls: the orchestrator's own accumulating digest history.** The design cites Anthropic context-editing / tool-result-clearing but only for workers (whose windows baton *doesn't* own). The orchestrator's window is the exception — baton composes every `fleet_wait` return into it, so baton *can* prune stale digests (clear digests older than the last verified checkpoint). This is the highest-leverage, most-owned application of a technique the design already cites and then doesn't use where it actually has the leverage.

**Net:** the skeleton is sound and genuinely integrated — kill the word "emergent" (replace with "compositional surface area at O(1) integration cost"), fix the `concurrency_ceiling` cost-mechanism and the un-implementable cross-summary dedup, resolve the Manus/Tool-Search conflict as an explicit per-card economic choice, split scaffolding into capacity-contingent vs. capacity-invariant and defend the latter with the Chroma data already in hand, and ship the composition-ledger pull-through metric so the per-harness knobs are measured rather than asserted.
