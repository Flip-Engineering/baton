# Red team — harvest-accessor contract v1.0 (issue #99), 2026-08-06

**Subject:** `docs/reference/evidence/harvest-accessor-2026-08-06/harvest-accessor-contract.md` (fleet-drafted by a deepseek worker — first fleet draft, so every anchor re-verified from zero).
**Method:** every file:line citation re-verified THIS session with NUL-safe `grep -an '' | sed -n` against this worktree; the delta law, conflict story, readiness semantics, and projections probed against the actual machinery (`wave.mjs`, `index.mjs`, `worktree.mjs`, `coordinator.mjs`, `application.mjs`, `mcp-northbound.mjs`, `application-cli.mjs`, `application-semantics.mjs`, the conformance scripts); #87 idiom anchors checked in `facade-projection-contract.md`.

**Verdict: NOT FOLD-READY — 8 blockers.** The facade/registry idiom half of the draft is unusually good (ground truths 5, 9, 10, 11 are exact, and the dispatch-alias safety claim — the easiest thing for a fleet drafter to hallucinate — is TRUE). The git-semantics half is where the draft is wrong in ways that matter: the delta law's base authority is inverted, the headline `conflicted` receipt cannot be constructed from the engine the contract pins, and the CLI collision resolution collides with the registry's own name derivation.

---

## 1. Citation audit (attack surface 1 — the contract's own law: a wrong citation is an automatic blocker)

The **range** citations are nearly all correct. The **sub-line pins** are systematically shifted — the signature of anchors written from a stale or mis-numbered view, exactly the fleet-draft failure mode the brief warned about:

| Contract citation | Actual content at cited line | Correct line(s) |
| --- | --- | --- |
| `index.mjs:842` (ownership regex) | `async resolveResult(ref) {` | regex at `index.mjs:843` |
| `index.mjs:845` (resolves `${ref}^{commit}`) | `}` (end of if-block) | `index.mjs:846` |
| `index.mjs:846` (returns `null` when missing) | the `try { return localGit([...]) }` line | `catch { return null; }` at `index.mjs:847` |
| `index.mjs:781` (`git diff --name-only -z …`) | `}` (end of oversize if) | diff at `index.mjs:777` |
| `index.mjs:783` (dedup + sort + ceiling, `captured_change_oversize`) | `},` (end of method) | ceiling/dedup refusal `:779-780`, sort `:782` |
| `coordinator.mjs:6085-6098`, states `(:6093-6097)` | range ends mid-function; `:6093-6097` contains only `unverifiable` + the resolve call | function spans `6085-6102`; states at `:6090` (unavailable), `:6093` (unverifiable), `:6099` (pinned/missing/mismatch ternary) |
| `worktree.mjs:1235` (commit on top of base) | `validateOwnedWorktree(repoRoot, taskId, {` | commit at `worktree.mjs:1225` |
| `worktree.mjs:1236` (`changedPathsFromBase(dir, meta.baseSha)`) | `expectedPath: dir, expectedBaseSha: …` | `worktree.mjs:1233` (also `:1203`, `:1215`) |
| Citation-discipline preamble: "application.mjs, coordinator.mjs, and coordination-store.mjs contain NUL bytes" | — | `application.mjs` (3 NULs) and `coordination-store.mjs` (3 NULs) do; **`coordinator.mjs` contains none** (verified by byte count) |

Verified CORRECT (substance and line): `coordination-store.mjs:356`; `index.mjs:837-840`, `:849-866`, `:864-866`, `:239`, `:772-783` (range); `coordinator.mjs:6070-6081` incl. `:6080`/`:6081`, `:6111`, `:4820-4828`, `:4799-4810`, `:6053-6098`; `worktree.mjs:936-946`, `:995`, `:1262-1352` with `:1265`/`:1270`/`:1272`/`:1280`/`:1301`/`:1295`/`:1296`/`:1312`/`:1324`/`:1328`/`:1340`/`:1342`; `result-export.mjs:431-442`, `:444-500` incl. `:452`/`:464`/`:477-482`/`:486`/`:494`/`:496`, `:726`; `context-result.mjs:91-98`, `:129-136`, `:204-217`, `:141-144` (the 1..100_000 bound is `:144-145`, just outside the cited `:148-153` — substance true); `application.mjs:300`, `:231-234`, `:150`, `:152`, `:11364-11372` incl. `:11366`, `:3733-3752`, `:4907-4909`, `:12164`, `:12170-12175`, `:12184-12223`, `:12219-12222`, `:12311`, `:11437-11475`, `:11477-11513`, `:11516`, `:11340-11390`; `wave.mjs:18`, `:134-155`, `:390-406` incl. `:397`, `:427-445`; `mcp-northbound.mjs:456-532`, `:267-268`, `:641`, `:97-100`, `:78`, `:1104-1160`, `:1771`, `:780`, `:125`, `:138`, `:198-260` incl. `:203`/`:258`/`:260`; `application-cli.mjs:1308-1350`, `:1510-1520`, `:16`, `:48`, `:1944`; `application-semantics.mjs:860`, `:735-827`, `:1540-1615`, `:2129-2133`; `mcp-descriptor.mjs:148`; `limits.mjs:57`; `mcp-packaging-red.test.mjs:556`; ledger `:11`; #87 contract `:40-52` (v2.2 fold note), `:50-52` (blue-team D3), `:1240` (FP-18), Decisions 10/11 (MCP/CLI idiom). Grammar-m3 pins the `APPLICATION_COMMAND_DEFINITIONS` key set at `grammar-m3-red.test.mjs:264` ✓.

**Blocker 1** — per the contract's own bolded law, the shifted pins above must be corrected before fold. All corrections are mechanical; the underlying claims are true at the right lines, so this is precision rot, not substance collapse.

---

## 2. The delta law (attack surface 2) — the base authority is INVERTED

**Ground truth 2 overclaims.** The contract states: "So `git rev-parse ${resultSha}^` equals the recorded capture base." That holds ONLY for the snapshot-capture path. `captureCommit` (`worktree.mjs:1206-1232`) commits only when the worktree is dirty; on a **clean tree** (worker made its own commits — admissible, since `validateOwnedWorktree` requires only that `meta.baseSha` be an *ancestor* of the worktree HEAD, `:1006`) the captured sha is the worker's own HEAD, whose parent is the worker's prior commit — NOT `meta.baseSha`. Same divergence when a worker merges main into its worktree mid-task (capture parent = the merge commit). The recorded base (`task.sessionContext.baseSha`, set from the worktree-creation result at `coordinator.mjs:3589-3604`) is the honest base in ALL cases — it is what the kernel itself diffs against (`changedPathsFromBase(dir, meta.baseSha)`, `:1233`) and what `inspectCapturedChanges` requires (`:4820`). The contract makes `pin^` authoritative and the recorded base a "cross-check when the task is reachable" — the wrong way around — and never says what happens when the cross-check FAILS (no code, no winner). The trap cases, concretely:

- **Pin base predates HEAD, post-base work on master (the deletion fake-out):** handled correctly for the projection — `changedPathsAtCommit(pin^, pin)` is HEAD-independent, and HA-02's diverged-HEAD fixture genuinely kills a HEAD-diffing implementation. SOUND.
- **HEAD-coincident green:** for `run.result`, HA-02 blocks it. For `waves.harvest` NO row pins `receipt.baseSha === git rev-parse ${resultSha}^` or `receipt.changedPaths` against the pin-parent diff — HA-05/HA-06 fix the *merge* (the engine is three-way regardless) but not the *receipt's* base fields. A harvest reporting HEAD-based `changedPaths` greens the suite whenever HEAD == pin^ in the fixture. GAP (blocker 7c).
- **Private effective-tree snapshot base / stacked-on-unintegrated result:** when the pin's parent is NOT an ancestor of `onto` (reachable — `createFromBase` takes any base, `worktree.mjs:1074`, and tasks carry an explicit `worktreeBaseSha`), the engine merges from the COMPUTED `merge-base(onto, pin)` (`:1272`), applying `diff(merge-base, pin)` — a superset of the pin-parent delta — while the receipt reports `changedPaths = diff(pin^, pin)`. The tree applies cleanly and the receipt describes a different delta than the one applied. This is precisely the "wrong-but-applying tree, no markers" case of attack surface 3, and no row catches it. **Blocker 4.** Fix: harvest must pin `merge-base(onto, resultSha) === baseSha` (equivalently `git merge-base --is-ancestor ${resultSha}^ <ontoHEAD>` for the single-commit pin) and refuse with a pinned code (e.g. `harvest_base_diverged`) otherwise.
- **Pin with a merge base / worker self-commits:** `pin^ ≠ base` — see above. **Blocker 2.** Fix: recorded `sessionContext.baseSha` is authoritative (refuse when unreachable); `pin^` lineage is a consistency CHECK (`merge-base --is-ancestor baseSha resultSha`) with a pinned mismatch refusal. This also fixes the empty-capture case (pin == base: `pin^` reads the base's own parent and reports the base commit's own delta as the "result").

**Semantic-conflict refusal (attack surface 3):** should harvest refuse on semantic risk? With blocker 4 fixed, the residual semantic risk is ordinary three-way behavior (textually clean, semantically conflicting) — git cannot detect it and neither can a shape-only scanner; the contract is right not to promise detection, but it must SAY the receipt's honesty bound: the receipt certifies the *textual* merge of the *pin-parent* delta, nothing more. Currently it implies more ("correct by construction", Decision 3).

---

## 3. The conflict story (attack surface 3) — the `conflicted` receipt is unconstructible under the contract's own non-goal

Decision 2 pins `result: 'conflicted'` carrying `conflicts: [{class, path}]` and a preserved-or-null `stagePath`. The pinned engine cannot produce it:

- With conflicts and NO resolver (Decision 2/OQ3: "no resolver on the harvest lane"), `stageStructuredIntegration` THROWS `structured_tool_unavailable` (`worktree.mjs:1287`) — and the catch block REMOVES the stage (`:1331`). The throw carries no conflict paths; the stage is gone, so `stagePath` is unreachable too.
- With a resolver, the engine never reports conflicts at all: it resolves or throws (`structured_unresolved` etc.), and resolved files land in `classes` as `{path, class: 'structured_resolved'}` — a shape (`{path, class}` objects) that matches NEITHER the receipt's `classes: ['clean_textual']` (strings, HA-05) NOR the conflicted receipt.
- The engine's ALREADY-integrated/empty handling: `structured_already_integrated` throws (catchable → `skipped` receipt ✓ fine), but there is NO empty-delta detection: a tree-identical non-ancestor merge commits cleanly (applied-clean with a no-op merge commit), and a clean-capture pin (sha == base, an ancestor of main) hits already-integrated. HA-07's `skipped / reason: 'empty_delta'` has no machinery path — **Blocker 6.** Fix: pin an explicit pre-merge emptiness check (`changedPathsAtCommit` empty, or `git diff --quiet onto resultSha`) → the `empty_delta` skipped receipt.

So the contract simultaneously (a) makes the engine's conflict protocol a non-goal ("No changes to … `worktree.mjs:1262-1352`") and (b) requires a conflict-reporting behavior the engine does not have. **Blocker 3.** Fix, one of: amend the engine with a report-only conflict mode (and move it out of non-goals); or pin a read-only conflict-discovery lane for the receipt (`git merge-tree --write-tree <onto> <resultSha>` reports conflict paths without a stage) and drop `stagePath` from the v1 receipt; either way, state where the conflict list comes from.

Adjacent ambiguities, same seam:

- **Receipt-vs-refusal disjunction.** Decision 2 has harvest THROW `harvest_conflict` "under a strict policy" but never names the policy lever; HA-06's oracle is literally disjunctive ("a `conflicted` receipt (or `harvest_conflict` under strict policy)"). An acceptance row cannot pin two outcomes for one fixture. Meanwhile Decision 4/6 map the `conflicted` receipt to a `harvest_conflict` ERROR at the MCP wire — so the same outcome is a success receipt on facade/CLI and an error on MCP, breaking the #87 refusal-constancy idiom it claims to mirror. Pick ONE shape (recommendation: receipt everywhere, `harvest_conflict` reserved for a caller-supplied `strict: true` — or error everywhere; either, but pinned). Part of blocker 7d.
- **`onto` is shipped but undefined.** Decision 2 ships the `onto` arg and `harvest_onto_invalid`, while OQ2 leaves onto's semantics open and the engine hardwires the main checkout (`beforeSha = rev-parse HEAD` of `repoRoot`, `:1269`) — it cannot target another path without modification (another non-goal conflict). For v1, pin: `onto` absent or equal to the deployment main checkout, anything else refuses `harvest_onto_invalid`. Part of blocker 5's class (spec self-contradiction), recorded under blocker 8's vocabulary completeness.

---

## 4. Readiness semantics (attack surface 4) — mostly honest, two unmapped states

- **Checkpoint pins vs result pins:** distinguished by construction — `resolveResult`'s ownership regex admits only `refs/baton/results/*` (`index.mjs:843`); the demo's checkpoint-only report run reads `result_not_ready` (its result was never accepted), which is the honest answer. OQ4's deferral to #53/#77 is safe; say explicitly that checkpoint-only ⇒ not-ready.
- **Across death/reaping:** sound. Workers rehydrate from durable state (`coordinator.mjs:4603`, `:13996`) and event replay restores `task.capturedSha`/`task.retainedResultRef` (`:13975-13977`); the run view's result block is store-derived (`application.mjs:7307-7323`). The contract's "durable, non-evented reads" (ground truth 12) holds.
- **Gaps:** `inspectPreservedResult` also returns `mismatch` and `unverifiable` (`coordinator.mjs:6093`, `:6099`) — neither is mapped in the refusal vocabulary ("complete" per Decision 6). A `mismatch` (ref resolves to a different commit) must not fall through to an unmapped code at the wire. Part of blocker 8. And the never-vs-not-yet distinction is collapsed into one `result_not_ready` for mid-flight and terminal-failed runs alike — defensible (orchestrators compose with run terminality), but the contract should state that composition rather than leave the issue's ready/not-ready/never trichotomy half-answered. Observation, not a blocker.

---

## 5. MCP/CLI projections (attack surface 5)

- **Collisions:** none. `baton_run_result` / `baton_waves_harvest` are free (full tool inventory checked); no clash with the six #87 workflow-surface tools; `waves.harvest` dispatches as a direct port without touching the byte-stable table (grammar-m3, `:264`, stays green). The dispatch-alias safety claim (ground truth 10) is TRUE: `APPLICATION_DISPATCH_ALIASES` derives ONLY from `OPERATION_ALIASES` (`application-semantics.mjs:1105-1107` → `:2020` → `:2129-2133`), and `run.result` is not a key there — the `:860` cliCommands row and the `:1807` surface alias feed other tables, not the dispatch rewrite.
- **Decision 5's collision resolution is unimplementable as written — Blocker 5.** `deriveSurfaceNames('run.result')` evaluates (this session) to `cli: 'baton run result'` — the OCCUPIED episode spelling — and `buildCanonicalOperation` derives names unconditionally (`application-semantics.mjs:1938`, no override mechanism). After the mandated regeneration, the generated CLI.md verb column would document `baton run result` for the new materialization operation, contradicting Decision 5's own `baton run result-pin` resolution and HA-09's "the occupied spelling is untouched". The #87 precedent required exactly this check ("Derived names are mechanically C4-clean", facade-projection Decision 11); this contract skipped it. Fix: pick a collision-free canonical key (e.g. `run.result.pin` → `baton run result pin`) or amend the registry with a pinned name override; state the `cliCommands` ledger row (`application-semantics.mjs:848+`) either way.
- **Count predictions incomplete:** the artifact also counts `mcpCombinedTools` and `mcpDispatchToolNames` (both include the ordinary application tools — `mcp-northbound.mjs:2138-2143`, `:32-47`), so regeneration changes +2 there too; `parserLifecycleActions` may move depending on the parse branch. Fold the full count list into Decision 5. Part of blocker 5.
- **Refusal constancy:** the five new codes must join `stateFailureCode` — but HA-08 pins only three of them (`result_not_ready`, `pin_not_found`, `harvest_conflict`); `harvest_onto_dirty`/`harvest_onto_invalid` are unpinned at the wire. And the underlying kernel codes (`structured_main_dirty`, `captured_change_oversize`, …) degrade to `command_outcome_unknown` if the facade forgets to translate — the suite should prove translation, not just mapping. Part of blockers 7e/8.
- Minor: the XOR for `baton_waves_harvest` is not expressible in the `schema()` idiom (closed objects only); it lives in the hand-rolled guard — say so (wording).

---

## 6. Acceptance pins (attack surface 6) — four shallow implementations green today

- **Latest-pin reader:** HA-03/HA-04 use single-result fixtures; an accessor returning the NEWEST pin (or the only extant one) greens them. Add a two-run/two-pin fixture where the queried run's pin is the older (and a released-pin run coexisting with another run's live pin).
- **Harvest without pin verification:** no row pins that `waves.harvest` of a real-but-UNPINNED commit sha refuses `pin_not_found` (sha-source AND runId-source — the runId path's pin re-verification is not pinned either). A merge-anything harvest greens HA-05/06/07.
- **HEAD-coincident receipt:** §2, blocker 7c — pin `receipt.baseSha`/`receipt.changedPaths` against `git rev-parse ${resultSha}^` with main advanced past the base.
- **Disjunctive oracle:** HA-06's "receipt (or `harvest_conflict` under strict policy)" with "strict policy" undefined — pick one (blocker 7d).
- Also missing: a `waves.harvest` AUTHORIZATION row (a control lane with no `application_unauthorized` pin — HA-04 covers `run.result` only); wire-constancy rows for the two onto codes (7e).
These five gaps are **Blocker 7**.

---

## 7. Verdicts per decision and open question (attack surface 7)

| Decision | Verdict | Fix |
| --- | --- | --- |
| 1. `run.result` | **HOLE** | base authority inverted (blocker 2); `mismatch`/`unverifiable` unmapped; `changedPaths` >1_024 hits unmapped `captured_change_oversize` with no pagination/refusal story; 64-hex shas pass the contract's shape gate then hit the 40-hex-only lane (`index.mjs:773`, `worktree.mjs:333`) — pin sha1-only or map `captured_change_invalid` (blocker 8). Note the shape sentence lists five closed keys while HA-03 pins `truncated`/`changedFilesDigest`/`cursor` extras — add "plus outcome-conditioned extras" (wording). |
| 2. `waves.harvest` | **HOLE** | conflicted receipt unconstructible (blocker 3); merge-base divergence (blocker 4); `empty_delta` pathless (blocker 6); pin `onto` default-only for v1; pin verification on both sources (blocker 7). |
| 3. Stale-base law | **HOLE** | right invariant (never HEAD), wrong authority — recorded base must be primary, `pin^` a checked consequence; cross-check failure semantics pinned (blocker 2). |
| 4. MCP projections | **SOUND with amendments** | idiom matches #87 Decision 10 exactly; add onto codes to HA-08; resolve the receipt-vs-error asymmetry; XOR-in-guard wording. |
| 5. CLI + registry + regeneration | **HOLE** | derived-name collision (blocker 5); incomplete count list; cliCommands ledger row unstated. |
| 6. Bounds + refusal completeness | **HOLE (minor)** | `changedPaths` oversize story; sha-width consistency; `mismatch`/`unverifiable` mapping (blocker 8). |
| Non-goals | **HOLE by contradiction** | the engine non-goal conflicts with the conflicted receipt (blocker 3). |
| Red-first suite | **HOLE** | blocker 7's gaps; HA-02 is the model row — extend its honesty pins to the harvest receipt. |

Open questions: **OQ1** (inline bytes) — safely deferred ✓ (`coordinator.mjs:4799-4810` lane exists). **OQ2** (`onto` semantics) — FOLD-BLOCKING as written: the arg and its refusal code ship in v1 while semantics are open; pin default-only or drop the arg. **OQ3** (auto-resolution) — safely deferred ONLY after blocker 3 fixes where the conflict list comes from. **OQ4** (checkpoint pins) — safely deferred ✓; state checkpoint-only ⇒ `result_not_ready` explicitly. **OQ5** (empty-section fallback asymmetry) — make it a DECISION, not a question: runId-harvest can succeed via `resolveResultPin` where `run.result` refuses — the readiness asymmetry between the read and act lanes must be pinned with rationale. **OQ6** (naming consolidation) — deferral fine, contingent on blocker 5's fix. **OQ7** (recursive-gate posture) — safely deferred: pre-gate dispatch per FP-18 is the right default; add the missing harvest-authorization row (blocker 7f).

---

## Blocker list (8)

1. **Citation law violated** — systematic sub-line shifts (`index.mjs:842/845/846`, `:781/:783`; `coordinator.mjs:6093-6097` + range; `worktree.mjs:1235/:1236`) and a false NUL claim for `coordinator.mjs`. Automatic per the contract's front matter; corrections enumerated in §1.
2. **Delta-law base authority inverted** (ground truth 2 / Decisions 1, 3) — `pin^` ≠ recorded capture base for worker-self-committed or mid-task-merge captures (clean-tree path, `worktree.mjs:1206-1232`; ancestor-only admission, `:1006`); cross-check failure semantics unpinned. Fix: recorded `sessionContext.baseSha` authoritative + ancestry consistency check + pinned mismatch refusal.
3. **`conflicted` receipt unconstructible** (Decision 2 vs non-goals) — engine throws `structured_tool_unavailable` without a resolver (`worktree.mjs:1287`), deletes the stage (`:1331`), carries no conflict list; `classes` shapes mismatch. Fix: engine report-mode amendment (non-goal moves) or a pinned read-only conflict-discovery lane; drop `stagePath` in v1.
4. **Merge-base ≠ pin-parent divergence** (Decision 2) — for pins whose parent is not an ancestor of `onto`, the engine applies `diff(merge-base, pin)` while the receipt reports `diff(pin^, pin)`: a wrong-but-applying tree with a clean receipt. Fix: pin the `merge-base(onto, resultSha) === baseSha` precondition + `harvest_base_diverged` refusal.
5. **CLI collision resolution unimplementable** (Decision 5) — `deriveSurfaceNames('run.result').cli === 'baton run result'` (occupied; evaluated this session), no name-override mechanism (`application-semantics.mjs:1938`); count predictions omit `mcpCombinedTools`/`mcpDispatchTools` +2; `cliCommands` ledger row unstated.
6. **`empty_delta` has no machinery path** (Decision 2 / HA-07) — engine detects ancestry only (`:1270`); tree-identical merges commit clean; clean-capture pins are ancestors ⇒ `already_integrated`. Fix: pinned pre-merge emptiness check → skipped receipt.
7. **Acceptance gaps that green shallow implementations** — (a) no multi-pin fixture (latest-pin reader); (b) no unpinned-sha harvest refusal row, both sources; (c) no harvest receipt base-honesty pin (HEAD-coincident green); (d) HA-06's disjunctive oracle + undefined "strict policy" + facade/MCP receipt-vs-error asymmetry; (e) onto codes missing from HA-08's constancy list; (f) no `waves.harvest` authorization row.
8. **Refusal vocabulary not complete** (Decisions 1/2/6) — `mismatch`/`unverifiable` unmapped; `captured_change_oversize` reachable (1_025+ changed paths) with no pagination or mapped code; 40-vs-64-hex inconsistency between the contract's shape gate and the 40-hex-only delta lane (`index.mjs:773`, `worktree.mjs:333`) vs the 40|64 inventory lane (`result-export.mjs:445`).

**What the draft got right (fold should preserve):** the facade direct-port idiom analysis (ground truth 5) is exact; the dispatch-alias safety proof (ground truth 10) is correct and non-obvious; the pin/ref machinery (ground truth 1), the engine inventory (ground truth 6), path-safety/projection laws (7, 8), and the MCP/CLI surface facts (9, 11) are all substantively accurate; the regeneration-mandate discipline matches #87 Decision 11; HA-02 is the right trap row and belongs in the suite unchanged.
