# #74 BLUE-TEAM BRIEF — attack the worker-orchestrated-swarm red-first suite

You are the **blue team** for the #74 suite. Target: NOT the contract — the SUITE's
red-keeping power. Read fully, in order: (1) `contract-fold.md` (**v1.1** — D1.2/D1.3/D1.4 are
the folded laws); (2) `impl/test/worker-orchestrated-swarm-red.test.mjs` (15 rows: 8 PIN
green, 7 RED at named stages — two static anchors were re-based for the #67 drift at landing,
noted in the file); (3) `suite-draft-notes.md`; (4) `contract-redteam.md`.

## Attack axes (per row)

- **Green-side blockers FIRST** — can every red row go green under a CORRECT v1.1
  implementation? Especially A3/A3b (the truthful steering trail): can the fixture actually
  drive `answerDecision` into a denied answer AND a raced-terminal answer hermetically? A2's
  read-law rows: can a fixture mint a wave-scoped grant?
- **Shallow-greenability** — could an impl record `outcome: 'denied'` while STILL marking the
  key handled (the permanence half)? Could A2 pass by refusing ALL cross-worker reads
  (over-refusal — the wave-scoped grant path must ALSO be asserted reachable)? Could A5 pass
  by refusing waves.* for everyone instead of only lease-bound principals?
- **The static anchors** — the P-A5-static/P-A10 rows pin line windows that drift on every
  landing: is the drift-alarm value worth the re-base churn, or should the rows assert
  ORDER/EXISTENCE only? Rule on it with a concrete recommendation (the campaign's pin-drift
  law currently owns re-basing at landing).
- **Missing rows** — D1.4's sequence bound is a comment-row; is that honest? The A4 two-level
  byte-identical refusal: pinned? The D4 harvest file-not-directory law: P-A8-dir pins it —
  is the basis assertion deep enough?

Verdict per axis: SOUND / NEEDS-FOLD (each finding with its concrete fix). Write ONLY
`docs/reference/evidence/worker-orchestrated-swarm-2026-08-13/suite-blueteam.md`. Laws: no
clocks; citations re-verified (`grep -an`/`sed -n` on the NUL files).
