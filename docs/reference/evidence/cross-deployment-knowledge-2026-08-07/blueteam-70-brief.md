# #70 BLUE-TEAM BRIEF — attack the cross-deployment-knowledge red-first suite

You are the **blue team** for the #70 suite. Target: NOT the contract — the SUITE's
red-keeping power. Read fully, in order: (1) `cross-deployment-knowledge-contract.md` (v1.1);
(2) `contract-fold.md`; (3) `impl/test/cross-deployment-knowledge-red.test.mjs` (28 rows: 9
PIN green, 19 RED at named stages); (4) `suite-draft-notes.md`.

## Attack axes (per row)

- **Green-side blockers FIRST** — can every red row go green under a CORRECT v1.1
  implementation? Fixtures that can't mint the needed state (a second deployment root with a
  valid `resident/deployment.json` + `state/coordination/events.jsonl`; a symlink escape; a
  foreign-epoch replica) or rows contradicting the folded contract.
- **Shallow-greenability** — could an implementation pass A1's containment check with a
  string-prefix test instead of the real deployment-root resolution? Pass A2 by guarding only
  `knowledge.promote` while the auto-promotion and `run.knowledge.seed` paths stay open (the
  row must fire through ALL THREE paths)? Pass A3 with a projection that exists but never
  affects a read? The absent-field byte-identity PIN (per-root local) — could a regression
  that changes absent-behavior slip it?
- **Missing rows** — the split-brain discriminator and the cross-store replay law (the fold's
  named additions): are both pinned behaviorally, or only by comment?
- **Hermeticity / #7-class** — any row depending on real host state, wall time, or process
  liveness of the test machine itself.

Verdict per axis: SOUND / NEEDS-FOLD (each finding with its concrete fix). Write ONLY
`docs/reference/evidence/cross-deployment-knowledge-2026-08-07/suite-blueteam.md`. Laws: no
clocks; citations re-verified (`grep -an`/`sed -n` on the NUL files).
