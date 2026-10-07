# Frontier research: debugging

## PROPOSAL
# Debugging — frontier features for the fleet driver

*Scope note: baton already has a strong, deeply-researched debug design — `docs/capabilities/debug-interp.md` (the "Vantage" module: DAP-as-southbound-surface, the `CausalObservation` as the token-bounded unit of value, record/replay recordings as shared artifacts, `dbg_*` verbs, three-plane integration, and a self-critique appendix). I am not re-proposing that. Everything below **extends** it, folds in the best of its own critique appendix as committed features, and adds the genuinely new ground the current doc leaves open — chiefly (1) debugging the **fleet itself**, not just the code, and (2) making a diagnosis a **durable, non-forgeable, trust-gated** fleet asset rather than a per-run recording.*

## State of the art now (2025-26)

| System / technique | What it does | Why it matters for baton | Cite |
|---|---|---|---|
| **Debug Adapter Protocol (DAP)** | One JSON protocol to drive any debugger (breakpoints, stepping, `evaluate`, scopes) | The southbound engine surface — one client, ~every language. Vantage already builds on this | [microsoft.github.io/debug-adapter-protocol](https://microsoft.github.io/debug-adapter-protocol/) |
| **InspectCoder / InspectWare** (Oct 2025) | Dual-agent (inspector + patcher) drives a live debugger; middleware abstracts pdb into 5 modes/4 actions; `interact_code` tests a hypothesis at a breakpoint | Proves debugger-in-the-loop *measurably* beats static reasoning: **5.1–60.4% rel.** repair gain, **1.67–2.24×** efficiency. The middleware thesis = the observation-plan idea | [arxiv 2510.18327](https://arxiv.org/abs/2510.18327) |
| **debug-gym** (MS Research, 2025) | Env teaching agents to use a debugger interactively; SWE-bench/Aider | Independent evidence a debug tool lifts fix rates; its action-count metric is baton's yardstick for "plan-sized vs statement-sized" | [MS Research](https://www.microsoft.com/en-us/research/blog/debug-gym-an-environment-for-ai-coding-tools-to-learn-how-to-debug-code-like-programmers/) |
| **rr** (record & deterministic replay) | Records a Linux process tree; reverse-execution; gdb-integrated; ≤1.2× on Firefox suites | Recordings become **immutable, forkable, shareable** — reproduce a heisenbug once, replay it fleet-wide for free | [rr-project.org](https://rr-project.org/) |
| **Pernosco** | Cloud omniscient debugger on rr traces; **dataflow** — "how did this value get here" — with instant time-navigation | The dataflow-provenance chain is the heart of a `CausalObservation`; SCAM-2025 plenary on state visualization | [pernos.co](https://pernos.co/) |
| **WinDbg TTD / Undo LiveRecorder** | Queryable execution traces (LINQ over the whole run); Undo does **CI-capture-on-failure** at ~2–3× | "Query the recording, don't step it." Capture-on-failure = capture during baton's own trust-gate run | [TTD](https://learn.microsoft.com/en-us/windows-hardware/drivers/debuggercmds/time-travel-debugging-overview) · [undo.io](https://undo.io/) |
| **Delta debugging / ddmin → DDMIN-LOC** (Jan 2026) | Auto-minimize a failing input; new work feeds the passing/failing inputs *from* ddmin *into* spectrum-based localization | One pass yields both a minimal repro **and** ranked suspects — the minimal repro is the durable, code-independent asset | [ddmin (Zeller)](https://arxiv.org/pdf/cs/0012009) · [DDMIN-LOC 2601.04689](https://arxiv.org/abs/2601.04689) |
| **SemLoc / RGFL** (2026) | Ground free-form LLM fault-localization reasoning in violated semantic properties / spectrum evidence | Keeps the LLM's "cause story" tethered to observed evidence — the exact `authoritative:false` discipline baton needs | [SemLoc 2603.29109](https://arxiv.org/pdf/2603.29109) · [RGFL 2601.18044](https://arxiv.org/pdf/2601.18044) |
| **Coz — causal profiling** | Virtual speedups tell you **which line, if made faster, actually speeds up the program** (not just where time is spent) | The agent-actionable answer for the "why is it slow/looping" class — far better than a flamegraph | [cacm.acm.org/research/coz](https://cacm.acm.org/research/coz/) |
| **OTel eBPF profiler / GenAI semantic conventions** (late-2025) | Zero-instrumentation sampling (<1–5%); standardized spans for agent/tool/MCP calls | Attach-on-stall perf capture merges into baton's existing OTel bridge; standard vocabulary for tracing the fleet's own actions | [OTel eBPF](https://github.com/open-telemetry/opentelemetry-ebpf-profiler) · [OTel AI-agent blog](https://opentelemetry.io/blog/2025/ai-agent-observability/) |
| **DoVer** (Dec 2025) — intervention-driven multi-agent debugging | Instead of just log-attributing a failure, it **intervenes** (edits a message, alters a plan) and re-runs to *verify* the hypothesized cause | This is the frontier baton is uniquely built for: its LOG + replay + steer are the intervention substrate. Flips 18–28% of failed trials to success | [arxiv 2512.06749](https://arxiv.org/abs/2512.06749) |
| **TraceCoder** (ICSE 2026) | Multi-agent observe→analyze→repair with **causal analysis over runtime traces** | +34.4% rel. Pass@1; validates causal-trace analysis over raw step-logs — baton's log is already a causal trace | [ICSE 2026](https://conf.researchr.org/details/icse-2026/icse-2026-research-track/145/) |
| **Multi-agent failure attribution** (2026) | Attribute a multi-agent failure to a specific agent+step; incl. *zero-replay* from surviving text | Directly relevant to "which worker/brief caused the fleet to fail." Baton keeps the full trace, so it doesn't need zero-replay hacks | [2603.17445](https://arxiv.org/pdf/2603.17445) · [zero-replay 2606.14805](https://arxiv.org/pdf/2606.14805) |
| **LLM diagnosis of integration-test failures @ Google** (2026) | Production LLM root-causing of real CI failures at scale | Evidence the "structured explanation into a log" pattern is shipping in industry, not just papers | [2604.12108](https://arxiv.org/pdf/2604.12108) |

## Beyond-frontier ideas (clearly labeled speculation)

- **A failure captured once, *interrogated* in parallel across the fleet.** A human debugger has one live process. Baton has an immutable recording + N idle workers. Fork the recording N ways, inject a different candidate value at the fault frame in each fork, replay-to-assertion in parallel, and return a *ranked sensitivity table*. No human-debugger analog exists. (Speculative but buildable — feature 5.)
- **Debug-knowledge as a *signature*, not a fossil.** The durable, matchable unit is not the GB recording (code-bound, wholesale-stale the instant code changes) but the code-independent shape: `fault_kind + dataflow_shape + winning_counterfactual` (e.g. "int() truncation at a duration→seconds boundary → widen to `//1000`-with-floor"). Speculative claim: the fleet pattern-matches this **before** it re-records. (Feature 6 — flagged a bet, per SYSTEM.md §9's "smarter on its own is measured, not assumed.")
- **Structured causal *explanations* replace step-logs entirely — even for the orchestrator's own mistakes.** DoVer/TraceCoder point at debugging the *interaction*, not just the code. Beyond-frontier: when a fleet run fails (bad brief, worker loop, cross-worker collision), the coordinator produces one causal DAG over its own LOG — "worker 2 looped because the brief's scope excluded `payments/` but the fix required it" — the same `CausalObservation` shape, over the fleet's behavior. (Feature 7.)
- **Speculative-execution debugging of the fix.** Before dispatching a repair worker, replay the recording with the *proposed patch's* behavior spliced in (where the engine allows expression-level override) to pre-screen candidate fixes with zero worktrees spun up. Honest: only works for value-level fixes replay engines can inject; structural fixes still need a real worktree + the trust gate.

## Proposed features for baton (the actionable core)

### 1. Postmortem digest — the *real* R0, no live session
- **What:** On any failed check, capture exception + traceback + per-frame locals + the failing assertion into one structured, shareable observation — read-only, after the fact, no debugger attached.
- **How it plugs in:** Coordinator feature at the trust gate + a thin worker tool. A pytest hook / `faulthandler` / `sys.settrace` snapshot produces a `CausalObservation` payload (`dataflow:null`, `recording_ref:null`) that enters the LOG as a `capability.op.completed` event and lands in the artifact registry. No lease, no two-phase-stop, no exclusive debuggee — so it respects worktrees trivially (it only reads the crashed worker's committed state).
- **Frontier or beyond:** SOTA-adoption (debug-gym/InspectCoder core, minus the live machinery).
- **Moat / bet / rental:** Moat (thin). The *structured, shareable* property survives better models; a stronger model still can't share its scratch `print()` output with the next worker. Baton's LOG can.
- **MVP or later:** **MVP.** This is the cheapest rung and carries the entire headline ("structured causal object, not a REPL transcript"). The current doc's R0 shows a rich dataflow chain its own R0 can't generate — this fixes that over-claim by naming the genuinely minimal rung.

### 2. Capture-on-reject — record the coordinator's own trust-gate run
- **What:** The instant the trust gate re-runs a worker's check in its fresh worktree and it *fails*, capture that run as a recording (or a postmortem digest if no recorder fits).
- **How it plugs in:** Coordinator feature, wired into the existing re-verify step (§5.1 / I7). The coordinator already re-executes the pinned check in a clean worktree the worker never touched — that is the perfect, trust-worthy moment to record, with zero re-triggering and zero trust in worker prose. Emits a `debug.recording_captured`-class payload; the recording is a registry blob refcounted against readers.
- **Frontier or beyond:** SOTA-adoption of Undo's CI-capture-on-failure, but placed at baton's unique choke point.
- **Moat / bet / rental:** **Moat.** This is a property of baton's architecture — the coordinator *already* re-runs — that no base-model improvement obviates. A deterministic recording of the authoritative failure, captured for free.
- **MVP or later:** MVP-adjacent (recorder engine is later; the digest fallback ships with feature 1).

### 3. `reverify(claim)` — diagnosis joins the trust chain
- **What:** A `CausalObservation` is a *claim* ("the bug is `token.exp=0`, born at `jwt.py:41`"). Make the coordinator able to re-derive it from evidence before any repair Decision trusts it.
- **How it plugs in:** Coordinator feature. Same discipline as re-verifying "done": re-run the same observation plan over the immutable recording — a deterministic recording *must* reproduce the same observation, which makes a worker's diagnosis **non-forgeable**. Live-session observations are non-deterministic by nature, so the debug-adapter `card` declares their reverify semantics (accept only if the verdict is stable across *k* replays). Output enters the LOG; a repair brief may only cite a `reverify`-passed observation.
- **Frontier or beyond:** SOTA-adoption (baton's own I7 discipline, extended to diagnosis) — but under-explored in the literature, which trusts the debugger's word.
- **Moat / bet / rental:** **Moat.** Non-forgeable diagnosis is an orchestration guarantee, not a model capability. It's what lets diagnosis and repair be *separate, parallel workers* safely.
- **MVP or later:** Later (Rung 1, once recordings exist) — but it's the feature that earns the whole module its place in the trust chain.

### 4. Content-anchored refs + staleness epochs
- **What:** Every location in a debug artifact (`born_at: jwt.py:41`) is anchored to a code-span/AST hash and stamped with `base:{commit_sha, worktree_hash}`, not a raw line number.
- **How it plugs in:** Coordinator + context feature. A recording is `immutable-snapshot@commit_sha`: immutable ≠ fresh. A consumer whose worktree has diverged from `base` gets a `stale_against_worktree` flag; line refs re-resolve against the current worktree or report "moved/deleted." Mirrors the code-index's `overlay_applied` staleness model — with the honest asymmetry that a recording can't be incrementally invalidated, it's wholesale stale the moment code changes.
- **Frontier or beyond:** Novel in this framing (the debug literature assumes a static repo; a fleet edits under the recording).
- **Moat / bet / rental:** **Moat.** Cross-worktree durability of shared artifacts is pure infra; no model obviates it.
- **MVP or later:** Later, but a **prerequisite** for sharing any debug artifact across workers — pull it forward the moment feature 1's output crosses a worktree boundary.

### 5. Parallel counterfactual replay sweep
- **What:** Fork one recording N ways, inject a different candidate value at the fault frame in each, replay-to-assertion in parallel, return a ranked sensitivity table — hands the repair task a *tested* fix, not a narrative.
- **How it plugs in:** Worker tool (`dbg_sweep`), scheduled as a task-DAG fan-out across idle workers. Zero side effects (it's a recording), zero contention (fork-per-reader), fully parallel. Its `refs` feed the repair brief without entering any agent's context; results land in the LOG as counterfactual-tested hypotheses. Respects the trust gate because the winning candidate is still verified for real in a fresh worktree before merge.
- **Frontier or beyond:** **Novel** — no human-debugger analog; distinctively native to a recording-based fleet.
- **Moat / bet / rental:** **Bet, leaning moat.** Unproven that a ranked sensitivity table beats a strong model just reasoning over the recording — but the *parallel-across-idle-workers* structure is something a single model genuinely can't do, so the value doesn't evaporate as models improve.
- **MVP or later:** Later (needs record/replay + the counterfactual-inject engine capability).

### 6. Bug-signature memory — match before you record
- **What:** Promote the code-independent *signature* (`fault_kind + dataflow_shape + winning_counterfactual`) of a solved bug to the durable knowledge graph; next time the fleet hits that dataflow shape, pattern-match a known fix before spending a recording.
- **How it plugs in:** Slow-memory / knowledge-plane feature. On run boundary, a reverify-passed `CausalObservation` promotes to a PM-style Finding with `ProducedBy` edges to the exact `debug.*` events that justify it (temporal coherence free from the LOG's monotonic `seq`). Recordings GC on task completion (fossils); signatures persist (KB-scale, code-independent).
- **Frontier or beyond:** Novel operationalization; adjacent to "knowledge-based zero-replay debugging of agent traces" ([2606.14805](https://arxiv.org/pdf/2606.14805)).
- **Moat / bet / rental:** **Bet** — this is exactly SYSTEM.md §9's "the fleet gets smarter on its own," which the design says must be *measured, not assumed*. Instrument hit-rate before believing it.
- **MVP or later:** Later. Earns its place only after there's enough signature history to get real matches.

### 7. Fleet-trace debugger — debug the *interaction*, not just the code
- **What:** When a fleet run fails for a non-code reason (a bad brief, a looping worker, a cross-worker path collision), produce one causal explanation over baton's own LOG — the same `CausalObservation` shape, applied to fleet behavior.
- **How it plugs in:** Coordinator feature. The append-only LOG is *already* a causal, replayable trace — the substrate DoVer/TraceCoder have to reconstruct from raw logs, baton has natively. Combined with §5.3 replay + counterfactual re-run, the coordinator can do DoVer-style **intervention** ("re-run with the brief's scope widened to `payments/`") and see if the failure flips — verified, not guessed. Output is a structured attribution ("worker 2 looped because scope excluded the file the fix needed"), entering the LOG and feeding better briefs.
- **Frontier or beyond:** **Novel** for a cross-vendor fleet driver; adopts DoVer/TraceCoder/attribution research the doc doesn't yet reference.
- **Moat / bet / rental:** **Moat** (the LOG + replay are baton's unique, hard-to-copy substrate) with a **rental** seam (the attribution *model* improves with better base models — keep that part thin and swappable).
- **MVP or later:** Later — but architecturally cheap because replay and the LOG already exist; it's mostly a new consumer of them.

### 8. Causal profiling on stall — the "why is it slow/looping" class
- **What:** When the coordinator's warning signals fire *stalled* or *looping*, attach Coz-style causal profiling (and/or eBPF sampling) to answer "which line, if sped up, actually helps" — not just "where time went."
- **How it plugs in:** Worker tool + telemetry. Attach-on-signal (never always-on — cost), export spans that merge into baton's existing OTel bridge (doc 05 §1). No code changes to the debuggee. The `looping` signal that today is a symptom-with-no-cause (doc 05) gets a cause attached.
- **Frontier or beyond:** SOTA-adoption (Coz + OTel eBPF), newly wired to the coordinator's own warning signals.
- **Moat / bet / rental:** **Moat (thin) / tool.** The tooling is commodity; the *trigger-on-fleet-signal* wiring is baton-specific and stays valuable.
- **MVP or later:** Later (Rung 3). Earns its place when perf/hang failures show up in practice.

## Add / subtract / modify

**ADD (net-new to the current design):**
- **Feature 7 (fleet-trace debugger)** is the biggest gap. The current doc debugs *code* the workers write; it barely touches debugging the *fleet's own behavior* — yet DoVer/TraceCoder/multi-agent-attribution (all 2025-26) are the hottest frontier and baton's LOG is the ideal substrate. This should be an explicit section, not folded into "code debugging."
- **Feature 3 (`reverify` for diagnoses)** and **Feature 4 (content-anchored + staleness)** — both flagged as *missing* by the doc's own critique appendix (§B, §D). Promote them from critique to committed features; they're what make a diagnosis a trustworthy, durable fleet asset rather than a per-run recording.
- **Coverage-guided input *search*** (Atheris/cargo-fuzz/AFL++) alongside ddmin *minimization* — ddmin shrinks a *known* failure; when you don't have a failing input, you need to *find* one. This is the front half of the localization pipeline the current `space=input` verb omits.

**MODIFY:**
- **Re-cut the rungs from a build-roadmap into a runtime cost/rigor ladder** the orchestrator picks *per failure* (R0 postmortem digest → R1 live observe → R2 record/replay → R3 minimize/slice/sweep). This matches baton's own "cheapest rung that fits the risk" philosophy (§5.1's evidence ladder) and fixes the doc's mis-cut MVP.
- **Downgrade the recording's status; upgrade the minimal repro's.** The current doc calls the GB recording "the multi-agent superpower," but it's the *most* staleness-prone, code-bound asset — good for diagnosis, then GC it. The durable, code-independent, KB-scale asset the repair task should actually *depend* on is the minimal repro (a command + minimized input). Different lifecycles: recordings ephemeral, repros + signatures promoted.
- **Fix the flaky-capture idempotency bug:** `dbg_record` spec'd "idempotent on `hash(target, repro)`" defeats the whole point — a heisenbug is *constant input, varying outcome*, so idempotency-on-input can return a cached *passing* recording. Make flaky capture a **record-until-`verdict==fail`** task with an attempt budget.
- **Correct two citation over-claims the doc's own appendix already caught:** quote InspectCoder as **5.1–60.4% rel. / 1.67–2.24×** (not the 60% ceiling), and treat SBFL `suspicion` as an **ordinal rank, not a probability** — forbid the narrative from doing arithmetic on it.

**SUBTRACT / don't build:**
- **Cross-worker *live* attach.** Letting a debugger-worker take a live lease on another worker's running process creates two supervisor fences over one execution state (unresolvable per I1) and serializes the whole fleet on one process. Rule: **live sessions are self-diagnosis only; cross-worker diagnosis is always record-then-replay** (forkable, parallel). This dissolves the fence problem and is what you'd want anyway.
- **Don't over-invest in per-language reverse-exec parity.** rr records *native* code — replaying CPython under rr yields C-level `ceval.c` frames, not Python-level dataflow. Keep the reverse-debug engine story honest and per-language in the `card` (PyPy `revdb` / deterministic syscall re-exec for Python; rr/gdb `record full` for native), and let the postmortem digest (feature 1) carry the languages where no good recorder fits.

## Sources

- Debug Adapter Protocol — https://microsoft.github.io/debug-adapter-protocol/
- InspectCoder / InspectWare (2510.18327) — https://arxiv.org/abs/2510.18327
- debug-gym (MS Research, 2503.21557) — https://www.microsoft.com/en-us/research/blog/debug-gym-an-environment-for-ai-coding-tools-to-learn-how-to-debug-code-like-programmers/
- rr — https://rr-project.org/ · https://github.com/rr-debugger/rr
- Pernosco — https://pernos.co/
- WinDbg Time Travel Debugging — https://learn.microsoft.com/en-us/windows-hardware/drivers/debuggercmds/time-travel-debugging-overview
- Undo LiveRecorder — https://undo.io/
- Delta debugging / ddmin (Zeller) — https://arxiv.org/pdf/cs/0012009 · DDMIN-LOC (2601.04689) — https://arxiv.org/abs/2601.04689
- SemLoc (2603.29109) — https://arxiv.org/pdf/2603.29109 · RGFL (2601.18044) — https://arxiv.org/pdf/2601.18044
- Coz causal profiling — https://cacm.acm.org/research/coz/
- OpenTelemetry eBPF profiler — https://github.com/open-telemetry/opentelemetry-ebpf-profiler · OTel AI-agent observability — https://opentelemetry.io/blog/2025/ai-agent-observability/
- DoVer — intervention-driven multi-agent debugging (2512.06749) — https://arxiv.org/abs/2512.06749
- TraceCoder (ICSE 2026) — https://conf.researchr.org/details/icse-2026/icse-2026-research-track/145/
- Multi-agent failure attribution (2603.17445) — https://arxiv.org/pdf/2603.17445 · Knowledge-based zero-replay debugging of agent traces (2606.14805) — https://arxiv.org/pdf/2606.14805
- LLM diagnosis of integration-test failures @ Google (2604.12108) — https://arxiv.org/pdf/2604.12108
- FVDebug (2510.15906) — https://arxiv.org/abs/2510.15906
- baton internal: `docs/capabilities/debug-interp.md` (the Vantage module + its critique appendix), `SYSTEM.md` §5.1/§5.3/§5.4, `docs/05` (telemetry/warning signals), `docs/08` (memory/PM)

## FILTER
Both new citations check out, and they materially sharpen the critique. Writing the filter.

---

## Filter: debugging

**Framing first — what this proposal actually is.** It sells itself as "frontier features," but six of its eight are *promotions of the debug-interp doc's own critique appendix* (postmortem digest = appendix C; `reverify` = B; content-anchoring/staleness = D; counterfactual sweep = H; bug-signature = H; Coz profiling = F; the flaky-idempotency fix and R0–R3 ladder = C/D). That's genuinely useful — turning a critique into a committed roadmap is real work — but it should not be dressed as eight new frontier ideas. **The actually-new content is: Feature 7 (debug the fleet, not the code) plus a 2025-26 citation refresh (DoVer, TraceCoder, multi-agent attribution, DDMIN-LOC, SemLoc/RGFL, Google CI-diagnosis).** Credit that; discount the rest as consolidation. Verdicts below.

### Feature 1 — Postmortem digest (R0, no live session) → **KEEP** (build-first, see bottom)
Real and trivially grounded (pytest hooks / `faulthandler` / `sys.settrace` are commodity). Fits perfectly: read-only over committed state, no lease, no two-phase-stop, output lands in the LOG as a `capability.op.completed` payload. Moat claim ("thin moat") is honest — the *digest content* is a rental (better models write better cause-stories), but the *structured-shareable-into-the-LOG* property is durable infra a stronger model can't replicate on its own. This is the cheapest rung and carries the whole headline.

### Feature 2 — Capture-on-reject at the trust gate → **KEEP + MERGE into Feature 1**
The single most baton-native idea in the proposal: the coordinator *already* re-runs the pinned check in a fresh worktree, so capturing that authoritative failure is free and trust-worthy. But note the honest collapse: the *recording* half needs an arch-bound record/replay engine (rr on CPython yields `ceval.c` frames, per the doc's own §F), so the **MVP-shippable version of Feature 2 is just Feature 1 fired at the I7-rejection moment.** Treat them as one primitive, two triggers — not two features. Moat is real (the re-run choke point is architecture, not a model capability).

### Feature 3 — `reverify(claim)` for diagnoses → **KEEP + MODIFY (scope the guarantee honestly)**
Conceptually the feature that earns debugging a seat in the trust chain — extending I7 from "done" to "the cause." But the non-forgeability guarantee only holds where you have *deterministic replay*. For the R0 postmortem-digest majority case, "reverify" degrades to "re-run the crash and check the same exception reproduces" — which is *already what the trust gate does*. So its incremental value concentrates entirely in the recording (Rung-1+) case, which is arch-bound and absent for most languages. MODIFY to say that plainly, or it reads as a universal guarantee it can't deliver.

### Feature 4 — Content-anchored refs + staleness epochs → **KEEP**
Correct, important, honest. Anchoring `born_at` to an AST/span hash + `base:{commit_sha}` (not a raw line) and flagging `stale_against_worktree` is the right model, and the asymmetry it names (a recording is *wholesale* stale the instant code changes, unlike the incrementally-invalidated code index) is the genuinely hard bit the original doc hand-waved. Pure infra moat. Correctly flagged as a prerequisite for any cross-worktree sharing, not a standalone.

### Feature 5 — Parallel counterfactual replay sweep → **MODIFY (demote to a flagged bet; the engine doesn't exist yet)**
This is the proposal's shakiest technical claim, and it's labeled "Bet, leaning moat" — cut the "leaning moat." The core mechanism ("inject a candidate value at the fault frame, replay forward to the assertion") **is not something current record/replay engines do.** rr and Pernosco are *faithful* replay: the moment you change a recorded value, execution diverges from the recorded event stream and the replay is invalid. What the feature actually needs is checkpoint-restore-then-*live*-re-execute, which loses the determinism that made the recording valuable. The beyond-frontier bullet admits this ("only value-level fixes replay engines can inject"); the *feature* body buries it. And once you strip the magic-injection engine, the sweep reduces to "test N candidate fixes in N worktrees in parallel across idle workers" — which **baton already does via worktrees + the trust gate.** So the novel part is the part that doesn't work today, and the working part isn't novel. Keep it as an explicitly-flagged research bet; don't put it on the roadmap as a moat.

### Feature 6 — Bug-signature memory → **KEEP as bet + MODIFY (add the rental flag)**
Honestly labeled a bet, correctly tied to SYSTEM §9 ("smarter on its own is *measured*, not assumed"). Two additions. (a) The "dataflow_shape" that matches across codebases is an unsolved retrieval problem — "match before you record" assumes a generalizable shape-match that nobody has shown works; instrument hit-rate before believing it (the proposal says this — good). (b) **Missing rental flag:** this is the feature most at risk of obviation — a stronger model may just recognize `int()`-truncation-at-a-duration-boundary directly from the postmortem digest, with no signature KB at all. The signature store's value *shrinks* as base models get better at pattern-matching bugs. Say so.

### Feature 7 — Fleet-trace debugger (debug the interaction) → **KEEP (the standout ADD) + MODIFY (the verification claim overreaches)**
This is the one place the proposal genuinely extends past the existing doc, and it's well-aimed: baton's append-only LOG *is* the causal trace DoVer/TraceCoder must reconstruct from raw logs, and replay+intervention already exist as stated capabilities (SYSTEM §5.3, doc 14 #20). Best fit of the new features — it's a *new consumer of substrate baton already has*, not new machinery. The moat/rental split is honest ("LOG+replay = moat; attribution model = swappable rental").

But two overclaims I verified against the literature and must flag:
1. **"Intervention — verified, not guessed" overreaches.** DoVer ([2512.06749](https://arxiv.org/abs/2512.06749)) flips only **18–28%** of failures, and its own paper says single-agent/single-step attribution is *"often ill-posed, as multiple distinct interventions can independently repair the failed task."* So "worker 2 looped *because* scope excluded `payments/`" is frequently not a unique cause. LLM-fleet intervention-replay is also **stochastic** (worker sampling isn't pinned like an rr recording) — you get a *probabilistic* flip, not the deterministic "reproduce the same observation" that Feature 3 relies on for code. Feature 7 cannot inherit Feature 3's non-forgeability; state that.
2. **"The LOG is already a causal trace" conflates temporal order with causation.** The LOG gives happened-before (monotonic `seq`), not cause. Deriving *why* still needs the (rental) attribution model + stochastic intervention — which current SOTA does badly (see missed-SOTA below). Keep the substrate claim; drop the "causal" overstatement.

### Feature 8 — Causal profiling (Coz/eBPF) on the stall signal → **KEEP (correctly Later/Rung-3, lowest priority)**
Real (Coz = Emery Berger's causal profiling; OTel eBPF profiler is real), cleanly scoped (attach-on-signal, not always-on; merges into the existing OTel bridge). Honestly a "thin moat / commodity tool" where only the trigger-on-fleet-signal wiring is baton-specific. Fine to keep, but it earns its place only when perf/hang failures actually show up — do not pull it forward.

### The ADD/MODIFY/SUBTRACT housekeeping → mostly **KEEP**
- **Flaky-capture idempotency fix (record-until-`verdict==fail`)**: genuine correctness catch — an idempotency-on-input key would cache a *passing* recording and never catch the heisenbug the feature exists for. Keep.
- **Downgrade recording / upgrade minimal-repro; recordings ephemeral (GC-on-done), repros+signatures durable**: correct lifecycle call. Keep.
- **SUBTRACT cross-worker *live* attach (self-diagnosis only; cross-worker = record-then-replay)**: correct — two supervisor fences over one execution state is unresolvable, and replay is what you'd want anyway. Keep.
- **Citation corrections (InspectCoder = 5–60% *range* not the 60% ceiling; SBFL `suspicion` = ordinal rank, not a probability the narrative can do arithmetic on)**: both correct and worth enforcing. Keep.
- **Coverage-guided fuzzing (Atheris/cargo-fuzz/AFL++) to *find* a failing input, not just ddmin to shrink a known one**: valid gap, keep — but scope it: fuzzing a whole worker repo is expensive and off the critical path, so it's a Rung-3 opt-in, not core.

### Real SOTA it MISSED (matters most for Feature 7)
- **"Who&When" / *Which Agent Causes Task Failures and When* ([2505.00212](https://arxiv.org/abs/2505.00212), ICML 2025 / PMLR v267)** — the *seminal* multi-agent failure-attribution benchmark. The proposal cites a downstream `2603.17445` and misses the anchor. This matters because it carries the **honesty number Feature 7 needs**: best method = **53.5% agent-attribution, 14.2% step-attribution**, with o1/DeepSeek-R1 below practical usability. Attributing a fleet failure to the right worker-and-step is *barely better than chance at the step level today.* Feature 7 should be built as "surface candidate attributions for the human/orchestrator to adjudicate," not "the coordinator tells you which worker caused it."
- **TraceElephant / *Seeing the Whole Elephant* ([2604.22708](https://arxiv.org/html/2604.22708v1))** — attribution benchmark with *reproducible execution environments per trace*, which is exactly baton's replay story; the natural thing to validate Feature 7 against.
- **ddmin-over-the-LOG (trace minimization)** — the proposal has ddmin for code inputs but never points it at the LOG itself. "Fork the LOG, drop steps/messages, replay, see if the failure persists" is delta-debugging applied to the fleet trace — cheap given replay already exists, and it makes Feature 7's attribution far sharper than an LLM guessing over the raw log. Biggest missed synthesis.
- **Industrial agent-trace debugging baseline** — LangSmith / Langfuse / Arize Phoenix / AgentOps are the shipping-today version of Feature 7. Naming them sets the honest bar: OTel GenAI spans (which the proposal does cite) + a trace viewer is the commodity floor; baton's differentiator is *replay+intervention on the same LOG*, not the trace view.

### The single feature to build first
**The postmortem-digest primitive (Feature 1), wired first to the trust-gate rejection (Feature 2's trigger) — built as one thing, not two.**

Why it beats the flashier candidates:
- **Cheapest rung, zero fragile dependencies.** No lease, no two-phase-stop, no arch-bound record/replay (the single riskiest, most platform-fragile part of the whole design). A pytest/`faulthandler`/`sys.settrace` snapshot of exception + traceback + per-frame locals + failing assertion. Demoable against this repo's `pytest` in days.
- **It carries the entire module's thesis** — "a structured, shareable causal object in the LOG instead of a REPL transcript or uncommitted `print()` noise" — which is the *only* part of the value proposition that survives better base models.
- **It plugs into the most baton-native choke point.** The coordinator already re-runs the check in a clean worktree; capturing that authoritative failure is free and needs zero trust in worker prose. This is a property of baton's architecture, not a model capability — the honest moat.
- **It's the substrate every other feature reads from.** You cannot `reverify` (3), content-anchor (4), sweep (5), or promote a signature (6) over an observation that doesn't exist yet, and Feature 7 wants the same `CausalObservation` shape pointed at the LOG. Build the structured observation first; everything else is a consumer of it.
- **It fixes the existing doc's named over-claim** (the rich R0 example the MVP-as-scoped can't actually produce) by shipping the genuinely-minimal rung the original doc skipped.

Feature 7 is the most *intellectually* valuable addition and should be the north-star ADD — but it depends on a rich LOG, on replay+intervention, and its verification is stochastic and (per Who&When) barely-usable at the step level today. It's the second brick, not the first.

Sources: [Who&When / 2505.00212](https://arxiv.org/abs/2505.00212) · [DoVer / 2512.06749](https://arxiv.org/abs/2512.06749) · [Seeing the Whole Elephant / 2604.22708](https://arxiv.org/html/2604.22708v1)
