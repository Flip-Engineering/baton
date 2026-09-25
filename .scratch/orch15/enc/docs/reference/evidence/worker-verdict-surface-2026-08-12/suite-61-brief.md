# #61 SUITE BRIEF — red-first suite for the folded worker-verdict-surface contract v1.1

You are drafting the **red-first acceptance suite** for the folded #61 contract. Read fully,
in order: (1) `contract-fold.md` (**v1.1** — source of truth; the red-first acceptance pins
R1–R9 carry the row inventory); (2) §D1 (the four-field `{gate, check, detail, corrective}`
surface) + §D2 (objectives from live truth, Rules 1/2, the epoch pin, the
`worktreeHarvestPolicy` seam); (3) `contract-redteam.md` (the six blockers as folded); (4)
idioms: `impl/test/trust-gate-steering-red.test.mjs` (gate cycles) and
`impl/test/briefing-pack-red.test.mjs` (worker-facing projections).

## Coverage (from the v1.1 pins)

R1 (the exact `detail` key), R2 (evidence sanitization + the `required_effect` digest/count
shape), R3 (hub-minted correctives per terminal code — never caller-authored, #73 law), R4
(one projection, three consumers), R5 (the surface never rides the refinement brief — the
digest pin), R6 (the no-commit line never ships on a boundary-commit deployment —
`worktreeHarvestPolicy` read), R7 (every served constraint line has a named live derivation
source; none without one ships), R8 (the wire_frame line is lane-conditional), R9 (the
composed block is a pure function of live policy, frozen at admission; the suppression record
carries the derivation epoch). Plus the closed `check` domain (whitelist; everything else
escalates `check: null`) and the refusal vocabulary, typed and surface-constant.

## Suite law

Red-first (capability rows fail at NAMED stages at HEAD; PIN rows green); namespace imports
for invented surfaces; hermetic (mkdtemp, test.after, no network, no real provider spawns);
run TWICE from the repo root, record the stable split in the header (row inventory + stages +
invented signatures + verified split); sorted-key literals ACTUAL order; `localeCompare`
banned; NUL discipline (`grep -an`/`sed -n` on `application.mjs` + `coordination-store.mjs`);
no clocks as controls. NOTE: `watchdog.stallMs` must be a VALID POSITIVE integer in every
fixture (the #67 admission law — `stallMs: 0` now refuses; use `60_000` with the fixture
comment).

## Deliverables (edit ONLY these)

`impl/test/worker-verdict-surface-red.test.mjs` ·
`docs/reference/evidence/worker-verdict-surface-2026-08-12/suite-draft-notes.md`.
