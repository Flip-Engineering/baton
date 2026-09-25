# Max-campaign stream: kill-case

## DESIGN
# Kill-case and steelman

*Existential red/blue for baton. I read the corpus this asks me to engage — README, doc 13 (Referee reframe), doc 15 §0 (Conductor-is-the-ask), doc 04 (architecture), doc 14 (the 30 addenda, esp. #22/#23/#30), doc 01 §§5–7 (GLM/ToS/economics), doc 07 (roadmap M0/M1), and the two sharpest red/blue/explore files (paradigm-vendor-obviation, architecture-buildability). I quote what I engage. The point of this document is to test the reason-to-exist at the root, so I steelman both extremes harder than the corpus steelmans either, then name the single experiment that dominates.*

---

## (A) The kill case — the honest move is to not build this

This is the argument a skeptic who wants to *save your time* would give. It is not a list of risks; it is a claim that the risks are structurally load-bearing and jointly fatal. Seven pillars, and they reinforce.

### A1. The value and the viability are anti-correlated — there is no configuration where both are present.

This is the paradigm review's FATAL-1 and it is the spine of the kill case. Baton's value splits cleanly into two disjoint sets, and each set is independently dead:

- **The buildable, valuable parts are exactly what the vendors are shipping** (A3 below). Single-vendor orchestration is, in doc 06 Q1's own opening, "already good."
- **The one thing a vendor structurally will not build — a single control plane spanning Claude+Codex+GLM — is precisely the thing their economics are moving to forbid.** Doc 01 §7 is not ambiguous: Anthropic *already announced* metering programmatic subscription use (2026-05-14), cancelled it the day it would take effect, and stated it is "reworking, not abandoning." Z.ai is "contractually restricted to officially supported tools … enforcement includes rate limiting, account freezing, bans." OpenAI directs job automation to the API-billed SDK and wants enterprise integrations to register as a known client.

The corpus's own hedge dissolves the thesis. Doc 09 F5 / doc 07 M1: "API-key is the **default** for unattended/CI; subscription auth is an opt-in, vendor-narrow, on-notice mode." But if API-key billing is the default posture, then baton is — in doc 00's own stated non-goal — a thing that "orchestrate[s] API calls, not harnesses," and the non-goal fires on baton itself. The flat-rate three-vendor fleet (doc 00 §2, the *founding pitch*) is the only configuration where the economics are novel, and it is exactly the contraband configuration each vendor is moving to kill, possibly mid-run. You would be building your differentiator on a surface all three landlords have announced they intend to pave over.

### A2. The "three-vendor fleet" is a two-harness reality plus a throttled model swap.

Doc 09 D1, accepted as VALID in baton's own revision log: "'Harness' conflates surface × model × seat. glm-adapter is really claude-surface + glm-model." The Codex external review says it flatly: GLM-through-Claude "is a second model provider, not a third independent harness architecture." So baton adapts **two** surfaces, not three; a third of the advertised heterogeneity is an `ANTHROPIC_BASE_URL` swap on an adapter you already have.

And the GLM seat is not a seat. Doc 01 §7: Pro-tier concurrency is documented at **1 in-flight request** (reportedly cut from 3 without notice), burning 3× at peak. Doc 06 Q7's own words: "A GLM 'fleet' on a Lite/Pro plan is one worker with a queue." So the marquee error-decorrelation ensemble (doc 12 §3) is, in the flat-rate world that is supposed to justify the project, a best-of-two where one arm is throttled serial. The founding economic object does not exist as described.

### A3. Obviation is present-tense, not a 12-month risk — and it has already eaten both headline demos.

Baton names two demos as its proof-of-existence (doc 09 F2/F3). Both are now native one-call primitives in the *installed binaries*:

- **F2 — "orchestrator dies/restarts and resumes with pending approvals intact,"** called "the smallest demo that proves the hub earns its existence." The Claude Agent SDK dossier annotates `reinitialize()` verbatim as "the daemon-reattach primitive baton doc 02 said Claude lacked," redelivering `pending_permission_requests`. Codex `thread/resume` rejoins the thread. Baton's existence-proof demo is a native call on both harnesses.
- **F3 — cross-review, "the use case with an existence proof."** The existence proof *is a competitor's shipping product*: OpenAI's Claude Code plugin runs a Stop-hook gate executing Codex over every Claude turn. Codex ships `approvalsReviewer: auto_review | guardian_subagent`.

Add the rest: Claude **agent teams** already field the hub/ledger/mailbox/task-DAG shape with PID-lockfile file-claiming and `TeammateIdle`/`TaskCompleted` hooks — and already spawn Codex teammates (`agentType: codex:codex-rescue`). Codex `app-server daemon bootstrap --remote-control` already targets SSH-driven fleets — baton's "Foreman" topology, shipped. `codex cloud exec --attempts N` is native best-of-N. `SKILL.md` is already a cross-vendor standard across ~40 clients — baton doesn't own skill portability, it rents it. Every plane baton claims has a shipping or in-dev vendor equivalent. You would spend M1's several weeks building the reattach demo the same quarter the SDK documents `reinitialize()` in a blog post.

### A4. The bitter lesson is eating the scaffolding — and the corpus admits which half.

Doc 12 §4's own rule: "scaffold WHAT and VERIFICATION, never HOW; the what/verify parts compound." Doc 14 #23, in the author's own voice: "half your value props have a shelf life." The steering/interruption machinery, the context-budget tricks, the boring-middle routing, the capability plane — these are HOW, and HOW is precisely what a stronger base model routes around. Doc 14 #23 lists them as *rentals* outright: "context-budget tricks a 10M-token model obviates, orchestration a natively-multi-agent harness subsumes." The uncomfortable read: the project's own most honest document has already sorted its components into moat and rental, and the *rental pile is where almost all the engineering complexity lives*. You are being asked to build, deep, the parts your own analysis says the frontier will make unnecessary in 18 months.

### A5. The null hypothesis is not a risk to mitigate — it is the unconfirmed premise, and it is probably true for most tasks.

Doc 14 #22, again in the author's voice: "orchestration can make agents *worse*." A capable frontier agent, well-briefed, with good tools, is a strong baseline, and "much of baton's machinery (task fragmentation, coordination overhead, context poisoning from digests, interruption of flow) can *net-reduce* capability." The honest framing the doc offers: baton is a bet that coordination *value* exceeds coordination *tax*, "and that ratio is *task-dependent* and probably *negative* for many tasks."

The corpus has never measured this number. The entire edifice cantilevers off one unmeasured fact (doc 13 T4: "the entire corpus cantilevers off a single unmeasured fact"). The intellectually honest posture toward a large speculative build whose central premise is unmeasured *and whose author suspects is negative for most tasks* is: measure the premise before building the edifice — and if you are unwilling to gate the whole project on that one number surviving its pre-committed pivot, you are building on faith.

### A6. What ships has the exact hole the trust model exists to close.

The architecture review's FATAL-2: there are two different I7s. The *scheduled* one (M1) "re-executes the brief's verification independently … in a sandbox" — i.e., it re-runs the worker's own test command. The math-proof doc's own gap analysis says why that is insufficient: "mere re-execution … does not catch a weak test suite the worker authored to pass." The *rich* I7 that closes the hole (mutation scoring, proof-carrying artifacts, kernel re-check) lives entirely in the unscheduled capability plane. And the "crown-jewel" proof claim was a documentation *lie*, corrected in doc 13 T1: kernel acceptance means the proof matches a *worker-influenced spec*, and "a worker who can't find a proof can weaken the spec until a *true* proof closes" — kernel-green, genuinely valid, wrong property. So even the durable core, as scheduled, ships with the named forgery hole open, and its deepest rigor rung is technically unsound without an axiom audit the spec never mentions.

### A7. Enormous complexity, one demonstrated use case — and that one is a competitor's feature.

Strip the vocabulary and count what is actually *demonstrated to help*: cross-review. One use case. Its existence proof is OpenAI's plugin (A3). Everything else — the seven capability modules, stigmergy (renamed to "a small-N coordination service" in doc 13 T2 after both teams found the O(N) scaling dies under contention), the emergence engine (CUT in doc 13 T3), the representation ladder (doc 15, explicitly "downstream of the eval," polishing "a thing that shouldn't exist" if the fleet loses) — is speculation stacked on the unmeasured premise of A5. The supervisor state machine is genuinely well-argued, but it is the control plane for a fleet whose reason to exist is unconfirmed. **The most rigorous version of the kill case is not "baton is bad." It is: the durable, defensible sliver (neutral cross-vendor verification) does not require the vast majority of what baton proposes to build, and everything baton proposes to build *around* that sliver is either shipped by vendors (A3), forbidden by ToS (A1), eroded by the frontier (A4), or downstream of a premise no one has measured (A5).** The honest move is to build the sliver as a weekend artifact-consumer, measure the one number, and *not* build the edifice — and given this user's far higher-return alternatives (the volta-renaissance research, the bug-bounty portfolio, the homelab), the opportunity cost of the edifice is the loudest argument of all.

---

## (B) The strongest case for — and it must survive (A)

The FOR case fails if it defends the Conductor, the three-vendor fleet, or the edifice — (A) is correct about all of those. It survives only if it retreats to the one thing (A) cannot touch and shows that thing is worth building *now* and by *this user*. That thing is **neutral, independent, cross-vendor verification** — the Referee, stripped even of the Conductor that doc 15 §0 wants to keep around it.

### B1. The durable claim is structural, not a feature gap that closes.

Every obviation in A3 is a vendor shipping a *single-vendor* version of a baton plane. Not one of them is cross-vendor adjudication, and the reason is not that the vendors haven't gotten to it — it is that **a vendor grading itself against a competitor is the fox guarding the henhouse** (doc 13, doc 01 §6: "the single-vendor boundary is exactly baton's reason to exist"). OpenAI's plugin has Codex review Claude — but it is OpenAI's plugin, authored by one party, running one direction, with the grader and the spec both vendor-adjacent. That is not neutral verification; it is a vendor's cross-sell. The neutral version — *re-verify in a sandbox neither worker nor its vendor controls, against a spec the human or orchestrator pins, never a worker-supplied restatement* (doc 13 T5, the "grader-provenance trust boundary") — is the one thing that boundary *permanently* protects. A3's obviation table has an empty cell exactly here, and it stays empty structurally.

### B2. It is ToS-clean, so A1 does not reach it.

A1 is devastating to the Conductor because driving live subscription-authed control loops across three vendors is the arbitrage each landlord is killing. But a Referee **consumes artifacts** — `codex exec --json`, `claude -p` output, git diffs, exit codes (doc 13's own distinction). It does not hold three live subscription sessions in a fleet; it grades outputs. That sidesteps the entire metered/contraband axis. The kill case's strongest pillar (A1) is a Conductor pillar; it glances off a Referee that never drives, only judges.

### B3. It is the half of doc 12 §4's own rule that *compounds*.

A4 sorts baton into moat and rental — and independent verification is on the moat side by baton's own rule: it is the VERIFY half, which "gets *more* valuable as models improve." As frontier models get cheaper and are deployed in more autonomous fleets (agent teams, `remote-control` — the very obviations of A3), the population of *unstoppable fleets you cannot independently trust* grows. A Conductor without a Referee is exactly that: an unstoppable fleet you can't trust (doc 15 §0). The frontier's advance does not erode the Referee — it *manufactures its market*. That is the definition of a moat under a moving frontier, and it is the one component in the corpus that answers doc 14 #30's mandatory "why won't a better base model obviate this?" with a structural, not a hopeful, answer.

### B4. The demand is proven and the neutral version is unowned.

A3 says cross-review is shipped. B4's turn of that same fact: OpenAI shipping a cross-review gate is the *existence proof of demand* baton needs — someone with the best information in the industry decided cross-model review was worth a production feature. What they shipped is single-authored and one-directional. The symmetric, neutral, human-pinned-grader version — where the spec is yours, the sandbox is yours, and *neither* vendor authored the gate — is unbuilt, unownable by any vendor (B1), and is precisely the "measure the decorrelation" object no one is producing. Demand: proven. Supply of the neutral version: zero.

### B5. Why *now*, and why *this user*.

*Now*, because the enabling artifacts just became stable (doc 01 §4: `codex exec --json` typed lifecycle events, `claude -p` stream-json) and the market (B3) is being manufactured by the fleet-autonomy wave this quarter. A Referee built as an artifact-consumer today needs almost none of the M0/M1 apparatus the architecture review (A6) shows is mis-scheduled — it needs a diff, two vendors, a pinned grader, and a sandbox.

*This user*, specifically: you already run cross-vendor review as a habit (the `codex:rescue` plugin, Codex-reviewing-Claude at your stop gate). You have the substrate to run the honest eval that A5 demands and the corpus keeps deferring — multi-GPU compute at atari-homelab, a project-manager knowledge graph for RLM-style experiment logging, and a documented culture (your own CLAUDE.md: "Failing Tests Must Be Resolved," "No Arbitrary Numeric Limits," "own the moat, rent the frontier") that is *already* the adversarial-honesty discipline doc 14 #21 says the eval requires. The kill case's opportunity-cost argument (A7) cuts the other way for the *sliver*: the sliver is a few days, not the edifice, and it produces a reusable research instrument (a decorrelation measurement) that feeds your existing research practice regardless of whether baton continues.

**What B concedes to A, honestly:** the Conductor is a rental — A1/A3/A4 win on it, and doc 15 §0's insistence on building it "because you asked for it" is the corpus's one un-rigorous move (the ask is not evidence). The three-vendor headline is a two-harness reality (A2 stands). The edifice should not be built (A7 stands). B does not rescue baton-as-specified. B rescues one organ — and claims that organ, alone, is worth a few days to *test*.

---

## (C) Synthesis — the one experiment that dominates

Both extremes converge on a single unmeasured fact, but they disagree about *which* fact, and that disagreement is the whole decision. The corpus (doc 07 M1, doc 13 T4) proposes **E1: does a supervised cross-vendor fleet beat a single-vendor soloist on cost/time/quality?** That is the Conductor's eval, and it is the *wrong* experiment to run first, because:

- It requires the supervisor, two adapters, the event-loop bridge, and the fault-injection harness — weeks of the exact HOW-machinery (A4) and mis-scheduled I7 (A6) whose value is most in doubt.
- It tests the *rental* (A1/A3), not the *moat* (B1–B4). A positive E1 is not durable; a negative E1 you could have predicted from A5.
- Its result is confounded by everything: adapter quality, GLM throttling (A2), brief quality, the Conductor's own tax.

The experiment that **dominates** — cheaper by an order of magnitude, testing the durable core, with the most decision-relevant result per dollar — is:

> **E2 — Does independent cross-vendor verification catch material defects that same-vendor verification misses, at a decorrelation rate that justifies a second vendor's cost?**

This is the Referee's load-bearing fact and the root of the entire tree. If cross-vendor decorrelation is real and material, the moat (B) is real and the *only* remaining question is engineering how to feed the Referee — the whole Conductor debate becomes a downstream optimization. If decorrelation is negligible — the sharpest risk in the corpus, doc 13 T1/T5's "N LLMs share training priors, so on an ambiguous spec they converge on the *same* wrong answer and `agree:true` fires" — then the cross-vendor premise is dead at the root, and *the entire project, Conductor and Referee alike, should not be built.* E2 can kill baton or vindicate its one durable organ, and it needs zero baton infrastructure.

**Concrete E2 (runnable in days, on the hardware you already have):**

1. **Corpus:** ~50 real diffs/PRs from repos you control, of which a known subset carries a *material* defect — ideally real historical bugs plus a smaller set of deliberately injected ones (logic flips, missing-guard, taint paths), so ground truth is pinned by *you*, not a worker.
2. **Conditions, held identical except the grader's vendor:**
   - (a) **same-vendor review:** Claude reviews a Claude-authored diff against your pinned spec, in a sandbox.
   - (b) **cross-vendor review:** a different family (Codex, and GLM as a throttled third — run it serially, that's fine at this scale) reviews the *same* diff against the *same* pinned spec.
   - (c) **union** of (a)+(b).
   Grader and spec are **human-pinned, never worker-supplied** (doc 13 T5 — this is the one methodological line that must not bend).
3. **Metric, pre-registered:** the *lift* of (b) over (a) in caught-defect fraction, **and** the decorrelation structure — do different families miss *different* bugs (the real asset), or the *same* bugs (priors-shared, thesis-dead)?
4. **Pre-committed kill threshold:** if cross-vendor lift over a *strong* same-vendor baseline is within noise, **kill baton** — the founding premise is false and A5 was right. If lift is material and the misses are decorrelated, **build the Referee-as-artifact-consumer** (not the Conductor), and only then revisit E1 as a genuinely-earned second question.

**Why E2 dominates E1 as a decision instrument:**

| | E1 (fleet beats soloist) | **E2 (cross-vendor verification lift)** |
|---|---|---|
| Tests | the Conductor (rental — A1/A3/A4) | the Referee (moat — B1–B4) |
| Cost | weeks: supervisor, adapters, event-loop, fault-injection | days: two `--json` artifact consumers + a fixed corpus |
| Confounds | adapter quality, GLM throttle, brief, coordination tax | one variable: the grader's vendor |
| A negative result | predictable from A5; weeks wasted | kills the *entire* premise cheaply — the honest "don't build" (A) with proof |
| A positive result | a rental that the frontier erodes | the durable moat, with the decorrelation number that gates everything above it |

Two guardrails E2 must survive or it re-inherits the kill case (doc 14 #21): the same-vendor baseline must be *strong* (well-briefed, same spec) or you're beating a scarecrow and lying to yourself in baton's favor; and the corpus must not be cherry-picked toward bugs one family is structurally bad at. Put the adversarial-review discipline your own CLAUDE.md already mandates on the *eval design* before running it.

**The synthesis in one line:** don't build baton, and don't do nothing — build the one artifact (E2) that tells you which of those two is correct, gate the entire project on its pre-committed threshold, and refuse to write another line of Conductor spec until that single decorrelation number survives its own adversarial review. The corpus already knows this ("run the M1 eval before building anything above the control/verification plane" — doc 13 #58); E2 is that instruction sharpened to the cheapest experiment that can *kill* the project, aimed at the moat instead of the rental.

*Files engaged (all absolute): /Users/wahargis/Development/Experiments/baton/README.md, docs/13-revision-log-r2.md, docs/15-representation-and-computation.md, docs/14-practitioner-addenda.md, docs/04-architecture-options.md, docs/01-landscape.md §§5–7, docs/07-roadmap.md M0/M1, reviews/red-blue-explore/paradigm-vendor-obviation.md, reviews/red-blue-explore/architecture-buildability.md.*

## RED-TEAM
## Red-team: kill-case

I read the docs this leans on (13, 14 #21/#22/#23/#30, 15 §0, 07 M0/M1) and the one it conspicuously doesn't cite (16 — the repo's own "if one doc is worth your time, this one"). The doc's A and B sections are mostly sound; my job is the part they aren't graded on: **the deliverable, E2, and the claim that it "dominates."** That is where the wishful thinking lives, and it is load-bearing — E2 is the entire output. Ranked most-fatal first.

---

### S1 — E2 measures the wrong variable, and the doc's own A2 proves it. (fatal to the deliverable)

E2's design: "**Conditions, held identical except the grader's vendor**," and the doc brags this is its edge — "Confounds: **one variable: the grader's vendor**." But A2 already established, quoting doc 09 D1 as VALID: "**'Harness' conflates surface × model × seat.**" Vendor is not a variable; it is a bundle of {model family, surface, auth, seat, concurrency ceiling}. So E2 does not vary one thing — it varies four, exactly the confound A2 used to demolish the "three-vendor" headline. The doc weaponizes the surface×model×seat conflation against the fleet in A2, then quietly treats "vendor" as atomic in C.

This is not pedantry, because doc 16 Premise B (which the doc never engages) names the specific consequence: "**'Cross-vendor' may be conflating the cheap valuable thing (different models) with the expensive fragile thing (different vendor harnesses).**" The decorrelation E2 hopes to find — if it exists — comes from **model family**, and you can get a different model family behind **one** harness/auth (doc 16 Pivot 2) for none of the ToS/concurrency cost E2's "cross-vendor" framing implies.

**Failure scenario:** E2 returns material lift. The doc's pre-committed branch fires: "**build the Referee-as-artifact-consumer**." But the positive result is fully explained by cross-*family* review, which supports Pivot 2 (`ANTHROPIC_BASE_URL`-swap behind one surface), i.e., *not baton*. E2 cannot discriminate "cross-vendor pays" from "cross-family pays," and those two hypotheses have opposite build implications — one is the whole project, the other kills it. The experiment the doc calls "the one that dominates" is confounded on the single axis the entire go/no-go hinges on. A "dominating" decision instrument that can't separate build-baton from don't-build-baton on a positive result is not dominating; it's undefined.

---

### S2 — E2 omits the one arm most likely to kill the moat, biasing it toward "build." (fatal to the pre-committed threshold)

E2's conditions are (a) same-vendor single review, (b) cross-vendor review, (c) union. The arm that is missing is the one the corpus itself says is the real competitor: **intra-vendor best-of-N sampling.** Doc 13 T6, verbatim: "the lift comes from **sampling-N inside one vendor** (one auth, one adapter, one shared KV-cache — cheap), **not** from vendor-N." The honest baseline against cross-vendor review is not "Claude reviews once" (E2's arm a) — it is "**Claude samples N reviews of the same diff**," which is cheap, ToS-clean, single-auth, and may absorb most or all of the "lift" E2 attributes to a second vendor.

The doc even flags the guardrail — "the same-vendor baseline must be *strong*... or you're beating a **scarecrow**" — and then builds a scarecrow: arm (a) is single-shot. Baseline strength is a continuous free parameter with no principled setting, and it *is* the outcome. A weak (a) manufactures lift → "build." An (a) that includes intra-vendor sampling-N (as T6 demands) may erase the lift → "kill." So the "**pre-committed kill threshold**" is hostage to a knob the doc leaves unspecified. "Pre-registered" is theater when the most outcome-determining parameter is undefined, and the doc's chosen arms are silently pre-tuned in baton's favor.

---

### S3 — E2 cannot confirm the null hypothesis it says a negative result would prove. (overreach dressed as "dominates")

The doc: "A negative result... **predictable from A5**... kills the *entire* premise cheaply — the honest 'don't build' (A) with proof." And: a negligible result means "**the entire project, Conductor and Referee alike, should not be built.**" This is false, and it's the doc's central overreach.

A5/#22 is the orchestration null hypothesis — "**orchestration can make agents *worse***... task fragmentation, coordination overhead, context poisoning from digests, interruption of flow." **E2 runs zero orchestration.** No fleet, no fragmentation, no coordination tax, no digests, no interruption — it is two review calls on a fixed diff. E2 therefore *cannot* confirm #22 in either direction. A negative E2 kills cross-vendor *review decorrelation*; it says nothing about whether a supervised fleet nets positive on a real task. The doc claims E2 is decision-relevant for "everything above it" while running an experiment structurally incapable of touching the null hypothesis it invokes as its proof.

Compounding this: E2 tests exactly the slice A3 says is **already shipped** ("cross-review... its existence proof *is a competitor's shipping product*"), not the slice B1 says is **structurally unowned** (neutral **re-execution against a human-pinned spec in a sandbox neither vendor controls**). Review-catches-a-different-bug is not I7 re-execution; they are different mechanisms. A6's whole point is that the *rich* I7 — mutation scoring, kernel re-check, the anti-forgery re-run — is where the durable value hides, and E2 doesn't build it. So E2 measures the A3-obviated organ and calls it a test of the B1-durable organ. The "moat vs rental" column in the doc's own comparison table is mislabeled for E2's row.

---

### S4 — "runnable in days / zero baton infrastructure" contradicts the doc's own non-negotiable methodology. (the cost claim is wishful)

Two of the doc's load-bearing lines cannot both be true. It insists on "**Grader and spec are human-pinned, never worker-supplied (doc 13 T5 — this is the one methodological line that must not bend)**" and re-verification "**in a sandbox neither the worker nor its vendor controls**." That pinned-spec + neutral-sandbox harness *is the Referee MVP* — the corpus's earned principle is that the **OS-sandbox is the authorization boundary**, not a shell convenience. Yet the doc also asserts E2 "**needs zero baton infrastructure**" and is "**runnable in days**."

Pick one. If E2 skips the real sandbox and pins nothing (two `--json` review calls in a loop), it is literally the OpenAI-plugin shape A3 calls already-shipped — not neutral verification, and its result carries no more signal than the thing the doc spent A3 mocking. If E2 builds the pinned-spec neutral sandbox, that is the Referee, not a weekend throwaway, and "days" evaporates.

And the expensive part isn't even the harness — it's the corpus. The doc wants "**~50 real diffs/PRs... a known subset carries a *material* defect — ideally real historical bugs plus... injected ones... so ground truth is pinned by *you***." Building a defensibly-labeled ground-truth bug corpus is the hard, weeks-long core of every bug-detection benchmark, and doc 14 #21 (the doc's *own* cited guardrail) says a fair eval is "**a research problem, not a checklist**" requiring adversarial review *before it's run*. You cannot honor #21 and ship in days. The doc undercosts precisely the thing it declares must not bend.

---

### S5 — the pre-registered metric is recall-only and rewards the noisier vendor. (a hole in the number itself)

The metric: "the *lift* of (b) over (a) in **caught-defect fraction**." That is recall on injected bugs with no precision term. A reviewer that flags everything "catches" every injected defect and is useless at fleet tempo. The **union** arm (c) mechanically maximizes both recall and false-positive rate, so (c) will always look best on this metric while being operationally worst.

**Failure scenario:** Vendor B is simply a higher-flagging, lower-precision reviewer. E2 records large "decorrelation" (B catches bugs A missed) and pre-committed logic says "**misses are decorrelated → build the Referee**." In reality B has no complementary *signal*; it has a lower threshold. The doc's #21(c) "un-gameable grader" guardrail doesn't catch this because the failure is statistical, not adversarial. A decorrelation study with no precision/false-positive control cannot distinguish complementary signal from complementary noise — and the doc pre-registers exactly that metric.

---

### S6 — the "synthesis" is doc 16's Pivot 3 re-derived, minus doc 16's stronger pivots. (novelty inflation)

The doc frames E2 as an original convergence: "**the one experiment that dominates**." Doc 16 §0 already wrote it — "**the most valuable next artifact is not a document or a system but a *number***" — as Pivot 3, "**Ship a measurement, not a system,**" and §5: "**Build *nothing else* until it returns a number.**" The kill-case doc cites 13/14/15 exhaustively and never touches 16, the one doc that already did its job. That's not just a scholarship gap; it hides doc 16's *stronger* moves that indict E2:

- **Pivot 1 (deterministic orchestrator):** doc 16 argues an LLM-on-top conductor "**manufactures nearly every hard problem in the corpus**," and a program-orchestrator dissolves six of them. The kill-case doc concedes "the Conductor is a rental" but never engages the pivot that would make the *rental* cheap and testable — it just proposes to not build it. That leaves E2 defending a false binary ("build baton" vs "build the sliver") when the corpus's own best doc offers a third the design ignores.
- **Pivot 2 (baton-as-harness):** as in S1, this is the reading under which even a *positive* E2 doesn't justify "cross-vendor." The doc's positive branch — "**build the Referee-as-artifact-consumer**" — silently re-imports "cross-vendor" that its evidence would only support at the "cross-family" level.

Presenting a re-derivation as a dominating discovery, while omitting the two pivots that would change E2's design, is the exact "beautiful edifice" self-flattery doc 14 #30 warns against — one level up.

---

### S7 — the "seven reinforcing pillars" are not independent; at least two self-cancel or are smuggled. (the A-case rhetoric)

The doc claims the kill pillars "reinforce." Two don't:

- **A3 self-cancels with B1/B4.** A3 presents native `reinitialize()` and the OpenAI plugin as devastating obviation. But these are *single-vendor* primitives, and B1's entire moat argument is that single-vendor obviation is structurally irrelevant to cross-vendor adjudication ("**a vendor grading itself... is the fox guarding the henhouse**"). So A3's force is defused by the doc's own B1, and B4 explicitly re-reads the *same* fact as *proof of demand*. A pillar that the same document neutralizes twice is not an independent load-bearing member of a "jointly fatal" structure — it's rhetoric that reads as crushing in A and is walked back in B.

- **A7's opportunity-cost claim is asserted, off-corpus, and contradicts B5.** "**given this user's far higher-return alternatives (the volta-renaissance research, the bug-bounty portfolio, the homelab), the opportunity cost of the edifice is the loudest argument of all.**" This is imported from the operator's ambient context, not the baton corpus, with zero comparative ROI, and it is named "the loudest argument of all" — a red-team using an unquantified priority assertion as its capstone. It also directly contradicts B5, which argues *this same user* is uniquely equipped and should spend "a few days" running E2. The doc leans on "loudest argument" to kill and on "few days, reusable research instrument" to build, and never nets the two — the reader is left with a mood, not a decision.

---

### Verdict

The A-case and B-case are largely honest and I'd defend most of them. The **synthesis is the weak point, and it's the whole point.** E2 as specified: (1) confounds cross-vendor with cross-family — the one distinction that decides the project (S1); (2) omits the intra-vendor sampling arm that most threatens the moat, pre-tilting toward "build" (S2); (3) claims decision-authority over a null hypothesis it cannot test and over an I7 mechanism it doesn't build (S3); (4) is costed as "days/zero-infra" while requiring a research-grade labeled corpus and a real neutral sandbox that *is* the Referee (S4); (5) pre-registers a recall-only metric that rewards noise (S5). The honest correction is not "kill E2" — it's that **E2 must include an intra-vendor best-of-N arm, vary model-family and vendor-harness *separately*, report precision alongside recall, fix baseline strength in advance, and be scoped as the Referee-MVP build it actually is** — at which point the doc's headline claim ("**needs zero baton infrastructure... runnable in days**") is false, and its rhetorical dominance over E1 shrinks to "cheaper and narrower," not "dominates."

Files engaged (absolute): `/Users/wahargis/Development/Experiments/baton/docs/13-revision-log-r2.md` (T5 pinned-grader, T6 intra-vendor sampling, #58 does not exist as numbered — the numbered list is doc 14's, a loose cite), `/Users/wahargis/Development/Experiments/baton/docs/14-practitioner-addenda.md` (#21 eval-is-a-research-problem, #22 null hypothesis = orchestration, #23/#30 moat/rental), `/Users/wahargis/Development/Experiments/baton/docs/15-representation-and-computation.md` §0, `/Users/wahargis/Development/Experiments/baton/docs/07-roadmap.md` (M1 arms a/c, 1.5× halt), and the uncited but decisive `/Users/wahargis/Development/Experiments/baton/docs/16-framing-critique-and-pivots.md` (Premise B, Pivots 1/2/3).

## BLUE-TEAM & SALVAGE
## Blue-team & salvage: kill-case

I read doc 16 (the uncited one the red is right to weaponize), and re-confirmed the two passages both sides fight over: doc 13 T5 (grader-provenance boundary), T6 (pass@N lift is intra-vendor sampling, "best-of-N justifies the *opposite* of baton"), and doc 07 M1 (the roadmap eval is arms **a/c = solo-vs-fleet**, 1.5× halt — *not* the review arms E2 assumes). The red's central claim is correct in shape: the A-case and B-case are largely honest, and **the synthesis is where the wishful thinking lives.** But "E2 must be rebuilt" is not "E2 was the wrong move" — every finding is a fixable design defect, and the red says so itself ("the honest correction is not 'kill E2'"). Here is the honest ledger, finding by finding, then the salvaged experiment, then how it plugs in.

### S1 — confounds cross-vendor with cross-family — **CONCEDE-and-FIX (and the red overstates the consequence)**

Conceded: "vendor" is a bundle of {family, surface, auth, seat}, and E2-as-written treats it as atomic — exactly the surface×model×seat conflation A2 used to demolish the fleet headline. The kill-case weaponized the conflation in A2 and forgot it in C. Real.

The fix is one added arm, and it converts the confound into the *measured* variable: run **cross-family same-surface** (a GLM backend behind `ANTHROPIC_BASE_URL` inside the Claude surface, grading a Claude diff — doc 16 Pivot 2's exact object) *alongside* **cross-family cross-surface** (Codex grading the same diff). Then `(family-effect) = bf − a+` and `(surface-effect) = bv − bf` are two separately-reported numbers. The one axis the whole go/no-go hinges on stops being a confound and becomes the output.

Where the red overstates: it claims a positive-on-family/null-on-surface result is "not baton," so E2 "can't separate build-baton from don't-build." That is a false dichotomy. The moat in doc 16's *own* value table (row 4: "trustworthy independent verification") and in B1 is **not** "vendor diversity" — it is **grader-provenance neutrality** (T5: a grader neither the worker nor its vendor controls, against a human-pinned spec). That neutrality property is satisfied by cross-*family* just as well, if the grading harness and sandbox are baton-controlled. So the family-positive/surface-null branch does **not** kill baton — it kills the *full-harness conductor-of-vendors* (which A already conceded is a rental) and vindicates **Pivot 2 as the Referee's substrate**, which is precisely what doc 16 §5 recommends holding. Both positive branches build the Referee; they differ only in *substrate* (contract-API backend vs full-harness adapter), which doc 07 M2 already treats as an optional tier. The genuinely fatal cell is a *different* one — null on **both** axes — and E2′ tests exactly that.

### S2 — omits the intra-vendor sampling arm; baseline strength is an undefined outcome-determining knob — **CONCEDE-and-FIX (the strongest finding; the fix sharpens the whole test)**

Fully conceded, and grounded in T6, which I re-read: pass@N lift is repeated-sampling inside one vendor, cheap, single-auth. The honest baseline against cross-family review is **not** single-shot Claude (a scarecrow the kill-case built while warning against scarecrows) — it is **cost-matched Claude sampled-to-saturation.** Pre-registration is theater if the most outcome-determining parameter is left free. Correct.

The defense the red understates — and it is what makes the corrected experiment *more* discriminating, not less: T6 itself separates *generation* best-of-N (variance reduction, intra-vendor) from *cross-review* ("a different family catches your blind spot," line 44). Sampling-N collapses a family's **variance** but cannot touch its **shared systematic bias** — the training-prior blind spots every sample from that family inherits. So the corrected metric is not recall-lift; it is: **after intra-family sampling saturates (the variance floor), does cross-family review still catch a residual set the family systematically misses?** That residual is bias, not variance — unbuyable by sampling at any N. If it is empty, T6 wins and baton dies at the root; if it is non-empty and material, that residual *is* the moat, measured against the strongest honest baseline. The missing arm was a real hole; adding it turns T6 from an objection into the instrument.

### S3 — claims decision-authority over the #22 null hypothesis it can't test; tests the A3-shipped organ, not the B1 organ — **CONCEDE-FATAL on the overreach; DEFEND the organ (with T5 as the mechanism)**

Two sub-claims, two different verdicts.

*Null hypothesis:* **Concede-fatal to the claim.** E2 runs zero orchestration — no fragmentation, no coordination tax, no digests. A negative E2 therefore *cannot* confirm doc 14 #22 ("orchestration makes agents worse"), and the kill-case's "kills the *entire* premise... Conductor and Referee alike" was an overreach. Retract it. The honest scope: a negative E2 kills the **cross-vendor verification decorrelation** premise — which is baton's *actual* moat and is sufficient on its own to make baton not-worth-building — but it does so *directly*, not by proving #22. #22 is a separate fact tested by E1/M1. Two kill-paths, not one; the doc conflated them.

*Review vs re-execution:* **Defend, with a mechanism the red half-saw.** The red is right that unaided "Vendor B reads the diff and opines" is the A3-shipped OpenAI-plugin shape, not the B1-durable I7. But E2's condition (b) was never supposed to be that — the kill-case's own non-negotiable line is T5: grader **re-verifies in a sandbox neither worker nor vendor controls, against a human-pinned spec, with re-run evidence the worker didn't author.** That *is* I7 re-execution, not opinion. The kill-case's prose was sloppy (it said "review" in places); the *object* it pinned is re-verification. So E2-done-to-T5 tests the B1 organ. The red is correct that this collides with S4 — but on the moat-vs-rental axis, the corrected E2 measures the durable organ.

### S4 — "days / zero-infra" contradicts the pinned-spec neutral-sandbox it demands — **CONCEDE (retract the cost claim); DEFEND the order-of-magnitude (the red inflates the other way)**

Conceded: "zero baton infrastructure, runnable in days" is false. A neutral sandbox + pinned grader *is* the Referee-MVP (OS-sandbox-is-the-authorization-boundary applied to grading), and #21 says a fair eval is a research problem. "Days" was wrong — retract it, and retract "dominates" with it.

But the red inflates in the other direction ("that is the Referee, days evaporates"). Two mechanisms cap the real cost well below the supervisor:
1. **The corpus is mined, not hand-built.** A git fix-commit *is* ground truth: the pre-fix diff carries the bug, the fix defines the pinned spec — labels "pinned by you" for free, from the user's own repos (the SWEBenchRunner substrate the CLAUDE.md infra already runs). Add injected controls and known-clean diffs on top. This is days, not the weeks of a from-scratch bug benchmark.
2. **The harness is a deterministic program consuming artifacts** (doc 16 Pivot 1/3: "~a few hundred lines, not four planes"), ingesting `codex exec --json` / `claude -p` and re-running in a subprocess. It is **not** the supervisor — no I1 fencing, no two-phase stop, no event-loop bridge, no adapter conformance suite (doc 07's "weeks-to-months, permanently-recurring" cost).

Honest cost: **~1–2 weeks** for an eval-grade Referee-artifact-consumer plus a mined corpus — an order of magnitude under E1/M1, not "days." The red's own verdict concedes this landing: E2's edge over E1 "shrinks to cheaper and narrower, not dominates." Agreed — drop "dominates," keep "decisively cheaper, aimed at the moat, and able to kill the project."

### S5 — recall-only metric rewards the noisier vendor; union maximizes false positives too — **CONCEDE-and-FIX (clean, cheap)**

Fully conceded. A recall-only "caught-defect fraction" rewards a lower-threshold, higher-flagging reviewer and makes the union arm always "win" while being operationally worst. Fix: pre-register **precision and recall** on a corpus that includes **known-clean diffs** (free — unmodified real diffs). The discriminating quantity: does Vendor B catch A's misses *while holding precision on clean diffs A correctly passed*? Complementary **signal** = catches misses + keeps precision; complementary **noise** = catches misses + flags clean. This defends S5's failure scenario mechanically: a lower-threshold B is exposed by its clean-diff false-positive rate. Standard, and the corpus change costs nothing.

### S6 — E2 is doc 16 Pivot 3 re-derived, uncited; omitting 16 hides the pivots that reshape E2 — **CONCEDE the scholarship and novelty; DEFEND the substance by adopting the pivots**

Conceded: doc 16 §0/§5 already wrote "ship a measurement not a system, build nothing else until it returns a number." "The one experiment that dominates" is Pivot 3 re-derived without citation — a real miss; frame it honestly as *16's Pivot 3 sharpened to the cheapest killing experiment.*

Substance survives *because* the omitted pivots are the S1/S2 fixes, not counter-evidence: **Pivot 2** is the cross-family arm (S1). **Pivot 1** (deterministic-program orchestrator) is the build substrate — "build the Referee-as-artifact-consumer" *is* a deterministic program dispatching LLM workers/graders, which is Pivot 1 adopted implicitly. Make it explicit and the red's "false binary" (build-baton vs build-sliver) dissolves: the sliver, program-orchestrated, *is* baton's honest first increment; E1 becomes the later question of whether to bolt an LLM-conductor on top — which doc 16 argues against anyway. Adopting the pivots strengthens E2; the novelty claim was inflated and is retracted.

### S7 — the seven pillars aren't independent; A3 self-cancels with B1/B4; A7's opportunity-cost is off-corpus — **DEFEND A3-vs-B1; CONCEDE A7**

*A3 vs B1:* Defend. This is the intended structure, not self-cancellation. A3 operates on **single-vendor primitives** (`reinitialize()`, the OpenAI plugin) → kills the Conductor. B1 operates on **neutral cross-vendor adjudication** → saves the Referee. Different objects. A3 is not neutralized; it is *scoped* — it wins on every cell except the one B1 marks empty. "Kill most, save one" is literally the doc's thesis; a survivor is not a contradiction. Concede only the minor honesty point: A3 and B4 are *one fact with two valences* (obviation / demand-proof) and should be presented as such, not as two independent findings.

*A7 opportunity-cost:* Concede. "Far higher-return alternatives... the loudest argument of all" is imported ambient operator context, unquantified, off-corpus, and it *does* sit in tension with B5. Demote it from "loudest argument" to "a real but unquantified cost that E2 itself resolves" — and the reconciliation the doc failed to net is exact: **E2′ is cheap enough (1–2 weeks) to sit *below* the opportunity-cost threshold, and its output (a decorrelation number + a reusable eval instrument) feeds the volta-renaissance/PM-RLM practice regardless of baton's fate.** So run E2′ (below threshold, dual-use); don't build the edifice (above threshold). B5 and A7 net cleanly once cost is stated honestly.

---

## SALVAGE — E2′, the experiment that survives the attack

The strongest surviving version is **not** "E2 dominates." It is: *the cheapest experiment that can kill baton at the root, aimed at the moat, with the two confounds the red exposed converted into measured axes.*

**Object under test:** neutral cross-family **re-verification** (T5: human-pinned spec, baton-controlled sandbox, re-run evidence the worker didn't author) — I7 instantiated minimally — *not* unaided review.

**Arms (factorial on the two axes S1/S2 exposed):**
- (a0) single same-family review — floor reference only, not the baseline
- (a+) **intra-family sampled to saturation** — the honest cost-matched baseline (S2 / T6)
- (bf) **cross-family, same surface** (GLM backend behind one harness) — Pivot 2 / family axis (S1)
- (bv) **cross-family, cross-surface** (Codex) — full cross-vendor / surface axis (S1)
- (c) adjudicated union — reported **with precision**, not recall-only (S5)

**Corpus:** git-mined (fix-commit = pinned label) + injected controls + **known-clean diffs**; ground truth pinned by the user (T5); the eval design itself put through adversarial review *before* running (#21).

**Pre-registered metric:** on a cost-matched token budget, the **bias residual** — cross-family catches on the intra-family-saturated miss set — reported as **precision AND recall over bugged *and* clean diffs**, decomposed into `family-effect (bf−a+)` and `surface-effect (bv−bf)`.

**Pre-committed decision — three branches, not two (S1/S3 fix):**
- **Null on both axes** (cross-family adds nothing beyond saturated intra-family sampling, precision-controlled) → decorrelation premise dead → do not build the Referee → **baton not worth building.** (The real kill — and it does *not* claim to confirm #22.)
- **Family-effect material, surface-effect null** → build the Referee on a **Pivot-2 substrate** (cross-family behind one baton-controlled harness / API backends); do *not* build the full-harness conductor-of-vendors.
- **Both material** → cross-vendor surface buys real independence → the full-harness adapter tier is *earned* as an option (doc 07 M2 tiering).

**Cost:** ~1–2 weeks; ~10× under E1/M1. Retract "days / zero-infra / dominates"; keep "decisively cheaper, aimed at the moat, able to kill the project."

## INTEGRATE — planes, invariants, and the one thing to build first

- **Plane:** E2′ lives *entirely* in the **control/verification plane**. It is **I7** (hub-run verification: worker prose non-authoritative, only hub-re-run evidence counts) instantiated at minimum scale. It does **not** touch the supervisor liveness invariants — I1 fencing, I3 at-least-once cursors, I6 two-phase stop — which are Conductor-branch, correctly gated behind E1 (doc 13's standing instruction: run the eval before building anything above the control/verification plane).
- **The one load-bearing invariant:** **T5 grader-provenance** must be architecturally un-bypassable — spec pinned by human/orchestrator, grader in a sandbox neither worker nor its vendor controls, verdict backed by re-run evidence. This is *OS-sandbox-is-the-authorization-boundary* applied to grading; it is the single line that separates real verification from green-check theater (strictly worse than trusting the worker).
- **Orchestrator = deterministic program** (doc 16 Pivot 1), not an LLM. The E2′ harness and the eventual Referee are the *same object*; LLMs are only workers and graders. This dissolves the red's build-baton-vs-build-sliver binary: the sliver, program-orchestrated, is baton's honest first increment.

**Build first — one object, three payoffs:** a deterministic-program **Referee-artifact-consumer** that ingests `{one diff, one human-pinned spec}`, re-runs verification in a baton-controlled sandbox, and emits a **provenance-typed verdict** — then wrap it in the E2′ factorial over the git-mined corpus. That single ~few-hundred-line program is simultaneously (i) the eval instrument that can kill the project on its pre-committed null branch, (ii) the I7 + T5 core of the surviving Referee (whichever substrate wins), and (iii) a reusable decorrelation-measurement instrument that feeds the user's existing PM/RLM research practice regardless of baton's fate. Nothing above the verification plane gets written until it returns its number.
