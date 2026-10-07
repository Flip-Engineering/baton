# Frontier research: testing

## PROPOSAL
I have enough. Writing the report.

---

# Testing — frontier features for the fleet driver

The single most important finding for baton: **an LLM-written test usually encodes what the code *does*, not what it *should* do.** Empirical work shows LLMs generate oracles that capture *actual* (implemented) behavior far more often than *expected* behavior, at under ~50% oracle-correctness ([Hossain et al., "actual or expected?"](https://arxiv.org/pdf/2410.21136); [Do LLMs Generate Useful Test Oracles, ASE 2025](https://www.lucadigrazia.com/papers/ase2025.pdf)). And on SWE-bench, agent patches routinely pass the visible tests but fail held-out ones — "test overfitting" is a measured, real problem ([Investigating Test Overfitting on SWE-bench](https://arxiv.org/pdf/2511.16858)).

This lands directly on baton's trust gate. SYSTEM.md §5.1 says the coordinator "re-runs the check itself, in a fresh copy of the repo." But re-running the *worker's own tests* — even in a pristine worktree — mostly proves the worker's code agrees with the worker's tests. That is a green light a competent worker can always earn. The frontier work below is about making the trust gate run checks the worker **did not author to pass.**

## State of the art now (2025-26)

| System / technique | What it does | Why it matters to baton | Cite |
|---|---|---|---|
| **Mutation-guided test gen at Meta (ACH)** | LLM plants realistic faults ("mutants") in source, then generates tests *guaranteed to catch them*; deployed in production at Meta | The real answer to "does this suite catch bugs" — the meta-check baton's trust gate is missing | [Meta ACH blog](https://engineering.fb.com/2025/09/30/security/llms-are-the-key-to-mutation-testing-and-better-compliance/); [arXiv 2501.12862](https://arxiv.org/pdf/2501.12862) |
| **Adversarial test-vs-mutant loops (AdverTest)** | A second LLM invents context-aware mutants and fights the test-writer in a loop until mutation-score/coverage thresholds are met | A blueprint for a fleet that generates its *own* adversarial test corpus (two vendors, one attacks) | [arXiv 2602.08146](https://arxiv.org/html/2602.08146v1) |
| **Mutant prioritization (PRIMG)** | Ranks which mutants are worth generating tests for, cutting mutation-testing cost | Makes a mutation probe cheap enough to run inside the gate on every "done" | [arXiv 2505.05584](https://arxiv.org/pdf/2505.05584) |
| **Property-based test agent (Anthropic)** | Claude Code agent reads types/docstrings/names, proposes *properties*, writes Hypothesis tests, self-reflects on real-vs-false failures; found real bugs in NumPy/SciPy/Pandas | The check-ladder's "property" rung, already built as a Claude Code command — grounds tests in the *spec*, not the diff. 984 raw reports → 56% valid; with ranking, top reports 86% valid | [Anthropic](https://www.anthropic.com/research/property-based-testing) |
| **PBT vs example tests for edge cases** | PBT exposes correctness gaps example tests miss; combining both hit 81% bug detection on HumanEval; 30-32% of "passing" solutions only partially satisfy properties | Property tests catch what a worker's happy-path tests never will | [AIware 2025, arXiv 2510.25297](https://arxiv.org/html/2510.25297v1); [From Prompts to Properties, FSE 2025](https://dl.acm.org/doi/10.1145/3696630.3728702) |
| **Metamorphic + differential testing (Kaizen, MTF)** | No reference oracle needed: mutate inputs in behavior-preserving ways, or diff two implementations, and flag divergence | Baton *already* runs the same brief on multiple vendors — differential testing across them is nearly free | [Kaizen, arXiv 2607.04058](https://arxiv.org/html/2607.04058); [MTF, ACM 2025](https://dl.acm.org/doi/10.1145/3787120.3787123) |
| **LLM fuzz-harness generation (OSS-Fuzz-Gen, PromeFuzz)** | Multi-agent LLM systems auto-write coverage-guided fuzz harnesses; PromeFuzz beats OSS-Fuzz-Gen by 1.4–3.9× branch coverage | The "fuzz" rung of baton's ladder for parsing/serialization/C changes | [PromeFuzz, CCS 2025](https://dl.acm.org/doi/10.1145/3719027.3765222); OSS-Fuzz-Gen (Google) |
| **Test-driven agent loops (TDFlow, Otter, SWT-Bench)** | Write a failing reproduction/acceptance test *first*, then code until it passes; TDFlow hit 94.3% on SWE-bench Verified given good reproduction tests | Turns "done" into a concrete red→green flip on an independently-authored test | [TDFlow, arXiv 2510.23761](https://arxiv.org/pdf/2510.23761); [Otter, arXiv 2502.05368](https://arxiv.org/pdf/2502.05368); [SWT-Bench](https://swtbench.com/) |
| **Flaky-test detection (FlakeFlagger, nondeterministic-API control)** | Static prediction of flakiness (F1 ~86%) without reruns; and pinning nondeterministic APIs (time, concurrency, env) to reproduce flakes deterministically | A flaky test poisons *both* the worker's signal and baton's gate; LLM-generated tests are measurably flaky | [Flakiness of LLM tests, arXiv 2601.08998](https://arxiv.org/pdf/2601.08998); [Controlling Nondeterministic APIs, PACMPL](https://dl.acm.org/doi/10.1145/3798265) |
| **Rethinking agent-generated test metrics** | Argues final solve-rate is too coarse; process-sensitive test metrics (coverage delta, fault-revelation) tell you *how* the agent worked | Guides what baton should actually log as test telemetry, not just pass/fail | [arXiv 2602.07900](https://arxiv.org/html/2602.07900) |

## Beyond-frontier ideas (clearly labeled speculation)

- **The fleet as an n-version oracle.** With no ground-truth spec, three vendors implementing the same brief are three independent guesses. Where two agree and one diverges, the divergence is a candidate bug *and* a candidate new test case — mined automatically. Classic n-version programming, but the "versions" are cross-vendor models whose errors are (hopefully) decorrelated — exactly baton's E2 hypothesis, now operationalized as a test source. **Speculative:** decorrelation is an assumption, not a proven fact.
- **A living, self-adversarial regression corpus.** Every mutant a worker's tests *failed* to kill, every held-out failure, every cross-vendor divergence gets distilled into a permanent test that ships with the repo path it touched. The corpus grows monotonically and is replayed against future diffs — the fleet gets harder to fool over time, not per-run. This is "tests as a shared fleet asset" made concrete in slow memory.
- **Curriculum of the fleet's own blind spots.** Aggregate which mutation operators consistently survive (off-by-one, boundary, exception-swallowing) *per vendor*, and feed that back into routing and briefs: "Codex tends to miss empty-collection cases here — bias its brief toward them." Testing telemetry becomes a routing signal.

## Proposed features for baton

### 1. Mutation probe in the trust gate (the flagship)
- **What:** Before believing "done," the coordinator plants a handful of small faults in the worker's *changed source lines* and checks the worker's test suite actually catches them.
- **How it plugs in:** Coordinator feature, inside the trust gate. Runs in a fresh worktree at the worker's committed diff (never the worker's dirty tree). Mutants are generated on the *diff hunks only* (cheap, targeted — PRIMG-style prioritization), the suite is run per-mutant, and the **kill rate** is written to the LOG as a first-class trust fact. A low kill rate downgrades "done" to "passes its own tests but doesn't actually catch bugs" — a distinct, honest verdict the orchestrator can act on.
- **Frontier or beyond:** SOTA-adoption (Meta ACH proves it works in production).
- **Moat / bet / rental:** **Moat.** As models get better at writing code *and* tests-that-pass, the "do these tests catch injected bugs" question stays hard and stays valuable. This is the deepest defensible upgrade to the trust gate.
- **MVP or later:** **Early** — it's the smallest change that makes "done" mean something. Ship right after basic re-verify.

### 2. Independent spec-anchored oracle (a *different* vendor writes the gate tests)
- **What:** The worker who wrote the code never writes the tests that decide its fate; a second vendor writes property/example tests grounded only in the pinned brief, type signatures, and docstrings — never the diff.
- **How it plugs in:** Coordinator feature + worker tool (reuses the Anthropic PBT command as the generator). The independence is enforced by *what the test-writer is shown*: the brief and public interface, not the implementation. Output enters the LOG tagged as an independent oracle. Directly attacks the oracle-overfitting problem: a test written without seeing the code can't have been written to match the code.
- **Frontier or beyond:** SOTA-adoption for PBT; **novel** in the "cross-vendor, blind-to-diff" enforcement.
- **Moat / bet / rental:** **Moat.** The overfitting problem is structural, not a model-capability gap — it doesn't disappear as models improve, because a smarter worker writes smarter self-passing tests too.
- **MVP or later:** **Early-ish.** Property generation is mature; the plumbing (hide the diff from the test-writer) is the work.

### 3. Cross-vendor differential + metamorphic testing
- **What:** Run two vendors' implementations of the same brief against a shared input pool; any output divergence is a bug in at least one, surfaced automatically. When there's no second implementation, use metamorphic relations (e.g., sort twice = sort once; encode-then-decode = identity).
- **How it plugs in:** Coordinator feature exploiting baton's existing multi-worker fleet. Divergences and metamorphic violations are logged as trust facts and become seed cases for the corpus (feature 7). Respects worktrees — each implementation runs in its own, driven against shared inputs by the coordinator.
- **Frontier or beyond:** SOTA-adoption (Kaizen/MTF) applied to a setting baton uniquely has for free.
- **Moat / bet / rental:** **Moat**, conditional on the decorrelation bet paying off (which baton already flagged as E2). Even if models converge, metamorphic relations need no second model and stay useful.
- **MVP or later:** **Later** — earns its place once multi-vendor concurrent runs on the same task are routine.

### 4. Flaky-test quarantine + replay confirmation
- **What:** The trust gate re-runs each test a few times (and, where possible, pins clock/concurrency/env), classifying every pass or fail as *stable* or *flaky* before it counts toward "done."
- **How it plugs in:** Coordinator feature, riding baton's existing replay (§5.3) and warning-signal machinery (§4.3 already has *stalled*/*looping* — add *flaky*). A flaky failure never blocks a merge silently and never falsely passes one; it's logged, and a static predictor (FlakeFlagger-style, F1 ~86%) can pre-flag likely-flaky new tests cheaply without N reruns.
- **Frontier or beyond:** SOTA-adoption.
- **Moat / bet / rental:** **Moat** (infrastructure). Flakiness is eternal; LLM-generated tests are *more* flaky than human ones, so this compounds with features 1-3.
- **MVP or later:** **Early** — a single flaky test can make the whole trust gate lie in both directions.

### 5. Differential-coverage gate on the diff
- **What:** Require that the worker's new/changed lines are actually *executed* by some test; flag any new branch that nothing runs.
- **How it plugs in:** Coordinator feature — the cheapest rung, run before the expensive ones. It's *delta* coverage (only the diff), not a project-wide percentage target — which sidesteps the "arbitrary numeric limit" rule in CLAUDE.md: the threshold is derived (every changed branch), not a made-up 80%. Result enters the LOG as a fact; untested new code is an honest yellow flag, not an auto-fail.
- **Frontier or beyond:** SOTA-adoption.
- **Moat / bet / rental:** **Rental-ish** — a better model writes better-covered code on its own — but it's near-free and a useful fast filter before mutation/property rungs.
- **MVP or later:** **MVP-adjacent.** Standard coverage tooling, thin integration.

### 6. Test-first / reproduction-test gate for bug tasks
- **What:** For a bug-fix brief, an independently-written failing reproduction test must exist *before* the worker starts, and "done" = that test flips red→green **and** the mutation/property gates pass.
- **How it plugs in:** Context/brief + coordinator feature. The reproduction test is generated (Otter/SWT-Bench style) and pinned into the brief; the gate checks the specific red→green transition in a fresh worktree, not just "all green." TDFlow shows this is where the SWE-bench ceiling actually is (94.3% given good reproduction tests).
- **Frontier or beyond:** SOTA-adoption.
- **Moat / bet / rental:** **Moat** for the *gate* (independent red→green is a durable trust signal); the reproduction-test generator itself is closer to rental.
- **MVP or later:** **Later** — most valuable once baton handles issue-shaped tasks, not greenfield.

### 7. Growing shared test corpus (tests as a fleet asset)
- **What:** Every surviving mutant's missed case, every held-out failure, every cross-vendor divergence is distilled into a permanent regression test attached to the repo paths it touches, and replayed against future diffs on those paths.
- **How it plugs in:** Slow memory (§5.3) + coordinator feature. The corpus is version-controlled alongside the code (fits baton's "promote into your notes system" stance), carries provenance (which run/mutant/divergence birthed it — respecting the untrusted-by-default contagion tracking in §5.6), and is gated: a candidate test only joins the corpus after it passes the flaky check (feature 4) and is confirmed to fail on the *un*-fixed code.
- **Frontier or beyond:** **Novel** (beyond-frontier, but grounded — it's just AdverTest's adversarial loop persisted across runs).
- **Moat / bet / rental:** **Moat** — it compounds. The corpus is exactly the kind of asset a better base model does not obviate; it's institutional memory of how *this repo's* code breaks.
- **MVP or later:** **Later** — needs the mutation/differential features producing material first.

### 8. Fuzz rung for high-risk surface
- **What:** For changes to parsers, serializers, C/unsafe code, or anything taking untrusted input, auto-generate a coverage-guided fuzz harness targeting the changed functions and run a short campaign.
- **How it plugs in:** Worker tool (OSS-Fuzz-Gen/PromeFuzz-style generator) invoked by the coordinator as the ladder's "fuzz" rung, only when the task's risk warrants it. Crashes/timeouts enter the LOG and feed the corpus. Runs in an isolated worktree under the OS sandbox (§5.6).
- **Frontier or beyond:** SOTA-adoption.
- **Moat / bet / rental:** **Bet leaning rental** — harness generation is improving fast and vendors may ship it; keep it thin and swappable per SYSTEM.md §9.
- **MVP or later:** **Later**, risk-gated. Only pays off on a minority of tasks.

## Add / subtract / modify

**CHANGE (the important one):** SYSTEM.md §5.1 and §3.2's TRUST GATE describe re-running "its tests" / "the worker's tests" in a fresh worktree. The research says this is a **weak gate**: re-running the author's own tests mostly re-confirms the author's own bias (the oracle problem; SWE-bench overfitting). Rewrite the trust gate as: *re-run tests the worker did not author to pass, and confirm the worker's tests actually catch injected bugs.* Concretely, the gate becomes a small pipeline — flaky-check (4) → diff-coverage (5) → mutation probe (1) → independent oracle (2) — each writing a distinct verdict to the LOG. "Passes its own tests" and "survives an independent oracle + mutation probe" become *different* trust levels, and the orchestrator sees which one it got. This is the honesty principle (§6 adapter cards: never pretend an emulated steer is real) applied to "done."

**ADD to the check ladder:** the ladder in §5.1 / GLOSSARY is types → tests → property → fuzz → proof. Insert two rungs that the current ladder is missing:
- **mutation** sits between *tests* and *property* — it's the meta-rung that asks "are the tests at the lower rung real?" It's what makes the "tests" rung trustworthy rather than theatrical.
- **cross-vendor differential** sits as a parallel rung the *fleet* uniquely unlocks — no other single-agent system can run it, and it needs no ground-truth oracle.

New ladder: types → tests → **mutation** → property → **differential** → fuzz → proof, cheapest-that-fits as before.

**ADD a telemetry type:** test outcomes today collapse to pass/fail. Per the "rethinking agent-generated tests" paper, log *process-sensitive* test facts — mutation kill-rate, diff-coverage delta, flaky-classification, cross-vendor divergence count — as trusted coordinator facts. These also become routing signals (§5.2): learn per-vendor which mutation operators survive, and bias briefs accordingly.

**SUBTRACT / don't build:** resist a project-wide coverage-percentage target — it's an arbitrary numeric limit (violates CLAUDE.md) and overfitting-prone. Use *diff*-delta coverage instead. And keep fuzz + proof rungs thin/swappable (§9) — they're the most rental-exposed.

## Sources

- [Do LLMs generate test oracles that capture actual or expected behavior?](https://arxiv.org/pdf/2410.21136) · [Do LLMs Generate Useful Test Oracles (ASE 2025)](https://www.lucadigrazia.com/papers/ase2025.pdf) · [Understanding LLM-Driven Test Oracle Generation](https://arxiv.org/abs/2601.05542) · [Nexus: Execution-Grounded Oracle Synthesis](https://arxiv.org/pdf/2510.26423)
- [Investigating Test Overfitting on SWE-bench](https://arxiv.org/pdf/2511.16858) · [Rethinking the Value of Agent-Generated Tests](https://arxiv.org/html/2602.07900)
- [Meta: LLMs Are the Key to Mutation Testing](https://engineering.fb.com/2025/09/30/security/llms-are-the-key-to-mutation-testing-and-better-compliance/) · [Mutation-Guided LLM Test Gen at Meta](https://arxiv.org/pdf/2501.12862) · [Test vs Mutant / AdverTest](https://arxiv.org/html/2602.08146v1) · [PRIMG: mutant prioritization](https://arxiv.org/pdf/2505.05584) · [SWE-Mutation](https://arxiv.org/html/2605.22175) · [Mutation-Guided Diagnosis of Regression Suites](https://arxiv.org/pdf/2604.01518)
- [Anthropic: Finding bugs with Claude and property-based testing](https://www.anthropic.com/research/property-based-testing) · [Characteristics of LLM-Generated PBT (AIware 2025)](https://arxiv.org/html/2510.25297v1) · [From Prompts to Properties (FSE 2025)](https://dl.acm.org/doi/10.1145/3696630.3728702)
- [Kaizen: Metamorphic Fuzzing + Differential Testing](https://arxiv.org/html/2607.04058) · [MTF metamorphic framework (ACM 2025)](https://dl.acm.org/doi/10.1145/3787120.3787123) · [Bidirectional MT + LLM survey](https://arxiv.org/pdf/2605.13898)
- [PromeFuzz (CCS 2025)](https://dl.acm.org/doi/10.1145/3719027.3765222) · OSS-Fuzz-Gen (Google) · [Coverage-Guided Multi-Agent Harness Gen](https://arxiv.org/pdf/2603.08616)
- [TDFlow](https://arxiv.org/pdf/2510.23761) · [Otter](https://arxiv.org/pdf/2502.05368) · [SWT-Bench](https://swtbench.com/) · [SWE-Tester](https://arxiv.org/html/2601.13713v1)
- [On the Flakiness of LLM-Generated Tests](https://arxiv.org/pdf/2601.08998) · [Detecting Flaky Tests by Controlling Nondeterministic APIs (PACMPL)](https://dl.acm.org/doi/10.1145/3798265) · [HgtFlaky: heterogeneous-graph flaky detection](https://doi.org/10.3390/computers15060372)

Files read: `/Users/wahargis/Development/Experiments/baton/SYSTEM.md`, `/Users/wahargis/Development/Experiments/baton/GLOSSARY.md`.

## FILTER
All eight core citations check out as real (Meta ACH/FSE 2025, TDFlow/EACL 2026, Hossain oracle actual-vs-expected, AdverTest 2602.08146, Rethinking-Value 2602.07900) — the future-dated arXiv IDs are legitimate given today is July 2026. Citation hygiene is good; I withdraw any fabrication concern. Here's the filter.

## Filter: testing

**Bottom line up front:** This is the strongest of the frontier reports — the central finding (LLM tests encode what the code *does*, not what it *should*) is real, well-cited, and lands exactly on baton's weakest seam. But the report slightly strawmans its own target, over-reaches for LLM tooling where deterministic tooling is stronger, and misses one whole class of SOTA that would make the flagship cheaper and rental-proof. Verdicts below.

---

### One framing correction first (applies to the whole report)
The report says the current gate "mostly proves the worker's code agrees with the worker's tests." That's a **partial strawman.** SYSTEM.md §4.1(3) already says re-verification runs "against a spec *you* pinned (not one the worker rewrote)." So the design already knows not to trust the worker's rewritten tests. The *real* unaddressed gap is narrower and sharper: **who authors that pinned spec, and was it authored blind to the diff?** Naming it precisely matters because it turns the report's "rewrite the trust gate" (big, scary) into "add a blind-authorship rule + two rungs" (small, shippable). Keep the substance, drop the wholesale-rewrite framing.

---

### Feature 1 — Mutation probe in the trust gate (flagship) → **MODIFY (keep, but change how it's built)**
Real and production-proven (Meta ACH: 10,795 classes, 73% test-acceptance — verified). Fits perfectly: coordinator feature, fresh worktree at committed diff, kill-rate as a first-class LOG fact, downgrade-not-fail. All good.

Three things the report glosses:
1. **Cost.** "Diff-hunks only" cuts mutant *count*, but you still run the suite *once per surviving mutant*. On a slow suite inside a gate that fires on every "done," that's a real tax. PRIMG prioritization is the right instinct but under-sells the problem.
2. **The equivalent-mutant trap.** A mutant that doesn't change behavior *can't* be killed — and would falsely read as "your tests are weak." Meta needed a dedicated equivalent-mutant detector (precision 0.79) to make ACH usable. The report doesn't mention this; without it the probe emits false accusations.
3. **The build choice is backwards.** The report reaches for LLM mutation (ACH). But **deterministic mutation engines already exist and are production-grade** — PIT/Pitest (JVM), Stryker (JS/TS), mutmut/cosmic-ray (Python). These are cheaper, reproducible (critical for a gate — see Feature 4), and have **zero oracle problem and zero rental exposure** because no model is in the loop. Ship the probe on a classical engine first; reserve LLM mutation for languages/targets the classical tools don't cover.

Moat claim is **honest but mislabeled as secret-sauce.** It's moat-as-*infrastructure* (the "are these tests adequate?" question stays useful as models improve) — not a competitive secret, since any Meta-ACH reader can build it. That's fine, just name it correctly.

### Feature 2 — Independent, blind-to-diff oracle from a different vendor → **KEEP (strongest fit)**
This is the best idea in the report and the most *baton-native* one. It (a) fixes the exact weakness the whole report identifies, (b) is the only feature that produces a *stronger green light* rather than just a diagnostic, and (c) uniquely exploits what baton has and single-agent systems don't — a second vendor. Fit is excellent: pure coordinator plumbing (route test-authoring to a different worker; withhold the diff), reusing the mature Anthropic PBT command as the generator, tagged in the LOG as an independent oracle. Moat is genuinely honest — overfitting is structural, not a capability gap.

One caveat the report under-weights: **the oracle problem cuts both ways.** A test written blind-to-diff can encode the test-writer's *misreading of the spec* and falsely block good work. You need the reconciliation step (Anthropic's "self-reflect on real-vs-false failures") as a required part, not an afterthought — otherwise the independent oracle trades false-passes for false-fails.

### Feature 3 — Cross-vendor differential + metamorphic → **KEEP as Later (correctly demoted)**
Real (Kaizen/MTF, classic n-version). Uniquely unlocked by the fleet. Honesty is good — explicitly conditioned on the decorrelation bet (E2). Two engineering caveats the report skips: (1) differential testing needs **comparable interfaces** — two vendors' implementations of the same brief may have different signatures, so "shared input pool" presumes a pinned interface contract; (2) metamorphic relations must be *stated* by something (human or LLM), and aren't always available. Keep the honest "Later." **Missing counterweight:** the beyond-frontier "fleet as n-version oracle" cites "decorrelation is an assumption" but omits the classic result that guts it — **Knight & Leveson (1986)** showed independently-developed versions still have *correlated* faults. With three models sharing training data and benchmark contamination, uniform-but-wrong agreement is a live failure mode. Cite it; it's the honest brake on E2.

### Feature 4 — Flaky-test quarantine + replay → **KEEP (and see "build first")**
Real and load-bearing. This is more foundational than the report frames it: a flaky gate corrupts **every** downstream trust fact — the existing re-verify, the mutation kill-rate, the differential divergence count, *and routing* (§5.2 learns from re-verified wins, so a flaky pass is a false win that poisons the routing stats too). Fits cleanly: rides §5.3 replay, adds a "flaky" warning signal alongside stalled/looping (§4.3). **One MODIFY:** demote the static-predictor claim. FlakeFlagger's F1~86% is dataset-specific and doesn't transfer well; the reliable mechanics are **rerun + nondeterministic-API pinning** (the PACMPL work), not static prediction. Also the report misses the more established flaky-detection lineage — **DeFlaker** (coverage-based, no reruns) and **iDFlakies** — which predate and out-generalize FlakeFlagger.

### Feature 5 — Diff-coverage gate → **KEEP (honest rental, cheap filter)**
Real, standard (diff-cover / Codecov patch coverage already do this — worth naming that it's off-the-shelf, not novel). Correctly labeled rental-ish and correctly navigates the CLAUDE.md no-arbitrary-limits rule via *delta* coverage. Good as the cheapest rung. No change.

### Feature 6 — Test-first reproduction gate for bug tasks → **KEEP as Later, sharpen the honesty**
Real (TDFlow verified: 94.3% *given* human tests). But the report should own what TDFlow's own data says: TDFlow scores **93.3% generating its own reproduction tests vs 94.3% with human ones** — a tiny gap — and the paper's conclusion is that **writing the correct reproduction test is the bottleneck**, not solving it. So "an independent failing reproduction test must exist before the worker starts" presumes you can *generate a correct one* — which is precisely the hard, semi-unsolved part. The durable asset is the red→green **gate mechanic** (moat); the generator is rental *and* currently unreliable. Report labels this split correctly — just don't let "94.3%" imply the reproduction test is the easy part.

### Feature 7 — Growing shared test corpus → **MODIFY (drop "monotonic", add adjudication)**
Grounded (AdverTest persisted across runs). Fits slow memory (§5.3) + provenance/contagion (§5.6). Compounding-moat claim is honest. Two real problems the report doesn't solve: (1) **"monotonically grows" fights test-suite hygiene** — a corpus replayed on every diff becomes a runtime and flakiness tax without pruning; drop the monotonic framing, add eviction. (2) **Enshrining a cross-vendor divergence as a permanent test pins a behavior you haven't confirmed is correct** — you may be freezing the *wrong* side. Needs adjudication (human or oracle) before a divergence becomes a regression test, on top of the fails-on-unfixed-code gate it already has. Keep as Later.

### Feature 8 — Fuzz rung → **KEEP as Later/risk-gated (correctly demoted)**
Real (OSS-Fuzz-Gen, PromeFuzz). Honestly labeled bet-leaning-rental, thin/swappable. Correctly risk-gated to parsing/serialization/unsafe surface, in-sandbox. No change — the demotion is right.

---

### Biggest missed SOTA (across the report)
**Deterministic, non-LLM tooling that plugs into the same gate slots with zero model dependence:**
- **Classical mutation engines** — PIT/Stryker/mutmut/cosmic-ray. These let Feature 1 ship *today*, reproducibly, with no equivalent-mutant-at-model-scale problem and **no rental exposure**. The report reaches past them straight to LLM mutation. That's the single most consequential omission — it changes how the flagship should be built.
- **SBST** — EvoSuite/Pynguin (AdverTest itself benchmarks against EvoSuite) as a deterministic independent-test source for Feature 2.
- **Daikon** (dynamic invariant inference) — a non-LLM way to mine likely properties from execution, grounding Feature 2's properties in something deterministic.
- **Knight & Leveson (1986)** — the honest brake on the n-version bet (Feature 3 / beyond-frontier).
- **SWE-bench's own FAIL-to-PASS / PASS-to-PASS harness structure** — the field already formalizes "tests the worker didn't author to pass"; the report talks around it without naming the mechanic it's re-inventing.

The theme: the report leans LLM-native where the *gate* specifically wants determinism (a gate that fires on every "done" cannot itself be flaky or model-dependent). Deterministic tools are the purer moat here precisely because a better base model doesn't obviate them.

---

### The one to build first: **Feature 2 — the independent, blind-to-diff oracle written by a different vendor**

Why this over the report's pick (Feature 1):
1. **It fixes the exact problem the whole report is about.** Oracle overfitting is structural. A test authored by a worker that never saw the code *cannot* have been written to match the code. Feature 1 only *diagnoses* weak tests; Feature 2 *produces a green light the worker couldn't have gamed* — which is the entire justification SYSTEM.md §5.1 gives for auto-merge.
2. **It's the most baton-native feature in the report.** It needs the one thing baton has and no single-agent system does: a second vendor. Meta-ACH-style mutation (Feature 1) is something any solo agent can bolt on; the blind cross-vendor oracle is *only* buildable on a fleet. Per the task's own test ("does it help the fleet driver drive *better*, uniquely"), this scores highest.
3. **Lowest new machinery.** No mutation engine, no fuzzing infra, no coverage instrumentation — just coordinator plumbing baton already has: route test-authoring to a different worker, withhold the diff, run the result in a fresh worktree, log it as an independent-oracle verdict. It's mostly an *information-flow rule*, not a new subsystem.
4. **Moat is structural, not rental.** A smarter worker writes smarter *self-passing* tests too — so the gap Feature 2 closes doesn't shrink as models improve.

**Non-negotiable co-requisite:** ship **Feature 4 (flaky quarantine)** in the same increment. An independent oracle that's flaky lies in both directions and would poison routing (§5.2) as well as the gate. Flaky handling is the cheap insurance that keeps the new, stronger signal honest — build it as the guard rail around Feature 2, not as a later phase.

**Natural second:** Feature 1, built on a *deterministic* mutation engine (PIT/Stryker/mutmut), so the two rungs the report wants to add to the ladder — mutation (is the suite real?) and independent-oracle (is the pass earned?) — land together, both reproducible, both writing distinct LOG verdicts, neither exposed to rental.

Files read: `/Users/wahargis/Development/Experiments/baton/SYSTEM.md`, `/Users/wahargis/Development/Experiments/baton/GLOSSARY.md`.
