# Issue #99 — The result-materialization accessor: `run.result` / `waves.harvest` (v1.0)

- **Issue:** #99 — `run.result` / `waves.harvest`, the harvest/result-materialization accessor
- **Date:** 2026-08-06
- **Status:** DRAFT v1.0 — implementation contract
- **Frame:** the frontier-sweep orchestrator friction ledger, design level
  (`docs/reference/evidence/frontier-sweep-2026-08-03/orchestrator-friction-ledger.md:11`):
  "Harvest-by-hand: pin-parent trap (fake 6117-line deletion diff), git apply + three-way merge
  surgery per wave."
- **Surface-style precedent:** the #87+#48 facade-projection contract v2.2
  (`docs/reference/evidence/facade-projection-2026-08-03/facade-projection-contract.md`). Its
  direct-port idiom, MCP/CLI projection shapes, refusal vocabulary, and red-first row form are
  the model this contract follows; its v2.2 fold note (`:40-52`) records the fold discipline
  (amend the contract, keep the suite's exact asserts).

Citation discipline: `impl/src/application.mjs`, `impl/src/coordinator.mjs`, and
`impl/src/coordination-store.mjs` contain NUL bytes. They were inspected with NUL-safe
`grep -an` + targeted `sed -n` only — never opened whole. **Every file:line citation below was
re-verified THIS SESSION (2026-08-06) against this worktree; a wrong citation is an automatic
red-team blocker.**

**Campaign law (binding).** Controls in this contract are eval-able, constructive, or
conversational — NEVER clocks or turn-limits. Count-based bounds (path counts, file counts,
conflict-entry counts) and event-vocabulary liveness (`result_ready`, `applied-clean` /
`conflicted` / `skipped`, `harvest_conflict`) are the only control shapes. Scanners stay
shape-only. `localeCompare` is BANNED — sorts are byte-wise (`Buffer.compare` / default
`<.sort()`, the `result-export.mjs:496`/`:726` precedent). Sorted-key closed-shape literals
appear in ACTUAL sorted order. Byte caps name cap+actual and prefer graceful spillover (the
#89 doctrine, `application.mjs:231-234`).

---

## Code-verified ground truth

1. **The result-pin namespace is Baton-protected, content-addressed, and physically
   verifiable.** `coordination-store.mjs:356` defines the ref law —
   `function retainedResultRef(sha) { return `refs/baton/results/${sha}`; }`.
   `index.mjs:837-840` `retainResult` writes `refs/baton/results/<sha>` via `git update-ref`
   (`:839`) and returns the ref. `index.mjs:842-847` `resolveResult` enforces the ownership
   regex `^refs/baton/results/[a-f0-9]{40,64}$` (`:842`), resolves `${ref}^{commit}` (`:845`),
   and returns `null` when the pin is physically missing (`:846`). `coordinator.mjs:6070-6081`
   `_pinAcceptedResult` records `task.retainedResultRef` (`:6080`) and returns
   `{sha, ref, state: 'pinned'}` (`:6081`); `coordinator.mjs:6085-6098`
   `inspectPreservedResult` re-verifies the physical ref and returns `state ∈ {pinned, missing,
   mismatch, unverifiable, unavailable}` (`:6093-6097`) — the "missing" state IS a deleted pin.

2. **A result pin is a commit whose parent is the capture base — the delta's honest base is the
   pin's OWN parent, never HEAD.** `worktree.mjs:1191-1240` `captureCommit` commits the worker's
   tree in its owned worktree at `meta.baseSha` (`:1235`, commit on top of the base) and computes
   the changed paths against that same base (`:1236`, `changedPathsFromBase(dir, meta.baseSha)`).
   So `git rev-parse ${resultSha}^` equals the recorded capture base. The coordinator records the
   same coordinate as `task.sessionContext.baseSha` and reads deltas through it
   (`coordinator.mjs:4820-4828`: `inspectCapturedChanges` requires
   `task.sessionContext.baseSha` then `changedPathsAtCommit(baseSha, expectedSha, maxPaths)`).
   The ledger's two trap hits (`orchestrator-friction-ledger.md:11`) — a fake 6117-line deletion
   diff — are precisely a HEAD-vs-pin diff where HEAD is foreign to the fork point.

3. **The changed-path projection is a bounded, sorted git diff.** `index.mjs:772-783`
   `changedPathsAtCommit(baseSha, resultSha, maxPaths)`: `git diff --name-only -z baseSha
   resultSha` (`:781`), `boundedRepoPath` filter (`:239`), dedup + sort + `maxPaths` ceiling
   (`:783`, refusing `captured_change_oversize`). `worktree.mjs:936-946` `changedPathsFromBase`
   is the worker-side equivalent (cached + untracked union, sorted). This is the projection a
   result accessor needs verbatim.

4. **The `run.inspect` result section carries the accepted sha, and the `waves.attach` harvest
   reads exactly that.** `application.mjs:11364-11370`: the facade's attach-harvest inspects
   `{runId, depth: 'section', section: 'result'}` (`:11366`) and reads
   `section?.section?.items?.[0]?.value.sha` (`:11368-11370`). The run view's result block
   (`view.result.sha`, `view.result.preservation`, commit/verification artifacts) feeds
   `_semanticTarget` at `application.mjs:3733-3752` and the run-evidence manifest's checks
   (`application.mjs:4907-4909`). The wave driver's `materialize` reads the same section first,
   then falls back to pin disambiguation (`wave.mjs:390-406`, `:397` RESULT_SHA test).

5. **The facade direct-port idiom is established and pinned.** `application.mjs:12164` is the
   `async command(...)` entry; the dispatch-alias rewrite fires ONLY for keys present in
   `APPLICATION_DISPATCH_ALIASES` (`:12170-12175`); the direct ports dispatch BEFORE
   `validateApplicationCommandArgs` and the recursive-session gate (`:12184-12223`). The wave
   ergonomics ports are `waves.start`/`waves.progress`/`waves.send`/`waves.stop`
   (`:12219-12222`), `waves.attach` (`:12311`). `APPLICATION_COMMAND_DEFINITIONS`
   (`application.mjs:152`) is byte-stable — grammar-m3 pins its key set — so the new commands
   must be direct ports, not table entries. `startWave` (`:11437-11475`) returns the detached
   `{schemaVersion: 1, waveId, members}` shape; `waveProgress` (`:11477-11513`) pages ≤16 with
   `{cursor, nextCursor}`; `sendWaveMember` (`:11516`) is per-member.

6. **Three-way conflict resolution already exists (Phase 26 SM1-SM9).**
   `worktree.mjs:1262-1336` `stageStructuredIntegration` requires a clean target
   (`structured_main_dirty`, `:1265`), refuses an already-contained result
   (`structured_already_integrated`, `:1270`), computes the three-way merge-base
   (`:1272`), merges with `merge.conflictStyle=diff3` (`:1280`), isolates each conflicted file
   to a deployment-injected resolver (`:1301`), refuses binary conflicts / oversize files /
   remaining markers (`:1295`, `:1296`, `:1312`), and returns structured `classes` /
   `resolutions` (`:1284`, `:1308`). `worktree.mjs:1337-1352` `finalizeStructuredIntegration`
   fast-forwards only after re-verifying onto HEAD hasn't advanced (`:1340`) and the merge
   parents are exact (`:1342`).

7. **Path-safety and result-tree inventory laws already exist.** `result-export.mjs:431-442`
   `decodePath` (valid UTF-8, no absolute/backslash/`.`/`..`/`.git` segments, ≤4,096 bytes);
   `result-export.mjs:444-500` `inventory` — regular `100644`/`100755` blobs only (`:464`),
   file/byte ceilings (`:452`, `:486`), collision detection (`:477-482`), sorted by byte-wise
   `Buffer.compare` (`:496`). The inventory row shape is exactly `{path, mode, blob, digest,
   size}` (+ `bytes`) at `:494`.

8. **A canonical retained-result projection shape exists.** `context-result.mjs:129-136`
   `projectionCore` + `context-result.mjs:204-217` `contextRetainedCommitProjection` —
   `{kind: 'retained_commit_projection', baseSha, resultSha, retainedResultRef, changedPaths,
   pathScope, pathScopeDigest, sourcePolicyDigest, resultSourceDigest, projectionDigest}` — with
   `changedPaths` canonical (sorted, unique, 1..100_000, `:148-153`), `baseSha ≠ resultSha`,
   and `retainedResultRef === refs/baton/results/${resultSha}` (`:141-144`).

9. **The MCP wave-tools envelope and the CLI verb idiom exist.** `mcp-northbound.mjs:456-532`
   defines `baton_waves_attach`/`start`/`progress`/`send`/`stop` with closed `schema()`
   schemas (`additionalProperties: false`, `:267-268`), `_meta` registry-digest stamp
   (`:641`), capability registrations (`:97-100`), and per-tool `invalid_*` guards
   (`:1104-1160`).
   `application-cli.mjs:1308-1350` is `baton waves attach WAVE_ID --members JSON`
   (`:1308-1315`, plural spelling enforced). `application-semantics.mjs:1540-1615` holds the
   `waves.*` registry rows (`profile: 'ordinary'`, wave-rows shape). `mcp-descriptor.mjs:148`
   is the card: `[...Object.keys(APPLICATION_COMMAND_DEFINITIONS), 'waves.attach']`.

10. **`baton run result RUN_ID` is an OCCUPIED CLI spelling for the episode's result chapter —
    the new lane is `run.result` at the facade but NOT at the CLI.** `application-cli.mjs:1510-1520`
    parses `action === 'result'` as the episode result-chapter read
    (`topic = 'result'`, `buildEpisodeCommand`, `:1516-1520`); `application-semantics.mjs:860`
    is the cliCommands row `['run.result', 'run.episode', null, 'baton run result RUN_ID …']`.
    `run.result` is NOT a key of `OPERATION_ALIASES` (`application-semantics.mjs:735-827`), so
    it is NOT in `APPLICATION_DISPATCH_ALIASES` (`application.mjs:150`,
    `application-semantics.mjs:2129-2133`) — the embedded `application.command('run.result', …)`
    name and the MCP `baton_run_result` name are FREE; only the CLI spelling collides.

11. **#89's cap+actual doctrine is the established oversize idiom.** `application.mjs:231-234`
    `coachingApplicationError(row, actual, cap)` composes a refusal that names BOTH numbers and
    a `gracefulPath`; `limits.mjs:57` is the `wave.member.objective` FRAME_LIMITS row
    (`value: 4096`, `graceful: 'spill-digest-citation'`).

12. **The pin's preservation and the result section are durable, non-evented reads.** The
    `waves.attach` harvest outcome carries `resultSha` with a try/catch empty-section guard
    (`application.mjs:11364-11372`), and the wave driver's settle outcome carries `resultSha`
    through `materialize` (`wave.mjs:427-445`). An empty result section mid-flight is honest
    (`result_not_ready`), never fabricated.

---

## Decisions

### 1. `run.result(runId)` — the parent-verified result projection (facade lane)

**Surface.** Embedded facade direct port `application.command('run.result', {runId}, principal,
context)`, dispatched with the wave-ports idiom ahead of `validateApplicationCommandArgs` and
the recursive-session gate (`application.mjs:12184-12223`). The name `run.result` is per the
issue and is dispatch-free at the facade (ground truth 10); the CLI spelling collision is
resolved in Decision 5.

**Shapes.** Args are closed `{runId}` (`validId`, `application.mjs:300`). The return is a
closed shape with the issue's five fields — sorted-key literal in ACTUAL sorted order:
`['baseSha', 'changedFiles', 'changedPaths', 'ready', 'resultSha']`.

- `ready: boolean` — a preserved, resolvable result exists for the run.
- `resultSha` — the accepted pin sha, `/^[a-f0-9]{40,64}$/` (the `RESULT_SHA` shape,
  `wave.mjs:18`).
- `baseSha` — the pin's OWN parent, resolved by the accessor (worktrees `resolveResult`
  + `git rev-parse ${sha}^`), cross-checked against `task.sessionContext.baseSha` when the task
  is reachable (`coordinator.mjs:4820-4828`). **Never HEAD.**
- `changedPaths` — sorted-unique paths from `changedPathsAtCommit(baseSha, resultSha, maxPaths)`
  (`index.mjs:772-783`), `maxPaths` default 1_024, ceiling 100_000.
- `changedFiles` — bounded inventory rows for exactly `changedPaths`, each
  `{blob, digest, mode, path, size}` (the inventory row minus inline `bytes`,
  `result-export.mjs:494`), sorted byte-wise by path. Serialized total ≤ 256 KiB; an oversize
  page truncates with `truncated: true`, a `changedFilesDigest` over the FULL entry set, and a
  continuing `cursor` (Decision 6).

**Resolution path.** runId → run view result block (`view.result.sha` / `view.result.preservation`,
`application.mjs:3733-3752`, `:4907-4909`) → task via `view.nodes[0].taskId` → `task.assignee`
→ `coordinator.inspectPreservedResult` (`coordinator.mjs:6085-6098`) → worktrees
`resolveResult` (`index.mjs:842-847`).

**Refusal vocabulary.** `application_run_result_invalid` (closed-shape, thrown BEFORE any state
lookup); `application_unauthorized` (host-policy, constant for unknown ≡ foreign); `result_not_ready`
(no preserved result: run non-terminal, task not `completed`, no `retainedResultRef`, or
`inspectPreservedResult` state `unavailable`); `pin_not_found` (`retainedResultRef` present but
`resolveResult` returns `null` — the `missing` state); `result_ref_invalid` (defense-in-depth,
the ownership regex at `index.mjs:842` — unreachable through the closed shape).

**Rationale.** The orchestrator needs the parent-verified delta — sha, base, and the bounded
file projection — without hand-running `git diff` against a guessed base. The shape is exactly
the issue's; the base law (Decision 3) makes the projection HEAD-independent.

### 2. `waves.harvest(resultSha | runId, {onto})` — parent-verified delta applied with three-way conflict resolution

**Surface.** Embedded facade direct port `application.command('waves.harvest', args, principal,
context)`, dispatched with the wave-ports idiom.

**Shapes.** Args are closed — sorted-key literal in ACTUAL sorted order: `['onto', 'resultSha',
'runId']` — with EXACTLY ONE of `resultSha` (`/^[a-f0-9]{40,64}$/`) or `runId` (`validId`), and
optional `onto` (string path; default = the deployment's main checkout HEAD).

**Source resolution.** `runId` → the result-section read (`application.mjs:11364-11370`
attach-harvest idiom); when the section is empty, a wave member may fall back to the wave
driver's `resolveResultPin` (`wave.mjs:134-155`, git-path-existence disambiguation, never
newest-pin guessing). `resultSha` → `resolveResult` (`index.mjs:842-847`).

**Delta law.** `baseSha` = the pin's OWN parent; `changedPaths` = `changedPathsAtCommit(baseSha,
resultSha)` (Decision 3). `onto` is the three-way merge's TARGET side, never the diff base.

**Apply.** Three-way merge via the structured-integration engine (`worktree.mjs:1262-1336`):
engine computes `merge-base(beforeSha, rightSha)` (`:1272`), merges with diff3 conflict style
(`:1280`), isolates conflicts to the resolver (`:1301`), refuses unresolved markers
(`:1312`), and commits the exact-parent merge (`:1324`, parents verified `:1328`).
`finalizeStructuredIntegration` (`:1337-1352`) fast-forwards only after verifying onto HEAD
hasn't advanced (`:1340`) and the merge parents are exact (`:1342`).

**Structured receipt** (return, closed core — sorted-key literal in ACTUAL sorted order):
`['baseSha', 'changedPaths', 'conflicts', 'ok', 'reason', 'result', 'resultSha']` with
outcome-conditioned extras.

- `result: 'applied-clean'` — merge clean; receipt carries `afterSha` (the stage commit sha) and
  `classes: ['clean_textual']`; onto HEAD = `afterSha` post-finalize.
- `result: 'conflicted'` — conflicts; receipt carries `conflicts: [{class, path}]` (sorted by
  path, byte-wise) and `stagePath` (the isolated stage, or null when cleaned); nothing
  finalizes.
- `result: 'skipped'` — result already contained by onto (the engine's
  `structured_already_integrated`, `worktree.mjs:1270`) or an empty delta; `reason:
  'already_integrated' | 'empty_delta'`.

`reason` is null except for `skipped`; `conflicts` is `[]` except for `conflicted`.

**Refusal vocabulary.** `application_waves_harvest_invalid` (closed-shape: ambiguous/absent
source, malformed `onto`); `application_unauthorized` (host policy); `result_not_ready` (no
preserved result); `pin_not_found` (pin ref unresolvable); `harvest_conflict` — thrown with the
conflict list when the merge leaves conflicts under a strict policy, and the wire projections
map a `conflicted` receipt to this code (Decision 4) — never `command_outcome_unknown`;
`harvest_onto_dirty` (onto not clean — the engine's `structured_main_dirty`,
`worktree.mjs:1265`); `harvest_onto_invalid` (onto path not the main checkout / not an owned
worktree).

**Rationale.** Reuses the proven structured-merge engine rather than inventing hand-rolled
`git apply` surgery — the ledger's "git apply + three-way merge surgery per wave"
(`orchestrator-friction-ledger.md:11`) becomes one command. The receipt is the eval-able
artifact (result class + conflict list), never a duration or turn count.

### 3. The stale-base law — the accessor OWNS the pin-parent diff (construction-level)

Both lanes derive `baseSha` from the pin itself (`git rev-parse ${sha}^`) and cross-check
`task.sessionContext.baseSha` when the task is reachable; `changedPaths` is always
`changedPathsAtCommit(baseSha, resultSha)`. **The accessor never accepts a caller-supplied base,
and a caller-supplied `onto` never becomes the diff base** — it becomes only the three-way
merge's target side. The accessor MUST NOT expose a HEAD-based diff in any projection.

**Rationale.** The two trap hits in the ledger are exactly a HEAD-vs-pin diff where HEAD is
foreign to the fork point. Content-addressing the delta against the pin's parent makes the delta
HEAD-independent and the apply correct by construction — this is the engineering-out the issue
demands, and it is a property of the accessor, not a caller-behavior requirement.

### 4. MCP projections per the #87 idiom

Two NEW ordinary-surface tools join `ORDINARY_APPLICATION_TOOL_DEFINITIONS` — closed `schema()`
schemas (`additionalProperties: false`, `mcp-northbound.mjs:267-268`), `_meta` registry-digest
stamp (`:641`), `CAPABILITY` registration (`:78`), a hand-rolled `invalid_*` shape guard
(`:1104-1160`), an explicit `_dispatch` branch calling `application.command(<name>, …)` with the
CONNECTION-derived principal (`:1771`), and `ORDINARY_EXPLICIT_TOOLS` membership
(`:780`):

| MCP tool | Facade command | Capabilities | Annotations |
| --- | --- | --- | --- |
| `baton_run_result` | `run.result` | `['observe']` | read-only, idempotent |
| `baton_waves_harvest` | `waves.harvest` | `['control', 'observe']` | effectful, idempotent via server-derived stage |

Schemas mirror the facade shapes plus `repoId`: `{repoId, runId}` for `baton_run_result`;
`{onto?, repoId, resultSha?, runId?}` with the XOR for `baton_waves_harvest` (sorted-key
literal in ACTUAL sorted order). None carries a wire `idempotencyKey`; none joins
`STATEFUL`/`RECONCILABLE` (`mcp-northbound.mjs:125`, `:138`) — replay safety lives server-side
in the deterministic pin/stage identity.

**Refusal constancy to the wire.** `stateFailureCode` (`mcp-northbound.mjs:198-260`) gains
`result_not_ready`, `pin_not_found`, `harvest_conflict` (with the conflict list),
`harvest_onto_dirty`, `harvest_onto_invalid` — none may degrade to `command_outcome_unknown`
(`:260`) or `invalid_command` (`:258`). The facade `application_*` codes already pass through
(`:203`).

**Rationale.** Mirrors the wave-tools projection one-for-one (facade-projection contract Decision
10) so the MCP-first orchestrator reaches the materialization lanes with the envelope shape it
already speaks.

### 5. CLI verbs + registry rows + the conformance regeneration step

**CLI verbs** (the `application-cli.mjs` idiom, `:1308-1350` for the waves pattern; parse
results `{kind: 'command', name, args, idempotencyKey}`):

- `baton run result-pin RUN_ID` — **the naming-collision resolution (ground truth 10):**
  `baton run result RUN_ID` is the OCCUPIED episode result-chapter spelling
  (`application-cli.mjs:1515-1520`; `application-semantics.mjs:860`), so the materialization
  read lands as a DISTINCT spelling whose parse-result is `{kind: 'command', name: 'run.result',
  args: {runId}}`. The two `run result*` spellings coexist with different arg shapes and
  different parse-result kinds — the `run.send` legacy-alias coexistence precedent
  (facade-projection contract Decision 11). The episode spelling is untouched.
- `baton waves harvest RESULT_SHA|RUN_ID [--onto PATH]` — parse-result `{kind: 'command', name:
  'waves.harvest', args}`, `runId` XOR `resultSha` enforced at parse.

`CLI_WEB_COMMANDS` gains `run.result` and `waves.harvest` (the dispatch gate,
`application-cli.mjs:16`). Two registry rows join `CANONICAL_OPERATION_SPECS` in the wave-rows
shape (`application-semantics.mjs:1540-1615`): `profile: 'ordinary'`; `surfaces: ['embedded',
'mcp', 'cli']`; capabilities `['observe']` (`run.result`) / `['control', 'observe']`
(`waves.harvest`); `idempotent: true`; closed `inputSchema`s matching Decisions 1-2; the
examples above.

**Conformance regeneration is MANDATORY and ordered** (facade-projection contract Decision 11):
1. `node impl/scripts/render-surface-docs.mjs` — rewrites the CLI.md/MCP.md generated inventory
   blocks in place.
2. `node impl/scripts/surface-conformance.mjs --write-inventory` — regenerates the CS-4 checked
   artifact (counts change: canonicalOperations +2, cliWebCommands +2, mcpApplicationTools +2).
3. Verify: `node impl/scripts/render-surface-docs.mjs --check` clean,
   `node impl/scripts/surface-conformance.mjs` prints `surface-conformance: ok`, and the three
   pinning suites stay green.

**Rationale.** The inventory blocks are executable projections of the served surface, not prose;
landing tools without regenerating them fails the committed-block pins by construction.

### 6. Bounds, byte caps, and the complete refusal vocabulary (#89 doctrine)

**Bounds (count-based only — no clocks, no turn-limits).**
- `run.result.changedPaths`: default `maxPaths` 1_024, ceiling 100_000 (inherited from
  `changedPathsAtCommit`, `index.mjs:772-783`).
- `run.result.changedFiles`: serialized total ≤ 256 KiB; an oversize page truncates with
  `truncated: true`, `changedFilesDigest` over the FULL entry set, and a continuing `cursor` —
  graceful spillover (the #89 doctrine, `application.mjs:231-234`, `limits.mjs:57`).
  Per-file: `size` ≤ 4 GiB blob ceiling (inherited from inventory, `result-export.mjs:486`),
  path ≤ 4,096 bytes (the `safePath` law, `context-result.mjs:91-98`).
- `waves.harvest` conflict list: ≤ 1_024 entries, each path ≤ 4,096 bytes, serialized listing
  ≤ 256 KiB with the same digest-citation spill.
- `waves.harvest` apply: inherits the structured-merge file/byte ceilings
  (`structured_file_too_large`, `worktree.mjs:1296`).

**Refusal vocabulary (complete, per surface).** The ONLY codes are the ones enumerated in
Decisions 1-2 and 4 — no invented distinct codes (the blue-team D3 law,
`facade-projection-contract.md:50-52`). The wire projections map the conflicted receipt to
`harvest_conflict` (never a degraded code); the CLI parse failures keep the
`cli_invalid`/`cli_command_unavailable` vocabulary (`application-cli.mjs:48`, `:1944`).

**Rationale.** Every cap is a count or a byte ceiling with cap+actual naming and a graceful
spillover path; the acceptance suite pins these shapes, never durations or turn counts.

---

## Non-goals

- No changes to the kernel result-preservation lane (`coordinator.mjs:6053-6098`:
  `preserveResult` / `_pinAcceptedResult` / `inspectPreservedResult`), the `captureCommit`
  baseSha semantics (`worktree.mjs:1191-1240`), or the structured-integration engine's
  conflict-resolution protocol (`worktree.mjs:1262-1352`).
- No changes to `APPLICATION_COMMAND_DEFINITIONS` (byte-stable, grammar-m3 pin). `run.result`
  and `waves.harvest` are direct ports only.
- No change to the `waves.attach` harvest loop's behavior (`application.mjs:11340-11390` stays;
  `waves.harvest` is additive, not a replacement).
- No new integration strategy, no remote publication, no auto-push; `finalizeStructuredIntegration`
  stays the ONLY fast-forward authority.
- No REPL binding surface, no worker-side changes, no provider changes, no mid-flight result
  projection beyond the existing result section.
- No `localeCompare` anywhere in the new modules; no new clocks, sleeps, or turn-limits.
- No implementation edits in this contract-authoring epic; the red-first suite is a subsequent
  rung.

---

## Red-first acceptance

Implementation begins with a focused red suite (suggested home:
`impl/test/harvest-accessor-red.test.mjs`) whose positive rows fail against the current
facade/MCP/CLI (the commands and tools do not exist today — ground truths 5, 9, 10). Existing
suites remain unchanged and green; no existing assertion is weakened. Facade rows drive
`application.command(name, args, principal, context)` (`application.mjs:12164`) with the
established `authorize: async () => true` stub (`impl/test/mcp-packaging-red.test.mjs:556`
idiom) and a policy stub refusing named runs for the constancy rows. The pin groups a suite
must carry:

| ID | Red state to prove first | Green acceptance oracle |
| --- | --- | --- |
| HA-01 | The two commands do not dispatch. | `run.result` and `waves.harvest` dispatch through `application.command`; extra/missing fields, ambiguous harvest sources (both/neither of `resultSha`/`runId`), and malformed ids/`onto` refuse the pinned `application_run_result_invalid` / `application_waves_harvest_invalid` codes BEFORE any state lookup; no bare TypeError reaches the caller. |
| HA-02 | The stale-base trap could survive. | **THE STALE-BASE ROW.** A fixture where main's HEAD has DIVERGED from the pin's parent (the ledger's trap shape): `run.result` returns `baseSha === git rev-parse ${resultSha}^` and `changedPaths` deep-equal `git diff --name-only -z baseSha resultSha` — NEVER the HEAD-based diff. A static, shape-only assertion pins the accessor derives the base from the pin (no caller-supplied base reach, no HEAD base). |
| HA-03 | The projection could re-shape the delta. | For one accepted, preserved result: `ready: true`, `resultSha` matches, `baseSha` is 40-hex and `≠ resultSha`, `changedPaths` sorted-unique and equal to the `changedPathsAtCommit` output, `changedFiles` rows `{blob, digest, mode, path, size}` EXACTLY covering `changedPaths` with byte-wise path sort; at-cap serialized page admitted, cap+1 truncated with `truncated: true`, `changedFilesDigest` over the full set, and a continuing `cursor`. |
| HA-04 | Not-ready and missing could degrade or leak. | A mid-flight or failed run returns `result_not_ready` (never a partial view, never a fabricated sha); a run whose pin was released (`releaseResult`, `index.mjs:864-866`) returns `pin_not_found`; a foreign/unknown run ≡ `application_unauthorized`. |
| HA-05 | Harvest could apply the wrong delta or half-apply. | A wave whose result's delta is applied onto main with no divergent edits returns `applied-clean` with `afterSha` = the structured stage commit and `classes: ['clean_textual']`; main ends at `afterSha`; post-harvest `git status` is clean. |
| HA-06 | Three-way preservation could regress to overwrite. | Divergent edits on main in a file the pin did NOT touch SURVIVE the harvest (three-way, not overwrite); divergent edits in a file the pin DID touch produce a `conflicted` receipt (or `harvest_conflict` under strict policy) whose conflict list names EXACTLY those paths, with no half-applied state and no fast-forward. |
| HA-07 | Already-contained and empty deltas could fail loudly. | A result already contained by onto → `skipped` with `reason: 'already_integrated'`; an empty delta → `skipped` with `reason: 'empty_delta'`; both are receipts, not refusals. |
| HA-08 | Refusals could degrade at the wire. | Through a descriptor-driven `McpFleetServer`: `baton_run_result`/`baton_waves_harvest` appear in `mcpApplicationToolNames()` with `additionalProperties: false` schemas, the pinned capability classes, `invalid_*` guards, and no wire `idempotencyKey`; `result_not_ready`, `pin_not_found`, and `harvest_conflict` (with its conflict list) surface AS THEMSELVES — never `command_outcome_unknown`, never `invalid_command`. |
| HA-09 | Docs could drift from the served surface. | CLI rows: the two spellings parse to the pinned `{kind: 'command', name, args}` dispatches; `baton run result RUN_ID` STILL parses to the episode result-chapter read (the occupied spelling is untouched); after the Decision 5 regeneration, `checkSurfaceDocs() === []`, `node impl/scripts/surface-conformance.mjs` prints `surface-conformance: ok`, and the three pinning suites stay green. |
| HA-10 | Static laws could silently break. | `Object.keys(APPLICATION_COMMAND_DEFINITIONS)` unchanged (grammar-m3 green); the new modules contain no `localeCompare` and no clock/turn-limit control (count-based bounds and event-vocabulary liveness only); sorted-key closed-shape literals appear in ACTUAL sorted order; the kernel diff touches ONLY the two direct ports and their projections (no kernel-lane changes). |

The end-to-end oracles (HA-02, HA-05…HA-07) key on durable ids, shas, codes, and state
predicates (`result_ready`, `applied-clean`/`conflicted`/`skipped`, `harvest_conflict`, git
status) — never sleep duration, turn count, or polling cadence (the campaign control law).

---

## Open questions

1. **`changedFiles` payload richness.** v1 projects the inventory row `{blob, digest, mode,
   path, size}` WITHOUT inline bytes (readable via the existing captured-file lane,
   `coordinator.mjs:4799-4810`). If orchestrators need inline bytes, the 256 KiB serialized cap
   halves at best — a later rung may add an opt-in `withBytes` with its own cap+actual row.
2. **`onto` semantics.** v1 targets the deployment's main checkout HEAD (the structured-merge
   engine's `beforeSha`). Whether `onto` may name an arbitrary owned worktree path (the
   `validateOwnedWorktree` shape, `worktree.mjs:995`) is open; the engine's exact
   interface is pinned by the structured-integration call sites, not by this contract.
3. **Conflict auto-resolution.** The structured-merge engine's resolver is deployment-injected
   today (`worktree.mjs:1301`, marker check `:1312`). v1 reports conflicts to the orchestrator (no resolver on
   the harvest lane); a resolver-carrying variant is open.
4. **Checkpoint pins.** Inconclusive results are preserved under `refs/baton/checkpoints/*`
   (`index.mjs:849-866`) and inspected via `inspectCheckpoint` (`coordinator.mjs:6111`). v1
   exposes result pins only; checkpoint exposure is #53/#77 territory.
5. **Empty-section fallback.** For wave members whose result section is empty mid-flight,
   `waves.harvest` gets the `resolveResultPin` fallback (`wave.mjs:134-155`); `run.result`
   refuses `result_not_ready` in that case. Whether `run.result` should also take `repoRoot` +
   `report` for the pin fallback is open.
6. **The CLI naming collision.** v1 lands `baton run result-pin RUN_ID` (Decision 5) and leaves
   the episode `baton run result` spelling untouched. Whether the registry's naming epic (#9 /
   §9 M-naming) should consolidate these into one canonical `run.result` with a distinct episode
   spelling is a registry decision this contract deliberately does not spend.
7. **Recursive-session posture.** `waves.harvest` is a control lane; the #87 law places direct
   ports ahead of the recursive-session gate so a live run-orchestrator lease holder retains
   lane authority (the FP-18 shape, `facade-projection-contract.md:1240`). The acceptance should
   pin the same pre-gate dispatch for `waves.harvest` — the open question is whether the
   ORDINARY (non-lease) recursive gate should also admit it.
