# Codex review of the Baton2 architecture

**Verdict: the eight logical owners are a useful prototype architecture. The evidence supports Prototype-only for production authority transfer. Several deletion claims require correction before they can be used as implementation instructions.** The rewrite can proceed under the operator's standing authorization with those corrections and bounded proofs. This review does not reopen the final approval of the 16 laws at `1fab9a1da60db3d5d9c9d3cef89d3caabd68fe35`.

The most serious gaps are application capability provenance and cleanup, canonical remote publication, native durability, and recovery decisions made with incomplete evidence. These are implementation obligations under the approved laws. I propose no additional law and no fixed eight-component design law.

The six reviewed documents are the staged copies of `docs/bend2/` at `387ff4399c382e49a8320e12ab48d949c3cd54b6`. I compared their bytes with the Git objects. The language review and source excerpts cited below are from that same commit unless explicitly identified otherwise. Later implementation or document changes require their own validation; this verdict does not silently cover them.

## Findings that change the proposal

### 1. Affine application records do not establish authority or cleanup

`target-architecture.md:60`, `:83`, `:172`, `:203`, `:305` and `:323` rely on affine values to replace in-process authority checks and to close child scopes. `architecture-review.md:192` proposes deleting fences, holder inference and bearer strings. The retained durable generations are necessary, but they do not establish that the proposed replacement works inside one execution.

The pinned language review already supplies the counterexamples. Under LANG-F-28, an importing module constructs `Lease{999}` directly. Under LANG-F-26, a function drops a lease without running release. A consumer using its argument at most once does not establish who issued it, which resource incarnation it names, whether another alias was issued, whether current authority still permits the action, or whether disposal preserved an artifact. Base's opaque handles have stronger construction restrictions; ordinary application records do not acquire them by naming convention.

I also compiled and ran `codex-probes/dropped-child.bend` natively with Bend 2.0.25. It starts an `IO.fork`, drops the result channel, and returns from the parent. Output was:

```text
parent returned without joining
child continued
```

This establishes that dropping the fork result does not cancel the computation. It is a small runtime probe, not an OS process lifecycle test. The installed guide describes fork/join channels and says the program finishes when all computations finish; `bend base IO.cancel` reports no such Base member. An application nursery and cancellation protocol remain feasible work, but they are not supplied by these primitive names.

Required correction: mark capability provenance and structured lifecycle management as explicit prerequisites. Keep sufficient runtime validation until a proof-indexed encoding or another effective authority mechanism is demonstrated at the pin. Specify close, cancellation acknowledgement, process termination, reap and custody release independently. Release must depend on established outcomes and preservation obligations. Relevant laws: M-4, M-7, M-8 and M-17; uncertain termination also invokes M-2. F5, F7 and F8 cannot authorize deletion on their current language claims.

### 2. Phase 4 still permits integration to complete after a local ref update

`rewrite-plan.md:439` gives `LandingPlan` an immutable commit, target ref and expected head, but no explicit admitted canonical shared destination. The listed receipts and restart tests end at ref compare-and-swap. At the reviewed source pin, `impl/src/worktree.mjs:2344` calls local `git update-ref`; `impl/src/swarm-runtime.mjs:7676` constructs the resulting integration receipt and records completion. The separate publisher in `impl/src/index.mjs:1553` invokes `git push`, but that is not the integration path. [Issue #558](https://github.com/Flip-Engineering/baton/issues/558) reports the resulting local-only completion.

Counterexample: prepare and verify a correct squash commit, update a clone's local target branch, return an integrated receipt, and leave the intended shared branch unchanged. Every local Phase 4 test as described can pass. This violates M-18. A wrong-destination push and an omitted push are distinct cases that both need coverage.

Required correction: give one owner responsibility for the whole publication operation. Bind admitted repository authority, the effective shared endpoint and target, the expected shared target state, and the verified artifact. Local preparation has its own state. Completion requires evidence for the actual shared publication; uncertainty after dispatch remains unresolved under M-2. Resolve configuration redirects and changes at the real effect boundary. A subsequent observation of the desired remote head can establish state convergence without establishing a new effect by this attempt; M-3c still applies.

Test destination substitution, no network publication, endpoint/configuration changes, target contention, lost responses after successful publication, and restart before and after the completion record. Preserve honest local preparation results where those are useful. The architecture must not relabel local preparation as shared completion. M-3a, M-3b, M-3c, M-8 and M-18 supply the contract; no extra law is needed.

### 3. The native host prerequisites omit a demonstrated durable journal path

The language review establishes Base file read/write/close operations. The installed native `file_write.c` uses `write`; `file_close.c` uses `close`. Neither is a durability barrier. The current `bend base File` surface exposes no fsync, atomic rename or locking operation; direct `File.fsync` and `File.rename` queries fail. These observations are recorded in `codex-native-surface-checks.json`.

Counterexample: return an append receipt after a successful buffered write, lose power, and recover without the accepted intent. A receipt-shaped Bend return value does not prevent it. LANG-F-29 makes the same distinction at the type level. Phase 6 lists atomic publication and rename, but the readiness accounting presents process and JSON as the two principal missing families without separately proving the durability family needed by Phase 2's eventual replacement.

Required correction: inventory the native journal and replacement operations explicitly. Define a supported-platform durability contract for append, partial writes, file synchronization, replacement, directory persistence where required, interprocess serialization and stale-writer exclusion. Demonstrate the relevant crash and contention cases before transferring that authority. Existing JavaScript durable writes can remain the Phase 2 executor while the native path is built. C effects are a documented route, so missing Base members do not establish impossibility.

The File API's U32 quantities also require an explicit segmentation/chunking design for large logical journals. They must not become an unexplained maximum on retained history. Relevant laws: M-1, M-5, M-8 and M-10.

### 4. Lost local ownership does not justify repeating an external effect

`target-architecture.md:330` permits the Reconciler to mint a new affine value after the prior value is expired, consumed or unreachable, then repeat an external effect after recording that proof. The wording does not require the necessary conclusion about the external effect.

Counterexample: a provider starts a worker, the response is lost, and the caller process dies. The local lease is unreachable. Recording that fact and starting another worker can duplicate the logical operation. Another counterexample is a paused writer resuming after a replacement writer obtained a newer generation: a stale in-memory handle remains usable unless the write boundary excludes it.

Required correction: distinguish operation identity, attempt identity, local ownership and observed external outcome. Reconciliation must use effect-specific evidence and a justified retry or newly authorized action that accounts for uncertainty. Generation checks must hold at the protected effect, with atomicity or serialization appropriate to that effect. One reconciler may coordinate these protocols; a generic retry rule cannot replace them. F9, F19 and F20 are useful ownership consolidations subject to this condition. Relevant laws: M-2, M-3b, M-3c, M-8 and M-17.

### 5. A diagnostic replay with missing policy can manufacture a corruption finding

Claude reported that doctor/quarantine rejected valid `run.stop_admitted` rows, that applying the suggested quarantine hid the stop, and that reverting two quarantines allowed ordinary startup to replay 72,996 rows. I did not rerun those resident operations or modify that ledger.

The reviewed source independently supports the mechanism. `coordination-store.mjs:123` and `:2636` construct `new CoordinationStore(root)` without deployment policy for diagnosis and quarantine. `coordination-ledger-writes.mjs:278` defaults the run-lineage policy to null. `coordination-admission.mjs:1620` selects different exact payload field sets according to whether that policy exists. A policy-bearing stop row containing `scope`, `throughSeq` and `targetRunIds` is therefore rejected by the policy-free path. `coordination-ledger.mjs:3282` normally folds that row into stop and cancellation state; omitting its fold changes the logical result.

This refutes the blanket implication in `target-architecture.md:332` that a replay refusal establishes corrupt history that should enter quarantine. Missing configuration, an incompatible decoder, a projection defect and corrupt source bytes require different dispositions. Preserving bytes while silently skipping a valid fact does not satisfy logical preservation.

Required correction: make startup, doctor and recovery use the same applicable recorded schema/policy basis, or explicitly report that the basis cannot be reconstructed. Classify the cause before offering repair. Exercise the same valid ledger through all three entry points and require equivalent logical projections. Include a missing-policy negative case that refuses to diagnose corruption or recommend destructive logical repair. Relevant laws: M-5, M-7, M-14 and M-17. This is a concrete reason to unify validation semantics under F2/F9/F22 while retaining distinct diagnostic responsibilities.

### 6. Typed effect declarations alone do not establish verification coverage

`target-architecture.md:63` and `:216`, F17, and Phase 4 replace the seam inventory with typed effects and affected-path declarations. A common owner can reduce duplicate maps. No demonstrated mechanism yet establishes that the replacement selects a sufficient gate set.

Counterexample: modify a pure authority predicate, canonical encoder or event fold while preserving its type and effect declarations. A gate selector that only tracks declared effect use may omit every relevant authorization or replay test. Caller-written affected-path declarations can also omit a dependency.

Required correction: define how changes are related to affected contracts and how omissions are detected. Keep conservative coverage while that relation is unproven. Test a pure helper change, a schema change, a shared library change and an altered C effect. The current source-shape inventory may be deleted once the replacement provides the required coverage; its exact representation is not an inviolable law. Verification evidence must still name the actual artifact and applicable state basis under M-3a.

### 7. The migration law basis and runtime premise are stale

`rewrite-plan.md:37` and `go-no-go.md:16`, `:67`, `:178` describe 138 candidate laws awaiting decisions. The reviewed commit already contains the reduced 16-entry set; final approval is separately recorded at `1fab9a1d`. The older rows remain useful source traces and compatibility observations. They are not 138 additional development laws.

Required correction: map the migration to the 16 approved prohibitions. Classify older fixtures as required compatibility, deliberate corrections, or internal structure tests. Keep the requirement of zero unexplained differential differences. A known invalid local-only publication result must not become a target expectation merely because the reference implementation produces it. Preserve evidence and explain every intentional difference; do not erase failing tests to obtain a green run. The recorded 174/175 source-shape discrepancy likewise needs an explicit disposition.

The first line of `target-architecture.md` and the mandate say HVM. The installed 2.0.25 guide describes generated C and BendRT's flat state machine. The review has validated that native compiler path. Correct the runtime premise for the accepted pin, or explicitly resolve a hard HVM requirement before claiming mandate conformance. Do not base performance or lifecycle guarantees on an untested runtime name.

### 8. The boundary table still has unresolved responsibilities

The eight owners can be logical modules. They do not require eight services or 28 active channels. The complete pair table is useful for checking responsibilities, but it is not evidence that the interactions have been implemented.

- Journal forbids command admission while retaining prospective fold admission. Distinguish the Scheduler's business decision from the journal's atomic validation of the expected basis and event batch. Two commands admitted against the same exclusive resource must not both commit.
- Worker Gateway owns process lifecycle, while the Worker/Verification pair has no direct seam and Verification owns an isolated executor. Phase 6 again assigns processes to Worker Gateway. Specify a shared host process substrate or the routed execution seam, with separate verification authority. Repeated process ownership would defeat F6; conflating independent review authority would defeat F16.
- A journal cursor establishes freshness for journal-derived views. It cannot alone establish the current state of an external provider, host capacity observation or remote repository. Retain each observation's source, identity and applicable basis.
- Journal waits need a race-free relation between checking a condition and registering interest. A resource can become available without a journal row, and a worker can die outside the resident. Own the host observation and event capture explicitly. Legitimate internal host polling can coexist with agent-facing push; deleting a polling implementation does not create the missing notification.
- One native schema can own structural codecs, but semantic authorization, state-dependent checks and versioned replay still require logic. JSON and the codec derivation path are work at this pin.
- Moving Atlas behind Capability Services does not remove a Node dependency from an overall Node-free deployment. Name the replacement ABI, implementation or externally supplied service and its packaging contract. Preserve per-operation language support.
- Bend's single IO event loop still needs responsiveness during long pure folds. Deleting JavaScript yield code is reasonable only with a demonstrated scheduling replacement and a measured host service budget.

These issues can be resolved without adding mandatory subsystem counts, scheduler algorithms, directory layouts or performance constants to the law set.

## Disposition of every proposed deletion or merge

“Accept direction” means the proposed consolidation has a sound ownership rationale. It does not assert that an implementation or its preservation tests already pass. “Conditional” names behavior the replacement must demonstrate. “Revise” means the current justification is insufficient to authorize deletion.

| Finding | Disposition | Behavior that must survive or be corrected |
| --- | --- | --- |
| F1 Facades and delegates | Accept direction | Preserve actual public embedding/protocol contracts during migration. Exact internal arity, forwarding bodies and test monkey-patching need not become permanent design constraints. Classify callers before removing compatibility. |
| F2 Durable event stores | Conditional | Preserve per-partition sequence, retention, archives, control/telemetry fault isolation, validation basis and atomicity where required. One journal owner need not mean one physical lock for all traffic. |
| F3 Parallel convergence runtime | Accept direction | Transfer its startup recovery and attention authorization into the surviving runtime; migrate any supported entry points explicitly. |
| F4 Plan/workflow/wave/swarm scheduling | Conditional | Share graph infrastructure while retaining distinct node variants, ID namespaces, digests, revisions, ancestry, focus and reopen semantics. Similar data shapes do not prove equivalent transitions. |
| F5 Wave supervision as joins | Revise lifecycle premise | Implement stall, nudge, claim recovery, settlement and selective stop. A fork/join primitive supplies none of those policies automatically. |
| F6 Worker adapter/process gateway | Conditional | Share process/transport mechanics; retain provider-specific readiness, permissions, resume and session state. Provider differences extend beyond stateless wire codecs. Prove the native process family. |
| F7 Provider supervision | Revise lifecycle premise | Implement the task supervisor and cancellation protocol. Preserve per-provider readiness, legitimate retry/backoff semantics, durable responsibility and one-shot settlement. |
| F8 Affine authority | Revise before deletion | Demonstrate provenance, resource incarnation, effect-time validity, exclusive claims and cleanup/preservation. Ordinary affine records are forgeable and droppable. |
| F9 Recovery reconciler | Conditional | Share orchestration while retaining effect-specific evidence, uncertainty, custody and diagnostic classifications. Unreachable local values do not prove retry safety. |
| F10 Materialized views | Accept direction | Preserve authorization, redaction, cursor semantics and bounded delivery. External observations need their own validity basis in addition to a journal position. |
| F11 One surface protocol | Accept direction | Share operation semantics and schemas; preserve each transport's authentication, notifications, streaming, error/exit behavior and compatibility. Codec generation remains implementation work. |
| F12 Context/plan/artifact models | Conditional | Parameterize common lineage logic while retaining pure/effect distinctions, selective retry identities and independently validated source evidence. |
| F13 Validation/presentation policy | Conditional | Unify secret coverage, then preserve policy differences for inline versus whole-value redaction, refusal mappings and truncation markers. Physical chunking must retain access to the owed remainder. |
| F14 ESM and source-shape shims | Accept direction | Delete language-specific re-exports and duplicate pin resolution when their callers migrate. Preserve import inertness, cancellation and attribution timing. |
| F15 Atlas boundary | Conditional | Preserve per-operation capabilities and version evidence. Resolve native parser packaging and Node-free deployment explicitly. |
| F16 Verification/contribution/landing | Conditional | One workflow owner can preserve separate review authority and execution isolation. Add actual shared publication and recovery; current local landing parity is insufficient. |
| F17 Seam inventory | Revise replacement claim | Demonstrate change-to-contract/test coverage, including pure and shared dependencies. Typed IO signatures alone do not prove test impact. Delete source-shape scaffolding after meaningful coverage exists. |
| F18 Capacity leases | Accept direction | Share accounting/publication mechanisms while retaining resource-specific floors, consistent units, owner incarnation, coupled resource accounting and dead-holder evidence. |
| F19 Idempotency stack | Conditional | Give the protocol one owner while distinguishing commands, logical operations, events and external attempts. Preserve persistent duplicate detection and unknown outcomes. |
| F20 Append/drift/atomic writes | Conditional | Share verified-frontier and durable replacement code; retain effect-time stale-writer exclusion, atomic batches, ordering and supported crash guarantees. Native durability remains an explicit prerequisite. |
| F21 Task/journal waits | Conditional | Prove condition-check/subscription race handling and external event capture. Keep an owner for physical changes that produce no journal event. Agent-facing push remains required. |
| F22 Schemas/refusals | Accept direction | Share structural definitions and refusal vocabulary while preserving semantic checks, safe context, versioned replay and the applicable recorded policy basis. |
| F23 Wake consumers | Conditional | Share subscription machinery with durable resume, lossless owed data in bounded chunks, backpressure and actual delivery at the agent interface. Appending a row does not itself deliver a wake. |
| F24 Node workarounds | Conditional | Replace V8/prototype/key mechanics as needed; preserve incarnation checks, deterministic encoding, control responsiveness and measured runtime capacity. Native compilation does not remove these requirements. |

## Coverage of the approved laws

No production implementation is certified by this table. It identifies the proof boundary each law requires in the proposed architecture.

| Law | Required boundary and current gap |
| --- | --- |
| M-1 Recoverable acceptance | Scheduler/Journal acknowledgement follows durable matching intent. Native durability and crash evidence remain unproven. |
| M-2 External uncertainty | Worker, publication and Reconciler preserve unknown attempts. Expired/unreachable local ownership cannot decide the outcome. |
| M-3a Actual artifact/target evidence | Verification/Landing bind evidence to the actual artifact and relevant live basis. Add shared target state and sufficient gate coverage. |
| M-3b Duplicate logical effects | Journal and effect executors preserve operation identity across retries and restarts. Local affinity alone is insufficient. |
| M-3c Honest new-effect claims | Receipts distinguish newly executed effects, replayed results, observed convergence and uncertainty. A matching remote head alone does not prove this attempt caused it. |
| M-4 Custody and preservation | Workspace disposal checks both current custody and preservation obligations. Dropping a lease proves neither. |
| M-5 Logical history and owed events | Journal/projectors preserve identities, required ordering and owed delivery through recovery and compaction. Misclassified quarantine violates this despite retained source bytes. |
| M-7 Validated authority/attribution | Gateways and Kernel validate provenance before granting established status. Forgeable record construction cannot provide the evidence. |
| M-8 Valid authority at effect | Every executor enforces action, resource incarnation, delegation and current exclusivity. Durable generations require effective checks at the protected operation. |
| M-10 No arbitrary cutoff | Capacity, exports, history and transport use justified physical bounds with retained remainder/resumption. No baked-in TTL may terminate valid work merely because time passed. |
| M-11 Caller facts | Northbound decoders preserve the distinction between requested values and established state/evidence. Shared schemas must not collapse it. |
| M-12 Asynchronous acceptance | Gateway can return after durable admission; worker execution is separate. Durability wait and optional completion wait remain legitimate. |
| M-13 Agent progress delivery | Journal subscription must reach the agent's actual receiving interface and survive reconnection. A queryable projection alone is insufficient. |
| M-14 Truthful safe refusal | Versioned refusal registry reports the actual failure and known safe remedy. Missing policy must not become invented corruption and harmful repair advice. |
| M-17 Continuation responsibility | Scheduler/recovery retain real responsibility or an authorized suspension for every accepted unsettled operation. Orphaned IDs and dead child scopes are insufficient. |
| M-18 Canonical publication | Landing dispatch and completion bind to the admitted shared endpoint and target. Phase 4 currently stops at insufficient local evidence. |

The reported hardcoded 24-hour owner-session expiry is another useful M-10/M-17 regression candidate. I did not independently reproduce that live incident. Expiring authentication may be legitimate under its actual authority policy; severing all responsibility for still-valid accepted work solely because a literal duration elapsed is the behavior the tests must distinguish.

## What Prototype-only should mean now

The current recommendation is supported: the six documents provide an executable evaluation plan, not a passed Phase 1 differential run, native host conformance suite or production rollback result. The record contains useful compiled language examples and real consolidation targets. It also contains explicit host gaps and the counterexamples above. Native parallel speedups on balanced numerical work do not measure resident latency, provider throughput, journal replay or total operating cost.

Use two independent proof tracks before relying on the deletion promises:

1. **Pure decision and replay prototype.** Update the law basis to the approved 16 entries. Freeze representative source traces with expected logical behavior, classify deliberate corrections, and run the same admission/fold/projection cases through both implementations. Include policy-bearing stop replay, missing policy, changed authorization basis, rejected mutations, preserved history and owed wake cursors. Explain all differences. This can proceed while host effects are built.
2. **Native effect prototype.** Demonstrate capability construction restrictions or validation, durable acceptance, asynchronous child lifecycle, cancellation acknowledgement/reap, process identity, recovery after lost responses, and canonical publication with controlled targets. Compose the pieces into a small durable-acceptance-to-completion path. Test ambiguous publication and external effects without automatically repeating them. Use isolated fixtures and controlled processes/remotes, not the active resident.

These tracks test different risks. Completing a large pure parity corpus first is not a prerequisite for discovering whether the native authority, durability and process assumptions hold. JSON/framing and host primitives can be developed independently where their actual dependencies permit it.

Before transferring each production authority, require the relevant behavior proof, a working rollback path and agreed operational measurements. Rollback needs compatible decoding of rows written during the transition and explicit ownership of any surviving external worker/effect. Stopping admission and replaying a ledger cursor alone do not exclude a still-running executor. Keep rollback obligations tied to the actual transferred boundary rather than imposing an unnecessary global phase order.

The consolidation benefits are partly independent of the language choice: duplicated delegates, registries and durable-write helpers can be consolidated in any implementation. The Bend2-specific benefit to establish is checked application invariants connected to real boundaries. The upstream sorting and interpreter examples relate implementations to semantic results; the IO server example proves its pure response construction, with network delivery still outside that proof. Baton2 should use the same precision: prove the relevant invariant, identify native assumptions, test adapter conformance, and avoid promoting a small model proof into a claim about actual Git, processes or disk persistence.

## Evidence and limits

I read all six staged architecture/plan documents, the pinned language review, the approved law text and the cited source paths. I independently checked the publication and diagnostic-policy paths. I compiled and ran the new dropped-child probe with the installed native 2.0.25 compiler, inspected the installed guide and C file effects, and queried the Base surfaces. Earlier capability, law and destination probes are supporting mechanism evidence; they were not rerun for this unchanged architecture review. No full Baton test suite, full 193-module audit, native production prototype, canary or resident recovery test was performed here. I made no changes to Baton source, its ledger or its running workers.

Compiler used: `/tmp/codex-baton2-context-afnsav7o/toolchain/bend/bin/bend`, version 2.0.25, SHA256 `3850c7cd281a687715a181ad6a2ecdef041704f320ea2b4304cf9e802309203c`. Language source pin: `bendlang/bend@a49524265bdfa5753a4bf38e25f0574a705dd868`.

Evidence files in this directory:

- `codex-probes/dropped-child.bend` and `codex-probes/dropped-child-results.json` contain the new native counterexample and exact process results.
- `codex-native-surface-checks.json` contains the File/IO Base queries.
- `source/impl/src/` contains Git-object copies of the source cited above.
- `context-language-review.md` and `context-laws-proposed.md` contain the language and law context at the reviewed architecture pin.
- `../codex-final-law-review-r9.1.md` records the separate final law approval.

Verified SHA256 of the six input artifacts:

| Artifact | SHA256 |
| --- | --- |
| target-architecture.md | `603b2fbc7954a463dfb82e25a5180b6ca0d20ad9b5907eb5d314e4851ccc845b` |
| architecture-review.md | `34506e37131fded326faff8f441af5938ee68c35f76a0ac014f7146190b44369` |
| architecture-findings-coordination.md | `1b7d6d428f7aa9c5549aeaa6ea9b1b32b745e1dd130f799404fa33473a3002d5` |
| architecture-findings-surface.md | `199a623459d4a39298724af58d15592f16bc01a37013f4219967dc2059b356a3` |
| rewrite-plan.md | `a4dcad9c9bbd3dcc2cd9effd3c604179ce248a4409042fb873d73614989a51c2` |
| go-no-go.md | `d275976052d6d492e6063b75b72b5ff37e919726128815deb712063dcc52a3d1` |
