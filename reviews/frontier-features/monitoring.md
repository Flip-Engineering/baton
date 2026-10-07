# Frontier research: monitoring

## PROPOSAL
I have enough grounding. Writing the deliverable.

# Monitoring / observability — frontier features for the fleet driver

*Grounded in baton's existing design: the append-only ledger (`SYSTEM.md` §3.3 rule 5), the normalized `BatonEvent` schema and derived signals (`docs/05` §1–2), digest levels (§3), the trust gate (§5.1), worktree isolation + contagion tracking (§4.1, `docs/14` #25), and the named-but-undesigned "story-style monitor" (§10, `docs/14` #16/#20). This pushes that area to SOTA and past it.*

## State of the art now (2025-26)

| System / technique | What it does | Why it matters for baton | Cite |
|---|---|---|---|
| **OpenTelemetry GenAI semantic conventions** (GenAI SIG) | Standard spans — `invoke_agent` → child `chat` (per LLM call) + `execute_tool` — with `gen_ai.request.model`, `gen_ai.usage.*_tokens`, `gen_ai.response.finish_reasons`. Adopted by Datadog/Honeycomb/New Relic; emitted natively by LangChain/CrewAI/AutoGen. | baton's `BatonEvent` is *already* a superset. Conforming its export means any off-the-shelf backend renders a baton fleet for free — and baton's unique fields (trust-gate outcome, `actor`, `emulated`) ride along as extra attributes. | [otel spans](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/), [otel blog](https://opentelemetry.io/blog/2026/genai-observability/) |
| **LangSmith / Langfuse / Arize Phoenix / Braintrust / Galileo** | Production agent observability: multi-turn tracing, online evals on live traffic (Galileo scores 100% of traffic sub-200ms), LLM-as-judge scoring, cost/latency dashboards. Phoenix adds drift detection + 50+ research-backed eval metrics with real statistics. | These are the *rendering + eval* layer baton should emit into, not rebuild. Phoenix's drift detection is the template for baton's fleet-baseline anomaly detection. | [Latitude comparison](https://latitude.so/blog/best-ai-agent-observability-tools-2026-comparison), [aiprosol index](https://aiprosol.com/llm-observability) |
| **MAST — Multi-Agent System Failure Taxonomy** (NeurIPS 2025) | 14 failure modes in 3 buckets (system-design ~44%, inter-agent misalignment ~37%, task-verification ~21%), from 1600+ annotated traces, κ=0.88. Key finding: most failures are design/coordination, *not* model weakness. | Gives baton a **labeled vocabulary** for its warning signals and story. "Worker 2 stuck" becomes "worker 2: step-repetition (MAST-1.3)." Turns ad-hoc signals into a shared, benchmarked ontology. | [arXiv 2503.13657](https://arxiv.org/abs/2503.13657), [MAST repo](https://github.com/multi-agent-systems-failure-taxonomy/MAST) |
| **SentinelAgent** (2505.24201) | Models a running multi-agent system as a **dynamic execution graph**; does semantic anomaly detection at node/edge/path level; a pluggable oversight agent detects prompt-injection, collusion, and latent exploit paths. | Directly maps to baton's fleet + shared scratchpad + path-leases + contagion tracking. baton has the *provenance* SentinelAgent lacks, so its graph can be sharper. | [arXiv 2505.24201](https://arxiv.org/abs/2505.24201) |
| **Trajectory Guard** (2601.00516) | Lightweight, sequence-aware model for *real-time* anomaly detection on agentic trajectories (not post-hoc). | The template for baton's cheap, streaming early-warning — a fold over the event stream, not a batch job. | [arXiv 2601.00516](https://arxiv.org/pdf/2601.00516) |
| **Process Reward Models / online LLM-judge** (PRM survey 2510.08049; ProRe reasoner-actor) | Score reasoning *step-by-step* mid-run, not just at the end; ProRe probes live environment state to raise reward precision; label-free PRMs (FreePRM, Self-PRM). | Justifies a *continuous* quality signal instead of one binary check at "done" — the basis for streaming the trust gate. | [PRM survey](https://arxiv.org/html/2510.08049v3) |
| **Governance-aware agent telemetry / closed-loop enforcement** (2604.05119); **Reasoning provenance** (2603.21692) | Telemetry designed to *drive enforcement*, and structured behavioral analytics beyond raw execution traces. | Confirms baton's thesis: telemetry is the input to steering (`docs/05` intro line), not a passive dashboard. | [arXiv 2604.05119](https://arxiv.org/pdf/2604.05119) |

**The gap in all of it:** every external platform monitors *one* agent trajectory (or a framework's internal graph). None owns a **cross-vendor fleet in isolated worktrees with an independent re-verification gate and provenance-tracked shared memory**. That substrate is baton's — and it's exactly what makes a *fleet story* and *contagion-aware fleet graph* possible. That's the moat this area should build into.

## Beyond-frontier ideas (clearly labeled speculation)

- **The story as an incremental fold, not a summarization call.** Everyone summarizes a finished trace. A *live* fleet story that updates on every event without re-reading the log is an online-algorithm problem (maintain a small state, fold each event in). Speculative that a cheap local model + templates can keep it coherent over an hour; worth trying because it's the whole operator UX.
- **Predictive alerts — "this worker will fail before it says so."** A survival model over recency-biased features (loop-count slope, budget-burn acceleration, churn) that fires *before* the budget blows or the loop is obvious. Beyond current tools, which alert on thresholds already crossed. Honest bet.
- **The fleet execution graph as a merge-collision *predictor*.** SentinelAgent detects anomalies; baton could use the same graph (workers × path-leases × shared facts) to predict merge collisions and contagion paths *before* they land, because it uniquely knows who-read-whose-fact and who-holds-which-lease. Novel; leans on substrate no external tool has.
- **Deviation from the fleet's own past self.** Not "is this run bad" in absolute terms, but "is this Codex run 3× its own normal token-cost for *this task class*" — anomaly against baton's recency-biased per-(model, task-type) baseline. Phoenix does drift on embeddings; nobody does it on a *cross-vendor coding fleet's* operational baseline.

## Proposed features for baton

### 1. OTel GenAI-conformant egress (don't build a dashboard empire)
- **What:** Emit the ledger as standard OpenTelemetry GenAI spans so Phoenix / Langfuse / Datadog render a baton fleet with zero bespoke UI.
- **How it plugs in:** *Telemetry.* A read-only exporter that folds the append-only LOG into `invoke_agent`/`execute_tool`/`chat` spans; baton-unique facts (`actor`, `emulated`, `trust_gate.outcome`, worktree ref) ride as extra attributes. Pure egress — never a second source of truth; the JSONL ledger stays authoritative (rule 5), spans are a projection you can delete and replay.
- **Frontier or beyond:** SOTA-adoption.
- **Moat / bet / rental:** Rental — but cheap, and it *frees* engineering to spend the moat budget on the graph and story instead of chart widgets. The subtractive move.
- **MVP or later:** MVP-adjacent. `docs/05` §1 already floats an OTel bridge; promote it to first-class and drop any plan for a custom web dashboard.

### 2. MAST-grounded failure-signal classifier (warning signals v2)
- **What:** Replace baton's ad-hoc signals (stall/loop/budget/scope/churn) with a labeled taxonomy mapped to MAST's 14 modes, so every alert names *what kind* of trouble.
- **How it plugs in:** *Coordinator feature.* A deterministic classifier over the event stream writes `health.*` entries carrying a MAST label + evidence-event refs into the LOG (a computed fact, `actor: policy`, never worker prose). Feeds `fleet_wait` digests and the story.
- **Frontier or beyond:** SOTA-adoption (uses the published taxonomy) with a novel wrinkle — baton can auto-label from re-verified outcomes, growing a private trace corpus.
- **Moat / bet / rental:** Moat-adjacent. The taxonomy is public; baton's *labeled cross-vendor corpus* (which signal predicted which trust-gate failure) is not, and it compounds.
- **MVP or later:** MVP. It's a re-labeling of signals baton already computes — low cost, high clarity.

### 3. The story compiler (the named story-style monitor)
- **What:** A running plain-language narrative of what the fleet is collectively doing — "3 workers on the auth change; w2 in a test loop (MAST step-repetition); orchestrator rerouted w4 after Codex refused; w1's diff just passed the trust gate."
- **How it plugs in:** *Telemetry + human view.* An **incremental fold** over the LOG: maintain a compact per-worker + per-task state, update it on each event, and render via deterministic templates with a cheap local model only for the connective prose. Reads the ledger; writes nothing authoritative back (story is a projection, replayable). Respects digest discipline — the orchestrator sees the story, not 4,000 events (`docs/05` §3 principle).
- **Frontier or beyond:** Novel framing (live fold vs. post-hoc summarize); SOTA-adjacent to session replay.
- **Moat / bet / rental:** Moat — it's the operator UX and the thing the user explicitly wants; it only works *because* baton owns the whole fleet's LOG.
- **MVP or later:** Phase 2 (§8.2), but design the fold-state now so the ledger schema supports it (it does).

### 4. The live fleet execution graph (with provenance)
- **What:** A dynamic graph — nodes = workers, path-leases, shared-scratchpad facts; edges = who-holds-which-path, who-read-whose-fact — with node/edge/path anomaly detection.
- **How it plugs in:** *Coordinator feature.* Built by folding `control.*`, `file_edit`, lease-claim, and scratchpad-read events from the LOG. Directly operationalizes worktree isolation (overlapping leases = predicted collision) and contagion tracking (`docs/14` #25: a poisoned fact's read-edges = its blast radius). Trust-gate outcomes annotate worker nodes.
- **Frontier or beyond:** SentinelAgent-style (SOTA) applied to a substrate that's richer than any framework's internal graph — *novel* because of the provenance baton uniquely has.
- **Moat / bet / rental:** Moat — no external observability tool can build this; it needs the shared scratchpad + leases + provenance that only baton has.
- **MVP or later:** Later; but the merge-collision-predictor slice earns its place as soon as concurrent workers touch overlapping paths.

### 5. Streaming the trust gate — continuous verification signal
- **What:** Turn the binary "re-run tests at done" into a live "green-ness" trace — cheap continuous checks (typecheck / scoped test subset) run in a fresh worktree at each worker commit.
- **How it plugs in:** *Trust + telemetry.* Extends the trust gate (§5.1): each worker commit triggers a cheap independent check in a *fresh* worktree at that commit (never the worker's dir — the isolation invariant holds), emitting a `verification.progress` LOG event. The story and graph show quality rising/falling in real time, not just a final verdict.
- **Frontier or beyond:** Beyond — process-reward-model logic (score the trajectory, not just the endpoint) applied to *independent* verification rather than a self-judge.
- **Moat / bet / rental:** Moat — independent cross-vendor verification is baton's most durable value (`docs/14` #23); making it a *live signal* is the strongest monitoring differentiator here. Watch cost: gate the frequency by budget, and only run the scoped subset the diff touches.
- **MVP or later:** Later (needs the trust gate solid first, §8.1), but high value the moment it exists.

### 6. Fleet-baseline anomaly detection ("off from your own normal")
- **What:** Flag runs that deviate from baton's recency-biased baseline for *this vendor+model on this task class* — e.g. 3× normal tokens, unusual tool-mix.
- **How it plugs in:** *Coordinator feature.* Reuses the adaptive-routing stats substrate (`docs/20`): the same recency-biased, model-version-keyed records that pick a vendor also define "normal," so deviation is a cheap side-computation. Emits `health.anomaly` into the LOG.
- **Frontier or beyond:** SOTA-adoption (Phoenix drift detection analog), fleet-specific.
- **Moat / bet / rental:** Moat-adjacent — the baseline corpus is baton's and compounds; the technique is standard.
- **MVP or later:** Later — needs history, like routing. Same gate: off until there's enough data to matter.

### 7. Predictive early-warning ("will fail" before it does)
- **What:** Predict budget-blowout / non-completion / doom-loop *before* the threshold is crossed, so the orchestrator preempts (nudge to wrap up, steer with the missing insight).
- **How it plugs in:** *Telemetry → steering.* A lightweight sequence model (Trajectory-Guard style) over the same derived features, emitting a `health.forecast` event with a confidence. Closes baton's own loop: telemetry is the input to steering (`docs/05` intro).
- **Frontier or beyond:** Beyond-frontier — current tools alert on crossed thresholds, not forecasts.
- **Moat / bet / rental:** Bet — unproven that the forecast beats the simple threshold enough to justify it; ship the threshold alert (feature 2) first and A/B the forecast against it.
- **MVP or later:** Later / experimental. Don't gate the product on it.

### 8. Replay + counterfactual as an operator surface
- **What:** "Show the fleet 20 minutes ago," "diff two runs' stories," "why did run B cost 2×," "replay with the brief changed."
- **How it plugs in:** *Telemetry / context.* Free from the LOG (rule 5 already guarantees replay; `docs/14` #20 asks for it as product). The story compiler (feature 3) renders any point in ledger time, so scrubbing and run-diffing are just the fold applied to a slice.
- **Frontier or beyond:** SOTA-adoption (session replay), with the counterfactual re-run as the valuable, less-common piece — it's how an operator *learns to brief better*.
- **Moat / bet / rental:** Rental-leaning but nearly free, and the counterfactual bit is genuinely differentiating for improving briefs.
- **MVP or later:** Later, but the raw replay is a Phase-2 freebie the moment the story compiler exists.

## Add / subtract / modify

**ADD**
- **The story compiler as a concrete design (feature 3).** `SYSTEM.md` §4.3 and §10 call the story-style monitor "a small piece still to design." This area *is* that design: an incremental fold over the LOG + deterministic templates + a cheap local model for prose. It's the highest-leverage add here.
- **The provenance-aware fleet execution graph (feature 4)** and **streaming trust gate (feature 5)** — the two things no external tool can build, because they need baton's substrate. Spend the moat budget here.
- **MAST labels on the warning signals (feature 2).** A vocabulary upgrade to signals baton already computes.

**SUBTRACT / CHANGE**
- **Don't build a bespoke web dashboard as a differentiator.** `docs/05` §7 says "TUI first (`baton top`), web later" — good; go further and make the *web* layer purely OTel egress into Phoenix/Langfuse (feature 1). A custom dashboard is a rental you'd maintain forever while vendors out-build it. The subtractive thesis (`GLOSSARY`) applies: the moat is the trust-gate-annotated LOG and the fleet graph, *not* chart widgets.
- **Promote the OTel bridge from optional to first-class.** `docs/05` §1 lists it as an "optional" export. Make it the primary human-rendering path; keep the TUI for the operator's live seat.
- **Modify the derived-signals list to be a taxonomy, not a flat set.** The current five (stall/loop/budget/scope/churn) are a good start but ad-hoc; reframe them as leaves of the MAST tree so alerts, the story, and the routing scorecard all speak one language — and so the "fleet-level integrity" concern (`docs/14` #24: aggregate standard drifting down) becomes a *measurable* fleet-level signal, which today's design names but doesn't instrument.
- **One honest caution on feature 5's cost:** continuous re-verification multiplies compute. Gate it by budget and diff-scope (only the touched test subset), or it violates baton's own "no arbitrary limits, let resource availability throttle" discipline in the wrong direction — here the physical constraint (verification compute) *is* the legitimate throttle.

## Sources
- OpenTelemetry GenAI semantic conventions — [spans spec](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/), [observability blog](https://opentelemetry.io/blog/2026/genai-observability/)
- Agent observability platform landscape — [Latitude 2026 comparison](https://latitude.so/blog/best-ai-agent-observability-tools-2026-comparison), [LLM Observability & Eval Index](https://aiprosol.com/llm-observability), [LangChain observability tools](https://www.langchain.com/resources/llm-observability-tools)
- MAST failure taxonomy — [arXiv 2503.13657](https://arxiv.org/abs/2503.13657), [NeurIPS 2025 poster](https://neurips.cc/virtual/2025/poster/121528), [MAST repo](https://github.com/multi-agent-systems-failure-taxonomy/MAST)
- SentinelAgent graph-based anomaly detection — [arXiv 2505.24201](https://arxiv.org/abs/2505.24201)
- Trajectory Guard (real-time agentic anomaly detection) — [arXiv 2601.00516](https://arxiv.org/pdf/2601.00516)
- Process Reward Models survey / online judge — [arXiv 2510.08049](https://arxiv.org/html/2510.08049v3)
- Governance-aware agent telemetry (closed-loop enforcement) — [arXiv 2604.05119](https://arxiv.org/pdf/2604.05119); Reasoning provenance — [arXiv 2603.21692](https://arxiv.org/pdf/2603.21692)
- baton internal: `SYSTEM.md` §3.3/§4.3/§5.1/§10, `docs/05-telemetry-steering.md`, `docs/14-practitioner-addenda.md` #16/#20/#24/#25, `docs/20-adaptive-routing.md`

## FILTER
All core citations check out — no fabrication. MAST (2503.13657), SentinelAgent (2505.24201), OTel GenAI semconv, Trajectory Guard (2601.00516), and the reasoning-provenance paper (2603.21692) are all real and roughly as described. Here is the filter.

## Filter: monitoring

**Honesty audit up front:** the external grounding is real, not hype-citations. MAST, SentinelAgent, the OTel GenAI conventions, and Trajectory Guard all exist and say roughly what the proposal claims. The internal-fit claims (docs/05 schema and digest levels, §4.1 worktrees, §5.1 trust gate, docs/14 #16/#20/#24/#25) are accurate to the repo. So this isn't a hand-wave deck. The problems are narrower: two moat labels are inflated, one feature has a category mismatch, one subtractive recommendation over-reaches, and the proposal missed the single most fleet-relevant research line in the field.

### Per-feature verdicts

**1. OTel GenAI-conformant egress — KEEP, but MODIFY the "kill the dashboard" claim.**
Real standard, real adoption (Datadog/Honeycomb/New Relic), honest "rental" label, and docs/05 §1 already floats it. Good subtractive instinct: don't build chart widgets vendors out-build. But the proposal over-reaches when it says "make the web layer purely OTel egress into Phoenix/Langfuse, drop any custom dashboard." That conflates *passive rendering* with baton's **control seat**. Per SYSTEM §7 / docs/05 §7, the human seat isn't a chart — it *wields the eight verbs*: steer, approve, interrupt, takeover-into-the-harness-session. Phoenix/Langfuse/Datadog are read-only trace viewers; they cannot carry baton's write-back control, and nothing they render bumps the fence or routes through the single-consumer approval CAS. So egress is a fine ADD for passive observability; it does **not** replace the control-capable seat, and the TUI (`baton top`) stays load-bearing. Keep the honest rental label; drop the "purely egress" over-claim.

**2. MAST-grounded classifier — MODIFY (category mismatch + inflated moat).**
The vocabulary upgrade is real and cheap, but the mechanics don't line up as stated. baton's five signals (stall/loop/budget/scope/churn) are **cheap deterministic folds** over the event stream. MAST's 14 modes are largely **semantic** — "reasoning-action mismatch," "premature termination," "information withholding" — which MAST itself detects with an **LLM-as-judge**, not a fold. You can map the mechanical leaves deterministically (loop → step-repetition; scope-drift → a coordination mode) and write those as `actor:policy`. You **cannot** get the semantic modes from a deterministic classifier — that needs the very LLM-judge the proposal's "actor:policy, never worker prose" framing rules out. So: adopt MAST *vocabulary for the signals you can already compute*, and be explicit that full-taxonomy coverage would require an LLM judge (a different, untrusted-by-default thing). Also: "private labeled cross-vendor corpus = moat-adjacent" is inflated — labeling your own signals with a public taxonomy is a clarity win, not a compounding asset, unless it feeds routing/forecasting (and see the reality check under #7). Call it what it is: a cheap, high-clarity rental.

**3. The story compiler — KEEP. This is the one to build first (see below).**
Strongest genuine add. It is exactly the named-but-undesigned piece (§4.3, §10, docs/14 #16), it's what the operator explicitly needs, and the **incremental-fold** framing is correct and non-trivial: it respects the load-bearing principle that "the orchestrator's context is the scarcest resource" (docs/05 §3) by maintaining compact per-worker state instead of re-summarizing the log. One MODIFY on the moat label: the durable part is the **fold-state schema + the provenance-tagged ledger underneath**; the prose generator is a **rental** (a better model narrates better and cheaper). That's fine — say it. Design the fold-state now so it also feeds features 4/6/8.

**4. Live fleet execution graph with provenance — KEEP (the real moat), with two cautions.**
This is the most defensible moat here: the leases + shared scratchpad + read-provenance substrate is baton's alone, so contagion blast-radius (docs/14 #25) and collision prediction genuinely can't be built by any external trace viewer. Two honest cautions the proposal skips: (a) it partly *overlaps baton's existing mechanism* — §4.1 already prevents overlap up front via non-overlapping path leases; so frame this as *monitoring/violation-detection over the lease system*, not a new collision-*prevention* (leases prevent; the graph catches lease violations and coarse-lease bleed). (b) SentinelAgent's actual novelty is an **LLM oversight agent** doing semantic anomaly detection — importing that wholesale re-introduces an untrusted LLM judge, in direct tension with baton's "trust nothing you didn't re-run." Keep the **deterministic graph** (folds of leases/reads/edits, trust-gate outcomes on nodes); treat any LLM-oversight layer as a flagged bet, not core.

**5. Streaming the trust gate — KEEP, but it's a Trust feature surfaced as monitoring, not a monitoring feature.**
Genuinely durable (independent cross-vendor verification is baton's most model-proof value, docs/14 #23), and correctly sequenced after the trust gate is solid (§8.1). The isolation invariant is respected (fresh worktree at each commit, never the worker's dir). The cost caution is the right one and it maps cleanly onto the repo's own discipline: continuous re-verification's throttle is a *physical* constraint (verification compute), which CLAUDE.md explicitly permits as a legitimate limit — so "gate by budget and diff-scope" is disciplined, not an arbitrary cap. Just be honest in the roadmap that this is a Trust-layer extension that *emits* a monitoring signal, so it doesn't jump the queue ahead of the story compiler.

**6. Fleet-baseline anomaly detection — KEEP (honest, deferred, cheap).**
Reuses the docs/20 routing-stats substrate as a side-computation; Phoenix-drift analog; honestly gated on history like routing itself. "Moat-adjacent" is fair — the baseline corpus compounds, the technique is commodity. No objection.

**7. Predictive early-warning — MODIFY: keep it explicitly shelved, and harden the honesty.**
The proposal labels it a bet and says ship the threshold alert first and A/B the forecast — right instinct. But the literature is harsher than the proposal admits, and it's the literature the proposal *itself half-cites*: automated failure **attribution** research (see miss below) finds even SOTA reasoning models hit only ~14% step-level accuracy at localizing *which step already failed, post-hoc* — and TRAIL puts the best model at ~11%. If SOTA can't reliably say where a failure *already happened* with the full trace in hand, "predict it before the worker says so" is the weakest bet in the set. Keep it as a pure experiment, never on the roadmap as a dependency. The threshold alerts (feature 2) plus the story (feature 3) capture most of the value at a fraction of the risk.

**8. Replay + counterfactual — KEEP (nearly free).**
Raw replay is a rule-5 freebie; the counterfactual re-run ("change the brief, see if the struggle vanishes") is the differentiating slice and the honest "rental-leaning" tag is right. Once the story compiler exists, scrubbing/diffing runs is just the fold over a ledger slice. No objection.

### The SOTA it missed (the important gap)

The proposal cites MAST (*what* failure modes exist) but **misses the entire failure-attribution / error-localization line**, which is the exact question a fleet driver has to answer operationally: *which worker, and which step, caused this?*

- **"Which Agent Causes Task Failures and When?" (Zhang et al., ICML 2025 Spotlight, arXiv 2505.00212)** — the Who&When benchmark: failure logs from 127 multi-agent systems annotated with the responsible agent *and* the decisive error step. This is baton's problem stated exactly. Its headline result — best method 53.5% at the agent, 14.2% at the step — is a load-bearing reality check the proposal needs, and it directly undercuts feature 7.
- **TRAIL (arXiv 2505.08638, Patronus AI)** — 148 traces, 841 errors, a formal three-bucket taxonomy (reasoning/execution/planning), **collected via OpenTelemetry/OpenInference**. It's a better fit for feature 2's classifier than MAST alone *and* it ties feature 2 to feature 1's OTel egress (same wire format). Best model ~11% accuracy — again, a sobering ceiling.
- Minor: the **span-level error-localization** work (arXiv 2606.02060) and **AgentCompass** (2509.14647) extend this to production. And the proposal's one soft citation — Galileo "scores 100% of traffic sub-200ms" — is vendor marketing; flag it as unverified, not a technical fact.

Why this matters: the attribution line reframes feature 2 and feature 4. A fleet driver's monitoring payoff isn't naming failure *categories* (MAST) — it's pointing at the worker/commit to reroute or re-verify (Who&When/TRAIL). And the empirical hardness of that (11-14%) is the strongest argument for baton's actual moat: it doesn't have to *infer* attribution from a trace like these benchmarks do — it **owns the provenance** (leases, read-edges, trust-gate outcomes per commit), so it can often *derive* who-touched-what deterministically where the benchmarks can only guess. That's the honest moat, and it's under-sold in the proposal.

### The one to build first: the story compiler (feature 3)

Build the story compiler first among the new features — not the OTel egress, not the MAST relabel.

- **It's the thing the user actually asked for.** §4.3, §10, and docs/14 #16 all name the "story-style monitor" as the piece still to design and the DX problem that "fails first in every multi-agent system" (loss of the plot). This *is* that design.
- **It's the substrate the other good features render through.** The fleet graph (4), baseline anomalies (6), and replay/counterfactual (8) all surface *to a human* as story fragments. Build the fold-state once and they plug into it; build them first and each invents its own surfacing.
- **It's honest about moat vs. rental in the right places** — durable ledger+fold underneath, swappable prose on top — which is exactly the repo's "own the moat, rent the frontier" discipline.
- **It respects the scarcest resource.** An incremental fold is the only design that lets the orchestrator supervise five workers for an hour on a few thousand tokens (docs/05 §3). A summarize-the-trace approach violates that on the first glance.

Sequencing caveat: it sits on the MVP live feed (§8.1), so ship the raw text feed first, then fold it into prose. And design the fold-state schema now to carry lease/provenance fields, so feature 4 doesn't require re-threading the ledger later.

Sources: [MAST (2503.13657)](https://arxiv.org/abs/2503.13657), [SentinelAgent (2505.24201)](https://arxiv.org/abs/2505.24201), [OTel GenAI observability](https://opentelemetry.io/blog/2026/genai-observability/), [Who&When / automated failure attribution (2505.00212, ICML 2025)](https://arxiv.org/abs/2505.00212), [TRAIL (2505.08638)](https://arxiv.org/abs/2505.08638), [span-level error localization (2606.02060)](https://arxiv.org/pdf/2606.02060).
