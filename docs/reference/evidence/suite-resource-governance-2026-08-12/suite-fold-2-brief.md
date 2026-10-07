# #77 SUITE-FOLD BRIEF — fold the blue-team findings into the suite-resource-governance suite

You are folding a blue-team report into the suite-resource-governance red-first suite. Read
fully, in order: (1) `suite-blueteam.md` (NEEDS-FOLD — the findings, each with its concrete
fix); (2) `impl/test/suite-resource-governance-red.test.mjs` (your primary edit target); (3)
`suite-resource-governance-contract.md` (v1.1 — edit ONLY if a finding requires contract
movement; v1.2 note if so); (4) `suite-draft-notes.md` (update).

## Priorities (per the report's concrete fixes)

- **Green-side blockers first** (any row a correct v1.1 implementation cannot green) — per the
  report.
- **Shallow-greenability hardening** — the measurement-costume row (a hardcoded baseline must
  fail), the floor row (a below-floor calibrated deadline must fail), the D2 row (a correctness
  failure recalibrated away must fail), the host-bound row.
- **Missing rows** — the refusal-code rows, the load-context receipt row, the per-file vs
  whole-run budget separation row.
- Suite stays red-first: PINs green, capability rows RED at named stages. Run twice from the
  repo root, record both splits. No clocks; sorted-key literals ACTUAL order; `localeCompare`
  banned; NUL discipline; hermetic (fake load doubles only — NO real host load reads; a flaky
  row in THIS suite is the deepest irony — catch it).

## Deliverables (edit ONLY these)

`impl/test/suite-resource-governance-red.test.mjs` ·
`docs/reference/evidence/suite-resource-governance-2026-08-12/suite-draft-notes.md` ·
`docs/reference/evidence/suite-resource-governance-2026-08-12/suite-fold-2.md` (finding →
resolution map) · `suite-resource-governance-contract.md` (v1.2 ONLY if required).
