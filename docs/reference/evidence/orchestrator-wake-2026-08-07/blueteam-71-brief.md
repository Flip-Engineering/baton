# #71 BLUE-TEAM BRIEF — attack the orchestrator-wake red-first suite

You are the **blue team** for the orchestrator-wake suite. Target: NOT the contract — the
SUITE's red-keeping power. Read fully, in order: (1) `orchestrator-wake-contract.md` (v1.1);
(2) `contract-fold.md` (the two-cursor split, stable candidacy, drift items); (3)
`impl/test/orchestrator-wake-red.test.mjs` (33 tests: 6 green PINs, 27 red at named stages);
(4) `suite-draft-notes.md`.

## Attack axes (per row)

- **Green-side blockers FIRST** — can every red row go green under a CORRECT v1.1
  implementation? Fixtures that can't mint the needed state (a pending decision, an advertised
  plan, a terminal member) or rows contradicting the folded contract.
- **Shallow-greenability** — sharpened for this lane: could the two-cursor rows pass with the
  cursors still folded into one token on the wire (split internally but one token externally —
  the B1 bug in a costume)? Could the race-free row pass with a register-then-read order that
  loses events between the seq read and the wait (the fixture must interleave an event INTO the
  gap)? Could answer-from-wake pass with a stale payload that isn't revalidated at delivery?
  Could the authority-inversion row pass with a check that trusts the caller's claimed
  principal class?
- **Missing-row gaps** — every v1.1 refusal code; the honest-empty row (a wake with nothing
  pending returns empty, never a fabricated reason); the bounded-payload spill row; the
  cancellation path.
- **Stage honesty + hermeticity** — named stages at HEAD; fake timers as doubles fine; no row
  may depend on real wall time (the #7 class).

## Output + laws

`docs/reference/evidence/orchestrator-wake-2026-08-07/suite-blueteam.md`: BLUE-CLEAN or
NEEDS-FOLD with numbered findings (row/gap + attack + concrete fix). Edit ONLY that file. No
clocks; citations verified (`grep -an`/`sed -n` on the two NUL files); run the suite twice from
the repo root and record both splits.
