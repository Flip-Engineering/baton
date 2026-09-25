# #67 RETHEAD BRIEF — retire the `stallMs: 0` "disable watchdog" test idiom (88 sites, 25 files)

The #67 impl (APPLIED in the tree you inherit — `createDriver` now refuses
`watchdog_stall_exceeds_wall` for a non-positive or wall-exceeding `stallMs` at the deployment
seam, `impl/src/index.mjs`). The pre-#67 idiom `watchdog: { stallMs: 0 }` meant "watchdog
disabled for this fixture" and now throws at setup. Your job: re-thread every site where
`stallMs: 0` is the DISABLE idiom to a valid positive value, and PRESERVE every site where
`stallMs: 0` is the refusal-test payload.

## Read first

(1) `docs/reference/evidence/stall-watchdog-2026-08-07/impl-67-notes.md` (what landed; the
"Known follow-up" section is your task statement); (2) the F1 fold's re-thread pattern in
`impl/test/stall-watchdog-red.test.mjs` rows D1/D2/D5 — the model: a valid positive `stallMs`
(`100`–`60_000` by the row's window) with `stallAction: 'escalate'` and a fixture-contract
comment ("valid positive stallMs; the sweep is driven through the injected now()/tick() seam"
or "watchdog never fires in this window"), NEVER `stallAction: 'none'` (outside the contract
vocabulary).

## The per-site judgment (the whole task)

- **KEEP** `stallMs: 0` exactly where the row ASSERTS the refusal
  (`watchdog_stall_exceeds_wall` — e.g. the A3-class rows in `stall-watchdog-red.test.mjs`).
  These rows are green BECAUSE it throws. Touching them breaks the pin.
- **RE-THREAD** every site where `stallMs: 0` meant "disabled": replace with a valid positive
  value sized to the row (default `60_000`; smaller only where the row's own window is
  smaller), keep the row's other options, add the one-line fixture-contract comment.
- Red suites must keep failing AT THEIR NAMED STAGES — each red suite's header carries the row
  inventory + stages; after your edit the failure stages must match the header EXACTLY (a
  setup-throw instead of the named stage is a corrupted suite).

## Affected files (grep-verified, 88 sites)

board-workerhalf-red · briefing-pack-red · harvest-accessor-red · nested-orchestration-red ·
orchestrator-wake-red · phase11-acceptance-integration · phase11-concurrent-grok-reap ·
phase11-coordination-store · phase11-governance · phase12-web-northbound ·
phase26-structured-merge · phase50-cairn-scratch-correction · phase56-drain-and-close ·
phase57-adversarial-governance · phase57-provider-callback-integrity ·
phase57-provider-governance · phase57-provider-turn-release ·
phase58-driver-sparse-projection · phase75-task-topology ·
phase91-semantic-interrupt-preservation-red · reflex2-boards-red · reply-chains-red ·
stall-watchdog-red (refusal rows KEEP 0 — judge per row) · tight-cell-red ·
workflow-surface-red (all under `impl/test/`, `.test.mjs`).

## Verify (before you finish)

For EVERY touched file, from the repo root: `node --test impl/test/<file>` — green suites
pass; red suites fail at exactly the header's named stages. Record the per-file outcome table
in your notes. No impl/src edits (your boundary is `impl/test/**` ONLY). No clocks; NUL
discipline reading `application.mjs`/`coordination-store.mjs`.

## Deliverables

The 25 edited test files (or fewer if a file's every site is a refusal row — say so in the
notes) · `docs/reference/evidence/stall-watchdog-2026-08-07/rethread-67-notes.md` (the
per-file outcome table + any site you kept and why).
