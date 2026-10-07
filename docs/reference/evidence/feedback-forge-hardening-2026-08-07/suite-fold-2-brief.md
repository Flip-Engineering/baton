# #73 SUITE-FOLD BRIEF — fold the blue-team findings into the feedback-forge-hardening suite

You are folding a blue-team report into the #73 red-first suite. Read fully, in order: (1)
`suite-blueteam.md` (NEEDS-FOLD — axis 1 SOUND; five load-bearing holes S1–S3 + M1–M3, each
with its concrete fold); (2) `impl/test/feedback-forge-hardening-red.test.mjs` (your primary
edit target); (3) `feedback-forge-hardening-contract.md` (v1.1 — edit ONLY if a finding
requires contract movement; v1.2 note if so); (4) `suite-draft-notes.md` (update).

## Priorities (per the report)

- **S1 (HIGH)** — pin the candidate-scoped `runId`+`taskId` referent boundary BEHAVIORALLY: a
  row driving a SECOND run whose same-shaped record must not bind (the contract's
  "cross-run verdict laundering is blocked by construction" claim becomes a tested law).
- **M1 (HIGH)** — B5's per-record degradation + migration: a persisted pre-hardening record
  must be excluded per-record on read-back while later records project (the code path must be
  REACHED, not vacuous).
- **M2 (HIGH)** — B4 replay-stability: a second gate event after recording must not move the
  bound projection.
- **S2 / S3 (MEDIUM)** — assert the `SECRET_SHAPED_TEXT` guard on the coaching branch; assert
  GREEN-4's render half (the distinct verdict line + the non-`undefined` feedback summary).
- **M3 (LOW)** — the `application_workflow_feedback_gate_unbound` code's surface constancy.
- Suite stays red-first: PINs green, capability rows RED at named stages. Run twice from the
  repo root, record both splits. No clocks; sorted-key literals ACTUAL order; `localeCompare`
  banned; NUL discipline; hermetic. `watchdog.stallMs` valid-positive in every fixture (the
  #67 law); `stallAction` only from the contract vocabulary.

## Deliverables (edit ONLY these)

`impl/test/feedback-forge-hardening-red.test.mjs` ·
`docs/reference/evidence/feedback-forge-hardening-2026-08-07/suite-draft-notes.md` ·
`docs/reference/evidence/feedback-forge-hardening-2026-08-07/suite-fold-2.md` (finding →
resolution map) · `feedback-forge-hardening-contract.md` (v1.2 ONLY if a finding requires
contract movement).
