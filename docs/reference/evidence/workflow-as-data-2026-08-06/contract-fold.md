# Issue #114 — fold map: red-team blockers → v1.1 contract + suite changes

- **Fold:** `contract-redteam.md` (verdict **NOT FOLD-READY**, blockers B1-B6) into
  `workflow-as-data-contract.md` v1.1 and its red-first suite
  `impl/test/workflow-as-data-red.test.mjs`.
- **Result:** v1.1 FOLDED — all six blockers folded (no deferrals); open question 2 folded NOW
  (verb = `waves run` / `baton_waves_run`); open questions 1 and 3 deferred with their red-team
  pins absorbed. §0 citation corrections applied.
- **Date:** 2026-08-06. HEAD 3953f81.

## Phase 1 — contract v1.0 → v1.1 (blocker → decision)

| Blocker | v1.0 hole | Contract change in v1.1 |
|---|---|---|
| **B1** — D4 harvest is a regression to matcher-by-convention | D4 probed "newest result pins then checkpoint pins" + non-empty/mustContain — the content-probing heuristic #99 was built to end; suite/spec waves recorded `harvested: none` under it | **D4** rebuilt on the #99 harvest-accessor: per-path recovery from the run's **authoritative result sha** (the `run.inspect { depth: 'section', section: 'result' }` section read, `application.mjs:11364-11370`). `mustContain` demoted to a **post-materialization integrity check** — never the selection mechanism. A path missing from the authoritative sha receipts a **named `harvest_miss`** — no silent drop, no 200-byte floor. W4 pins it. |
| **B2** — harvest can attribute the WRONG wave's pin | Pins are content-addressed and probed newest-first with **no waveId filter**; a W2 re-drive or parallel wave with overlapping paths could be recovered from another wave's bytes | **D4** recovery is **waveId-bound**: the accessor reads the wave's OWN runs (the receipt's `waveId` is the binding key), and the wave's attempt marker (`[attempt: <salt>]`) is verified in harvested content before accepting — a wrong/parallel wave's byte-similar pin cannot be attributed. W4 asserts `entry.waveId === receipt.waveId` and `entry.resultSha === outcome.resultSha` on every harvest receipt. |
| **B3** — W6 refusal constancy is unpassable as written | Facade throws, CLI re-wraps at body/exit, MCP maps through `stateFailureCode` whose allowlist has none of the five `workflow_*` codes → `command_outcome_unknown` | **(a)** `stateFailureCode` (`mcp-northbound.mjs:198-260`) gains the five `workflow_*` codes as **contract-required work** (new "Contract-required work (B3)" section). **(b)** W6 redefined as identical `{code, message}` payloads via a **pinned accessor per surface** (facade throw / CLI `body.error` / MCP `structuredContent.error`). New suite stage `state-failure-allowlist-missing` (W6-02). |
| **B4** — `verification` is an undefined executable escape | Schema carried `verification: {command, arguments}` with no consumer in D2/D6 — executed it is spec-carried RCE, ignored it is dead schema | **D1** REMOVES `verification` from the schema (the recipes-lane precedent R-DC-6, `recipes.mjs:249`), and states the removal's reason: undefined-consumer field = dead schema, executed-consumer = the executable escape the import law forbids. A spec carrying `verification` at all refuses `workflow_spec_invalid` naming the field. W1-01 pins the refusal. |
| **B5** — steering retries can loop forever / misfire | `messageOnSpawn` unbounded retries; `elevateWhenNotes` failure-blind + restart-unsafe; `answerDecisions` unpinned match semantics / no optionId validation / no dedup | **D3** adopts the wave-driver precedents (`refusalNudgeBudget`, `decisionFired` by `` `${runId}:${requestId}` ``, the `onDecision` live `options`): `messageOnSpawn` **≤3 total** keyed to a DELIVERED `messageId`, then a named `steering_message_undelivered` evidence line and STOP; `elevateWhenNotes` **exactly once per member per wave** keyed durably by `(runId, role)`, typed-refusal retries **≤2**; `answerDecisions` exact-or-anchored match, **first-match-wins** insertion order, `optionId` validated against the live decision's options (or `allowFreeResponse` → send `text`), **`(runId, requestId)` dedup**, non-match → `defer`. W3 gains the three bounds rows. |
| **B6** — the closed schema is not closed recursively | Nested unknown fields, bad enum values, function-smuggling, and member-scope `..` all slip validation | **D1** requires recursive `assertClosed` / `assertNoFunctions` / `deepFreeze` at EVERY nesting level (the `recipes.mjs:81-116` pattern); `schemaVersion` is an enum (`1` only); the steering sub-schema enums are closed against the producers' vocabularies (message kinds `inform\|query\|steer` `coordinator.mjs:6795`, scratchpad kinds `doubt\|link\|note\|plan` `coordination-store.mjs:507`); member scope admission mirrors `path-scope.mjs` (rejects `..` / absolute / backslash / NUL) — never `wave.mjs` `validateMember` verbatim — refusing `workflow_member_invalid` AT ADMISSION. W1 rows gain the nested/function/enum/scope cases. |

### Open question 2 — FOLDED NOW

The verb is the **family plural**: `baton waves run` / `baton_waves_run` (the existing family is
plural on both surfaces: CLI `waves`, MCP `baton_waves_attach|start|progress|send|stop`). This
gives B3's surface work a fixed target. Folded into D2; pinned by W6-01.

### §0 citation corrections (applied)

| Correction | v1.1 text |
|---|---|
| GT1 — default finalization is `none` | The wave driver's shipped vocabulary has `finalization` defaulting to **`none`**; `claim-on-stall` is opt-in, not the default. |
| GT2 — six drivers, not five | The six bespoke drivers are listed with their MIXED receipts (`BD3-LIVE-OK`, `BLUE-WAVE-OK`; `SPEC-WAVE-INCOMPLETE`, `SUITE-WAVE-INCOMPLETE`, `DYNAMIC-WORKFLOW-INCOMPLETE`) — the incomplete harvests are on-disk evidence for B1. |
| GT6/D3 — `worker_spawning` is spec-not-shipped | #97's typed `worker_spawning` refusal is absent at HEAD (the live `run.message.send` returns `worker_not_active`/`run_not_active`); the retry vocabulary is a **depending-on-#97 row**, and the real receipt is the demo's `messageId`-marks-sent pattern (`run-dynamic-workflow.mjs:218-230`). |

### Deferred (with red-team pins absorbed)

- **OQ1** — `answerDecisions.policy` as bounded expression vs closed enum map: DEFERRED to v2;
  the v1 pins (exact-or-anchored, first-match-wins, optionId validation, dedup, defer-on-non-match)
  are already in D3.
- **OQ3** — `harvest.onto:` subdirs: DEFERRED (additive); if added, the subdir gets the same
  lexical + realpath containment as `harvest.paths`.

## Phase 2 — suite fold (contract change → suite row)

| Contract change | Suite rows (all red at a named stage unless noted) |
|---|---|
| `verification` REMOVED (B4) | W1-01 gains the `verification` refusal case (carrying it at all → `workflow_spec_invalid` naming the field); `validSpec()` drops the field. |
| Recursive closure + function smuggling (B6) | W1-01 gains the function-at-`steering.messageOnSpawn.body` case; W1-04 gains nested unknown fields (`bogusNested` in `messageOnSpawn`) and bad enum values (message kind `'bogus'`, scratchpad kinds). |
| `schemaVersion` enum (B6) | W1-01 gains `schemaVersion: 999` (and absent) refusing naming the field. |
| Member-scope admission mirrors path-scope.mjs (B6) | W1-02 gains `scope: ['../**']` refusing `workflow_member_invalid` naming the entry AT ADMISSION (stage `member-validation-missing`); W1-05 gains harvest-path escape cases (`'../outside.md'`, `'/etc/cron.d/x'` → `workflow_harvest_invalid`). |
| `waves run` / `baton_waves_run` plural verb (OQ2) | W6-01 uses `parseBatonCli(['waves', 'run', specPath])` and `mcpApplicationToolNames().includes('baton_waves_run')`. |
| MCP `stateFailureCode` allowlist adds the five codes (B3) | W6-02 (stage `state-failure-allowlist-missing`): static source check requiring each of the five codes as a quoted literal inside `stateFailureCode` (the allowlist region). |
| W6 = pinned-accessor `{code, message}` payload comparison (B3) | W6-01 asserts `{code, message}` identity across facade throw / CLI `body.error` / MCP `structuredContent.error` (no byte-identity of text blobs). |
| `messageOnSpawn` ≤3 keyed to a delivered `messageId`, then `steering_message_undelivered` (B5) | W3-message-bounds (stage `policy-missing:message-on-spawn`): `MessageDeafAdapter`, `attempts.length === 3`, exactly one `steering_message_undelivered` line, a fourth retry does NOT fire. |
| `elevateWhenNotes` exactly once per `(runId, role)` with refires deduped, ≤2 retries (B5) | W3-elevate-bounds (stage `policy-missing:elevate-when-notes`): `RepeatedNoteWritingAdapter` over 2 edits, exactly one elevate event. |
| `answerDecisions` exact-or-anchored first-match-wins, optionId validation, `(runId, requestId)` dedup, non-match defers (B5) | W3-answer-bounds (stage `policy-missing:answer-decisions`): non-matching pattern defers (no answer call); invalid `optionId` refuses (never committed + refusal receipted). |
| D4 harvest on the #99 authoritative-sha accessor, `mustContain` post-check, waveId-bound, named `harvest_miss` (B1, B2) | W4-01 and W4-02 assert `miss.code === 'harvest_miss'`, `entry.waveId === receipt.waveId`, `entry.resultSha === outcome.resultSha`, and both receipts distinct for a mixed harvest. |
| Steering triggers + evidence names surfaced | Suite header lists the seven sorted triggers plus the two named evidence lines (`steering_message_undelivered`, `harvest_miss`). |

## Verification

- **Suite split (verified, twice, from the repo root):** `node --test impl/test/workflow-as-data-red.test.mjs`
  → **tests 25 · pass 4 (P1-P4) · fail 21**, stable across both runs. Every red row fails at its
  named stage. Row map in `suite-draft-notes.md`.
- **Deployment gate:** executable `"true"`, args `[]`, cwd `.`, expected exit 0 — unchanged by this
  fold (the suite is the rung's red-first acceptance, not the deployment gate).
- **Laws:** no clocks; every citation verified with `grep -an`/`sed -n`; NUL-byte discipline kept
  (suite reads only the NUL-free files whole: itself, `workflow-lane.mjs`, `mcp-northbound.mjs`).
