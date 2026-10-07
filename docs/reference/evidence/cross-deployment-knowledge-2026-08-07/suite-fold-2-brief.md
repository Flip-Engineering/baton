# #70 SUITE-FOLD BRIEF — fold the blue-team findings into the cross-deployment-knowledge suite

You are folding a blue-team report into the #70 red-first suite. Read fully, in order: (1)
`suite-blueteam.md` (NEEDS-FOLD — **5 of 19 RED rows are green-side blockers** (structurally
unsatisfiable by a correct v1.1 implementation), plus minor findings F2.2/F2.4 and the §140
minor); (2) `impl/test/cross-deployment-knowledge-red.test.mjs` (your primary edit target);
(3) `cross-deployment-knowledge-contract.md` (v1.1 — edit ONLY if a finding requires contract
movement; v1.2 note if so); (4) `suite-draft-notes.md` (update).

## Priorities (per the report)

- **Green-side blockers FIRST** — the five rows the report names (§"Verdict: NEEDS-FOLD" at
  line 30, enumerated in §1): each gets the report's concrete fix. A row that cannot go green
  under a correct impl is the deepest suite defect — re-drive or re-shape the fixture until a
  correct v1.1 implementation passes it and a wrong one fails at the named stage.
- **Minors** — F2.2 (A1-R4 must discriminate the containment walk from plain deployment-root
  validation), F2.4 (the primary-refusal probe seam: the contract D3 names the coordinator
  mutator seam — align the probe or pin both), the §140 finding.
- Suite stays red-first: PINs green, capability rows RED at named stages. Run twice from the
  repo root, record both splits. No clocks; sorted-key literals ACTUAL order; `localeCompare`
  banned; NUL discipline; hermetic. `watchdog.stallMs` valid-positive in every fixture (the
  #67 law); `stallAction` only from the contract vocabulary.

## Deliverables (edit ONLY these)

`impl/test/cross-deployment-knowledge-red.test.mjs` ·
`docs/reference/evidence/cross-deployment-knowledge-2026-08-07/suite-draft-notes.md` ·
`docs/reference/evidence/cross-deployment-knowledge-2026-08-07/suite-fold-2.md` (finding →
resolution map) · `cross-deployment-knowledge-contract.md` (v1.2 ONLY if a finding requires
contract movement).
