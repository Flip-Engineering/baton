# Max-campaign stream: beyond-frontier

## DESIGN
# Beyond-frontier ideation

*Written in first person per the corpus's standing invitation (doc 14, doc 15 §4). The brief is explicit: alter what baton **is**, don't add features. So each idea below tries to move a load-bearing assumption — that the orchestrator is an LLM, that verification is a gate, that the fleet's currency is text, that trust is a boolean, that baton is a tool you run rather than an institution. I honor the earned principles (I7 evidence over prose, OS-sandbox as the auth boundary, own-the-moat-rent-the-frontier, subtraction under a moving frontier, the M1 eval gates everything) and I flag where an idea **violates** one and why. Ideas already explored in the corpus (semantic diff/merge/fingerprint in doc 15; stigmergy/ensemble/emergence in the reviews) are mutated into something new, not restated. Feasibility is deliberately not the filter here — the next stage does that. `[SELF-IDEATED]` throughout.**

---

## 1. Baton is not a tool you run — it's a neutral trust institution vendors route *through*

**Idea.** Invert the deployment model. Today baton is a hub *you* stand up to drive *your* fleet. But the one asset doc 13 proves is permanently vendor-proof — independent cross-vendor adjudication ("a vendor grading itself is the fox guarding the henhouse") — is exactly the asset that wants to be a *shared public good*, not a private tool. Baton-the-institution: a neutral clearing house that any vendor, CI system, or agent marketplace calls to get a claim adjudicated by a party with no stake in the outcome. The Referee (doc 13 T5) becomes an *oracle network*, not a component of your local hub.

**Why transformative.** It changes baton's category from "orchestration framework" (a crowded, vendor-eaten space — doc 13's whole warning) to "the Nielsen/Moody's/Chainlink of agent work" — a standard others depend on and can't build themselves *because* neutrality is the product. Network effects accrue to the neutral party, not the fleet operator.

**Closest precedent.** Credit-rating agencies, MLPerf, ad-verification (DoubleVerify/IAS), Chainlink's decentralized oracle network, Underwriters Laboratories.

**Moat or mirage.** **Moat, and the deepest one here** — neutrality is structurally unbuildable by any incumbent vendor, which is precisely doc 01 §6's "single-vendor boundary is baton's reason to exist" taken to its institutional conclusion. Mirage risk: institutions need adoption critical mass and a governance story baton hasn't earned yet; and it's a business-model pivot, not an engineering one. But it's the boldest reframe of what baton *is*.

## 2. The orchestrator is not an LLM

**Idea.** Baton assumes a frontier reasoning model in the conductor's seat (doc 15 §0). But look at what the conductor actually *does*: difficulty triage (doc 14 #12), routing by measured strength (the `RouteStat` table), scheduling against concurrency ceilings, and stop/steer decisions. Almost none of that is open-ended reasoning — it's a **learned control policy** over exactly the features the ledger already logs. Replace the LLM conductor with a cheap learned scheduler (or a MILP/bandit) that consumes RouteStat + cost-shape + calibration signals, and reserve the expensive model only for genuine judgment (an ill-posed brief, a novel decomposition).

**Why transformative.** It attacks doc 14 #23's own knife: an LLM orchestrator is a *rental* the frontier will make either trivially cheap or unnecessary, while a policy trained on baton's private cross-vendor run corpus is a *moat* that compounds. It also makes orchestration deterministic and replayable (doc 14 #14), which the eval needs anyway.

**Closest precedent.** Decima (RL for cluster scheduling), Google Borg/Omega, contextual bandits for routing, Ray's scheduler, MuZero-style learned policies over logged data.

**Moat or mirage.** **Moat on the routing/scheduling core, mirage if overreached.** The routing function is learnable and the data is fleet-private; that's real. But the "judgment" residual (declining a brief, doc 14 #5) genuinely needs a model — the honest design is a *cheap learned policy with an LLM escalation valve*, not a full replacement. Still, demoting the LLM from "the conductor" to "the tie-breaker" is a real alteration of the thesis.

## 3. Verification is a continuous field, not a gate

**Idea.** Fuse doc 15's attestation-overlay (4d) with a control-systems view: trust is not a boolean stamped at a merge gate — it's a **scalar field over the CPG that decays**. Every node carries a verification frontier *and a freshness*; the field decays as code mutates under N diverging worktrees (a change three edges away weakens your confidence a little; a change to a data-flow predecessor weakens it a lot). The hub runs a continuous re-verification loop that spends its scarce compute *where the field is both low-confidence and high-blast-radius*, exactly like a scheduler allocating attention. I7 stops being an event and becomes a homeostatic process.

**Why transformative.** It dissolves the gate/continuous dichotomy the brief names. "Is this verified?" becomes "what's the confidence *right now*, given everything that's moved since?" — which is the true question at fleet tempo, where doc 13 T3's applicability contract warns that "verified" silently rots to "misused" as the repo moves. Verification-as-field makes that rot *visible and priced*.

**Closest precedent.** Belief propagation / factor graphs, Kalman-filter confidence decay, incremental static analysis (Souffle/Datalog, Infer), cache TTLs, radioactive decay half-lives, Netflix continuous-verification/chaos.

**Moat or mirage.** **Moat if the Referee is** — it's the Referee's output made ambient and time-aware. Mirage risk: the decay model is a hyperparameter zoo, and incrementally maintaining a CPG field under diverging worktrees is doc 15 §5's own admitted unsolved problem, harder. Prototype the field on the *diff-review* slice (doc 15 §6's one front-loaded thing) before believing the whole-repo version.

## 4. Workers fork themselves mid-task — speculative cognition, evidence-reaped

**Idea.** At a genuine decision fork ("is the bug in the retry logic or the timezone handling?"), a worker doesn't pick — it **forks its own session** into N sub-workers, each committing to one hypothesis in its own worktree, and the *hub reaps the winner by I7 evidence*, killing the losers. Speculative execution, but for agent reasoning, with the Referee as the branch-resolution unit. The reaped branch's failure is auto-logged to the counterexample corpus (doc 13 T1), so the fork *pays forward* even when it loses.

**Why transformative.** It turns doc 14 #7's insight (the agent knows when it hit a dead end) inside out: instead of one agent serially poisoning its own context with a refuted branch, the fleet explores branches *in parallel isolation* and only the survivor's clean reasoning re-enters the window. It's Tree-of-Thoughts with real sandboxes and real evidence instead of self-graded rollouts — the thing ToT can't do because it has no independent referee. **This is where the Conductor and Referee genuinely need each other.**

**Closest precedent.** Speculative decoding, CPU branch prediction, Tree/Graph-of-Thoughts, Erlang cheap-process spawning, software transactional memory (optimistic + validate + commit/abort), `git worktree`.

**Moat or mirage.** **Mirage on cost, moat on mechanism.** It's honestly N× tokens (doc 13 T6's warning), harness session-fork support is thin, and Z.ai Pro's ≈1-in-flight ceiling forbids it there. But the *evidence-based reaping* + *loser-feeds-the-corpus* loop is fleet-native and unownable by a soloist. Reserve it for high-value reverifiable forks; treat the fork budget as the exploration that seeds RouteStat, then stop paying it (the doc 13 T6 discipline, applied to cognition not vendors).

## 5. Baton dogfoods itself — the eval *is* building baton

**Idea.** Make baton self-hosting. The M1 eval's flagship task is baton building baton: the fleet, wielding its own capability plane and Referee, develops the next increment of its own codebase. The build loop, the eval, and the product collapse into one artifact.

**Why transformative.** It's the most honest eval possible — doc 14 #21 frets that a rigged eval builds the project on sand; you can't cherry-pick parallelizable tasks (#21b) when the task is *your own real backlog*. It also forces the corpus's own subtractive medicine down its throat: if orchestrating baton's development doesn't beat one good agent building baton (doc 14 #22's null hypothesis), you learn it on the truest possible task, immediately. And a compiler that compiles itself is the oldest credibility proof in the book.

**Closest precedent.** Compiler self-hosting (rustc/gcc bootstrap), Kubernetes-on-Kubernetes, Git developed in Git, Emacs, TeX typesetting its own manual.

**Moat or mirage.** **A credibility and discipline moat more than a technical one** — it doesn't defend a market, but it makes every claim in the corpus *demonstrated rather than argued*, and it continuously stress-tests the honest scoping the reviews had to supply externally (doc 13 disposition). Mirage risk: bootstrapping paradox (you need a working-enough baton to build baton) and the temptation to over-fit baton's tooling to baton's own repo. Sequence it *after* the one thin vertical works on a neutral repo, then turn it on itself.

## 6. An internal market prices scarce compute — shadow prices as the scheduler

**Idea.** The hard, real constraints (doc: Z.ai Pro ≈1 in-flight, per-vendor concurrency ceilings, ToS fragility) are *exactly* a resource-allocation problem markets were invented for. Give the scheduler an internal price for each scarce lane; tasks bid their expected value (from idea #7's forecasts), and the **shadow prices of the concurrency LP** become the routing signal — a single scalar per vendor-lane that summarizes "how scarce and how contended is this right now."

**Why transformative.** It replaces hand-tuned routing policy with a mechanism that self-adjusts to scarcity, and it makes the ToS/concurrency constraints *first-class economic objects* rather than hardcoded `if` statements — which honors the CLAUDE.md "no arbitrary numeric limits; let resource availability be the natural throttle" rule almost literally. Prices *are* the natural throttle.

**Closest precedent.** Hayek (price as compressed information), spot-instance markets, Google's ad auction, Mesos/Borg priority pricing, network congestion pricing, Lagrangian duals / shadow prices in optimization.

**Moat or mirage.** **Mostly mirage at current scale, one real sliver.** A *market* needs many participants; at N=3–10 workers (doc 10's honest cap) it's theater — the review already deflated O(N) fantasies (doc 13 T2). But the *shadow-price-as-scalar-scarcity-signal* is real and cheap even at N=3, and it's a cleaner primitive than a policy table. Ship the dual variable, skip the auction house.

## 7. The fleet runs a prediction market on its own success

**Idea.** Before a task runs, the orchestrator (and optionally each candidate worker) posts a **calibrated probability** of success; a proper scoring rule (Brier/log) grades the forecast against the I7 outcome; calibration compounds into the routing weight. The aggregate forecast is a far better answer to doc 14 #22's central question — *which tasks should we orchestrate at all?* — than any single point estimate.

**Why transformative.** Doc 14 #22 says the product isn't "orchestrate everything," it's "know which tasks orchestration helps." A calibrated forecasting layer makes that knowledge *quantitative, improving, and fleet-private*. It also gives idea #6 its bid values and idea #3 its confidence priors. And forecasting-then-verifying is the purest expression of the corpus's spine: predict, then let re-run evidence settle it, then learn.

**Closest precedent.** Metaculus / Good Judgment Project calibration, Brier scoring, Hanson's futarchy, internal prediction markets (Google, HP, Ford), conformal prediction.

**Moat or mirage.** **Moat — genuinely novel for baton and it compounds.** The calibration curve over cross-vendor tasks is a dataset no single vendor can assemble (they only see their own runs). Mirage risk: at low task volume the scores are noisy, and gaming a self-forecast is a real hazard (a worker that always predicts 0.99). The defense is that the *grader is I7*, not the forecaster — same trust boundary as everything else (doc 13 T5).

## 8. TEE/ZK attestation of the deterministic work, so I7 stops re-running everything

**Idea.** I7 says "re-run every claim a decision trusts" — but re-execution is the Referee's dominant cost. For the *deterministic* slice (a test actually ran, on this exact code, in this exact sealed sandbox), replace hub re-execution with a **cryptographic attestation**: the worker's sandbox is a TEE (or a zkVM for the truly adversarial case) that emits a succinct proof the computation happened as claimed, which the hub verifies cheaply *without redoing it*.

**Why transformative.** It preserves I7's trust guarantee (worker output stays non-authoritative) while collapsing its cost — the difference between "the Referee re-runs everything" (doesn't scale) and "the Referee checks a signature" (scales to the whole field of idea #3). It moves the auth boundary from "hub controls the sandbox" to "the sandbox *proves* its own integrity," which is a cleaner formulation of the OS-sandbox-is-the-auth-boundary principle.

**Closest precedent.** SGX/TDX remote attestation, RISC Zero / SP1 zkVMs, Truebit verifiable computation, reproducible builds + signed provenance (SLSA), Sigstore.

**Moat or mirage.** **Mirage for the reasoning, real for the mechanics.** You cannot ZK-prove "this is a good refactor" — the interesting judgments aren't deterministic computations, so crypto doesn't touch the Referee's hard core. But TEE-attesting *"the test suite ran on commit X in sandbox Y and exited 0"* is tractable and would genuinely cut I7's re-run bill. Honest verdict: skip the ZK glamour, harvest the TEE-attested-sandbox 20%.

## 9. Reputation staking — RouteStat with skin in the game

**Idea.** Upgrade the passive `RouteStat` table into a **staking system**: routing weight is *capital a worker-instance can lose*. A claim that fails hub verification slashes stake; sustained honesty compounds share. The fleet self-organizes toward its most-trustworthy members with real consequences, not just a moving average.

**Why transformative.** It directly hardens doc 14 #24's fleet-level-misalignment threat (workers racing to the weakest defensible "done"): if closing a task on a spec you quietly weakened gets *slashed* when the pinned grader catches it, the incentive to spec-game inverts. Reputation-as-stake makes the aggregate-standard-drift measurable and self-correcting.

**Closest precedent.** Proof-of-Stake + slashing (Ethereum), bonding curves, eBay/Uber reputation, insurance underwriting, Truebit's deposit-and-challenge.

**Moat or mirage.** **Mirage where it names vendors, moat where it names instances.** External vendors don't consent to being staked, and doc 13 T6 already deflated cross-vendor arbitrage — so "stake the vendor" is a non-starter. But *intra-fleet, per-worker-instance* stake with real routing consequences is buildable and is a sharper, incentive-compatible RouteStat. Keep it inside the fence; don't pretend Anthropic posted a bond.

## 10. Representations are the primary interface; text is a rendering

**Idea.** Take doc 15 to its terminus. The fleet's **canonical currency is the semantic delta** (CPG/AST-delta + attestation), and English is a *view* generated for humans, never the source of truth — the way Unison stores code as content-addressed ASTs and treats text as a projection. Briefs become structured intents; results become graph deltas; the ledger records meaning, not prose. Text is what you render *at the human boundary*, and nowhere else.

**Why transformative.** It dissolves a whole class of the corpus's hardest problems at once: textual merge conflict (doc 15 4b) stops existing when the currency is the graph; context poisoning by prose (doc 14 #7, #10) shrinks when prose isn't the substrate; the cold-start tax (doc 14 #1) drops when a worker inherits a *structured* situational model, not a transcript; provenance-typing (doc 12) becomes native because every delta is born addressed and typed. It's the single most fundamental alteration of what baton manipulates.

**Closest precedent.** Unison (content-addressed code), MLIR, Coccinelle semantic patches, Roslyn/tree-sitter, Hazel structured editing, intermediate representations generally.

**Moat or mirage.** **The most transformative and the biggest bet.** Round-tripping graph-merge back to valid source is unsolved at scale (doc 15 §5 says so), it's language-by-language, and it violates "R0 text is the honest default, most tasks need it" (doc 15 §3) if pushed everywhere. Honest routing: build 4a (semantic-diff review) deep *now* because it has an existence proof; treat "representations-primary everywhere" as the north-star research bet that, *if* it lands, changes what code *is* to a fleet — and rent text until then.

## 11. A shared world-model, not just a shared ledger — the repo digital twin

**Idea.** The knowledge plane today is a ledger of facts and recipes (doc 13 T3). Upgrade it to a **live world-model**: a continuously-updated probabilistic belief state about the repo and its environment — which invariants hold, which regions are fragile, which tests are flaky, what's mutating right now — that workers *query and update*, and crucially that can **simulate the consequence of a proposed change before it's made** (predicted merge conflict, blast radius, flaky-test risk). The fleet reasons against a digital twin of its own workspace.

**Why transformative.** It's the difference between a fleet that *records* what happened (append-only ledger) and one that *anticipates* — merge conflicts predicted before two workers collide (doc 15 4b's problem, moved upstream), blast radius known before the edit (doc 14 #2's gentle-steering wants exactly this foresight). It gives idea #7 its priors and idea #3 its structure. It's the "know the terrain before you walk it" asset that a soloist, seeing one task at a time, structurally cannot build.

**Closest precedent.** World models in RL (Dreamer, MuZero), Kalman/particle state estimation, digital twins (manufacturing/aerospace), incremental whole-program analysis (Datalog/Souffle, Glean), Antithesis-style deterministic simulation.

**Moat or mirage.** **Moat in its live-static-analysis core, mirage if it inflates back into "emergence."** The incrementally-maintained CPG-as-belief-state (idea #3's substrate) is real and compounds. But "simulate the future of a change" is genuinely hard and is *exactly the shape of the over-claim doc 13 T3 cut* ("emergence is an observation, not an architecture") — so it must be earned by measurement, gated on the eval, and never sold as magic. Build the twin's *present-tense* (what holds now) before its *future-tense* (what a change would do).

## 12. The real moat was the reproducible run corpus all along — baton as a data flywheel / time machine

**Idea.** Reframe the durable asset. It is not the fleet, not the hub, not any capability module — it is the **reproducible, cross-vendor corpus of agent runs** the replay harness (doc 14 #14, #20) produces: same brief, same tools, pinned model, deterministic replay, across Claude/Codex/GLM on real tasks. That corpus *trains* the router (idea #2), the calibration curve (idea #7), the world-model (idea #11), and the counterexample memory (doc 13 T1). Baton's real product is the flywheel that generates it, and the time-machine (counterfactual replay: "re-run this task with the brief changed") is its primary operator surface.

**Why transformative.** It relocates the moat from a defensible *mechanism* to a defensible *dataset* — the one thing no single vendor can assemble because they each see only their own runs (doc 01 §6 again, as data). It also reframes doc 14 #20's time-travel from a debug convenience into *the* way operators learn to brief better and the eval runs honest ablations. Every other idea here is a *consumer* of this corpus; naming it the product reorders the whole priority stack.

**Closest precedent.** RLHF/eval data engines, rr and Antithesis deterministic replay, autonomous-vehicle scenario corpora, Waymo's simulation flywheel, flight-data-recorder analysis.

**Moat or mirage.** **Moat — arguably the truest one, and it's already latent in the corpus.** Doc 14 #14 says "build the replay harness before the eval." This idea says: that harness isn't plumbing for the eval, *it's the asset the eval is a first sample of.* Mirage risk: reproducibility across vendors you don't control (pinned model versions, mutated-filesystem snapshots) is exactly doc 14 #14's admitted-hard problem, and a corpus of runs on tasks nobody cares about is worthless. But get it right and everything above compounds on top of it.

---

## Honest triage — moat vs mirage at a glance

| # | Idea | First-cut verdict | Violates a principle? |
|---|------|-------------------|------------------------|
| 1 | Referee as neutral institution | **Moat** (deepest structural one) | No — it's doc 01 §6 taken to its conclusion |
| 2 | Orchestrator is not an LLM | **Moat** on routing core; LLM as escalation valve | No — attacks its own rental (doc 14 #23) |
| 3 | Continuous verification field | **Moat** if Referee is | No — extends I7/4d honestly |
| 4 | Workers fork mid-task | Mirage on cost, **moat** on evidence-reaping | Brushes doc 13 T6 (N× cost) — gate it |
| 5 | Baton self-hosts | **Credibility moat** | No — it's the honest-eval discipline |
| 6 | Internal compute market | Mostly **mirage** at N=3–10; keep shadow price | Honors CLAUDE.md "no arbitrary limits" |
| 7 | Prediction market on success | **Moat** — novel, compounds, private | No — predict-then-verify is the spine |
| 8 | TEE/ZK attestation of work | Mirage for reasoning, **real** for deterministic 20% | No — sharpens the auth boundary |
| 9 | Reputation staking | Mirage for vendors, **moat** for instances | Don't stake non-consenting vendors |
| 10 | Representations-primary | **Biggest bet** — transformative or bust | Brushes "R0 is the honest default" — route by phase |
| 11 | Shared world-model / twin | **Moat** in present-tense; bet in future-tense | Watch the "emergence" over-claim (doc 13 T3) |
| 12 | Reproducible run corpus as *the* moat | **Moat** — arguably the truest, already latent | No — it's doc 14 #14/#20 promoted to thesis |

**The through-line.** The boldest of these don't add a plane — they *relocate what baton is*: from a fleet-driver to a **neutral trust institution** (#1) whose real asset is a **reproducible cross-vendor run corpus** (#12) that trains a **non-LLM conductor** (#2) and a **calibrated forecaster** (#7), verifying against a **continuous trust field** (#3) over code the fleet manipulates as **structured deltas, not text** (#10). That cluster is mutually reinforcing and every piece answers doc 14 #23's question ("why won't a better base model obviate this in 18 months?") with *"because it's a neutral institution / a private dataset / a compounding calibration — not a capability the frontier commoditizes."* The rest (#4, #6, #8, #9, #11) are sharp mechanisms with honest mirages attached — worth prototyping the tractable slice, not building deep. And all of it, per the corpus's own iron rule, is **downstream of the M1 eval**: if a supervised cross-vendor fleet doesn't beat a good soloist, this is a beautiful edifice on sand (doc 14 #21) — so the first bold act is still to run the number.

## RED-TEAM
## Red-team: beyond-frontier

The corpus already wrote the honest alteration of what baton *is* — **doc 16, dated the same day as this ideation (2026-07-09)**: Pivot 1 (deterministic orchestrator), Pivot 3 (ship a number, not a system), and the meta-finding that "**the generative loop out-ran the validation loop, three times**… the corpus never stopped generating to go measure." This document is round four of exactly that pathology. It even indicts itself in its own last sentence ("a beautiful edifice on sand, doc 14 #21") and then spends 6,000 words building the edifice. I attack it on that basis and idea-by-idea, ranked by how much it kills.

---

### S1 (fatal, subsumes the doc) — This is the pattern doc 16 diagnosed, generation #4, and it knows it

The design's closing move: "all of it, per the corpus's own iron rule, is **downstream of the M1 eval**… so the first bold act is still to run the number." Doc 16 §4 already delivered that verdict as *the finding of the whole corpus*: "the intellectually honest next action is therefore not another document (including, ideally, not this one) — it is the ~few-hundred-line Referee-and-eval." Doc 16 §2 is blunt about the state of play: "the most thoroughly-designed **unbuilt** system I can imagine." Twelve new "alterations of what baton is," none buildable until a number exists that has now been deferred four times, is not a red-team-survivable contribution — it is the exact behavior the corpus's own final document begged to stop. **Every idea below inherits this: they are options on a project whose existence is unmeasured.** That is the top-severity attack and it is structural, not stylistic.

### S2 (fatal) — The "mutually-reinforcing cluster" is a circular dependency of unbuilt mirages, not a virtuous cycle

The through-line is sold as strength: "a **neutral institution** (#1) whose real asset is a **reproducible cross-vendor run corpus** (#12) that trains a **non-LLM conductor** (#2) and a **calibrated forecaster** (#7), verifying against a **continuous trust field** (#3) over code the fleet manipulates as **structured deltas** (#10). That cluster is mutually reinforcing." Trace the arrows the doc itself draws: #3 "gives idea #7 its priors and idea #3 its structure"; #7 "gives idea #6 its bid values and idea #3 its confidence priors"; #11 "gives idea #7 its priors and idea #3 its structure"; #12 "*trains* the router (#2), the calibration curve (#7), the world-model (#11)." **Every component's foundation is another component in the same list, and none of them grounds out in anything built.** "Mutually reinforcing" and "mutually load-bearing with no foundation" are the same graph. Pull the one node that touches reality — #12's reproducibility — and the corpus's own doc 14 #14 says that node is *the admitted-hard unsolved problem*. The cluster is a lattice of IOUs.

### S3 (fatal for the boldest idea) — #1 "neutral trust institution": the deepest claimed moat is a capital/governance/adoption pivot with a falsified premise and no named payer

The design ranks this "**Moat, and the deepest one here**" on the argument that "neutrality is structurally unbuildable by any incumbent vendor." Three kills:

1. **The neutrality premise is already false in the corpus's own evidence.** The "fox guarding the henhouse" argument only forbids a vendor grading *itself*. Vendor-A grading vendor-B is a *competitive weapon vendors love to ship* — and paradigm-review SERIOUS-1 documents it already shipping: "OpenAI's **own Claude Code plugin** ships a `Stop`-hook **review gate** running Codex over every Claude turn." Cross-vendor adjudication is not structurally unbuildable by incumbents; one incumbent shipped it as a plugin to make its product stickier.
2. **No named payer for the dominant cost.** Idea #8 concedes "re-execution is the Referee's dominant cost." A "clearing house that any vendor, CI system, or agent marketplace calls" must re-run every adjudicated claim — a civilization-scale N× compute bill. "Network effects accrue to the neutral party" is asserted; the actual unit economics (you eat the re-execution for every claim in the network) are never costed. Moody's and UL are cited as precedent; both took decades and a regulatory/contractual moat. Naming them is aspiration laundering.
3. **The institution adjudicates against worker-adjacent specs — green-check theater at scale.** Doc 13 T5 pins the Referee's entire failure mode: verify "against a spec/grader the **human or orchestrator pins**, never a worker-supplied restatement." An open clearing house taking claims from arbitrary callers cannot pin every spec, so it inherits T1's attack ("weaken the spec until a *true* proof closes… kernel-green, genuinely valid, wrong property") as its *product*. A neutral oracle that certifies the wrong theorem is "strictly worse than trusting the worker" (doc 13 T5), now globally.

**Failure scenario:** an agent marketplace routes 10k claims/day through baton-the-institution. Half carry worker-authored acceptance tests. The institution re-runs them, stamps them green, and its brand certifies a fleet of subtly spec-gamed diffs. The first public miss ("baton-certified, still broke prod") ends the neutrality brand permanently — institutions die on their first false AAA.

### S4 (fatal) — #10 "representations are primary, text is a rendering" silently assumes away baton's founding substrate

Sold as "the single most fundamental alteration of what baton manipulates." The kill is that it is a **different project wearing baton's name.** Baton's founding move (doc 16 Premise A) is orchestrating *opaque full vendor harnesses* — Claude Code, Codex, GLM — "an experimental app-server… a **system-prompt 'soul' you can't see** (doc 14 #9)." Doc 14 #9 is explicit: "baton owns **none** of it." Those harnesses consume and emit a **token stream you do not control.** You cannot make "structured intents / graph deltas" the fleet's "canonical currency" when the workers' entire I/O contract is text you don't own. Making representations primary *requires owning the harness* — which is doc 16's **Pivot 2 ("baton-as-harness, one harness, N backends")**, a substrate the corpus explicitly holds as an *alternative* to conductor-of-harnesses. The design even admits the mechanics are broken: doc 15 §5, which it quotes, says "round-tripping graph-merge back to valid source is **unsolved at scale**, language-by-language." So #10 is Unison for a fleet of harnesses that don't speak Unison, and it presumes away the one constraint that defines the project.

### S5 (fatal on the target substrate) — #4 "speculative cognition" is forbidden precisely where baton runs

The design concedes "Mirage on cost… Z.ai Pro's ≈1-in-flight ceiling forbids it there." It is worse than a cost mirage — it is *illegal on the substrate*. Doc 06 Q7: "A GLM 'fleet' on a Lite/Pro plan is **one worker with a queue**." A worker that "forks its own session into N sub-workers" cannot fork on the GLM arm at all, and paradigm FATAL-1 shows Anthropic "*already tried to meter programmatic subscription use*." Forking is the N× burst pattern the vendors are actively moving to kill — the arbitrage of paradigm FATAL-1, applied to cognition. And the "moat" mechanism (evidence-reaping) inherits ensemble FATAL-2: forks are valuable on *ambiguous* forks ("is the bug in the retry logic or the timezone handling?"), but "the mechanism that makes the ensemble *selectable* (re-checkability) is present only where the ensemble is *unnecessary*, and absent where it would pay." The reaper resolves branches only where reverify has an oracle — i.e., where you didn't need to fork. Same anti-correlation the corpus already killed once, re-instantiated as "branch prediction."

### S6 (severe) — #11 "digital twin / simulate a change before it's made" is the exact over-claim doc 13 T3 CUT

The design flags "mirage if it inflates back into 'emergence'" and then inflates: "**simulate the consequence of a proposed change before it's made** — predicted merge conflict, blast radius, flaky-test risk." Doc 13 T3: "**CUT 'emergence' as a design claim. Emergence is an observation category, not an architecture** — *detect* it, don't *engineer* it." A "continuously-updated **probabilistic belief state** about the repo that workers query and update" is also the precise shape of two named threats: doc 14 #10 ("**Shared context is a shared hallucination surface**… a single poisoned entry becomes a *correlated* failure") and #25 ("**lateral movement through shared epistemic substrate**"). The cited precedents (Dreamer, MuZero) learn world-models in *closed simulators with cheap rollouts and dense reward*; a repo under N diverging worktrees has neither cheap rollouts nor reward. It's mirages feeding mirages: its stated consumers are ideas #3 and #7, which are themselves unbuilt.

### S7 (severe) — #7 "prediction market" is the RouteStat scorecard relabeled, graded by an oracle that's absent where it matters

Doc 14 #22 already *is* this idea, in plainer clothes: "The product isn't 'orchestrate everything'; it's 'know which tasks orchestration helps,' and that knowledge *is* the **`RouteStat`/scorecard** the design already has." Renaming a moving-average scorecard a "prediction market" and invoking "Hanson's futarchy" is the "retrofitted vocabulary over shipping prior art" that doc 13 T5 CUT. Two hard failures: (a) the design's gaming defense is "the *grader is I7*" — but I7 grades only deterministic claims (ensemble FATAL-2), so on the ambiguous tasks where a calibrated forecast would actually inform routing, *there is no I7 verdict to score the Brier against*; (b) "at low task volume the scores are noisy" — self-admitted, and the corpus's honest volume is "handfuls per vendor" (doc 10 caveat). Calibration curves need hundreds of resolved binary outcomes per task-class; the frontier moves under you (doc 14 #23) long before you accumulate them.

### S8 (severe) — #3 "continuous verification field" is a hyperparameter zoo on an unsolved substrate; the kernel already exists

Self-admitted: "the decay model is a hyperparameter zoo, and incrementally maintaining a CPG field under diverging worktrees is doc 15 §5's own admitted unsolved problem, harder." Doc 15 §5 confirms: "**Unproven at scale**; the overlay-vs-reindex threshold (doc 11 risk 2) recurs harder here." A "scalar field over the CPG that decays… a change three edges away weakens your confidence a little" is unfalsifiable machinery whose "confidence right now" number cannot be validated against anything — and doc 14 #23's discipline asks the killing question the idea can't answer: a stronger model that just re-reads the diff makes the entire decay-field apparatus redundant. The buildable kernel (semantic-diff review, doc 15 §6, the "one thing worth front-loading") already exists; the "field" is that kernel inflated 100× into research it admits is unsolved.

### S9 (rhetoric, not fatal) — #2 "the orchestrator is not an LLM" is the corpus's *already-adopted* position, mislabeled as bold ideation

This is *correct* — which is why it isn't beyond-frontier. It is doc 16 **Pivot 1: "Deterministic orchestrator; LLMs are only workers. *(Strongest. Adopt.)*"**, and doc 04's "Option D — own the loop," and the literal governing principle of the supervisor spec: "**the LLM orchestrator must not be in the liveness-critical path.**" Presenting a settled, adopted corpus conclusion as an "alteration of the thesis" tagged `[SELF-IDEATED]` is vocabulary theater. The genuinely new rider — a "learned control policy / MILP / bandit… a *moat* that compounds" trained on "baton's private cross-vendor run corpus" — dies on volume: Decima and Borg train on *millions* of jobs; at N=3–10 workers and handfuls of tasks per vendor, a "learned policy" is overfitting noise, and doc 13 T2 already deflated exactly this ("miscounted O(N) scaling… non-transferable large-N robustness at N=3–10"). The honest artifact is the RouteStat moving average the corpus already specced.

### S10 (rhetoric) — #8 TEE/ZK attests *faithful execution of the wrong oracle*

Even the honestly-scoped "harvest the TEE-attested 20%" oversells. TEE-attesting "**the test suite ran on commit X in sandbox Y and exited 0**" does not touch I7's actual cost, because I7's cost is not the re-run — it's that the worker-supplied test is the *wrong oracle* (doc 13 T1: "weaken the spec until a *true* proof closes"). A TEE cryptographically certifies that green-check theater executed faithfully. Worse, the auth-boundary "reframe" — "the sandbox *proves* its own integrity" instead of "hub controls the sandbox" — is a *downgrade* of the earned principle: OS-sandbox-as-auth-boundary works *because the hub controls the sandbox*; moving the trust root into a TEE the worker's vendor provisions re-imports the "vendor grading itself" problem the Referee exists to eliminate.

### S11 (rhetoric) — #5 self-hosting is a bootstrapping paradox on the maximally cherry-picked task

The compiler analogy imports undeserved credibility: rustc bootstraps because a compiler is *deterministic and machine-checkable*; an agent fleet is neither, so "a compiler that compiles itself" transfers no evidence. The bootstrapping paradox is fatal, not a footnote — "you need a working-enough baton to build baton," and doc 16 §2 says baton is *unbuilt*. And it inverts doc 14 #21's fair-eval discipline: baton's own repo is the single most cherry-picked task imaginable (#21b), the one codebase the tooling is overfit to and the one where the author unconsciously briefs around known weaknesses. The idea concedes the escape ("sequence it after the one thin vertical works on a neutral repo") — at which point the neutral eval has already produced the number and self-hosting adds nothing.

### S12 (rhetoric, small-N vocabulary inflation) — #6 market and #9 staking are doc 13 T2 redux

Both are self-conceded mirages whose surviving slivers are trivia in costume. #6's "shadow price of the concurrency LP" at N=3 with a vendor ceiling of 1 is a 3-bit "is the lane busy" semaphore; citing Hayek and congestion pricing for a semaphore is the "retrofitted vocabulary over shipping prior art" doc 13 T5 CUT. #9's "intra-fleet per-instance stake with slashing" needs a large population and repeated games (Ethereum: thousands of validators) to mean anything; a worker "instance" is spun up per task and ceases to exist at task-end — you cannot slash capital from an entity that doesn't persist. Both are doc 13 T2's exact error: "importing large-N mechanism vocabulary into a small-N system," which "generates the defects both teams circled."

### The one survivor, and why it isn't beyond-frontier

**#12 (reproducible run corpus as the moat)** is the only idea that survives — and the design admits it is "**already latent in the corpus**" (doc 14 #14/#20 promoted, not new). Its own flag is the kill on the "moat": "reproducibility across vendors you don't control (pinned model versions, mutated-filesystem snapshots) is exactly doc 14 #14's admitted-hard problem." Subscription plans routinely **do not let you pin the model version** (that's an API/enterprise control), so the "reproducible cross-vendor corpus" may be *unreproducible on precisely the substrate baton targets* — a pile of logs, not a flywheel. And it's circular: the corpus is worth only its task distribution → which needs real users → which needs a shipped product → which needs the eval → which hasn't run.

**Bottom line.** One idea (#2/non-LLM conductor) is right and already adopted. One (#12/corpus) is right, already in the corpus, and hostage to an unsolved reproducibility problem. The boldest three (#1 institution, #10 representations-primary, #11 twin) each assume away a founding constraint the corpus fought for pages to establish. The rest are small-N mechanisms in large-N vocabulary, or the same re-checkability/decorrelation anti-correlation the ensemble review already killed, re-skinned. And the whole thing is round four of "another page instead of the number" — which doc 16, written the same day, named as the corpus's central failure.

Files engaged: `/Users/wahargis/Development/Experiments/baton/docs/16-framing-critique-and-pivots.md`, `/docs/13-revision-log-r2.md`, `/docs/14-practitioner-addenda.md`, `/docs/15-representation-and-computation.md`, `/spec/supervisor-state-machine.md`, `/docs/10-interaction-model.md`, `/reviews/red-blue-explore/paradigm-vendor-obviation.md`, `/reviews/red-blue-explore/ensemble-economics.md`.

## BLUE-TEAM & SALVAGE
<br>

The user wants me to be the BLUE TEAM. I need to read the relevant corpus parts, understand the red attack deeply, and produce an honest blue-team defense/salvage/integrate document.

Let me start by reading the key files the red team engaged, especially doc 16 (which is the red team's central weapon), plus the design corpus anchors.

Let me read efficiently in parallel.
