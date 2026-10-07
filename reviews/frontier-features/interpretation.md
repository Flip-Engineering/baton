# Frontier research: interpretation

## PROPOSAL
# Program interpretation / understanding — frontier features for the fleet driver

*Scope note: baton's existing `orientation-reuse.md` already owns the **map** (per-SHA call graph, localization) and **dependency vetting**. This report deliberately does not re-propose those. It targets the deeper layer the task names — "what does this actually do," change-impact, static+dynamic fusion, code-property-graphs, effect inference, and turning understanding into a durable, trusted fleet asset — and wires each into the trust gate, semantic diff, worktrees, and the LOG.*

## State of the art now (2025-26)

| System / technique | What it does | Why it matters for baton | Cite |
|---|---|---|---|
| **LLMxCPG / codebadger** (Joern CPG + LLM) | Feeds an LLM *code-property-graph* slices (AST+CFG+PDG), taint source→sink paths, program slices; codebadger is an MCP server over Joern that patched CVE-2025-6021 in libxml2 first-try | The upgrade path for the Cartographer map from "call graph" to "dataflow/taint graph" — lets a verifier ask *"does this diff carry tainted input to a sink"* deterministically, not by vibes | [LLMxCPG](https://arxiv.org/html/2507.16585v1), [Bridging CPGs & LMs](https://arxiv.org/html/2603.24837v1), [Joern](https://joern.io/impact/) |
| **Deterministic blast-radius tools** (Recursive, pharaoh, Loomai, Impact-Assessment CC skill) | Graph-traversal (not probabilistic) over call/dependency edges to enumerate every function/file a change can break; the July-2025 Replit DB-wipe had a *blast radius of 91 dependent elements* | The single highest-value understanding primitive for a fleet: which tests to re-run in the trust gate, and whether a change reached beyond its path-lease | [Loomai glossary](https://loomai.io/glossary/blast-radius-analysis.html), [Recursive](https://recursive.pm/blast-radius), [pharaoh](https://pharaoh.so/blog/code-change-blast-radius/), [Impact-Assessment skill](https://mcpmarket.com/tools/skills/impact-assessment-blast-radius-analysis) |
| **"Do Code LLMs Do Static Analysis?" + LLM-augmented static analysis surveys** | Empirically: LLMs are decent at *intent* but unreliable at precise static facts (call targets, types) without a symbolic backend; hybrid > either alone | Justifies baton's stance: never trust an LLM's *claim* about code as fact — ground it in a computed graph and check it | [Do Code LLMs Do Static Analysis?](https://arxiv.org/html/2505.12118v1), [LLM-Assisted Program Analysis survey](https://arxiv.org/abs/2502.18474) |
| **RepoGraph / LocAgent / KGCompass** | Repo-level code graphs for LLM fault localization; +32.8% rel. on SWE-bench, graph-guided localization wins | Evidence the graph substrate pays off; localization is "understanding, applied" | [RepoGraph/LocAgent](https://arxiv.org/pdf/2503.09089) |
| **ReFEree / Entity-Tracing / RepoAgent** | Reference-free, fine-grained faithfulness checks for *code summaries*; entity-tracing catches hallucinated symbols; RepoAgent generates repo-level docs | The verification layer that lets a worker's summary become a *fleet fact* — a summary is promoted only after its cited entities check out | [ReFEree](https://arxiv.org/pdf/2604.10520), [Code-summary hallucination](https://arxiv.org/pdf/2404.00971) |
| **Learning-based + hybrid type/effect inference** (TypeT5-lineage, hybrid static+DL) | Infers types/call targets in dynamically-typed code by fusing static inference with a learned model; effect systems reason about IO/purity | Enables per-symbol "effect cards" (does this touch net/fs/global state?) in languages with no effect system | [Learning Type Inference for Dataflow](https://arxiv.org/pdf/2310.00673), [Hybrid Type Inference](https://arxiv.org/pdf/2105.03595), [Type/Ability/Effect systems](https://arxiv.org/pdf/2510.07582) |
| **SLICET5 / program slicing** | LLM-assisted static program slicing (what statements affect a value) with constrained decoding | The "why does this line matter" primitive behind change-impact and taint | [SLICET5](https://arxiv.org/pdf/2509.17338) |
| **TraceCoder / zero-replay trace debugging** | Trace-driven multi-agent debugging: runtime traces (not just pass/fail) fed back so the model stops making blind local edits | Static+dynamic *fusion*: pair the trust gate's test run with a trace to see which code paths the tests actually exercised | [TraceCoder](https://arxiv.org/html/2602.06875v1), [Zero-replay trace debugging](https://arxiv.org/html/2606.14805v1) |
| **Graphiti / AriGraph** (bi-temporal KG world models) | Incrementally-updated, *bi-temporal* knowledge graphs (event-time + ingest-time) as agent memory; semantic + episodic layers, community clustering, no batch recompute | The template for a live, versioned, self-updating **repo belief-model** — understanding as durable shared state, invalidated correctly on change | [Graphiti/Zep](https://zylos.ai/research/2026-05-09-knowledge-graph-world-models-ai-agents/), [AriGraph](https://www.ijcai.org/proceedings/2025/0002.pdf) |
| **SCIP + stack-graphs (cautionary)** | SCIP is the durable, compiler-accurate index format; **GitHub archived stack-graphs Sept 2025**; SCIP indexers are still whole-project, not file-incremental | Don't bet on incremental-graph magic that keeps dying; use SCIP where compilers emit it, tree-sitter tags elsewhere, and make the *belief cache* incremental instead of the index | [stack-graphs archived](https://github.com/orgs/sheeptechnologies/discussions/4), [SCIP](https://sourcegraph.com/blog/announcing-scip), [Endor reachability](https://docs.endorlabs.com/scan/sca/reachability-analysis) |

## Beyond-frontier ideas (clearly labeled speculation)

- **The living repo belief-model.** Today's world-model KGs (Graphiti/AriGraph) model *an agent's episodic memory*, not *a codebase's behavior over time*. Speculation: a bi-temporal graph whose nodes are symbols/modules and whose values are **grounded belief cards** — "`charge()` calls Stripe, is not idempotent, is reachable from the webhook handler" — each with a confidence, a provenance chain to the lines that justify it, and a *staleness* flag. Every accepted merge doesn't rebuild it; it **invalidates only the beliefs inside the merge's blast radius** and re-derives those. The fleet stops re-reading the repo; it reads its own maintained understanding, and disagreements between a belief and fresh evidence become first-class events.
- **Intent-vs-effect reconciliation as the review verb.** Speculation: fuse three things the system already has — the *brief* (declared intent), the *semantic diff* (observed behavior change), and the *blast radius* (reach) — into one judgment: "the task said 'fix the timezone bug in `format_date`' but the behavioral change also alters `parse_date`'s error path, which is out of the declared scope." This turns "understanding a change" into an automatic scope-and-surprise detector.
- **Coverage-of-change as a trust-gate invariant.** Speculation beyond current practice: it is not enough that the re-run tests *pass* — the trust gate should refuse "done" unless the tests **executed the changed lines**. A green suite that never runs the diff is the most dangerous false-positive in autonomous coding, and no mainstream agent gates on it yet.
- **Effect-delta safety coupling.** Speculation: tie inferred effects to SYSTEM §4.4's honest limit on irreversible outside-world actions — if a diff makes a previously-pure function perform network/DB IO, that's not just a review note, it auto-escalates the change to approval-gated even if the worker never called `push`.

## Proposed features for baton (the actionable core)

### 1. Impact-selected re-verification (blast-radius → the trust gate)
- **What:** Before re-running tests, compute the diff's blast radius on the code graph and re-run *the tests that actually reach the change*, plus flag any reach outside the worker's path-lease.
- **How it plugs in:** *Coordinator feature*, run at the trust-gate step in the fresh worktree. Uses the Cartographer graph (deterministic traversal, à la Recursive/pharaoh) to map changed symbols → dependent tests. Emits `knowledge.impact_computed {diff_ref, reached_symbols, selected_tests, out_of_scope_reach}` to the LOG; the trust gate believes "done" only on the coordinator's own impact-selected run. Feeds the existing scope-drift signal when reach exceeds the lease.
- **Frontier or beyond:** SOTA-adoption (deterministic blast-radius is 2025 practice) + one novel twist (gating the *referee's* test selection, not just informing a human).
- **Moat / bet / rental:** **Moat** — trustworthy verification stays valuable as models improve; a smarter worker still needs an external, deterministic check of *what its change can break*.
- **MVP or later:** **Earlier** (Phase 3, alongside semantic-diff review). It directly hardens the MVP's marquee promise ("re-run before believing done").

### 2. Coverage-of-change gate (static+dynamic fusion in the referee)
- **What:** During the trust gate's test run, capture a lightweight execution trace/coverage and refuse "done" if the changed lines were never executed.
- **How it plugs in:** *Coordinator feature* extending re-verification. The fresh-worktree run already executes; add coverage capture, intersect with the diff's changed spans. Emits `knowledge.change_coverage {diff_ref, changed_lines, executed, uncovered}`; an uncovered change becomes a trust-gate *fail-or-warn* and a `fleet_wait` digest line. This is the static (diff) + dynamic (trace) fusion TraceCoder argues for, applied to verification rather than debugging.
- **Frontier or beyond:** **Novel** as a gate — coverage-of-diff exists in CI, but gating an *agent's* "done" on it, fleet-wide, isn't standard.
- **Moat / bet / rental:** **Moat** — closes the "green suite that never touched the change" hole, which no better base model removes.
- **MVP or later:** **Earlier**, right after feature 1 (they share the same test run).

### 3. Grounded, checked belief cards (understanding as a shared, trusted fact)
- **What:** A per-symbol/per-module summary — "what this does, what it calls, what it assumes" — where every claim is cited to specific lines and is faithfulness-checked before it's allowed to become a fleet fact.
- **How it plugs in:** *Worker tool* (`fleet_explain(symbol)`) that returns a grounded card, plus a *coordinator promotion step*: a worker-authored summary is untrusted prose until an entity-tracing/ReFEree-style check confirms its cited symbols exist and match the graph; only then does it promote to the knowledge plane as a `Finding` and a `knowledge.belief_recorded` event. Honors SYSTEM's core rule — worker output is never trusted as fact — by making grounding the gate.
- **Frontier or beyond:** SOTA-adoption (RepoAgent-style summaries) + novel (the *verification-before-promotion* discipline).
- **Moat / bet / rental:** **Split:** the raw summary is **rental** (models get better at this for free); the *grounded, checked, deduplicated fleet asset* is **moat**.
- **MVP or later:** **Later** (Phase 4 memory), but the promotion-gate is cheap and worth prototyping earlier.

### 4. Effect / capability cards ("what does this actually touch")
- **What:** Infer, per function, its effects — pure vs. reads-fs / writes-fs / network / DB / global-mutation / nondeterministic — and surface an **effect-delta** when a change adds one.
- **How it plugs in:** *Worker tool + coordinator signal*. Built on the PDG/taint layer (feature 6) plus learned inference where no effect system exists. An effect-delta on a diff emits `health.effect_delta {symbol, added_effects, reachable_from}` and — the safety coupling — auto-escalates a newly-side-effecting change to approval-gated (SYSTEM §4.4, §5.6), even absent an explicit `push`.
- **Frontier or beyond:** **Novel** in combination (effect inference exists in PL research; wiring it to agent approval-gating is new).
- **Moat / bet / rental:** **Moat** (safety/verification) with a **bet** flavor on inference precision in dynamic languages.
- **MVP or later:** **Later**; earns its place once feature 6's graph exists.

### 5. Code-property-graph rung for the map (taint/dataflow understanding)
- **What:** Upgrade the Cartographer's call graph to a CPG (AST+CFG+PDG) for security/dataflow queries — "does this diff move untrusted input to a dangerous sink."
- **How it plugs in:** *Worker tool*, a deeper backend rung behind `fleet_locate`/`fleet_orient` (Joern where it supports the language, tree-sitter tags elsewhere — do **not** try to hand-roll a polyglot CPG; see the stack-graphs graveyard). Serves the trust gate's *security* rung on the evidence ladder (SYSTEM §5.1). Reachability data also sharpens the Quartermaster's vuln gating (Endor-style, on the free in-fleet graph). Emits `knowledge.taint_path {diff_ref, source, sink, reachable}`.
- **Frontier or beyond:** SOTA-adoption (LLMxCPG / codebadger / Joern-MCP is exactly 2025-26).
- **Moat / bet / rental:** **Moat** for security-sensitive verification; the LLM-over-CPG glue is partly rental.
- **MVP or later:** **Later**, switched on for security-touching tasks (path scope includes auth/crypto/input handling).

### 6. Intent-vs-effect reconciliation (the cross-vendor review verb)
- **What:** Judge a change by lining up its *declared intent* (brief), its *observed behavior change* (semantic diff), and its *reach* (blast radius) — and flagging mismatches and surprises.
- **How it plugs in:** *Coordinator feature* feeding the review/steering loop; consumes the semantic-diff tool (SYSTEM §5.4) it already plans to build. Produces a `knowledge.change_reconciled {diff_ref, intent, behavior_delta, surprises[]}` event and a short digest line the orchestrator sees. A surprise (behavior change outside the brief's scope) is a steer trigger, not a silent merge.
- **Frontier or beyond:** **Novel** — no shipping agent reconciles brief-intent against measured behavioral delta this way.
- **Moat / bet / rental:** **Moat** — this is judgment *about* the change that improves the fleet's driving regardless of model quality.
- **MVP or later:** **Later** (needs semantic diff first), but high-leverage once that lands.

### 7. The living repo belief-model (durable, versioned understanding)
- **What:** A bi-temporal graph of grounded belief cards for the whole repo, maintained across runs, invalidated *only within a merge's blast radius* rather than rebuilt.
- **How it plugs in:** *Coordinator feature + slow memory*. It is the aggregation of features 1–5's outputs: beliefs (3), effects (4), taint (5), keyed by symbol, versioned per SHA like the map, bi-temporal like Graphiti/AriGraph. On an accepted merge, the coordinator invalidates beliefs whose symbols intersect the blast radius (feature 1) and re-derives them; everything else stays warm. Cross-run recall stays explicit (`fleet_recall`), never auto-injected. This is the "understanding-as-a-shared-fleet-asset" deliverable: N workers read the model, not the repo.
- **Frontier or beyond:** **Beyond-frontier** (labeled bet).
- **Moat / bet / rental:** **Bet** on the full self-maintaining version; the **incremental core** (cache grounded cards per SHA, invalidate by blast radius) is a **moat** and is buildable without the speculative parts.
- **MVP or later:** **Later** (Phase 4). Ship the invalidate-by-blast-radius cache first; grow the belief graph only if reuse proves it out.

## Add / subtract / modify

**ADD**
- A `knowledge.impact_*` / `knowledge.change_coverage` / `health.effect_delta` event family — understanding facts belong in the append-only LOG, tagged trusted-fact-vs-worker-prose like everything else.
- Blast-radius computation and coverage-of-change as **trust-gate inputs**, not just human dashboards — this is the biggest single hardening available to the MVP's core promise.
- A **grounding/faithfulness promotion gate** for any summary or belief before it becomes a fleet fact (mirrors the untrusted-by-default safety stance already in §5.6).

**MODIFY**
- SYSTEM §5.1 says the referee "re-runs the check itself." Sharpen it to: re-runs the **impact-selected** tests **and** verifies the change was **executed**. "Ran the tests" and "tested the change" are different claims; only the second earns trust.
- `orientation-reuse.md` treats the map as rebuilt per `(repo, sha)`. Given the SCIP-incrementality wall and the archived stack-graphs, **move incrementality to the belief cache, not the index**: rebuild the index when you must, but invalidate *understanding* by blast radius so the expensive semantic layer isn't recomputed wholesale each commit.
- Semantic diff (§5.4) is currently framed as a review aid. Promote it to an **input to the trust gate and to intent-reconciliation** — it's the substrate for features 2 and 6, not just a nicer diff view.

**SUBTRACT / DON'T BUILD**
- Do **not** hand-build a polyglot code-property or stack graph in-house. Stack-graphs was archived Sept 2025 and SCIP indexers remain non-incremental; lean on Joern/tree-sitter/SCIP where each already works and keep the in-house layer to the *belief cache and impact traversal* over whatever graph you can get.
- Resist a "summarize the whole repo" verb. Understanding is only valuable **addressed and grounded**; an ungrounded repo-wide summary is the rental part a better base model gives away for free, and it burns the scarcest resource (orchestrator context) for the least durable gain.

## Sources

- LLMxCPG (CPG-guided vuln detection): https://arxiv.org/html/2507.16585v1
- Bridging Code Property Graphs and Language Models: https://arxiv.org/html/2603.24837v1
- Joern (CPG workbench) impact / codebadger: https://joern.io/impact/
- Neuro-symbolic static analysis w/ LLM-generated patterns: https://arxiv.org/pdf/2504.16057
- Blast-radius analysis (Loomai glossary): https://loomai.io/glossary/blast-radius-analysis.html
- Deterministic blast radius (Recursive): https://recursive.pm/blast-radius
- Code-change blast radius (pharaoh): https://pharaoh.so/blog/code-change-blast-radius/
- Impact-Assessment Claude Code skill: https://mcpmarket.com/tools/skills/impact-assessment-blast-radius-analysis
- LLM-Augmented Release Intelligence (change summarization + impact): https://arxiv.org/abs/2603.14619
- Do Code LLMs Do Static Analysis?: https://arxiv.org/html/2505.12118v1
- Contemporary Survey of LLM-Assisted Program Analysis: https://arxiv.org/abs/2502.18474
- RepoGraph / LocAgent (graph-guided localization): https://arxiv.org/pdf/2503.09089
- SLICET5 (LLM program slicing): https://arxiv.org/pdf/2509.17338
- ReFEree (code-summary factual consistency): https://arxiv.org/pdf/2604.10520
- Hallucinations in LLM-generated code: https://arxiv.org/pdf/2404.00971
- Learning Type Inference for Enhanced Dataflow Analysis: https://arxiv.org/pdf/2310.00673
- Hybrid (static + DL) type inference: https://arxiv.org/pdf/2105.03595
- Type, Ability, and Effect Systems (purity): https://arxiv.org/pdf/2510.07582
- TraceCoder (trace-driven debugging): https://arxiv.org/html/2602.06875v1
- Zero-replay debugging of multi-agent LLM traces: https://arxiv.org/html/2606.14805v1
- Graphiti / KG world models: https://zylos.ai/research/2026-05-09-knowledge-graph-world-models-ai-agents/
- AriGraph (KG world model + episodic memory): https://www.ijcai.org/proceedings/2025/0002.pdf
- Stack-graphs removal / tree-sitter incremental (archived Sept 2025): https://github.com/orgs/sheeptechnologies/discussions/4
- SCIP indexing format: https://sourcegraph.com/blog/announcing-scip
- Endor Labs reachability analysis: https://docs.endorlabs.com/scan/sca/reachability-analysis

## FILTER
## Filter: interpretation

I read SYSTEM.md, GLOSSARY.md, and orientation-reuse.md. I verified the two load-bearing external claims: codebadger really did patch CVE-2025-6021 in libxml2 first-try via Joern CPGs ([GitHub](https://github.com/lekssays/codebadger), [Bridging CPGs & LMs, ACM 2026](https://dl.acm.org/doi/10.1145/3786165.3788441)), and the future-dated arXiv IDs (2603.x etc.) resolve to real papers — so the citation set is grounded, not padded. Good. The proposal's biggest honesty problems are elsewhere: one whole research field it skipped, and two "moat" labels that are really rentals.

**The field it MISSED (this matters for Features 1 and 2):** Feature 1 is *regression test selection* (RTS) / *test impact analysis* (TIA) — a 20-year discipline with industrial implementations, and the proposal cites startup marketing blogs (Recursive, pharaoh, Loomai) instead of the actual state of the art: **Ekstazi** (Gligoric et al., the canonical file-level RTS), **Meta's ML predictive test selection** (the fleet-scale version), **Microsoft Azure Pipelines TIA**, and **Google's TIA**. And Google's own published lesson is the one that should reshape Feature 1: *when the selector isn't confident, fall back to the full suite, because a missed regression costs more than a longer run.* That directly contradicts framing test-selection as a trust *gate*. Feature 2 similarly builds on mature primitives it doesn't name — **diff/patch coverage** (`diff-cover`, Codecov patch status) — and skips the *stronger* form, **mutation testing** (PIT, Stryker), which answers the question coverage can't: did the test actually *catch* the change, or merely execute the line.

---

### Feature 1 — Impact-selected re-verification → MODIFY
Real and it fits perfectly (coordinator step, fresh worktree, LOG event, feeds scope-drift). But the framing is backwards and the moat claim is soft. **Selecting a subset of tests is a cost optimization, not a trust primitive** — and a risky one, because the module's own "honest residuals" already admit call graphs are incomplete for reflection/DI/`eval`/FFI, so a missed edge silently drops the exact test that catches the regression. That's a trust *hole*, not a trust gate. The genuinely durable, moat-grade half is the **out-of-scope reach flag** ("this diff reaches beyond the worker's path-lease") — that's a deterministic safety signal no better model obviates. Keep that. Default to the full suite; use blast-radius selection only as an opt-in speedup with a full-suite fallback, per Google's lesson. Cite Ekstazi/Meta/MS/Google, drop the blog links.

### Feature 2 — Coverage-of-change gate → KEEP (the one to build first — see below)
The strongest, cheapest, most honest item. Real base primitive (patch coverage), genuinely novel *as an agent-done gate* (mainstream coding agents don't gate on it), and the moat claim holds: a green suite that never executed the diff is the canonical autonomous-coding false positive, and no smarter worker removes it. Two corrections to make it honest: (1) drop "novel" for the coverage mechanism itself — say "standard CI primitive, novel as a fleet trust invariant"; (2) note coverage is *necessary, not sufficient* — a line executed under a test that asserts nothing still passes green. The stronger version is mutation-of-diff (did any test *fail* when the changed lines are perturbed). Ship line-coverage-of-diff first; name mutation as the rung-2 upgrade.

### Feature 3 — Grounded checked belief cards → MODIFY (keep the gate, cut the product)
The moat/rental split here is the most honest call in the document: raw summary = rental (models get better for free), the *verification-before-promotion* discipline = moat. Agreed. But the scope note claims not to re-tread orientation-reuse, and this does — that doc already promotes a module summary to a Finding. So don't build a new `fleet_explain` verb and belief-card subsystem. **Build only the entity-tracing faithfulness gate** (a summary's cited symbols must exist and match the graph before it promotes) as a thin addition to the promotion path that already exists. That gate is cheap, model-proof, and directly enforces SYSTEM's "worker prose is never trusted as fact." The standalone card product is Phase-4 weight for Phase-4-uncertain payoff — defer it.

### Feature 4 — Effect / capability cards + auto-escalation → MODIFY (keep the tripwire, cut the effect system)
The *safety coupling* is the valuable, well-fitting idea: a diff that makes a previously-pure function do network/DB/fs IO auto-escalates to approval-gated (§4.4, §5.6, LOG). That's real and moat-grade because it's a safety invariant. But "infer per-function effects, especially in dynamic languages" is a **bet dressed a little too confidently** — the proposal admits the "bet flavor," but understates that a *false negative* (missed effect) is a silent safety regression, which is worse than the false-positive annoyance it acknowledges. The honest MVP is not a learned effect system: it's a **deterministic tripwire** — detect *new* imports/calls to a known set of dangerous sinks (`net`, `fs`, `subprocess`, DB drivers) appearing in the diff. Grep-grade, no inference, no false-negative-from-a-bad-model. Ship that; treat learned effect inference as a much-later, clearly-flagged bet gated on Feature 5's graph existing.

### Feature 5 — CPG rung (taint/dataflow) → KEEP
Real (codebadger/LLMxCPG verified), fits as a deeper backend rung behind `fleet_locate`, serves the trust gate's security rung and the Quartermaster's reachability gating. The best judgment in the whole proposal is its own SUBTRACT note: **do not hand-build a polyglot CPG — lean on Joern/tree-sitter/SCIP, the stack-graphs graveyard is the warning.** Correct and load-bearing. Moat/rental split is honest (deterministic taint check = moat, LLM narration over it = rental). Keep as later, gated to security-touching path scopes. No changes.

### Feature 6 — Intent-vs-effect reconciliation → MODIFY (the moat claim is a rental in disguise)
This is the one dishonest label. The proposal calls it "moat — judgment about the change regardless of model quality." But the judgment "does the observed behavior match the declared intent?" is exactly an LLM-as-judge task, and LLM judgment is the *first* thing that improves for free as base models get better — it's a textbook **rental**. What's actually durable here is not the verdict, it's the **plumbing**: getting the brief, the semantic diff, and the blast radius into the LOG as structured, co-located inputs so *whatever* judge (this model or next year's) can reconcile them, and so a surprise becomes a logged steer-trigger rather than a silent merge. Keep the plumbing and the event; relabel the judgment as rental. Also soften "no shipping agent does this" — reconciling a PR against its stated intent is ordinary code review; the novelty is only that it's automatic and fleet-wide.

### Feature 7 — Living repo belief-model → CUT the graph, KEEP the one-line insight
Correctly self-labeled a bet, and the proposal already retreats to "ship the invalidate-by-blast-radius cache first." Agree — so cut the bi-temporal belief graph entirely for now; it's speculation stacked on Features 1–5 that don't exist yet, and Graphiti/AriGraph model an *agent's episodic memory*, not a codebase's behavior, so the analogy is looser than claimed. The genuinely useful residue is the MODIFY-to-orientation-reuse note: *move incrementality to the belief/understanding cache, not the index* (because SCIP indexers aren't file-incremental and stack-graphs was archived). That's a sound architectural point worth recording in orientation-reuse.md — but it's a design note, not a thing to build in this cycle.

---

### The one to build first: Feature 2 (coverage-of-change gate)
Because it wins on every axis the others split: it's the **cheapest** (it piggybacks entirely on the test run the trust gate *already does* in the fresh worktree — add coverage capture, intersect with the diff spans); it has the **most defensible moat** (a passing suite that never touched the change is the signature failure mode of autonomous coding, and it stays real no matter how good the worker model gets); it plugs **directly into the existing §5.1 re-verify step** and emits one clean LOG event; and it hardens the MVP's marquee promise more than anything else here — turning "I re-ran the tests" into "I confirmed the tests *executed the change*," which are different claims and only the second earns trust.

Build it together with Feature 1's **reach-flag** (they share the same instrumented run), but keep the roles straight: coverage-of-change is the *invariant that earns trust*; blast-radius selection is an *optimization* added later with a full-suite fallback. Name mutation-of-diff as the honest rung-2 upgrade once line-coverage lands.
