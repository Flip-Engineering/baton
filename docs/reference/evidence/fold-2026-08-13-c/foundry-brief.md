# FOLD FOUNDRY wave-c — shared frame (multi-member SUITE-fold workflow, 2026-08-13)

Every member reads this first. The blue-team attacked the eight landed red-first suites and
named SHALLOW / DECORATIVE / BROKEN rows in each. This wave FOLDS those findings into the
suites — one row per suite. The suites are the campaign's acceptance machinery: after your
fold, no cheap wrong implementation passes your suite.

## The fold laws (bind every member)

- **RED honesty preserved:** every capability row still FAILS at HEAD at a named stage — the
  fold hardens rows against gaming; it never makes a row pass at HEAD (the impls don't
  exist). PIN rows stay green. If a blue-team finding says a row is red for the WRONG reason,
  the fold fixes the reason — the row stays red for the RIGHT one.
- **Every blue-team finding gets exactly one of:** FOLDED (the suite changed — cite the new
  row/assertion) / STRUCK (evidence: reproduce why the finding doesn't hold) / ESCALATED (why
  it can't be folded honestly). No silent drops.
- **Re-run the split TWICE** after your edits; record both in your fold notes (new totals).
- **The suite's existing `[attempt: …]` header line is SACRED** — do not touch it. YOUR fold
  notes carry YOUR OWN objective's attempt line, verbatim, first five lines.
- **Suite law holds:** hermetic (mkdtemp + after-cleanup, no network/providers), no clocks as
  controls, namespace imports for invented surfaces, sorted-key literals ACTUAL order,
  `localeCompare` banned, `watchdog.stallMs: 60_000` + comment in fixtures you touch, no
  absolute line-window anchors.
- Where a blue-team finding conflicts with the CONTRACT (the authority), the contract governs
  — record the resolution. Judgment calls are yours — record them. Authority-class ambiguity →
  DECISION_REQUEST with options.
- **Do not write outside your scope.** Your deliverables are your suite file (in place) and
  your fold notes — both at the paths your member spec declares, under YOUR worktree (verify
  `pwd` shows the `ws-*` worktree before writing; a write that lands in the main checkout is
  the #scope-escape incident class — report it if your environment points you there).

## Row assignments (suite → blue-team report → fold notes)

- `row-sf155` → `impl/test/cli-silent-start-red.test.mjs` → `blue-team-2026-08-13-a/blueteam-155.md` → `fold-suite-155.md`
- `row-sf156` → `impl/test/mcp-profile-parity-red.test.mjs` → `blueteam-156.md` → `fold-suite-156.md`
- `row-sf157` → `impl/test/cli-wave-fidelity-red.test.mjs` → `blueteam-157.md` → `fold-suite-157.md`
- `row-sf158` → `impl/test/scratchpad-write-red.test.mjs` → `blueteam-158.md` → `fold-suite-158.md`
- `row-sf159` → `impl/test/doc-truth-conformance-red.test.mjs` → `blueteam-159.md` → `fold-suite-159.md`
- `row-sf160` → `impl/test/error-actionability-red.test.mjs` → `blueteam-160.md` → `fold-suite-160.md`
- `row-sf161` → `impl/test/orchestrator-plan-object-red.test.mjs` → `blueteam-161.md` → `fold-suite-161.md`
- `row-sf164` → `impl/test/blind-waits-red.test.mjs` → `blueteam-164.md` → `fold-suite-164.md`

Fold notes land in the suite's OWN evidence dir (the one named in the suite header's Authority
line): `docs/reference/evidence/<that-dir>/fold-suite-<issue>.md`.
