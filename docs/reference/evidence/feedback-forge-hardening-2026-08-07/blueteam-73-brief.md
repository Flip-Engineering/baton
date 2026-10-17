# #73 BLUE-TEAM BRIEF — attack the feedback-forge-hardening red-first suite

You are the **blue team** for the #73 suite. Target: NOT the contract — the SUITE's
red-keeping power. Read fully, in order: (1) `feedback-forge-hardening-contract.md` (v1.1, §5
acceptance pins); (2) `contract-fold.md` (the referent fix + the one derived-flag model); (3)
`impl/test/feedback-forge-hardening-red.test.mjs` (13 rows: 7 PIN green, 6 RED at named
stages); (4) `suite-draft-notes.md`.

## Attack axes (per row)

- **Green-side blockers FIRST** — can every red row go green under a CORRECT v1.1
  implementation? The G2 shape-boundary rows (gate-shaped → hub-minted-or-refused vs
  coaching-shaped → authored) need fixtures driving `run.feedback` through the real
  normalization (`application.mjs:1645-1682`) — confirm the fixture reaches the seam.
- **Shallow-greenability** — could an impl pass the forged-verdict rows by refusing
  gate-shaped input outright (breaking the hub-minted path) instead of minting-or-refusing
  honestly? Could the referent-fix rows pass with a referent bound at the wrong identity
  (candidate vs worker)? The `SECRET_SHAPED_TEXT` guard: is a secret-shaped coaching payload
  asserted refused?
- **Missing rows** — the migration pin (pre-hardening records replay honestly): is it
  behaviorally pinned? The one derived-flag model: is there a row where BOTH flags would have
  fired pre-fold?
- **Hermeticity / #7-class** — no real timers, no host state.

Verdict per axis: SOUND / NEEDS-FOLD (each finding with its concrete fix). Write ONLY
`docs/reference/evidence/feedback-forge-hardening-2026-08-07/suite-blueteam.md`. Laws: no
clocks; citations re-verified (`grep -an`/`sed -n` on the NUL files).
