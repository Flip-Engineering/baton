# #114 FOLD BRIEF — contract v1.0 → v1.1 + suite fold (read after the red-team report)

You are FOLDING an adversarial red-team report into the workflow-as-data contract AND its red-first
suite. Read fully, in order: (1) `contract-redteam.md` (verdict NOT FOLD-READY, blockers B1-B6,
open-question verdicts, per-decision table) in this directory; (2) `workflow-as-data-contract.md`
(v1.0 — your first edit target); (3) `impl/test/workflow-as-data-red.test.mjs` (your second edit
target) and `suite-draft-notes.md` in this directory.

## PHASE 1 — fold the contract to v1.1 (every blocker)

- **B1** — D4 harvest must build on the #99 harvest-accessor: per-path recovery from the run's
  authoritative result sha; `mustContain` demoted to a post-materialization integrity check, never
  the selection mechanism; a missing path is a NAMED `harvest_miss`.
- **B2** — harvest binds pins to the wave's own `waveId` and verifies the attempt marker before
  accepting.
- **B3** — add the five `workflow_*` refusal codes to the MCP `stateFailureCode` allowlist as
  contract-required work; redefine W6 as identical `{code, message}` payloads via a pinned
  accessor per surface (throw / `body.error` / `structuredContent.error`).
- **B4** — REMOVE the `verification` field from the schema (the `recipes.mjs` precedent) OR pin it
  to the coordinator pinned-verification mechanism with `expectExit` + repo containment +
  `receipt.verification`; pick one and say why.
- **B5** — bound `messageOnSpawn` retries ≤3 keyed to a delivered `messageId`, then a named
  `steering_message_undelivered` evidence line; `elevateWhenNotes` exactly once per member per wave
  keyed durably by `(runId, role)` with ≤2 retries on typed refusals; `answerDecisions`
  exact-or-anchored match, first-match-wins in insertion order, `optionId` validated against the
  live decision's `options` (or `allowFreeResponse` → text), dedup by `(runId, requestId)`,
  non-match defers.
- **B6** — recursive `assertClosed`/`assertNoFunctions`/`deepFreeze` at EVERY nesting level per
  `recipes.mjs:81-116`; `schemaVersion` enum check; member scope rejects `..`/absolute/backslash/NUL
  at ADMISSION mirroring `path-scope.mjs` (not `validateMember` verbatim); close every steering enum
  against the producer vocabularies (message kinds `inform|query|steer`, scratchpad kinds
  `note|plan|doubt|link`).
- Fold open question 2 NOW: the verb is `waves run` / `baton_waves_run` (plural family).
- Fix the red-team §0 citation corrections: GT1 default finalization is `none` (not
  `claim-on-stall`); GT2 says six drivers not five; D3 `worker_spawning` is spec-not-shipped — mark
  it as a depending-on-#97 row.

## PHASE 2 — fold the suite to v1.1 semantics

Track every contract change: W1 gains recursive-closedness rows (nested unknown field named; bad
enum value refused; `schemaVersion: 999` refused; scope `..` refused at admission as
`workflow_member_invalid`); W3 rows assert the BOUNDS (a fourth `messageOnSpawn` retry does NOT
fire; elevation refires are deduped; a mismatched `answerDecisions` pattern defers; an invalid
`optionId` refuses); W4 rows rebuild on the authoritative-sha accessor (`mustContain` is a
post-check; waveId binding; a missing path receipts a named `harvest_miss`; harvest-path
containment refuses `workflow_harvest_invalid`); W5 unchanged in substance; W6 becomes the
pinned-accessor payload comparison (facade throw vs CLI `body.error` vs MCP
`structuredContent.error`) with the five codes in `stateFailureCode` as a named stage. Every row
stays RED at a named stage (the lane is still unimplemented) — update stage names where the v1.1
semantics moved them. Update the header row inventory + `suite-draft-notes.md` (new verified split
— run `node --test impl/test/workflow-as-data-red.test.mjs` from the repo root twice and record
the stable split).

## Laws

No clocks; every citation verified with `grep -an`/`sed -n` (NUL files: `application.mjs` +
`coordination-store.mjs` only); sorted-key literals in ACTUAL sorted order; `localeCompare` banned.
Contract header to **v1.1** with the fold note. Write the fold summary (blocker → change map, both
phases) to `contract-fold.md` in this directory. Edit ONLY: the contract, the suite,
`suite-draft-notes.md`, `contract-fold.md`.
