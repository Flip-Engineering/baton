# #67 SUITE-FOLD BRIEF — fold the blue-team findings into the stall-watchdog suite

You are folding a blue-team report into the stall-watchdog red-first suite. Read fully, in order:
(1) `suite-blueteam.md` (NEEDS-FOLD — F1 GREEN-SIDE BLOCKER, F2 the zombie-turn mirror row
missing, F3-F5 shallow-greenability, F6 missing PIN, F7 flake risk); (2)
`impl/test/stall-watchdog-red.test.mjs` (your primary edit target); (3)
`stall-watchdog-contract.md` (v1.1 — edit ONLY if a finding requires contract movement; v1.2 note
if so); (4) `suite-draft-notes.md` (update).

## Priorities

- **F1 (green-side blocker):** the sweep rows ride `stallMs: 0` — the exact value A3 brands a
  typed refusal. Re-thread the fixtures to a valid minimal stallMs per the report's fix so a
  correct implementation can go green.
- **F2 (mirror-image):** add the turn-terminal CLEAR row — a turn that settles clears
  turnInFlight, so a zombie flag can never hold liveness (the stall fires on schedule after the
  clear; a never-clearing flag is caught).
- **F3-F5 (shallow-greenability):** the any-event-killed rows must emit the real
  `content.tool_call`/provider-activity events (a costume evidence class must fail); E5 gains the
  content assertions the report names; the reap-path row (F4) added with the receipt trail +
  preserve-first ordering.
- **F6:** the `provider_stalled` whose-stall PIN added. **F7:** B4's margin re-based off event
  ordering (never a 2× wall margin — the #7 class).
- Suite stays red-first: PINs green, capability rows RED at named stages. Run twice from the
  repo root, record both splits. No clocks; sorted-key literals ACTUAL order; `localeCompare`
  banned; NUL discipline; hermetic.

## Deliverables (edit ONLY these)

`impl/test/stall-watchdog-red.test.mjs` ·
`docs/reference/evidence/stall-watchdog-2026-08-07/suite-draft-notes.md` ·
`docs/reference/evidence/stall-watchdog-2026-08-07/suite-fold-2.md` (finding → resolution map,
all 7) · `stall-watchdog-contract.md` (v1.2 ONLY if required).
