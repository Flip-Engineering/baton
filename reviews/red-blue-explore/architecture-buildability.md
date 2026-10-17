# Red/Blue/Explore — architecture-buildability

## RED
I have read the load-bearing files (docs 04, 06, 07, 08, 09, 10, 11, 12; spec/supervisor-state-machine, spec/capability-plane, spec/adapter-contract, spec/communication-channel; the math-proof capability doc and its embedded critic pass; and both prior reviews). Here is the attack.

## Red-team: architecture-buildability

The stack is genuinely well-argued and hard-nosed about its own control plane. But the brief asked whether it's "a beautiful doc pile that won't ship" with "fatal coupling," and whether doc 07's MVP exercises the load-bearing parts or dodges them. The honest answer is: **the buildable plan and the differentiating vision are two different projects that never touch, and the one that's scheduled dodges everything the docs call interesting.** Ranked findings:

---

### FATAL 1 — The roadmap builds a smaller, different system than the design describes; the three planes the docs call "the bet" and "the actual product" appear in no milestone.

**Claim attacked.** doc 10 §0: "The design **bets** that the third — **stigmergic** coordination through structured shared media — is where the leverage is." doc 12's subtitle calls the context/capability layer "the user's **stated core intent**." capability-plane §8 and doc 11's "Cross-module MVP" both define a concrete "**one thin vertical**": `atlas` lexical+structural + validation `test`/`proptest` + Cartographer `repo_map` + Cairn scorecard.

**Why it fails.** Grep doc 07 (the actual build sequence, M0–M3) for `atlas`, `capability`, `validation ladder`, `reverify`, `index`, `stigmerg`, `blackboard`, `Cairn`, `Cartographer`, `scorecard` — **none of them are milestone deliverables.** M0 = transport; M1 = supervisor + cross-review + BatonEvent + eval; M2 = control surface + human seat + GLM + isolation; M3 = conductor + ACP + foreman. The entire capability plane, the epistemic knowledge layer, the context-composition layer, and stigmergy are **unscheduled and unestimated.** So there are two disjoint "MVPs" — doc 07's (a durable cross-vendor for-loop) and doc 11/capability-plane's (the agent-shaped substrate) — and they describe non-overlapping systems. The reviewer's question ("does the MVP exercise the load-bearing parts or dodge them?") has a clean answer: doc 07's MVP dodges every part docs 10/11/12 insist is the point.

**Scenario/evidence.** An engineer follows doc 07 to completion. They ship a hub that spawns Codex+Claude workers in worktrees, survives orchestrator restart, and runs cross-review — and **never build a single capability module, never build the shared index, never build stigmergy, never build the context composer.** They have built "beyond HCI"'s *opposite*: a well-supervised `codex exec` for-loop. The vision docs (10–12) and the build doc (07) are not the same product, and nothing in the corpus reconciles them or sequences the crossing.

**Severity: fatal** (it's the coherence of the whole stack — the differentiated thing isn't scheduled; the scheduled thing isn't differentiated).

---

### FATAL 2 — The trust model that ships has exactly the hole the advertised trust model exists to close.

**Claim attacked.** The "trust spine": capability-plane §6 "Capabilities are where supervisor **I7** gets its teeth... a worker cannot forge a capability result the hub re-checks"; doc 11 "the capability plane is the **evidence layer** the control plane's trust model stands on"; math-proof "the **crown-jewel** realization of I7... a worker literally cannot hand back a proof term the hub's kernel accepts unless it is valid."

**Why it fails.** There are **two different I7s** conflated across the docs. The *scheduled* one (supervisor line 29, in M1) is: "re-executes the brief's verification independently... in a sandbox." That is just **re-running the worker's test command.** The math-proof doc's own gap-analysis says verbatim why that's insufficient: "mere re-execution only catches lying about the exit code — it **does not catch a weak test suite the worker authored to pass**." The *rich* I7 that closes that hole (proof-carrying artifacts, mutation testing, kernel re-check) is **entirely in the unscheduled capability plane.** And the crown-jewel claim is **false as written** — the module's own embedded critic pass (§0): "`sorry` elaborates to `sorryAx : α`, which the Lean kernel *accepts*... `lean4checker` will happily accept all of these." Worse, that critic also found "**Kani, CBMC, Lean, and Alive2 are NOT installed** ... The only deep verifier actually on the box is z3" — so the module leans on tooling that isn't even present.

**Scenario/evidence.** A worker writes `def test_auth(): assert True` and a real code change, reports green. Shipped-I7 re-runs `pytest`, sees exit 0, merges. The forged-strength attack (doc 06 Q4, red-team `adversarial` A5) that the entire "worker prose is non-authoritative" edifice was built to defeat **succeeds against the version of I7 that's on the roadmap.** The closing mechanism (cargo-mutants / z3-with-checkable-verdict / axiom audit) is unscheduled, and where it *is* designed (Lean rung) it's technically unsound without the axiom-audit the spec never mentions.

**Severity: fatal** (the security thesis is advertised at a rigor level that is not the level that ships, and the shipped level has the named hole).

---

### SERIOUS 3 — M0 is internally impossible by the doc's own arithmetic, and its experiments presuppose the supervisor M0 doesn't build.

**Claim attacked.** doc 07 "M0 — Transport spike + the honest baseline (**~1 week**)" — builds *both* `codex-adapter` and `claude-adapter`, six northbound tools, and four recorded experiments including steer-timing and interrupt-unwind latency.

**Why it fails.** The same doc's guiding re-estimate: "the supervisor invariants alone... are **~2–3 weeks to a tested skeleton for one adapter**, because the tests are the hard part." M0's experiment 1 tests "the **bounded-poll-under-timeout (`HOST_SAFE_MS`) loop** + progress heartbeats survive" — that *is* supervisor I4+I3. Experiment 3 tests "**the unwind window**... whether a shell child keeps running past the ack" — that *is* I6 two-phase stop. But I3/I4/I6 are M1's "**the real work**." You cannot measure whether the bounded-poll loop survives host timeouts (M0) before you have built the bounded-poll loop (M1). Either M0 secretly builds the supervisor (blowing ~1 week → the doc's own 2–3 weeks for *one* adapter, and M0 has two), or M0's experiments test the naive raw-adapter form the supervisor exists to replace — in which case they don't falsify what M0 claims to falsify.

**Scenario/evidence.** Week 1 arrives; to run experiment 1 the team must implement pre-reserved at-least-once cursors + `HOST_SAFE_MS` bounded poll + heartbeats across two vendor adapters. That is, by the doc's own number, a >4-week job (2–3 weeks × ~2 adapters, "tests are the hard part"). M0 as scoped cannot exist in the timebox it's assigned; the very first milestone's estimate is contradicted three sentences earlier in the same file.

**Severity: serious** (the earliest, cheapest, thesis-testing milestone is mis-estimated by a factor the doc itself supplies).

---

### SERIOUS 4 — Fatal coupling: capability ops are "fenced like a control op" (turn-scoped) but explicitly outlive turns.

**Claim attacked.** capability-plane §1: "`InvokeCtx` carries... the `(worker, turn_epoch)` fence (so a capability op is **fenced like a control op** — a stale-epoch invoke is rejected)." Design law 3: "Long ops live in the task-DAG. Anything beyond a latency budget (a full index build, a fuzzing campaign, a **proof search**) becomes a task-DAG node... interruptible via the control plane."

**Why it fails.** Supervisor I1 (just promoted from an open question by doc 09 A6): "The supervisor bumps `turn_epoch` on **every `turn/start`** and rejects any op whose fence < current." A capability op launched in turn N carries fence=N. A minutes-to-hours op (the doc's own examples) is still running when the worker's turn N ends and the orchestrator issues turn N+1 — `turn_epoch` is now N+1, and the running op holds a **stale fence.** Per the stated rule, its resume/cancel/result interactions are rejected with `stale_fence`. Turn-scoped fencing — the mechanism deliberately chosen to kill stale-turn steers — **structurally cannot govern a cross-turn operation.** The uniformity the framework asserts ("fenced like a control op") is forbidden by the concurrency model it inherits.

**Scenario/evidence.** Worker w3 kicks off a 20-minute `index.build` in turn 7. Turn 7 completes; orchestrator sends turn 8 (epoch→8). At minute 20 the index build emits `capability.op.completed` with fence 7. The supervisor rejects it (7 < 8), or the worker can no longer `cancel`/`resume` its own job. Either the result is dropped or the long op is unkillable through the fenced path — the exact liveness failure the fence was invented to prevent, now re-created for the whole capability plane.

**Severity: serious** (a genuine cross-plane contradiction; either "fenced like a control op" is wrong or every long capability op breaks on the next turn).

---

### SERIOUS 5 — The trust spine's economics ("proving is hard, checking is easy") are false for the MVP case and true only for an unscheduled tail.

**Claim attacked.** math-proof: "That asymmetry (proving is hard, checking is **easy-and-independent**) is the whole game." doc 11: "Forging a result the hub re-verifies **in milliseconds** is pointless." The premise that `reverify` is cheap enough to run on *every* trusted claim.

**Why it fails.** For the MVP rungs (`test`, `proptest`) `reverify` = **re-run the suite** — identical cost to the original run, doubled and serialized through the hub's sandbox, on a fleet whose entire value proposition is *speed via parallelism*. The module's own critic pass demolishes the universality: "'Checking is easy' is rung-dependent... **False for R5**: DRAT/LRAT UNSAT proofs are routinely gigabytes and checking can equal or exceed the original solve time." The one rung where checking << proving (Lean kernel) is deferred to "Later" and, per finding 2, unsound without an unspecced axiom audit; Python/JS/Go "top out around R2–R3.5," i.e. reverify ≈ re-run. capability-plane open-q #1 concedes the whole thing is unsolved: "Is `reverify` always cheap enough... or does the hub **sample**?"

**Scenario/evidence.** A fleet of 8 workers each finish a task with a 90-second test suite. The hub, being the sole authoritative verifier, must re-execute all 8 suites (12 minutes of serialized hub-side sandbox compute) to trust them. The advertised "near-free re-runnability" is, for the actual shipped capability, a **100% verification tax** that scales with task count on a single serialization point (see finding 7). The stack sells re-runnability as a system property; it's cheap only in the formal-methods tail that isn't built.

**Severity: serious** (the trust model's cost model is inverted for the common case).

---

### SERIOUS 6 — The `atlas` MVP is sliced along the axis that *minimizes* its own thesis and leads with an admitted-unproven cost mechanism.

**Claim attacked.** doc 11 module 1: `atlas`'s dirty overlay is "the **defining multi-agent constraint nobody else solves**." doc 11 cross-module MVP: "`atlas` lexical+structural search (**drop semantic and graph** initially)." The MVP "proves... shared agent-shaped tools... beating N workers each grepping."

**Why it fails.** Two ways. (a) The MVP ships the overlay whose viability is explicitly unproven — doc 11 risk #2: "the overlay can approach re-index cost; the... threshold is **unproven**"; capability-plane open-q #3: "does the overlay become as **expensive as re-indexing**?" (b) The amortization argument ("index once, read N times") is strong only for *expensive-to-build* indices (semantic/graph) — which the MVP **drops** — and weak for *lexical*, where a worker's own `rg` over its worktree is already millisecond-fast. So the MVP carries the *most* overlay-consistency complexity for the *least* amortization payoff, over exactly the index type where a solo worker doesn't need a shared service at all. It cannot demonstrate "beats N workers each grepping," because for lexical search N workers each grepping their own worktree is already near-optimal.

**Scenario/evidence.** Bench the MVP `atlas` (shared lexical base + per-worker dirty overlay) against 8 workers each running `rg` locally. The overlay must re-scan each worker's dirty files anyway; the shared base only saves work on clean files, where `rg` was already fast. The measured win is marginal-to-negative, and the interesting index (SCIP/LSP graph, where sharing genuinely amortizes) is the deferred part. The MVP proves the thesis on the one workload that doesn't need it.

**Severity: serious** (the flagship capability MVP is engineered to fail its own falsification test).

---

### SERIOUS 7 — The "stigmergy scales O(N)" story funnels through a single hub that is sole fence authority + sole ledger writer + sole approval arbiter + sole reverify executor + sole capability host, with no throughput model.

**Claim attacked.** doc 10 T3: "direct AAI is **O(N²)** chatter that... doesn't scale; stigmergic AIAI is **O(N)** reads/writes against shared structure." Sold as the scaling rationale for the whole architecture.

**Why it fails.** doc 08 §4: "The event ledger is the **only append point** and the source of truth... the hub multiplexes." supervisor open-q #1: "one process owning N adapters (**single fence authority, single point of failure**)... Leaning single-process." So the "shared substrate" is not a distributed medium — it's **one process's SQLite + JSONL.** Every stigmergic read/write, every fence check, every approval, every `reverify` (a full test re-execution, finding 5), every index overlay is a call into that one process. The elegant O(N) coordination is O(N) load on a serialization point that *also* performs O(tasks) full re-executions. There is no hub-throughput estimate anywhere, and the corpus's governing principle (user CLAUDE.md, echoed in "let resource availability be the natural throttle") forbids admission control beyond a disk-watermark. The abstraction claim (stigmergy scales) is true at the abstraction; the implementation (one hub) is the undiscussed bottleneck.

**Scenario/evidence.** At N=20 workers each completing a task every few minutes, the single hub must serialize: 20 event streams' fsync-batched appends + fence arbitration + per-completion sandbox re-execution of every verification. `reverify` alone saturates the box (finding 5) long before the "O(N) stigmergy" abstraction is stressed. The design never says at what N the single hub tips over, and its own no-arbitrary-limits principle means it won't backpressure until the disk fills.

**Severity: serious** (the headline scaling argument is defeated by the mandated single-hub topology it never prices).

---

### SERIOUS 8 — The interop payoff (heterogeneity → ensemble) is mutually exclusive with the economics (subscription arbitrage) at the exact vendor-ceiling boundary both depend on.

**Claim attacked.** doc 12 §3 (the "core-intent" payoff): "'different harnesses fail differently' stops being a liability and becomes an **ensemble** — **best-of-N** across Codex/Claude/GLM with the hub as the judge. Heterogeneity is the asset."

**Why it fails.** The stack's own constraints kill it. doc 12 open-q #5: the ensemble "**multiplies cost by N and hits per-vendor concurrency ceilings**." adapter-contract + doc 06 Q7: GLM "**Pro ≈ 1 in-flight**" is a "hard" scheduler input, and GLM's `usage_fidelity` is "⚠️ (Z.ai-side reporting unverified)." So a "best-of-3 including GLM" is **serialized on the GLM leg** and **unmeterable** in cost. Meanwhile the whole economic case (doc 06 Q2, "subscription arbitrage... marginal task is free") depends on those same flat-rate plans whose ToS and concurrency tiers are exactly what forbid running N-at-once. You can have the free-marginal-cost story **or** the best-of-N quality story; at the vendor ceiling you cannot have both.

**Scenario/evidence.** Operator wants the advertised ensemble on a critical task: Codex + Claude + GLM, hub judges. The GLM Pro plan admits 1 in-flight, so that leg queues; the run's cost includes an unmeterable GLM component (`usage_fidelity ⚠️`), so the budget engine (finding depends on cost accounting) is flying blind on a third of the ensemble. The "heterogeneity is the asset" payoff degrades to "pay N× real API dollars and abandon the subscription economics, or serialize and wait." The two flagship values cancel.

**Severity: serious** (the two headline benefits are in direct economic contradiction, acknowledged only in an open question while still sold as the §3 payoff).

---

### ANNOYING 9 — The "deferred northbound or we poison our own orchestrator" MUST rests on a per-vendor client feature unconfirmed for the orchestrator the roadmap builds first.

**Claim attacked.** doc 12 §3: "The northbound socket **must be deferred / code-mode, or the hub poisons its own orchestrator** — aggregating the whole control+capability+knowledge surface as flat MCP tools is the exact pathology."

**Why it fails.** doc 12 open-q #2: "Deferred tool loading **depends on each harness's client supporting it** (Anthropic does; **Codex `mcp`/Gemini?**)." The roadmap's M0/M1 headline is Codex-as-orchestrator. If Codex's MCP client lacks `defer_loading`/tool-search, the primary orchestrator gets the flat surface — and as the capability catalog grows to 7 modules × several ops + control verbs + knowledge verbs, that flat surface is precisely the "fatal pathology" the doc names. A hard MUST is predicated on an unverified, vendor-controlled, moving feature on the first orchestrator built.

**Scenario/evidence.** M1 wires the northbound `fleet_*` + first capability ops into a Codex orchestrator whose MCP client loads tools flat. Selection accuracy degrades ("collapses past a few dozen tools," doc 12's own citation) exactly as the catalog grows — the interop layer's answer to its central risk is unavailable on the harness it shipped against.

**Severity: annoying** (real, but a per-vendor gap with a stated fallback — "statically scoped small surface" — not a whole-stack contradiction).

---

### ANNOYING 10 — The differentiating M1 demo beats a strawman competitor.

**Claim attacked.** doc 07 M1: "orchestrator dies/restarts mid-fleet and resumes command with pending approvals and worker state intact... A **for-loop loses everything on Ctrl-C**; the hub doesn't. This is the smallest thing that proves the architecture earns its complexity."

**Why it fails.** The real competitors aren't a naive bash for-loop. Codex ships `thread/resume`/`thread/list` (durable threads); Claude ships `--resume` over JSONL transcripts; OpenAI's own plugin has a session-scoped job ledger with `--wait` (doc 08 §6 lists it). **The vendors already persist worker + pending state across client restarts** for their single-vendor case. So "orchestrator restart resumes command" proves baton didn't *discard* durability the vendors already provide — it does not prove cross-vendor orchestration beats single-vendor delegation, which is the actual thesis (doc 06 Q1). The genuinely-hard question (does the orchestra beat the soloist) is the ~10-task eval, and M1 front-loads the cheap durability demo as the headline while the falsification sits behind it.

**Scenario/evidence.** The M1 demo succeeds impressively; a skeptic notes `codex exec` jobs already survive a client restart via `thread/resume`, so the demo differentiates baton from a strawman, not from the tools it must beat. "Earns its complexity" is asserted against the one competitor nobody uses.

**Severity: annoying** (the demo is real and useful, but mis-billed as the thing that justifies the architecture).

---

### Meta-framing (applies to the whole target)

It is, right now, **literally a doc pile** — zero contact with any running system. The original timeline is self-described as "**fiction**" (doc 07). The flagship module relies on tools its own critic pass found **aren't installed**. And the corpus's confidence is *closed-system internal coherence*: every red-team finding carries an ID and a "disposition" adjudicated **back into the specs by the same author** ("verifiers ruled attacks... 'closed by `spec/supervisor-state-machine.md`'"). That density reads as rigor, but nothing has been *falsified against a system* — the first empirical number (M0 exp 4, the honest baseline) does not exist and, per finding 3, its milestone can't fit its timebox. The control plane is the one part specified tightly enough to plausibly ship. Everything the docs call the reason to exist — stigmergy, the capability plane, proof-carrying trust, the context composer, the ensemble — is unscheduled, and where designed, floats beside the spec it claims to implement (math-proof critic: "reads as if written **before the capability-plane spec existed**"). The pile is coherent the way a closed formal system is coherent: with itself, and not yet with the world.

## BLUE
## Blue-team: architecture-buildability

Verdict up front: the red team lands real hits, but almost all of them are *marketing-vs-shipped* and *sequencing* gaps, not structural impossibilities. Two mechanisms the red team consistently misreads — the **`latency_class` interactive/task split** and the **"reverify runs in a sandbox, never on the hub" locus** — defuse the two "fatal" concurrency/economics arguments. The genuinely fatal item is narrow and already self-identified by the design's own critic pass: one false sentence. Per-finding below.

---

### FATAL 1 — the differentiated planes are in no milestone

**Verdict: concede-and-fix** (not fatal — the fix is one gated milestone, and the build order is *forced*, not arbitrary).

The factual claim is correct: grep doc 07 M0–M3 and the capability/knowledge/context planes are unscheduled. I won't pretend otherwise. But two mechanisms make this a sequencing bug, not incoherence:

1. **The dependency order forces control-plane-first — you cannot build the capability plane before its substrate exists.** The capability plane is *defined in terms of* control-plane primitives: `spec/capability-plane.md` §1 fences every op with the supervisor's `(worker, turn_epoch)`; §3's `cursor` is "at-least-once (spec I3)"; §6 says "Capabilities are where supervisor **I7** gets its teeth"; law 3 puts long ops "in the task-DAG" (doc 08 §3a). M0/M1 build exactly the ledger, task-DAG, I3 cursors, I7, and fencing the capability plane stands on. So M0/M1 are not "a different product" — they are the *foundation the differentiated product is bolted to*, and the order is the only buildable one.
2. **"Modules earned by demand" is a stated discipline, not an omission** (doc 11 §MVP: "The framework is the deliverable; the modules are earned by demand"; capability-plane §8 same).

The real defect: docs 11/12 and `spec/capability-plane.md` were written *after* doc 07's round-1 rewrite and doc 07 was never updated to place their "one thin vertical" in the milestone sequence. **Fix:** add a named, gated milestone — call it **M2-Capability** — shipping capability-plane §8's exact vertical (`atlas` lexical+structural + validation `test`/`proptest` + `Cartographer` `repo_map` + `Cairn` scorecard), *depending on* the M1 substrate and *gated on* the M1 eval, and carrying the same "falsifies something measurable" contract the rest of doc 07 uses (its falsification test — capability-plane §8: "shared, agent-shaped, re-runnable search beats N workers each grepping" — is already written). Also add one sentence to doc 07 stating M0/M1 are *foundation, explicitly not the differentiated product*.

**Residual:** until that milestone is written and estimated, doc 07 *is* the plan-of-record and a builder who follows only it ships the supervised for-loop and stops. The red team's coherence critique has teeth as a **documentation-reconciliation debt**: the corpus rhetorically centers the bet (doc 10 §0) while funding only its foundation, and nothing in the corpus today crosses that gap. That reconciliation is owed before the roadmap can be called honest.

---

### FATAL 2 — the I7 that ships has the hole the advertised I7 closes

**Verdict: concede-and-fix, with one concede-fatal sub-claim** (the crown-jewel sentence) **and a large permanent residual.**

I concede the core: the *shipped* M1 I7 ("re-executes the brief's verification independently, in a sandbox," supervisor line 29) is re-run-the-test-command, and the math-proof doc says verbatim that "mere re-execution only catches lying about the exit code — it does not catch a weak test suite the worker authored to pass." The rich I7 (mutation, proof-carrying, kernel re-check) is unscheduled (= Finding 1).

- **Concede-fatal, as-written:** the sentence "a worker literally cannot hand back a proof term the hub's kernel accepts unless it is valid" is **false** — the design's *own* embedded critic proves it (`sorryAx`, `axiom cheat`, `native_decide` all pass `lean4checker`). This must change. The fix is already written by that critic: forgery-resistance is **three conjuncts** — kernel type-checks + `#print axioms` audit (used set ⊆ allowlist, no `sorryAx`) + no `native_decide`/`ofReduceBool`/`implemented_by` on the trusted path. Cheap to close; must be closed before the claim is repeated.

But the *architecture* survives, on three mechanisms the red team steps past:

1. **The shipped I7 closes the forgery it was actually built for.** C1 (doc 09) — the finding I7 exists for — is "a worker can *fabricate* a green verification and a fake provenance frame," i.e. claim `exit 0` without running anything. Re-execution in a fresh sandbox closes *that* completely. The weak-suite attack (author `assert True` + real code) is a strictly weaker, different attack, and one that *every* single-agent and human-review baseline also has — baton is strictly better than baseline, not worse.
2. **Cross-review is scheduled in M1 and is the design's stated answer to weak suites.** `fleet_review` (doc 07 M1) has a *different-vendor* worker read the diff — a vacuous `assert True` beside a real change is exactly what an adversarial reviewer catches. So the weak-suite gap is attacked at M1 by a mechanism that *is* on the roadmap, independent of the deep rungs.
3. **The cheap teeth are one installable tool away.** Fold `cargo-mutants` (R1.5) into the M2-Capability vertical: the mutation score is a *hub-computed number the worker can't author*, which is precisely "strength not authored by the checked party" without waiting for Lean. The critic already specified this as the minimal non-redundant MVP.

**Fix set:** (a) correct the crown-jewel to three conjuncts; (b) scope the "re-verifies in milliseconds / worker cannot forge" language to the rungs where it holds (proof term, counterexample), never over bare `test`; (c) add `cargo-mutants` to the shipped vertical so the *deployed* trust model resists weak suites; (d) drop "installed and demoable" for Kani/CBMC/Lean/Alive2 (only `z3` is present) and re-scope the demo to `cargo-mutants + z3-with-checkable-verdict`.

**Residual (permanent):** even fixed, baton buys "provably satisfies *this stated property*," never "does what you meant" — the autoformalization ceiling (doc 11 risk #1). Mutation testing has its own false-negative rate; cross-review is probabilistic. The security thesis must be *marketed at the rigor that ships*, which is "independently re-checked, strength-audited per rung," not "unforgeable."

---

### SERIOUS 3 — M0 impossible by its own arithmetic

**Verdict: concede-and-fix on the estimate; defend the structure.**

The red team collapses a distinction the design depends on. **M0 is a measurement spike; M1 is the tested, fault-injected supervisor.** The 2–3-week number (supervisor §6) is explicitly "to a *tested* skeleton … because the tests are the hard part (fault injection: kill the worker mid-approval, cancel `fleet_wait` mid-return, race human+orchestrator on one fence)." M0 delivers *none* of that fault-injection proof — its four deliverables are *numbers* (does the bounded-poll loop survive a real host timeout; steer timing; interrupt→confirmed latency and whether a shell child outlives the ack; for-loop vs hub on 5 tasks). A naive bounded-poll loop with 10s heartbeats (a while-loop + a timer) is the *cheapest* of the invariants; the expensive I1/I2/I6-under-adversarial-concurrency is M1's "real work." Experiment 3 in particular is meant to *characterize the danger window that I6 then fixes* — you measure the raw adapter precisely to learn how much I6 machinery you need.

**Concede two real points:** (1) the "~1 week" is optimistic — persistent `codex app-server` child + `claude -p` stream-json child + adapter-owned outbox + six northbound tools + a poll loop, across *two* vendors, is plausibly 2–3 weeks; (2) experiment 1's number is only *honest* with I3's at-least-once durable cursor (a naive at-most-once spike would report a spuriously-good result until an approval rides the dropped page — doc 09 A1). So a slice of M1 (I3) legitimately belongs in M0.

**Fix:** relabel M0 "~2–3 weeks," state it builds a *durable-cursor (I3) + minimal-bounded-poll (I4)* spike, and that I1/I2/I6-under-fault-injection is M1. **Residual:** the M0/M1 boundary is genuinely fuzzy (I3 leaks left), and doc 07's own §6 estimate already contradicts its "~1 week" header — the header is the error, and it should inherit §6's number.

---

### SERIOUS 4 — capability ops "fenced like a control op" but outlive turns

**Verdict: concede-and-fix.** This is the sharpest *architectural* finding and it names a real spec conflation — but the mechanism to resolve it already exists and the red team quotes past it.

The governing distinction is `latency_class`, `spec/capability-plane.md` §5: **`interactive` (< budget, returns inline)** vs **`task` (task-DAG node, progress events, interruptible)**. The `(worker, turn_epoch)` fence in §1 governs the **invoke decision and interactive ops** — "a stale-epoch **invoke** is rejected" — which is correct: a stale worker must not *launch* new work against a dead turn, and an interactive op that must return in-turn is rightly turn-scoped. A **task-class** op, once admitted, is promoted to a task-DAG node with its own durable identity (`job_id`/`dag_node_id` — see the math-proof `verify_run -> {job_id, dag_node_id}`), its own `cancel(handle)` (Capability interface), I6 two-phase stop, and I3 cursor delivery — **all turn-independent.** Its result lands as a `capability.op.completed` ledger event read by cursor, not gated on the turn epoch. So a 20-minute `index.build` is governed by the *task* lifecycle, not the turn it was born in.

**Concede the spec debt the finding correctly exposes:** doc 11's parenthetical "a task-DAG node — leased, **fenced (`turn_epoch`)**" over-applies turn-scoping to task-class ops, and the supervisor's `Lease.fence` comment — "fence increments on every takeover/**epoch bump**" — couples the *lease* fence to the *turn* epoch. Read literally, that churns worktree leases and long ops every turn (and would also break the M1 restart demo's leases). That's a genuine bug in the text.

**Fix:** split the two fences the design currently blurs. A **freshness fence** (`turn_epoch`, bumps every `turn/start`) governs steer/nudge/answer splice-prevention — the thing I1 was actually invented for (doc 09 A6). An **authority/lease fence** (bumps on *takeover* only) governs op-admission, worktree leases, and task-DAG-node lifecycle. Task-class ops are fenced by the authority fence and cancelled/resulted through their `job_id`, never through `turn_epoch`. Correct the `Lease.fence` comment and doc 11's parenthetical accordingly. **Residual:** real spec-editing debt across three files; and someone must decide precisely which fence gates the *launch* of a task-class op (authority fence, but state it). Buildable, not architecture-fatal.

---

### SERIOUS 5 — reverify economics inverted for the MVP case

**Verdict: defend the economics; concede the phrasing.**

The "100% verification tax on a single serialization point that saturates the box" rests on a factual misread the design corrects in three places: **reverify runs in "the worker's (or a fresh throwaway) sandbox — never on the hub"** (supervisor I7 line 29; capability-plane §6; doc 09 C2). The hub *initiates and trusts* the verdict; it does not *execute* the suite in-process or necessarily on the hub box. So:

- Not a single serialization point for *compute* — 8 tasks' re-runs are 8 independent sandboxes, embarrassingly parallel, bounded by box compute, not hub mutex.
- Not per-turn or per-claim — reverify fires **once per task terminal transition** (the merge gate). A task is minutes-to-hours of worker work (coordinative tempo, doc 08 §1); one 90s suite re-run at its gate is a small tax against the whole task, not a doubling. The "doubled cost" framing assumes the suite dominates task cost, which it rarely does.
- Cache-keyed — deterministic re-runs are content-addressed (capability-plane §4; the closure-keyed cache); identical obligations collapse to a hit.

**Concede:** the *language* — "re-verifies in milliseconds," "near-free re-runnability," "proving is hard, checking is easy — the whole game" — is over-general, and the design's own critic says so ("'Checking is easy' is rung-dependent … **False for R5**"). **Fix (the critic's reframe):** the load-bearing invariant is **independence** (a checker whose strength the worker didn't author), not *cheapness*; cheapness becomes a per-rung `card()` annotation, and `reverify` on cheap/deterministic rungs is "one sandboxed suite-run at the gate," not "milliseconds." capability-plane open-q #1 already carries the escape valve for the expensive tail (always re-run cheap/deterministic; sample expensive/non-deterministic). **Residual:** for a short task with a long suite, the merge-gate re-run *is* a non-trivial fraction of task cost, and the sampling policy is still a "leaning," not a decided mechanism.

---

### SERIOUS 6 — atlas MVP sliced to minimize its own thesis

**Verdict: concede-and-fix the benchmark framing; defend the slicing.**

Defend: the red team misidentifies *what atlas amortizes*. It is not "lexical search is slow to run" — it is the **persistent index build** that's shared. doc 11's own `fff` grounding: an in-memory index is "**~1000× faster than spawn-per-query ripgrep after one scan.**" N workers each doing spawn-per-query `rg` (or each rebuilding a trigram/CST index) on a large repo (doc 11's 500k-file example) is the waste removed; the shared, content-addressed base index is the amortization, and it holds for *lexical* on large repos, not only for semantic/graph. Structural search (ast-grep CST) *is* in the MVP and *is* genuinely expensive to build. And the overlay is shipped in the MVP **on purpose because it is the risky novel thing** — "the defining multi-agent constraint nobody else solves (N worktrees diverge)"; shipping the risk first is correct MVP design.

Concede: the *falsification axis* is mis-stated. If the MVP's headline is "beats N workers each grepping" measured as **query wall-clock on a small/medium repo**, N parallel local `rg` is near-optimal and atlas shows marginal-to-negative — the red team is right. **Fix:** state the MVP's real, right-axis falsification tests, all already implied by the corpus: (a) **index-build amortization on a large repo** (where per-worker rebuild/spawn-per-query dominates — the `fff` result); (b) **context-token reduction** — the ACI envelope's "~400 tokens, not 40,000" (capability-plane §3), a rung-independent win true even when raw `rg` is fast; (c) **overlay correctness + cost under divergence** — measure risk #2's unproven threshold ("the overlay can approach re-index cost") rather than assume it. **Residual:** on small/medium repos the shared *lexical* service genuinely may not beat local `rg` on speed; there, atlas's value rests entirely on the context-token and overlay-correctness axes — narrower than "the constraint nobody solves" rhetoric implies, and the corpus should say so.

---

### SERIOUS 7 — single hub is sole authority for everything, with no throughput model

**Verdict: defend the architecture; concede the missing number.**

The heaviest term in the red team's serialization argument is wrong: **reverify does not execute on the hub** (I7/§6/C2), so "reverify alone saturates the box" fails. Beyond that:

- **The ledger is per-worker JSONL, not a global mutex** — doc 08 §4: "one writer per worker stream … **one file per worker sidesteps interleaving entirely**"; SQLite is "a *projection* rebuilt from the ledger." The "single seq serialization point" (doc 09 C6) is a monotonic stamp + batched WAL commit — a light point, not a compute chokepoint.
- **The heaviest stigmergic medium bypasses the hub.** git/worktrees carry a large fraction of T3 coordination (doc 10 T3: "claude-squad's whole model is stigmergic") with *zero* hub round-trip; the artifact store is content-addressed files; the index *base* is immutable/content-addressed (read-mostly, cacheable). Only the ledger tail, `Scratch`, and the overlay are hub-mediated.
- **Single-hub is a priced-deferred choice with a named exit** — doc 07 defers "multi-hub federation … **until a second machine actually hurts**"; doc 06 "one-box first." And backpressure via *physical* constraints exists (disk-watermark admission pause, C6; per-vendor concurrency ceilings as the real throughput throttle) — the "no arbitrary limits" rule explicitly permits limits "derived from a physical resource constraint," so it does *not* forbid backpressure.

**Concede the genuine gap:** there is **no hub-throughput model** — no measured events/sec the ledger+projection sustains, no fence-op latency under N, no cursor-serve p99, and supervisor open-q #1 leaves single-vs-multi-process open. The disk-watermark guards *disk exhaustion*, not *latency degradation* under fence-arbitration/cursor-serve contention. **Fix:** make hub throughput an M1/M2 experiment — state the single-hub tip-over N as a measured number, with a stated fallback (further-shard the ledger, move the SQLite projection off the hot path, split fence authority per-worktree). **Residual:** fence arbitration and cursor-serving *are* hub-serialized (lightweight but not free); under a pathological event rate the single hub is a real ceiling whose N is unknown until measured. The design owes that number.

---

### SERIOUS 8 — ensemble (best-of-N) vs economics (subscription arbitrage) cancel

**Verdict: defend the mutual-exclusivity claim; concede the GLM cost-accounting.**

These are **two operating modes for two task classes, not one contradictory claim.** doc 06 Q1 is explicit: cross-vendor's high-value uses are "(a) cross-review and (b) parallel *independent* tasks — **both coarse-grained**." Best-of-N is reserved for the *critical* subset (doc 12 §3's own words, "on a critical task"); subscription arbitrage is for *bulk independent* work. And the design already prices best-of-N as a *learned N×-cost threshold*, not a free lunch — doc 12 open-q #5: "when is decorrelation worth the N×, and does the scorecard learn that threshold?" The two coexist because they apply to **different tasks under different auth postures**: bulk subscription work (subscription auth, concurrency-ceiling-throttled, cheap) vs critical ensemble (**API-key — the default unattended posture, doc 07 M1 / doc 09 F5** — N× real dollars, correctly metered). `auth_posture` is a per-worker card field (doc 06 Q7), so this is a config knob, not a contradiction. GLM's Pro ≈ 1-in-flight is "a hard *scheduler input*" — a best-of-N including GLM simply serializes the GLM leg, a latency cost the orchestrator sees and may decline.

**Concede one real hit:** GLM's `usage_fidelity: ⚠️` (adapter-contract) means an ensemble leg run over *subscription* GLM is genuinely **unmeterable** — the budget engine is blind on that third. **Fix:** in ensemble/best-of-N mode, *require* a metered posture (API-key) on every leg, or forbid a best-of-N leg over a `⚠️`-fidelity subscription worker, or estimate its cost from token-count with a stated error bar. And rewrite the §3 payoff sentence to say plainly what doc 06 Q1 already implies: **best-of-N is the critical-task, API-billed mode, economically distinct from bulk subscription arbitrage.** **Residual:** on GLM specifically you cannot have *both* subscription economics *and* a metered ensemble leg — you pick per-leg; the "heterogeneity is the asset" line oversells by not stating which auth posture it assumes.

---

### ANNOYING 9 — deferred-northbound MUST rests on an unconfirmed Codex feature

**Verdict: defend (fallback already specified); minor residual.**

The MUST is not "deferred loading or catastrophe" — the pathology is *a large flat surface*, and the design already names *two* ways to a small one. doc 12 open-q #2: "Where unsupported, the worker gets a **statically scoped small surface per task-class** instead — a coarser projection of the same principle." Further:

- The **M0/M1 orchestrator surface is small by construction** — six northbound tools at M0, ~a dozen at M1, well under doc 12's own "few dozen" cliff.
- The **capability catalog is worker-facing, and the orchestrator sees only digests** (doc 10 §6 Q4; doc 12 §1d: "The orchestrator sees capability *digests*, never raw ACI"). So catalog growth does *not* flatten the *orchestrator's* surface — the exact place the finding worries about.
- Codex has minimal-static-surface paths that need no `defer_loading`: the two-tool **`codex mcp-server`** (doc 07 M1) and code-execution-over-MCP (doc 12 §2).

**Residual:** real — the *elegant* per-task deferred composition is Anthropic-confirmed only; on the Codex orchestrator baton runs the *coarser* static projection (less precise tool scoping), and the selection-accuracy cliff for Codex's client is unmeasured. Fix: make "measure Codex MCP client tool-count degradation" an M1 experiment; ship the static-scoped surface on Codex until it lands `defer_loading`.

---

### ANNOYING 10 — the M1 demo beats a strawman

**Verdict: defend (the actual-thesis falsifier is in M1); concede the rhetoric.**

The finding half-concedes the design's own move: **the solo-vs-fleet eval is in M1 as the exit gate**, not deferred — doc 07 M1: "arms (a) best solo vs (c) fleet on ~10 tasks; **explicit pivot criteria** (fleet ≤ solo pass-rate and >1.5× wall-clock → halt and rethink)." So "does the orchestra beat the soloist" (doc 06 Q1) *is* the M1 falsifier; F1 (eval) and F2 (restart demo) are *separate* deliverables with separate purposes, not conflated. And the restart demo differentiates on the axis that matters: single-vendor `thread/resume`/`--resume` persist a *single-vendor worker*; none persists **cross-vendor fleet orchestration state** — pending approvals + worktree leases + fence epochs + task-DAG across heterogeneous workers — because none *is* a cross-vendor orchestrator. That state is exactly what a for-loop *and* a single-vendor delegator lose on restart.

**Concede:** billing the demo against "a for-loop loses everything on Ctrl-C" picks the weakest comparator and *undersells* — a skeptic will (correctly) note single-vendor tools have resume. **Fix:** reframe against *single-vendor durable delegation* — "no single-vendor tool persists cross-vendor fleet-orchestration state across an orchestrator restart" — and let the already-scheduled M1 eval carry the thesis. **Residual:** purely rhetorical; the demo is real and correctly placed, only its comparator is badly chosen.

---

### Meta-framing

**Verdict: concede the epistemic status; reject the implied fatality.** Yes — it is pre-implementation, the first empirical number (M0 exp 4) does not exist, and closed-system coherence is not world-contact. The design says so (doc 07 "fiction"; the honest residuals; the critic passes). What the meta-framing under-credits: this corpus is unusually **falsifiable-by-construction** — it front-loads the eval with *halt-and-rethink* pivot criteria (doc 09 F1), scopes M0 as a *measurement spike whose entire job is world-contact numbers*, and embeds adversarial critic passes that **contradict the author** (the math-proof critic calling the crown-jewel claim false is the author publishing his own refutation, not self-ratification). The correct verdict on the whole target: the **control plane is spec'd tightly enough to ship and is the right foundation**; the capability/knowledge/context planes are researched but **unscheduled**, and where designed (math-proof) **float beside their own spec**. The remedy is the same three moves Findings 1/2 demand — (1) schedule the capability thin-vertical as a gated M2 milestone with its own falsification test; (2) correct the over-claims so marketed rigor equals shipped rigor; (3) produce the M0 numbers before any further capability design. That is, verbatim, doc 09's own disposition: "**Nothing rejected as a blocker. The architecture stands; the work is hardening, honesty, and sequencing.**"

**Net for architecture-buildability:** no finding is fatal to the *architecture*. One sub-claim is fatal *as written* (the crown-jewel sentence — Finding 2, fix already authored). The rest resolve to: schedule the capability vertical (1), scope the trust marketing to shipped rigor (2, 5), correct the fence-granularity conflation (4), fix the M0 estimate (3), pick the right benchmark axes (6, 10), and produce two missing numbers — hub throughput (7) and metered-ensemble cost (8). All buildable; the honest residuals (autoformalization ceiling, small-repo lexical marginality, single-hub tip-over N, GLM unmeterability) are ones the corpus already half-names and should promote to first-class.

## EXPLORE & VERDICT
## Explore & verdict: architecture-buildability

I read the load-bearing files (docs 00, 01, 04, 07, 10; specs) plus the red/blue passes. Stepping past attack/defend: the buildability question has been argued *inside* baton's own frame — "can we build the four-plane stack, in what order." The more honest question the user's "analysis of replacements" invites is whether the **frame that bundles four planes into one product** is right at all. It mostly isn't. Here's the case.

### Strongest alternative

**Unbundle. Ship the cross-vendor supervision layer as the entire product; demote the capability/knowledge/stigmergy planes to optional downstream consumers; and lean on ACP as the default southbound tier so you never own the adapter treadmill.**

This is a *reframe*, and it's bracketed by two calibration points that make its shape clear:

- **10× smaller (the floor):** the one capability in the whole corpus with a shipping existence proof is cross-vendor diff review — OpenAI's `codex-plugin-cc` stop-hook that "runs a Codex review on every Claude turn" (doc 01 §6). A worktree runner + "have a different-vendor harness review this diff" captures most of the *demonstrated* value with no supervisor state machine, no ledger, no capability plane, no stigmergy.
- **Do nothing / wait (the ceiling):** the industry is building baton's substrate right now, and baton owns almost none of it. Doc 01 §1: ACP "specifies **complete orchestration semantics for driving a subordinate harness**" — session lifecycle, cancellation, permission routing, streaming telemetry — with **35 agents** in the registry and both flagship Claude/Codex adapters "maintained by the protocol org / Zed, **not by Anthropic or OpenAI**." A2A donates the task-lifecycle state machine; MCP tasks donates the 5-status long-op vocabulary; Anthropic agent teams already ships the hub/ledger/mailbox/task-DAG/file-lock shape — its *only* gap is cross-vendor (doc 01 §6: "its single-vendor boundary is exactly baton's reason to exist").

The strongest alternative sits between these: **build the one genuinely-unowned, genuinely-novel thing — reliable cross-vendor supervision (durability, fenced steering, two-phase stop, hub-run verification) — and stop there until it proves value.** Everything the capability/knowledge/stigmergy planes do is either (a) not cross-vendor-specific at all, or (b) already being attacked by others, or (c) cheaply realized by the control plane's own ledger + git.

### Honest comparison

Where the alternative beats baton's current frame:

1. **The two "MVPs" stop being disjoint by *declaring the scheduled one to be the product*.** Red's FATAL 1 (the roadmap builds a supervised for-loop; docs 10–12 describe a different system) and blue's concession ("documentation-reconciliation debt... the corpus rhetorically centers the bet while funding only its foundation") are the *same fact*. The alternative dissolves it: the control plane isn't the "foundation for the real product," it *is* the product. Doc 01 §6's own verdict — "all partial, **none cross-vendor-with-protocol**" — says this layer alone is unowned and sufficient to be first.

2. **It exposes a category error the frame hides.** The capability/knowledge/stigmergy plane has *nothing to do with cross-vendor orchestration.* A shared code index, a validation ladder, an operational blackboard help a *single-vendor* fleet identically. Baton bundles "cross-vendor harness control" (novel, unowned) with "multi-agent coordination substrate" (vendor-agnostic, crowded — agent teams' shared task list, claude-flow, et al.). These are two products with two theses, and the second dilutes the first's clarity.

3. **The stigmergy "bet" is oversold on the wrong axis.** Doc 10 §0: "The design **bets** that the third — stigmergic coordination — is **where the leverage is**," justified (T3) as "direct AAI is **O(N²)**... stigmergic AIAI is **O(N)**." But the system's own economics forbid the N where O(N²) bites: subscription concurrency ceilings ("Pro ≈ 1 in-flight," doc 01 §7) and "one-box first" cap the fleet at *handfuls* per vendor. At N=8, O(N²)=64 is not a wall. The *real* reason to prefer shared substrate is narrower and correct — keeping untrusted worker prose out of the orchestrator's scarce context (doc 05/09 D4) and "the medium is the record" auditability (doc 10 law 5). That's a hygiene principle, not a moonshot — and blue's own FATAL-7 rebuttal concedes "the heaviest stigmergic medium **bypasses the hub** — git." So you get ~80% of the stigmergy value free from the control plane's ledger + git; the elaborate modules (atlas overlay, Cairn, Cartographer) are the expensive 20% tail with the weakest evidence (red's SERIOUS 6; the overlay threshold is "**unproven**").

Where baton's frame beats the alternative — and why this is REVISE not REPLACE:

- **"Just use ACP" builds the differentiator on the one thing ACP refuses to guarantee.** Baton's whole reason to exist is *reliable* steering/interruption. Doc 01 §2: A2A/ACP mid-run steering is "**agent-discretionary (MAY)**; the guaranteed steering path flows through `input-required`" — i.e. you can't preempt, you can only wait to be asked. Doc 04 Option B already rejected ACP-everywhere: northbound "an orchestrator agent **cannot be an ACP client from inside its own loop**," southbound ACP is LCD ("no `turn/steer`, no goal pinning, no usage telemetry — first-class adapters would be **downgrades**"). So ACP replaces the *southbound adapter* but neither the northbound hub nor the supervisor — which is most of baton's code. Correct synthesis: ACP is the *default* southbound tier (which doc 04 Option B⊂A already states), and baton owns raw adapters *only* where LCD costs it steer/usage — a "lean harder on the tier you planned," not a replacement.
- **The event-loop problem is real and unowned.** Doc 04's crux — bridging push-shaped workers to a pull-shaped CLI orchestrator — is a genuine engineering contribution no protocol solves. (Option D "own the loop" — "the strongest runtime... the natural end-state" — is the escape, but abandons "your CLI is the orchestrator," so keep it as the planned second northbound, not the MVP.)

### Verdict + why

**REVISE.** Right frame at the core (cross-vendor supervision is real, unsolved, unowned, and buildable — the control plane is the one part red and blue *agree* ships), one load-bearing distortion.

The specific change: **stop declaring the capability/knowledge/stigmergy planes "the bet" and "the actual product" (doc 10 §0, doc 12 subtitle). Make baton = "a cross-vendor full-harness supervision layer," full stop.** The capability plane becomes an *optional consumer, earned by the supervision layer's proven value* — exactly the "modules earned by demand" discipline the corpus already states but contradicts rhetorically. Concretely: (1) rewrite doc 10 §0 so the leverage claim is the *narrow, true* one — context economy + auditability, not O(N) scaling; (2) delete the "unbundled multi-agent substrate" ambition from the critical path and gate it entirely behind the M1 eval; (3) adopt ACP as the *stated default* southbound tier so doc 07's self-described "months-long, permanently-recurring" adapter-churn cost is socialized to Zed/vendors, and own raw adapters only for the steer/usage delta. This is *not* CUT — the core question ("does the orchestra beat the soloist," doc 06 Q1) is worth answering and nobody else is positioned to. It's not KEEP — the frame currently funds a supervised for-loop while selling a coordination-substrate moonshot, and those are two products. It's not REPLACE — the strongest replacement (ACP-native, or conductor-first) either surrenders the differentiator (steering ACP won't guarantee) or is the *already-planned* second northbound.

### The one thing

**Get one honest eval number before writing another line of capability-plane spec.** The entire corpus — four planes, seven capability modules, proof-carrying trust, stigmergy — is a cantilever off a single unmeasured fact: *does a supervised cross-vendor fleet beat a single-vendor soloist on cost/time/quality?* Doc 07's round-1 rewrite already front-loaded this correctly (M1 eval, "~10 tasks... explicit pivot criteria: fleet ≤ solo pass-rate and >1.5× wall-clock → **halt and rethink**"), and doc 00 D9/M0-exp-4 name the baselines. But per red's meta-framing, "the first empirical number does not exist." Everything above the control plane is speculation until that eval returns a number that survives its own pre-committed pivot criteria. If the orchestra doesn't beat the soloist, the capability plane, the stigmergy bet, and the Validation Ladder are castles on unproven ground — and the honest thing is to know that *first*, cheaply, before the doc pile grows another plane.
