# Phase 79 Baton Atlas representation-plane audit

Date: 2026-07-17  
Deployment profile under audit: `default@c6d3539da3be9c4a45cecfbccc683211281e9b67397fae82b8f0dac1b77ec20a`  
Required verification: `node` with exit code `0`

## Verdict

The repository contains useful, bounded local representation implementations, but the exact default deployment does not register any Atlas capability or the durable representation producer. `openBatonDeployment` accepts no capability, representation-production, or structured-merge option and passes none to `createDriver` (`impl/src/application-deployment.mjs:873-936`); `createDriver` registers only explicitly injected capabilities and conditionally constructs the producer (`impl/src/index.mjs:665-700`). The public application profile nevertheless lists only `baton_orchestrator`, `code`, and `test` capabilities while advertising both `ff-only` and `structured` integration (`impl/src/application-deployment.mjs:596-627`). Therefore:

- no AST/CST, symbol/SCIP, CPG, compiler-IR, behavioral-fingerprint, or representation-production operation is available through the requested default Baton Run deployment;
- the structural, index, bounded CPG, taint, delta, and behavioral modules are production-source implementations that can be used only by a custom/injected driver;
- structured staging, verification, finalization, and cleanup are real production coordinator behavior, but conflict resolution is unavailable in the default deployment because no `MergirafStructuredMerge` instance is injected;
- compiler IR and e-graph modules are executable negative policy decisions, not implementations of those representations;
- true semantic delta, semantic merge, whole-repository CPG, compiler IR ingestion, effect signatures, and equality saturation are missing.

This is materially narrower than the README's “active complete scope” formulation (`README.md:42-44`). The narrower statements in `SYSTEM.md:273-280`, `docs/15-representation-and-computation.md:23-75`, and `docs/28-exhaustive-capability-audit.md:348-360,411-417` match the implementation more closely.

## Audit method and status vocabulary

The audit traced the R0-R5 ladder and research additions from `docs/15-representation-and-computation.md:23-75`, the adopted/cut recommendations in `reviews/frontier-features/representation.md:48-102,121-165`, phase specifications 13, 17-20, 22, 24-27, 46, 54, and 61, the corresponding implementation modules and tests, the capability registry, the coordinator/worktree path, and default application assembly. The phase-46 “representation review” is not independent runtime evidence: it hashes a fixed source inventory and returns fixed statuses (`impl/src/atlas-representation-review.mjs:8-42`).

Statuses in this report are deliberately deployment-aware:

- **Default production**: reachable through the exact default Baton Run deployment.
- **Injectable production code**: substantive implementation in `impl/src`, but absent from the default deployment and available only when a driver is assembled with it.
- **Test-only seam**: wiring demonstrated only with an injected fake/executor or direct class invocation, not a live default dependency.
- **Decision/scaffold**: executable policy or inventory that refuses unsupported work; it does not construct the named representation.
- **Documentation-only / missing**: intended or researched behavior without an implementation route.

## Representation-plane inventory

| Plane | Default deployment | What is actually implemented | Honest status |
|---|---|---|---|
| R0 text/search | `code` is advertised | Baton code surface plus Atlas lexical search when an index is injected | Default for text; Atlas search injectable |
| AST/CST and structural delta | Not registered | ast-grep parsing of selected named units, fingerprints, one-file delta, structural search/rewrite proposals | Injectable production code; no reusable AST/CST artifact |
| Symbol graph / SCIP | Not registered | snapshot+per-query-overlay heuristic index and SCIP-shaped JSON export | Injectable bounded index; not compiler-accurate symbol graph or native SCIP pipeline |
| CPG / CFG / PDG / SSA | Not registered | one-file JS/TS graph with bounded scope/binding, braced-`if` CFG, may-reaching definitions, direct value/call edges, taint, and graph delta | Injectable bounded CPG subset; no full CPG, PDG, or SSA |
| Compiler IR | Not registered | rung-ceiling policy returning `Decision` or a typed refusal | Decision/scaffold only |
| Semantic delta | Producer not registered | syntax-unit delta and bounded CPG graph delta can be persisted into Cairn when explicitly configured | Injectable advisory structural delta; true semantic delta missing |
| Behavioral fingerprint | Not registered | pinned-corpus execution of one dependency-free ESM named export, twice, under Node permissions | Injectable experiment; not effects, coverage, input generation, or equivalence proof |
| Structured merge | Action advertised | Git three-way staging plus optional Mergiraf conflict resolver, referee verification, finalize, rollback/cleanup | Default production for clean Git merge; conflict solver is dependency-gated and presently unavailable by default |
| Semantic merge | No route | No semantic merge engine or representation-guided conflict resolution | Documentation-only / missing |
| E-graphs | Not registered | policy choosing conditional expression/kernel experiments and refusing repository/whole-function scope | Decision/scaffold; engine missing |

## Findings by plane

### 1. AST/CST and structural operations

The R1 implementation really uses ast-grep parsers for JavaScript/TypeScript/TSX/HTML/CSS and selects declarations and imports/exports (`impl/src/atlas-structural.mjs:10-21,115-138`). It hashes a comment-insensitive child tree and emits added/modified/removed selected units (`impl/src/atlas-structural.mjs:98-150`). `AtlasStructuralRewrite` also provides bounded structural search and proposal generation, expressly without worktree apply authority (`impl/src/atlas-rewrite.mjs:93-195`). Phase-13 and phase-17 tests exercise direct class behavior, truncation, confinement, malformed syntax, proposal generation, cancellation, and artifact tampering (`impl/test/phase13-atlas-structural.test.mjs:1-78`; `impl/test/phase17-atlas-structural-rewrite.test.mjs:1-99`).

This is not an AST/CST storage plane. No operation returns a complete typed AST, lossless CST, tokens/trivia, stable node identity, edit script, or cross-file tree. Occurrence-number IDs make insertion/reordering unstable, and the card correctly disclaims move/rename and semantic equivalence (`impl/src/atlas-structural.mjs:123-150,162-168`). Calling it “CST” would be especially misleading: comments are intentionally removed from fingerprints, unnamed syntax is not emitted, and exact source reconstruction is not represented.

Contract defects remain in the older delta module:

1. `maxSourceBytes` silently defaults instead of being deployment-derived, no artifact ceiling exists, and the complete result is serialized and written before payload budgeting (`impl/src/atlas-structural.mjs:153-160,187-195`).
2. It never checks `ctx.signal` before or during parsing, despite an interactive potentially expensive operation (`impl/src/atlas-structural.mjs:170-208`).
3. Buffer decoding uses replacement-character UTF-8 rather than fatal decoding, so invalid text is analyzed rather than refused (`impl/src/atlas-structural.mjs:178-184`).
4. Rewrite resume accepts a digest-valid manifest path rather than requiring the canonical `<digest>.json` location, returns `ok` after a completed resume even when the source parse was partial, and its reverify compares only provenance digests (`impl/src/atlas-rewrite.mjs:197-220`).

Recommended red tests: reject non-UTF-8 source; cancel before parse and observe no artifact; refuse an artifact above a deployment-derived ceiling; reject a valid digest artifact copied to a noncanonical path; preserve `partial` after the final rewrite resume page; reject summary/payload/ref substitution during rewrite reverify.

### 2. Symbol graph and SCIP

`AtlasCodeIndex` is a substantive snapshot+overlay index. It scans bounded source files, extracts ast-grep definitions/imports/calls/identifier occurrences, content-addresses an epoch, recomputes a worktree overlay, serves lexical/symbol/reference/call/map/seed queries, and exports validated SCIP-shaped JSON (`impl/src/atlas-index.mjs:76-185,203-309,326-390`). Its tests cover epochs, overlays, path confinement, ambiguity, ceilings, cancellation, export shape, integrity, and replay (`impl/test/phase13-atlas-index.test.mjs:1-159`; `impl/test/phase61-atlas-index-source-contract.test.mjs:1-77`).

It is not a sound symbol graph. The resolver globally groups definitions by bare name and resolves a reference whenever one repository-wide candidate exists (`impl/src/atlas-index.mjs:143-159`). Broad identifier extraction and last-identifier call naming ignore lexical shadowing, imports/exports, module resolution, receiver types, overloads, and language compiler rules (`impl/src/atlas-index.mjs:74-109`). The “overlay” rescans the effective worktree for each query (`impl/src/atlas-index.mjs:164-185`). SCIP output is JSON interchange with empty relationships/external symbols, not native protobuf or output from a language indexer (`impl/src/atlas-index.mjs:374-386`); the capability card states that boundary (`impl/src/atlas-index.mjs:244-260`).

There are two route/resume blockers:

1. `index.build` is correctly advertised as task latency (`impl/src/atlas-index.mjs:244-249`), but `CapabilityRegistry` refuses every task-class operation through generic capability invocation (`impl/src/capability-registry.mjs:117-122`), and the deployment provides no Atlas-specific durable task adapter. Existing tests invoke the class directly.
2. A truncated `scip.export` cursor belongs to the wrapper `scip_export_results` artifact, but the representation producer designates the `scip_json` ref as primary. Producer resume therefore passes the SCIP artifact handle with a cursor containing the wrapper digest, which `AtlasCodeIndex.resume` rejects (`impl/src/atlas-index.mjs:310-323,374-386,404-423`; `impl/src/atlas-representation-producer.mjs:185-224`). Existing producer coverage uses a large enough budget to avoid this path (`impl/test/phase61-representation-producer.test.mjs:254-268`). Resume also changes the ref kind to `atlas_results`, omits the SCIP primary ref, and loses a terminal `partial` parse status (`impl/src/atlas-index.mjs:417-423`).

Recommended red tests: two files with same-name symbols and shadowed locals must not cross-resolve; an imported alias and same-name unrelated module must remain unresolved rather than falsely precise; invalid UTF-8 must be typed/refused; the public durable task path must build an index or the op must not be advertised; a deliberately truncated Phase-61 SCIP production must resume to the same primary artifact and preserve `partial`; resumed refs must retain exact kinds and SCIP provenance.

### 3. CPG, CFG, PDG, SSA, taint, and path sensitivity

`AtlasCpgBuild` is a real but deliberately small JS/TS graph builder. It enforces explicit ceilings, emits nodes/edges with a binding model, handles functions and block scopes, creates CFG for a subset of braced `if` statements with literal pruning, computes may-reaching definitions, and emits direct assignment, argument, and local call edges (`impl/src/atlas-cpg.mjs:91-327`). `AtlasCpgTaint` performs bounded source/sink/sanitizer reachability over that graph (`impl/src/atlas-cpg-taint.mjs:15-55`). `AtlasCpgDelta` compares semantically keyed bounded graph elements and calculates reachability impact (`impl/src/atlas-cpg-delta.mjs:47-84,118-199`). Phase 18-22 and 54 tests validate the intentionally narrow behavior (`impl/test/phase18-atlas-cpg.test.mjs:1-88`; `impl/test/phase19-atlas-cpg-delta.test.mjs:1-72`; `impl/test/phase20-atlas-cpg-taint.test.mjs:1-49`; `impl/test/phase22-atlas-cpg-path-sensitive.test.mjs:1-142`; `impl/test/phase54-atlas-cpg-lexical-bindings.test.mjs:1-205`).

The implementation is not a whole-repository CPG and does not provide a general PDG or SSA form. It has no module/import linking, receiver/type resolution, heap or field model, alias analysis, exception/finally control flow, closure capture model, interprocedural return/summary flow, phi nodes, dominance, loop fixed point, or general path feasibility. The phase-54 spec itself preserves these limits (`spec/phase54/atlas-cpg-lexical-bindings.md:230-250`), and `SYSTEM.md:273-280` explicitly denies deeper semantics.

Correctness and evidence issues:

1. Entering a nested function resets `fn`, `fnScope`, and statement state but does not reset inherited `block`/`blockScope`; occurrence assignment prefers `blockScope` over `fnScope`. A concise arrow nested in an outer block can therefore inherit the outer block scope even though phase-54 requires a fresh function scope and forbids binding across function boundaries (`impl/src/atlas-cpg.mjs:112-125,151-160`; `spec/phase54/atlas-cpg-lexical-bindings.md:58-59,101-104`). Existing closure tests use a nested block-bodied function and do not cover this shape.
2. CPG build and taint choose `needs_resume` before `partial` when both payload truncation and parse errors exist, then return `ok` at the last resume page (`impl/src/atlas-cpg.mjs:325-333`; `impl/src/atlas-cpg-taint.mjs:43-54`). Delta correctly gives partial analysis precedence (`impl/src/atlas-cpg-delta.mjs:174-188`).
3. CPG and taint reverify check only a primary digest/model, not the full stable result projection, so substituted result fields can survive reverify (`impl/src/atlas-cpg.mjs:329-333`; `impl/src/atlas-cpg-taint.mjs:52-55`).

Recommended red tests: nested concise arrows inside an outer block must receive a fresh function scope and never bind to an outer same-name declaration; malformed input plus a tiny budget must remain `partial` through every build and taint page; reverify must reject changed summary, payload, status, refs, or provenance; calls with same bare name in distinct scopes must not produce cross-scope edges; explicitly assert the absence of heap, alias, exception, import, return-summary, phi, and loop-sensitive claims until implemented.

### 4. Compiler IR ceiling

`AtlasRepresentationCeiling` implements the phase-24 policy decision: JS/TS stop at R3, and external compiler IR may be selected only for eligible native toolchains; false native-IR operations are refused (`impl/src/atlas-representation-ceiling.mjs:5-7,44-98`). Tests demonstrate policy selection, refusal, truncation, and integrity (`impl/test/phase24-atlas-representation-ceiling.test.mjs:1-59`).

No LLVM IR, MLIR, Rust MIR, Swift SIL, JVM bytecode, Wasm IR, debug/source map, optimizer pipeline, equivalence checker, or translation validator is produced or consumed. This is **Decision/scaffold**, not R4. The status is consistent with `spec/phase24/atlas-representation-ceiling.md:38-51` and inconsistent with reading README terminology as shipped capability.

Recommended red tests before any R4 claim: compile a pinned native fixture twice in a sealed toolchain and require byte-identical normalized IR plus source/toolchain provenance; reject unsupported flags, ambient compiler configuration, missing debug/source mapping, and language/toolchain drift; compare pre/post source through an explicitly defined translation-validation oracle and prove that a changed return value is rejected. Until those pass, cards and profiles must say “policy only.”

### 5. Structural delta versus semantic delta

There are two durable delta products when custom assembly enables Phase 61: R1 structural-unit delta and R3 bounded CPG graph delta. `AtlasRepresentationProducer` has a closed source map containing only those two and R2 SCIP (`impl/src/atlas-representation-producer.mjs:13-17,88-152,247-345`), and `CoordinationStore` persists their receipts and `DerivedFrom`/`RepresentsChange` graph edges (`impl/src/coordination-store.mjs:58-60,2147-2214`). Tests prove idempotency, provenance, replay, and graph persistence for injected sources (`impl/test/phase61-representation-producer.test.mjs:29-176,254-268`; `impl/test/phase61-representation-store.test.mjs:107-318`).

The `bounded_cpg_semantic_delta` label is a graph-element comparison, not a behavioral or compiler-semantic delta. It neither classifies observable behavior nor routes reviews, selects Referees, gates integration, or changes trust. The coordinator's structured integration path stages, verifies, and finalizes without consuming Atlas delta, CPG, or fingerprint evidence (`impl/src/coordinator.mjs:3485-3552`). Phase 61 also expressly retains that limit (`spec/phase61/graph-backed-representations.md:157-165`).

Accordingly, R1 and R3 deltas are **injectable advisory production code**; “true semantic delta” is **missing**. The intended native review unit and risk-routing ideas remain documentation-only (`docs/15-representation-and-computation.md:36-48,50-64`).

Recommended red tests: default profile cards must either expose a fully configured producer or explicitly report it unavailable; producing the same change through direct/web/MCP/durable-task routes must bind identical source digests and receipts; truncation must not alter primary identity; no delta may raise trust or authorize integration; a future semantic classifier must distinguish same-syntax/different-behavior and different-syntax/same-behavior fixtures and must emit `unknown`, not “safe,” outside its language/effect envelope.

### 6. Behavioral fingerprints and effects

`AtlasBehaviorFingerprint` confines paths, validates a pinned JSON corpus, executes one dependency-free ESM named export in a bounded child with Node's permission model, repeats the corpus to detect nondeterminism, and compares two observation artifacts (`impl/src/atlas-behavior-fingerprint.mjs:17-64,103-140,143-265`). Tests cover matching/diverging functions, nondeterminism, dependency refusal, path confinement, timeout/output limits, and artifact replay (`impl/test/phase25-atlas-behavior-fingerprint.test.mjs:15-107`). This is a useful **injectable experimental implementation**.

It is not the behavioral/effect-signature plane proposed in `docs/15-representation-and-computation.md:58-60`: there is no coverage guidance, input generation, fuzzing, shrinking, filesystem/network/subprocess effect trace, package graph, state reset beyond process isolation, or equivalence proof. It is not registered by default and no reviewer, router, or integration gate consumes it.

The child runner catches target invocation and V8 serialization in one `try`. If the target successfully returns an unsupported value such as a function, serialization throws and the runner records that serializer exception as if the target threw (`impl/src/atlas-behavior-fingerprint.mjs:47-60`). Two unsupported return values can therefore falsely agree on runner failure. Reverify checks only a result digest (`impl/src/atlas-behavior-fingerprint.mjs:267-284`).

Recommended red tests: distinguish a target-thrown exception from observation-protocol/serialization failure; two unsupported return values must yield typed `unsupported_observation`, never agreement; cover cycles, BigInt, symbol, function, proxy, and mutated input; reject output/result substitution at reverify; demonstrate explicit effect denial/recording for filesystem, network, subprocess, time, randomness, environment, and module loads before adding any “effect signature” claim.

### 7. Structured merge

The coordinator has a real structured-integration state machine. Worktree staging first attempts Git's three-way merge, invokes the optional structured resolver only for conflicts, verifies the staged commit with the referee, finalizes the integration, and records/executes cleanup on refusal or failure (`impl/src/worktree.mjs:635-732`; `impl/src/coordinator.mjs:3485-3598`). `MergirafStructuredMerge` bounds the executable, argv/environment, timeout, and output and classifies unavailable/conflict/error outcomes (`impl/src/structured-merge.mjs:7-58`). Phase-26 tests cover clean merges, fake structured resolution, verification failure, stale state, forged metadata, cancellation, finalization, and cleanup (`impl/test/phase26-structured-merge.test.mjs:34-241`).

However, the tests inject an executor; they do not qualify a live Mergiraf binary (`impl/test/phase26-structured-merge.test.mjs:185-208`). The default deployment passes no `structuredMerge` instance (`impl/src/application-deployment.mjs:912-936`) while advertising `structured` strategy (`impl/src/application-deployment.mjs:624-627`). Thus clean Git merge is default production, the conflict-resolution wiring is production code, and successful structured conflict resolution is presently a **test-only/dependency-gated seam**. This is the same open gap recorded in `docs/28-exhaustive-capability-audit.md:348-360`.

Recommended red tests: the exact default application profile must not advertise structured conflict resolution unless startup readiness proves a pinned resolver; run a live pinned Mergiraf fixture with a real conflict, verify the exact staged tree, then force referee failure and prove branch/worktree/runtime cleanup; test malformed/non-UTF-8 resolver output, timeout, cancellation, signal termination, tool version drift, and a resolver-created out-of-scope path. Preserve the existing invariant that resolver output never bypasses Referee verification.

### 8. Semantic merge

There is no semantic merge engine. No implementation consumes CPG/IR/fingerprint evidence to resolve a conflict, synthesizes candidate programs, round-trips a representation to source, validates candidate behavior, or measures false-clean merges. `requireSemanticReview` is a model-review gate, not code semantic merge (`impl/src/application-deployment.mjs:624-635`; `impl/test/phase65-run-semantic-review-integration.test.mjs:13-228`). The term must not be conflated with Atlas semantics.

This remains a research intention in `docs/15-representation-and-computation.md:50-58`, `spec/phase26/structured-merge.md:64-70`, and `SYSTEM.md:287-288`. The frontier review explicitly recommends structured merge now while narrowing semantic merge/CPG scope (`reviews/frontier-features/representation.md:97-102,121-136`). Honest status: **documentation-only / missing**.

Recommended pre-production reds: a benchmark suite must include textual conflict/semantic compatibility, textual compatibility/semantic conflict, rename+edit, independent control-flow edits, changed exception behavior, state/effect ordering, and unsupported-language cases; candidates must be source-round-trippable, compile/typecheck where applicable, pass pinned tests and behavioral oracles, and return `unknown` on insufficient evidence; no semantic candidate may finalize without the ordinary referee and cleanup path.

### 9. E-graph research bets

`AtlasEGraphEvaluation` emits a `Decision`: repository-wide and whole-function equality saturation are retired, while a bounded expression/kernel experiment is conditional; false engine operations are refused (`impl/src/atlas-egraph-evaluation.mjs:5-24,48-90`). Tests exercise the policy and refusal artifact (`impl/test/phase27-atlas-egraph-evaluation.test.mjs:12-63`). No e-graph, e-class, rewrite rule set, analysis lattice, extractor, saturation budget, proof/explanation, or source round-trip exists.

This correctly follows the frontier review's recommendation to cut repository-scale e-graphs and keep only a tightly benchmarked expression/kernel bet (`reviews/frontier-features/representation.md:83-88,97-102,155-165`). Honest status: **Decision/scaffold**, with the engine **missing**.

Recommended experiment reds: pin a tiny pure expression language, typed rewrite rules, node/iteration/time ceilings, deterministic extraction cost, and proof replay; include unsound overflow, floating-point/NaN, effectful-ordering, nontermination/explosion, and source-round-trip fixtures. Require a measured win over compiler optimization or ordinary normalization before promoting the experiment. Repository/whole-function operations must continue to refuse.

## Cross-cutting production-truth gaps

1. **Profile/catalog drift.** The default profile advertises broad integration strategy but not dependency readiness, while the phase-46 review returns static source-derived statuses rather than probing deployed cards (`impl/src/application-deployment.mjs:596-627`; `impl/src/atlas-representation-review.mjs:8-42`).
2. **No default Atlas assembly.** Documentation correctly says deployments inject Atlas and empty deployments are honestly empty (`docs/28-exhaustive-capability-audit.md:357-360`), but README/system language can still be read as live default capability.
3. **No durable task route for index build.** A task-class card is refused by the generic registry and has no Atlas task adapter (`impl/src/capability-registry.mjs:117-122`; `impl/src/atlas-index.mjs:244-249`).
4. **Uneven artifact contract.** Newer modules require deployment-derived bounds and hardened stable projections; older modules default ceilings, lose `partial` on resume, vary ref kinds, or reverify only a digest. Exact route/result truth is therefore representation-dependent.
5. **Advisory evidence is not decision authority—and should remain so.** Phase-61 representations are stored and grounded but not automatically consumed. That is safer than an undocumented trust upgrade; future routing must preserve explicit advisory status.
6. **No incremental substrate.** Index overlays rescan; structural and CPG analyses are one-shot. The frontier review correctly rejects a premature repository-wide Salsa database and favors bounded commit/artifact caching (`reviews/frontier-features/representation.md:62-67,137-145`).
7. **Attestation remains coarse.** Artifacts contain input digests/provenance, but there is no per-symbol/per-node attestation overlay linking review claims to exact representation nodes and toolchain inputs, as contemplated by `docs/15-representation-and-computation.md:60-62`.

## Spec-to-code traceability ledger

This ledger records the disposition of every representation-plane phase contract used by the audit. “Covered” means the bounded behavior has implementation and tests; it does not imply default-deployment availability.

| Contract | Implementation/test evidence | Disposition |
|---|---|---|
| Phase 13 structural delta (`spec/phase13/atlas-structural-delta.md:1-63`) | `impl/src/atlas-structural.mjs:10-240`; `impl/test/phase13-atlas-structural.test.mjs:1-78` | Bounded selected-unit delta covered; cancellation, fatal decoding, deployment-derived artifact ceiling missing |
| Phase 17 structural rewrite (`spec/phase17/atlas-structural-search-rewrite.md:1-67`) | `impl/src/atlas-rewrite.mjs:93-220`; `impl/test/phase17-atlas-structural-rewrite.test.mjs:1-99` | Proposal-only behavior covered; canonical resume path, partial preservation, full reverify incomplete |
| Phase 13 code index (`spec/phase13/atlas-index-symbols.md:1-70`) | `impl/src/atlas-index.mjs:76-423`; `impl/test/phase13-atlas-index.test.mjs:1-159` | Snapshot/overlay heuristic covered; task route and sound symbol semantics absent |
| Phase 18 bounded CPG (`spec/phase18/atlas-cpg-slice.md:1-47`) | `impl/src/atlas-cpg.mjs:91-333`; `impl/test/phase18-atlas-cpg.test.mjs:1-88` | Single-file subset covered; full CPG/PDG/SSA absent |
| Phase 19 CPG delta (`spec/phase19/atlas-cpg-delta-impact.md:1-49`) | `impl/src/atlas-cpg-delta.mjs:47-199`; `impl/test/phase19-atlas-cpg-delta.test.mjs:1-72` | Bounded graph delta covered; no behavioral semantics |
| Phase 20 taint (`spec/phase20/atlas-cpg-taint.md:1-46`) | `impl/src/atlas-cpg-taint.mjs:15-55`; `impl/test/phase20-atlas-cpg-taint.test.mjs:1-49` | Bounded reachability covered; resume status/reverify weak |
| Phase 22 path sensitivity (`spec/phase22/atlas-cpg-path-sensitive.md:1-60`) | CPG/taint modules above; `impl/test/phase22-atlas-cpg-path-sensitive.test.mjs:1-142` | Literal/braced-branch subset covered; general path sensitivity absent |
| Phase 24 IR ceiling (`spec/phase24/atlas-representation-ceiling.md:1-51`) | `impl/src/atlas-representation-ceiling.mjs:5-98`; `impl/test/phase24-atlas-representation-ceiling.test.mjs:1-59` | Policy decision covered; no compiler IR implementation |
| Phase 25 behavioral fingerprint (`spec/phase25/atlas-behavior-fingerprint.md:1-58`) | `impl/src/atlas-behavior-fingerprint.mjs:17-284`; `impl/test/phase25-atlas-behavior-fingerprint.test.mjs:15-107` | Pinned-corpus observation covered; serializer/target outcome conflation and weak reverify remain |
| Phase 26 structured merge (`spec/phase26/structured-merge.md:1-70`) | `impl/src/structured-merge.mjs:7-58`; `impl/src/worktree.mjs:635-732`; `impl/test/phase26-structured-merge.test.mjs:34-241` | State machine covered; live/default resolver qualification absent; semantic merge explicitly deferred |
| Phase 27 e-graph evaluation (`spec/phase27/egraph-evaluation.md:1-63`) | `impl/src/atlas-egraph-evaluation.mjs:5-90`; `impl/test/phase27-atlas-egraph-evaluation.test.mjs:12-63` | Decision artifact covered; no e-graph engine |
| Phase 46 representation review (`spec/phase46/attested-representation-review.md:1-50`) | `impl/src/atlas-representation-review.mjs:8-42`; `impl/test/phase46-representation-review.test.mjs:1-27` | Fixed source inventory covered; not deployed/runtime readiness evidence |
| Phase 54 lexical binding/path CPG (`spec/phase54/atlas-cpg-lexical-bindings.md:1-286`) | `impl/src/atlas-cpg.mjs:91-333`; `impl/test/phase54-atlas-cpg-lexical-bindings.test.mjs:1-205` | Bounded binding model covered with nested concise-arrow defect; retained limits are explicit |
| Phase 61 graph-backed producer (`spec/phase61/graph-backed-representations.md:1-165`) | `impl/src/atlas-representation-producer.mjs:13-345`; `impl/src/coordination-store.mjs:2147-2214`; phase-61 tests cited above | Injectable durable R1/R2/R3 production covered; default assembly absent; truncated SCIP source contract broken |

The system chronology is consistent with this ledger: Phase 54 is described as bounded CPG, Phase 61 as a graph-backed producer, and Phase 61 expressly does not claim full semantics, IR, whole-repository analysis, true semantic merge, or proof (`SYSTEM.md:253-254,273-280`). The later roadmap keeps the representation ladder staged and semantic merge experimental (`SYSTEM.md:287-288`).

## Dependency-ordered implementation plan

The order below is intentional: deployment truth and shared evidence contracts precede deeper analysis; bounded representations precede consumers; semantic merge and e-graphs remain last-mile research bets.

### P0. Make deployment and catalog truth exact

Implementation target: derive advertised capability/strategy availability from the assembled deployment, add explicit readiness for the structured resolver, and replace fixed phase-46 statuses with runtime card/probe results. Either wire Atlas through closed, deployment-derived configuration or report it unavailable; do not silently auto-register expensive capabilities.

Acceptance criteria:

- The exact default profile's advertised actions equal callable actions; every advertised representation operation succeeds or produces its documented typed refusal through the unified route.
- `structured` is advertised only with a ready pinned resolver, or is explicitly described as clean-Git-only with conflict resolution unavailable.
- Review inventory distinguishes `available`, `dependency_unavailable`, `policy_only`, and `not_configured` and binds the deployment/profile digest.
- Direct, authenticated web, MCP, and Baton Run projections cannot disagree about cards or readiness.

Red-test recommendation: `impl/test/phase79-atlas-deployment-truth-red.test.mjs` should open the exact default application, compare advertised actions to invocation outcomes, assert Atlas is not falsely listed, assert structured dependency truth, and reject static/injected status substitution.

### P1. Unify the representation artifact, resume, and reverify contract

Implementation target: a shared content-addressed artifact helper with owner/mode/symlink checks, canonical path enforcement, fatal UTF-8 where source text is required, deployment-derived source/result/artifact ceilings, cancellation checkpoints, stable result projection, primary-ref typing, and `partial` precedence across every page.

Acceptance criteria:

- Every module preserves exact `op`, `status`, ref kind/media type/identity, primary provenance, and analysis incompleteness across resume.
- Reverify is read-only and rejects substitution of status, summary, payload, cursor, refs, cost (excluding explicitly volatile fields), or provenance.
- No oversized complete artifact is materialized before its ceiling is checked; cancellation leaves no partial file.
- Every primary ref resolves only to its canonical content-addressed path and verifies bytes, digest, schema, ownership, and mode.

Red-test recommendation: a table-driven `impl/test/phase79-atlas-artifact-contract-red.test.mjs` should run structural, rewrite, index/SCIP, CPG, taint, delta, fingerprint, ceiling, and e-graph modules through truncation, parse-partial, cancellation, relocation, symlink, mode, byte-count, and claim-substitution cases.

### P2. Stabilize R1 as an explicitly bounded syntax-unit plane

Implementation target: fix the structural-module defects, document the output as selected syntax units rather than AST/CST, and introduce stable matching/edit scripts only if a consumer requires them. Keep rewrite proposal-only and route application through ordinary scoped worktree authority.

Acceptance criteria:

- Capability names/cards never claim lossless AST/CST.
- IDs and deltas have documented insertion/reorder behavior; if move/rename is claimed, benchmark fixtures prove it.
- Invalid text, cancellation, parse partiality, and artifact bounds satisfy P1.
- A rewrite proposal cannot modify a worktree and its eventual application is independently scope-checked and verified.

Red-test recommendation: add reorder/duplicate anonymous declaration, comment/trivia, rename/move, malformed-tree, and proposal-to-verified-apply fixtures; keep move/rename expected as unsupported until implemented.

### P3. Repair R2 reachability and semantic honesty

Implementation target: add a real durable `index.build` task route; fix SCIP wrapper/primary resumability; either integrate pinned language-native SCIP indexers or rename the present output as a heuristic symbol index and never assign a unique symbol without lexical/module proof.

Acceptance criteria:

- Index build is reachable through a durable advertised action, cancellable, resumable/reconcilable, and deployment-bounded.
- Truncated and parse-partial SCIP production completes with stable primary identity and exact receipt/graph grounding.
- Shadowing, imports, aliases, namespaces, overloads, methods, and duplicate names do not create false precise edges.
- Native SCIP claims require schema-valid native indexer output, pinned toolchain provenance, and overlay staleness semantics; otherwise output remains explicitly `heuristic_json_interchange`.

Red-test recommendation: `impl/test/phase79-atlas-symbol-soundness-red.test.mjs` plus a truncated Phase-61 SCIP producer test covering the counterexamples above and restart/reconcile.

### P4. Correct and then widen the bounded R3 CPG

Implementation target: first fix nested-function scope isolation and P1 status/reverify behavior. Then choose an explicit build-versus-buy boundary for whole-repository CPG. Add module linking, closure capture, receiver/type resolution, exceptional CFG, loops, returns, heap/alias modeling, interprocedural summaries, dominance/phi/SSA, and PDG only in independently testable increments.

Acceptance criteria:

- Fresh function scopes and lexical bindings are correct for declarations, expressions, methods, arrows, concise bodies, nesting, shadowing, and closures.
- Every emitted edge states its soundness envelope; uncertain resolution stays candidate/unknown rather than precise.
- CFG/def-use/taint reach fixed points within declared ceilings and report truncation/unknown without upgrading to clean.
- “CPG,” “PDG,” and “SSA” appear in cards only for graph layers whose invariants are validated.

Red-test recommendation: `impl/test/phase79-atlas-cpg-scope-red.test.mjs` for the concise-arrow defect, then separate reds for imports, closures, loops, exceptions/finally, heap aliasing, interprocedural returns, phi placement, and path explosion.

### P5. Enable durable advisory representations without granting authority

Implementation target: after P1-P4, optionally configure the Phase-61 producer in a deployment profile, add on-demand/commit-trigger policy and bounded caching, and expose its receipts to review/routing as explicitly advisory evidence.

Acceptance criteria:

- R1/R2/R3 production is deterministic per source/toolchain/policy digest, idempotent across restart, and graph-grounded to exact commits.
- Unavailable, partial, stale, and unsupported representations remain visible and cannot be interpreted as “no risk.”
- No representation alone raises trust, approves a plan, or finalizes integration.
- Consumers cite exact artifact/ref/node IDs and preserve per-read receipts.

Red-test recommendation: route-equivalence and restart tests should produce/reuse identical receipts, then attempt to forge a representation into trust/integration authority and require refusal.

### P6. Harden behavioral observation and define an evidence ladder

Implementation target: separate target throws from harness/serialization failures, harden result projections, define supported values and state reset, then add optional coverage-guided corpus generation, shrinking, and explicit effect tracing. Keep results one advisory signal among tests/static analysis/fuzzing.

Acceptance criteria:

- Harness failure, target throw, timeout, nondeterminism, unsupported observation, and value result are disjoint typed outcomes.
- Corpus, runtime, module graph, permissions, environment, clock/random policy, effect log, and reset strategy are provenance-bound.
- Comparing identical/different artifacts never claims semantic equivalence; output is `observed_match`, `observed_divergence`, or `unknown` within a stated envelope.
- No fingerprint gates integration until benchmarked false-negative/false-positive thresholds and ordinary referee behavior are defined.

Red-test recommendation: `impl/test/phase79-atlas-behavior-observation-red.test.mjs` should cover unsupported serialization, hidden state, input mutation, time/randomness, filesystem/network/subprocess attempts, flaky divergence, shrinking, and forged claim fields.

### P7. Qualify live structured merge

Implementation target: pin and readiness-probe Mergiraf, project its version into the deployment profile and receipts, run live conflict fixtures, and retain the existing stage-referee-finalize-cleanup boundary.

Acceptance criteria:

- A real supported conflict resolves deterministically with exact base/ours/theirs/tool provenance.
- Unsupported grammar, unresolved conflict, tool absence/crash/timeout/cancellation, stale heads, verification failure, and finalization failure all fail closed with exact result and cleanup receipts.
- The resolver has no ambient configuration or out-of-scope write authority.
- Default advertisement changes atomically with resolver readiness.

Red-test recommendation: `impl/test/phase79-structured-merge-live-red.test.mjs` should use a pinned real binary fixture and assert both successful tree identity and every cleanup branch; retain unit fakes only for fault injection.

### P8. Add compiler IR only behind language/toolchain gates

Implementation target: select one high-value native language/toolchain, ingest normalized external IR plus source/debug mapping, and define a translation-validation oracle. JS/TS remain capped unless a separately justified IR is selected.

Acceptance criteria:

- Toolchain, flags, target, dependencies, source tree, normalized IR, and mappings are content-addressed and reproducible.
- Unsupported constructs/configurations return typed `rung_ceiling`/`unknown`.
- Translation validation catches seeded semantic changes and never treats optimizer equality as source-level proof beyond its envelope.
- R4 production is optional and resource-bounded; no fake native-IR operation is advertised.

Red-test recommendation: pinned compile/replay, ambient-toolchain drift, missing mapping, nondeterministic metadata, seeded miscompile/change, and resource-exhaustion fixtures.

### P9. Research semantic delta and semantic merge behind evaluation gates

Implementation target: define observable semantics and effect envelopes per language, build a labeled change/merge benchmark, use R2-R4 plus P6 evidence to classify `changed`, `observed_unchanged`, or `unknown`, and synthesize merge candidates only in a sandbox. Do not couple this milestone to the existing model “semantic review.”

Acceptance criteria:

- Benchmarks report false-clean, false-conflict, abstention, cost, and cleanup rates against textual and structured baselines.
- Unsupported/effectful/under-observed cases abstain.
- Candidate source round-trips, compiles/typechecks, passes independent tests/oracles, and still traverses the ordinary referee/integration path.
- Promotion requires a written threshold decision; until then all operations remain experimental and nonauthoritative.

Red-test recommendation: use the semantic-merge counterexample suite described above, mutation testing, deliberately incomplete corpora, and adversarial effect ordering; assert `unknown` rather than success whenever evidence is insufficient.

### P10. Run only the bounded e-graph experiment if it earns its cost

Implementation target: after P8-P9 provide a need, prototype equality saturation only for a pure typed expression/kernel domain with proof-producing rewrites and hard saturation/extraction ceilings. Keep repository and whole-function scope retired.

Acceptance criteria:

- Every extraction has replayable rule proof, deterministic cost, and source/IR round-trip validation.
- Overflow, floating point, traps, effects, and undefined behavior are modeled or refused.
- The benchmark beats ordinary compiler/normalizer baselines on a predeclared quality/cost threshold without unacceptable explosion.
- Failure to meet the threshold leaves the current `Decision` as the final product and removes no safety boundary.

Red-test recommendation: typed unsound-rewrite corpus, saturation bomb, cyclic rule set, ambiguous-cost extraction, proof tampering, and effect-order counterexamples.

## Documentation disposition

- Keep the R0-R5 ladder as a roadmap, but annotate each rung with default/injectable/scaffold/missing status (`docs/15-representation-and-computation.md:23-75`).
- Retain `SYSTEM.md:273-280,287-288` as the normative honesty boundary.
- Correct README language that groups CPG/CFG/PDG/SSA, semantic delta, and compiler IR under “active complete scope” without deployment qualification (`README.md:42-44`).
- Treat `docs/28-exhaustive-capability-audit.md:348-360,411-417,501-505` and `reviews/frontier-features/representation.md:121-165` as the current accurate gap/research record.
- Do not use the phase-46 fixed source inventory as proof of runtime availability; it is useful only as drift-detecting documentation evidence.

## Verification and cleanup record

- Scoped repository change: only `reviews/dogfood/phase79-atlas-representation-audit.md`.
- Production code changed: no.
- External state changed: no.
- Required deployment verification command: `node`.
- Observed result: exit code `0`; stdout/stderr empty.
- Cleanup: no temporary worktree, branch, runtime, or external artifact was created by this audit; no cleanup action is required.
