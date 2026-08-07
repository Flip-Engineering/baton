# #59 BLUE-TEAM BRIEF — attack the re-drive-continuity red-first suite

You are the **blue team** for the re-drive-continuity suite. Target: NOT the contract — the
SUITE's red-keeping power. Read fully, in order: (1) `redrive-continuity-contract.md` (v1.1);
(2) `contract-fold.md` (per-item neutralization, both renderers, the total render order); (3)
`impl/test/redrive-continuity-red.test.mjs` (24 tests: 5 green PINs, 19 red at named stages);
(4) `suite-draft-notes.md`.

## Attack axes (per row)

- **Green-side blockers FIRST** — can every red row go green under a CORRECT v1.1
  implementation? Fixtures that can't mint the needed state (a dead attempt with checkpoint
  history + scratchpad projection, a foreign-role source) or oracles contradicting the fold.
- **Shallow-greenability** — sharpened for the poisoned-successor lane: could the
  neutralization rows pass with a sanitizer that strips `##` but leaves the text as a
  free-floating line that still READS as a section to the model? Could the TG2
  evidence-never-authority row pass with a carried digest counted under a renamed class? Could
  the pin-history binding pass with a list that's just "pins from before the re-drive" (the
  fold-114-v1 wrong-pin class)? Could the opt-in row pass with default-on-when-empty?
- **Missing-row gaps** — every v1.1 refusal code; the render-order row with all three sections
  present (not pairwise); the provenance-line-first assertion; the spill resolvability.
- **Stage honesty + hermeticity** — named stages at HEAD; mkdtemp only; no order-dependence.

## Output + laws

`docs/reference/evidence/redrive-continuity-2026-08-07/suite-blueteam.md`: BLUE-CLEAN or
NEEDS-FOLD with numbered findings (row/gap + attack + concrete fix). Edit ONLY that file. No
clocks; citations verified (`grep -an`/`sed -n` on the two NUL files); run the suite twice from
the repo root and record both splits.
