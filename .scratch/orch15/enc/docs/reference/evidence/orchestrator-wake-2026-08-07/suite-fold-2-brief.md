# #71 SUITE-FOLD BRIEF — fold the blue-team findings into the orchestrator-wake suite

You are folding a blue-team report into the orchestrator-wake red-first suite. Read fully, in
order: (1) `suite-blueteam.md` (NEEDS-FOLD — 10 findings, each with its concrete fix); (2)
`impl/test/orchestrator-wake-red.test.mjs` (your primary edit target); (3)
`orchestrator-wake-contract.md` (v1.1 — edit ONLY if a finding requires contract movement; v1.2
note if so); (4) `suite-draft-notes.md` (update).

## Priorities

- **Green-side blockers first** (any finding where a correct v1.1 implementation cannot go
  green) — per the report's concrete fixes.
- **Shallow-greenability hardening** — the two-cursor rows must defeat a one-token-on-the-wire
  costume; the race-free row must interleave an event INTO the read/register gap; the
  answer-from-wake row must exercise the stale-payload revalidation; the authority-inversion row
  must not trust a claimed principal class.
- **Missing rows + remaining findings** per the report (all 10, resolved or explicitly deferred
  with the reason).
- Suite stays red-first: PINs green, capability rows RED at named stages. Run twice from the
  repo root, record both splits. No clocks; sorted-key literals ACTUAL order; `localeCompare`
  banned; NUL discipline; hermetic (no real wall time — the #7 class).

## Deliverables (edit ONLY these)

`impl/test/orchestrator-wake-red.test.mjs` ·
`docs/reference/evidence/orchestrator-wake-2026-08-07/suite-draft-notes.md` ·
`docs/reference/evidence/orchestrator-wake-2026-08-07/suite-fold-2.md` (finding → resolution map,
all 10) · `orchestrator-wake-contract.md` (v1.2 ONLY if required).
