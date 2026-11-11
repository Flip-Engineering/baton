# Workflow-as-Data Contract v1.0 — Adversarial Red Team Report (issue #114)

- **Contract under attack:** `docs/reference/evidence/workflow-as-data-2026-08-06/workflow-as-data-contract.md` (v1.0 DRAFT, 2026-08-06)
- **Verdict:** **NOT FOLD-READY** — 6 numbered blockers (B1–B6), each with a concrete fix.
- **Citations re-verified against HEAD `3953f81` (private effective-tree snapshot over `61763c8`).** NUL discipline honored: `grep -an`/`sed -n` only on `impl/src/application.mjs` and `impl/src/coordination-store.mjs` for NUL checks; no NULs were introduced or relied upon elsewhere.

---

## 0. Citation re-verification (the contract's only `file:line` + every named file)

The contract carries exactly **one** explicit `file:line` citation plus four named source files and a set of issue cross-references. Results:

| Citation | Verdict | Evidence |
|---|---|---|
| `docs/PROGRESS.md:391` — composition law | **VERIFIED** | `sed -n '385,395p'` shows line 391 = "**Composition v2.1 acceptance law (operator): no new orchestration wave may require a new script file.**" |
| `wave-driver.mjs` — `createWaveDriver` options shape (GT1) | **VERIFIED w/ caveat** | `impl/src/wave-driver.mjs:257` `export function createWaveDriver(baton, rawPolicy)`. `DEFAULT_POLICY` (:24–:67) ships `steering: 'nudge-on-checkpoint'`, `pollIntervalMs/stallTimeoutMs/hardCapMs`, and `finalization` vocabulary `none|claim-on-stall`. **Caveat:** the shipped *default* finalization is `'none'`; `'claim-on-stall'` is opt-in vocabulary, so GT1's "shipped steering vocabulary is … `finalization: 'claim-on-stall'`" overstates the default. |
| `recipes.mjs` — `baton.recipes.implementContract` (GT3) | **VERIFIED** | `impl/src/recipes.mjs:548` `implementContractRecipe`, :562 `implementContract`, :579 the facade accessor. |
| `wave.mjs` — `validateMember` laws (D1) | **VERIFIED** | `impl/src/wave.mjs:50` `validateMember`: scope globs + bare-directory law (:68–:88), exact-route closed shape `{harness, model, effort}` only (:100–:110). |
| GT5 — 4096-byte rendered cap → `recipe_oversize` | **VERIFIED** | `impl/src/recipes.mjs:35` `RENDERED_OBJECTIVE_MAX_BYTES = 4096`; :311 throws `recipe_oversize`. |
| D3 — "#97's typed `worker_spawning` refusal" | **NOT SHIPPED at HEAD** | `grep -rn worker_spawning impl/` (non-test) → **zero production sites**. Current `sendMessage` (`impl/src/coordinator.mjs:6793`) returns `worker_not_active`/`run_not_active`, never `worker_spawning`. The typed refusal is a **RED row** (`impl/test/issue10-waiting-vocabulary-red.test.mjs:934` `SP-REFUSAL`, stage `spawn-refusal-missing`). The contract presents a spec'd-but-unimplemented refusal as a shipped ground truth. The demo's retry pattern (`docs/reference/evidence/dynamic-workflow-2026-08-03/run-dynamic-workflow.mjs:218-230`) handles the not-ready case and is the real receipt. |
| GT2 — "five working bespoke drivers" | **PARTIALLY VERIFIED** | The six names all exist under `docs/reference/evidence/` (bd3 = `bidirectional-v3-2026-08-02`, spec-wave = `spec-waves-2026-08-06`, suite/blueteam/fold = `suite-waves-2026-08-06`, demo = `dynamic-workflow-2026-08-03`). But the recorded receipts show **mixed verdicts**: `BD3-LIVE-OK`, `BLUE-WAVE-OK`; **`SPEC-WAVE-INCOMPLETE`, `SUITE-WAVE-INCOMPLETE`, `DYNAMIC-WORKFLOW-INCOMPLETE`** (`fold-wave-receipt.json` truncated after `waves.start`). "Five working" is not uniformly backed by the on-disk artifacts — the suite/spec waves recorded *incomplete harvests* (this is itself evidence for blocker B1). Also the prose lists **six** items for "five drivers" (the demo is the sixth). Minor. |
| GT4 — module-load side effect | **VERIFIED (mechanism); incident unrecorded** | Every named driver runs `await openBaton({...})` + `await baton.waves.start(...)` at **top-level await** (verified in all five drivers + demo), so `import` of any of them launches a wave. The specific "duplicate fold wave, 2026-08-06, killed" incident has no repo record outside the contract itself — plausible, but unverifiable from the tree. |
| D4 — "the campaign's three bespoke-matcher misses" | **VERIFIED** | `docs/reference/evidence/frontier-sweep-2026-08-03/orchestrator-friction-ledger.md:76` (spec-wave salt-matcher miss), `:90` ("harvest content-matcher missed a THIRD time … suite-wave verdict 'harvested: none'"). |

---

## 1. The closed spec schema (D1) — **HOLE**

**1.1 — `verification` is an undefined executable escape (feeds B4).** The schema carries `"verification": { "command": "node", "arguments": ["--test", …] }` (`workflow-as-data-contract.md:47`), but **no decision defines its consumer**. D2's interpreter description (validates → starts the wave → drives steering → harvests → returns the receipt) omits it; D6's receipt `{ outcomes, steering, harvest, verdict, basis, waveId, manifestDigest }` omits its result. Two readings, both bad:
  - If the interpreter **runs** it, the spec carries arbitrary executable content — a direct contradiction of the "spec is data" law (D2) and a working RCE if the spec is ever untrusted (a PR-submitted spec, a shared `baton wave run` example).
  - If the interpreter **ignores** it, it is dead schema. The campaign already made this exact call in the recipe lane: `impl/src/recipes.mjs:176-178` — "`verification` is REMOVED (no consumer — R-DC-6)". The workflow spec reintroduces it without a consumer.
  - **Fix:** either delete `verification` from the schema (recipes precedent) or wire it to the existing pinned-verification mechanism (`impl/src/coordinator.mjs:4652` requires `{command: string}` and runs it against an expected exit, `expectExit`), with the verdict surfaced in `receipt.verification` and the command containment-checked to the repo worktree. Do not leave a schema field whose semantics are unstated.

**1.2 — Closedness must be *recursive*, not top-level.** D1 says "Unknown fields refuse `workflow_spec_invalid` naming the field" — but the schema nests: `members[].exact`, `members[].scope[]`, `steering.*` (five sub-objects), `harvest`, `verification`. A typo in a nested key (`steering.messageOnspawn`, `harvest.pathes`) must name that field. The recipe lane's pattern is the proven tool: `assertClosed` (`recipes.mjs:93`), `assertNoFunctions` (`:109` — a function smuggled into a known slot, e.g. `runWorkflow(spec)` called with an object whose `steering.messageOnSpawn.body` is a closure), and `deepFreeze` (`:81`). The contract must mandate all three **at every nesting level** and add a `schemaVersion` enum check (a spec with `schemaVersion: 999` must refuse, not silently treat as v1).

**1.3 — Scope `..` slips wave.mjs admission.** D1 reuses `wave.mjs`'s `validateMember` laws "verbatim" for scope globs. `validateMember` (`wave.mjs:63-88`) checks glob magic and the bare-directory heuristic but **never rejects `..`**; only the runtime matcher does (`pathScopeRegex`, `impl/src/path-scope.mjs:5` — rejects `..`-segments, absolute, backslash, NUL). So `scope: ["../**"]` passes admission and then **throws** `path_scope_invalid` on the first runtime scope check — a validation gap that surfaces as a late crash instead of `workflow_member_invalid`. The spec's member validation must reject `..`/absolute/backslash/NUL at admission (mirror `path-scope.mjs`), not inherit `validateMember` verbatim.

**1.4 — Steering sub-schema enums are unpinned.** The policy objects take enum-ish values that the contract never closes:
  - `messageOnSpawn.kind` / `signalOnMembersDone.message.kind` — the message lane accepts exactly `inform|query|steer` (`coordinator.mjs:6795`). A bad kind throws a bare `TypeError` (untyped) mid-loop.
  - `elevateWhenNotes.kinds` — the scratchpad lane accepts exactly `note|plan|doubt|link` (`coordination-store.mjs:507` `SCRATCHPAD_KINDS`). A garbage kind silently elevates nothing (a silent no-op, the class of failure W4 explicitly says harvest must not have).
  - `answerDecisions.policy` — see §4 below.
  - **Fix:** close each enum against the producer's own vocabulary and name the refusing code (`workflow_steering_unknown` exists in the vocabulary; the individual *values* must be validated too).

**1.5 — `objectiveRef` containment must be the realpath-standard, not a naive prefix check.** D5 says "containment-checked" without specifying the mechanism. The proven precedent is `resolveCredentialRef` (`impl/src/mcp-descriptor.mjs:46-72`): lexical `resolve` + `relative`-starts-with-`..` rejection **plus a `realpathSync` symlink-escape check**. A naive `resolve(repoRoot, ref).startsWith(repoRoot)` misses `repo/notes` → `/etc` symlinks and `repo/ok/../secret`. The contract must mandate the lexical + realpath double check and a byte bound (the recipe lane already bounds rendered objectives at 4096, `recipes.mjs:35`; the brief file should be bounded at admission, refusing `workflow_objective_ref_invalid` on oversize/missing/escape as the refusal vocabulary promises).

---

## 2. The import law (D2/W5) — **SOUND with two required clarifications**

**2.1 — "Pure evaluation over a frozen spec object" is enforceable if and only if the loader is `JSON.parse`-only.** JSON.parse cannot carry functions, prototypes, or accessors (the scratchpad lane already enforces the same invariants for entries, `coordination-store.mjs:530-557`). The contract must pin: parse → validate (closed) → deepFreeze → run. No `eval`, no `Function`, no `import()` of the spec path (an `import()` would be the executable escape — a `.json` file loaded as a module would crash, but a specPath loader that `require()`s an adjacent `.mjs` would execute it). **The one real executable escape in the current schema is `verification` (§1.1).** With `verification` removed or pinned, a JSON spec cannot carry executable content.

**2.2 — W5's static row is testable, with instrumentation.** "Importing the lane's module starts nothing (no wave, no spawn, no network)" is testable via the facade-staging idiom (`impl/test/workflow-surface-red.test.mjs`): import the interpreter module graph with mock adapters and assert a zero-spawn/zero-network counter. Two requirements the contract must add: (a) the **module graph** must not transitively import a module with a top-level `await openBaton(...)` — every current driver violates this (GT4), so the interpreter module and its imports must be audited; (b) the "no network" assertion needs a spawn-count oracle (the suite already has `ScriptableAdapter`-style mocks). As written, W5 names the *effect* but not the *oracle*; that is a test-design gap, not a design hole.

---

## 3. The steering policies (D3) — **HOLE (loop-forever class, blocker B5)**

**3.1 — `messageOnSpawn` "retried, never fatal" is an unbounded retry storm.** The contract (`workflow-as-data-contract.md:67-68`) says the send is retried through the spawn window and "never fatal". The demo's actual loop (`run-dynamic-workflow.mjs:221-231`) retries **every poll** until a real `messageId` marks it sent. With the shipped `pollIntervalMs: 20_000` and `hardCapMs: 3h` (`wave-driver.mjs:29,:31`), a member that never leaves the spawn window (or is claimed/attached by another driver) generates **~540 send attempts**, each receipted into `receipt.steering[]` — the "receipt grows unboundedly" half of the storm. The driver already has the bounded-retry precedent: `refusalNudgeBudget: 2` (`wave-driver.mjs:37-44`) is consumed on DELIVERED acknowledgment only. **Fix:** send-on-first-live where the live flag is authoritative, with a bounded retry budget (e.g. 3) keyed to a delivered `messageId`, then a named `steering_message_undelivered` evidence line and stop. "Never fatal" is fine; "retried forever" is not.

**3.2 — `elevateWhenNotes` "once per member" is ambiguous and failure-blind.** The contract (`:69-70`) says "maxEntries-bounded, once per member". Three gaps: (a) *once per member* vs *once per batch* — if a member writes notes after its elevation, does the policy refire? The demo (`run-dynamic-workflow.mjs:235-248`) skips re-elevation after the first success, so later notes are **never** elevated — a functional gap, not a loop, but the contract must say which. (b) On a refused elevation (`scratchpad_write_conflict`, `scratchpad_partition_exhausted` — `coordinator.mjs:10521-10522`), does it retry? Unbounded retry = refiring each poll. (c) The dedup key must be **durable** across a driver restart/attach (`waves.attach`), not an in-memory Set — otherwise a mid-wave attach re-fires. **Fix:** pin "once per member per wave", keyed durably by `(runId, role)`, with a bounded retry (≤2) on typed refusals and a named evidence line on final failure.

**3.3 — `answerDecisions` can misfire on a text pattern.** The policy (`:71-72`) is "a closed map of requestText-pattern → answer (optionId), or 'defer'". Attack classes: (a) **false positive** — an unanchored substring matches the *wrong* decision's question and auto-commits a canned answer; (b) **non-deterministic precedence** — two patterns matching one question, winner unspecified; (c) **invalid optionId** — the policy's answer is a bare string, but the live decision carries a real `options` array; answering with an optionId outside it mangles the worker's decision state; (d) **refire** — the same `(runId, requestId)` must be answered at most once, or it re-answers each poll. The wave-driver already provides both the dedup and the validation inputs: `decisionFired` keyed `` `${runId}:${requestId}` `` (`wave-driver.mjs:398-399,:591-592`) and the `onDecision` callback receiving `{ question, options, allowFreeResponse, recommended }` (`:599-612`). **Fix:** define match semantics (exact literal or anchored pattern, **first-match-wins** with the map iterated in insertion order), validate the chosen `optionId` against the live decision's `options` (or `allowFreeResponse` → send `text`), and dedup by `(runId, requestId)`; any non-match → `defer`.

**3.4 — `signalOnMembersDone` is bounded (SOUND).** It fires when the named roles reach terminal, sends to the *remaining* members, then stops — terminality is monotonic, so no loop. No action.

---

## 4. The harvest spec (D4) — **HOLE (blockers B1 and B2)**

**4.1 — B1: D4 is a regression to the matcher-by-convention it claims to end.** D4 says probe "the newest result pins then checkpoint pins for each path, verify content (non-empty; a per-path optional `mustContain` string)" and claims this "end[s] the matcher-by-convention misses (the campaign's three bespoke-matcher misses)". But **content-probing the newest pin IS the matcher-by-convention**. The campaign's own #99 work exists precisely to end it: the run's result section carries the **authoritative sha**, and `waves.attach` harvest reads exactly that (`harvest-accessor-contract.md:94-96`, `application.mjs:11364-11370`); `wave.mjs:390-406` materializes from the result section **first**, falling back to pin disambiguation only as a fallback. D4's "probe the newest result pins then checkpoint pins" is the *fallback*, promoted to primary. The proof it fails is on disk: the suite-wave and spec-wave both recorded **`harvested: none` despite all four members complete** (the third matcher miss, `orchestrator-friction-ledger.md:90`) — exactly the failure D4 would re-install. **Fix:** D4 must build on `run.resultpin`/`waves.harvest` (#99): per-path recovery from the run's authoritative result sha, `mustContain` demoted to a post-materialization *integrity check* (never the selection mechanism), and a named `harvest_miss` when the authoritative sha lacks the path.

**4.2 — B2: a pin probe can hit the WRONG pin belonging to a different wave.** Pins are **content-addressed** (`refs/baton/results/<sha>`, `coordination-store.mjs:356`) and the probe sorts by `creatordate` with **no waveId filter** — the current launcher does `for-each-ref refs/baton/results + refs/baton/checkpoints --sort=-creatordate` and takes the first hit (`run-wad-wave.mjs:105-123`). Consequences: (a) **W2 re-drive** re-runs the suite-wave with overlapping `harvest.paths`; the probe can attribute the *original* wave's pins (or a killed mid-wave checkpoint) to the re-drive; (b) **parallel waves** sharing an evidence dir collide; (c) the receipt carries `waveId` but the probe never binds to it. **Fix:** harvest must filter pins by the wave's own `waveId` (bind the wave's pins at start — the run records carry runIds; the receipt already surfaces `waveId`) and additionally verify the wave's attempt marker (`[attempt: <salt>]`) in harvested content before accepting.

**4.3 — `mustContain` spoofable.** A substring check on content passes if a *wrong* pin happens to contain the marker (a suite file whose header boilerplate mentions the topic, a checkpoint draft that already contains the final path). Without the wave/salt binding of 4.2, `mustContain` is a weak oracle. **Fix:** require the mustContain target to include the wave-salted attempt marker, or drop `mustContain` to a true post-check and rely on authoritative-sha attribution.

**4.4 — harvest paths are not containment-checked.** D4 never states that `harvest.paths` entries must resolve inside the repo. The launcher writes `writeFileSync(resolve(repo, entry.path))` (`run-wad-wave.mjs:123`) — a path like `../../etc/cron.d/x` or an absolute path writes **outside the repo**. The `objectiveRef` lane gets "containment-checked" (D5) but the *write* lane gets nothing. **Fix:** apply the `mcp-descriptor.mjs:46-72` lexical + realpath containment to every `harvest.paths` entry (and to the open-question-3 `onto:` subdir), refusing `workflow_harvest_invalid`.

**4.5 — the "non-empty" law has a magic 200-byte floor.** D4 says content is verified "non-empty"; the launcher silently skips any deliverable under **200 bytes** (`run-wad-wave.mjs:121`). A terse-but-valid red-team report or a 120-byte suite stub is silently dropped, and the wave marks `WAD-WAVE-INCOMPLETE` without naming a miss — the exact "silent miss" W4 forbids. **Fix:** drop the magic floor; a path present in the authoritative sha with non-empty content is a successful recovery, and a genuinely missing/short deliverable is a **named** `harvest_miss`.

---

## 5. The W2 re-drive claim — **SOUND (canonically), but the assertion needs pinning**

**5.1 — "(4 result_ready)" is canonically correct.** The reference suite-wave receipt records four terminals as `work_completed` (`suite-wave-receipt.json`, 4×), and `work_completed` canonicalizes to `result_ready` (`application-semantics.mjs:62` `work_completed: 'result_ready'`). So the contract's expected outcome is consistent with the reference — this is not the trap it first looks like.

**5.2 — "identical outcome shape" is untestable as written.** Identical to *what*, on *which* fields? The receipt embeds `attempt`/`salt`/`waveId`/pin shas that necessarily differ per run. The test must pin the **structural shape**: `outcomes` cardinality = 4, each `{role, phase→result_ready}` after canonicalization, `steering[]` and `harvest[]` with the same per-path receipt keys. As written, two runtimes could both pass "4 result_ready" yet differ in every other receipt key, and the test could not call either one wrong. **Fix:** W2 must name the exact shape assertion (outcome keys, canonical phases, harvest receipt keys), not the words "identical outcome shape".

**5.3 — "zero driver script" needs scoping.** The re-drive runs the interpreter + a spec file + the test harness — all code. The claim can only mean *no wave-specific bespoke driver script*. **Fix:** state it as "zero per-wave driver script; one shared interpreter", so the test asserts the suite-wave was driven from the spec, not that no code executed.

---

## 6. Refusal constancy (W6) — **HOLE (blocker B3)**

**6.1 — The MCP surface will not preserve `workflow_*` codes.** `stateFailureCode` (`impl/src/mcp-northbound.mjs:198-257`) is a hardcoded allowlist. It preserves `application_*`, `worker_policy_*`, `run_orchestrator_*` and a long explicit list — **none of the five new codes** (`workflow_spec_invalid`, `workflow_member_invalid`, `workflow_objective_ref_invalid`, `workflow_steering_unknown`, `workflow_harvest_invalid`) appear. A `workflow_spec_invalid` thrown by the facade degrades on the MCP surface to `command_outcome_unknown`. W6 is unpassable until the codes are added to the allowlist.

**6.2 — "Byte-identical refusal" is undefined at the transport level.** The three surfaces wrap errors differently: the facade **throws** an `Error`; the CLI **wraps** in a stderr brand line `✦(◕﹏◕)◦ baton: CODE: message` (`application-cli.mjs`, per `cli-surface-audit.md:68`) and re-uses the server's typed code only when it matches `^[a-z][a-z0-9_]{0,63}$` (so `workflow_spec_invalid` survives) but at HTTP body + non-zero exit; the MCP surface returns a JSON-RPC `toolError` (`mcp-northbound.mjs:195-196`) whose `code` is whatever `stateFailureCode` emits. "Byte-identical" across an `Error` object, an HTTP body, and a JSON-RPC result is not literal. **Fix:** redefine W6 as *identical `{code, message}` payloads via a pinned accessor* — extract the typed error object from each surface (throw / `body.error` / `structuredContent.error`) and compare the payload bytes. And add the five codes to `stateFailureCode`.

**6.3 — The CLI verb is a second drift point.** The existing CLI corrects the singular spelling: `baton wave attach` → "use the plural spelling: `baton waves attach`" (`application-cli.mjs:1309-1314`). D2 names the new verb `baton wave run` (singular) and the MCP tool `baton_wave_run` (singular), but the entire family — CLI `waves`, MCP `baton_waves_attach|start|progress|send|stop` (`mcp-northbound.mjs:44,:64-100`), and the registry canonical rows — is plural. A singular `wave run` verb either collides with the corrective or requires special-casing `run` inside the singular branch. **Fix:** resolve open question 2 now, in favor of `waves run` / `baton_waves_run` (the leaning), so the CLI parse branch and the MCP tool name are decided before W6 is written.

---

## 7. Open questions — verdicts

1. **`answerDecisions.policy` closed map vs bounded expression — DEFERRED, with required pins.** A closed map is fine for v1, but the contract must pin *now*: exact-match or anchored-match semantics, first-match-wins insertion order, and optionId validation against the live decision's `options` (§3.3). The bounded-expression generalization can come in v2 without breaking the map shape.
2. **`baton wave run` vs `baton waves run` — NOT fold-blocking on its own, but fold it NOW.** The established family is plural on both surfaces (CLI `waves`, MCP `baton_waves_*`, `application-cli.mjs:1309-1319`); D2's singular `baton wave run`/`baton_wave_run` is inconsistent. Fold the leaning (`waves run` / `baton_waves_run`) so B3's surface work has a fixed target. Deferred only in the sense that the name itself doesn't change the interpreter; it *does* change the CLI branch and the MCP tool registry that W6 touches.
3. **`onto:` (harvest into a subdir) — DEFERRED.** Additive and non-blocking, but the subdir must get the same lexical + realpath containment as `harvest.paths` (§4.4) or it becomes a second write-escape lane.

---

## 8. Per-decision verdicts

| Decision | Verdict | Fix |
|---|---|---|
| **D1** — closed spec | **HOLE** | Remove/pin `verification` (B4); recursive `assertClosed`/`assertNoFunctions`/`deepFreeze` at every level; `schemaVersion` enum; reject `..`/absolute/backslash/NUL in member scope at admission; close steering sub-schema enums against the producers' vocabularies (B6). |
| **D2** — the lane | **SOUND (conditional)** | One interpreter over the facade is the right shape, and W5's import row is testable with a spawn/network oracle. The conditions: `JSON.parse`-only loading, no `verification` execution unless pinned (B4), and a module graph with no top-level `openBaton`. The three-surface claim is what's broken — it belongs to W6 (B3). |
| **D3** — steering policies | **HOLE** | Bound `messageOnSpawn` retries (≤3, keyed to a delivered `messageId`); pin `elevateWhenNotes` once-per-wave with durable dedup and bounded retries; define `answerDecisions` match semantics + optionId validation + `(runId, requestId)` dedup (B5). |
| **D4** — harvest spec | **HOLE** | Rebuild on the #99 accessor (authoritative result sha per run, `mustContain` as a post-check); bind pins to `waveId` + attempt marker; containment-check every harvest path; drop the 200-byte floor for a named miss (B1, B2). |
| **D5** — objectives by reference | **SOUND (required spec)** | Adopt the `mcp-descriptor.mjs:46-72` lexical + realpath containment, a byte bound at admission, and a `workflow_objective_ref_invalid` on missing/oversize/escape. Optionally scope-bind the ref (a member's brief should live inside the member's own scope). |
| **D6** — the receipt | **SOUND (under-specified)** | `waveId`/`manifestDigest`/`steering`/`harvest` are clear; `verdict` and `basis` are undefined. Define them (verdict = outcome+harvest completeness; basis = the canonical phase map or the spec digest) or drop them from the shape. |

---

## 9. Final: **NOT FOLD-READY** — numbered blockers

**B1 — D4 harvest is a regression to matcher-by-convention.**
*What:* D4's "probe the newest result pins then checkpoint pins, verify non-empty + mustContain" is the exact content-probing heuristic the campaign's #99 accessor (`run.resultpin`/`waves.harvest`, authoritative result sha read at `application.mjs:11364-11370`) was built to end.
*Why:* The suite-wave and spec-wave both recorded `harvested: none` despite all members complete (`orchestrator-friction-ledger.md:90`) under this same probe; D4 re-installs the failure mode it claims to close.
*Fix:* D4 must bind harvest to the run's authoritative result sha via the #99 accessor, with `mustContain` demoted to a post-materialization integrity check and missing paths surfacing a named `harvest_miss`.

**B2 — Harvest can attribute the WRONG wave's pin.**
*What:* Pins are content-addressed (`coordination-store.mjs:356`) and probed by `creatordate` with no waveId filter (`run-wad-wave.mjs:105-123`); a W2 re-drive or a parallel wave with overlapping paths can be recovered from another wave's pin, and the receipt's `waveId` is never used to bind them.
*Why:* Content-sha refs + newest-first probing cannot distinguish "this wave produced this file" from "a prior/killed/parallel wave produced byte-similar content".
*Fix:* Filter pins by the wave's own `waveId` and verify the wave's attempt marker (`[attempt: <salt>]`) in harvested content before accepting.

**B3 — W6 refusal constancy is unpassable as written.**
*What:* The three surfaces wrap errors differently (facade throws; CLI re-wraps in a stderr brand at HTTP body + exit code; MCP maps through `stateFailureCode`, `mcp-northbound.mjs:198-257`, whose allowlist has **none** of the five `workflow_*` codes → `command_outcome_unknown`).
*Why:* "Byte-identical refusal" has no literal meaning across an `Error`, an HTTP body, and a JSON-RPC result; and the MCP surface degrades the typed codes before comparison is even possible.
*Fix:* Add the five `workflow_*` codes to `stateFailureCode`; redefine W6 as identical `{code, message}` payloads via a pinned accessor per surface.

**B4 — The `verification` field is an undefined executable escape.**
*What:* The schema carries `verification: {command, arguments}` with no consumer in D2/D6; if executed it is spec-carried RCE, if ignored it is dead schema (the recipe lane already removed `verification` for exactly this, `recipes.mjs:176-178`).
*Why:* The import law (D2) says a spec must never execute, but a spec that names a command to run after the wave is an executable escape unless explicitly pinned and contained.
*Fix:* Remove `verification` from the schema, or wire it to the pinned-verification mechanism (`coordinator.mjs:4652`) with `expectExit`, repo-worktree containment, and a `receipt.verification` verdict.

**B5 — Steering retries can loop forever / misfire.**
*What:* `messageOnSpawn` "retried, never fatal" has no bound (≈540 sends at 20s poll over a 3h hardcap for a stuck member, each receipted); `elevateWhenNotes` "once per member" is failure-blind and restart-unsafe; `answerDecisions` has unpinned match semantics, invalid-optionId risk, and no `(runId, requestId)` dedup guarantee.
*Why:* Unbounded per-poll retries violate the contract's own receipt discipline ("all events surfaced to `receipt.steering[]`" → unbounded growth); a wrong text-pattern match auto-commits a bad decision.
*Fix:* Adopt the wave-driver's bounded-retry and dedup precedents — `refusalNudgeBudget` (`wave-driver.mjs:37-44`), `decisionFired` keyed by `` `${runId}:${requestId}` `` (`:398-399`), and the `onDecision` callback's live `options` (`:599-612`). Bound messageOnSpawn retries ≤3 keyed to a delivered `messageId`; key elevation by durable `(runId, role)`; validate every answered `optionId` against the live decision's options.

**B6 — The closed schema is not closed recursively.**
*What:* Nested unknown fields, bad enum values (message kinds, scratchpad kinds, `schemaVersion`), function-smuggling via the object overload `runWorkflow(spec)`, and member-scope `..` entries all slip the current validation surfaces (`assertClosed`/`assertNoFunctions` are not required at every level; `wave.mjs`'s `validateMember` never rejects `..`; only `path-scope.mjs:5` does, at runtime).
*Why:* D1 promises "every malformed field refuses its named code" (W1); a nested typo or a `..` scope that crashes at runtime instead of refusing `workflow_member_invalid` is a silent validation hole.
*Fix:* Require recursive `assertClosed`/`assertNoFunctions`/`deepFreeze` (recipes.mjs:81-116 pattern) at every nesting level, close all enums against the producers' vocabularies, validate `schemaVersion`, and reject `..`/absolute/backslash/NUL in member scope at admission.

---

*Scope note: the NUL discipline — `grep -an`/`sed -n` were used only on `impl/src/application.mjs` and `impl/src/coordination-store.mjs` for NUL-byte checks; no NUL-bearing content was introduced. Every `file:line` above was re-verified at HEAD `3953f81` during this review.*
