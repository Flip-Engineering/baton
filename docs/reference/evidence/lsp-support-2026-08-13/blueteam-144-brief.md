# #144 BLUE-TEAM BRIEF — attack the LSP-pool red-first suite

You are the **blue team** for the #144 suite. Target: NOT the contract — the SUITE's
red-keeping power. Read fully, in order: (1) `contract-fold.md` (**v1.1** — the folded laws:
D1 pool, D2 diagnostic scoping, D3 environmental tier, D4 honesty/containment; the B1–B5
fixes); (2) `impl/test/issue144-lsp-pool-red.test.mjs` (23 rows: 10 PIN green, 13 RED at named
stages); (3) `suite-draft-notes.md` (the row inventory + the GP-B/GP-C re-anchor record).

## Attack axes (per row)

- **Green-side blockers FIRST** — can every red row go green under a CORRECT v1.1
  implementation? Especially R3 (the wedged trigger: can the fixture actually drive a server
  over the outstanding-request ceiling hermetically?), R9 (the dirty-base-root refusal: can
  the fixture mint a dirty worktree state the pool reads?), R10 (the effective-view absence
  key: can two workers with different overlays be fixtured?).
- **Shallow-greenability** — could an impl pass R2's single-flight with a lock that serializes
  but never JOINS (the concurrent-demand row must prove one server, not two sequential)? Could
  R12's never-a-gate-input pass by the projection existing but unconsulted? Could the B5a
  projection pass by emitting digests-only and dropping the symbol NAMES (the row must assert
  names present AND paths absent)? Could R13's opt-in refusal pass by refusing every language
  (the opted path must also be asserted reachable)?
- **The stubbed fixture** — is the `typescript-language-server` stub a real hermetic LSP
  responder (initialize + textDocument/*), or a costume that a no-server impl also satisfies
  (GP-L pins non-vacuity — verify it discriminates)?
- **Missing rows** — the B1 trust-posture card content: behaviorally pinned or comment-only?
  The single-flight slot-clear before `lsp_startup_failed` (B2's retry reachability): pinned?
- **Hermeticity / #7-class** — no real servers, no host load reads, no wall clocks.

Verdict per axis: SOUND / NEEDS-FOLD (each finding with its concrete fix). Write ONLY
`docs/reference/evidence/lsp-support-2026-08-13/suite-blueteam.md`. Laws: no clocks; citations
re-verified (`grep -an`/`sed -n` on the NUL files).
