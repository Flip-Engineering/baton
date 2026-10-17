# #69 SUITE-FOLD BRIEF — fold the blue-team findings into the REPL-realization suite

You are folding a blue-team report into the REPL-realization red-first suite. Read fully, in
order: (1) `suite-blueteam.md` (NEEDS-FOLD — 8 findings F1-F8, each with its concrete fix);
(2) `impl/test/repl-realization-red.test.mjs` (your primary edit target); (3)
`repl-realization-contract.md` (v1.1 — edit ONLY if a finding requires contract movement; v1.2
note if so); (4) `suite-draft-notes.md` (update).

## Priorities (per the report's concrete fixes)

- **F1 (green-side blocker)** — G2's phantom `taskId 'task-x'` fixture must mint a REAL task so
  the own-run positive path is greenable under a correct implementation.
- **F5** — the R11 fan-out row must call the (invented) fan-out facade, not the already-shipped
  store machinery — a row that passes today without the lane is a false PIN.
- **F7** — the no-arbitrary-code static row walks the lane's transitive module graph (the
  walkImportGraph idiom from the #114 suite), not a closed 4-file list.
- **F8** — the promotion row must distinguish always-refuse from correct (a valid promotion
  path succeeds under the correct implementation).
- **F2/F3/F4/F6** — the D7 render-order row's #79 dependency made explicit (target-state posture
  or independent, per the report); the D5 provenance row aligned to a pinned mechanism; the
  insertion-order over-pins corrected per the contract's actual key-order law; R10 exercises the
  real port + a resolvable foreign-run citation.
- Suite stays red-first: PINs green, capability rows RED at named stages. Run twice from the
  repo root, record both splits. No clocks; sorted-key literals ACTUAL order; `localeCompare`
  banned; NUL discipline; hermetic.

## Deliverables (edit ONLY these)

`impl/test/repl-realization-red.test.mjs` ·
`docs/reference/evidence/repl-realization-2026-08-07/suite-draft-notes.md` ·
`docs/reference/evidence/repl-realization-2026-08-07/suite-fold-2.md` (finding → resolution map,
all 8) · `repl-realization-contract.md` (v1.2 ONLY if required).
