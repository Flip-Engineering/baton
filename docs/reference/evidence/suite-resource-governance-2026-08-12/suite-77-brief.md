# #77 SUITE BRIEF — red-first suite for the folded suite-resource-governance contract v1.1

You are drafting the **red-first acceptance suite** for the folded suite-resource-governance
contract. Read fully, in order: (1) `suite-resource-governance-contract.md` (**v1.1** — source
of truth); (2) `contract-fold.md` (the 6 calibration-seam resolutions); (3) `contract-redteam.md`
(the attack surface); (4) idioms: `impl/scripts/run-suite.mjs` (the gate runner you're
specifying against) and `impl/test/phase56-drain-and-close.test.mjs` (the deadline-sensitive
suite family).

## Coverage (from the v1.1 acceptance pins)

- **D1 the calibration model** — measured-load-derived deadlines: a measured baseline × the
  pinned factor derives the per-file bound; the derivation floors at the honest static default
  (a calibrated deadline is NEVER shorter than the floor); the calibration receipt records the
  load context so a flake report carries it.
- **D2 flake-taxonomy honesty** — a row failing ONLY under load gets the load-context receipt +
  a named cause class (never a silent flake bucket); a correctness failure under load is NEVER
  recalibrated away (the two-sided rows: a slow-but-healthy machine passes; a hung process is
  still caught).
- **D3 parallelism posture** — concurrency adapts to the host within the pinned bound (never a
  fork-bomb-by-calibration); per-file timeout vs whole-run budget separated honestly.
- **Refusals/observability** — every code the contract names, typed, surface-constant.

## Suite law

Red-first (every capability row fails at a NAMED stage at HEAD); namespace imports for invented
surfaces; hermetic (mkdtemp only, test.after, no network; **fake load measurement is a test
double — no row may depend on REAL host load**); run TWICE from the repo root, record the stable
split; header carries the row inventory + stages + invented signatures + verified split;
sorted-key literals ACTUAL order; `localeCompare` banned; no clocks; NUL discipline.

## Deliverables (edit ONLY these)

`impl/test/suite-resource-governance-red.test.mjs` ·
`docs/reference/evidence/suite-resource-governance-2026-08-12/suite-draft-notes.md`.
