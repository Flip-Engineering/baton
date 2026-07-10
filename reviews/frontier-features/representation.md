# Frontier research: representation

## PROPOSAL
# Code representation — frontier features for the fleet driver

*Read: `SYSTEM.md`, `GLOSSARY.md`, `docs/15-representation-and-computation.md`. This validates doc 15's ladder, updates two of its calls with 2025-26 evidence (semantic merge is no longer a pure research bet; the incremental substrate is the real deliverable, not a footnote), and proposes the specific build items that plug into the trust gate, the merge step, and the LOG.*

## State of the art now (2025-26)

| System / technique | What it does | Why it matters to baton | Cite |
|---|---|---|---|
| **tree-sitter** | Incremental, error-tolerant parser → concrete syntax tree for 40+ langs; re-parses only edited spans | The universal substrate. Every rung below (diff, merge, structural search) sits on it. Incremental = cheap to maintain under a worker's live edits | [tree-sitter](https://tree-sitter.github.io/tree-sitter/) |
| **ast-grep / comby** | Structural search-and-rewrite by syntax pattern, not regex | The worker tool for "rename this construct everywhere," "never match in comments" — R1 of the ladder, already shippable | [ast-grep](https://ast-grep.github.io/) |
| **difftastic / diffsitter / SemanticDiff** | AST-level structural diff: hides reformatting/renames, shows the real change. SemanticDiff goes further (knows `1337`==`0x539`, ignores moved functions) | This *is* doc 15 §6's front-loaded item, and it ships today. difftastic is tree-sitter-based and drops into `git diff` | [difftastic](https://github.com/Wilfred/difftastic), [diffsitter](https://github.com/afnanenayet/diffsitter), [SemanticDiff](https://semanticdiff.com/blog/semanticdiff-vs-difftastic/) |
| **GumTree** | AST *edit script* (mapping between two trees: moves/inserts/deletes), not just a delta | The algorithm under structured merge and fine-grained change classification | [GumTree](https://github.com/GumTreeDiff/gumtree) |
| **Mergiraf** | **Production** syntax-aware Git *merge driver*: parses base/left/right, matches subtrees, resolves line-conflicts that are semantically disjoint | **The big update to doc 15 §4b.** Structured (not full-CPG) merge is no longer "a research bet" — it's a `git config` away. Moved off tree-sitter to native parsers + Dijkstra matching for accuracy | [Mergiraf](https://mergiraf.org/architecture.html), [LWN](https://lwn.net/Articles/1042355/) |
| **SCIP + stack-graphs (LSP)** | Language-agnostic symbol-graph index: go-to-def, find-refs, cross-repo nav. SCIP now independent-governed (Uber/Meta steering), 45k+ indexed repos | R2 of the ladder, commodity and standardized. Baton adopts, never invents, this rung | [SCIP](https://scip-code.org/), [The future of SCIP](https://sourcegraph.com/blog/the-future-of-scip) |
| **Serena (MCP + LSP)** | Ships the "structure not text" agent interface *now*: symbol-level retrieval/editing over LSP, returns precise symbols instead of grep noise | **Direct validation of doc 15 §3.** The primary-interface-is-structure thesis is real and in production for agents — token-efficient on large repos | [Serena](https://github.com/oraios/serena) |
| **Joern / CodeQL / Semgrep (CPG)** | Code Property Graph = AST+CFG+PDG unified; "does user input reach this sink" is a local graph query | R3, the Referee's ideal risk view. And now agent-wrapped: **codebadger** (MCP server exposing Joern slicing/taint to LLMs; found+patched CVE-2025-6021 first try), **LLMxCPG** (USENIX Security 2025) | [LLMxCPG](https://arxiv.org/html/2507.16585v1), [CPG×LM](https://arxiv.org/abs/2603.24837) |
| **Salsa / rust-analyzer** | Demand-driven, memoized, incremental query engine (red/green): change an input, only the affected derived facts recompute | **The maintenance engine doc 15 needs but buries.** This is how you keep CPG/symbol-graph fresh under N diverging worktrees without full re-index | [Salsa](https://github.com/salsa-rs/salsa), [rustc query system](https://rustc-dev-guide.rust-lang.org/queries/salsa.html) |
| **egglog / egg / HEC / DialEgg** | Equality saturation: one e-graph holds all equivalent forms; HEC checks *functional equivalence* by testing if two programs land in the same e-class after saturation | R5 equivalence. Real progress (HEC 2025, DialEgg CGO'25) but still **expression/kernel-level**, not whole-repo. Confirms doc 15's "research bet" call | [HEC](https://arxiv.org/pdf/2506.02290), [DialEgg](https://dl.acm.org/doi/pdf/10.1145/3696443.3708957) |
| **Repo-level code graphs (RepoGraph, CGM, LocAgent, CodexGraph)** | Build call/dependency/data-flow graphs and feed them to LLM agents for localization/generation | RepoGraph: **+32.8% relative on SWE-bench** just by giving the agent a graph. Learned+symbolic hybrid is the retrieval frontier — feeds the worker tool in §5.4 | [RepoGraph/CGM](https://arxiv.org/pdf/2505.16901), [survey](https://arxiv.org/html/2510.04905v1) |

**Bottom line on the ladder:** doc 15's R0→R5 ladder is *correct and holds up*. What has changed since it was written: (a) structured **merge** graduated from research to production (Mergiraf), (b) CPG-for-agents graduated too (codebadger/LLMxCPG), (c) the "structure is the interface" thesis is now shipping (Serena), and (d) the incremental-computation substrate (Salsa-style) is clearly the load-bearing engineering, not a limits-section caveat.

## Beyond-frontier ideas (clearly labeled speculation)

- **Representation-on-demand as a coordinator service.** No representation is pre-built for a repo. The coordinator lazily materializes exactly the rung a task-phase asks for (Salsa memoizes it), keyed by commit, shared base⊕overlay across worktrees. The agent never picks a representation; it asks a question ("what reaches this sink after my change?") and the coordinator serves the cheapest rung that answers it. *Speculation:* the clean overlay-vs-reindex threshold under many diverging worktrees is unproven at scale.
- **The LOG as a program representation.** Because the LOG is the only truth and every edit is captured as a commit, the *sequence of semantic deltas* is itself a representation of "how this change was built" — replayable, and a training signal for routing. Reviewing the delta-stream (not the final diff) could catch "worker thrashed here" that a final diff hides. *Speculation:* useful signal-to-noise unproven.
- **Trust as a spatial overlay (attestation-annotated representation, doc 15 §4d).** Every node/edge carries its verification frontier; touching a proven-pure function auto-flags the proof stale. This is the most genuinely novel idea in doc 15 and it survives scrutiny — but it only pays off *if* the Referee ladder produces attestations worth threading.

## Proposed features for baton (the actionable core)

### 1. Structural semantic-diff as the review primitive
- **What:** every worker result is presented to the reviewer (orchestrator or a cross-vendor worker) as an AST-level delta that hides reformatting/renames, not a raw text diff.
- **How it plugs in:** *coordinator feature* on the merge/review path + *worker tool* for cross-vendor review. The coordinator computes it (difftastic/diffsitter-class, tree-sitter under it) at the worker's committed result inside the fresh worktree the trust gate already creates; the delta and its "change class" (pure-reformat / logic-changed / signature-changed) are written to the LOG as coordinator-computed facts (trusted), distinct from worker prose.
- **Frontier or beyond:** SOTA-adoption.
- **Moat / bet / rental:** **Moat.** Strictly less context for strictly more signal — value grows as models get more expensive, not less. (doc 15 §4a is right about this.)
- **MVP or later:** **MVP-adjacent** — this is the one representation item doc 15 §6 already front-loads, and it should ship with the review step in build phase 3.

### 2. CPG-delta as the trust gate's risk triage
- **What:** on re-verify, compute the data-flow delta of the change (new taint edge `input → exec/fs/net`, altered control branch on a security-relevant path) over the *changed functions only*, and stamp the result with a risk class.
- **How it plugs in:** *coordinator feature inside the trust gate.* After tests re-run clean in the fresh worktree, run a localized Joern/CodeQL/Semgrep pass on the diff's blast-radius; the risk class routes review depth (auto-merge low-risk, escalate "new taint path to filesystem"). Output → LOG. Never whole-program — scoped to changed symbols so it's affordable.
- **Frontier or beyond:** SOTA-adoption (codebadger, LLMxCPG prove agents can drive CPG usefully in 2025).
- **Moat / bet / rental:** **Moat** if the Referee is — this is the Referee thinking in data-flow instead of test pass/fail.
- **MVP or later:** **Later, earned.** Turn on when the review fleet demonstrably wants risk-routing; passing tests alone is the MVP bar.

### 3. Syntax-aware structured merge (Mergiraf-class) as a real middle rung
- **What:** when two workers' branches conflict on lines but the changes are structurally disjoint, resolve automatically with a syntax-aware merge instead of dumping a textual conflict.
- **How it plugs in:** *coordinator feature* on the merge step (§4.1). Slots between "textual merge" (MVP) and "true semantic/data-flow merge" (still a bet). Each auto-resolution is logged with the pre-image so it's replayable and reviewable; the trust gate re-runs tests on the merged result before believing it.
- **Frontier or beyond:** SOTA-adoption — **this is the update.** doc 15 §4b and SYSTEM.md §10 both file semantic merge as "Bet / Research"; Mergiraf makes the *structured* tier a low-risk adoption today.
- **Moat / bet / rental:** **Rental-trending-commodity.** Don't build a merge algorithm — wrap Mergiraf. The moat is the *fleet policy around it* (path leases + structured merge + re-verify), not the merge itself.
- **MVP or later:** **Phase 2-3.** Path leases already avoid most conflicts (§4.1); this catches the residue and materially raises the viable worker-count N.

### 4. Behavioral fingerprint for the ensemble
- **What:** represent a changed function by its *observed behavior* — I/O over a property/fuzz corpus plus an effect signature (reads/writes/calls) — and compare N vendor implementations by fingerprint divergence, not text.
- **How it plugs in:** *coordinator feature*, reusing the trust gate's sandboxed fresh worktree. When the fleet produces N implementations of one task (the honest ensemble use), the coordinator executes each against a shared corpus and logs the fingerprint; divergence *is* the signal, no spec or autoformalization needed. Corpus and counterexamples persist in slow memory (shared across the fleet).
- **Frontier or beyond:** SOTA-adoption of differential testing + **novel** as a fleet-native, cached, shared *representation* (HEC does this symbolically for kernels; baton does it empirically at function scope).
- **Moat / bet / rental:** **Moat.** A stronger model still cannot know two implementations agree without *running* them; the fingerprint is the shared cached form of "we ran them, here's where they differ."
- **MVP or later:** **Later** — earned when ensembles are actually run; depends on a decent input corpus (the honest limit, doc 15 §4c).

### 5. Incremental representation substrate (Salsa-style) — the plumbing that makes 1-4 affordable
- **What:** one content-addressed, demand-driven, memoized store of derived representations (CST, symbol graph, CPG facts), keyed by commit, maintained as base⊕per-worktree overlay so a worker's edit invalidates only the affected facts.
- **How it plugs in:** *coordinator infrastructure* underneath the worker tools and the trust gate. It's the answer to doc 15 §5's own worry ("these must be incrementally maintained under N diverging worktrees"). Salsa/rust-analyzer's red/green algorithm and SCIP's overlay model are the proven blueprints.
- **Frontier or beyond:** SOTA-adoption (Salsa, rust-analyzer, SCIP) applied to a new setting (many worktrees, one shared history).
- **Moat / bet / rental:** **Moat if it works, engineering bet on the overlay threshold.** This is where the durable, hard-to-copy engineering lives — everyone can call difftastic; keeping ten diverging worktrees' CPGs fresh cheaply is the actual problem.
- **MVP or later:** **Later, but foundational** — don't build until feature 2 or 4 demands a second representation; a single-worktree recompute is fine for feature 1's MVP.

### 6. Structure-first worker retrieval (Serena/SCIP-backed)
- **What:** the shared code-search tool (SYSTEM.md §5.4) answers symbol-graph queries ("what calls this," "definition of X") over LSP/SCIP, returning precise symbols, not grep hits.
- **How it plugs in:** *worker tool*, shared and indexed once for the whole fleet (the "atlas" delivery vehicle). Structure queries return a few hundred tokens where text search returns tens of thousands.
- **Frontier or beyond:** SOTA-adoption — Serena ships exactly this.
- **Moat / bet / rental:** **Rental.** Vendors and Serena are converging here fast; keep it thin and swappable, don't over-invest. The moat is *sharing one index across the fleet*, not the retrieval itself.
- **MVP or later:** **Phase 3** as part of shared code search.

### 7. Attestation overlay — trust as a property of the representation
- **What:** the representation carries each node/edge's verification frontier (fuzzed-clean, proven-pure, unverified, stale); editing a verified node auto-flags it stale.
- **How it plugs in:** *coordinator feature*; the overlay is literally the LOG's re-verify outcomes projected onto the code the workers read. It makes verification an ambient, spatial property instead of an end-gate — a worker *sees* where it's standing on checked ground.
- **Frontier or beyond:** **Novel.**
- **Moat / bet / rental:** **Moat iff the Referee is** — it's the Referee's output made legible.
- **MVP or later:** **Later** — only meaningful once the deeper-check ladder produces attestations worth threading. Don't build ahead of that.

### 8. E-graph equivalence check for "semantics-preserving" claims — research track, not a build item
- **What:** for a refactor/perf change that claims "same behavior, faster," check equivalence of the changed function via equality saturation (HEC/egglog-style e-class membership).
- **How it plugs in:** would be the deepest rung of the trust gate for equivalence claims.
- **Frontier or beyond:** **Novel / research.**
- **Moat / bet / rental:** **Bet.** HEC/DialEgg are still expression/kernel-scale in 2025-26; whole-function/repo equality saturation explodes.
- **MVP or later:** **Research-track only.** Behavioral fingerprint (feature 4) gives most of the value empirically and cheaply; prefer it. This is a candidate to **CUT** from the build plan.

## Add / subtract / modify

**ADD**
- **The incremental substrate (feature 5) as a named deliverable.** doc 15 buries it in the §5 "limits" section; it is the actual moat and the thing that makes every other rung affordable under N worktrees. Promote it from caveat to plan.
- **Structure-first retrieval (feature 6)** as explicit SOTA-adoption — Serena validates doc 15 §3's thesis is real and shippable, so baton adopts rather than invents.

**MODIFY**
- **Semantic merge (doc 15 §4b, SYSTEM.md §10 row "Semantic merge at scale = Bet/Research").** Split it: a **structured merge** tier (Mergiraf-class, syntax-aware) is *production-ready SOTA-adoption today*, and belongs in phase 2-3, not "Research." Reserve "Bet" for *true data-flow-aware* merge (conflict = same semantic edge, incompatible intent), which is still unproven. This is the single most important update the 2025-26 evidence forces.
- **CPG framing (doc 15 §3/§36).** doc 15 says "the CPG is the representation the Referee should think in" and implies a whole-program CPG delta. Scope it down: CPG-delta is a **localized triage over changed functions only** (feature 2), gated on demand — the whole-program version is too expensive to maintain and over-claims. Structural diff (feature 1), not CPG, is the *primary* review unit; CPG is the *escalation*.

**SUBTRACT / CUT**
- **E-graph equivalence at repo scale (doc 15 §4e).** doc 15 already flags it a bet; the 2025-26 evidence (HEC/DialEgg still kernel-scale) confirms it. Keep as research-track; do **not** put it on the build plan. Behavioral fingerprint (feature 4) covers the "did behavior change" need empirically for far less risk.
- **"Representation choreography" as a distinct build item (doc 15 §4f).** It's context engineering (docs 12/14) restated in representation vocabulary — "serve the phase's view, evict the rest." Fold it into context handling; don't build a separate choreography subsystem. The insight is right; a second system for it is over-ambition.

**Net:** doc 15's ladder and its two flagged moats (semantic diff, behavioral fingerprint) are validated and should be built. The correction is one of *emphasis*: build the boring incremental substrate that makes the ladder cheap, adopt Mergiraf for the merge rung the doc thought was still research, keep CPG as a scoped triage rather than the primary lens, and drop repo-scale e-graphs and standalone choreography as over-reach.

## Sources
- [difftastic](https://github.com/Wilfred/difftastic) · [diffsitter](https://github.com/afnanenayet/diffsitter) · [SemanticDiff vs difftastic](https://semanticdiff.com/blog/semanticdiff-vs-difftastic/) · [GumTree](https://github.com/GumTreeDiff/gumtree)
- [Mergiraf architecture](https://mergiraf.org/architecture.html) · [Mergiraf on LWN](https://lwn.net/Articles/1042355/) · [Spork](https://github.com/ASSERT-KTH/spork)
- [SCIP](https://scip-code.org/) · [The future of SCIP (Sourcegraph)](https://sourcegraph.com/blog/the-future-of-scip) · [ast-grep](https://ast-grep.github.io/)
- [Serena MCP+LSP](https://github.com/oraios/serena)
- [LLMxCPG (USENIX Security 2025)](https://arxiv.org/html/2507.16585v1) · [Bridging CPGs and Language Models](https://arxiv.org/abs/2603.24837)
- [Salsa](https://github.com/salsa-rs/salsa) · [rustc query/Salsa](https://rustc-dev-guide.rust-lang.org/queries/salsa.html)
- [HEC: equivalence via equality saturation](https://arxiv.org/pdf/2506.02290) · [DialEgg (CGO'25)](https://dl.acm.org/doi/pdf/10.1145/3696443.3708957) · [awesome-egraphs](https://github.com/philzook58/awesome-egraphs)
- [Code Graph Model / RepoGraph (SWE-bench +32.8%)](https://arxiv.org/pdf/2505.16901) · [Repo-level RAG survey](https://arxiv.org/html/2510.04905v1)

## FILTER
## Filter: representation

I read `SYSTEM.md`, `GLOSSARY.md`, and `docs/15-representation-and-computation.md`, and web-verified the load-bearing claims. Verdict up front: **this proposal is unusually honest and mostly grounded** — its factual spine checks out (Mergiraf is real and near-production, 33 langs, being Debian-packaged; RepoGraph's +32.8% is a real ICLR 2025 result; codebadger really patched CVE-2025-6021 in libxml2 on the first try via Joern slicing; the `2603.24837` CPG×LM paper is a real 2026 IEEE/ACM workshop paper). So my job is mostly to cut two dressed-up moats and one soundness hole, not to demolish. Findings per feature below.

### Feature 1 — Structural semantic-diff as review primitive → **KEEP (build first), MODIFY the moat claim**
Real (difftastic/diffsitter ship today) and it fits the fleet driver perfectly: the coordinator computes it *inside the fresh worktree the trust gate already creates*, and writes a **change-class** (pure-reformat / logic-changed / signature-changed) to the LOG as a coordinator-computed trusted fact — which is exactly SYSTEM.md §4.3's "trusted fact vs. worker prose" distinction made concrete, and it routes review depth.

But the moat is mislabeled. The proposal's moat argument is token economics — "strictly less context for strictly more signal, value grows as models get more expensive." Models are getting *cheaper*, so that framing is a **rental argument wearing a moat costume**. The diff tool itself is free commodity; anyone can run difftastic. The *actual* baton-native moat is the thing the proposal almost says and then buries: the **change-class as a deterministic, auditable, replayable trusted fact in the append-only LOG that drives review routing** — independent of any model, reconstructable on replay. Relabel it: tool = commodity, the logged-and-routed classification = moat.

### Feature 2 — CPG-delta as trust-gate risk triage → **MODIFY (soundness hole + it's more rental than claimed)**
Real and it fits (localized taint pass inside the trust gate after tests pass, risk-class → LOG → routes review depth). Two problems.

1. **Soundness hole.** "Scoped to changed functions only" quietly kills the property that makes CPG worth having. Taint reachability is inherently non-local — a new taint path can run *through unchanged functions* into a distant sink. Scoping to changed functions makes it cheap by discarding the whole-program reachability that is the entire point. Be honest: scoped CPG-delta is a **tripwire that flags newly-introduced local dataflow edges, not a sound reachability proof.** If you want it sound, the "blast radius" must be the transitive dataflow slice (which Joern/codebadger slicing actually gives you), not literally the changed functions — otherwise it's security theater the Referee shouldn't trust.
2. **More rental than stated.** Semgrep already ships **diff-aware / `--baseline-commit` scanning** in production — scan only what changed relative to a baseline. Feature 2 is closer to "adopt Semgrep diff-mode" than "build a CPG-delta subsystem." Good news (de-risks it); but it undercuts the "moat if the Referee is" framing.

### Feature 3 — Structured merge (Mergiraf) → **KEEP as-is**
This is the strongest and most honest call in the doc, and the genuine update to SYSTEM.md §10 / doc 15 §4b. Verified: Mergiraf is real, actively developed, adopted, being packaged. It fits (coordinator merge step; log the pre-image so it's replayable; the trust gate re-runs tests on the merged result before believing it). The moat/rental call is exactly right — **wrap Mergiraf, don't build a merge algorithm; the moat is the fleet policy (path leases + structured merge + re-verify), not the merge.** The split it proposes — structured merge = adopt now (phase 2-3), true dataflow-aware merge = still a bet — is correct and should be written into SYSTEM.md §10.

### Feature 4 — Behavioral fingerprint for the ensemble → **MODIFY (honest moat, but downstream of an unvalidated premise; fold into the evidence ladder)**
The moat claim is genuinely honest — a stronger model still can't know two implementations agree without *running* them. But two things demote it from a standalone representation subsystem:
- Its whole use case (running N vendor implementations of *one* task) is the ensemble, which is gated on **E1 — "does a fleet beat a soloist?"** — which SYSTEM.md §9 and GLOSSARY flag as unproven and expensive. This isn't "later, earned by ensembles running"; it's **downstream of a premise the project hasn't validated at all.**
- Mechanically it overlaps the trust gate. If both implementations pass the same pinned tests, the fingerprint adds signal *only beyond the suite* — which is precisely the "depends on a decent corpus" caveat doing all the work. Strip the framing and it's **differential fuzzing across ensemble members**, i.e. a rung on the existing Evidence ladder (SYSTEM.md §5.1), not a new representation. Keep the idea; file it as an evidence-ladder rung, gated on E1.

### Feature 5 — Incremental substrate (Salsa-style) → **MODIFY hard — the moat is likely over-claimed / a solution to a problem baton may not have**
This is the proposal's headline ADD and my sharpest disagreement. It's real technology (Salsa, rust-analyzer, SCIP overlays). But the proposal both crowns it ("the actual moat, promote from caveat to plan") and then says "don't build it until feature 2 or 4 demands it." That tension is the tell.

Salsa's hard, defensible engineering is **live incremental invalidation under keystroke-granular edits** — that's what an *editor* (rust-analyzer) needs. Baton doesn't operate at keystroke granularity. It works at **commit boundaries**: the trust gate spins up a fresh worktree *at a commit*, computes what it needs, logs it, reaps the worktree. Commits are discrete and content-addressable, so **content-addressed caching keyed by commit/blob hash gives you most of the cross-worktree reuse without a red/green demand-driven engine at all.** The proposal imports rust-analyzer's single hardest problem into a setting whose architecture (fresh worktree per verify, log-as-truth, commit-addressed) was specifically built to not need it. Verdict: **build commit-addressed caching first; treat the full Salsa incremental engine as a bet whose necessity is unproven** — don't promote it to "the moat" until you've shown commit-granular caching is insufficient. This is where the proposal dresses a bet as a moat.

### Feature 6 — Structure-first retrieval (Serena/SCIP) → **KEEP, correctly rental — but it's already in the plan, not an ADD**
Real, ships (Serena), fits as the shared fleet index (the atlas), honestly labeled rental. One correction: SYSTEM.md §5.4 *already* specifies "structure-aware search and cross-file what-calls-this" in shared code search. So this is naming a layer that's already designed, not adding one. Keep it thin and swappable, as proposed; the only baton-native part is sharing one index across the fleet.

### Feature 7 — Attestation overlay → **KEEP as north-star, but it currently has no input to consume**
Genuinely novel and it fits in principle (LOG re-verify outcomes projected onto the code). But be blunt about the prerequisite gap: the trust gate today produces a **pass/fail per result**, not **per-function attestations**. "This function is fuzzed-clean / proven-pure" requires per-symbol verification granularity that nothing in the current design emits. So this is 2+ prerequisite layers away (deeper-check ladder must exist *and* attribute results to symbols), and right now it would have nothing to overlay. Keep as the direction; don't let it read as near-term.

### Feature 8 — E-graph equivalence → **CUT (as the proposal itself recommends)**
Verified: HEC/DialEgg are still expression/kernel-scale in 2025-26. Research-track only. The proposal already says cut it from the build plan; agreed. Feature 4 (empirical) covers the "did behavior change" need far more cheaply.

### Beyond-frontier notes
- **"LOG as program representation" is underrated by the proposal.** Reviewing the *delta-stream* (not the final diff) to catch "worker thrashed here" isn't a new representation — it's a new *read of the LOG that already exists*, so it's nearly free, and it plugs straight into the existing "looping" warning signal (SYSTEM.md §4.3). More grounded than the "unproven signal" hedge suggests. Worth naming as a cheap win.
- **Representation-on-demand / trust-as-spatial-overlay** are restatements of features 5 and 7; same critiques apply.

### SOTA it missed
- **Semgrep diff-aware / `--baseline-commit` scanning** — ships today, does most of feature 2 (scan only the change vs. a baseline). Biggest miss because it makes feature 2 more adopt-than-build.
- **Glean (Meta, open source)** — a production code-indexing/graph system battle-tested at very large scale; more relevant to feature 5/6's "incremental symbol graph across huge repos" than SCIP alone, and uncited.
- **Sourcegraph / Zoekt** — the "index once, share across the whole fleet" model is literally their product; uncited under feature 6.
- Minor: RepoGraph is **Python-only, line-level**, and the +32.8% is *average relative* improvement across configs — the proposal's phrasing slightly overstates it (the citation itself is honest).

### The one feature to build first
**Feature 1 — structural semantic-diff, built as a change-class written to the LOG (not as a pretty diff for humans).** It is the only one that is (a) real and shipping now with zero research risk, (b) a pure drop-in to machinery the MVP already builds — it runs in the trust gate's fresh worktree at the worker's committed result, (c) the concrete realization of SYSTEM.md §4.3's "coordinator-computed trusted fact vs. worker prose" distinction, and (d) the **hook every other representation feature hangs off**: features 2, 7, and the review-depth router all consume "what class of change is this?" Build the router-facing classification and its LOG entry — the diff renderer underneath is commodity, so wrap difftastic; the baton-native value is the trusted, logged, review-routing change-class.
