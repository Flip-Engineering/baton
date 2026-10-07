# #66 SUITE-FOLD BRIEF — fold the blue-team findings into the doubt-review suite

You are folding a blue-team report into the doubt-review red-first suite. Read fully, in order:
(1) `suite-blueteam.md` (NEEDS-FOLD — blockers in §83 (green-side), shallow-greenability in §117,
missing-row gaps in §165; each finding carries its concrete fix); (2)
`impl/test/doubt-review-red.test.mjs` (your primary edit target); (3) `doubt-review-contract.md`
(v1.1 — edit ONLY if a finding requires contract movement; v1.2 note if so); (4)
`suite-draft-notes.md` (update).

## Priorities (per the report's concrete fixes)

- **§83 blockers (green-side)** — every row that cannot go green under a CORRECT v1.1
  implementation, fixed per the report (fixtures that can't mint the needed state, oracles
  contradicting the fold).
- **§117 shallow-greenability** — the doubt-kind discrimination, the cross-run authority check,
  the self-resolution receipt distinction, the settle error path doubts-intact assertion — each
  hardened per the report.
- **§165 missing rows** — the refusal-code rows, the UNTRUSTED framing rows, the spill
  resolvability, the answer-push addressing.
- Suite stays red-first: PINs green, capability rows RED at named stages. Run twice from the
  repo root, record both splits. No clocks; sorted-key literals ACTUAL order; `localeCompare`
  banned; NUL discipline; hermetic.

## Deliverables (edit ONLY these)

`impl/test/doubt-review-red.test.mjs` ·
`docs/reference/evidence/doubt-review-2026-08-12/suite-draft-notes.md` ·
`docs/reference/evidence/doubt-review-2026-08-12/suite-fold-2.md` (finding → resolution map) ·
`doubt-review-contract.md` (v1.2 ONLY if required).
