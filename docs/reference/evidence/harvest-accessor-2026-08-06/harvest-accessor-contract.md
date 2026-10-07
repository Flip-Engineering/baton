# Issue #99 — The result-materialization accessor: `run.resultpin` / `waves.harvest` (v1.1)

- **Issue:** #99 — `run.result` / `waves.harvest`, the harvest/result-materialization accessor
  (the read lane lands under the canonical key `run.resultpin` — Decision 5's collision law).
- **Date:** 2026-08-06
- **Status:** DRAFT v1.1 — implementation contract (red-team fold applied)
- **Frame:** the frontier-sweep orchestrator friction ledger, design level
  (`docs/reference/evidence/frontier-sweep-2026-08-03/orchestrator-friction-ledger.md:11`):
  "Harvest-by-hand: pin-parent trap (fake 6117-line deletion diff), git apply + three-way merge
  surgery per wave."
- **Surface-style precedent:** the #87+#48 facade-projection contract v2.2
  (`docs/reference/evidence/facade-projection-2026-08-03/facade-projection-contract.md`). Its
  direct-port idiom, MCP/CLI projection shapes, refusal vocabulary, and red-first row form are
  the model this contract follows; its v2.2 fold note (`:40-52`) records the fold discipline
  (amend the contract, keep the suite's exact asserts).

**Fold note (v1.1, 2026-08-06).** Folded from the adversarial red-team report
`docs/reference/evidence/harvest-accessor-2026-08-06/contract-redteam.md` (verdict: NOT
FOLD-READY, 8 blockers). All 8 blockers are folded; every citation the report flagged was
re-verified against this worktree before amendment, and every citation the report verified
CORRECT is left byte-identical. Headline changes: the delta law's base authority is inverted
back to the RECORDED capture base `task.sessionContext.baseSha` (ground truth 2, Decision 3
rewritten); the `conflicted` receipt is descoped to a typed `harvest_conflict` refusal carrying
a probe-derived conflict list (Decision 2); a `harvest_base_diverged` precondition refusal pins
the wrong-but-applying-tree trap (Decision 2); the read lane is renamed to the collision-free
canonical key `run.resultpin` per the registry's one-derivation naming law (Decision 5);
`empty_delta` gains a machinery path (Decision 2); the refusal vocabulary is completed (seven
new codes, Decisions 1/2/6); and the acceptance suite gains the missing pins (HA-06/HA-07/HA-08
rewritten, HA-11…HA-14 added). The blocker→change map with per-blocker verification evidence is
`docs/reference/evidence/harvest-accessor-2026-08-06/contract-fold.md`.

Citation discipline: `impl/src/application.mjs` (3 NULs) and `impl/src/coordination-store.mjs`
(3 NULs) contain NUL bytes; `impl/src/coordinator.mjs` contains NONE (byte-count verified
2026-08-06 — v1.0's claim that `coordinator.mjs` is NUL-bearing was false and is corrected
here). All three were inspected with NUL-safe `grep -an` + targeted `sed -n` only — never
opened whole. **Every file:line citation below was re-verified THIS SESSION (2026-08-06)
against this worktree; a wrong citation is an automatic red-team blocker.**

**Campaign law (binding).** Controls in this contract are eval-able, constructive, or
conversational — NEVER clocks or turn-limits. Count-based bounds (path counts, file counts,
conflict-entry counts) and event-vocabulary liveness (`result_ready`, `applied-clean` /
`skipped`, `harvest_conflict`) are the only control shapes. Scanners stay shape-only.
`localeCompare` is BANNED — sorts are byte-wise (`Buffer.compare` / default `<.sort()`, the
`result-export.mjs:496`/`:726` precedent). Sorted-key closed-shape literals appear in ACTUAL
sorted order. Byte caps name cap+actual and prefer graceful spillover (the #89 doctrine,
`application.mjs:231-234`).

---

## Code-verified ground truth

1. **The result-pin namespace is Baton-protected, content-addressed, and physically
   verifiable.** `coordination-store.mjs:356` defines the ref law —
   `function retainedResultRef(sha) { return `refs/baton/results/${sha}`; }`.
   `index.mjs:837-840` `retainResult` writes `refs/baton/results/<sha>` via `git update-ref`
   (`:839`) and returns the ref. `index.mjs:842-848` `resolveResult` enforces the ownership
   regex `^refs/baton/results/[a-f0-9]{40,64}$` (`:843`), resolves `${ref}^{commit}` (`:846`),
   and returns `null` when the pin is physically missing (the `catch { return null; }` at
   `:847`). `coordinator.mjs:6070-6081` `_pinAcceptedResult` records `task.retainedResultRef`
   (`:6080`) and returns `{sha, ref, state: 'pinned'}` (`:6081`);
   `coordinator.mjs:6085-6102` `inspectPreservedResult` re-verifies the physical ref and
   returns `state ∈ {unavailable (`:6090`), unverifiable (`:6093`), pinned / missing / mismatch
   (the `:6099` ternary)}` — the "missing" state IS a deleted pin.

2. **A result pin descends from the RECORDED capture base — the honest base is the recorded
   `baseSha`, never HEAD and never the pin's own parent.** `worktree.mjs:1191-1240`
   `captureCommit` commits the worker's tree ONLY when the worktree is dirty
   (`:1206-1232`, the `if (!isClean(dir))` branch; the commit itself at `:1225`); on a clean
   tree (worker self-committed — admissible, since `validateOwnedWorktree` requires only that
   `meta.baseSha` be an ANCESTOR of the worktree HEAD, `:1006-1007`) the captured sha is the
   worker's own HEAD, whose parent is the worker's prior commit — NOT the base. A mid-task
   merge of main into the worktree diverges the same way (capture parent = the merge commit).
   Either way the changed paths are computed against `meta.baseSha` (`:1233`,
   `changedPathsFromBase(dir, meta.baseSha)`; also `:1203`, `:1215`), and the capture return
   carries `baseSha: meta.baseSha` (`:1239`). So `git rev-parse ${resultSha}^` equals the
   recorded base ONLY for snapshot captures. The recorded base is
   `task.sessionContext.baseSha`, set from the worktree-creation result
   (`coordinator.mjs:3589-3604`, `baseSha` at `:3592`), restored durably across event replay
   (`coordinator.mjs:13970-13977`), and it is what the kernel itself diffs against:
   `inspectCapturedChanges` requires `task.sessionContext.baseSha` then
   `changedPathsAtCommit(baseSha, expectedSha, maxPaths)` (`coordinator.mjs:4820-4828`). The
   ledger's two trap hits (`orchestrator-friction-ledger.md:11`) — a fake 6117-line deletion
   diff — are precisely a HEAD-vs-pin diff where HEAD is foreign to the fork point.

3. **The changed-path projection is a bounded, sorted git diff.** `index.mjs:772-783`
   `changedPathsAtCommit(baseSha, resultSha, maxPaths)`: a sha1-only shape gate
   (`/^[a-f0-9]{40}$/` on both shas plus the `maxPaths` bound, `:773-775`, refusing
   `captured_change_invalid`), `git diff --name-only -z baseSha resultSha` (`:777`),
   `boundedRepoPath` filter (`:239`), the `maxPaths` ceiling + dedup refusal (`:779-780`,
   `captured_change_oversize`), and the byte-wise sort (`:782`). `worktree.mjs:936-946`
   `changedPathsFromBase` is the worker-side equivalent (cached + untracked union, sorted).
   This is the projection a result accessor needs verbatim.

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
   parents are exact (`:1342`). **The engine's conflict report is resolver-gated:** with no
   resolver it throws `structured_tool_unavailable` (`:1287`) carrying NO conflict paths, and
   the catch block REMOVES the stage (`:1331`) — a conflict list and a surviving `stagePath`
   are unconstructible from the engine without a resolver.

7. **Path-safety and result-tree inventory laws already exist.** `result-export.mjs:431-442`
   `decodePath` (valid UTF-8, no absolute/backslash/`.`/`..`/`.git` segments, ≤4,096 bytes);
   `result-export.mjs:444-500` `inventory` — regular `100644`/`100755` blobs only (`:464`),
   file/byte ceilings (`:452`, `:486`), collision detection (`:477-482`), sorted by byte-wise
   `Buffer.compare` (`:496`). The inventory row shape is exactly `{path, mode, blob, digest,
   size}` (+ `bytes`) at `:494`. The inventory lane's sha gate is 40-or-64 hex
   (`/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/`, `:445`) — WIDER than the 40-hex-only delta lane
   (ground truth 3); the accessor pins sha1-only (Decision 6).

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
    and the registry's ONE mechanical name derivation makes the canonical key the sole source
    of every surface name.** `application-cli.mjs:1510-1520` parses `action === 'result'` as
    the episode result-chapter read (`topic = 'result'`, `buildEpisodeCommand`, `:1516-1520`);
    the cliCommands ledger row `['run.result', 'run.episode', null, 'baton run result RUN_ID
    …']` (`application-semantics.mjs:860`) and the surface alias `['run.view', 'cli', 'baton
    run result']` (`application-semantics.mjs:1807`) own the spelling. `deriveSurfaceNames`
    (`application-semantics.mjs:1123-1144`) derives `cli`/`mcp`/`web`/`embedded` names
    mechanically from the canonical key and is invoked UNCONDITIONALLY
    (`names: deriveSurfaceNames(key)`, `:1938` — no override mechanism; key parts must match
    `/^[a-z][a-z0-9_]*$/`, `:1128`, so hyphenated compounds are underivable). Evaluated this
    session: `deriveSurfaceNames('run.result').cli === 'baton run result'` — the occupied
    spelling. `run.result` is NOT a key of `OPERATION_ALIASES`
    (`application-semantics.mjs:735-827`), so it is NOT in `APPLICATION_DISPATCH_ALIASES`
    (`application.mjs:150`, `application-semantics.mjs:2129-2133`) — the embedded
    `application.command(...)` name and the MCP tool name are dispatch-free; only the CLI
    spelling collides, and it collides for ANY canonical key whose derivation produces it.

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

### 1. `run.resultpin(runId)` — the recorded-base result projection (facade lane)

**Surface.** Embedded facade direct port `application.command('run.resultpin', {runId},
principal, context)`, dispatched with the wave-ports idiom ahead of
`validateApplicationCommandArgs` and the recursive-session gate (`application.mjs:12184-12223`).
The issue names the read lane `run.result`; the canonical key is `run.resultpin` because the
registry derives every surface name mechanically from the key and `run.result`'s CLI derivation
is occupied (ground truth 10; the full collision law and the evaluated derivation are Decision
5). The name is dispatch-free at the facade either way (ground truth 10).

**Shapes.** Args are closed `{runId}` (`validId`, `application.mjs:300`). The return is a
closed shape with the issue's five fields — sorted-key literal in ACTUAL sorted order:
`['baseSha', 'changedFiles', 'changedPaths', 'ready', 'resultSha']` — plus outcome-conditioned
extras (`truncated`, `changedFilesDigest`, `cursor` on an oversize page).

- `ready: boolean` — a preserved, resolvable result exists for the run.
- `resultSha` — the accepted pin sha, `/^[a-f0-9]{40}$/`. v1 is sha1-only: the delta lane is
  40-hex-only (`index.mjs:773-775`, `worktree.mjs:333`) while the ownership regex
  (`index.mjs:843`), the wave driver's `RESULT_SHA` (`wave.mjs:18`), and the inventory lane
  (`result-export.mjs:445`) admit 64 hex — a 64-hex sha refuses at the shape gate and never
  reaches an unmapped `captured_change_invalid` (Decision 6).
- `baseSha` — the RECORDED capture base `task.sessionContext.baseSha`
  (`coordinator.mjs:3589-3604`; durable across replay, `coordinator.mjs:13970-13977`),
  consistency-checked by ancestry: `git merge-base --is-ancestor ${baseSha} ${resultSha}` must
  hold (construction-guaranteed, `worktree.mjs:1006-1007`). For snapshot captures the pin's own
  parent equals the recorded base; for worker-self-committed or mid-task-merge captures it does
  not (ground truth 2) — the recorded base is authoritative in ALL shapes, `git rev-parse
  ${resultSha}^` is never the base source. **Never HEAD.**
- `changedPaths` — sorted-unique paths from `changedPathsAtCommit(baseSha, resultSha, maxPaths)`
  (`index.mjs:772-783`), `maxPaths` default 1_024, ceiling 100_000; beyond-`maxPaths` refuses
  `result_delta_oversize` (Decision 6).
- `changedFiles` — bounded inventory rows for exactly `changedPaths`, each
  `{blob, digest, mode, path, size}` (the inventory row minus inline `bytes`,
  `result-export.mjs:494`), sorted byte-wise by path. Serialized total ≤ 256 KiB; an oversize
  page truncates with `truncated: true`, a `changedFilesDigest` over the FULL entry set, and a
  continuing `cursor` (Decision 6).

**Resolution path.** runId → run view result block (`view.result.sha` / `view.result.preservation`,
`application.mjs:3733-3752`, `:4907-4909`) → task via `view.nodes[0].taskId` → `task.assignee`
→ `coordinator.inspectPreservedResult` (`coordinator.mjs:6085-6102`) → worktrees
`resolveResult` (`index.mjs:842-848`).

**Readiness composition (stated, per the issue's ready/not-ready/never trichotomy).**
`result_not_ready` deliberately covers mid-flight AND terminal-failed runs — the
never-vs-not-yet distinction is collapsed into the one code, and orchestrators compose with run
terminality to distinguish "never" from "not yet". Checkpoint-only runs (pins under
`refs/baton/checkpoints/*`, `index.mjs:849-866`, inspected via `inspectCheckpoint`,
`coordinator.mjs:6111`) are not results: they read `result_not_ready` (OQ4).

**Refusal vocabulary (complete).** `application_run_resultpin_invalid` (closed-shape, thrown
BEFORE any state lookup — including 64-hex shas); `application_unauthorized` (host-policy,
constant for unknown ≡ foreign); `result_not_ready` (no preserved result: run non-terminal,
task not `completed`, no `retainedResultRef`, `inspectPreservedResult` state `unavailable`,
empty result section, or the recorded base unreachable); `pin_not_found`
(`inspectPreservedResult` state `missing` — the ref was released); `pin_unverifiable` (state
`unverifiable` — the physical re-verification lane is absent); `pin_mismatch` (state `mismatch`
— the ref resolves to a different commit); `pin_base_mismatch` (the recorded base is reachable
but NOT an ancestor of the pin — a record-corruption class; the accessor refuses, it never
silently proceeds on `pin^`); `result_delta_oversize` (`changedPaths` beyond `maxPaths`,
Decision 6); `result_ref_invalid` (defense-in-depth, the ownership regex at `index.mjs:843` —
unreachable through the closed shape).

**Rationale.** The orchestrator needs the recorded-base delta — sha, base, and the bounded
file projection — without hand-running `git diff` against a guessed base. The shape is the
issue's; the base law (Decision 3) makes the projection HEAD-independent and
parent-shape-independent.

### 2. `waves.harvest(resultSha | runId, {onto})` — recorded-base delta applied with three-way conflict resolution

**Surface.** Embedded facade direct port `application.command('waves.harvest', args, principal,
context)`, dispatched with the wave-ports idiom.

**Shapes.** Args are closed — sorted-key literal in ACTUAL sorted order: `['onto', 'resultSha',
'runId']` — with EXACTLY ONE of `resultSha` (`/^[a-f0-9]{40}$/`, sha1-only per Decision 1) or
`runId` (`validId`), and optional `onto` (string path). **`onto` is pinned default-only for v1
(OQ2 resolved):** absent, or a path that realpath-equals the deployment's main checkout; any
other value refuses `harvest_onto_invalid`. The engine hardwires the target side —
`beforeSha = git rev-parse HEAD` of `repoRoot` (`worktree.mjs:1269`) — so an arbitrary
owned-worktree target would require an engine amendment the non-goals forbid; that variant is a
later rung.

**Source resolution + pin verification (BOTH sources).** `runId` → the result-section read
(`application.mjs:11364-11370` attach-harvest idiom); when the section is empty, the wave
driver's `resolveResultPin` fallback (`wave.mjs:134-155` — report-path-existence +
committerdate-window disambiguation, never newest-pin guessing) MAY supply the candidate sha,
admitted ONLY when the run's task record attributes it (`task.capturedSha === candidate`). This
pins the read/act readiness asymmetry (OQ5, now decided): the read lane is strictly
record-backed and refuses `result_not_ready` on an empty section, while the act lane may
attempt an attributed, physically re-verified pin — because everything the read would certify
is re-derived from the task record before any apply. `resultSha` → the ownership pin
`refs/baton/results/<sha>` must resolve back to the SAME sha via `resolveResult`
(`index.mjs:842-848`); a real-but-unpinned commit refuses `pin_not_found`. `runId`-source
re-verifies identically: the recorded `task.retainedResultRef` is re-resolved to the section
sha before any merge (`missing` → `pin_not_found`; `mismatch` → `pin_mismatch`; `unverifiable`
→ `pin_unverifiable`). The recorded base comes from the attributing task's
`sessionContext.baseSha`; an unreachable recorded base refuses `result_not_ready`, and the
ancestry check of Decision 3 refuses `pin_base_mismatch`.

**Preconditions (ordered, each typed — this order is pinned).**
1. onto clean — the engine's `structured_main_dirty` (`worktree.mjs:1265`) maps to
   `harvest_onto_dirty`.
2. Already-contained: `git merge-base --is-ancestor ${resultSha} <ontoHEAD>` → `skipped /
   reason: 'already_integrated'`. (The engine's own `structured_already_integrated`,
   `worktree.mjs:1270`, is the defense-in-depth double-check, translated to the same receipt.
   This check precedes the divergence check: a contained pin is skipped, never "diverged".)
3. **Base-divergence (the wrong-but-applying-tree trap).** `git merge-base <ontoHEAD>
   ${resultSha}` MUST equal the recorded `baseSha`. For pins stacked on unintegrated results or
   bases foreign to onto's line (`createFromBase` takes any base, `worktree.mjs:1074`) the
   engine would otherwise merge from the COMPUTED merge-base (`worktree.mjs:1272`), applying
   `diff(merge-base, pin)` — a SUPERSET of the recorded-base delta — while the receipt reported
   the smaller delta: a wrong-but-applying tree with a clean receipt. Refusal:
   `harvest_base_diverged`, naming `{baseSha, mergeBaseSha, ontoHeadSha, resultSha}`; no merge
   is attempted and onto is untouched. The orchestrator's three-way surgery for such pins stays
   manual-or-flagged — NEVER a silent different-delta apply.
4. Empty delta: `changedPathsAtCommit(baseSha, resultSha)` empty → `skipped / reason:
   'empty_delta'`, computed BEFORE any stage. The constructible case is a net-zero
   self-committed pin (the worker's commits cancel out — non-ancestor of onto, onto descended
   from the recorded base, so preconditions 2-3 pass and the delta is empty); an ancestor
   clean-capture pin (`sha == base`) is already contained and reports `already_integrated`.
   No merge commit is created for either `skipped` reason.

**Apply.** Three-way merge via the structured-integration engine (`worktree.mjs:1262-1336`):
engine computes `merge-base(beforeSha, rightSha)` (`:1272` — provably the recorded base,
precondition 3), merges with diff3 conflict style (`:1280`), and commits the exact-parent
merge (`:1324`, parents verified `:1328`). `finalizeStructuredIntegration` (`:1337-1352`)
fast-forwards only after verifying onto HEAD hasn't advanced (`:1340` — a race there refuses
`harvest_onto_advanced`, retry-safe) and the merge parents are exact (`:1342`). If onto
advanced between a clean probe and the stage so the staged merge conflicts, the engine throws
`structured_tool_unavailable` (`:1287` — no resolver on the harvest lane, OQ3): translated to
`harvest_conflict` with a freshly probed conflict list, never `command_outcome_unknown`.

**Conflict outcome — descoped to a typed refusal (never a silent apply).** v1 ships no resolver
on the harvest lane (OQ3), and the pinned engine without one THROWS `structured_tool_unavailable`
(`worktree.mjs:1287`) carrying no conflict paths and DELETES its stage (`:1331`) — a
`conflicted` receipt with `conflicts` + `stagePath` is unconstructible without amending the
engine, which the non-goals forbid. So the v1.0 `conflicted` receipt is descoped: a conflicting
harvest REFUSES `harvest_conflict` — ONE outcome shape on facade, CLI, and MCP (the #87
refusal-constancy idiom; the receipt-on-facade/error-on-MCP asymmetry is gone by construction).
The conflict list comes from the harvest lane's OWN non-destructive three-way probe — additive
code in the new module, never an engine change: a throwaway detached worktree at `ontoHeadSha`;
the engine's own merge invocation replayed (`git -c merge.conflictStyle=diff3 merge --no-verify
--no-commit --no-ff <resultSha>`, the `worktree.mjs:1280` invocation); the conflicted set read
as `git diff --name-only --diff-filter=U -z` (the `:1282-1283` read) with per-path unmerged
classes from `git status --porcelain`; then the worktree removed. Nothing commits, onto is
untouched, no stage persists. The refusal carries `{conflicts: [{class, path}]}` sorted by path
byte-wise, plus `ontoHeadSha` and `resultSha`; `stagePath` is dropped from v1. A clean probe
proceeds to the engine stage above.

**Structured receipt** (return, closed core — sorted-key literal in ACTUAL sorted order):
`['baseSha', 'changedPaths', 'ok', 'reason', 'result', 'resultSha']` with outcome-conditioned
extras.

- `result: 'applied-clean'` — merge clean; receipt carries `afterSha` (the finalized stage
  commit sha) and `classes: ['clean_textual']` (the class-name projection of the engine's
  `{path, class}` rows, `worktree.mjs:1284`); onto HEAD = `afterSha` post-finalize.
- `result: 'skipped'` — `reason: 'already_integrated' | 'empty_delta'` (preconditions 2 and 4).

`ok: true` on every receipt; `reason` is null except for `skipped`. The receipt certifies the
TEXTUAL merge of the RECORDED-base delta — nothing more. Semantic conflicts (textually clean,
semantically conflicting) are undetectable by git and by shape-only scanners, and no row
promises detection (the honesty bound; v1.0's "correct by construction" overclaim is corrected
in Decision 3).

**Refusal vocabulary (complete).** `application_waves_harvest_invalid` (closed-shape:
ambiguous/absent source, malformed `onto`, 64-hex sha); `application_unauthorized` (host
policy); `result_not_ready` (no preserved result; recorded base unreachable; fallback pin
unattributed); `pin_not_found` (pin ref absent or resolves elsewhere — either source);
`pin_unverifiable`; `pin_mismatch`; `pin_base_mismatch`; `harvest_onto_invalid`;
`harvest_onto_dirty`; `harvest_base_diverged` (with both base shas named);
`harvest_conflict` (with the conflict list); `harvest_onto_advanced` (the finalize race,
retry-safe); `harvest_apply_failed` — any residual engine failure (`structured_stage_failed`,
`structured_merge_failed` (`:1286`), `structured_diff_invalid`, `structured_parent_mismatch`,
or a post-effect finalize failure) carrying the engine's code verbatim as `cause` and a
`postEffect` flag when the effect may have landed — NEVER `command_outcome_unknown`. The
resolver-loop engine codes (`structured_binary_conflict`, `structured_file_too_large`,
`structured_unsupported_path`, `structured_unresolved`, `structured_policy_invalid`) are
UNREACHABLE on the resolver-free harvest lane (the `:1287` throw precedes the per-file loop),
and `structured_invalid_result` is unreachable after pin verification.

**Rationale.** Reuses the proven structured-merge engine rather than inventing hand-rolled
`git apply` surgery — the ledger's "git apply + three-way merge surgery per wave"
(`orchestrator-friction-ledger.md:11`) becomes one command. The receipt (result class) and the
refusal (the exact conflict list) are the eval-able artifacts, never a duration or turn count;
when the machine cannot apply, it names exactly where, and the orchestrator's remaining surgery
stays manual by choice, not by ignorance.

### 3. The stale-base law — the accessor OWNS the recorded-base diff (construction-level)

Both lanes derive `baseSha` from the RECORDED capture base — `task.sessionContext.baseSha`
(`coordinator.mjs:3589-3604`, set from the worktree-creation result, `baseSha` at `:3592`;
restored durably across event replay, `coordinator.mjs:13970-13977`) — the same coordinate
`captureCommit` diffs against (`changedPathsFromBase(dir, meta.baseSha)`, `worktree.mjs:1233`)
and `inspectCapturedChanges` requires (`coordinator.mjs:4820-4828`). The pin's OWN parent
(`git rev-parse ${resultSha}^`) is NOT the base authority: `captureCommit` commits only on a
dirty tree (`worktree.mjs:1206-1232`), so for a clean-tree worker-self-committed capture —
admissible, since `validateOwnedWorktree` requires only that the base be an ANCESTOR of the
worktree HEAD (`worktree.mjs:1006-1007`) — the pin's parent is the worker's prior commit; for
a mid-task main-merge it is the merge commit. `rev-parse ${resultSha}^` equals the recorded
base ONLY for snapshot captures.

The pin lineage is a consistency CHECK, never a base source: `git merge-base --is-ancestor
${baseSha} ${resultSha}` must hold; failure refuses `pin_base_mismatch`; an unreachable
recorded base refuses `result_not_ready` — the accessor NEVER silently proceeds on `pin^` when
the recorded base disagrees or is missing. **The accessor never accepts a caller-supplied base,
and a caller-supplied `onto` never becomes the diff base** — it becomes only the three-way
merge's target side. The accessor MUST NOT expose a HEAD-based diff in any projection. The
harvest precondition (Decision 2, precondition 3) additionally pins `merge-base(ontoHEAD,
resultSha) === baseSha` so the APPLIED delta is exactly the receipted delta.

**Honesty bound.** The accessor certifies the TEXTUAL delta and its textual merge against the
recorded base — nothing more. Semantic conflicts (textually clean, semantically conflicting)
are undetectable by git and by shape-only scanners; v1.0's "correct by construction" is
corrected to "textually correct by construction against the recorded base".

**Rationale.** The two trap hits in the ledger are exactly a HEAD-vs-pin diff where HEAD is
foreign to the fork point. The recorded base is the only base that is honest in ALL capture
shapes (snapshot, worker-self-committed, mid-task merge): content-addressing the delta against
it makes the delta HEAD-independent and the apply textually correct by construction — the
engineering-out the issue demands, and a property of the accessor, not a caller-behavior
requirement.

### 4. MCP projections per the #87 idiom

Two NEW ordinary-surface tools join `ORDINARY_APPLICATION_TOOL_DEFINITIONS` — closed `schema()`
schemas (`additionalProperties: false`, `mcp-northbound.mjs:267-268`), `_meta` registry-digest
stamp (`:641`), `CAPABILITY` registration (`:78`), a hand-rolled `invalid_*` shape guard
(`:1104-1160`), an explicit `_dispatch` branch calling `application.command(<name>, …)` with the
CONNECTION-derived principal (`:1771`), and `ORDINARY_EXPLICIT_TOOLS` membership
(`:780`):

| MCP tool | Facade command | Capabilities | Annotations |
| --- | --- | --- | --- |
| `baton_run_resultpin` | `run.resultpin` | `['observe']` | read-only, idempotent |
| `baton_waves_harvest` | `waves.harvest` | `['control', 'observe']` | effectful, idempotent via server-derived pin/stage identity |

Schemas mirror the facade shapes plus `repoId`: `{repoId, runId}` for `baton_run_resultpin`;
`{onto?, repoId, resultSha?, runId?}` for `baton_waves_harvest` (sorted-key literal in ACTUAL
sorted order). The `resultSha` XOR `runId` law is NOT expressible in the `schema()` idiom
(closed objects only — both fields are optional in the schema); it lives in the hand-rolled
`invalid_*` guard, which refuses both-present and both-absent. None carries a wire
`idempotencyKey`; none joins `STATEFUL`/`RECONCILABLE` (`mcp-northbound.mjs:125`, `:138`) —
replay safety lives server-side in the deterministic pin/stage identity.

**Refusal constancy to the wire.** `stateFailureCode` (`mcp-northbound.mjs:198-260`) gains the
COMPLETE new vocabulary: `result_not_ready`, `pin_not_found`, `pin_unverifiable`,
`pin_mismatch`, `pin_base_mismatch`, `result_delta_oversize`, `harvest_conflict` (with the
conflict list), `harvest_onto_dirty`, `harvest_onto_invalid`, `harvest_onto_advanced`,
`harvest_base_diverged`, `harvest_apply_failed` — none may degrade to
`command_outcome_unknown` (`:260`) or `invalid_command` (`:258`). The facade `application_*`
codes already pass through (`:203`). The v1.0 receipt-vs-error asymmetry is gone by
construction: the conflict outcome is a refusal on every surface (Decision 2), and receipts
are success shapes everywhere.

**Rationale.** Mirrors the wave-tools projection one-for-one (facade-projection contract Decision
10) so the MCP-first orchestrator reaches the materialization lanes with the envelope shape it
already speaks.

### 5. CLI verbs + registry rows + the conformance regeneration step

**Canonical keys and the one-derivation naming law.** Two registry rows join
`CANONICAL_OPERATION_SPECS` in the wave-rows shape (`application-semantics.mjs:1540-1615`):
`run.resultpin` and `waves.harvest`. `deriveSurfaceNames`
(`application-semantics.mjs:1123-1144`) is the single shared derivation — the registry, the
audit, and every renderer compute surface names one way — and `buildCanonicalOperation` invokes
it UNCONDITIONALLY (`names: deriveSurfaceNames(key)`, `:1938`; there is no name-override
mechanism, and key parts must match `/^[a-z][a-z0-9_]*$/`, `:1128`). Evaluated this session:

- `run.resultpin` → cli `baton run resultpin`, mcp `baton_run_resultpin`, web `run_resultpin`,
  embedded `run.resultpin()`.
- `waves.harvest` → cli `baton waves harvest`, mcp `baton_waves_harvest`, web `waves_harvest`,
  embedded `waves.harvest()`.

**Collision check (the #87 Decision 11 law: derived names are mechanically C4-clean).**
`deriveSurfaceNames('run.result').cli === 'baton run result'` — the OCCUPIED episode
result-chapter spelling (cliCommands ledger row `application-semantics.mjs:860`; surface alias
`['run.view', 'cli', 'baton run result']`, `:1807`; parser `application-cli.mjs:1510-1520`) —
so the issue's `run.result` key is inadmissible as a canonical key, and v1.0's hand-picked
`baton run result-pin` spelling was unimplementable: the generated CLI.md verb column would
have documented the derived `baton run result` for the new operation, contradicting its own
resolution. `run.resultpin` clears every namespace (grepped clean this session): no canonical
key, no cliCommands ledger id, no run-verb parser token, no MCP tool, and no surface alias
carries it or any of its derivations; as a NEW single-token run verb it has zero interaction
with the episode parse branch (which consumes the token after `result` as RUN_ID). The
alternatives were rejected: `run.result.pin` derives `baton run result pin`, whose four-token
spelling the episode branch mis-parses (`pin` is consumed as the RUN_ID); `run.harvest` puts a
"harvest" read verb beside the `waves.harvest` apply verb — a semantic collision.

**CLI verbs** (the `application-cli.mjs` idiom, `:1308-1350` for the waves pattern; parse
results `{kind: 'command', name, args, idempotencyKey}`):

- `baton run resultpin RUN_ID` — a new single-token branch in the run-verb grammar, parse-result
  `{kind: 'command', name: 'run.resultpin', args: {runId}}`. The cliCommands ledger gains
  `['run.resultpin', 'run.resultpin', null, 'baton run resultpin RUN_ID']` (the
  `['run.stop', 'run.stop', …]` row pattern, `application-semantics.mjs:864`; the ledger map
  derives `subcommand: 'resultpin'` from the id, `:886-891`). The episode spelling
  `baton run result RUN_ID` is UNTOUCHED — its ledger row (`:860`) and parse branch stay.
- `baton waves harvest RESULT_SHA|RUN_ID [--onto PATH]` — parse-result `{kind: 'command', name:
  'waves.harvest', args}`, `runId` XOR `resultSha` enforced at parse. No ledger row — the
  `waves.*` verbs ride the canonical derivation and the `:848-885` ledger carries no `waves.*`
  rows.

`CLI_WEB_COMMANDS` gains `run.resultpin` and `waves.harvest` (the dispatch gate,
`application-cli.mjs:16`). The two registry rows: `profile: 'ordinary'`; `surfaces:
['embedded', 'mcp', 'cli']`; capabilities `['observe']` (`run.resultpin`) / `['control',
'observe']` (`waves.harvest`); `idempotent: true`; closed `inputSchema`s matching Decisions 1-2;
the examples above.

**Conformance regeneration is MANDATORY and ordered** (facade-projection contract Decision 11):
1. `node impl/scripts/render-surface-docs.mjs` — rewrites the CLI.md/MCP.md generated inventory
   blocks in place.
2. `node impl/scripts/surface-conformance.mjs --write-inventory` — regenerates the CS-4 checked
   artifact (the COMPLETE count list: `canonicalOperations` +2, `cliWebCommands` +2,
   `mcpApplicationTools` +2, `mcpCombinedTools` +2, and `mcpDispatchToolNames` +2 — the last two
   include the ordinary application tools, `mcp-northbound.mjs:2138-2140` and the
   `APPLICATION_TOOL` map's `CANONICAL_ORDINARY_SIBLINGS` feed, `:32-47`;
   `parserLifecycleActions` may move depending on the parse branch — observe it post-regeneration
   and pin the artifact's value. The registry authority projection covers `canonicalOperations`
   (`application-semantics.mjs:1985-1995`), so any digest that projection feeds moves with the
   two rows; the regenerated artifact is the pin).
3. Verify: `node impl/scripts/render-surface-docs.mjs --check` clean,
   `node impl/scripts/surface-conformance.mjs` prints `surface-conformance: ok`, and the three
   pinning suites stay green.

**Rationale.** The inventory blocks are executable projections of the served surface, not prose;
landing tools without regenerating them fails the committed-block pins by construction.

### 6. Bounds, byte caps, and the complete refusal vocabulary (#89 doctrine)

**Bounds (count-based only — no clocks, no turn-limits).**
- `run.resultpin.changedPaths`: default `maxPaths` 1_024, ceiling 100_000 (inherited from
  `changedPathsAtCommit`, `index.mjs:772-783`). Beyond-`maxPaths` refuses
  `result_delta_oversize` naming the cap and the `gracefulPath` (re-issue with a higher
  `maxPaths` ≤ 100_000) — the kernel throw (`captured_change_oversize`, `index.mjs:779-780`)
  carries no actual count, so the refusal names cap + gracefulPath only; the suite pins the
  TRANSLATION, never a degradation to `command_outcome_unknown`.
- `run.resultpin.changedFiles`: serialized total ≤ 256 KiB; an oversize page truncates with
  `truncated: true`, `changedFilesDigest` over the FULL entry set, and a continuing `cursor` —
  graceful spillover (the #89 doctrine, `application.mjs:231-234`, `limits.mjs:57`).
  Per-file: `size` ≤ 4 GiB blob ceiling (inherited from inventory, `result-export.mjs:486`),
  path ≤ 4,096 bytes (the `safePath` law, `context-result.mjs:91-98`).
- `waves.harvest` conflict list (the `harvest_conflict` payload): ≤ 1_024 entries, each path
  ≤ 4,096 bytes, serialized listing ≤ 256 KiB with the same digest-citation spill. The probe is
  bounded by the merge itself — no clocks, no timeouts.
- `waves.harvest` apply: the resolver-loop ceilings (`structured_file_too_large`,
  `worktree.mjs:1296`) are UNREACHABLE on the resolver-free harvest lane (the `:1287` throw
  precedes the per-file loop); the apply's failure modes map per Decision 2's vocabulary.
- Sha width: both lanes' shape gates pin sha1 (`/^[a-f0-9]{40}$/`) for v1 — the delta lane is
  40-hex-only (`index.mjs:773-775`, `worktree.mjs:333`); the wider 40|64 lanes (ownership
  regex `index.mjs:843`, `RESULT_SHA` `wave.mjs:18`, inventory `result-export.mjs:445`) are
  admitted by those layers, but the accessor refuses 64-hex at the shape gate rather than
  degrading to an unmapped `captured_change_invalid`. sha256-format deployments are a later
  rung.

**Refusal vocabulary (complete, per surface).** The ONLY codes are the ones enumerated in
Decisions 1-2 and 4 — no invented distinct codes (the blue-team D3 law,
`facade-projection-contract.md:50-52`). The conflict outcome is the typed `harvest_conflict`
refusal on every surface (Decision 2 — never a degraded code, never a facade/MCP asymmetry);
the CLI parse failures keep the `cli_invalid`/`cli_command_unavailable` vocabulary
(`application-cli.mjs:48`, `:1944`).

**Rationale.** Every cap is a count or a byte ceiling with cap+actual naming (or, where the
kernel supplies no count, cap + gracefulPath with the translation pinned) and a graceful
spillover path; the acceptance suite pins these shapes, never durations or turn counts.

---

## Non-goals

- No changes to the kernel result-preservation lane (`coordinator.mjs:6053-6102`:
  `preserveResult` / `_pinAcceptedResult` / `inspectPreservedResult`), the `captureCommit`
  baseSha semantics (`worktree.mjs:1191-1240`), or the structured-integration engine's
  conflict-resolution protocol (`worktree.mjs:1262-1352`). The harvest lane's conflict probe is
  ADDITIVE non-destructive code in the new module — it replays the engine's merge invocation in
  a throwaway worktree and changes nothing in `worktree.mjs`.
- No changes to `APPLICATION_COMMAND_DEFINITIONS` (byte-stable, grammar-m3 pin). `run.resultpin`
  and `waves.harvest` are direct ports only.
- No change to the `waves.attach` harvest loop's behavior (`application.mjs:11340-11390` stays;
  `waves.harvest` is additive, not a replacement).
- No resolver on the harvest lane in v1 (OQ3); no `conflicted` receipt and no `stagePath` in v1
  (descoped — Decision 2); no auto-resolution of the conflicts the probe reports.
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
| HA-01 | The two commands do not dispatch. | `run.resultpin` and `waves.harvest` dispatch through `application.command`; extra/missing fields, ambiguous harvest sources (both/neither of `resultSha`/`runId`), malformed ids/`onto`, and 64-hex shas refuse the pinned `application_run_resultpin_invalid` / `application_waves_harvest_invalid` codes BEFORE any state lookup; no bare TypeError reaches the caller. |
| HA-02 | The stale-base trap could survive. | **THE STALE-BASE ROW.** A fixture where main's HEAD has DIVERGED from the recorded base (the ledger's trap shape): `run.resultpin` returns `baseSha === task.sessionContext.baseSha` and `changedPaths` deep-equal `git diff --name-only -z baseSha resultSha` — NEVER the HEAD-based diff. A second fixture with a worker-self-committed capture (`pin^ ≠ recorded base`, admitted by the ancestor-only law `worktree.mjs:1006-1007`) returns the SAME recorded base — killing `pin^`-readers. A static, shape-only assertion pins the accessor derives the base from the record (no caller-supplied base reach, no HEAD base, no `pin^` base). A corrupted-attribution fixture (recorded base NOT an ancestor of the pin) refuses `pin_base_mismatch` — never silently proceeds. |
| HA-03 | The projection could re-shape the delta. | For one accepted, preserved result: `ready: true`, `resultSha` matches, `baseSha` is 40-hex and `≠ resultSha`, `changedPaths` sorted-unique and equal to the `changedPathsAtCommit` output, `changedFiles` rows `{blob, digest, mode, path, size}` EXACTLY covering `changedPaths` with byte-wise path sort; at-cap serialized page admitted, cap+1 truncated with `truncated: true`, `changedFilesDigest` over the full set, and a continuing `cursor`. |
| HA-04 | Not-ready and missing could degrade or leak. | A mid-flight or failed run returns `result_not_ready` (never a partial view, never a fabricated sha); a checkpoint-only run returns `result_not_ready`; a run whose pin was released (`releaseResult`, `index.mjs:864-866`) returns `pin_not_found`; the `unverifiable` and `mismatch` preservation states return `pin_unverifiable` / `pin_mismatch`; a foreign/unknown run ≡ `application_unauthorized`. |
| HA-05 | Harvest could apply the wrong delta or half-apply. | A wave whose result's delta is applied onto main with no divergent edits returns `applied-clean` with `afterSha` = the structured stage commit and `classes: ['clean_textual']`; the receipt's `baseSha` is the recorded base and its `changedPaths` equal the recorded-base diff; main ends at `afterSha`; post-harvest `git status` is clean. |
| HA-06 | Three-way preservation could regress to overwrite — or a conflict could be silently applied. | Divergent edits on main in a file the pin did NOT touch SURVIVE the harvest (three-way, not overwrite); divergent edits in a file the pin DID touch produce a `harvest_conflict` REFUSAL — the ONE outcome shape on facade, CLI, and MCP — whose conflict list names EXACTLY those paths (with their unmerged classes, sorted byte-wise), with onto HEAD unchanged, `git status` clean, no probe worktree or stage left behind, no fast-forward, and nothing applied. |
| HA-07 | Already-contained and empty deltas could fail loudly. | A result already contained by onto (harvest the same pin twice — the second attempt hits the ancestor check) → `skipped` with `reason: 'already_integrated'`; a net-zero self-committed pin (non-ancestor of onto, onto descended from the recorded base) → `skipped` with `reason: 'empty_delta'`; both are receipts (`ok: true`), not refusals, and no merge commit is created for either. |
| HA-08 | Refusals could degrade at the wire. | Through a descriptor-driven `McpFleetServer`: `baton_run_resultpin`/`baton_waves_harvest` appear in `mcpApplicationToolNames()` with `additionalProperties: false` schemas, the pinned capability classes, `invalid_*` guards, and no wire `idempotencyKey`; the COMPLETE vocabulary — `result_not_ready`, `pin_not_found`, `pin_unverifiable`, `pin_mismatch`, `pin_base_mismatch`, `result_delta_oversize`, `harvest_conflict` (with its conflict list), `harvest_onto_dirty`, `harvest_onto_invalid`, `harvest_onto_advanced`, `harvest_base_diverged`, `harvest_apply_failed` — surfaces AS ITSELF, never `command_outcome_unknown`, never `invalid_command`. Translation-proof rows inject the kernel codes at the facade (`structured_main_dirty` → `harvest_onto_dirty`; `captured_change_oversize` → `result_delta_oversize`; `structured_already_integrated` → the `skipped` receipt; `structured_tool_unavailable` → `harvest_conflict` with a re-probed list) and pin the wire shape — proving translation, not just mapping. |
| HA-09 | Docs could drift from the served surface. | CLI rows: `baton run resultpin RUN_ID` and `baton waves harvest RESULT_SHA\|RUN_ID [--onto PATH]` parse to the pinned `{kind: 'command', name, args}` dispatches; `baton run result RUN_ID` STILL parses to the episode result-chapter read (the occupied spelling is untouched); after the Decision 5 regeneration, `checkSurfaceDocs() === []`, `node impl/scripts/surface-conformance.mjs` prints `surface-conformance: ok`, and the three pinning suites stay green. |
| HA-10 | Static laws could silently break. | `Object.keys(APPLICATION_COMMAND_DEFINITIONS)` unchanged (grammar-m3 green); the new modules contain no `localeCompare` and no clock/turn-limit control (count-based bounds and event-vocabulary liveness only); sorted-key closed-shape literals appear in ACTUAL sorted order; the kernel diff touches ONLY the two direct ports and their projections (no kernel-lane changes — the probe is additive). |
| HA-11 | A latest-pin or only-pin reader could green the suite. | **THE MULTI-PIN ROW.** Two runs with two live pins where the queried run's pin is the OLDER: `run.resultpin` returns the queried run's OWN pin (`resultSha` === that run's captured sha), never the newest. A released-pin run coexisting with another run's live pin returns `pin_not_found` for the released run — an accessor returning the newest (or the only extant) pin greens nothing. |
| HA-12 | A merge-anything harvest could green the suite. | `waves.harvest` of a real-but-UNPINNED commit sha refuses `pin_not_found` (sha-source: `refs/baton/results/<sha>` absent or resolves elsewhere). RunId-source re-verification is pinned identically: the recorded `retainedResultRef` is re-resolved before any merge — a released pin → `pin_not_found`, a ref resolving to a different commit → `pin_mismatch`. |
| HA-13 | The harvest receipt could certify a different delta than the one applied. | With main advanced past the recorded base (HEAD-coincident trap): an `applied-clean` receipt's `baseSha` === the recorded `task.sessionContext.baseSha` and `changedPaths` deep-equal the recorded-base diff — never HEAD-based, never merge-base-based. A stacked-on-unintegrated pin (its recorded base is not the merge-base of onto, `createFromBase` taking any base, `worktree.mjs:1074`) refuses `harvest_base_diverged` naming `baseSha`, `mergeBaseSha`, `ontoHeadSha`, and `resultSha` — no merge attempted, onto untouched, never a silent different-delta apply. |
| HA-14 | The control lane could bypass authorization or the session gate. | `waves.harvest` is a control lane: a policy-refused principal gets `application_unauthorized` (constant for unknown ≡ foreign); and the direct port dispatches AHEAD of the recursive-session gate — a live run-orchestrator lease holder retains lane authority (the FP-18 shape, `facade-projection-contract.md:1240`). |

The end-to-end oracles (HA-02, HA-05…HA-07, HA-13) key on durable ids, shas, codes, and state
predicates (`result_ready`, `applied-clean`/`skipped`, `harvest_conflict`,
`harvest_base_diverged`, git status) — never sleep duration, turn count, or polling cadence
(the campaign control law).

---

## Open questions

1. **`changedFiles` payload richness.** v1 projects the inventory row `{blob, digest, mode,
   path, size}` WITHOUT inline bytes (readable via the existing captured-file lane,
   `coordinator.mjs:4799-4810`). If orchestrators need inline bytes, the 256 KiB serialized cap
   halves at best — a later rung may add an opt-in `withBytes` with its own cap+actual row.
2. **`onto` semantics — RESOLVED for v1** (Decision 2): `onto` is absent or names the
   deployment's main checkout; anything else refuses `harvest_onto_invalid`. The engine's
   `beforeSha` hardwires the main checkout HEAD (`worktree.mjs:1269`), so an arbitrary
   owned-worktree target (the `validateOwnedWorktree` shape, `worktree.mjs:995`) is a later
   rung requiring an engine amendment the non-goals forbid.
3. **Conflict auto-resolution.** The structured-merge engine's resolver is deployment-injected
   today (`worktree.mjs:1301`, marker check `:1312`). v1 reports conflicts via the
   `harvest_conflict` refusal (no resolver on the harvest lane); the conflict list's source is
   pinned (the harvest lane's own probe, Decision 2), so a resolver-carrying variant is a pure
   addition — safely deferred.
4. **Checkpoint pins.** Inconclusive results are preserved under `refs/baton/checkpoints/*`
   (`index.mjs:849-866`) and inspected via `inspectCheckpoint` (`coordinator.mjs:6111`). v1
   exposes result pins only; checkpoint-only runs read `result_not_ready` (Decision 1);
   checkpoint exposure is #53/#77 territory.
5. **Empty-section fallback — RESOLVED** (Decision 2): the readiness asymmetry is pinned.
   `run.resultpin` is strictly record-backed and refuses `result_not_ready` on an empty
   section; `waves.harvest`'s runId-source may take the `resolveResultPin` fallback
   (`wave.mjs:134-155`) ONLY with task attribution (`task.capturedSha === candidate`) and
   physical re-verification — the fallback can widen WHAT is attempted, never WHAT is
   certified, because the act lane re-derives everything the read would have certified before
   any apply.
6. **The CLI naming collision — SETTLED.** The canonical key is `run.resultpin` (Decision 5);
   the episode `baton run result` spelling stays the episode lane's untouched spelling. Whether
   the registry's naming epic (#9 / §9 M-naming) renames the EPISODE spelling independently is
   a registry decision this contract deliberately does not spend.
7. **Recursive-session posture.** `waves.harvest` is a control lane; the #87 law places direct
   ports ahead of the recursive-session gate so a live run-orchestrator lease holder retains
   lane authority (the FP-18 shape, `facade-projection-contract.md:1240`), and HA-14 pins that
   pre-gate dispatch plus the authorization refusal. The open question is whether the ORDINARY
   (non-lease) recursive gate should also admit it.
