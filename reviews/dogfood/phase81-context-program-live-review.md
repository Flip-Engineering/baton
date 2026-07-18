# Phase 81 Context Program live review

## Verdict

The current vertical is a useful, correctly narrow **pure Context Program prototype**, not yet a `context_recursive` Workflow implementation. Its strongest choice is the closed JSON AST: unknown fields, ambient code, mutable paths, and route knobs fail before execution, while manifest/program/environment/policy digests give deterministic local cell identity. The Bench also verifies source and output content and keeps `finish` explicitly asserted rather than verified.

It does **not yet preserve Baton's full authority, replay, stop/reap, evidence, or route truth**, because cells live in process memory, artifacts are plain files outside the coordination/artifact ledgers, provider operators deliberately stop at `context_program_effect_requires_workflow`, and the unified Run application advertises no context operations. Those are appropriate omissions for build steps 1–2, but the implementation and tests should be described as such. The Phase 81 specification remains the target contract, not the observed behavior.

## Implemented now

- `normalizeContextManifest` is closed, immutable, content-addressed, policy-bound, and requires an exact 40-character tree SHA with `source: workflow_plan`. Branch refs must agree with their content digest. This is a solid anti-substitution boundary.
- `normalizeContextProgram` closes the operation vocabulary and each operation's fields, canonicalizes JSON, rejects cycles/non-finite or non-JSON values, applies structural/text ceilings, and prevents model/harness/effort, code, shell, credential-shaped text, or authority coordinates from being smuggled through the AST.
- Pure `source`, `outline`, `index`, `search`, `slice`, `chunk`, `filter`, `project`, `sort`, `unique`, `join`, `collect`, `coverage`, and `finish` evaluation exists. `map`, `reduce`, `review`, and `verify` normalize as typed effects but cannot execute in the Bench.
- Cell IDs bind manifest, normalized program, environment, and policy digests. Same-process replay returns the same frozen cell; output files are content-addressed and checked on read/write. Pure execution reports zero provider effects.
- `ContextSession` provides a compact JavaScript outline/index/search/chunk/coverage/cell/evidence/help cascade. The Phase 81 tests cover closure, source substitution, local memoization, zero provider effects, and the compact facade.
- Existing Baton machinery already supplies the correct substrate for later work: approved Goal/Plan authority, atomic and replay-checked multi-node Wave admission, exact route tuples, isolated Attempts/worktrees, Run stop fencing and cleanup receipts, Scratch grounding/promotion controls, Cairn contradiction-aware promotion, and Atlas derived-only authority. Context work should compile into these mechanisms, not duplicate them.

## Important gaps and risks

### Authority and replay

`StatelessContextBench._cells` and `ContextSession._cells` are Maps. Cell admission, state transitions, dependencies, and outputs are not append-only coordination records. A restart can deterministically recompute a pure result and notice an existing output file, but it cannot reconstruct an admitted/completed cell, distinguish replay from recomputation, recover an interrupted admission, or prove that a returned file is the ledger-authorized artifact. The cell record also omits the specified canonical program, input refs, child calls, termination, and record digest. Calling this “exact replay” currently overstates same-process memoization.

The output path is a private filesystem cache, not the existing artifact registry. Eviction/corruption therefore has no durable artifact lease or typed ledger transition. `context_artifact_unavailable` exists only at read time; it is not a cell termination truth.

### Evidence and knowledge

Evidence currently contains branch names and aggregate counts, not exact source refs, item/range/node coordinates, tree-currentness, exclusions, derivation receipts, or gate/route/Attempt identities. Coverage has only selected/source counts and unread branch count; it cannot represent `indexed`, `delegated`, `reviewed`, or `excluded_with_reason`. `join`/`collect` sum source counts and can double-count shared provenance.

The manifest branch shape has a digest and summary but no explicit immutable source-coordinate or `observedOn/currentTree` fields. Consequently the promised conspicuous cross-tree labeling cannot yet be enforced. No explicit Scratch publication path exists, which safely prevents accidental Cairn promotion, but there is also no tested bridge proving that Context outputs remain derived/quarantined when publication is later added.

### Routing, dynamic depth-one map/reduce, and lifecycle

The AST correctly denies route selection, but exact orchestrator-selected harness/model/effort is not yet exercised: there is no role-map lookup, ContextManifest-to-Plan compilation, WorkItem/Wave admission, child prompt binding, Attempt attachment, synthesis Candidate, review-family gate, or deterministic verification gate. Therefore route preservation is **proposed, not implemented**.

Likewise there is no dynamic depth-one execution. The existing `parallel_attempts:isolated:operator_selected` Workflow proves durable prebound teams and Wave replay for a static composition; it does not yet prove that an addressed Context partition set can be deterministically compiled after a pure cell, capped at one decomposition Wave plus synthesis/review, and resumed without duplicating provider effects.

Context cells/call batches are absent from the Run descendant union. Existing Run stop/reap is strong for known workers and worktrees, but cannot fence an unrecorded Context effect, target a cell generation, reject late child attachment, settle artifact leases, or project the CP6 termination taxonomy. Stop/reap preservation is therefore also proposed, not inherited automatically.

### Agent experience and progressive application surface

The closed AST is safer than unrestricted Python, but the current facade is only lightly Pythonic: it is JavaScript, accepts branch names rather than composable addressed values, exposes only three transforming helpers, and has no `map`, `reduce`, `review`, `verify`, `finish`, calls view, termination, attention, or recommended-next-action surface. The convenient example `hits = ctx.search(...); parts = ctx.chunk(hits, ...)` is not expressible through `ContextSession` today.

The unified Run application's semantic registry advertises Run start/status/inspect/act/stop and related Workflow actions, but no context outline/index/cell/call/evidence actions. Direct export of the Context classes is not progressive application integration. CLI, Web/browser, and MCP transport parity—and a shared semantic document digest—remain wholly future work.

### Evaluation

No direct-vs-Atlas-vs-pure-Context-vs-depth-one evaluation exists. There is no evidence yet that recursion should be selected for any task class, that short-context recursion is refused, or that the strategy improves verified utility after cost, latency, duplication, replay, and cleanup are included. Deeper-than-one recursion should remain closed.

## Smallest dependency-ordered red-test and implementation sequence

1. **Durable pure-cell admission/replay.** Red-test ledger admission before evaluation, restart after admission and completion, exact program/input/dependency records, artifact-registry identity, unavailable/corrupt artifact termination, and changed tree/environment/policy identity. Implement ContextManifest/cell/artifact records in coordination and registry storage; keep the Bench a deterministic evaluator behind that authority.
2. **Exact provenance and typed progress.** Red-test item/range/node coordinates, cross-tree labels, non-double-counting coverage states/exclusions, asserted `finish`, independent gate requirements, and every CP6 disposition. Implement addressed context values and receipts before any provider call or Scratch bridge.
3. **Manifest-to-approved Plan/Wave compilation.** Red-test one normalized `map` over deterministic partitions producing one WorkItem/Wave and a bijection of partition → Attempt, with no provider effect before approved atomic admission. Reject unknown role, route fields, changed membership, excess depth, and coding/analysis workspace mismatches. Compile through existing Goal/Plan/Wave APIs.
4. **Exact role routing.** Red-test each child observes precisely the orchestrator-bound harness/model/effort (including distinct efforts by role), while aliases/defaults/model-authored overrides and route-family violations fail before spawn. Persist requested/resolved/observed route receipts on call, Attempt, result, and evidence.
5. **Partial-batch recovery and contamination fencing.** Red-test restart at batch admission, partial completion, ambiguous provider effect, result attachment, and synthesis; require stable identities and at most one physical effect per Attempt. Red-test duplicate/stale/cross-generation/late results as retained evidence that cannot attach or enter cache/synthesis.
6. **Stop/reap union.** Red-test Run and cell stop during a Wave: fence admission first, snapshot cells/calls/Attempts/processes/worktrees/runtimes/leases, confirm death and zero ownership, and keep late completions quarantined. Extend existing descendant discovery and cleanup receipts rather than adding Bench-local cancellation.
7. **Depth-one reduce/review/verify.** Red-test reduce consuming only exact terminal child refs, producing an untrusted Candidate, independent review/verification, typed no-progress/repetition/contradiction outcomes, and successor-Plan proposal instead of hidden depth-two calls. Implement synthesis and gates through ordinary Workflow authority.
8. **Composable session facade.** Red-test the conceptual flow `search → chunk → map → reduce → finish`, contextual help at each depth, bounded calls/cells tables, attention, termination, and recommended action. Implement a small addressed-value builder that compiles to the same canonical AST; defer isolated Python until differential tests justify it.
9. **Unified transport parity.** Red-test direct application, CLI, Web/browser, and MCP against the same advertised actions and semantic digest, with no client-supplied private coordinates. Add context operations to the Run progressive surface only after lifecycle semantics are durable.
10. **Evaluation gate.** Add the fixed four-arm corpus and measure fresh-gate correctness, evidence precision/coverage, contradiction behavior, calls, latency, cost, duplication, replay equivalence, and cleanup. Enable recommendation/automatic routing only for winning task classes; keep deeper recursion and persistent kernels closed.

This ordering makes the first provider-backed red test depend on durable authority and evidence, and makes transport polish depend on settled semantics. It is the smallest route to preserving exact route, result, and cleanup truth without creating a parallel orchestration system.

## Verification status

Per the brief, this review did not run the verification command or any verification suite. Completion must not be claimed until Baton runs its required fresh deployment verification (`node`, expected exit code `0`).
