# 17 — Language & Runtime (a decision record)

*Answering a direct question: is TypeScript the right language for the actual product? Short answer: it's right for the throwaway MVP and for the MCP/SDK glue, and it is **not** the best home for the control-plane core — there are two genuinely better choices, and one of them is uncannily aligned with both the design and this user. Written decisively, per the standing "trust your taste" mandate.*

## The product is not one workload — it's four

You can't pick "a language for baton" because baton is four workloads with different physics:

| Workload | Character | What the language must be good at |
|---|---|---|
| **Control-plane hub** (supervisor, fencing, leases, two-phase stop, single-consumer approvals, crash recovery, the ledger) | long-running daemon, concurrent process orchestration, correctness-critical invariants | supervised concurrency, process/signal handling, daemon stability, making the invariants hard to get wrong |
| **Interop / SDK glue** (MCP northbound if the LLM-orchestrator branch survives; Agent SDK; app-server bindings) | protocol plumbing | being where the first-class SDKs already live |
| **Capability plane** (search/AST/semantic-diff, DAP debug, the validation ladder, analysis) | CPU-bound, calls native tools | native performance, FFI to z3/tree-sitter/analysis tools |
| **Eval + analysis** (the scorecard, RouteStat stats, the measurement itself) | data/stats | fast to write, statistical libraries |

Choosing one language for all four is how you get a core that's mediocre at its hardest job. The honest answer is polyglot, and the interesting decision is *the control-plane core*.

## The realization that reframes the whole question: the supervisor **is** OTP

Read `spec/supervisor-state-machine.md` and `spec/communication-channel.md` back with Erlang/OTP in mind and it's startling — the spec reinvents, less robustly, what BEAM has shipped and battle-tested in telecom for 30 years:

| baton spec concept | The OTP primitive it reimplements |
|---|---|
| "the supervisor," worker leases, "the hub must outlive the orchestrator," crash-recovery, orphan reaping, boot-reconcile (doc 09 B5) | **OTP supervision trees** + restart strategies + `let it crash` |
| single-consumer approval CAS (I2), "one serialization point" for the ledger | **a `GenServer`** — a process that serializes messages by construction |
| the communication channel, mailbox, `ask`/`answer` (spec/communication-channel) | **BEAM process mailboxes** — every process has one, ordered, isolated |
| priority lane + bulk lane + backpressure (supervisor §4) | **`GenStage`/`Flow`** — demand-driven backpressure, built in |
| per-worker isolation, "a crashed agent leaves its marks" (doc 10 T3) | **per-process heap isolation** — one process crashing can't corrupt another |
| multi-hub Foreman/mesh (doc 04 deployment) | **BEAM distribution** — transparent cross-node messaging |
| at-least-once cursors, fencing (I1/I3) | still yours to build, but on a substrate that makes the surrounding correctness free |

Every hard invariant the two review rounds sweated over — the ones that produced the fencing/two-phase-stop/single-consumer machinery — has a native, decades-hardened BEAM primitive. The corpus didn't know it was writing an actor system; it was.

## Pivot 1 changes the language pull (important)

Doc 16's deterministic-orchestrator pivot (the conductor is a program, LLMs are only workers) has a second-order effect that's easy to miss: **it frees the core from TypeScript's gravity.** The main reason to be in TS is that MCP and the Agent SDK are TS-first — but that pull only exists for the *LLM-orchestrator* branch, where the orchestrator reaches the hub *through MCP*. If the orchestrator is a program (Pivot 1), the northbound is just a normal API/CLI surface, and the *southbound* is either subprocess (`claude -p`, `codex exec --json`) or JSON-RPC-over-stdio to the app-server — **both language-agnostic**. So going deterministic doesn't just simplify the architecture; it *unlocks a better core language*. These two decisions are coupled.

## The candidates, judged

- **TypeScript / Node** — right for the *glue* (MCP/Agent SDK are TS-first) and right for the *MVP* (fastest path to interop; the single-threaded event loop makes the fencing/single-consumer invariants trivially race-free at MVP scale; the prototype already exists). Wrong for the *product core*: a weak long-running daemon (GC pauses, leaks), fiddly process/signal/kill-tree handling, and a type system that goes unsound at exactly the edges (`any`, casts) where the review found the bugs.
- **Elixir / OTP (BEAM)** — the **aligned** choice, and the one I'd pick *for this user*. The control plane is an OTP application almost verbatim (table above); you'd delete most of the hand-rolled supervisor and inherit 30 years of fault-tolerance. And decisively: **you already run an Elixir/Phoenix infra stack** (HomeCloud's ExecutionEngine/InferenceRouter/InstancePool) and already think in the "infrastructure logic stays in the infrastructure layer / slot checkout / supervised concurrency" model — this is the same model. Costs: `Port`/`erlexec` subprocess management is workable but not BEAM's strong suit; MCP has no first-class Elixir SDK (you'd build a thin server or bridge — but Pivot 1 makes MCP northbound optional anyway); CPU-bound analysis needs NIFs/subprocess (fine — that's the Rust capability plane).
- **Go** — the **pragmatic** choice and the safe recommendation if OTP ceremony isn't wanted. It's *the* language for concurrent process-orchestrating network daemons; the closest prior art in this exact domain (**claude-squad**, the tmux fleet manager) is Go; goroutines + a single channel-fed goroutine owning the ledger/fence is a clean, idiomatic realization of the single-serialization-point invariants; single-binary deploy is ideal for the SSH-driven Foreman posture; far more robust than Node as a daemon, far less ceremony than Rust. Costs: real parallelism means you *do* have to be disciplined about the invariants (channels/mutexes, not free-threaded shared state); less expressive types than Rust/TS.
- **Rust** — right for the **capability plane specifically**, not the whole core. It's where the real tools already live (tree-sitter, ast-grep, ripgrep, Zoekt, egg, and codex-rs itself), it FFIs to z3/native analysis, its ownership model *enforces baton's fencing/single-owner invariants at compile time* (the borrow checker is a fencing checker), and being in-language with the codex app-server helps raw adapters. Costs for the *whole* core: velocity — for a solo builder chasing an eval number, Rust everywhere is a tax you don't need yet.
- **Python** — right for the **eval + analysis** (stats, the scorecard, RouteStat, any ML in autoformalization/embeddings), and for a second Agent-SDK flavor. Categorically wrong for the concurrent, correctness-critical daemon core (GIL, asyncio edges, dynamic typing hiding exactly the invariant bugs the review found).

## The decision

1. **MVP (now, to get the eval number): keep it TypeScript.** Do not rewrite. The MVP's only job is the measurement (doc 16 Pivot 3); optimizing the language before the eval justifies the product is the corpus's own documented sin. The prototype runs; ship the number.
2. **Product control-plane core (only if the eval justifies a product): Elixir/OTP — recommended for you specifically**, because the design *is* OTP and you already run BEAM; **Go — the pragmatic alternative** if you want single-binary ops and less ceremony. Either is a clear improvement over TS for the daemon core. Adopt Pivot 1 first, because it's what makes this choice free (no MCP-SDK lock-in).
3. **Capability plane: Rust**, where and when it's earned by demand (semantic-diff, AST/graph, analysis, native-tool FFI). Not before.
4. **Interop bridge: TypeScript (or Python)**, thin, only if you keep the LLM-orchestrator branch and need first-class MCP/Agent-SDK. Pivot 1 shrinks this to near-zero.
5. **Eval/analysis: Python.**

So the honest product is roughly: **Elixir/OTP (or Go) core · Rust capability plane · thin TS/Python edges** — a polyglot with each language doing the one thing it's best at, and TypeScript demoted from "the language" to "the MVP and the glue."

## The one caveat

Don't let this decision become a reason to *not ship the eval*. The language of the product is a question the eval *unlocks* — if the number says "one strong agent wins" (doc 16 §2's live possibility), the best language for the product is *no product*. Keep the MVP in TS, get the number, and let it earn the Elixir/Go rewrite. The rewrite is a reward for a favorable measurement, not a prerequisite to one.
