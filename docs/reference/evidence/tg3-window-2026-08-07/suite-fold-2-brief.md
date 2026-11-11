# #80 SUITE-FOLD BRIEF — fold the blue-team findings into the TG3-window suite

You are folding a blue-team report into the TG3-window red-first suite. Read fully, in order:
(1) `suite-blueteam.md` (NEEDS-FOLD — 7 findings F1-F7, each with its concrete fix); (2)
`impl/test/tg3-window-red.test.mjs` (your primary edit target); (3) `tg3-window-contract.md`
(v1.1 — edit ONLY if a finding requires contract movement; v1.2 note if so); (4)
`suite-draft-notes.md` (update).

## Priorities (per the report's concrete fixes)

- **F1 (HIGH)** — the provider-call answer rows must stage against the
  `provider_call_after_terminal` gate deliberately: pin WHICH side (false-red vs false-green)
  each row exercises, per the report's fix.
- **F2** — TW-03's "minute 4" staging must ride fake timers / event ordering, never real wall
  time (the #7 flake class).
- **F3** — pin that qualifying in-window evidence is APPENDED to `record.steering.observedEvidence`
  (TW-05 may not inject the fold directly).
- **F4-F7** — the which-call-answered assertion; the TG6 content-free-write row staged; TW-02's
  semantic (not regex-shape) pin; F7 per the report.
- Suite stays red-first: PINs green, capability rows RED at named stages. Run twice from the
  repo root, record both splits. No clocks; sorted-key literals ACTUAL order; `localeCompare`
  banned; NUL discipline; hermetic.

## Deliverables (edit ONLY these)

`impl/test/tg3-window-red.test.mjs` ·
`docs/reference/evidence/tg3-window-2026-08-07/suite-draft-notes.md` ·
`docs/reference/evidence/tg3-window-2026-08-07/suite-fold-2.md` (finding → resolution map, all
7) · `tg3-window-contract.md` (v1.2 ONLY if required).
