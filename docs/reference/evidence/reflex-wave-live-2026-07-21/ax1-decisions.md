# AX-1 decisions contract — blocked_interaction classification + required-action projection

Ground truth: issue #10 (2026-07-21 comment), docs/32 §5, `impl/src/application.mjs`
(`runProgress` ~:1307, `_buildView`, `_progressTiming` ~:6815, `listRuns` ~:9646),
`impl/src/application-cli.mjs` outline rendering, MockAdapter `ask` scenarios
(`impl/src/adapter.mjs:580-606`).

## Rules

1. **Classification.** A Run's outline gains `blockedInteraction: null | { kind, summary }`
   computed from current state: no approval → `{kind:'approve_plan'}`; phase
   `selection_required` → `{kind:'select_candidate'}`; a pending worker question/approval →
   `{kind:'answer_question', summary}` where summary is a bounded (≤160 bytes, NFC, no
   credential-shaped text) projection of the pending request's question — never worker prose
   beyond the request text itself. Forward-compatible `kind:'decision'` is reserved (issue #16)
   but not emitted.
2. **Projection points.** `run.status`/`run.wait` outline, `runs.list` items, and the CLI
   `baton run status` outline render `blockedInteraction` identically from one projection
   helper (no divergent copies). `attention` keeps its current semantics; blockedInteraction is
   additive, never a replacement.
3. **Meaningful progress.** The `lastProgress` age MUST NOT advance on repeated thought/tool
   telemetry (it already derives from coordination events); add one test pinning that a burst
   of provider thought/tool events leaves `lastProgress.at` unchanged.
4. **Red tests first** (`impl/test/issue10-blocked-interaction-red.test.mjs`): approve_plan
   classification pre/post approval; answer_question with a MockAdapter blocking `ask` (question
   text projected bounded/sanitized); select_candidate on an operator-join workflow; no
   classification while running/blocked-none; CLI outline parity; the meaningful-progress pin.
5. **Boundaries.** No new ledger event kinds; no behavior change to settlement machinery; no
   decision channel (that is REFLEX-1/issue #16); sanitized projections only; no doc edits
   beyond `docs/PROGRESS.md` if a count changes. Do NOT modify settlement paths
   (`coordinator.respond`, `adapter.answer`).
6. **Validation.** Focused new suite green; then `node impl/scripts/run-suite.mjs` green from
   the worktree root. No git commits, no scratch/log writes anywhere (including /tmp).
