# Red/Blue/Explore — ensemble-economics

## RED
## Red-team: ensemble-economics

Target: **doc 12 §3** (line 48): *"because the envelope + `reverify` make results **comparable and re-checkable across vendors**, 'different harnesses fail differently' stops being a liability and becomes an **ensemble** — best-of-N across Codex/Claude/GLM with the hub as the judge (the error-decorrelation value from doc 06 Q1, now mechanized). **Heterogeneity is the asset.**"*

The attack in one line: the sentence couples two things that are anti-correlated in practice (re-checkability and decorrelation-value), routes the payoff through a "judge" the architecture forbids the hub from having, prices it against a subscription arbitrage that best-of-N is the *most* likely workload to destroy, and parallelizes it against concurrency walls that make it serial. The design's own buried reference file already wrote the honest version; the headline doc dropped every caveat.

---

### FATAL 1 — "the hub as the judge" is architecturally impossible; `reverify` is a gate, not a ranker, and every way to build the ranker breaks a stated invariant

**Claim attacked:** "best-of-N across Codex/Claude/GLM **with the hub as the judge** … now mechanized."

**Why it fails:** `reverify` returns a `Verdict` — a pass/fail gate (`spec/capability-plane.md` §6: *"For deterministic capabilities this is an exact re-run"*; the ladder is *"forgeability, not pass/fail"* selection, doc 11 §3). A gate selects a unique winner only in the case where **exactly one** of N candidates passes. The two common cases both defeat the claim:
- **0 pass** → you spent N× and learned nothing the cheapest single arm wouldn't have told you.
- **≥2 pass** → the gate is silent; there is no ranking. To pick among passing diffs you need a *quality judge* (diff size? cost? correctness-beyond-the-test?).

That judge cannot be "the hub." The whole architecture's headline is a **non-LLM supervisor** (doc 09 line 5: *"hub + MCP northbound + southbound adapters + **non-LLM supervisor**"*). A deterministic supervisor can run `reverify`; it cannot judge diff *quality*. Every fix breaks something:
1. Put an LLM judge in the hub → you've re-opened *"cross-agent prompt injection … the signature attack of this architecture"* (doc 06 Q4), now on the highest-authority component, judging attacker-influenced diffs from three vendors.
2. Make the judge one of the ensemble vendors (Claude judges Claude+Codex+GLM) → documented LLM-as-judge **self-preference/position bias** systematically corrupts selection *in the direction of the judge's own family* — which is exactly the correlation the ensemble existed to cancel. Decorrelation on the generate side, re-correlation on the select side.
3. Use a neutral 4th vendor as judge → now it's **(N+1)×** cost and the judge still has verbosity/position bias with no ground truth.

**Evidence:** the design *already knows this* — its own reference file states it and doc 12 §3 dropped it: *"`reverify` gives a **pass/fail gate**, not a **ranking**. Best-of-N-with-verification only selects when exactly one candidate passes; when two of three pass reverify you have no way to 'pick the winner' — you need a **tie-break scorer** that baton must define and that reverify does not provide"* (`docs/reference/context-harness/interop-unification.md` line 206). The headline doc asserts "the hub as the judge … Heterogeneity is the asset" with none of this. The mechanism the sentence claims is "mechanized" is, per the design's own analysis, undefined.

**Severity: fatal** — the load-bearing verb ("the hub as the judge") names a component that doesn't exist and can't be built without violating the non-LLM-supervisor invariant or the injection threat model.

---

### FATAL 2 — best-of-N pays where `reverify` is weakest and is redundant where `reverify` is strongest; the precondition and the payoff are anti-correlated

**Claim attacked:** the causal chain "**re-checkable across vendors** → therefore ensemble → therefore decorrelation is mechanized."

**Why it fails:** `reverify` yields a clean, cheap, trustworthy signal only on **deterministically verifiable** tasks — tests, proofs, exact re-runs (`spec/capability-plane.md` §6, §9 Q1). But:
- On exactly those tasks, **decorrelation buys little**: if you hold a ground-truth oracle (a passing test suite, a machine-checked proof), one worker + `reverify` already tells you correct-or-not for ~1× cost. You rarely need three vendors to find a green suite you can verify in milliseconds.
- Decorrelation's value is highest on **hard, spec-ambiguous, novel** tasks where models genuinely disagree — and those are precisely where `reverify` collapses to *"Autoformalization … an unsolved trust leak, not a footnote — the spec→property gap can invalidate the whole proof-carrying story"* (doc 11 risk 1), or has **no oracle at all**. *"A perfect proof of the wrong theorem is worthless"* (doc 11 §3).

So the mechanism that makes the ensemble *selectable* (re-checkability) is present only where the ensemble is *unnecessary*, and absent where it would pay. Best-of-N with a trustworthy gate is a solution to a problem you mostly don't have.

**Concrete scenario:** Task A = "make `pytest tests/auth` pass" (deterministic oracle). Codex passes on the first try; `reverify` confirms; the Claude and GLM arms are pure waste — you paid 3× to confirm what 1× proved. Task B = "refactor the auth flow to be 'cleaner' and 'more idiomatic'" (no oracle). All three diffs pass the (unchanged) tests; `reverify` says nothing about *which is cleaner*; you're back to Fatal 1's LLM judge with no ground truth. There is no task shape where re-checkability and decorrelation-value are both high.

**Severity: fatal** — it severs the doc's own "because … therefore" chain. Re-checkability does not imply a valuable ensemble; it implies the opposite selection of tasks.

---

### SERIOUS 3 — concurrency ceilings make best-of-N *serial*, so you pay N× tokens for sub-linear parallelism

**Claim attacked:** implicit in "best-of-N across Codex/Claude/GLM" — that N arms run in parallel so wall-clock ≈ 1×.

**Why it fails:** best-of-N's *only* defensible economics (doc 06 Q1) is *"parallel independent tasks"* — but doc 01 §7 kills the parallelism vendor-by-vendor. *"Pro-tier GLM-4.7 concurrency of **1 in-flight request** (reportedly reduced from 3 without notice) … A GLM 'fleet' on a Lite/Pro plan is one worker with a queue"* (doc 01 §7 / doc 06 Q7). A 3-way bakeoff that includes a GLM arm cannot even parallelize GLM against itself; the GLM arm serializes behind the vendor's wall. Wall-clock of a bakeoff = max over arms = dominated by the throttled vendor. Worse: *"glm-adapter is really **claude-surface + glm-model**"* (doc 09 D1) and *"Claude Code IS the GLM harness"* (doc 01 §5) — so the Claude arm and the GLM arm can contend for the *same* Claude Code surface/seat, not two independent seats. And peak-hour multipliers compound the *cost* axis: *"GLM-5.2/Turbo consume at 3× during peak hours"* (doc 01 §7) — a 3-way bakeoff at 15:00 UTC+8 burns 3 arms × up to 3× quota = ~9× effective quota for one task, on a plan that grants ~400 prompts/5h.

**Severity: serious** — the "asset" is priced as parallel and delivered as serial-with-multiplier on the cheapest tier, which is exactly the tier a cost-sensitive fleet uses.

---

### SERIOUS 4 — best-of-N is the single workload most likely to trip the ToS tripwire that funds it

**Claim attacked:** the tacit economic premise (doc 06 Q1.2) that N× is affordable because *"Three flat-rate plans = a fleet whose marginal task is free."*

**Why it fails:** doc 06 Q1.2 itself flags this as *"economically real but strategically fragile,"* and doc 01 §7 gives the vendor's own words: Anthropic's (paused, *"reworking, not abandoning"*) metering targeted *"**heavy automated workloads (long-looping agents, CI-per-commit)** exceed[ing] subscription revenue."* Best-of-N is the maximal-multiplier automated workload in existence: N vendor generations + N `reverify` sandbox re-runs, per task, forever. Running best-of-N at scale is the *most efficient way to become the exact abuse case that gets subscription arbitrage metered.* And the design's own default posture for unattended use is already API keys, not subscriptions: *"F5: Subscription-arbitrage premise overstated … API-key fallback is the default posture for unattended/CI"* (doc 09 F5). On API keys there is no "free marginal task" — N× is N× real dollars, and *"No cross-vendor KV-cache … Ensembling pays real tokens per vendor. Honest"* (reference, line 154). The economic case for "heterogeneity is the asset" evaporates the moment it succeeds enough to matter.

**Severity: serious** — the workload is self-defeating: at the scale where decorrelation would statistically pay, it is the scale most likely to remove the flat-rate pricing that made N× tolerable.

---

### SERIOUS 5 — the "scorecard learns the threshold" backstop (§6 Q5) cannot converge

**Claim attacked:** doc 12 §6 Q5's implied rescue: *"does the scorecard learn that threshold?"* — the idea that the fleet learns *when* N× is worth it.

**Why it fails:** three independent blockers, each sufficient:
1. **No key.** Learning "when is decorrelation worth it" requires a task-class taxonomy to group on, but *"nothing in the design classifies a task as an 'auth refactor'"* (reference, line 208). Wilson-scored win/loss (doc 11 §7 `RouteStat`) has no `GROUP BY` column.
2. **Cold-start exploration cost exceeds the prize.** To learn the threshold you must *pay* N× across many samples per (harness × task-class × N) cell *before* you can decide N× wasn't worth it. For any fleet not running thousands of repeated, stably-labeled tasks, the exploration bill exceeds the lifetime savings — which is why doc 11 §7 already concedes *"**most fleets should stop at the near-free run scorecard**."*
3. **Non-stationarity outruns convergence.** *"all three vendors moved within the last 8 months"* (doc 06 Q7) — models update, quotas change, ToS shifts. Each vendor change resets the per-cell statistics. A counter that needs hundreds of stationary trials per class to converge, against a world that reshuffles every ~8 weeks, never converges.

**Severity: serious** — the doc raises the threshold-learning question in §6 and never answers it; the honest answer is "it can't," which means best-of-N is dispatched on vibes, not learned economics.

---

### SERIOUS 6 — decorrelation is assumed, not measured, and two of the three "vendors" share a harness surface

**Claim attacked:** "**different harnesses fail differently** … Heterogeneity is the asset" — the assumption of cross-vendor failure independence.

**Why it fails:** (a) Frontier models share training corpora and RLHF convergence; on the hard/novel cases where you'd want decorrelation, biases correlate — *"for frontier models trained on overlapping corpora is an empirical bet, not a given — on genuinely novel problems the biases correlate and best-of-3 buys little"* (reference, line 206). (b) Sharper and unacknowledged in doc 12: two of the three arms are **not** independent harnesses. GLM runs *through Claude Code* (*"Claude Code IS the GLM harness,"* doc 01 §5; *"glm-adapter = claude-surface + glm-model,"* doc 09 D1). So harness-level failure modes — tool ergonomics, prompt scaffolding, compaction behavior, the `settings.json` deny-rule gap (doc 01 §1) — are **shared** between the Claude arm and the GLM arm. The realized decorrelation is below even the model-family estimate the doc assumes. (c) The one pattern the doc cites as proof (doc 06 Q1: *"the one pattern with existence proof — OpenAI ships a Claude Code plugin whose flagship feature is exactly **adversarial review**"*) is **cross-review**, not best-of-N generation. The doc conflates a proven pattern (A implements, B critiques) with an unproven one (A, B, C all generate, hub picks) and inherits the proof it didn't earn.

**Severity: serious** — the core premise ("fail differently") is weaker than claimed and partly false for the actual Claude/GLM pairing, with no measurement plan attached (doc 06 Q9: *"If you can't measure it, you built a toy"*).

---

### SERIOUS 7 — best-of-N wastes N-1 of every N results and doesn't compose with the fleet's own decomposition model

**Claim attacked:** that best-of-N is a general "asset" rather than a niche tactic.

**Why it fails:** the fleet's decomposition principle is *"Work decomposes by task and capability … boundaries are drawn for parallelizability and verifiability"* (doc 10 §59) — N workers on N *different* nodes. Best-of-N is the inversion: N workers redundantly solving the *same* node, N-1 diffs discarded, each discarded diff having still cost a `reverify` sandbox run (doc 09 C2: verification runs in a *worker* sandbox, so N candidates = N sandboxes). And the winner isn't free either — it still needs integration, and for anything stateful you cannot merge divergent solutions: *"Deep interleaved collaboration (workers co-editing one change) is **where cross-vendor orchestration goes to die**; don't design for it in v1"* (doc 06 Q1). Best-of-N is therefore confined to tasks that are simultaneously coarse-grained, self-contained, stateless, *and* deterministically verifiable — a slice narrow enough that "Heterogeneity is the asset" (unqualified, general) is an overclaim about a corner case.

**Severity: serious** — the technique's applicable domain is a small intersection, not the general "asset" the sentence asserts.

---

### ANNOYING 8 — internal contradiction: §3 declares victory, §6 admits it doesn't know, and the honest version is buried

**Claim attacked:** the confidence of the headline vs. the doc's own open questions.

**Why it fails:** doc 12 §3 line 48 asserts *"Heterogeneity is the asset"* as settled and *"now mechanized."* Twenty-eight lines later, doc 12 §6 Q5 lists the identical mechanism as an **unresolved open question**: *"when is decorrelation worth the N×, and does the scorecard learn that threshold?"* A claim cannot be both mechanized-and-an-asset and an open-question-about-when-it-pays. The full honest framing — *"a buildable best-of-N gated by verification; value is conditional on (a) the task being reverifiable, (b) a tie-break scorer you build, (c) vendor independence you must measure, and it costs N× tokens"* — exists, but only in `docs/reference/context-harness/interop-unification.md` (line 206), a file the headline doc doesn't cite at the point of the claim. The published summary is strictly more confident than the design's own analysis.

**Severity: annoying** — editorial/honesty defect rather than a mechanism failure, but it's the tell: every load-bearing caveat was present in the reference pass and stripped from the sentence that ships.

---

**Bottom line.** The defensible residue (which the design should retreat to) is the reference file's own honest version plus doc 06 Q1's *proven* pattern: **cross-review** (A implements, B from another vendor critiques — one existence proof, coarse-grained, no ranker needed) and **reroute-on-refusal** (doc 06 Q8: a refusal is information; try another seat). Both are *N=1-at-a-time* uses of heterogeneity that need no judge, no tie-break scorer, no convergent scorecard, and no N× standing cost. "Best-of-N generation with the hub as judge" is a different, unproven claim wearing the proven one's existence proof — and doc 12 §3 states it without the four preconditions its own authors already wrote down.

## BLUE
I have everything I need. The key finding: the design corpus already holds the red team's own "defensible residue" position — doc 07 M1 makes `fleet_review` (cross-review, existence proof) the headline and marks `fleet_bakeoff` (best-of-N + judge) merely "Optional"; interop-unification.md line 206 states all four preconditions. Only the single doc 12 §3 sentence overclaims. My verdict follows.

## Blue-team: ensemble-economics

**Framing.** The red team is attacking one sentence (doc 12 §3, line 48), and on that sentence it is largely right: the words "the hub as the judge … now mechanized … Heterogeneity is the asset" strip every caveat the design wrote elsewhere. But the *design underneath* is not the sentence. The corpus already holds red's own "defensible residue": doc 07 M1 makes cross-review (`fleet_review`) "the headline… the one use case with an existence proof" and marks "**Optional** `fleet_bakeoff` (N vendors, same task, judge)"; interop-unification.md line 206 states all four preconditions; doc 11 §7 says "most fleets should stop at the near-free run scorecard." So most findings resolve as **concede the sentence, defend the mechanism** — the fix is to retreat doc 12 §3 to the honest version the design already ships. Two findings (2, part of 7) are genuine over-reach *by the red team* and I defend. None is fatal to the design; one word ("judge") is fatal to the sentence.

---

### FATAL 1 — "the hub as the judge" names a component that can't exist
**Verdict: concede-and-fix** (fatal to the word "judge", not to best-of-N).

Red is correct that `reverify` returns a `Verdict` gate, not a ranker — the design says so itself: capability-plane.md §6 "For deterministic capabilities this is an **exact re-run**"; the interface (§1) types it `reverify?(...): Promise<Verdict>`; doc 11 §3 "forgeability, **not pass/fail** selection"; and interop-unification.md line 206 already concedes the exact point: *"reverify gives a pass/fail gate, not a ranking… you need a tie-break scorer that baton must define and that reverify does not provide."* The word "judge" is an overclaim and must be cut.

But the *selection procedure* is buildable inside every invariant, and does **not** require any of red's three broken fixes (in-hub LLM / self-family judge / N+1 neutral judge):

1. **The gate is sufficient for the actual value model.** Best-of-N's payoff is **pass@N = 1−(1−p)^N**, not "always rank a winner." reverify-as-gate is exactly the right instrument: it certifies *which* arm(s) passed with hub-independent, millisecond-cheap evidence (capability-plane §6). Red's "0 pass → learned nothing" is false — N independent failures on a deterministic oracle is a strong *escalate-to-human / reroute* signal (the generalized doc 06 Q8 "refusals are information").
2. **The ≥2-pass tie-break is deterministic and needs no LLM.** The envelope carries `cost:{tokens_out, wall_ms, usd}` (capability-plane §3) and the hub owns the worktree, so **diffstat is a hub-computed `trusted_fact`** (doc 09 C1/C2), not worker-reported. The non-LLM supervisor can rank passers by min-diff (parsimony) or min-cost (budget) — a `trusted_fact` scalar, not prose it obeys, preserving doc 12 §1b's typing rule. Note red *itself* lists "diff size? cost?" as the criteria — those are exactly the deterministic scalars the hub already has.
3. **Semantic ties escalate to cross-review, which is not an in-hub judge.** doc 07 M1's `fleet_review` uses "worker B **from a different vendor** reviews the diff" — cross-vendor by construction, dodging red's option-2 self-preference bias; and the review is structured output whose claims are themselves partially reverifiable ("does the flagged bug reproduce?"). That is a *worker capability*, not an LLM in the hub, so the non-LLM-supervisor invariant (doc 09 headline) holds.

**Mechanism/fix:** rewrite doc 12 §3 to "the hub as the **verification gate + deterministic (`cost`/diffstat) tie-break**, escalating semantic ties to cross-review" — never "judge."
**Residual (honest):** "cheapest/smallest passing diff" is a parsimony/budget *proxy*, not a correctness-beyond-oracle guarantee; genuine semantic ties do incur red's option-3 cost — but as an **opt-in `fleet_review` on ties**, not the standing cost of every run.

---

### FATAL 2 — "reverify is weakest where decorrelation pays" (anti-correlation)
**Verdict: defend** (red conflates "verifiable" with "easy").

Red's thesis collapses two different "hard"s: (1) hard-to-*solve*, easy-to-*verify* (a concurrency bug with an existing failing test); (2) hard-to-*specify*, no oracle (autoformalization). reverify is at its **strongest** on (1) and weakest on (2) — and best-of-N economics live entirely in (1). On a deterministic-oracle task with per-arm solve probability p<1, decorrelation is *precisely* what raises pass@N: p=0.4 → pass@3 = 1−0.6³ = 0.784. Red's claim "one worker + reverify already tells you correct-or-not" conflates **verifiability with solvability** — reverify tells you *if* the one worker succeeded; it does not *make* it succeed.

The both-high quadrant red says can't exist is **the entire SWE-bench class**: deterministic oracle (a test suite), per-model solve rate 30–80% (decorrelation-rich). That is the design's stated eval target (doc 06 Q9 "fixed task set… verification commands"; doc 11 grounds on SWE-agent). doc 11 validation-ladder rungs `test`/`proptest`/`fuzz` are exactly deterministic oracles on hard tasks. Red's Task-A ("Codex passes first try") cherry-picks an *easy* verifiable task (p≈1) — a strawman of when you'd invoke best-of-N; the scorecard/criticality gate steers best-of-N *away* from those.

**Mechanism/fix:** none needed for the thesis — but the design must *state the quadrant* at the claim site (doc 12 §3): best-of-N is scoped to **hard-but-reverifiable** tasks (low per-arm p, deterministic oracle). Red's Task-B ("make it cleaner", no oracle) is correctly out of scope — it routes to `fleet_review`, not `fleet_bakeoff`, and the doc should say so.
**Residual:** the design owes an explicit "no-oracle → cross-review, not bakeoff" boundary in doc 12 §3, which is currently missing.

---

### SERIOUS 3 — concurrency ceilings make best-of-N serial
**Verdict: concede-and-fix** (mostly defend; red overcounts).

A 3-way **cross-vendor** bakeoff (one arm per vendor) runs on three independent seats/auths/endpoints — Codex, Anthropic, Z.ai — so wall-clock ≈ max(arm), genuinely parallel. GLM's `concurrency_ceiling≈1` (doc 01 §63) bites only **GLM-internal** best-of-N, which the scheduler already forbids: interop-unification.md line 84 "concurrency_ceiling≈1 (Pro)… **serialize**"; doc 01 §65 "per-vendor concurrency ceilings belong in the harness card and the **scheduler**, not in retry loops."

Two red sub-claims are wrong:
- **"Claude arm and GLM arm share a seat"** — no. glm-adapter is claude-*binary* + Z.ai *auth/endpoint* (doc 09 D1); the two arms bill *different vendors* (Anthropic vs `api.z.ai`) and don't contend for quota. They share *surface failure modes* — but that's the decorrelation point (Finding 6), not concurrency.
- **"9× at peak"** — overcounts. The GLM 3× peak multiplier (doc 01 §63) applies to the **GLM arm only**: peak cost ≈ 1(Codex)+1(Claude)+3(GLM) = **~5×**, and the existing mitigation is doc 01 §65 "**time-aware dispatch**" — run/drop the GLM arm off-peak.

**Mechanism/fix:** `fleet_bakeoff` card requires **distinct seats per arm**; scheduler drops/defers the GLM arm at peak (doc 01 §65). The doc must stop implying parallelism erases *token* cost.
**Residual:** token spend is genuinely N× (~5× at GLM peak) regardless of wall-clock — owned in Finding 4. And multiple *same-vendor* arms (best-of-3 all-GLM) IS serial; best-of-N is the wrong tactic there and the card should reject it.

---

### SERIOUS 4 — best-of-N is the workload most likely to trip the ToS tripwire that funds it
**Verdict: defend** (via a concession the design already made).

The design does **not** fund best-of-N on subscription arbitrage. doc 09 F5 (CONFIRMED): *"Subscription-arbitrage premise overstated… **API-key fallback is the default posture for unattended/CI**."* doc 07 M1: *"Auth posture: **API-key is the default** for unattended/CI; subscription auth is an opt-in, vendor-narrow, on-notice mode."* interop-unification.md line 154: *"Ensembling pays real tokens per vendor. **Honest.**"* So best-of-N is priced at honest N× **real dollars on API keys** — where metered use is the *sanctioned* path, not a tripwire. Red is attacking the doc 06 Q1.2 "marginal task is free" premise that the design's own revision log already retired.

**Mechanism/fix:** the `fleet_bakeoff` doc should *explicitly forbid* unattended best-of-N on subscription auth (the one place red's abuse-case is real is someone ignoring F5).
**Residual:** the honest N× dollar cost is precisely why best-of-N must be criticality/scorecard-gated to high-pass@N-lift tasks (Finding 5) — the economics are honest, but they are *not free*, and doc 12 §3's tone of costless heterogeneity must go.

---

### SERIOUS 5 — the "scorecard learns the threshold" backstop cannot converge
**Verdict: concede-and-fix.**

Concede the learned-threshold cannot robustly converge: non-stationarity is real ("all three vendors moved within the last 8 months", doc 06 Q7) and the task-class key is unspecified — interop-unification.md line 208: *"nothing in the design classifies a task as an 'auth refactor'… without the classifier the counter has no key."* Red is right that doc 12 §6 Q5 poses the question and never answers it.

But the fixes are concrete and the "dispatched on vibes" charge is wrong:
1. **The missing key is buildable deterministically** — not a semantic classifier. The brief carries `path_scope` (doc 06 Q6) and a typed DoD/verification command; a coarse class = `path_scope` prefix (`src/auth/**`→"auth") × DoD-type (test/proof/perf). That gives `RouteStat` (doc 11 §7) a GROUP BY column with **no LLM**.
2. **best-of-N is NOT gated on a converged learned threshold** — it's dispatched on **criticality/budget policy**, the same dial that picks the validation-ladder rung: capability-plane §7 "the orchestrator (or a policy) picks the rung by task **criticality and budget**." An operator marking "this is the critical-path auth change, spend N×" is neither vibes nor a converged model — it's an explicit input.
3. **The learned threshold is explicitly an earned-by-recurrence increment**, honestly deprioritized: doc 11 §7 "**most fleets should stop at the near-free run scorecard**"; doc 12 §4 "**measure emergence or delete it**." Under drift, Wilson-scored counters (doc 11 §7) with recency weighting degrade gracefully — they need to beat random on the *recent window*, not converge a stationary point-estimate; doc 01 §65 "re-check on a calendar" is the stated posture.

**Mechanism/fix:** doc 12 §6 Q5 should *answer itself*: "dispatched on criticality-policy, not a converged learned threshold; the learned threshold is built only when task-classes recur (doc 11 §7)." Add the deterministic `path_scope×DoD-type` key spec.
**Residual:** for fleets that *do* build the learned threshold, red's non-stationarity limit is real and permanent — the honest answer is "recency-weighted, calendar-rechecked, and off for most fleets," not "converges."

---

### SERIOUS 6 — decorrelation assumed-not-measured; two of three arms share a surface
**Verdict: (a) defend · (b) concede-and-fix · (c) concede (editorial).**

**(a) "assumed, not measured" — defend.** The design already treats decorrelation as an empirical bet *and* specifies the measurement: interop-unification.md line 206 "an **empirical bet, not a given** — on genuinely novel problems the biases correlate and best-of-3 buys little"; the measurement plan is doc 06 Q9 (fixed task set, arms solo/subagents/fleet, pass rate, "**cross-review on/off**" ablation) — "If you can't measure it, you built a toy." So it is flagged-as-bet-plus-eval, not assumed.

**(b) shared Claude surface — concede (red's sharpest point).** glm-adapter = claude-*surface* + glm-*model* (doc 09 D1; doc 01 §47 "Claude Code IS the GLM harness"). So {Codex, Claude, GLM} has only **two independent SurfaceAdapters** (Codex's + Claude Code's, used by both the Claude and GLM arms). Shared harness bugs — compaction behavior, tool scaffolding, the settings.json deny-rule gap (doc 01 §11, issue #94) — are common-mode across the Claude and GLM arms and the bakeoff cannot cancel them.
**Fix:** use doc 09 D1's own **SurfaceAdapter / ModelProfile / Seat** factoring to *stamp the decorrelation axes* on the bakeoff result — three-way on Model+Seat, **two-way on Surface** — and never claim three independent harnesses. To recover true surface-decorrelation, adopt doc 07 M2's already-proposed "**OpenCode-as-GLM-worker** as a distinct… adapter" (a different surface for GLM).

**(c) existence proof is cross-review, not best-of-N — concede (editorial).** Red is right that doc 06 Q1's proof (OpenAI's plugin = "adversarial review") is cross-*review*. And the design's own roadmap knows it: doc 07 M1 assigns the existence proof to `fleet_review` and marks `fleet_bakeoff` merely "Optional." **Only doc 12 §3's sentence** borrows the cross-review existence proof for best-of-N generation ("the error-decorrelation value from doc 06 Q1, now mechanized").
**Fix:** cut "now mechanized" + the existence-proof attribution from best-of-N in doc 12 §3; keep the existence proof on cross-review, matching doc 07 M1.
**Residual:** with Claude Code as GLM's surface, common-mode harness failures are real until OpenCode-as-GLM (doc 07 M2) is adopted; decorrelation remains an empirical bet the eval must confirm per task-class.

---

### SERIOUS 7 — best-of-N wastes N−1 and doesn't compose with the decomposition model
**Verdict: defend (the composition/merge claim) · concede-and-fix (the "unqualified asset" overclaim).**

**Defend — red misapplies "co-editing goes to die."** best-of-N **never merges** the N candidates; it *picks one and discards N−1*. So doc 06 Q1's "deep interleaved collaboration… where cross-vendor orchestration goes to die" is inapplicable — best-of-N is the *opposite*: N **independent** attempts at one node, which is exactly doc 06 Q1's blessed "(b) **parallel independent tasks**." "Stateful merge impossible" is a non-issue because no merge occurs. And it *composes cleanly* with the DAG: a task-DAG node (doc 10 §59) is tagged "best-of-N=3"; the scheduler fans 3 arms, gates, picks one, emits one winning diff downstream — a **node-level policy** orthogonal to the decomposition, exactly like a validation-ladder rung selector. The "wastes N−1" is the *definition* of pass@N spend, priced honestly (interop-unification.md line 154), not a defect.

**Concede — "Heterogeneity is the asset" (unqualified) overclaims.** best-of-N's domain genuinely is the narrow coarse + self-contained + reverifiable slice, so making it *the* proof of the general claim is over-reach.
**Mechanism/fix:** reframe doc 12 §3 as a **portfolio**: heterogeneity is an asset via cross-review (`fleet_review`, coarse, existence-proof), reroute-on-refusal (doc 06 Q8), comparative-advantage routing (doc 06 Q1.3), *and* — narrowest — best-of-N (`fleet_bakeoff`). best-of-N is one member, not the headline. This is exactly doc 07 M1's ordering (`fleet_review` headline; `fleet_bakeoff` optional).
**Residual:** N× waste caps best-of-N to high-pass@N-lift tasks — an economic bound, honestly owned, not removable.

---

### ANNOYING 8 — §3 declares victory, §6 admits it doesn't know, honest version buried
**Verdict: concede** (editorial/honesty defect — red is correct).

doc 12 §3 line 48 ("now mechanized… Heterogeneity is the asset", declarative) contradicts doc 12 §6 Q5 twenty-eight lines later ("**when** is decorrelation worth the N×, and does the scorecard learn that threshold?", open). The four preconditions live in interop-unification.md line 206 but are absent at the claim site. Red's diagnosis — "every load-bearing caveat was present in the reference pass and stripped from the sentence that ships" — is accurate.

This is a documentation-honesty failure, **not** a mechanism failure: the corpus's own honest version (doc 07 M1's headline/optional split, interop-unification.md line 206's four preconditions, doc 11 §7's "stop at the scorecard", doc 06 Q1's proven-vs-unproven distinction) already refutes the sentence.
**Mechanism/fix (single consolidated edit to doc 12 §3):** (i) "the hub as the **verification gate + deterministic tie-break**, semantic ties → cross-review" — never "judge"; (ii) attach the four preconditions inline or cite interop-unification.md line 206; (iii) demote best-of-N to one member of the heterogeneity **portfolio**, cross-review as headline (matching doc 07 M1); (iv) reconcile with §6 Q5 by answering it (criticality-policy dispatch; learned threshold earned-by-recurrence, off for most fleets); (v) scope to hard-but-reverifiable tasks, with no-oracle → cross-review stated.
**Residual:** none beyond the edit; the design already holds the honest position everywhere except this sentence.

---

**Bottom line.** I concede the sentence and defend the design. Red's own "defensible residue" — cross-review as the proven, ranker-free headline; best-of-N as a narrow, honestly-N×-priced, criticality-gated increment — **is already the design's stated position** in doc 07 M1, interop-unification.md line 206, doc 11 §7, and doc 06 Q1. Nothing here is fatal to baton: best-of-N is buildable inside every invariant as **gate + deterministic (`cost`/diffstat) tie-break + cross-review escalation for semantic ties**, scoped to the hard-but-reverifiable quadrant (where red's anti-correlation thesis is simply false), on distinct API-key seats (where the ToS tripwire doesn't fire), dispatched by criticality (not a phantom converged threshold). The one fatal casualty is the word **"judge"** and the costless-victory tone of doc 12 §3, line 48 — fix by retreating that single sentence to the honest version the rest of the corpus already ships.

## EXPLORE & VERDICT
I have what I need. I've read the target sentence (doc 12 §3 line 48) in full context, the roadmap's own framing (doc 07 M1 line 29), the scorecard/routing design (doc 11 module 7 line 30, doc 06 Q1.3), and the reference file's admitted costs (interop-unification.md lines 154, 206, 208). Here is my ruling.

## Explore & verdict: ensemble-economics

### The strongest alternative — "Route, don't ensemble": split the two N's

Red and Blue both stayed inside the frame "cross-vendor best-of-N, gated by `reverify`" and argued about whether it's buildable and honest. Step outside it. The target's value model is **pass@N = 1−(1−p)^N** (Blue's own defense, doc 12 §6 Q5). That curve is overwhelmingly a **repeated-sampling** phenomenon (Brown et al., *Large Language Monkeys*, 2024; Wang et al. self-consistency): coverage rises log-linearly in the number of samples **of one model at temperature** — you do not need three vendors to climb it. So the target conflates two orthogonal axes of "N":

- **Sampling-N** (intra-vendor, temperature): where the pass@N lift actually comes from. One auth, one adapter, **one shared prefix KV-cache** — so sample *k* costs ~output tokens only, not a re-read of context.
- **Vendor-N** (cross-vendor, decorrelation): expensive, unmeasured, and — by the design's own admission — **cacheless**: *"No cross-vendor KV-cache… Ensembling pays real tokens per vendor. Honest"* (interop-unification.md line 154).

The replacement therefore is: for the **pass@N** you want, do it **inside the single vendor you routed to** (cheap, subscription-friendly, needs no baton and no cross-vendor conformance harness); and extract the **cross-vendor-unique** value through the two mechanisms that *don't* require running N generators and a judge — **learned comparative-advantage routing** (doc 06 Q1.3; the `RouteStat` win/loss table, doc 11 module 7 line 30) and **cross-review** (a *different family* catches your blind spot — the one pattern with an existence proof, doc 06 Q1.1). Both are **1×-cost, ranker-free** uses of heterogeneity.

The economic punchline: cross-vendor best-of-N wins over intra-vendor sampling **only** when a *different family* covers a **systematic** per-family blind spot (p_A≈0, p_B>0) — but if you can *predict* the blind spot you should **route** (1×), and if you can't, best-of-N is a bounded cold-start probe, not a standing cost. So vendor-N's honest steady-state role is to **generate the routing data**, then get out of the loop — explore, don't exploit.

### Honest comparison

| | Target (cross-vendor best-of-N + hub judge) | Alternative (route to best vendor; sampling-N *inside* it; cross-review for the family-diversity value) |
|---|---|---|
| Where pass@N lift comes from | Attributed to vendor diversity | Attributed to repeated sampling — **capturable intra-vendor** |
| Cost per task | N× tokens, **no shared cache** (line 154), N× auth/ToS surface | ~1× + cheap temperature resamples on a **shared KV-cache**; cross-review adds one coarse pass |
| Needs a ranker / "judge" | Yes — the component the non-LLM-supervisor invariant forbids (doc 09), and `reverify` is *"a pass/fail gate, not a ranking"* (interop line 206) | **No.** Routing = argmax over a win-counter; cross-review = a worker capability, not an in-hub judge |
| Needs a task-class taxonomy | Yes, to know *when* N× pays — and *"nothing in the design classifies a task as an 'auth refactor'"* (interop line 208) | Same taxonomy need — but routing **pays for the taxonomy with 1× traffic**, where best-of-N pays N× to learn the same key |
| Decorrelation assumption | Load-bearing and unmeasured; **2 of 3 arms share the Claude Code surface** (doc 09 D1), so realized diversity is below the model-family estimate | Routing needs no independence assumption; cross-review needs only that a *different* reviewer sees *different* bugs — the proven, weaker claim |
| Vendor-uniqueness (does this justify **baton**?) | Weak: intra-vendor best-of-N needs no cross-vendor hub at all | Strong: **routing and cross-review are un-vendorable** — Anthropic will never ship "sometimes Codex wins"; a neutral arbiter is the one thing only a cross-vendor hub can be |

The comparison that matters most: the target uses best-of-N to **justify cross-vendor orchestration**, but best-of-N is best served **intra-vendor** — so it justifies the opposite of baton. The value that is *uniquely* baton's (a neutral cross-family arbiter and a cross-vendor routing table) lives in routing + cross-review, which the target buries.

### Verdict: **REVISE** (right intent, wrong economic engine — and the corpus already holds the fix)

Not CUT: "heterogeneity is an asset" is *true* — via routing and cross-review. Not KEEP: the specific engine the sentence names (best-of-N generation across vendors, "the hub as the judge," "now mechanized") is the wrong mechanism wearing the right conclusion, and it mislabels an intra-vendor technique as baton's cross-vendor differentiator. This is REVISE with a REPLACE-flavored core: **demote best-of-N generation out of the economics headline and put learned routing + cross-review in its place**; relocate best-of-N to *inside the routed vendor* and to *cold-start exploration for the router*, never as the steady-state delivery path.

Why this is REVISE and not a heavier verdict: the design **already ships the corrected frame everywhere except the target sentence** — doc 07 M1 makes `fleet_review` (cross-review) *"the headline… the one use case with an existence proof"* and marks *"**Optional** `fleet_bakeoff` (N vendors, same task, judge)"*; doc 06 Q1 lists comparative-advantage routing as a first-class value; doc 11 module 7 says *"most fleets should stop at the near-free run scorecard."* Only doc 12 §3 line 48 promotes the optional, unproven engine to *"Heterogeneity is the asset."* The fix is a one-paragraph retreat to the position the rest of the corpus holds — plus the conceptual correction that neither Red nor Blue made explicit: **best-of-N is an intra-vendor / exploration tool, not the cross-vendor asset.**

### The one thing to get right

**Separate sampling-N from vendor-N, and spend vendor-N only where a different *family* — not a different *sample* — is what buys you the value.** Concretely: pass@N lift → resample inside the routed vendor (cheap, cached, no hub needed). Blind-spot coverage → **route** (1×) when predictable, cross-**review** (1×, proven) when you want a second family's eyes. Reserve cross-vendor best-of-N for the narrow, honestly-N×-priced corner — *unpredictable, systematic per-family failure on a critical reverifiable task* — and treat even that as **exploration that seeds the routing table**, after which the fleet stops paying N×. Get this cut right and "heterogeneity is the asset" becomes true and cheap; leave it conflated and baton pays N× to buy a curve one vendor sells for ~1×.
