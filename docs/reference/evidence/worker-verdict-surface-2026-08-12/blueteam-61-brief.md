# #61 BLUE-TEAM BRIEF — attack the worker-verdict-surface red-first suite

You are the **blue team** for the #61 suite. Target: NOT the contract — the SUITE's
red-keeping power. Read fully, in order: (1) `contract-fold.md` (**v1.1** — the folded pins
R1–R9 + the closed `check` domain + the B1–B6 resolutions); (2)
`impl/test/worker-verdict-surface-red.test.mjs` (24 rows: 5 PIN green, 19 RED at named
stages); (3) `suite-draft-notes.md`.

## Attack axes (per row)

- **Green-side blockers FIRST** — can every red row go green under a CORRECT v1.1
  implementation? Especially: the R1 exact-`detail`-key rows (can the fixture drive a real
  terminal code through the projection?), R6 (the `worktreeHarvestPolicy` read — can a fixture
  mint both policy values?), R9 (admission-frozen derivation — can the fixture change live
  truth MID-RUN to prove the freeze?).
- **Shallow-greenability** — could an impl pass R7 (named derivation sources) with a registry
  that exists but is never consulted (the lines still render boilerplate)? Could the closed
  `check` domain pass by mapping everything to `null` (over-escalation — the whitelist rows
  must assert the POSITIVE mappings too)? Could R3's hub-mint pass with caller-authored
  content wearing a hub costume (the #73 law — authorship must be structural)?
- **Missing rows** — the B6 epoch on the suppression record: pinned behaviorally? The
  `[attempt:]` salt-line carve-out (fold minor): pinned?
- **Hermeticity / #7-class** — no real timers, no host state; `watchdog.stallMs`
  valid-positive in every fixture (the #67 law).

Verdict per axis: SOUND / NEEDS-FOLD (each finding with its concrete fix). Write ONLY
`docs/reference/evidence/worker-verdict-surface-2026-08-12/suite-blueteam.md`. Laws: no
clocks; citations re-verified (`grep -an`/`sed -n` on the NUL files).
