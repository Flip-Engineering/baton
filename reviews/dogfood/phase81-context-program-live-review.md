# Phase 81 Context Program live review

## Verdict

The effective-tree snapshot contains a credible first leaf for Phase 81: a closed ContextManifest normalizer, a closed JSON Context Program normalizer, a synchronous stateless evaluator for pure expressions, content-addressed output files, and a compact in-process ContextSession facade. That leaf does prevent the program from smuggling a route or arbitrary code into the evaluator, and its identity includes manifest, normalized program, environment, and policy digests.

It does **not** yet establish the Phase 81 authority, replay, lifecycle, evidence, routing, or application contract. The Bench is independent of the coordination ledger and unified Baton Run application. `map`, `reduce`, `review`, and `verify` are accepted syntax but always fail at execution. There is no ContextManifest-to-Goal/Plan/Wave compiler, no durable cell admission, no Attempt attachment, no context-aware stop/reap union, no progressive context section, and no direct/CLI/Web/MCP parity. Accordingly, the current code must not be described as a working `context_recursive` strategy.

The design direction is sound if the Context Program remains a subordinate compiler and projection over existing Baton authority. The next implementation should reuse the current Plan-bound Workflow Wave, exact route tuple, Candidate, progressive application, and coordinator cleanup machinery. Building parallel context-specific dispatch or lifecycle state would undermine the strongest parts of Baton.

## What is implemented now

### Closed manifest and program data

`normalizeContextManifest` enforces an exact top-level shape, a 40-hex tree selected by `workflow_plan`, a content-addressed Plan identifier, unique content-addressed branch refs, a policy digest, canonical branch ordering, and a computed manifest digest (`impl/src/context-program.mjs:95-165`). Returned manifests are recursively frozen.

`normalizeContextProgram` admits only the specified expression operators and exact fields, rejects cycles and unknown operations, bounds normalized program bytes/nodes/depth, normalizes text, and computes a program digest (`impl/src/context-program.mjs:220-355`). Provider-effect expressions have only `role` plus instruction/gate fields; harness, model, effort, credentials, cwd, and authority coordinates are rejected as unknown fields. This is a meaningful negative-authority boundary.

The current canonicalizer is nevertheless only a local JSON-like canonicalizer, not yet a proven durable canonical encoding. Source values are cloned as structured data but are not recursively validated as JSON values. Values such as `undefined` can be omitted by `JSON.stringify`, array `undefined` becomes `null`, and unsupported primitives can fail outside a typed normalization boundary (`impl/src/context-program.mjs:41-67`). Before these digests become ledger or artifact identities, tests must prove rejection of non-JSON values and collision-free agreement with Baton's canonical digest conventions.

### Pure stateless Bench

`StatelessContextBench` verifies policy equality and branch content digests, evaluates the pure operators synchronously, imposes an output item ceiling, writes one digest-named JSON artifact with exclusive creation, and checks an existing file's digest (`impl/src/context-program.mjs:397-630`). Its cell identity includes manifest, program, environment, and policy digests. The current tests demonstrate unchanged-input identity, changed-program identity, zero provider effects, artifact presence, source-substitution rejection, and basic coverage counts (`impl/test/phase81-context-program-red.test.mjs:80-150`).

This is deterministic re-evaluation, not durable replay. Every `execute` call evaluates again before checking/writing the output; no admitted/completed cell record is read from the coordination ledger. There is no append-only transition, idempotency key, generation fence, dependency/input-ref list, admission-before-effect boundary, or recovery transaction. A missing source reports `context_source_unavailable`, not the specified terminal `artifact_unavailable`. The returned `outputRef.path` also exposes a host path, which is acceptable inside this isolated prototype but must never become the public reference accepted by transports.

The output artifact is not registered through Baton's artifact registry and the returned cell record is an ephemeral object. Thus “one identity and artifact” is locally demonstrated, while eviction semantics, unavailable-artifact truth, restart equivalence, and non-recomputation under an old receipt are not.

### Pure operations, coverage, and evidence

The evaluator implements `source`, `outline`, `index`, `search`, `slice`, `chunk`, `filter`, `project`, `sort`, `unique`, `join`, `collect`, `coverage`, and `finish` (`impl/src/context-program.mjs:427-576`). Effects are explicitly refused with `context_program_effect_requires_workflow` (`impl/src/context-program.mjs:577-583`). This separation correctly prevents the Bench from becoming dispatch authority.

Evidence is not yet sufficient for Phase 81. Metadata carries branch names and aggregate counts, but not exact source refs, item identities, paths/spans/nodes, exclusions, read-state transitions, or receipts. `finish` labels its output `grounding: 'asserted'`, which avoids claiming verification, but nothing connects it to Scratch publication, Cairn gating, Candidate review, or a deterministic gate. Coverage only distinguishes source/selected totals and unread branch count; it does not implement `unread/indexed/selected/delegated/reviewed/excluded_with_reason` accounting. Join and collect totals may also double-count a source, so the current counters are evaluator metadata rather than an evidence ledger.

### Agent experience

`ContextSession` offers `outline`, branch `index`, `search`, `chunk`, `coverage`, `cell`, and `help`, storing cells only in a process-local Map (`impl/src/context-program.mjs:632-689`). It is compact and discoverable, and the tests verify that shallow cascade.

It is not yet the intuitive Pythonic experience described by the spec. The implemented facade is JavaScript-only; it lacks composable addressed values, `slice/filter/project/sort/unique/join/collect/finish`, `map/reduce/review/verify`, calls, exact evidence, termination, and durable session recovery. `index()` returns all branch descriptors with no cursor, while `cell()` can only see cells executed through that particular in-memory object. The advertised method list claims an `outline -> index -> cell -> evidence` depth in help, but there is no session `evidence()` method. A Python-like front end should remain deferred; first make the JSON AST and unified Run projection complete, then add a thin fluent/Python compiler with differential tests.

## Existing Baton machinery that should remain authoritative

The existing unified application already supplies the control-plane shape Phase 81 needs:

- Workflow composition currently supports only `parallel_attempts / isolated / operator_selected`, validates a unique role-to-exact-route team, and makes harness/model/effort a complete tuple (`impl/src/application-client.mjs:80-145`). `context_recursive` is not an admitted strategy today.
- Application Workflow definitions are ledger-recorded, digest-bound to Goal, Plan, profile, WorkItem, and exact Attempts. Replay validation rejects any Attempt route that differs from its Plan node (`impl/src/application.mjs:3660-3735`). This is the right source for exact orchestrator-selected harness/model/effort truth.
- Initial multi-node Plans dispatch through coordinator-owned durable Workflow Wave authority, rather than direct provider calls (`impl/src/application.mjs:2210-2310`). Context `map` should compile to this seam.
- The Workflow projection already reports intent, Plan, Wave, selection, and owned-resource cleanup stages, exact attempt routes, Candidate selection, attention, evidence actions, and stop/wait actions (`impl/src/application.mjs:4820-4895`).
- The progressive application derives fresh semantic actions from the current view and binds them to registry/view/profile/Plan digests (`impl/src/application.mjs:5500-5560`). Outline/index/section/item/evidence inspection and the client `drive`/`complete` behavior invoke only advertised safe actions (`impl/src/application.mjs:5831-5900`; `impl/src/application-client.mjs:250-422`). Phase 81 should add projections and actions here, not expose the local ContextSession as another northbound control plane.
- Scratch already has tree-scoped observed/derived facts and explicit reads/claims; Atlas already produces addressed representations; coordinator/application stop and drain already own workers, interactions, provider processes, worktrees, and release receipts. A context branch should reference snapshots from these systems without copying their authority.

The missing work is therefore integration and compilation, not reinvention. A ContextManifest may describe immutable repository, Atlas, Scratch, coordination, evidence, document, artifact, and log coordinates, but it cannot itself authorize reading a mutable source, dispatching an Attempt, accepting a Candidate, publishing a claim, or stopping a subtree.

## Authority, replay, stop/reap, route, result, and cleanup critique

**Authority:** Closed AST validation is implemented; cell authority is not. Bench construction accepts an arbitrary `sources` object and caller-supplied environment/policy digests. It checks internal consistency, not whether the authenticated Run/approved Plan granted those coordinates. Cell admission and transitions must be coordination-ledger transactions derived from a current Run handle.

**Replay:** Pure determinism is partially implemented; replay truth is not. The cell has no ledger sequence, dependency cells, generation, artifact-registry receipt, or durable state history. Provider ambiguity and partial Wave recovery are wholly proposed. A replay must reconstruct the same manifest/cell/batch/Plan/Wave/Attempt/Candidate/gate/cleanup identities without repeating an ambiguous effect.

**Stop/reap:** Pure synchronous evaluation owns no child resources, so current tests say nothing about CP7. There is no session/cell/call-batch descendant registry and no fence against late output. Compilation must register ownership before dispatch, add it to the existing Run stop snapshot, fence new batches first, and accept terminal stop only after every exact Attempt/process/runtime/worktree/lease is settled. Late results remain evidence on the stopped generation and must fail current-cell attachment.

**Exact routing:** The AST correctly cannot select a route, and existing Workflow validation has strong exact tuple binding. But no code resolves a context role against an approved role map. The future compiler must copy one approved triple as an indivisible tuple into each Plan node/Attempt, then preserve requested/resolved/observed route truth and reject absent, ambiguous, unsupported, or drifted tuples before provider effect. There must be no implicit “low” fallback.

**Result truth:** Pure output digesting is implemented locally. Child result attachment, terminal-child filtering, Candidate quarantine, independent review/verification, synthesis identity, stale/duplicate/cross-generation refusal, and typed termination are not. A model `reduce` result must remain an untrusted Candidate and cannot select, integrate, verify, or finish itself.

**Cleanup truth:** Existing Workflow views project owned-resource cleanup, but context cells are absent from that ownership graph. A successful synthesis cannot become terminal while any child ownership is unsettled. The cell evidence should include the ordinary Attempt cleanup receipts and a context subtree union receipt; it should not manufacture a parallel boolean.

## Clearly deferred/proposed work

### ContextManifest-to-Plan/Wave compilation

Not implemented. The compiler should be a hub-owned, deterministic translation from an admitted effect cell plus approved Workflow role map into ordinary Goal/Plan/WorkItem/Wave/Attempt records. Its output digest must bind the manifest, normalized program, partition refs, policy/environment, role-map definition, and predecessor cell. Admission must occur before any provider effect. This compiler should call the same Plan/Wave dispatch seam used by unified Workflows and should never call an adapter directly.

### Dynamic depth-one map/reduce

Not implemented. First scope should be exactly one root `map` batch over already materialized addressed partitions followed by one synthesis or independent review batch. Each partition gets a distinct Attempt and result/cleanup identity; analysis children get no writable checkout and coding children get private worktrees. Expansion beyond that depth may only propose a successor Plan for ordinary approval. No model-authored loop, recursive hidden call, shared mutable interpreter, or automatic depth increase belongs in the first vertical.

### Transport and progressive-application parity

Not implemented. `context-program.mjs` is exported from the module index but is not attached to `BatonApplication`, the client Workflow handle, CLI, Web, or MCP. The unified Run outline needs a context stage/count/coverage/termination summary; index needs a context section; section/item/evidence depths need bounded manifests, cells, calls, routes, receipts, and exclusions. Any action (for example, admit a proposed context step or stop a cell) must be advertised by the current view and invoked through `run.act` with server-derived coordinates. Direct, CLI, Web, and MCP should be contract-tested against one semantic view digest.

### Evaluation and strategy routing

Not implemented. No benchmark compares direct root response, Atlas-only inspection, pure Context Program, and depth-one map/reduce. No routing gate demonstrates where recursion improves verified utility. Keep `context_recursive` unavailable as an automatic recommendation until fixed tasks measure correctness, evidence precision/coverage, contradictions, provider calls, latency/cost, duplicate work, replay, and cleanup—including short tasks where recursion should be refused.

## Smallest dependency-ordered red-test and implementation sequence

1. **Harden the pure identity leaf.** Add red tests for non-JSON source/program values, canonical digest agreement, exact source-coordinate provenance, duplicate-source coverage accounting, missing/corrupt artifact disposition, artifact-registry identity, and replay that reads a completed durable record rather than silently recomputing it. Implement strict JSON normalization and an artifact-registry adapter without expanding the effect surface.

2. **Admit manifests and pure cells through the ledger.** Red-test that an authenticated approved Run/Plan is required; caller-invented repo/tree/source/environment/policy coordinates fail; admission is append-only/idempotent; restart around admitted/working/completed transitions converges; and changed tree/program/dependency/environment/policy creates a new cell. Implement manifest assembly from repository/Atlas/Scratch/coordination snapshots and durable cell state/events.

3. **Project pure context through the unified Run.** Red-test outline/index/section/item/evidence cascade, bounded cursors, exact provenance/coverage, safe next action, and identical direct/client/CLI/Web/MCP semantic digests. Implement application sections and client conveniences only; do not add effects yet. Remove public filesystem paths from projections.

4. **Compile one `map` effect to the existing Plan/Wave seam.** Red-test one logical WorkItem, one overlapping Wave, distinct partition/Attempt/process/result/cleanup identities, analysis read-only isolation, coding private worktrees, and rejection before effect of role absence or any program-supplied route field. Test exact approved requested/resolved/observed harness/model/effort with non-low efforts. Implement the deterministic compiler and role-map binding by reusing Workflow records and `spawnPlanWave`.

5. **Make batch replay and attachment crash-safe.** Red-test crashes after cell admission, batch admission, partial completion, provider completion, and attachment; ambiguous provider ownership must stop redelivery; duplicate/late/stale/cross-cell/cross-generation results remain evidence but cannot attach. Implement generation-fenced batch records and idempotent child attachment transactions.

6. **Add one reduce/review and gates.** Red-test that synthesis consumes only exact terminal child refs, produces an untrusted Candidate, cannot self-select/integrate/verify, and requires the approved deterministic/semantic gates. Implement one synthesis or review Wave and ordinary Candidate/feedback/verification records.

7. **Integrate typed progress and stop/reap.** Red-test every CP6 disposition, especially policy exhaustion without invented success. Stop during partial map and synthesis must fence new work, reap the complete descendant union, return zero ownership, and quarantine late completions. Implement context ownership edges in the existing Run stop/drain and cleanup projection, not a second reaper.

8. **Expose `context_recursive` only after transport parity.** Red-test application-admitted depth one, advertised actions only, exact semantic parity, replay after application restart, and depth-two refusal/successor-Plan proposal. Then admit the strategy in the client/application schemas.

9. **Evaluate before recommendation or deeper recursion.** Add the fixed comparative suite and thresholds. Only enable recommendation/routing for winning task classes. Treat a Python/Starlark facade, persistent kernels, transport-specific sugar, and depth greater than one as later proposals requiring differential behavior, containment, replay, and cleanup evidence.

## Bottom line

The closed Context Program currently preserves **syntax-level non-authority** and useful local pure-result identity. It does not yet preserve Baton's full authority, replay, stop/reap, evidence, exact orchestrator-selected routing, result, or cleanup truth because it is not connected to the systems that own those truths. The smallest safe continuation is ledger admission, unified progressive projection, then compilation into the existing exact-route Plan/Wave/Attempt lifecycle. Keep the Bench stateless, keep model output quarantined, keep depth one closed, and make the pleasant agent facade a compiler over those receipts rather than a new source of authority.
