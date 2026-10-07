# Max-campaign stream: eval-design

## DESIGN
I have deep grounding across the corpus. Writing the design now — returning it directly as my final message (markdown, no file).

---

# baton M1 — The Eval: an un-riggable test of "does a supervised cross-vendor fleet beat a strong single-vendor soloist?"

*The linchpin doc. Every REVISE verdict in doc 13 and every "earned by demand" gate in docs 07/11 cantilevers off one unmeasured number. Doc 14 #21 demands this eval be red-teamed before it is run, because "if it's rigged — in either direction — every downstream decision inherits the rig." doc 14 #22 demands it be able to **confirm the null** — that orchestration makes agents worse. This document is the pre-registration-grade design that satisfies both. It is not a survey; it is baton's eval, tied to the invariants (I1 fence, I3 cursors, I7 hub-run verification), the `Cairn` RunScorecard/`RouteStat` plane (doc 11), and the two-channel/brief/result contracts (spec/communication-channel).*

---

## 0. The one number, and the asymmetry of what it can do

The eval produces one confirmatory number: **the paired difference in cost-adjusted resolved-rate between the full baton fleet (arm B3) and the strongest single-vendor baseline (arm A2), at matched total budget, on a pre-registered stratified corpus, graded by a sealed oracle the fleet cannot touch.**

Two disciplines govern it from the start:

1. **The eval is asymmetric by design.** A *cheap, underpowered* eval (MVP, N≈20) may **HALT** the project but may never **bless** it — a wide confidence interval is licence to stop, never licence to build. Only the *powered* eval (N in the low hundreds) can issue a GO. This asymmetry is the honest resolution of doc 07's "the proof is cheap": cheap enough to kill, not cheap enough to canonize.
2. **The eval must be able to confirm H0.** The null hypothesis — *coordination tax ≥ coordination value; a strong soloist wins* (doc 14 #22) — is a real, publishable outcome. An eval that structurally cannot return "the fleet lost" is rigged pro-fleet and is worthless. Half the design effort below is spent making the baseline strong enough that H0 has a fair chance.

---

## 1. Problem, precisely stated

### 1.1 The estimand

Let `T` be a task drawn from corpus `𝒞`. Let `A(·)` be an *arm* — a fully-specified agent configuration (baseline or fleet) run under a fixed **resource envelope** `E = (usd_max, wall_max, in_flight_ceiling)`. Let `G(diff)` ∈ {0,1} be the **sealed grader** (§2): 1 iff the arm's produced diff resolves the task under a held-out oracle the arm never saw.

For each arm we estimate `resolved(A) = E_T[ G(A(T)) ]`, and — because the whole point is cost — the **cost-adjusted** estimand:

- `resolved@usd(A, b)` = resolved-rate when every arm is capped at the same total USD budget `b` (fleet USD is the honest sum across all its vendor calls, priced at published API rates — §9);
- `resolved@wall(A, w)` = resolved-rate under the same wall-clock cap `w`, run at **real vendor concurrency ceilings** (Z.ai Pro ≈ 1 in-flight is a hard input, not idealized-away — doc 07 M2).

The **primary confirmatory estimand** is the paired difference `Δ = resolved@usd(B3, b*) − resolved@usd(A2, b*)` at the pre-registered budget `b*`, tested per-task-paired (§7). Everything else — wall-clock frontier, per-mechanism ablations, per-vendor cost — is **exploratory** and reported with multiple-comparison correction, so the eval cannot be data-dredged into a favorable headline.

### 1.2 The value decomposition (what "beats" must be attributable to)

"The fleet beats the soloist" is not one claim; it is a sum of four mechanisms the corpus earned, each of which the ablation matrix (§8) must isolate:

| Claimed value | Mechanism | Isolating ablation | Prior expectation from the corpus |
|---|---|---|---|
| **Independent verification** | I7 hub-run re-execution catches worker over-claims | B3 vs B3∖verify | The durable moat (doc 13 T5, doc 14 #23). Expected **positive**. |
| **Decorrelation** | different model families catch different bugs | B3(cross-vendor) vs B3(same-vendor) | doc 13 T6 predicts **≈0** for *generation*; positive only for *review*. A near-zero result here is a **confirmation**, not a failure. |
| **Steering** | mid-flight nudge/interrupt/reroute (the Conductor) | B3 vs B3∖steer (spawn-and-wait) | Unowned, real (doc 15 §0), but doc 13 demotes it to "optional branch." Sign unknown — this is what the eval is *for*. |
| **Context-economy** | provenance-typed digests keep the orchestrator's scarce context clean (doc 14 #4/#8) | B3 vs B3∖typed (raw transcripts) | Expected positive but small; mostly a cost/token effect. |

If the sum is positive **but concentrated in verification+review** (B1 lifts, B2/B3 do not), the eval's verdict is not GO but **PIVOT-TO-REFEREE** — exactly doc 13's Referee-not-Conductor reframe, now *measured* instead of argued. Pre-registering this as a named outcome is what stops the eval from being a thumbs-up/down that hides the most likely real answer.

---

## 2. The trust spine: the grader is I7 lifted one level

The proof red-team (doc 13 T1) showed workers spec-game verifiers, and doc 14 #21(c) names the eval's own grader as "the same attack surface, one level up." The fleet's *internal* I7 verification is part of arm B3 — but the **eval grader is a separate, higher, sealed oracle** governed by the same trust boundary the whole project rests on (doc 13 T5: re-verify in a sandbox neither the worker nor its vendor controls, against a spec the *evaluator* pins, never a worker-supplied restatement).

### 2.1 Sealed-grader procedure (the un-gameable core)

```
grade(task T, arm_diff D):
  # 1. Provenance gate — the arm may not have touched the oracle.
  if D touches any path in T.oracle_paths (held-out tests, grader harness):
      return FAIL(reason="oracle_tampering")          # spec-gaming attempt = auto-fail, logged

  # 2. Fresh sealed container — fleet has zero write access to it.
  #    Digest pinned & committed in the pre-registration (§7.4).
  ctn = docker_run(image=T.grader_image_digest, network=none, ro_rootfs=true)

  # 3. Apply the arm's diff to the CANONICAL base, then overlay the
  #    canonical held-out tests ON TOP (so a weakened in-repo test is discarded).
  ctn.git_checkout(T.base_sha)
  ctn.git_apply(D)                                     # only the arm's source changes survive
  ctn.checkout_from_oracle(T.oracle_paths)             # canonical FAIL_TO_PASS + PASS_TO_PASS

  # 4. Run. Authoritative exit/log is the container's, never the arm's report.
  ftp = ctn.run(T.fail_to_pass);  ptp = ctn.run(T.pass_to_pass)
  return PASS if (all(ftp)==pass and all(ptp)==pass) else FAIL
```

This is **I7's exact shape, one level up**: (i) re-execute in a sandbox the subject does not control; (ii) grade against a spec the *evaluator* pins; (iii) the subject's self-reported exit codes are non-authoritative claims. SWE-bench's `FAIL_TO_PASS`/`PASS_TO_PASS` split and per-task Docker images (SWE-bench Verified, OpenAI 2024; SWE-bench-Live 2025 for freshness) give us this substrate off the shelf. The `PASS_TO_PASS` set is the anti-regression guard: a fleet that resolves the bug by breaking ten other tests does not pass.

### 2.2 Reward-hacking that passes the hidden tests

Passing `FAIL_TO_PASS` is necessary, not sufficient — a diff can satisfy the tests while being wrong (hard-coding, narrowing, deleting the feature). Defense, layered so no single check is the whole grade:

- **Blind, cross-family LLM-judge audit on a pre-registered random subset (~20%).** The judge (a) is a model family present in *no* arm (neither soloist vendor nor any fleet worker — no self-grading), (b) is **blind to arm identity** (it never learns whether a diff came from solo or fleet — this kills pro-fleet bias, the mirror of position/verbosity bias in LLM-judge literature), (c) is a *secondary* signal that can only *demote* a test-passing diff to "suspect," never *promote* a test-failing one. The judge is itself non-authoritative; its disagreements are surfaced, adjudicated by a human on the audit subset, and the human-adjudicated label is what enters the confirmatory metric for those tasks.
- **Diff-shape tripwires** (cheap, deterministic, computed by the hub not a model): does the diff touch only test files? Delete asserts? Add `skip`/`xfail`? Introduce `if RUNNING_UNDER_GRADER`? Each is a flag; flagged-and-test-passing diffs are force-routed to human audit.
- **Semantic-diff review of the audit subset** (doc 15 §6, `difftastic`/`diffsitter`-class AST delta) so the human auditor reads *what changed in the graph*, not a noisy text diff — the one representation move doc 15 front-loads, used here to make the audit tractable.

### 2.3 Grader provenance is pinned before the run

The grader harness, the per-task oracle test sets, and the container image digests are **hashed and committed to the pre-registration** (§7.4) before any arm executes. The grader is immutable during the run. This is doc 13 T5's "grader-provenance / independent-verification trust boundary" applied to the eval itself: *the failure mode of a Referee — green-check theater strictly worse than trusting the worker — is exactly the failure mode of a rigged eval, and the same fix (pin the spec, re-run in a sandbox you control) closes both.*

---

## 3. The arms

Every arm runs under the **same resource envelope** `E` and the **same capability plane** (search, repo-map, debugger, test-runner — spec/capability-plane §8). The *only* thing that varies across arms is the orchestration structure. Withholding the capability plane from the soloist would be sandbagging; giving the fleet extra tools would be rigging. Same tools, same budget, structure is the independent variable.

### 3.1 Baseline ladder (deliberately steelmanned upward)

| Arm | Config | Role |
|---|---|---|
| **A0** | 1 vendor, 1 agent, 1 sample, capability plane | Floor / sanity only. *Not* the baseline — using it as the baseline is the strawman doc 14 #21(a) forbids. |
| **A1** | 1 vendor, 1 agent, **intra-vendor best-of-N** (self-consistency, same USD budget spent on N samples + a cheap self-select), capability plane | The **cheap-lift** baseline. doc 13 T6: pass@N is a *repeated-sampling* phenomenon best served inside one vendor (one auth, shared KV-cache). The fleet must beat *this*, not a single sample. |
| **A2** | 1 vendor, **its native multi-agent** (Claude Code `Task` subagents / Codex native), same budget, capability plane | **The strong baseline — the confirmatory comparand.** "Single-vendor" ≠ "single-agent." The hardest thing baton must beat is a good vendor's *own* orchestration. If baton only beats A0/A1 but not A2, the cross-vendor thesis is dead and the eval must say so. |

A2 is chosen per-task-class by a **pre-committed rule** to prevent post-hoc baseline-shopping: the soloist vendor for a class is the one with the higher `resolved` on a **separate calibration split** (§5.4), frozen before the confirmatory run. (Alternative pre-registered option: run A2 for *every* vendor and take the max — a strictly stronger, harder-to-beat baseline. The powered eval uses per-vendor-max; the MVP uses the single calibrated champion to save budget. Either is fixed in advance, never chosen after seeing results.)

### 3.2 Fleet arms

| Arm | Config | Isolates |
|---|---|---|
| **B1** | baton **cross-review only**: worker A (vendor X) implements; worker B (vendor Y) reviews the diff; hub I7-verifies. No decomposition, no steering. | The Referee value in isolation — the one use case with an existence proof (OpenAI's own review plugin; doc 07 M1). |
| **B2** | baton **partitioned parallel**: orchestrator decomposes, N cross-vendor workers in N worktrees, hub merges + I7-verifies. No mid-flight steering. | Parallelism + decorrelation + verification, minus steering. |
| **B3** | **the full system**: B2 + mid-flight steering/interrupt/reroute (the Conductor) + provenance-typed digests + `RouteStat` routing. | The whole product. The confirmatory comparand vs A2. |

### 3.3 Why these and not "baton vs a for-loop"

Doc 07 M0 already runs the honest for-loop baseline as a *smoke test*. That baseline is too weak to be the confirmatory comparand (it is A0-shaped). The confirmatory eval's job is the hard question — does baton beat a *well-resourced, natively-multi-agent* single vendor — because that is the baseline the frontier is actively strengthening (agent teams, `codex remote-control`; doc 13 T5). Beating the for-loop proves nothing durable; beating A2 is the whole thesis.

---

## 4. The soloist baseline, made un-sandbaggable

This is the section doc 14 #21(a) says decides everything, so it is specified to the point of leaving no discretion at run time.

1. **Budget parity is total, and the fleet's is honestly summed.** A2 receives a budget equal to the fleet's *summed* spend across all workers and all vendors (§9 pricing). Comparing a 3-worker fleet to a 1×-budget soloist is the classic rig; the eval forbids it by construction. If the fleet spends 3× the tokens, the soloist gets 3× the budget to spend however its native orchestration sees fit.
2. **Same tools.** A2 gets the full capability plane — the identical search/repo-map/debugger the fleet workers use. The *only* thing withheld from A2 is cross-vendor orchestration. Nothing else.
3. **Native multi-agent is allowed and encouraged.** A2 is run in its vendor's strongest supported configuration (subagents, extended thinking, whatever the harness ships). We are steelmanning "one good agent left alone" (doc 14 #22) into "one good *harness* using everything it's got."
4. **Intra-vendor best-of-N is allowed (A1) and folded into A2 where the harness supports it.** The cheap sampling lift (doc 13 T6) belongs to the baseline, not smuggled as a fleet-only advantage.
5. **The soloist is briefed as well as the fleet workers.** Same task card (spec/communication-channel §3), authored in the vendor's own brief dialect via the `gpt-5-4-prompting`-class translation, so brief quality is not a confound (doc 14 #9: harness souls differ; brief *around* the drift, don't sandbag by under-briefing one side).
6. **Prompt/config for A2 is frozen in the pre-registration and reviewed by a party who wants the baseline to win** (§10). The person building baton does not get to quietly write a mediocre baseline prompt.

The test: if a skeptic who *wants the soloist to win* signs off that A2 is the strongest single-vendor config they can construct under `E`, the baseline is honest. That sign-off is a gate (§10), not a courtesy.

---

## 5. Task corpus

### 5.1 Provenance & the gradeability bias, stated up front

The corpus is drawn from three frames, and its bias is disclosed rather than hidden:

- **SWE-bench Verified** (500 human-validated instances) — the standard, with per-task Docker oracle images. **Known-contaminated**: these repos/issues predate model cutoffs and appear in training data.
- **SWE-bench-Live / fresh slice** — issues+PRs created **after the training cutoff of every model in every arm** (LiveCodeBench's contamination-free discipline, applied to agentic tasks). This is the *load-bearing* slice: if the fleet's advantage appears only on contaminated tasks, it is memorization, not orchestration.
- **A private real-repo slice** — tasks mined from the user's own recent merged PRs (post-cutoff), graded by the PR's own test delta. Highest external validity, lowest contamination, smallest N.

**Disclosed bias:** every gradeable corpus over-samples tasks with crisp automated oracles (bug-fixes, well-tested features) and under-samples baton's *claimed* sweet spot — long-horizon, judgment-heavy, weakly-specified work (METR's time-horizon framing). This may **undersell** the fleet. It also over-samples decomposable multi-file work, which may **oversell** it (doc 14 #21(b)). We cannot fully resolve this; we *stratify* to bound it (§5.2) and *report per-stratum* so a headline can never hide a stratum-specific effect.

### 5.2 Stratification (the anti-cherry-pick mechanism)

Cherry-picking toward "parallelizable work the fleet is structurally good at" (doc 14 #21(b)) is defeated by **pre-registered stratified sampling** across two axes, with quotas fixed before selection:

- **Structure axis** (the one that matters for the fleet's structural advantage): `atomic-single-file` · `multi-file-localized` · `cross-cutting` · `refactor` · `debug-heavy`. **`atomic-single-file` is quota-guaranteed** — it is precisely the stratum where a soloist *should* win, and its inclusion is what makes the corpus honest. A corpus without it is rigged pro-fleet.
- **Difficulty axis**: calibrated by A1's pass-rate on the calibration split — `easy` (A1 > 70%), `medium`, `hard` (A1 < 25%). Quota-balanced so the result isn't an artifact of one difficulty band.

Selection within each cell is **uniform-random from the sampling frame with a fixed seed**, committed in the pre-registration. No task is hand-picked. The task-class taxonomy is the same one `RouteStat`/`bok_route` key on (doc 11) and is **human/brief-declared, not auto-clustered** — doc 11 flags auto-clustering as "the single most likely thing to make the module quietly wrong," and the same hazard applies to eval strata.

### 5.3 Sizing & statistical power

- **Powered eval (M3 publication):** paired binary outcomes → analysis by McNemar's test on discordant pairs (§7). For a pre-registered target effect of **Δ = +10 pp** with realistic discordance, 80% power at α=0.05 (one-sided) needs **N ≈ 200–300** tasks, distributed across strata to keep per-stratum CIs interpretable. This is the "low hundreds" the asymmetry in §0 refers to.
- **MVP eval (M1 exit gate, doc 07):** **N ≈ 20** stratified. This yields a resolved-rate CI half-width of roughly **±20 pp** — far too wide to *confirm* a +10pp lift, wide enough to *fire the HALT rule* if the fleet is clearly behind. Reported with its CI, explicitly labeled directional. This is the honest reading of doc 07's "~10 tasks": a kill-switch, not a coronation.

### 5.4 Splits

Three disjoint splits, frozen before any confirmatory run: **calibration** (picks A2's per-class champion, calibrates difficulty; never scored in the headline), **development** (for debugging the harness, tuning digests — touching it burns it, so it's separate), and **confirmatory** (scored exactly once, under the frozen plan). Touching the confirmatory split before the plan is locked voids the result.

---

## 6. The metric & the pre-registered decision rule

### 6.1 Primary metric

**Cost-adjusted paired resolved-rate difference** `Δ = resolved@usd(B3) − resolved@usd(A2)` at the pre-registered budget `b*`, both arms grABI the sealed grader. Cost is the honest sum of all vendor API charges at published rates (§9), *not* subscription flat-rate (which doesn't meter and would let the fleet hide its true cost).

We do **not** report raw pass-rate as the headline: raw pass-rate favors the fleet's N attempts (doc 14 #21(d)) and would be a rig. We report the **Pareto frontier** over (resolved-rate, USD) and (resolved-rate, wall-clock at real ceilings), with A2 and B1/B2/B3 plotted. Baton "wins" only if a fleet arm is **on the frontier that A2 does not dominate**.

### 6.2 The pre-registered decision rule (frozen before the run)

```
DECIDE(results):
  # HALT — doc 07 M1's pre-committed pivot, made precise. Fires even on the cheap MVP.
  if resolved@usd(B3) ≤ resolved@usd(A2)  AND  wall(B3) > 1.5 × wall(A2):
      return HALT("coordination tax exceeds value; H0 not rejected")   # doc 14 #22 confirmed

  # GO — only the POWERED eval may issue this.
  if powered AND Δ = resolved@usd(B3) − resolved@usd(A2) > δ*         # δ* pre-registered, e.g. +8pp
             AND McNemar_one_sided(B3, A2) p < 0.05
             AND usd(B3) ≤ usd(A2):                                   # at matched-or-lower cost
      return GO("build above the control/verification plane")

  # PIVOT-TO-REFEREE — the most likely real outcome, named in advance (doc 13 reframe, measured).
  if lift_significant(B1, A2)  AND  NOT lift_significant(B3, A2):
      return REFEREE_ONLY("verification/review is the value; the Conductor is not; "
                          "build the Referee, gate the Conductor on a later eval")

  return INCONCLUSIVE("underpowered or mixed; do not build above control plane; "
                      "expand N or narrow to the strata that lifted")
```

Four named outcomes, all pre-committed: **HALT**, **GO**, **PIVOT-TO-REFEREE**, **INCONCLUSIVE**. There is no free parameter to tune after seeing data. `δ*`, `b*`, the McNemar direction, and the significance threshold are all in the frozen pre-registration (§7.4). This predicate *is* the eval's verdict — the human runs it, they don't re-litigate it.

---

## 7. Statistical design

### 7.1 Paired, per-task

Every arm runs on every confirmatory task, so outcomes are **paired** — dramatically higher power than unpaired rates, and it controls for task difficulty as a nuisance. The confirmatory test is **McNemar** on the discordant pairs (`b` = A2-pass/B3-fail, `c` = A2-fail/B3-pass); the effect estimate is the paired rate difference with a **clustered bootstrap CI** (resample tasks).

### 7.2 Seeds & nondeterminism (reproducibility is a prerequisite — doc 14 #14)

Each (task, arm) is run **K = 3 (MVP) / 5 (powered)** times with captured seeds. We report two quantities, because they answer different questions:

- **resolved@1** (mean over seeds) — expected single-shot performance;
- **resolved^K** (all-K-pass) — *reliability*, which is what a user of an autonomous fleet actually cares about (a fleet that resolves 60% of the time but only 20% *reliably* is a different product).

Variance is decomposed with a mixed model: task (random), seed-within-task-arm (random), arm (fixed). This separates "the fleet is better" from "the fleet is noisier."

### 7.3 Multiple comparisons

Many arms × strata × ablations = a garden of forking paths, the classic route to a cherry-picked headline. Defense: **exactly one confirmatory test** (B3 vs A2 on the full confirmatory split). Every other comparison — ablations (§8), per-stratum, per-vendor, wall-clock frontier — is **exploratory**, reported with **Holm–Bonferroni** correction and labeled as such. The eval cannot be salami-sliced into significance.

### 7.4 Pre-registration (the anti-rig keystone)

Before the confirmatory split is touched, a signed, timestamped, git-committed `preregistration.yaml` freezes everything:

```yaml
corpus:      { frame_hashes: {...}, strata_quotas: {...}, sampling_seed: 0xBA70N }
splits:      { calibration_sha, development_sha, confirmatory_sha }   # disjoint, hashed
arms:        { A2: {vendor_by_class, prompt_hash, config_hash}, B1,B2,B3: {config_hash} }
grader:      { harness_hash, oracle_test_hashes_by_task, container_image_digests }  # §2.3
envelope:    { usd_max: b*, wall_max, in_flight_ceilings_by_vendor }
metric:      primary: "resolved@usd(B3) - resolved@usd(A2) @ b*"
decision:    { delta_star: 0.08, alpha: 0.05, test: mcnemar_one_sided, halt_wall_factor: 1.5 }
seeds:       { K: 5, model_snapshot_ids: {...} }
signoffs:    { baseline_champion: <skeptic>, redteam: <name>, date }   # §10
```

The commit hash of this file is the eval's identity. A result whose plan was edited after the confirmatory split was seen is void. This is standard experimental hygiene (OSF-style pre-registration) applied to an agent eval — the single practice that most protects against the doc 14 #21 rig.

---

## 8. Ablations — one variable each, mapped to the four claims

Each ablation is a **single-variable delta from B3**, run paired on the confirmatory split, reported as exploratory (§7.3). Together they answer "if the fleet wins, *why*, and is the why durable?"

| Ablation arm | Single change from B3 | Measures | Durable-moat reading (doc 14 #23) |
|---|---|---|---|
| **B3∖verify** | I7 hub re-execution off; trust worker self-report | value of independent verification | positive ⇒ the moat; the Referee's engine |
| **B3∖crossvendor** | all workers same vendor | value of *vendor* decorrelation (vs mere orchestration) | ≈0 expected (doc 13 T6). If B3∖crossvendor ≈ B3, the value is orchestration, not cross-vendor — a finding that would *narrow* the product. |
| **B3∖steer** | spawn-and-wait; no mid-flight nudge/interrupt/reroute | value of the Conductor's steering channel | the doc 13 vs doc 15 §0 tension, *decided by data* |
| **B3∖typed** | raw transcripts, no provenance-typed digests | value of context-economy (doc 14 #4/#8) | mostly a cost/token effect |
| **B3∖route** | random vendor assignment vs `RouteStat` | value of learned comparative-advantage routing | the 1×-cost un-vendorable lever (doc 13 T6) |

The verification and routing ablations map to the **durable** column; the steering and cross-vendor-generation ablations test the parts doc 13/14 flag as possibly ephemeral or ≈0. An honest eval *wants* some of these deltas to be zero — a zero on B3∖crossvendor is a confirmation of the corpus's own analysis, not a defeat.

---

## 9. Reproducibility & cost accounting

Doc 14 #14: "build the replay harness before the eval, not after." The eval is a controlled cross-arm run of exactly the `Cairn` RunScorecard machinery (doc 11) — the eval is not a bolt-on, it *is* the scorecard under experimental control, and `RouteStat` falls out of the same data (doc 07 M3: "routing-by-empirics falls out of the same data").

- **Pinned everything:** exact model snapshot IDs, frozen container digests, frozen capability-index revisions, captured seeds, tool-result snapshots (so a re-run doesn't re-hit a mutated filesystem). Every run replays deterministically from the ledger (I3 durable cursors + I1 fenced epochs give this half-for-free).
- **Cost is API-priced, always.** Even when runs execute under subscription auth (doc 07's opt-in mode), cost is *counted* at published per-token API rates, because subscriptions don't meter and a flat-rate run would let the fleet hide N× token spend. This makes `resolved@usd` honest and vendor-neutral.
- **Wall-clock under real ceilings.** The fleet's parallelism advantage is capped by actual concurrency limits (Z.ai Pro ≈ 1 in-flight; doc 07 M2). The eval runs *at* those ceilings; idealizing them away would manufacture a wall-clock win the product can't deliver.

---

## 10. Red-teaming the eval *before* it runs (doc 14 #21's demand, as a gate)

The pre-registration is not final until it clears an adversarial review whose explicit job is to find how *either* arm is being sandbagged or inflated. Two named sign-offs, both blocking:

1. **Baseline-champion sign-off.** A reviewer who *wants A2 to win* certifies A2 is the strongest single-vendor config constructible under `E` (§4). Their incentive is opposite the builder's; their signature is what makes "strong baseline" real rather than asserted.
2. **Eval red-team sign-off** against a fixed checklist: Is any stratum missing that would favor the soloist (esp. `atomic-single-file`)? Can the fleet see or influence the grader? Is budget parity total and honestly summed? Is the metric pre-registered and not raw-pass-rate? Is contamination controlled by a fresh slice? Is there exactly one confirmatory test? Can the decision rule be tuned post-hoc? Each item is signed or the plan doesn't ship.

This is the "put a red team on the eval design before a line of it is written" that doc 14 #21 demands, operationalized as two blocking signatures on the pre-registration commit.

---

## 11. Worked example

**Task** `django__django-14915` (SWE-bench Verified, `multi-file-localized`, difficulty `medium` from calibration). Base image digest and `FAIL_TO_PASS`/`PASS_TO_PASS` sets hashed into the pre-registration. Envelope: `b* = $6.00` total USD, `wall_max = 25 min`, Claude in-flight ≤ 4, Z.ai ≤ 1.

- **A2 (strong baseline):** calibration made Claude-the-harness the champion for `multi-file-localized`. A2 runs Claude Code with native `Task` subagents, full capability plane, $6 budget. Produces `diff_A2`. Grader: fresh sealed container, `git apply diff_A2`, overlay canonical tests → `FAIL_TO_PASS` all pass, `PASS_TO_PASS` all pass → **PASS**. Cost $3.10, wall 9 min.
- **B3 (full fleet):** orchestrator (Claude) decomposes; worker-1 (Codex) implements the model change, worker-2 (Claude) implements the migration, worker-3 (GLM) is rerouted off after a refusal (logged as a `control.*` intervention). Cross-review: Codex reviews Claude's migration diff, flags an off-by-one in the `PASS_TO_PASS`-adjacent path; orchestrator steers worker-2 to fix it (a steering event the B3∖steer arm would not have). Hub I7 re-runs the brief's verification in a fresh sandbox before declaring done. Produces `diff_B3`. Grader: same sealed procedure → **PASS**. Honest summed cost $5.40 (Codex + Claude + GLM tokens at API rates), wall 7 min.
- **Diff-shape tripwires:** neither diff touches oracle paths; neither is test-only. Task is *not* in the 20% audit subset, so no LLM-judge pass.
- **This task's paired cell:** (A2 PASS, B3 PASS) — a *concordant* pair, contributes nothing to McNemar. The signal lives in the discordant pairs across the corpus. On the `atomic-single-file` stratum, several tasks come back (A2 PASS, B3 FAIL) — the fleet's decomposition overhead *lost* on atomic work, exactly the coordination-tax the null predicts (doc 14 #22). The verdict is the *balance* of `b` vs `c` across all strata, run through `DECIDE(...)`.

The steering event on this task is precisely what B3∖steer would lack; whether such events *net* help is the ablation's job, not this anecdote's — one task never decides, the paired corpus does.

---

## 12. MVP vs later

| | **MVP — M1 exit gate** (doc 07 M1) | **Powered — M3 publication** (doc 07 M3) |
|---|---|---|
| N | ~20 stratified | ~200–300 stratified |
| Arms | A2, B1, B3 (+A1 floor) | full ladder + all §8 ablations |
| Corpus | SWE-bench Verified, all strata | + fresh slice + private real-repo slice |
| Seeds K | 3 | 5 |
| Grader | sealed hidden tests + diff tripwires | + blind cross-family judge audit (20%) + human adjudication |
| Verdict power | **HALT / INCONCLUSIVE only** (may kill, may not bless) | **GO / PIVOT-TO-REFEREE / HALT** |
| Cost | days, low $100s | weeks, low $1000s |

The MVP is the cheap kill-switch doc 07 front-loads; the powered eval is the only thing licensed to authorize building above the control/verification plane (doc 13 T4's "one honest number before another line of capability-plane spec"). Both run the *same* frozen-plan machinery; the MVP is a strict subset, so nothing is rebuilt.

---

## 13. Honest limits

1. **We measure products, not models.** "Vendor" and "harness" are entangled (doc 14 #9 — harness souls differ). The eval attributes a difference to Codex-the-harness vs Claude-the-harness, never to GPT-the-model vs Claude-the-model. This is the correct estimand for baton (it orchestrates *products*), but it means the eval cannot separate model quality from harness scaffolding, and a vendor changing its harness invalidates prior numbers.
2. **Gradeability bias cuts both ways and cannot be fully removed.** The corpus over-samples crisply-gradeable, decomposable tasks — possibly overselling the fleet — while under-sampling the long-horizon judgment work baton claims as its real edge — possibly underselling it. Per-stratum reporting bounds it; it does not eliminate it. The METR-style time-horizon regime is out of reach for a single-run automated grader.
3. **The single-run eval cannot measure the durable moat.** The counterexample corpus, cross-run `RouteStat` learning, and accumulated fleet wariness (doc 14 #1, #23) are *longitudinal* assets that compound across runs. A one-shot eval structurally undervalues exactly the parts doc 13/14 call most durable. A later **longitudinal eval** (does the fleet's `RouteStat`/recipe-cache make run K+1 cheaper than run 1?) is a separate, necessary study this design does not cover.
4. **Subscription-cost fuzziness.** API-rate pricing is the honest denominator, but if the deployed product runs on flat-rate subscriptions, the *realized* economics differ from the measured ones. The eval measures marginal-token economics, which is the right unit for a GO decision but not identical to a user's monthly bill.
5. **Concurrency ceilings make the wall-clock result environment-specific.** Under Z.ai Pro ≈ 1 in-flight, the fleet's parallelism edge is throttled; a different plan tier would move the frontier. The eval reports the frontier *at the tested ceilings* and must not be read as vendor-plan-independent.
6. **N in the low hundreds still leaves wide per-stratum CIs.** The confirmatory test is powered for the *aggregate* Δ; per-stratum claims (e.g. "the fleet wins specifically on cross-cutting tasks") are exploratory and under-powered even in the M3 eval. A strong per-stratum claim needs its own targeted, pre-registered follow-up.

*The eval's own north star, matching doc 14's subtractive thesis: the product isn't "orchestrate everything" — it's "know which tasks orchestration helps" (doc 14 #22), and this eval's real output is not a thumbs-up but the first row of that `RouteStat` table. Even a HALT is a result worth its cost: it saves everything above the control plane from being built on sand.*

## RED-TEAM
## Red-team: eval-design

I read the corpus this design cantilevers off (docs 07, 11, 13, 14, 16; spec/communication-channel). The design is genuinely the most rigorous artifact in the repo — and that rigor is exactly what makes its load-bearing cracks dangerous, because they're dressed as pre-registration hygiene. Ranked by severity, strongest honest attack only.

---

### 1. [FATAL] The core estimand is internally contradictory: A2's budget is endogenous, post-hoc, and can't coexist with the pre-registered `b*` — and `resolved@usd` isn't a dial you can set on an agent

The confirmatory number is `Δ = resolved@usd(B3, b*) − resolved@usd(A2, b*)` "at the pre-registered budget `b*`." §7.4 freezes `envelope: { usd_max: b* }` as a fixed constant. But §4.1 says the exact opposite:

> "A2 receives a budget equal to the fleet's *summed* spend across all workers and all vendors… If the fleet spends 3× the tokens, the soloist gets 3× the budget."

These cannot both be true. The fleet's summed spend is **not known until B3 has already run on that task, on that seed** — it's a per-task, per-seed random variable emergent from B3's runtime thrashing. So A2's budget is either (a) a fixed pre-registered `b*` (contradicting §4.1), or (b) a post-hoc quantity read off B3's behavior (contradicting §7.4's frozen envelope and voiding the "pre-registered budget" claim). The single most-repeated word in the design — "pre-registered" — fails at the one place it matters most.

Worse, option (b) is a hidden **pro-fleet rig** inside the section titled "un-sandbaggable." Tying A2's cap to B3's realized spend hands A2 *little* budget on tasks B3 found easy and *much* on tasks B3 thrashed — but an agent doesn't convert a budget *cap* into spend the way the prose imagines. You can't run Claude Code "at exactly $6"; you cap it, and it either finishes under the cap or gets guillotined mid-edit producing a broken diff. So "budget parity" silently means "cap parity," while §6.2's GO rule tests realized spend (`usd(B3) ≤ usd(A2)`), and §6.1 measures rate "at budget `b*`." Three different constructs — fixed cap, realized spend, and rate-at-a-target — are used interchangeably for the one number the entire project gates on. **Failure scenario:** the eval runs, produces a Δ, and a reviewer asks "was A2 capped at b\* or funded to B3's spend?" — and the pre-registration answers both. The number is uninterpretable and every downstream verdict inherits the ambiguity, which is the exact rig doc 14 #21 says "every downstream decision inherits."

---

### 2. [FATAL] The eval's precondition is the thing the eval is supposed to gate — it presupposes a built, identical cross-vendor capability plane

§3, stated as the anti-sandbag rule: every arm runs "the **same capability plane** (search, repo-map, debugger, test-runner — spec/capability-plane §8)… Same tools, same budget, structure is the independent variable."

But doc 13 T4's "one thing" — the single sentence this whole eval exists to honor — is: **"get one honest eval number *before writing another line of capability-plane spec*."** Doc 07 places the capability plane *above* the control plane, "earned by M1's eval." The eval that decides whether to build the capability plane presupposes the capability plane is already built — and not merely built, but **identical across Codex, Claude, and GLM harnesses**, which is precisely doc 07's "months-long, permanently-recurring" cross-vendor conformance tax. The eval's precondition is more expensive and more speculative than the thing it gates. This is circular in the deepest way: you cannot run the gate without first building past it. Either the eval runs *without* a capability plane (then §3's "same tools" parity is a fiction and the comparison is unspecified), or it waits for the plane (then doc 13 T4's discipline is dead and the eval is no longer "cheap enough to kill"). The design never notices it has inverted its own founding constraint.

---

### 3. [SEVERE] It evals yesterday's baton — B3 is an LLM-Conductor, which the corpus's own latest and strongest conclusion (doc 16, "adopt immediately") says to delete

B3 is defined (§3.2) as "the full system: B2 + **mid-flight steering/interrupt/reroute (the Conductor)**," and the flagship ablation B3∖steer measures "the value of the Conductor's steering channel." But doc 16 §5.1 — the corpus's most recent verdict — says:

> "**Adopt Pivot 1 immediately in the design of record:** the orchestrator is a deterministic program; LLMs are workers… This deletes the majority of the corpus's hard problems at a stroke."

Doc 16 §1 Premise C names the LLM-orchestrator "**the load-bearing mistake**" that "manufactures most of the corpus's hard problems." So the eval pre-registers a treatment arm (LLM-Conductor B3) that baton's own design-of-record is in the act of abandoning, and spends a named ablation measuring a steering channel doc 16 argues should be *dissolved, not measured*. There is **no deterministic-orchestrator arm** anywhere in the ladder. The eval will return a verdict on "an LLM CLI agent conducting three opaque vendor harnesses" — the strawman doc 16 §5.5 explicitly contrasts against "a deterministic program that directs model-diverse workers." If the number is bad, you'll have killed a version of baton nobody intends to build; if good, you'll have blessed one. Either way the estimand is misaligned with the product.

---

### 4. [SEVERE] The asymmetry doctrine is inverted by the baseline economics: the cheap "kill-switch" uses the *weakest* baseline, so it is least able to kill

§0 pillar 1: the cheap MVP "may **HALT** the project but may never **bless** it." The intent: a kill-switch should fire conservatively. But §3.1 hands the MVP the *weaker* comparand:

> "The powered eval uses per-vendor-max; the MVP uses the single calibrated champion to save budget."

Single-champion A2 is a *weaker* baseline than per-vendor-max A2 (one fixed vendor vs. the max over all vendors). A weaker baseline flatters the fleet → `resolved(B3) ≤ resolved(A2)` is *less* likely to hold → HALT is *less* likely to fire. So the cheap eval, whose entire licensed job is to kill, is armed with the baseline that makes killing hardest, while the powered eval, the only one licensed to bless, faces the *strongest* baseline that makes blessing hardest. The design has made it hard to GO *and* hard to cheap-HALT — the worst of both. A credible kill-switch must run the *strongest* baseline (a HALT against a weak baseline is worthless; a HALT against the strongest baseline is decisive). This is backwards, and it's backwards in the pro-fleet direction — the rig doc 14 #22 warns of.

Compounding it: the design never computes a **false-HALT rate**. At N≈20 with "±20 pp" CI half-width (§5.3), the HALT predicate keys off a point estimate with a ±20pp swing. "A wide confidence interval is licence to stop" is precisely wrong — a wide CI is licence to do *nothing*, not to make the one irreversible project-ending decision. A false HALT is not "safe because conservative"; it's the maximal error, made on the maximally-noisy data, uncosted.

---

### 5. [SEVERE] The sealed grader's reward-hacking defense doesn't reach the confirmatory metric, and it smuggles in an uncounted human-months bottleneck

§2.2 concedes "Passing `FAIL_TO_PASS` is necessary, not sufficient." The defense: diff tripwires (fine, deterministic) + a blind LLM-judge on a "pre-registered random subset (~20%)" + human adjudication. Two holes:

- **The audit can't correct the 80% it doesn't see.** The judge "can only *demote* a test-passing diff to suspect" on the 20% it audits. The confirmatory Δ is computed over the *full* confirmatory split — so ~80% of the McNemar cells rest on raw test-pass labels, the exact signal §2.2 says is insufficient. If reward-hacking rates differ by arm (a cross-reviewing fleet may hack *less*, or a decomposing fleet churning many files may hack *more* — either is plausible and unmeasured), that differential lands entirely in the un-audited 80% and biases Δ in an unknown direction. The design provides no mechanism to propagate the 20% finding to the 80%, so the headline number is contaminated by exactly the surface §2 is built to seal.

- **Human adjudication is a bottleneck the cost model omits.** §12 budgets the powered eval at "weeks, low $1000s." But N≈300 × K=5 × ~11 arms (ladder + 5 ablations) ≈ 16,500 runs; a 20% semantic-diff audit is ~3,000+ human adjudications of AST deltas. That is human-*months* of expert grading, not "low $1000s," and it re-installs the human-in-the-loop the rest of the corpus works to remove. The eval's own trust spine has a throughput ceiling that caps N far below "low hundreds."

---

### 6. [SEVERE] The decision rule cannot confirm the null in the case that matters most: a "worse but faster" fleet never HALTs

§6.2 HALT fires only on `resolved@usd(B3) ≤ resolved@usd(A2) AND wall(B3) > 1.5 × wall(A2)` — a **conjunction**. Consider the single most likely coordination-tax outcome doc 14 #22 names: the fleet parallelizes, so it's *fast* (`wall(B3) < 1.5×A2`), but decomposition/context-poisoning makes it *worse* (`resolved(B3) < resolved(A2)`). This does **not** trigger HALT (wall conjunct fails), does not trigger GO (Δ negative), and PIVOT-TO-REFEREE requires B1 to lift. It falls to INCONCLUSIVE. So a fleet that is genuinely *worse at the job* but merely faster escapes the kill. For a product whose durable core is the **Referee** (doc 13 T5 — correctness, not speed), "worse but faster" is a *failure*, yet the decision rule structurally cannot name it. The eval that claims (§0 pillar 2) it "must be able to confirm H0" has a decision rule that can't confirm H0 in the coordination-tax scenario H0 is *about*. The wall-clock conjunct — meant to steelman parallelism — is the loophole through which a losing fleet survives.

---

### 7. [HIGH] The ablations are non-orthogonal and structurally under-powered, so the eval's most important output — *which* mechanism is the value — is the one it cannot measure

§8 claims each ablation is "a **single-variable** delta from B3." Several are not:

- **B3∖crossvendor** ("all workers same vendor") simultaneously kills decorrelation, *and* strips cross-review of its different-family value (B1's whole mechanism), *and* leaves RouteStat (B3∖route's variable) nothing to route across. That's three mechanisms moving on one row, not one.
- **B3∖steer** ("spawn-and-wait") changes the entire coordination regime, not a knob.

So the "durable-moat reading" column can't be read as advertised — a near-zero on B3∖crossvendor doesn't cleanly "confirm doc 13 T6," it confounds four things. And §7.3 routes every ablation through Holm–Bonferroni as "exploratory," while §13 limit 6 admits "per-stratum claims… are exploratory and **under-powered even in the M3 eval**." The value decomposition (§1.2) — the thing that distinguishes GO from PIVOT-TO-REFEREE, the design's proudest feature — is therefore both confounded *and* under-powered, and will return INCONCLUSIVE on the mechanisms. The eval's genuinely novel output (not thumbs-up/down but *which lever*) is the output it is least able to deliver. The confident four-row table in §1.2 is wishful.

---

### 8. [HIGH] The highest-validity corpus slice is graded by the exact worker-adjacent oracle the trust spine forbids

§5.1's private real-repo slice is "graded by the PR's own test delta" and billed "highest external validity." But §2's entire un-gameable core rests on a **sealed, evaluator-pinned oracle the arm never saw**, and §2.1's provenance gate auto-fails any diff that "touches any path in `T.oracle_paths`." On the private slice these collapse: the oracle *is* the repo's own in-tree test suite — of unknown strength, authored by the same human whose PR you're grading, and which the agent legitimately reads and runs as part of normal work. You cannot both let the agent use the repo's tests and hold those tests as a sealed held-out oracle. So the slice with the best external validity is graded by precisely the "worker-supplied restatement" / in-repo test that doc 13 T5 ("never a worker-supplied restatement") and §2.3 are built to exclude. The design's most-trusted evidence and its trust-spine are mutually exclusive, and the doc doesn't notice.

---

### 9. [HIGH] Contamination control and reproducibility mutually expire — the pinned numbers cannot be replicated

§5.1's load-bearing fresh slice = issues "created **after the training cutoff of every model in every arm**." §9/§7.4 pin "exact model snapshot IDs" for reproducibility. These fight:

- Every vendor snapshot bump moves the cutoff forward, silently **re-contaminating** yesterday's "fresh" tasks. The fresh slice has a shelf life of weeks.
- Vendors **retire** model snapshots. By M3 publication ("weeks" later, §12), the pinned `model_snapshot_ids` may be deprecated or gone. You cannot re-run the confirmatory arm to replicate — the exact subjects no longer exist.

§13 limit 1 admits "a vendor changing its harness invalidates prior numbers," but the sharper problem is that the numbers **expire before they can be independently replicated**, which for a "pre-registration-grade" eval is disqualifying: pre-registration's entire value is replicability against a frozen plan, and the plan freezes artifacts (snapshots) the vendors won't keep frozen.

---

### 10. [MEDIUM] The anti-rig keystone assumes an org that doesn't exist — the "adversarial sign-offs" are governance fiction for a solo, one-box project

§10 makes two "blocking signatures" the anti-rig keystone: a "**baseline-champion** … reviewer who *wants A2 to win*" and an "**eval red-team**." §4's honesty test: "if a skeptic who *wants the soloist to win* signs off…" But doc 16 §2's stated deployment is a solo user "has Claude Code, Codex, and GLM subscriptions and a laptop," and the corpus is "one-box-first." There is no independent adversary in this org. The person building baton, wanting baton to win, plays both the champion and the red-team — the exact conflict §4.6 says to prevent ("The person building baton does not get to quietly write a mediocre baseline prompt"). The signatures are a ritual, not a control. This isn't fatal to the *method*, but it voids the central *claim* that the method is un-riggable: the anti-rig depends on adversarial incentives the solo context cannot supply. The design imports enterprise pre-registration governance into a one-laptop setting and never reconciles the mismatch.

---

### 11. [MEDIUM] The blind cross-family judge is unsourceable at the frontier and its blindness is defeatable by diff shape

§2.2 requires the judge be "a model family present in *no* arm" and "**blind to arm identity**." With arms spanning Claude, Codex/GPT, and GLM — three of the leading families — "no arm" relegates the judge to a *weaker* family (Gemini, Mistral, …) whose judgment on frontier-level diffs is itself the shakiest link in the grade. And blindness is a fiction the eval's own independent variable defeats: a B3 diff carries decomposed multi-file structure, heterogeneous per-vendor commit style, and cross-review artifacts; an A2 diff doesn't. The judge can infer arm from diff morphology, so the "kills pro-fleet bias" claim (explicitly analogized to position/verbosity bias) is undermined by the very structural signal the eval exists to measure. You cannot blind a judge to the treatment when the treatment is *visible in the artifact being judged*.

---

### 12. [MEDIUM] The run itself is infeasible at the stated cost/time, throttled by the concurrency ceilings the design elsewhere treats as sacred

§12: powered eval = "weeks, low $1000s." Count it: N≈300 × K=5 seeds × ~11 arms ≈ 16,500 full multi-vendor coding sessions, each up to $6 and 25 min wall (§11 envelope). §9 insists — correctly — on running "**at** those ceilings," with "Z.ai Pro ≈ 1 in-flight." But that means every GLM-touching arm (B1/B2/B3 and their cross-vendor ablations) serializes through a **single in-flight GLM slot**. Thousands of GLM-involving runs through a 1-concurrency bottleneck is *weeks of pure wall-clock on GLM alone*, before human adjudication (#5). The honest cost is an order of magnitude over "low $1000s" in dollars and over "weeks" in time. The design's own realism about ceilings (a strength) collides with its optimism about eval cost (§0's "cheap enough to kill") — and the MVP's "cheap kill-switch" framing depends on a cost estimate the powered eval's own inputs contradict.

---

### Rhetoric flags (realness, not feasibility)

- **"This is I7's exact shape, one level up"** (§2, §2.3) is invoked four times as if naming the pattern discharges the burden. I7 is trustworthy because *the hub controls the sandbox and a human pins the spec*; the grader borrows SWE-bench's third-party spec and then spends all of §2.2 patching a reward-hacking gap the "exact shape" analogy papers over. The analogy is doing argumentative work the mechanism doesn't earn.

- **The worked example (§11) demonstrates the eval measuring nothing.** The one concrete task is deliberately a concordant `(A2 PASS, B3 PASS)` pair that "contributes nothing to McNemar," and the signal is *asserted* to "live in the discordant pairs across the corpus." The design cannot show a single concrete discordant win without inventing numbers, so it shows a tie and gestures at an aggregate. A worked example that carries zero signal is a tell.

- **"Even a HALT is a result worth its cost"** (§13 close) is honest but is rhetorical cover for the fact that the corpus's own latest bet (doc 16 §5: "I'd bet the number is favorable for a narrow… Referee, and **unfavorable for the four-plane cathedral**") predicts this eval *kills most of baton*. Framing the probable-negative as "the first row of that `RouteStat` table" dresses a likely-death-certificate as a product roadmap. That's not dishonest — but the sunny framing obscures that the design's own priors say the modal outcome is HALT or REFEREE_ONLY, i.e. "don't build the thing this eval is scaffolding for."

---

**Bottom line for the kill-case stream:** The eval is *real* in method (pre-registration, sealed oracle, paired McNemar, ablation matrix — all sound in the abstract) but **mirage in three load-bearing places**: (a) the core estimand is self-contradictory on budget parity (#1) and measures a cost dial agents don't have; (b) its precondition — an identical cross-vendor capability plane — is the very thing it's supposed to gate, so it can't be run cheaply enough to be the kill-switch it claims (#2); and (c) it evals an LLM-Conductor architecture (#3) the corpus's own most recent verdict says to delete. The asymmetry doctrine is inverted by its baseline economics (#4), and the decision rule can't confirm the null in the one scenario (worse-but-faster) that the null is about (#6). Fix #1, #2, #3, #4, #6 on paper before a single task runs, or the number this whole project cantilevers off will be uninterpretable — the exact rig doc 14 #21 says everything downstream inherits.

## BLUE-TEAM & SALVAGE
## Blue-team & salvage: eval-design

I read doc 16 in full and doc 07's M0/M1 (the two the red team weaponizes). Verdict up front: the red team lands real hits, but its two "FATAL" flags are fatal to the *document as written*, not to the eval as a method. Both dissolve under a mechanism the red team missed (#2) or a one-line specification fix that actually strengthens the design (#1). Nothing here is CONCEDE-FATAL. Below, each finding gets a mechanism or a concrete change — no bare concessions.

---

### 1 (FATAL → CONCEDE-and-FIX): budget parity is a real contradiction; the fix is fixed-cap-for-both and it removes the rig

The red team is correct that §4.1 ("A2 gets 3× if the fleet spends 3×") and §7.4 (`envelope: {usd_max: b*}` frozen) cannot both hold, and that "run Claude at exactly $6" confuses a *cap* with *realized spend*. This is a genuine specification defect. But it is a defect of conflation, not of approach, and the honest resolution is the simpler one:

**Fix.** The confirmatory metric fixes one pre-registered USD cap `b*` and one wall cap, applied *identically* to A2 and B3. An arm is run under the cap and produces whatever diff exists when it finishes-or-is-guillotined; that diff is graded. `resolved@usd(A, b)` is therefore not a dial you set on an agent — it is a **function you sample by running arm A under cap b and grading the result**. The confirmatory number samples it at the single pre-registered `b*`.

The "give the soloist the fleet's summed spend" intuition is a legitimate but *different* question — "what if A2 had the fleet's money?" — and it belongs on the **exploratory Pareto frontier** (sweep several caps, plot resolved-rate vs USD for every arm), never in the headline. §6.1 already commits to reporting that frontier; the fix is to move the endogenous-budget idea entirely onto it and delete it from the confirmatory estimand. The GO clause's `usd(B3) ≤ usd(A2)` then becomes coherent: both ran under the same cap `b*`, so realized spend is a tiebreaker within the cap, not a third construct. One cap, both arms, pre-registered — the contradiction is gone and, note, the fixed-cap version is *harder* on the fleet (no budget gift indexed to its own thrashing), so the fix moves in the anti-rig direction.

### 2 (FATAL → DEFEND, with a wording concession): the eval runs on native harness tools that exist before the capability-plane spec — no circularity

The red team's sharpest-sounding attack rests on equating two different referents of "capability plane." Doc 07 M1 — the milestone this eval gates — runs the eval *before* M2, and M2 is where the engineered, cross-vendor-conformant capability plane (spec/capability-plane §8) is built. So the eval demonstrably does **not** presuppose that plane; doc 07 already sequences it earlier.

**The mechanism the red missed:** the tools SWE-bench-class tasks need — edit files, run tests, read the repo — are *native to every harness in every arm* (Claude Code, Codex, and GLM-in-Claude-harness all ship them). "Same tools" at MVP means **the native common denominator**, which requires building nothing. The identical-conformance plane is an M2+ product concern; the eval's parity requirement is satisfied by "each arm uses its harness's built-in edit/test/search," which is true on day zero. Doc 16 Pivot 3 ("a few hundred lines, run on the user's real tasks") is explicit that this is buildable *now*, which is only possible because it rides native tooling.

**Concession:** §3's citation of "spec/capability-plane §8" and "same capability plane" invited exactly this misreading. Fix the wording: the eval requires *native-harness tool parity on the task-necessary subset*, pins each arm's tool inventory in the pre-registration, and forbids adding any baton-built tool to either side. Circularity dissolved; the "FATAL" is fatal to a sentence, not to the eval.

### 3 (SEVERE → CONCEDE-and-FIX): adopt Pivot 1 — the orchestrator is a deterministic program in *every* fleet arm; "steering" is program-issued

This is the red team's best structural hit and it is right: doc 16 §5.1 says adopt the deterministic-program orchestrator immediately, and B3-as-LLM-Conductor evals a version doc 16 calls "the load-bearing mistake." But the fix is not to add a fourth arm — it is to recognize the LLM-Conductor was **never the treatment worth testing**, and remove it from *all* arms.

**Fix.** In B1/B2/B3 the orchestrator is the deterministic supervisor (docs 09/13 — which doc 16 §5.1 notes *already is* a program). "Steering" in B3 is redefined as **program-issued intervention on deterministic triggers** — stall detection, budget tripwire, a cross-review flag routing a diff back — with an LLM invoked only for the narrow adjudication the program can't make ("these two diffs diverge; which resolves the issue?"). The B3∖steer ablation is unchanged in *purpose* (does mid-flight intervention beat spawn-and-wait?) but now measures *deterministic* steering, which is the thing baton would actually ship. There is no LLM-Conductor arm because there is no LLM-Conductor product. This aligns the estimand with doc 16 §5.5's "deterministic program that directs model-diverse workers" and, as a bonus, makes every arm reproducible (a program replays; an LLM-orchestrator's context does not).

### 4 (SEVERE → CONCEDE-and-FIX): the kill-switch must run the *strongest* baseline; HALT must be CI-guarded

Conceded fully — the asymmetry was inverted and in the pro-fleet direction. Two fixes:

- **Strong baseline for the killer.** The MVP runs A2 as **per-vendor-max**, not the single calibrated champion. At MVP N≈20 across 2–3 vendors this is ~40–60 baseline runs — affordable, and it is the only baseline against which a HALT is decisive. "Save budget with the weaker baseline" was a false economy; the kill-switch's entire value is that its HALT is trustworthy.
- **CI-guarded HALT.** HALT fires only when the fleet is behind by a margin the noise can't explain — i.e. the **upper bound** of the bootstrap CI on `Δ` is still ≤ 0 — not on a point estimate with ±20pp swing. This makes a false HALT structurally hard: a wide CI now yields INCONCLUSIVE (do nothing more, expand N), never HALT. The red team's "a wide CI is licence to do nothing, not to end the project" is correct and this operationalizes it.

### 5 (SEVERE → DEFEND-partial + FIX): tripwires cover 100%, and the audit targets only the cells that move the number

Two mechanisms the red missed shrink this from a contaminated-headline problem to a bounded, cheap one:

- **The deterministic diff-shape tripwires run on 100% of runs, not 20%** (§2.2 already computes them hub-side). So the un-audited majority is not "raw test-pass" — it is test-pass *and* tripwire-clean. The residual is reward-hacking that passes hidden tests *and* evades every deterministic tripwire — a much smaller class.
- **The audit belongs on discordant pairs, not a blanket 20%.** Only discordant McNemar cells (A2-pass/B3-fail and vice-versa) move `Δ`; concordant pairs contribute nothing. So concentrate LLM-judge + human adjudication on **discordant + tripwire-flagged** diffs, a small fraction of N. The 20%-of-everything number was the source of the "human-months" objection; targeting discordant cells cuts it by ~an order of magnitude.
- **What the audit actually estimates is the *differential* hack rate.** In a paired difference, hacking that occurs equally in both arms cancels. So the audit's job is not to clean 100% of labels — it is to test whether per-arm hack rates differ. Pre-register: if the audited per-arm rates are statistically indistinguishable, `Δ` is unbiased and no correction is needed; if they differ, apply a pre-registered bias adjustment and expand the audit on discordant cells only.

**Concession:** §12's "low $1000s / weeks" ignored adjudication throughput and §2.2's "20% random subset" was the wrong target. Fixed by tripwires-on-100% + discordant-targeted audit + differential-rate framing.

### 6 (SEVERE → CONCEDE-and-FIX): drop the wall-clock conjunct; correctness-behind = HALT, full stop

Conceded — the conjunction is a loophole through which a "worse but faster" fleet escapes the kill, and for a Referee-first product (correctness is the moat, doc 13 T5) that is the *primary* failure to catch. Fix: HALT fires on `upper-CI(Δ) ≤ 0` at matched cost `b*`, **regardless of wall-clock**. Speed moves to the exploratory Pareto axis where it can *earn* a narrow "faster-at-equal-quality" note but can never *shield* a quality loss. This makes the null genuinely confirmable in the exact scenario doc 14 #22 is about.

### 7 (HIGH → CONCEDE-partial): the GO-vs-REFEREE branch survives on three arms; the four-mechanism decomposition is honestly demoted

Conceded that B3∖crossvendor moves three things at once and that §1.2's confident four-row table overclaims clean attribution. But the load-bearing branch does not depend on the full matrix. The decision the eval *must* make — GO vs PIVOT-TO-REFEREE — is a **three-arm comparison**: A2 (baseline), B1 (Referee-only), B3 (full). "B1 lifts over A2 but B3 does not lift over B1" is directly readable from those three arms and is adequately powered at N in the low hundreds. Fix: relabel §1.2 as "directional priors for targeted follow-up," run the *confirmatory* eval on three arms only, and treat the mechanism ablations as a separate, explicitly under-powered exploratory study (a proper 2×2 factorial on verify×crossvendor where run budget allows, rather than one-at-a-time deltas). The eval's genuinely novel output — *which lever* — is delivered at the coarse GO/REFEREE grain it can support, and the fine-grained decomposition is named as a future powered study, not promised now.

### 8 (HIGH → CONCEDE-and-FIX): seal the private slice with the PR's held-out test delta

Clean concession and a clean fix, both SWE-bench-shaped. On the private real-repo slice, the sealed oracle is the **tests the human's PR *added*** (its FAIL_TO_PASS delta), and the agent works from the *pre-PR* tree and never sees those added tests — they live in `oracle_paths`, withheld from checkout and overlaid only at grade time. The repo's *pre-existing* tests become PASS_TO_PASS regression guards, which the agent may legitimately read and run because they are not the resolution oracle. This is exactly the SWE-bench construction; §5.1's "graded by the PR's own test delta" was underspecified and invited the collapse. Tasks whose PR added no tests are simply ineligible for the sealed slice.

### 9 (HIGH → DEFEND-partial): the reproducible object is the graded ledger + decision, which is the correct reproducibility target for model-dependent science

The tension is real but it is a property of *every* frontier-model eval, and the design already flags it (§13 limit 1). The defense is to be precise about what "reproducible" means for a model-dependent instrument: the pre-registration pins the **plan and the artifacts** — every arm's diffs, transcripts, the sealed grader, and `DECIDE()`. Anyone can re-grade the exact diffs against the frozen oracle and re-run the decision predicate deterministically; *that* is the reproducible object. Model-level re-execution is best-effort and cannot be otherwise for any eval that touches a hosted model. **Concession:** §9's "pinned snapshot IDs give reproducibility" overstated it; the honest claim is "the graded ledger and the verdict are reproducible; the model call is timestamped, not eternal." The fresh slice's shelf-life is then a *feature* — the eval is a decision with a date, cheaply re-run (it is the MVP) when snapshots move. Not fatal, and not unique to baton.

### 10 (MEDIUM → DEFEND-with-fix): the adversary is a cross-vendor agent and a public commit, not an org chart

The mechanism the red missed is baton-native: **use a rival vendor's agent to build and defend the opposing baseline.** Codex constructs and steelmans the strongest Claude-soloist A2 prompt; Claude does the same for a Codex baseline. Cross-agent adversarial baseline construction supplies the opposed incentive without a second human, and it is *exactly* the model-diversity baton exists to exploit. Second mechanism: the git-committed `preregistration.yaml` with the frozen A2 prompt is a **public adversarial surface** — any skeptic can inspect and challenge the baseline post-hoc; the artifact is the red team, standing. **Concession:** §10/§4.6's "two named human signatures" is enterprise cosplay for a one-laptop user; replace with cross-agent baseline construction + published pre-registration. The real anti-rig was never the signature — it is the *structure* (fixed cap, sealed oracle, pre-registered rule, published diffs), all of which work solo.

### 11 (MEDIUM → DEFEND): a demote-only, morphology-normalized judge can inflate audit volume but cannot flip a label

Two mechanisms bound the damage. (a) The judge's job is **narrow and demote-only** — flag hardcoding/test-narrowing, a far easier task than judging solution quality, well within a mid-tier (non-frontier) model's reach; and every disagreement is **human-adjudicated**, so the judge is a triage filter, not the grade. A weak judge therefore cannot corrupt a label; it can only route more diffs to the human. (b) Blind the judge by **normalizing the diff first** — present the single unified diff against the canonical base, stripped of commit structure, per-vendor style, and cross-review comments — and ask it the *correctness* question, whose answer does not depend on morphology. The residual risk is that a morphology-biased judge sends more B3 diffs to audit; but the human adjudicator grades correctness, not provenance, so the bias inflates audit *cost*, never the confirmatory *label*. The §2.2 analogy to position/verbosity bias survives because those biases flip the automated grade — here the human is the grade.

### 12 (MEDIUM → DEFEND-with-fix): subtract to three confirmatory arms; the decision value dwarfs the run cost

Baton's own principle (subtraction under a moving frontier) is the fix. The confirmatory eval needs **three arms** (A2, B1, B3), not eleven — the ablations are exploratory and run at reduced N/K or are deferred (finding #7). Recount: MVP = 20 tasks × K=3 × 3 arms ≈ 180 runs; powered ≈ 250 × K=5 × 3 ≈ 3,750 runs, with GLM in a subset. The GLM 1-in-flight ceiling throttles the *wall-clock* of GLM-touching runs, but the eval is a **batch job, not a latency-sensitive service** — it runs overnight/over-days in the background; serialization costs calendar time, not correctness. **Concession:** §12's "low $1000s" was rosy; it may be low five figures once adjudication (finding #5) is counted. But the decision this buys — whether to build months of the four-plane cathedral — dwarfs that by orders of magnitude, which is the actual economic argument doc 16 §5 makes. And if GLM's concurrency makes it impractical at N, *that is itself a finding* about cross-vendor feasibility that feeds the routing table — a result, not a blocker.

---

### SALVAGE — the strongest version that survives the attack

A **three-arm, fixed-cap, deterministic-orchestrator** eval:

1. **Deterministic orchestrator in every fleet arm** (Pivot 1). No LLM-Conductor exists to test. "Steering" = program-issued intervention on deterministic triggers, with LLM calls only for narrow adjudication. Every arm replays from its ledger.
2. **One pre-registered budget cap `b*`, applied identically to both arms.** `resolved@usd` is a function sampled at `b*`, not a dial. The "give the soloist the fleet's money" question lives only on the exploratory Pareto frontier.
3. **Three confirmatory arms:** A2 (**per-vendor-max**, cross-agent-constructed, the strong baseline), B1 (Referee-only), B3 (full deterministic fleet). GO/HALT/PIVOT-TO-REFEREE is decidable from these three. Ablations are demoted to a separate, explicitly under-powered exploratory study.
4. **Decision rule:** HALT if `upper-CI(Δ) ≤ 0` at cost `b*`, regardless of wall-clock (correctness-behind = kill). GO only if powered *and* CI-clear *and* matched cost. Wide CI → INCONCLUSIVE, never HALT. PIVOT-TO-REFEREE if B1 lifts and B3 does not.
5. **Sealed oracle everywhere, including the private slice** (held-out PR test delta). Deterministic tripwires on 100%; LLM-judge + human adjudication concentrated on **discordant + flagged** cells; the audit estimates the *differential* hack rate, not 100% of labels.
6. **Anti-rig is structural**, not signatorial: fixed cap, sealed I7-lifted oracle, pre-registered rule, cross-agent baseline construction, published `preregistration.yaml`. Reproducibility = the graded ledger + decision, re-runnable even after snapshots retire.
7. **Tool parity = native-harness common denominator.** Runs before any capability-plane spec is written — which is what makes it the cheap kill-switch doc 16 Pivot 3 promises.

This survives because every red hit was either a wording defect (#1, #2, #8), a fix that moves anti-rig (#4, #6), or an over-count fixed by subtraction (#7, #12) — and the moves that fix them are the *same* moves doc 16 already demands (deterministic orchestrator, measure-first, three arms not eleven). The attack, honestly absorbed, converges the eval *onto* the corpus's latest verdict rather than away from it.

### INTEGRATE — planes, invariants, and the one thing to build first

**Invariants.** The sealed grader is **I7 lifted one level and it holds under the attack**: re-execute in a hub-controlled sandbox the subject cannot touch, grade against an oracle the *evaluator* pins (SWE-bench FAIL_TO_PASS / PASS_TO_PASS, or the held-out PR delta on the private slice), treat self-reported exit codes as non-authoritative. I1 fenced epochs + I3 durable cursors give deterministic replay of each (task, arm, seed) run "half for free," which is now *load-bearing* since finding #3 made every arm a deterministic program. I6 two-phase stop is what enforces the `b*` cap cleanly (drain-then-grade, not guillotine-mid-write where avoidable).

**Planes.** The eval *is* the `Cairn` RunScorecard machinery under experimental control — not a bolt-on — and the confirmatory `Δ` plus the per-stratum A2/B1/B3 table **is the first row of the `RouteStat` routing table** (doc 07 M3: "routing-by-empirics falls out of the same data"). It sits at doc 07's M1 exit gate and gates everything above the control/verification plane. It does **not** presuppose the capability plane (finding #2): it rides native harness tools and is therefore runnable before M2.

**Build first — the single thing:** the **sealed-oracle grader as a standalone hub component** (I7-lifted): fresh network-none container, canonical-base checkout, `git apply` the arm's diff, overlay held-out oracle tests, authoritative container exit, plus the 100%-coverage deterministic diff-shape tripwires. Build it before any arm runner, because (a) without it no number is trustworthy, so it is the true root of the dependency graph; (b) it is identical across MVP and powered tiers and across all three arms, so it is built once; and (c) it is the concrete, few-hundred-line core doc 16 Pivot 3 says is the honest next deliverable. The fixed-`b*` arm runner and the three-arm MVP (A2-strong, B1, B3-deterministic on ~20 SWE-bench Verified tasks, HALT-only power) are the immediate next layer around it — but the grader is the keystone that makes every downstream number mean anything.
