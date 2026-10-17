# #144 SUITE-FOLD BRIEF — fold the blue-team findings into the LSP-pool suite

You are folding a blue-team report into the #144 red-first suite. Read fully, in order: (1)
`suite-blueteam.md` (NEEDS-FOLD — green-side blockers F1–F3 (R3 un-greenable on all three
legs) + F12 (R1's over-broad negative substring); shallow-greenability F8–F10; F11 the stub
handshake's wall-clock; each with its concrete fix); (2)
`impl/test/issue144-lsp-pool-red.test.mjs` (your primary edit target); (3) `contract-fold.md`
(v1.1 — edit ONLY if a finding requires contract movement; v1.2 note if so); (4)
`suite-draft-notes.md` (update).

## Priorities (per the report)

- **Green-side blockers FIRST** — F1–F3: R3's wedged-trigger legs must be drivable
  hermetically by a correct v1.1 implementation (the report's concrete fixes); F12: R1's
  negative substring narrowed so a correct honest-empty projection can't trip it.
- **Shallow-greenability** — F8 (the blast-radius projection must be CONSULTED, not merely
  present), F9 (symbol NAMES must be non-empty — droppable-to-empty fails), F10 (the opt-in
  gate must also assert the OPTED path reachable, not refuse-everything).
- **F11** — the stub handshake's wall-clock hard deadline violates the suite's own law:
  re-drive it on event/order evidence (or a fixture-seeded condition), never a wall clock.
- Suite stays red-first: PINs green, capability rows RED at named stages. Run twice from the
  repo root, record both splits. Sorted-key literals ACTUAL order; `localeCompare` banned; NUL
  discipline; hermetic. `watchdog.stallMs` valid-positive in every fixture (the #67 law).

## Deliverables (edit ONLY these)

`impl/test/issue144-lsp-pool-red.test.mjs` ·
`docs/reference/evidence/lsp-support-2026-08-13/suite-draft-notes.md` ·
`docs/reference/evidence/lsp-support-2026-08-13/suite-fold-2.md` (finding → resolution map) ·
`contract-fold.md` (v1.2 ONLY if a finding requires contract movement).
