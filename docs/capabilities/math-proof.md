I have enough grounding across the 2025-26 landscape. Here is the design dossier.

---

# Proof-Carrying Validation (the Validation Ladder) — baton capability module

*Module codename: `anvil` — where a worker's *claim* gets hammered into a hub-re-checkable *attestation*. Tool namespace `verify_*` / `spec_*` / `attest_*`.*

## Summary (5 bullets)

- **Rigor is a dial, not a checkbox.** The module exposes one primitive — "validate this artifact against this spec at rung R" — over a seven-rung ladder (types → tests → property tests → fuzzing → bounded model checking → SMT/auto-active → machine-checked proof), plus an **orthogonal machine/assembly axis** (translation validation, ISA-semantic checking, constant-time). The orchestrator picks the rung per task *criticality/blast-radius*; the module does not decide policy, it executes and attests.
- **The load-bearing distinction is forgeability, not pass/fail.** A worker saying "tests pass" is an *unverified claim* (supervisor **I7**). This module converts claims into **proof-carrying artifacts the hub independently re-checks** — and the re-check cost/trust differs sharply by rung: counterexamples are *self-validating* (replay the concrete failing input), machine-checked proof terms are *kernel-re-checkable* (a ~2k-LOC trusted checker the worker cannot fool), bare solver "unsat" is *trust-the-tool-and-pin*. The gate logic is graded, not binary.
- **This is the crown-jewel realization of I7.** For the top rung, "the hub re-checks the proof" is not aspirational: Lean/Rocq/Isabelle proofs are validated by a *small trusted kernel*, and independent external checkers already exist (`lean4checker`, the formally-verified `Lean4Lean`, Rocq's `coqchk`). A worker literally cannot hand back a proof term the hub's kernel accepts unless it is valid — forgery-resistance is a mathematical property, not a policy.
- **Autoformalization is the acknowledged soft spot, and it is a multi-agent problem.** Turning an English spec into a machine-checkable property is where trust actually leaks (a perfect proof of the wrong theorem is worthless). Baton attacks it with orchestration a single harness can't self-provide: **separation of duty** (specifier ≠ implementer ≠ prover), **spec triangulation** (N independent formalizations must agree), and **non-vacuity gates** (satisfiability + differential oracle checks) before any proof counts.
- **Deep validation is expensive, long-running, cacheable, and shared** — exactly the shape that belongs in the task-DAG (addressable/resumable/interruptible jobs), the artifact registry (content-addressed attestations + proof caches shared fleet-wide), and the ledger (verdicts as provenance-carrying events). No single worker harness gets a fleet-wide lemma/solver cache or an independent re-checker; the module does.

## The problem for an agent fleet (why harness-native tools are insufficient)

Every worker harness can already *run a test*. That is precisely the problem. Five orchestration-specific gaps make harness-native validation insufficient:

1. **The claim/verification trust asymmetry (the I7 problem).** "Run pytest" inside a worker is inside the worker's own trust boundary. An adversarial or merely lazy worker can stub the assertion, write a vacuous test, hard-code the oracle, or `exit 0`. Doc 05/supervisor **I7** already says worker-reported `{command, exit, tail}` is a *claim* the hub must independently re-execute. But mere re-execution only catches lying about the exit code — it does not catch a *weak test suite the worker authored to pass*. The fleet needs validation whose **positive result the hub can reproduce with a small independent checker** and whose **strength is not authored by the party being checked**. That is what proof-carrying artifacts (kernel-checkable proof terms, DRAT/LRAT UNSAT proofs, Alive2 refinement certificates) buy and what "run the harness's test tool" cannot.

2. **Separation of duty is a fleet property, not a harness feature.** If one agent writes the code, *its own* spec, and *its own* proof, it can co-adapt all three until the proof is vacuously true (prove `x == x`, or a precondition `false` that makes everything hold). A single harness cannot check itself out of this. An orchestrator *can* assign the specifier, the implementer, and the prover to **different workers with different vendors** and make the spec author's identity part of the attestation. This checks-and-balances design is the single strongest argument that validation belongs in the orchestration layer.

3. **Cost/latency asymmetry breaks the synchronous turn.** A `lake build` of Mathlib, a 3-hour CBMC unroll, or a portfolio SMT run are minutes-to-hours long. Run inline as a harness tool call, they (a) pin a worker slot idle, (b) burn orchestrator context on a blocking wait, and (c) die on the host's ~60s MCP timeout (supervisor I4). Deep validation must live in the **task-DAG as addressable, resumable, interruptible jobs**, polled with bounded calls — not as a synchronous tool return.

4. **The expensive index is a shared fleet asset.** Mathlib, the Sail ISA models, a discharged-VC / lemma cache, the spec registry — all are costly to build and *identical across workers*. A per-worker harness rebuilds them N times and shares nothing. Content-addressing a discharged verification condition `(spec_hash, tool, version) → verdict` turns one worker's proof into a fleet-wide cache hit, exactly like the shared ctags/rg index in baton's other capability modules.

5. **Validation is the merge gate, and the gate is a hub concern.** A task transitioning to `completed` and merging into a shared worktree is a coordinative-layer event (doc 08). Making "the required rung's certificate re-verified at the hub" a *precondition* of that transition is only expressible where the task lifecycle lives — the hub. Harness-native tools have no notion of "you may not merge until an independent kernel accepts your proof."

## Prior art

Real tools, current status, and what baton takes/leaves. (Installed locally and demoable: `z3`, `python3`/Hypothesis, `cargo`+Kani-family, `clang`/LLVM+Alive2, `lldb`, `rg`, `ctags`.)

| Tool / system | What it does | 2025-26 status | What baton borrows | What baton rejects |
|---|---|---|---|---|
| **Z3** (installed) | Workhorse SMT solver; best API/Python bindings | Ubiquitous; the default backend under Dafny/Kani/Boogie | R5 direct-SMT rung; the reference solver in the portfolio | "bare `unsat`" as a trusted positive without a checkable proof or version pin |
| **cvc5** | Versatile SMT: strings, quantifiers, SyGuS, proofs | Actively released ([cvc5/cvc5](https://github.com/cvc5/cvc5/releases)); strong on quantifiers/strings | Portfolio member; **proof-producing** mode for hub re-check | single-solver dependence |
| **Bitwuzla** | Bit-vector / FP / array specialist | Best-in-class on QF bit-vector/FP divisions ([Bitwuzla, CAV'23](https://bitwuzla.github.io/)) | Portfolio member for machine-word/FP obligations (assembly-level reasoning) | using a general solver where a BV specialist is 3-5× faster |
| **Lean 4 + Mathlib** | Dependent-type proof assistant + huge math library | Frontier for AI proving; Mathlib the de-facto corpus | R6 rung; Mathlib as shared read-only index | per-worker Mathlib rebuild; treating Lean as a *test* runner |
| **`lean4checker` / `Lean4Lean`** | Independent external kernel re-checkers for Lean | `lean4checker` CI-recommended; **`Lean4Lean`** is a formally-verified checker, ~20-50% slower, validates all of Mathlib ([digama0/lean4lean](https://github.com/digama0/lean4lean), [arXiv 2403.14064](https://arxiv.org/abs/2403.14064)) | **The literal I7 hub-recheck for R6** — the small TCB that makes proof forgery-resistant | trusting the elaborator; the hub re-runs the *kernel*, not the tactic engine |
| **Rocq** (ex-Coq) | Proof assistant; `coqchk` independent checker | Renamed with **Rocq 9.0, Mar 2025** ([release notes](https://rocq-prover.org/releases/9.0.0)) | `coqchk` as alt-R6 re-checker; CompCert lives here | — |
| **Isabelle/HOL** | Proof assistant; LCF-kernel, proof export | Actively maintained; Sail exports to it | LCF small-kernel discipline as the re-check model | — |
| **Dafny** | Auto-active verifier (contracts → Z3 VCs) | **4.11.0, Aug 2025**, Amazon-led ([releases](https://github.com/dafny-lang/dafny/releases)); active "vericoding" benchmarks at POPL'26 | R5 rung for algorithmic code; contracts-as-spec ergonomics | Dafny as a *language to write in* (baton validates existing code, doesn't mandate rewrites) |
| **Verus** | SMT verification of **Rust** with ghost types | Active; closest tool to Kani in ambition | R5 for Rust when contracts are wanted vs BMC | assuming all Rust tasks want ghost-type annotation overhead |
| **F\*** / **Why3** | Dependently-typed verifier / multi-prover VC platform | F\* active (HACL\*/EverCrypt); **Why3 1.8.2**, 2025 | Why3's multi-prover dispatch idea → the *portfolio* pattern | Why3's IDE-centric human workflow |
| **Frama-C** | C analysis (WP plugin → Why3/provers), abstract interpretation (Eva) | **31.0 "Gallium", Jun 2025** ([frama-c.com](https://frama-c.com/)) | R5 for C; ACSL contracts; Eva as an R0.5 abstract-interp cheap check | plugin-config sprawl as agent surface |
| **CBMC** | C bounded model checker (SAT/SMT backend) | Mature; the engine under Kani | R4 rung for C | unbounded claims from a bounded tool |
| **Kani** | **Rust** BMC: MIR → CBMC; no annotation needed | **Monthly releases**; used to verify the Rust std lib (725 harnesses, 33.9k fns) ([arXiv 2607.01504](https://arxiv.org/abs/2607.01504)) | **R4 flagship** — annotation-free memory-safety + contract/loop-contract/stubbing extensions; self-validating concrete counterexamples | reporting "verified" without stating the unwind bound |
| **Alive2** | Bounded **translation validation** for LLVM IR (src→opt refinement, SMT, no false alarms) | Active; found 47 LLVM bugs, drove 8 IR-semantics fixes ([PLDI'21](https://web.ist.utl.pt/nuno.lopes/pubs.php?id=alive2-pldi21)) | **The machine-axis workhorse**: prove the *compiled/optimized* form refines the source | treating "no counterexample ≤ bound" as unconditional proof |
| **CompCert** | Formally verified C compiler (in Rocq) | Canonical; semantic preservation C→asm | The "verified toolchain closes the source→binary gap" pattern | mandating CompCert as the fleet's compiler |
| **CakeML** | Verified ML compiler to machine code; **verified proof checkers** (Candle) | Active; end-to-end binary-level proof provenance ([cakeml.org/checkers](https://cakeml.org/checkers.html)) | The idea that a *checker itself* can be verified down to machine code (minimal TCB) | full-stack adoption cost |
| **Sail** | ISA-semantics DSL → executable emulators + Isabelle/Rocq/HOL4 defs + `isla` symbolic engine | **Official RISC-V model**; ARMv8-A, x86 fragments, CHERI ([riscv/sail-riscv](https://github.com/riscv/sail-riscv)) | **The ISA-semantic rung**: symbolically check a compiled binary against authoritative ISA semantics via `isla` | assuming the Sail model == silicon (it's a model) |
| **K-framework** | Executable formal semantics (KEVM etc.) | Active for VM/bytecode semantics | Alt ISA/bytecode-semantics engine for DSL/interpreter tasks | heavyweight for the common case |
| **Jasmin / ct-verif / Binsec-Rel** | Constant-time & side-channel verification at asm/binary level | Active; ct-verif/Binsec-Rel + newer CT-Prover find real CVEs in SSL libs (2024-25) | **The constant-time axis** — a *distinct* property (leakage), not functional correctness | conflating CT with correctness in one verdict |
| **angr / KLEE / Manticore** | Symbolic execution of binaries / LLVM bitcode | angr & KLEE active; still the standard engines (2025) | R3.5 symbolic-execution rung; binary-level counterexamples | path-explosion presented as coverage |
| **Hypothesis / QuickCheck / proptest** | Property-based testing w/ shrinking | Standard in Python/Haskell/Rust | **R2 rung** — generative props + *minimal* shrunk counterexamples (self-validating) | PBT as a substitute for the deep rungs on critical code |
| **DeepSeek-Prover-V2 / Goedel-Prover-V2 / AlphaProof** | LLM proof search in Lean 4 | **DeepSeek-Prover-V2** (671B, 88.9% miniF2F, Apr'25); **Goedel-Prover-V2-32B** (88.1→90.4%, Aug'25, 80× smaller beats it); **AlphaProof** IMO-silver ([arXiv 2504.21801](https://arxiv.org/html/2504.21801v1), [2508.03613](https://arxiv.org/pdf/2508.03613)) | The *prover* worker role: a worker can invoke these to discharge R6 — **but the hub still re-checks the kernel term** | trusting the LLM prover's word; the kernel is the arbiter, not the model |
| **Autoformalization benchmarks** (FormalMATH, PutnamBench, miniF2F, RLM25) | English↔formal spec translation eval | **FormalMATH** 5,560 Lean4 problems; **RLM25** research-level; still far below 100% ([spherelab.ai/FormalMATH](https://spherelab.ai/FormalMATH/)) | Sobering ground truth: autoformalization is the *untrusted* step → triangulation + non-vacuity gates | one-shot English→spec as authoritative |

## Module design

### Agent-facing interface (MCP verbs)

Deliberately small; used by **both** workers (to self-validate / produce proofs) and the orchestrator (to plan rungs and gate merges). Long operations return job handles, never block.

```ts
// ---- rung selection (steering knob; cheap, synchronous) ----
verify_plan(task_id, {spec_ref?, criticality: 'trivial'|'standard'|'load_bearing'|'critical',
                      lang, blast_radius?}) 
  -> { rung: 'R0'..'R6', axis?: ('tv'|'isa'|'ct')[], tools: string[],
       est_cost: {tokens, wall_s, solver_s}, cache: {hits, refs[]}, rationale }

// ---- submit a validation job (long-running -> becomes a task-DAG sub-task) ----
verify_run(task_id, { rung, axis?, target_ref /*git sha|binary|IR*/, spec_ref,
                      budget: {wall_s, solver_s, unroll?, proof_depth?},
                      solver_portfolio?: string[], seed? })
  -> { job_id, dag_node_id }                    // returns immediately

verify_status(job_id) -> { state:'working'|'input_required'|'completed'|'failed',
                           progress, partial?: {best_bound?, subgoals_closed?} }
verify_result(job_id) -> Attestation            // see output shape below
counterexample_get(job_id) -> { model, minimal_repro, trace_ref }  // self-validating negative

// ---- the I7 hub-recheck: independent re-verification of a proof-carrying artifact ----
attest_check(attestation_ref) 
  -> { ok: bool, checker: 'lean4checker'|'coqchk'|'drat-trim'|'alive2'|'rerun-sandbox',
       recomputed_digest, checker_version, wall_s }   // hub-only; workers CANNOT forge past this

// ---- autoformalization (the untrusted step; returns CANDIDATES + sanity, never one answer) ----
spec_formalize(nl_spec, { target_lang:'lean'|'dafny'|'acsl'|'z3smt'|'verus',
                          context_refs?, n_candidates? })
  -> { candidates: [{ formal, confidence, back_translation }],
       triangulation: { agree: bool, divergences[] },
       vacuity: { satisfiable, negation_refutable, oracle_examples: {pass[], fail[]} } }

spec_register(task_id, { formal_spec, author_worker_id, provenance, supersedes? })
  -> spec_ref                                   // enforces specifier≠implementer separation-of-duty
```

Anti-verb (refused by design, mirroring doc 05's `fleet_chat` stance): **no `verify_trust_me`** — there is no path for a worker to assert a verdict the hub doesn't re-derive. Every positive above `R0` carries an artifact `attest_check` can independently re-run.

### The ladder (the rigor dial), with the forgery-resistance column that matters

| Rung | Rigor bought | Representative tools | Typical cost | **Positive = "pass" means** | **Hub re-check of a positive** |
|---|---|---|---|---|---|
| **R0 types** | ill-typed states unrepresentable | rustc, clang `-Wall`, pyright | seconds | compiles/type-checks | **re-run compiler** (deterministic) |
| **R1 tests** | named cases hold | hub-rerun example tests | seconds | authored cases pass | **re-run in fresh sandbox (I7)** + coverage/mutation guard (defeats vacuous suites) |
| **R2 property** | invariants over *generated* inputs | Hypothesis, proptest, QuickCheck | seconds-min | no counterexample found w/ seed S | **re-run with a *different* seed**; negatives are self-validating |
| **R3 fuzz** | no crash over coverage-guided corpus | cargo-fuzz, libFuzzer, AFL++ | minutes-hours | no crash ≤ time budget | replay corpus; **crash inputs self-validating** |
| **R3.5 symexec** | path-wise assertion checks | KLEE, angr, Manticore | minutes-hours | no violating path explored | replay the concrete violating input |
| **R4 BMC** | exhaustive ≤ bound k | **Kani** (Rust), **CBMC** (C), ESBMC | minutes-hours | no bug for all inputs up to unroll k | replay concrete counter-trace; positive is *trust-tool + pinned bound* |
| **R5 SMT / auto-active** | VCs discharged (unbounded) | **Z3/cvc5/Bitwuzla**; **Dafny/Verus/Frama-C/Why3/F\*** | seconds-hours | solver returns UNSAT (no counterexample exists) | **re-check DRAT/LRAT or SMT proof** if produced; else *trust-solver + version/seed pin*; SAT models self-validating |
| **R6 machine-checked proof** | full spec proven | **Lean 4 / Rocq / Isabelle** (+ AI provers as *search*) | minutes-hours | a proof *term* of the spec exists | **independent kernel re-check** (`lean4checker`/`Lean4Lean`/`coqchk`) — **worker cannot forge** |

**Orthogonal machine/assembly axis** (composes with any rung, because a worker proves things about *source* but ships *binaries*):

- **`tv` — translation validation:** did the *compiled/optimized* artifact preserve the source semantics? **Alive2** for LLVM peephole/opt refinement; per-build TV. Verdict is a refinement certificate the hub re-checks. Answers "the compiler didn't betray your proof."
- **`isa` — ISA-semantic checking:** does the *machine code* satisfy the spec under *authoritative* ISA semantics? Lift the binary and symbolically check against a **Sail**-derived model via **`isla`** (RISC-V/ARM), or **K/KEVM** for bytecode DSLs. Answers "your custom interpreter / emitted assembly means what you claim on real silicon semantics."
- **`ct` — constant-time / side-channel:** a *distinct* property (leakage, not functional correctness) — **ct-verif / Binsec-Rel / Jasmin** at asm/binary level. Reported as a separate verdict, never merged into the correctness bit.

**How proof-carrying code is produced end-to-end:** a worker returns a bundle `{ code@sha, spec_ref, artifact: (proof_term | drat_proof | alive2_cert | counter_trace), tool@version, recheck_recipe }`. The hub's merge gate runs `attest_check(recheck_recipe)` — a *cheap, independent* re-derivation relative to the *expensive* original search — and only a pass lets the task-DAG node transition to `completed`. That asymmetry (proving is hard, checking is easy-and-independent) is the whole game, and it is why the gate is not forgeable.

### Integration with the three planes

**Control plane (supervisor).** Validation *is* the concrete implementation of **I7**. New ledger events (all carry `actor` + provenance edges to the events that justified them, per doc 08 causal backbone):
`verify.rung.chosen`, `verify.job.started/progress`, `spec.formalized`, `spec.vacuity.warning`, `verify.attestation.produced` (worker claim), **`attest.recheck.passed/failed`** (the authoritative hub event — the worker's `attestation.produced` is non-authoritative and, per I7, the "untrusted worker output" frame is applied by the hub and not quotable by the worker), `verify.counterexample`, `verify.gate.blocked`. Steering surface for the orchestrator:
- **Rung as the primary knob** — raise a merge-blocking `critical` task from R2 to R6, or *lower* it: on a `loop_suspected` signal against a stalling R6 proof, steer down to R4 Kani to get a fast concrete counterexample instead of an infinite proof search. This is doc 05's "intervene on signal" applied to validation.
- **Budget caps** — proofs are unbounded; the orchestrator sets `solver_s`, `unroll`, `proof_depth`. Portfolio solving (Z3 ∥ cvc5 ∥ Bitwuzla, first-to-finish wins, losers cancelled) is the natural default for R5.
- **Interruption** — solvers/BMC/proof runs are externally killable (SIGTERM→SIGKILL, doc 05 `kill` sequence). Jobs checkpoint partial state (SMT: last frontier; proof assistant: `sorry`-annotated partial term; Kani: best bound reached) and are **resumable by `job_id`** — a validation job is exactly the "long operation lives in the task-DAG" case.

**Knowledge plane.** 
- *Coordinative (task-DAG + artifact registry):* each `verify_run` is a **sub-task node** with real deps (`spec must be registered → code must compile → then TV → then proof`) and the standard 5-state lifecycle. The parent task's `verification` field names the **required rung**; the node cannot reach `completed` until `attest.recheck.passed`. The **Attestation is an artifact** in the registry, content-addressed; proof terms / DRAT logs / Alive2 certs / counter-traces live in git, the registry indexes them. The **proof/lemma cache** `(spec_hash, tool, version) → verdict` is a registry projection — one worker's discharged VC is a fleet cache hit.
- *Epistemic (selective promotion, doc 08 §5):* at run boundaries the module emits `pm_log_finding`-shaped records for durable outcomes ("spec S for task T proven at R6, kernel-rechecked, cost 34 min") and `pm_decision` for consequential rung choices ("dropped auth-token compare from R6 to `ct` axis after Binsec-Rel found a leak"). It does **not** run a second brain at fleet tempo.

### Agent-ergonomic output shape

`verify_result` returns a **token-bounded Attestation**, not a solver dump. A *failure* leads with the minimal counterexample (the valuable part); a *success* leads with what was re-checkable.

```jsonc
// FAILED R4 (Kani) — counterexample is self-validating, hub can replay it
{ "verdict": "refuted", "rung": "R4", "tool": "kani@0.60",
  "task": "t_auth_compare", "spec_ref": "spec:sha256:9f21…",
  "counterexample": {                       // <-- the payload; concrete, replayable
    "input": { "a": "0x00", "b": "0x80", "len": 1 },
    "violated": "postcondition: eq ⟺ bytewise_equal",
    "minimal_repro_ref": "git:artifacts/t_auth/cex_0001.rs",
    "trace_ref": "reg:trace/8c…" },          // full trace addressable, NOT inlined
  "unwind_bound": 8, "solver_s": 41, "recheck": "replay-sandbox: reproduced ✓" }

// PASSED R6 (Lean 4) — the proof-carrying, kernel-re-checked positive
{ "verdict": "proven", "rung": "R6", "tool": "lean4@4.x + goedel-prover-v2 (search)",
  "task": "t_ringbuf", "spec_ref": "spec:sha256:1a03…",
  "artifact": { "proof_term_ref": "git:proofs/t_ringbuf.olean", "size_kb": 214 },
  "attest_check": { "ok": true, "checker": "lean4checker",   // <-- independent hub re-check
                    "checker_version": "…", "wall_s": 3.1 },  // cheap vs the hours to find it
  "tcb_note": "trusts: Lean kernel + spec_ref formalization (NOT the AI prover)",
  "cost": { "search_wall_s": 2280, "recheck_wall_s": 3.1 } }

// spec_formalize — deliberately plural + a non-vacuity verdict
{ "candidates": [ {"formal":"∀ i, get (set b i v) i = v ∧ …", "confidence":0.71,
                   "back_translation":"setting index i then reading i yields v"},
                  {"formal":"…alt…", "confidence":0.63} ],
  "triangulation": { "agree": false,
                     "divergences": ["candidate 2 omits the out-of-bounds precondition"] },
  "vacuity": { "satisfiable": true, "negation_refutable": true,
               "oracle_examples": { "pass":[…3…], "fail":[…2…] } },
  "recommendation": "escalate: candidates disagree on OOB precondition — human/second-worker adjudication before proof" }
```

Design rules: full traces/proof terms/solver logs are **addressable refs into the registry**, never inlined (context is the scarcest resource — doc 05 §3). The orchestrator's digest is one line: `t_auth_compare: R4 REFUTED — eq⟺bytewise fails at a=00,b=80 (repro cex_0001.rs)`.

### Shared vs per-worker (concurrency)

- **Shared, fleet-wide (built once, immutable, content-addressed):** Mathlib/proof-library index, Sail ISA models, the discharged-VC / lemma cache, the **spec registry**. Because attestations are immutable and content-addressed, concurrent writes are append-only and naturally safe — the *same* discipline as doc 08 §4's artifact registry (the repo is the memory; the registry finds it). Same `(spec_hash, tool@version) → verdict` from any worker collapses to one cache entry.
- **Per-job, sandboxed:** every solver/BMC/proof run executes in the worker's (or a fresh throwaway) sandbox — **never on the hub** (I7). The hub only ever runs the *cheap re-checker*, whose small TCB is the point.
- **The one place needing serialization:** the *canonical* spec of a task (`spec_register` is a compare-and-swap on `spec_ref`, like task claims). This is also where **separation-of-duty** is enforced: `spec_register` records `author_worker_id`, and a `verify_run` producing an R5/R6 positive whose prover == spec author == implementer is **flagged in the attestation** (`independence: violated`) so the orchestrator can require a second worker's spec/proof for `critical` tasks.

## Scoping (MVP rung vs later rungs)

**MVP — the ladder spine + the I7 spine (weeks, against installed tools).** Ship exactly two things:
1. **Hub-side independent re-execution as the merge gate** — `verify_run` at **R0–R2** (rustc/clang typecheck; hub-rerun example tests in a fresh sandbox; Hypothesis/proptest property tests with a hub-chosen seed) plus `attest_check` = "re-run deterministically, content-address the result." This alone operationalizes I7: it converts every "tests pass" claim into a hub-observed, reproduced, provenance-carrying attestation, and self-validating property-test counterexamples flow into the ledger. It proves the thesis (*workers can't forge a passing gate*) with tools already on the box.
2. **`verify_plan` rung selection** wired to the task's `criticality`, so the orchestrator has the dial from day one even if the top rungs are stubs.

**Next (earned by demand):** R4 **Kani/CBMC** with self-validating counterexamples; R5 **Z3 portfolio + Dafny/Verus**; the shared proof/lemma cache.

**Later (the deep, hard rungs — explicitly harder):** R6 **Lean 4 + `lean4checker` re-check** (the forgery-resistant crown gate, and the cleanest demo of "the hub re-checks a proof the worker cannot fake"); **autoformalization** (`spec_formalize` with triangulation + non-vacuity, the genuinely open problem); and the **machine/assembly axis** — **Alive2** translation validation (highest ROI: fully automatic, no annotations, immediately demoable on `clang`+LLVM here), then **Sail/`isla`** ISA-semantic checking and **Jasmin/Binsec-Rel** constant-time for the crypto/security-critical tail.

## Limitations & honest residuals

- **The wrong-spec / vacuous-proof problem is the real ceiling, and it does not go away.** A kernel-perfect proof of a misformalized theorem is worthless, and *autoformalization is where trust leaks* — current benchmarks (FormalMATH, RLM25) are well below 100% even on math, and arbitrary *software* specs are harder and harder to evaluate. Triangulation, non-vacuity gates, and specifier≠implementer separation *reduce* this risk; they do not eliminate it. This is the honest headline residual: baton buys "this artifact provably satisfies *this stated property*," never "this artifact does what you *meant*."
- **The TCB is non-zero and must be named in every attestation.** R6 trusts the Lean/Rocq kernel *and the formalization*. `isa` trusts the **Sail model, which is a model, not the silicon**. `tv`/verified-compiler rungs trust the preservation proof. R5 UNSAT without a checkable proof trusts the solver (mitigated by DRAT/LRAT re-checking where the theory supports it, and version+seed pinning where it doesn't). The `tcb_note` field is mandatory, not decorative.
- **Bounded methods are bounded.** R3/R3.5/R4 and Alive2 find bugs; "no counterexample ≤ bound k" is **not** a proof of absence. Attestations must state the bound; the orchestrator must not read R4-pass as R6-proven.
- **Undecidability and cost.** General functional correctness is undecidable; the ladder buys *rigor proportionate to cost*, not omniscience. R6 can run for hours or simply fail within budget — the module must fall back down the ladder gracefully and say so, never hang (mirrors supervisor deny-with-message on timeout).
- **Language coverage is uneven.** The deep rungs are strongest for **Rust** (Kani/Verus), **C** (CBMC/Frama-C/CompCert), **LLVM IR** (Alive2), and **Lean/Rocq** (math). Python/JS/Go top out around R2–R3.5; the ladder's honest max height is language-dependent and `verify_plan` must report it rather than promise a rung it can't reach.
- **Non-determinism / flakiness at the boundary.** Portfolio SMT and proof search are time- and seed-sensitive; pinning `tool@version` + `seed` in the attestation makes a *pass* reproducible, but a *timeout* on one run vs a solve on the next is real and must be treated as an environment-dependent flake (CLAUDE.md's "failing tests must be resolved" discipline — file it, don't dismiss it).

## Sources

- DeepSeek-Prover-V2 — [arXiv 2504.21801](https://arxiv.org/html/2504.21801v1); Goedel-Prover-V2 — [arXiv 2508.03613](https://arxiv.org/pdf/2508.03613); AlphaProof (DeepMind, IMO-silver, 2024).
- Rocq 9.0 (Coq rename, Mar 2025) — [release notes](https://rocq-prover.org/releases/9.0.0), [changelog](https://rocq-prover.org/changelog).
- Lean external checkers — [digama0/lean4lean](https://github.com/digama0/lean4lean), [Lean4Lean paper (arXiv 2403.14064)](https://arxiv.org/abs/2403.14064), [Lean "Validating a Proof" docs](https://lean-lang.org/doc/reference/latest/ValidatingProofs/).
- Kani — [arXiv 2607.01504](https://arxiv.org/abs/2607.01504), [getting started](https://model-checking.github.io/kani/getting-started.html); Rust std verification — [arXiv 2510.01072](https://arxiv.org/html/2510.01072v1). Verus — cited via Kani comparison.
- Alive2 — [PLDI'21](https://web.ist.utl.pt/nuno.lopes/pubs.php?id=alive2-pldi21), [ACM DL 10.1145/3453483.3454030](https://dl.acm.org/doi/10.1145/3453483.3454030). CompCert / CakeML — [CakeML verified checkers](https://cakeml.org/checkers.html), [CakeML-to-machine-code (CPP'17)](https://cakeml.org/cpp17.pdf), [Foundational PCC (Appel)](https://www.cs.princeton.edu/~appel/papers/fpcc.pdf).
- SMT — [SMT-COMP 2025](https://smt-comp.github.io/2025/), [cvc5 releases](https://github.com/cvc5/cvc5/releases), [Bitwuzla (CAV'23)](https://link.springer.com/chapter/10.1007/978-3-031-37703-7_1).
- Sail / ISA — [riscv/sail-riscv](https://github.com/riscv/sail-riscv), [isla adaption](https://github.com/rems-project/isla-sail-riscv), [ISA semantics for ARMv8-A/RISC-V/CHERI-MIPS (POPL'19)](https://dl.acm.org/doi/abs/10.1145/3290384).
- Auto-active verifiers — [Dafny releases](https://github.com/dafny-lang/dafny/releases), [Frama-C 31.0](https://frama-c.com/html/news.html), [Why3 changes](https://www.why3.org/doc/changes.html), Dafny/POPL'26 vericoding.
- Constant-time — [Towards Efficient Verification of Constant-Time (arXiv 2402.13506)](https://arxiv.org/abs/2402.13506), [Binsec/Rel (arXiv 2209.01129)](https://arxiv.org/pdf/2209.01129), [ct-verif (USENIX Security'16)](https://www.usenix.org/system/files/conference/usenixsecurity16/sec16_paper_almeida.pdf).
- Symbolic execution — [angr docs](https://docs.angr.io/), [Manticore (arXiv 1907.03890)](https://arxiv.org/pdf/1907.03890).
- Autoformalization / specs — [FormalMATH](https://spherelab.ai/FormalMATH/), [Reliable Autoformalization Eval (arXiv 2406.07222)](https://arxiv.org/pdf/2406.07222), [Verified Lean-to-C proof-carrying pipeline (2025)](https://www.researchgate.net/publication/397883522).

---

# Appendix: Design critique (workflow critic pass)

## Design critique & sharpening for math-proof

This is the strongest dossier of the set on *conceptual* framing — the forgeability-not-pass/fail reframe and the "hub re-checks a term the worker can't fake" thesis are exactly right, and they are the reason this module deserves to exist. But the dossier floats *beside* baton's actual capability-plane contract rather than conforming to it, its crown-jewel claim is technically false as stated, its MVP is redundant with a supervisor invariant that already ships, and it hand-waves the two hardest problems it names (shared-state cache invalidation and resumability). Corrections first, because several are load-bearing.

### 0. Factual corrections (fix before circulating)

- **"Installed locally and demoable" is false for the tools that matter.** On this box only `z3` (4.15.2), `rg`, `ctags`, `clang`, `cargo/rustc`, `python3`, `node`, `lldb` are present. **Kani, CBMC, Lean, and Alive2 are NOT installed** (`which` returns nothing). The dossier repeatedly leans on "cargo+Kani-family, clang/LLVM+Alive2 … installed and demoable" and calls Alive2 "immediately demoable on clang+LLVM here." Alive2 is a separate z3-backed build against a specific LLVM, not a flag on the installed `clang`; standing it up is a day, not a demo. **The only deep verifier actually on the box is z3.** This directly changes the MVP (see §2).

- **The crown-jewel claim is unsound as written.** "A worker literally cannot hand back a proof term the hub's kernel accepts unless it is valid" is **false**. `sorry` elaborates to `sorryAx : α`, which the Lean kernel *accepts* — it is a known axiom. A worker can also `axiom cheat : False` or lean on `native_decide` / `Lean.ofReduceBool` (which trust the *compiler*, not the kernel — documented TCB escape hatches) and `@[implemented_by]`. `lean4checker` re-running the kernel will happily accept all of these. Forgery-resistance therefore requires **three** conjuncts, not one: (a) kernel type-checks the term, **(b) `#print axioms` / axiom audit shows the used axiom set ⊆ an allowlist and contains no `sorryAx`, (c) no `native_decide`/`ofReduceBool`/`implemented_by` on the trusted path** (or those are explicitly named in `tcb_note`). The attestation's `tcb_note` must *enumerate the actual axioms used*, not say "trusts: Lean kernel." This is the single most important fix — the whole thesis over-claims without it, and it's cheap to close (`coqchk -o` prints Coq's assumptions similarly).

- **"Checking is easy" is rung-dependent, and the dossier states it as universal ("that asymmetry … is the whole game").** True for a proof-assistant kernel (linear-ish in term size). **False for R5**: DRAT/LRAT UNSAT proofs are routinely gigabytes and `drat-trim` checking can equal or exceed the original solve time; large SMT proofs likewise. The property that *actually* holds across all rungs is **independence** (a different, small-TCB checker), not cheapness. Reframe the load-bearing invariant as "*independently* re-checkable," and let cheapness be a per-rung annotation in the card.

- **`est_cost.solver_s` is a fiction the dossier later contradicts.** `verify_plan` promises a solver-seconds point estimate; the Limitations section then correctly says "proofs are unbounded." You cannot predict z3/BMC/proof-search wall time on an obligation — that unpredictability is *why* budgets exist. Make `est_cost` a **distributional prior pulled from the cache** ("obligations of this shape: p50=8s, p95=timeout") plus "unbounded; budget-capped" for R5/R6. A point estimate here is exactly the kind of confident-wrong output that poisons the orchestrator's planning.

### 1. Integration is asserted, but the module does not speak the capability-plane contract (the biggest structural gap)

`spec/capability-plane.md` is not optional background — it is the contract every module MUST implement, and this dossier ignores its concrete shapes while claiming three-plane integration:

- **The mandated call shape is `invoke(op, args, ctx)` returning the ACI envelope** (`summary` / `payload` / `refs` / `cursor` / `cost` / `provenance`). The dossier invents a bespoke verb set (`verify_run`, `verify_status`, `verify_result`, `attest_check`) and a bespoke `Attestation` JSON that shares *none* of those field names. The whole point of the envelope (law: "so the orchestrator and workers learn *one* way to consume tool output") is defeated. The fix is nearly free because the Attestation is *already* envelope-shaped in spirit: make the Attestation the `payload`, promote the one-line digest to the mandatory `summary`, move `trace_ref`/`proof_term_ref` into `refs`, and add `cost`/`provenance`. Domain verbs (`verify.plan`, `verify.run`) are fine as `op` strings *inside* `invoke`, not as a parallel API.

- **`attest_check` is a reinvention of the contract's `reverify()`.** The interface already defines `reverify(claim, ctx) -> Verdict` as *the* I7 hook. Don't ship a second name for it. Rename `attest_check` → the module's `reverify` implementation; the `checker`/`checker_version`/`recomputed_digest` fields become the `Verdict` body.

- **The invented ledger kinds violate doc 05's closed taxonomy.** Doc 05 §1 states the kind set is "closed … versioned," and the capability-plane law is "every op emits `capability.op.started/completed`." The dossier mints `verify.rung.chosen`, `attest.recheck.passed`, etc. as if new top-level kinds. Either emit `capability.op.completed` with `payload.verdict`/`payload.rung` (correct, no schema change), **or** explicitly propose the taxonomy amendment. Silently extending a closed set is the kind of drift the adapter-card version-probe discipline exists to prevent.

- **A real I7-locus contradiction the dossier must resolve.** I7 and capability-plane §6 both say re-verification runs **"in the worker's (or a fresh throwaway) sandbox — never on the hub."** The dossier says "the hub only ever runs the *cheap re-checker*" and "hub-only." A `.olean`, a DRAT log, or an Alive2 IR file is *adversarial input to the checker*; a checker bug is an exploit primitive against the hub process. The small-TCB argument is about the checker's *logic*, not about it being safe to feed attacker-controlled bytes on the orchestrator host. Correct statement: **the hub *initiates and trusts* the re-check, but it runs in a fresh throwaway sandbox, never in the hub process.** "Hub-run" means hub-authoritative, not hub-hosted.

Net: this module is doc 11's validation module — capability-plane §7 literally names "validation: types→test→proptest→fuzz→BMC→SMT→proof" as the archetypal ladder and §8 names `test` as its MVP rung. So the *slot* is correct. But the dossier reads as if written before the capability-plane spec existed. One editing pass to conform it to `Capability`/`invoke`/`reverify`/ACI-envelope/`card()` would convert "floats beside baton" into "is baton."

### 2. Scoping: the MVP is redundant with a shipped invariant, and it proves the version of I7 the dossier itself calls insufficient

The proposed MVP is R0–R2 (typecheck + hub-rerun example tests + Hypothesis with a hub seed) + `verify_plan`. Two problems make this **too timid, not minimal-and-useful**:

1. **It overlaps supervisor I7, which already re-executes the brief's verification command in a sandbox.** "Re-run the tests in a fresh sandbox and content-address the result" is *what the supervisor already does* per spec line 29. An MVP that mostly re-implements a shipped invariant does not justify a new capability module. The module earns its existence *only* at the rungs where the artifact is **proof-carrying and its strength is not authored by the checked party** — and the MVP defers every one of those to "Later."

2. **The MVP's own "defeats vacuous suites" claim is unfunded.** Gap #1 correctly says re-execution "does not catch a weak test suite the worker authored to pass," yet the R1 row promises a "coverage/mutation guard (defeats vacuous suites)" while the MVP tool list is only rustc/clang/Hypothesis — *no mutation tester*. The claim and the toolset contradict.

**Sharper MVP (still weeks, still installed tools, but actually proves the thesis):**

- Keep R0–R2 hub-rerun as the cheap spine (fine), **but demote it from "the demo" to "table stakes."**
- **Add mutation testing as the R1.5 rung using `cargo-mutants`** (Rust, installable today alongside the present `cargo`; `mutmut`/`Stryker` for other langs). This is the *cheap* operationalization of "strength not authored by the checked party": the mutation score is generated by the hub against the worker's suite, so a vacuous suite is caught by a hub-computed number the worker can't fake. This is more central to the module's thesis than any deep rung and it's genuinely minimal.
- **Add exactly one forgery-resistant rung to the MVP using z3** — the only deep verifier on the box. A spec/obligation → z3 → **either a SAT model (self-validating: substitute-and-evaluate, milliseconds) or UNSAT with a checkable proof**. This is the smallest possible artifact that demonstrates "the hub re-checks something the worker structurally cannot forge," which R0–R2 never does. Without it the MVP demo is indistinguishable from "the supervisor re-runs pytest."

So: *not* boiling the ocean (Lean/Sail/Alive2/ct correctly deferred), but the MVP as drawn is timid in the one dimension that matters — it ships the module without shipping the idea. cargo-mutants + z3-with-a-checkable-verdict is the minimal thing that isn't redundant.

### 3. Agent-ergonomic output: right instincts, two real defects

The counterexample-first-on-failure, digest-as-one-line, refs-not-inlined design is correct and is the dossier's best ACI instinct. Two things break it in practice:

- **"Leads with the *minimal* counterexample" is false for the BMC/SMT rungs.** Only property-based testing (Hypothesis/proptest) shrinks. Kani/CBMC/angr return the *first* counterexample found, which for a struct-heavy obligation is frequently kilobytes of concrete model. The example `input: {a:"0x00", b:"0x80", len:1}` is a toy; a real Kani cex over a `Vec<Struct>` is not that. Fix: (a) state `"minimized": false` honestly, or run a delta-debugging minimization pass and record its cost; (b) **hard-bound the inline cex to K bytes; overflow → `refs`**, with `minimal_repro_ref` (the replayable script) as the payload and the full model addressable. Right now "the payload; concrete, replayable" has no size discipline, which is exactly the context blow-out the envelope exists to prevent.

- **`spec_formalize` returning N candidates + `triangulation.agree:false` + `recommendation:"escalate"` is the single most agent-native thing in the dossier** — a tool that *refuses to collapse to one answer* and hands the orchestrator a decision instead of a false certainty. Keep it exactly. One addition: the `recommendation` should be a **typed enum** (`proceed | escalate_second_specifier | escalate_human | reject_vacuous`) so the orchestrator can branch on it without parsing prose — prose recommendations are a human affordance bolted onto an agent tool.

### 4. Shared state: the "content-addressed ⇒ naturally safe" argument dodges the hard problem the framework flags

The dossier's shared-state section asserts "attestations are immutable and content-addressed, concurrent writes are append-only and naturally safe." That's true for *storing* attestations and false for *using* them, and it side-steps precisely the staleness problem `capability-plane.md §4` calls the hard one (snapshot + per-worker overlay, epoch-stamped, per-file-hash invalidation). Specifically:

- **The cache key `(spec_hash, tool, version) → verdict` is under-specified and will serve stale hits.** A proof/verdict depends on far more than the spec: the code under proof, *and every definition/lemma the proof transitively references*. If worker B edits a definition that lemma L's proof imports, "L proven" is stale — but a key on `spec_hash` alone doesn't capture that transitive edge. This is the incremental-verification cache-invalidation problem (Lean's own `.olean` hashing, Nix, Bazel all solve it with a dependency-closure hash). The key must be a **Merkle hash over the full dependency closure** (code AST slice + spec + imported lemma hashes + tool@version + solver seed + unwind/axiom parameters), not `spec_hash`. As written, the cache is a **soundness hole**, not just a missed optimization.

- **The overlay (uncommitted edits) is the elephant.** capability-plane §4 says shared indices are "base snapshot + per-worker overlay" because "workers edit in divergent worktrees." A proof produced against a worker's *uncommitted* code cannot be a fleet-wide cache entry keyed on a committed sha — the committed sha doesn't reflect the overlay. Either (a) verdicts against overlay code are **worker-private until the diff commits**, keyed on the overlay hash, or (b) they don't enter the shared cache at all. The dossier never says which, and "content-addressed = safe" glosses exactly this. Pick (a), state it, and make `provenance` carry `overlay_applied: bool` per the framework.

- **Separation-of-duty via `spec_register` is *detection*, not *enforcement*.** The dossier calls it the "enforcement point," but `independence: violated` is a flag computed *after* the prover==author==implementer collision, and enforcement then depends on the orchestrator choosing to require a second worker. That's fine — but call it a **detector the merge gate consults**, not an enforcer. And thread the real scheduling consequence into the task-DAG: "specifier ≠ implementer" plus the dep "spec registered → code compiles → proof" *forces* the orchestrator to dispatch a specifier worker before the implementer, which is a non-trivial ready-work constraint (doc 08 §3a) the dossier asserts but doesn't wire.

### 5. Resumability is hand-waved for every deep rung (call it out specifically)

"Jobs checkpoint partial state (SMT: last frontier; proof assistant: `sorry`-annotated partial term; Kani: best bound reached) and are **resumable by `job_id`**" is mostly **not achievable** with these backends:

- z3 exposes incremental `push/pop`, but you **cannot** SIGKILL z3 mid-solve and resume from a serialized "frontier" — no such checkpoint exists.
- Kani/CBMC do not resume from a "best bound"; you re-run at a higher unwind. There is no serialized solver state to resume.
- A `sorry`-annotated Lean term is a valid *object* but does **not** capture tactic-*search* state; resuming a proof search from it is not a thing the search engines do.

The honest, buildable reframe — and it's actually *stronger* for a fleet: these jobs are **interruptible + re-runnable**, and progress is preserved at **two granularities the module controls**, not inside the solver: **(a) obligation/lemma granularity** — a discharged VC or lemma is cached (the §4 cache), so a re-run skips what's already proven; **(b) iterative deepening** — "resume" = re-dispatch at bound k+1 or `proof_depth`+1, *reusing the obligation cache*. Portfolio-level, record which solver finished. Sell resumability as "obligation-granular caching + iterative deepening over an interruptible job," and drop the "serialize the solver frontier" claim, which promises something no backend delivers.

### 6. Missed tools / approaches

- **Mutation testing (`cargo-mutants`, `Stryker`, `mutmut`, PIT)** — the concrete, named answer to "weak suite the worker authored," gestured at but never named, and the natural cheap MVP rung (§2).
- **Carcara** (TACAS'23) — the actual 2024-25 way to *independently* re-check cvc5/veriT **Alethe** SMT proofs. The dossier says "re-check … SMT proof if produced" but names no checker and leans on z3, whose proof-production is notoriously weak/incomplete. The real proof-carrying R5 path is **cvc5 → Alethe → Carcara** (or LFSC), not "z3 unsat." Name Carcara; it's the R5 analog of `lean4checker`.
- **`#print axioms` / axiom-audit and `coqchk -o`** — the required companion to kernel re-check (§0). Not a nice-to-have; without it the crown-jewel claim is false.
- **Creusot** (Rust → Why3 deductive verification, active 2024-25) — a real R5 alternative to Verus/Kani for Rust with a different TCB; worth a portfolio slot for the "diverse TCB" argument the dossier makes elsewhere.
- **Differential testing as a first-class cheap rung.** The dossier uses "differential oracle" only inside vacuity checking, but differential testing against a reference implementation is a distinct, high-value R2.5 rung when a reference exists (crypto, compilers, refactors-that-must-preserve-behavior) — cheaper than BMC, self-validating divergences.
- **Isabelle's `Sledgehammer`/proof reconstruction and Lean's `native_decide` caveat** — the latter as a TCB *hole* to detect, not a tool to add.

### 7. The one distinctively agent-native move to build (beyond porting a human tool)

The dossier's most under-developed asset is that **negatives and lemmas are fleet knowledge that a human tool throws away.** Two stigmergic (doc 10 T3 / AIAI) mechanisms turn this module from "a proof checker with a job queue" into something no single-user tool can be:

- **A fleet-wide, content-addressed counterexample corpus.** Every self-validating cex any worker ever finds — Kani, proptest, angr, Alive2 — is *permanently* deposited into a shared, replayable regression corpus keyed by the code region it falsified. Future workers touching that region **replay the accumulated adversarial history for free** at R1–R3. A human tool discards the cex after the fix; the fleet *hoards* it. This directly dissolves the "weak worker-authored suite" problem: the strongest part of the suite is no longer worker-authored at all — it's the fleet's accumulated adversarial memory, applied stigmergically with zero messaging. The dossier is one step away (cex are self-validating and hit the ledger) but never makes them a *shared, replayed* asset.

- **A conjecture/lemma market as the shared medium.** The shared lemma cache shouldn't be mere memoization — make it a **tuple-space of open obligations**. A worker blocked on lemma L emits L as an open conjecture into the blackboard (`take`/`read`/`write`, the same primitive as payments/-lease); the orchestrator dispatches a *specialized prover worker* (DeepSeek-Prover-V2 / Goedel-Prover-V2) to discharge it; the kernel-rechecked result flows back into the closure-keyed cache and unblocks the original worker — **without the two workers ever messaging** (doc 10's "prefer stigmergy to messaging" made literal). Proof search becomes a *fleet* activity with specialization and load-balancing, which is exactly the "an orchestrator can do what a single harness cannot" argument the dossier makes for separation-of-duty, now applied to the *search* itself.

Both are pure T3, both are impossible in any single-user proof assistant, and both strengthen the honest residual (the weak-spec/weak-suite ceiling) rather than merely restating it. If you build one distinctively-agent-native thing here, build the **counterexample corpus** — it's the cheapest, it lands in the MVP alongside the self-validating negatives you already produce, and it converts the module's throwaway output into compounding fleet knowledge.

### Bottom line

Keep: the forgeability reframe, the graded hub-recheck-per-rung column, `spec_formalize`-returns-candidates, counterexample-first output, and the honest autoformalization ceiling. Fix before circulating: the false crown-jewel claim (add the axiom audit), the four factual/over-claim errors in §0, and the resumability hand-wave. Restructure: conform to the `Capability`/`invoke`/`reverify`/ACI-envelope/`card()` contract (this module currently ignores its own governing spec), re-key the cache on a dependency closure with an explicit overlay policy (current key is a soundness hole), and re-scope the MVP to cargo-mutants + one z3 forgery-resistant rung so it stops being redundant with supervisor I7. Then add the counterexample corpus as the distinctively agent-native leg.

Grounding paths: `/Users/wahargis/Development/Experiments/baton/spec/capability-plane.md` (the contract this dossier must conform to — `card`/`invoke`/`resume`/`cancel`/`reverify`, the ACI envelope, §4 staleness = overlay model, §8 MVP), `/Users/wahargis/Development/Experiments/baton/spec/supervisor-state-machine.md` (I7 sandbox-not-hub locus at line 29; MVP overlap), `/Users/wahargis/Development/Experiments/baton/docs/05-telemetry-steering.md` (closed kind taxonomy the invented `verify.*`/`attest.*` events violate), `/Users/wahargis/Development/Experiments/baton/docs/10-interaction-model.md` (T3/stigmergy basis for the counterexample-corpus and conjecture-market opportunity), `/Users/wahargis/Development/Experiments/baton/docs/08-shared-memory-and-pm.md` (task-DAG ready-work + artifact registry the module plugs into).
