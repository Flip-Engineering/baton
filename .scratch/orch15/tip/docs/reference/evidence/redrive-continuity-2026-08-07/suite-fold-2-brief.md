# #59 SUITE-FOLD BRIEF — fold the blue-team findings into the re-drive-continuity suite

You are folding a blue-team report into the re-drive-continuity red-first suite. Read fully, in
order: (1) `suite-blueteam.md` (NEEDS-FOLD — 7 numbered findings in §3, each with its concrete
fix; F1 is CRITICAL); (2) `impl/test/redrive-continuity-red.test.mjs` (your primary edit target);
(3) `redrive-continuity-contract.md` (v1.1 — edit ONLY if a finding requires contract movement);
(4) `suite-draft-notes.md` (update).

## Priorities (per the report's §3 concrete fixes)

- **F1 (CRITICAL)** — the R6 no-store-write invariant asserts a nonexistent `entries` field, so
  the restore-implementation the blocker was written to kill passes green. Fix the invariant to
  assert against the REAL store surface per the report.
- **F2** — the default-off fixture must distinguish default-on-when-a-source-exists (stage a
  source existing AND the flag unset; byte-identity to no-carry must hold only when truly off).
- **F3** — the D1.2 pin-list disambiguation needs a foreign-pin fixture (a pin never in the dead
  attempt's history must be refused/absent per the contract's rule).
- **F4-F7** — the within-block order row; the spill resolvability round trip; the four missing
  refusal-code rows; the provenance-line-first assertion.
- Suite stays red-first: PINs green, capability rows RED at named stages. Run twice from the
  repo root, record both splits. No clocks; sorted-key literals ACTUAL order; `localeCompare`
  banned; NUL discipline; hermetic.

## Deliverables (edit ONLY these)

`impl/test/redrive-continuity-red.test.mjs` ·
`docs/reference/evidence/redrive-continuity-2026-08-07/suite-draft-notes.md` ·
`docs/reference/evidence/redrive-continuity-2026-08-07/suite-fold-2.md` (finding → resolution
map, all 7) · `redrive-continuity-contract.md` (v1.2 ONLY if required).
