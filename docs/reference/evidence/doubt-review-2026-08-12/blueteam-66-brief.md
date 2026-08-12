# #66 BLUE-TEAM BRIEF — attack the doubt-review red-first suite

You are the **blue team** for the doubt-review suite. Target: NOT the contract — the SUITE's
red-keeping power. Read fully, in order: (1) `doubt-review-contract.md` (v1.1); (2)
`contract-fold.md` (the 7 resolutions); (3) `impl/test/doubt-review-red.test.mjs` (29 tests: 5
green PINs, 24 red at named stages); (4) `suite-draft-notes.md`.

## Attack axes (per row)

- **Green-side blockers FIRST** — can every red row go green under a CORRECT v1.1
  implementation? Fixtures that can't mint the needed state (a doubt entry, a wave with two
  members, a settle in progress) or oracles contradicting the fold.
- **Shallow-greenability** — sharpened for this lane: could the elevation rows pass with doubt
  KIND not discriminated (any entry elevating)? Could the queryable-surface rows pass with a
  wave-scoped read that secretly reads cross-run? Could the promote_doubt rows pass with a
  self-resolution not receipted distinctly (or a forged authority)? Could the settle rows pass
  with doubts silently dropped on the error path?
- **Missing-row gaps** — every v1.1 refusal code; the UNTRUSTED framing assertion on rendered
  questions AND answers; the spill resolvability; the answer-push addressing.
- **Stage honesty + hermeticity** — named stages at HEAD; mkdtemp only; no order-dependence.

## Output + laws

`docs/reference/evidence/doubt-review-2026-08-12/suite-blueteam.md`: BLUE-CLEAN or NEEDS-FOLD
with numbered findings (row/gap + attack + concrete fix). Edit ONLY that file. No clocks;
citations verified (`grep -an`/`sed -n` on the two NUL files); run the suite twice from the repo
root and record both splits.
