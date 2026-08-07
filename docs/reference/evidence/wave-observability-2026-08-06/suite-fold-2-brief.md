# #132 SUITE-FOLD BRIEF — fold the blue-team findings into the wave-observability suite

You are folding a blue-team report into the wave-observability red-first suite. Read fully, in
order: (1) `suite-blueteam.md` (NEEDS-FOLD, 13 findings — F1-F3 CRITICAL green-side blockers);
(2) `impl/test/wave-observability-red.test.mjs` (your primary edit target); (3)
`wave-observability-contract.md` (v1.1 — edit ONLY where a finding's fix says the CONTRACT is
wrong; bump to v1.2 with a one-line note if you touch it); (4) `suite-draft-notes.md` (update).

## Priorities

- **F1-F3 first (green-side blockers — the suite cannot go green under a CORRECT impl):** the
  fixture must provide a deploymentId end-to-end (F3/D2.2); A1-3/A1-4 must dispatch to a runId
  the fixture actually creates; A6-1 must not depend on the facade per-member swallow the D5.1/F6
  fix never touches (re-aim the row at the layer the fix owns).
- **F4/F7/F8/F12 (shallow-greenability):** D5 surface-constancy asserted on the full
  {code,message} payload across facade + MCP + CLI (add the CLI leg); A1-6's card assertions must
  defeat special-casing (derive, don't enumerate); A1-7 pins the FULL ordered key set, not a
  subset; F12 per the report.
- **F5/F6/F9/F10/F11 (missing rows):** `wave_not_found` behaviorally exercised (not a source
  grep); replay-exactness row (fresh store from the same log ⇒ identical registry); the
  exactly-once-on-attach leg; the negative per-member runId envelope path; F11 per the report.
- **F13** per the report.
- Suite stays red-first: 4 PINs green, capability rows RED at named stages. Run twice from the
  repo root, record both splits. No clocks; sorted-key literals ACTUAL order; `localeCompare`
  banned; NUL discipline; hermetic.

## Deliverables (edit ONLY these)

`impl/test/wave-observability-red.test.mjs` ·
`docs/reference/evidence/wave-observability-2026-08-06/suite-draft-notes.md` ·
`docs/reference/evidence/wave-observability-2026-08-06/suite-fold-2.md` (finding → resolution
map, all 13) · `wave-observability-contract.md` (v1.2 ONLY if a finding requires it).
