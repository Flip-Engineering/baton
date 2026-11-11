# #61 SUITE-FOLD BRIEF — fold the blue-team findings into the worker-verdict-surface suite

You are folding a blue-team report into the #61 red-first suite. Read fully, in order: (1)
`suite-blueteam.md` (NEEDS-FOLD — axis 1 greenable except its named findings; G1's 1200-char
window fragility and every later finding, each with its concrete fix); (2)
`impl/test/worker-verdict-surface-red.test.mjs` (your primary edit target); (3)
`contract-fold.md` (v1.1 — edit ONLY if a finding requires contract movement; v1.2 note if
so); (4) `suite-draft-notes.md` (update).

## Priorities (per the report)

- **Green-side fragility first** — G1: the 1200-char source window for `worktreeHarvestPolicy`
  can reject a CORRECT placement (the slice ends mid-`integrationPolicy`); apply the report's
  fix (anchor the full `applicationProfile` object span, not a char window).
- Every later finding in the report in its numbered order — each carries its concrete fold.
- Suite stays red-first: PINs green, capability rows RED at named stages. Run twice from the
  repo root, record both splits. No clocks; sorted-key literals ACTUAL order; `localeCompare`
  banned; NUL discipline; hermetic. `watchdog.stallMs` valid-positive in every fixture (the
  #67 law); `stallAction` only from the contract vocabulary.

## Deliverables (edit ONLY these)

`impl/test/worker-verdict-surface-red.test.mjs` ·
`docs/reference/evidence/worker-verdict-surface-2026-08-12/suite-draft-notes.md` ·
`docs/reference/evidence/worker-verdict-surface-2026-08-12/suite-fold-2.md` (finding →
resolution map) · `contract-fold.md` (v1.2 ONLY if a finding requires contract movement).
