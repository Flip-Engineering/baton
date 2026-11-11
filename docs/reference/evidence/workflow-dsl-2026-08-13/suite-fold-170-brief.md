# ROW BRIEF — suite-fold-170: harden the #170 DSL suite per its blue-team (single-member wave)

Your raw material (all landed on master):
- The suite: `impl/test/workflow-dsl-red.test.mjs` (31 rows, split 5/26 — RED-first, verified)
- The blue-team attack: `docs/reference/evidence/blue-team-2026-08-13-b/blueteam-170.md` (9
  SHALLOW rows named + 7 concrete fold instructions in its §4)
- The contract: `docs/reference/evidence/workflow-dsl-2026-08-13/workflow-dsl-contract.md`
  (FOLDED — your authority for intent)

## The fold (apply all seven instructions from blueteam-170.md §4)

1. Add the `answerDecisions` behavioral row (incl. the repeatable-accumulation leg) — the
   totality claim must be behavioral, not registry-only.
2. Add the symlink-escape row — a `harvest` path that is a symlink resolving outside
   `repoRoot` refuses `workflow_harvest_invalid` when `repoRoot` is provided AND compiles when
   omitted (pins the B3 gating itself).
3. Resolve the S5 shared-module drift — accept the shared-constants-module form in S5 (a
   compiler importing `IDEMPENCY_PATTERN`/`MAX_MEMBERS`/`MESSAGE_KINDS`/`SCRATCHPAD_KINDS` from
   a shared module must pass; the blue-team's probe shows the current regexes reject it) —
   OR strike the shared-module alternative from S5. Prefer acceptance; the contract sanctions
   both forms.
4. Repair P6's facade leg — scope to the `waves` accessor (`/waves[\s\S]{0,400}compile/`) and
   accept both property and method-shorthand spellings.
5. Widen R1 to 2–3 distinct unknown-directive names, each asserted in `field` with the same
   closed-list `expected`.
6. Add the compiler-source code-family scan (every `workflow_*` literal the compiler throws is
   within the closed 5-code family — the compiler-facing twin of PIN-B).
7. Probe the bare `harvest <path>` form (no mustContain) and the explicit `false` steering
   forms.

## The fold laws (binding)

- **RED honesty preserved:** every capability row still FAILS at HEAD at a named stage — the
  fold makes rows harder to game, never greenable. New rows are RED with named stages too.
  PIN rows stay green.
- **Re-run the split TWICE** after your edits; record both in your fold notes with the new
  totals.
- **Preserve the verbatim `[attempt: ea57954b-95c1-4918-a494-41b0249738ee row-suite-170]`
  header line** in the suite file — do not touch it. YOUR fold notes carry YOUR OWN
  `[attempt: <salt> suite-fold-170]` line from your objective, verbatim, first five lines.
- Suite law holds: hermetic, no clocks, sorted-key literals ACTUAL order, `localeCompare`
  banned, watchdog.stallMs 60_000 + comment in any fixture you touch, no absolute line-window
  anchors.
- Where a fold instruction conflicts with the contract text (e.g. S5), the contract governs —
  record the resolution in your notes. Judgment calls are yours — record them.
  Authority-class ambiguity → DECISION_REQUEST with options.

## Deliverables (edit ONLY these)

1. `impl/test/workflow-dsl-red.test.mjs` (in place).
2. `docs/reference/evidence/workflow-dsl-2026-08-13/suite-fold-170.md` — the instruction →
   resolution map + both measured splits (the harvest artifact).
