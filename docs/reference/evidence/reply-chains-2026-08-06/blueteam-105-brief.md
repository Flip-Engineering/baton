# #105 BLUE-TEAM BRIEF — attack the reply-chains red-first suite

You are the **blue team** for the reply-chains suite. Target: NOT the contract — the SUITE's
red-keeping power. Read fully, in order: (1) `reply-chains-contract.md` (v1.1); (2)
`contract-fold.md` (B-1..B-7 resolutions); (3) `impl/test/reply-chains-red.test.mjs` (25 tests:
5 green PINs, 20 red); (4) `suite-draft-notes.md`.

## Attack axes (per row)

- **Green-side blockers FIRST** (the row cannot go green under a CORRECT v1.1 implementation —
  the #132 suite's F1-F3 class): fixtures that can't mint the state a row needs (a budgeted root,
  a multi-member run, a replayed store), oracles that contradict the contract's own folded shape.
- **Shallow-greenability** — could an implementation pass WITHOUT the capability? Sharpened for
  this lane: the A1 default-1 byte-identity PIN (is it truly byte-level?); the walk row (could
  messageRunId resolve only the ROOT and pass?); the membership row (could the check run AFTER
  the depth check and still pass the row while violating B-2's ordering law?); the replay row
  (does it rebuild from a FRESH store, or an in-memory map the test itself warmed?); the budget
  refusal rows (does any row accept a refusal with the right code but a self-authored payload?).
- **Missing-row gaps** — every v1.1 refusal code (message_budget_invalid, the depth-exhaustion
  code, message_parent_not_found / message_target_not_member); the legacy-alias replay row (B-4's
  second message.sent shape); the per-member multi-reply parent case; the escalation marker's
  deadlock-recovery path.
- **Stage honesty** — every red row fails at its NAMED stage at HEAD.
- **Hermeticity** — mkdtemp only, test.after cleanup, no network, no order-dependence.

## Output + laws

`docs/reference/evidence/reply-chains-2026-08-06/suite-blueteam.md`: BLUE-CLEAN or NEEDS-FOLD
with numbered findings (row/gap + attack + concrete fix). Edit ONLY that file. No clocks;
citations verified (`grep -an`/`sed -n` on the two NUL files); run the suite twice from the repo
root and record both splits before claiming stage honesty.
