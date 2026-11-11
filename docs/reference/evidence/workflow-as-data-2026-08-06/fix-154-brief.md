# #154 FIX BRIEF — the harvest mustContain verdict bug (red-first, small)

Issue #154: the interpreter's harvest retrieves the file content at the member's result pin
(the receipt's `bytes`/`actual` carry it, marker verbatim) yet records `matched: false,
code: harvest_miss` and drops the wave to WAVE-INCOMPLETE. Live evidence: the #147 dogfood
wave (receipt at `docs/reference/evidence/control-surface-audit-2026-08-13/`).

## The task (red-first, then fix)

1. **Red row first.** In `impl/test/workflow-as-data-red.test.mjs` (the interpreter's own
   suite — read its header idioms and the harvest rows it already has): add a row that drives
   a wave whose harvest declares `mustContain` matching the file's first line, and asserts
   `matched: true`, `code: harvest_ok`, verdict `WAVE-OK`. Confirm it fails at HEAD at a named
   stage (`harvest-match-evaluation-missing` or as the row inventory names it).
2. **The fix.** `impl/src/workflow-interpreter.mjs` `harvestOne` (:597-639 area): the
   retrieval works (`bytes`/`actual` populate) — the defect is between retrieval and the
   `matched` evaluation (comparison type, normalization asymmetry, or the miss code written
   before the match check). Fix the evaluation ONLY; do not touch retrieval, the steering
   lanes, or the D6 receipt shape.
3. **Green proof.** The new row passes; the whole suite passes
   (`node --test impl/test/workflow-as-data-red.test.mjs` from the repo root); adjacents
   `wave-observability-red` + `worker-orchestrated-swarm-red` stay green.

## Laws

No clocks; sorted-key literals ACTUAL order; `localeCompare` banned; NUL discipline; boundary
commits (#141). Deliverables: the suite row + the one-file fix + a 10-line note in
`docs/reference/evidence/workflow-as-data-2026-08-06/fix-154-notes.md` (root cause in one
sentence).
