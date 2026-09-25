# #103 SUITE-FOLD BRIEF — fold the blue-team findings into the briefing-pack suite

You are folding a blue-team report into the briefing-pack red-first suite. Read fully, in order:
(1) `suite-blueteam.md` (verdict NEEDS-FOLD, 17 findings F1-F17 — F1 CRITICAL; each finding
carries its concrete fix); (2) `impl/test/briefing-pack-red.test.mjs` (your primary edit target);
(3) `briefing-pack-contract.md` (v1.1 — edit ONLY where a finding's fix says the CONTRACT is
wrong; bump the header to v1.2 with a one-line note if you touch it); (4) `suite-draft-notes.md`
(update the row map + measured split).

## Priority and laws

- **F1 first** (CRITICAL): `P-A7base` is a broken pin — it contradicts `R-D9a` and flips red
  under the correct implementation. Rewrite the pin so it pins TODAY's behavior without
  contradicting the target behavior (or split it into two rows with the contradiction named).
- F2-F5 (oracle holes): pin the mint SITE, cross-check `landings.*` against the `wave.closed`
  record, assert the doctor sibling's VALUES not just shape, kill the dead-`briefing: null`
  green path with a positive behavioral exercise of the CLI render.
- F6-F12 (missing rows): add rows for the D4 validity leg, the resolve-envelope equality, the
  replay-derived rule (an in-memory map must FAIL), the D2 migration backfill, the waveId-keyed
  dedupe, the operator-actor gate, the append-failure path. Every new row: red at a NAMED stage.
- F13-F17 (remaining mediums/minors per the report): resolve or explicitly defer with the reason.
- After folding the suite stays red-first: guards/PINs green, every capability row RED at a named
  stage (the lane is unimplemented). Run `node --test impl/test/briefing-pack-red.test.mjs` from
  the repo root TWICE; record both splits. No clocks; sorted-key literals in ACTUAL sorted order;
  `localeCompare` banned; NUL discipline (`grep -an`/`sed -n` on the two NUL files); hermetic.

## Deliverables (edit ONLY these)

`impl/test/briefing-pack-red.test.mjs` ·
`docs/reference/evidence/briefing-pack-2026-08-06/suite-draft-notes.md` ·
`docs/reference/evidence/briefing-pack-2026-08-06/suite-fold-2.md` (finding → resolution map for
all 17) · `briefing-pack-contract.md` (v1.2 ONLY if a finding requires contract movement).
