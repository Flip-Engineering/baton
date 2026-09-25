# Frontier research: code-development

## PROPOSAL
I have enough grounded material. Writing the deliverable.

# Code development / editing — frontier features for the fleet driver

*Scope note up front, because it changes what's real: baton's workers are whole coding CLIs (Codex, Claude Code, GLM) that own their **own** edit loop — they decide search-replace vs. whole-file vs. their internal apply model, and they write files directly. baton sits **outside** that loop. So baton's real levers on *how code gets changed* are three: (1) what the **brief** asks for, (2) what the coordinator **captures** from the worker's commit (structured edit records → the LOG), and (3) what the **trust gate** insists on before believing "done." Every feature below routes through one of those three. Features that would require intercepting a worker's keystrokes are honestly out of reach and I don't propose them.*

## State of the art now (2025-26)

| System / technique | What it does | Why it matters for baton | Cite |
|---|---|---|---|
| **Aider edit-format benchmarks** (search-replace / unified-diff / whole-file) | Measured that format choice swings a model's pass rate hugely (GPT-4 26%→59% moving to unified diff) — but 2025 re-runs show whole-file ≈ search-replace, udiff *worst* for DeepSeek; format is model-dependent, not universal | Confirms there is no one edit format to standardize on — the right format is **per-vendor**, which is exactly a routing decision baton already makes for verified wins | [aider unified-diffs](https://aider.chat/docs/unified-diffs.html), [edit-formats](https://aider.chat/docs/more/edit-formats.html) |
| **Diff-XYZ benchmark** | Isolates diff *understanding/generation/application* as separate skills; Claude 4 Sonnet & GPT-4.1 top it; udiff best for apply, search-replace best for generation | The coordinator's own re-check needs diff-*understanding*; tells you which task wants which representation | [arXiv 2510.12487](https://arxiv.org/abs/2510.12487) |
| **AdaEdit / BlockDiff / FuncDiff** (ACL Findings 2026) | Structure-aware diffs = block/function-level rewrites aligned to the AST; a trained policy adaptively picks the most token-efficient format per edit; matches whole-file accuracy at −30% cost/latency on long files | The edit unit becomes a **syntactic unit**, which is also the natural unit for semantic diff and semantic merge — directly feeds baton's review/merge story | [arXiv 2604.27296](https://arxiv.org/abs/2604.27296), [AdaEdit repo](https://github.com/nju-websoft/AdaEdit) |
| **Fast Apply models** (Morph ~4.5k tok/s, Relace Apply 3 ~10k tok/s, Cursor speculative edits on Fireworks) | A small dedicated model turns a "lazy"/vague edit snippet + full file into a correct full-file rewrite via speculative decoding | The pattern baton would use to *reconcile* a worker's edit that doesn't apply cleanly to the pinned base — a coordinator-side apply fallback | [Morph fast-apply](https://www.morphllm.com/fast-apply-model), [Relace Apply 3](https://relace.ai/blog/relace-apply-3), [Fireworks/Cursor](https://fireworks.ai/blog/cursor) |
| **"Fast Apply models are already dead"** | Even Morph/Relace founders call the apply-model a ~6-month play; frontier models increasingly emit clean structured diffs themselves | Honest rental warning: build the *record/route/gate* scaffolding, keep the apply model swappable | [AI Cathedral](https://pashpashpash.substack.com/p/fast-apply-models-are-already-dead) |
| **Kiro spec-driven development** (AWS, mid-2025) | requirements.md → design.md → tasks.md; EARS-notation acceptance criteria; checks specs for contradictions/gaps; property-based tests; parallel agents per task | The **brief** as a checkable artifact, and tasks pre-sliced into non-overlapping units — maps onto baton's brief + path leases | [kiro.dev](https://kiro.dev/), [Thoughtworks SDD](https://www.thoughtworks.com/en-us/insights/blog/agile-engineering-practices/spec-driven-development-unpacking-2025-new-engineering-practices) |
| **CodeCRDT** | Multi-agent codegen coordinating through **observed shared state** (CRDT convergence) instead of messaging; +21% speedup on some tasks, −39% *slowdown* on others | Empirical proof that parallel editing is a coin-flip unless collisions are designed out — validates baton's "no worker-to-worker chat, coordinate through shared scratchpad + leases" | [arXiv 2510.18893](https://arxiv.org/pdf/2510.18893) |
| **SWE-bench overfitting / UTBoost / SWT-Bench / bug-repro cogeneration** | Documents that agents pass held-out tests by overfitting or weakening them; test-first bug-reproduction and stronger test suites expose it | The single biggest hole in a "re-run the tests" trust gate: a green run isn't proof if the worker shaped the test. Motivates **red→green** verification | [test-overfitting 2511.16858](https://arxiv.org/pdf/2511.16858), [UTBoost 2506.09289](https://arxiv.org/pdf/2506.09289), [SWT-Bench 2406.12952](https://arxiv.org/pdf/2406.12952) |
| **Execution-guided self-repair** (InspectCoder, Live-SWE-agent) | Agents use runtime/debugger feedback to iterate edits; dynamic-analysis-in-the-loop beats blind retry | Where the worker's *own* edit loop already lives — baton shouldn't reinvent it, it should observe and gate it | [InspectCoder 2510.18327](https://arxiv.org/pdf/2510.18327), [Live-SWE-agent 2511.13646](https://arxiv.org/html/2511.13646v3) |
| **SWE-EVO / multi-file gap** | GPT-5+OpenHands scores 21% on evolving multi-file tasks vs 65% on SWE-bench Verified | Sustained, coordinated multi-file editing is the *unsolved* part — the exact place a coordinator that plans and gates edits can add value | [SWE-EVO 2512.18470](https://arxiv.org/pdf/2512.18470v1) |

## Beyond-frontier ideas (clearly labeled speculation)

- **Edits as behavior-preserving transforms with a proof-obligation attached.** When a worker labels an edit "refactor / no behavior change," treat that as a *claim* the coordinator can cheaply falsify by running the pre-edit tests against the post-edit code (they must still pass unchanged) and comparing behavioral fingerprints. A behavior-changing edit inside a "pure refactor" is caught mechanically — no spec, no autoformalization. *(Grounds doc 15's fingerprint idea in the edit act itself.)*
- **Edit-as-plan.** The worker's first output for a nontrivial task is not code but a *declared edit plan* (files, symbols, order, which are additive vs. behavior-changing). The coordinator checks it against path leases and dependency order **before** a line is written, and the plan becomes the diff's expected shape — an edit that lands outside its own declared plan is an out-of-scope warning signal. Kiro's tasks.md, but enforced by the coordinator and stamped into the LOG.
- **The LOG as a stream of typed edits, not file writes.** If every change is a structured edit record (below), the append-only log stops being "worker wrote file X" and becomes a semantically bisectable history — you can replay to the exact edit that broke re-verify and revert *just that edit*, keeping the rest of the worker's good work. This is the highest-leverage beyond-frontier move and it's cheap once records exist.

## Proposed features for baton

### 1. Structured edit records — the foundation
- **What:** the coordinator derives a typed record for every change a worker commits — `{file, syntactic anchor (function/block), before-hash, after, kind: add|modify|delete|refactor-claim, worker rationale}` — from the git commit, not from the worker's prose.
- **How it plugs in:** *coordinator feature + telemetry.* Post-commit, the coordinator parses the worker's diff into AST-block units (tree-sitter/difftastic-class) and appends each as a LOG event tagged "computed fact" (never the worker's word). Respects worktrees (derived from the committed tree only) and is the input the trust gate and semantic-diff already want.
- **Frontier or beyond:** SOTA-adoption (structural diff exists) applied as the fleet's native change unit (novel).
- **Moat / bet / rental:** **Moat** — structured, provenance-tagged edit history gets *more* valuable as models get cheaper to run and fleets get larger; it's the substrate every later feature stands on.
- **MVP or later:** **MVP.** Small, and everything else needs it.

### 2. Per-vendor edit-format brief + coordinator apply-fallback
- **What:** the brief asks each vendor for the edit format it's measured-best at (search-replace for one, whole-file for another), and when a worker's committed change can't be cleanly derived/re-based onto the pinned base, a fleet-owned apply model reconciles it instead of failing.
- **How it plugs in:** *context/brief + coordinator feature.* Format choice is a routing decision fed by re-verified outcomes (extends §5.2's routing, keyed by model version). Apply-fallback runs coordinator-side in the fresh worktree; its use is a LOG event (so you can see who needed reconciling). Trust gate is unchanged — apply happens before re-verify, never replacing it.
- **Frontier or beyond:** SOTA-adoption (Morph/Relace/Cursor pattern).
- **Moat / bet / rental:** the apply model is a **rental** (founders themselves say ~6 months); the *format-by-vendor routing learned from verified wins* is a **moat**. Build the routing deep, keep the apply model a swappable dependency.
- **MVP or later:** MVP-adjacent — brief side is trivial; apply-fallback added when a vendor's dirty edits actually cost you.

### 3. Structure-aware edit granularity in the brief (AdaEdit / BlockDiff)
- **What:** briefs request edits at function/block granularity aligned to the AST, so changes arrive as coherent syntactic units rather than arbitrary line hunks.
- **How it plugs in:** *context/brief.* Makes feature 1's records cleaner and makes semantic diff (doc 15) and any future semantic merge operate on real units. Output is just cleaner commits → cleaner LOG records.
- **Frontier or beyond:** SOTA-adoption (ACL 2026).
- **Moat / bet / rental:** mild **moat** (feeds the merge/review pipeline); low cost, so low risk if it's a wash.
- **MVP or later:** MVP-adjacent.

### 4. Red→green trust-gate protocol (anti-overfit) — the highest-value one
- **What:** for bug-fix and feature tasks, the trust gate doesn't just check "tests green"; it captures the acceptance test in the **pinned base** (must be **red**/absent-then-failing there), then confirms that *same, coordinator-held* test goes **green** after the worker's edit — proving the fix, not a weakened test.
- **How it plugs in:** *coordinator feature (extends §5.1).* The test spec is pinned by the coordinator (or an independent vendor writes it), stored in the LOG, and re-run in the fresh worktree. A worker editing the acceptance test itself is an out-of-scope signal. Directly closes the SWE-bench overfitting hole that plain re-verify leaves open.
- **Frontier or beyond:** SOTA-adoption of test-first / SWT-Bench findings, made a coordinator invariant (novel packaging).
- **Moat / bet / rental:** **Moat** — verification integrity is the part that *grows* in value as models get better at gaming weak checks. This is the single most defensible feature in this area.
- **MVP or later:** MVP-adjacent — it's a modest extension of the trust gate that's already the product's spine.

### 5. Edit-as-plan, checked against leases and dependency order
- **What:** for nontrivial tasks the worker first emits a declared edit plan (files, symbols, order, additive-vs-behavior-changing); the coordinator validates it against path leases and dependency order before editing starts, and treats out-of-plan edits as a scope warning.
- **How it plugs in:** *coordinator feature + telemetry.* Upgrades §4.1 path leases from "I claim payments/" to "I will touch these symbols in this order." The plan is a LOG event; divergence from it is a computed warning signal (§4.3). Prevents collisions *before* merge, which CodeCRDT shows is where parallel editing lives or dies.
- **Frontier or beyond:** Kiro tasks.md adoption + enforcement (novel as a coordinator gate).
- **Moat / bet / rental:** **Moat** for large-N fleets (collision cost is the dominant coordination tax).
- **MVP or later:** Phase 2 (after the MVP proves single-worker edit capture).

### 6. Edit-level bisect + behavior-preserving auto-revert
- **What:** when the trust gate's re-verify fails, the coordinator bisects the worker's structured edit records to the specific edit that broke it and reverts *only* that edit, re-running the gate — instead of discarding the whole worker result.
- **How it plugs in:** *coordinator feature.* Pure consequence of feature 1 + the log-is-truth rule (§3.3.5) and replay (§5.3). Operates on the committed record set in a fresh worktree; the revert and its outcome are LOG events.
- **Frontier or beyond:** novel (git-bisect-of-agent-edits at the semantic-record level).
- **Moat / bet / rental:** **Moat** — recovers partial value from near-miss runs, which becomes more valuable as tasks get bigger and reruns get costlier.
- **MVP or later:** Later — earns its place once multi-edit tasks are common.

### 7. Semantic collision early-warning across live worktrees
- **What:** as each worker's edit records land, the coordinator checks whether a touched symbol overlaps a symbol another *live* worker is currently editing, and raises a collision signal before merge time.
- **How it plugs in:** *telemetry / warning signal (§4.3).* Uses feature 1's records + a shared symbol graph (the code-search index in §5.4). Doesn't touch worktrees; it's a read-only overlay that produces a story-line ("worker 2 and worker 4 are both editing `AuthToken.verify`").
- **Frontier or beyond:** novel application of CodeCRDT-style observed-state coordination.
- **Moat / bet / rental:** **Moat** for multi-worker runs; **rental-ish** for single-worker (no collisions to find).
- **MVP or later:** Phase 2/3, with routing and shared search.

### 8. Speculative cross-vendor edit race on critical slices
- **What:** for a high-risk slice, spawn two vendors on the *same* edit; accept whichever's edit re-verifies (red→green), and diff their semantic deltas — agreement is confidence, divergence is a flag for human review.
- **How it plugs in:** *coordinator feature.* Extends the ensemble/decorrelation idea (E2) down to the edit unit; reconciliation is semantic-delta + behavioral-fingerprint comparison (doc 15 §4a/4c). Both runs and the comparison are LOG events; each worker is isolated in its own worktree.
- **Frontier or beyond:** novel (pass@N at edit granularity, reconciled semantically).
- **Moat / bet / rental:** **Bet** — 2× cost has to be justified by catching bugs one vendor misses; that's the unproven E2 hypothesis. Flag, don't commit.
- **MVP or later:** Later, and only after E2 shows cross-vendor checks actually decorrelate errors.

## Add / subtract / modify

- **ADD — a typed "edit" event to the LOG schema (feature 1).** Today the LOG streams turns, tool runs, tokens, questions, results. It should also carry *structured edit records* as a first-class, provenance-tagged event. This is a genuine schema addition and it unlocks features 2, 6, 7, 8 and sharpens semantic diff. It's the missing primitive between "worker did stuff" and "here's the committed result."
- **MODIFY — the trust gate from "green" to "red→green" (feature 4).** §5.1 as written re-runs the worker's tests and believes a pass. That's necessary but not sufficient: the SWE-bench overfitting literature shows a green run can be a weakened test. Pin the acceptance test independently and require the red→green transition. This is a real change to the spine, not an add-on.
- **MODIFY — path leases into edit-plan leases (feature 5).** §4.1's leases claim *paths*; upgrade the primitive to claim *declared symbol-level edit plans*. Same mechanism (shared scratchpad), finer grain, collisions caught before merge.
- **Honest tension to flag, not cut — whole-file rewrite vendors vs. structured records.** Some vendors (and apply-model workflows) internally rewrite whole files; that fights clean per-edit records. baton can't stop it (it's outside the worker's loop), so feature 1 must *derive* block-level records from the resulting diff post-hoc rather than assume the worker hands them over. Don't design as if baton controls the worker's edit format — it doesn't.
- **Nothing to cut.** doc 15 already owns semantic diff/merge/fingerprint as *representation*; this area is the complementary *act of editing* and the *verification of the act*. Keep the apply model explicitly thin and swappable (it's a rental), and keep feature 8 behind the E2 gate the design already sets.

## Sources
- Aider edit formats & unified-diff laziness benchmark — https://aider.chat/docs/unified-diffs.html , https://aider.chat/docs/more/edit-formats.html
- Diff-XYZ (diff understanding benchmark) — https://arxiv.org/abs/2510.12487
- AdaEdit / BlockDiff / FuncDiff (structure-aware adaptive edit formats, ACL Findings 2026) — https://arxiv.org/abs/2604.27296 , https://github.com/nju-websoft/AdaEdit
- Morph Fast Apply — https://www.morphllm.com/fast-apply-model ; edit-formats guide — https://www.morphllm.com/edit-formats
- Relace Apply 3 (10k tok/s) — https://relace.ai/blog/relace-apply-3
- Cursor speculative edits on Fireworks — https://fireworks.ai/blog/cursor
- "Fast Apply Models are Already Dead" (rental warning) — https://pashpashpash.substack.com/p/fast-apply-models-are-already-dead
- Kiro spec-driven development — https://kiro.dev/ ; Thoughtworks SDD — https://www.thoughtworks.com/en-us/insights/blog/agile-engineering-practices/spec-driven-development-unpacking-2025-new-engineering-practices
- CodeCRDT (observation-driven multi-agent coordination) — https://arxiv.org/pdf/2510.18893
- SWE-bench test overfitting — https://arxiv.org/pdf/2511.16858 ; UTBoost — https://arxiv.org/pdf/2506.09289 ; SWT-Bench (test generation) — https://arxiv.org/pdf/2406.12952
- InspectCoder (dynamic-analysis self-repair) — https://arxiv.org/pdf/2510.18327 ; Live-SWE-agent — https://arxiv.org/html/2511.13646v3
- SWE-Edit (efficient editing) — https://arxiv.org/html/2604.26102v1 ; SWE-EVO (multi-file gap) — https://arxiv.org/pdf/2512.18470v1
- Multi-agent worktree isolation guidance — https://www.augmentcode.com/guides/how-to-run-a-multi-agent-coding-workspace

## FILTER
All exotic citations check out precisely — AdaEdit (2604.27296, ACL Findings 2026), SWE-EVO (2512.18470, 21% vs 65%), CodeCRDT (2510.18893, +21.1%/−39.4%) are all real, and the numbers are quoted correctly. This proposal did real homework; it is not fabricating sources. My cuts below are about *fit and framing*, not fake papers.

## Filter: code-development

**The proposal's own framing note is its best contribution — and it then violates it.** The opening frame is correct and load-bearing: baton sits *outside* each worker's edit loop (workers are whole CLIs that own their apply strategy), so baton's only real levers are (1) the brief, (2) what the coordinator *captures from the commit*, and (3) the trust gate. That frame is right. But features 2 and 3 quietly smuggle in *brief-side control over edit format and granularity* — which the outside-the-loop position denies. You cannot reliably tell Codex "emit search-replace" or "emit function-block diffs" through natural-language task text; those are knobs on a harness you don't own (Aider owns them because Aider *is* the harness — baton is a fleet of harnesses). The proposal even admits this in its closing "honest tension" bullet, then proposes 2 and 3 as MVP-adjacent anyway. That internal contradiction is the thing to fix.

---

**Feature 1 — Structured edit records (derive AST-block records from the commit) → KEEP, but MODIFY the label and the sequencing claim.**
Real (tree-sitter / difftastic / GumTree exist and are the right tech). Fits cleanly: post-commit, coordinator-side, derived from the committed tree only, tagged "computed fact." Two corrections: (a) **it is not a "moat" — it's plumbing.** Difftastic is open source; the records themselves are a substrate, and a substrate is not a hard-to-copy advantage. The value lives in what stands on it (4, 6, 7), not in the records. (b) **"everything else needs it" is false.** The trust gate (4) needs a pinned test, not AST records. Edit-as-plan (5) needs a plan, not AST records. Only 6, 7, 8 need this substrate. So it is *not* the thing to build first, and it should not gate feature 4.

**Feature 2 — Per-vendor edit-format brief + coordinator apply-fallback → CUT the apply-fallback; MODIFY the brief-side down to near-zero.**
The apply-fallback solves a problem baton structurally does not have. Workers *commit* their results; the coordinator captures commits, not loose "lazy edit snippets." If it committed, it already applied cleanly in the worker's own worktree. The only way a committed result fails to land on the pinned base is that the base moved — which is a *merge/rebase conflict*, and §4.1 already owns that (textual merge now, merge-by-meaning later). A Morph/Relace apply model adds nothing to a commit-capture design. The brief-side ("ask each vendor for its best format") imports an Aider-harness lever into a driver that doesn't own the harness — mostly inapplicable. The one *real* residue is vendor selection, which §5.2 routing already owns. The author correctly calls the apply model a rental; the honest verdict is stronger — the whole feature is a misfit, not just a rental.

**Feature 3 — Structure-aware edit granularity in the brief → CUT (redundant + non-lever).**
Same category error as 2 (asking a whole-CLI worker for AST-block output you can't enforce), and *also* redundant: feature 1 already says it derives block-level records post-hoc from whatever diff arrives. That post-hoc derivation is the correct move and it makes the brief-side request unnecessary. AdaEdit is a train-the-model technique for when you own the weights; baton owns neither.

**Feature 4 — Red→green trust gate → KEEP. This is the one to build first.**
Real and correctly grounded (SWT-Bench, UTBoost, the overfitting literature are all cited accurately). Fits the spine perfectly: extends §5.1, coordinator pins the test, requires red-on-base then green-after, re-runs in the fresh worktree, and a worker editing the acceptance test is already an out-of-scope signal (§4.3). The moat claim is the *one honest "moat" in the whole area*: verification integrity grows in value exactly as models get better at gaming weak checks — it's the opposite of a rental. Crucially it does **not** depend on the feature-1 substrate, so it's independently shippable. One real gap the proposal glosses: "an independent vendor writes the test" has its own trust problem (a trivial test). Red-on-base guards triviality partly (a no-op test won't be red on base), but the principled fortifier is **mutation testing** — see the miss below.

**Feature 5 — Edit-as-plan checked against leases + dependency order → KEEP as Phase 2, MODIFY moat→bet.**
This one *is* within baton's reach: asking for a plan as the first turn and gating it between turns is coordinator mediation, not keystroke interception. Kiro is real; upgrading path leases to symbol-level leases is a genuine, sensible refinement, and out-of-plan edits are computable warning signals. But "moat for large-N fleets" is asserted, not shown — CodeCRDT proves collisions *matter*, not that baton's lease design fails to handle them (baton already avoids collisions by non-overlapping scopes). It's a reasonable **bet**, sequenced right at Phase 2.

**Feature 6 — Edit-level bisect + behavior-preserving auto-revert → KEEP as Later/research, MODIFY moat→bet, flag the mechanism.**
Cute and novel, but shakier than presented. git-bisect works because each *commit* builds; the AST edit-records *within* one worker commit have no such guarantee — later edits routinely depend on earlier ones, so "revert just that one edit, keep the rest" will frequently fail to compile. The idea is real but the "keep the rest of the good work" promise is optimistic. It's a bet, not a moat.

**Feature 7 — Semantic collision early-warning across live worktrees → KEEP as Phase 2/3, MODIFY "early."**
Fits (telemetry/warning-signal + shared code search). But it is not *early*: baton captures commits, not in-progress uncommitted edits, so overlap becomes visible only once both workers have committed to a symbol — roughly when textual merge would catch it anyway. The real added value is the *semantic framing* (same symbol, not just same file) and the human story-line, not earliness. The author's moat-multi / rental-single split is honest; just drop "early."

**Feature 8 — Speculative cross-vendor edit race → KEEP as flagged Bet, honest.**
Correctly gated behind E2 and labeled a bet. It's essentially "run E2 at edit granularity" — not really a separate feature until E2 shows cross-vendor checks decorrelate errors. No change; the honesty is good.

---

**Moat-label audit (the one systemic dishonesty):** the proposal over-uses "moat." Stripped down, there is exactly **one durable moat in this area — verification integrity (feature 4).** Features 1, 5, 6, 7 are plumbing or bets dressed as moats; the apply model (2) is correctly called a rental but the feature around it is a misfit. The author's instinct to flag the apply model as a rental is good — they just didn't apply the same skepticism to their own structural features.

**Biggest missed SOTA — mutation testing (PIT, mutmut, Stryker).** The proposal reaches for 2026 papers on test overfitting but skips the decades-proven, principled answer to "is a green run trustworthy?": mutation score tells you whether the suite is strong enough to believe. It plugs *directly* into feature 4 — a red→green transition proves the fix exists; a decent mutation score proves the pinned test isn't trivially weak. That's the missing second half of the anti-overfit gate, and it's grounded, cheap, and real. Also missed: **metamorphic / differential testing** is the established, grounded name for the "behavior-preserving fingerprint" the beyond-frontier section invents from scratch — use the real technique. Minor misses: R2E / Commit0 / RepoBench (repo-level edit benchmarks) as routing signal; and note feature 1's tree-diff tech *is the same tech* as doc 15's semantic diff — consolidate them, don't run two tree-differs.

---

**One to build first: Feature 4, the red→green trust gate.**
Why, concretely: it extends the product's actual spine (§5.1) with minimal new machinery; it closes the single biggest hole in a "re-run the tests" gate — a green run can be a weakened test, which is exactly documented and exactly the failure a fleet driver must not swallow; it is the most durable thing in the area (grows in value as models improve, the opposite of a rental); and — critically — it does **not** depend on the feature-1 AST substrate the author wrongly claims everything needs, so it ships independently and immediately serves the core promise: believe "done" only when it's provably real. Pair it with mutation-score as the strength check and you have the defensible core of this entire proposal in one modest coordinator change. Build feature 1 (structured records) second, as the substrate for 5/6/7 — not first.
