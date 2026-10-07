# Vantage — baton's DAP-driven debug & code-interpretability module

*Capability-plane module. Its job is not "install a debugger" — it is to turn "why did this fail" into a **CausalObservation**: a single, token-bounded, addressable structured object an agent can reason over, produced by driving real debuggers, record/replay engines, and dynamic-analysis passes as supervised, steerable operations whose evidence lands in the ledger and whose artifacts land in the registry.*

## Summary (5 bullets)

- **The unit of value is a `CausalObservation`, not a debugger session.** Agents don't step-print-step over a REPL (a token firehose — [InspectCoder](https://arxiv.org/abs/2510.18327) measured 33–72 debugger actions per bug). They submit an **observation plan** and receive one bounded structured object: fault site, the offending value's *dataflow provenance*, a minimized repro, SBFL-ranked suspects, and (when two runs exist) the first divergence. This is [Pernosco](https://pernos.co/)/[FVDebug](https://arxiv.org/abs/2510.15906)-style causal explanation reshaped for agent context economy.
- **[DAP](https://microsoft.github.io/debug-adapter-protocol/) is the southbound surface, wrapped by a debug-adapter contract that mirrors baton's harness-adapter contract.** debugpy/Delve/CodeLLDB/lldb-dap/js-debug/[rr](https://rr-project.org/)+gdb are DAP servers; Vantage is a DAP *client* that translates DAP's chatty stateful request/response into addressable, resumable verbs — exactly as harness adapters wrap Codex/Claude, with the same `card()` capability negotiation and `emulated`-stamping discipline.
- **A debug session is a first-class supervised operation in the control plane** — leased, fenced, two-phase-stoppable (supervisor I1/I4/I6). Live sessions take an *exclusive* lease on the debuggee (concurrency: CAS, like task claims); replay sessions over an immutable recording are *fork-per-reader* (no contention). Long ops (record, ddmin, bisect) are task-DAG tasks, budgeted and resumable.
- **Reproduction becomes a shared, addressable fleet asset.** A worker's failure is captured as a record/replay recording ([rr](https://github.com/rr-debugger/rr)/[TTD](https://learn.microsoft.com/en-us/windows-hardware/drivers/debuggercmds/time-travel-debugging-overview)/[Undo](https://undo.io/), or a [debugg.ai](https://debugg.ai/resources/taming-heisenbugs-deterministic-replay-sandboxes-code-debugging-ai)-style deterministic replay of the agent's own tool-run) and registered as an artifact. Any agent — the stuck worker, a dedicated debugger worker, or the orchestrator — can later re-open it and run *new* observation plans without re-triggering the heisenbug. This is the multi-agent superpower harness-native printf can't touch.
- **Every CausalObservation is provenance-shaped for the epistemic plane.** It carries edges to the exact `debug.breakpoint_hit`/`debug.recording_captured` events that justify it; a downstream fix Decision cites it; temporal coherence is enforced by the ledger's monotonic `seq` (doc 08 §2). Diagnosis and repair become *separable, parallelizable* fleet tasks joined by a repro artifact.

## The problem for an agent fleet (why harness-native tools are insufficient here)

A single agent with a shell can already `pip install debugpy` and run `pdb`. The reason that doesn't solve baton's problem is that **debug state is per-process, ephemeral, and unstructured — three properties that are individually survivable for one agent and collectively fatal for a fleet.**

1. **Debug state evaporates at the turn boundary, so it never becomes fleet knowledge.** A worker that scatters `print()` statements and reads the output has learned something no other agent can see; when its turn ends, the insight is gone and the prints are uncommitted noise in its worktree. The orchestrator, watching *derived signals* (doc 05 §2), sees `loop-suspected on pytest tests/test_auth.py (5 near-identical failures)` — a **symptom with no cause attached**. There is currently no primitive that converts that loop signal into "the bad value is `token.exp = 0`, born at `auth/jwt.py:41` from an int/float truncation, consumed at `verify.py:88`." The control plane *detects* pathology; nothing *diagnoses* it. Vantage is the missing half.

2. **Heisenbug reproduction is a per-worker lottery that burns budget.** A worker hits a flaky failure, re-runs the test five times (the exact loop the supervisor flags), and either gets lucky or gives up — and *no other agent can reproduce what it saw*, because the failing interleaving lived only in that process. Record/replay ([rr](https://rr-project.org/), [Undo LiveRecorder](https://undo.io/)'s CI-capture pattern, [debugg.ai](https://debugg.ai/resources/deterministic-replay-saves-code-debugging-ai)) turns "reproduce it again and hope" into "open recording `rec_8f2`" — a deterministic, forkable, *shareable* asset. The fleet reproduces a bug **once**; every subsequent agent replays it for free.

3. **A raw debugger is a context firehose the orchestrator cannot afford.** Supervising five workers on a few thousand tokens (doc 05 §3 "context is the scarcest resource") is incompatible with reading a step-by-step DAP transcript. [InspectCoder](https://arxiv.org/abs/2510.18327) and [debug-gym](https://www.microsoft.com/en-us/research/blog/debug-gym-an-environment-for-ai-coding-tools-to-learn-how-to-debug-code-like-programmers/) both show agents spending tens of round-trips per bug interacting with a live debugger. Multiplied by a fleet, a REPL-shaped interface is a non-starter. The output must be pre-digested into a bounded observation — the same digest-first principle baton already applies to events.

4. **Division of labor is impossible when the evidence can't leave the process.** The natural fleet move — spin up a *dedicated debugger worker* to diagnose on behalf of a stuck coder, then hand the fix back to a repair worker — requires the diagnosis to be a *portable artifact*: a recording + a CausalObservation + a minimized repro, expressed as a brief. Harness-native printf produces none of these. Vantage makes diagnosis a task that produces an artifact a repair task can `depend` on (doc 08 §3), which is exactly how a DAG-scheduled fleet parallelizes work.

5. **The hub already re-runs verification (I7) — it should record it for free.** The supervisor independently re-executes the brief's verification command in a fresh sandbox and treats only its own observed exit as authoritative. That run is the *perfect* moment to capture a recording: the instant a worker's result is rejected, the hub already holds a replayable failure — no re-triggering, no extra sandbox, no trust in worker prose.

Harness-native tools are insufficient because they optimize for *one agent understanding code in the moment*. Baton needs *the fleet accumulating reproducible, structured, provenance-carrying causal knowledge* — an orchestration problem, not a debugger problem.

## Prior art

Real tools/systems, cited. Status as of 2025-2026.

| Tool / system | What it does | 2025-26 status | What baton borrows | What baton rejects |
|---|---|---|---|---|
| **[Debug Adapter Protocol (DAP)](https://microsoft.github.io/debug-adapter-protocol/)** (Microsoft) | Standardized JSON request/response to control any debugger (breakpoints, stepping, scopes, `evaluate`) | De-facto universal; a DAP server exists for ~every language | DAP as the **southbound engine surface**; a debug-adapter `card()` per engine, exactly like harness adapters | DAP's editor-centric synchronous *stepping* as the agent's interface — too chatty, no orchestration awareness |
| **[mcp-debugger](https://github.com/debugmcp/mcp-debugger)** (debugmcp) | Headless agentic debugger over MCP: 20 tools (`set_breakpoint`, `step_over`, `get_variables`…), 7 languages via DAP, structured JSON out | Active 2025-26 (Java JDI, Delve, CodeLLDB added) | Proof DAP-over-MCP works; structured-JSON variable shape; `sessionId` model | **1:1 DAP-verb→MCP-tool mapping** (each `step_into` is a round-trip); no ledger, no lease, no shared recordings, single-agent |
| **[LLDB MCP](https://lldb.llvm.org/use/mcp.html)** (LLVM) | Official LLDB↔MCP bridge; agent issues LLDB commands (breakpoints, memory, stepping) | Shipped in LLDB | Native systems path (C/C++/Rust/Swift) via `lldb-dap` | Raw command passthrough → REPL transcript, not a structured observation |
| **[rr](https://github.com/rr-debugger/rr)** (Mozilla/rr-debugger) | Record & deterministic replay, reverse execution, gdb-integrated | Mature, actively maintained; Intel Nehalem+/AMD Zen, Linux | **Recordings as immutable, forkable, shareable artifacts**; reverse-continue to first-bad-value; MVP record engine | Linux/CPU-arch coupling and gdb-only as the *sole* engine — engines must be pluggable |
| **[Pernosco](https://pernos.co/)** (O'Callahan/Huey) | Cloud *omniscient* debugger on rr recordings; **dataflow** — "how did this value get here" — with instant time-navigation | Live service; [SCAM 2025 plenary](https://conf.researchr.org/details/scam-2025/scam-2025-plenary-events/2/) on state visualization | **Dataflow provenance of a value** as the core of `CausalObservation`; offline DB-build-from-recording | Web-UI-for-humans as the interface; the agent needs a structured query result, not a browser |
| **[WinDbg TTD](https://learn.microsoft.com/en-us/windows-hardware/drivers/debuggercmds/time-travel-debugging-overview)** (Microsoft) | User-mode trace; **LINQ queries over the whole trace**; timelines | June 2025 added percentage-into-trace navigation | **Query the recording, don't step it** (a trace is a queryable dataset); Windows engine tier | 10–20× record overhead as default-on; Windows-only |
| **[Undo LiveRecorder / UDB](https://undo.io/)** (Undo) | Enterprise reversible debugging, Linux/embedded, ~2–3× overhead, **CI-capture-on-failure**, AI-assist features (2025) | Commercial, active | **Capture-in-verification-on-failure** pattern → capture during the hub's I7 verification run; low-overhead posture | Proprietary license as a *hard* dependency — pluggable engine, not required |
| **[Delta Debugging / ddmin](https://arxiv.org/pdf/cs/0012009)** (Zeller); **[C-Reduce](https://users.cs.utah.edu/~regehr/papers/mintest.pdf)**; **[WDD (ICSE 2025)](https://dl.acm.org/doi/10.1109/ICSE55347.2025.00071)**; T-Rec (2025) | Automatic input/test-case minimization to a minimal failing core | Actively researched; weighted & hierarchical variants in 2025 | **`dbg_bisect(space=input)`** → minimal-repro artifacts; weighted/hierarchical variants for structured inputs | Running minimization *inline in orchestrator context* — it's a long task-DAG op, not a tool-turn |
| **Program slicing + SBFL** ([Tandem-FL, DX 2025](https://drops.dagstuhl.de/entities/document/10.4230/OASIcs.DX.2025.3); [efficient dynamic analysis for debug agents, 2026](https://arxiv.org/html/2604.24212); AutoCodeRover) | Dynamic slice + spectrum-based suspiciousness ranking to localize faults | 2025 combos improve fault-localization "wasted effort" 5–15% | **`dbg_slice`** → top-K suspicious statements, ranked; bounds the suspect list | Handing the agent a full slice / coverage matrix (unbounded) |
| **[OTel eBPF profiler](https://github.com/open-telemetry/opentelemetry-ebpf-profiler)**, [Pyroscope/Parca](https://grafana.com/docs/pyroscope/), **py-spy**, **async-profiler** | Zero-instrumentation sampling profilers; <1–5% overhead; whole-system stacks | Mature 2025; OTel-native | **Attach-on-signal** perf/hang interpretability (the "why is it *slow*/looping" class); export merges into baton's existing OTel bridge (doc 05 §1) | Always-on full-fleet profiling (cost); attach only on a stall/loop signal |
| **[debug-gym](https://arxiv.org/pdf/2503.21557)** (Microsoft Research, 2025) | Text env teaching agents interactive debugging; Aider/Mini-nightmare/SWE-bench benchmarks | Published 2025 | Empirical case that a debugger tool **measurably lifts fix rates** → justifies the module | Giving the agent raw pdb per-step; Vantage gives observation *plans* |
| **[InspectCoder / InspectWare](https://arxiv.org/abs/2510.18327)** (2025) | Middleware abstracting a debugger into **5 modes / 4 actions** for multi-turn LLM; `interact_code` for hypothesis tests; **+60% rel. resolve on LiveCodeBench-R**, 2.24× efficiency | Preprint Oct 2025 | **The middleware thesis itself** — abstract a stateful debugger into a clean, mode-tracked interface; `interact_code` as the "test a hypothesis at a breakpoint" primitive | Single-agent/single-process scope — no fleet, no ledger, no shared recordings |
| **[FVDebug](https://arxiv.org/abs/2510.15906)** (2025) | Causal Graph Synthesis: failure trace → **DAG**; for-and-against node scoring; agentic causal narrative | Preprint Oct 2025 | **CausalObservation-as-DAG** shape; for/against suspicion scoring; promotes cleanly into the epistemic KG | Formal-verification-specific pipeline |
| **[debugg.ai](https://debugg.ai/resources/taming-heisenbugs-deterministic-replay-sandboxes-code-debugging-ai)** (2025) | Deterministic replay + **egress-less sandbox** for AI debugging; record/replay the *agent's own* tool-runs | Active 2025 vendor + write-ups | Record/replay the **agent's tool-runs** (not just the program); no-egress sandbox aligns with I7's fresh throwaway sandbox | SaaS lock-in |
| **[ChatDBG](https://arxiv.org/html/2403.16354)** / **[Debug2Fix](https://arxiv.org/html/2602.18571v2)** | LLM-in-the-debugger loops (pdb/gdb/JDB) for root-cause & repair; Debug2Fix reports >20% rel. lift on SWE-bench-Live | 2024–2026 | Validates "debugger-in-the-loop beats static reasoning" for the *coding* fleet | Their in-process, single-harness coupling |

## Module design

### Agent-facing interface (MCP tools / verbs)

Exposed as MCP tools alongside the northbound `fleet_*` surface, under a `dbg_*` namespace. Callable by a worker (self-diagnosis), by a dedicated debugger worker, or by the orchestrator on a worker's behalf. Signatures are the contract; every long-running verb returns a `task_id` and lands in the task-DAG.

```ts
// --- Capture & sessions ---
dbg_record(target: {worktree|pid, repro: Command}, engine?: 'auto'|'rr'|'ttd'|'undo'|'agent-replay',
           budget?: Budget) -> { recording_ref, task_id }
  // Deterministic capture of a failing run. Long op → task-DAG. Idempotent on hash(target, repro).
  // engine='agent-replay' records the *agent's own tool-run* (debugg.ai-style), not the program.

dbg_open(source: recording_ref | {launch: LaunchSpec} | {attach: {pid}}, mode: 'replay'|'live')
         -> { session_id, lease, card }
  // replay over a recording = fork-per-reader (shared, read-only). live = EXCLUSIVE lease on the debuggee (CAS).
  // `card` declares this engine's real capabilities (reverse?, watchpoints?, dataDisassemble?) — capability negotiation.

dbg_close(session_id) -> Ack            // kill-sequence for live sessions (verify debuggee stop)
dbg_list() -> [{ session_id, kind, target, lease, status }]

// --- THE core verb: plan in, structured observation out (NOT a REPL) ---
dbg_observe(session_id, plan: ObservationPlan) -> CausalObservation
  // ObservationPlan = {
  //   breakpoints: [{loc|fn, condition?, hit_limit?}],
  //   watch:       [{expr|address, on: 'write'|'read'|'change'}],   // Pernosco-style dataflow seed
  //   capture:     [{at: bp_id|'exception'|'exit', frames?: k, exprs?: string[]}],
  //   hypotheses?: [{ probe: string /* interact_code snippet */, expect: string }],  // InspectCoder-style
  //   trace_to?:   'first_bad_value' | { criterion },              // reverse-exec target (replay engines)
  //   budget:      { max_steps, max_wallclock_s, max_frames }
  // }
  // Executes the WHOLE plan under one supervised op; returns one bounded CausalObservation. Steerable mid-flight.

// --- Long-horizon analysis passes (task-DAG ops) ---
dbg_bisect(subject: recording_ref | repro, predicate: Command|Expr,
           space: 'input'|'time'|'commit') -> { task_id }        // → BisectResult
  //   space='input' → ddmin/C-Reduce minimal repro artifact
  //   space='time'  → reverse-execute recording to first divergence / first-bad-value
  //   space='commit'→ differential across revisions (git-bisect, hub-run predicate)

dbg_diff(good: recording_ref, bad: recording_ref, focus?: {var|fn}) -> DifferentialObservation
  // Differential debugging: align two executions, return the FIRST control/data-flow divergence.

dbg_slice(subject: session_id | recording_ref, criterion: {var, location}) -> Slice
  // Dynamic program slice + SBFL suspiciousness; returns top-K ranked statements (bounded).

dbg_profile(target: {pid|worktree, repro?}, kind: 'cpu'|'wall'|'alloc'|'offcpu', duration_s)
           -> { profile_ref, task_id }
  // eBPF/py-spy/async-profiler attach-on-signal (the "slow/hung/loop" class); exports OTel spans that MERGE
  // into doc 05 §1's bridge. No code changes to the debuggee.

// --- Interpretability convenience (grounded, non-authoritative) ---
dbg_explain(subject: observation_ref | recording_ref) -> CausalObservation
  // LLM-assembled causal narrative OVER the structured evidence. Every claim cites a frame/event ref;
  // marked non-authoritative (I7 discipline) — the evidence is authoritative, the prose is not.
```

Design rule inherited from the adapter contract: **no silent emulation.** If an engine lacks reverse execution (most live DAP servers do), `dbg_observe(trace_to:'first_bad_value')` on a *live* session is rejected with `Unsupported{need: replay_engine}` rather than silently degraded, and the `card` from `dbg_open` said so up front.

### Integration with the three planes

**Control plane (supervisor + adapters).** A debug session is a supervised operation with the same envelope as a worker turn:
- **Leases & fencing (I1).** A *live* `dbg_open` takes an exclusive lease on the debuggee process/worktree, fenced against `fleet_spawn`/merge into that worktree (you cannot merge a worktree that a debugger has paused mid-execution). *Replay* sessions take no exclusive lease — the recording is immutable, so N agents fork N readers. Every `dbg_*` op carries `(target, epoch, fence)`; a human takeover of the target bumps the fence and a stale plan is rejected `stale_fence`.
- **Bounded ops (I4).** `dbg_observe` never blocks the caller past `HOST_SAFE_MS`; a plan that hasn't converged returns `{partial: true, cursor}` and is re-polled — the same bounded-poll loop as `fleet_wait`. Long captures/bisections are task-DAG tasks polled via `fleet_events`.
- **Two-phase stop (I6).** `interrupt` on a runaway plan (a breakpoint that never hits, a `continue` into an infinite loop) is request→confirm: the supervisor sends the engine's cancel, marks the session `stopping`, and only reports `idle` on the debugger's authoritative stop. Precondition: any outstanding *expression-eval approval* is drained (answered `cancel`) first, or the session hangs — the exact I6 approval-drain rule.
- **Steering.** The orchestrator amends an in-flight `ObservationPlan` (add a watchpoint, narrow `trace_to`, cap steps) — native on replay engines (re-query), emulated (`interrupt`+re-plan) on live DAP, and the ack says which.
- **Approval routing (§5) + the OS-sandbox boundary.** `interact_code` / `evaluate` can execute arbitrary expressions in the debuggee, and `dbg_record` runs the repro command — both are exactly the surface the permission chain governs. They execute **inside the worker's OS-sandbox confinement, never on the hub** (I7), evaluated under the same kernel-denied scope escape; a state-mutating `interact_code` routes `policy → orchestrator → human` like any tool call. The debugger is not a sandbox-escape hatch.

**Knowledge plane.**
- *Operational (ledger).* New closed `debug.*` kind namespace on `BatonEvent`: `debug.session_opened`, `debug.recording_captured`, `debug.breakpoint_hit`, `debug.watch_fired`, `debug.observation_ready`, `debug.bisect_step`, `debug.repro_minimized`, `debug.slice_computed`, `debug.hypothesis_tested`, `debug.profile_ready`. Session lifecycle + `observation_ready` ride the **priority lane** (small, load-bearing); per-step frame/variable deltas ride the **bulk lane** (coalescible, `dropped:k`-marked) — a step flood degrades resolution, not safety (supervisor §4). The digest the orchestrator sees is the CausalObservation *summary*, never the step transcript.
- *Coordinative (task-DAG + artifact registry).* Recordings, CausalObservations, minimized repros, slices, and profiles are **immutable artifacts** in the registry: `task_id → {recording_ref, observation_ref, repro_ref, profile_ref}`. Recordings/profiles are blob-stored (they're large — GBs); observations are small JSON. The killer flow: a **diagnosis task** (`dbg_record`→`dbg_observe`→`dbg_bisect`) produces a `repro_ref`; a **repair task** is created with `deps:[diagnosis_task]` and a brief that *is* the CausalObservation + minimal repro. The DAG's ready-work detection (doc 08 §3) dispatches repair only when diagnosis is `completed`. Diagnosis and repair parallelize across workers — the thing printf can't express.
- *Epistemic (selective promotion).* A CausalObservation is already provenance-shaped ([FVDebug](https://arxiv.org/abs/2510.15906)'s causal DAG). At run boundaries it promotes to a PM-style **Finding** (`pm_log_finding`) with `ProducedBy` edges to the `debug.recording_captured` + `debug.breakpoint_hit` events that justify it; the repair **Decision** cites the observation (`Informed` edge). Temporal coherence is free — the ledger's monotonic `seq` guarantees a fix Decision cannot cite an observation that hadn't happened (doc 08 §2, the exact invariant PM enforces).

### Agent-ergonomic output shape

`dbg_observe` returns a **CausalObservation**: token-bounded, addressable (every `frame_ref`/`recording_ref` is re-openable for a deeper plan — resumable, not a dead-end dump), and grounded (evidence is authoritative; any narrative is marked non-authoritative). Example for a rejected Python pytest verification the hub recorded:

```json
{
  "observation_ref": "obs_7c1",
  "recording_ref": "rec_8f2",                     // re-openable: dbg_open(rec_8f2, replay)
  "target": { "worker": "w_codex_01", "repro": "pytest tests/test_auth.py::test_exp -x" },
  "verdict": "reproduced",                          // reproduced | flaky | not_reproduced
  "fault": {
    "kind": "assertion_failure",
    "site": "tests/test_auth.py:88",
    "message": "assert token.valid is True",
    "frame_ref": "rec_8f2#f_0341"                  // dbg_observe deeper here if needed
  },
  "offending_value": {
    "expr": "token.exp", "observed": 0, "expected": ">= now()",
    "dataflow": [                                   // Pernosco/FVDebug-style provenance chain (bounded to origin→sink)
      { "born_at": "auth/jwt.py:41", "as": "exp = int(ttl / 1000)", "note": "int() truncates 0.4s ttl -> 0",
        "frame_ref": "rec_8f2#f_0290" },
      { "flows_to": "auth/jwt.py:57", "as": "claims['exp'] = exp" },
      { "consumed_at": "auth/verify.py:88", "as": "valid = exp >= now()", "yields": "False" }
    ]
  },
  "suspects_sbfl": [                                // dbg_slice top-K, ranked; not the full matrix
    { "loc": "auth/jwt.py:41", "suspicion": 0.94, "reason": "in dynamic slice of token.exp; fail-only" },
    { "loc": "auth/jwt.py:38", "suspicion": 0.31 }
  ],
  "minimal_repro": { "repro_ref": "repro_44a", "space": "input",
                     "core": "ttl=400", "from_original": "config with 12 fields → 1" },  // ddmin
  "differential": null,                             // populated by dbg_diff(good, bad): first divergence
  "hypotheses_tested": [
    { "probe": "exp = ttl // 1000 if ttl>=1000 else 1", "result": "assertion passes", "confidence": "high" }
  ],
  "narrative": { "text": "ttl<1000ms truncates to exp=0 at jwt.py:41; token is born expired.",
                 "authoritative": false, "cites": ["rec_8f2#f_0290", "obs_7c1.offending_value"] },
  "cost": { "wallclock_s": 41, "trace_bytes": 210000000, "steps": 1180 },
  "next_probes": [ "dbg_bisect(rec_8f2, space=time) to confirm first write of exp=0",
                   "dbg_diff against a passing ttl=5000 recording" ]
}
```

Everything the orchestrator needs to route a fix — cause, minimal repro, a *tested* candidate — in a few hundred tokens. Depth is available on demand (open a `frame_ref`), never pre-paid.

### Shared vs per-worker (concurrency)

- **Shared, immutable, fork-safe:** recordings, CausalObservations, minimal repros, profiles, and the symbol/xref index ([ctags](https://en.wikipedia.org/wiki/Ctags)/rg-built, one per repo) — all live in the artifact registry, addressable by every agent. Replay sessions over a recording are **fork-per-reader**: N agents each open their own cursor over the same read-only trace with zero contention. This is the concurrency win — the expensive thing (a recording) is produced once and read by the fleet.
- **Exclusive, leased, serialized:** a *live* debug session owns a running debuggee; you cannot have two agents stepping one process. Live `dbg_open` is a **CAS on the target's debug-lease** (same mechanism as task claims, doc 08 §4); the loser gets `already_leased{holder}`. A heisenbug that only reproduces in the live worker's exact state (and can't be recorded) forces serialized lease-and-inspect — an honest limitation, flagged below.
- **No shared mutable debug state.** There is no `debug_state.json` every agent reads/writes — the ledger + registry are the truth; sessions are derived and leased. Idempotency keys on every `dbg_*` op make replays no-ops (doc 05 §4).

## Scoping (MVP rung vs later rungs)

- **Rung 0 (MVP — proves the thesis, ~one adapter).** One DAP engine (**debugpy/Python** — matches [debug-gym](https://arxiv.org/pdf/2503.21557)/SWE-bench and the installed `python3`), `dbg_open(live)` + `dbg_observe(plan)` returning a CausalObservation, exclusive lease, `debug.*` events to the ledger, observation artifact to the registry. No record/replay, no bisect, no slice. This is the [InspectCoder](https://arxiv.org/abs/2510.18327)/debug-gym core **wrapped as a fleet capability** — and it already delivers the headline: an agent gets a structured causal observation instead of a REPL transcript. Demoable today against `pytest` in this repo.
- **Rung 1 (reproducibility).** [rr](https://github.com/rr-debugger/rr) record engine (Linux) + `dbg_open(replay)` fork-per-reader + `dbg_bisect(space=time)` reverse-exec to first-bad-value. Recordings become shared artifacts; the hub records the I7 verification run on rejection. This is where the multi-agent superpower lands.
- **Rung 2 (localization & minimization).** `dbg_bisect(space=input)` = ddmin/[C-Reduce](https://users.cs.utah.edu/~regehr/papers/mintest.pdf) minimal repros; `dbg_slice` + SBFL top-K ([Tandem-FL](https://drops.dagstuhl.de/entities/document/10.4230/OASIcs.DX.2025.3)); `dbg_diff` differential (needs a good + bad recording).
- **Rung 3 (perf interpretability + knowledge).** `dbg_profile` via [OTel eBPF profiler](https://github.com/open-telemetry/opentelemetry-ebpf-profiler)/py-spy attach-on-stall-signal, merged into the OTel bridge; `dbg_explain` grounded narrative; automatic promotion of CausalObservations into the epistemic KG.
- **Breadth tier (adapter expansion).** [lldb-dap](https://lldb.llvm.org/use/mcp.html) for native/Rust (matches installed `lldb`/`clang`/`cargo`), Delve/js-debug, [WinDbg TTD](https://learn.microsoft.com/en-us/windows-hardware/drivers/debuggercmds/time-travel-debugging-overview) (Windows engine tier), [Undo](https://undo.io/) (licensed engine tier) — each a debug-adapter `card()`, degrading explicitly. Note: `z3` (installed) is complementary, not an engine — a CausalObservation's constraint on the offending value can be handed to z3 to *synthesize* a failing input, feeding `dbg_bisect`.

## Limitations & honest residuals

- **Record/replay is arch- and platform-bound.** [rr](https://rr-project.org/) needs specific Intel/AMD CPUs and is single-process-tree; [TTD](https://learn.microsoft.com/en-us/windows-hardware/drivers/debuggercmds/time-travel-debugging-overview) is Windows-only with 10–20× overhead; [Undo](https://undo.io/) is licensed. Where no recorder fits, the module degrades to live-session + logging, and the `card` says so. **No engine can deterministically replay a *distributed* fleet interaction** (multiple workers + network) — recordings are per-process-tree. Cross-worker causality stays in the ledger, not in a recording.
- **Live-only heisenbugs serialize.** A bug that reproduces only in the live worker's exact, unrecordable state can't be forked; agents must lease-and-inspect one at a time. The lease makes this safe, not fast.
- **DAP capability gaps are real.** Many DAP servers lack reverse execution, hardware watchpoints, or `dataDisassemble`. Capability negotiation per debug-adapter card is mandatory (mirrors the harness card); the dataflow-provenance quality in a CausalObservation is only as rich as the engine's granularity — a `capture`-only fallback still works but yields a thinner `dataflow` chain.
- **Cost and retention.** Recordings are GBs; profiles and traces accumulate. This inherits doc 08 Q4's unresolved retention/rotation boundary — recordings must be GC'd on task completion by default, pinned only when an observation promotes to the epistemic layer.
- **The interpretability ceiling is over-claiming.** `dbg_explain`'s narrative can hallucinate a cause the evidence doesn't support. Mitigation is structural, not hopeful: the narrative is marked `authoritative:false`, every sentence cites a `frame_ref`/`event`, and it is treated with the same "untrusted worker output" provenance frame as worker prose (I7). The *evidence* — recorded values, breakpoint hits, tested hypotheses — is authoritative; the story is not.
- **The debugger is a powerful sandbox surface.** `interact_code`/`evaluate` execute arbitrary code in the debuggee. This is contained only because it runs inside the worker's OS-sandbox confinement (doc 05 §5) and routes state-mutating probes through the approval chain — not because the debugger is inherently safe. If a future engine tier can't be confined, its card must declare `evaluate: unsupported`.
- **`dbg_observe` plan expressiveness vs autonomy tension.** A too-rigid plan can't follow the bug where it actually goes; too-open a plan re-becomes a REPL. The `partial`+cursor resume model and `next_probes` are the compromise — the agent iterates in *plan-sized* steps, not *statement-sized* ones — but calibrating plan granularity per bug class is genuinely open and will need measurement (the debug-gym/InspectCoder action-count metrics are the yardstick).

## Sources

- Debug Adapter Protocol — https://microsoft.github.io/debug-adapter-protocol/
- mcp-debugger (debugmcp) — https://github.com/debugmcp/mcp-debugger
- LLDB MCP (LLVM) — https://lldb.llvm.org/use/mcp.html
- rr — https://rr-project.org/ · https://github.com/rr-debugger/rr
- Pernosco — https://pernos.co/ · SCAM 2025 talk — https://conf.researchr.org/details/scam-2025/scam-2025-plenary-events/2/Visualizing-Program-State-in-the-Pernosco-Debugger
- WinDbg Time Travel Debugging — https://learn.microsoft.com/en-us/windows-hardware/drivers/debuggercmds/time-travel-debugging-overview
- Undo LiveRecorder / UDB — https://undo.io/ · https://undo.io/resources/6-things-time-travel-debugging/
- Delta Debugging / ddmin (Zeller) — https://arxiv.org/pdf/cs/0012009 · C-Reduce — https://users.cs.utah.edu/~regehr/papers/mintest.pdf · Weighted Delta Debugging (ICSE 2025) — https://dl.acm.org/doi/10.1109/ICSE55347.2025.00071
- Program slicing + SBFL (DX 2025) — https://drops.dagstuhl.de/entities/document/10.4230/OASIcs.DX.2025.3 · Efficient dynamic analysis for autonomous debugging agents (2026) — https://arxiv.org/html/2604.24212
- OpenTelemetry eBPF profiler — https://github.com/open-telemetry/opentelemetry-ebpf-profiler · Grafana Pyroscope eBPF — https://grafana.com/docs/pyroscope/latest/configure-client/grafana-alloy/ebpf/
- debug-gym (Microsoft Research) — https://www.microsoft.com/en-us/research/blog/debug-gym-an-environment-for-ai-coding-tools-to-learn-how-to-debug-code-like-programmers/ · https://arxiv.org/pdf/2503.21557
- InspectCoder / InspectWare — https://arxiv.org/abs/2510.18327
- FVDebug (causal graph synthesis) — https://arxiv.org/abs/2510.15906
- Debug2Fix — https://arxiv.org/html/2602.18571v2 · ChatDBG — https://arxiv.org/html/2403.16354
- debugg.ai (deterministic replay + sandboxes for AI debugging) — https://debugg.ai/resources/taming-heisenbugs-deterministic-replay-sandboxes-code-debugging-ai

---

# Appendix: Design critique (workflow critic pass)

## Design critique & sharpening for debug-interp

Verdict up front: this is the strongest-researched dossier of the set — the prior-art is real (I verified InspectCoder 2510.18327, FVDebug 2510.15906, and WDD/ICSE 2025; all genuine), the control-plane integration is thoughtful, and the recording-as-shared-asset instinct is right. But it **floats beside the capability-plane spec instead of conforming to it**, its **MVP is mis-cut** (expensive machinery front-loaded, the cheap high-value rung not even named), its **showcased output can't be produced at the rung it's attached to**, and its **shared-state story confuses immutability with freshness** — the one hard problem the task flagged, and the one it hand-waves. Concrete fixes below, ordered by leverage.

### A. Conformance: Vantage invents a second framework instead of being a module of the first (biggest structural miss)

`spec/capability-plane.md` is the contract this module *must* implement, and the dossier never cites it. It mandates:
- `interface Capability { card; invoke; resume; cancel; reverify }` (§1) — Vantage exposes bespoke `dbg_*` verbs instead. Fix: `dbg_open`, `dbg_observe`, `dbg_bisect`… are **`op` values on the one `invoke(op, args, ctx)` call**, not a parallel verb surface.
- The uniform **`AciResult` envelope** `{op,status,summary,payload,refs,cursor,cost,provenance}` (§3) — Vantage returns a raw `CausalObservation`. Fix: CausalObservation is the typed **`payload`**; the recording is a **`ref`** (blob handle); the ≤1-line `summary` is what enters context by default; `cost`/`provenance` are already half-present, just move them into the envelope. The whole point of §3 is that the orchestrator learns *one* way to consume tool output — a bespoke shape breaks that for the sake of nothing.
- **`capability.op.started/completed` ledger events** (§2) — Vantage mints a new top-level `debug.*` namespace, which breaks doc 05's *closed, versioned* kind set (lifecycle/content/action/control/resource/health). If every module mints its own namespace the closed set explodes. Fix: emit `capability.op.*`; put `breakpoint_hit`/`watch_fired`/`recording_captured` in the **payload**, keep the priority-vs-bulk lane split (that part is good) as a class attribute.

This is the difference between "a capability module" and "a debugger with an MCP skin." Roughly a one-day refactor of the interface section; do it first because everything downstream (reverify, staleness flags, cursor) hangs off the envelope.

### B. `reverify` is missing — and it's the exact hook that earns Vantage a place in the trust chain

Capability-plane §6 / supervisor I7: any output a downstream decision trusts must be hub-re-runnable. A CausalObservation *is* a claim ("the bug is `token.exp=0`, born at `jwt.py:41`"). The dossier discusses the hub *recording* the I7 run but never implements `reverify(claim)`. This is a gift the design leaves on the table: **a deterministic recording is the reverify substrate** — re-running the same `ObservationPlan` over `rec_8f2` must reproduce the same observation, which is precisely what makes a worker's diagnosis non-forgeable. Live-session observations are non-deterministic (that's the heisenbug), so the card must declare their reverify semantics (re-record; accept only if `verdict` is stable across *k* replays). State this. It converts "the debugger" into "the evidence layer I7 stands on," which is the dossier's own stated ambition.

### C. Scoping — the MVP is mis-cut, and the flagship example can't run on it (over-claim)

The showcased CausalObservation shows a full **backward dataflow chain** (`born_at → flows_to → consumed_at`) with `frame_ref`s into recording `rec_8f2`, a **ddmin minimal_repro**, and **reverse-exec to first_bad_value**. Every one of those is Rung 1–2 (needs rr record/replay + slicing + ddmin). Rung 0 as scoped — live debugpy, *"no record/replay, no bisect, no slice"* — cannot produce backward provenance: live DAP has no reverse execution, and Python has no cheap hardware watchpoints, so "how did this value get here" requires either a recording or a `sys.settrace` assignment-log slicing pass, neither of which is in the MVP. **The MVP's headline is illustrated with an output the MVP can't generate.** That's the concrete over-claim.

Two fixes, and I recommend re-cutting rather than enlarging:

1. **Name the genuinely minimal rung the dossier skipped — a postmortem digest with no live session at all.** On a failed verification run, capture exception + traceback + per-frame locals + the failing assertion (via a pytest hook / `faulthandler` / `sys.settrace`) into a structured, shareable observation. No lease, no two-phase-stop, no exclusive debuggee — it's read-only post-hoc. This *already delivers the entire thesis* ("structured, shareable, provenance-shaped causal object instead of a REPL transcript") and most failures never need more. The current "MVP" front-loads the expensive live-session control machinery (exclusive lease, I6 drain, fencing) while stripping the cheap thing that carries the value proposition. That's mis-cut, not just mis-sized.

2. **Re-frame the rungs as a runtime cost/rigor ladder (capability-plane §7), not a build roadmap.** The orchestrator picks a rung *per failure* and escalates on the critical path:
   - **R0 postmortem digest** (no session) → the real MVP.
   - **R1 live observe** (leased `ObservationPlan`) → escalate when R0 is insufficient (need a conditional breakpoint / hypothesis probe).
   - **R2 record/replay** → escalate for heisenbugs or when you need backward dataflow.
   - **R3 minimize/slice/differential** → escalate when localization is stuck.
   
   This matches the framework's own composition model, makes the cheap rung actually cheap, and makes rr/ddmin/slicing demand-driven instead of a four-quarter roadmap. Downgrade the R0 example JSON to what capture yields (forward locals + re-run SBFL, `dataflow: null`, `recording_ref: null`); show the rich chain as the R2 output it actually is.

### D. Shared-state consistency — the recording-staleness hole (hardest problem, hand-waved)

The dossier's entire multi-agent consistency argument is *"recordings are immutable → fork-per-reader → zero contention."* This **conflates immutability with freshness** and skips exactly the problem capability-plane §4 exists to solve.

- A recording is a **fossil of code at worktree-state S**. `born_at: jwt.py:41` is meaningless to a worker who has since edited `jwt.py` — line 41 is now a different statement. Immutability guarantees the recording won't *change*; it does **not** guarantee it's still *about the current code*. §4 requires shared state to be epoch-stamped and to tell the consumer how stale it is (`overlay_applied`); the dossier does neither for recordings. **Fix:** every recording and CausalObservation carries `base:{commit_sha, worktree_hash}`; a consumer whose worktree has diverged from `base` gets a `stale_against_worktree` flag (the recording analog of `overlay_applied`); and location refs are **content-anchored** (code-span hash / AST path), not raw line numbers, so they can be re-resolved against the current worktree or reported "moved/deleted." Note the sharp asymmetry vs the code index: the index invalidates per-file-hash and re-overlays; a recording **cannot be incrementally invalidated** — it is wholesale stale the instant the code changes. That must be stated as its consistency model (`immutable-snapshot@commit_sha`), not glossed as "immutable, therefore shareable."

- **The dossier over-sells the recording and under-sells the minimal repro.** It calls the recording "the multi-agent superpower," but the recording is the *most* staleness-prone, code-bound, GB-scale asset — it exists to read the *past*. The durable, code-independent, KB-scale fleet asset is the **minimal_repro** (a command + minimized input): it survives the fix, it's what the repair task is *verified* against, it's exactly what the DAG dependency should carry. Recordings are for **diagnosis** (ephemeral, GC-on-completion); minimal repros are for **verification** (durable, promoted). Different lifecycles — say so.

- **GC vs live readers collide.** "GC recording on task completion" + "fork-per-reader" = use-after-free when a reader still holds a replay cursor at completion. Need **refcount/lease on the recording blob**; GC only at refcount 0 and unpinned. This is the "who-owns-what" the task asked about, and it's currently unowned.

- **Idempotency defeats the flaky-capture value prop.** `dbg_record` is spec'd "idempotent on `hash(target, repro)`" — but a heisenbug is *defined* by constant input and varying outcome. Idempotency-on-input returns a cached (possibly *passing*) recording and never catches the failure the whole feature exists to catch. **Fix:** flaky capture is a **record-until-`verdict==fail`** task with an attempt budget (a task-DAG op), keyed on `(target, repro, observed_verdict)`, not a single idempotent call.

### E. Three-plane integration nits (beyond A/B)

- **Task-DAG ready-work needs an artifact predicate, not just dep-completion.** "Repair dispatches when diagnosis is `completed`" is too coarse: a diagnosis that runs cleanly but yields `verdict: not_reproduced` is `completed` yet must **not** trigger a blind repair with no cause. Ready-work (doc 08 §3a) must evaluate a predicate on the *artifact* (`observation.verdict == reproduced`), not just task status. Otherwise a not-reproduced diagnosis auto-spawns a causeless repair.
- **Cross-worker live-attach vs turn fence is unresolved — resolve it by forbidding it.** The dossier lets a debugger-worker take a live lease on *another* worker's debuggee, but the supervisor fence is per-worker-turn (I1): suspending peer worker-A's process means two fences over one execution state, which the dossier never composes. Honest fix: **live sessions are self-diagnosis only** (a worker debugging its own paused turn); *cross-worker diagnosis is always record-then-replay*. This dissolves the fence mess and is what you'd want anyway — replay is forkable and parallel; live peer-attach serializes the whole fleet on one process.
- **Registry departs from "the repo IS the memory" (doc 08 §3b) and doesn't say so.** The registry is a git manifest; recordings/profiles are GBs and are not git objects. Name the extension explicitly: a **blob backend the registry indexes**, with its own retention/GC (doc 08 Q4), distinct from the git-as-memory leg.

### F. What it missed (real tools)

- **Python record/replay is not rr.** rr records native code; replaying CPython under rr yields C-level `ceval.c` frames, not the Python-level dataflow the example shows. The MVP language is Python but the reproducibility rung is rr — an unflagged language/engine mismatch. The real Python reverse-debug paths are **PyPy's `revdb`**, **deterministic input/syscall record + re-exec under CPython**, or debugpy postmortem (no reverse). Fix the R2 engine story per-language in the card.
- **Input-space *search*, not just minimization.** `space=input` covers ddmin/C-Reduce (shrink a *known* failure) and z3 (synthesize from a constraint), but misses coverage-guided fuzzers to *find* a failing input when you don't have one: **Atheris** (Python), **cargo-fuzz/libFuzzer** (Rust/C), **AFL++**. That's the front half of the minimization pipeline.
- **Causal profiling (Coz).** `dbg_profile` is sampling-only. **Coz** answers "which line, if sped up, speeds up the program" — the causal analog of causal debugging and far more agent-actionable than a flamegraph. It's the frontier tool for the perf-interpretability class the module claims.
- **eBPF/`bpftrace` uprobes + USDT for stop-free value capture** — capture a value at a site across many runs with no breakpoint and no lease. The dossier uses eBPF only for profiling, missing the low-overhead alternative to a leased breakpoint for the "watch this value in the wild" case.
- **gdb/lldb built-in `record full`** as a zero-CPU-arch-dependency degraded recorder for short windows, for when rr's Nehalem+/Zen requirement isn't met.

### G. Citation hygiene / corrections (verified against source)

- **InspectCoder is cherry-picked.** The dossier quotes "+60% rel. resolve on LiveCodeBench-R." The paper reports a **range, 5.10%–60.37% relative improvement** (BigCodeBench-R headline: 81.4% pass / 67.87% resolve). Quoting only the ceiling as the justification is misleading; write "5–60% rel. depending on benchmark."
- **FVDebug is hardware-formal-verification-specific** (RTL signals, waveforms, counterexample traces); its causal DAG is a *signal-dependency* graph over a bounded counterexample, **not** a software runtime dataflow-provenance chain over a GB recording. The dossier's "rejects: FV-specific pipeline" nods at this, but the borrow ("validates CausalObservation-as-DAG") over-transfers — FVDebug does not de-risk the software-dataflow-observation shape. Borrow the for/against node-scoring *heuristic*; drop the implied validation.
- **Two load-bearing IDs I could not confirm** and that carry real weight — "efficient dynamic analysis for autonomous debugging agents" (2604.24212, the slicing/SBFL "5–15% wasted-effort" justification) and Debug2Fix (2602.18571, ">20% rel. lift"). Verify before leaning on them; the SBFL rung's quantitative claim rests entirely on the former.
- **On the math-proof/autoformalization gap the task flagged: no over-claim here — affirm it.** The only formal-methods claim is modest and *correct*: hand a CausalObservation's constraint on the offending value to z3 to *synthesize a failing input* (z3 as downstream input-synthesizer, not an engine). Don't let a reviewer "fix" a non-problem. One residual precision bug: SBFL `suspicion: 0.94` is an **ordinal ranking statistic, not a probability** — presenting it as a decimal invites the agent (and `dbg_explain`) to treat 0.94 as "94% likely the cause" and arithmetic-combine it. Label it `rank`/`suspiciousness (ordinal)` and forbid the narrative from doing math on it.

### H. The one non-obvious agent-native opportunity: parallel counterfactual sweep over immutable recordings

The dossier has hypothesis-probing (`interact_code`) but only on **live** sessions — where it mutates real state, needs approval, is dangerous, and is serial. The move that is distinctively *native to a recording-based fleet* and has **no human-debugger analog** (a human has one live process; a fleet has N idle workers and an immutable, forkable trace):

**Fork the recording N ways, inject a different candidate value at the offending frame in each fork, replay-to-assertion in parallel, and return a ranked sensitivity table** — `{exp=5000 → pass; exp=ttl//1000 → pass; exp=-1 → fails differently}`. Zero side effects (it's a recording), zero contention (fork-per-reader), fully parallel across spare workers, and it hands the repair task a **tested** fix candidate instead of a narrative + hope. This converts diagnosis→repair from "here's a story about the cause" into "here is the value change that makes the assertion pass, verified by N counterfactual replays," and it's exactly the kind of thing capability-plane §7 pipelines are for (its `refs` feed the repair brief without entering any agent's context).

It also **resolves the staleness problem in D**: the promotable, matchable unit of fleet debug-knowledge is not the code-bound GB recording (GC it) but the **code-independent signature** — `fault_kind + dataflow_shape + winning_counterfactual` (e.g. "int() truncation at a duration→seconds boundary → widen to `//1000`-with-floor"). Promote the *signature* to the epistemic plane as a Finding; the next time the fleet hits that dataflow shape, it pattern-matches before it re-records. That's the knowledge-plane payoff the dossier gestures at but never operationalizes — and it's a far better answer to "how does a debug observation become durable fleet knowledge" than pinning fossils.
