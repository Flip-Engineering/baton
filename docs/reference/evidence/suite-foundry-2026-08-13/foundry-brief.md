# SUITE FOUNDRY — shared frame (multi-member red-first suite workflow, 2026-08-13)

Every member reads this first. This wave drafts FOUR red-first acceptance suites in parallel —
one per row — for the folded honesty-cluster contracts. The coordinator verifies each suite's
split and discrimination independently.

## The suite law (binds every row — the campaign's red-first doctrine)

- **Red-first:** every capability row FAILS at a NAMED stage at HEAD (the stage in the
  assertion message); every PIN row is GREEN at HEAD and guards landed behavior the contract
  says is unchanged. A PIN red at HEAD is a suite defect; a capability row green at HEAD is no
  row at all.
- The contract's red-first acceptance section is your row inventory — every pin becomes a row,
  at its named stage.
- **Hermetic:** mkdtemp fixtures, test.after cleanup, no network, no real provider spawns, no
  host state. No clocks as controls (fake timers are test doubles, never workflow controls).
- Namespace imports for invented surfaces (`import * as ns from '../src/x.mjs'` — the correct
  impl exposes exactly those names; today they are undefined and the row fails at its stage).
- Sorted-key literals in ACTUAL sorted order; `localeCompare` banned. NUL discipline reading
  `application.mjs`/`coordination-store.mjs` (`grep -an`/`sed -n` only).
- `watchdog.stallMs` must be a VALID POSITIVE integer in every fixture (the #67 admission law —
  `60_000` with the one-line fixture comment); `stallAction` only from the contract vocabulary.
- Static source anchors: ORDER/EXISTENCE/byte-string assertions only — never absolute line
  windows (the #166-law-in-advance; they drift on every landing).
- **Verify:** `node --test impl/test/<your-suite>` from the repo root TWICE; record both
  stable splits in the file header (row inventory + stages + invented signatures + the
  verified split).
- **THE ATTEMPT-ECHO LAW (#171):** your objective opens with an `[attempt: <salt> <role>]`
  line — carry it VERBATIM into your suite-draft-notes header (and leave the suite file's own
  header with its standard inventory header). No echo, no harvest.

## Row assignments (your objectiveRef names yours; the contract-fold is your source of truth)

- `row-suite-157` → `cli-wave-fidelity-2026-08-13/contract-fold.md` → `impl/test/cli-wave-fidelity-red.test.mjs`
- `row-suite-158` → `scratchpad-write-2026-08-13/contract-fold.md` → `impl/test/scratchpad-write-red.test.mjs`
- `row-suite-159` → `doc-truth-conformance-2026-08-13/contract-fold.md` → `impl/test/doc-truth-conformance-red.test.mjs`
- `row-suite-160` → `error-actionability-2026-08-13/contract-fold.md` → `impl/test/error-actionability-red.test.mjs`

Each row also writes its `suite-draft-notes.md` in the CONTRACT's evidence dir (the row
inventory + stage table + verified split). Publish your notes to `shared` when done.
