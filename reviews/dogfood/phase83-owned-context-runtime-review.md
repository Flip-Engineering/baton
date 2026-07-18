# Phase 83 owned Context runtime audit

## Disposition

**Not launch-ready for the owned Layer B runtime.** The effective tree gets the in-process ordering mostly right: a Run stop is durably admitted before cancellation, that admission fences new Context sessions/cells and marks the snapshotted logical targets stopped, the application then aborts registered Context operations, and an owned executor resolves only after the direct child has closed and its process group is proven absent. The durable manifest/cell/artifact validation is also materially stronger than the Phase 81 checkpoint describes.

The remaining blockers are at the boundaries that the current tests do not cross: an executor has no durable process-generation identity across an application crash; the source filter can expose ordinary prefixed credential variables and Git may lazy-fetch through repository-local configuration; the cell environment digest does not identify the Node executable, worker/program bytes, or extractor policy; and the advertised evidence cascade does not expose the durable Git/source attestation that settlement relies on. A crash during a first CAS write can also leave a corrupt final-name artifact that prevents deterministic recovery.

This was a source-only audit. Per the Baton brief, I did **not** run `node`, the Phase 81-83 suites, or any other verification command. Therefore this report does not claim deployment verification or definition-of-done completion.

## What is actually implemented

### Kill/reap ordering in one live application incarnation

The intended order is visible and coherent:

1. `run.stop` appends `run.stop_admitted` first (`impl/src/application.mjs:6586-6602`). Store application immediately installs the Run admission fence and changes active Context sessions and admitted cells to `stopped` (`impl/src/coordination-store.mjs:5192-5252`). `_apply` independently rejects later session/cell admissions for a stopping Run (`impl/src/coordination-store.mjs:4649-4665`).
2. The application then aborts every registered Context operation for the Run and waits for those operation promises before asking the Coordinator to stop ordinary workers (`impl/src/application.mjs:2142-2174`). That ordering prevents a posted Context result from settling after the logical stop fence.
3. `_executeOwned` starts a detached child/process group with a minimal environment, registers it before returning, sends `SIGTERM` on abort, escalates to `SIGKILL`, and on child `close` probes the group and kills/waits again before resolving or rejecting (`impl/src/context-runtime.mjs:324-460`). `DurableContextSession` treats `context_execution_aborted` as a lifecycle abort and deliberately leaves the logical pure cell admitted rather than recording a deterministic failure (`impl/src/context-program.mjs:1182-1241`).
4. Shutdown closes late Context admission by setting the application closing gate and by rechecking that gate immediately before controller registration (`impl/src/application.mjs:6280-6301`, `6630-6652`). It aborts existing Context controllers and awaits the serialized Run-effect chains before draining the ordinary worker fleet.

`CR83-3`, `CR83-4`, and `CR83-5` cover the admission race, durable-abort disposition, and result-versus-exit ordering (`impl/test/phase83-context-runtime-red.test.mjs:237-411`). `CR83-2` covers same-incarnation Run stop of an in-flight Context action (`impl/test/phase83-context-runtime-red.test.mjs:613-662`). These are useful tests, but none kills the owning application process while its detached Context group is alive.

### Manifest, source, and cell authority

The durable side binds considerably more than a cache key:

- Session admission revalidates the exact deployment snapshot, Context policy/environment/reference identity, Goal and Plan versions/heads, approval, Workflow definition digest, Plan node digest/path scope, and claimed task generation (`impl/src/coordination-store.mjs:3985-4159`).
- Repository extraction reads the pinned commit, tree, and blobs through an attested Git executable and recomputes each SHA-1 Git object identity (`impl/src/context-runtime.mjs:46-191`). It ignores mutable worktree bytes when projecting source.
- A v2 source attestation records the commit/tree coordinate, root tree OID, extractor-policy digest, scope/node digests, per-item Git blob and byte coordinates, coverage, and a proof digest (`impl/src/context-runtime.mjs:535-593`). Admission reassembles every included file, verifies its blob OID/content digest/length and canonical chunk continuity, and checks every item is in Plan scope (`impl/src/coordination-store.mjs:3851-3982`, `5558-5587`).
- Pure cell admission is append-only and precedes execution. Settlement reopens both CAS artifacts and verifies cell, manifest, program, environment, policy, output, source-item, coordinate, and artifact identities before appending the terminal event (`impl/src/coordination-store.mjs:4163-4312`, `5383-5497`, `5609-5755`). Completed artifacts are reread, not recomputed.

The Phase 82 tests exercise strict idempotency, ledger replay, missing completed CAS behavior, late-result fencing, principal binding, source-item substitution, historical authority, and logical Context stop snapshots (`impl/test/phase82-context-durability-red.test.mjs:245-872`). Phase 83 adds real pinned-tree extraction and v2 producer attestation tests (`impl/test/phase83-context-runtime-red.test.mjs:465-611`).

### Credential environment and five-operation AX

The owned worker receives only `LANG`, `LC_ALL`, `TZ`, and a private `HOME`; provider environment variables, `PATH`, `NODE_OPTIONS`, and provider credential paths are not inherited (`impl/src/context-runtime.mjs:41-44`, `317-337`). Git is invoked by its attested absolute path with system/global config disabled, replacement objects disabled, prompting/askpass disabled, and optional locks off (`impl/src/context-runtime.mjs:104-119`). `CR83-6` confirms one sentinel is absent from both the worker and Git child (`impl/test/phase83-context-runtime-red.test.mjs:413-463`).

At the semantic layer, Context is correctly nested under the five default operations—`application.help`, `run.start`, `run.inspect`, `run.act`, and `run.stop`—rather than adding a command family (`impl/src/application-semantics.mjs:21-51`, `422`). The client facade uses inspect for outline/index/cell/evidence, help for contextual documentation, and advertised `run.act` IDs for search/chunk/coverage (`impl/src/application-client.mjs:260-315`). Action IDs bind the principal scope and current semantic view, and the server derives the session/manifest/program/cell coordinates (`impl/src/application-semantics.mjs:73-114`; `impl/src/application.mjs:5736-5819`, `6234-6305`). This is a sound AX shape.

The evidence for transport parity is still shallow. `CA83-1` checks the registry and `CA83-2` uses a fake command function (`impl/test/phase83-context-application-red.test.mjs:66-105`). The generic CLI/Web/MCP machinery plausibly carries the same `run.act`, but no Phase 83 test executes a Context action through CLI, authenticated Web/browser, and MCP and compares the semantic digest/result/replay identity. Do not yet promote the architectural wiring into a CP9 parity claim.

## Launch blockers

### LB1 — detached Context process ownership disappears on controller crash

The only live ownership record is `RepositoryContextRuntime.executions`, an in-memory `Set<ChildProcess>` (`impl/src/context-runtime.mjs:320`, `331-352`). Durable events know sessions and logical cells but have no Context execution ID, generation, PID/PGID, start identity, handshake, or reaping disposition. The Run-stop snapshot likewise carries only Context session and cell IDs (`impl/src/coordination-store.mjs:3292-3343`). Its v2 completion receipt proves only that those projections say `stopped`; all process arithmetic is for ordinary Coordinator worker IDs (`impl/src/coordination-store.mjs:3429-3481`; `impl/src/application.mjs:2174-2208`).

Adversarial sequence:

1. `context.cell_admitted` is durable.
2. `_executeOwned` spawns detached PGID 9001, sends work, and records it only in `executions`/`_contextControllers`.
3. Kill the application with `SIGKILL` while the child or a Git descendant is still alive.
4. Reopen the same deployment root. The ledger reconstructs the admitted cell, but the new runtime has an empty `executions` set and the application has an empty `_contextControllers` map.
5. Replay or admit Run stop. Store projection marks the cell/session stopped; `stopRunTargets` sees only ordinary workers; v2 stop completion can record zero remaining Context authority while PGID 9001 still exists.

`DC81-21` actually demonstrates how little the restart proof means physically: it reopens after a logical stop and replays a synthetic zero-Context receipt without any process coordinate (`impl/test/phase82-context-durability-red.test.mjs:805-824`). `CR83-2` cannot detect this because the original controller remains alive to abort its in-memory child.

This violates CP5 restart reconciliation and CP7's confirmed descendant death/zero-ownership requirements (`spec/phase81-context-program-rlm.md:260-268`, `288-298`). It also means the final deployment ownership object, which reports only workers (`impl/src/application.mjs:6651-6657`), can be truthful about Coordinator workers while omitting a surviving Context group.

### LB2 — source credential exclusion has concrete false negatives

The environment boundary is good, but Context also projects tracked repository text. `EXCLUDED_PATH` rejects several obvious locations and `SECRET_SHAPED` scans content (`impl/src/context-runtime.mjs:21-28`, `209-275`). The key/value expression starts with `\b`. Because underscore is a regex word character, common prefixed identifiers do not match at `API_KEY`, `TOKEN`, `PASSWORD`, or `SECRET`.

For example, a tracked, in-scope `src/runtime-config.ts` containing:

```ts
export const ANTHROPIC_API_KEY = "ordinaryopaquecredentialvalue12345";
export const service_token = "anotheropaquecredentialvalue12345";
```

has an allowed path/type and neither value has a provider-specific prefix. The scanner does not find `api_key` or `token` because each is preceded by an underscore. The entire file is admitted and `context_search` can return it. `CR83-1` tests only an unprefixed JSON key (`api_key`) and obvious sensitive paths (`impl/test/phase83-context-runtime-red.test.mjs:33-59`, `551-611`), so it misses this case. The similar scanner in the Bench also has the boundary weakness (`impl/src/context-program.mjs:25-30`, `539-568`).

This is a direct violation of the no-model-visible-credentials boundary, not later knowledge-graph work.

### LB3 — Git reads are object-verified but not guaranteed side-effect-free

Object identity verification prevents mutable-worktree or object-byte substitution, but `git cat-file` still honors repository-local configuration and partial-clone/promisor behavior. The environment disables system/global configuration and prompts, but it does not set `GIT_NO_LAZY_FETCH=1`, impose a timeout, or otherwise forbid a missing promisor object from triggering a remote/helper fetch (`impl/src/context-runtime.mjs:104-127`). A repository-local credential/helper or remote configuration can therefore turn a supposedly immutable read into external command/network activity. Because `execFileSync` has no timeout, that effect can also hang the owned worker until cancellation—and becomes LB1's orphan case if the controller crashes.

Adversarial test: create a partial/promisor repository whose pinned tree references a missing blob, install a repository-local helper/remote sentinel, and request source production. Expected behavior is a typed `context_tree_integrity`/unavailable refusal with zero helper invocations and zero network attempts. The current Phase 83 tests use a complete local repository and an instrumented Git wrapper; they do not exercise missing promised objects or hostile local configuration.

### LB4 — `environmentDigest` does not attest the executing environment

The cell/session identity claims to bind the environment, but the digest is built from static labels plus the Git authority digest (`impl/src/context-runtime.mjs:293-311`). It omits at least:

- the Node executable bytes/version/identity used by `spawn(process.execPath, ...)`;
- `context-execution-worker.mjs` bytes;
- the imported Context evaluator/runtime code bytes;
- `sourcePolicyDigest`, including path/content filters and extractor identity.

Adversarial sequence: admit a session/cell; stop the application; change the worker/evaluator or source-exclusion constants without changing the hard-coded `repository-json-cas-v2` strings; reopen the same `application-v3` deployment root. The current deployment authority digest remains equal, so old sessions are considered current and an admitted cell may execute under changed code with the original cell identity. A Node binary replacement at the same `process.execPath` has the same problem. This contradicts CP2/CP3's exact environment identity and makes restart equivalence depend on developers remembering to bump a label (`spec/phase81-context-program-rlm.md:173-175`, `200-204`).

### LB5 — first-write CAS crash is not recoverable

`_writeArtifact` writes directly to the final digest filename with `flag: 'wx'` (`impl/src/context-program.mjs:630-659`). If the executor or host dies after creating that path but before all bytes are durable, retry sees an existing corrupt file and raises `context_artifact_integrity`. For an admitted pure cell, that becomes a deterministic failed settlement because only missing source/artifact errors are classified retryable (`impl/src/context-program.mjs:1197-1218`). The corrupt bytes were never bound by a completed ledger event, so refusing to replace them preserves neither authority nor liveness.

The same window exists when admitting a newly produced source before `context.session_admitted`. Tests cover an absent artifact after a *completed* settlement (`DC81-4`), but not a truncated unreferenced artifact between write and admission/settlement (`impl/test/phase82-context-durability-red.test.mjs:346-371`). Use temp-file write, file sync where required by the durability contract, atomic no-clobber publication, and directory sync; validate a winner after rename/link contention.

### LB6 — source provenance is durable but absent from the advertised evidence cascade

The v2 `sourceAttestations` are stored on the session and used for admission integrity, but the public Context evidence paths omit them. Session evidence returns only the manifest; completed-cell evidence returns the program and `baton.context_cell_evidence`, whose coordinates are only `{branch, sourceRef, sourceDigest, itemIndex, itemDigest}` (`impl/src/application.mjs:5668-5688`; `impl/src/context-program.mjs:945-963`). The Git root tree OID, source-policy digest, scope/proof digest, path, blob OID, and byte range remain buried in internal session state/events. Session section items expose coverage counts, not the attestation (`impl/src/application.mjs:5623-5654`).

Thus the hub can validate source provenance internally, but a caller following `outline -> index -> item -> evidence` cannot obtain the exact source-coordinate attestation promised by CP8/CP9. The smallest correction is to expose a bounded session-attestation evidence item and/or resolve cell item indices into the attested path/blob/byte coordinates at evidence depth—without placing host paths or mutable filenames into authority.

## Restart and abort assessment

- **Completed cell restart: pass, conditional on intact CAS and unchanged under-attested environment.** The ledger replays the completed identity and artifacts; `CR83-1` reopens a stopped deployment and reads the same output (`impl/test/phase83-context-runtime-red.test.mjs:551-611`).
- **Admitted cell restart: only demand-driven, not reconciled.** `pendingContextCells()` reconstructs the admission (`impl/src/coordination-store.mjs:5375-5381`), and reissuing the identical Context action reaches the same admission/program identity. Application readiness has no pending-Context reconciliation stage (`impl/src/application.mjs:1256-1264`). After an interrupted caller loses its response, Baton advertises generic Context actions but no `resume_cell` action or automatic executor reconciliation. `DC81-4` resumes by manually invoking low-level Bench/settlement methods, not by reopening the application (`impl/test/phase82-context-durability-red.test.mjs:346-360`). Decide and document one behavior: automatic re-execution for deterministic admitted cells, or an advertised coordinate-free resume action. Either must be serialized with stop/shutdown and LB1 process reconciliation.
- **Abort disposition: correct for same-incarnation lifecycle cancellation.** Leaving the cell admitted avoids poisoning a deterministic identity (`impl/src/context-program.mjs:1197-1202`). It becomes unsafe only because physical execution ownership and subsequent reconciliation are not durable.
- **Late result fence: pass logically.** Stop changes the cell version/state before cancellation, and settlement requires an admitted v1 cell plus an open/current Run (`impl/src/coordination-store.mjs:4227-4312`). A late child result cannot attach after the stop admission.

## Exact route and Layer C boundary

There is no implemented Context provider route to audit. `normalizeContextProgram` accepts `map`, `reduce`, `review`, and `verify`, but pure-cell admission rejects those effects and Bench refuses to execute them (`impl/src/context-program.mjs:408-425`, `894-899`; `impl/src/coordination-store.mjs:5617-5624`). The client rejects any Workflow strategy other than `parallel_attempts:isolated:operator_selected`, so `context_recursive` cannot be started (`impl/src/application-client.mjs:91-113`). There is no call batch, WorkItem/Wave compiler, child attachment, synthesis/review Candidate, or CP6 terminal-disposition projection.

The ordinary Workflow path still binds each role to one exact `{harness, model, effort}` tuple in the approved Plan/definition, and Context `run.act` accepts only a role—not route axes. That is the right non-substitution property for the current pure layer. However, Phase 83 tests use the same single Codex tuple for both roles and never attempt a model-authored override (`impl/test/phase83-context-runtime-red.test.mjs:22`, `99-113`, `551-570`). They prove no future `map` routing behavior.

The checked-in Phase 83 dogfood script requested exact `codex/gpt-5.6-sol@high` for `codex-lifecycle-auditor` and `codex/gpt-5.6-sol@xhigh` for `codex-provenance-adversary` (`docs/reference/evidence/phase83-owned-context-dogfood-live-2026-07-18/run.mjs:17-19`, `60-65`). Its checked-in `evidence.json` has `record: null` and no stopped receipt (`docs/reference/evidence/phase83-owned-context-dogfood-live-2026-07-18/evidence.json:1-12`), so it is not evidence of resolved/observed route truth or successful verification. Do not infer an observed model/effort from the requested tuple.

The following are later Layer C work and should not be mixed into the launch-blocker patch:

- the `context_recursive` strategy and separately approved successor Plan;
- partition-to-WorkItem/overlapping-Wave compilation;
- exact role-map route resolution and override refusal before provider effect;
- private worktrees for coding children and checkout-free analysis children;
- durable call batches, child generation/result attachment, reduce/review Candidates, and deterministic verify gates;
- CP6 typed progress/termination, call views, and late/duplicate child evidence;
- Atlas/Scratch/Cairn/candidate/feedback/verification branches, cross-tree labeling, explicit knowledge publication, contradiction-preserving Cairn promotion, and knowledge-graph projections;
- four-arm utility evaluation and any recursion deeper than one.

Likewise, the broader pure AST already normalizes more operations than the Run facade advertises. Exposing slice/filter/project/sort/unique/join/collect/finish, richer coverage states, and `calls()` can follow the ownership/provenance fixes; current AX is narrow but honest.

The implementation checkpoint at `spec/phase81-context-program-rlm.md:416-447` is now stale: it says durable admission, producer, stop extension, and transport integration are absent even though much of that Layer B exists. Update it only after the launch blockers are resolved and verified, preserving an explicit distinction between architectural wiring and tested transport parity.

## Smallest dependency-ordered next patch/test sequence

1. **Close source-side credential and Git effects first.** Add table-driven allowed-path fixtures for prefixed keys (`ANTHROPIC_API_KEY`, `service_token`, `AWS_SECRET_ACCESS_KEY`, mixed JSON/YAML/TS forms) and assert no source/artifact contains their sentinel. Add a partial/promisor hostile-local-config test that proves source extraction invokes no helper/network and fails typed/bounded. Then harden the shared scanner and Git environment (`GIT_NO_LAZY_FETCH`, bounded subprocess timeout, explicit local-config policy). Bind the resulting extractor policy into deployment/environment authority.
2. **Attest the execution package.** Define one canonical execution-authority record covering Node executable identity, worker bytes, evaluator dependency bytes/version, Git authority, execution protocol, and `sourcePolicyDigest`; derive `environmentDigest` from it and persist it in session deployment authority. Add restart tests where each component changes independently: old completed cells remain historical/readable, while pending/new execution under the old identity is refused and a new session/cell identity is required.
3. **Make CAS publication crash-safe.** Replace direct final-name writes with atomic content-addressed publication. Add kill/fault-injection tests at create/write/sync/publish boundaries for both source-before-session and output/evidence-before-settlement. An unreferenced partial must be recoverable; a completed referenced artifact must remain immutable and corruption must stay typed.
4. **Add durable Context execution ownership before extending features.** Introduce an execution admission/generation and authenticated start handshake before work begins, persist process start/settlement/reap evidence, and make the worker self-terminate on lost ownership. Reuse the existing process-lifecycle conventions rather than inventing a second weaker PID scheme. Run stop must snapshot execution generations/process identities in addition to sessions/cells, fence first, cancel/TERM, escalate KILL, confirm every direct child and descendant group extinct, and only then append a receipt whose Context process counts/digest are independently reconstructable.
5. **Test the actual crash window.** Start a fixture Context executor that blocks with a live descendant, wait until its durable process-start record, `SIGKILL` the application host, reopen the deployment, then exercise both Run-stop reconciliation and deployment close. Assert the original authenticated PGID/descendant is gone, no PID-reuse-unsafe signal is sent, the admitted cell is stopped or safely resumable according to policy, and the receipt cannot be forged from logical session/cell state alone. Repeat crashes before handshake, after posted result, and during TERM-to-KILL escalation.
6. **Choose and test pending-cell recovery.** After steps 2-5, add startup reconciliation or one advertised coordinate-free resume action for admitted deterministic cells. Test restart after cell admission, after output artifact publication, and before settlement; all must converge to one cell/output identity and no overlapping physical execution generation. Concurrent resume, stop, and shutdown must have a deterministic winner.
7. **Expose provenance through AX and then test transport parity.** Add bounded source-attestation/path-blob-byte evidence at session/cell evidence depth. Execute the same advertised Context action through direct client, generic CLI `run.do`, authenticated Web/browser, and MCP; compare semantic digest, cell/result identity, exact evidence, replay behavior, and cleanup truth. Keep the wire command set at the existing five operations.
8. **Only then begin Layer C.** Start with one adversarial `map` compiler test that proves a caller/program can supply only an approved role, while harness/model/effort are resolved from the exact approved role map. Ship call-batch durability, child generation fences, restart ambiguity handling, and stop/reap in the same slice before adding reduce/review/verify or knowledge promotion.

This order keeps the first patches small and foundational: make reads safe, make identity exact, make bytes crash-safe, then make physical ownership durable. Provider-backed recursion should not be built atop a cleanup receipt that can currently lose a detached Context process across restart.
