# #69 BLUE-TEAM BRIEF — attack the REPL-realization red-first suite

You are the **blue team** for the REPL-realization suite. Target: NOT the contract — the SUITE's
red-keeping power. Read fully, in order: (1) `repl-realization-contract.md` (v1.1); (2)
`contract-fold.md` (the 8 blocker resolutions incl. R9/R10/R11); (3)
`impl/test/repl-realization-red.test.mjs` (32 tests: 10 green PINs, 22 red at named stages);
(4) `suite-draft-notes.md`.

## Attack axes (per row)

- **Green-side blockers FIRST** — can every red row go green under a CORRECT v1.1
  implementation? Fixtures that can't mint the needed state (a multi-run wave for R11, a foreign
  citation for R10, a cell with embedded `\n## ` for R9) or oracles contradicting the folded
  contract.
- **Shallow-greenability** — sharpened: R9 — could a sanitizer that strips the `#` characters
  but keeps the text pass while the contract's single-line-leaf rule is violated? R10 — could a
  membership check that trusts the caller's CLAIMED task (not the server-derived one) pass?
  R11 — could a fan-out that admits the binding into only the FIRST member's run pass the row
  if the row only checks one member? The no-arbitrary-code static row — could it be gamed by an
  indirect import (the walkImportGraph transitive discipline, or a gap in it)?
- **Missing-row gaps** — every v1.1 refusal code (repl_citation_out_of_run and the rest); the
  promotion-never-auto row (a candidacy that lands without orchestrator review must refuse);
  the byte-bound + spill-resolvable round trip; the D7 rendering order.
- **Stage honesty + hermeticity** — named stages at HEAD; mkdtemp only; no order-dependence.

## Output + laws

`docs/reference/evidence/repl-realization-2026-08-07/suite-blueteam.md`: BLUE-CLEAN or
NEEDS-FOLD with numbered findings (row/gap + attack + concrete fix). Edit ONLY that file. No
clocks; citations verified (`grep -an`/`sed -n` on the two NUL files); run the suite twice from
the repo root and record both splits.
